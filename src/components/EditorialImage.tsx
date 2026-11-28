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
        className={`relative flex flex-col items-center justify-center bg-paper-warm dark:bg-night-card p-6 text-center ${aspectClassName} ${className}`}
        role="img"
        aria-label={alt}
      >
        <BookOpen className="w-6 h-6 text-ink-muted dark:text-sandstone-light mb-3" strokeWidth={1.5} />
        <span className="font-serif text-lg font-medium text-ink dark:text-cream leading-snug max-w-[18ch]">
          {titleFallback || alt}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${
        transparentBg ? 'bg-transparent' : 'bg-paper-warm dark:bg-night-card'
      } ${aspectClassName} ${className}`}
    >
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        referrerPolicy="no-referrer"
        {...(priority
          ? { fetchPriority: 'high' }
          : { loading: 'lazy', decoding: 'async' })}
        onError={() => {
          setHasError(true);
          onImageError?.();
        }}
        className="w-full h-full object-cover transition-transform duration-300 ease-out hover:will-change-transform"
      />
    </div>
  );
}
