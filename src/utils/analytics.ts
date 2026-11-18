import type { AnalyticsClickCategory, AnalyticsDwellCategory } from '../types.ts';

interface PendingEvent {
  type: 'click' | 'dwell' | 'exit';
  targetKey: string;
  label: string;
  category?: string;
  section?: string;
  durationSeconds?: number;
}

export interface ActiveMoment {
  targetKey: string;
  momentKey: string;
  label: string;
  category: AnalyticsDwellCategory;
  section: string;
}

const SESSION_STORAGE_KEY = 'dankiv_analytics_session_v1';
const ANALYTICS_ENDPOINT = '/api/analytics/event';

function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && existing.length >= 6) return existing;
    const generated = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

const sessionId = getOrCreateSessionId();
const sessionStartMs = Date.now();

let currentMoment: ActiveMoment = {
  targetKey: 'section:home',
  momentKey: 'home',
  label: 'Головна сторінка',
  category: 'section',
  section: 'home',
};
let momentEnteredAtMs = Date.now();
let isPageHidden = typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false;
let exitReportedForHide = false;
let lifecycleInitialized = false;

function dispatchEvents(events: PendingEvent[], useBeacon = false): void {
  if (events.length === 0) return;
  const payload = JSON.stringify({
    sessionId,
    events,
  });

  if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon(ANALYTICS_ENDPOINT, blob)) {
        return;
      }
    } catch {
      // Fall through to keepalive fetch
    }
  }

  fetch(ANALYTICS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: useBeacon,
  }).catch(() => {
    // Analytics must never interrupt user experience
  });
}

function flushActiveDwell(useBeacon = false): PendingEvent | null {
  if (isPageHidden) return null;
  const elapsedSec = Math.round((Date.now() - momentEnteredAtMs) / 1000);
  momentEnteredAtMs = Date.now();
  if (elapsedSec < 2) return null;

  const ev: PendingEvent = {
    type: 'dwell',
    targetKey: currentMoment.targetKey,
    label: currentMoment.label,
    category: currentMoment.category,
    section: currentMoment.section,
    durationSeconds: Math.min(elapsedSec, 14400),
  };
  if (!useBeacon) {
    dispatchEvents([ev], false);
  }
  return ev;
}

export function trackClick(
  targetKey: string,
  label: string,
  category: AnalyticsClickCategory = 'action'
): void {
  dispatchEvents([
    {
      type: 'click',
      targetKey,
      label,
      category,
    },
  ]);
}

export function setActiveMoment(next: ActiveMoment): void {
  if (
    currentMoment.targetKey === next.targetKey &&
    currentMoment.momentKey === next.momentKey
  ) {
    return;
  }
  flushActiveDwell(false);
  currentMoment = next;
  momentEnteredAtMs = Date.now();
  exitReportedForHide = false;
}

export function initBehaviorAnalytics(): () => void {
  if (lifecycleInitialized || typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  lifecycleInitialized = true;

  const handleLeaveOrHide = () => {
    const batch: PendingEvent[] = [];
    const dwellEvent = flushActiveDwell(true);
    if (dwellEvent) {
      batch.push(dwellEvent);
    }

    if (!exitReportedForHide) {
      exitReportedForHide = true;
      const totalSessionSec = Math.max(1, Math.round((Date.now() - sessionStartMs) / 1000));
      batch.push({
        type: 'exit',
        targetKey: currentMoment.momentKey,
        label: currentMoment.label,
        section: currentMoment.section,
        durationSeconds: Math.min(totalSessionSec, 28800),
      });
    }

    if (batch.length > 0) {
      dispatchEvents(batch, true);
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      handleLeaveOrHide();
      isPageHidden = true;
    } else {
      isPageHidden = false;
      momentEnteredAtMs = Date.now();
      exitReportedForHide = false;
    }
  };

  const handlePageHide = () => {
    handleLeaveOrHide();
    isPageHidden = true;
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', handlePageHide);
    lifecycleInitialized = false;
  };
}
