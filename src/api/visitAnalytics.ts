import crypto from 'crypto';
import type { Request } from 'express';
import type { SiteDatabase } from '../../server/seedData.ts';
import type {
  VisitBreakdownItem,
  VisitDeviceType,
  VisitLogEntry,
  VisitPeriodKey,
  VisitPeriodReport,
  VisitTrendPoint,
} from '../types.ts';

const KYIV_TIMEZONE = 'Europe/Kyiv';
const MAX_VISIT_RETENTION_DAYS = 65;
const MAX_VISIT_LOG_RECORDS = 12000;
const API_VISIT_DEDUP_MS = 30 * 60 * 1000;
const SESSION_UPGRADE_WINDOW_MS = 3 * 60 * 1000;

const KYIV_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: KYIV_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const KYIV_HOUR_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: KYIV_TIMEZONE,
  hour: '2-digit',
  hour12: false,
});

const KYIV_SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('uk-UA', {
  timeZone: KYIV_TIMEZONE,
  day: 'numeric',
  month: 'short',
});

export function getKyivDateKey(date: Date): string {
  return KYIV_DATE_FORMATTER.format(date);
}

export function getKyivHour(date: Date): number {
  const parsed = Number(KYIV_HOUR_FORMATTER.format(date));
  return Number.isFinite(parsed) ? parsed % 24 : 0;
}

function formatKyivShortDay(date: Date): string {
  return KYIV_SHORT_DATE_FORMATTER.format(date).replace(/\.$/, '');
}

const VALID_SECTIONS = new Set(['home', 'poetry', 'prose', 'blog', 'store', 'radio']);

export function normalizeEntrySection(rawSection?: string): string {
  if (typeof rawSection !== 'string') return 'home';
  const clean = rawSection.trim().toLowerCase();
  return VALID_SECTIONS.has(clean) ? clean : 'home';
}

export function entrySectionLabel(section: string): string {
  switch (section) {
    case 'home':
      return 'Головна';
    case 'poetry':
      return 'Вірші';
    case 'prose':
      return 'Проза';
    case 'blog':
      return 'Блог';
    case 'store':
      return 'Крамниця';
    case 'radio':
      return 'Радіо';
    default:
      return section;
  }
}

export function deviceTypeLabel(deviceType: VisitDeviceType): string {
  switch (deviceType) {
    case 'mobile':
      return 'Смартфони';
    case 'tablet':
      return 'Планшети';
    case 'desktop':
      return 'Комп’ютери';
    case 'bot':
      return 'Боти / Пошукові системи';
  }
}

export function parseUserAgentSummary(rawUa: string | undefined): {
  deviceType: VisitDeviceType;
  browser: string;
  os: string;
} {
  const ua = typeof rawUa === 'string' ? rawUa : '';
  const lower = ua.toLowerCase();

  let deviceType: VisitDeviceType = 'desktop';
  if (
    /bot|crawler|spider|slurp|bingpreview|googlebot|yandex|duckduckbot|facebookexternalhit|telegrambot|whatsapp|curl|wget|headless/i.test(
      lower
    )
  ) {
    deviceType = 'bot';
  } else if (/ipad|tablet|playbook|silk|android(?!.*mobile)/i.test(lower)) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(lower)) {
    deviceType = 'mobile';
  }

  let os = 'Інше';
  if (/iphone|ipad|ipod|ios/i.test(lower)) {
    os = 'iOS';
  } else if (/android/i.test(lower)) {
    os = 'Android';
  } else if (/windows/i.test(lower)) {
    os = 'Windows';
  } else if (/mac os x|macintosh/i.test(lower)) {
    os = 'macOS';
  } else if (/linux/i.test(lower)) {
    os = 'Linux';
  }

  let browser = 'Інше';
  if (/telegram/i.test(lower)) {
    browser = 'Telegram';
  } else if (/instagram/i.test(lower)) {
    browser = 'Instagram';
  } else if (/edg\//i.test(lower)) {
    browser = 'Edge';
  } else if (/opr\/|opera/i.test(lower)) {
    browser = 'Opera';
  } else if (/firefox|fxios/i.test(lower)) {
    browser = 'Firefox';
  } else if (/chrome|crios/i.test(lower) && !/edg\//i.test(lower)) {
    browser = 'Chrome';
  } else if (/safari/i.test(lower) && !/chrome|crios|android/i.test(lower)) {
    browser = 'Safari';
  } else if (deviceType === 'bot') {
    browser = 'Бот';
  }

  return { deviceType, browser, os };
}

function mapHostToFriendlyReferrer(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  if (host === 't.me' || host.endsWith('.t.me') || host.includes('telegram')) {
    return 'Telegram';
  }
  if (host === 'google.com' || host.startsWith('google.') || host.includes('.google.')) {
    return 'Google';
  }
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    return 'Instagram';
  }
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com') {
    return 'Facebook';
  }
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) {
    return 'YouTube';
  }
  if (host === 'threads.net' || host.endsWith('.threads.net')) {
    return 'Threads';
  }
  if (host === 'x.com' || host === 'twitter.com' || host === 't.co') {
    return 'X (Twitter)';
  }
  return host;
}

export function normalizeReferrerHost(rawReferrer: string | undefined, req: Request): string {
  const candidate =
    (typeof rawReferrer === 'string' && rawReferrer.trim()) ||
    (typeof req.headers.referer === 'string' && req.headers.referer.trim()) ||
    '';
  if (!candidate) return 'Прямий перехід';

  try {
    const parsed = new URL(candidate);
    const refHost = parsed.host.toLowerCase();
    const ownHosts = new Set<string>();
    const reqHost = req.get('host');
    const fwdHost = req.get('x-forwarded-host');
    if (reqHost) {
      for (const h of reqHost.split(',')) {
        const clean = h.trim().toLowerCase();
        if (clean) ownHosts.add(clean);
      }
    }
    if (fwdHost) {
      for (const h of fwdHost.split(',')) {
        const clean = h.trim().toLowerCase();
        if (clean) ownHosts.add(clean);
      }
    }
    if (process.env.APP_URL) {
      try {
        ownHosts.add(new URL(process.env.APP_URL).host.toLowerCase());
      } catch {
        // Ignore malformed APP_URL
      }
    }
    if (!refHost || ownHosts.has(refHost)) {
      return 'Прямий перехід';
    }
    return mapHostToFriendlyReferrer(parsed.hostname);
  } catch {
    return 'Прямий перехід';
  }
}

export function recordSiteVisit(
  db: SiteDatabase,
  req: Request,
  ipHash: string,
  options?: {
    sessionId?: string;
    entrySection?: string;
    referrer?: string;
    isNewVisitor?: boolean;
    source?: 'api' | 'client';
  }
): boolean {
  if (!Array.isArray(db.analytics.visitRecords)) {
    db.analytics.visitRecords = [];
  }
  const records = db.analytics.visitRecords;
  const now = new Date();
  const nowMs = now.getTime();
  const source = options?.source ?? 'api';
  const cleanSessionId =
    typeof options?.sessionId === 'string' && options.sessionId.trim()
      ? options.sessionId.trim().slice(0, 64)
      : undefined;
  const entrySection = normalizeEntrySection(options?.entrySection);
  const referrerHost = normalizeReferrerHost(options?.referrer, req);

  if (cleanSessionId) {
    const existingBySession = records.find((r) => r.sessionId === cleanSessionId);
    if (existingBySession) {
      let mutated = false;
      if (existingBySession.entrySection === 'home' && entrySection !== 'home') {
        existingBySession.entrySection = entrySection;
        mutated = true;
      }
      if (
        existingBySession.referrerHost === 'Прямий перехід' &&
        referrerHost !== 'Прямий перехід'
      ) {
        existingBySession.referrerHost = referrerHost;
        mutated = true;
      }
      return mutated;
    }

    // Upgrade a recent API-bootstrap visit from the same IP hash within 3 minutes
    for (let i = records.length - 1; i >= 0; i -= 1) {
      const rec = records[i];
      const recMs = Date.parse(rec.timestamp);
      if (Number.isFinite(recMs) && nowMs - recMs > SESSION_UPGRADE_WINDOW_MS) {
        break;
      }
      if (rec.ipHash === ipHash && !rec.sessionId) {
        const uaUpgrade = parseUserAgentSummary(req.headers['user-agent']);
        rec.sessionId = cleanSessionId;
        rec.deviceType = uaUpgrade.deviceType;
        rec.browser = uaUpgrade.browser;
        rec.os = uaUpgrade.os;
        if (entrySection !== 'home') {
          rec.entrySection = entrySection;
        }
        if (referrerHost !== 'Прямий перехід') {
          rec.referrerHost = referrerHost;
        }
        return true;
      }
    }
  } else if (source === 'api') {
    for (let i = records.length - 1; i >= 0; i -= 1) {
      const rec = records[i];
      const recMs = Date.parse(rec.timestamp);
      if (Number.isFinite(recMs) && nowMs - recMs > API_VISIT_DEDUP_MS) {
        break;
      }
      if (rec.ipHash === ipHash) {
        return false;
      }
    }
  }

  const uaSummary = parseUserAgentSummary(req.headers['user-agent']);
  const entry: VisitLogEntry = {
    id: `vis_${nowMs.toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    ipHash,
    ...(cleanSessionId ? { sessionId: cleanSessionId } : {}),
    timestamp: now.toISOString(),
    dateKey: getKyivDateKey(now),
    hour: getKyivHour(now),
    entrySection,
    deviceType: uaSummary.deviceType,
    browser: uaSummary.browser,
    os: uaSummary.os,
    referrerHost,
    isNewVisitor: Boolean(options?.isNewVisitor),
  };

  records.push(entry);

  // Prune old entries beyond retention window
  const cutoffMs = nowMs - MAX_VISIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (records.length > MAX_VISIT_LOG_RECORDS || (records[0] && Date.parse(records[0].timestamp) < cutoffMs)) {
    db.analytics.visitRecords = records
      .filter((item) => {
        const ts = Date.parse(item.timestamp);
        return Number.isFinite(ts) && ts >= cutoffMs;
      })
      .slice(-MAX_VISIT_LOG_RECORDS);
  }

  return true;
}

function buildBreakdown(
  items: VisitLogEntry[],
  getKeyAndLabel: (entry: VisitLogEntry) => { key: string; label: string },
  limit = 8
): VisitBreakdownItem[] {
  const total = items.length;
  if (total === 0) return [];
  const counts = new Map<string, { key: string; label: string; visits: number }>();
  for (const item of items) {
    const { key, label } = getKeyAndLabel(item);
    const existing = counts.get(key);
    if (existing) {
      existing.visits += 1;
    } else {
      counts.set(key, { key, label, visits: 1 });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.visits - a.visits)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      sharePercent: Math.round((entry.visits / total) * 100),
    }));
}

function computeDeltaPercent(current: number, previous: number): number | null {
  if (previous <= 0) {
    return current > 0 ? null : 0;
  }
  return Math.round(((current - previous) / previous) * 100);
}

function summarizePeriodReport(params: {
  period: VisitPeriodKey;
  label: string;
  currentEntries: VisitLogEntry[];
  previousEntries: VisitLogEntry[];
  trendBuckets: Array<{ key: string; label: string; entries: VisitLogEntry[] }>;
}): VisitPeriodReport {
  const { period, label, currentEntries, previousEntries, trendBuckets } = params;
  const uniqueSet = new Set<string>();
  let newVisitors = 0;
  let returningVisitors = 0;

  for (const entry of currentEntries) {
    uniqueSet.add(entry.ipHash);
    if (entry.isNewVisitor) {
      newVisitors += 1;
    } else {
      returningVisitors += 1;
    }
  }

  const trend: VisitTrendPoint[] = trendBuckets.map((bucket) => {
    const bucketUnique = new Set<string>();
    let bucketNew = 0;
    let bucketReturning = 0;
    for (const item of bucket.entries) {
      bucketUnique.add(item.ipHash);
      if (item.isNewVisitor) bucketNew += 1;
      else bucketReturning += 1;
    }
    return {
      key: bucket.key,
      label: bucket.label,
      visits: bucket.entries.length,
      uniqueVisitors: bucketUnique.size,
      newVisitors: bucketNew,
      returningVisitors: bucketReturning,
    };
  });

  let peakPoint: VisitTrendPoint | null = null;
  for (const point of trend) {
    if (!peakPoint || point.visits > peakPoint.visits) {
      peakPoint = point;
    }
  }

  const recentVisits = [...currentEntries]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 30)
    .map((item) => ({
      id: item.id,
      visitorCode: item.ipHash.slice(0, 6).toUpperCase(),
      timestamp: item.timestamp,
      entrySection: item.entrySection,
      deviceType: item.deviceType,
      browser: item.browser,
      os: item.os,
      referrerHost: item.referrerHost,
      isNewVisitor: item.isNewVisitor,
    }));

  return {
    period,
    label,
    totalVisits: currentEntries.length,
    uniqueVisitors: uniqueSet.size,
    newVisitors,
    returningVisitors,
    previousPeriodVisits: previousEntries.length,
    deltaPercent: computeDeltaPercent(currentEntries.length, previousEntries.length),
    peakLabel: peakPoint && peakPoint.visits > 0 ? peakPoint.label : null,
    peakVisits: peakPoint?.visits ?? 0,
    trend,
    devices: buildBreakdown(currentEntries, (e) => ({
      key: e.deviceType,
      label: deviceTypeLabel(e.deviceType),
    })),
    browsers: buildBreakdown(currentEntries, (e) => ({
      key: e.browser,
      label: e.browser,
    }), 6),
    operatingSystems: buildBreakdown(currentEntries, (e) => ({
      key: e.os,
      label: e.os,
    }), 6),
    entrySections: buildBreakdown(currentEntries, (e) => ({
      key: e.entrySection,
      label: entrySectionLabel(e.entrySection),
    })),
    referrers: buildBreakdown(currentEntries, (e) => ({
      key: e.referrerHost,
      label: e.referrerHost,
    }), 8),
    recentVisits,
  };
}

export function buildVisitStatisticsReport(db: SiteDatabase): {
  allTimeUniqueVisitors: number;
  day: VisitPeriodReport;
  week: VisitPeriodReport;
  month: VisitPeriodReport;
} {
  const records = Array.isArray(db.analytics.visitRecords) ? db.analytics.visitRecords : [];
  const nowMs = Date.now();
  const parsed = records
    .map((entry) => ({ entry, ts: Date.parse(entry.timestamp) }))
    .filter((item) => Number.isFinite(item.ts));

  // 1. DAY (Last 24 hours, bucketed by Kyiv hour)
  const dayStartMs = nowMs - 24 * 60 * 60 * 1000;
  const prevDayStartMs = nowMs - 48 * 60 * 60 * 1000;
  const dayCurrent = parsed.filter((i) => i.ts >= dayStartMs && i.ts <= nowMs).map((i) => i.entry);
  const dayPrevious = parsed
    .filter((i) => i.ts >= prevDayStartMs && i.ts < dayStartMs)
    .map((i) => i.entry);

  const hourBucketMap = new Map<string, VisitLogEntry[]>();
  const dayBuckets: Array<{ key: string; label: string; entries: VisitLogEntry[] }> = [];
  for (let offset = 23; offset >= 0; offset -= 1) {
    const slotDate = new Date(nowMs - offset * 60 * 60 * 1000);
    const dk = getKyivDateKey(slotDate);
    const hr = getKyivHour(slotDate);
    const bucketKey = `${dk}:${hr}`;
    if (!hourBucketMap.has(bucketKey)) {
      const list: VisitLogEntry[] = [];
      hourBucketMap.set(bucketKey, list);
      dayBuckets.push({
        key: bucketKey,
        label: `${hr.toString().padStart(2, '0')}:00`,
        entries: list,
      });
    }
  }
  for (const entry of dayCurrent) {
    const key = `${entry.dateKey}:${entry.hour}`;
    const list = hourBucketMap.get(key);
    if (list) {
      list.push(entry);
    }
  }

  // Helper for daily Kyiv calendar windows (week = 7 days, month = 30 days)
  const buildDailyReport = (period: 'week' | 'month', label: string, daysCount: number) => {
    const currentDateKeys: string[] = [];
    const currentBuckets: Array<{ key: string; label: string; entries: VisitLogEntry[] }> = [];
    const currentMap = new Map<string, VisitLogEntry[]>();

    for (let offset = daysCount - 1; offset >= 0; offset -= 1) {
      const d = new Date(nowMs - offset * 24 * 60 * 60 * 1000);
      const dk = getKyivDateKey(d);
      if (!currentMap.has(dk)) {
        const list: VisitLogEntry[] = [];
        currentMap.set(dk, list);
        currentDateKeys.push(dk);
        currentBuckets.push({
          key: dk,
          label: formatKyivShortDay(d),
          entries: list,
        });
      }
    }

    const previousDateKeys = new Set<string>();
    for (let offset = daysCount * 2 - 1; offset >= daysCount; offset -= 1) {
      const d = new Date(nowMs - offset * 24 * 60 * 60 * 1000);
      previousDateKeys.add(getKyivDateKey(d));
    }

    const currentSet = new Set(currentDateKeys);
    const currentEntries: VisitLogEntry[] = [];
    const previousEntries: VisitLogEntry[] = [];

    for (const { entry } of parsed) {
      if (currentSet.has(entry.dateKey)) {
        currentEntries.push(entry);
        currentMap.get(entry.dateKey)?.push(entry);
      } else if (previousDateKeys.has(entry.dateKey)) {
        previousEntries.push(entry);
      }
    }

    return summarizePeriodReport({
      period,
      label,
      currentEntries,
      previousEntries,
      trendBuckets: currentBuckets,
    });
  };

  return {
    allTimeUniqueVisitors: db.visitorIpHashes.length,
    day: summarizePeriodReport({
      period: 'day',
      label: 'За добу (24 год)',
      currentEntries: dayCurrent,
      previousEntries: dayPrevious,
      trendBuckets: dayBuckets,
    }),
    week: buildDailyReport('week', 'За тиждень (7 днів)', 7),
    month: buildDailyReport('month', 'За місяць (30 днів)', 30),
  };
}
