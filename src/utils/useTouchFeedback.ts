import { useCallback, useEffect, useRef, useState, type PointerEvent, type TouchEvent } from 'react';

interface TouchPoint {
  x: number;
  y: number;
}

export function useTouchFeedback() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const startPointRef = useRef<TouchPoint | null>(null);

  const clearTimer = useCallback(() => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  const scheduleRelease = useCallback(
    (id: string) => {
      clearTimer();
      clearTimerRef.current = window.setTimeout(() => {
        setActiveId((prev) => (prev === id ? null : prev));
        clearTimerRef.current = null;
      }, 110);
    },
    [clearTimer]
  );

  const shouldIgnoreTarget = (target: EventTarget | null, ignoreSelector?: string): boolean => {
    if (!ignoreSelector || !(target instanceof Element)) return false;
    return Boolean(target.closest(ignoreSelector));
  };

  const getTouchProps = useCallback(
    (id: string, ignoreSelector?: string) => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (shouldIgnoreTarget(e.target, ignoreSelector)) return;
        clearTimer();
        startPointRef.current = { x: e.clientX, y: e.clientY };
        setActiveId(id);
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const start = startPointRef.current;
        if (!start) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
          startPointRef.current = null;
          setActiveId((prev) => (prev === id ? null : prev));
        }
      },
      onPointerUp: () => {
        startPointRef.current = null;
        scheduleRelease(id);
      },
      onPointerCancel: () => {
        startPointRef.current = null;
        clearTimer();
        setActiveId((prev) => (prev === id ? null : prev));
      },
      onPointerLeave: () => {
        startPointRef.current = null;
        clearTimer();
        setActiveId((prev) => (prev === id ? null : prev));
      },
      onTouchStart: (e: TouchEvent<HTMLElement>) => {
        if (shouldIgnoreTarget(e.target, ignoreSelector)) return;
        const touch = e.touches[0];
        if (touch) {
          startPointRef.current = { x: touch.clientX, y: touch.clientY };
        }
        clearTimer();
        setActiveId(id);
      },
      onTouchMove: (e: TouchEvent<HTMLElement>) => {
        const start = startPointRef.current;
        const touch = e.touches[0];
        if (!start || !touch) return;
        if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) {
          startPointRef.current = null;
          setActiveId((prev) => (prev === id ? null : prev));
        }
      },
      onTouchEnd: () => {
        startPointRef.current = null;
        scheduleRelease(id);
      },
      onTouchCancel: () => {
        startPointRef.current = null;
        clearTimer();
        setActiveId((prev) => (prev === id ? null : prev));
      },
    }),
    [clearTimer, scheduleRelease]
  );

  const isTouchActive = useCallback((id: string) => activeId === id, [activeId]);

  return { getTouchProps, isTouchActive };
}
