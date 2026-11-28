import type { CSSProperties } from 'react';
import { Heart } from 'lucide-react';

const PETAL_ANGLES = [0, 60, 120, 180, 240, 300] as const;

interface HeartBloomIconProps {
  liked: boolean;
  bloomKey?: number;
  phase?: 'idle' | 'like' | 'unlike';
  className?: string;
  strokeWidth?: number;
  activeColorClass?: string;
}

export function HeartBloomIcon({
  liked,
  bloomKey = 0,
  phase = 'idle',
  className = 'w-4 h-4',
  strokeWidth = 1.8,
  activeColorClass = 'fill-rose-600 text-rose-600 dark:fill-rose-400 dark:text-rose-400',
}: HeartBloomIconProps) {
  const showBloom = bloomKey > 0 && phase === 'like' && liked;
  const iconAnimClass =
    bloomKey > 0 && phase === 'like' && liked
      ? 'heart-bloom-pop'
      : bloomKey > 0 && phase === 'unlike' && !liked
        ? 'heart-unlike-pop'
        : liked
          ? 'scale-110'
          : '';

  return (
    <span className="relative inline-flex items-center justify-center shrink-0">
      {showBloom && (
        <span
          key={`bloom-${bloomKey}`}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="heart-bloom-ring absolute w-5 h-5 rounded-full border border-rose-500/70 dark:border-rose-400/75" />
          {PETAL_ANGLES.map((angle) => (
            <span
              key={angle}
              style={{ '--petal-angle': `${angle}deg` } as CSSProperties}
              className="heart-bloom-petal absolute w-1 h-1 rounded-full bg-rose-500 dark:bg-rose-400"
            />
          ))}
        </span>
      )}
      <Heart
        key={bloomKey > 0 ? `heart-${bloomKey}-${phase}` : 'heart-static'}
        className={`${className} transition-transform duration-150 ${
          liked ? activeColorClass : ''
        } ${iconAnimClass}`}
        strokeWidth={strokeWidth}
      />
    </span>
  );
}
