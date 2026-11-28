import { m } from 'motion/react';
import { useEffect, useState } from 'react';
import { parseHexRgb } from '../utils/imagePalette.ts';

interface PoetrySpaceBackdropProps {
  accentColor?: string;
  swipeKey?: string;
  swipeDirection?: number;
}

function getDeepNebulaTint(hex?: string): { primary: string; secondary: string } {
  const fallback = {
    primary: 'rgba(56, 189, 248, 0.13)',
    secondary: 'rgba(99, 102, 241, 0.15)',
  };
  if (!hex) return fallback;
  const rgb = parseHexRgb(hex);
  if (!rgb) return fallback;

  // Keep nebula dark, muted, and atmospheric so text always stays legible
  const r1 = Math.round(rgb.r * 0.65 + 24);
  const g1 = Math.round(rgb.g * 0.65 + 28);
  const b1 = Math.round(rgb.b * 0.75 + 48);

  const r2 = Math.round(rgb.r * 0.4 + 34);
  const g2 = Math.round(rgb.g * 0.45 + 32);
  const b2 = Math.round(rgb.b * 0.65 + 72);

  return {
    primary: `rgba(${Math.min(220, r1)}, ${Math.min(220, g1)}, ${Math.min(240, b1)}, 0.18)`,
    secondary: `rgba(${Math.min(200, r2)}, ${Math.min(200, g2)}, ${Math.min(245, b2)}, 0.16)`,
  };
}

export function PoetrySpaceBackdrop({
  accentColor,
}: PoetrySpaceBackdropProps) {
  const [depthPhase, setDepthPhase] = useState(0);
  const [scrollDepth, setScrollDepth] = useState(0);

  // Progressive immersion depth curve: deepens smoothly after entering focus mode
  useEffect(() => {
    const startTimer = window.setTimeout(() => setDepthPhase(1), 500);
    const deepTimer = window.setTimeout(() => setDepthPhase(2), 2800);
    const abyssTimer = window.setTimeout(() => setDepthPhase(3), 7500);
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(deepTimer);
      window.clearTimeout(abyssTimer);
    };
  }, []);

  // Scroll-reactive depth deepening as the reader moves down long poems
  useEffect(() => {
    const updateScrollDepth = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const ratio = Math.min(1, Math.max(0, window.scrollY / Math.min(maxScroll, 900)));
      setScrollDepth(ratio);
    };
    updateScrollDepth();
    window.addEventListener('scroll', updateScrollDepth, { passive: true });
    return () => window.removeEventListener('scroll', updateScrollDepth);
  }, []);

  const nebula = getDeepNebulaTint(accentColor);
  const baseBgColor =
    depthPhase === 0
      ? '#14171F'
      : depthPhase === 1
        ? '#090C15'
        : depthPhase === 2
          ? '#04060C'
          : '#020307';

  // Deepen vignette subtly with both time and scroll depth
  const vignetteStrength = Math.min(
    0.94,
    (depthPhase >= 2 ? 0.86 : depthPhase === 1 ? 0.68 : 0.42) + scrollDepth * 0.1
  );

  return (
    <m.div
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        transition: { duration: 2.3, ease: [0.22, 1, 0.36, 1] },
      }}
      exit={{
        opacity: 0,
        transition: { duration: 0.9, ease: [0.4, 0, 0.2, 1] },
      }}
      className="fixed inset-0 z-[1] pointer-events-none overflow-hidden transition-colors duration-[3800ms] ease-out"
      style={{ backgroundColor: baseBgColor }}
    >
      {/* Slowly drifting cosmic nebula clouds tinted by the poem's mood */}
      <div
        className="poetry-nebula-primary absolute -inset-[22%] transition-opacity duration-[3200ms] ease-out"
        style={{
          opacity: depthPhase === 0 ? 0.28 : 0.95 - scrollDepth * 0.25,
          backgroundImage: `radial-gradient(46% 42% at 32% 36%, ${nebula.primary} 0%, transparent 72%), radial-gradient(42% 40% at 72% 66%, ${nebula.secondary} 0%, transparent 74%)`,
        }}
      />

      {/* Secondary deeper abyssal core */}
      <div
        className="poetry-nebula-secondary absolute -inset-[18%] transition-opacity duration-[3800ms] ease-out"
        style={{
          opacity: depthPhase >= 2 ? 0.9 : 0.38,
          backgroundImage:
            'radial-gradient(55% 48% at 50% 48%, rgba(15, 23, 42, 0.34) 0%, rgba(2, 4, 10, 0.74) 68%, rgba(1, 2, 5, 0.97) 100%)',
        }}
      />

      {/* Progressive outer vignette pulling attention inward into the poem */}
      <div
        className="absolute inset-0 transition-opacity duration-[3400ms] ease-out"
        style={{
          opacity: vignetteStrength,
          background:
            'radial-gradient(74% 68% at 50% 48%, transparent 26%, rgba(2, 3, 7, 0.58) 70%, rgba(1, 1, 4, 0.96) 100%)',
        }}
      />
    </m.div>
  );
}
