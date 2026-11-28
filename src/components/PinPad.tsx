import { Delete } from 'lucide-react';
import { m } from 'motion/react';
import { useCallback, useEffect } from 'react';

interface PinPadProps {
  value: string;
  onChange: (nextValue: string) => void;
  onComplete?: (pin: string) => void;
  disabled?: boolean;
  loading?: boolean;
  errorTrigger?: number;
  maxLength?: number;
  keyboardActive?: boolean;
  leftActionLabel?: string;
  onLeftAction?: () => void;
}

const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export function PinPad({
  value,
  onChange,
  onComplete,
  disabled = false,
  loading = false,
  errorTrigger = 0,
  maxLength = 4,
  keyboardActive = true,
  leftActionLabel,
  onLeftAction,
}: PinPadProps) {
  const isBlocked = disabled || loading;

  const appendDigit = useCallback(
    (digit: string) => {
      if (isBlocked) return;
      if (!/^\d$/.test(digit)) return;
      if (value.length >= maxLength) return;
      const next = `${value}${digit}`;
      onChange(next);
      if (next.length === maxLength && onComplete) {
        onComplete(next);
      }
    },
    [isBlocked, value, maxLength, onChange, onComplete]
  );

  const handleBackspace = useCallback(() => {
    if (isBlocked || value.length === 0) return;
    onChange(value.slice(0, -1));
  }, [isBlocked, value, onChange]);

  const handleClear = useCallback(() => {
    if (isBlocked || value.length === 0) return;
    onChange('');
  }, [isBlocked, value.length, onChange]);

  useEffect(() => {
    if (!keyboardActive || isBlocked) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        appendDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Delete') {
        e.preventDefault();
        handleClear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboardActive, isBlocked, appendDigit, handleBackspace, handleClear]);

  return (
    <div className="select-none space-y-5">
      {/* 4-dot Monobank-style indicator */}
      <m.div
        key={`dots-${errorTrigger}`}
        initial={errorTrigger > 0 ? { x: 0 } : false}
        animate={errorTrigger > 0 ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : undefined}
        transition={{ duration: 0.36, ease: 'easeOut' }}
        className="flex items-center justify-center gap-4 py-1"
        aria-label={`Введено ${value.length} з ${maxLength} цифр`}
      >
        {Array.from({ length: maxLength }).map((_, idx) => {
          const filled = idx < value.length;
          return (
            <span
              key={idx}
              aria-hidden="true"
              className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                filled
                  ? loading
                    ? 'bg-[#2C5937] dark:bg-[#6EE7B7] scale-110 animate-pulse'
                    : errorTrigger > 0 && value.length === 0
                      ? 'bg-rose-500 dark:bg-rose-400 scale-105'
                      : 'bg-[#141413] dark:bg-[#F4F1EA] scale-110 shadow-xs'
                  : 'border-2 border-[#D2CCC0] dark:border-[#4A4A48] bg-transparent'
              }`}
            />
          );
        })}
      </m.div>

      {/* Tactile 3x4 numeric keypad */}
      <div className="grid grid-cols-3 gap-2.5 max-w-[258px] mx-auto">
        {KEYPAD_DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            disabled={isBlocked}
            onClick={() => appendDigit(digit)}
            className="min-h-[54px] rounded-2xl bg-white dark:bg-[#2A2A2A] hover:bg-[#F2EFE8] dark:hover:bg-[#343434] active:scale-[0.94] text-[22px] font-medium tabular-nums text-[#141413] dark:text-[#F4F1EA] shadow-[0_2px_6px_-2px_rgba(20,20,19,0.08)] dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.45)] transition-all duration-100 flex items-center justify-center cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141413]/40 dark:focus-visible:ring-[#F4F1EA]/40"
          >
            {digit}
          </button>
        ))}

        {/* Bottom-left slot: custom utility or clear */}
        {leftActionLabel && onLeftAction ? (
          <button
            type="button"
            disabled={isBlocked}
            onClick={onLeftAction}
            className="min-h-[54px] rounded-2xl text-xs font-medium text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA] hover:bg-[#EFECE6]/70 dark:hover:bg-[#2C2C2C] active:scale-[0.95] transition-all duration-100 flex items-center justify-center cursor-pointer disabled:opacity-45"
          >
            {leftActionLabel}
          </button>
        ) : value.length > 0 ? (
          <button
            type="button"
            disabled={isBlocked}
            onClick={handleClear}
            aria-label="Очистити ПІН-код"
            className="min-h-[54px] rounded-2xl text-xs font-medium text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA] hover:bg-[#EFECE6]/70 dark:hover:bg-[#2C2C2C] active:scale-[0.95] transition-all duration-100 flex items-center justify-center cursor-pointer disabled:opacity-45"
          >
            Скинути
          </button>
        ) : (
          <div aria-hidden="true" className="min-h-[54px]" />
        )}

        {/* Bottom-center: 0 */}
        <button
          type="button"
          disabled={isBlocked}
          onClick={() => appendDigit('0')}
          className="min-h-[54px] rounded-2xl bg-white dark:bg-[#2A2A2A] hover:bg-[#F2EFE8] dark:hover:bg-[#343434] active:scale-[0.94] text-[22px] font-medium tabular-nums text-[#141413] dark:text-[#F4F1EA] shadow-[0_2px_6px_-2px_rgba(20,20,19,0.08)] dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.45)] transition-all duration-100 flex items-center justify-center cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141413]/40 dark:focus-visible:ring-[#F4F1EA]/40"
        >
          0
        </button>

        {/* Bottom-right: Backspace */}
        <button
          type="button"
          disabled={isBlocked || value.length === 0}
          onClick={handleBackspace}
          aria-label="Стерти останню цифру"
          className="min-h-[54px] rounded-2xl text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA] hover:bg-[#EFECE6]/70 dark:hover:bg-[#2C2C2C] active:scale-[0.93] transition-all duration-100 flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141413]/40 dark:focus-visible:ring-[#F4F1EA]/40"
        >
          <Delete className="w-5 h-5" strokeWidth={1.85} />
        </button>
      </div>
    </div>
  );
}
