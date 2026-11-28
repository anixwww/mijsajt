import { Clock } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { usePageVisibility } from '../hooks/useViewportActivity.ts';
import { formatPromoCountdown } from '../types.ts';

interface PromoCountdownProps {
  endsAtIso?: string;
  variant?: 'card' | 'modal' | 'vitrine';
  isCompact?: boolean;
}

export const PromoCountdown = memo(function PromoCountdown({
  endsAtIso,
  variant = 'card',
  isCompact = false,
}: PromoCountdownProps) {
  const isVisible = usePageVisibility();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const targetMs = endsAtIso ? Date.parse(endsAtIso) : NaN;
  const isFuture = Number.isFinite(targetMs) && targetMs > nowMs;

  useEffect(() => {
    if (!endsAtIso || !Number.isFinite(targetMs) || !isVisible) return;
    const current = Date.now();
    setNowMs(current);
    if (targetMs <= current) return;

    const timer = window.setInterval(() => {
      const next = Date.now();
      setNowMs(next);
      if (targetMs <= next) {
        window.clearInterval(timer);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [endsAtIso, targetMs, isVisible]);

  if (!endsAtIso || !isFuture) return null;
  const countdownText = formatPromoCountdown(endsAtIso, nowMs);
  if (!countdownText) return null;

  if (variant === 'vitrine') {
    return (
      <>
        <span aria-hidden="true">·</span>
        <span className="font-mono">{countdownText}</span>
      </>
    );
  }

  if (variant === 'modal') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-ink dark:bg-black/75 text-white font-mono text-[11px] font-semibold tabular-nums">
        <Clock className="w-3 h-3 shrink-0 text-[#BCD369] dark:text-silver" strokeWidth={2} />
        <span>До кінця акції: {countdownText}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-black/82 text-white font-mono font-semibold tabular-nums shadow-sm ${
        isCompact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'
      }`}
    >
      <Clock
        className="w-2.5 h-2.5 shrink-0 text-[#BCD369] dark:text-silver"
        strokeWidth={2.2}
      />
      <span>{countdownText}</span>
    </span>
  );
});
