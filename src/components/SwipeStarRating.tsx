import { Star } from'lucide-react';
import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type SyntheticEvent,
} from'react';

interface SwipeStarRatingProps {
  value: number;
  onChange?: (rating: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
  readOnly?: boolean;
  locked?: boolean;
  disabled?: boolean;
  size?:'sm'|'md'|'lg';
  showHint?: boolean;
  showValue?: boolean |'active';
  ariaLabel?: string;
}

function clampToTenth(raw: number): number {
  const clamped = Math.max(0.1, Math.min(5, raw));
  return Math.round(clamped * 10) / 10;
}

export function SwipeStarRating({
  value,
  onChange,
  onDraggingChange,
  readOnly = false,
  locked = false,
  disabled = false,
  size ='md',
  showHint = false,
  showValue = true,
  ariaLabel ='Оцінка від 0.1 до 5.0 свайпом по зірочках',
}: SwipeStarRatingProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [draggingValue, setDraggingValue] = useState<number | null>(null);
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const isDraggingRef = useRef(false);

  const isInteractive = !readOnly && !locked && !disabled && Boolean(onChange);
  const displayValue = draggingValue ?? hoverValue ?? value;

  const iconSizeClass =
    size ==='sm'?'w-4 h-4': size ==='lg'?'w-7 h-7':'w-6 h-6';

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
    onDraggingChange?.(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors on synthetic events
    }
    const next = computeRatingFromClientX(e.clientX);
    setDraggingValue(next);
    setHoverValue(null);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      e.stopPropagation();
      if (!isInteractive) return;
      const next = computeRatingFromClientX(e.clientX);
      setDraggingValue(next);
      return;
    }
    if (!isInteractive) return;
    if (e.pointerType ==='mouse') {
      const next = computeRatingFromClientX(e.clientX);
      setHoverValue(next);
    }
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!isInteractive || !isDraggingRef.current) return;
    isDraggingRef.current = false;
    onDraggingChange?.(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }
    const finalRating = computeRatingFromClientX(e.clientX);
    setDraggingValue(null);
    setHoverValue(null);
    onChange?.(finalRating);
  };

  const handlePointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isDraggingRef.current = false;
    onDraggingChange?.(false);
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
    if (e.key ==='ArrowRight'|| e.key ==='ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      onChange?.(clampToTenth(base + 0.1));
    } else if (e.key ==='ArrowLeft'|| e.key ==='ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      onChange?.(clampToTenth(base - 0.1));
    }
  };

  return (
    <div
      className="inline-flex flex-col gap-1 touch-none select-none"
      onPointerDown={stopParentDrag}
      onPointerMove={stopParentDrag}
      onPointerUp={stopParentDrag}
      onTouchStart={stopParentDrag}
      onTouchMove={stopParentDrag}
      onTouchEnd={stopParentDrag}
      onMouseDown={stopParentDrag}
    >
      <div className="inline-flex items-center gap-2.5">
        <div
          ref={trackRef}
          role={isInteractive ?'slider':'img'}
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
          onTouchMove={stopParentDrag}
          onTouchEnd={stopParentDrag}
          onKeyDown={handleKeyDown}
          className={`relative inline-flex items-center gap-1 min-h-[44px] py-2.5 px-2 -my-2 -mx-2 rounded-lg touch-none select-none transition-transform ${
            isInteractive
              ?'cursor-ew-resize hover:bg-[#F7F6F2] dark:hover:bg-[#323232] focus-visible:outline-2 focus-visible:outline-[#2C5937] dark:focus-visible:outline-[#E5E5E5]'
              :''
          } ${draggingValue !== null ?'bg-[#F7F6F2] dark:bg-[#323232] scale-[1.03]':''}`}
        >
          {[1, 2, 3, 4, 5].map((starIndex) => {
            const fillRatio = Math.max(0, Math.min(1, displayValue - (starIndex - 1)));
            const fillPercent = Math.round(fillRatio * 100);
            return (
              <span key={starIndex} className="relative inline-flex shrink-0">
                <Star className={`${iconSizeClass} text-[#D4D4CE] dark:text-[#454545]`} strokeWidth={1.75} />
                {fillPercent > 0 && (
                  <span
                    className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none"
                    style={{ width:`${fillPercent}%`}}
                  >
                    <Star
                      className={`${iconSizeClass} fill-[#FACC15] text-[#EAB308]`}
                      strokeWidth={1.75}
                    />
                  </span>
                )}
              </span>
            );
          })}
        </div>

        {(showValue === true && displayValue > 0) ||
        (showValue ==='active'&& (draggingValue !== null || hoverValue !== null)) ? (
          <span
            className={`font-mono text-xs tabular-nums transition-colors ${
              draggingValue !== null || hoverValue !== null
                ?'font-semibold text-[#141413] bg-[#FEF08A] dark:bg-[#FACC15] px-2 py-0.5 rounded'
                :'text-[#5C5C58] dark:text-[#A8A49B]'
            }`}
          >
            {displayValue.toFixed(1)}
          </span>
        ) : null}
      </div>

      {showHint && isInteractive && (
        <span className="text-[11px] text-[#787872] dark:text-[#8E8A82]">
          Проведіть пальцем або мишею по зірочках (крок 0.1)
        </span>
      )}
    </div>
  );
}
