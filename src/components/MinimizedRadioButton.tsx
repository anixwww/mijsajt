import { memo, useEffect, useRef } from 'react';
import { useViewportActivity } from '../hooks/useViewportActivity.ts';
import {
  computeLiveFrequencyBands,
  getLiveRadioProgress,
  type RadioFrameEnergy,
} from '../utils/radioAudioTelemetry.ts';

interface MinimizedRadioButtonProps {
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  positionMs: number;
  durationMs: number;
  trackTitle?: string | null;
  onClick: () => void;
}

const RING_RADIUS = 16.25;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export const MinimizedRadioButton = memo(function MinimizedRadioButton({
  isPlaying,
  isMuted,
  volume,
  positionMs,
  durationMs,
  trackTitle,
  onClick,
}: MinimizedRadioButtonProps) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const { isActive: viewportActive, reducedMotion } = useViewportActivity(btnRef);
  const haloRef = useRef<HTMLSpanElement | null>(null);
  const progressCircleRef = useRef<SVGCircleElement | null>(null);
  const progressTrackRef = useRef<SVGCircleElement | null>(null);
  const coreDotRef = useRef<SVGCircleElement | null>(null);
  const innerWaveRef = useRef<SVGGElement | null>(null);
  const outerWaveRef = useRef<SVGGElement | null>(null);

  const bandsRef = useRef<number[]>(new Array(9).fill(0));
  const energyRef = useRef<RadioFrameEnergy>({
    overall: 0,
    bass: 0,
    bpm: 108,
    volumeFactor: 0.85,
    progress: 0,
  });

  useEffect(() => {
    const applyFrame = (
      bass: number,
      mids: number,
      highs: number,
      overall: number,
      progress: number,
      activeAudio: boolean
    ) => {
      if (coreDotRef.current) {
        const dotScale = activeAudio ? 0.92 + bass * 0.34 : 1;
        coreDotRef.current.style.transform = `scale(${dotScale.toFixed(3)})`;
      }

      if (innerWaveRef.current) {
        const innerScale = activeAudio ? 0.95 + mids * 0.12 : 1;
        const innerOpacity = activeAudio ? 0.55 + mids * 0.45 : isPlaying && isMuted ? 0.48 : 0.88;
        innerWaveRef.current.style.transform = `scale(${innerScale.toFixed(3)})`;
        innerWaveRef.current.style.opacity = innerOpacity.toFixed(3);
      }

      if (outerWaveRef.current) {
        const outerScale = activeAudio ? 0.95 + highs * 0.14 : 1;
        const outerOpacity = activeAudio ? 0.28 + highs * 0.72 : isPlaying && isMuted ? 0.25 : 0.62;
        outerWaveRef.current.style.transform = `scale(${outerScale.toFixed(3)})`;
        outerWaveRef.current.style.opacity = outerOpacity.toFixed(3);
      }

      if (haloRef.current) {
        if (!activeAudio) {
          haloRef.current.style.opacity = '0';
          haloRef.current.style.transform = 'scale(0.92)';
        } else {
          const haloOpacity = Math.min(0.75, 0.08 + bass * 0.42 + overall * 0.2);
          const haloScale = 0.96 + bass * 0.1;
          haloRef.current.style.opacity = haloOpacity.toFixed(3);
          haloRef.current.style.transform = `scale(${haloScale.toFixed(3)})`;
        }
      }

      const clampedProgress = Math.max(0, Math.min(1, progress));
      const showRing = durationMs > 0 && clampedProgress > 0.004;

      if (progressTrackRef.current) {
        progressTrackRef.current.style.opacity = showRing ? '0.14' : '0';
      }
      if (progressCircleRef.current) {
        progressCircleRef.current.style.opacity = showRing ? '0.95' : '0';
        progressCircleRef.current.style.strokeDashoffset = (
          RING_CIRCUMFERENCE *
          (1 - clampedProgress)
        ).toFixed(2);
      }
    };

    const isSilenced = isMuted || volume <= 0;

    if (!isPlaying) {
      const staticProgress = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;
      applyFrame(0, 0, 0, 0, staticProgress, false);
      return;
    }

    if (reducedMotion || !viewportActive) {
      applyFrame(
        isSilenced ? 0 : 0.4,
        isSilenced ? 0 : 0.5,
        isSilenced ? 0 : 0.45,
        isSilenced ? 0 : 0.45,
        getLiveRadioProgress(),
        !isSilenced
      );
      return;
    }

    let rafId = 0;
    let smoothBass = 0;
    let smoothMids = 0;
    let smoothHighs = 0;

    const tick = (now: number) => {
      computeLiveFrequencyBands(now, bandsRef.current, energyRef.current);
      const b = bandsRef.current;
      const targetBass = (b[0] + b[1] + b[2]) / 3;
      const targetMids = (b[3] + b[4] + b[5]) / 3;
      const targetHighs = (b[6] + b[7] + b[8]) / 3;

      smoothBass += (targetBass - smoothBass) * 0.34;
      smoothMids += (targetMids - smoothMids) * 0.38;
      smoothHighs += (targetHighs - smoothHighs) * 0.44;

      applyFrame(
        smoothBass,
        smoothMids,
        smoothHighs,
        energyRef.current.overall,
        energyRef.current.progress,
        !isSilenced
      );
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [isPlaying, isMuted, volume, positionMs, durationMs, viewportActive, reducedMotion]);

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={onClick}
      aria-label={
        isPlaying && trackTitle
          ? `Радіостанція · Грає ${trackTitle}`
          : 'Відкрити радіостанцію'
      }
      title={
        isPlaying && trackTitle
          ? `Радіо · ${trackTitle}`
          : 'Радіостанція'
      }
      className="group fixed bottom-[74px] sm:bottom-[78px] right-3.5 sm:right-6 z-30 w-9 h-9 rounded-full bg-[#FAF9F5] dark:bg-[#202020] text-[#2C5937] dark:text-[#E5E5E5] shadow-[0_6px_18px_-5px_rgba(20,20,19,0.22)] dark:shadow-[0_8px_22px_-6px_rgba(0,0,0,0.72)] flex items-center justify-center hover:scale-105 active:scale-[0.94] transition-transform duration-150 cursor-pointer overflow-hidden"
    >
      {/* Subtle bass-reactive ambient halo */}
      <span
        ref={haloRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full opacity-0 bg-radial from-[#2C5937]/20 via-[#2C5937]/6 to-transparent dark:from-white/20 dark:via-white/5 dark:to-transparent will-change-transform"
      />

      {/* Circular song duration progress arc */}
      <svg
        viewBox="0 0 36 36"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 w-full h-full -rotate-90"
      >
        <circle
          ref={progressTrackRef}
          cx="18"
          cy="18"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="opacity-0 transition-opacity duration-200"
        />
        <circle
          ref={progressCircleRef}
          cx="18"
          cy="18"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE}
          className="opacity-0 transition-opacity duration-200"
        />
      </svg>

      {/* Minimalist living broadcast icon (core + acoustic arcs, no 7-bar clutter) */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="relative z-10 w-[18px] h-[18px]"
      >
        <g
          ref={outerWaveRef}
          style={{ transformOrigin: '12px 12px' }}
          className="will-change-transform transition-opacity duration-150"
        >
          <path d="M5.2 18.8a9.6 9.6 0 0 1 0-13.6" />
          <path d="M18.8 5.2a9.6 9.6 0 0 1 0 13.6" />
        </g>
        <g
          ref={innerWaveRef}
          style={{ transformOrigin: '12px 12px' }}
          className="will-change-transform transition-opacity duration-150"
        >
          <path d="M8.3 15.7a5.2 5.2 0 0 1 0-7.4" />
          <path d="M15.7 8.3a5.2 5.2 0 0 1 0 7.4" />
        </g>
        <circle
          ref={coreDotRef}
          cx="12"
          cy="12"
          r="2.15"
          fill="currentColor"
          stroke="none"
          style={{ transformOrigin: '12px 12px' }}
          className="will-change-transform"
        />
      </svg>
    </button>
  );
});
