import { Feather } from 'lucide-react';

interface EmptySectionStateProps {
  className?: string;
}

export function EmptySectionState({ className = '' }: EmptySectionStateProps) {
  return (
    <div
      className={`py-16 sm:py-20 px-6 flex flex-col items-center justify-center text-center select-none ${className}`}
    >
      <div className="flex items-center gap-3 mb-4" aria-hidden="true">
        <span className="h-px w-8 bg-gradient-to-r from-transparent to-pine/35 dark:to-white/25" />
        <span className="w-8 h-8 rounded-full bg-pine/[0.07] dark:bg-white/[0.06] inline-flex items-center justify-center text-pine dark:text-silver">
          <Feather className="w-3.5 h-3.5" strokeWidth={1.6} />
        </span>
        <span className="h-px w-8 bg-gradient-to-l from-transparent to-pine/35 dark:to-white/25" />
      </div>

      <p className="text-xl sm:text-2xl font-light italic tracking-[-0.015em] text-ink/90 dark:text-cream/92 leading-snug">
        Тут поки що тиша
      </p>
    </div>
  );
}
