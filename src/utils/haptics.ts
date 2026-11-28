const MIN_HAPTIC_INTERVAL_MS = 40;
let lastHapticTimestamp = 0;

function vibrateSafe(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignore browsers or embedded contexts where Vibration API is restricted
  }
}

export function triggerHapticFeedback(durationMs: number | number[] = 12): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }

  const now = Date.now();
  if (now - lastHapticTimestamp < MIN_HAPTIC_INTERVAL_MS) {
    return;
  }
  lastHapticTimestamp = now;
  vibrateSafe(durationMs);
}

export function triggerLikeHapticFeedback(liked: boolean): void {
  lastHapticTimestamp = Date.now();
  vibrateSafe(liked ? [14, 26, 20] : 10);
}

export function initGlobalButtonHaptics(): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }

  const handleGlobalButtonClick = (event: MouseEvent) => {
    if (!event.isTrusted) return;
    if (!(event.target instanceof Element)) return;

    const interactive = event.target.closest('button, [role="button"], [role="tab"]');
    if (!interactive) return;

    if (
      (interactive instanceof HTMLButtonElement && interactive.disabled) ||
      interactive.getAttribute('aria-disabled') === 'true'
    ) {
      return;
    }

    if (interactive.hasAttribute('data-haptic-like')) {
      return;
    }

    triggerHapticFeedback(12);
  };

  document.addEventListener('click', handleGlobalButtonClick, { capture: true, passive: true });
  return () => {
    document.removeEventListener('click', handleGlobalButtonClick, { capture: true });
  };
}
