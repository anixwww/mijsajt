import { useState } from 'react';
import { RegistrationCrosshair } from './EditorialMarks.tsx';

interface EditorialImageProps {
  src?: string;
  alt: string;
  titleFallback?: string;
  className?: string;
  aspectClassName?: string;
  priority?: boolean;
}

export function EditorialImage({
  src,
  alt,
  titleFallback,
  className = '',
  aspectClassName = 'aspect-[3/4]',
  priority = false,
}: EditorialImageProps) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div
        className={`relative flex flex-col items-start justify-between bg-[#ECEAE2] dark:bg-[#1B1B18] border border-[#0D0D0C]/16 dark:border-[#252522] p-6 text-left ${aspectClassName} ${className}`}
        role="img"
        aria-label={alt}
      >
        <RegistrationCrosshair className="w-4 h-4 text-[#1E4631] dark:text-[#4E946C]" />
        <span className="font-serif text-xl font-medium text-[#0D0D0C] dark:text-[#F2F1EC] leading-snug max-w-[18ch]">
          {titleFallback || alt}
        </span>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-[#ECEAE2] dark:bg-[#1B1B18] ${aspectClassName} ${className}`}>
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setHasError(true)}
        className="w-full h-full object-cover transition-transform duration-300 ease-out will-change-transform group-hover:scale-[1.02]"
      />
    </div>
  );
}
