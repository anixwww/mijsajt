import { useEffect, useState, type RefObject } from 'react';

export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      setVisible(document.visibilityState !== 'hidden');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  return visible;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export function useInView(
  ref: RefObject<Element | null>,
  rootMargin = '120px'
): boolean {
  const [inView, setInView] = useState<boolean>(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setInView(entry.isIntersecting);
        }
      },
      { rootMargin, threshold: 0.01 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return inView;
}

export function useViewportActivity(
  ref: RefObject<Element | null>,
  rootMargin = '120px'
): {
  isActive: boolean;
  inView: boolean;
  isVisible: boolean;
  reducedMotion: boolean;
} {
  const inView = useInView(ref, rootMargin);
  const isVisible = usePageVisibility();
  const reducedMotion = usePrefersReducedMotion();

  return {
    isActive: inView && isVisible && !reducedMotion,
    inView,
    isVisible,
    reducedMotion,
  };
}
