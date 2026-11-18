import { Star } from 'lucide-react';
import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type SyntheticEvent,
} from 'react';

interface SwipeStarRatingProps {
  value: number;
  onChange?: (rating: number) => void;
  readOnly?: boolean;
  locked?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showHint?: boolean;
  showValue?: boolean | 'active';
  ariaLabel?: string;
}

function clampToTenth(raw: number): number {
  const clamped = Math.max(0.1, Math.min(5, raw));
  return Math.round(clamped * 10) / 10;
}

export function SwipeStarRating({
  value,
  onChange,
  readOnly = false,
  locked = false,
  disabled = false,
  size = 'md',
  showHint = false,
  showValue = true,
  ariaLabel = 'Оцінка від 0.1 до 5.0 свайпом по зірочках',
}: SwipeStarRatingProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [draggingValue, setDraggingValue] = useState<number | null>(null);
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const isDraggingRef = useRef(false);

  const isInteractive = !readOnly && !locked && !disabled && Boolean(onChange);
  const displayValue = draggingValue ?? hoverValue ?? value;

  const iconSizeClass =
    size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-7 h-7' : 'w-5 h-5';

  const computeRatingFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return value || 5;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return value || 5;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return clampToTenth(ratio * 5);
  };

  const stopParentDrag = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!isInteractive) return;
    isDraggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    const next = computeRatingFromClientX(e.clientX);
    setDraggingValue(next);
    setHoverValue(null);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isInteractive) return;
    if (isDraggingRef.current) {
      e.stopPropagation();
      const next = computeRatingFromClientX(e.clientX);
      setDraggingValue(next);
      return;
    }
    if (e.pointerType === 'mouse') {
      const next = computeRatingFromClientX(e.clientX);
      setHoverValue(next);
    }
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!isInteractive || !isDraggingRef.current) return;
    isDraggingRef.current = false;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}
    const finalRating = computeRatingFromClientX(e.clientX);
    setDraggingValue(null);
    setHoverValue(null);
    onChange?.(finalRating);
  };

  const handlePointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isDraggingRef.current = false;
    setDraggingValue(null);
    setHoverValue(null);
  };

  const handlePointerLeave = () => {
    if (!isDraggingRef.current) {
      setHoverValue(null);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isInteractive) return;
    const base = value > 0 ? value : 3;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      onChange?.(clampToTenth(base + 0.1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      onChange?.(clampToTenth(base - 0.1));
    }
  };

  return (
    <div className="inline-flex flex-col gap-1">
      <div className="inline-flex items-center gap-2.5">
        <div
          ref={trackRef}
          role={isInteractive ? 'slider' : 'img'}
          tabIndex={isInteractive ? 0 : undefined}
          aria-label={ariaLabel}
          aria-valuemin={isInteractive ? 0.1 : undefined}
          aria-valuemax={isInteractive ? 5 : undefined}
          aria-valuenow={isInteractive ? Number(displayValue.toFixed(1)) : undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
          onMouseDown={stopParentDrag}
          onTouchStart={stopParentDrag}
          onKeyDown={handleKeyDown}
          className={`relative inline-flex items-center gap-1 py-1 px-1.5 -mx-1.5 touch-none select-none transition-transform ${
            isInteractive
              ? 'cursor-ew-resize hover:bg-[#ECEAE2] dark:hover:bg-[#1E1E1B] focus-visible:outline-2 focus-visible:outline-[#1E4631] dark:focus-visible:outline-[#4E946C]'
              : ''
          } ${draggingValue !== null ? 'bg-[#ECEAE2] dark:bg-[#1E1E1B] scale-[1.03]' : ''}`}
        >
          {[1, 2, 3, 4, 5].map((starIndex) => {
            const fillRatio = Math.max(0, Math.min(1, displayValue - (starIndex - 1)));
            const fillPercent = Math.round(fillRatio * 100);
            return (
              <span key={starIndex} className="relative inline-flex shrink-0">
                <Star className={`${iconSizeClass} text-[#D4D3CC] dark:text-[#33332E]`} strokeWidth={1.6} />
                {fillPercent > 0 && (
                  <span
                    className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none"
                    style={{ width: `${fillPercent}%` }}
                  >
                    <Star
                      className={`${iconSizeClass} fill-[#1E4631] text-[#1E4631] dark:fill-[#4E946C] dark:text-[#4E946C]`}
                      strokeWidth={1.6}
                    />
                  </span>
                )}
              </span>
            );
          })}
        </div>

        {(showValue === true ||
          (showValue === 'active' && (draggingValue !== null || hoverValue !== null))) && (
          <span
            className={`font-mono text-xs tabular-nums transition-colors ${
              draggingValue !== null || hoverValue !== null
                ? 'font-semibold text-white bg-[#1E4631] dark:bg-[#2D6A4F] px-2 py-0.5'
                : 'text-[#6B6B65] dark:text-[#94948C]'
            }`}
          >
            {displayValue > 0 ? displayValue.toFixed(1) : '0.1'}
          </span>
        )}
      </div>

      {showHint && isInteractive && (
        <span className="text-[11px] font-mono text-[#6B6B65] dark:text-[#94948C]">
          Проведіть пальцем або мишею по зірочках (крок 0.1)
        </span>
      )}
    </div>
  );
}
