import type {
  WeeklyPeriodInfo,
  WeeklyPoemWinner,
  WeeklyProseWinner,
} from '../src/types.ts';
import type {
  RawPoem,
  RawProseWork,
  SiteDatabase,
  WeeklyVoteLogEntry,
} from './seedData.ts';

const KYIV_TIMEZONE = 'Europe/Kyiv';

const UKRAINIAN_MONTHS_GENITIVE = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
] as const;

const UKRAINIAN_MONTH_NAME_TO_INDEX: Record<string, number> = {
  січня: 0,
  січень: 0,
  лютого: 1,
  лютий: 1,
  березня: 2,
  березень: 2,
  квітня: 3,
  квітень: 3,
  травня: 4,
  травень: 4,
  червня: 5,
  червень: 5,
  липня: 6,
  липень: 6,
  серпня: 7,
  серпень: 7,
  вересня: 8,
  вересень: 8,
  жовтня: 9,
  жовтень: 9,
  листопада: 10,
  листопад: 10,
  грудня: 11,
  грудень: 11,
};

function getKyivDateParts(date: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value || date.getUTCFullYear());
  const month = Number(parts.find((p) => p.type === 'month')?.value || date.getUTCMonth() + 1);
  const day = Number(parts.find((p) => p.type === 'day')?.value || date.getUTCDate());
  return { year, month, day };
}

export function toKyivDateString(date: Date): string {
  const { year, month, day } = getKyivDateParts(date);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseYmdToUtcNoon(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((n) => Number(n));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
}

function formatUtcDateYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const dt = parseYmdToUtcNoon(ymd);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return formatUtcDateYmd(dt);
}

function getIsoWeekKeyFromMondayYmd(mondayYmd: string): string {
  const thursday = parseYmdToUtcNoon(addDaysYmd(mondayYmd, 3));
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 12, 0, 0));
  const jan4Day = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const firstMonday = new Date(jan4.getTime());
  firstMonday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const diffDays = Math.round((parseYmdToUtcNoon(mondayYmd).getTime() - firstMonday.getTime()) / 86400000);
  const weekNum = Math.floor(diffDays / 7) + 1;
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

export function formatUkrainianPeriodLabel(periodStart: string, periodEnd: string): string {
  const [y1, m1, d1] = periodStart.split('-').map((n) => Number(n));
  const [y2, m2, d2] = periodEnd.split('-').map((n) => Number(n));
  const month1 = UKRAINIAN_MONTHS_GENITIVE[(m1 || 1) - 1] || '';
  const month2 = UKRAINIAN_MONTHS_GENITIVE[(m2 || 1) - 1] || '';

  if (y1 === y2 && m1 === m2) {
    return `${d1}–${d2} ${month1} ${y1} р.`;
  }
  if (y1 === y2) {
    return `${d1} ${month1} – ${d2} ${month2} ${y1} р.`;
  }
  return `${d1} ${month1} ${y1} – ${d2} ${month2} ${y2} р.`;
}

export function getWeekPeriodForDate(date: Date = new Date()): WeeklyPeriodInfo {
  const ymd = toKyivDateString(date);
  const utcNoon = parseYmdToUtcNoon(ymd);
  const dayOfWeek = utcNoon.getUTCDay(); // 0=Sun..6=Sat
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const periodStart = addDaysYmd(ymd, offsetToMonday);
  const periodEnd = addDaysYmd(periodStart, 6);
  const weekKey = getIsoWeekKeyFromMondayYmd(periodStart);
  return {
    weekKey,
    periodStart,
    periodEnd,
    periodLabel: formatUkrainianPeriodLabel(periodStart, periodEnd),
  };
}

export function getPreviousWeekPeriod(date: Date = new Date(), weeksBack = 1): WeeklyPeriodInfo {
  const current = getWeekPeriodForDate(date);
  const periodStart = addDaysYmd(current.periodStart, -7 * Math.max(1, weeksBack));
  const periodEnd = addDaysYmd(periodStart, 6);
  const weekKey = getIsoWeekKeyFromMondayYmd(periodStart);
  return {
    weekKey,
    periodStart,
    periodEnd,
    periodLabel: formatUkrainianPeriodLabel(periodStart, periodEnd),
  };
}

export function getWeekPeriodForWeekKey(rawWeekKey: string): WeeklyPeriodInfo | null {
  const match = rawWeekKey.trim().match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const isoYear = Number(match[1]);
  const weekNum = Number(match[2]);
  if (!Number.isInteger(isoYear) || isoYear < 2000 || isoYear > 2200) return null;
  if (!Number.isInteger(weekNum) || weekNum < 1 || weekNum > 53) return null;

  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 12, 0, 0));
  const jan4Day = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const firstMonday = new Date(jan4.getTime());
  firstMonday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (weekNum - 1) * 7);
  const periodStart = formatUtcDateYmd(firstMonday);
  const periodEnd = addDaysYmd(periodStart, 6);
  const verifiedKey = getIsoWeekKeyFromMondayYmd(periodStart);
  if (verifiedKey !== `${isoYear}-W${String(weekNum).padStart(2, '0')}`) {
    return null;
  }
  return {
    weekKey: verifiedKey,
    periodStart,
    periodEnd,
    periodLabel: formatUkrainianPeriodLabel(periodStart, periodEnd),
  };
}

function parseWorkCreatedYmd(rawDate?: string): string | null {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const trimmed = rawDate.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const isoMs = Date.parse(trimmed);
  if (Number.isFinite(isoMs)) {
    return toKyivDateString(new Date(isoMs));
  }

  const normalized = trimmed.toLowerCase().replace(/\s*р\.?$/i, '');
  const textMatch = normalized.match(/^(\d{1,2})\s+([а-яіїєґ']+)\s+(\d{4})$/u);
  if (textMatch) {
    const day = Number(textMatch[1]);
    const monthIdx = UKRAINIAN_MONTH_NAME_TO_INDEX[textMatch[2]];
    const year = Number(textMatch[3]);
    if (monthIdx !== undefined && Number.isFinite(day) && Number.isFinite(year)) {
      return `${String(year).padStart(4, '0')}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function recordWeeklyVoteLog(
  db: SiteDatabase,
  params: {
    targetType: 'poem' | 'prose';
    targetId: string;
    voterKey: string;
    rating: number;
    createdAt?: string;
  }
): void {
  if (!Array.isArray(db.weeklyVoteLog)) {
    db.weeklyVoteLog = [];
  }
  const createdAt =
    params.createdAt && !Number.isNaN(Date.parse(params.createdAt))
      ? params.createdAt
      : new Date().toISOString();
  const weekKey = getWeekPeriodForDate(new Date(createdAt)).weekKey;
  const alreadyExists = db.weeklyVoteLog.some(
    (entry) =>
      entry.targetType === params.targetType &&
      entry.targetId === params.targetId &&
      entry.voterKey === params.voterKey
  );
  if (alreadyExists) return;

  db.weeklyVoteLog.push({
    targetType: params.targetType,
    targetId: params.targetId,
    voterKey: params.voterKey,
    rating: Math.max(0.1, Math.min(5, Math.round(params.rating * 10) / 10)),
    weekKey,
    createdAt,
  });

  if (db.weeklyVoteLog.length > 5000) {
    db.weeklyVoteLog = db.weeklyVoteLog.slice(-5000);
  }
}

export function createWeeklyPoemWinnerSnapshot(
  poem: RawPoem,
  period: WeeklyPeriodInfo,
  stats: { ratingAverage: number; ratingCount: number },
  selectedAt = new Date().toISOString()
): WeeklyPoemWinner {
  return {
    id: `poem_${period.weekKey}`,
    weekKey: period.weekKey,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodLabel: period.periodLabel,
    selectedAt,
    sourcePoemId: poem.id,
    ...(poem.submissionId ? { sourceSubmissionId: poem.submissionId } : {}),
    ...(poem.authorUid ? { authorUid: poem.authorUid } : {}),
    authorName: (poem.authorName || 'Читач').trim() || 'Читач',
    ...(poem.authorPhotoUrl ? { authorPhotoUrl: poem.authorPhotoUrl } : {}),
    title: poem.title,
    ...(poem.cycle ? { cycle: poem.cycle } : {}),
    ...(typeof poem.year === 'number' ? { year: poem.year } : {}),
    content: poem.content,
    ...(poem.note ? { note: poem.note } : {}),
    ...(poem.fontSize ? { fontSize: poem.fontSize } : {}),
    ...(poem.textAlign ? { textAlign: poem.textAlign } : {}),
    ...(poem.lineSpacing ? { lineSpacing: poem.lineSpacing } : {}),
    ...(poem.textColor ? { textColor: poem.textColor } : {}),
    ...(poem.backgroundColor ? { backgroundColor: poem.backgroundColor } : {}),
    ...(poem.imageUrl ? { imageUrl: poem.imageUrl } : {}),
    ...(poem.imagePalette ? { imagePalette: { ...poem.imagePalette } } : {}),
    ...(poem.soundcloudTrack ? { soundcloudTrack: { ...poem.soundcloudTrack } } : {}),
    ...(Array.isArray(poem.soundcloudTracks) && poem.soundcloudTracks.length > 0
      ? { soundcloudTracks: poem.soundcloudTracks.map((t) => ({ ...t })) }
      : {}),
    ratingAverage: Number(stats.ratingAverage.toFixed(1)),
    ratingCount: Math.max(0, Math.round(stats.ratingCount)),
  };
}

export function createWeeklyProseWinnerSnapshot(
  work: RawProseWork,
  period: WeeklyPeriodInfo,
  stats: { ratingAverage: number; ratingCount: number },
  selectedAt = new Date().toISOString()
): WeeklyProseWinner {
  const baseWords = countWords(work.content || '');
  const chapterWords = Array.isArray(work.chapters)
    ? work.chapters.reduce((sum, ch) => sum + countWords(ch.content || ''), 0)
    : 0;
  const totalWords = baseWords + chapterWords;

  return {
    id: `prose_${period.weekKey}`,
    weekKey: period.weekKey,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodLabel: period.periodLabel,
    selectedAt,
    sourceProseId: work.id,
    ...(work.submissionId ? { sourceSubmissionId: work.submissionId } : {}),
    ...(work.authorUid ? { authorUid: work.authorUid } : {}),
    authorName: (work.authorName || 'Читач').trim() || 'Читач',
    ...(work.authorPhotoUrl ? { authorPhotoUrl: work.authorPhotoUrl } : {}),
    title: work.title,
    genre: work.genre || 'Оповідання',
    pages: Math.max(1, Math.round(Number(work.pages) || 1)),
    ...(totalWords > 0 ? { totalWords } : {}),
    ...(work.slogan ? { slogan: work.slogan } : {}),
    content: work.content || '',
    ...(Array.isArray(work.chapters) && work.chapters.length > 0
      ? { chapters: work.chapters.map((ch) => ({ ...ch })) }
      : {}),
    ...(Array.isArray(work.moodboardUrls) && work.moodboardUrls.length > 0
      ? { moodboardUrls: [...work.moodboardUrls] }
      : {}),
    ...(work.publishedAt ? { publishedAt: work.publishedAt } : {}),
    ratingAverage: Number(stats.ratingAverage.toFixed(1)),
    ratingCount: Math.max(0, Math.round(stats.ratingCount)),
  };
}

function getPoemCreationYmd(poem: RawPoem, db: SiteDatabase): string | null {
  if (poem.submissionId) {
    const sub = (db.poemSubmissions || []).find((s) => s.id === poem.submissionId);
    if (sub?.createdAt) {
      return parseWorkCreatedYmd(sub.createdAt);
    }
  }
  return null;
}

function getProseCreationYmd(work: RawProseWork, db: SiteDatabase): string | null {
  if (work.submissionId) {
    const sub = (db.proseSubmissions || []).find((s) => s.id === work.submissionId);
    if (sub?.createdAt) {
      return parseWorkCreatedYmd(sub.createdAt);
    }
  }
  if (work.publishedAt) {
    return parseWorkCreatedYmd(work.publishedAt);
  }
  return null;
}

function pickWinningCommunityPoemForWeek(
  db: SiteDatabase,
  period: WeeklyPeriodInfo,
  allowBootstrapFromAllVotes: boolean
): WeeklyPoemWinner | null {
  const communityPoems = (db.poems || []).filter((p) => {
    if (!p.isCommunity) return false;
    const createdYmd = getPoemCreationYmd(p, db);
    if (createdYmd && createdYmd > period.periodEnd) return false;
    return true;
  });
  if (communityPoems.length === 0) return null;

  const weekEntries = (db.weeklyVoteLog || []).filter(
    (e): e is WeeklyVoteLogEntry => e.targetType === 'poem' && e.weekKey === period.weekKey
  );

  const statsByPoemId = new Map<string, { avg: number; count: number }>();

  if (weekEntries.length > 0) {
    const grouped = new Map<string, number[]>();
    for (const entry of weekEntries) {
      const arr = grouped.get(entry.targetId) || [];
      arr.push(entry.rating);
      grouped.set(entry.targetId, arr);
    }
    for (const poem of communityPoems) {
      const scores = grouped.get(poem.id);
      if (scores && scores.length > 0) {
        const avg = scores.reduce((sum, n) => sum + n, 0) / scores.length;
        statsByPoemId.set(poem.id, { avg, count: scores.length });
      }
    }
  } else if (allowBootstrapFromAllVotes) {
    for (const poem of communityPoems) {
      const votes = Object.values(db.poemVotes?.[poem.id] || {});
      if (votes.length > 0) {
        const avg = votes.reduce((sum, n) => sum + n, 0) / votes.length;
        statsByPoemId.set(poem.id, { avg, count: votes.length });
      }
    }
  }

  const candidates = communityPoems
    .map((poem) => {
      const stat = statsByPoemId.get(poem.id);
      if (!stat || stat.count <= 0) return null;
      const reviewsCount = (db.reviews || []).filter(
        (r) => r.targetType === 'poem' && r.targetId === poem.id
      ).length;
      const viewsCount = db.poemViews?.[poem.id] || 0;
      return { poem, stat, reviewsCount, viewsCount };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const avgDiff = b.stat.avg - a.stat.avg;
    if (Math.abs(avgDiff) > 0.001) return avgDiff;
    const countDiff = b.stat.count - a.stat.count;
    if (countDiff !== 0) return countDiff;
    const revDiff = b.reviewsCount - a.reviewsCount;
    if (revDiff !== 0) return revDiff;
    return b.viewsCount - a.viewsCount;
  });

  const best = candidates[0];
  return createWeeklyPoemWinnerSnapshot(best.poem, period, {
    ratingAverage: best.stat.avg,
    ratingCount: best.stat.count,
  });
}

function pickWinningCommunityProseForWeek(
  db: SiteDatabase,
  period: WeeklyPeriodInfo,
  allowBootstrapFromAllVotes: boolean
): WeeklyProseWinner | null {
  const communityProse = (db.prose || []).filter((w) => {
    if (!w.isCommunity) return false;
    const createdYmd = getProseCreationYmd(w, db);
    if (createdYmd && createdYmd > period.periodEnd) return false;
    return true;
  });
  if (communityProse.length === 0) return null;

  const weekEntries = (db.weeklyVoteLog || []).filter(
    (e): e is WeeklyVoteLogEntry => e.targetType === 'prose' && e.weekKey === period.weekKey
  );

  const statsByProseId = new Map<string, { avg: number; count: number }>();

  if (weekEntries.length > 0) {
    const grouped = new Map<string, number[]>();
    for (const entry of weekEntries) {
      const arr = grouped.get(entry.targetId) || [];
      arr.push(entry.rating);
      grouped.set(entry.targetId, arr);
    }
    for (const work of communityProse) {
      const scores = grouped.get(work.id);
      if (scores && scores.length > 0) {
        const avg = scores.reduce((sum, n) => sum + n, 0) / scores.length;
        statsByProseId.set(work.id, { avg, count: scores.length });
      }
    }
  } else if (allowBootstrapFromAllVotes) {
    for (const work of communityProse) {
      const votes = Object.values(db.proseVotes?.[work.id] || {});
      if (votes.length > 0) {
        const avg = votes.reduce((sum, n) => sum + n, 0) / votes.length;
        statsByProseId.set(work.id, { avg, count: votes.length });
      }
    }
  }

  const candidates = communityProse
    .map((work) => {
      const stat = statsByProseId.get(work.id);
      if (!stat || stat.count <= 0) return null;
      const reviewsCount = (db.reviews || []).filter(
        (r) => r.targetType === 'prose' && r.targetId === work.id
      ).length;
      return { work, stat, reviewsCount };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const avgDiff = b.stat.avg - a.stat.avg;
    if (Math.abs(avgDiff) > 0.001) return avgDiff;
    const countDiff = b.stat.count - a.stat.count;
    if (countDiff !== 0) return countDiff;
    return b.reviewsCount - a.reviewsCount;
  });

  const best = candidates[0];
  return createWeeklyProseWinnerSnapshot(best.work, period, {
    ratingAverage: best.stat.avg,
    ratingCount: best.stat.count,
  });
}

export function ensureWeeklyWinnersUpToDate(
  db: SiteDatabase,
  now: Date = new Date()
): { changed: boolean; addedPoems: WeeklyPoemWinner[]; addedProse: WeeklyProseWinner[] } {
  if (!Array.isArray(db.weeklyPoems)) db.weeklyPoems = [];
  if (!Array.isArray(db.weeklyProse)) db.weeklyProse = [];
  if (!Array.isArray(db.weeklyVoteLog)) db.weeklyVoteLog = [];

  let changed = false;
  const addedPoems: WeeklyPoemWinner[] = [];
  const addedProse: WeeklyProseWinner[] = [];

  const existingPoemWeeks = new Set(db.weeklyPoems.map((w) => w.weekKey));
  const existingProseWeeks = new Set(db.weeklyProse.map((w) => w.weekKey));

  // Check up to the last 4 completed weeks (oldest to newest) so missed rollovers recover cleanly
  for (let weeksBack = 4; weeksBack >= 1; weeksBack -= 1) {
    const period = getPreviousWeekPeriod(now, weeksBack);
    const allowBootstrap = weeksBack === 1;

    if (!existingPoemWeeks.has(period.weekKey)) {
      const winnerPoem = pickWinningCommunityPoemForWeek(
        db,
        period,
        allowBootstrap && db.weeklyPoems.length === 0
      );
      if (winnerPoem) {
        db.weeklyPoems.unshift(winnerPoem);
        existingPoemWeeks.add(period.weekKey);
        addedPoems.push(winnerPoem);
        changed = true;
      }
    }

    if (!existingProseWeeks.has(period.weekKey)) {
      const winnerProse = pickWinningCommunityProseForWeek(
        db,
        period,
        allowBootstrap && db.weeklyProse.length === 0
      );
      if (winnerProse) {
        db.weeklyProse.unshift(winnerProse);
        existingProseWeeks.add(period.weekKey);
        addedProse.push(winnerProse);
        changed = true;
      }
    }
  }

  if (changed) {
    db.weeklyPoems.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
    db.weeklyProse.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  }

  return { changed, addedPoems, addedProse };
}
