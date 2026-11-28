import { useEffect, useRef, type RefObject } from 'react';
import {
  computeLiveFrequencyBands,
  EQUALIZER_BAND_COUNT,
  getLiveRadioProgress,
  IDLE_EQUALIZER_LEVELS,
  type RadioFrameEnergy,
} from '../utils/radioAudioTelemetry.ts';

interface LiveRadioEqualizerProps {
  isPlaying: boolean;
  tone?: 'light' | 'muted' | 'accent';
  size?: 'sm' | 'md';
  variant?: 'bars' | 'wave';
  isMuted?: boolean;
  haloRef?: RefObject<HTMLSpanElement | null>;
  progressCircleRef?: RefObject<SVGCircleElement | null>;
  progressCircumference?: number;
  className?: string;
}

// Per-band attack/decay smoothing: lows carry weight, highs snap and drop rapidly
const BAND_ATTACK = [0.46, 0.5, 0.54, 0.58, 0.62, 0.68, 0.74, 0.8, 0.85];
const BAND_DECAY = [0.16, 0.18, 0.21, 0.24, 0.27, 0.32, 0.36, 0.42, 0.48];

// 7 representative frequency bands ordered left-to-right (sub-bass -> treble)
const WAVE_BAND_INDICES = [0, 1, 2, 4, 5, 7, 8] as const;
const IDLE_WAVE_LEVELS: readonly number[] = [0.22, 0.42, 0.62, 0.46, 0.7, 0.4, 0.2];

export function LiveRadioEqualizer({
  isPlaying,
  tone = 'muted',
  size = 'md',
  variant = 'bars',
  isMuted = false,
  haloRef,
  progressCircleRef,
  progressCircumference = 0,
  className = '',
}: LiveRadioEqualizerProps) {
  const isWave = variant === 'wave';
  const renderedIndices = isWave ? WAVE_BAND_INDICES : [0, 1, 2, 3, 4, 5, 6, 7, 8];

  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const smoothedRef = useRef<number[]>([...IDLE_EQUALIZER_LEVELS]);
  const targetRef = useRef<number[]>([...IDLE_EQUALIZER_LEVELS]);
  const energyRef = useRef<RadioFrameEnergy>({
    overall: 0,
    bass: 0,
    bpm: 108,
    volumeFactor: 0.85,
    progress: 0,
  });

  useEffect(() => {
    const applyVisuals = (
      levels: readonly number[],
      bassEnergy: number,
      overallEnergy: number,
      progress: number
    ) => {
      if (isWave) {
        for (let i = 0; i < WAVE_BAND_INDICES.length; i++) {
          const el = barRefs.current[i];
          if (!el) continue;
          const srcIdx = WAVE_BAND_INDICES[i];
          const raw = isPlaying ? (levels[srcIdx] ?? 0.2) : IDLE_WAVE_LEVELS[i];
          const scale = Math.max(0.14, Math.min(1, raw));
          el.style.transform = `scaleY(${scale.toFixed(3)})`;
        }
      } else {
        for (let i = 0; i < EQUALIZER_BAND_COUNT; i++) {
          const el = barRefs.current[i];
          if (!el) continue;
          const scale = Math.max(0.14, Math.min(1, levels[i] ?? 0.2));
          el.style.transform = `scaleY(${scale.toFixed(3)})`;
        }
      }

      if (haloRef?.current) {
        if (!isPlaying || isMuted) {
          haloRef.current.style.opacity = '0';
          haloRef.current.style.transform = 'scale(0.94)';
        } else {
          const haloOpacity = Math.min(0.85, 0.1 + bassEnergy * 0.5 + overallEnergy * 0.25);
          const haloScale = 0.96 + bassEnergy * 0.08;
          haloRef.current.style.opacity = haloOpacity.toFixed(3);
          haloRef.current.style.transform = `scale(${haloScale.toFixed(3)})`;
        }
      }

      if (progressCircleRef?.current && progressCircumference > 0) {
        const clampedProgress = Math.max(0, Math.min(1, progress));
        const offset = progressCircumference * (1 - clampedProgress);
        progressCircleRef.current.style.strokeDashoffset = offset.toFixed(2);
      }
    };

    if (!isPlaying) {
      smoothedRef.current = [...IDLE_EQUALIZER_LEVELS];
      applyVisuals(IDLE_EQUALIZER_LEVELS, 0, 0, getLiveRadioProgress());
      return;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      const staticActive = isMuted
        ? [0.16, 0.18, 0.16, 0.18, 0.16, 0.15, 0.14, 0.14, 0.14]
        : [0.74, 0.92, 0.78, 0.66, 0.84, 0.72, 0.6, 0.48, 0.38];
      applyVisuals(staticActive, isMuted ? 0 : 0.45, isMuted ? 0 : 0.45, getLiveRadioProgress());
      return;
    }

    let rafId = 0;
    let lastFrameMs = 0;

    const tick = (now: number) => {
      const dt = lastFrameMs > 0 ? Math.min(2.5, (now - lastFrameMs) / 16.67) : 1;
      lastFrameMs = now;

      computeLiveFrequencyBands(now, targetRef.current, energyRef.current);

      for (let i = 0; i < EQUALIZER_BAND_COUNT; i++) {
        const current = smoothedRef.current[i];
        const target = targetRef.current[i];
        const rate = target > current ? BAND_ATTACK[i] : BAND_DECAY[i];
        const alpha = Math.min(1, rate * dt);
        smoothedRef.current[i] = current + (target - current) * alpha;
      }

      applyVisuals(
        smoothedRef.current,
        energyRef.current.bass,
        energyRef.current.overall,
        energyRef.current.progress
      );
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [isPlaying, isMuted, isWave, haloRef, progressCircleRef, progressCircumference]);

  const containerDimensions = isWave
    ? 'h-[18px] gap-[1.75px] items-center'
    : size === 'sm'
      ? 'h-3.5 gap-[2px] items-end'
      : 'h-4 gap-[2px] items-end';

  const barWidth = isWave ? 'w-[1.5px]' : 'w-[2px]';

  const barColorClass =
    tone === 'light'
      ? isPlaying
        ? 'bg-white'
        : 'bg-white/90'
      : tone === 'accent'
        ? isPlaying
          ? 'bg-[#E5E5E5]'
          : 'bg-[#E5E5E5]/85'
        : isPlaying && isMuted
          ? 'bg-[#2C5937]/40 dark:bg-[#E5E5E5]/40'
          : 'bg-[#2C5937] dark:bg-[#E5E5E5] opacity-90 group-hover:opacity-100';

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 ${containerDimensions} ${className}`}
    >
      {renderedIndices.map((_, idx) => {
        const initialScale = isWave
          ? IDLE_WAVE_LEVELS[idx]
          : IDLE_EQUALIZER_LEVELS[idx];
        return (
          <span
            key={idx}
            ref={(el) => {
              barRefs.current[idx] = el;
            }}
            style={{
              transform: `scaleY(${initialScale})`,
              transformOrigin: isWave ? 'center center' : 'bottom center',
            }}
            className={`block ${barWidth} h-full rounded-full will-change-transform transition-colors duration-150 ${barColorClass}`}
          />
        );
      })}
    </span>
  );
}
