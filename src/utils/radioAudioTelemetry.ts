import type { RadioStationId } from '../types.ts';

export const EQUALIZER_BAND_COUNT = 9;

export const IDLE_EQUALIZER_LEVELS: readonly number[] = [
  0.22, 0.36, 0.52, 0.34, 0.62, 0.44, 0.3, 0.22, 0.16,
];

interface RadioTelemetryState {
  isPlaying: boolean;
  trackId: string | null;
  trackStation: RadioStationId;
  durationMs: number;
  positionMs: number;
  relativePosition: number;
  lastProgressPerfMs: number;
  playbackStartedPerfMs: number;
  volume: number;
  isMuted: boolean;
  waveformByTrackId: Map<string, number[]>;
  tempoBpmByTrackId: Map<string, number>;
}

const state: RadioTelemetryState = {
  isPlaying: false,
  trackId: null,
  trackStation: 'indie',
  durationMs: 0,
  positionMs: 0,
  relativePosition: 0,
  lastProgressPerfMs: 0,
  playbackStartedPerfMs: 0,
  volume: 85,
  isMuted: false,
  waveformByTrackId: new Map<string, number[]>(),
  tempoBpmByTrackId: new Map<string, number>(),
};

export interface RadioFrameEnergy {
  overall: number;
  bass: number;
  bpm: number;
  volumeFactor: number;
  progress: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function hashTrackId(trackId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < trackId.length; i++) {
    hash ^= trackId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function getSampleAt(samples: number[], index: number): number {
  if (samples.length === 0) return 0;
  const clamped = Math.min(samples.length - 1, Math.max(0, index));
  const lo = Math.floor(clamped);
  const hi = Math.min(samples.length - 1, lo + 1);
  const frac = clamped - lo;
  return samples[lo] * (1 - frac) + samples[hi] * frac;
}

/**
 * Estimates musical tempo (BPM) from SoundCloud waveform amplitude peaks and duration,
 * falling back to station-appropriate rhythmic cadence when metadata is still arriving.
 */
function estimateWaveformTempoBpm(
  samples: number[],
  durationMs: number,
  station: RadioStationId,
  trackId: string
): number {
  const baseMin = station === 'electronic' ? 116 : 86;
  const baseMax = station === 'electronic' ? 138 : 118;
  const fallbackBpm = baseMin + hashTrackId(trackId) * (baseMax - baseMin);

  if (samples.length < 24 || durationMs < 15000) {
    return fallbackBpm;
  }

  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i];
  }
  const avg = sum / samples.length;
  const threshold = avg * 1.06;

  let peakCount = 0;
  let transientEnergy = 0;
  let lastPeakIdx = -4;
  for (let i = 1; i < samples.length - 1; i++) {
    const curr = samples[i];
    const diff = Math.max(0, curr - samples[i - 1]);
    transientEnergy += diff;
    if (curr >= threshold && curr > samples[i - 1] && curr >= samples[i + 1] && i - lastPeakIdx >= 2) {
      peakCount++;
      lastPeakIdx = i;
    }
  }

  const durationMinutes = durationMs / 60000;
  const rawPeaksPerMinute = peakCount / Math.max(0.25, durationMinutes);
  const meanTransient = transientEnergy / samples.length;

  const densityRatio = clamp01((rawPeaksPerMinute - 40) / 190 + meanTransient * 1.6);
  return Math.round(baseMin + densityRatio * (baseMax - baseMin));
}

function getEffectiveTempoBpm(): number {
  const trackId = state.trackId;
  if (!trackId) {
    return state.trackStation === 'electronic' ? 126 : 102;
  }
  const cached = state.tempoBpmByTrackId.get(trackId);
  if (cached) return cached;

  const samples = state.waveformByTrackId.get(trackId);
  if (samples && samples.length > 8) {
    const bpm = estimateWaveformTempoBpm(
      samples,
      state.durationMs,
      state.trackStation,
      trackId
    );
    if (state.durationMs > 0) {
      state.tempoBpmByTrackId.set(trackId, bpm);
    }
    return bpm;
  }

  const baseMin = state.trackStation === 'electronic' ? 118 : 88;
  const span = state.trackStation === 'electronic' ? 20 : 28;
  return Math.round(baseMin + hashTrackId(trackId) * span);
}

function getEffectiveVolumeFactor(): number {
  if (state.isMuted || state.volume <= 0) {
    return 0.14;
  }
  const normalized = clamp01(state.volume / 100);
  // Wide perceptual curve so changing volume noticeably scales wave height
  return 0.22 + Math.pow(normalized, 0.72) * 0.88;
}

export function getLiveRadioProgress(nowPerfMs?: number): number {
  if (state.durationMs <= 0) {
    return clamp01(state.relativePosition);
  }
  if (!state.isPlaying) {
    return clamp01(state.positionMs / state.durationMs);
  }
  const now = nowPerfMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const elapsedMs = Math.max(0, Math.min(4000, now - state.lastProgressPerfMs));
  return clamp01((state.positionMs + elapsedMs) / state.durationMs);
}

export function updateRadioTelemetryPlayback(patch: {
  isPlaying?: boolean;
  trackId?: string | null;
  trackStation?: RadioStationId;
  durationMs?: number;
  positionMs?: number;
  relativePosition?: number;
  volume?: number;
  isMuted?: boolean;
}): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (typeof patch.isPlaying === 'boolean') {
    const wasPlaying = state.isPlaying;
    state.isPlaying = patch.isPlaying;
    if (patch.isPlaying) {
      state.lastProgressPerfMs = now;
      if (!wasPlaying) {
        state.playbackStartedPerfMs = now;
      }
    }
  }
  if (patch.trackStation) {
    state.trackStation = patch.trackStation;
  }
  if (patch.trackId !== undefined) {
    if (patch.trackId !== state.trackId) {
      state.trackId = patch.trackId;
      state.positionMs = 0;
      state.relativePosition = 0;
      state.lastProgressPerfMs = now;
      state.playbackStartedPerfMs = now;
    }
  }
  if (typeof patch.durationMs === 'number' && Number.isFinite(patch.durationMs)) {
    const nextDuration = Math.max(0, patch.durationMs);
    if (nextDuration !== state.durationMs && state.trackId) {
      state.tempoBpmByTrackId.delete(state.trackId);
    }
    state.durationMs = nextDuration;
  }
  if (typeof patch.positionMs === 'number' && Number.isFinite(patch.positionMs)) {
    state.positionMs = Math.max(0, patch.positionMs);
    state.lastProgressPerfMs = now;
    if (state.durationMs > 0) {
      state.relativePosition = clamp01(state.positionMs / state.durationMs);
    }
  }
  if (typeof patch.relativePosition === 'number' && Number.isFinite(patch.relativePosition)) {
    state.relativePosition = clamp01(patch.relativePosition);
    state.lastProgressPerfMs = now;
  }
  if (typeof patch.volume === 'number' && Number.isFinite(patch.volume)) {
    state.volume = Math.min(100, Math.max(0, patch.volume));
  }
  if (typeof patch.isMuted === 'boolean') {
    state.isMuted = patch.isMuted;
  }
}

export function setRadioTelemetryWaveform(trackId: string, samples: number[]): void {
  if (!trackId || samples.length === 0) return;
  state.waveformByTrackId.set(trackId, samples);
  state.tempoBpmByTrackId.delete(trackId);
}

export function hasRadioTelemetryWaveform(trackId: string): boolean {
  return Boolean(trackId && state.waveformByTrackId.has(trackId));
}

/**
 * Computes 9 target equalizer band levels ordered left-to-right from lowest
 * frequencies (sub-bass / kick) to highest frequencies (presence / hi-hats / air),
 * with strong dynamic separation per frequency band, volume scaling, and beat-locked motion.
 */
export function computeLiveFrequencyBands(
  nowPerfMs: number,
  outBands: number[],
  outEnergy?: RadioFrameEnergy
): void {
  const bpm = getEffectiveTempoBpm();
  const volFactor = getEffectiveVolumeFactor();
  const progress = getLiveRadioProgress(nowPerfMs);

  if (!state.isPlaying) {
    for (let i = 0; i < EQUALIZER_BAND_COUNT; i++) {
      outBands[i] = IDLE_EQUALIZER_LEVELS[i];
    }
    if (outEnergy) {
      outEnergy.overall = 0;
      outEnergy.bass = 0;
      outEnergy.bpm = bpm;
      outEnergy.volumeFactor = volFactor;
      outEnergy.progress = progress;
    }
    return;
  }

  // Continuous live clock ensures the frequency visualizer never stalls even if SC PLAY_PROGRESS throttles
  const elapsedSinceProgress = Math.max(0, nowPerfMs - state.lastProgressPerfMs);
  const continuousPosMs = state.positionMs + elapsedSinceProgress;
  const tSec = (state.positionMs > 0 ? continuousPosMs : nowPerfMs - state.playbackStartedPerfMs) / 1000;
  const beatHz = bpm / 60;
  const beatRad = tSec * beatHz * Math.PI * 2;
  const isSilent = state.isMuted || state.volume <= 0;

  if (isSilent) {
    for (let i = 0; i < EQUALIZER_BAND_COUNT; i++) {
      const microBreath = 0.03 * (0.5 + 0.5 * Math.sin(beatRad + i * 0.8));
      outBands[i] = Math.min(0.22, 0.14 + microBreath);
    }
    if (outEnergy) {
      outEnergy.overall = 0.04;
      outEnergy.bass = 0.04;
      outEnergy.bpm = bpm;
      outEnergy.volumeFactor = volFactor;
      outEnergy.progress = progress;
    }
    return;
  }

  // Distinct rhythmic shapes per frequency zone (0.0 -> 1.0 with deep valleys so bars visibly dance)
  const subKick = Math.pow(0.5 + 0.5 * Math.sin(beatRad), 3.0); // Sharp heavy sub-bass kick
  const bassBody = Math.pow(0.5 + 0.5 * Math.sin(beatRad * 0.5 + 0.4), 2.2); // Bassline sustain
  const lowMidGroove = Math.pow(0.5 + 0.5 * Math.sin(beatRad * 1.5 + 1.15), 1.9);
  const midVocal = Math.pow(0.5 + 0.5 * Math.sin(beatRad * 0.75 + 2.1), 1.6);
  const upperMidSnare = Math.pow(0.5 + 0.5 * Math.sin(beatRad * 2.0 + Math.PI * 0.5), 3.4); // Snare backbeat
  const presenceSpark = Math.pow(0.5 + 0.5 * Math.sin(beatRad * 3.0 + 0.85), 2.8);
  const hatTick = Math.pow(0.5 + 0.5 * Math.sin(beatRad * 4.0 + 1.9), 3.6); // Fast crisp hi-hats
  const airShimmer = Math.pow(0.5 + 0.5 * Math.sin(beatRad * 6.0 + 0.45), 3.2);

  const samples = state.trackId ? state.waveformByTrackId.get(state.trackId) : undefined;

  if (samples && samples.length > 8) {
    const idx = progress * (samples.length - 1);

    const sCurr = getSampleAt(samples, idx);
    const sPrev1 = getSampleAt(samples, idx - 1);
    const sPrev2 = getSampleAt(samples, idx - 2);
    const sPrev4 = getSampleAt(samples, idx - 4);
    const sNext1 = getSampleAt(samples, idx + 1);
    const sNext2 = getSampleAt(samples, idx + 2);
    const sNext4 = getSampleAt(samples, idx + 4);

    // Local mean vs instantaneous amplitude (isolates AC dynamics instead of saturating at 1.0)
    const macroEnv = (sPrev4 + sPrev2 + sPrev1 + sCurr + sNext1 + sNext2 + sNext4) / 7;
    const bassTransient = clamp01((sCurr - (sPrev2 + sPrev4) * 0.5) * 3.4);
    const midLift = clamp01((sCurr - macroEnv * 0.75) * 2.2);
    const highFlux = clamp01(
      (Math.abs(sCurr - sPrev1) + Math.abs(sNext1 - sCurr)) * 2.6
    );
    const dynamicsGate = 0.45 + clamp01(macroEnv) * 0.65;

    const raw = [
      // 0: Sub-bass (20-60 Hz) — drops to ~0.18 between kicks, punches to ~0.96 on hits
      (0.12 + subKick * 0.62 + bassTransient * 0.42) * dynamicsGate,
      // 1: Bass / Kick (60-140 Hz)
      (0.14 + (subKick * 0.48 + bassBody * 0.34) + bassTransient * 0.38) * dynamicsGate,
      // 2: Upper Bass (140-260 Hz)
      (0.14 + bassBody * 0.56 + midLift * 0.34 + bassTransient * 0.22) * dynamicsGate,
      // 3: Low-Mids (260-600 Hz)
      (0.15 + lowMidGroove * 0.54 + midLift * 0.36) * dynamicsGate,
      // 4: Core Mids (600 Hz-1.8 kHz) — vocals / melody swell
      (0.16 + midVocal * 0.52 + midLift * 0.42) * dynamicsGate,
      // 5: Upper-Mids (1.8-4 kHz) — snare snap & vocal presence
      (0.12 + upperMidSnare * 0.55 + highFlux * 0.48) * dynamicsGate,
      // 6: Presence (4-7 kHz)
      (0.1 + presenceSpark * 0.48 + highFlux * 0.56) * dynamicsGate,
      // 7: Brilliance (7-12 kHz) — crisp hi-hats
      (0.08 + hatTick * 0.54 + highFlux * 0.54) * dynamicsGate,
      // 8: Air / Treble (12-20 kHz)
      (0.07 + airShimmer * 0.46 + highFlux * 0.52) * dynamicsGate,
    ];

    let total = 0;
    for (let i = 0; i < EQUALIZER_BAND_COUNT; i++) {
      const scaled = clamp01(0.1 + raw[i] * volFactor);
      outBands[i] = scaled;
      total += scaled;
    }

    if (outEnergy) {
      outEnergy.overall = clamp01(total / EQUALIZER_BAND_COUNT);
      outEnergy.bass = clamp01((outBands[0] + outBands[1] + outBands[2]) / 3);
      outEnergy.bpm = bpm;
      outEnergy.volumeFactor = volFactor;
      outEnergy.progress = progress;
    }
    return;
  }

  // Fallback tempo-locked frequency dynamics with wide spectral contrast per band
  const raw = [
    0.1 + subKick * 0.78 + bassBody * 0.14,
    0.12 + subKick * 0.58 + bassBody * 0.32,
    0.12 + bassBody * 0.62 + lowMidGroove * 0.24,
    0.14 + lowMidGroove * 0.66 + midVocal * 0.16,
    0.14 + midVocal * 0.7 + lowMidGroove * 0.14,
    0.1 + upperMidSnare * 0.76 + presenceSpark * 0.14,
    0.09 + presenceSpark * 0.72 + hatTick * 0.16,
    0.08 + hatTick * 0.78,
    0.06 + airShimmer * 0.68,
  ];

  let total = 0;
  for (let i = 0; i < EQUALIZER_BAND_COUNT; i++) {
    const scaled = clamp01(0.08 + raw[i] * volFactor);
    outBands[i] = scaled;
    total += scaled;
  }

  if (outEnergy) {
    outEnergy.overall = clamp01(total / EQUALIZER_BAND_COUNT);
    outEnergy.bass = clamp01((outBands[0] + outBands[1] + outBands[2]) / 3);
    outEnergy.bpm = bpm;
    outEnergy.volumeFactor = volFactor;
    outEnergy.progress = progress;
  }
}
