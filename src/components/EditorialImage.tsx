import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';

interface EditorialImageProps {
  src?: string;
  alt: string;
  titleFallback?: string;
  className?: string;
  aspectClassName?: string;
  priority?: boolean;
  transparentBg?: boolean;
  width?: number;
  height?: number;
  onImageError?: () => void;
}

export function EditorialImage({
  src,
  alt,
  titleFallback,
  className = '',
  aspectClassName = 'aspect-[3/4]',
  priority = false,
  transparentBg = false,
  width,
  height,
  onImageError,
}: EditorialImageProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center bg-[#EFECE6] dark:bg-[#262626] p-6 text-center ${aspectClassName} ${className}`}
        role="img"
        aria-label={alt}
      >
        <BookOpen className="w-6 h-6 text-[#5C5C58] dark:text-[#A8A49B] mb-3" strokeWidth={1.5} />
        <span className="font-serif text-lg font-medium text-[#141413] dark:text-[#F4F1EA] leading-snug max-w-[18ch]">
          {titleFallback || alt}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${
        transparentBg ? 'bg-transparent' : 'bg-[#EFECE6] dark:bg-[#262626]'
      } ${aspectClassName} ${className}`}
    >
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        referrerPolicy="no-referrer"
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding={priority ? 'sync' : 'async'}
        onError={() => {
          setHasError(true);
          onImageError?.();
        }}
        className="w-full h-full object-cover transition-transform duration-300 ease-out hover:will-change-transform"
      />
    </div>
  );
}
