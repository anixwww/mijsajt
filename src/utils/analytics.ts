import type { AnalyticsClickCategory, AnalyticsDwellCategory } from '../types.ts';

interface QueuedEvent {
  type: 'click' | 'dwell' | 'exit';
  targetKey: string;
  label: string;
  category?: string;
  section?: string;
  durationSeconds?: number;
}

interface ActiveMomentState {
  targetKey: string;
  momentKey: string;
  label: string;
  category: AnalyticsDwellCategory;
  section: string;
  startedAtMs: number;
}

const SESSION_STORAGE_KEY = 'dankiv_analytics_session_v1';

let sessionIdCache: string | null = null;
let sessionStartMs = Date.now();
let currentMoment: ActiveMomentState | null = null;
let pendingEvents: QueuedEvent[] = [];
let flushTimer: number | null = null;
let exitTrackedForHide = false;

function getSessionId(): string {
  if (sessionIdCache) return sessionIdCache;
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) {
      sessionIdCache = existing;
      return existing;
    }
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    sessionIdCache = created;
    return created;
  } catch {
    sessionIdCache = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return sessionIdCache;
  }
}

function sendEventsPayload(events: QueuedEvent[], useBeacon = false): void {
  if (typeof window === 'undefined' || events.length === 0) return;

  const payload = JSON.stringify({
    sessionId: getSessionId(),
    events: events.slice(0, 20),
  });

  if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const sent = navigator.sendBeacon('/api/analytics/event', payload);
      if (sent) return;
    } catch {
      // Fall back to keepalive fetch
    }
  }

  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Ignore transient analytics delivery failures
  });
}

function flushQueue(useBeacon = false): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingEvents.length === 0) return;
  const batch = pendingEvents;
  pendingEvents = [];
  sendEventsPayload(batch, useBeacon);
}

function scheduleFlush(): void {
  if (typeof window === 'undefined' || flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushQueue(false);
  }, 2500);
}

function flushCurrentDwell(resetTimer: boolean): void {
  if (!currentMoment) return;
  const now = Date.now();
  const elapsedSeconds = Math.round((now - currentMoment.startedAtMs) / 1000);
  if (resetTimer) {
    currentMoment.startedAtMs = now;
  }
  if (elapsedSeconds >= 2) {
    pendingEvents.push({
      type: 'dwell',
      targetKey: currentMoment.targetKey,
      label: currentMoment.label,
      category: currentMoment.category,
      section: currentMoment.section,
      durationSeconds: elapsedSeconds,
    });
  }
}

export function trackClick(
  targetKey: string,
  label: string,
  category: AnalyticsClickCategory
): void {
  if (typeof window === 'undefined') return;
  pendingEvents.push({
    type: 'click',
    targetKey,
    label,
    category,
  });
  scheduleFlush();
}

export function setActiveMoment(moment: {
  targetKey: string;
  momentKey: string;
  label: string;
  category: AnalyticsDwellCategory;
  section: string;
}): void {
  if (typeof window === 'undefined') return;

  if (
    currentMoment &&
    currentMoment.targetKey === moment.targetKey &&
    currentMoment.momentKey === moment.momentKey
  ) {
    return;
  }

  if (currentMoment) {
    flushCurrentDwell(false);
    scheduleFlush();
  }

  currentMoment = {
    ...moment,
    startedAtMs: Date.now(),
  };
  exitTrackedForHide = false;
}

const VISIT_TRACKED_KEY = 'dankiv_visit_tracked_v1';

function trackSessionVisit(entrySection?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (sessionStorage.getItem(VISIT_TRACKED_KEY) === '1') return;
    sessionStorage.setItem(VISIT_TRACKED_KEY, '1');
  } catch {
    // Ignore storage unavailability
  }

  const sessionId = getSessionId();
  const payload = JSON.stringify({
    sessionId,
    entrySection: entrySection || 'home',
    referrer: typeof document !== 'undefined' ? document.referrer || '' : '',
  });

  fetch('/api/visitors/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Ignore transient network errors
  });
}

export function initBehaviorAnalytics(entrySection?: string): () => void {
  if (typeof window === 'undefined') return () => {};
  getSessionId();
  sessionStartMs = Date.now();
  trackSessionVisit(entrySection);

  const handleExitFlush = () => {
    flushCurrentDwell(true);
    if (!exitTrackedForHide) {
      exitTrackedForHide = true;
      const totalSessionSeconds = Math.max(1, Math.round((Date.now() - sessionStartMs) / 1000));
      pendingEvents.push({
        type: 'exit',
        targetKey: currentMoment?.momentKey || 'home',
        label: currentMoment?.label || 'Головна сторінка',
        section: currentMoment?.section || 'home',
        durationSeconds: totalSessionSeconds,
      });
    }
    flushQueue(true);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      handleExitFlush();
    } else {
      exitTrackedForHide = false;
      if (currentMoment) {
        currentMoment.startedAtMs = Date.now();
      }
    }
  };

  const onPageHide = () => {
    handleExitFlush();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    flushCurrentDwell(false);
    flushQueue(true);
  };
}
