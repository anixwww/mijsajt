import 'dotenv/config';
import compression from 'compression';
import crypto from 'crypto';
import dns from 'dns/promises';
import express, { type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import fs from 'fs';
import http from 'http';
import https from 'https';
import helmet from 'helmet';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import sharp from 'sharp';
import {
  DEFAULT_AUTHOR_ABOUT_TEXT,
  DEFAULT_AUTHOR_PHOTO_URL,
  DEFAULT_CONTACT_EMAIL,
  DEFAULT_HERO_LEAD_TEXT,
  DEFAULT_HOME_ACTION_ABOUT,
  DEFAULT_HOME_ACTION_CONTACT,
  DEFAULT_HOME_ACTION_INTERVIEWS,
  DEFAULT_HOME_ACTION_MONOBANK,
  DEFAULT_INTERVIEWS,
  DEFAULT_MONOBANK_CARD_LABEL,
  DEFAULT_MONOBANK_EMPTY_TEXT,
  DEFAULT_MONOBANK_JAR_URL,
  DEFAULT_MONOBANK_MODAL_SUBTITLE,
  DEFAULT_MONOBANK_MODAL_TEXT,
  DEFAULT_MONOBANK_MODAL_TITLE,
  DEFAULT_SOCIAL_LINKS,
  INITIAL_DATABASE,
  type DonorRecord,
  type FeedbackRecord,
  type GuestAccountRecord,
  type MonobankJarWatermark,
  type PoemSubmissionRecord,
  type ProseSubmissionRecord,
  type RawBlogPost,
  type RawPoem,
  type RawProseWork,
  type RawStoreProduct,
  type SiteDatabase,
  type WeeklyVoteLogEntry,
} from './server/seedData.ts';
import {
  getEffectivePriceUah,
  getProseDiscountCalculation,
  isPhysicalProduct,
  normalizeHomeRepeatersConfig,
  type AnalyticsClickCategory,
  type AnalyticsDwellCategory,
  type AuthorAnalyticsReport,
  type BlogPost,
  type ContactMessageRecord,
  type EncryptedPaymentEnvelope,
  type EncryptedPiiEnvelope,
  type GlobalChatMessage,
  type GuestUser,
  type HomeFeedbackItem,
  type InterviewLinkItem,
  type LeaderboardDonorEntry,
  type LeaderboardSeniorityEntry,
  type LeaderboardActivityEntry,
  type LeaderboardTimeEntry,
  type MonthlySelection,
  type MonthlySelectionTrack,
  type OrderRecord,
  type PaymentSummary,
  type Poem,
  type PoemImagePalette,
  type PoemSoundCloudTrack,
  type PoemSubmission,
  type PoemSubmissionStatus,
  type ProseAccessMode,
  type ProseChapter,
  type ProseStatus,
  type ProseTag,
  type ProseTagColor,
  type ProseWork,
  type PurchasedAccess,
  type RadioStationId,
  type RadioTrack,
  type ReviewItem,
  type ShippingDetails,
  type SiteAnalyticsData,
  type SocialLinkItem,
  type StoreProduct,
  type TopRankNumber,
  type UserLeaderboardResponse,
  type UserTopBadges,
  type WeeklyMusicSelection,
  type WeeklyMusicTrack,
  type WeeklyPoemWinner,
  type WeeklyProseWinner,
} from './src/types.ts';
import {
  computeProseWorkPages,
  countProseWords,
} from './src/utils/prosePagination.ts';
import {
  getFirstFormattedExcerptLine,
  preserveFormattedText,
} from './src/utils/textFormatting.ts';
import {
  extractYouTubeVideoId,
  getYouTubeThumbnailUrl,
  getYouTubeWatchUrl,
  isValidBlogPhotoUrl,
  stripBlogMediaTokens,
} from './src/utils/blogMedia.ts';
import {
  applyCloudTelegramBotToken,
  registerTelegramBotRoutes,
  verifyTelegramSubscriberForRequest,
} from './src/api/telegramBot.ts';
import {
  buildVisitStatisticsReport,
  recordSiteVisit,
} from './src/api/visitAnalytics.ts';
import {
  ensureWeeklyWinnersUpToDate,
  getWeekPeriodForDate,
  getWeekPeriodForWeekKey,
  recordWeeklyVoteLog,
} from './server/weeklyHighlights.ts';
import {
  selectRadioStationRepertoire,
  type RadioRepertoireBucket,
} from './src/utils/radioRepertoire.ts';
import {
  checkPersistentRateLimit,
  configurePersistentRateLimitPath,
  createPersistentRateLimitStore,
} from './server/persistentRateLimit.ts';
import {
  ALL_DB_SLICES,
  loadSiteDatabaseFromSqlite,
  saveSiteDatabaseToSqlite,
  savePaymentSessionToSqlite,
  getAndConsumePaymentSessionFromSqlite,
  purgeExpiredPaymentSessionsSqlite,
  upsertMonobankInvoiceSqlite,
  getMonobankInvoiceSqlite,
  purgeExpiredMonobankInvoicesSqlite,
  type DbSliceKey,
  type SqliteMonobankInvoice,
} from './server/sqliteStore.ts';
import {
  cloudSyncState,
  paymentSessions,
  pendingMonobankStoreInvoices,
  pendingMonobankProseInvoices,
  getMonobankToken,
  persistPendingInvoices,
  ensurePendingInvoicesLoaded,
  queueDatabaseSyncToFirestore,
  syncWorkVoteToFirestore,
  syncReviewToFirestore,
  updateSingleReviewInFirestore,
  deleteSingleReviewInFirestore,
  hydrateAdminPoemSubmissionsFromFirestore,
  hydrateAdminProseSubmissionsFromFirestore,
  hydrateAdminOrdersFromFirestore,
  hydrateAdminSiteFeedbackFromFirestore,
  syncDonationToFirestore,
  deleteDonationInFirestore,
  syncSiteFeedbackToFirestore,
  hydrateUserSiteFeedbackFromFirestore,
  deleteSiteFeedbackInFirestore,
  deleteReviewsForTargetInFirestore,
  syncPoemSubmissionToFirestore,
  saveMediaAssetToFirestore,
  loadMediaAssetFromFirestore,
  deletePoemSubmissionInFirestore,
  syncProseSubmissionToFirestore,
  deleteProseSubmissionInFirestore,
  deleteRadioTrackInFirestore,
  syncSingleWeeklyMusicSelectionInFirestore,
  deleteWeeklyMusicSelectionInFirestore,
  syncPublicUserProfileToFirestore,
  hydrateSingleAuthorizedProse,
  syncChatMessageToFirestore,
  deleteChatMessageInFirestore,
  syncAdminTelegramTokenToFirestore,
  hydrateAuthorizedProseAndRadio,
  hydratePublicCatalogFromFirestore,
  hydrateUserPoemSubmissionsFromFirestore,
  hydrateUserProseSubmissionsFromFirestore,
  syncGuestLikesToFirestore,
  syncRadioLikeEntryToFirestore,
  syncUserPoemLikeEntriesToFirestore,
  syncPoemLikeEntryToFirestore,
  syncOrderToFirestore,
  hydratePoemLikesFromFirestore,
  hydrateRadioLikesFromFirestore,
  hydrateCommunityStateFromFirestore,
  hydrateGuestLikesFromFirestore,
  hydrateAdminSecretsFromFirestore,
  type PendingMonobankStoreInvoice,
} from './server/firestoreStubs.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const EBOOKS_DIR = path.join(DATA_DIR, 'ebooks');
const PROSE_PDF_DIR = path.join(DATA_DIR, 'prose-pdfs');
const ADMIN_EMAILS = new Set<string>([
  'andrijdankiv5@gmail.com',
  'andriidankiv.writer@gmail.com',
]);
function isAdminEmailAddress(email?: string | null): boolean {
  return Boolean(email && ADMIN_EMAILS.has(email.trim().toLowerCase()));
}
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const FIREBASE_PROJECT_ID = (() => {
  const candidates = [
    path.join(__dirname, 'firebase-applet-config.json'),
    path.join(process.cwd(), 'firebase-applet-config.json'),
  ];
  for (const configPath of candidates) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as { projectId?: string };
      if (parsed.projectId) return parsed.projectId;
    } catch {
      // Try next candidate
    }
  }
  return '';
})();

interface VerifiedFirebaseClaims {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  email_verified?: boolean;
  name: string | null;
  picture: string | null;
}

let cachedCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getFirebasePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedCerts && now < cachedCerts.expiresAt) {
    return cachedCerts.certs;
  }

  const response = await fetch(GOOGLE_CERTS_URL);
  if (!response.ok) {
    if (cachedCerts) return cachedCerts.certs;
    throw new Error('Не вдалося отримати публічні сертифікати Firebase.');
  }

  const certs = (await response.json()) as Record<string, string>;
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = {
    certs,
    expiresAt: now + Math.max(60, maxAgeSec) * 1000,
  };
  return certs;
}

function decodeBase64UrlJson<T>(segment: string): T | null {
  try {
    const jsonStr = Buffer.from(segment, 'base64url').toString('utf-8');
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

const verifiedFirebaseTokenCache = new Map<
  string,
  { claims: VerifiedFirebaseClaims; expiresAtMs: number }
>();

async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseClaims | null> {
  if (!FIREBASE_PROJECT_ID) return null;
  const nowMs = Date.now();
  const cached = verifiedFirebaseTokenCache.get(token);
  if (cached) {
    if (cached.expiresAtMs > nowMs) {
      return cached.claims;
    }
    verifiedFirebaseTokenCache.delete(token);
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    return null;
  }

  let certs = await getFirebasePublicCerts(false);
  let certPem = certs[header.kid];
  if (!certPem) {
    certs = await getFirebasePublicCerts(true);
    certPem = certs[header.kid];
  }
  if (!certPem) return null;

  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    const signature = Buffer.from(signatureB64, 'base64url');
    if (!verifier.verify(certPem, signature)) {
      return null;
    }
  } catch {
    return null;
  }

  const payload = decodeBase64UrlJson<{
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  }>(payloadB64);

  if (!payload) return null;
  const nowSec = Math.floor(nowMs / 1000);
  const expectedIssuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;

  if (payload.aud !== FIREBASE_PROJECT_ID || payload.iss !== expectedIssuer) {
    return null;
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    return null;
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    return null;
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > nowSec + 300) {
    return null;
  }

  const claims: VerifiedFirebaseClaims = {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };

  if (verifiedFirebaseTokenCache.size >= 1000) {
    verifiedFirebaseTokenCache.clear();
  }
  verifiedFirebaseTokenCache.set(token, {
    claims,
    expiresAtMs: Math.min(payload.exp * 1000 - 10_000, nowMs + 30_000),
  });

  return claims;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  const guestHeader = req.headers['x-guest-token'];
  if (typeof guestHeader === 'string' && guestHeader.trim()) {
    return guestHeader.trim();
  }
  return null;
}

function isVerifiedAdminClaims(claims: VerifiedFirebaseClaims | null): boolean {
  return Boolean(
    claims &&
      claims.emailVerified &&
      isAdminEmailAddress(claims.email)
  );
}

async function authenticateAdminRequest(
  req: Request
): Promise<{ ok: true; claims: VerifiedFirebaseClaims } | { ok: false; status: number; error: string }> {
  const token = extractBearerToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Увійдіть через Google-пошту адміністратора, щоб виконувати зміни.',
    };
  }
  try {
    const claims = await verifyFirebaseIdToken(token);
    if (!claims) {
      return {
        ok: false,
        status: 401,
        error: 'Сесія адміністратора недійсна або закінчилась. Увійдіть повторно.',
      };
    }
    if (!isVerifiedAdminClaims(claims)) {
      return {
        ok: false,
        status: 403,
        error: 'Редагування дозволено лише в ролі Адміністратора сайту.',
      };
    }
    return { ok: true, claims };
  } catch {
    return {
      ok: false,
      status: 401,
      error: 'Не вдалося перевірити авторизацію адміністратора.',
    };
  }
}

const VALID_PRESET_TAG_COLORS = new Set<string>([
  'rose',
  'amber',
  'emerald',
  'sky',
  'violet',
  'coral',
  'teal',
  'indigo',
]);

function normalizeProseTagColor(rawColor: unknown): ProseTagColor {
  if (typeof rawColor !== 'string') return 'rose';
  const trimmed = rawColor.trim();
  if (VALID_PRESET_TAG_COLORS.has(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  return 'rose';
}

function normalizeProseStatus(rawStatus: unknown): ProseStatus | undefined {
  if (rawStatus === 'completed' || rawStatus === 'in_progress') {
    return rawStatus;
  }
  return undefined;
}

function resolveProseAccessMode(
  work: Pick<RawProseWork, 'accessMode' | 'requiresAuth' | 'isPaid' | 'priceUah'>
): ProseAccessMode {
  if (work.accessMode === 'paid' || (Boolean(work.isPaid) && Number(work.priceUah || 0) > 0)) {
    return 'paid';
  }
  if (work.accessMode === 'authorized' || Boolean(work.requiresAuth)) {
    return 'authorized';
  }
  return 'public';
}

function createEmptyAnalytics(): SiteAnalyticsData {
  return {
    totalSessions: 0,
    seenSessionIds: [],
    totalClicks: 0,
    totalTrackedSeconds: 0,
    clicksByTarget: {},
    dwellByTarget: {},
    exitsByMoment: {},
    recentEvents: [],
    visitRecords: [],
  };
}

const BUILTIN_IMAGE_EXT_RE = /^(\/src\/assets\/images\/[a-z0-9_]+_179502567\d+)\.jpg$/i;

function normalizeBuiltInImageUrl(url: string): string {
  return url.replace(BUILTIN_IMAGE_EXT_RE, '$1.webp');
}

let cachedDb: SiteDatabase | null = null;
let catalogRevision = 1;
let visitorIpSet: Set<string> = new Set();
let seenAnalyticsSessionsSet: Set<string> = new Set();
let dirsEnsured = false;
let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFlushDeadlineMs = 0;
let dirtyPendingWrite = false;
let shutdownHooksRegistered = false;
const pendingDirtySlices = new Set<DbSliceKey>();
const pendingDirtyOrderCodes = new Set<string>();
let pendingAllOrdersDirty = false;

function syncRuntimeSets(db: SiteDatabase): void {
  visitorIpSet = new Set(db.visitorIpHashes);
  seenAnalyticsSessionsSet = new Set(db.analytics.seenSessionIds);
}

function ensureDataDirectories(): void {
  if (dirsEnsured) return;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(EBOOKS_DIR)) {
    fs.mkdirSync(EBOOKS_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROSE_PDF_DIR)) {
    fs.mkdirSync(PROSE_PDF_DIR, { recursive: true });
  }
  dirsEnsured = true;
}

function flushDatabaseSync(): void {
  if (pendingFlushTimer) {
    clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
  }
  pendingFlushDeadlineMs = 0;

  if (!cachedDb || !dirtyPendingWrite) {
    pendingDirtySlices.clear();
    pendingDirtyOrderCodes.clear();
    pendingAllOrdersDirty = false;
    dirtyPendingWrite = false;
    return;
  }

  const slicesSnapshot = new Set(pendingDirtySlices);
  const ordersSnapshot: ReadonlySet<string> | 'all' = pendingAllOrdersDirty
    ? 'all'
    : new Set(pendingDirtyOrderCodes);

  pendingDirtySlices.clear();
  pendingDirtyOrderCodes.clear();
  pendingAllOrdersDirty = false;
  dirtyPendingWrite = false;

  saveSiteDatabaseToSqlite(cachedDb, {
    dirtySlices: slicesSnapshot,
    dirtyOrderCodes: ordersSnapshot,
  });
}

function registerDatabaseShutdownHooks(): void {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;
  const flushOnExit = () => {
    try {
      flushDatabaseSync();
    } catch {
      // Ignore flush error on process shutdown
    }
  };
  process.once('beforeExit', flushOnExit);
  process.once('SIGINT', () => {
    flushOnExit();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    flushOnExit();
    process.exit(0);
  });
}

function ensureDatabase(): SiteDatabase {
  if (cachedDb) {
    return cachedDb;
  }
  ensureDataDirectories();
  const db = loadSiteDatabaseFromSqlite();
  cachedDb = db;
  syncRuntimeSets(cachedDb);
  registerDatabaseShutdownHooks();
  return cachedDb;
}

function saveDatabase(
  db: SiteDatabase,
  options?: {
    bumpCatalogRevision?: boolean;
    flushDelayMs?: number;
    slices?: DbSliceKey[];
    ordersDirty?: boolean | string[];
  }
): void {
  cachedDb = db;
  registerDatabaseShutdownHooks();

  const shouldBumpRevision = options?.bumpCatalogRevision !== false;
  if (shouldBumpRevision) {
    catalogRevision += 1;
  }

  if (options?.slices && options.slices.length > 0) {
    for (const sk of options.slices) {
      pendingDirtySlices.add(sk);
    }
  } else if (!options?.ordersDirty) {
    for (const sk of ALL_DB_SLICES) {
      pendingDirtySlices.add(sk);
    }
  }

  if (options?.ordersDirty === true) {
    pendingAllOrdersDirty = true;
  } else if (Array.isArray(options?.ordersDirty)) {
    for (const code of options.ordersDirty) {
      if (code) pendingDirtyOrderCodes.add(code);
    }
  }

  dirtyPendingWrite = true;
  const delayMs = Math.max(0, Math.min(5000, options?.flushDelayMs ?? 1200));

  if (delayMs === 0) {
    flushDatabaseSync();
    return;
  }

  const targetDeadlineMs = Date.now() + delayMs;
  if (!pendingFlushTimer || targetDeadlineMs < pendingFlushDeadlineMs) {
    if (pendingFlushTimer) {
      clearTimeout(pendingFlushTimer);
    }
    pendingFlushDeadlineMs = targetDeadlineMs;
    pendingFlushTimer = setTimeout(() => {
      pendingFlushTimer = null;
      pendingFlushDeadlineMs = 0;
      flushDatabaseSync();
    }, delayMs);
    pendingFlushTimer.unref();
  }
}

function getNormalizedClientIp(req: Request): string {
  const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  return rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
}

function getTrustedWsIp(request: http.IncomingMessage): string {
  const remote = request.socket?.remoteAddress || '127.0.0.1';
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    // Under trust proxy = 1, the single reverse proxy appends the real client IP as the rightmost hop
    const hops = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (hops.length > 0) {
      const candidate = hops[hops.length - 1];
      return candidate.startsWith('::ffff:') ? candidate.slice(7) : candidate;
    }
  }
  return remote.startsWith('::ffff:') ? remote.slice(7) : remote;
}

function getClientIpHash(req: Request): string {
  return crypto.createHash('sha256').update(getNormalizedClientIp(req)).digest('hex');
}

const GUEST_SESSION_SECRET_FILE = path.join(DATA_DIR, '.guest-session-secret');
const GUEST_SESSION_COOKIE_NAME = 'dankiv_guest_session';
const GUEST_SESSION_TTL_SEC = 30 * 24 * 60 * 60;
const PIN_MAX_FAILED_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;
let cachedGuestSessionSecret: string | null = null;

function getGuestSessionSecret(): Buffer | string {
  const envSecret = process.env.GUEST_SESSION_SECRET?.trim();
  if (envSecret) return envSecret;
  if (cachedGuestSessionSecret) return cachedGuestSessionSecret;
  try {
    ensureDataDirectories();
    if (fs.existsSync(GUEST_SESSION_SECRET_FILE)) {
      const stored = fs.readFileSync(GUEST_SESSION_SECRET_FILE, 'utf-8').trim();
      if (stored.length >= 32) {
        cachedGuestSessionSecret = stored;
        return cachedGuestSessionSecret;
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(GUEST_SESSION_SECRET_FILE, generated, { encoding: 'utf-8', mode: 0o600 });
    cachedGuestSessionSecret = generated;
    return cachedGuestSessionSecret;
  } catch {
    cachedGuestSessionSecret = crypto.randomBytes(32).toString('hex');
    return cachedGuestSessionSecret;
  }
}

function parseCookies(req: Request): Record<string, string> {
  const rawCookie = req.headers.cookie;
  if (typeof rawCookie !== 'string' || !rawCookie) return {};
  const result: Record<string, string> = {};
  for (const part of rawCookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function extractCookieGuestSessionToken(req: Request): string | null {
  const cookies = parseCookies(req);
  const val = cookies[GUEST_SESSION_COOKIE_NAME];
  return typeof val === 'string' && val.startsWith('guest_v1.') ? val : null;
}

function isHttpsRequest(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '').toLowerCase();
  return req.secure || proto.includes('https');
}

function setGuestSessionCookie(req: Request, res: Response, token: string): void {
  const https = isHttpsRequest(req);
  const parts = [
    `${GUEST_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${GUEST_SESSION_TTL_SEC}`,
  ];
  if (https) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.append('Set-Cookie', parts.join('; '));
}

function clearGuestSessionCookie(req: Request, res: Response): void {
  const https = isHttpsRequest(req);
  const parts = [
    `${GUEST_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (https) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.append('Set-Cookie', parts.join('; '));
}

function isValidFourDigitPin(raw: unknown): raw is string {
  return typeof raw === 'string' && /^\d{4}$/.test(raw);
}

function hashGuestPin(pin: string): { pinHash: string; pinSalt: string } {
  const pinSalt = crypto.randomBytes(16).toString('hex');
  const pinHash = crypto.scryptSync(pin, pinSalt, 64).toString('hex');
  return { pinHash, pinSalt };
}

function verifyGuestPinHash(pin: string, pinHash: string, pinSalt: string): boolean {
  if (!pinHash || !pinSalt) return false;
  try {
    const derived = crypto.scryptSync(pin, pinSalt, 64);
    const stored = Buffer.from(pinHash, 'hex');
    if (derived.length !== stored.length) return false;
    return crypto.timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

interface GuestSessionTokenPayload {
  uid: string;
  email: string;
  provider: 'google';
  exp: number;
}

function issueGuestSessionToken(
  account: GuestAccountRecord,
  provider: 'google'
): string {
  const payload: GuestSessionTokenPayload = {
    uid: account.uid,
    email: account.email,
    provider,
    exp: Math.floor(Date.now() / 1000) + GUEST_SESSION_TTL_SEC,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getGuestSessionSecret())
    .update(`guest_v1.${payloadB64}`, 'utf8')
    .digest('base64url');
  return `guest_v1.${payloadB64}.${sig}`;
}

function verifyGuestSessionToken(token: string): GuestSessionTokenPayload | null {
  if (!token.startsWith('guest_v1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  try {
    const expectedSig = crypto
      .createHmac('sha256', getGuestSessionSecret())
      .update(`guest_v1.${payloadB64}`, 'utf8')
      .digest('base64url');
    const sigBuf = Buffer.from(sigB64, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = decodeBase64UrlJson<GuestSessionTokenPayload>(payloadB64);
    if (!payload || typeof payload.uid !== 'string' || typeof payload.exp !== 'number') {
      return null;
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function sanitizeGuestUser(
  account: GuestAccountRecord,
  provider: GuestUser['provider'],
  sessionToken?: string,
  badgeLookup?: UserBadgesLookup
): GuestUser {
  const likedPoemIds = Array.isArray(account.likedPoemIds) ? account.likedPoemIds : [];
  const likedRadioTrackIds = Array.isArray(account.likedRadioTrackIds)
    ? account.likedRadioTrackIds
    : [];
  const donorChatText =
    typeof account.donorChatText === 'string' && account.donorChatText.trim()
      ? account.donorChatText.trim().slice(0, 80)
      : undefined;
  const badges = badgeLookup?.get(account.uid, account.displayName);
  return {
    uid: account.uid,
    ...(account.googleUid ? { firebaseUid: account.googleUid } : {}),
    displayName: account.displayName,
    email: account.email,
    photoUrl: account.photoUrl,
    provider,
    likedPoemIds,
    likedRadioTrackIds,
    createdAt: account.createdAt,
    hasPin: Boolean(account.pinHash && account.pinSalt),
    ...(sessionToken ? { sessionToken } : {}),
    ...(badges ? { badges } : {}),
    ...(donorChatText ? { donorChatText } : {}),
  };
}

function normalizeEmailAddress(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 254) : '';
}

const hydratedGuestLikesUids = new Set<string>();
let cloudPoemLikesHydrated = false;
let pendingPoemLikesHydration: Promise<boolean> | null = null;
const cloudPoemLikesByPoemId = new Map<string, Set<string>>();
const cloudPoemLikesByUid = new Map<string, Set<string>>();

let cloudRadioLikesHydrated = false;
let pendingRadioLikesHydration: Promise<boolean> | null = null;
const cloudRadioLikesByTrackId = new Map<string, Set<string>>();
const cloudRadioLikesByUid = new Map<string, Set<string>>();

async function ensureCloudPoemLikesHydrated(): Promise<boolean> {
  if (cloudPoemLikesHydrated) return true;
  if (pendingPoemLikesHydration) return pendingPoemLikesHydration;
  pendingPoemLikesHydration = (async () => {
    try {
      const res = await hydratePoemLikesFromFirestore();
      if (!res.ok) return false;
      cloudPoemLikesByPoemId.clear();
      cloudPoemLikesByUid.clear();
      for (const [poemId, uids] of res.likesByPoemId.entries()) {
        cloudPoemLikesByPoemId.set(poemId, new Set(uids));
      }
      for (const [uid, poemIds] of res.likesByUid.entries()) {
        cloudPoemLikesByUid.set(uid, new Set(poemIds));
      }
      cloudPoemLikesHydrated = true;
      catalogRevision += 1;
      return true;
    } catch {
      return false;
    } finally {
      pendingPoemLikesHydration = null;
    }
  })();
  return pendingPoemLikesHydration;
}

async function ensureCloudRadioLikesHydrated(): Promise<boolean> {
  if (cloudRadioLikesHydrated) return true;
  if (pendingRadioLikesHydration) return pendingRadioLikesHydration;
  pendingRadioLikesHydration = (async () => {
    try {
      const res = await hydrateRadioLikesFromFirestore();
      if (!res.ok) return false;
      cloudRadioLikesByTrackId.clear();
      cloudRadioLikesByUid.clear();
      for (const [trackId, uids] of res.likesByTrackId.entries()) {
        cloudRadioLikesByTrackId.set(trackId, new Set(uids));
      }
      for (const [uid, trackIds] of res.likesByUid.entries()) {
        cloudRadioLikesByUid.set(uid, new Set(trackIds));
      }
      cloudRadioLikesHydrated = true;
      catalogRevision += 1;
      return true;
    } catch {
      return false;
    } finally {
      pendingRadioLikesHydration = null;
    }
  })();
  return pendingRadioLikesHydration;
}

function recordCloudRadioLikeState(trackId: string, firebaseUid: string, liked: boolean): void {
  if (!trackId || !firebaseUid) return;
  let trackSet = cloudRadioLikesByTrackId.get(trackId);
  let uidSet = cloudRadioLikesByUid.get(firebaseUid);
  if (liked) {
    if (!trackSet) {
      trackSet = new Set<string>();
      cloudRadioLikesByTrackId.set(trackId, trackSet);
    }
    trackSet.add(firebaseUid);
    if (!uidSet) {
      uidSet = new Set<string>();
      cloudRadioLikesByUid.set(firebaseUid, uidSet);
    }
    uidSet.add(trackId);
  } else {
    trackSet?.delete(firebaseUid);
    if (trackSet && trackSet.size === 0) cloudRadioLikesByTrackId.delete(trackId);
    uidSet?.delete(trackId);
    if (uidSet && uidSet.size === 0) cloudRadioLikesByUid.delete(firebaseUid);
  }
}

async function ensureAllPublicStateHydrated(db: SiteDatabase): Promise<boolean> {
  const needPublic = !cloudSyncState.publicHydrated;
  const needCommunity = !cloudSyncState.communityHydrated;
  const needLikes = !cloudPoemLikesHydrated;
  const needRadioLikes = !cloudRadioLikesHydrated;
  if (!needPublic && !needCommunity && !needLikes && !needRadioLikes) return false;

  const [publicRes, communityRes, likesRes, radioLikesRes] = await Promise.all([
    needPublic ? hydratePublicCatalogFromFirestore(db) : Promise.resolve(false),
    needCommunity ? hydrateCommunityStateFromFirestore(db) : Promise.resolve(false),
    needLikes ? ensureCloudPoemLikesHydrated() : Promise.resolve(false),
    needRadioLikes ? ensureCloudRadioLikesHydrated() : Promise.resolve(false),
  ]);

  const weeklyRollover = ensureWeeklyWinnersUpToDate(db);

  if (publicRes || communityRes || likesRes || radioLikesRes || weeklyRollover.changed) {
    catalogRevision += 1;
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 300 });
    return true;
  }
  return false;
}

function recordCloudPoemLikeState(poemId: string, firebaseUid: string, liked: boolean): void {
  if (!poemId || !firebaseUid) return;
  let poemSet = cloudPoemLikesByPoemId.get(poemId);
  let uidSet = cloudPoemLikesByUid.get(firebaseUid);
  if (liked) {
    if (!poemSet) {
      poemSet = new Set<string>();
      cloudPoemLikesByPoemId.set(poemId, poemSet);
    }
    poemSet.add(firebaseUid);
    if (!uidSet) {
      uidSet = new Set<string>();
      cloudPoemLikesByUid.set(firebaseUid, uidSet);
    }
    uidSet.add(poemId);
  } else {
    poemSet?.delete(firebaseUid);
    if (poemSet && poemSet.size === 0) cloudPoemLikesByPoemId.delete(poemId);
    uidSet?.delete(poemId);
    if (uidSet && uidSet.size === 0) cloudPoemLikesByUid.delete(firebaseUid);
  }
}

function syncCloudPoemLikesForUid(firebaseUid: string, likedPoemIds: string[]): void {
  if (!firebaseUid) return;
  const oldSet = cloudPoemLikesByUid.get(firebaseUid);
  if (oldSet) {
    for (const oldPoemId of oldSet) {
      const poemSet = cloudPoemLikesByPoemId.get(oldPoemId);
      poemSet?.delete(firebaseUid);
      if (poemSet && poemSet.size === 0) {
        cloudPoemLikesByPoemId.delete(oldPoemId);
      }
    }
  }
  const cleanSet = new Set(likedPoemIds.filter((id) => typeof id === 'string' && id.trim().length > 0));
  if (cleanSet.size === 0) {
    cloudPoemLikesByUid.delete(firebaseUid);
    return;
  }
  cloudPoemLikesByUid.set(firebaseUid, cleanSet);
  for (const poemId of cleanSet) {
    let poemSet = cloudPoemLikesByPoemId.get(poemId);
    if (!poemSet) {
      poemSet = new Set<string>();
      cloudPoemLikesByPoemId.set(poemId, poemSet);
    }
    poemSet.add(firebaseUid);
  }
}

function findOrCreateGoogleGuestAccount(
  db: SiteDatabase,
  claims: VerifiedFirebaseClaims
): { account: GuestAccountRecord; createdNow: boolean } {
  const email = normalizeEmailAddress(claims.email);
  const existing = db.guestAccounts.find(
    (acc) => acc.googleUid === claims.uid || (email && acc.email.toLowerCase() === email)
  );
  const resolvedName =
    (claims.name || email.split('@')[0] || 'Читач').trim().slice(0, 80) || 'Читач';
  const resolvedPhoto =
    typeof claims.picture === 'string' && claims.picture.startsWith('https://')
      ? claims.picture
      : undefined;

  if (existing) {
    let changed = false;
    const nowIso = new Date().toISOString();
    if (!existing.googleUid) {
      existing.googleUid = claims.uid;
      changed = true;
    }
    if (resolvedPhoto && existing.photoUrl !== resolvedPhoto) {
      existing.photoUrl = resolvedPhoto;
      changed = true;
    }
    if (claims.name && !existing.displayName) {
      existing.displayName = resolvedName;
      changed = true;
    }
    existing.lastSeenAt = nowIso;
    if (changed) {
      existing.updatedAt = nowIso;
    }
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 5000, slices: ['community'] });
    return { account: existing, createdNow: false };
  }

  const nowIso = new Date().toISOString();
  const created: GuestAccountRecord = {
    uid: `guest_${crypto.randomBytes(10).toString('hex')}`,
    displayName: resolvedName,
    email,
    photoUrl: resolvedPhoto,
    googleUid: claims.uid,
    likedPoemIds: [],
    totalTimeSeconds: 0,
    lastSeenAt: nowIso,
    createdAt: nowIso,
  };
  db.guestAccounts.push(created);
  saveDatabase(db, { flushDelayMs: 1000, slices: ['community'] });
  return { account: created, createdNow: true };
}

async function hydrateAccountLikesFromFirestoreIfNeeded(
  db: SiteDatabase,
  account: GuestAccountRecord,
  firebaseUid: string,
  idToken: string,
  options?: { force?: boolean }
): Promise<boolean> {
  if (!firebaseUid || !idToken) return false;
  if (!options?.force && hydratedGuestLikesUids.has(firebaseUid)) {
    return true;
  }

  await ensureCloudPoemLikesHydrated();
  const fsLikes = await hydrateGuestLikesFromFirestore(firebaseUid, idToken);
  const cloudEntryLikes = Array.from(cloudPoemLikesByUid.get(firebaseUid) || []);
  const localLikes = Array.isArray(account.likedPoemIds) ? account.likedPoemIds : [];
  const localRadioLikes = Array.isArray(account.likedRadioTrackIds)
    ? account.likedRadioTrackIds
    : [];

  let profileChanged = false;
  if (typeof fsLikes.totalTimeSeconds === 'number' && fsLikes.totalTimeSeconds > (account.totalTimeSeconds || 0)) {
    account.totalTimeSeconds = fsLikes.totalTimeSeconds;
    profileChanged = true;
  }
  if (typeof fsLikes.purchasesCount === 'number' && fsLikes.purchasesCount > (account.purchasesCount || 0)) {
    account.purchasesCount = fsLikes.purchasesCount;
    profileChanged = true;
  }
  if (fsLikes.donorChatText && !account.donorChatText) {
    account.donorChatText = fsLikes.donorChatText;
    profileChanged = true;
  }
  if (fsLikes.hasRadioLikedField) {
    const fsUpdatedMs = fsLikes.updatedAt ? Date.parse(fsLikes.updatedAt) : 0;
    const localUpdatedMs = account.likedUpdatedAt ? Date.parse(account.likedUpdatedAt) : 0;
    const shouldTakeRadio =
      (localRadioLikes.length === 0 && fsLikes.likedRadioTrackIds.length > 0) ||
      (fsLikes.likedRadioTrackIds.length > 0 && fsUpdatedMs > localUpdatedMs);
    if (shouldTakeRadio) {
      account.likedRadioTrackIds = fsLikes.likedRadioTrackIds;
      profileChanged = true;
    }
  }
  if (profileChanged) {
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 2000, slices: ['community'] });
  }

  if (fsLikes.found && fsLikes.hasLikedField) {
    const localUpdatedMs = account.likedUpdatedAt ? Date.parse(account.likedUpdatedAt) : 0;
    const fsUpdatedMs = fsLikes.updatedAt ? Date.parse(fsLikes.updatedAt) : 0;

    // Never let an empty init doc wipe existing poemLikes or local likes when local had no timestamp
    const mergedReconciled = Array.from(
      new Set([...localLikes, ...fsLikes.likedPoemIds, ...cloudEntryLikes])
    ).slice(0, 500);

    const shouldTakeFirestore =
      (fsLikes.likedPoemIds.length > 0 &&
        (!account.likedUpdatedAt ||
          (Number.isFinite(fsUpdatedMs) && Number.isFinite(localUpdatedMs) && fsUpdatedMs >= localUpdatedMs) ||
          localLikes.length === 0)) ||
      (fsLikes.likedPoemIds.length === 0 &&
        localLikes.length === 0 &&
        cloudEntryLikes.length === 0) ||
      (Boolean(account.likedUpdatedAt) &&
        Number.isFinite(fsUpdatedMs) &&
        Number.isFinite(localUpdatedMs) &&
        fsUpdatedMs > localUpdatedMs &&
        fsLikes.likedPoemIds.length >= localLikes.length);

    const nextLikes = !account.likedUpdatedAt && mergedReconciled.length > fsLikes.likedPoemIds.length
      ? mergedReconciled
      : shouldTakeFirestore
        ? fsLikes.likedPoemIds
        : mergedReconciled;

    const sameLength = localLikes.length === nextLikes.length;
    const sameValues =
      sameLength && localLikes.every((id, idx) => nextLikes[idx] === id);
    if (!sameValues) {
      account.likedPoemIds = nextLikes;
      account.likedUpdatedAt = fsLikes.updatedAt || new Date().toISOString();
      account.updatedAt = new Date().toISOString();
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 2000, slices: ['community'] });
    } else if (!account.likedUpdatedAt && fsLikes.updatedAt) {
      account.likedUpdatedAt = fsLikes.updatedAt;
    }

    syncCloudPoemLikesForUid(firebaseUid, account.likedPoemIds || []);

    const needsSyncBackToCloud =
      (account.likedPoemIds?.length || 0) > fsLikes.likedPoemIds.length ||
      (localRadioLikes.length > 0 && !fsLikes.hasRadioLikedField);

    if (needsSyncBackToCloud) {
      const synced = await syncGuestLikesToFirestore(
        {
          firebaseUid,
          email: account.email,
          displayName: account.displayName,
          likedPoemIds: account.likedPoemIds || [],
          likedRadioTrackIds: account.likedRadioTrackIds,
          photoUrl: account.photoUrl,
          guestUid: account.uid,
          totalTimeSeconds: account.totalTimeSeconds,
          purchasesCount: account.purchasesCount,
          donorChatText: account.donorChatText,
        },
        idToken
      );
      void syncUserPoemLikeEntriesToFirestore(
        { firebaseUid, likedPoemIds: account.likedPoemIds || [] },
        idToken
      );
      if (synced) hydratedGuestLikesUids.add(firebaseUid);
    } else {
      hydratedGuestLikesUids.add(firebaseUid);
      if (
        (account.likedPoemIds?.length || 0) > 0 &&
        (cloudPoemLikesByUid.get(firebaseUid)?.size || 0) < (account.likedPoemIds?.length || 0)
      ) {
        void syncUserPoemLikeEntriesToFirestore(
          { firebaseUid, likedPoemIds: account.likedPoemIds || [] },
          idToken
        );
      }
    }
    return true;
  }

  const mergedLikes = Array.from(new Set([...localLikes, ...cloudEntryLikes])).slice(0, 500);
  if (mergedLikes.length > 0 || localRadioLikes.length > 0) {
    const sameLength = localLikes.length === mergedLikes.length;
    const sameValues = sameLength && localLikes.every((id, idx) => mergedLikes[idx] === id);
    if (!sameValues) {
      account.likedPoemIds = mergedLikes;
      account.likedUpdatedAt = account.likedUpdatedAt || new Date().toISOString();
      account.updatedAt = new Date().toISOString();
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 2000, slices: ['community'] });
    }
    syncCloudPoemLikesForUid(firebaseUid, mergedLikes);
    const synced = await syncGuestLikesToFirestore(
      {
        firebaseUid,
        email: account.email,
        displayName: account.displayName,
        likedPoemIds: mergedLikes,
        likedRadioTrackIds: account.likedRadioTrackIds,
        photoUrl: account.photoUrl,
        guestUid: account.uid,
        totalTimeSeconds: account.totalTimeSeconds,
        purchasesCount: account.purchasesCount,
        donorChatText: account.donorChatText,
      },
      idToken
    );
    if (mergedLikes.length > 0) {
      void syncUserPoemLikeEntriesToFirestore({ firebaseUid, likedPoemIds: mergedLikes }, idToken);
    }
    if (synced) {
      hydratedGuestLikesUids.add(firebaseUid);
    }
    return true;
  }
  return false;
}

async function authenticateGuestTokenFast(
  token: string,
  db: SiteDatabase
): Promise<
  | {
      ok: true;
      account: GuestAccountRecord;
      provider: GuestUser['provider'];
      isAdmin: boolean;
      firebaseClaims?: VerifiedFirebaseClaims;
      firebaseIdToken?: string;
    }
  | { ok: false; status: number; error: string }
> {
  if (!token) {
    return { ok: false, status: 401, error: 'Потрібно увійти в акаунт гостя.' };
  }

  const sessionPayload = verifyGuestSessionToken(token);
  if (sessionPayload) {
    const account = db.guestAccounts.find((a) => a.uid === sessionPayload.uid);
    if (!account) {
      return { ok: false, status: 401, error: 'Акаунт не знайдено. Увійдіть повторно.' };
    }
    return {
      ok: true,
      account,
      provider: sessionPayload.provider,
      isAdmin: isAdminEmailAddress(account.email),
    };
  }

  try {
    const claims = await verifyFirebaseIdToken(token);
    if (!claims || !claims.emailVerified || !claims.email) {
      return { ok: false, status: 401, error: 'Сесія Google недійсна або закінчилась. Увійдіть знову.' };
    }
    const { account } = findOrCreateGoogleGuestAccount(db, claims);
    return {
      ok: true,
      account,
      provider: 'google',
      isAdmin: isVerifiedAdminClaims(claims),
      firebaseClaims: claims,
      firebaseIdToken: token,
    };
  } catch {
    return { ok: false, status: 401, error: 'Не вдалося перевірити авторизацію.' };
  }
}

async function authenticateGuestToken(
  token: string,
  db: SiteDatabase
): Promise<
  | {
      ok: true;
      account: GuestAccountRecord;
      provider: GuestUser['provider'];
      isAdmin: boolean;
      firebaseClaims?: VerifiedFirebaseClaims;
      firebaseIdToken?: string;
    }
  | { ok: false; status: number; error: string }
> {
  const fast = await authenticateGuestTokenFast(token, db);
  if (!fast.ok) return fast;
  if (fast.firebaseClaims && fast.firebaseIdToken) {
    await hydrateAccountLikesFromFirestoreIfNeeded(
      db,
      fast.account,
      fast.firebaseClaims.uid,
      fast.firebaseIdToken
    );
  }
  return fast;
}

async function authenticateGuestRequest(
  req: Request,
  db: SiteDatabase
): Promise<
  | {
      ok: true;
      account: GuestAccountRecord;
      provider: GuestUser['provider'];
      isAdmin: boolean;
      firebaseClaims?: VerifiedFirebaseClaims;
      firebaseIdToken?: string;
    }
  | { ok: false; status: number; error: string }
> {
  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    return authenticateGuestToken(bearerToken, db);
  }
  const cookieToken = extractCookieGuestSessionToken(req);
  if (cookieToken) {
    const isReadMethod = req.method === 'GET' || req.method === 'HEAD';
    const hasCustomHeader = Boolean(req.headers['x-requested-with']);
    if (isReadMethod || (verifySameOrigin(req) && hasCustomHeader)) {
      return authenticateGuestToken(cookieToken, db);
    }
  }
  return { ok: false, status: 401, error: 'Потрібно увійти в акаунт гостя.' };
}

async function tryAuthenticateOptionalGuest(
  req: Request,
  db: SiteDatabase
): Promise<{
  account: GuestAccountRecord;
  provider: GuestUser['provider'];
  isAdmin: boolean;
  firebaseClaims?: VerifiedFirebaseClaims;
  firebaseIdToken?: string;
} | null> {
  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    const result = await authenticateGuestToken(bearerToken, db);
    return result.ok ? result : null;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    const cookieToken = extractCookieGuestSessionToken(req);
    if (cookieToken) {
      const result = await authenticateGuestToken(cookieToken, db);
      return result.ok ? result : null;
    }
  }
  return null;
}

// Payment Vault: AES-256-GCM encryption at rest & HMAC-SHA256 integrity keys
const DEV_VAULT_KEY_FILE = path.join(DATA_DIR, '.dev-vault-key');

function getOrderVaultKey(): Buffer {
  const envSecret = process.env.PAYMENT_ENCRYPTION_KEY?.trim();
  if (process.env.NODE_ENV === 'production') {
    if (!envSecret || envSecret === 'MY_PAYMENT_ENCRYPTION_KEY' || envSecret.length < 16) {
      console.error('CRITICAL: PAYMENT_ENCRYPTION_KEY must be configured with a secure secret (>= 16 chars) in production.');
      process.exit(1);
    }
    return crypto.scryptSync(envSecret, 'dankiv-order-vault-v1', 32);
  }

  if (envSecret && envSecret !== 'MY_PAYMENT_ENCRYPTION_KEY') {
    return crypto.scryptSync(envSecret, 'dankiv-order-vault-v1', 32);
  }

  try {
    ensureDataDirectories();
    if (fs.existsSync(DEV_VAULT_KEY_FILE)) {
      const stored = fs.readFileSync(DEV_VAULT_KEY_FILE, 'utf-8').trim();
      if (stored.length >= 32) {
        return crypto.scryptSync(stored, 'dankiv-order-vault-v1', 32);
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(DEV_VAULT_KEY_FILE, generated, { encoding: 'utf-8', mode: 0o600 });
    console.warn('WARNING: PAYMENT_ENCRYPTION_KEY not set. Generated persistent development vault key in data/.dev-vault-key.');
    return crypto.scryptSync(generated, 'dankiv-order-vault-v1', 32);
  } catch {
    const generated = crypto.randomBytes(32).toString('hex');
    return crypto.scryptSync(generated, 'dankiv-order-vault-v1', 32);
  }
}

function getOrderHmacKey(): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      getOrderVaultKey(),
      Buffer.from('dankiv-hmac-salt-v1', 'utf8'),
      Buffer.from('order-integrity-v1', 'utf8'),
      32
    )
  );
}

function hashBuyerEmailLookup(email: string): string {
  return crypto
    .createHash('sha256')
    .update(`dankiv-email-lookup-v1:${email.trim().toLowerCase()}`)
    .digest('hex');
}

function maskPersonName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Гість';
  return parts
    .map((part) => (part.length <= 1 ? `${part}***` : `${part[0]}${'•'.repeat(Math.min(4, part.length - 1))}`))
    .join(' ');
}

function maskEmailAddress(email: string): string {
  const clean = email.trim().toLowerCase();
  const atIdx = clean.indexOf('@');
  if (atIdx <= 0) return '***';
  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx + 1);
  const maskedLocal = local.length <= 1 ? `${local}***` : `${local[0]}***${local.length > 3 ? local.slice(-1) : ''}`;
  return `${maskedLocal}@${domain}`;
}

interface EncryptedPiiPayload {
  buyerName: string;
  buyerEmail: string;
  shipping?: ShippingDetails;
}

function encryptOrderPii(payload: EncryptedPiiPayload, orderCode: string): EncryptedPiiEnvelope {
  const key = getOrderVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`order-pii:${orderCode}`, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'AES-256-GCM',
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ciphertext: encrypted.toString('base64url'),
  };
}

function decryptOrderPii(envelope: EncryptedPiiEnvelope, orderCode: string): EncryptedPiiPayload | null {
  try {
    const key = getOrderVaultKey();
    const iv = Buffer.from(envelope.iv, 'base64url');
    const tag = Buffer.from(envelope.tag, 'base64url');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`order-pii:${orderCode}`, 'utf8'));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted) as EncryptedPiiPayload;
  } catch {
    return null;
  }
}

function signOrderReceipt(params: {
  orderCode: string;
  transactionId: string;
  totalUah: number;
  paidAt: string;
  cardLast4?: string;
}): string {
  const canonical = `${params.orderCode}|${params.transactionId}|${params.totalUah}|${params.paidAt}|${params.cardLast4 || ''}`;
  return crypto.createHmac('sha256', getOrderHmacKey()).update(canonical, 'utf8').digest('hex');
}

function verifyOrderReceipt(order: OrderRecord): boolean {
  const sig = order.payment?.receiptSignature;
  const txId = order.payment?.transactionId;
  const paidAt = order.payment?.paidAt;
  if (!sig || !txId || !paidAt) return false;
  const expected = signOrderReceipt({
    orderCode: order.orderCode,
    transactionId: txId,
    totalUah: order.totalUah,
    paidAt,
    cardLast4: order.payment?.cardLast4,
  });
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateHighEntropyOrderCode(db: SiteDatabase): string {
  const generateChunk = (len: number) => {
    const bytes = crypto.randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) {
      out += ORDER_CODE_ALPHABET[bytes[i] % ORDER_CODE_ALPHABET.length];
    }
    return out;
  };
  let code = `AD-${generateChunk(4)}-${generateChunk(4)}`;
  while (db.orders.some((o) => o.orderCode.toLowerCase() === code.toLowerCase())) {
    code = `AD-${generateChunk(4)}-${generateChunk(4)}`;
  }
  return code;
}

function verifySameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const secFetchSite = req.headers['sec-fetch-site'];

  if (secFetchSite === 'cross-site') {
    return false;
  }

  const allowedHosts = new Set<string>();
  const rawForwarded = req.get('x-forwarded-host');
  const rawHost = req.get('host');
  if (rawForwarded) {
    for (const h of rawForwarded.split(',')) {
      const clean = h.trim().toLowerCase();
      if (clean) allowedHosts.add(clean);
    }
  }
  if (rawHost) {
    for (const h of rawHost.split(',')) {
      const clean = h.trim().toLowerCase();
      if (clean) allowedHosts.add(clean);
    }
  }
  if (process.env.APP_URL) {
    try {
      allowedHosts.add(new URL(process.env.APP_URL).host.toLowerCase());
    } catch {
      // Ignore
    }
  }

  const checkHostMatch = (targetUrlStr: string): boolean => {
    try {
      const targetHost = new URL(targetUrlStr).host.toLowerCase();
      if (allowedHosts.size === 0) return true;
      return allowedHosts.has(targetHost);
    } catch {
      return false;
    }
  };

  if (origin) {
    return checkHostMatch(origin);
  }
  if (referer) {
    return checkHostMatch(referer);
  }

  // If both Origin and Referer are absent, allow for safe GET/HEAD requests or explicit X-Requested-With
  if (req.method === 'GET' || req.method === 'HEAD' || req.headers['x-requested-with']) {
    return true;
  }
  return false;
}

function checkRateLimit(bucketKey: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  return checkPersistentRateLimit(bucketKey, maxRequests, windowMs);
}

function purgeExpiredPaymentSessions(): void {
  purgeExpiredPaymentSessionsSqlite();
}

interface DecryptedPaymentAssertion {
  sessionId: string;
  nonce: string;
  amountUah: number;
  method: 'card' | 'apple_google_pay' | 'monobank';
  cardBrand?: string;
  cardLast4?: string;
  cardFingerprint?: string;
  buyerName: string;
  buyerEmail: string;
  shipping?: Partial<ShippingDetails>;
  clientIssuedAt?: string;
}

type MonobankInvoiceStatus =
  | 'created'
  | 'processing'
  | 'hold'
  | 'success'
  | 'failure'
  | 'reversed'
  | 'expired';

let cachedMonobankPubKey: { pem: string; fetchedAtMs: number } | null = null;

function purgeExpiredMonobankInvoices(): void {
  purgeExpiredMonobankInvoicesSqlite();
}

function getServerPublicBaseUrl(req: Request): string {
  const envUrl = (process.env.APP_URL || '').trim();
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, '');
  }
  const rawHost = (req.get('x-forwarded-host') || req.get('host') || 'localhost:3000')
    .split(',')[0]
    .trim();
  const protoHeader = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  return `${protoHeader}://${rawHost}`;
}

async function getMonobankWebhookPubKey(token: string): Promise<string | null> {
  const now = Date.now();
  if (cachedMonobankPubKey && now - cachedMonobankPubKey.fetchedAtMs < 6 * 60 * 60 * 1000) {
    return cachedMonobankPubKey.pem;
  }
  const res = await fetch('https://api.monobank.ua/api/merchant/pubkey', {
    headers: { 'X-Token': token },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { key?: string };
  if (typeof data.key !== 'string' || !data.key.trim()) return null;
  const pem = Buffer.from(data.key.trim(), 'base64').toString('utf8');
  cachedMonobankPubKey = { pem, fetchedAtMs: now };
  return pem;
}

async function verifyMonobankWebhookSignature(
  rawBody: Buffer | undefined,
  xSignHeader: string | undefined,
  token: string
): Promise<boolean> {
  if (!rawBody || !xSignHeader || !token) return false;
  try {
    const pubKeyPem = await getMonobankWebhookPubKey(token);
    if (!pubKeyPem) return false;
    const signature = Buffer.from(xSignHeader.trim(), 'base64');
    return crypto.verify('sha256', rawBody, pubKeyPem, signature);
  } catch {
    return false;
  }
}

function createPendingProseOrder(
  db: SiteDatabase,
  work: RawProseWork,
  options: {
    orderCode: string;
    invoiceId: string;
    cleanName: string;
    cleanEmail: string;
    effectivePriceUah: number;
    guestUid?: string;
  }
): OrderRecord {
  const createdAt = new Date().toISOString();
  const paymentSummary: PaymentSummary = {
    status: 'pending',
    providerLabel: 'monobank Acquiring',
    method: 'monobank',
    encryptionProtocol: 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
    transactionId: options.invoiceId,
    paidAt: '',
  };

  const encryptedPii = encryptOrderPii(
    {
      buyerName: options.cleanName,
      buyerEmail: options.cleanEmail,
    },
    options.orderCode
  );

  const pendingOrder: OrderRecord = {
    orderCode: options.orderCode,
    ...(options.guestUid ? { guestUid: options.guestUid } : {}),
    buyerName: maskPersonName(options.cleanName),
    buyerEmail: maskEmailAddress(options.cleanEmail),
    buyerNameMasked: maskPersonName(options.cleanName),
    buyerEmailMasked: maskEmailAddress(options.cleanEmail),
    buyerEmailHash: hashBuyerEmailLookup(options.cleanEmail),
    encryptedPii,
    createdAt,
    totalUah: options.effectivePriceUah,
    payment: paymentSummary,
    items: [],
    pendingProseId: work.id,
  };

  db.orders.unshift(pendingOrder);
  saveDatabase(db, { flushDelayMs: 0, ordersDirty: [pendingOrder.orderCode] });
  return pendingOrder;
}

function finalizeProsePaidOrder(
  db: SiteDatabase,
  work: RawProseWork,
  options: {
    cleanName: string;
    cleanEmail: string;
    effectivePriceUah: number;
    providerLabel: string;
    transactionId: string;
    orderCode: string;
    encryptionProtocol?: string;
    guestUid?: string;
  }
): { orderCode: string; unlockedAccess: PurchasedAccess; orderRecord: OrderRecord } {
  const existing = db.orders.find((o) => o.orderCode === options.orderCode);
  if (existing && existing.payment?.status === 'paid' && existing.items.length > 0) {
    return {
      orderCode: existing.orderCode,
      unlockedAccess: existing.items[0],
      orderRecord: existing,
    };
  }

  const paidAt = new Date().toISOString();
  const orderCode = options.orderCode;
  const receiptSignature = signOrderReceipt({
    orderCode,
    transactionId: options.transactionId,
    totalUah: options.effectivePriceUah,
    paidAt,
  });

  const paymentSummary: PaymentSummary = {
    status: 'paid',
    providerLabel: options.providerLabel,
    method: 'monobank',
    encryptionProtocol: options.encryptionProtocol || 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
    receiptSignature,
    transactionId: options.transactionId,
    paidAt,
  };

  const unlockedAccess: PurchasedAccess = {
    productId: work.id,
    proseId: work.id,
    orderCode,
    title: work.title,
    type: 'prose_access',
    purchasedAt: paidAt,
    paymentTransactionId: options.transactionId,
    hasPdf: Boolean(work.pdfStorageKey),
    pdfFileName: work.pdfFileName,
    pdfFileSize: work.pdfFileSize,
  };

  let targetOrder: OrderRecord;
  if (existing) {
    existing.payment = paymentSummary;
    existing.items = [unlockedAccess];
    delete existing.pendingProseId;
    targetOrder = existing;
  } else {
    const encryptedPii = encryptOrderPii(
      {
        buyerName: options.cleanName,
        buyerEmail: options.cleanEmail,
      },
      orderCode
    );
    targetOrder = {
      orderCode,
      ...(options.guestUid ? { guestUid: options.guestUid } : {}),
      buyerName: maskPersonName(options.cleanName),
      buyerEmail: maskEmailAddress(options.cleanEmail),
      buyerNameMasked: maskPersonName(options.cleanName),
      buyerEmailMasked: maskEmailAddress(options.cleanEmail),
      buyerEmailHash: hashBuyerEmailLookup(options.cleanEmail),
      encryptedPii,
      createdAt: paidAt,
      totalUah: options.effectivePriceUah,
      payment: paymentSummary,
      items: [unlockedAccess],
    };
    db.orders.unshift(targetOrder);
  }

  const effectiveGuestUid = targetOrder.guestUid || options.guestUid;
  if (effectiveGuestUid) {
    const acc = db.guestAccounts.find((g) => g.uid === effectiveGuestUid);
    if (acc) {
      acc.purchasesCount = Math.round(Number(acc.purchasesCount) || 0) + 1;
      acc.updatedAt = paidAt;
    }
  }

  saveDatabase(db, { flushDelayMs: 0, slices: ['community'], ordersDirty: [targetOrder.orderCode] });
  return { orderCode, unlockedAccess, orderRecord: targetOrder };
}

function finalizePendingStoreOrder(
  db: SiteDatabase,
  pending: PendingMonobankStoreInvoice
): { orderRecord: OrderRecord; unlockedItems: PurchasedAccess[] } {
  const existing = db.orders.find((o) => o.orderCode === pending.orderCode);
  if (existing && existing.payment?.status === 'paid' && existing.items.length > 0) {
    return { orderRecord: existing, unlockedItems: existing.items };
  }

  const paidAt = new Date().toISOString();
  const matchedProducts = pending.productIds
    .map((id: string) => db.products.find((p: RawStoreProduct) => p.id === id))
    .filter((p: RawStoreProduct | undefined): p is RawStoreProduct => Boolean(p));

  const shippingFromEncrypted =
    existing?.encryptedPii
      ? decryptOrderPii(existing.encryptedPii, pending.orderCode)?.shipping
      : undefined;
  const resolvedShipping = pending.shipping || shippingFromEncrypted;

  const unlockedItems = matchedProducts.map((p: RawStoreProduct) =>
    buildPurchasedAccess(p, pending.orderCode, paidAt, resolvedShipping, pending.invoiceId)
  );

  const receiptSignature = signOrderReceipt({
    orderCode: pending.orderCode,
    transactionId: pending.invoiceId,
    totalUah: pending.amountUah,
    paidAt,
  });

  const paymentSummary: PaymentSummary = {
    status: 'paid',
    providerLabel: 'monobank Acquiring',
    method: 'monobank',
    encryptionProtocol: 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
    receiptSignature,
    transactionId: pending.invoiceId,
    paidAt,
  };

  let targetOrder: OrderRecord;
  if (existing) {
    existing.payment = paymentSummary;
    existing.items = unlockedItems;
    delete existing.pendingProductIds;
    targetOrder = existing;
  } else {
    const encryptedPii = encryptOrderPii(
      {
        buyerName: pending.buyerName,
        buyerEmail: pending.buyerEmail,
        shipping: resolvedShipping,
      },
      pending.orderCode
    );
    targetOrder = {
      orderCode: pending.orderCode,
      ...(pending.guestUid ? { guestUid: pending.guestUid } : {}),
      buyerName: maskPersonName(pending.buyerName),
      buyerEmail: maskEmailAddress(pending.buyerEmail),
      buyerNameMasked: maskPersonName(pending.buyerName),
      buyerEmailMasked: maskEmailAddress(pending.buyerEmail),
      buyerEmailHash: hashBuyerEmailLookup(pending.buyerEmail),
      encryptedPii,
      createdAt: paidAt,
      totalUah: pending.amountUah,
      payment: paymentSummary,
      items: unlockedItems,
    };
    db.orders.unshift(targetOrder);
  }

  const effectiveGuestUid = targetOrder.guestUid || pending.guestUid;
  if (effectiveGuestUid) {
    const acc = db.guestAccounts.find((g) => g.uid === effectiveGuestUid);
    if (acc) {
      acc.purchasesCount = Math.round(Number(acc.purchasesCount) || 0) + Math.max(1, unlockedItems.length);
      acc.updatedAt = paidAt;
    }
  }

  saveDatabase(db, { flushDelayMs: 0, slices: ['community'], ordersDirty: [targetOrder.orderCode] });
  return { orderRecord: targetOrder, unlockedItems };
}

function decryptPaymentEnvelope(
  envelope: Partial<EncryptedPaymentEnvelope> | undefined,
  expectedKind: 'store' | 'prose',
  expectedItemIds: string[],
  expectedAmountUah: number
): { ok: true; payload: DecryptedPaymentAssertion } | { ok: false; status: number; error: string } {
  if (
    !envelope ||
    typeof envelope.sessionId !== 'string' ||
    !envelope.clientPublicKeyJwk ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Відсутній криптографічний конверт оплати (ECDH + AES-256-GCM). Оновіть сторінку та спробуйте знову.',
    };
  }

  const session = paymentSessions.get(envelope.sessionId);
  if (!session) {
    return { ok: false, status: 400, error: 'Платіжну сесію не знайдено або її термін дії завершився.' };
  }
  if (session.consumed) {
    return { ok: false, status: 409, error: 'Цю платіжну сесію вже використано (захист від повторного запиту).' };
  }
  if (Date.now() > session.expiresAtMs) {
    paymentSessions.delete(session.sessionId);
    return { ok: false, status: 408, error: 'Час дії платіжної сесії вийшов. Повторіть підтвердження оплати.' };
  }
  if (session.kind !== expectedKind || session.expectedAmountUah !== expectedAmountUah) {
    return { ok: false, status: 400, error: 'Сума або тип замовлення не збігаються із захищеною сесією.' };
  }
  const expectedSet = new Set(session.expectedItemIds);
  if (expectedItemIds.length !== expectedSet.size || expectedItemIds.some((id) => !expectedSet.has(id))) {
    return { ok: false, status: 400, error: 'Склад замовлення змінився. Оновіть платіжну сесію.' };
  }

  // Consume atomically before cryptographic decryption to prevent concurrent replay
  session.consumed = true;

  try {
    const clientJwk = envelope.clientPublicKeyJwk;
    if (clientJwk.kty !== 'EC' || clientJwk.crv !== 'P-256') {
      return { ok: false, status: 400, error: 'Недійсний відкритий ключ пристрою клієнта.' };
    }
    const clientPublicKey = crypto.createPublicKey({ key: clientJwk as crypto.JsonWebKey, format: 'jwk' });
    const sharedSecret = crypto.diffieHellman({
      privateKey: session.serverPrivateKey,
      publicKey: clientPublicKey,
    });
    const derivedAesKey = Buffer.from(
      crypto.hkdfSync(
        'sha256',
        sharedSecret,
        Buffer.from(session.nonce, 'utf8'),
        Buffer.from(`dankiv-e2ee-payment-v1:${session.sessionId}`, 'utf8'),
        32
      )
    );

    const rawIv = Buffer.from(envelope.iv, 'base64url');
    const rawCiphertext = Buffer.from(envelope.ciphertext, 'base64url');
    if (rawIv.length !== 12 || rawCiphertext.length <= 16) {
      return { ok: false, status: 400, error: 'Пошкоджені зашифровані дані платежу.' };
    }

    const authTag = rawCiphertext.subarray(rawCiphertext.length - 16);
    const encData = rawCiphertext.subarray(0, rawCiphertext.length - 16);
    const aad = Buffer.from(`${session.sessionId}|${session.nonce}|${session.expectedAmountUah}`, 'utf8');

    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedAesKey, rawIv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);

    const decryptedJson = Buffer.concat([decipher.update(encData), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decryptedJson) as DecryptedPaymentAssertion;

    if (
      parsed.sessionId !== session.sessionId ||
      parsed.nonce !== session.nonce ||
      Number(parsed.amountUah) !== session.expectedAmountUah
    ) {
      return { ok: false, status: 400, error: 'Порушено цілісність платіжного підтвердження.' };
    }

    return { ok: true, payload: parsed };
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Не вдалося розшифрувати або перевірити підпис оплати. Повторіть спробу.',
    };
  }
}

function parseDecimalRating(raw: unknown): number | null {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric * 10) / 10;
  if (rounded < 0.1 || rounded > 5) return null;
  return rounded;
}

function computePoemLikesCount(poemId: string, db: SiteDatabase): number {
  const likerKeys = new Set<string>();
  const cloudUids = cloudPoemLikesByPoemId.get(poemId);
  if (cloudUids) {
    for (const uid of cloudUids) {
      likerKeys.add(`g:${uid}`);
    }
  }
  for (const acc of db.guestAccounts) {
    const hasLiked = Array.isArray(acc.likedPoemIds) && acc.likedPoemIds.includes(poemId);
    if (acc.googleUid) {
      if (hydratedGuestLikesUids.has(acc.googleUid) || acc.likedUpdatedAt) {
        if (hasLiked) {
          likerKeys.add(`g:${acc.googleUid}`);
        } else {
          likerKeys.delete(`g:${acc.googleUid}`);
        }
      } else if (hasLiked) {
        likerKeys.add(`g:${acc.googleUid}`);
      }
    } else if (hasLiked) {
      likerKeys.add(`a:${acc.uid}`);
    }
  }
  return likerKeys.size;
}

function computeRadioTrackLikesCount(trackId: string, db: SiteDatabase): number {
  const likerKeys = new Set<string>();
  const cloudUids = cloudRadioLikesByTrackId.get(trackId);
  if (cloudUids) {
    for (const uid of cloudUids) {
      likerKeys.add(`g:${uid}`);
    }
  }
  for (const acc of db.guestAccounts) {
    const hasLiked = Array.isArray(acc.likedRadioTrackIds) && acc.likedRadioTrackIds.includes(trackId);
    if (acc.googleUid) {
      if (hydratedGuestLikesUids.has(acc.googleUid) || acc.likedUpdatedAt) {
        if (hasLiked) {
          likerKeys.add(`g:${acc.googleUid}`);
        } else {
          likerKeys.delete(`g:${acc.googleUid}`);
        }
      } else if (hasLiked) {
        likerKeys.add(`g:${acc.googleUid}`);
      }
    } else if (hasLiked) {
      likerKeys.add(`a:${acc.uid}`);
    }
  }
  return likerKeys.size;
}

interface UserBadgesLookup {
  get: (uid?: string | null, displayName?: string | null) => UserTopBadges | undefined;
}

function computeLeaderboardRankings(db: SiteDatabase) {
  const accountByUid = new Map(db.guestAccounts.map((acc) => [acc.uid, acc]));
  const existingPoemIds = new Set(db.poems.map((p) => p.id));

  const activityRanked = [...db.guestAccounts]
    .filter((acc) => Boolean(acc.displayName))
    .map((acc) => {
      const commentsCount = db.reviews.reduce((sum, rev) => {
        if (!rev.comment || !rev.comment.trim()) return sum;
        const matchesAuthor =
          rev.authorUid === acc.uid || (Boolean(acc.googleUid) && rev.authorUid === acc.googleUid);
        return matchesAuthor ? sum + 1 : sum;
      }, 0);

      const likedSet = new Set<string>();
      if (Array.isArray(acc.likedPoemIds)) {
        for (const poemId of acc.likedPoemIds) {
          if (existingPoemIds.has(poemId)) likedSet.add(poemId);
        }
      }
      if (acc.googleUid) {
        const cloudLiked = cloudPoemLikesByUid.get(acc.googleUid);
        if (cloudLiked) {
          for (const poemId of cloudLiked) {
            if (existingPoemIds.has(poemId)) likedSet.add(poemId);
          }
        }
      }
      const likesCount = likedSet.size;

      const accEmailHash = acc.email ? hashBuyerEmailLookup(acc.email) : '';
      const accEmailLower = acc.email ? acc.email.trim().toLowerCase() : '';
      let ordersPurchasesCount = 0;
      for (const order of db.orders) {
        const matchesUid = Boolean(
          order.guestUid &&
            (order.guestUid === acc.uid || (acc.googleUid && order.guestUid === acc.googleUid))
        );
        const matchesHash = Boolean(accEmailHash && order.buyerEmailHash === accEmailHash);
        const matchesPlainEmail = Boolean(
          !order.encryptedPii &&
            accEmailLower &&
            order.buyerEmail?.trim().toLowerCase() === accEmailLower
        );
        if (matchesUid || matchesHash || matchesPlainEmail) {
          ordersPurchasesCount +=
            Array.isArray(order.items) && order.items.length > 0 ? order.items.length : 1;
        }
      }
      const purchasesCount = Math.max(
        ordersPurchasesCount,
        Math.round(Number(acc.purchasesCount) || 0)
      );

      const points = commentsCount + likesCount + purchasesCount;
      return {
        uid: acc.uid,
        googleUid: acc.googleUid,
        displayName: acc.displayName,
        photoUrl: acc.photoUrl,
        points,
        commentsCount,
        likesCount,
        purchasesCount,
        totalTimeSeconds: Math.round(Number(acc.totalTimeSeconds) || 0),
        createdAt: acc.createdAt,
      };
    })
    .filter((entry) => entry.points > 0)
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.purchasesCount !== a.purchasesCount) return b.purchasesCount - a.purchasesCount;
      if (b.commentsCount !== a.commentsCount) return b.commentsCount - a.commentsCount;
      if (b.likesCount !== a.likesCount) return b.likesCount - a.likesCount;
      if (b.totalTimeSeconds !== a.totalTimeSeconds) return b.totalTimeSeconds - a.totalTimeSeconds;
      return (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
    })
    .slice(0, 10)
    .map((entry, idx) => ({
      rank: idx + 1,
      uid: entry.uid,
      googleUid: entry.googleUid,
      displayName: entry.displayName,
      photoUrl: entry.photoUrl,
      points: entry.points,
      commentsCount: entry.commentsCount,
      likesCount: entry.likesCount,
      purchasesCount: entry.purchasesCount,
    }));

  const donorAgg = new Map<
    string,
    {
      id: string;
      guestUid?: string;
      googleUid?: string;
      displayName: string;
      photoUrl?: string;
      totalAmountUah: number;
      donationsCount: number;
      lastDonatedAt: string;
    }
  >();

  for (const don of db.donations) {
    const linked = don.guestUid ? accountByUid.get(don.guestUid) : undefined;
    const resolvedName = (linked?.displayName || don.displayName || '').trim();
    if (!resolvedName || don.amountUah <= 0) continue;
    const key = linked ? `uid:${linked.uid}` : `name:${resolvedName.toLowerCase()}`;
    const existing = donorAgg.get(key);
    const donatedAt = don.donatedAt || new Date().toISOString();
    const photoUrl = linked?.photoUrl || don.photoUrl;
    if (existing) {
      existing.totalAmountUah += Math.round(don.amountUah);
      existing.donationsCount += 1;
      if ((Date.parse(donatedAt) || 0) > (Date.parse(existing.lastDonatedAt) || 0)) {
        existing.lastDonatedAt = donatedAt;
      }
      if (!existing.photoUrl && photoUrl) {
        existing.photoUrl = photoUrl;
      }
    } else {
      donorAgg.set(key, {
        id: don.id,
        ...(linked ? { guestUid: linked.uid, googleUid: linked.googleUid } : don.guestUid ? { guestUid: don.guestUid } : {}),
        displayName: resolvedName,
        ...(photoUrl ? { photoUrl } : {}),
        totalAmountUah: Math.round(don.amountUah),
        donationsCount: 1,
        lastDonatedAt: donatedAt,
      });
    }
  }

  const donorsRanked = Array.from(donorAgg.values())
    .sort((a, b) => {
      if (b.totalAmountUah !== a.totalAmountUah) return b.totalAmountUah - a.totalAmountUah;
      if (b.donationsCount !== a.donationsCount) return b.donationsCount - a.donationsCount;
      return (Date.parse(a.lastDonatedAt) || 0) - (Date.parse(b.lastDonatedAt) || 0);
    })
    .slice(0, 10)
    .map((entry, idx) => ({
      rank: idx + 1,
      ...entry,
    }));

  const activityByUid = new Map<string, TopRankNumber>();
  for (const entry of activityRanked.slice(0, 5)) {
    const rank = entry.rank as TopRankNumber;
    activityByUid.set(entry.uid, rank);
    if (entry.googleUid) {
      activityByUid.set(entry.googleUid, rank);
    }
  }

  const donorByUid = new Map<string, TopRankNumber>();
  const donorByName = new Map<string, TopRankNumber>();
  for (const entry of donorsRanked.slice(0, 5)) {
    const rank = entry.rank as TopRankNumber;
    if (entry.guestUid) {
      donorByUid.set(entry.guestUid, rank);
      if (entry.googleUid) {
        donorByUid.set(entry.googleUid, rank);
      }
    } else if (entry.displayName) {
      donorByName.set(entry.displayName.trim().toLowerCase(), rank);
    }
  }

  const lookup: UserBadgesLookup = {
    get: (uid?: string | null, displayName?: string | null): UserTopBadges | undefined => {
      const cleanUid = typeof uid === 'string' ? uid.trim() : '';
      const cleanName = typeof displayName === 'string' ? displayName.trim().toLowerCase() : '';
      const activityRank = cleanUid ? activityByUid.get(cleanUid) : undefined;
      let donorRank = cleanUid ? donorByUid.get(cleanUid) : undefined;
      if (!donorRank && cleanName) {
        donorRank = donorByName.get(cleanName);
      }
      if (!activityRank && !donorRank) return undefined;
      return {
        ...(activityRank ? { activityRank } : {}),
        ...(donorRank ? { donorRank } : {}),
      };
    },
  };

  return {
    activityRanked,
    donorsRanked,
    lookup,
  };
}

let cachedLeaderboardEntry: {
  db: SiteDatabase;
  revision: number;
  expiresAtMs: number;
  result: ReturnType<typeof computeLeaderboardRankings>;
} | null = null;

function getCachedLeaderboardRankings(db: SiteDatabase) {
  const now = Date.now();
  if (
    cachedLeaderboardEntry &&
    cachedLeaderboardEntry.db === db &&
    cachedLeaderboardEntry.revision === catalogRevision &&
    cachedLeaderboardEntry.expiresAtMs > now
  ) {
    return cachedLeaderboardEntry.result;
  }
  const result = computeLeaderboardRankings(db);
  cachedLeaderboardEntry = {
    db,
    revision: catalogRevision,
    expiresAtMs: now + 3000,
    result,
  };
  return result;
}

function createBadgeLookup(db: SiteDatabase): UserBadgesLookup {
  return getCachedLeaderboardRankings(db).lookup;
}

interface AccountPhotoLookup {
  get: (uid?: string | null, displayName?: string | null) => string | undefined;
}

function createAccountPhotoLookup(db: SiteDatabase): AccountPhotoLookup {
  const byUid = new Map<string, string>();
  const namePhotoCandidates = new Map<string, Set<string>>();

  for (const acc of db.guestAccounts) {
    const cleanPhoto = typeof acc.photoUrl === 'string' ? acc.photoUrl.trim() : '';
    if (!cleanPhoto) continue;
    if (acc.uid) byUid.set(acc.uid, cleanPhoto);
    if (acc.googleUid) byUid.set(acc.googleUid, cleanPhoto);
    const cleanName = typeof acc.displayName === 'string' ? acc.displayName.trim().toLowerCase() : '';
    if (cleanName && cleanName !== 'гість' && cleanName !== 'читач') {
      let set = namePhotoCandidates.get(cleanName);
      if (!set) {
        set = new Set<string>();
        namePhotoCandidates.set(cleanName, set);
      }
      set.add(cleanPhoto);
    }
  }

  return {
    get(uid?: string | null, displayName?: string | null) {
      if (uid && byUid.has(uid)) return byUid.get(uid);
      const cleanName = typeof displayName === 'string' ? displayName.trim().toLowerCase() : '';
      if (cleanName) {
        const candidates = namePhotoCandidates.get(cleanName);
        if (candidates && candidates.size === 1) {
          return Array.from(candidates)[0];
        }
      }
      return undefined;
    },
  };
}

interface AccountDonorTextLookup {
  get: (uid?: string | null) => string | undefined;
}

function createDonorTextLookup(db: SiteDatabase): AccountDonorTextLookup {
  const byUid = new Map<string, string>();
  for (const acc of db.guestAccounts) {
    const cleanText = typeof acc.donorChatText === 'string' ? acc.donorChatText.trim().slice(0, 80) : '';
    if (!cleanText) continue;
    if (acc.uid) byUid.set(acc.uid, cleanText);
    if (acc.googleUid) byUid.set(acc.googleUid, cleanText);
  }
  return {
    get(uid?: string | null) {
      if (!uid) return undefined;
      return byUid.get(uid);
    },
  };
}

function enrichReviewWithBadges(
  review: ReviewItem,
  badgeLookup: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup
): ReviewItem {
  const authorBadges = badgeLookup.get(review.authorUid, review.authorName);
  const resolvedPhoto =
    (typeof review.authorPhotoUrl === 'string' && review.authorPhotoUrl.trim()) ||
    photoLookup?.get(review.authorUid, review.authorName) ||
    undefined;
  return {
    ...review,
    ...(resolvedPhoto ? { authorPhotoUrl: resolvedPhoto } : {}),
    ...(authorBadges ? { authorBadges } : {}),
  };
}

function enrichChatMessageWithBadges(
  msg: GlobalChatMessage,
  badgeLookup: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup,
  donorTextLookup?: AccountDonorTextLookup
): GlobalChatMessage {
  const authorBadges = badgeLookup.get(msg.authorUid, msg.authorName);
  const resolvedPhoto =
    (typeof msg.authorPhotoUrl === 'string' && msg.authorPhotoUrl.trim()) ||
    photoLookup?.get(msg.authorUid, msg.authorName) ||
    undefined;
  const isTop3Donor = Boolean(authorBadges?.donorRank && authorBadges.donorRank <= 3);
  const resolvedDonorText = isTop3Donor
    ? donorTextLookup?.get(msg.authorUid) ||
      (typeof msg.authorDonorText === 'string' ? msg.authorDonorText.trim().slice(0, 80) : undefined)
    : undefined;
  return {
    ...msg,
    ...(resolvedPhoto ? { authorPhotoUrl: resolvedPhoto } : {}),
    ...(authorBadges ? { authorBadges } : {}),
    ...(resolvedDonorText ? { authorDonorText: resolvedDonorText } : {}),
  };
}

function getEffectiveVoteKeys(
  ipHash?: string,
  account?: { uid: string; googleUid?: string } | null
): { primaryKey: string; lookupKeys: string[] } {
  const keys: string[] = [];
  if (account?.googleUid) keys.push(`u:${account.googleUid}`);
  if (account?.uid) keys.push(`u:${account.uid}`);
  if (ipHash) keys.push(ipHash);
  const lookupKeys = Array.from(new Set(keys));
  const primaryKey = account?.googleUid
    ? `u:${account.googleUid}`
    : account?.uid
      ? `u:${account.uid}`
      : ipHash || 'anon';
  return { primaryKey, lookupKeys };
}

function findUserRatingInVotes(
  votesMap: Record<string, number>,
  lookupKeys: string[]
): number | null {
  for (const key of lookupKeys) {
    if (typeof votesMap[key] === 'number') return votesMap[key];
  }
  return null;
}

function enrichPoem(
  poem: RawPoem,
  db: SiteDatabase,
  ipHash: string,
  guestAccount?: GuestAccountRecord | null,
  badgeLookup?: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup
): Poem {
  const resolvedBadges = badgeLookup ?? createBadgeLookup(db);
  const resolvedPhotos = photoLookup ?? createAccountPhotoLookup(db);
  const votesForPoem = db.poemVotes[poem.id] || {};
  const scores = Object.values(votesForPoem);
  const ratingCount = scores.length;
  const ratingAverage =
    ratingCount > 0 ? Number((scores.reduce((sum, s) => sum + s, 0) / ratingCount).toFixed(1)) : 0;
  const { lookupKeys } = getEffectiveVoteKeys(ipHash, guestAccount);
  const userRating = findUserRatingInVotes(votesForPoem, lookupKeys);
  const poemReviews = db.reviews
    .filter((r) => r.targetType === 'poem' && r.targetId === poem.id)
    .map((r) => enrichReviewWithBadges(r, resolvedBadges, resolvedPhotos));
  const likesCount = computePoemLikesCount(poem.id, db);
  const isLiked = Boolean(
    guestAccount && Array.isArray(guestAccount.likedPoemIds) && guestAccount.likedPoemIds.includes(poem.id)
  );

  return {
    ...poem,
    viewsCount: db.poemViews[poem.id] || 0,
    likesCount,
    isLiked,
    ratingAverage,
    ratingCount,
    userRating,
    reviews: poemReviews,
  };
}

function enrichBlogPost(post: RawBlogPost, db: SiteDatabase): BlogPost {
  return {
    ...post,
    viewsCount: db.blogViews[post.id] || 0,
  };
}

const CATALOG_TEXT_MAX_CHARS = 1200;
const CATALOG_TEXT_CUT_CHARS = 900;

function truncatePoemForCatalog(poem: Poem): Poem {
  if (!poem.content || poem.content.length <= CATALOG_TEXT_MAX_CHARS) {
    return poem;
  }
  const nlCut = poem.content.lastIndexOf('\n', CATALOG_TEXT_CUT_CHARS);
  const wsCut = poem.content.lastIndexOf(' ', CATALOG_TEXT_CUT_CHARS);
  const sliceEnd =
    nlCut >= 400 ? nlCut : wsCut >= 400 ? wsCut : CATALOG_TEXT_CUT_CHARS;
  return {
    ...poem,
    content: `${poem.content.slice(0, sliceEnd).trimEnd()}…`,
    contentTruncated: true,
  };
}

function truncateBlogForCatalog(post: BlogPost): BlogPost {
  if (!post.content) return post;
  const lines = post.content.split('\n');
  const directiveLines: string[] = [];
  const proseLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(':::blog-media ') && trimmed.endsWith(':::')) {
      directiveLines.push(line);
    } else {
      proseLines.push(line);
    }
  }

  const proseText = proseLines.join('\n');
  if (proseText.length <= CATALOG_TEXT_MAX_CHARS) {
    return post;
  }

  const nlCut = proseText.lastIndexOf('\n', CATALOG_TEXT_CUT_CHARS);
  const wsCut = proseText.lastIndexOf(' ', CATALOG_TEXT_CUT_CHARS);
  const sliceEnd =
    nlCut >= 400 ? nlCut : wsCut >= 400 ? wsCut : CATALOG_TEXT_CUT_CHARS;
  const truncatedProse = `${proseText.slice(0, sliceEnd).trimEnd()}…`;
  const rebuilt =
    directiveLines.length > 0
      ? `${truncatedProse}\n\n${directiveLines.join('\n')}`
      : truncatedProse;

  return {
    ...post,
    content: rebuilt,
    contentTruncated: true,
  };
}

function getProsePreviewText(content: string): string {
  const paragraphs = preserveFormattedText(content)
    .split(/\n{2,}/)
    .map((p) => preserveFormattedText(p))
    .filter(Boolean);
  if (paragraphs.length === 0) return '';
  if (paragraphs.length === 1) {
    const first = paragraphs[0];
    if (first.length <= 260) return first;
    return `${first.slice(0, 260).replace(/\s+\S*$/, '')}…`;
  }
  const previewParagraphs = paragraphs.slice(0, Math.min(2, Math.max(1, paragraphs.length - 1)));
  const joined = previewParagraphs.join('\n\n');
  if (joined.length <= 520) return joined;
  return `${joined.slice(0, 520).replace(/\s+\S*$/, '')}…`;
}

function resolveConfinedFilePath(baseDir: string, storageKey: string): string | null {
  const safeName = path.basename(storageKey);
  if (!safeName) return null;
  const resolved = path.resolve(baseDir, safeName);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep)) {
    return null;
  }
  return resolved;
}

function computeProseStats(
  workId: string,
  db: SiteDatabase,
  ipHash?: string,
  badgeLookup?: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup,
  guestAccount?: GuestAccountRecord | null
) {
  const resolvedBadges = badgeLookup ?? createBadgeLookup(db);
  const resolvedPhotos = photoLookup ?? createAccountPhotoLookup(db);
  const votesForProse = db.proseVotes[workId] || {};
  const scores = Object.values(votesForProse);
  const ratingCount = scores.length;
  const ratingAverage =
    ratingCount > 0 ? Number((scores.reduce((sum, s) => sum + s, 0) / ratingCount).toFixed(1)) : 0;
  const { lookupKeys } = getEffectiveVoteKeys(ipHash, guestAccount);
  const userRating = findUserRatingInVotes(votesForProse, lookupKeys);
  const proseReviews = db.reviews
    .filter((r) => r.targetType === 'prose' && r.targetId === workId)
    .map((r) => enrichReviewWithBadges(r, resolvedBadges, resolvedPhotos));
  return { ratingAverage, ratingCount, userRating, reviews: proseReviews };
}

function getValidProseTagIds(tagIds: string[] | undefined, db: SiteDatabase): string[] {
  if (!Array.isArray(tagIds) || tagIds.length === 0) return [];
  const validSet = new Set(db.proseTags.map((t) => t.id));
  return Array.from(new Set(tagIds.filter((id) => typeof id === 'string' && validSet.has(id))));
}

function computeProseTotalWords(work: RawProseWork): number {
  const baseWords = countProseWords(work.content);
  const chapterWords = Array.isArray(work.chapters)
    ? work.chapters.reduce((sum, ch) => sum + countProseWords(ch.content), 0)
    : 0;
  return baseWords + chapterWords;
}

function enrichProseForPublic(
  work: RawProseWork,
  db: SiteDatabase,
  ipHash: string,
  isAuthorizedUser = false,
  includeFullContent = false,
  badgeLookup?: UserBadgesLookup,
  guestAccount?: GuestAccountRecord | null,
  photoLookup?: AccountPhotoLookup
): ProseWork {
  const accessMode = resolveProseAccessMode(work);
  const isPaid = accessMode === 'paid';
  const requiresAuth = accessMode === 'authorized';
  const hasPdf = Boolean(work.pdfStorageKey);
  const { pdfStorageKey: _hiddenPdfKey, ...safeFields } = work;
  const stats = computeProseStats(work.id, db, ipHash, badgeLookup, photoLookup, guestAccount);
  const tagIds = getValidProseTagIds(work.tagIds, db);
  const rawChapters = Array.isArray(work.chapters) ? work.chapters : [];
  const totalWords = computeProseTotalWords(work);
  const computedPages = computeProseWorkPages({
    content: work.content,
    chapters: rawChapters,
    hasPdf,
    fallbackPages: work.pages,
  });

  const normalizedStatus = normalizeProseStatus(work.status);
  const canReadDirectly = accessMode === 'public' || (requiresAuth && isAuthorizedUser);

  if (canReadDirectly) {
    return {
      ...safeFields,
      content: includeFullContent ? work.content : '',
      pages: computedPages,
      chapters: includeFullContent
        ? rawChapters
        : rawChapters.map((ch) => ({
            id: ch.id,
            title: ch.title,
            publishedAt: ch.publishedAt,
            content: '',
          })),
      totalWords,
      tagIds,
      status: normalizedStatus,
      accessMode,
      requiresAuth,
      isPaid: false,
      priceUah: 0,
      hasPdf,
      isLocked: false,
      moodboardUrls: Array.isArray(work.moodboardUrls) ? work.moodboardUrls : [],
      ...stats,
    };
  }

  const previewText = work.content.trim()
    ? getProsePreviewText(work.content)
    : work.excerpt;
  return {
    id: work.id,
    title: work.title,
    genre: work.genre,
    pages: computedPages,
    publishedAt: work.publishedAt,
    slogan: work.slogan,
    excerpt: work.excerpt,
    content: '',
    chapters: rawChapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      publishedAt: ch.publishedAt,
      content: '',
    })),
    totalWords,
    tagIds,
    status: normalizedStatus,
    accessMode,
    requiresAuth,
    isPaid,
    priceUah: isPaid ? Number(work.priceUah || 0) : 0,
    previewText,
    hasPdf,
    pdfFileName: work.pdfFileName,
    pdfFileSize: work.pdfFileSize,
    isLocked: true,
    moodboardUrls: Array.isArray(work.moodboardUrls) ? work.moodboardUrls : [],
    ...(work.isCommunity ? { isCommunity: true } : {}),
    ...(work.authorUid ? { authorUid: work.authorUid } : {}),
    ...(work.authorName ? { authorName: work.authorName } : {}),
    ...(work.authorPhotoUrl ? { authorPhotoUrl: work.authorPhotoUrl } : {}),
    ...(work.submissionId ? { submissionId: work.submissionId } : {}),
    ...stats,
  };
}

function enrichProseForAuthor(work: RawProseWork, db: SiteDatabase): ProseWork {
  const rawChapters = Array.isArray(work.chapters) ? work.chapters : [];
  const hasPdf = Boolean(work.pdfStorageKey);
  const accessMode = resolveProseAccessMode(work);
  return {
    ...work,
    pages: computeProseWorkPages({
      content: work.content,
      chapters: rawChapters,
      hasPdf,
      fallbackPages: work.pages,
    }),
    chapters: rawChapters,
    totalWords: computeProseTotalWords(work),
    tagIds: getValidProseTagIds(work.tagIds, db),
    status: normalizeProseStatus(work.status),
    accessMode,
    requiresAuth: accessMode === 'authorized',
    isPaid: accessMode === 'paid',
    priceUah: accessMode === 'paid' ? Number(work.priceUah || 0) : 0,
    hasPdf,
    ...computeProseStats(work.id, db),
  };
}

function enrichProductForPublic(
  product: RawStoreProduct,
  db: SiteDatabase,
  ipHash: string,
  badgeLookup?: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup,
  guestAccount?: GuestAccountRecord | null
): StoreProduct {
  const resolvedBadges = badgeLookup ?? createBadgeLookup(db);
  const resolvedPhotos = photoLookup ?? createAccountPhotoLookup(db);
  const {
    gdocGuestUrl: _hiddenUrl,
    ebookFullText: _hiddenBook,
    ebookStorageKey: _hiddenStorageKey,
    ...publicFields
  } = product;
  const votesForProduct = db.productVotes[product.id] || {};
  const scores = Object.values(votesForProduct);
  const ratingCount = scores.length;
  const ratingAverage =
    ratingCount > 0 ? Number((scores.reduce((sum, s) => sum + s, 0) / ratingCount).toFixed(1)) : 0;
  const { lookupKeys } = getEffectiveVoteKeys(ipHash, guestAccount);
  const userRating = findUserRatingInVotes(votesForProduct, lookupKeys);
  const productReviews = db.reviews
    .filter((r) => r.targetType === 'product' && r.targetId === product.id)
    .map((r) => enrichReviewWithBadges(r, resolvedBadges, resolvedPhotos));

  return {
    ...publicFields,
    hasEbookFile: Boolean(product.ebookStorageKey || product.ebookFullText),
    ratingAverage,
    ratingCount,
    userRating,
    reviews: productReviews,
  };
}

function recordRecentRating(
  db: SiteDatabase,
  params: {
    targetType: 'poem' | 'prose' | 'product';
    targetId: string;
    rating: number;
    authorUid?: string;
    authorName?: string;
    authorPhotoUrl?: string;
  }
) {
  if (!Array.isArray(db.recentRatings)) {
    db.recentRatings = [];
  }
  const entry: ReviewItem = {
    id: `rate_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    targetType: params.targetType,
    targetId: params.targetId,
    authorUid: (params.authorUid || 'guest_voter').slice(0, 128),
    authorName: (params.authorName?.trim() || 'Читач').slice(0, 80),
    authorPhotoUrl: params.authorPhotoUrl?.trim() || undefined,
    rating: params.rating,
    comment: '',
    createdAt: new Date().toISOString(),
  };
  db.recentRatings.unshift(entry);
  if (db.recentRatings.length > 40) {
    db.recentRatings = db.recentRatings.slice(0, 40);
  }
}

function buildRecentFeedback(
  db: SiteDatabase,
  limit = 20,
  badgeLookup?: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup
): HomeFeedbackItem[] {
  const resolvedBadges = badgeLookup ?? createBadgeLookup(db);
  const resolvedPhotos = photoLookup ?? createAccountPhotoLookup(db);
  const poemTitles = new Map(db.poems.map((p) => [p.id, p.title]));
  const proseTitles = new Map(db.prose.map((p) => [p.id, p.title]));
  const productTitles = new Map(db.products.map((p) => [p.id, p.title]));

  const resolveTitle = (targetType: ReviewItem['targetType'], targetId: string): string | null => {
    if (targetType === 'poem') return poemTitles.get(targetId) ?? null;
    if (targetType === 'prose') return proseTitles.get(targetId) ?? null;
    return productTitles.get(targetId) ?? null;
  };

  const combined: HomeFeedbackItem[] = [];
  const seenIds = new Set<string>();
  const allEntries = [...(db.reviews || []), ...(db.recentRatings || [])];

  for (const item of allEntries) {
    if (!item || !item.id || seenIds.has(item.id)) continue;
    const targetTitle = resolveTitle(item.targetType, item.targetId);
    if (!targetTitle) continue;
    if (!item.comment?.trim() && typeof item.rating !== 'number') continue;
    seenIds.add(item.id);
    const authorBadges = resolvedBadges.get(item.authorUid, item.authorName);
    const resolvedPhoto =
      (typeof item.authorPhotoUrl === 'string' && item.authorPhotoUrl.trim()) ||
      resolvedPhotos.get(item.authorUid, item.authorName) ||
      undefined;
    combined.push({
      ...item,
      ...(resolvedPhoto ? { authorPhotoUrl: resolvedPhoto } : {}),
      ...(authorBadges ? { authorBadges } : {}),
      targetTitle,
    });
  }

  combined.sort((a, b) => {
    const aMs = Date.parse(a.createdAt || '') || 0;
    const bMs = Date.parse(b.createdAt || '') || 0;
    return bMs - aMs;
  });

  return combined.slice(0, limit);
}

const SOUNDCLOUD_INPUT_HOSTS = new Set([
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com',
  'on.soundcloud.com',
  'snd.sc',
]);

const SOUNDCLOUD_SHORT_HOSTS = new Set(['on.soundcloud.com', 'snd.sc']);

const SOUNDCLOUD_EMBED_HOSTS = new Set([
  'api.soundcloud.com',
  'w.soundcloud.com',
  'soundcloud.com',
  'www.soundcloud.com',
]);

function isAllowedSoundCloudArtworkHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'sndcdn.com' ||
    lower.endsWith('.sndcdn.com') ||
    lower === 'soundcloud.com' ||
    lower.endsWith('.soundcloud.com')
  );
}

function normalizeSoundCloudInputUrl(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 600) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  const host = parsed.hostname.toLowerCase();
  if (!SOUNDCLOUD_INPUT_HOSTS.has(host)) return null;
  if (!parsed.pathname || parsed.pathname === '/') return null;

  parsed.protocol = 'https:';
  if (host === 'm.soundcloud.com' || host === 'www.soundcloud.com') {
    parsed.hostname = 'soundcloud.com';
  }
  parsed.hash = '';
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (key === 'si' || key === 'ref' || key.startsWith('utm_')) {
      parsed.searchParams.delete(key);
    }
  }
  return parsed.toString();
}

async function resolveSoundCloudShortUrl(canonicalUrl: string): Promise<string> {
  let currentUrl = canonicalUrl;
  for (let hop = 0; hop < 4; hop += 1) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return canonicalUrl;
    }
    if (!SOUNDCLOUD_SHORT_HOSTS.has(parsed.hostname.toLowerCase())) {
      return currentUrl;
    }
    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(5000),
      });
      const location = response.headers.get('location');
      if (!location || response.status < 300 || response.status >= 400) {
        return currentUrl;
      }
      const nextRaw = new URL(location, currentUrl).toString();
      const validatedNext = normalizeSoundCloudInputUrl(nextRaw);
      if (!validatedNext) {
        return currentUrl;
      }
      currentUrl = validatedNext;
    } catch {
      return currentUrl;
    }
  }
  return currentUrl;
}

function deriveSoundCloudFallbackMeta(canonicalUrl: string): { title: string; artist: string } {
  try {
    const parsed = new URL(canonicalUrl);
    const segments = parsed.pathname
      .split('/')
      .map((s) => decodeURIComponent(s).trim())
      .filter(Boolean);
    const artistSlug = segments[0] || 'SoundCloud';
    const trackSlug = segments[1] && segments[1] !== 'sets' ? segments[1] : segments[segments.length - 1] || 'Трек';
    const formatSlug = (slug: string) =>
      slug
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
    return {
      artist: formatSlug(artistSlug) || 'SoundCloud',
      title: formatSlug(trackSlug) || 'Трек із SoundCloud',
    };
  } catch {
    return { artist: 'SoundCloud', title: 'Трек із SoundCloud' };
  }
}

async function resolveSoundCloudTrackMetadata(
  rawUrl: string,
  station: RadioStationId = 'indie'
): Promise<
  | { ok: true; track: RadioTrack }
  | { ok: false; error: string }
> {
  const normalized = normalizeSoundCloudInputUrl(rawUrl);
  if (!normalized) {
    return {
      ok: false,
      error: 'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/track).',
    };
  }

  const canonicalUrl = await resolveSoundCloudShortUrl(normalized);
  const fallback = deriveSoundCloudFallbackMeta(canonicalUrl);
  let title = fallback.title;
  let artist = fallback.artist;
  let artworkUrl: string | undefined;
  let embedTargetUrl = canonicalUrl;

  try {
    const oembedEndpoint = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`;
    const oembedRes = await fetch(oembedEndpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (oembedRes.ok) {
      const data = (await oembedRes.json()) as {
        title?: unknown;
        author_name?: unknown;
        thumbnail_url?: unknown;
        html?: unknown;
      };
      if (typeof data.author_name === 'string' && data.author_name.trim()) {
        artist = data.author_name.trim().slice(0, 140);
      }
      if (typeof data.title === 'string' && data.title.trim()) {
        let cleanTitle = data.title.trim();
        const suffix = ` by ${artist}`;
        if (cleanTitle.length > suffix.length && cleanTitle.toLowerCase().endsWith(suffix.toLowerCase())) {
          cleanTitle = cleanTitle.slice(0, cleanTitle.length - suffix.length).trim();
        }
        title = cleanTitle.slice(0, 200) || fallback.title;
      }
      if (typeof data.thumbnail_url === 'string' && data.thumbnail_url.trim()) {
        try {
          const thumbUrl = new URL(data.thumbnail_url.trim());
          if (
            thumbUrl.protocol === 'https:' &&
            !thumbUrl.username &&
            !thumbUrl.password &&
            isAllowedSoundCloudArtworkHost(thumbUrl.hostname)
          ) {
            artworkUrl = thumbUrl.toString();
          }
        } catch {
          // Ignore malformed thumbnail URL
        }
      }
      if (typeof data.html === 'string') {
        const srcMatch = data.html.match(/\bsrc=["'](https:\/\/w\.soundcloud\.com\/player\/\?[^"']+)["']/i);
        if (srcMatch?.[1]) {
          try {
            const playerUrl = new URL(srcMatch[1]);
            const targetParam = playerUrl.searchParams.get('url');
            if (targetParam) {
              const targetUrl = new URL(targetParam);
              if (
                targetUrl.protocol === 'https:' &&
                !targetUrl.username &&
                !targetUrl.password &&
                SOUNDCLOUD_EMBED_HOSTS.has(targetUrl.hostname.toLowerCase())
              ) {
                embedTargetUrl = targetUrl.toString();
              }
            }
          } catch {
            // Keep canonicalUrl fallback
          }
        }
      }
    }
  } catch {
    // Fallback to URL-derived metadata if oEmbed is unreachable
  }

  return {
    ok: true,
    track: {
      id: `radio_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      title,
      artist,
      soundcloudUrl: canonicalUrl,
      embedTargetUrl,
      ...(artworkUrl ? { artworkUrl } : {}),
      station,
      addedAt: new Date().toISOString(),
    },
  };
}

function sanitizePoemImageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 1000) return undefined;
  if (
    (trimmed.startsWith('/uploads/') || trimmed.startsWith('/src/assets/') || trimmed.startsWith('/assets/')) &&
    !trimmed.includes('..') &&
    !trimmed.includes('\\')
  ) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) {
      return parsed.toString().slice(0, 1000);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sanitizePoemImagePalette(raw: unknown): PoemImagePalette | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  const background = typeof obj.background === 'string' ? obj.background.trim() : '';
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!hexRe.test(background) || !hexRe.test(text)) return undefined;
  const secondaryRaw = typeof obj.secondaryBackground === 'string' ? obj.secondaryBackground.trim() : '';
  const secondaryBackground = hexRe.test(secondaryRaw) ? secondaryRaw.toUpperCase() : undefined;
  const isDark = typeof obj.isDark === 'boolean' ? obj.isDark : undefined;
  return {
    background: background.toUpperCase(),
    ...(secondaryBackground ? { secondaryBackground } : {}),
    text: text.toUpperCase(),
    ...(typeof isDark === 'boolean' ? { isDark } : {}),
  };
}

function sanitizePoemSoundCloudTrack(raw: unknown): PoemSoundCloudTrack | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const rawTitle = typeof obj.title === 'string' ? obj.title.trim().slice(0, 200) : '';
  const rawArtist = typeof obj.artist === 'string' ? obj.artist.trim().slice(0, 140) : '';
  const rawScUrl = typeof obj.soundcloudUrl === 'string' ? obj.soundcloudUrl.trim() : '';
  const rawEmbedUrl = typeof obj.embedTargetUrl === 'string' ? obj.embedTargetUrl.trim() : '';
  if (!rawTitle || !rawArtist || !rawScUrl) return undefined;

  const normalizedSc = normalizeSoundCloudInputUrl(rawScUrl);
  if (!normalizedSc || normalizedSc.length > 500) return undefined;

  let embedTargetUrl = normalizedSc;
  if (rawEmbedUrl && rawEmbedUrl.length <= 500) {
    try {
      const parsedEmbed = new URL(rawEmbedUrl);
      if (
        (parsedEmbed.protocol === 'https:' || parsedEmbed.protocol === 'http:') &&
        !parsedEmbed.username &&
        !parsedEmbed.password &&
        SOUNDCLOUD_EMBED_HOSTS.has(parsedEmbed.hostname.toLowerCase())
      ) {
        parsedEmbed.protocol = 'https:';
        embedTargetUrl = parsedEmbed.toString().slice(0, 500);
      }
    } catch {
      // Fallback to normalizedSc
    }
  }

  let artworkUrl: string | undefined;
  if (typeof obj.artworkUrl === 'string' && obj.artworkUrl.trim() && obj.artworkUrl.trim().length <= 500) {
    try {
      const parsedArt = new URL(obj.artworkUrl.trim());
      if (
        parsedArt.protocol === 'https:' &&
        !parsedArt.username &&
        !parsedArt.password &&
        isAllowedSoundCloudArtworkHost(parsedArt.hostname)
      ) {
        artworkUrl = parsedArt.toString();
      }
    } catch {
      // Ignore invalid artwork URL
    }
  }

  const rawId = typeof obj.id === 'string' ? obj.id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) : '';
  const id = rawId || `poem_sc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  return {
    id,
    title: rawTitle,
    artist: rawArtist,
    soundcloudUrl: normalizedSc,
    embedTargetUrl,
    ...(artworkUrl ? { artworkUrl } : {}),
  };
}

function sanitizePoemSoundCloudTracks(
  rawTracks: unknown,
  rawFallbackSingle?: unknown
): PoemSoundCloudTrack[] {
  const result: PoemSoundCloudTrack[] = [];
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();

  const pushCandidate = (item: unknown) => {
    if (result.length >= 10) return;
    const clean = sanitizePoemSoundCloudTrack(item);
    if (!clean) return;
    const urlKey = clean.soundcloudUrl.toLowerCase();
    if (seenUrls.has(urlKey)) return;
    let uniqueId = clean.id;
    if (seenIds.has(uniqueId)) {
      uniqueId = `${clean.id}_${result.length}`;
    }
    seenUrls.add(urlKey);
    seenIds.add(uniqueId);
    result.push({ ...clean, id: uniqueId });
  };

  if (Array.isArray(rawTracks)) {
    for (const item of rawTracks) {
      pushCandidate(item);
    }
  } else if (rawFallbackSingle !== undefined && rawFallbackSingle !== null) {
    pushCandidate(rawFallbackSingle);
  }

  return result;
}

async function resolvePoemSoundCloudTracksInput(body: {
  url?: unknown;
  urls?: unknown;
}): Promise<{ ok: true; tracks: PoemSoundCloudTrack[] } | { ok: false; error: string }> {
  const candidateInputs: string[] = [];

  if (typeof body.url === 'string' && body.url.trim()) {
    for (const part of body.url.split(/[\r\n]+/)) {
      const clean = part.trim();
      if (clean) candidateInputs.push(clean);
    }
  }
  if (Array.isArray(body.urls)) {
    for (const item of body.urls) {
      if (typeof item === 'string' && item.trim()) {
        candidateInputs.push(item.trim());
      }
    }
  }

  const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 10);
  if (uniqueInputs.length === 0) {
    return { ok: false, error: 'Вставте посилання на пісню у SoundCloud.' };
  }

  const canonicalInputs: string[] = [];
  for (const rawUrl of uniqueInputs) {
    const normalized = normalizeSoundCloudInputUrl(rawUrl);
    if (!normalized) {
      return {
        ok: false,
        error:
          'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/track або /sets/playlist).',
      };
    }
    canonicalInputs.push(await resolveSoundCloudShortUrl(normalized));
  }

  const resolvedQueue: Array<{
    title: string;
    artist: string;
    soundcloudUrl: string;
    embedTargetUrl?: string;
    artworkUrl?: string;
  }> = [];
  const singleUrls: string[] = [];

  for (const canonical of canonicalInputs) {
    if (isSoundCloudPlaylistUrl(canonical)) {
      const remaining = Math.max(1, 10 - resolvedQueue.length);
      const playlistRes = await resolveSoundCloudPlaylistTracks(canonical, 'indie', remaining);
      if (!playlistRes.ok) {
        return { ok: false, error: playlistRes.error };
      }
      resolvedQueue.push(...playlistRes.tracks);
    } else {
      singleUrls.push(canonical);
    }
  }

  for (let i = 0; i < singleUrls.length; i += 6) {
    const batch = singleUrls.slice(i, i + 6);
    const batchResults = await Promise.all(
      batch.map((trackUrl) => resolveSoundCloudTrackMetadata(trackUrl, 'indie'))
    );
    for (const result of batchResults) {
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      resolvedQueue.push(result.track);
    }
  }

  const tracks: PoemSoundCloudTrack[] = [];
  const seenUrls = new Set<string>();
  const nowBase = Date.now();
  for (const resolved of resolvedQueue) {
    const key = resolved.soundcloudUrl.toLowerCase();
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    if (tracks.length >= 10) break;
    tracks.push({
      id: `poem_sc_${nowBase}_${tracks.length}_${crypto.randomBytes(3).toString('hex')}`,
      title: resolved.title,
      artist: resolved.artist,
      soundcloudUrl: resolved.soundcloudUrl,
      embedTargetUrl: resolved.embedTargetUrl || resolved.soundcloudUrl,
      ...(resolved.artworkUrl ? { artworkUrl: resolved.artworkUrl } : {}),
    });
  }

  if (tracks.length === 0) {
    return { ok: false, error: 'Не вдалося знайти треки за цим посиланням.' };
  }

  return { ok: true, tracks };
}

function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.startsWith('::ffff:')) {
    return isPrivateOrReservedIp(normalized.slice(7));
  }
  const version = net.isIP(normalized);
  if (version === 4) {
    const parts = normalized.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }
    return false;
  }
  return true;
}

async function validateExternalImageUrlForProxy(rawUrl: string): Promise<{ url: URL; pinIp: string } | null> {
  if (!rawUrl || rawUrl.length > 1000) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') return null;

  const hostname = parsed.hostname.toLowerCase();
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return null;
  }

  let resolvedIp = '';
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) return null;
    resolvedIp = hostname;
  } else {
    try {
      const records = await dns.lookup(hostname, { all: true, verbatim: true });
      if (!records || records.length === 0) return null;
      for (const rec of records) {
        if (isPrivateOrReservedIp(rec.address)) return null;
      }
      resolvedIp = records[0].address;
    } catch {
      return null;
    }
  }

  return { url: parsed, pinIp: resolvedIp };
}

function fetchPinnedImageUrl(
  targetUrl: URL,
  pinnedIp: string,
  maxBytes = 5 * 1024 * 1024
): Promise<{ status: number; headers: Map<string, string>; buffer: Buffer } | null> {
  return new Promise((resolve) => {
    const lib = targetUrl.protocol === 'https:' ? https : http;
    const req = lib.request(
      targetUrl,
      {
        method: 'GET',
        headers: {
          Accept: 'image/jpeg,image/png,image/webp,image/gif,image/avif,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; LiteraryImagePalette/1.0)',
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, pinnedIp, net.isIP(pinnedIp));
        },
        timeout: 7000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve({
            status: res.statusCode,
            headers: new Map([['location', res.headers.location]]),
            buffer: Buffer.alloc(0),
          });
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        let totalLen = 0;
        res.on('data', (chunk: Buffer) => {
          totalLen += chunk.length;
          if (totalLen > maxBytes) {
            req.destroy();
            resolve(null);
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const headersMap = new Map<string, string>();
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') headersMap.set(k.toLowerCase(), v);
          }
          resolve({ status: res.statusCode || 200, headers: headersMap, buffer: Buffer.concat(chunks) });
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

const SOUNDCLOUD_BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

let cachedSoundCloudClientId: string | null = null;
let cachedSoundCloudClientIdAt = 0;
const SOUNDCLOUD_CLIENT_ID_TTL_MS = 6 * 60 * 60 * 1000;

function isSoundCloudPlaylistUrl(canonicalUrl: string): boolean {
  try {
    const parsed = new URL(canonicalUrl);
    return /^\/[^/]+\/sets\/[^/]+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizeSoundCloudPlaylistPageUrl(canonicalUrl: string): string {
  try {
    const parsed = new URL(canonicalUrl);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return canonicalUrl;
  }
}

function upgradeSoundCloudArtworkUrl(rawUrl: unknown): string | undefined {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return undefined;
  try {
    const parsed = new URL(rawUrl.trim());
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      !isAllowedSoundCloudArtworkHost(parsed.hostname)
    ) {
      return undefined;
    }
    const upgraded = parsed.toString().replace(/-large\.(jpg|jpeg|png|webp)(\?.*)?$/i, '-t500x500.$1$2');
    return upgraded.slice(0, 500);
  } catch {
    return undefined;
  }
}

function extractSoundCloudHydrationArray(html: string): Array<{ hydratable?: string; data?: unknown }> {
  const match = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
  if (!match?.[1]) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getSoundCloudClientId(forceRefresh = false, htmlHint?: string): Promise<string | null> {
  if (
    !forceRefresh &&
    cachedSoundCloudClientId &&
    Date.now() - cachedSoundCloudClientIdAt < SOUNDCLOUD_CLIENT_ID_TTL_MS
  ) {
    return cachedSoundCloudClientId;
  }

  let html = htmlHint || '';
  if (!html) {
    try {
      const homeRes = await fetch('https://soundcloud.com/', {
        headers: SOUNDCLOUD_BROWSER_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (homeRes.ok) {
        html = await homeRes.text();
      }
    } catch {
      return cachedSoundCloudClientId;
    }
  }

  const scriptUrls = Array.from(
    new Set(
      Array.from(html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"'\s<>]+\.js/g)).map((m) => m[0])
    )
  );

  for (const scriptUrl of scriptUrls.slice(-5).reverse()) {
    try {
      const jsRes = await fetch(scriptUrl, {
        headers: { 'User-Agent': SOUNDCLOUD_BROWSER_HEADERS['User-Agent'] },
        signal: AbortSignal.timeout(7000),
      });
      if (!jsRes.ok) continue;
      const js = await jsRes.text();
      const cidMatch =
        js.match(/client_id\s*:\s*['"]([a-zA-Z0-9]{20,40})['"]/) ||
        js.match(/client_id=([a-zA-Z0-9]{20,40})/);
      if (cidMatch?.[1]) {
        cachedSoundCloudClientId = cidMatch[1];
        cachedSoundCloudClientIdAt = Date.now();
        return cachedSoundCloudClientId;
      }
    } catch {
      // Try next script bundle
    }
  }

  return cachedSoundCloudClientId;
}

interface SoundCloudApiTrackShape {
  id?: unknown;
  title?: unknown;
  permalink_url?: unknown;
  uri?: unknown;
  secret_token?: unknown;
  artwork_url?: unknown;
  user?: { username?: unknown; avatar_url?: unknown } | null;
  publisher_metadata?: { artist?: unknown } | null;
}

function buildRadioTrackFromApiTrack(
  raw: SoundCloudApiTrackShape,
  station: RadioStationId
): RadioTrack | null {
  const numericId =
    typeof raw.id === 'number' && Number.isInteger(raw.id) && raw.id > 0 ? raw.id : null;
  const permalink =
    typeof raw.permalink_url === 'string' && normalizeSoundCloudInputUrl(raw.permalink_url)
      ? normalizeSoundCloudInputUrl(raw.permalink_url)!
      : null;

  const fallbackApiUrl = numericId ? `https://api.soundcloud.com/tracks/${numericId}` : null;
  const soundcloudUrl = permalink || fallbackApiUrl;
  if (!soundcloudUrl) return null;

  const rawTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!rawTitle) return null;

  const secretToken =
    typeof raw.secret_token === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(raw.secret_token.trim())
      ? raw.secret_token.trim()
      : null;

  let embedTargetUrl = fallbackApiUrl || soundcloudUrl;
  if (typeof raw.uri === 'string' && /^https:\/\/api\.soundcloud\.com\/tracks\/\d+/.test(raw.uri.trim())) {
    embedTargetUrl = raw.uri.trim();
  }
  if (secretToken && embedTargetUrl.startsWith('https://api.soundcloud.com/') && !embedTargetUrl.includes('secret_token=')) {
    embedTargetUrl = `${embedTargetUrl}?secret_token=${encodeURIComponent(secretToken)}`;
  }

  const rawArtist =
    (typeof raw.user?.username === 'string' && raw.user.username.trim()) ||
    (typeof raw.publisher_metadata?.artist === 'string' && raw.publisher_metadata.artist.trim()) ||
    'SoundCloud';

  const artworkUrl =
    upgradeSoundCloudArtworkUrl(raw.artwork_url) || upgradeSoundCloudArtworkUrl(raw.user?.avatar_url);

  return {
    id: `radio_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    title: rawTitle.slice(0, 200),
    artist: rawArtist.slice(0, 140),
    soundcloudUrl,
    embedTargetUrl,
    ...(artworkUrl ? { artworkUrl } : {}),
    station,
    addedAt: new Date().toISOString(),
  };
}

async function resolveSoundCloudPlaylistTracks(
  rawPlaylistUrl: string,
  station: RadioStationId = 'indie',
  maxTracks = 100
): Promise<
  | {
      ok: true;
      playlistTitle: string;
      soundcloudUrl: string;
      tracks: RadioTrack[];
      totalFound: number;
    }
  | { ok: false; error: string }
> {
  const normalized = normalizeSoundCloudInputUrl(rawPlaylistUrl);
  if (!normalized) {
    return {
      ok: false,
      error: 'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/sets/playlist).',
    };
  }

  const resolvedShort = await resolveSoundCloudShortUrl(normalized);
  const canonicalUrl = normalizeSoundCloudPlaylistPageUrl(resolvedShort);

  let html = '';
  try {
    const pageRes = await fetch(canonicalUrl, {
      headers: SOUNDCLOUD_BROWSER_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (pageRes.ok) {
      html = await pageRes.text();
    }
  } catch {
    // Fallback to resolve endpoint below
  }

  const hydration = html ? extractSoundCloudHydrationArray(html) : [];
  let playlistObj = hydration.find((item) => item.hydratable === 'playlist')?.data as
    | { title?: unknown; tracks?: SoundCloudApiTrackShape[] }
    | undefined;

  let clientId = await getSoundCloudClientId(false, html);

  if (!playlistObj || !Array.isArray(playlistObj.tracks) || playlistObj.tracks.length === 0) {
    if (clientId) {
      const fetchResolve = async (cid: string) =>
        fetch(`https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(canonicalUrl)}&client_id=${encodeURIComponent(cid)}`, {
          headers: { 'User-Agent': SOUNDCLOUD_BROWSER_HEADERS['User-Agent'], Accept: 'application/json' },
          signal: AbortSignal.timeout(9000),
        });
      try {
        let resolveRes = await fetchResolve(clientId);
        if (resolveRes.status === 401 || resolveRes.status === 403) {
          const refreshed = await getSoundCloudClientId(true, html);
          if (refreshed) {
            clientId = refreshed;
            resolveRes = await fetchResolve(refreshed);
          }
        }
        if (resolveRes.ok) {
          const resolvedJson = (await resolveRes.json()) as {
            kind?: unknown;
            title?: unknown;
            tracks?: SoundCloudApiTrackShape[];
          };
          if (resolvedJson.kind === 'playlist' && Array.isArray(resolvedJson.tracks)) {
            playlistObj = resolvedJson;
          }
        }
      } catch {
        // Handle below
      }
    }
  }

  if (!playlistObj || !Array.isArray(playlistObj.tracks) || playlistObj.tracks.length === 0) {
    return {
      ok: false,
      error:
        'Не вдалося витягти треки з цього плейлиста SoundCloud. Перевірте, що посилання веде на відкритий плейлист (/sets/...).',
    };
  }

  const playlistTitle =
    typeof playlistObj.title === 'string' && playlistObj.title.trim()
      ? playlistObj.title.trim().slice(0, 160)
      : 'Плейлист SoundCloud';

  const rawEntries = playlistObj.tracks.slice(0, Math.max(1, maxTracks));
  const stubIds: number[] = [];
  for (const entry of rawEntries) {
    const idNum = typeof entry?.id === 'number' && Number.isInteger(entry.id) ? entry.id : null;
    const hasMeta =
      typeof entry?.title === 'string' &&
      entry.title.trim().length > 0 &&
      typeof entry?.permalink_url === 'string' &&
      entry.permalink_url.trim().length > 0;
    if (!hasMeta && idNum && idNum > 0) {
      stubIds.push(idNum);
    }
  }

  const hydratedById = new Map<number, SoundCloudApiTrackShape>();
  if (stubIds.length > 0) {
    if (!clientId) {
      clientId = await getSoundCloudClientId(true, html);
    }
    if (clientId) {
      for (let i = 0; i < stubIds.length; i += 50) {
        const chunk = stubIds.slice(i, i + 50);
        const fetchBatch = async (cid: string) =>
          fetch(
            `https://api-v2.soundcloud.com/tracks?ids=${chunk.join(',')}&client_id=${encodeURIComponent(cid)}`,
            {
              headers: { 'User-Agent': SOUNDCLOUD_BROWSER_HEADERS['User-Agent'], Accept: 'application/json' },
              signal: AbortSignal.timeout(9000),
            }
          );
        try {
          let batchRes = await fetchBatch(clientId);
          if (batchRes.status === 401 || batchRes.status === 403) {
            const refreshed = await getSoundCloudClientId(true, html);
            if (refreshed) {
              clientId = refreshed;
              batchRes = await fetchBatch(refreshed);
            }
          }
          if (batchRes.ok) {
            const items = (await batchRes.json()) as SoundCloudApiTrackShape[];
            if (Array.isArray(items)) {
              for (const item of items) {
                if (typeof item?.id === 'number') {
                  hydratedById.set(item.id, item);
                }
              }
            }
          }
        } catch {
          // Fallback per-track below if needed
        }
      }
    }
  }

  const tracks: RadioTrack[] = [];
  const seenUrls = new Set<string>();

  for (const entry of rawEntries) {
    const idNum = typeof entry?.id === 'number' && Number.isInteger(entry.id) ? entry.id : null;
    const merged: SoundCloudApiTrackShape =
      idNum && hydratedById.has(idNum)
        ? { ...entry, ...hydratedById.get(idNum) }
        : entry;

    let built = buildRadioTrackFromApiTrack(merged, station);

    // Fallback to SoundCloud oEmbed on api.soundcloud.com/tracks/<id> if api-v2 did not return metadata
    if (!built && idNum) {
      const apiTrackUrl = `https://api.soundcloud.com/tracks/${idNum}`;
      try {
        const oeRes = await fetch(
          `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(apiTrackUrl)}`,
          { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) }
        );
        if (oeRes.ok) {
          const oe = (await oeRes.json()) as {
            title?: unknown;
            author_name?: unknown;
            thumbnail_url?: unknown;
          };
          const artist =
            typeof oe.author_name === 'string' && oe.author_name.trim()
              ? oe.author_name.trim().slice(0, 140)
              : 'SoundCloud';
          let title = typeof oe.title === 'string' ? oe.title.trim() : '';
          const suffix = ` by ${artist}`;
          if (title.length > suffix.length && title.toLowerCase().endsWith(suffix.toLowerCase())) {
            title = title.slice(0, title.length - suffix.length).trim();
          }
          if (title) {
            const artworkUrl = upgradeSoundCloudArtworkUrl(oe.thumbnail_url);
            built = {
              id: `radio_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
              title: title.slice(0, 200),
              artist,
              soundcloudUrl: apiTrackUrl,
              embedTargetUrl: apiTrackUrl,
              ...(artworkUrl ? { artworkUrl } : {}),
              station,
              addedAt: new Date().toISOString(),
            };
          }
        }
      } catch {
        // Skip inaccessible private track
      }
    }

    if (!built) continue;
    const dedupKey = built.soundcloudUrl.toLowerCase();
    if (seenUrls.has(dedupKey)) continue;
    seenUrls.add(dedupKey);
    tracks.push(built);
  }

  if (tracks.length === 0) {
    return {
      ok: false,
      error: 'У цьому плейлисті не знайдено жодного доступного для відтворення треку.',
    };
  }

  return {
    ok: true,
    playlistTitle,
    soundcloudUrl: canonicalUrl,
    tracks,
    totalFound: playlistObj.tracks.length,
  };
}

function enrichRadioTrackForPublic(
  track: RadioTrack,
  isAuthorized: boolean,
  db?: SiteDatabase,
  guestAccount?: GuestAccountRecord | null,
  repertoireBucket?: RadioRepertoireBucket | null
): RadioTrack {
  const normalizedStation: RadioStationId =
    track.station === 'electronic' ? 'electronic' : 'indie';
  const likesCount = db ? computeRadioTrackLikesCount(track.id, db) : (track.likesCount ?? 0);
  const isLiked = Boolean(
    isAuthorized &&
      guestAccount &&
      Array.isArray(guestAccount.likedRadioTrackIds) &&
      guestAccount.likedRadioTrackIds.includes(track.id)
  );
  const resolvedBucket = repertoireBucket ?? track.repertoireBucket ?? null;
  const resolvedInRepertoire =
    repertoireBucket !== undefined
      ? repertoireBucket !== null
      : track.inRepertoire ?? true;

  if (isAuthorized) {
    return {
      ...track,
      station: normalizedStation,
      embedTargetUrl: track.embedTargetUrl || track.soundcloudUrl,
      likesCount,
      isLiked,
      inRepertoire: resolvedInRepertoire,
      repertoireBucket: resolvedBucket,
    };
  }
  const { embedTargetUrl: _hiddenEmbed, ...publicTrack } = track;
  return {
    ...publicTrack,
    station: normalizedStation,
    likesCount,
    isLiked: false,
    inRepertoire: resolvedInRepertoire,
    repertoireBucket: resolvedBucket,
  };
}

function buildRadioTracksWithRepertoire(
  db: SiteDatabase,
  isAuthorized: boolean,
  guestAccount?: GuestAccountRecord | null
): RadioTrack[] {
  const baseEnriched = db.radioTracks.map((track) =>
    enrichRadioTrackForPublic(track, isAuthorized, db, guestAccount)
  );
  const indieRep = selectRadioStationRepertoire(baseEnriched, 'indie');
  const electronicRep = selectRadioStationRepertoire(baseEnriched, 'electronic');
  return baseEnriched.map((track) => {
    const rep = track.station === 'electronic' ? electronicRep : indieRep;
    const bucket = rep.bucketById.get(track.id) ?? null;
    return {
      ...track,
      inRepertoire: bucket !== null,
      repertoireBucket: bucket,
    };
  });
}

function buildPurchasedAccess(
  product: RawStoreProduct,
  orderCode: string,
  createdAt: string,
  shipping?: ShippingDetails,
  paymentTransactionId?: string
): PurchasedAccess {
  if (product.type === 'wip_gdoc') {
    return {
      productId: product.id,
      orderCode,
      title: product.title,
      type: product.type,
      purchasedAt: createdAt,
      gdocGuestUrl: product.gdocGuestUrl,
      progressLabel: product.progressLabel,
      paymentTransactionId,
    };
  }
  if (isPhysicalProduct(product.type)) {
    const carrierLabel =
      shipping?.carrier === 'nova_poshta'
        ? 'Нова Пошта'
        : shipping?.carrier === 'ukrposhta'
          ? 'Укрпошта'
          : 'Кур’єрська доставка';
    // Privacy-by-design: never expose recipient full name, phone, or street address in client/restore tokens
    const shippingSummary = shipping ? `Доставку оформлено · ${carrierLabel}` : 'Фізичне відправлення';
    return {
      productId: product.id,
      orderCode,
      title: product.title,
      type: product.type,
      purchasedAt: createdAt,
      shippingSummary,
      paymentTransactionId,
    };
  }
  return {
    productId: product.id,
    orderCode,
    title: product.title,
    type: product.type,
    purchasedAt: createdAt,
    downloadUrl: `/api/ebooks/${encodeURIComponent(product.id)}/download?order=${encodeURIComponent(orderCode)}`,
    ebookFileName: product.ebookFileName,
    ebookFileSize: product.ebookFileSize,
    formats: product.formats,
    paymentTransactionId,
  };
}

const ALLOWED_EBOOK_EXTS = new Set([
  '.epub',
  '.pdf',
  '.fb2',
  '.mobi',
  '.azw3',
  '.txt',
  '.rtf',
  '.docx',
  '.zip',
]);

async function startServer() {
  const app = express();
  const portArgIndex = process.argv.indexOf('--port');
  const cliPort = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : NaN;
  const PORT = (Number.isFinite(cliPort) && cliPort > 0 ? cliPort : 0) || Number(process.env.PORT) || 3000;

  const initialDb = ensureDatabase();
  void hydratePublicCatalogFromFirestore(initialDb)
    .then((hydrated) => {
      if (hydrated) {
        saveDatabase(initialDb);
      }
    })
    .catch((err) => {
      console.error('Initial catalog hydration error:', err);
    });
  void ensureCloudPoemLikesHydrated().catch((err) => {
    console.error('Initial poem likes hydration error:', err);
  });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(compression({ threshold: 512 }));

  const createEndpointRateLimiter = (
    prefix: string,
    limit: number,
    windowMs: number,
    errorMessage: string
  ) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      store: createPersistentRateLimitStore(prefix),
      keyGenerator: (req) => {
        const normalized = ipKeyGenerator(getNormalizedClientIp(req));
        return crypto.createHash('sha256').update(normalized).digest('hex');
      },
      validate: {
        keyGeneratorIpFallback: false,
      },
      handler: (_req, res) => {
        res.status(429).json({ error: errorMessage });
      },
    });

  const paySessionLimiter = createEndpointRateLimiter(
    'erl:pay-session',
    25,
    5 * 60 * 1000,
    'Забагато запитів на оплату. Зачекайте кілька секунд.'
  );
  const ordersCreateLimiter = createEndpointRateLimiter(
    'erl:orders-create',
    12,
    10 * 60 * 1000,
    'Перевищено ліміт спроб оплати. Спробуйте через кілька хвилин.'
  );
  const ordersStatusLimiter = createEndpointRateLimiter(
    'erl:orders-status',
    120,
    5 * 60 * 1000,
    'Забагато перевірок статусу оплати. Зачекайте кілька секунд.'
  );
  const ordersRestoreLimiter = createEndpointRateLimiter(
    'erl:orders-restore',
    10,
    10 * 60 * 1000,
    'Забагато спроб відновлення. Зачекайте кілька хвилин.'
  );
  const prosePurchaseLimiter = createEndpointRateLimiter(
    'erl:prose-purchase',
    12,
    10 * 60 * 1000,
    'Забагато спроб оплати. Спробуйте трохи пізніше.'
  );
  const proseStatusLimiter = createEndpointRateLimiter(
    'erl:prose-status',
    120,
    5 * 60 * 1000,
    'Забагато перевірок статусу оплати. Зачекайте кілька секунд.'
  );
  const pinSetLimiter = createEndpointRateLimiter(
    'erl:pin-set',
    15,
    10 * 60 * 1000,
    'Забагато спроб зміни ПІН-коду. Спробуйте трохи пізніше.'
  );
  const pinLoginLimiter = createEndpointRateLimiter(
    'erl:pin-login',
    20,
    10 * 60 * 1000,
    'Забагато спроб входу за ПІН-кодом. Зачекайте кілька хвилин або увійдіть через Google.'
  );
  const uploadsLimiter = createEndpointRateLimiter(
    'erl:uploads',
    20,
    10 * 60 * 1000,
    'Забагато завантажень фото. Зачекайте кілька хвилин.'
  );
  const reviewsPostLimiter = createEndpointRateLimiter(
    'erl:reviews-post',
    25,
    10 * 60 * 1000,
    'Забагато відгуків поспіль. Спробуйте через кілька хвилин.'
  );
  const feedbackPostLimiter = createEndpointRateLimiter(
    'erl:feedback-post',
    15,
    10 * 60 * 1000,
    'Забагато звернень поспіль. Спробуйте через кілька хвилин.'
  );
  const ebookDownloadLimiter = createEndpointRateLimiter(
    'erl:ebook-download',
    40,
    10 * 60 * 1000,
    'Забагато спроб завантаження. Зачекайте кілька хвилин.'
  );

  // Strict security headers & no-store caching for payment, auth, and protected routes
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'interest-cohort=()');
    if (
      req.path.startsWith('/api/payments') ||
      req.path.startsWith('/api/orders') ||
      req.path.startsWith('/api/author') ||
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/api/guest') ||
      req.path.startsWith('/api/chat') ||
      req.path.startsWith('/api/leaderboard') ||
      req.path.startsWith('/api/users') ||
      req.path.startsWith('/api/poems/my-submissions') ||
      req.path.startsWith('/api/poems/submissions') ||
      /^\/api\/prose\/[^/]+\/(read|pdf|purchase)$/.test(req.path) ||
      /^\/api\/ebooks\/[^/]+\/download$/.test(req.path)
    ) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  });

  // Check current user's verified role (never exposes admin privileges without valid Firebase token)
  app.get('/api/auth/role', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.json({ isAdmin: false, role: 'guest', email: null });
      return;
    }
    try {
      const claims = await verifyFirebaseIdToken(token);
      const isAdmin = isVerifiedAdminClaims(claims);
      if (isAdmin && claims?.uid) {
        const db = ensureDatabase();
        const hadPublic = await hydratePublicCatalogFromFirestore(db);
        const hadSecrets = await hydrateAdminSecretsFromFirestore(db, token, {
          onTelegramBotToken: applyCloudTelegramBotToken,
        });
        if (hadPublic || hadSecrets) {
          saveDatabase(db);
        }
        if (!cloudSyncState.cloudConfigExists) {
          queueDatabaseSyncToFirestore(structuredClone(db), token, claims.uid);
        }
      }
      res.json({
        isAdmin,
        role: isAdmin ? 'admin' : 'guest',
        email: claims?.email || null,
      });
    } catch {
      res.json({ isAdmin: false, role: 'guest', email: null });
    }
  });

  // Strict Admin-only guard for ALL /api/author/* endpoints (evaluated before body parsing)
  app.use('/api/author', async (req, res, next) => {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }
    const token = extractBearerToken(req) || '';
    const db = ensureDatabase();
    if (!cloudSyncState.publicHydrated) {
      const hadPublic = await hydratePublicCatalogFromFirestore(db);
      if (hadPublic) saveDatabase(db);
    }
    if (!cloudSyncState.adminSecretsHydrated && token) {
      const hadSecrets = await hydrateAdminSecretsFromFirestore(db, token, {
        onTelegramBotToken: applyCloudTelegramBotToken,
      });
      if (hadSecrets) saveDatabase(db);
    }

    const revBefore = catalogRevision;
    res.on('finish', () => {
      if (
        req.method !== 'GET' &&
        req.method !== 'HEAD' &&
        res.statusCode < 400 &&
        token &&
        (catalogRevision !== revBefore || !cloudSyncState.cloudConfigExists)
      ) {
        queueDatabaseSyncToFirestore(structuredClone(ensureDatabase()), token, authResult.claims.uid);
      }
    });
    next();
  });

  // Raw binary upload for e-book files into database storage (up to 40 MB)
  app.post(
    '/api/author/upload-ebook',
    express.raw({ type: '*/*', limit: '40mb' }),
    (req, res) => {
      const db = ensureDatabase();
      const rawNameHeader = req.headers['x-file-name'];
      const rawMimeHeader = req.headers['x-file-type'];
      const productIdHeader = req.headers['x-product-id'];

      const decodedName =
        typeof rawNameHeader === 'string' && rawNameHeader.trim()
          ? decodeURIComponent(rawNameHeader).replace(/[/\\?%*:|"<>]/g, '_')
          : 'ebook.epub';
      const ext = path.extname(decodedName).toLowerCase();
      if (!ALLOWED_EBOOK_EXTS.has(ext)) {
        res.status(400).json({
          error: 'Підтримуються формати: EPUB, PDF, FB2, MOBI, AZW3, TXT, RTF, DOCX або ZIP.',
        });
        return;
      }

      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      if (buffer.byteLength === 0) {
        res.status(400).json({ error: 'Файл електронної книги порожній.' });
        return;
      }

      const storageKey = `ebook-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(EBOOKS_DIR, storageKey), buffer);

      const mimeType =
        typeof rawMimeHeader === 'string' && rawMimeHeader.trim()
          ? rawMimeHeader.trim()
          : 'application/octet-stream';
      const fileSize = buffer.byteLength;

      let updatedProduct: RawStoreProduct | undefined;
      const targetProductId = typeof productIdHeader === 'string' ? productIdHeader.trim() : '';
      if (targetProductId) {
        const idx = db.products.findIndex((p) => p.id === targetProductId);
        if (idx !== -1) {
          const existing = db.products[idx];
          if (existing.ebookStorageKey) {
            const oldPath = path.join(EBOOKS_DIR, path.basename(existing.ebookStorageKey));
            if (fs.existsSync(oldPath)) {
              try {
                fs.unlinkSync(oldPath);
              } catch {
                // Ignore cleanup failure
              }
            }
          }
          const nextProduct: RawStoreProduct = {
            ...existing,
            ebookFileName: decodedName,
            ebookMimeType: mimeType,
            ebookFileSize: fileSize,
            ebookStorageKey: storageKey,
            formats: existing.formats || ext.replace('.', '').toUpperCase(),
          };
          db.products[idx] = nextProduct;
          db.orders = db.orders.map((order) => ({
            ...order,
            items: order.items.map((item) =>
              item.productId === targetProductId
                ? { ...item, ebookFileName: decodedName, ebookFileSize: fileSize }
                : item
            ),
          }));
          saveDatabase(db, { slices: ['products'], ordersDirty: true });
          updatedProduct = nextProduct;
        }
      }

      res.status(201).json({
        fileName: decodedName,
        mimeType,
        fileSize,
        storageKey,
        product: updatedProduct,
      });
    }
  );

  // Raw binary upload for paid prose PDF documents (Admin-only, up to 40 MB)
  app.post(
    '/api/author/upload-prose-pdf',
    express.raw({ type: '*/*', limit: '40mb' }),
    (req, res) => {
      const db = ensureDatabase();
      const rawNameHeader = req.headers['x-file-name'];
      const proseIdHeader = req.headers['x-prose-id'];

      const decodedName =
        typeof rawNameHeader === 'string' && rawNameHeader.trim()
          ? decodeURIComponent(rawNameHeader).replace(/[/\\?%*:|"<>]/g, '_')
          : 'story.pdf';
      const ext = path.extname(decodedName).toLowerCase();
      if (ext !== '.pdf') {
        res.status(400).json({ error: 'Дозволено завантажувати лише PDF-документи (.pdf).' });
        return;
      }

      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      if (buffer.byteLength < 8 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        res.status(400).json({ error: 'Файл не є дійсним PDF-документом.' });
        return;
      }

      const storageKey = `prose-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf`;
      const destPath = resolveConfinedFilePath(PROSE_PDF_DIR, storageKey);
      if (!destPath) {
        res.status(400).json({ error: 'Некоректний шлях збереження.' });
        return;
      }
      fs.writeFileSync(destPath, buffer);

      const fileSize = buffer.byteLength;
      let updatedProse: ProseWork | undefined;
      const targetProseId = typeof proseIdHeader === 'string' ? proseIdHeader.trim() : '';

      if (targetProseId) {
        const idx = db.prose.findIndex((p) => p.id === targetProseId);
        if (idx !== -1) {
          const existing = db.prose[idx];
          if (existing.pdfStorageKey) {
            const oldPath = resolveConfinedFilePath(PROSE_PDF_DIR, existing.pdfStorageKey);
            if (oldPath && fs.existsSync(oldPath)) {
              try {
                fs.unlinkSync(oldPath);
              } catch {
                // Ignore cleanup error
              }
            }
          }
          const existingMode = resolveProseAccessMode(existing);
          const nextMode: ProseAccessMode = existingMode === 'authorized' ? 'authorized' : 'paid';
          const nextPrice =
            nextMode === 'paid' ? ((existing.priceUah || 0) > 0 ? existing.priceUah : 75) : 0;
          const nextWork: RawProseWork = {
            ...existing,
            accessMode: nextMode,
            requiresAuth: nextMode === 'authorized',
            isPaid: nextMode === 'paid',
            priceUah: nextPrice,
            pdfFileName: decodedName,
            pdfFileSize: fileSize,
            pdfStorageKey: storageKey,
          };
          db.prose[idx] = nextWork;
          db.orders = db.orders.map((order) => ({
            ...order,
            items: order.items.map((item) =>
              item.proseId === targetProseId || item.productId === targetProseId
                ? { ...item, hasPdf: true, pdfFileName: decodedName, pdfFileSize: fileSize }
                : item
            ),
          }));
          saveDatabase(db, { slices: ['prose'], ordersDirty: true });
          updatedProse = enrichProseForAuthor(nextWork, db);
        }
      }

      res.status(201).json({
        fileName: decodedName,
        fileSize,
        storageKey,
        prose: updatedProse,
      });
    }
  );

  app.use(
    express.json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  const missingUploadCache = new Map<string, number>();
  const MISSING_UPLOAD_TTL_MS = 5 * 60 * 1000;

  async function isUploadUrlAvailable(url: string): Promise<boolean> {
    if (!url.startsWith('/uploads/')) return true;
    const rawName = url.slice('/uploads/'.length).split('?')[0];
    const safeName = path.basename(rawName);
    if (!safeName || safeName !== rawName || safeName.includes('..')) {
      return false;
    }
    const localPath = resolveConfinedFilePath(UPLOADS_DIR, safeName);
    if (localPath && fs.existsSync(localPath)) {
      return true;
    }
    const cachedMissingAt = missingUploadCache.get(safeName);
    if (cachedMissingAt && Date.now() - cachedMissingAt < MISSING_UPLOAD_TTL_MS) {
      return false;
    }
    try {
      const asset = await loadMediaAssetFromFirestore(safeName);
      if (asset) {
        if (localPath) {
          try {
            fs.writeFileSync(localPath, asset.buffer);
          } catch {
            // Ignore disk cache write failure
          }
        }
        missingUploadCache.delete(safeName);
        return true;
      }
    } catch {
      // Fall through to missing cache
    }
    missingUploadCache.set(safeName, Date.now());
    return false;
  }

  function listAvailableLocalUploadPhotos(): string[] {
    try {
      return fs
        .readdirSync(UPLOADS_DIR)
        .filter((name) => /\.(jpg|jpeg|png|webp|gif)$/i.test(name))
        .sort()
        .slice(0, 20)
        .map((name) => `/uploads/${name}`);
    } catch {
      return [];
    }
  }

  async function ensureAvailableAuthorPhotos(db: SiteDatabase): Promise<void> {
    const candidates = Array.isArray(db.authorPhotos) && db.authorPhotos.length > 0
      ? db.authorPhotos
      : db.authorPhotoUrl
        ? [db.authorPhotoUrl]
        : [];
    const checks = await Promise.all(
      candidates.map(async (url) => ({ url, ok: await isUploadUrlAvailable(url) }))
    );
    const available = checks.filter((item) => item.ok).map((item) => item.url);

    let resolved: string[];
    if (available.length > 0) {
      resolved = available;
    } else {
      const localUploads = listAvailableLocalUploadPhotos();
      resolved = localUploads.length > 0 ? localUploads : [DEFAULT_AUTHOR_PHOTO_URL];
    }

    const changed =
      resolved.length !== db.authorPhotos.length ||
      resolved.some((url, idx) => db.authorPhotos[idx] !== url) ||
      db.authorPhotoUrl !== resolved[0];

    if (changed) {
      db.authorPhotos = resolved;
      db.authorPhotoUrl = resolved[0];
      saveDatabase(db, { bumpCatalogRevision: true });
    }
  }

  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '30d', immutable: true }));
  app.get('/uploads/:filename', async (req, res) => {
    const rawName = String(req.params.filename || '');
    const safeName = path.basename(rawName);
    if (!safeName || safeName !== rawName || safeName.includes('..')) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    try {
      const asset = await loadMediaAssetFromFirestore(safeName);
      if (!asset) {
        missingUploadCache.set(safeName, Date.now());
        res.status(404).type('text/plain').send('Not found');
        return;
      }
      missingUploadCache.delete(safeName);
      const dest = resolveConfinedFilePath(UPLOADS_DIR, safeName);
      if (dest) {
        try {
          fs.writeFileSync(dest, asset.buffer);
        } catch {
          // Ignore disk cache failure
        }
      }
      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      res.send(asset.buffer);
    } catch {
      res.status(404).type('text/plain').send('Not found');
    }
  });

  // Telegram Bot API & channel subscription verification routes
  registerTelegramBotRoutes(app, {
    ensureDatabase,
    saveDatabase,
    dataDir: DATA_DIR,
    extractBearerToken,
    onSyncTelegramBotTokenToCloud: syncAdminTelegramTokenToFirestore,
    verifySameOrigin,
    checkRateLimit,
    getClientIpHash,
    decodeBase64UrlJson,
  });

  // Lightweight homepage shell endpoint for instant first paint (public & CDN cacheable)
  app.get('/api/home', async (req, res) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    await ensureAvailableAuthorPhotos(db);

    const etag = `W/"home-${catalogRevision}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.json({
      heroLeadText: db.heroLeadText,
      authorAboutText: db.authorAboutText,
      authorPhotoUrl: db.authorPhotoUrl,
      authorPhotos: db.authorPhotos,
      socialLinks: db.socialLinks,
      monobankJarUrl: db.monobankJarUrl,
      monobankModalTitle: db.monobankModalTitle || DEFAULT_MONOBANK_MODAL_TITLE,
      monobankModalSubtitle: db.monobankModalSubtitle ?? DEFAULT_MONOBANK_MODAL_SUBTITLE,
      monobankCardLabel: db.monobankCardLabel ?? DEFAULT_MONOBANK_CARD_LABEL,
      monobankModalText: db.monobankModalText || DEFAULT_MONOBANK_MODAL_TEXT,
      monobankEmptyText: db.monobankEmptyText ?? DEFAULT_MONOBANK_EMPTY_TEXT,
      contactEmail: db.contactEmail,
      interviews: db.interviews,
      homeActionAboutTitle: db.homeActionAboutTitle || 'Про мене',
      homeActionContactTitle:
        db.homeActionContactTitle &&
        db.homeActionContactTitle !== 'Зв’язатися з автором' &&
        db.homeActionContactTitle !== "Зв'язатися з автором"
          ? db.homeActionContactTitle
          : 'Зв’язок',
      homeActionMonobankTitle: db.homeActionMonobankTitle || 'Підтримати через Монобанк',
      homeActionInterviewsTitle: db.homeActionInterviewsTitle || 'Розмови',
      homeRepeaters: normalizeHomeRepeatersConfig(db.homeRepeaters),
      proseAuthDiscountPercent: db.proseAuthDiscountPercent ?? 0,
      proseTelegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
      storeAuthDiscountPercent: 0,
      uniqueVisitors: db.visitorIpHashes.length,
    });
  });

  // Public catalog (trimmed content for poems/blog; public cacheable for anonymous requests)
  app.get('/api/catalog', async (req, res) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    await ensureAvailableAuthorPhotos(db);
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const isAuthorized = Boolean(optionalAuth);
    if (optionalAuth?.provider === 'google' && !cloudSyncState.radioHydrated) {
      const bearerToken = extractBearerToken(req);
      if (bearerToken) {
        const radioChanged = await hydrateAuthorizedProseAndRadio(db, bearerToken);
        if (radioChanged) saveDatabase(db);
      }
    }

    const weeklyRollover = ensureWeeklyWinnersUpToDate(db);
    if (weeklyRollover.changed) {
      saveDatabase(db);
    }

    res.setHeader('Vary', 'Authorization');
    const etag = optionalAuth
      ? `W/"cat-${catalogRevision}-${optionalAuth.account.uid}"`
      : `W/"cat-pub-${catalogRevision}"`;
    res.setHeader('ETag', etag);
    res.setHeader(
      'Cache-Control',
      optionalAuth
        ? 'private, max-age=0, must-revalidate'
        : 'public, max-age=60, stale-while-revalidate=300'
    );
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const effectiveIpHash = optionalAuth ? getClientIpHash(req) : '';
    const badgeLookup = createBadgeLookup(db);
    const photoLookup = createAccountPhotoLookup(db);

    res.json({
      heroLeadText: db.heroLeadText,
      authorAboutText: db.authorAboutText,
      authorPhotoUrl: db.authorPhotoUrl,
      authorPhotos: db.authorPhotos,
      socialLinks: db.socialLinks,
      monobankJarUrl: db.monobankJarUrl,
      monobankAcquiringEnabled: Boolean(getMonobankToken()),
      monobankModalTitle: db.monobankModalTitle || DEFAULT_MONOBANK_MODAL_TITLE,
      monobankModalSubtitle: db.monobankModalSubtitle ?? DEFAULT_MONOBANK_MODAL_SUBTITLE,
      monobankCardLabel: db.monobankCardLabel ?? DEFAULT_MONOBANK_CARD_LABEL,
      monobankModalText: db.monobankModalText || DEFAULT_MONOBANK_MODAL_TEXT,
      monobankEmptyText: db.monobankEmptyText ?? DEFAULT_MONOBANK_EMPTY_TEXT,
      contactEmail: db.contactEmail,
      interviews: db.interviews,
      homeActionAboutTitle: db.homeActionAboutTitle || 'Про мене',
      homeActionContactTitle:
        db.homeActionContactTitle &&
        db.homeActionContactTitle !== 'Зв’язатися з автором' &&
        db.homeActionContactTitle !== "Зв'язатися з автором"
          ? db.homeActionContactTitle
          : 'Зв’язок',
      homeActionMonobankTitle: db.homeActionMonobankTitle || 'Підтримати через Монобанк',
      homeActionInterviewsTitle: db.homeActionInterviewsTitle || 'Розмови',
      homeRepeaters: normalizeHomeRepeatersConfig(db.homeRepeaters),
      proseAuthDiscountPercent: db.proseAuthDiscountPercent ?? 0,
      proseTelegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
      storeAuthDiscountPercent: 0,
      poems: db.poems.map((poem) =>
        truncatePoemForCatalog(
          enrichPoem(poem, db, effectiveIpHash, optionalAuth?.account, badgeLookup, photoLookup)
        )
      ),
      prose: db.prose.map((work) =>
        enrichProseForPublic(work, db, effectiveIpHash, isAuthorized, false, badgeLookup, optionalAuth?.account, photoLookup)
      ),
      proseTags: db.proseTags,
      blog: db.blog.map((post) => truncateBlogForCatalog(enrichBlogPost(post, db))),
      products: db.products.map((product) =>
        enrichProductForPublic(product, db, effectiveIpHash, badgeLookup, photoLookup, optionalAuth?.account)
      ),
      radioTracks: buildRadioTracksWithRepertoire(db, isAuthorized, optionalAuth?.account),
      monthlySelections: [...(db.monthlySelections || [])].sort((a, b) =>
        a.monthKey !== b.monthKey ? b.monthKey.localeCompare(a.monthKey) : a.order - b.order
      ),
      weeklyMusicSelections: [...(db.weeklyMusicSelections || [])].sort((a, b) =>
        b.periodStart !== a.periodStart
          ? b.periodStart.localeCompare(a.periodStart)
          : b.createdAt.localeCompare(a.createdAt)
      ),
      weeklyPoems: [...(db.weeklyPoems || [])].sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
      weeklyProse: [...(db.weeklyProse || [])].sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
      weeklyCurrentPeriod: getWeekPeriodForDate(),
      recentFeedback: buildRecentFeedback(db, 20, badgeLookup, photoLookup),
      uniqueVisitors: db.visitorIpHashes.length,
    });
  });

  // Full text lazy-loader for truncated poems in catalog
  app.get('/api/poems/:id/read', async (req, res) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const { id } = req.params;
    const poem = db.poems.find((p) => p.id === id);
    if (!poem) {
      res.status(404).json({ error: 'Вірш не знайдено.' });
      return;
    }
    const etag = `W/"poem-${poem.id}-${catalogRevision}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.json({ id: poem.id, content: poem.content });
  });

  // Full text lazy-loader for truncated blog posts in catalog
  app.get('/api/blog/:id/read', async (req, res) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const { id } = req.params;
    const post = db.blog.find((b) => b.id === id);
    if (!post) {
      res.status(404).json({ error: 'Допис не знайдено.' });
      return;
    }
    const etag = `W/"blog-${post.id}-${catalogRevision}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.json({ id: post.id, content: post.content });
  });

  // Public monthly SoundCloud music selections endpoint
  app.get('/api/selections', async (req, res) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const etag = `W/"sel-${catalogRevision}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    const sorted = [...(db.monthlySelections || [])].sort((a, b) =>
      a.monthKey !== b.monthKey ? b.monthKey.localeCompare(a.monthKey) : a.order - b.order
    );
    res.json({ monthlySelections: sorted });
  });

  // Radio playlist endpoint: public metadata cacheable without auth; full playback URLs only for signed-in users
  app.get('/api/radio', async (req, res) => {
    const db = ensureDatabase();
    if (!cloudSyncState.publicHydrated) {
      const hydrated = await hydratePublicCatalogFromFirestore(db);
      if (hydrated) saveDatabase(db);
    }
    res.setHeader('Vary', 'Authorization');
    const bearer = extractBearerToken(req);
    if (!bearer) {
      const etag = `W/"radio-pub-${catalogRevision}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.json({
        tracks: buildRadioTracksWithRepertoire(db, false, null),
      });
      return;
    }

    const authResult = await authenticateGuestRequest(req, db);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }
    if (authResult.provider === 'google' && !cloudSyncState.radioHydrated) {
      const changed = await hydrateAuthorizedProseAndRadio(db, bearer);
      if (changed) saveDatabase(db);
    }
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.json({
      tracks: buildRadioTracksWithRepertoire(db, true, authResult.account),
    });
  });

  const radioWaveformServerCache = new Map<string, number[]>();

  // Authorized-only SoundCloud track waveform samples for live frequency equalizer
  app.get('/api/radio/waveform/:trackId', async (req, res) => {
    const db = ensureDatabase();
    const authResult = await authenticateGuestRequest(req, db);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }

    const trackId = String(req.params.trackId || '').trim();
    if (!trackId) {
      res.status(400).json({ error: 'Не вказано трек.' });
      return;
    }

    const cached = radioWaveformServerCache.get(trackId);
    if (cached) {
      res.json({ samples: cached });
      return;
    }

    const track = db.radioTracks.find((t) => t.id === trackId);
    if (!track?.soundcloudUrl) {
      res.status(404).json({ error: 'Трек не знайдено.' });
      return;
    }

    const normalizedUrl = normalizeSoundCloudInputUrl(track.soundcloudUrl);
    if (!normalizedUrl) {
      res.status(400).json({ error: 'Недійсне посилання SoundCloud.' });
      return;
    }

    try {
      const pageRes = await fetch(normalizedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RadioEqualizer/1.0)',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (!pageRes.ok) {
        res.status(200).json({ samples: [] });
        return;
      }
      const html = await pageRes.text();
      const waveMatch = html.match(/https:\/\/wave\.sndcdn\.com\/[a-zA-Z0-9_-]+\.(?:json|png)/i);
      if (!waveMatch?.[0]) {
        res.status(200).json({ samples: [] });
        return;
      }
      const waveJsonUrl = waveMatch[0].replace(/\.png$/i, '.json');
      const waveRes = await fetch(waveJsonUrl, { signal: AbortSignal.timeout(6000) });
      if (!waveRes.ok) {
        res.status(200).json({ samples: [] });
        return;
      }
      const waveData = (await waveRes.json()) as { height?: number; samples?: unknown };
      if (!Array.isArray(waveData.samples) || waveData.samples.length === 0) {
        res.status(200).json({ samples: [] });
        return;
      }
      const maxHeight = typeof waveData.height === 'number' && waveData.height > 0 ? waveData.height : 140;
      const samples = waveData.samples.map((v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Math.min(1, Math.max(0, Number((n / maxHeight).toFixed(4))));
      });
      radioWaveformServerCache.set(trackId, samples);
      res.json({ samples });
    } catch {
      res.status(200).json({ samples: [] });
    }
  });

  // Toggle like on a radio track for authenticated users (excluded from leaderboard activity ranking)
  app.post('/api/radio/tracks/:id/like', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`radio-like:${ipHash}`, 80, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато дій за короткий час. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const trackId = String(req.params.id || '').trim().slice(0, 128);
    if (!trackId) {
      res.status(400).json({ error: 'Не вказано трек.' });
      return;
    }

    const currentLikes = Array.isArray(auth.account.likedRadioTrackIds)
      ? auth.account.likedRadioTrackIds
      : [];
    const alreadyLiked = currentLikes.includes(trackId);
    const nextLikes = alreadyLiked
      ? currentLikes.filter((tid) => tid !== trackId)
      : [trackId, ...currentLikes];

    auth.account.likedRadioTrackIds = nextLikes;
    auth.account.likedUpdatedAt = new Date().toISOString();
    auth.account.updatedAt = auth.account.likedUpdatedAt;
    saveDatabase(db, { flushDelayMs: 1500, slices: ['community'] });

    if (auth.firebaseClaims && auth.firebaseIdToken) {
      recordCloudRadioLikeState(trackId, auth.firebaseClaims.uid, !alreadyLiked);
      void syncGuestLikesToFirestore(
        {
          firebaseUid: auth.firebaseClaims.uid,
          email: auth.account.email,
          displayName: auth.account.displayName,
          likedPoemIds: Array.isArray(auth.account.likedPoemIds) ? auth.account.likedPoemIds : [],
          likedRadioTrackIds: nextLikes,
          photoUrl: auth.account.photoUrl,
          guestUid: auth.account.uid,
          totalTimeSeconds: auth.account.totalTimeSeconds,
          purchasesCount: auth.account.purchasesCount,
          donorChatText: auth.account.donorChatText,
        },
        auth.firebaseIdToken
      );
      void syncRadioLikeEntryToFirestore(
        {
          trackId,
          firebaseUid: auth.firebaseClaims.uid,
          liked: !alreadyLiked,
        },
        auth.firebaseIdToken
      );
    }

    const existingTrack = db.radioTracks.find((t) => t.id === trackId);
    const likesCount = computeRadioTrackLikesCount(trackId, db);
    res.json({
      liked: !alreadyLiked,
      likedRadioTrackIds: nextLikes,
      likesCount,
      track: existingTrack
        ? enrichRadioTrackForPublic(existingTrack, true, db, auth.account)
        : null,
    });
  });

  // Track/refresh unique visitor count and detailed session visit
  app.post('/api/visitors/track', (req, res) => {
    const db = ensureDatabase();
    const ipHash = getClientIpHash(req);
    let isNewVisitor = false;

    if (!visitorIpSet.has(ipHash)) {
      visitorIpSet.add(ipHash);
      db.visitorIpHashes.push(ipHash);
      isNewVisitor = true;
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      sessionId?: unknown;
      entrySection?: unknown;
      referrer?: unknown;
    };

    const visitRecorded = recordSiteVisit(db, req, ipHash, {
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      entrySection: typeof body.entrySection === 'string' ? body.entrySection : undefined,
      referrer: typeof body.referrer === 'string' ? body.referrer : undefined,
      isNewVisitor,
      source: 'client',
    });

    if (isNewVisitor || visitRecorded) {
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 5000, slices: ['community', 'analytics'] });
    }

    res.json({
      uniqueVisitors: db.visitorIpHashes.length,
      isNewVisitor,
    });
  });

  // View counters for Poems and Blog posts
  app.post('/api/poems/:id/view', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const poem = db.poems.find((p) => p.id === id);
    if (!poem) {
      res.status(404).json({ error: 'Вірш не знайдено.' });
      return;
    }
    db.poemViews[id] = (db.poemViews[id] || 0) + 1;
    saveDatabase(db, { bumpCatalogRevision: true, flushDelayMs: 2500, slices: ['poems'] });
    res.json({ id, viewsCount: db.poemViews[id] });
  });

  app.post('/api/blog/:id/view', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const post = db.blog.find((b) => b.id === id);
    if (!post) {
      res.status(404).json({ error: 'Допис не знайдено.' });
      return;
    }
    db.blogViews[id] = (db.blogViews[id] || 0) + 1;
    saveDatabase(db, { bumpCatalogRevision: true, flushDelayMs: 2500, slices: ['blog'] });
    res.json({ id, viewsCount: db.blogViews[id] });
  });

  // Track user behavior telemetry (clicks, dwell duration, exit moments)
  app.post(
    '/api/analytics/event',
    express.text({ type: 'text/plain', limit: '256kb' }),
    (req, res) => {
      let body = req.body as unknown;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          res.status(400).json({ error: 'Invalid payload' });
          return;
        }
      }
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Invalid payload' });
        return;
      }

      const { sessionId, events } = body as {
        sessionId?: string;
        events?: Array<{
          type?: string;
          targetKey?: string;
          label?: string;
          category?: string;
          section?: string;
          durationSeconds?: number;
        }>;
      };

      const cleanSessionId =
        typeof sessionId === 'string' ? sessionId.trim().slice(0, 64) : 'anonymous';
      if (!Array.isArray(events) || events.length === 0) {
        res.status(200).json({ ok: true });
        return;
      }

      const db = ensureDatabase();
      const analytics = db.analytics;
      const nowIso = new Date().toISOString();

      if (cleanSessionId && !seenAnalyticsSessionsSet.has(cleanSessionId)) {
        seenAnalyticsSessionsSet.add(cleanSessionId);
        analytics.seenSessionIds.push(cleanSessionId);
        if (analytics.seenSessionIds.length > 2000) {
          analytics.seenSessionIds = analytics.seenSessionIds.slice(-1500);
          seenAnalyticsSessionsSet = new Set(analytics.seenSessionIds);
        }
        analytics.totalSessions += 1;
      }

      for (const rawEv of events.slice(0, 20)) {
        if (!rawEv || typeof rawEv !== 'object') continue;
        const evType = rawEv.type;
        const targetKey =
          typeof rawEv.targetKey === 'string' ? rawEv.targetKey.trim().slice(0, 120) : '';
        const label =
          typeof rawEv.label === 'string' ? rawEv.label.trim().slice(0, 140) : targetKey;
        if (!targetKey || !label) continue;

        if (evType === 'click') {
          const validCategories: AnalyticsClickCategory[] = ['section', 'content', 'store', 'action'];
          const category: AnalyticsClickCategory = validCategories.includes(
            rawEv.category as AnalyticsClickCategory
          )
            ? (rawEv.category as AnalyticsClickCategory)
            : 'action';
          const prev = analytics.clicksByTarget[targetKey];
          analytics.clicksByTarget[targetKey] = {
            targetKey,
            label,
            category,
            clicks: (prev?.clicks || 0) + 1,
            lastClickedAt: nowIso,
          };
          analytics.totalClicks += 1;
          analytics.recentEvents.unshift({
            id: `ev_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
            sessionId: cleanSessionId,
            type: 'click',
            targetKey,
            label,
            createdAt: nowIso,
          });
        } else if (evType === 'dwell') {
          const sec = Math.max(0, Math.min(14400, Math.round(Number(rawEv.durationSeconds) || 0)));
          if (sec < 2) continue;
          const validDwellCategories: AnalyticsDwellCategory[] = [
            'section',
            'poem',
            'prose',
            'blog',
            'product',
          ];
          const category: AnalyticsDwellCategory = validDwellCategories.includes(
            rawEv.category as AnalyticsDwellCategory
          )
            ? (rawEv.category as AnalyticsDwellCategory)
            : 'section';
          const prev = analytics.dwellByTarget[targetKey];
          analytics.dwellByTarget[targetKey] = {
            targetKey,
            label,
            category,
            totalSeconds: (prev?.totalSeconds || 0) + sec,
            sessionsCount: (prev?.sessionsCount || 0) + 1,
            maxSeconds: Math.max(prev?.maxSeconds || 0, sec),
            lastActiveAt: nowIso,
          };
          analytics.totalTrackedSeconds += sec;
          analytics.recentEvents.unshift({
            id: `ev_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
            sessionId: cleanSessionId,
            type: 'dwell',
            targetKey,
            label,
            durationSeconds: sec,
            createdAt: nowIso,
          });
        } else if (evType === 'exit') {
          const sessionSec = Math.max(
            1,
            Math.min(28800, Math.round(Number(rawEv.durationSeconds) || 1))
          );
          const section =
            typeof rawEv.section === 'string' ? rawEv.section.trim().slice(0, 40) : 'home';
          const prev = analytics.exitsByMoment[targetKey];
          const nextExits = (prev?.exits || 0) + 1;
          const nextTotalSessionSec = (prev?.totalSessionSeconds || 0) + sessionSec;
          analytics.exitsByMoment[targetKey] = {
            momentKey: targetKey,
            label,
            section,
            exits: nextExits,
            totalSessionSeconds: nextTotalSessionSec,
            avgSessionSeconds: Math.round(nextTotalSessionSec / nextExits),
            lastExitAt: nowIso,
          };
          analytics.recentEvents.unshift({
            id: `ev_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
            sessionId: cleanSessionId,
            type: 'exit',
            targetKey,
            label,
            durationSeconds: sessionSec,
            createdAt: nowIso,
          });
        }
      }

      if (analytics.recentEvents.length > 40) {
        analytics.recentEvents = analytics.recentEvents.slice(0, 40);
      }

      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 5000, slices: ['analytics'] });
      res.status(200).json({ ok: true });
    }
  );

  // Track authenticated user's active time on site (anti-tamper wall-clock cap)
  const userHeartbeatLastMs = new Map<string, number>();
  const userTimeCloudSyncLastMs = new Map<string, number>();

  app.post(
    '/api/users/time-heartbeat',
    express.text({ type: 'text/plain', limit: '16kb' }),
    async (req, res) => {
      if (!verifySameOrigin(req)) {
        res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
        return;
      }

      let body = req.body as unknown;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          res.status(400).json({ error: 'Invalid payload' });
          return;
        }
      }
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Invalid payload' });
        return;
      }

      const { seconds, guestToken } = body as {
        seconds?: number;
        guestToken?: string;
      };

      const rawSec = Math.round(Number(seconds) || 0);
      if (rawSec <= 0) {
        res.status(200).json({ ok: true, creditedSeconds: 0 });
        return;
      }

      const db = ensureDatabase();
      let account: GuestAccountRecord | undefined;
      let firebaseUidForSync: string | undefined;
      let firebaseTokenForSync: string | undefined;

      const bearer =
        extractBearerToken(req) ||
        (typeof guestToken === 'string' && guestToken.trim() ? guestToken.trim() : null);

      if (!bearer) {
        res.status(200).json({ ok: true, creditedSeconds: 0 });
        return;
      }

      const sessionPayload = verifyGuestSessionToken(bearer);
      if (sessionPayload) {
        account = db.guestAccounts.find((a) => a.uid === sessionPayload.uid);
      } else {
        try {
          const claims = await verifyFirebaseIdToken(bearer);
          if (claims && claims.emailVerified && claims.email) {
            account = findOrCreateGoogleGuestAccount(db, claims).account;
            firebaseUidForSync = claims.uid;
            firebaseTokenForSync = bearer;
          }
        } catch {
          account = undefined;
        }
      }

      if (!account) {
        res.status(200).json({ ok: true, creditedSeconds: 0 });
        return;
      }

      const nowMs = Date.now();
      const prevMs = userHeartbeatLastMs.get(account.uid);
      const maxWallDelta =
        typeof prevMs === 'number'
          ? Math.max(2, Math.ceil((nowMs - prevMs) / 1000) + 5)
          : 60;
      const credited = Math.max(0, Math.min(rawSec, 180, maxWallDelta));

      userHeartbeatLastMs.set(account.uid, nowMs);
      if (userHeartbeatLastMs.size > 5000) {
        const entries = Array.from(userHeartbeatLastMs.entries()).sort((a, b) => a[1] - b[1]);
        for (const [k] of entries.slice(0, entries.length - 3000)) {
          userHeartbeatLastMs.delete(k);
        }
      }

      if (credited > 0) {
        account.totalTimeSeconds = Math.max(0, Math.round(account.totalTimeSeconds || 0)) + credited;
        account.lastSeenAt = new Date(nowMs).toISOString();
        saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 5000, slices: ['community'] });

        if (firebaseUidForSync && firebaseTokenForSync) {
          const prevSyncMs = userTimeCloudSyncLastMs.get(firebaseUidForSync) || 0;
          if (nowMs - prevSyncMs >= 55_000) {
            userTimeCloudSyncLastMs.set(firebaseUidForSync, nowMs);
            void syncPublicUserProfileToFirestore(
              {
                firebaseUid: firebaseUidForSync,
                guestUid: account.uid,
                displayName: account.displayName,
                photoUrl: account.photoUrl,
                likedPoemIds: account.likedPoemIds,
                likedRadioTrackIds: account.likedRadioTrackIds,
                totalTimeSeconds: account.totalTimeSeconds,
                purchasesCount: account.purchasesCount,
                donorChatText: account.donorChatText,
              },
              firebaseTokenForSync
            );
          }
        }
      }

      res.status(200).json({
        ok: true,
        creditedSeconds: credited,
        totalTimeSeconds: account.totalTimeSeconds || 0,
      });
    }
  );

  // Public Top-10 User Leaderboard (registration seniority, time spent on site, top donors)
  app.get('/api/leaderboard', async (req, res) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const seniority: LeaderboardSeniorityEntry[] = [...db.guestAccounts]
      .filter((acc) => typeof acc.createdAt === 'string' && acc.displayName)
      .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))
      .slice(0, 10)
      .map((acc, idx) => ({
        rank: idx + 1,
        uid: acc.uid,
        displayName: acc.displayName,
        photoUrl: acc.photoUrl,
        createdAt: acc.createdAt,
      }));

    const time: LeaderboardTimeEntry[] = [...db.guestAccounts]
      .filter((acc) => Math.round(Number(acc.totalTimeSeconds) || 0) > 0)
      .sort((a, b) => {
        const diff = Math.round(Number(b.totalTimeSeconds) || 0) - Math.round(Number(a.totalTimeSeconds) || 0);
        if (diff !== 0) return diff;
        return (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
      })
      .slice(0, 10)
      .map((acc, idx) => ({
        rank: idx + 1,
        uid: acc.uid,
        displayName: acc.displayName,
        photoUrl: acc.photoUrl,
        totalTimeSeconds: Math.round(Number(acc.totalTimeSeconds) || 0),
        lastSeenAt: acc.lastSeenAt,
      }));

    const { activityRanked, donorsRanked, lookup: badgeLookup } = computeLeaderboardRankings(db);

    const activity: LeaderboardActivityEntry[] = activityRanked.map(
      ({ googleUid: _gUid, ...entry }) => {
        const badges = badgeLookup.get(entry.uid, entry.displayName);
        return {
          ...entry,
          ...(badges ? { badges } : {}),
        };
      }
    );

    const donors: LeaderboardDonorEntry[] = donorsRanked.map(
      ({ googleUid: _gUid, ...entry }) => {
        const badges = badgeLookup.get(entry.guestUid, entry.displayName);
        return {
          ...entry,
          ...(badges ? { badges } : {}),
        };
      }
    );

    const currentUserBadges = optionalAuth
      ? badgeLookup.get(optionalAuth.account.uid, optionalAuth.account.displayName)
      : undefined;

    const payload: UserLeaderboardResponse = {
      seniority,
      time,
      activity,
      donors,
      totalRegisteredUsers: db.guestAccounts.length,
      currentUserUid: optionalAuth?.account.uid ?? null,
      ...(currentUserBadges ? { currentUserBadges } : {}),
      generatedAt: new Date().toISOString(),
    };

    res.json(payload);
  });

  // Guest Google Sign-In session sync
  app.post('/api/guest/google-session', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Відсутній токен авторизації Google.' });
      return;
    }
    try {
      const claims = await verifyFirebaseIdToken(token);
      if (!claims || !claims.email) {
        res.status(401).json({ error: 'Не вдалося підтвердити Google-акаунт.' });
        return;
      }
      if (!claims.emailVerified) {
        res.status(401).json({ error: 'Електронна пошта цього Google-акаунту не підтверджена.' });
        return;
      }
      const db = ensureDatabase();
      if (!cloudSyncState.publicHydrated) {
        const hadPublic = await hydratePublicCatalogFromFirestore(db);
        if (hadPublic) saveDatabase(db);
      }
      const { account } = findOrCreateGoogleGuestAccount(db, claims);
      const hydratedFromFs = await hydrateAccountLikesFromFirestoreIfNeeded(
        db,
        account,
        claims.uid,
        token,
        { force: true }
      );

      const rawFallbackLikes = (req.body as { fallbackLikedPoemIds?: unknown } | undefined)
        ?.fallbackLikedPoemIds;
      if (
        !hydratedFromFs &&
        (!account.likedPoemIds || account.likedPoemIds.length === 0) &&
        !account.likedUpdatedAt &&
        Array.isArray(rawFallbackLikes) &&
        rawFallbackLikes.length > 0
      ) {
        const validPoemIds = new Set(db.poems.map((p) => p.id));
        const restoredLikes = Array.from(
          new Set(
            rawFallbackLikes.filter(
              (id): id is string => typeof id === 'string' && validPoemIds.has(id)
            )
          )
        ).slice(0, 500);
        if (restoredLikes.length > 0) {
          account.likedPoemIds = restoredLikes;
          account.likedUpdatedAt = new Date().toISOString();
          account.updatedAt = account.likedUpdatedAt;
          saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
          syncCloudPoemLikesForUid(claims.uid, restoredLikes);
          void syncGuestLikesToFirestore(
            {
              firebaseUid: claims.uid,
              email: account.email,
              displayName: account.displayName,
              likedPoemIds: restoredLikes,
              likedRadioTrackIds: account.likedRadioTrackIds,
              photoUrl: account.photoUrl,
              guestUid: account.uid,
              totalTimeSeconds: account.totalTimeSeconds,
              purchasesCount: account.purchasesCount,
              donorChatText: account.donorChatText,
            },
            token
          ).then((ok) => {
            if (ok) hydratedGuestLikesUids.add(claims.uid);
          });
          void syncUserPoemLikeEntriesToFirestore(
            { firebaseUid: claims.uid, likedPoemIds: restoredLikes },
            token
          );
        }
      } else {
        void syncPublicUserProfileToFirestore(
          {
            firebaseUid: claims.uid,
            guestUid: account.uid,
            displayName: account.displayName,
            photoUrl: account.photoUrl,
            likedPoemIds: account.likedPoemIds,
            likedRadioTrackIds: account.likedRadioTrackIds,
            totalTimeSeconds: account.totalTimeSeconds,
            purchasesCount: account.purchasesCount,
            donorChatText: account.donorChatText,
          },
          token
        );
      }

      const isAdmin = isVerifiedAdminClaims(claims);
      const sessionToken = issueGuestSessionToken(account, 'google');
      setGuestSessionCookie(req, res, sessionToken);
      res.json({
        user: sanitizeGuestUser(account, 'google', sessionToken, createBadgeLookup(db)),
        isAdmin,
        role: isAdmin ? 'admin' : 'guest',
      });
    } catch {
      res.status(401).json({ error: 'Помилка перевірки Google-сесії.' });
    }
  });

  // Restore remembered guest session transparently from HttpOnly cookie
  app.get('/api/guest/session', async (req, res) => {
    const cookieToken = extractCookieGuestSessionToken(req);
    const bearerToken = extractBearerToken(req);
    const token = bearerToken || cookieToken;
    if (!token) {
      res.json({ authenticated: false, user: null });
      return;
    }
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const authResult = await authenticateGuestToken(token, db);
    if (!authResult.ok) {
      if (cookieToken && !bearerToken) {
        clearGuestSessionCookie(req, res);
      }
      res.json({ authenticated: false, user: null });
      return;
    }
    const account = authResult.account;
    account.lastSeenAt = new Date().toISOString();
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 5000, slices: ['community'] });
    const freshSessionToken = issueGuestSessionToken(account, 'google');
    setGuestSessionCookie(req, res, freshSessionToken);
    const requiresGoogleForAdmin =
      !authResult.firebaseClaims && isAdminEmailAddress(account.email);
    res.json({
      authenticated: true,
      user: sanitizeGuestUser(
        account,
        'google',
        freshSessionToken,
        createBadgeLookup(db)
      ),
      isAdmin: Boolean(authResult.firebaseClaims && authResult.isAdmin),
      requiresGoogleForAdmin,
    });
  });

  // Clear remembered HttpOnly session cookie on explicit logout
  app.post('/api/guest/logout', (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    clearGuestSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Set or update 4-digit PIN (Monobank-style quick unlock)
  app.post('/api/guest/pin/set', pinSetLimiter, async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const db = ensureDatabase();
    const authResult = await authenticateGuestRequest(req, db);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }

    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`pin-set:${authResult.account.uid}:${ipHash}`, 15, 10 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато спроб зміни ПІН-коду. Спробуйте трохи пізніше.' });
      return;
    }

    const { pin, currentPin } = req.body as { pin?: unknown; currentPin?: unknown };
    if (!isValidFourDigitPin(pin)) {
      res.status(400).json({ error: 'ПІН-код має складатися рівно з 4 цифр.' });
      return;
    }

    const account = authResult.account;
    const alreadyHasPin = Boolean(account.pinHash && account.pinSalt);
    // If changing an existing PIN without an active Firebase Google token, verify current PIN first
    if (alreadyHasPin && !authResult.firebaseClaims) {
      if (!isValidFourDigitPin(currentPin) || !verifyGuestPinHash(currentPin, account.pinHash!, account.pinSalt!)) {
        res.status(401).json({ error: 'Неправильний поточний ПІН-код.' });
        return;
      }
    }

    const { pinHash, pinSalt } = hashGuestPin(pin);
    const nowIso = new Date().toISOString();
    account.pinHash = pinHash;
    account.pinSalt = pinSalt;
    account.pinFailedAttempts = 0;
    delete account.pinLockedUntil;
    account.pinUpdatedAt = nowIso;
    account.updatedAt = nowIso;
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 0, slices: ['community'] });

    const freshSessionToken = issueGuestSessionToken(account, 'google');
    setGuestSessionCookie(req, res, freshSessionToken);

    res.json({
      ok: true,
      user: sanitizeGuestUser(account, 'google', freshSessionToken, createBadgeLookup(db)),
    });
  });

  // Disable 4-digit PIN for current account
  app.delete('/api/guest/pin', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const db = ensureDatabase();
    const authResult = await authenticateGuestRequest(req, db);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }

    const account = authResult.account;
    delete account.pinHash;
    delete account.pinSalt;
    delete account.pinFailedAttempts;
    delete account.pinLockedUntil;
    delete account.pinUpdatedAt;
    account.updatedAt = new Date().toISOString();
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 0, slices: ['community'] });

    const freshSessionToken = issueGuestSessionToken(account, 'google');
    setGuestSessionCookie(req, res, freshSessionToken);

    res.json({
      ok: true,
      user: sanitizeGuestUser(account, 'google', freshSessionToken, createBadgeLookup(db)),
    });
  });

  // Quick 4-digit PIN sign-in for remembered returning users (Monobank-style)
  app.post('/api/guest/pin-login', pinLoginLimiter, async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }

    const { uid, email, pin } = req.body as { uid?: unknown; email?: unknown; pin?: unknown };
    const cleanUid = typeof uid === 'string' ? uid.trim() : '';
    const cleanEmail = normalizeEmailAddress(email);

    if ((!cleanUid && !cleanEmail) || !isValidFourDigitPin(pin)) {
      res.status(400).json({ error: 'Введіть 4-значний ПІН-код.' });
      return;
    }

    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);

    const account = db.guestAccounts.find(
      (acc) =>
        (cleanUid && (acc.uid === cleanUid || acc.googleUid === cleanUid)) ||
        (cleanEmail && acc.email.toLowerCase() === cleanEmail)
    );

    if (!account || !account.pinHash || !account.pinSalt) {
      res.status(401).json({
        error: 'Швидкий ПІН-вхід для цього акаунту не налаштовано. Увійдіть через Google.',
      });
      return;
    }

    const nowMs = Date.now();
    if (account.pinLockedUntil) {
      const lockedUntilMs = Date.parse(account.pinLockedUntil);
      if (Number.isFinite(lockedUntilMs) && lockedUntilMs > nowMs) {
        const retryAfterSec = Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000));
        const mins = Math.ceil(retryAfterSec / 60);
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(429).json({
          error: `ПІН-вхід тимчасово заблоковано на ${mins} хв через невдалі спроби. Використайте вхід через Google.`,
          retryAfterSec,
          lockedUntil: account.pinLockedUntil,
        });
        return;
      }
      account.pinFailedAttempts = 0;
      delete account.pinLockedUntil;
    }

    const isPinValid = verifyGuestPinHash(pin, account.pinHash, account.pinSalt);
    if (!isPinValid) {
      const nextFailed = (Number(account.pinFailedAttempts) || 0) + 1;
      account.pinFailedAttempts = nextFailed;
      if (nextFailed >= PIN_MAX_FAILED_ATTEMPTS) {
        const lockIso = new Date(nowMs + PIN_LOCKOUT_MS).toISOString();
        account.pinLockedUntil = lockIso;
        saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 0, slices: ['community'] });
        res.setHeader('Retry-After', String(Math.ceil(PIN_LOCKOUT_MS / 1000)));
        res.status(429).json({
          error: 'Забагато невірних спроб. ПІН-вхід заблоковано на 15 хвилин — увійдіть через Google.',
          retryAfterSec: Math.ceil(PIN_LOCKOUT_MS / 1000),
          lockedUntil: lockIso,
          attemptsRemaining: 0,
        });
        return;
      }
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
      const attemptsRemaining = Math.max(0, PIN_MAX_FAILED_ATTEMPTS - nextFailed);
      res.status(401).json({
        error: `Невірний ПІН-код. Залишилось спроб: ${attemptsRemaining}.`,
        attemptsRemaining,
      });
      return;
    }

    account.pinFailedAttempts = 0;
    delete account.pinLockedUntil;
    account.lastSeenAt = new Date().toISOString();
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 3000, slices: ['community'] });

    const sessionToken = issueGuestSessionToken(account, 'google');
    setGuestSessionCookie(req, res, sessionToken);
    const requiresGoogleForAdmin = isAdminEmailAddress(account.email);

    res.json({
      user: sanitizeGuestUser(account, 'google', sessionToken, createBadgeLookup(db)),
      sessionToken,
      isAdmin: false,
      requiresGoogleForAdmin,
      role: 'guest',
    });
  });

  let broadcastGlobalChatRefresh: ((db: SiteDatabase) => void) | null = null;

  // Update guest profile (displayName, photoUrl, optional top-3 donorChatText)
  app.post('/api/guest/profile', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const db = ensureDatabase();
    const authResult = await authenticateGuestRequest(req, db);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }
    const { displayName, photoUrl, donorChatText } = req.body as {
      displayName?: string;
      photoUrl?: string;
      donorChatText?: string;
    };
    const cleanName = typeof displayName === 'string' ? displayName.trim().slice(0, 80) : '';
    const cleanPhoto = typeof photoUrl === 'string' ? photoUrl.trim() : '';

    if (cleanName) {
      authResult.account.displayName = cleanName;
    }
    if (cleanPhoto !== undefined) {
      authResult.account.photoUrl = cleanPhoto || undefined;
    }

    const badgeLookup = createBadgeLookup(db);
    const liveBadges = badgeLookup.get(authResult.account.uid, authResult.account.displayName);
    let donorTextUpdated = false;
    if (typeof donorChatText === 'string' && liveBadges?.donorRank && liveBadges.donorRank <= 3) {
      const normalizedDonorText = donorChatText.replace(/\s+/g, ' ').trim().slice(0, 80);
      authResult.account.donorChatText = normalizedDonorText || undefined;
      donorTextUpdated = true;
    }

    authResult.account.updatedAt = new Date().toISOString();
    saveDatabase(db, { flushDelayMs: 1000, slices: ['community'] });
    if (donorTextUpdated && broadcastGlobalChatRefresh) {
      broadcastGlobalChatRefresh(db);
    }

    if (authResult.firebaseClaims && authResult.firebaseIdToken) {
      void syncGuestLikesToFirestore(
        {
          firebaseUid: authResult.firebaseClaims.uid,
          email: authResult.account.email,
          displayName: authResult.account.displayName,
          likedPoemIds: Array.isArray(authResult.account.likedPoemIds)
            ? authResult.account.likedPoemIds
            : [],
          likedRadioTrackIds: authResult.account.likedRadioTrackIds,
          photoUrl: authResult.account.photoUrl,
          guestUid: authResult.account.uid,
          totalTimeSeconds: authResult.account.totalTimeSeconds,
          purchasesCount: authResult.account.purchasesCount,
          donorChatText: authResult.account.donorChatText,
        },
        authResult.firebaseIdToken
      );
    }

    const token = extractBearerToken(req) || undefined;
    res.json({
      user: sanitizeGuestUser(authResult.account, authResult.provider, token, badgeLookup),
      isAdmin: authResult.isAdmin,
    });
  });

  // Toggle poem favorite / like ("Вподобайка") for authenticated users
  app.post('/api/poems/:id/like', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`poem-like:${ipHash}`, 80, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато дій за короткий час. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { id } = req.params;
    const poem = db.poems.find((p) => p.id === id);
    if (!poem) {
      res.status(404).json({ error: 'Вірш не знайдено.' });
      return;
    }

    const currentLikes = Array.isArray(auth.account.likedPoemIds) ? auth.account.likedPoemIds : [];
    const alreadyLiked = currentLikes.includes(id);
    const nextLikes = alreadyLiked
      ? currentLikes.filter((pid) => pid !== id)
      : [id, ...currentLikes];

    const nowIso = new Date().toISOString();
    auth.account.likedPoemIds = nextLikes;
    auth.account.likedUpdatedAt = nowIso;
    auth.account.updatedAt = nowIso;
    saveDatabase(db, { flushDelayMs: 1500, slices: ['community'] });

    let cloudSynced = false;
    if (auth.firebaseClaims && auth.firebaseIdToken) {
      const fbUid = auth.firebaseClaims.uid;
      recordCloudPoemLikeState(id, fbUid, !alreadyLiked);
      const [syncedUsersDoc, syncedLikeEntry] = await Promise.all([
        syncGuestLikesToFirestore(
          {
            firebaseUid: fbUid,
            email: auth.account.email,
            displayName: auth.account.displayName,
            likedPoemIds: nextLikes,
            likedRadioTrackIds: auth.account.likedRadioTrackIds,
            photoUrl: auth.account.photoUrl,
            guestUid: auth.account.uid,
            totalTimeSeconds: auth.account.totalTimeSeconds,
            purchasesCount: auth.account.purchasesCount,
            donorChatText: auth.account.donorChatText,
          },
          auth.firebaseIdToken
        ),
        syncPoemLikeEntryToFirestore(
          {
            poemId: id,
            firebaseUid: fbUid,
            liked: !alreadyLiked,
          },
          auth.firebaseIdToken
        ),
      ]);
      if (syncedUsersDoc) {
        hydratedGuestLikesUids.add(fbUid);
      } else {
        hydratedGuestLikesUids.delete(fbUid);
      }
      cloudSynced = syncedUsersDoc || syncedLikeEntry;
      if (!syncedUsersDoc && !syncedLikeEntry) {
        console.warn('[PoemLike] Failed to persist like change to Firestore for uid:', fbUid);
      }
    } else if (auth.account.googleUid) {
      recordCloudPoemLikeState(id, auth.account.googleUid, !alreadyLiked);
      hydratedGuestLikesUids.delete(auth.account.googleUid);
    }

    res.json({
      liked: !alreadyLiked,
      likedPoemIds: nextLikes,
      cloudSynced,
      poem: enrichPoem(poem, db, ipHash, auth.account),
    });
  });

  // Rate a poem (0.1 to 5.0), strictly once per unique user/IP
  app.post('/api/poems/:id/rate', async (req, res) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const { id } = req.params;
    const { rating } = req.body as { rating?: number };
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);

    const poem = db.poems.find((p) => p.id === id);
    if (!poem) {
      res.status(404).json({ error: 'Вірш не знайдено.' });
      return;
    }

    const numericRating = parseDecimalRating(rating);
    if (numericRating === null) {
      res.status(400).json({ error: 'Оцінка має бути від 0.1 до 5.0.' });
      return;
    }

    const ipHash = getClientIpHash(req);
    if (!db.poemVotes[id]) {
      db.poemVotes[id] = {};
    }

    const { primaryKey, lookupKeys } = getEffectiveVoteKeys(ipHash, optionalAuth?.account);
    const existingVote = findUserRatingInVotes(db.poemVotes[id], lookupKeys);
    if (existingVote !== null) {
      const enriched = enrichPoem(poem, db, ipHash, optionalAuth?.account);
      res.status(409).json({
        error: 'Ви вже оцінили цей вірш.',
        alreadyRated: true,
        poem: enriched,
      });
      return;
    }

    db.poemVotes[id][primaryKey] = numericRating;
    recordWeeklyVoteLog(db, {
      targetType: 'poem',
      targetId: id,
      voterKey: primaryKey,
      rating: numericRating,
    });
    recordRecentRating(db, {
      targetType: 'poem',
      targetId: id,
      rating: numericRating,
      authorUid: optionalAuth?.firebaseClaims?.uid || optionalAuth?.account.googleUid || optionalAuth?.account.uid,
      authorName: optionalAuth?.account.displayName,
      authorPhotoUrl: optionalAuth?.account.photoUrl,
    });
    saveDatabase(db, { flushDelayMs: 1500, slices: ['poems', 'products'] });

    if (optionalAuth?.firebaseClaims && optionalAuth.firebaseIdToken) {
      await syncWorkVoteToFirestore(
        {
          targetType: 'poem',
          targetId: id,
          firebaseUid: optionalAuth.firebaseClaims.uid,
          rating: numericRating,
        },
        optionalAuth.firebaseIdToken
      );
    }

    const enriched = enrichPoem(poem, db, ipHash, optionalAuth?.account);
    res.json({ poem: enriched });
  });

  // Upload a photo for a reader's submitted poem (authenticated users)
  app.post('/api/poems/upload-image', uploadsLimiter, async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { dataUrl } = req.body as { dataUrl?: unknown };
    if (!dataUrl || typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'Файл зображення не передано.' });
      return;
    }

    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i);
    if (!match) {
      res.status(400).json({ error: 'Підтримуються лише зображення PNG, JPG, WEBP або GIF.' });
      return;
    }

    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > 6 * 1024 * 1024) {
      res.status(400).json({ error: 'Розмір зображення не повинен перевищувати 6 МБ.' });
      return;
    }

    let processedBuffer = buffer;
    try {
      processedBuffer = await sharp(buffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();
    } catch {
      processedBuffer = buffer;
    }

    const filename = `poem-sub-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), processedBuffer);
    missingUploadCache.delete(filename);

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      const mime = 'image/jpeg';
      try {
        cloudSynced = await saveMediaAssetToFirestore(filename, mime, processedBuffer, auth.firebaseIdToken);
      } catch {
        cloudSynced = false;
      }
    }

    res.status(201).json({ url: `/uploads/${filename}`, cloudSynced });
  });

  // Resolve one or multiple SoundCloud tracks for attaching to a reader's poem submission (authenticated users)
  app.post('/api/poems/resolve-soundcloud', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`poem-sc-resolve:${ipHash}`, 30, 10 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато запитів. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const body = req.body as { url?: unknown; urls?: unknown };
    const resolved = await resolvePoemSoundCloudTracksInput(body);
    if (!resolved.ok) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    res.json({ track: resolved.tracks[0], tracks: resolved.tracks });
  });

  // SSRF-protected image proxy for extracting color palette from external poem image URLs (authenticated users)
  app.get('/api/poems/image-proxy', async (req, res) => {
    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Потрібен параметр url.' });
      return;
    }

    let currentValid = await validateExternalImageUrlForProxy(rawUrl);
    if (!currentValid) {
      res.status(400).json({ error: 'Недозволений або небезпечний URL зображення.' });
      return;
    }

    try {
      let response: globalThis.Response | null = null;
      for (let hop = 0; hop < 4; hop += 1) {
        const resHop = await fetch(currentValid.url.toString(), {
          method: 'GET',
          redirect: 'manual',
          headers: {
            Accept: 'image/*,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (compatible; LiteraryImagePalette/1.0)',
          },
          signal: AbortSignal.timeout(7000),
        });

        if (resHop.status >= 300 && resHop.status < 400) {
          const location = resHop.headers.get('location');
          if (!location) {
            res.status(400).json({ error: 'Не вдалося обробити перенаправлення зображення.' });
            return;
          }
          const nextTarget = new URL(location, currentValid.url).toString();
          const validatedNext = await validateExternalImageUrlForProxy(nextTarget);
          if (!validatedNext) {
            res.status(400).json({ error: 'Перенаправлення веде на недозволену адресу.' });
            return;
          }
          currentValid = validatedNext;
          continue;
        }

        response = resHop;
        break;
      }

      if (!response || !response.ok) {
        res.status(502).json({ error: 'Не вдалося завантажити зовнішнє зображення.' });
        return;
      }

      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) {
        res.status(400).json({ error: 'Посилання не веде на зображення.' });
        return;
      }

      const contentLengthHeader = Number(response.headers.get('content-length') || 0);
      if (contentLengthHeader > 5 * 1024 * 1024) {
        res.status(413).json({ error: 'Зображення занадто велике (макс. 5 МБ).' });
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
        res.status(413).json({ error: 'Зображення занадто велике (макс. 5 МБ).' });
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(Buffer.from(arrayBuffer));
    } catch {
      res.status(502).json({ error: 'Не вдалося обробити зовнішнє зображення.' });
    }
  });

  // Get current authenticated user's submitted poems & moderation statuses
  app.get('/api/poems/my-submissions', async (req, res) => {
    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const fbUid = auth.firebaseClaims?.uid || auth.account.googleUid || '';
    if (fbUid && auth.firebaseIdToken) {
      const hydrated = await hydrateUserPoemSubmissionsFromFirestore(db, fbUid, auth.firebaseIdToken);
      if (hydrated) {
        saveDatabase(db);
      }
    }

    const items = (db.poemSubmissions || [])
      .filter(
        (sub) =>
          (fbUid && sub.authorUid === fbUid) ||
          sub.authorUid === auth.account.uid ||
          sub.guestUid === auth.account.uid
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    res.json({ submissions: items });
  });

  // Propose/submit a reader's own poem (with optional photo & SoundCloud song) for admin moderation
  app.post('/api/poems/submissions', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`poem-submit:${ipHash}`, 10, 10 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато поданих віршів за короткий час. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const body = req.body as {
      title?: unknown;
      cycle?: unknown;
      content?: unknown;
      note?: unknown;
      authorName?: unknown;
      workStatus?: unknown;
      fontSize?: unknown;
      textAlign?: unknown;
      lineSpacing?: unknown;
      textColor?: unknown;
      backgroundColor?: unknown;
      imageUrl?: unknown;
      imagePalette?: unknown;
      soundcloudTrack?: unknown;
      soundcloudTracks?: unknown;
    };

    const cleanTitle = typeof body.title === 'string' ? body.title.trim() : '';
    if (!cleanTitle || cleanTitle.length > 200) {
      res.status(400).json({ error: 'Назва вірша має містити від 1 до 200 символів.' });
      return;
    }

    const cleanContent = typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
    if (!cleanContent || cleanContent.length > 50000) {
      res.status(400).json({ error: 'Текст вірша має містити від 1 до 50 000 символів.' });
      return;
    }

    const cleanCycle = typeof body.cycle === 'string' ? body.cycle.trim().slice(0, 160) : '';
    const cleanNote = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : undefined;
    const cleanWorkStatus: ProseStatus = body.workStatus === 'in_progress' ? 'in_progress' : 'completed';
    const cleanAuthorName = (
      (typeof body.authorName === 'string' && body.authorName.trim()) ||
      auth.account.displayName ||
      'Читач'
    )
      .trim()
      .slice(0, 80);

    let cleanImageUrl: string | undefined;
    if (body.imageUrl !== undefined && body.imageUrl !== null && body.imageUrl !== '') {
      cleanImageUrl = sanitizePoemImageUrl(body.imageUrl);
      if (!cleanImageUrl) {
        res.status(400).json({ error: 'Некоректне посилання на фото для вірша.' });
        return;
      }
    }

    const cleanImagePalette =
      cleanImageUrl && body.imagePalette ? sanitizePoemImagePalette(body.imagePalette) : undefined;

    let cleanSoundCloudTracks: PoemSoundCloudTrack[] = [];
    if (body.soundcloudTracks !== undefined && body.soundcloudTracks !== null) {
      if (!Array.isArray(body.soundcloudTracks)) {
        res.status(400).json({ error: 'Некоректний список SoundCloud-треків.' });
        return;
      }
      cleanSoundCloudTracks = sanitizePoemSoundCloudTracks(body.soundcloudTracks);
      if (body.soundcloudTracks.length > 0 && cleanSoundCloudTracks.length === 0) {
        res.status(400).json({ error: 'Некоректні дані SoundCloud-треків.' });
        return;
      }
    } else if (body.soundcloudTrack !== undefined && body.soundcloudTrack !== null) {
      const single = sanitizePoemSoundCloudTrack(body.soundcloudTrack);
      if (!single) {
        res.status(400).json({ error: 'Некоректні дані SoundCloud-треку.' });
        return;
      }
      cleanSoundCloudTracks = [single];
    }

    const validFontSize = ['sm', 'base', 'lg', 'xl', '2xl'].includes(String(body.fontSize))
      ? (body.fontSize as PoemSubmissionRecord['fontSize'])
      : undefined;
    const validTextAlign = ['left', 'center', 'right'].includes(String(body.textAlign))
      ? (body.textAlign as PoemSubmissionRecord['textAlign'])
      : undefined;
    const validLineSpacing = ['tight', 'normal', 'relaxed', 'loose'].includes(String(body.lineSpacing))
      ? (body.lineSpacing as PoemSubmissionRecord['lineSpacing'])
      : undefined;
    const validTextColor =
      typeof body.textColor === 'string' && body.textColor.trim()
        ? body.textColor.trim().slice(0, 32)
        : undefined;
    const validBackgroundColor =
      typeof body.backgroundColor === 'string' && body.backgroundColor.trim()
        ? body.backgroundColor.trim().slice(0, 32)
        : undefined;

    const nowIso = new Date().toISOString();
    const authorUid = auth.firebaseClaims?.uid || auth.account.googleUid || auth.account.uid;

    const submission: PoemSubmissionRecord = {
      id: `psub_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      authorUid,
      guestUid: auth.account.uid,
      authorName: cleanAuthorName,
      ...(auth.account.photoUrl ? { authorPhotoUrl: auth.account.photoUrl } : {}),
      title: cleanTitle,
      cycle: cleanCycle,
      year: new Date().getFullYear() || 2026,
      content: cleanContent,
      ...(cleanNote ? { note: cleanNote } : {}),
      ...(validFontSize ? { fontSize: validFontSize } : {}),
      ...(validTextAlign ? { textAlign: validTextAlign } : {}),
      ...(validLineSpacing ? { lineSpacing: validLineSpacing } : {}),
      ...(validTextColor ? { textColor: validTextColor } : {}),
      ...(validBackgroundColor ? { backgroundColor: validBackgroundColor } : {}),
      ...(cleanImageUrl ? { imageUrl: cleanImageUrl } : {}),
      ...(cleanImagePalette ? { imagePalette: cleanImagePalette } : {}),
      ...(cleanSoundCloudTracks.length > 0
        ? {
            soundcloudTrack: cleanSoundCloudTracks[0],
            soundcloudTracks: cleanSoundCloudTracks,
          }
        : {}),
      status: 'pending',
      workStatus: cleanWorkStatus,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (!Array.isArray(db.poemSubmissions)) {
      db.poemSubmissions = [];
    }
    db.poemSubmissions.unshift(submission);
    saveDatabase(db);

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      cloudSynced = await syncPoemSubmissionToFirestore(submission, auth.firebaseIdToken);
    }

    res.status(201).json({ submission, cloudSynced });
  });

  // Update/edit user's own poem submission from cabinet (resets moderation status to 'pending' and unpublishes until admin re-approval)
  app.put('/api/poems/submissions/:id', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { id } = req.params;
    const fbUid = auth.firebaseClaims?.uid || auth.account.googleUid || '';
    if (fbUid && auth.firebaseIdToken && !(db.poemSubmissions || []).some((s) => s.id === id)) {
      const hydrated = await hydrateUserPoemSubmissionsFromFirestore(db, fbUid, auth.firebaseIdToken);
      if (hydrated) saveDatabase(db);
    }

    const submission = (db.poemSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const isOwner =
      (fbUid && submission.authorUid === fbUid) ||
      submission.authorUid === auth.account.uid ||
      submission.guestUid === auth.account.uid;
    if (!isOwner) {
      res.status(403).json({ error: 'Ви можете редагувати лише власні твори.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    if (body.title !== undefined) {
      const cleanTitle = typeof body.title === 'string' ? body.title.trim() : '';
      if (!cleanTitle || cleanTitle.length > 200) {
        res.status(400).json({ error: 'Назва вірша має містити від 1 до 200 символів.' });
        return;
      }
      submission.title = cleanTitle;
    }
    if (body.cycle !== undefined) {
      submission.cycle = typeof body.cycle === 'string' ? body.cycle.trim().slice(0, 160) : '';
    }
    if (body.content !== undefined) {
      const cleanContent = typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
      if (!cleanContent || cleanContent.length > 50000) {
        res.status(400).json({ error: 'Текст вірша має містити від 1 до 50 000 символів.' });
        return;
      }
      submission.content = cleanContent;
    }
    if (body.note !== undefined) {
      submission.note =
        typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : undefined;
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }

    // Return work to moderation and unpublish previously live copy until admin re-approval
    submission.status = 'pending';
    submission.moderationNote = undefined;
    submission.updatedAt = new Date().toISOString();

    const beforePoems = db.poems.length;
    db.poems = db.poems.filter(
      (p) => p.submissionId !== submission.id && (!submission.publishedPoemId || p.id !== submission.publishedPoemId)
    );
    const unpublishedLive = db.poems.length !== beforePoems;

    saveDatabase(db);

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      cloudSynced = await syncPoemSubmissionToFirestore(submission, auth.firebaseIdToken);
    }

    res.json({ submission, unpublishedLive, cloudSynced });
  });

  // Upload an optional moodboard/cover photo for a reader's submitted prose work (authenticated users)
  app.post('/api/prose/upload-image', uploadsLimiter, async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { dataUrl } = req.body as { dataUrl?: unknown };
    if (!dataUrl || typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'Файл зображення не передано.' });
      return;
    }

    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i);
    if (!match) {
      res.status(400).json({ error: 'Підтримуються лише зображення PNG, JPG, WEBP або GIF.' });
      return;
    }

    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > 6 * 1024 * 1024) {
      res.status(400).json({ error: 'Розмір зображення не повинен перевищувати 6 МБ.' });
      return;
    }

    let processedBuffer = buffer;
    try {
      processedBuffer = await sharp(buffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();
    } catch {
      processedBuffer = buffer;
    }

    const filename = `prose-sub-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), processedBuffer);
    missingUploadCache.delete(filename);

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      const mime = 'image/jpeg';
      try {
        cloudSynced = await saveMediaAssetToFirestore(filename, mime, processedBuffer, auth.firebaseIdToken);
      } catch {
        cloudSynced = false;
      }
    }

    res.status(201).json({ url: `/uploads/${filename}`, cloudSynced });
  });

  // Get current authenticated user's submitted prose works & moderation statuses
  app.get('/api/prose/my-submissions', async (req, res) => {
    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const fbUid = auth.firebaseClaims?.uid || auth.account.googleUid || '';
    if (fbUid && auth.firebaseIdToken) {
      const hydrated = await hydrateUserProseSubmissionsFromFirestore(db, fbUid, auth.firebaseIdToken);
      if (hydrated) {
        saveDatabase(db);
      }
    }

    const items = (db.proseSubmissions || [])
      .filter(
        (sub) =>
          (fbUid && sub.authorUid === fbUid) ||
          sub.authorUid === auth.account.uid ||
          sub.guestUid === auth.account.uid
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    res.json({ submissions: items });
  });

  // Propose/submit a reader's own prose work (with optional moodboard photos) for admin moderation
  app.post('/api/prose/submissions', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`prose-submit:${ipHash}`, 10, 10 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато поданих творів за короткий час. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const body = req.body as {
      title?: unknown;
      genre?: unknown;
      slogan?: unknown;
      excerpt?: unknown;
      content?: unknown;
      authorName?: unknown;
      workStatus?: unknown;
      moodboardUrls?: unknown;
    };

    const cleanTitle = typeof body.title === 'string' ? body.title.trim() : '';
    if (!cleanTitle || cleanTitle.length > 240) {
      res.status(400).json({ error: 'Назва твору має містити від 1 до 240 символів.' });
      return;
    }

    const cleanContent = typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
    if (!cleanContent || cleanContent.length > 250000) {
      res.status(400).json({ error: 'Текст твору має містити від 1 до 250 000 символів.' });
      return;
    }

    const cleanGenre =
      typeof body.genre === 'string' && body.genre.trim()
        ? body.genre.trim().slice(0, 120)
        : 'Оповідання';
    const cleanSlogan =
      typeof body.slogan === 'string' && body.slogan.trim()
        ? body.slogan.trim().slice(0, 500)
        : undefined;
    const rawExcerpt =
      typeof body.excerpt === 'string' && body.excerpt.trim()
        ? body.excerpt.trim().slice(0, 2000)
        : '';
    const cleanExcerpt =
      rawExcerpt || getFirstFormattedExcerptLine(cleanContent, 240);
    const cleanWorkStatus: ProseStatus = body.workStatus === 'in_progress' ? 'in_progress' : 'completed';
    const cleanAuthorName = (
      (typeof body.authorName === 'string' && body.authorName.trim()) ||
      auth.account.displayName ||
      'Читач'
    )
      .trim()
      .slice(0, 80);

    let cleanMoodboardUrls: string[] | undefined;
    if (Array.isArray(body.moodboardUrls)) {
      const normalized = Array.from(
        new Set(
          body.moodboardUrls
            .map((item) => sanitizePoemImageUrl(item))
            .filter((item): item is string => Boolean(item))
        )
      ).slice(0, 8);
      if (normalized.length > 0) {
        cleanMoodboardUrls = normalized;
      }
    }

    const computedPages = computeProseWorkPages({ content: cleanContent, fallbackPages: 1 });
    const computedWords = countProseWords(cleanContent);
    const nowIso = new Date().toISOString();
    const authorUid = auth.firebaseClaims?.uid || auth.account.googleUid || auth.account.uid;

    const submission: ProseSubmissionRecord = {
      id: `prsub_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      authorUid,
      guestUid: auth.account.uid,
      authorName: cleanAuthorName,
      ...(auth.account.photoUrl ? { authorPhotoUrl: auth.account.photoUrl } : {}),
      title: cleanTitle,
      genre: cleanGenre,
      ...(cleanSlogan ? { slogan: cleanSlogan } : {}),
      ...(cleanExcerpt ? { excerpt: cleanExcerpt } : {}),
      content: cleanContent,
      pages: computedPages,
      totalWords: computedWords,
      ...(cleanMoodboardUrls ? { moodboardUrls: cleanMoodboardUrls } : {}),
      status: 'pending',
      workStatus: cleanWorkStatus,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (!Array.isArray(db.proseSubmissions)) {
      db.proseSubmissions = [];
    }
    db.proseSubmissions.unshift(submission);
    saveDatabase(db);

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      cloudSynced = await syncProseSubmissionToFirestore(submission, auth.firebaseIdToken);
    }

    res.status(201).json({ submission, cloudSynced });
  });

  // Update/edit user's own prose submission from cabinet (resets moderation status to 'pending' and unpublishes until admin re-approval)
  app.put('/api/prose/submissions/:id', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { id } = req.params;
    const fbUid = auth.firebaseClaims?.uid || auth.account.googleUid || '';
    if (fbUid && auth.firebaseIdToken && !(db.proseSubmissions || []).some((s) => s.id === id)) {
      const hydrated = await hydrateUserProseSubmissionsFromFirestore(db, fbUid, auth.firebaseIdToken);
      if (hydrated) saveDatabase(db);
    }

    const submission = (db.proseSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const isOwner =
      (fbUid && submission.authorUid === fbUid) ||
      submission.authorUid === auth.account.uid ||
      submission.guestUid === auth.account.uid;
    if (!isOwner) {
      res.status(403).json({ error: 'Ви можете редагувати лише власні твори.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    if (body.title !== undefined) {
      const cleanTitle = typeof body.title === 'string' ? body.title.trim() : '';
      if (!cleanTitle || cleanTitle.length > 240) {
        res.status(400).json({ error: 'Назва твору має містити від 1 до 240 символів.' });
        return;
      }
      submission.title = cleanTitle;
    }
    if (body.genre !== undefined) {
      submission.genre =
        typeof body.genre === 'string' && body.genre.trim()
          ? body.genre.trim().slice(0, 120)
          : 'Оповідання';
    }
    if (body.slogan !== undefined) {
      submission.slogan =
        typeof body.slogan === 'string' && body.slogan.trim()
          ? body.slogan.trim().slice(0, 500)
          : undefined;
    }
    if (body.excerpt !== undefined) {
      submission.excerpt =
        typeof body.excerpt === 'string' && body.excerpt.trim()
          ? body.excerpt.trim().slice(0, 2000)
          : undefined;
    }
    if (body.content !== undefined) {
      const cleanContent = typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
      if (!cleanContent || cleanContent.length > 250000) {
        res.status(400).json({ error: 'Текст твору має містити від 1 до 250 000 символів.' });
        return;
      }
      submission.content = cleanContent;
      submission.pages = computeProseWorkPages({ content: cleanContent, fallbackPages: 1 });
      submission.totalWords = countProseWords(cleanContent);
      if (!submission.excerpt) {
        submission.excerpt = getFirstFormattedExcerptLine(cleanContent, 240) || undefined;
      }
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }

    // Return work to moderation and unpublish previously live copy until admin re-approval
    submission.status = 'pending';
    submission.moderationNote = undefined;
    submission.updatedAt = new Date().toISOString();

    const beforeProse = db.prose.length;
    db.prose = db.prose.filter(
      (w) => w.submissionId !== submission.id && (!submission.publishedProseId || w.id !== submission.publishedProseId)
    );
    const unpublishedLive = db.prose.length !== beforeProse;

    saveDatabase(db);

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      cloudSynced = await syncProseSubmissionToFirestore(submission, auth.firebaseIdToken);
    }

    res.json({ submission, unpublishedLive, cloudSynced });
  });

  // Rate a prose work (0.1 to 5.0), strictly once per unique user/IP
  app.post('/api/prose/:id/rate', async (req, res) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const { id } = req.params;
    const { rating } = req.body as { rating?: number };
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);

    const work = db.prose.find((p) => p.id === id);
    if (!work) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const numericRating = parseDecimalRating(rating);
    if (numericRating === null) {
      res.status(400).json({ error: 'Оцінка має бути від 0.1 до 5.0.' });
      return;
    }

    const ipHash = getClientIpHash(req);
    if (!db.proseVotes[id]) {
      db.proseVotes[id] = {};
    }

    const { primaryKey, lookupKeys } = getEffectiveVoteKeys(ipHash, optionalAuth?.account);
    const existingVote = findUserRatingInVotes(db.proseVotes[id], lookupKeys);
    if (existingVote !== null) {
      const enriched = enrichProseForPublic(work, db, ipHash, Boolean(optionalAuth), false, undefined, optionalAuth?.account);
      res.status(409).json({
        error: 'Ви вже оцінили цей твір.',
        alreadyRated: true,
        prose: enriched,
      });
      return;
    }

    db.proseVotes[id][primaryKey] = numericRating;
    recordWeeklyVoteLog(db, {
      targetType: 'prose',
      targetId: id,
      voterKey: primaryKey,
      rating: numericRating,
    });
    recordRecentRating(db, {
      targetType: 'prose',
      targetId: id,
      rating: numericRating,
      authorUid: optionalAuth?.firebaseClaims?.uid || optionalAuth?.account.googleUid || optionalAuth?.account.uid,
      authorName: optionalAuth?.account.displayName,
      authorPhotoUrl: optionalAuth?.account.photoUrl,
    });
    saveDatabase(db, { flushDelayMs: 1500, slices: ['prose', 'poems', 'products'] });

    if (optionalAuth?.firebaseClaims && optionalAuth.firebaseIdToken) {
      await syncWorkVoteToFirestore(
        {
          targetType: 'prose',
          targetId: id,
          firebaseUid: optionalAuth.firebaseClaims.uid,
          rating: numericRating,
        },
        optionalAuth.firebaseIdToken
      );
    }

    const enriched = enrichProseForPublic(work, db, ipHash, Boolean(optionalAuth), false, undefined, optionalAuth?.account);
    res.json({ prose: enriched });
  });

  // Submit guest review + optional rating (0.1..5.0) for Poem, Prose, or Book/Product
  app.post('/api/reviews', reviewsPostLimiter, async (req, res) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const { targetType, targetId, rating, comment, authorUid, authorName, authorPhotoUrl } = req.body as {
      targetType?: 'poem' | 'prose' | 'product';
      targetId?: string;
      rating?: number | null;
      comment?: string;
      authorUid?: string;
      authorName?: string;
      authorPhotoUrl?: string;
    };

    if ((targetType !== 'poem' && targetType !== 'prose' && targetType !== 'product') || !targetId) {
      res.status(400).json({ error: 'Некоректний об’єкт відгуку.' });
      return;
    }

    const ipHash = getClientIpHash(req);
    const cleanName = (optionalAuth?.account.displayName || authorName?.trim() || 'Гість').slice(0, 80);
    const cleanUid = (
      optionalAuth?.firebaseClaims?.uid ||
      optionalAuth?.account.googleUid ||
      optionalAuth?.account.uid ||
      authorUid?.trim() ||
      `guest_anon_${ipHash.slice(0, 12)}`
    ).slice(0, 128);
    const clientPhoto = typeof authorPhotoUrl === 'string' ? authorPhotoUrl.trim() : '';
    const resolvedPhotoUrl =
      optionalAuth?.account.photoUrl ||
      (clientPhoto && /^https?:\/\//i.test(clientPhoto) ? clientPhoto : undefined);
    const cleanComment = comment?.trim() || '';
    const hasComment = cleanComment.length > 0;
    const hasRatingInput = rating !== undefined && rating !== null;
    const numericRating = hasRatingInput ? parseDecimalRating(rating) : null;

    if (hasRatingInput && numericRating === null) {
      res.status(400).json({ error: 'Оцінка має бути від 0.1 до 5.0.' });
      return;
    }
    if (!hasRatingInput && !hasComment) {
      res.status(400).json({ error: 'Оберіть оцінку або напишіть коментар.' });
      return;
    }
    if (cleanComment.length > 1500) {
      res.status(400).json({ error: 'Текст відгуку не повинен перевищувати 1500 символів.' });
      return;
    }

    const { primaryKey: votePrimaryKey, lookupKeys: voteLookupKeys } = getEffectiveVoteKeys(
      ipHash,
      optionalAuth?.account
    );

    if (targetType === 'poem') {
      const poem = db.poems.find((p) => p.id === targetId);
      if (!poem) {
        res.status(404).json({ error: 'Вірш не знайдено.' });
        return;
      }

      if (!db.poemVotes[targetId]) db.poemVotes[targetId] = {};
      const existingVote = findUserRatingInVotes(db.poemVotes[targetId], voteLookupKeys);
      const alreadyRatedIp = existingVote !== null;
      if (numericRating !== null && !alreadyRatedIp) {
        db.poemVotes[targetId][votePrimaryKey] = numericRating;
        recordWeeklyVoteLog(db, {
          targetType: 'poem',
          targetId,
          voterKey: votePrimaryKey,
          rating: numericRating,
        });
      }

      const finalVoteRating =
        numericRating !== null
          ? alreadyRatedIp
            ? existingVote
            : numericRating
          : null;

      let review: ReviewItem | null = null;
      if (hasComment) {
        review = {
          id: `rev_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          targetType: 'poem',
          targetId,
          authorUid: cleanUid,
          authorName: cleanName,
          authorPhotoUrl: resolvedPhotoUrl,
          rating: finalVoteRating,
          comment: cleanComment,
          createdAt: new Date().toISOString(),
        };
        db.reviews.unshift(review);
      } else if (numericRating !== null && !alreadyRatedIp) {
        recordRecentRating(db, {
          targetType: 'poem',
          targetId,
          rating: numericRating,
          authorUid: cleanUid,
          authorName: cleanName,
          authorPhotoUrl: resolvedPhotoUrl,
        });
      }

      if ((numericRating !== null && !alreadyRatedIp) || hasComment) {
        saveDatabase(db, { flushDelayMs: 1500, slices: ['poems', 'products'] });
      }

      if (optionalAuth?.firebaseClaims && optionalAuth.firebaseIdToken) {
        const fbUid = optionalAuth.firebaseClaims.uid;
        const fbToken = optionalAuth.firebaseIdToken;
        const cloudTasks: Promise<unknown>[] = [];
        if (numericRating !== null && !alreadyRatedIp) {
          cloudTasks.push(
            syncWorkVoteToFirestore(
              { targetType: 'poem', targetId, firebaseUid: fbUid, rating: numericRating },
              fbToken
            )
          );
        }
        if (review) {
          cloudTasks.push(
            syncReviewToFirestore(
              {
                id: review.id,
                targetType: 'poem',
                targetId,
                firebaseUid: fbUid,
                authorName: review.authorName,
                authorPhotoUrl: review.authorPhotoUrl,
                rating: review.rating,
                comment: review.comment,
              },
              fbToken
            )
          );
        }
        if (cloudTasks.length > 0) {
          await Promise.allSettled(cloudTasks);
        }
      }

      const badgeLookup = createBadgeLookup(db);
      const photoLookup = createAccountPhotoLookup(db);
      res.status(201).json({
        review: review ? enrichReviewWithBadges(review, badgeLookup, photoLookup) : null,
        ratingOnly: !hasComment,
        commentOnly: numericRating === null,
        alreadyRatedIp: numericRating !== null && alreadyRatedIp,
        appliedRating: finalVoteRating,
        poem: enrichPoem(poem, db, ipHash, optionalAuth?.account, badgeLookup, photoLookup),
      });
      return;
    }

    if (targetType === 'prose') {
      const work = db.prose.find((p) => p.id === targetId);
      if (!work) {
        res.status(404).json({ error: 'Прозовий твір не знайдено.' });
        return;
      }

      if (!db.proseVotes[targetId]) db.proseVotes[targetId] = {};
      const existingVote = findUserRatingInVotes(db.proseVotes[targetId], voteLookupKeys);
      const alreadyRatedIp = existingVote !== null;
      if (numericRating !== null && !alreadyRatedIp) {
        db.proseVotes[targetId][votePrimaryKey] = numericRating;
        recordWeeklyVoteLog(db, {
          targetType: 'prose',
          targetId,
          voterKey: votePrimaryKey,
          rating: numericRating,
        });
      }

      const finalVoteRating =
        numericRating !== null
          ? alreadyRatedIp
            ? existingVote
            : numericRating
          : null;

      let review: ReviewItem | null = null;
      if (hasComment) {
        review = {
          id: `rev_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          targetType: 'prose',
          targetId,
          authorUid: cleanUid,
          authorName: cleanName,
          authorPhotoUrl: resolvedPhotoUrl,
          rating: finalVoteRating,
          comment: cleanComment,
          createdAt: new Date().toISOString(),
        };
        db.reviews.unshift(review);
      } else if (numericRating !== null && !alreadyRatedIp) {
        recordRecentRating(db, {
          targetType: 'prose',
          targetId,
          rating: numericRating,
          authorUid: cleanUid,
          authorName: cleanName,
          authorPhotoUrl: resolvedPhotoUrl,
        });
      }

      if ((numericRating !== null && !alreadyRatedIp) || hasComment) {
        saveDatabase(db, { flushDelayMs: 1500, slices: ['prose', 'poems', 'products'] });
      }

      if (optionalAuth?.firebaseClaims && optionalAuth.firebaseIdToken) {
        const fbUid = optionalAuth.firebaseClaims.uid;
        const fbToken = optionalAuth.firebaseIdToken;
        const cloudTasks: Promise<unknown>[] = [];
        if (numericRating !== null && !alreadyRatedIp) {
          cloudTasks.push(
            syncWorkVoteToFirestore(
              { targetType: 'prose', targetId, firebaseUid: fbUid, rating: numericRating },
              fbToken
            )
          );
        }
        if (review) {
          cloudTasks.push(
            syncReviewToFirestore(
              {
                id: review.id,
                targetType: 'prose',
                targetId,
                firebaseUid: fbUid,
                authorName: review.authorName,
                authorPhotoUrl: review.authorPhotoUrl,
                rating: review.rating,
                comment: review.comment,
              },
              fbToken
            )
          );
        }
        if (cloudTasks.length > 0) {
          await Promise.allSettled(cloudTasks);
        }
      }

      const badgeLookup = createBadgeLookup(db);
      const photoLookup = createAccountPhotoLookup(db);
      res.status(201).json({
        review: review ? enrichReviewWithBadges(review, badgeLookup, photoLookup) : null,
        ratingOnly: !hasComment,
        commentOnly: numericRating === null,
        alreadyRatedIp: numericRating !== null && alreadyRatedIp,
        appliedRating: finalVoteRating,
        prose: enrichProseForPublic(work, db, ipHash, Boolean(optionalAuth), false, badgeLookup, optionalAuth?.account, photoLookup),
      });
      return;
    }

    // Product / book review
    const product = db.products.find((p) => p.id === targetId);
    if (!product) {
      res.status(404).json({ error: 'Книгу не знайдено.' });
      return;
    }

    if (!db.productVotes[targetId]) db.productVotes[targetId] = {};
    const existingVote = findUserRatingInVotes(db.productVotes[targetId], voteLookupKeys);
    const alreadyRatedIp = existingVote !== null;
    if (numericRating !== null && !alreadyRatedIp) {
      db.productVotes[targetId][votePrimaryKey] = numericRating;
    }

    const finalVoteRating =
      numericRating !== null
        ? alreadyRatedIp
          ? existingVote
          : numericRating
        : null;

    let review: ReviewItem | null = null;
    if (hasComment) {
      review = {
        id: `rev_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        targetType: 'product',
        targetId,
        authorUid: cleanUid,
        authorName: cleanName,
        authorPhotoUrl: resolvedPhotoUrl,
        rating: finalVoteRating,
        comment: cleanComment,
        createdAt: new Date().toISOString(),
      };
      db.reviews.unshift(review);
    } else if (numericRating !== null && !alreadyRatedIp) {
      recordRecentRating(db, {
        targetType: 'product',
        targetId,
        rating: numericRating,
        authorUid: cleanUid,
        authorName: cleanName,
        authorPhotoUrl: resolvedPhotoUrl,
      });
    }

    if ((numericRating !== null && !alreadyRatedIp) || hasComment) {
      saveDatabase(db, { flushDelayMs: 1500, slices: ['products'] });
    }

    if (optionalAuth?.firebaseClaims && optionalAuth.firebaseIdToken) {
      const fbUid = optionalAuth.firebaseClaims.uid;
      const fbToken = optionalAuth.firebaseIdToken;
      const cloudTasks: Promise<unknown>[] = [];
      if (numericRating !== null && !alreadyRatedIp) {
        cloudTasks.push(
          syncWorkVoteToFirestore(
            { targetType: 'product', targetId, firebaseUid: fbUid, rating: numericRating },
            fbToken
          )
        );
      }
      if (review) {
        cloudTasks.push(
          syncReviewToFirestore(
            {
              id: review.id,
              targetType: 'product',
              targetId,
              firebaseUid: fbUid,
              authorName: review.authorName,
              authorPhotoUrl: review.authorPhotoUrl,
              rating: review.rating,
              comment: review.comment,
            },
            fbToken
          )
        );
      }
      if (cloudTasks.length > 0) {
        await Promise.allSettled(cloudTasks);
      }
    }

    const badgeLookup = createBadgeLookup(db);
    const photoLookup = createAccountPhotoLookup(db);
    res.status(201).json({
      review: review ? enrichReviewWithBadges(review, badgeLookup, photoLookup) : null,
      ratingOnly: !hasComment,
      commentOnly: numericRating === null,
      alreadyRatedIp: numericRating !== null && alreadyRatedIp,
      appliedRating: finalVoteRating,
      product: enrichProductForPublic(product, db, ipHash, badgeLookup, photoLookup, optionalAuth?.account),
    });
  });

  // Edit review comment (Admin or comment author)
  app.patch('/api/reviews/:id', async (req, res) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);

    const adminAuth = await authenticateAdminRequest(req);
    const guestAuth = await authenticateGuestRequest(req, db);
    const isAdminActor = adminAuth.ok || (guestAuth.ok && guestAuth.isAdmin);
    const guestAccount = guestAuth.ok ? guestAuth.account : null;

    if (!isAdminActor && !guestAuth.ok) {
      res.status(401).json({ error: 'Потрібно увійти в акаунт, щоб редагувати коментарі.' });
      return;
    }

    const reviewId = req.params.id;
    const review = db.reviews.find((r) => r.id === reviewId);
    if (!review) {
      res.status(404).json({ error: 'Коментар не знайдено.' });
      return;
    }

    if (!isAdminActor) {
      const isOwner = Boolean(
        guestAuth.ok &&
          (guestAuth.account.uid === review.authorUid ||
            guestAuth.account.googleUid === review.authorUid ||
            guestAuth.firebaseClaims?.uid === review.authorUid)
      );
      if (!isOwner) {
        res.status(403).json({ error: 'Редагування дозволено лише автору коментаря або адміністратору.' });
        return;
      }
    }

    const { comment } = req.body as { comment?: string };
    const cleanComment = typeof comment === 'string' ? comment.trim().slice(0, 1500) : '';
    if (!cleanComment) {
      res.status(400).json({ error: 'Текст коментаря не може бути порожнім.' });
      return;
    }

    review.comment = cleanComment;
    saveDatabase(db, { flushDelayMs: 1500, slices: ['products'] });

    const bearerToken = extractBearerToken(req);
    const firebaseToken =
      (guestAuth.ok ? guestAuth.firebaseIdToken : undefined) ||
      (bearerToken && !bearerToken.startsWith('guest_v1.') ? bearerToken : undefined);
    if (firebaseToken) {
      void updateSingleReviewInFirestore(reviewId, cleanComment, firebaseToken);
    }

    const ipHash = getClientIpHash(req);
    const badgeLookup = createBadgeLookup(db);
    const photoLookup = createAccountPhotoLookup(db);
    const enrichedReview = enrichReviewWithBadges(review, badgeLookup, photoLookup);

    let updatedPoem: Poem | undefined;
    let updatedProse: ProseWork | undefined;
    let updatedProduct: StoreProduct | undefined;

    if (review.targetType === 'poem') {
      const poem = db.poems.find((p) => p.id === review.targetId);
      if (poem) {
        updatedPoem = enrichPoem(poem, db, ipHash, guestAccount ?? undefined, badgeLookup, photoLookup);
      }
    } else if (review.targetType === 'prose') {
      const prose = db.prose.find((p) => p.id === review.targetId);
      if (prose) {
        updatedProse = enrichProseForPublic(
          prose,
          db,
          ipHash,
          Boolean(guestAccount || isAdminActor),
          false,
          badgeLookup,
          guestAccount ?? undefined,
          photoLookup
        );
      }
    } else if (review.targetType === 'product') {
      const product = db.products.find((p) => p.id === review.targetId);
      if (product) {
        updatedProduct = enrichProductForPublic(
          product,
          db,
          ipHash,
          badgeLookup,
          photoLookup,
          guestAccount ?? undefined
        );
      }
    }

    res.json({
      success: true,
      review: enrichedReview,
      poem: updatedPoem,
      prose: updatedProse,
      product: updatedProduct,
    });
  });

  // Delete review comment (Admin or comment author)
  app.delete('/api/reviews/:id', async (req, res) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);

    const adminAuth = await authenticateAdminRequest(req);
    const guestAuth = await authenticateGuestRequest(req, db);
    const isAdminActor = adminAuth.ok || (guestAuth.ok && guestAuth.isAdmin);
    const guestAccount = guestAuth.ok ? guestAuth.account : null;

    if (!isAdminActor && !guestAuth.ok) {
      res.status(401).json({ error: 'Потрібно увійти в акаунт, щоб видаляти коментарі.' });
      return;
    }

    const reviewId = req.params.id;
    const reviewIndex = db.reviews.findIndex((r) => r.id === reviewId);
    if (reviewIndex === -1) {
      res.status(404).json({ error: 'Коментар не знайдено.' });
      return;
    }
    const review = db.reviews[reviewIndex];

    if (!isAdminActor) {
      const isOwner = Boolean(
        guestAuth.ok &&
          (guestAuth.account.uid === review.authorUid ||
            guestAuth.account.googleUid === review.authorUid ||
            guestAuth.firebaseClaims?.uid === review.authorUid)
      );
      if (!isOwner) {
        res.status(403).json({ error: 'Видалення дозволено лише автору коментаря або адміністратору.' });
        return;
      }
    }

    const [removedReview] = db.reviews.splice(reviewIndex, 1);
    saveDatabase(db, { flushDelayMs: 1500, slices: ['products'] });

    const bearerToken = extractBearerToken(req);
    const firebaseToken =
      (guestAuth.ok ? guestAuth.firebaseIdToken : undefined) ||
      (bearerToken && !bearerToken.startsWith('guest_v1.') ? bearerToken : undefined);
    if (firebaseToken) {
      void deleteSingleReviewInFirestore(reviewId, firebaseToken);
    }

    const ipHash = getClientIpHash(req);
    const badgeLookup = createBadgeLookup(db);
    const photoLookup = createAccountPhotoLookup(db);

    let updatedPoem: Poem | undefined;
    let updatedProse: ProseWork | undefined;
    let updatedProduct: StoreProduct | undefined;

    if (removedReview.targetType === 'poem') {
      const poem = db.poems.find((p) => p.id === removedReview.targetId);
      if (poem) {
        updatedPoem = enrichPoem(poem, db, ipHash, guestAccount ?? undefined, badgeLookup, photoLookup);
      }
    } else if (removedReview.targetType === 'prose') {
      const prose = db.prose.find((p) => p.id === removedReview.targetId);
      if (prose) {
        updatedProse = enrichProseForPublic(
          prose,
          db,
          ipHash,
          Boolean(guestAccount || isAdminActor),
          false,
          badgeLookup,
          guestAccount ?? undefined,
          photoLookup
        );
      }
    } else if (removedReview.targetType === 'product') {
      const product = db.products.find((p) => p.id === removedReview.targetId);
      if (product) {
        updatedProduct = enrichProductForPublic(
          product,
          db,
          ipHash,
          badgeLookup,
          photoLookup,
          guestAccount ?? undefined
        );
      }
    }

    res.json({
      success: true,
      reviewId,
      poem: updatedPoem,
      prose: updatedProse,
      product: updatedProduct,
    });
  });

  // Author studio catalog: includes full fields for editing + decrypted & verified orders for fulfillment
  app.get('/api/author/catalog', async (req, res) => {
    const db = ensureDatabase();
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      const [poemSubsHydrated, proseSubsHydrated, ordersHydrated, feedbackHydrated] = await Promise.all([
        hydrateAdminPoemSubmissionsFromFirestore(db, adminToken),
        hydrateAdminProseSubmissionsFromFirestore(db, adminToken),
        hydrateAdminOrdersFromFirestore(db, adminToken),
        hydrateAdminSiteFeedbackFromFirestore(db, adminToken),
      ]);
      if (poemSubsHydrated || proseSubsHydrated || ordersHydrated || feedbackHydrated) {
        saveDatabase(db, { ordersDirty: ordersHydrated });
      }
    }
    const adminOrders: OrderRecord[] = db.orders.map((order) => {
      const integrityVerified = order.payment?.receiptSignature ? verifyOrderReceipt(order) : false;
      if (order.encryptedPii) {
        const decrypted = decryptOrderPii(order.encryptedPii, order.orderCode);
        if (decrypted) {
          return {
            ...order,
            buyerName: decrypted.buyerName,
            buyerEmail: decrypted.buyerEmail,
            buyerNameMasked: order.buyerNameMasked || maskPersonName(decrypted.buyerName),
            buyerEmailMasked: order.buyerEmailMasked || maskEmailAddress(decrypted.buyerEmail),
            shipping: decrypted.shipping,
            integrityVerified,
            piiLocked: false,
          };
        }
        return {
          ...order,
          buyerName: order.buyerNameMasked || 'Зашифровано',
          buyerEmail: order.buyerEmailMasked || 'Зашифровано',
          buyerNameMasked: order.buyerNameMasked || 'Зашифровано',
          buyerEmailMasked: order.buyerEmailMasked || 'Зашифровано',
          shipping: undefined,
          integrityVerified,
          piiLocked: true,
        };
      }
      return {
        ...order,
        buyerNameMasked: order.buyerNameMasked || maskPersonName(order.buyerName),
        buyerEmailMasked: order.buyerEmailMasked || maskEmailAddress(order.buyerEmail),
        integrityVerified,
        piiLocked: false,
      };
    });

    const sortedSubmissions = [...(db.poemSubmissions || [])].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    const sortedProseSubmissions = [...(db.proseSubmissions || [])].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    const pendingPoemSubmissionsCount = sortedSubmissions.filter((s) => s.status === 'pending').length;
    const pendingProseSubmissionsCount = sortedProseSubmissions.filter((s) => s.status === 'pending').length;

    res.json({
      heroLeadText: db.heroLeadText,
      authorAboutText: db.authorAboutText,
      authorPhotoUrl: db.authorPhotoUrl,
      authorPhotos: db.authorPhotos,
      socialLinks: db.socialLinks,
      monobankJarUrl: db.monobankJarUrl,
      monobankModalTitle: db.monobankModalTitle || DEFAULT_MONOBANK_MODAL_TITLE,
      monobankModalSubtitle: db.monobankModalSubtitle ?? DEFAULT_MONOBANK_MODAL_SUBTITLE,
      monobankCardLabel: db.monobankCardLabel ?? DEFAULT_MONOBANK_CARD_LABEL,
      monobankModalText: db.monobankModalText || DEFAULT_MONOBANK_MODAL_TEXT,
      monobankEmptyText: db.monobankEmptyText ?? DEFAULT_MONOBANK_EMPTY_TEXT,
      contactEmail: db.contactEmail,
      interviews: db.interviews,
      homeRepeaters: normalizeHomeRepeatersConfig(db.homeRepeaters),
      contactMessages: db.contactMessages,
      poems: db.poems,
      poemSubmissions: sortedSubmissions,
      pendingPoemSubmissionsCount,
      proseSubmissions: sortedProseSubmissions,
      pendingProseSubmissionsCount,
      pendingSubmissionsCount: pendingPoemSubmissionsCount + pendingProseSubmissionsCount,
      prose: db.prose.map((p) => enrichProseForAuthor(p, db)),
      proseTags: db.proseTags,
      blog: db.blog,
      products: db.products,
      radioTracks: db.radioTracks.map((t) => ({
        ...t,
        station: t.station === 'electronic' ? ('electronic' as const) : ('indie' as const),
      })),
      weeklyMusicSelections: [...(db.weeklyMusicSelections || [])].sort((a, b) =>
        b.periodStart !== a.periodStart
          ? b.periodStart.localeCompare(a.periodStart)
          : b.createdAt.localeCompare(a.createdAt)
      ),
      weeklyCurrentPeriod: getWeekPeriodForDate(),
      orders: adminOrders,
      ordersCount: adminOrders.length,
      siteFeedback: [...(db.feedback || [])].sort(
        (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
      ),
      unreadSiteFeedbackCount: (db.feedback || []).filter((f) => !f.readByAdmin && !f.adminReply).length,
      proseAuthDiscountPercent: db.proseAuthDiscountPercent ?? 0,
      proseTelegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
      storeAuthDiscountPercent: 0,
      uniqueVisitors: db.visitorIpHashes.length,
    });
  });

  // Author behavior analytics report (Admin-only)
  app.get('/api/author/analytics', (_req, res) => {
    const db = ensureDatabase();
    const { analytics } = db;

    const clicks = Object.values(analytics.clicksByTarget)
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 25);

    const dwell = Object.values(analytics.dwellByTarget)
      .map((item) => ({
        ...item,
        avgSeconds: Math.round(item.totalSeconds / Math.max(1, item.sessionsCount)),
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
      .slice(0, 25);

    const rawExits = Object.values(analytics.exitsByMoment).sort((a, b) => b.exits - a.exits);
    const totalExits = rawExits.reduce((sum, item) => sum + item.exits, 0);
    const exits = rawExits.slice(0, 25).map((item) => ({
      ...item,
      sharePercent: totalExits > 0 ? Math.round((item.exits / totalExits) * 100) : 0,
    }));

    const avgSessionSeconds =
      analytics.totalSessions > 0
        ? Math.round(analytics.totalTrackedSeconds / analytics.totalSessions)
        : 0;

    const report: AuthorAnalyticsReport = {
      summary: {
        totalSessions: analytics.totalSessions,
        totalClicks: analytics.totalClicks,
        totalTrackedSeconds: analytics.totalTrackedSeconds,
        avgSessionSeconds,
        totalExits,
        topClick: clicks[0] || null,
        topDwell: dwell[0] || null,
        topExit: exits[0] || null,
      },
      visits: buildVisitStatisticsReport(db),
      clicks,
      dwell,
      exits,
      recentEvents: analytics.recentEvents.slice(0, 30),
    };

    res.json(report);
  });

  app.delete('/api/author/analytics', (_req, res) => {
    const db = ensureDatabase();
    db.analytics = createEmptyAnalytics();
    db.poemViews = {};
    db.blogViews = {};
    db.visitorIpHashes = [];
    seenAnalyticsSessionsSet.clear();
    visitorIpSet.clear();
    saveDatabase(db, { flushDelayMs: 0, slices: ['analytics', 'poems', 'blog', 'community'] });
    res.json({ ok: true });
  });

  // Author Studio: List recorded donations & registered users for donor leaderboard
  app.get('/api/author/donations', (_req, res) => {
    const db = ensureDatabase();
    const users = [...db.guestAccounts]
      .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))
      .map((acc) => ({
        uid: acc.uid,
        displayName: acc.displayName,
        photoUrl: acc.photoUrl,
        createdAt: acc.createdAt,
      }));
    res.json({
      donations: db.donations,
      users,
    });
  });

  // Author Studio: Add a verified donor entry (linked to a registered user or standalone donor name)
  app.post('/api/author/donations', (req, res) => {
    const db = ensureDatabase();
    const { guestUid, displayName, amountUah, note, donatedAt } = req.body as {
      guestUid?: string;
      displayName?: string;
      amountUah?: number;
      note?: string;
      donatedAt?: string;
    };

    const parsedAmount = Math.round(Number(amountUah) || 0);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 1 || parsedAmount > 10_000_000) {
      res.status(400).json({ error: 'Вкажіть коректну суму донату від 1 ₴.' });
      return;
    }

    const cleanGuestUid = typeof guestUid === 'string' ? guestUid.trim() : '';
    const linkedAccount = cleanGuestUid
      ? db.guestAccounts.find((a) => a.uid === cleanGuestUid)
      : undefined;

    const cleanName = (
      (typeof displayName === 'string' && displayName.trim()) ||
      linkedAccount?.displayName ||
      ''
    )
      .trim()
      .slice(0, 80);

    if (cleanName.length < 1) {
      res.status(400).json({ error: 'Вкажіть ім’я донатера або оберіть користувача.' });
      return;
    }

    const cleanNote = typeof note === 'string' ? note.trim().slice(0, 200) : '';
    const parsedDateMs = typeof donatedAt === 'string' && donatedAt.trim() ? Date.parse(donatedAt) : NaN;
    const resolvedDate = Number.isFinite(parsedDateMs)
      ? new Date(parsedDateMs).toISOString()
      : new Date().toISOString();

    const record: DonorRecord = {
      id: `don_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      ...(linkedAccount ? { guestUid: linkedAccount.uid } : {}),
      displayName: cleanName,
      ...(linkedAccount?.photoUrl ? { photoUrl: linkedAccount.photoUrl } : {}),
      amountUah: parsedAmount,
      ...(cleanNote ? { note: cleanNote } : {}),
      donatedAt: resolvedDate,
    };

    db.donations.unshift(record);
    saveDatabase(db, { flushDelayMs: 500, slices: ['community'] });
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      void syncDonationToFirestore(record, adminToken);
    }
    res.status(201).json({ donation: record });
  });

  // Author Studio: Delete a donation entry
  app.delete('/api/author/donations/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = db.donations.length;
    db.donations = db.donations.filter((d) => d.id !== id);
    if (db.donations.length === before) {
      res.status(404).json({ error: 'Запис про донат не знайдено.' });
      return;
    }
    saveDatabase(db, { flushDelayMs: 500, slices: ['community'] });
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      void deleteDonationInFirestore(id, adminToken);
    }
    res.json({ deletedId: id });
  });

  // ── Monobank Jar Automatic Donation Tracking ─────────────────────────
  interface LiveMonobankJarSnapshot {
    jarId: string;
    extJarId: string;
    title: string;
    ownerName: string;
    amountKopecks: number;
    goalKopecks: number | null;
    closed: boolean;
    fetchedAtMs: number;
  }

  interface MonobankJarIntent {
    intentId: string;
    jarId: string;
    baselineKopecks: number;
    guestUid?: string;
    displayName: string;
    photoUrl?: string;
    ipHash: string;
    createdAtMs: number;
    expiresAtMs: number;
    status: 'pending' | 'credited';
    creditedAmountUah?: number;
    donationId?: string;
  }

  const monobankJarIntents = new Map<string, MonobankJarIntent>();
  let cachedMonobankJarSnapshot: LiveMonobankJarSnapshot | null = null;
  let inflightMonobankJarFetch: Promise<LiveMonobankJarSnapshot | null> | null = null;

  const extractMonobankJarShortId = (rawUrl: string): string | null => {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (!parsed.hostname.toLowerCase().endsWith('monobank.ua')) return null;
      const match = parsed.pathname.match(/\/jar\/([a-zA-Z0-9_-]{3,40})/);
      return match?.[1] || null;
    } catch {
      return null;
    }
  };

  const fetchLiveMonobankJarSnapshot = async (
    jarUrl: string,
    forceFresh = false
  ): Promise<LiveMonobankJarSnapshot | null> => {
    const jarId = extractMonobankJarShortId(jarUrl);
    if (!jarId) return null;

    const now = Date.now();
    if (
      !forceFresh &&
      cachedMonobankJarSnapshot &&
      cachedMonobankJarSnapshot.jarId === jarId &&
      now - cachedMonobankJarSnapshot.fetchedAtMs < 2500
    ) {
      return cachedMonobankJarSnapshot;
    }

    if (inflightMonobankJarFetch) {
      return inflightMonobankJarFetch;
    }

    inflightMonobankJarFetch = (async () => {
      try {
        const res = await fetch('https://send.monobank.ua/api/handler', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; DankivJarSync/1.0)',
          },
          body: JSON.stringify({ c: 'hello', clientId: jarId, Pc: '1' }),
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) return cachedMonobankJarSnapshot;
        const data = (await res.json()) as {
          clientType?: string;
          name?: string;
          ownerName?: string;
          jarAmount?: number;
          jarGoal?: number;
          extJarId?: string;
          jarStatus?: string;
        };
        if (typeof data.jarAmount !== 'number' || !Number.isFinite(data.jarAmount)) {
          return cachedMonobankJarSnapshot;
        }
        const snap: LiveMonobankJarSnapshot = {
          jarId,
          extJarId: typeof data.extJarId === 'string' ? data.extJarId : '',
          title: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Банка Монобанку',
          ownerName: typeof data.ownerName === 'string' ? data.ownerName.trim() : '',
          amountKopecks: Math.max(0, Math.round(data.jarAmount)),
          goalKopecks:
            typeof data.jarGoal === 'number' && Number.isFinite(data.jarGoal) && data.jarGoal > 0
              ? Math.round(data.jarGoal)
              : null,
          closed: data.jarStatus === 'CLOSED',
          fetchedAtMs: Date.now(),
        };
        cachedMonobankJarSnapshot = snap;
        return snap;
      } catch {
        return cachedMonobankJarSnapshot;
      } finally {
        inflightMonobankJarFetch = null;
      }
    })();

    return inflightMonobankJarFetch;
  };

  const cleanupExpiredMonobankIntents = () => {
    const now = Date.now();
    for (const [id, item] of monobankJarIntents.entries()) {
      if (now > item.expiresAtMs + 10 * 60 * 1000) {
        monobankJarIntents.delete(id);
      }
    }
    if (monobankJarIntents.size > 300) {
      const oldest = Array.from(monobankJarIntents.entries()).sort(
        (a, b) => a[1].createdAtMs - b[1].createdAtMs
      );
      for (const [id] of oldest.slice(0, oldest.length - 200)) {
        monobankJarIntents.delete(id);
      }
    }
  };

  app.get('/api/monobank/jar/info', async (_req, res) => {
    const db = ensureDatabase();
    if (!db.monobankJarUrl) {
      res.json({ enabled: false });
      return;
    }
    const snap = await fetchLiveMonobankJarSnapshot(db.monobankJarUrl);
    if (!snap) {
      res.json({ enabled: false });
      return;
    }
    if (!db.monobankJarWatermark || db.monobankJarWatermark.jarId !== snap.jarId) {
      db.monobankJarWatermark = {
        jarId: snap.jarId,
        ...(snap.extJarId ? { extJarId: snap.extJarId } : {}),
        lastAmountKopecks: snap.amountKopecks,
        updatedAt: new Date().toISOString(),
      };
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 2500, slices: ['meta'] });
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      enabled: true,
      jarId: snap.jarId,
      title: snap.title,
      ownerName: snap.ownerName,
      amountUah: Math.round(snap.amountKopecks / 100),
      goalUah: snap.goalKopecks ? Math.round(snap.goalKopecks / 100) : null,
      closed: snap.closed,
    });
  });

  app.post('/api/monobank/jar/intent', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`mono-jar-intent:${ipHash}`, 30, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато запитів. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    if (!db.monobankJarUrl) {
      res.status(400).json({ error: 'Посилання на банку Монобанку ще не налаштовано.' });
      return;
    }

    const snap = await fetchLiveMonobankJarSnapshot(db.monobankJarUrl, true);
    if (!snap) {
      res.status(503).json({ error: 'Не вдалося з’єднатися з Monobank для перевірки банки.' });
      return;
    }

    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const rawDonorName = (req.body as { donorName?: unknown })?.donorName;
    const cleanCustomName =
      typeof rawDonorName === 'string' ? rawDonorName.trim().slice(0, 80) : '';
    const resolvedName =
      optionalAuth?.account.displayName || cleanCustomName || 'Добродій';

    const watermarkMatchesJar = db.monobankJarWatermark?.jarId === snap.jarId;
    const baselineKopecks = watermarkMatchesJar
      ? Math.max(snap.amountKopecks, db.monobankJarWatermark!.lastAmountKopecks)
      : snap.amountKopecks;

    if (!watermarkMatchesJar || snap.amountKopecks < db.monobankJarWatermark!.lastAmountKopecks) {
      db.monobankJarWatermark = {
        jarId: snap.jarId,
        ...(snap.extJarId ? { extJarId: snap.extJarId } : {}),
        lastAmountKopecks: snap.amountKopecks,
        updatedAt: new Date().toISOString(),
      };
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 2500, slices: ['meta'] });
    }

    cleanupExpiredMonobankIntents();
    const now = Date.now();
    const intentId = `mji_${now.toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
    const intent: MonobankJarIntent = {
      intentId,
      jarId: snap.jarId,
      baselineKopecks,
      ...(optionalAuth?.account.uid ? { guestUid: optionalAuth.account.uid } : {}),
      displayName: resolvedName,
      ...(optionalAuth?.account.photoUrl ? { photoUrl: optionalAuth.account.photoUrl } : {}),
      ipHash,
      createdAtMs: now,
      expiresAtMs: now + 60 * 60 * 1000,
      status: 'pending',
    };
    monobankJarIntents.set(intentId, intent);

    res.status(201).json({
      intentId,
      jarTitle: snap.title,
      amountUah: Math.round(snap.amountKopecks / 100),
      goalUah: snap.goalKopecks ? Math.round(snap.goalKopecks / 100) : null,
      donorName: resolvedName,
    });
  });

  app.post('/api/monobank/jar/check', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`mono-jar-check:${ipHash}`, 120, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато перевірок. Зачекайте кілька секунд.' });
      return;
    }

    const db = ensureDatabase();
    const { intentId, donorName } = req.body as { intentId?: unknown; donorName?: unknown };
    const cleanIntentId = typeof intentId === 'string' ? intentId.trim() : '';
    const intent = cleanIntentId ? monobankJarIntents.get(cleanIntentId) : undefined;
    if (!intent) {
      res.status(404).json({ status: 'expired' });
      return;
    }
    if (intent.ipHash !== ipHash) {
      const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
      const sameUser = Boolean(
        optionalAuth && intent.guestUid && optionalAuth.account.uid === intent.guestUid
      );
      if (!sameUser) {
        res.status(403).json({ error: 'Немає доступу до цієї перевірки.' });
        return;
      }
    }

    if (intent.status === 'credited') {
      res.json({
        status: 'credited',
        amountUah: intent.creditedAmountUah,
        donationId: intent.donationId,
      });
      return;
    }

    if (Date.now() > intent.expiresAtMs) {
      res.json({ status: 'expired' });
      return;
    }

    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    if (optionalAuth?.account) {
      intent.guestUid = optionalAuth.account.uid;
      intent.displayName = optionalAuth.account.displayName || intent.displayName;
      if (optionalAuth.account.photoUrl) {
        intent.photoUrl = optionalAuth.account.photoUrl;
      }
    } else if (typeof donorName === 'string' && donorName.trim()) {
      intent.displayName = donorName.trim().slice(0, 80);
    }

    const snap = await fetchLiveMonobankJarSnapshot(db.monobankJarUrl, true);
    if (!snap || snap.jarId !== intent.jarId) {
      res.json({ status: 'pending' });
      return;
    }

    const watermarkKopecks =
      db.monobankJarWatermark && db.monobankJarWatermark.jarId === snap.jarId
        ? db.monobankJarWatermark.lastAmountKopecks
        : intent.baselineKopecks;

    // Handle case if author withdrew funds from jar since last check
    if (snap.amountKopecks < watermarkKopecks) {
      db.monobankJarWatermark = {
        jarId: snap.jarId,
        ...(snap.extJarId ? { extJarId: snap.extJarId } : {}),
        lastAmountKopecks: snap.amountKopecks,
        updatedAt: new Date().toISOString(),
      };
      intent.baselineKopecks = snap.amountKopecks;
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 2500, slices: ['meta'] });
      res.json({
        status: 'pending',
        currentJarUah: Math.round(snap.amountKopecks / 100),
      });
      return;
    }

    const effectiveFloor = Math.max(intent.baselineKopecks, watermarkKopecks);
    const deltaKopecks = snap.amountKopecks - effectiveFloor;
    const amountUah = Math.round(deltaKopecks / 100);

    if (deltaKopecks >= 100 && amountUah >= 1) {
      const nowIso = new Date().toISOString();
      const record: DonorRecord = {
        id: `don_mono_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
        ...(intent.guestUid ? { guestUid: intent.guestUid } : {}),
        displayName: intent.displayName || 'Добродій',
        ...(intent.photoUrl ? { photoUrl: intent.photoUrl } : {}),
        amountUah,
        note: 'Донат у банку Монобанку',
        donatedAt: nowIso,
      };

      // Atomically update watermark & intent status before saving
      db.monobankJarWatermark = {
        jarId: snap.jarId,
        ...(snap.extJarId ? { extJarId: snap.extJarId } : {}),
        lastAmountKopecks: snap.amountKopecks,
        updatedAt: nowIso,
      };
      intent.status = 'credited';
      intent.creditedAmountUah = amountUah;
      intent.donationId = record.id;

      db.donations.unshift(record);
      saveDatabase(db, { flushDelayMs: 0, slices: ['meta', 'community'] });

      res.json({
        status: 'credited',
        amountUah,
        donation: record,
        currentJarUah: Math.round(snap.amountKopecks / 100),
      });
      return;
    }

    res.json({
      status: 'pending',
      currentJarUah: Math.round(snap.amountKopecks / 100),
    });
  });

  // Public: Submit site feedback / suggestions
  app.post('/api/feedback', feedbackPostLimiter, async (req, res) => {
    const db = ensureDatabase();
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const { message, displayName, contact } = req.body as {
      message?: string;
      displayName?: string;
      contact?: string;
    };
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'Введіть текст відгуку або пропозиції.' });
      return;
    }
    const cleanMessage = message.trim().slice(0, 2000);
    const cleanName = (
      (typeof displayName === 'string' && displayName.trim()) ||
      optionalAuth?.account?.displayName ||
      'Гість'
    )
      .trim()
      .slice(0, 80);
    const cleanContact = typeof contact === 'string' ? contact.trim().slice(0, 100) : '';
    const resolvedFirebaseUid =
      optionalAuth?.firebaseClaims?.uid || optionalAuth?.account?.googleUid || undefined;
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    if (!Array.isArray(db.feedback)) {
      db.feedback = [];
    }

    // Idempotency guard: prevent accidental duplicate submissions within 15 seconds
    const duplicate = db.feedback.find((existing) => {
      const sameAuthor =
        (optionalAuth?.account?.uid && existing.guestUid === optionalAuth.account.uid) ||
        (resolvedFirebaseUid && existing.firebaseUid === resolvedFirebaseUid) ||
        existing.displayName.trim().toLowerCase() === cleanName.toLowerCase();
      const createdMs = Date.parse(existing.createdAt) || 0;
      return (
        sameAuthor &&
        existing.message.trim().toLowerCase() === cleanMessage.toLowerCase() &&
        nowMs - createdMs >= 0 &&
        nowMs - createdMs <= 15_000
      );
    });
    if (duplicate) {
      res.status(200).json({ success: true, record: duplicate, deduplicated: true });
      return;
    }

    const record: FeedbackRecord = {
      id: `fb_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      ...(optionalAuth?.account?.uid ? { guestUid: optionalAuth.account.uid } : {}),
      ...(resolvedFirebaseUid ? { firebaseUid: resolvedFirebaseUid } : {}),
      displayName: cleanName,
      ...(optionalAuth?.account?.photoUrl ? { authorPhotoUrl: optionalAuth.account.photoUrl } : {}),
      ...(cleanContact ? { contact: cleanContact } : {}),
      message: cleanMessage,
      createdAt: nowIso,
      updatedAt: nowIso,
      readByAdmin: false,
      readByUser: true,
    };

    db.feedback.unshift(record);
    saveDatabase(db);

    if (optionalAuth?.firebaseIdToken && optionalAuth?.firebaseClaims?.email_verified) {
      void syncSiteFeedbackToFirestore(record, optionalAuth.firebaseIdToken);
    }

    res.status(201).json({ success: true, record });
  });

  // Guest: Get current user's submitted site feedback & admin replies
  app.get('/api/feedback/my', async (req, res) => {
    const db = ensureDatabase();
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    if (!optionalAuth) {
      res.json({ feedback: [], unreadRepliesCount: 0 });
      return;
    }

    const fbUid = optionalAuth.firebaseClaims?.uid || optionalAuth.account.googleUid;
    if (fbUid && optionalAuth.firebaseIdToken) {
      const hydrated = await hydrateUserSiteFeedbackFromFirestore(
        db,
        fbUid,
        optionalAuth.firebaseIdToken
      );
      if (hydrated) {
        saveDatabase(db);
      }
    }

    const items = (db.feedback || [])
      .filter((item) => {
        if (item.guestUid && item.guestUid === optionalAuth.account.uid) return true;
        if (fbUid && item.firebaseUid && item.firebaseUid === fbUid) return true;
        return false;
      })
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));

    const unreadRepliesCount = items.filter(
      (item) => Boolean(item.adminReply?.trim()) && item.readByUser === false
    ).length;

    res.json({ feedback: items, unreadRepliesCount });
  });

  // Guest: Mark admin replies on own site feedback as read
  app.patch('/api/feedback/my/read', async (req, res) => {
    const db = ensureDatabase();
    const authResult = await authenticateGuestRequest(req, db);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }

    const fbUid = authResult.firebaseClaims?.uid || authResult.account.googleUid;
    const nowIso = new Date().toISOString();
    const updatedItems: FeedbackRecord[] = [];

    db.feedback = (db.feedback || []).map((item) => {
      const isMine =
        (item.guestUid && item.guestUid === authResult.account.uid) ||
        Boolean(fbUid && item.firebaseUid && item.firebaseUid === fbUid);
      if (isMine && item.adminReply?.trim() && item.readByUser === false) {
        const nextItem: FeedbackRecord = {
          ...item,
          readByUser: true,
          updatedAt: nowIso,
        };
        updatedItems.push(nextItem);
        return nextItem;
      }
      return item;
    });

    if (updatedItems.length > 0) {
      saveDatabase(db);
      if (authResult.firebaseIdToken && authResult.firebaseClaims?.email_verified) {
        for (const item of updatedItems) {
          void syncSiteFeedbackToFirestore(item, authResult.firebaseIdToken);
        }
      }
    }

    res.json({ ok: true, updatedCount: updatedItems.length });
  });

  // Author Studio: Get list of user feedbacks
  app.get('/api/author/feedback', async (req, res) => {
    const db = ensureDatabase();
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      const hydrated = await hydrateAdminSiteFeedbackFromFirestore(db, adminToken);
      if (hydrated) saveDatabase(db);
    }
    const sorted = [...(db.feedback || [])].sort(
      (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
    );
    res.json({ feedback: sorted });
  });

  // Author Studio: Reply directly to a user feedback message
  const handleAuthorFeedbackReply = (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const { reply } = req.body as { reply?: string };
    const items = db.feedback || [];
    const targetIndex = items.findIndex((f) => f.id === id);
    if (targetIndex < 0) {
      res.status(404).json({ error: 'Відгук не знайдено.' });
      return;
    }

    const cleanReply = typeof reply === 'string' ? reply.trim().slice(0, 2000) : '';
    const nowIso = new Date().toISOString();
    const current = items[targetIndex];
    const updated: FeedbackRecord = {
      ...current,
      readByAdmin: true,
      updatedAt: nowIso,
      ...(cleanReply
        ? {
            adminReply: cleanReply,
            adminReplyAt: nowIso,
            adminReplyAuthorName: 'Андрій Даньків',
            readByUser: false,
          }
        : {
            readByUser: true,
          }),
    };
    if (!cleanReply) {
      delete updated.adminReply;
      delete updated.adminReplyAt;
      delete updated.adminReplyAuthorName;
    }

    items[targetIndex] = updated;
    db.feedback = items;
    saveDatabase(db);

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      void syncSiteFeedbackToFirestore(updated, adminToken);
    }

    res.json({ record: updated });
  };
  app.post('/api/author/feedback/:id/reply', handleAuthorFeedbackReply);
  app.put('/api/author/feedback/:id/reply', handleAuthorFeedbackReply);

  // Author Studio: Mark site feedback as read by admin
  app.patch('/api/author/feedback/:id/read', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const items = db.feedback || [];
    const targetIndex = items.findIndex((f) => f.id === id);
    if (targetIndex < 0) {
      res.status(404).json({ error: 'Відгук не знайдено.' });
      return;
    }
    const updated: FeedbackRecord = {
      ...items[targetIndex],
      readByAdmin: true,
      updatedAt: new Date().toISOString(),
    };
    items[targetIndex] = updated;
    db.feedback = items;
    saveDatabase(db);

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      void syncSiteFeedbackToFirestore(updated, adminToken);
    }

    res.json({ record: updated });
  });

  // Author Studio: Delete a feedback item
  app.delete('/api/author/feedback/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = (db.feedback || []).length;
    db.feedback = (db.feedback || []).filter((f) => f.id !== id);
    if (db.feedback.length === before) {
      res.status(404).json({ error: 'Відгук не знайдено.' });
      return;
    }
    saveDatabase(db);
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      void deleteSiteFeedbackInFirestore(id, adminToken);
    }
    res.json({ deletedId: id });
  });

  // Delete a literary work (poem, prose, or blog post) from author studio
  app.delete('/api/author/works/:kind/:id', (req, res) => {
    const db = ensureDatabase();
    const { kind, id } = req.params;
    if (kind === 'poem') {
      const before = db.poems.length;
      db.poems = db.poems.filter((p) => p.id !== id);
      if (db.poems.length === before) {
        res.status(404).json({ error: 'Вірш не знайдено.' });
        return;
      }
      delete db.poemViews[id];
      delete db.poemVotes[id];
      db.reviews = db.reviews.filter((r) => !(r.targetType === 'poem' && r.targetId === id));
      if (Array.isArray(db.recentRatings)) {
        db.recentRatings = db.recentRatings.filter((r) => !(r.targetType === 'poem' && r.targetId === id));
      }
      cloudPoemLikesByPoemId.delete(id);
      for (const uidSet of cloudPoemLikesByUid.values()) {
        uidSet.delete(id);
      }
      db.guestAccounts = db.guestAccounts.map((acc) => ({
        ...acc,
        likedPoemIds: Array.isArray(acc.likedPoemIds)
          ? acc.likedPoemIds.filter((pid) => pid !== id)
          : [],
      }));
      saveDatabase(db);
      const adminToken = extractBearerToken(req);
      if (adminToken) {
        void deleteReviewsForTargetInFirestore('poem', id, adminToken);
      }
      res.json({ deletedId: id });
      return;
    }
    if (kind === 'prose') {
      const target = db.prose.find((p) => p.id === id);
      if (!target) {
        res.status(404).json({ error: 'Твір не знайдено.' });
        return;
      }
      if (target.pdfStorageKey) {
        const pdfPath = resolveConfinedFilePath(PROSE_PDF_DIR, target.pdfStorageKey);
        if (pdfPath && fs.existsSync(pdfPath)) {
          try {
            fs.unlinkSync(pdfPath);
          } catch {
            // Ignore cleanup failure
          }
        }
      }
      db.prose = db.prose.filter((p) => p.id !== id);
      delete db.proseVotes[id];
      db.reviews = db.reviews.filter((r) => !(r.targetType === 'prose' && r.targetId === id));
      if (Array.isArray(db.recentRatings)) {
        db.recentRatings = db.recentRatings.filter((r) => !(r.targetType === 'prose' && r.targetId === id));
      }
      saveDatabase(db);
      const adminToken = extractBearerToken(req);
      if (adminToken) {
        void deleteReviewsForTargetInFirestore('prose', id, adminToken);
      }
      res.json({ deletedId: id });
      return;
    }
    if (kind === 'blog') {
      const before = db.blog.length;
      db.blog = db.blog.filter((p) => p.id !== id);
      if (db.blog.length === before) {
        res.status(404).json({ error: 'Допис не знайдено.' });
        return;
      }
      delete db.blogViews[id];
      saveDatabase(db);
      res.json({ deletedId: id });
      return;
    }
    res.status(400).json({ error: 'Невідомий розділ.' });
  });

  // Update an existing poem (title, cycle, content, note, typesetting options)
  app.put('/api/author/works/poem/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const poem = db.poems.find((p) => p.id === id);
    if (!poem) {
      res.status(404).json({ error: 'Вірш не знайдено.' });
      return;
    }
    const {
      title,
      cycle,
      excerpt,
      content,
      note,
      fontSize,
      textAlign,
      lineSpacing,
      textColor,
      backgroundColor,
      imageUrl,
      imagePalette,
      soundcloudTrack,
      soundcloudTracks,
    } = req.body as {
      title?: unknown;
      cycle?: unknown;
      excerpt?: unknown;
      content?: unknown;
      note?: unknown;
      fontSize?: unknown;
      textAlign?: unknown;
      lineSpacing?: unknown;
      textColor?: unknown;
      backgroundColor?: unknown;
      imageUrl?: unknown;
      imagePalette?: unknown;
      soundcloudTrack?: unknown;
      soundcloudTracks?: unknown;
    };

    const { authorName, isCommunity, year, workStatus } = req.body as {
      authorName?: unknown;
      isCommunity?: unknown;
      year?: unknown;
      workStatus?: unknown;
    };

    if (year !== undefined) {
      const parsedYear = Math.round(Number(year));
      if (!Number.isFinite(parsedYear) || parsedYear < 1900 || parsedYear > 2200) {
        res.status(400).json({ error: 'Рік написання має бути в межах 1900–2200.' });
        return;
      }
      poem.year = parsedYear;
    }
    if (workStatus === 'completed' || workStatus === 'in_progress') {
      poem.workStatus = workStatus;
    } else if (workStatus === null || workStatus === 'none') {
      poem.workStatus = undefined;
    }

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 240) {
        res.status(400).json({ error: 'Заголовок має містити від 1 до 240 символів.' });
        return;
      }
      poem.title = title.trim();
    }
    if (cycle !== undefined) {
      poem.cycle = typeof cycle === 'string' && cycle.trim() ? cycle.trim() : 'Нові вірші';
    }
    if (content !== undefined) {
      const cleanPoemContent = typeof content === 'string' ? preserveFormattedText(content) : '';
      if (!cleanPoemContent) {
        res.status(400).json({ error: 'Текст вірша не може бути порожнім.' });
        return;
      }
      poem.content = cleanPoemContent;
      poem.excerpt =
        typeof excerpt === 'string' && excerpt.trim()
          ? excerpt.trim()
          : getFirstFormattedExcerptLine(cleanPoemContent, 140) + '...';
    } else if (excerpt !== undefined) {
      poem.excerpt = typeof excerpt === 'string' ? excerpt.trim() : poem.excerpt;
    }
    if (note !== undefined) {
      poem.note = typeof note === 'string' && note.trim() ? note.trim() : undefined;
    }
    if (fontSize !== undefined) {
      poem.fontSize = ['sm', 'base', 'lg', 'xl', '2xl'].includes(String(fontSize))
        ? (fontSize as 'sm' | 'base' | 'lg' | 'xl' | '2xl')
        : undefined;
    }
    if (textAlign !== undefined) {
      poem.textAlign = ['left', 'center', 'right'].includes(String(textAlign))
        ? (textAlign as 'left' | 'center' | 'right')
        : undefined;
    }
    if (lineSpacing !== undefined) {
      poem.lineSpacing = ['tight', 'normal', 'relaxed', 'loose'].includes(String(lineSpacing))
        ? (lineSpacing as 'tight' | 'normal' | 'relaxed' | 'loose')
        : undefined;
    }
    if (textColor !== undefined) {
      poem.textColor =
        typeof textColor === 'string' && textColor.trim()
          ? textColor.trim().slice(0, 32)
          : undefined;
    }
    if (backgroundColor !== undefined) {
      poem.backgroundColor =
        typeof backgroundColor === 'string' && backgroundColor.trim()
          ? backgroundColor.trim().slice(0, 32)
          : undefined;
    }
    if (imageUrl !== undefined) {
      if (imageUrl === null || imageUrl === '') {
        poem.imageUrl = undefined;
        poem.imagePalette = undefined;
      } else {
        const cleanImageUrl = sanitizePoemImageUrl(imageUrl);
        if (!cleanImageUrl) {
          res.status(400).json({ error: 'Некоректне посилання на фото для вірша.' });
          return;
        }
        poem.imageUrl = cleanImageUrl;
      }
    }
    if (imagePalette !== undefined) {
      if (imagePalette === null || !poem.imageUrl) {
        poem.imagePalette = undefined;
      } else {
        const cleanPalette = sanitizePoemImagePalette(imagePalette);
        if (cleanPalette) {
          poem.imagePalette = cleanPalette;
        }
      }
    }
    if (soundcloudTracks !== undefined) {
      if (soundcloudTracks === null || (Array.isArray(soundcloudTracks) && soundcloudTracks.length === 0)) {
        poem.soundcloudTracks = undefined;
        poem.soundcloudTrack = undefined;
      } else if (!Array.isArray(soundcloudTracks)) {
        res.status(400).json({ error: 'Некоректний список SoundCloud-треків для вірша.' });
        return;
      } else {
        const cleanTracks = sanitizePoemSoundCloudTracks(soundcloudTracks);
        if (cleanTracks.length === 0) {
          res.status(400).json({ error: 'Некоректні дані SoundCloud-треків для вірша.' });
          return;
        }
        poem.soundcloudTracks = cleanTracks;
        poem.soundcloudTrack = cleanTracks[0];
      }
    } else if (soundcloudTrack !== undefined) {
      if (soundcloudTrack === null) {
        poem.soundcloudTrack = undefined;
        poem.soundcloudTracks = undefined;
      } else {
        const cleanTrack = sanitizePoemSoundCloudTrack(soundcloudTrack);
        if (!cleanTrack) {
          res.status(400).json({ error: 'Некоректні дані SoundCloud-треку для вірша.' });
          return;
        }
        poem.soundcloudTrack = cleanTrack;
        poem.soundcloudTracks = [cleanTrack];
      }
    }

    if (typeof isCommunity === 'boolean') {
      poem.isCommunity = isCommunity || undefined;
    }
    if (typeof authorName === 'string') {
      poem.authorName = authorName.trim() ? authorName.trim().slice(0, 80) : undefined;
    }

    saveDatabase(db);
    res.json({ item: poem });
  });

  // Author Studio: Reorder poems display sequence
  app.put('/api/author/poems/reorder', (req, res) => {
    const db = ensureDatabase();
    const { orderedIds } = req.body as { orderedIds?: unknown };
    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ error: 'Очікується масив ідентифікаторів віршів.' });
      return;
    }

    const byId = new Map(db.poems.map((p) => [p.id, p]));
    const seen = new Set<string>();
    const reordered: RawPoem[] = [];

    for (const rawId of orderedIds) {
      if (typeof rawId !== 'string') continue;
      const cleanId = rawId.trim();
      if (!cleanId || seen.has(cleanId)) continue;
      const found = byId.get(cleanId);
      if (found) {
        seen.add(cleanId);
        reordered.push(found);
      }
    }

    for (const poem of db.poems) {
      if (!seen.has(poem.id)) {
        reordered.push(poem);
      }
    }

    db.poems = reordered;
    saveDatabase(db);
    res.json({ poems: db.poems });
  });

  // Author Studio: List all reader poem submissions
  app.get('/api/author/poem-submissions', async (req, res) => {
    const db = ensureDatabase();
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      const hydrated = await hydrateAdminPoemSubmissionsFromFirestore(db, adminToken);
      if (hydrated) saveDatabase(db);
    }
    const items = [...(db.poemSubmissions || [])].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    res.json({ submissions: items });
  });

  // Author Studio: Edit a reader's poem submission before or alongside moderation
  app.put('/api/author/poem-submissions/:id', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.poemSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = req.body as Record<string, unknown>;

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
        res.status(400).json({ error: 'Назва вірша має містити від 1 до 200 символів.' });
        return;
      }
      submission.title = body.title.trim();
    }
    if (body.cycle !== undefined) {
      submission.cycle = typeof body.cycle === 'string' ? body.cycle.trim().slice(0, 160) : '';
    }
    if (body.authorName !== undefined) {
      if (typeof body.authorName === 'string' && body.authorName.trim()) {
        submission.authorName = body.authorName.trim().slice(0, 80);
      }
    }
    if (body.content !== undefined) {
      const cleanSubContent = typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
      if (!cleanSubContent || cleanSubContent.length > 50000) {
        res.status(400).json({ error: 'Текст вірша має містити від 1 до 50 000 символів.' });
        return;
      }
      submission.content = cleanSubContent;
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }
    if (body.note !== undefined) {
      submission.note =
        typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : undefined;
    }
    if (body.moderationNote !== undefined) {
      submission.moderationNote =
        typeof body.moderationNote === 'string' && body.moderationNote.trim()
          ? body.moderationNote.trim().slice(0, 1000)
          : undefined;
    }
    if (body.fontSize !== undefined) {
      submission.fontSize = ['sm', 'base', 'lg', 'xl', '2xl'].includes(String(body.fontSize))
        ? (body.fontSize as PoemSubmissionRecord['fontSize'])
        : undefined;
    }
    if (body.textAlign !== undefined) {
      submission.textAlign = ['left', 'center', 'right'].includes(String(body.textAlign))
        ? (body.textAlign as PoemSubmissionRecord['textAlign'])
        : undefined;
    }
    if (body.lineSpacing !== undefined) {
      submission.lineSpacing = ['tight', 'normal', 'relaxed', 'loose'].includes(String(body.lineSpacing))
        ? (body.lineSpacing as PoemSubmissionRecord['lineSpacing'])
        : undefined;
    }
    if (body.textColor !== undefined) {
      submission.textColor =
        typeof body.textColor === 'string' && body.textColor.trim()
          ? body.textColor.trim().slice(0, 32)
          : undefined;
    }
    if (body.backgroundColor !== undefined) {
      submission.backgroundColor =
        typeof body.backgroundColor === 'string' && body.backgroundColor.trim()
          ? body.backgroundColor.trim().slice(0, 32)
          : undefined;
    }
    if (body.imageUrl !== undefined) {
      if (body.imageUrl === null || body.imageUrl === '') {
        submission.imageUrl = undefined;
        submission.imagePalette = undefined;
      } else {
        const cleanImageUrl = sanitizePoemImageUrl(body.imageUrl);
        if (!cleanImageUrl) {
          res.status(400).json({ error: 'Некоректне посилання на фото.' });
          return;
        }
        submission.imageUrl = cleanImageUrl;
      }
    }
    if (body.imagePalette !== undefined) {
      if (body.imagePalette === null || !submission.imageUrl) {
        submission.imagePalette = undefined;
      } else {
        const cleanPalette = sanitizePoemImagePalette(body.imagePalette);
        if (cleanPalette) {
          submission.imagePalette = cleanPalette;
        }
      }
    }
    if (body.soundcloudTracks !== undefined) {
      if (body.soundcloudTracks === null || (Array.isArray(body.soundcloudTracks) && body.soundcloudTracks.length === 0)) {
        submission.soundcloudTracks = undefined;
        submission.soundcloudTrack = undefined;
      } else if (!Array.isArray(body.soundcloudTracks)) {
        res.status(400).json({ error: 'Некоректний список SoundCloud-треків.' });
        return;
      } else {
        const cleanTracks = sanitizePoemSoundCloudTracks(body.soundcloudTracks);
        if (cleanTracks.length === 0) {
          res.status(400).json({ error: 'Некоректні дані SoundCloud-треків.' });
          return;
        }
        submission.soundcloudTracks = cleanTracks;
        submission.soundcloudTrack = cleanTracks[0];
      }
    } else if (body.soundcloudTrack !== undefined) {
      if (body.soundcloudTrack === null) {
        submission.soundcloudTrack = undefined;
        submission.soundcloudTracks = undefined;
      } else {
        const cleanTrack = sanitizePoemSoundCloudTrack(body.soundcloudTrack);
        if (!cleanTrack) {
          res.status(400).json({ error: 'Некоректні дані SoundCloud-треку.' });
          return;
        }
        submission.soundcloudTrack = cleanTrack;
        submission.soundcloudTracks = [cleanTrack];
      }
    }

    submission.updatedAt = new Date().toISOString();

    if (submission.publishedPoemId && submission.status === 'approved') {
      const published = db.poems.find((p) => p.id === submission.publishedPoemId);
      if (published) {
        published.title = submission.title;
        published.cycle = submission.cycle || 'Вірші читачів';
        published.content = submission.content;
        published.excerpt = getFirstFormattedExcerptLine(submission.content, 140) + '...';
        published.note = submission.note;
        published.workStatus = submission.workStatus;
        published.fontSize = submission.fontSize;
        published.textAlign = submission.textAlign;
        published.lineSpacing = submission.lineSpacing;
        published.textColor = submission.textColor;
        published.backgroundColor = submission.backgroundColor;
        published.imageUrl = submission.imageUrl;
        published.imagePalette = submission.imagePalette;
        published.soundcloudTracks = submission.soundcloudTracks;
        published.soundcloudTrack = submission.soundcloudTracks?.[0] || submission.soundcloudTrack;
        published.authorName = submission.authorName;
      }
    }

    saveDatabase(db);
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await syncPoemSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission });
  });

  // Author Studio: Approve (with optional last-mile edits) & publish a reader's poem submission
  app.post('/api/author/poem-submissions/:id/approve', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.poemSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.title === 'string' && body.title.trim()) {
      submission.title = body.title.trim().slice(0, 200);
    }
    if (typeof body.cycle === 'string') {
      submission.cycle = body.cycle.trim().slice(0, 160);
    }
    if (typeof body.authorName === 'string' && body.authorName.trim()) {
      submission.authorName = body.authorName.trim().slice(0, 80);
    }
    if (typeof body.content === 'string') {
      const cleanApproveContent = preserveFormattedText(body.content).slice(0, 50000);
      if (cleanApproveContent) submission.content = cleanApproveContent;
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }
    if (body.note !== undefined) {
      submission.note =
        typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : undefined;
    }
    if (body.moderationNote !== undefined) {
      submission.moderationNote =
        typeof body.moderationNote === 'string' && body.moderationNote.trim()
          ? body.moderationNote.trim().slice(0, 1000)
          : undefined;
    }
    if (body.fontSize !== undefined) {
      submission.fontSize = ['sm', 'base', 'lg', 'xl', '2xl'].includes(String(body.fontSize))
        ? (body.fontSize as PoemSubmissionRecord['fontSize'])
        : undefined;
    }
    if (body.textAlign !== undefined) {
      submission.textAlign = ['left', 'center', 'right'].includes(String(body.textAlign))
        ? (body.textAlign as PoemSubmissionRecord['textAlign'])
        : undefined;
    }
    if (body.lineSpacing !== undefined) {
      submission.lineSpacing = ['tight', 'normal', 'relaxed', 'loose'].includes(String(body.lineSpacing))
        ? (body.lineSpacing as PoemSubmissionRecord['lineSpacing'])
        : undefined;
    }
    if (body.textColor !== undefined) {
      submission.textColor =
        typeof body.textColor === 'string' && body.textColor.trim()
          ? body.textColor.trim().slice(0, 32)
          : undefined;
    }
    if (body.backgroundColor !== undefined) {
      submission.backgroundColor =
        typeof body.backgroundColor === 'string' && body.backgroundColor.trim()
          ? body.backgroundColor.trim().slice(0, 32)
          : undefined;
    }
    if (body.imageUrl !== undefined) {
      if (body.imageUrl === null || body.imageUrl === '') {
        submission.imageUrl = undefined;
        submission.imagePalette = undefined;
      } else {
        const cleanImageUrl = sanitizePoemImageUrl(body.imageUrl);
        if (cleanImageUrl) submission.imageUrl = cleanImageUrl;
      }
    }
    if (body.imagePalette !== undefined) {
      if (body.imagePalette === null || !submission.imageUrl) {
        submission.imagePalette = undefined;
      } else {
        const cleanPalette = sanitizePoemImagePalette(body.imagePalette);
        if (cleanPalette) submission.imagePalette = cleanPalette;
      }
    }
    if (body.soundcloudTracks !== undefined) {
      if (body.soundcloudTracks === null || (Array.isArray(body.soundcloudTracks) && body.soundcloudTracks.length === 0)) {
        submission.soundcloudTracks = undefined;
        submission.soundcloudTrack = undefined;
      } else if (Array.isArray(body.soundcloudTracks)) {
        const cleanTracks = sanitizePoemSoundCloudTracks(body.soundcloudTracks);
        if (cleanTracks.length > 0) {
          submission.soundcloudTracks = cleanTracks;
          submission.soundcloudTrack = cleanTracks[0];
        }
      }
    } else if (body.soundcloudTrack !== undefined) {
      if (body.soundcloudTrack === null) {
        submission.soundcloudTrack = undefined;
        submission.soundcloudTracks = undefined;
      } else {
        const cleanTrack = sanitizePoemSoundCloudTrack(body.soundcloudTrack);
        if (cleanTrack) {
          submission.soundcloudTrack = cleanTrack;
          submission.soundcloudTracks = [cleanTrack];
        }
      }
    }

    const excerpt = getFirstFormattedExcerptLine(submission.content, 140) + '...';

    let publishedPoem = submission.publishedPoemId
      ? db.poems.find((p) => p.id === submission.publishedPoemId)
      : undefined;

    const resolvedSubTracks =
      Array.isArray(submission.soundcloudTracks) && submission.soundcloudTracks.length > 0
        ? submission.soundcloudTracks
        : submission.soundcloudTrack
          ? [submission.soundcloudTrack]
          : [];

    if (!publishedPoem) {
      publishedPoem = {
        id: submission.publishedPoemId || `poem-comm-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
        title: submission.title,
        cycle: submission.cycle || 'Вірші читачів',
        year: submission.year || new Date().getFullYear() || 2026,
        excerpt,
        content: submission.content,
        note: submission.note,
        workStatus: submission.workStatus || 'completed',
        fontSize: submission.fontSize,
        textAlign: submission.textAlign,
        lineSpacing: submission.lineSpacing,
        textColor: submission.textColor,
        backgroundColor: submission.backgroundColor,
        ...(submission.imageUrl ? { imageUrl: submission.imageUrl } : {}),
        ...(submission.imageUrl && submission.imagePalette ? { imagePalette: submission.imagePalette } : {}),
        ...(resolvedSubTracks.length > 0
          ? {
              soundcloudTrack: resolvedSubTracks[0],
              soundcloudTracks: resolvedSubTracks,
            }
          : {}),
        isCommunity: true,
        authorUid: submission.authorUid,
        authorName: submission.authorName,
        ...(submission.authorPhotoUrl ? { authorPhotoUrl: submission.authorPhotoUrl } : {}),
        submissionId: submission.id,
      };
      db.poems.unshift(publishedPoem);
    } else {
      publishedPoem.title = submission.title;
      publishedPoem.cycle = submission.cycle || 'Вірші читачів';
      publishedPoem.excerpt = excerpt;
      publishedPoem.content = submission.content;
      publishedPoem.note = submission.note;
      publishedPoem.workStatus = submission.workStatus || 'completed';
      publishedPoem.fontSize = submission.fontSize;
      publishedPoem.textAlign = submission.textAlign;
      publishedPoem.lineSpacing = submission.lineSpacing;
      publishedPoem.textColor = submission.textColor;
      publishedPoem.backgroundColor = submission.backgroundColor;
      publishedPoem.imageUrl = submission.imageUrl;
      publishedPoem.imagePalette = submission.imageUrl ? submission.imagePalette : undefined;
      publishedPoem.soundcloudTracks = resolvedSubTracks.length > 0 ? resolvedSubTracks : undefined;
      publishedPoem.soundcloudTrack = resolvedSubTracks[0];
      publishedPoem.isCommunity = true;
      publishedPoem.authorUid = submission.authorUid;
      publishedPoem.authorName = submission.authorName;
      publishedPoem.authorPhotoUrl = submission.authorPhotoUrl;
      publishedPoem.submissionId = submission.id;
    }

    submission.status = 'approved';
    submission.publishedPoemId = publishedPoem.id;
    submission.updatedAt = new Date().toISOString();
    saveDatabase(db);

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      if (publishedPoem.imageUrl?.startsWith('/uploads/')) {
        const filename = path.basename(publishedPoem.imageUrl.slice('/uploads/'.length).split('?')[0]);
        const localFile = resolveConfinedFilePath(UPLOADS_DIR, filename);
        if (localFile && fs.existsSync(localFile)) {
          try {
            const buf = fs.readFileSync(localFile);
            const ext = path.extname(filename).toLowerCase();
            const mime =
              ext === '.png'
                ? 'image/png'
                : ext === '.webp'
                  ? 'image/webp'
                  : ext === '.gif'
                    ? 'image/gif'
                    : 'image/jpeg';
            await saveMediaAssetToFirestore(filename, mime, buf, adminToken);
          } catch {
            // Non-fatal media asset sync
          }
        }
      }
      await syncPoemSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission, poem: publishedPoem });
  });

  // Author Studio: Reject a reader's poem submission
  app.post('/api/author/poem-submissions/:id/reject', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.poemSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = (req.body || {}) as { moderationNote?: unknown };
    if (typeof body.moderationNote === 'string') {
      submission.moderationNote = body.moderationNote.trim()
        ? body.moderationNote.trim().slice(0, 1000)
        : undefined;
    }
    submission.status = 'rejected';
    submission.updatedAt = new Date().toISOString();
    saveDatabase(db);

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await syncPoemSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission });
  });

  // Author Studio: Delete a reader's poem submission
  app.delete('/api/author/poem-submissions/:id', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = (db.poemSubmissions || []).length;
    db.poemSubmissions = (db.poemSubmissions || []).filter((s) => s.id !== id);
    if (db.poemSubmissions.length === before) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }
    saveDatabase(db);

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await deletePoemSubmissionInFirestore(id, adminToken);
    }

    res.json({ deletedId: id });
  });

  // Author Studio: List all reader prose submissions
  app.get('/api/author/prose-submissions', async (req, res) => {
    const db = ensureDatabase();
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      const hydrated = await hydrateAdminProseSubmissionsFromFirestore(db, adminToken);
      if (hydrated) saveDatabase(db);
    }
    const items = [...(db.proseSubmissions || [])].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    res.json({ submissions: items });
  });

  // Author Studio: Edit a reader's prose submission before or alongside moderation
  app.put('/api/author/prose-submissions/:id', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.proseSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = req.body as Record<string, unknown>;

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 240) {
        res.status(400).json({ error: 'Назва твору має містити від 1 до 240 символів.' });
        return;
      }
      submission.title = body.title.trim();
    }
    if (body.genre !== undefined) {
      submission.genre =
        typeof body.genre === 'string' && body.genre.trim()
          ? body.genre.trim().slice(0, 120)
          : 'Оповідання';
    }
    if (body.authorName !== undefined) {
      if (typeof body.authorName === 'string' && body.authorName.trim()) {
        submission.authorName = body.authorName.trim().slice(0, 80);
      }
    }
    if (body.slogan !== undefined) {
      submission.slogan =
        typeof body.slogan === 'string' && body.slogan.trim()
          ? body.slogan.trim().slice(0, 500)
          : undefined;
    }
    if (body.excerpt !== undefined) {
      submission.excerpt =
        typeof body.excerpt === 'string' && body.excerpt.trim()
          ? body.excerpt.trim().slice(0, 2000)
          : undefined;
    }
    if (body.content !== undefined) {
      const cleanProseSubContent = typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
      if (!cleanProseSubContent || cleanProseSubContent.length > 250000) {
        res.status(400).json({ error: 'Текст твору має містити від 1 до 250 000 символів.' });
        return;
      }
      submission.content = cleanProseSubContent;
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }
    if (body.moderationNote !== undefined) {
      submission.moderationNote =
        typeof body.moderationNote === 'string' && body.moderationNote.trim()
          ? body.moderationNote.trim().slice(0, 1000)
          : undefined;
    }
    if (body.moodboardUrls !== undefined) {
      if (body.moodboardUrls === null || (Array.isArray(body.moodboardUrls) && body.moodboardUrls.length === 0)) {
        submission.moodboardUrls = undefined;
      } else if (Array.isArray(body.moodboardUrls)) {
        const cleaned = Array.from(
          new Set(
            body.moodboardUrls
              .map((item) => sanitizePoemImageUrl(item))
              .filter((item): item is string => Boolean(item))
          )
        ).slice(0, 8);
        submission.moodboardUrls = cleaned.length > 0 ? cleaned : undefined;
      }
    }

    submission.pages = computeProseWorkPages({ content: submission.content, fallbackPages: 1 });
    submission.totalWords = countProseWords(submission.content);
    submission.updatedAt = new Date().toISOString();

    if (submission.publishedProseId && submission.status === 'approved') {
      const published = db.prose.find((p) => p.id === submission.publishedProseId);
      if (published) {
        published.title = submission.title;
        published.genre = submission.genre || 'Оповідання';
        published.slogan = submission.slogan || '';
        published.excerpt =
          submission.excerpt || getFirstFormattedExcerptLine(submission.content, 240);
        published.content = submission.content;
        published.status = submission.workStatus || published.status || 'completed';
        published.pages = computeProseWorkPages({
          content: submission.content,
          chapters: published.chapters,
          hasPdf: Boolean(published.pdfStorageKey),
          fallbackPages: 1,
        });
        published.moodboardUrls = submission.moodboardUrls ? [...submission.moodboardUrls] : [];
        published.authorName = submission.authorName;
      }
    }

    saveDatabase(db);
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await syncProseSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission });
  });

  // Author Studio: Approve (with optional last-mile edits) & publish a reader's prose submission
  app.post('/api/author/prose-submissions/:id/approve', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.proseSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.title === 'string' && body.title.trim()) {
      submission.title = body.title.trim().slice(0, 240);
    }
    if (typeof body.genre === 'string') {
      submission.genre = body.genre.trim() ? body.genre.trim().slice(0, 120) : 'Оповідання';
    }
    if (typeof body.authorName === 'string' && body.authorName.trim()) {
      submission.authorName = body.authorName.trim().slice(0, 80);
    }
    if (body.slogan !== undefined) {
      submission.slogan =
        typeof body.slogan === 'string' && body.slogan.trim()
          ? body.slogan.trim().slice(0, 500)
          : undefined;
    }
    if (body.excerpt !== undefined) {
      submission.excerpt =
        typeof body.excerpt === 'string' && body.excerpt.trim()
          ? body.excerpt.trim().slice(0, 2000)
          : undefined;
    }
    if (typeof body.content === 'string') {
      const cleanProseApprove = preserveFormattedText(body.content).slice(0, 250000);
      if (cleanProseApprove) submission.content = cleanProseApprove;
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }
    if (body.moderationNote !== undefined) {
      submission.moderationNote =
        typeof body.moderationNote === 'string' && body.moderationNote.trim()
          ? body.moderationNote.trim().slice(0, 1000)
          : undefined;
    }
    if (body.moodboardUrls !== undefined) {
      if (body.moodboardUrls === null || (Array.isArray(body.moodboardUrls) && body.moodboardUrls.length === 0)) {
        submission.moodboardUrls = undefined;
      } else if (Array.isArray(body.moodboardUrls)) {
        const cleaned = Array.from(
          new Set(
            body.moodboardUrls
              .map((item) => sanitizePoemImageUrl(item))
              .filter((item): item is string => Boolean(item))
          )
        ).slice(0, 8);
        submission.moodboardUrls = cleaned.length > 0 ? cleaned : undefined;
      }
    }

    const computedPages = computeProseWorkPages({ content: submission.content, fallbackPages: 1 });
    const computedWords = countProseWords(submission.content);
    submission.pages = computedPages;
    submission.totalWords = computedWords;

    const resolvedExcerpt =
      submission.excerpt || getFirstFormattedExcerptLine(submission.content, 240);

    const publishedAtLabel = new Date().toLocaleDateString('uk-UA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    let publishedProse = submission.publishedProseId
      ? db.prose.find((p) => p.id === submission.publishedProseId)
      : undefined;

    if (!publishedProse) {
      publishedProse = {
        id: submission.publishedProseId || `prose-comm-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
        title: submission.title,
        genre: submission.genre || 'Оповідання',
        pages: computedPages,
        publishedAt: publishedAtLabel,
        slogan: submission.slogan || '',
        excerpt: resolvedExcerpt,
        content: submission.content,
        chapters: [],
        tagIds: [],
        status: submission.workStatus || 'completed',
        accessMode: 'public',
        requiresAuth: false,
        isPaid: false,
        priceUah: 0,
        moodboardUrls: submission.moodboardUrls ? [...submission.moodboardUrls] : [],
        isCommunity: true,
        authorUid: submission.authorUid,
        authorName: submission.authorName,
        ...(submission.authorPhotoUrl ? { authorPhotoUrl: submission.authorPhotoUrl } : {}),
        submissionId: submission.id,
      };
      db.prose.unshift(publishedProse);
    } else {
      publishedProse.title = submission.title;
      publishedProse.genre = submission.genre || 'Оповідання';
      publishedProse.pages = computeProseWorkPages({
        content: submission.content,
        chapters: publishedProse.chapters,
        hasPdf: Boolean(publishedProse.pdfStorageKey),
        fallbackPages: 1,
      });
      publishedProse.slogan = submission.slogan || '';
      publishedProse.excerpt = resolvedExcerpt;
      publishedProse.content = submission.content;
      publishedProse.status = submission.workStatus || publishedProse.status || 'completed';
      publishedProse.accessMode = 'public';
      publishedProse.requiresAuth = false;
      publishedProse.isPaid = false;
      publishedProse.priceUah = 0;
      publishedProse.moodboardUrls = submission.moodboardUrls ? [...submission.moodboardUrls] : [];
      publishedProse.isCommunity = true;
      publishedProse.authorUid = submission.authorUid;
      publishedProse.authorName = submission.authorName;
      publishedProse.authorPhotoUrl = submission.authorPhotoUrl;
      publishedProse.submissionId = submission.id;
    }

    submission.status = 'approved';
    submission.publishedProseId = publishedProse.id;
    submission.updatedAt = new Date().toISOString();
    saveDatabase(db);

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      for (const mediaUrl of publishedProse.moodboardUrls || []) {
        if (mediaUrl.startsWith('/uploads/')) {
          const filename = path.basename(mediaUrl.slice('/uploads/'.length).split('?')[0]);
          const localFile = resolveConfinedFilePath(UPLOADS_DIR, filename);
          if (localFile && fs.existsSync(localFile)) {
            try {
              const buf = fs.readFileSync(localFile);
              const ext = path.extname(filename).toLowerCase();
              const mime =
                ext === '.png'
                  ? 'image/png'
                  : ext === '.webp'
                    ? 'image/webp'
                    : ext === '.gif'
                      ? 'image/gif'
                      : 'image/jpeg';
              await saveMediaAssetToFirestore(filename, mime, buf, adminToken);
            } catch {
              // Non-fatal media asset sync
            }
          }
        }
      }
      await syncProseSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission, prose: enrichProseForAuthor(publishedProse, db) });
  });

  // Author Studio: Reject a reader's prose submission
  app.post('/api/author/prose-submissions/:id/reject', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.proseSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = (req.body || {}) as { moderationNote?: unknown };
    if (typeof body.moderationNote === 'string') {
      submission.moderationNote = body.moderationNote.trim()
        ? body.moderationNote.trim().slice(0, 1000)
        : undefined;
    }
    submission.status = 'rejected';
    submission.updatedAt = new Date().toISOString();
    saveDatabase(db);

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await syncProseSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission });
  });

  // Author Studio: Delete a reader's prose submission
  app.delete('/api/author/prose-submissions/:id', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = (db.proseSubmissions || []).length;
    db.proseSubmissions = (db.proseSubmissions || []).filter((s) => s.id !== id);
    if (db.proseSubmissions.length === before) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }
    saveDatabase(db);

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await deleteProseSubmissionInFirestore(id, adminToken);
    }

    res.json({ deletedId: id });
  });

  // Update an existing blog post (title, category, excerpt, content with embedded photos & SoundCloud tracks)
  app.put('/api/author/works/blog/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const post = db.blog.find((b) => b.id === id);
    if (!post) {
      res.status(404).json({ error: 'Допис не знайдено.' });
      return;
    }
    const { title, category, excerpt, content, coverImage } = req.body as {
      title?: unknown;
      category?: unknown;
      excerpt?: unknown;
      content?: unknown;
      coverImage?: unknown;
    };

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 240) {
        res.status(400).json({ error: 'Заголовок має містити від 1 до 240 символів.' });
        return;
      }
      post.title = title.trim();
    }

    if (category !== undefined && typeof category === 'string') {
      post.category = category.trim().slice(0, 120) || 'Авторське кіно';
    }

    if (coverImage !== undefined) {
      if (coverImage === null || (typeof coverImage === 'string' && !coverImage.trim())) {
        delete post.coverImage;
      } else if (isValidBlogPhotoUrl(coverImage)) {
        post.coverImage = coverImage.trim();
      }
    }

    if (content !== undefined) {
      if (typeof content !== 'string' || !content.trim() || content.length > 200000) {
        res.status(400).json({ error: 'Текст допису не може бути порожнім.' });
        return;
      }
      post.content = content.trim();
      const plainText = stripBlogMediaTokens(post.content);
      const words = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
      post.readingMinutes = Math.max(1, Math.ceil(words / 180));
    }

    if (excerpt !== undefined && typeof excerpt === 'string') {
      const trimmedExcerpt = excerpt.trim().slice(0, 2000);
      if (trimmedExcerpt) {
        post.excerpt = trimmedExcerpt;
      } else {
        const plainText = stripBlogMediaTokens(post.content);
        post.excerpt =
          (plainText.split('\n').find((line) => line.trim().length > 0)?.slice(0, 140) || post.title) +
          '...';
      }
    }

    saveDatabase(db);
    res.json({ item: enrichBlogPost(post, db) });
  });

  // Resolve SoundCloud track metadata for embedding inside blog posts (Admin-only)
  app.post('/api/author/blog/resolve-soundcloud', async (req, res) => {
    const body = req.body as { url?: unknown; urls?: unknown };
    const candidateInputs: string[] = [];

    if (typeof body.url === 'string' && body.url.trim()) {
      for (const part of body.url.split(/[\r\n]+/)) {
        const clean = part.trim();
        if (clean) candidateInputs.push(clean);
      }
    }
    if (Array.isArray(body.urls)) {
      for (const item of body.urls) {
        if (typeof item === 'string' && item.trim()) {
          candidateInputs.push(item.trim());
        }
      }
    }

    const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 15);
    if (uniqueInputs.length === 0) {
      res.status(400).json({ error: 'Вставте посилання на пісню або трек у SoundCloud.' });
      return;
    }

    const tracks: Array<{
      id: string;
      kind: 'track';
      title: string;
      artist: string;
      soundcloudUrl: string;
      embedTargetUrl: string;
      artworkUrl?: string;
    }> = [];

    for (const rawUrl of uniqueInputs) {
      const resolved = await resolveSoundCloudTrackMetadata(rawUrl, 'indie');
      if (!resolved.ok) {
        res.status(400).json({ error: resolved.error });
        return;
      }
      tracks.push({
        id: `blog_sc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        kind: 'track',
        title: resolved.track.title,
        artist: resolved.track.artist,
        soundcloudUrl: resolved.track.soundcloudUrl,
        embedTargetUrl: resolved.track.embedTargetUrl || resolved.track.soundcloudUrl,
        ...(resolved.track.artworkUrl ? { artworkUrl: resolved.track.artworkUrl } : {}),
      });
    }

    res.json({ tracks });
  });

  // Resolve YouTube video metadata for embedding inside blog (БДК) posts (Admin-only)
  app.post('/api/author/blog/resolve-youtube', async (req, res) => {
    const body = req.body as { url?: unknown; urls?: unknown };
    const candidateInputs: string[] = [];

    if (typeof body.url === 'string' && body.url.trim()) {
      for (const part of body.url.split(/[\r\n]+/)) {
        const clean = part.trim();
        if (clean) candidateInputs.push(clean);
      }
    }
    if (Array.isArray(body.urls)) {
      for (const item of body.urls) {
        if (typeof item === 'string' && item.trim()) {
          candidateInputs.push(item.trim());
        }
      }
    }

    const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 15);
    if (uniqueInputs.length === 0) {
      res.status(400).json({ error: 'Вставте посилання на відео з YouTube.' });
      return;
    }

    const videos: Array<{
      id: string;
      kind: 'youtube';
      videoId: string;
      youtubeUrl: string;
      title: string;
      authorName?: string;
      thumbnailUrl: string;
    }> = [];

    for (const rawUrl of uniqueInputs) {
      const videoId = extractYouTubeVideoId(rawUrl);
      if (!videoId) {
        res.status(400).json({
          error:
            'Не вдалося розпізнати посилання на YouTube. Використовуйте формат youtube.com/watch?v=..., youtu.be/... або youtube.com/shorts/...',
        });
        return;
      }

      const watchUrl = getYouTubeWatchUrl(videoId);
      const fallbackThumb = getYouTubeThumbnailUrl(videoId);
      let title = 'Відео з YouTube';
      let authorName: string | undefined;
      let thumbnailUrl = fallbackThumb;

      try {
        const oembedRes = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'User-Agent': 'andrii-dankiv-writer-app/1.0',
            },
            signal: AbortSignal.timeout(7000),
          }
        );
        if (oembedRes.ok) {
          const data = (await oembedRes.json()) as {
            title?: unknown;
            author_name?: unknown;
            thumbnail_url?: unknown;
          };
          if (typeof data.title === 'string' && data.title.trim()) {
            title = data.title.trim().slice(0, 200);
          }
          if (typeof data.author_name === 'string' && data.author_name.trim()) {
            authorName = data.author_name.trim().slice(0, 140);
          }
          if (typeof data.thumbnail_url === 'string' && /^https?:\/\//i.test(data.thumbnail_url.trim())) {
            thumbnailUrl = data.thumbnail_url.trim().replace(/^http:\/\//i, 'https://').slice(0, 500);
          }
        }
      } catch {
        // Fallback metadata already prepared above
      }

      videos.push({
        id: `blog_yt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        kind: 'youtube',
        videoId,
        youtubeUrl: watchUrl,
        title,
        ...(authorName ? { authorName } : {}),
        thumbnailUrl,
      });
    }

    res.json({ videos });
  });

  // Resolve one or multiple SoundCloud tracks for attaching to a poem (Admin-only)
  app.post('/api/author/poem/resolve-soundcloud', async (req, res) => {
    const body = req.body as { url?: unknown; urls?: unknown };
    const resolved = await resolvePoemSoundCloudTracksInput(body);
    if (!resolved.ok) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    res.json({ track: resolved.tracks[0], tracks: resolved.tracks });
  });

  // SSRF-protected image proxy for extracting color palette from external poem image URLs (Admin-only)
  app.get('/api/author/image-proxy', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Потрібен параметр url.' });
      return;
    }

    let currentValid = await validateExternalImageUrlForProxy(rawUrl);
    if (!currentValid) {
      res.status(400).json({ error: 'Недозволений або небезпечний URL зображення.' });
      return;
    }

    try {
      let response: globalThis.Response | null = null;
      for (let hop = 0; hop < 4; hop += 1) {
        const resHop = await fetch(currentValid.url.toString(), {
          method: 'GET',
          redirect: 'manual',
          headers: {
            Accept: 'image/*,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (compatible; LiteraryImagePalette/1.0)',
          },
          signal: AbortSignal.timeout(7000),
        });

        if (resHop.status >= 300 && resHop.status < 400) {
          const location = resHop.headers.get('location');
          if (!location) {
            res.status(400).json({ error: 'Не вдалося обробити перенаправлення зображення.' });
            return;
          }
          const nextTarget = new URL(location, currentValid.url).toString();
          const validatedNext = await validateExternalImageUrlForProxy(nextTarget);
          if (!validatedNext) {
            res.status(400).json({ error: 'Перенаправлення веде на недозволену адресу.' });
            return;
          }
          currentValid = validatedNext;
          continue;
        }

        response = resHop;
        break;
      }

      if (!response || !response.ok) {
        res.status(502).json({ error: 'Не вдалося завантажити зовнішнє зображення.' });
        return;
      }

      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) {
        res.status(400).json({ error: 'Посилання не веде на зображення.' });
        return;
      }

      const contentLengthHeader = Number(response.headers.get('content-length') || 0);
      if (contentLengthHeader > 5 * 1024 * 1024) {
        res.status(413).json({ error: 'Зображення занадто велике (макс. 5 МБ).' });
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
        res.status(413).json({ error: 'Зображення занадто велике (макс. 5 МБ).' });
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(Buffer.from(arrayBuffer));
    } catch {
      res.status(502).json({ error: 'Не вдалося завантажити зображення для аналізу палітри.' });
    }
  });

  // Preview/extract tracks from a SoundCloud playlist or single track URL for Radio (Admin-only)
  app.post('/api/author/radio/resolve-playlist', async (req, res) => {
    const body = req.body as { url?: unknown; station?: unknown };
    const station: RadioStationId = body.station === 'electronic' ? 'electronic' : 'indie';
    const rawUrl = typeof body.url === 'string' ? body.url.trim().split(/[\r\n]+/)[0]?.trim() || '' : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Вставте посилання на плейлист або трек SoundCloud.' });
      return;
    }
    const normalized = normalizeSoundCloudInputUrl(rawUrl);
    if (!normalized) {
      res.status(400).json({
        error: 'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/sets/playlist).',
      });
      return;
    }

    const canonical = await resolveSoundCloudShortUrl(normalized);
    if (isSoundCloudPlaylistUrl(canonical)) {
      const playlistRes = await resolveSoundCloudPlaylistTracks(canonical, station, 100);
      if (!playlistRes.ok) {
        res.status(400).json({ error: playlistRes.error });
        return;
      }
      res.json({
        kind: 'playlist',
        playlistTitle: playlistRes.playlistTitle,
        soundcloudUrl: playlistRes.soundcloudUrl,
        totalFound: playlistRes.totalFound,
        tracks: playlistRes.tracks,
      });
      return;
    }

    const resolvedTrack = await resolveSoundCloudTrackMetadata(canonical, station);
    if (!resolvedTrack.ok) {
      res.status(400).json({ error: resolvedTrack.error });
      return;
    }
    res.json({
      kind: 'track',
      playlistTitle: null,
      soundcloudUrl: resolvedTrack.track.soundcloudUrl,
      totalFound: 1,
      tracks: [resolvedTrack.track],
    });
  });

  // Add one or multiple SoundCloud tracks or full SoundCloud playlists to a radio station (Admin-only)
  app.post('/api/author/radio/tracks', async (req, res) => {
    const db = ensureDatabase();
    const body = req.body as { url?: unknown; urls?: unknown; station?: unknown };
    const station: RadioStationId = body.station === 'electronic' ? 'electronic' : 'indie';
    const candidateInputs: string[] = [];

    if (typeof body.url === 'string' && body.url.trim()) {
      for (const part of body.url.split(/[\r\n]+/)) {
        const clean = part.trim();
        if (clean) candidateInputs.push(clean);
      }
    }
    if (Array.isArray(body.urls)) {
      for (const item of body.urls) {
        if (typeof item === 'string' && item.trim()) {
          candidateInputs.push(item.trim());
        }
      }
    }

    const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 100);
    if (uniqueInputs.length === 0) {
      res.status(400).json({ error: 'Вставте посилання на пісню або плейлист SoundCloud.' });
      return;
    }

    if (db.radioTracks.length >= 200) {
      res.status(400).json({ error: 'Список радіо заповнений (максимум 200 треків).' });
      return;
    }

    const addedTracks: RadioTrack[] = [];
    let activatedTrackId: string | null = null;
    let mutated = false;
    let skippedDuplicates = 0;
    let lastPlaylistTitle: string | null = null;
    let playlistTrackAddedCount = 0;

    const canonicalInputs: string[] = [];
    for (const rawUrl of uniqueInputs) {
      const normalized = normalizeSoundCloudInputUrl(rawUrl);
      if (!normalized) {
        res.status(400).json({
          error: 'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/track або /sets/playlist).',
        });
        return;
      }
      canonicalInputs.push(await resolveSoundCloudShortUrl(normalized));
    }

    const resolvedTracksQueue: RadioTrack[] = [];
    const singleTrackUrls: string[] = [];

    for (const canonical of canonicalInputs) {
      if (isSoundCloudPlaylistUrl(canonical)) {
        const remainingCapacity = Math.max(1, 200 - db.radioTracks.length - resolvedTracksQueue.length);
        const playlistRes = await resolveSoundCloudPlaylistTracks(
          canonical,
          station,
          Math.min(100, remainingCapacity + 25)
        );
        if (!playlistRes.ok) {
          res.status(400).json({ error: playlistRes.error });
          return;
        }
        lastPlaylistTitle = playlistRes.playlistTitle;
        playlistTrackAddedCount += playlistRes.tracks.length;
        resolvedTracksQueue.push(...playlistRes.tracks);
      } else {
        singleTrackUrls.push(canonical);
      }
    }

    for (let i = 0; i < singleTrackUrls.length; i += 8) {
      const batch = singleTrackUrls.slice(i, i + 8);
      const batchResults = await Promise.all(
        batch.map((trackUrl) => resolveSoundCloudTrackMetadata(trackUrl, station))
      );
      for (const result of batchResults) {
        if (!result.ok) {
          res.status(400).json({ error: result.error });
          return;
        }
        resolvedTracksQueue.push(result.track);
      }
    }

    for (const resolvedTrack of resolvedTracksQueue) {
      const existing = db.radioTracks.find(
        (t) =>
          (t.station === 'electronic' ? 'electronic' : 'indie') === station &&
          t.soundcloudUrl.toLowerCase() === resolvedTrack.soundcloudUrl.toLowerCase()
      );
      if (existing) {
        skippedDuplicates += 1;
        if (!activatedTrackId) activatedTrackId = existing.id;
        continue;
      }
      if (db.radioTracks.length >= 200) break;
      resolvedTrack.order = db.radioTracks.length;
      db.radioTracks.push(resolvedTrack);
      addedTracks.push(resolvedTrack);
      if (!activatedTrackId) activatedTrackId = resolvedTrack.id;
      mutated = true;
    }

    if (mutated) {
      saveDatabase(db);
    }

    res.status(mutated ? 201 : 200).json({
      station,
      addedTracks,
      skippedDuplicates,
      playlistTitle: lastPlaylistTitle,
      playlistTrackAddedCount,
      activatedTrackId:
        activatedTrackId ||
        db.radioTracks.find((t) => (t.station === 'electronic' ? 'electronic' : 'indie') === station)?.id ||
        null,
      radioTracks: db.radioTracks,
    });
  });

  // Sync persisted radio tracks into server cache when hydrated from Firestore (Admin-only)
  app.put('/api/author/radio/tracks/sync', (req, res) => {
    const db = ensureDatabase();
    const { tracks } = req.body as { tracks?: unknown };
    if (!Array.isArray(tracks)) {
      res.status(400).json({ error: 'Невірний формат списку треків.' });
      return;
    }
    const sanitized: RadioTrack[] = [];
    const seenIds = new Set<string>();
    for (const raw of tracks.slice(0, 200)) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Partial<RadioTrack>;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const title = typeof item.title === 'string' ? item.title.trim().slice(0, 200) : '';
      const soundcloudUrl =
        typeof item.soundcloudUrl === 'string' ? item.soundcloudUrl.trim().slice(0, 500) : '';
      if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || seenIds.has(id)) continue;
      if (!title || !/^https?:\/\/.+/.test(soundcloudUrl)) continue;
      seenIds.add(id);
      const embedTargetUrl =
        typeof item.embedTargetUrl === 'string' && /^https?:\/\/.+/.test(item.embedTargetUrl.trim())
          ? item.embedTargetUrl.trim().slice(0, 500)
          : soundcloudUrl;
      const artworkUrl =
        typeof item.artworkUrl === 'string' && /^https?:\/\/.+/.test(item.artworkUrl.trim())
          ? item.artworkUrl.trim().slice(0, 500)
          : undefined;
      sanitized.push({
        id,
        title,
        artist:
          typeof item.artist === 'string' && item.artist.trim()
            ? item.artist.trim().slice(0, 140)
            : 'SoundCloud',
        soundcloudUrl,
        embedTargetUrl,
        ...(artworkUrl ? { artworkUrl } : {}),
        station: item.station === 'electronic' ? 'electronic' : 'indie',
        order: sanitized.length,
        addedAt: typeof item.addedAt === 'string' ? item.addedAt : new Date().toISOString(),
      });
    }
    db.radioTracks = sanitized;
    saveDatabase(db);
    res.json({ radioTracks: db.radioTracks });
  });

  // Reorder SoundCloud tracks in the radio playlist or within a specific station (Admin-only)
  app.put('/api/author/radio/tracks/reorder', (req, res) => {
    const db = ensureDatabase();
    const { orderedIds, station } = req.body as { orderedIds?: unknown; station?: unknown };
    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ error: 'Невірний формат списку треків.' });
      return;
    }
    const cleanIds = orderedIds.filter((id): id is string => typeof id === 'string');
    const targetStation: RadioStationId | null =
      station === 'indie' || station === 'electronic' ? station : null;

    if (targetStation) {
      const stationTracks = db.radioTracks.filter(
        (t) => (t.station === 'electronic' ? 'electronic' : 'indie') === targetStation
      );
      const otherTracks = db.radioTracks.filter(
        (t) => (t.station === 'electronic' ? 'electronic' : 'indie') !== targetStation
      );
      const byId = new Map(stationTracks.map((t) => [t.id, t]));
      const reorderedStation: RadioTrack[] = [];
      const seen = new Set<string>();
      for (const id of cleanIds) {
        const found = byId.get(id);
        if (found && !seen.has(id)) {
          reorderedStation.push(found);
          seen.add(id);
        }
      }
      for (const track of stationTracks) {
        if (!seen.has(track.id)) {
          reorderedStation.push(track);
        }
      }
      db.radioTracks = [...reorderedStation, ...otherTracks].map((t, idx) => ({
        ...t,
        order: idx,
      }));
    } else {
      const byId = new Map(db.radioTracks.map((t) => [t.id, t]));
      const reordered: RadioTrack[] = [];
      const seen = new Set<string>();
      for (const id of cleanIds) {
        const found = byId.get(id);
        if (found && !seen.has(id)) {
          reordered.push(found);
          seen.add(id);
        }
      }
      for (const track of db.radioTracks) {
        if (!seen.has(track.id)) {
          reordered.push(track);
        }
      }
      db.radioTracks = reordered.map((t, idx) => ({ ...t, order: idx }));
    }

    saveDatabase(db);
    res.json({ radioTracks: db.radioTracks });
  });

  // Remove a track from the radio playlist (Admin-only)
  app.delete('/api/author/radio/tracks/:id', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = db.radioTracks.length;
    db.radioTracks = db.radioTracks.filter((t) => t.id !== id).map((t, idx) => ({ ...t, order: idx }));
    const deletedLocally = db.radioTracks.length !== before;
    if (deletedLocally) {
      saveDatabase(db);
    }

    const token = extractBearerToken(req);
    const deletedInCloud = token ? await deleteRadioTrackInFirestore(id, token) : false;

    if (!deletedLocally && !deletedInCloud) {
      res.json({ deletedId: id, radioTracks: db.radioTracks, alreadyAbsent: true });
      return;
    }

    res.json({ deletedId: id, radioTracks: db.radioTracks });
  });

  // ── Weekly Music Selection (beside Radio, Admin CRUD) ─────────────────
  const sortWeeklyMusicSelections = (list: WeeklyMusicSelection[]): WeeklyMusicSelection[] =>
    [...list].sort((a, b) =>
      b.periodStart !== a.periodStart
        ? b.periodStart.localeCompare(a.periodStart)
        : b.createdAt.localeCompare(a.createdAt)
    );

  const sanitizeWeeklyMusicPhotoList = (rawPhotos: unknown): string[] => {
    if (!Array.isArray(rawPhotos)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of rawPhotos) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim().slice(0, 1000);
      if (!trimmed) continue;
      if (!/^(\/uploads\/[^\s]+|https?:\/\/[^\s]+)$/i.test(trimmed)) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= 12) break;
    }
    return out;
  };

  const sanitizeWeeklyMusicTrackList = (rawTracks: unknown): WeeklyMusicTrack[] => {
    if (!Array.isArray(rawTracks)) return [];
    const seenUrl = new Set<string>();
    const out: WeeklyMusicTrack[] = [];
    for (const raw of rawTracks) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Partial<WeeklyMusicTrack>;
      const scUrl = typeof item.soundcloudUrl === 'string' ? item.soundcloudUrl.trim().slice(0, 500) : '';
      const title = typeof item.title === 'string' ? item.title.trim().slice(0, 200) : '';
      if (!/^https?:\/\/.+/.test(scUrl) || !title) continue;
      const key = scUrl.toLowerCase();
      if (seenUrl.has(key)) continue;
      seenUrl.add(key);
      const idRaw = typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(item.id.trim())
        ? item.id.trim()
        : `wmt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const embedTargetUrl =
        typeof item.embedTargetUrl === 'string' && /^https?:\/\/.+/.test(item.embedTargetUrl.trim())
          ? item.embedTargetUrl.trim().slice(0, 500)
          : scUrl;
      const artworkUrl =
        typeof item.artworkUrl === 'string' && /^https?:\/\/.+/.test(item.artworkUrl.trim())
          ? item.artworkUrl.trim().slice(0, 500)
          : undefined;
      out.push({
        id: idRaw,
        title,
        artist:
          typeof item.artist === 'string' && item.artist.trim()
            ? item.artist.trim().slice(0, 140)
            : 'SoundCloud',
        soundcloudUrl: scUrl,
        embedTargetUrl,
        ...(artworkUrl ? { artworkUrl } : {}),
      });
      if (out.length >= 50) break;
    }
    return out;
  };

  const resolveWeeklySoundCloudInputs = async (
    rawUrl?: unknown,
    rawUrls?: unknown
  ): Promise<
    | { ok: true; tracks: WeeklyMusicTrack[]; playlistTitle: string | null }
    | { ok: false; error: string }
  > => {
    const candidateInputs: string[] = [];
    if (typeof rawUrl === 'string' && rawUrl.trim()) {
      for (const part of rawUrl.split(/[\r\n]+/)) {
        const clean = part.trim();
        if (clean) candidateInputs.push(clean);
      }
    }
    if (Array.isArray(rawUrls)) {
      for (const item of rawUrls) {
        if (typeof item === 'string' && item.trim()) {
          candidateInputs.push(item.trim());
        }
      }
    }
    const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 50);
    if (uniqueInputs.length === 0) {
      return { ok: false, error: 'Вставте посилання на пісню або плейлист SoundCloud.' };
    }

    const canonicalInputs: string[] = [];
    for (const rawInput of uniqueInputs) {
      const normalized = normalizeSoundCloudInputUrl(rawInput);
      if (!normalized) {
        return {
          ok: false,
          error:
            'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/track або /sets/playlist).',
        };
      }
      canonicalInputs.push(await resolveSoundCloudShortUrl(normalized));
    }

    const resolvedTracks: WeeklyMusicTrack[] = [];
    const singleUrls: string[] = [];
    let playlistTitle: string | null = null;

    for (const canonical of canonicalInputs) {
      if (isSoundCloudPlaylistUrl(canonical)) {
        const playlistRes = await resolveSoundCloudPlaylistTracks(canonical, 'indie', 50);
        if (!playlistRes.ok) {
          return { ok: false, error: playlistRes.error };
        }
        playlistTitle = playlistRes.playlistTitle;
        for (const t of playlistRes.tracks) {
          resolvedTracks.push({
            id: `wmt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            title: t.title,
            artist: t.artist,
            soundcloudUrl: t.soundcloudUrl,
            embedTargetUrl: t.embedTargetUrl || t.soundcloudUrl,
            ...(t.artworkUrl ? { artworkUrl: t.artworkUrl } : {}),
          });
        }
      } else {
        singleUrls.push(canonical);
      }
    }

    for (let i = 0; i < singleUrls.length; i += 8) {
      const batch = singleUrls.slice(i, i + 8);
      const batchResults = await Promise.all(
        batch.map((trackUrl) => resolveSoundCloudTrackMetadata(trackUrl, 'indie'))
      );
      for (const result of batchResults) {
        if (!result.ok) {
          return { ok: false, error: result.error };
        }
        resolvedTracks.push({
          id: `wmt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          title: result.track.title,
          artist: result.track.artist,
          soundcloudUrl: result.track.soundcloudUrl,
          embedTargetUrl: result.track.embedTargetUrl || result.track.soundcloudUrl,
          ...(result.track.artworkUrl ? { artworkUrl: result.track.artworkUrl } : {}),
        });
      }
    }

    return {
      ok: true,
      tracks: sanitizeWeeklyMusicTrackList(resolvedTracks),
      playlistTitle,
    };
  };

  // Resolve SoundCloud track(s) or playlist URL(s) into structured tracks (Admin-only)
  app.post('/api/author/weekly-music/resolve-soundcloud', async (req, res) => {
    const body = req.body as { url?: unknown; urls?: unknown };
    const result = await resolveWeeklySoundCloudInputs(body.url, body.urls);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      playlistTitle: result.playlistTitle,
      tracks: result.tracks,
    });
  });

  // Create (or upsert) a weekly music selection (Admin-only)
  app.post('/api/author/weekly-music', async (req, res) => {
    const db = ensureDatabase();
    const body = req.body as {
      weekKey?: unknown;
      text?: unknown;
      photos?: unknown;
      tracks?: unknown;
      soundcloudUrl?: unknown;
      soundcloudUrls?: unknown;
    };

    const rawWeekKey = typeof body.weekKey === 'string' ? body.weekKey.trim() : '';
    const period = rawWeekKey
      ? getWeekPeriodForWeekKey(rawWeekKey)
      : getWeekPeriodForDate();
    if (!period) {
      res.status(400).json({ error: 'Вкажіть коректний тиждень у форматі РРРР-WНН.' });
      return;
    }

    const cleanText = typeof body.text === 'string' ? body.text.trim().slice(0, 5000) : '';
    const cleanPhotos = sanitizeWeeklyMusicPhotoList(body.photos);
    let cleanTracks = sanitizeWeeklyMusicTrackList(body.tracks);

    const hasRawSoundCloudInput =
      (typeof body.soundcloudUrl === 'string' && body.soundcloudUrl.trim().length > 0) ||
      (Array.isArray(body.soundcloudUrls) && body.soundcloudUrls.length > 0);
    if (hasRawSoundCloudInput) {
      const scRes = await resolveWeeklySoundCloudInputs(body.soundcloudUrl, body.soundcloudUrls);
      if (!scRes.ok) {
        res.status(400).json({ error: scRes.error });
        return;
      }
      cleanTracks = sanitizeWeeklyMusicTrackList([...cleanTracks, ...scRes.tracks]);
    }

    if (!cleanText && cleanPhotos.length === 0 && cleanTracks.length === 0) {
      res.status(400).json({ error: 'Додайте музику з SoundCloud, фото або короткий текст.' });
      return;
    }

    if (!Array.isArray(db.weeklyMusicSelections)) {
      db.weeklyMusicSelections = [];
    }

    const now = new Date().toISOString();
    const existingIdx = db.weeklyMusicSelections.findIndex((s) => s.weekKey === period.weekKey);
    let savedSelection: WeeklyMusicSelection;

    if (existingIdx >= 0) {
      const existing = db.weeklyMusicSelections[existingIdx];
      savedSelection = {
        ...existing,
        weekKey: period.weekKey,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        periodLabel: period.periodLabel,
        ...(cleanText ? { text: cleanText } : {}),
        photos: cleanPhotos,
        tracks: cleanTracks,
        updatedAt: now,
      };
      if (!cleanText) {
        delete savedSelection.text;
      }
      db.weeklyMusicSelections[existingIdx] = savedSelection;
    } else {
      savedSelection = {
        id: `wmusic_${period.weekKey}`,
        weekKey: period.weekKey,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        periodLabel: period.periodLabel,
        ...(cleanText ? { text: cleanText } : {}),
        photos: cleanPhotos,
        tracks: cleanTracks,
        createdAt: now,
        updatedAt: now,
      };
      db.weeklyMusicSelections.unshift(savedSelection);
    }

    db.weeklyMusicSelections = sortWeeklyMusicSelections(db.weeklyMusicSelections);
    saveDatabase(db);

    const token = extractBearerToken(req);
    if (token) {
      void syncSingleWeeklyMusicSelectionInFirestore(savedSelection, token).catch(() => {});
    }

    res.status(existingIdx >= 0 ? 200 : 201).json({
      selection: savedSelection,
      weeklyMusicSelections: db.weeklyMusicSelections,
    });
  });

  // Update an existing weekly music selection (Admin-only)
  app.put('/api/author/weekly-music/:id', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const list = Array.isArray(db.weeklyMusicSelections) ? db.weeklyMusicSelections : [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Щотижневу підбірку не знайдено.' });
      return;
    }

    const existing = list[idx];
    const body = req.body as {
      weekKey?: unknown;
      text?: unknown;
      photos?: unknown;
      tracks?: unknown;
    };

    const nextPeriod =
      typeof body.weekKey === 'string' && body.weekKey.trim()
        ? getWeekPeriodForWeekKey(body.weekKey.trim())
        : {
            weekKey: existing.weekKey,
            periodStart: existing.periodStart,
            periodEnd: existing.periodEnd,
            periodLabel: existing.periodLabel,
          };
    if (!nextPeriod) {
      res.status(400).json({ error: 'Вкажіть коректний тиждень у форматі РРРР-WНН.' });
      return;
    }

    const nextText =
      typeof body.text === 'string'
        ? body.text.trim().slice(0, 5000) || undefined
        : existing.text;
    const nextPhotos =
      body.photos !== undefined ? sanitizeWeeklyMusicPhotoList(body.photos) : existing.photos;
    const nextTracks =
      body.tracks !== undefined ? sanitizeWeeklyMusicTrackList(body.tracks) : existing.tracks;

    if (!nextText && nextPhotos.length === 0 && nextTracks.length === 0) {
      res.status(400).json({ error: 'Додайте музику з SoundCloud, фото або короткий текст.' });
      return;
    }

    const updated: WeeklyMusicSelection = {
      ...existing,
      weekKey: nextPeriod.weekKey,
      periodStart: nextPeriod.periodStart,
      periodEnd: nextPeriod.periodEnd,
      periodLabel: nextPeriod.periodLabel,
      ...(nextText ? { text: nextText } : {}),
      photos: nextPhotos,
      tracks: nextTracks,
      updatedAt: new Date().toISOString(),
    };
    if (!nextText) {
      delete updated.text;
    }

    list[idx] = updated;
    db.weeklyMusicSelections = sortWeeklyMusicSelections(list);
    saveDatabase(db);

    const token = extractBearerToken(req);
    if (token) {
      void syncSingleWeeklyMusicSelectionInFirestore(updated, token).catch(() => {});
    }

    res.json({
      selection: updated,
      weeklyMusicSelections: db.weeklyMusicSelections,
    });
  });

  // Delete a weekly music selection (Admin-only)
  app.delete('/api/author/weekly-music/:id', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const list = Array.isArray(db.weeklyMusicSelections) ? db.weeklyMusicSelections : [];
    const before = list.length;
    db.weeklyMusicSelections = sortWeeklyMusicSelections(list.filter((s) => s.id !== id));
    const deletedLocally = db.weeklyMusicSelections.length !== before;
    if (deletedLocally) {
      saveDatabase(db);
    }

    const token = extractBearerToken(req);
    const deletedInCloud = token ? await deleteWeeklyMusicSelectionInFirestore(id, token) : false;

    res.json({
      deletedId: id,
      deletedLocally,
      deletedInCloud,
      weeklyMusicSelections: db.weeklyMusicSelections,
    });
  });

  // ── Monthly SoundCloud Selections (Admin CRUD) ──────────────────────────
  const UK_MONTH_NAMES = [
    'Січень',
    'Лютий',
    'Березень',
    'Квітень',
    'Травень',
    'Червень',
    'Липень',
    'Серпень',
    'Вересень',
    'Жовтень',
    'Листопад',
    'Грудень',
  ];

  const formatDefaultMonthTitle = (monthKey: string): string => {
    const match = monthKey.match(/^(\d{4})-(\d{2})$/);
    if (!match) return monthKey;
    const monthIndex = Number(match[2]) - 1;
    const label = UK_MONTH_NAMES[monthIndex] || match[2];
    return `${label} ${match[1]}`;
  };

  const getSortedSelections = (db: SiteDatabase): MonthlySelection[] =>
    [...(db.monthlySelections || [])].sort((a, b) =>
      a.monthKey !== b.monthKey ? b.monthKey.localeCompare(a.monthKey) : a.order - b.order
    );

  // Create a new monthly selection
  app.post('/api/author/selections', (req, res) => {
    const db = ensureDatabase();
    const body = req.body as { monthKey?: unknown; title?: unknown; description?: unknown };
    const monthKey = typeof body.monthKey === 'string' ? body.monthKey.trim() : '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      res.status(400).json({ error: 'Вкажіть коректний місяць у форматі РРРР-ММ.' });
      return;
    }
    const rawTitle = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : '';
    const title = rawTitle || formatDefaultMonthTitle(monthKey);
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim().slice(0, 1000)
        : undefined;

    const now = new Date().toISOString();
    const selection: MonthlySelection = {
      id: `sel_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      monthKey,
      title,
      ...(description ? { description } : {}),
      tracks: [],
      order: 0,
      createdAt: now,
      updatedAt: now,
    };

    db.monthlySelections = [selection, ...(db.monthlySelections || [])].map((item, idx) => ({
      ...item,
      order: idx,
    }));
    saveDatabase(db);
    res.status(201).json({
      selection,
      monthlySelections: getSortedSelections(db),
    });
  });

  // Update monthly selection metadata
  app.put('/api/author/selections/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const list = db.monthlySelections || [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Щомісячну підбірку не знайдено.' });
      return;
    }
    const body = req.body as { monthKey?: unknown; title?: unknown; description?: unknown };
    const existing = list[idx];
    const nextMonthKey =
      typeof body.monthKey === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.monthKey.trim())
        ? body.monthKey.trim()
        : existing.monthKey;
    const nextTitle =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 160)
        : existing.title;
    const nextDescription =
      typeof body.description === 'string'
        ? body.description.trim().slice(0, 1000) || undefined
        : existing.description;

    const updated: MonthlySelection = {
      ...existing,
      monthKey: nextMonthKey,
      title: nextTitle,
      ...(nextDescription ? { description: nextDescription } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (!nextDescription) {
      delete updated.description;
    }

    list[idx] = updated;
    db.monthlySelections = list;
    saveDatabase(db);
    res.json({
      selection: updated,
      monthlySelections: getSortedSelections(db),
    });
  });

  // Delete a monthly selection
  app.delete('/api/author/selections/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = (db.monthlySelections || []).length;
    db.monthlySelections = (db.monthlySelections || [])
      .filter((s) => s.id !== id)
      .map((s, idx) => ({ ...s, order: idx }));
    if (db.monthlySelections.length !== before) {
      saveDatabase(db);
    }
    res.json({
      deletedId: id,
      monthlySelections: getSortedSelections(db),
    });
  });

  // Import one or multiple SoundCloud tracks or full playlists into a monthly selection
  app.post('/api/author/selections/:id/tracks', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const list = db.monthlySelections || [];
    const selIndex = list.findIndex((s) => s.id === id);
    if (selIndex === -1) {
      res.status(404).json({ error: 'Щомісячну підбірку не знайдено.' });
      return;
    }

    const selection = list[selIndex];
    if (selection.tracks.length >= 100) {
      res.status(400).json({ error: 'У підбірці може бути максимум 100 треків.' });
      return;
    }

    const body = req.body as { url?: unknown; urls?: unknown; note?: unknown };
    const sharedNote =
      typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : undefined;
    const candidateInputs: string[] = [];

    if (typeof body.url === 'string' && body.url.trim()) {
      for (const part of body.url.split(/[\r\n]+/)) {
        const clean = part.trim();
        if (clean) candidateInputs.push(clean);
      }
    }
    if (Array.isArray(body.urls)) {
      for (const item of body.urls) {
        if (typeof item === 'string' && item.trim()) {
          candidateInputs.push(item.trim());
        }
      }
    }

    const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 100);
    if (uniqueInputs.length === 0) {
      res.status(400).json({ error: 'Вставте посилання на пісню або плейлист SoundCloud.' });
      return;
    }

    const canonicalInputs: string[] = [];
    for (const rawUrl of uniqueInputs) {
      const normalized = normalizeSoundCloudInputUrl(rawUrl);
      if (!normalized) {
        res.status(400).json({
          error:
            'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/track або /sets/playlist).',
        });
        return;
      }
      canonicalInputs.push(await resolveSoundCloudShortUrl(normalized));
    }

    const resolvedTracksQueue: RadioTrack[] = [];
    const singleTrackUrls: string[] = [];
    let lastPlaylistTitle: string | null = null;

    for (const canonical of canonicalInputs) {
      if (isSoundCloudPlaylistUrl(canonical)) {
        const remainingCapacity = Math.max(
          1,
          100 - selection.tracks.length - resolvedTracksQueue.length
        );
        const playlistRes = await resolveSoundCloudPlaylistTracks(
          canonical,
          'indie',
          Math.min(100, remainingCapacity + 25)
        );
        if (!playlistRes.ok) {
          res.status(400).json({ error: playlistRes.error });
          return;
        }
        lastPlaylistTitle = playlistRes.playlistTitle;
        resolvedTracksQueue.push(...playlistRes.tracks);
      } else {
        singleTrackUrls.push(canonical);
      }
    }

    for (let i = 0; i < singleTrackUrls.length; i += 8) {
      const batch = singleTrackUrls.slice(i, i + 8);
      const batchResults = await Promise.all(
        batch.map((trackUrl) => resolveSoundCloudTrackMetadata(trackUrl, 'indie'))
      );
      for (const result of batchResults) {
        if (!result.ok) {
          res.status(400).json({ error: result.error });
          return;
        }
        resolvedTracksQueue.push(result.track);
      }
    }

    const addedTracks: MonthlySelectionTrack[] = [];
    let skippedDuplicates = 0;
    const nextTracks = [...selection.tracks];

    for (const resolved of resolvedTracksQueue) {
      const duplicate = nextTracks.some(
        (t) => t.soundcloudUrl.toLowerCase() === resolved.soundcloudUrl.toLowerCase()
      );
      if (duplicate) {
        skippedDuplicates += 1;
        continue;
      }
      if (nextTracks.length >= 100) break;
      const track: MonthlySelectionTrack = {
        id: `seltr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        title: resolved.title,
        artist: resolved.artist,
        soundcloudUrl: resolved.soundcloudUrl,
        embedTargetUrl: resolved.embedTargetUrl || resolved.soundcloudUrl,
        ...(resolved.artworkUrl ? { artworkUrl: resolved.artworkUrl } : {}),
        ...(sharedNote ? { note: sharedNote } : {}),
        addedAt: new Date().toISOString(),
      };
      nextTracks.push(track);
      addedTracks.push(track);
    }

    const updated: MonthlySelection = {
      ...selection,
      tracks: nextTracks,
      updatedAt: new Date().toISOString(),
    };

    if (addedTracks.length > 0) {
      list[selIndex] = updated;
      db.monthlySelections = list;
      saveDatabase(db);
    }

    res.status(addedTracks.length > 0 ? 201 : 200).json({
      selection: updated,
      addedTracks,
      skippedDuplicates,
      playlistTitle: lastPlaylistTitle,
      monthlySelections: getSortedSelections(db),
    });
  });

  // Reorder tracks inside a monthly selection
  app.put('/api/author/selections/:id/tracks/reorder', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const list = db.monthlySelections || [];
    const selIndex = list.findIndex((s) => s.id === id);
    if (selIndex === -1) {
      res.status(404).json({ error: 'Щомісячну підбірку не знайдено.' });
      return;
    }
    const { orderedIds } = req.body as { orderedIds?: unknown };
    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ error: 'Невірний формат списку треків.' });
      return;
    }
    const selection = list[selIndex];
    const byId = new Map(selection.tracks.map((t) => [t.id, t]));
    const reordered: MonthlySelectionTrack[] = [];
    const seen = new Set<string>();
    for (const rawId of orderedIds) {
      if (typeof rawId !== 'string') continue;
      const found = byId.get(rawId);
      if (found && !seen.has(rawId)) {
        reordered.push(found);
        seen.add(rawId);
      }
    }
    for (const track of selection.tracks) {
      if (!seen.has(track.id)) {
        reordered.push(track);
      }
    }
    const updated: MonthlySelection = {
      ...selection,
      tracks: reordered,
      updatedAt: new Date().toISOString(),
    };
    list[selIndex] = updated;
    db.monthlySelections = list;
    saveDatabase(db);
    res.json({
      selection: updated,
      monthlySelections: getSortedSelections(db),
    });
  });

  // Update curator note / title / artist of a track inside a monthly selection
  app.patch('/api/author/selections/:id/tracks/:trackId', (req, res) => {
    const db = ensureDatabase();
    const { id, trackId } = req.params;
    const list = db.monthlySelections || [];
    const selIndex = list.findIndex((s) => s.id === id);
    if (selIndex === -1) {
      res.status(404).json({ error: 'Щомісячну підбірку не знайдено.' });
      return;
    }
    const selection = list[selIndex];
    const trackIndex = selection.tracks.findIndex((t) => t.id === trackId);
    if (trackIndex === -1) {
      res.status(404).json({ error: 'Трек не знайдено.' });
      return;
    }

    const body = req.body as { title?: unknown; artist?: unknown; note?: unknown };
    const existingTrack = selection.tracks[trackIndex];
    const nextTitle =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 200)
        : existingTrack.title;
    const nextArtist =
      typeof body.artist === 'string' && body.artist.trim()
        ? body.artist.trim().slice(0, 140)
        : existingTrack.artist;
    const nextNote =
      typeof body.note === 'string'
        ? body.note.trim().slice(0, 300) || undefined
        : existingTrack.note;

    const updatedTrack: MonthlySelectionTrack = {
      ...existingTrack,
      title: nextTitle,
      artist: nextArtist,
      ...(nextNote ? { note: nextNote } : {}),
    };
    if (!nextNote) {
      delete updatedTrack.note;
    }

    const nextTracks = [...selection.tracks];
    nextTracks[trackIndex] = updatedTrack;
    const updatedSelection: MonthlySelection = {
      ...selection,
      tracks: nextTracks,
      updatedAt: new Date().toISOString(),
    };
    list[selIndex] = updatedSelection;
    db.monthlySelections = list;
    saveDatabase(db);
    res.json({
      selection: updatedSelection,
      track: updatedTrack,
      monthlySelections: getSortedSelections(db),
    });
  });

  // Delete a track from a monthly selection
  app.delete('/api/author/selections/:id/tracks/:trackId', (req, res) => {
    const db = ensureDatabase();
    const { id, trackId } = req.params;
    const list = db.monthlySelections || [];
    const selIndex = list.findIndex((s) => s.id === id);
    if (selIndex === -1) {
      res.status(404).json({ error: 'Щомісячну підбірку не знайдено.' });
      return;
    }
    const selection = list[selIndex];
    const nextTracks = selection.tracks.filter((t) => t.id !== trackId);
    const updatedSelection: MonthlySelection = {
      ...selection,
      tracks: nextTracks,
      updatedAt: new Date().toISOString(),
    };
    if (nextTracks.length !== selection.tracks.length) {
      list[selIndex] = updatedSelection;
      db.monthlySelections = list;
      saveDatabase(db);
    }
    res.json({
      deletedTrackId: trackId,
      selection: updatedSelection,
      monthlySelections: getSortedSelections(db),
    });
  });

  // Remove attached PDF from a prose work (Admin-only)
  app.delete('/api/author/works/prose/:id/pdf', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.prose.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }
    const existing = db.prose[index];
    if (existing.pdfStorageKey) {
      const pdfPath = resolveConfinedFilePath(PROSE_PDF_DIR, existing.pdfStorageKey);
      if (pdfPath && fs.existsSync(pdfPath)) {
        try {
          fs.unlinkSync(pdfPath);
        } catch {
          // Ignore cleanup failure
        }
      }
    }
    const { pdfFileName: _n, pdfFileSize: _s, pdfStorageKey: _k, ...rest } = existing;
    db.prose[index] = { ...rest };
    saveDatabase(db);
    res.json({ item: enrichProseForAuthor(db.prose[index], db) });
  });

  // Update paid access pricing and/or collection/book tags on an existing prose work (Admin-only)
  app.put('/api/author/works/prose/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.prose.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }
    const body = req.body as {
      accessMode?: ProseAccessMode;
      requiresAuth?: boolean;
      isPaid?: boolean;
      priceUah?: number;
      tagIds?: string[];
      status?: ProseStatus | null | 'none';
      moodboardUrls?: string[];
    };
    const current = db.prose[index];
    const currentMode = resolveProseAccessMode(current);
    let nextAccessMode: ProseAccessMode = currentMode;
    if (body.accessMode === 'public' || body.accessMode === 'authorized' || body.accessMode === 'paid') {
      nextAccessMode = body.accessMode;
    } else if (body.requiresAuth === true) {
      nextAccessMode = 'authorized';
    } else if (body.isPaid !== undefined) {
      nextAccessMode = body.isPaid ? 'paid' : 'public';
    }

    const nextIsPaid = nextAccessMode === 'paid';
    const nextRequiresAuth = nextAccessMode === 'authorized';
    const nextPrice = nextIsPaid
      ? Math.max(10, Math.round(Number(body.priceUah) || current.priceUah || 75))
      : 0;
    const nextTagIds =
      body.tagIds !== undefined ? getValidProseTagIds(body.tagIds, db) : getValidProseTagIds(current.tagIds, db);
    const nextStatus =
      body.status === undefined
        ? current.status
        : body.status === null || body.status === 'none'
          ? ('none' as unknown as ProseStatus)
          : normalizeProseStatus(body.status);
    const validPhotoUrlPattern = /^(\/src\/assets\/|\/uploads\/|\/assets\/|https?:\/\/)/i;
    const nextMoodboardUrls =
      body.moodboardUrls !== undefined && Array.isArray(body.moodboardUrls)
        ? Array.from(
            new Set(
              body.moodboardUrls
                .filter((item): item is string => typeof item === 'string' && validPhotoUrlPattern.test(item.trim()))
                .map((item) => item.trim())
            )
          ).slice(0, 20)
        : current.moodboardUrls;

    db.prose[index] = {
      ...current,
      accessMode: nextAccessMode,
      requiresAuth: nextRequiresAuth,
      isPaid: nextIsPaid,
      priceUah: nextPrice,
      tagIds: nextTagIds,
      status: nextStatus,
      moodboardUrls: nextMoodboardUrls,
    };
    saveDatabase(db);
    res.json({ item: enrichProseForAuthor(db.prose[index], db) });
  });

  // Add a new chapter into a prose card folder (Admin-only)
  app.post('/api/author/works/prose/:id/chapters', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.prose.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const { title, content, publishedAt } = req.body as {
      title?: string;
      content?: string;
      publishedAt?: string;
    };
    const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 140) : '';
    const cleanContent = typeof content === 'string' ? preserveFormattedText(content) : '';
    if (cleanTitle.length < 2) {
      res.status(400).json({ error: 'Назва розділу має містити щонайменше 2 символи.' });
      return;
    }
    if (cleanContent.length < 2) {
      res.status(400).json({ error: 'Додайте текст нового розділу.' });
      return;
    }

    const rawDateStr = typeof publishedAt === 'string' ? publishedAt.trim() : '';
    let formattedPublishedAt = new Date().toLocaleDateString('uk-UA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    if (rawDateStr) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawDateStr)) {
        const [y, m, d] = rawDateStr.split('-').map(Number);
        const parsedDate = new Date(y, m - 1, d);
        if (!Number.isNaN(parsedDate.getTime())) {
          formattedPublishedAt = parsedDate.toLocaleDateString('uk-UA', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });
        }
      } else {
        formattedPublishedAt = rawDateStr;
      }
    }

    const newChapter: ProseChapter = {
      id: `chap-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      title: cleanTitle,
      content: cleanContent,
      publishedAt: formattedPublishedAt,
    };

    const existingChapters = Array.isArray(db.prose[index].chapters) ? db.prose[index].chapters! : [];
    const nextChapters = [...existingChapters, newChapter];
    db.prose[index] = {
      ...db.prose[index],
      chapters: nextChapters,
      pages: computeProseWorkPages({
        content: db.prose[index].content,
        chapters: nextChapters,
        hasPdf: Boolean(db.prose[index].pdfStorageKey),
        fallbackPages: db.prose[index].pages,
      }),
    };
    saveDatabase(db);
    res.status(201).json({ chapter: newChapter, item: enrichProseForAuthor(db.prose[index], db) });
  });

  // Delete a chapter from a prose card folder (Admin-only)
  app.delete('/api/author/works/prose/:id/chapters/:chapterId', (req, res) => {
    const db = ensureDatabase();
    const { id, chapterId } = req.params;
    const index = db.prose.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const existingChapters = Array.isArray(db.prose[index].chapters) ? db.prose[index].chapters! : [];
    const nextChapters = existingChapters.filter((ch) => ch.id !== chapterId);
    if (nextChapters.length === existingChapters.length) {
      res.status(404).json({ error: 'Розділ не знайдено.' });
      return;
    }

    db.prose[index] = {
      ...db.prose[index],
      chapters: nextChapters,
      pages: computeProseWorkPages({
        content: db.prose[index].content,
        chapters: nextChapters,
        hasPdf: Boolean(db.prose[index].pdfStorageKey),
        fallbackPages: db.prose[index].pages,
      }),
    };
    saveDatabase(db);
    res.json({ item: enrichProseForAuthor(db.prose[index], db) });
  });

  // Create a manual bright collection/book tag for prose (Admin-only)
  app.post('/api/author/prose-tags', (req, res) => {
    const db = ensureDatabase();
    const { label, color } = req.body as { label?: string; color?: ProseTagColor };
    const cleanLabel = typeof label === 'string' ? label.trim().slice(0, 60) : '';
    if (cleanLabel.length < 2) {
      res.status(400).json({ error: 'Назва тегу має містити щонайменше 2 символи.' });
      return;
    }
    if (db.proseTags.some((t) => t.label.toLowerCase() === cleanLabel.toLowerCase())) {
      res.status(409).json({ error: 'Такий тег збірки чи книги вже існує.' });
      return;
    }
    const safeColor: ProseTagColor = normalizeProseTagColor(color);
    const newTag: ProseTag = {
      id: `tag-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      label: cleanLabel,
      color: safeColor,
    };
    db.proseTags.push(newTag);
    saveDatabase(db);
    res.status(201).json({ tag: newTag, proseTags: db.proseTags });
  });

  // Update color or label of an existing prose tag (Admin-only)
  app.put('/api/author/prose-tags/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.proseTags.findIndex((t) => t.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Тег не знайдено.' });
      return;
    }
    const { label, color } = req.body as { label?: string; color?: ProseTagColor };
    const current = db.proseTags[index];
    const nextLabel =
      typeof label === 'string' && label.trim().length >= 2 ? label.trim().slice(0, 60) : current.label;
    const nextColor = color !== undefined ? normalizeProseTagColor(color) : current.color;

    db.proseTags[index] = {
      ...current,
      label: nextLabel,
      color: nextColor,
    };
    saveDatabase(db);
    res.json({ tag: db.proseTags[index], proseTags: db.proseTags });
  });

  // Delete a prose collection/book tag and unlink from all works (Admin-only)
  app.delete('/api/author/prose-tags/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = db.proseTags.length;
    db.proseTags = db.proseTags.filter((t) => t.id !== id);
    if (db.proseTags.length === before) {
      res.status(404).json({ error: 'Тег не знайдено.' });
      return;
    }
    db.prose = db.prose.map((work) => ({
      ...work,
      tagIds: (work.tagIds || []).filter((tid) => tid !== id),
    }));
    saveDatabase(db);
    res.json({ deletedId: id, proseTags: db.proseTags });
  });

  // Update homepage hero lead block text, author profile, Monobank, interviews & social links
  app.put('/api/author/settings', (req, res) => {
    const db = ensureDatabase();
    const {
      heroLeadText,
      authorAboutText,
      authorPhotoUrl,
      authorPhotos,
      socialLinks,
      monobankJarUrl,
      monobankModalTitle,
      monobankModalSubtitle,
      monobankCardLabel,
      monobankModalText,
      monobankEmptyText,
      contactEmail,
      interviews,
      homeActionAboutTitle,
      homeActionContactTitle,
      homeActionMonobankTitle,
      homeActionInterviewsTitle,
      homeRepeaters,
      proseAuthDiscountPercent,
      proseTelegramDiscountPercent,
    } = req.body as {
      heroLeadText?: string;
      authorAboutText?: string;
      authorPhotoUrl?: string;
      authorPhotos?: string[];
      socialLinks?: SocialLinkItem[];
      monobankJarUrl?: string;
      monobankModalTitle?: string;
      monobankModalSubtitle?: string;
      monobankCardLabel?: string;
      monobankModalText?: string;
      monobankEmptyText?: string;
      contactEmail?: string;
      interviews?: InterviewLinkItem[];
      homeActionAboutTitle?: string;
      homeActionContactTitle?: string;
      homeActionMonobankTitle?: string;
      homeActionInterviewsTitle?: string;
      homeRepeaters?: unknown;
      proseAuthDiscountPercent?: number;
      proseTelegramDiscountPercent?: number;
    };

    if (proseAuthDiscountPercent !== undefined) {
      const parsedDiscount = Number(proseAuthDiscountPercent);
      if (!Number.isFinite(parsedDiscount)) {
        res.status(400).json({ error: 'Вкажіть коректний відсоток знижки (від 0 до 90%).' });
        return;
      }
      db.proseAuthDiscountPercent = Math.max(0, Math.min(90, Math.round(parsedDiscount)));
    }

    if (proseTelegramDiscountPercent !== undefined) {
      const parsedTgDiscount = Number(proseTelegramDiscountPercent);
      if (!Number.isFinite(parsedTgDiscount)) {
        res.status(400).json({ error: 'Вкажіть коректний відсоток знижки в Прозі для Telegram (від 0 до 90%).' });
        return;
      }
      db.proseTelegramDiscountPercent = Math.max(0, Math.min(90, Math.round(parsedTgDiscount)));
    }

    if (homeActionAboutTitle !== undefined) {
      if (typeof homeActionAboutTitle !== 'string' || homeActionAboutTitle.trim().length === 0 || homeActionAboutTitle.trim().length > 60) {
        res.status(400).json({ error: 'Некоректна назва кнопки (до 60 символів).' });
        return;
      }
      db.homeActionAboutTitle = homeActionAboutTitle.trim();
    }

    if (homeActionContactTitle !== undefined) {
      if (typeof homeActionContactTitle !== 'string' || homeActionContactTitle.trim().length === 0 || homeActionContactTitle.trim().length > 60) {
        res.status(400).json({ error: 'Некоректна назва кнопки (до 60 символів).' });
        return;
      }
      db.homeActionContactTitle = homeActionContactTitle.trim();
    }

    if (homeActionMonobankTitle !== undefined) {
      if (typeof homeActionMonobankTitle !== 'string' || homeActionMonobankTitle.trim().length === 0 || homeActionMonobankTitle.trim().length > 60) {
        res.status(400).json({ error: 'Некоректна назва кнопки (до 60 символів).' });
        return;
      }
      db.homeActionMonobankTitle = homeActionMonobankTitle.trim();
    }

    if (homeActionInterviewsTitle !== undefined) {
      if (typeof homeActionInterviewsTitle !== 'string' || homeActionInterviewsTitle.trim().length === 0 || homeActionInterviewsTitle.trim().length > 60) {
        res.status(400).json({ error: 'Некоректна назва кнопки (до 60 символів).' });
        return;
      }
      db.homeActionInterviewsTitle = homeActionInterviewsTitle.trim();
    }

    if (homeRepeaters !== undefined) {
      db.homeRepeaters = normalizeHomeRepeatersConfig(homeRepeaters);
    }

    if (heroLeadText !== undefined) {
      if (typeof heroLeadText !== 'string' || heroLeadText.trim().length > 500) {
        res.status(400).json({ error: 'Текст опису не може перевищувати 500 символів.' });
        return;
      }
      db.heroLeadText = heroLeadText.trim();
    }

    if (authorAboutText !== undefined) {
      if (typeof authorAboutText !== 'string' || authorAboutText.trim().length > 2500) {
        res.status(400).json({ error: 'Текст блоку «Про мене» не може перевищувати 2500 символів.' });
        return;
      }
      db.authorAboutText = authorAboutText.trim();
    }

    const validPhotoUrlPattern = /^(\/src\/assets\/|\/uploads\/|\/assets\/|https?:\/\/)/i;

    if (authorPhotos !== undefined) {
      if (!Array.isArray(authorPhotos)) {
        res.status(400).json({ error: 'Некоректний формат галереї фото автора.' });
        return;
      }
      const nextPhotos = Array.from(
        new Set(
          authorPhotos
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
        )
      ).slice(0, 20);

      for (const photo of nextPhotos) {
        if (!validPhotoUrlPattern.test(photo)) {
          res.status(400).json({
            error: 'Кожне фото автора повинно бути завантажене або мати валідну URL-адресу.',
          });
          return;
        }
      }

      db.authorPhotos = nextPhotos.length > 0 ? nextPhotos : [DEFAULT_AUTHOR_PHOTO_URL];
      db.authorPhotoUrl = db.authorPhotos[0];
    } else if (authorPhotoUrl !== undefined) {
      if (typeof authorPhotoUrl !== 'string') {
        res.status(400).json({ error: 'Некоректне посилання на фото автора.' });
        return;
      }
      const trimmedPhoto = authorPhotoUrl.trim();
      if (!trimmedPhoto) {
        db.authorPhotoUrl = DEFAULT_AUTHOR_PHOTO_URL;
      } else if (!validPhotoUrlPattern.test(trimmedPhoto)) {
        res.status(400).json({ error: 'Фото автора повинно бути завантажене або мати валідну URL-адресу.' });
        return;
      } else {
        db.authorPhotoUrl = trimmedPhoto;
      }
      const rest = (db.authorPhotos || []).filter((url) => url !== db.authorPhotoUrl);
      db.authorPhotos = [db.authorPhotoUrl, ...rest].slice(0, 20);
    }

    if (socialLinks !== undefined) {
      if (!Array.isArray(socialLinks)) {
        res.status(400).json({ error: 'Некоректний формат списку соціальних мереж.' });
        return;
      }
      const incomingMap = new Map(
        socialLinks
          .filter((item): item is SocialLinkItem => Boolean(item && typeof item.platform === 'string'))
          .map((item) => [item.platform, item])
      );

      const nextSocialLinks: SocialLinkItem[] = [];
      for (const seed of DEFAULT_SOCIAL_LINKS) {
        const incoming = incomingMap.get(seed.platform);
        if (!incoming) {
          const current = db.socialLinks.find((s) => s.platform === seed.platform);
          nextSocialLinks.push(current ? { ...current } : { ...seed });
          continue;
        }
        const rawUrl = typeof incoming.url === 'string' ? incoming.url.trim() : '';
        const normalizedUrl =
          rawUrl && !/^https?:\/\//i.test(rawUrl) && !/^[a-z]+:/i.test(rawUrl)
            ? `https://${rawUrl}`
            : rawUrl;
        if (normalizedUrl && !/^https?:\/\/\S+$/i.test(normalizedUrl)) {
          res.status(400).json({
            error: `Некоректне посилання для ${seed.label}. Використовуйте адресу http:// або https://.`,
          });
          return;
        }
        const enabled = Boolean(incoming.enabled) && Boolean(normalizedUrl);
        nextSocialLinks.push({
          platform: seed.platform,
          label: seed.label,
          url: normalizedUrl,
          enabled,
        });
      }
      db.socialLinks = nextSocialLinks;
    }

    if (monobankJarUrl !== undefined) {
      if (typeof monobankJarUrl !== 'string') {
        res.status(400).json({ error: 'Некоректне посилання на банку Монобанку.' });
        return;
      }
      const rawJar = monobankJarUrl.trim();
      const normalizedJar =
        rawJar && !/^https?:\/\//i.test(rawJar) && !/^[a-z]+:/i.test(rawJar)
          ? `https://${rawJar}`
          : rawJar;
      if (normalizedJar && !/^https?:\/\/\S+$/i.test(normalizedJar)) {
        res.status(400).json({ error: 'Посилання на Монобанку повинно починатися з https:// або http://.' });
        return;
      }
      db.monobankJarUrl = normalizedJar;
    }

    if (monobankModalTitle !== undefined) {
      if (typeof monobankModalTitle !== 'string' || monobankModalTitle.trim().length === 0 || monobankModalTitle.trim().length > 120) {
        res.status(400).json({ error: 'Заголовок вікна Монобанки має містити від 1 до 120 символів.' });
        return;
      }
      db.monobankModalTitle = monobankModalTitle.trim();
    }

    if (monobankModalSubtitle !== undefined) {
      if (typeof monobankModalSubtitle !== 'string' || monobankModalSubtitle.trim().length > 300) {
        res.status(400).json({ error: 'Підзаголовок вікна Монобанки не може перевищувати 300 символів.' });
        return;
      }
      db.monobankModalSubtitle = monobankModalSubtitle.trim();
    }

    if (monobankCardLabel !== undefined) {
      if (typeof monobankCardLabel !== 'string' || monobankCardLabel.trim().length > 80) {
        res.status(400).json({ error: 'Підпис картки Монобанки не може перевищувати 80 символів.' });
        return;
      }
      db.monobankCardLabel = monobankCardLabel.trim();
    }

    if (monobankModalText !== undefined) {
      if (typeof monobankModalText !== 'string' || monobankModalText.trim().length > 1500) {
        res.status(400).json({ error: 'Основний текст вікна Монобанки не може перевищувати 1500 символів.' });
        return;
      }
      db.monobankModalText = monobankModalText.trim();
    }

    if (monobankEmptyText !== undefined) {
      if (typeof monobankEmptyText !== 'string' || monobankEmptyText.trim().length > 1000) {
        res.status(400).json({ error: 'Текст про відсутність посилання на банку не може перевищувати 1000 символів.' });
        return;
      }
      db.monobankEmptyText = monobankEmptyText.trim();
    }

    if (contactEmail !== undefined) {
      if (typeof contactEmail !== 'string') {
        res.status(400).json({ error: 'Некоректна адреса електронної пошти.' });
        return;
      }
      const trimmedEmail = contactEmail.trim();
      if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        res.status(400).json({ error: 'Вкажіть коректний контактний email або залиште поле порожнім.' });
        return;
      }
      db.contactEmail = trimmedEmail;
    }

    if (interviews !== undefined) {
      if (!Array.isArray(interviews)) {
        res.status(400).json({ error: 'Некоректний формат списку розмов.' });
        return;
      }
      const nextInterviews: InterviewLinkItem[] = [];
      for (const item of interviews) {
        if (!item || typeof item !== 'object') continue;
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const outlet = typeof item.outlet === 'string' ? item.outlet.trim() : '';
        const dateLabel = typeof item.dateLabel === 'string' ? item.dateLabel.trim() : '';
        const content = typeof item.content === 'string' ? item.content.trim() : '';
        const rawUrl = typeof item.url === 'string' ? item.url.trim() : '';
        const normalizedUrl =
          rawUrl && !/^https?:\/\//i.test(rawUrl) && !/^[a-z]+:/i.test(rawUrl)
            ? `https://${rawUrl}`
            : rawUrl;
        if (!title || (!content && !normalizedUrl)) {
          res.status(400).json({ error: 'Кожна розмова повинна містити назву та текст або посилання.' });
          return;
        }
        if (normalizedUrl && !/^https?:\/\/\S+$/i.test(normalizedUrl)) {
          res.status(400).json({
            error: `Некоректне посилання для розмови «${title}». Використовуйте https:// або http://.`,
          });
          return;
        }
        nextInterviews.push({
          id:
            typeof item.id === 'string' && item.id.trim()
              ? item.id.trim()
              : `interview-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          title,
          outlet,
          dateLabel,
          ...(content ? { content: content.slice(0, 100000) } : {}),
          ...(normalizedUrl ? { url: normalizedUrl } : {}),
        });
      }
      db.interviews = nextInterviews;
    }

    saveDatabase(db);
    res.json({
      heroLeadText: db.heroLeadText,
      authorAboutText: db.authorAboutText,
      authorPhotoUrl: db.authorPhotoUrl,
      authorPhotos: db.authorPhotos,
      socialLinks: db.socialLinks,
      monobankJarUrl: db.monobankJarUrl,
      monobankModalTitle: db.monobankModalTitle || DEFAULT_MONOBANK_MODAL_TITLE,
      monobankModalSubtitle: db.monobankModalSubtitle ?? DEFAULT_MONOBANK_MODAL_SUBTITLE,
      monobankCardLabel: db.monobankCardLabel ?? DEFAULT_MONOBANK_CARD_LABEL,
      monobankModalText: db.monobankModalText || DEFAULT_MONOBANK_MODAL_TEXT,
      monobankEmptyText: db.monobankEmptyText ?? DEFAULT_MONOBANK_EMPTY_TEXT,
      contactEmail: db.contactEmail,
      interviews: db.interviews,
      homeActionAboutTitle: db.homeActionAboutTitle || 'Про мене',
      homeActionContactTitle:
        db.homeActionContactTitle &&
        db.homeActionContactTitle !== 'Зв’язатися з автором' &&
        db.homeActionContactTitle !== "Зв'язатися з автором"
          ? db.homeActionContactTitle
          : 'Зв’язок',
      homeActionMonobankTitle: db.homeActionMonobankTitle || 'Підтримати через Монобанк',
      homeActionInterviewsTitle: db.homeActionInterviewsTitle || 'Розмови',
      homeRepeaters: normalizeHomeRepeatersConfig(db.homeRepeaters),
      proseAuthDiscountPercent: db.proseAuthDiscountPercent,
      proseTelegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
      storeAuthDiscountPercent: 0,
    });
  });

  // Dedicated Admin endpoint to update discounts for paid prose (authorized & Telegram subscribers)
  app.put('/api/author/prose-discount', (req, res) => {
    const db = ensureDatabase();
    const { discountPercent, proseAuthDiscountPercent, proseTelegramDiscountPercent } = req.body as {
      discountPercent?: number;
      proseAuthDiscountPercent?: number;
      proseTelegramDiscountPercent?: number;
    };

    if (proseTelegramDiscountPercent !== undefined && proseAuthDiscountPercent === undefined && discountPercent === undefined) {
      const numeric = Number(proseTelegramDiscountPercent);
      if (!Number.isFinite(numeric)) {
        res.status(400).json({ error: 'Вкажіть коректне значення знижки від 0 до 90%.' });
        return;
      }
      const clamped = Math.max(0, Math.min(90, Math.round(numeric)));
      db.proseTelegramDiscountPercent = clamped;
      saveDatabase(db);
      res.json({ proseTelegramDiscountPercent: clamped });
      return;
    }

    const raw = proseAuthDiscountPercent ?? discountPercent;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      res.status(400).json({ error: 'Вкажіть коректне значення знижки від 0 до 90%.' });
      return;
    }
    const clamped = Math.max(0, Math.min(90, Math.round(numeric)));
    db.proseAuthDiscountPercent = clamped;
    if (proseTelegramDiscountPercent !== undefined && Number.isFinite(Number(proseTelegramDiscountPercent))) {
      db.proseTelegramDiscountPercent = Math.max(0, Math.min(90, Math.round(Number(proseTelegramDiscountPercent))));
    }
    saveDatabase(db);
    res.json({
      proseAuthDiscountPercent: db.proseAuthDiscountPercent,
      proseTelegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
    });
  });

  // Dedicated Admin endpoint to update Telegram discount for Prose
  app.put('/api/author/prose-telegram-discount', (req, res) => {
    const db = ensureDatabase();
    const { discountPercent, proseTelegramDiscountPercent } = req.body as {
      discountPercent?: number;
      proseTelegramDiscountPercent?: number;
    };
    const raw = proseTelegramDiscountPercent ?? discountPercent;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      res.status(400).json({ error: 'Вкажіть коректне значення знижки від 0 до 90%.' });
      return;
    }
    const clamped = Math.max(0, Math.min(90, Math.round(numeric)));
    db.proseTelegramDiscountPercent = clamped;
    saveDatabase(db);
    res.json({ proseTelegramDiscountPercent: clamped });
  });

  app.patch('/api/author/messages/:id/read', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const msg = db.contactMessages.find((m) => m.id === id);
    if (!msg) {
      res.status(404).json({ error: 'Повідомлення не знайдено.' });
      return;
    }
    msg.read = true;
    saveDatabase(db);
    res.json({ contactMessages: db.contactMessages });
  });

  app.delete('/api/author/messages/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = db.contactMessages.length;
    db.contactMessages = db.contactMessages.filter((m) => m.id !== id);
    if (db.contactMessages.length === before) {
      res.status(404).json({ error: 'Повідомлення не знайдено.' });
      return;
    }
    saveDatabase(db);
    res.json({ contactMessages: db.contactMessages });
  });

  // Upload a custom cover image from admin computer
  app.post('/api/author/upload-cover', async (req, res) => {
    ensureDatabase();
    const { dataUrl } = req.body as { dataUrl?: string };
    if (!dataUrl || typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'Файл зображення не передано.' });
      return;
    }

    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i);
    if (!match) {
      res.status(400).json({ error: 'Підтримуються лише зображення PNG, JPG, WEBP або GIF.' });
      return;
    }

    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength > 6 * 1024 * 1024) {
      res.status(400).json({ error: 'Розмір зображення не повинен перевищувати 6 МБ.' });
      return;
    }

    let processedBuffer = buffer;
    try {
      processedBuffer = await sharp(buffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();
    } catch {
      processedBuffer = buffer;
    }

    const filename = `cover-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), processedBuffer);
    missingUploadCache.delete(filename);

    let cloudSynced = false;
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      const mime = 'image/jpeg';
      try {
        cloudSynced = await saveMediaAssetToFirestore(filename, mime, processedBuffer, adminToken);
      } catch {
        cloudSynced = false;
      }
    }

    res.status(201).json({ url: `/uploads/${filename}`, cloudSynced });
  });

  // Full store product customization for admin
  app.put('/api/author/products/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.products.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Товар не знайдено.' });
      return;
    }

    const existing = db.products[index];
    const body = req.body as Partial<RawStoreProduct>;

    const parsedDiscount =
      typeof body.discountPercent === 'number'
        ? Math.max(0, Math.min(90, Math.round(body.discountPercent)))
        : existing.discountPercent ?? 0;

    const validTypes = ['ebook', 'paper_book', 'wip_gdoc', 'poem_frame', 'painting'] as const;
    const nextType = validTypes.includes(body.type as (typeof validTypes)[number])
      ? (body.type as (typeof validTypes)[number])
      : existing.type;

    const updated: RawStoreProduct = {
      ...existing,
      type: nextType,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : existing.title,
      subtitle: typeof body.subtitle === 'string' && body.subtitle.trim() ? body.subtitle.trim() : existing.subtitle,
      priceUah: typeof body.priceUah === 'number' && body.priceUah > 0 ? Math.round(body.priceUah) : existing.priceUah,
      discountPercent: parsedDiscount,
      promoActive: typeof body.promoActive === 'boolean' ? body.promoActive : Boolean(existing.promoActive),
      promoLabel: typeof body.promoLabel === 'string' ? body.promoLabel.trim() : existing.promoLabel ?? '',
      coverImage: typeof body.coverImage === 'string' && body.coverImage.trim() ? body.coverImage.trim() : existing.coverImage,
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : existing.description,
      sampleExcerpt: typeof body.sampleExcerpt === 'string' ? body.sampleExcerpt.trim() : existing.sampleExcerpt,
      formats: typeof body.formats === 'string' ? body.formats.trim() : existing.formats,
      pages: typeof body.pages === 'number' && body.pages > 0 ? Math.round(body.pages) : existing.pages,
      year: typeof body.year === 'number' && body.year > 0 ? Math.round(body.year) : existing.year,
      binding: typeof body.binding === 'string' ? body.binding.trim() : existing.binding,
      dimensions: typeof body.dimensions === 'string' ? body.dimensions.trim() : existing.dimensions,
      material: typeof body.material === 'string' ? body.material.trim() : existing.material,
      ebookFullText: typeof body.ebookFullText === 'string' ? body.ebookFullText : existing.ebookFullText,
      ebookFileName: typeof body.ebookFileName === 'string' ? body.ebookFileName.trim() : existing.ebookFileName,
      ebookMimeType: typeof body.ebookMimeType === 'string' ? body.ebookMimeType.trim() : existing.ebookMimeType,
      ebookFileSize: typeof body.ebookFileSize === 'number' ? body.ebookFileSize : existing.ebookFileSize,
      ebookStorageKey: typeof body.ebookStorageKey === 'string' ? body.ebookStorageKey.trim() : existing.ebookStorageKey,
      progressLabel: typeof body.progressLabel === 'string' ? body.progressLabel.trim() : existing.progressLabel,
      wordCount: typeof body.wordCount === 'number' && body.wordCount >= 0 ? Math.round(body.wordCount) : existing.wordCount,
      lastUpdated: typeof body.lastUpdated === 'string' && body.lastUpdated.trim() ? body.lastUpdated.trim() : existing.lastUpdated,
      gdocGuestUrl: typeof body.gdocGuestUrl === 'string' ? body.gdocGuestUrl.trim() : existing.gdocGuestUrl,
    };

    db.products[index] = updated;

    db.orders = db.orders.map((order) => ({
      ...order,
      items: order.items.map((item) =>
        item.productId === id
          ? {
              ...item,
              title: updated.title,
              ebookFileName: updated.type === 'ebook' ? updated.ebookFileName : item.ebookFileName,
              ebookFileSize: updated.type === 'ebook' ? updated.ebookFileSize : item.ebookFileSize,
              gdocGuestUrl: updated.type === 'wip_gdoc' ? updated.gdocGuestUrl : item.gdocGuestUrl,
              progressLabel: updated.type === 'wip_gdoc' ? updated.progressLabel : item.progressLabel,
            }
          : item
      ),
    }));

    saveDatabase(db, { slices: ['products'], ordersDirty: true });
    res.json({ product: updated });
  });

  app.delete('/api/author/products/:id/ebook', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.products.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Товар не знайдено.' });
      return;
    }

    const existing = db.products[index];
    if (existing.ebookStorageKey) {
      const filePath = path.join(EBOOKS_DIR, path.basename(existing.ebookStorageKey));
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Ignore file removal error
        }
      }
    }

    const updated: RawStoreProduct = {
      ...existing,
      ebookFileName: undefined,
      ebookMimeType: undefined,
      ebookFileSize: undefined,
      ebookStorageKey: undefined,
    };
    db.products[index] = updated;
    saveDatabase(db);
    res.json({ product: updated });
  });

  app.delete('/api/author/products/:id', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const target = db.products.find((p) => p.id === id);
    const before = db.products.length;
    db.products = db.products.filter((p) => p.id !== id);
    if (db.products.length === before) {
      res.status(404).json({ error: 'Товар не знайдено.' });
      return;
    }
    if (target?.ebookStorageKey) {
      const filePath = path.join(EBOOKS_DIR, path.basename(target.ebookStorageKey));
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Ignore cleanup failure
        }
      }
    }
    delete db.productVotes[id];
    db.reviews = db.reviews.filter((r) => !(r.targetType === 'product' && r.targetId === id));
    if (Array.isArray(db.recentRatings)) {
      db.recentRatings = db.recentRatings.filter((r) => !(r.targetType === 'product' && r.targetId === id));
    }
    saveDatabase(db);
    res.json({ deletedId: id });
  });

  app.post('/api/author/products', (req, res) => {
    const db = ensureDatabase();
    const body = req.body as Partial<RawStoreProduct>;
    const validTypes = ['ebook', 'paper_book', 'wip_gdoc', 'poem_frame', 'painting'] as const;
    if (!body.title?.trim() || !body.type || !validTypes.includes(body.type) || !body.priceUah) {
      res.status(400).json({ error: 'Вкажіть назву, коректний тип і ціну.' });
      return;
    }

    const id = `${body.type}-${Date.now()}`;
    const discountPercent = Math.max(0, Math.min(90, Math.round(Number(body.discountPercent) || 0)));

    const defaultSubtitle =
      body.type === 'wip_gdoc'
        ? 'Роман у роботі · Гостьовий доступ до Google Документа'
        : body.type === 'paper_book'
          ? 'Паперова книга · Друковане видання'
          : body.type === 'poem_frame'
            ? 'Скляна антирамка · Тіло вірша'
            : 'Електронна книга · Авторське видання';

    const newProduct: RawStoreProduct = {
      id,
      type: body.type,
      title: body.title.trim(),
      subtitle: body.subtitle?.trim() || defaultSubtitle,
      priceUah: Math.max(1, Math.round(Number(body.priceUah))),
      discountPercent,
      promoActive: Boolean(body.promoActive),
      promoLabel: body.promoLabel?.trim() || '',
      coverImage:
        body.coverImage?.trim() ||
        (body.type === 'wip_gdoc'
          ? '/src/assets/images/wip_manuscript_novel_1795025674997.webp'
          : '/src/assets/images/ebook_cover_silence_1795025673857.webp'),
      description: body.description?.trim() || 'Нове видання Андрія Даньківа.',
      sampleExcerpt: body.sampleExcerpt?.trim() || 'Уривок буде додано автором найближчим часом.',
      ...(body.type === 'wip_gdoc'
        ? {
            progressLabel: body.progressLabel?.trim() || 'Розділи 1–2',
            wordCount: Number(body.wordCount) || 8500,
            lastUpdated: new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }),
            gdocGuestUrl: body.gdocGuestUrl?.trim() || 'https://docs.google.com/document/d/example/view',
          }
        : body.type === 'paper_book'
          ? {
              binding: body.binding?.trim() || 'Тверда палітурка',
              pages: Number(body.pages) || 200,
              year: Number(body.year) || 2026,
            }
          : body.type === 'poem_frame'
            ? {
                dimensions: body.dimensions?.trim() || '21 × 30 см (А4)',
                material: body.material?.trim() || 'Загартоване скло, металеві кліпси, бавовняний папір',
                year: Number(body.year) || 2026,
              }
            : {
                formats: body.formats?.trim() || 'EPUB · PDF · TXT',
                pages: Number(body.pages) || 160,
                year: Number(body.year) || 2026,
                ebookFileName: body.ebookFileName?.trim() || undefined,
                ebookMimeType: body.ebookMimeType?.trim() || undefined,
                ebookFileSize: typeof body.ebookFileSize === 'number' ? body.ebookFileSize : undefined,
                ebookStorageKey: body.ebookStorageKey?.trim() || undefined,
                ebookFullText:
                  body.ebookFullText?.trim() ||
                  `${body.title.trim()}\nАвтор: Андрій Даньків\n\n${body.description?.trim() || ''}`,
              }),
    };

    db.products.unshift(newProduct);
    saveDatabase(db);
    res.status(201).json({ product: newProduct });
  });

  app.post('/api/author/publish', (req, res) => {
    const db = ensureDatabase();
    const { kind, payload } = req.body as {
      kind: 'poem' | 'prose' | 'blog';
      payload: Record<string, string | number | boolean | string[]>;
    };

    if (!payload?.title) {
      res.status(400).json({ error: 'Вкажіть заголовок твору.' });
      return;
    }

    const hasAttachedPdf =
      kind === 'prose' &&
      typeof payload.pdfStorageKey === 'string' &&
      payload.pdfStorageKey.trim().length > 0;

    if (!payload?.content && !hasAttachedPdf) {
      res.status(400).json({ error: 'Заповніть текст твору або прикріпіть PDF-документ.' });
      return;
    }

    const contentStr = preserveFormattedText(String(payload.content || ''));
    const plainContentForSummary = kind === 'blog' ? stripBlogMediaTokens(contentStr) : contentStr;
    const excerptStr =
      String(payload.excerpt || '').trim() ||
      (plainContentForSummary
        ? getFirstFormattedExcerptLine(plainContentForSummary, 140) + '...'
        : kind === 'blog'
          ? String(payload.title).trim()
          : `Повний текст у форматі PDF (${String(payload.title).trim()}).`);

    if (kind === 'poem') {
      const validFontSize = ['sm', 'base', 'lg', 'xl', '2xl'].includes(String(payload.fontSize))
        ? (payload.fontSize as 'sm' | 'base' | 'lg' | 'xl' | '2xl')
        : undefined;
      const validTextAlign = ['left', 'center', 'right'].includes(String(payload.textAlign))
        ? (payload.textAlign as 'left' | 'center' | 'right')
        : undefined;
      const validLineSpacing = ['tight', 'normal', 'relaxed', 'loose'].includes(
        String(payload.lineSpacing)
      )
        ? (payload.lineSpacing as 'tight' | 'normal' | 'relaxed' | 'loose')
        : undefined;

      const validTextColor =
        typeof payload.textColor === 'string' && payload.textColor.trim()
          ? payload.textColor.trim().slice(0, 32)
          : undefined;
      const validBackgroundColor =
        typeof payload.backgroundColor === 'string' && payload.backgroundColor.trim()
          ? payload.backgroundColor.trim().slice(0, 32)
          : undefined;
      const validImageUrl = sanitizePoemImageUrl(payload.imageUrl);
      const validImagePalette = validImageUrl ? sanitizePoemImagePalette(payload.imagePalette) : undefined;
      const validSoundCloudTracks = sanitizePoemSoundCloudTracks(
        payload.soundcloudTracks,
        payload.soundcloudTrack
      );

      const parsedYear = Number(payload.year);
      const validYear =
        Number.isFinite(parsedYear) && parsedYear >= 1900 && parsedYear <= 2200
          ? Math.round(parsedYear)
          : new Date().getFullYear();

      const validWorkStatus: ProseStatus | undefined =
        payload.workStatus === 'completed' || payload.workStatus === 'in_progress'
          ? payload.workStatus
          : undefined;

      const poem: RawPoem = {
        id: `poem-${Date.now()}`,
        title: String(payload.title).trim(),
        cycle: String(payload.cycle || 'Нові вірші').trim(),
        year: validYear,
        excerpt: excerptStr,
        content: contentStr,
        note: payload.note ? String(payload.note).trim() : undefined,
        ...(validWorkStatus ? { workStatus: validWorkStatus } : {}),
        fontSize: validFontSize,
        textAlign: validTextAlign,
        lineSpacing: validLineSpacing,
        textColor: validTextColor,
        backgroundColor: validBackgroundColor,
        ...(validImageUrl ? { imageUrl: validImageUrl } : {}),
        ...(validImagePalette ? { imagePalette: validImagePalette } : {}),
        ...(validSoundCloudTracks.length > 0
          ? {
              soundcloudTrack: validSoundCloudTracks[0],
              soundcloudTracks: validSoundCloudTracks,
            }
          : {}),
      };

      const requestedPos = payload.position;
      const requestedInsertIdx = Number(payload.insertIndex);
      if (requestedPos === 'end') {
        db.poems.push(poem);
      } else if (Number.isFinite(requestedInsertIdx) && requestedInsertIdx >= 0) {
        const clampedIdx = Math.max(0, Math.min(db.poems.length, Math.round(requestedInsertIdx)));
        db.poems.splice(clampedIdx, 0, poem);
      } else {
        db.poems.unshift(poem);
      }

      saveDatabase(db);
      res.status(201).json({ item: poem });
      return;
    }

    if (kind === 'prose') {
      let requestedAccessMode: ProseAccessMode = 'public';
      if (
        payload.accessMode === 'authorized' ||
        payload.accessMode === 'paid' ||
        payload.accessMode === 'public'
      ) {
        requestedAccessMode = payload.accessMode;
      } else if (payload.requiresAuth === true || payload.requiresAuth === 'true') {
        requestedAccessMode = 'authorized';
      } else if (hasAttachedPdf || payload.isPaid === true || payload.isPaid === 'true') {
        requestedAccessMode = 'paid';
      }
      if (hasAttachedPdf && requestedAccessMode === 'public') {
        requestedAccessMode = 'paid';
      }
      const requestedPaid = requestedAccessMode === 'paid';
      const parsedPrice = requestedPaid ? Math.max(10, Math.round(Number(payload.priceUah) || 75)) : 0;
      const explicitPages = Number(payload.pages);
      const rawDateStr = typeof payload.publishedAt === 'string' ? payload.publishedAt.trim() : '';
      let formattedPublishedAt = new Date().toLocaleDateString('uk-UA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      if (rawDateStr) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawDateStr)) {
          const [y, m, d] = rawDateStr.split('-').map(Number);
          const parsedDate = new Date(y, m - 1, d);
          if (!Number.isNaN(parsedDate.getTime())) {
            formattedPublishedAt = parsedDate.toLocaleDateString('uk-UA', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            });
          }
        } else {
          formattedPublishedAt = rawDateStr;
        }
      }
      const requestedTagIds = Array.isArray(payload.tagIds)
        ? getValidProseTagIds(payload.tagIds as string[], db)
        : [];
      const requestedMoodboardUrls = Array.isArray(payload.moodboardUrls)
        ? Array.from(
            new Set(
              payload.moodboardUrls
                .filter((item): item is string => typeof item === 'string' && /^(\/src\/assets\/|\/uploads\/|\/assets\/|https?:\/\/)/i.test(item.trim()))
                .map((item) => item.trim())
            )
          ).slice(0, 20)
        : [];
      const computedPages = computeProseWorkPages({
        content: contentStr,
        chapters: [],
        hasPdf: hasAttachedPdf,
        fallbackPages: Number.isFinite(explicitPages) && explicitPages > 0 ? Math.round(explicitPages) : 1,
      });
      const prose: RawProseWork = {
        id: `prose-${Date.now()}`,
        title: String(payload.title).trim(),
        genre: String(payload.genre || 'Оповідання').trim(),
        pages: computedPages,
        publishedAt: formattedPublishedAt,
        slogan: String(payload.slogan || '').trim(),
        excerpt: excerptStr,
        content: contentStr,
        chapters: [],
        tagIds: requestedTagIds,
        status: normalizeProseStatus(payload.status),
        accessMode: requestedAccessMode,
        requiresAuth: requestedAccessMode === 'authorized',
        isPaid: requestedPaid && parsedPrice > 0,
        priceUah: parsedPrice,
        moodboardUrls: requestedMoodboardUrls,
        ...(hasAttachedPdf
          ? {
              pdfStorageKey: String(payload.pdfStorageKey).trim(),
              pdfFileName: String(payload.pdfFileName || 'story.pdf').trim(),
              pdfFileSize: Number(payload.pdfFileSize) || undefined,
            }
          : {}),
      };
      db.prose.unshift(prose);
      saveDatabase(db);
      res.status(201).json({ item: enrichProseForAuthor(prose, db) });
      return;
    }

    if (kind === 'blog') {
      const plainText = stripBlogMediaTokens(contentStr);
      const words = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
      const validCoverImage = isValidBlogPhotoUrl(payload.coverImage)
        ? String(payload.coverImage).trim()
        : undefined;
      const post: RawBlogPost = {
        id: `blog-${Date.now()}`,
        title: String(payload.title).trim(),
        category: String(payload.category || 'Авторське кіно').trim(),
        publishedAt: new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }),
        readingMinutes: Math.max(1, Math.ceil(words / 180)),
        ...(validCoverImage ? { coverImage: validCoverImage } : {}),
        excerpt: excerptStr,
        content: contentStr,
      };
      db.blog.unshift(post);
      saveDatabase(db);
      res.status(201).json({ item: enrichBlogPost(post, db) });
      return;
    }

    res.status(400).json({ error: 'Невідомий тип публікації.' });
  });

  // Issue single-use cryptographic payment session (ECDH P-256 + HKDF-SHA-256 + AES-256-GCM)
  app.post('/api/payments/session', paySessionLimiter, async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }

    const db = ensureDatabase();
    purgeExpiredPaymentSessions();
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);

    const { kind, productIds, proseId } = req.body as {
      kind?: 'store' | 'prose';
      productIds?: string[];
      proseId?: string;
    };

    let expectedItemIds: string[] = [];
    let expectedAmountUah = 0;
    let authorizedDiscountUid: string | undefined;
    let telegramDiscountTgId: number | undefined;

    if (kind === 'prose') {
      if (!proseId || typeof proseId !== 'string') {
        res.status(400).json({ error: 'Не вказано твір для оплати.' });
        return;
      }
      const work = db.prose.find((p) => p.id === proseId);
      const basePriceUah = Number(work?.priceUah || 0);
      if (!work || resolveProseAccessMode(work) !== 'paid' || basePriceUah <= 0) {
        res.status(404).json({ error: 'Платний твір не знайдено.' });
        return;
      }
      const tgSub = await verifyTelegramSubscriberForRequest(req, db, { forceFresh: true });
      if (tgSub.tokenValid && !tgSub.subscribed) {
        res.status(403).json({
          error:
            tgSub.error ||
            'Підписку на Telegram-канал не підтверджено. Підпишіться та перевірте статус знову, щоб отримати знижку.',
        });
        return;
      }
      const pricing = getProseDiscountCalculation(basePriceUah, {
        authDiscountPercent: db.proseAuthDiscountPercent,
        isAuthorized: Boolean(optionalAuth),
        telegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
        isTelegramSubscribed: tgSub.subscribed,
      });
      expectedItemIds = [work.id];
      expectedAmountUah = pricing.finalPriceUah;
      if (pricing.appliedSource === 'telegram' && tgSub.subscribed && tgSub.tgId) {
        telegramDiscountTgId = tgSub.tgId;
      } else if (pricing.appliedSource === 'auth' && optionalAuth && pricing.finalPriceUah < basePriceUah) {
        authorizedDiscountUid = optionalAuth.account.uid;
      }
    } else {
      if (!Array.isArray(productIds) || productIds.length === 0) {
        res.status(400).json({ error: 'Кошик порожній.' });
        return;
      }
      const uniqueIds = Array.from(new Set(productIds.filter((id) => typeof id === 'string')));
      const matched = uniqueIds
        .map((id) => db.products.find((p) => p.id === id))
        .filter((p): p is RawStoreProduct => Boolean(p));
      if (matched.length === 0) {
        res.status(404).json({ error: 'Обрані видання не знайдено.' });
        return;
      }
      expectedItemIds = matched.map((p) => p.id);
      expectedAmountUah = matched.reduce((sum, p) => sum + getEffectivePriceUah(p), 0);
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const serverPublicKeyJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
    const sessionId = `ps_${crypto.randomBytes(12).toString('hex')}`;
    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAtMs = Date.now() + 5 * 60 * 1000;

    paymentSessions.set(sessionId, {
      sessionId,
      nonce,
      serverPrivateKey: privateKey,
      kind: kind === 'prose' ? 'prose' : 'store',
      expectedItemIds,
      expectedAmountUah,
      authorizedDiscountUid,
      telegramDiscountTgId,
      expiresAtMs,
      consumed: false,
    });

    res.json({
      sessionId,
      nonce,
      amountUah: expectedAmountUah,
      expiresAt: new Date(expiresAtMs).toISOString(),
      algorithm: 'ECDH-P256+HKDF-SHA256+AES-256-GCM',
      serverPublicKeyJwk,
      monobankAcquiringAvailable: Boolean(getMonobankToken()),
    });
  });

  app.post('/api/orders', ordersCreateLimiter, async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }

    const monobankToken = getMonobankToken();
    if (!monobankToken) {
      res.status(503).json({
        error: 'Оплата замовлень тимчасово недоступна: платіжний шлюз monobank не налаштовано.',
      });
      return;
    }

    purgeExpiredMonobankInvoices();

    const db = ensureDatabase();
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const { productIds, encryptedPayment } = req.body as {
      productIds?: string[];
      encryptedPayment?: EncryptedPaymentEnvelope;
    };

    if (!Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ error: 'Оберіть хоча б одне видання.' });
      return;
    }

    const uniqueIds = Array.from(new Set(productIds.filter((id) => typeof id === 'string')));
    const matchedProducts = uniqueIds
      .map((id) => db.products.find((p) => p.id === id))
      .filter((p): p is RawStoreProduct => Boolean(p));

    if (matchedProducts.length === 0) {
      res.status(404).json({ error: 'Обрані видання не знайдено.' });
      return;
    }

    const totalUah = matchedProducts.reduce((sum, p) => sum + getEffectivePriceUah(p), 0);
    if (!Number.isFinite(totalUah) || totalUah <= 0) {
      res.status(400).json({ error: 'Сума замовлення має перевищувати 0 грн.' });
      return;
    }

    const decryptedResult = decryptPaymentEnvelope(
      encryptedPayment,
      'store',
      matchedProducts.map((p) => p.id),
      totalUah
    );

    if (!decryptedResult.ok) {
      res.status(decryptedResult.status).json({ error: decryptedResult.error });
      return;
    }

    const assertion = decryptedResult.payload;
    const cleanBuyerName = assertion.buyerName?.trim() || '';
    const cleanBuyerEmail = assertion.buyerEmail?.trim().toLowerCase() || '';

    if (cleanBuyerName.length < 2 || !cleanBuyerEmail.includes('@')) {
      res.status(400).json({ error: 'Будь ласка, вкажіть ім’я та дійсний email.' });
      return;
    }

    const requiresShipping = matchedProducts.some((p) => isPhysicalProduct(p.type));
    let sanitizedShipping: ShippingDetails | undefined;

    if (requiresShipping) {
      const shipping = assertion.shipping;
      const recipientName = shipping?.recipientName?.trim() || cleanBuyerName;
      const phone = shipping?.phone?.trim() || '';
      const city = shipping?.city?.trim() || '';
      const addressOrBranch = shipping?.addressOrBranch?.trim() || '';
      if (shipping?.carrier && shipping.carrier !== 'nova_poshta') {
        res.status(400).json({ error: 'Доставка доступна лише Новою Поштою.' });
        return;
      }
      const carrier = 'nova_poshta' as const;

      if (phone.length < 9 || city.length < 2 || addressOrBranch.length < 3) {
        res.status(400).json({
          error: 'Для доставки фізичної книги або антирамки заповніть телефон, місто та відділення або поштомат Нової Пошти.',
        });
        return;
      }

      sanitizedShipping = {
        recipientName,
        phone,
        carrier,
        city,
        addressOrBranch,
        comment: shipping?.comment?.trim() || undefined,
      };
    }

    if (assertion.method !== 'monobank') {
      res.status(400).json({ error: 'Оплата замовлення доступна лише через Монобанк.' });
      return;
    }

    const orderCode = generateHighEntropyOrderCode(db);
    const baseUrl = getServerPublicBaseUrl(req);
    const redirectUrl = `${baseUrl}/#store`;
    const webHookUrl = `${baseUrl}/api/monobank/webhook`;

    try {
      const monoRes = await fetch('https://api.monobank.ua/api/merchant/invoice/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Token': monobankToken,
        },
        body: JSON.stringify({
          amount: Math.max(100, Math.round(totalUah * 100)),
          ccy: 980,
          merchantPaymInfo: {
            reference: orderCode,
            destination: `Замовлення у крамниці #${orderCode} (${matchedProducts.map((p) => p.title).join(', ').slice(0, 100)})`,
            comment: `Покупець: ${cleanBuyerName}`,
          },
          redirectUrl,
          webHookUrl,
          validity: 3600,
        }),
      });

      const monoData = (await monoRes.json().catch(() => ({}))) as {
        invoiceId?: string;
        pageUrl?: string;
        errText?: string;
      };

      if (!monoRes.ok || !monoData.invoiceId || !monoData.pageUrl) {
        res.status(502).json({
          error: monoData.errText || 'Не вдалося створити рахунок monobank. Спробуйте ще раз.',
        });
        return;
      }

      const createdAt = new Date().toISOString();
      const paymentSummary: PaymentSummary = {
        status: 'pending',
        providerLabel: 'monobank Acquiring',
        method: 'monobank',
        encryptionProtocol: 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
        transactionId: monoData.invoiceId,
        paidAt: '',
      };

      const encryptedPii = encryptOrderPii(
        {
          buyerName: cleanBuyerName,
          buyerEmail: cleanBuyerEmail,
          shipping: sanitizedShipping,
        },
        orderCode
      );

      const pendingOrderRecord: OrderRecord = {
        orderCode,
        ...(optionalAuth?.account.uid ? { guestUid: optionalAuth.account.uid } : {}),
        buyerName: maskPersonName(cleanBuyerName),
        buyerEmail: maskEmailAddress(cleanBuyerEmail),
        buyerNameMasked: maskPersonName(cleanBuyerName),
        buyerEmailMasked: maskEmailAddress(cleanBuyerEmail),
        buyerEmailHash: hashBuyerEmailLookup(cleanBuyerEmail),
        encryptedPii,
        createdAt,
        totalUah,
        payment: paymentSummary,
        items: [],
        pendingProductIds: matchedProducts.map((p) => p.id),
      };

      db.orders.unshift(pendingOrderRecord);
      saveDatabase(db, { flushDelayMs: 0, ordersDirty: [pendingOrderRecord.orderCode] });

      const now = Date.now();
      pendingMonobankStoreInvoices.set(monoData.invoiceId, {
        invoiceId: monoData.invoiceId,
        orderCode,
        productIds: matchedProducts.map((p) => p.id),
        amountUah: totalUah,
        buyerName: cleanBuyerName,
        buyerEmail: cleanBuyerEmail,
        shipping: sanitizedShipping,
        ...(optionalAuth?.account.uid ? { guestUid: optionalAuth.account.uid } : {}),
        status: 'created',
        createdAtMs: now,
        expiresAtMs: now + 60 * 60 * 1000,
      });
      persistPendingInvoices();

      res.status(201).json({
        mode: 'acquiring',
        status: 'pending',
        orderCode,
        invoiceId: monoData.invoiceId,
        pageUrl: monoData.pageUrl,
        totalUah,
      });
    } catch {
      res.status(502).json({
        error: 'Тимчасово не вдалося з’єднатися з платіжним сервісом monobank.',
      });
    }
  });

  // Check Monobank Acquiring invoice payment status & finalize store order only after bank confirmation
  app.get('/api/orders/monobank/status', ordersStatusLimiter, async (req, res) => {
    purgeExpiredMonobankInvoices();
    const db = ensureDatabase();
    const invoiceId = typeof req.query.invoiceId === 'string' ? req.query.invoiceId.trim() : '';
    const orderCodeQuery = typeof req.query.orderCode === 'string' ? req.query.orderCode.trim() : '';
    if (!invoiceId || !orderCodeQuery) {
      res.status(400).json({ error: 'Відсутній ідентифікатор рахунку або номер замовлення.' });
      return;
    }

    const pending = pendingMonobankStoreInvoices.get(invoiceId);
    if (!pending || pending.orderCode.toLowerCase() !== orderCodeQuery.toLowerCase()) {
      res.status(404).json({ error: 'Рахунок на оплату не знайдено або його термін дії завершився.' });
      return;
    }

    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);

    const buildPaidOrderResponse = (orderRecord: OrderRecord, unlockedItems: PurchasedAccess[]) => ({
      paid: true,
      status: 'success' as const,
      order: {
        orderCode: orderRecord.orderCode,
        createdAt: orderRecord.createdAt,
        totalUah: orderRecord.totalUah,
        payment: orderRecord.payment,
        items: unlockedItems,
      },
    });

    if (pending.finalizedOrderCode) {
      const existingOrder = db.orders.find((o) => o.orderCode === pending.finalizedOrderCode);
      if (existingOrder && existingOrder.payment?.status === 'paid' && existingOrder.items.length > 0) {
        res.json(buildPaidOrderResponse(existingOrder, existingOrder.items));
        return;
      }
    }

    const monobankToken = getMonobankToken();
    if (!monobankToken) {
      res.status(503).json({
        error: 'Платіжний шлюз monobank не налаштовано.',
      });
      return;
    }

    if (pending.status !== 'success') {
      try {
        const statusRes = await fetch(
          `https://api.monobank.ua/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`,
          {
            headers: { 'X-Token': monobankToken },
          }
        );
        if (statusRes.ok) {
          const statusData = (await statusRes.json()) as {
            status?: MonobankInvoiceStatus;
            amount?: number;
            failureReason?: string;
          };
          const expectedKopecks = Math.max(100, Math.round(pending.amountUah * 100));
          if (statusData.status === 'success' && typeof statusData.amount === 'number' && statusData.amount < expectedKopecks) {
            pending.status = 'failure';
            pending.failureReason = 'Сума платежу не відповідає сумі замовлення.';
          } else if (statusData.status) {
            pending.status = statusData.status;
          }
          if (statusData.failureReason) {
            pending.failureReason = statusData.failureReason;
          }
          persistPendingInvoices();
        }
      } catch {
        // Keep current status on transient network failure
      }
    }

    if (pending.status === 'success') {
      const { orderRecord, unlockedItems } = finalizePendingStoreOrder(db, pending);
      pending.finalizedOrderCode = orderRecord.orderCode;
      persistPendingInvoices();

      if (optionalAuth?.account && optionalAuth.firebaseClaims && optionalAuth.firebaseIdToken) {
        if (!orderRecord.guestUid || orderRecord.guestUid === optionalAuth.account.uid) {
          void syncPublicUserProfileToFirestore(
            {
              firebaseUid: optionalAuth.firebaseClaims.uid,
              guestUid: optionalAuth.account.uid,
              displayName: optionalAuth.account.displayName,
              photoUrl: optionalAuth.account.photoUrl,
              likedPoemIds: optionalAuth.account.likedPoemIds,
              likedRadioTrackIds: optionalAuth.account.likedRadioTrackIds,
              totalTimeSeconds: optionalAuth.account.totalTimeSeconds,
              purchasesCount: optionalAuth.account.purchasesCount,
              donorChatText: optionalAuth.account.donorChatText,
            },
            optionalAuth.firebaseIdToken
          );
          void syncOrderToFirestore(
            orderRecord,
            optionalAuth.firebaseClaims.uid,
            optionalAuth.firebaseIdToken
          );
        }
      }

      res.json(buildPaidOrderResponse(orderRecord, unlockedItems));
      return;
    }

    if (pending.status === 'failure' || pending.status === 'expired' || pending.status === 'reversed') {
      const existingOrder = db.orders.find((o) => o.orderCode === pending.orderCode);
      if (existingOrder && existingOrder.payment && existingOrder.payment.status === 'pending') {
        existingOrder.payment.status = pending.status === 'expired' ? 'expired' : 'failed';
        saveDatabase(db, { ordersDirty: [existingOrder.orderCode] });
      }
    }

    res.json({
      paid: false,
      status: pending.status,
      failureReason: pending.failureReason,
    });
  });

  // Read full prose content (public works, authorized-only works, verified admin, or verified paid order)
  app.post('/api/prose/:id/read', async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const work = db.prose.find((p) => p.id === id);
    if (!work) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const accessMode = resolveProseAccessMode(work);
    const workChapters = Array.isArray(work.chapters) ? work.chapters : [];

    if (accessMode === 'public') {
      res.json({ id: work.id, content: work.content, chapters: workChapters, unlocked: true });
      return;
    }

    if (accessMode === 'authorized') {
      const guestAuth = await authenticateGuestRequest(req, db);
      if (!guestAuth.ok) {
        res.status(401).json({
          error: 'Увійдіть в акаунт, щоб читати твори для авторизованих читачів.',
          requiresAuth: true,
        });
        return;
      }
      if (
        guestAuth.provider === 'google' &&
        !work.content &&
        (!work.chapters || work.chapters.length === 0)
      ) {
        const bearer = extractBearerToken(req);
        if (bearer) {
          const hydrated = await hydrateSingleAuthorizedProse(db, work.id, bearer);
          if (hydrated) saveDatabase(db);
        }
      }
      res.json({
        id: work.id,
        content: work.content,
        chapters: Array.isArray(work.chapters) ? work.chapters : [],
        unlocked: true,
      });
      return;
    }

    const bearer = extractBearerToken(req);
    if (bearer) {
      try {
        const claims = await verifyFirebaseIdToken(bearer);
        if (isVerifiedAdminClaims(claims)) {
          res.json({
            id: work.id,
            content: work.content,
            chapters: workChapters,
            unlocked: true,
            adminPreview: true,
          });
          return;
        }
      } catch {
        // Fall through to order verification
      }
    }

    const rawCode = typeof req.body?.orderCode === 'string' ? req.body.orderCode.trim().toLowerCase() : '';
    if (!rawCode) {
      res.status(403).json({ error: 'Для читання повного тексту придбайте доступ.' });
      return;
    }

    const matchedOrder = db.orders.find(
      (o) =>
        o.orderCode.toLowerCase() === rawCode &&
        o.payment?.status === 'paid' &&
        o.items.some((it) => it.proseId === work.id || it.productId === work.id)
    );

    if (!matchedOrder) {
      res.status(403).json({ error: 'Замовлення для доступу до цього твору не знайдено.' });
      return;
    }

    res.json({
      id: work.id,
      content: work.content,
      chapters: workChapters,
      orderCode: matchedOrder.orderCode,
      unlocked: true,
    });
  });

  // Monobank-only checkout initiation for paid prose (requires configured MONOBANK_TOKEN)
  app.post('/api/prose/:id/monobank/invoice', prosePurchaseLimiter, async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }

    const monobankToken = getMonobankToken();
    if (!monobankToken) {
      res.status(503).json({
        error: 'Оплата платної прози тимчасово недоступна: платіжний шлюз monobank не налаштовано.',
      });
      return;
    }

    purgeExpiredMonobankInvoices();

    const db = ensureDatabase();
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const { id } = req.params;
    const work = db.prose.find((p) => p.id === id);
    if (!work) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const basePriceUah = Number(work.priceUah || 0);
    if (resolveProseAccessMode(work) !== 'paid' || basePriceUah <= 0) {
      res.status(400).json({ error: 'Цей твір не потребує оплати.' });
      return;
    }

    const tgSub = await verifyTelegramSubscriberForRequest(req, db, { forceFresh: true });
    if (tgSub.tokenValid && !tgSub.subscribed) {
      res.status(403).json({
        error:
          tgSub.error ||
          'Підписку на Telegram-канал не підтверджено. Оновіть перевірку підписки для оплати зі знижкою.',
      });
      return;
    }

    const pricing = getProseDiscountCalculation(basePriceUah, {
      authDiscountPercent: db.proseAuthDiscountPercent,
      isAuthorized: Boolean(optionalAuth),
      telegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
      isTelegramSubscribed: tgSub.subscribed,
    });
    const effectivePriceUah = pricing.finalPriceUah;

    const { encryptedPayment } = req.body as {
      encryptedPayment?: EncryptedPaymentEnvelope;
    };

    if (encryptedPayment?.sessionId) {
      const pendingSession = paymentSessions.get(encryptedPayment.sessionId);
      if (
        pendingSession?.authorizedDiscountUid &&
        optionalAuth?.account.uid !== pendingSession.authorizedDiscountUid
      ) {
        res.status(403).json({
          error: 'Для оплати зі знижкою авторизованого читача підтвердіть активну сесію входу.',
        });
        return;
      }
      if (
        pendingSession?.telegramDiscountTgId &&
        (!tgSub.subscribed || tgSub.tgId !== pendingSession.telegramDiscountTgId)
      ) {
        res.status(403).json({
          error: 'Для оплати зі знижкою підписника Telegram-каналу підтвердіть активну підписку.',
        });
        return;
      }
    }

    const decryptedResult = decryptPaymentEnvelope(
      encryptedPayment,
      'prose',
      [work.id],
      effectivePriceUah
    );
    if (!decryptedResult.ok) {
      res.status(decryptedResult.status).json({ error: decryptedResult.error });
      return;
    }

    const assertion = decryptedResult.payload;
    if (assertion.method !== 'monobank') {
      res.status(400).json({ error: 'Оплата прози доступна лише через monobank.' });
      return;
    }

    const cleanName = assertion.buyerName?.trim() || '';
    const cleanEmail = assertion.buyerEmail?.trim().toLowerCase() || '';
    if (cleanName.length < 2 || !cleanEmail.includes('@')) {
      res.status(400).json({ error: 'Будь ласка, вкажіть коректне ім’я та email.' });
      return;
    }

    const orderCode = generateHighEntropyOrderCode(db);
    const baseUrl = getServerPublicBaseUrl(req);
    const redirectUrl = `${baseUrl}/#prose/${encodeURIComponent(work.id)}`;
    const webHookUrl = `${baseUrl}/api/monobank/webhook`;

    try {
      const monoRes = await fetch('https://api.monobank.ua/api/merchant/invoice/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Token': monobankToken,
        },
        body: JSON.stringify({
          amount: Math.max(100, Math.round(effectivePriceUah * 100)),
          ccy: 980,
          merchantPaymInfo: {
            reference: orderCode,
            destination: `Повний доступ до твору «${work.title}»`,
            comment: `Читач: ${cleanName}`,
          },
          redirectUrl,
          webHookUrl,
          validity: 3600,
        }),
      });

      const monoData = (await monoRes.json().catch(() => ({}))) as {
        invoiceId?: string;
        pageUrl?: string;
        errText?: string;
      };

      if (!monoRes.ok || !monoData.invoiceId || !monoData.pageUrl) {
        res.status(502).json({
          error: monoData.errText || 'Не вдалося створити рахунок monobank. Спробуйте ще раз.',
        });
        return;
      }

      createPendingProseOrder(db, work, {
        orderCode,
        invoiceId: monoData.invoiceId,
        cleanName,
        cleanEmail,
        effectivePriceUah,
        guestUid: optionalAuth?.account.uid,
      });

      const now = Date.now();
      pendingMonobankProseInvoices.set(monoData.invoiceId, {
        invoiceId: monoData.invoiceId,
        proseId: work.id,
        orderCode,
        amountUah: effectivePriceUah,
        buyerName: cleanName,
        buyerEmail: cleanEmail,
        ...(optionalAuth?.account.uid ? { guestUid: optionalAuth.account.uid } : {}),
        status: 'created',
        createdAtMs: now,
        expiresAtMs: now + 60 * 60 * 1000,
      });
      persistPendingInvoices();

      res.status(201).json({
        mode: 'acquiring',
        invoiceId: monoData.invoiceId,
        pageUrl: monoData.pageUrl,
        orderCode,
        amountUah: effectivePriceUah,
      });
    } catch {
      res.status(502).json({
        error: 'Тимчасово не вдалося з’єднатися з платіжним сервісом monobank.',
      });
    }
  });

  // Check Monobank Acquiring invoice payment status & unlock prose when paid
  app.get('/api/prose/:id/monobank/status', proseStatusLimiter, async (req, res) => {
    purgeExpiredMonobankInvoices();
    const db = ensureDatabase();
    const { id } = req.params;
    const invoiceId = typeof req.query.invoiceId === 'string' ? req.query.invoiceId.trim() : '';
    if (!invoiceId) {
      res.status(400).json({ error: 'Відсутній ідентифікатор рахунку monobank.' });
      return;
    }

    const work = db.prose.find((p) => p.id === id);
    if (!work) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const pending = pendingMonobankProseInvoices.get(invoiceId);
    if (!pending || pending.proseId !== work.id) {
      res.status(404).json({ error: 'Рахунок на оплату не знайдено або його термін дії завершився.' });
      return;
    }

    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);

    if (pending.finalizedOrderCode) {
      const existingOrder = db.orders.find((o) => o.orderCode === pending.finalizedOrderCode);
      if (existingOrder && existingOrder.payment?.status === 'paid') {
        const unlockedItem =
          existingOrder.items.find((it) => it.proseId === work.id || it.productId === work.id) || {
            productId: work.id,
            proseId: work.id,
            orderCode: pending.finalizedOrderCode,
            title: work.title,
            type: 'prose_access' as const,
            purchasedAt: existingOrder.createdAt || new Date().toISOString(),
            paymentTransactionId: invoiceId,
            hasPdf: Boolean(work.pdfStorageKey),
            pdfFileName: work.pdfFileName,
            pdfFileSize: work.pdfFileSize,
          };

        res.json({
          paid: true,
          status: 'success',
          orderCode: pending.finalizedOrderCode,
          unlockedAccess: unlockedItem,
          content: work.content,
          chapters: Array.isArray(work.chapters) ? work.chapters : [],
          hasPdf: Boolean(work.pdfStorageKey),
          pdfFileName: work.pdfFileName,
          pdfFileSize: work.pdfFileSize,
        });
        return;
      }
    }

    const monobankToken = getMonobankToken();
    if (!monobankToken) {
      res.status(503).json({ error: 'Платіжний шлюз monobank не налаштовано.' });
      return;
    }

    if (pending.status !== 'success') {
      try {
        const statusRes = await fetch(
          `https://api.monobank.ua/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`,
          {
            headers: { 'X-Token': monobankToken },
          }
        );
        if (statusRes.ok) {
          const statusData = (await statusRes.json()) as {
            status?: MonobankInvoiceStatus;
            amount?: number;
            failureReason?: string;
          };
          const expectedKopecks = Math.max(100, Math.round(pending.amountUah * 100));
          if (statusData.status === 'success' && typeof statusData.amount === 'number' && statusData.amount < expectedKopecks) {
            pending.status = 'failure';
            pending.failureReason = 'Сума платежу не відповідає вартості твору.';
          } else if (statusData.status) {
            pending.status = statusData.status;
          }
          if (statusData.failureReason) {
            pending.failureReason = statusData.failureReason;
          }
          persistPendingInvoices();
        }
      } catch {
        // Keep current cached status if transient network error occurs during polling
      }
    }

    if (pending.status === 'success') {
      const { orderCode, unlockedAccess, orderRecord } = finalizeProsePaidOrder(db, work, {
        cleanName: pending.buyerName,
        cleanEmail: pending.buyerEmail,
        effectivePriceUah: pending.amountUah,
        providerLabel: 'monobank Acquiring',
        transactionId: pending.invoiceId,
        orderCode: pending.orderCode,
        encryptionProtocol: 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
        guestUid: pending.guestUid,
      });
      pending.finalizedOrderCode = orderCode;
      persistPendingInvoices();

      if (optionalAuth?.account && optionalAuth.firebaseClaims && optionalAuth.firebaseIdToken) {
        if (!orderRecord.guestUid || orderRecord.guestUid === optionalAuth.account.uid) {
          void syncPublicUserProfileToFirestore(
            {
              firebaseUid: optionalAuth.firebaseClaims.uid,
              guestUid: optionalAuth.account.uid,
              displayName: optionalAuth.account.displayName,
              photoUrl: optionalAuth.account.photoUrl,
              likedPoemIds: optionalAuth.account.likedPoemIds,
              likedRadioTrackIds: optionalAuth.account.likedRadioTrackIds,
              totalTimeSeconds: optionalAuth.account.totalTimeSeconds,
              purchasesCount: optionalAuth.account.purchasesCount,
              donorChatText: optionalAuth.account.donorChatText,
            },
            optionalAuth.firebaseIdToken
          );
          void syncOrderToFirestore(
            orderRecord,
            optionalAuth.firebaseClaims.uid,
            optionalAuth.firebaseIdToken
          );
        }
      }

      res.json({
        paid: true,
        status: 'success',
        orderCode,
        unlockedAccess,
        content: work.content,
        chapters: Array.isArray(work.chapters) ? work.chapters : [],
        hasPdf: Boolean(work.pdfStorageKey),
        pdfFileName: work.pdfFileName,
        pdfFileSize: work.pdfFileSize,
      });
      return;
    }

    if (pending.status === 'failure' || pending.status === 'expired' || pending.status === 'reversed') {
      const existingOrder = db.orders.find((o) => o.orderCode === pending.orderCode);
      if (existingOrder && existingOrder.payment && existingOrder.payment.status === 'pending') {
        existingOrder.payment.status = pending.status === 'expired' ? 'expired' : 'failed';
        saveDatabase(db, { ordersDirty: [existingOrder.orderCode] });
      }
    }

    res.json({
      paid: false,
      status: pending.status,
      failureReason: pending.failureReason,
    });
  });

  // Monobank Acquiring webhook callback (handles both prose and store invoices)
  app.post('/api/monobank/webhook', async (req, res) => {
    const monobankToken = getMonobankToken();
    if (!monobankToken) {
      console.warn('⚠️ [Monobank Webhook] Received webhook call, but Monobank token (MONOBANK_TOKEN / MONOBANK_ACQUIRING_TOKEN) is not configured.');
      res.status(200).json({ ok: true });
      return;
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const xSign = req.get('x-sign');
    const signatureValid = await verifyMonobankWebhookSignature(rawBody, xSign, monobankToken);
    if (!signatureValid) {
      res.status(401).json({ error: 'Invalid monobank signature' });
      return;
    }

    ensurePendingInvoicesLoaded();

    const payload = req.body as {
      invoiceId?: string;
      status?: MonobankInvoiceStatus;
      amount?: number;
      failureReason?: string;
    };

    if (payload.invoiceId) {
      const pendingProse = pendingMonobankProseInvoices.get(payload.invoiceId);
      if (pendingProse) {
        const expectedKopecks = Math.max(100, Math.round(pendingProse.amountUah * 100));
        if (payload.status === 'success' && typeof payload.amount === 'number' && payload.amount < expectedKopecks) {
          pendingProse.status = 'failure';
          pendingProse.failureReason = 'Сума платежу не відповідає вартості твору.';
        } else if (payload.status) {
          pendingProse.status = payload.status;
        }
        if (payload.failureReason) {
          pendingProse.failureReason = payload.failureReason;
        }
        if (pendingProse.status === 'success' && !pendingProse.finalizedOrderCode) {
          const db = ensureDatabase();
          const work = db.prose.find((p) => p.id === pendingProse.proseId);
          if (work) {
            const { orderCode } = finalizeProsePaidOrder(db, work, {
              cleanName: pendingProse.buyerName,
              cleanEmail: pendingProse.buyerEmail,
              effectivePriceUah: pendingProse.amountUah,
              providerLabel: 'monobank Acquiring',
              transactionId: pendingProse.invoiceId,
              orderCode: pendingProse.orderCode,
              encryptionProtocol: 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
              guestUid: pendingProse.guestUid,
            });
            pendingProse.finalizedOrderCode = orderCode;
          }
        } else if (pendingProse.status === 'failure' || pendingProse.status === 'expired' || pendingProse.status === 'reversed') {
          const db = ensureDatabase();
          const existingOrder = db.orders.find((o) => o.orderCode === pendingProse.orderCode);
          if (existingOrder && existingOrder.payment && existingOrder.payment.status === 'pending') {
            existingOrder.payment.status = pendingProse.status === 'expired' ? 'expired' : 'failed';
            saveDatabase(db, { ordersDirty: [existingOrder.orderCode] });
          }
        }
        persistPendingInvoices();
      }

      const pendingStore = pendingMonobankStoreInvoices.get(payload.invoiceId);
      if (pendingStore) {
        const expectedKopecks = Math.max(100, Math.round(pendingStore.amountUah * 100));
        if (payload.status === 'success' && typeof payload.amount === 'number' && payload.amount < expectedKopecks) {
          pendingStore.status = 'failure';
          pendingStore.failureReason = 'Сума платежу не відповідає сумі замовлення.';
        } else if (payload.status) {
          pendingStore.status = payload.status;
        }
        if (payload.failureReason) {
          pendingStore.failureReason = payload.failureReason;
        }
        if (pendingStore.status === 'success' && !pendingStore.finalizedOrderCode) {
          const db = ensureDatabase();
          const { orderRecord } = finalizePendingStoreOrder(db, pendingStore);
          pendingStore.finalizedOrderCode = orderRecord.orderCode;
        } else if (pendingStore.status === 'failure' || pendingStore.status === 'expired' || pendingStore.status === 'reversed') {
          const db = ensureDatabase();
          const existingOrder = db.orders.find((o) => o.orderCode === pendingStore.orderCode);
          if (existingOrder && existingOrder.payment && existingOrder.payment.status === 'pending') {
            existingOrder.payment.status = pendingStore.status === 'expired' ? 'expired' : 'failed';
            saveDatabase(db, { ordersDirty: [existingOrder.orderCode] });
          }
        }
        persistPendingInvoices();
      }
    }

    res.status(200).json({ ok: true });
  });

  // Disabled unverified direct-purchase endpoint: fail closed when MONOBANK_TOKEN is unset, otherwise require Acquiring invoice flow
  app.post('/api/prose/:id/purchase', prosePurchaseLimiter, async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    if (!getMonobankToken()) {
      res.status(503).json({
        error: 'Оплата платної прози тимчасово недоступна: платіжний шлюз monobank не налаштовано.',
      });
      return;
    }
    res.status(400).json({ error: 'Для оплати використовуйте рахунок monobank.' });
  });

  // Protected PDF document streaming/download for authorized-only & paid prose works
  const handleProsePdfRequest = async (req: Request, res: express.Response, orderCodeInput?: string) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const work = db.prose.find((p) => p.id === id);
    if (!work || !work.pdfStorageKey) {
      res.status(404).json({ error: 'PDF-документ для цього твору не знайдено.' });
      return;
    }

    const accessMode = resolveProseAccessMode(work);
    if (accessMode === 'authorized') {
      const guestAuth = await authenticateGuestRequest(req, db);
      if (!guestAuth.ok) {
        res.status(401).json({ error: 'Увійдіть в акаунт гостя, щоб відкрити PDF-документ.' });
        return;
      }
    } else if (accessMode === 'paid') {
      let authorized = false;
      const bearer = extractBearerToken(req);
      if (bearer) {
        try {
          const claims = await verifyFirebaseIdToken(bearer);
          if (isVerifiedAdminClaims(claims)) {
            authorized = true;
          }
        } catch {
          // Fall back to order code check
        }
      }

      if (!authorized) {
        const normalizedCode = (orderCodeInput || '').trim().toLowerCase();
        if (normalizedCode) {
          authorized = db.orders.some(
            (o) =>
              o.orderCode.toLowerCase() === normalizedCode &&
              o.payment?.status === 'paid' &&
              o.items.some((it) => it.proseId === work.id || it.productId === work.id)
          );
        }
      }

      if (!authorized) {
        res.status(403).json({ error: 'Доступ до PDF-документа можливий лише після оплати.' });
        return;
      }
    }

    const pdfPath = resolveConfinedFilePath(PROSE_PDF_DIR, work.pdfStorageKey);
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      res.status(404).json({ error: 'Файл PDF не знайдено на сервері.' });
      return;
    }

    const downloadName = work.pdfFileName || `${work.id}.pdf`;
    const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, '_');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );
    res.sendFile(pdfPath);
  };

  app.post('/api/prose/:id/pdf', async (req, res) => {
    const orderCode = typeof req.body?.orderCode === 'string' ? req.body.orderCode : '';
    await handleProsePdfRequest(req, res, orderCode);
  });

  app.get('/api/prose/:id/pdf', async (req, res) => {
    const orderCode = typeof req.query?.order === 'string' ? req.query.order : '';
    await handleProsePdfRequest(req, res, orderCode);
  });

  app.post('/api/orders/restore', ordersRestoreLimiter, (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }

    const db = ensureDatabase();
    const { query } = req.body as { query?: string };
    const normalized = query?.trim().toLowerCase();
    if (!normalized) {
      res.status(400).json({ error: 'Введіть email або номер замовлення.' });
      return;
    }

    const lookupHash = normalized.includes('@') ? hashBuyerEmailLookup(normalized) : null;
    const matchedOrders = db.orders.filter((o) => {
      if (o.payment?.status !== 'paid' || !Array.isArray(o.items) || o.items.length === 0) {
        return false;
      }
      if (o.orderCode.toLowerCase() === normalized) return true;
      if (lookupHash && o.buyerEmailHash === lookupHash) return true;
      if (!o.encryptedPii && o.buyerEmail.toLowerCase() === normalized) return true;
      return false;
    });

    // Never return raw recipient PII in restore payloads
    const items = matchedOrders.flatMap((o) =>
      o.items.map((item) => ({
        ...item,
        shippingSummary: item.shippingSummary
          ? item.shippingSummary.replace(/\([^)]*\)/g, '').split('·')[0].trim() || 'Доставку оформлено'
          : undefined,
      }))
    );
    res.json({ items, ordersCount: matchedOrders.length });
  });

  app.get('/api/ebooks/:id/download', ebookDownloadLimiter, async (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const { order, preview } = req.query as { order?: string; preview?: string };
    const product = db.products.find((p) => p.id === id && p.type === 'ebook');
    if (!product) {
      res.status(404).send('Видання не знайдено');
      return;
    }

    if (preview === 'author') {
      const authResult = await authenticateAdminRequest(req);
      if (!authResult.ok) {
        res.status(authResult.status).json({ error: authResult.error });
        return;
      }
    } else {
      const normalizedOrder = typeof order === 'string' ? order.trim().toLowerCase() : '';
      const isPurchased =
        normalizedOrder.length > 0 &&
        db.orders.some(
          (o) =>
            o.orderCode.toLowerCase() === normalizedOrder &&
            o.payment?.status === 'paid' &&
            o.items.some((item) => item.productId === id)
        );
      if (!isPurchased) {
        res.status(403).send('Файл доступний для завантаження лише після оплати електронної книги.');
        return;
      }
    }

    if (product.ebookStorageKey) {
      const safeStoragePath = path.join(EBOOKS_DIR, path.basename(product.ebookStorageKey));
      if (fs.existsSync(safeStoragePath)) {
        const downloadName = product.ebookFileName || `${product.id}${path.extname(safeStoragePath)}`;
        const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, '_');
        res.setHeader('Content-Type', product.ebookMimeType || 'application/octet-stream');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
        );
        res.sendFile(safeStoragePath);
        return;
      }
    }

    const fileContent =
      product.ebookFullText ||
      `${product.title}\nАвтор: Андрій Даньків\n\n${product.description}\n\n${product.sampleExcerpt}`;

    const safeFileName = `${product.id}-andrij-dankiv.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
    res.send(fileContent);
  });

  const httpServer = http.createServer(app);
  const chatWss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  const chatClients = new Map<
    WebSocket,
    {
      uid?: string;
      firebaseUid?: string;
      firebaseIdToken?: string;
      isAdmin?: boolean;
      ipHash: string;
      isAlive: boolean;
    }
  >();

  const broadcastChatEvent = (payload: unknown) => {
    const encoded = JSON.stringify(payload);
    for (const [client] of chatClients.entries()) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(encoded);
      }
    }
  };

  broadcastGlobalChatRefresh = (db: SiteDatabase) => {
    const badgeLookup = createBadgeLookup(db);
    const photoLookup = createAccountPhotoLookup(db);
    const donorTextLookup = createDonorTextLookup(db);
    broadcastChatEvent({
      type: 'chat:refresh',
      messages: (db.chatMessages || [])
        .slice(-100)
        .map((msg) => enrichChatMessageWithBadges(msg, badgeLookup, photoLookup, donorTextLookup)),
    });
  };

  const appendChatMessage = (
    db: SiteDatabase,
    account: GuestAccountRecord,
    rawText: string,
    replyToId?: string,
    options?: {
      id?: string;
      clientMessageId?: string;
      firebaseUid?: string;
      firebaseIdToken?: string;
      skipFirestoreSync?: boolean;
    }
  ): { ok: true; message: GlobalChatMessage } | { ok: false; status: number; error: string } => {
    const cleanText = typeof rawText === 'string' ? rawText.trim() : '';
    if (!cleanText) {
      return { ok: false, status: 400, error: 'Введіть текст повідомлення.' };
    }
    if (cleanText.length > 600) {
      return { ok: false, status: 400, error: 'Повідомлення не може перевищувати 600 символів.' };
    }

    const requestedId =
      typeof options?.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(options.id.trim())
        ? options.id.trim()
        : '';

    if (requestedId && Array.isArray(db.chatMessages)) {
      const existing = db.chatMessages.find((m) => m.id === requestedId);
      if (existing) {
        const enrichedExisting = enrichChatMessageWithBadges(
          existing,
          createBadgeLookup(db),
          createAccountPhotoLookup(db),
          createDonorTextLookup(db)
        );
        return { ok: true, message: enrichedExisting };
      }
    }

    const cleanReplyId = typeof replyToId === 'string' ? replyToId.trim() : '';
    const replyTarget =
      cleanReplyId && Array.isArray(db.chatMessages)
        ? db.chatMessages.find((m) => m.id === cleanReplyId)
        : undefined;

    const fbUid = options?.firebaseUid || account.googleUid;
    const isAuthorAdmin = isAdminEmailAddress(account.email);
    const record: GlobalChatMessage = {
      id: requestedId || `chat_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      authorUid: fbUid || account.uid,
      authorName: account.displayName || 'Гість',
      ...(account.photoUrl ? { authorPhotoUrl: account.photoUrl } : {}),
      ...(isAuthorAdmin ? { isAdmin: true } : {}),
      text: cleanText,
      ...(replyTarget
        ? {
            replyTo: {
              id: replyTarget.id,
              authorUid: replyTarget.authorUid,
              authorName: replyTarget.authorName,
              text: replyTarget.text.slice(0, 180),
            },
          }
        : {}),
      createdAt: new Date().toISOString(),
    };

    if (!Array.isArray(db.chatMessages)) {
      db.chatMessages = [];
    }
    db.chatMessages.push(record);
    if (db.chatMessages.length > 200) {
      db.chatMessages = db.chatMessages.slice(-200);
    }
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
    const enrichedMessage = enrichChatMessageWithBadges(
      record,
      createBadgeLookup(db),
      createAccountPhotoLookup(db),
      createDonorTextLookup(db)
    );
    broadcastChatEvent({
      type: 'chat:message',
      message: enrichedMessage,
      ...(options?.clientMessageId ? { clientMessageId: options.clientMessageId } : {}),
    });

    if (!options?.skipFirestoreSync && fbUid && options?.firebaseIdToken) {
      void syncChatMessageToFirestore(
        {
          id: record.id,
          firebaseUid: fbUid,
          authorName: record.authorName,
          authorPhotoUrl: record.authorPhotoUrl,
          isAdmin: isAuthorAdmin,
          text: record.text,
          replyTo: record.replyTo,
        },
        options.firebaseIdToken
      );
    }

    return { ok: true, message: enrichedMessage };
  };

  const removeChatMessage = (
    db: SiteDatabase,
    id: string,
    actor: {
      uid: string;
      firebaseUid?: string;
      isAdmin: boolean;
      idToken?: string;
      skipFirestoreSync?: boolean;
    }
  ): { ok: true; deletedId: string } | { ok: false; status: number; error: string } => {
    if (!Array.isArray(db.chatMessages)) {
      if (actor.skipFirestoreSync) {
        return { ok: true, deletedId: id };
      }
      return { ok: false, status: 404, error: 'Повідомлення не знайдено.' };
    }
    const index = db.chatMessages.findIndex((m) => m.id === id);
    if (index === -1) {
      if (actor.skipFirestoreSync) {
        broadcastChatEvent({ type: 'chat:deleted', id });
        return { ok: true, deletedId: id };
      }
      return { ok: false, status: 404, error: 'Повідомлення не знайдено.' };
    }
    const target = db.chatMessages[index];
    const isOwner =
      target.authorUid === actor.uid ||
      (Boolean(actor.firebaseUid) && target.authorUid === actor.firebaseUid);
    if (!isOwner && !actor.isAdmin) {
      return { ok: false, status: 403, error: 'Ви можете видаляти лише власні повідомлення.' };
    }
    db.chatMessages.splice(index, 1);
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
    broadcastChatEvent({ type: 'chat:deleted', id });
    if (!actor.skipFirestoreSync && actor.idToken) {
      void deleteChatMessageInFirestore(id, actor.idToken);
    }
    return { ok: true, deletedId: id };
  };

  app.get('/api/chat/messages', async (req, res) => {
    const db = ensureDatabase();
    if (!cloudSyncState.communityHydrated) {
      await ensureAllPublicStateHydrated(db);
    }
    const bearerToken = extractBearerToken(req) || extractCookieGuestSessionToken(req) || '';
    const optionalAuthResult = bearerToken
      ? await authenticateGuestTokenFast(bearerToken, db)
      : null;
    const optionalAuth = optionalAuthResult && optionalAuthResult.ok ? optionalAuthResult : null;
    const badgeLookup = createBadgeLookup(db);
    const photoLookup = createAccountPhotoLookup(db);
    const donorTextLookup = createDonorTextLookup(db);
    const currentUserBadges = optionalAuth
      ? badgeLookup.get(optionalAuth.account.uid, optionalAuth.account.displayName)
      : undefined;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({
      messages: (db.chatMessages || [])
        .slice(-100)
        .map((msg) => enrichChatMessageWithBadges(msg, badgeLookup, photoLookup, donorTextLookup)),
      onlineCount: chatClients.size,
      ...(currentUserBadges ? { currentUserBadges } : {}),
      ...(optionalAuth
        ? { currentUserDonorText: optionalAuth.account.donorChatText || '' }
        : {}),
    });
  });

  app.put('/api/chat/donor-text', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`chat-donor-text:${auth.account.uid}:${ipHash}`, 30, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато оновлень тексту. Зачекайте трохи.' });
      return;
    }

    const badgeLookup = createBadgeLookup(db);
    const liveBadges = badgeLookup.get(auth.account.uid, auth.account.displayName);
    if (!liveBadges?.donorRank || liveBadges.donorRank > 3) {
      res.status(403).json({
        error: 'Поле для власного тексту в чаті доступне лише для топ-3 у рейтингу донатів.',
      });
      return;
    }

    const { text } = req.body as { text?: string };
    const cleanText = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    auth.account.donorChatText = cleanText || undefined;
    auth.account.updatedAt = new Date().toISOString();
    saveDatabase(db, { flushDelayMs: 1500, slices: ['community'] });
    broadcastGlobalChatRefresh?.(db);

    if (auth.firebaseClaims && auth.firebaseIdToken) {
      void syncPublicUserProfileToFirestore(
        {
          firebaseUid: auth.firebaseClaims.uid,
          guestUid: auth.account.uid,
          displayName: auth.account.displayName,
          photoUrl: auth.account.photoUrl,
          likedPoemIds: auth.account.likedPoemIds,
          likedRadioTrackIds: auth.account.likedRadioTrackIds,
          totalTimeSeconds: auth.account.totalTimeSeconds,
          purchasesCount: auth.account.purchasesCount,
          donorChatText: auth.account.donorChatText,
        },
        auth.firebaseIdToken
      );
    }

    const token = extractBearerToken(req) || undefined;
    res.json({
      ok: true,
      donorChatText: auth.account.donorChatText || '',
      user: sanitizeGuestUser(auth.account, auth.provider, token, badgeLookup),
    });
  });

  app.post('/api/chat/messages', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const db = ensureDatabase();
    const token = extractBearerToken(req) || '';
    const auth = await authenticateGuestTokenFast(token, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`chat-send:${auth.account.uid}:${ipHash}`, 20, 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато повідомлень поспіль. Зачекайте хвилинку.' });
      return;
    }

    const { id, text, replyToId, clientMessageId, skipFirestoreSync } = req.body as {
      id?: string;
      text?: string;
      replyToId?: string;
      clientMessageId?: string;
      skipFirestoreSync?: boolean;
    };
    const result = appendChatMessage(db, auth.account, text || '', replyToId, {
      id: typeof id === 'string' ? id.trim() : undefined,
      clientMessageId:
        typeof clientMessageId === 'string' && clientMessageId.trim()
          ? clientMessageId.trim().slice(0, 80)
          : undefined,
      firebaseUid: auth.firebaseClaims?.uid || auth.account.googleUid,
      firebaseIdToken: auth.firebaseIdToken,
      skipFirestoreSync: Boolean(skipFirestoreSync),
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json({ message: result.message });
  });

  app.delete('/api/chat/messages/:id', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const db = ensureDatabase();
    const token = extractBearerToken(req) || '';
    const auth = await authenticateGuestTokenFast(token, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }
    const skipFirestoreSync =
      req.query.skipFirestoreSync === '1' ||
      req.query.skipFirestoreSync === 'true' ||
      Boolean((req.body as { skipFirestoreSync?: boolean } | undefined)?.skipFirestoreSync);
    const result = removeChatMessage(db, req.params.id, {
      uid: auth.account.uid,
      firebaseUid: auth.firebaseClaims?.uid || auth.account.googleUid,
      isAdmin: auth.isAdmin,
      idToken: auth.firebaseIdToken,
      skipFirestoreSync,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ deletedId: result.deletedId });
  });

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      if (url.pathname !== '/ws/chat') {
        return;
      }
      chatWss.handleUpgrade(request, socket, head, (ws) => {
        chatWss.emit('connection', ws, request);
      });
    } catch {
      socket.destroy();
    }
  });

  chatWss.on('connection', (ws, request) => {
    const rawIp = getTrustedWsIp(request);
    const ipHash = crypto.createHash('sha256').update(rawIp).digest('hex');

    const meta: {
      uid?: string;
      firebaseUid?: string;
      firebaseIdToken?: string;
      isAdmin?: boolean;
      ipHash: string;
      isAlive: boolean;
    } = {
      ipHash,
      isAlive: true,
    };
    chatClients.set(ws, meta);

    const db = ensureDatabase();
    const sendInitSnapshot = (targetDb: SiteDatabase) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const badgeLookup = createBadgeLookup(targetDb);
      const photoLookup = createAccountPhotoLookup(targetDb);
      const donorTextLookup = createDonorTextLookup(targetDb);
      ws.send(
        JSON.stringify({
          type: 'chat:init',
          messages: (targetDb.chatMessages || [])
            .slice(-100)
            .map((msg) => enrichChatMessageWithBadges(msg, badgeLookup, photoLookup, donorTextLookup)),
          onlineCount: chatClients.size,
        })
      );
    };
    sendInitSnapshot(db);
    if (!cloudSyncState.communityHydrated) {
      void ensureAllPublicStateHydrated(db).then((changed) => {
        if (changed && ws.readyState === WebSocket.OPEN) {
          broadcastGlobalChatRefresh?.(db);
        }
      });
    }
    broadcastChatEvent({ type: 'chat:presence', onlineCount: chatClients.size });

    ws.on('pong', () => {
      meta.isAlive = true;
    });

    ws.on('message', async (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as {
          type?: string;
          id?: string;
          token?: string;
          text?: string;
          replyToId?: string;
          clientMessageId?: string;
          skipFirestoreSync?: boolean;
        };
        if (!parsed || typeof parsed.type !== 'string') return;

        if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (parsed.type === 'auth') {
          const currentDb = ensureDatabase();
          const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
          if (!token) {
            meta.uid = undefined;
            meta.firebaseUid = undefined;
            meta.firebaseIdToken = undefined;
            meta.isAdmin = false;
            ws.send(JSON.stringify({ type: 'chat:auth', authenticated: false }));
            return;
          }
          const auth = await authenticateGuestTokenFast(token, currentDb);
          if (auth.ok) {
            meta.uid = auth.account.uid;
            meta.firebaseUid = auth.firebaseClaims?.uid || auth.account.googleUid;
            meta.firebaseIdToken = auth.firebaseIdToken;
            meta.isAdmin = auth.isAdmin;
            const liveBadges = createBadgeLookup(currentDb).get(
              auth.account.uid,
              auth.account.displayName
            );
            ws.send(
              JSON.stringify({
                type: 'chat:auth',
                authenticated: true,
                uid: auth.account.uid,
                isAdmin: auth.isAdmin,
                ...(liveBadges ? { badges: liveBadges } : {}),
                donorChatText: auth.account.donorChatText || '',
              })
            );
          } else {
            meta.uid = undefined;
            meta.firebaseUid = undefined;
            meta.firebaseIdToken = undefined;
            meta.isAdmin = false;
            ws.send(JSON.stringify({ type: 'chat:auth', authenticated: false, error: auth.error }));
          }
          return;
        }

        if (parsed.type === 'chat:send') {
          const currentDb = ensureDatabase();
          const frameToken = typeof parsed.token === 'string' ? parsed.token.trim() : '';
          let account = meta.uid
            ? currentDb.guestAccounts.find((acc) => acc.uid === meta.uid)
            : undefined;
          if ((!account || (frameToken && !frameToken.startsWith('guest_v1.'))) && frameToken) {
            const auth = await authenticateGuestTokenFast(frameToken, currentDb);
            if (auth.ok) {
              account = auth.account;
              meta.uid = auth.account.uid;
              meta.firebaseUid = auth.firebaseClaims?.uid || auth.account.googleUid;
              meta.firebaseIdToken = auth.firebaseIdToken;
              meta.isAdmin = auth.isAdmin;
            }
          }
          if (!account) {
            ws.send(
              JSON.stringify({
                type: 'chat:error',
                ...(typeof parsed.clientMessageId === 'string'
                  ? { clientMessageId: parsed.clientMessageId }
                  : {}),
                error: 'Увійдіть в акаунт, щоб писати в глобальний чат.',
              })
            );
            return;
          }

          const rate = checkRateLimit(`chat-send:${account.uid}:${meta.ipHash}`, 20, 60 * 1000);
          if (!rate.allowed) {
            ws.send(
              JSON.stringify({
                type: 'chat:error',
                ...(typeof parsed.clientMessageId === 'string'
                  ? { clientMessageId: parsed.clientMessageId }
                  : {}),
                error: 'Забагато повідомлень поспіль. Зачекайте хвилинку.',
              })
            );
            return;
          }

          const result = appendChatMessage(
            currentDb,
            account,
            parsed.text || '',
            parsed.replyToId,
            {
              id: typeof parsed.id === 'string' ? parsed.id.trim() : undefined,
              clientMessageId:
                typeof parsed.clientMessageId === 'string' && parsed.clientMessageId.trim()
                  ? parsed.clientMessageId.trim().slice(0, 80)
                  : undefined,
              firebaseUid: meta.firebaseUid || account.googleUid,
              firebaseIdToken: meta.firebaseIdToken,
              skipFirestoreSync: Boolean(parsed.skipFirestoreSync),
            }
          );
          if (!result.ok) {
            ws.send(
              JSON.stringify({
                type: 'chat:error',
                ...(typeof parsed.clientMessageId === 'string'
                  ? { clientMessageId: parsed.clientMessageId }
                  : {}),
                error: result.error,
              })
            );
          }
          return;
        }

        if (parsed.type === 'chat:delete' && typeof parsed.id === 'string') {
          const currentDb = ensureDatabase();
          if (!meta.uid) {
            ws.send(
              JSON.stringify({
                type: 'chat:error',
                error: 'Потрібна авторизація для видалення повідомлення.',
              })
            );
            return;
          }
          const result = removeChatMessage(currentDb, parsed.id, {
            uid: meta.uid,
            firebaseUid: meta.firebaseUid,
            isAdmin: Boolean(meta.isAdmin),
            idToken: meta.firebaseIdToken,
            skipFirestoreSync: Boolean(parsed.skipFirestoreSync),
          });
          if (!result.ok) {
            ws.send(JSON.stringify({ type: 'chat:error', error: result.error }));
          }
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      chatClients.delete(ws);
      broadcastChatEvent({ type: 'chat:presence', onlineCount: chatClients.size });
    });
  });

  const heartbeatInterval = setInterval(() => {
    for (const [ws, meta] of chatClients.entries()) {
      if (!meta.isAlive) {
        chatClients.delete(ws);
        ws.terminate();
        continue;
      }
      meta.isAlive = false;
      try {
        ws.ping();
      } catch {
        chatClients.delete(ws);
      }
    }
  }, 30000);
  heartbeatInterval.unref();

  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ...(hmrDisabled ? { ws: false } : {}),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    const precompressedMimeMap: Record<string, string> = {
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json; charset=utf-8',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
      '.woff2': 'font/woff2',
      '.ico': 'image/x-icon',
      '.txt': 'text/plain; charset=utf-8',
      '.xml': 'application/xml; charset=utf-8',
    };

    const createPrecompressedMiddleware = (
      rootDir: string,
      cacheControlForFile: (relPath: string) => string
    ) => {
      const resolvedRoot = path.resolve(rootDir);
      return (req: Request, res: Response, next: () => void) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          next();
          return;
        }
        let decodedPath: string;
        try {
          decodedPath = decodeURIComponent(req.path || '/');
        } catch {
          next();
          return;
        }
        const relPath = decodedPath.replace(/^\/+/, '');
        if (!relPath || decodedPath.endsWith('/')) {
          next();
          return;
        }
        const fullPath = path.resolve(resolvedRoot, relPath);
        if (!fullPath.startsWith(resolvedRoot + path.sep)) {
          next();
          return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        const contentType = precompressedMimeMap[ext];
        if (!contentType) {
          next();
          return;
        }

        const acceptEncoding = String(req.headers['accept-encoding'] || '');
        let encodedPath: string | null = null;
        let encoding: 'br' | 'gzip' | null = null;
        if (/\bbr\b/i.test(acceptEncoding) && fs.existsSync(`${fullPath}.br`)) {
          encodedPath = `${fullPath}.br`;
          encoding = 'br';
        } else if (/\bgzip\b/i.test(acceptEncoding) && fs.existsSync(`${fullPath}.gz`)) {
          encodedPath = `${fullPath}.gz`;
          encoding = 'gzip';
        }

        if (!encodedPath || !encoding) {
          next();
          return;
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Cache-Control', cacheControlForFile(relPath));
        res.sendFile(encodedPath);
      };
    };

    const assetsDir = path.join(distPath, 'assets');
    const srcAssetsDir = path.join(distPath, 'src/assets');

    app.use(
      '/assets',
      createPrecompressedMiddleware(assetsDir, () => 'public, max-age=31536000, immutable'),
      express.static(assetsDir, {
        maxAge: '1y',
        immutable: true,
      })
    );
    app.use(
      '/src/assets',
      createPrecompressedMiddleware(srcAssetsDir, () => 'public, max-age=31536000, immutable'),
      express.static(srcAssetsDir, {
        maxAge: '1y',
        immutable: true,
      })
    );
    app.use(
      createPrecompressedMiddleware(distPath, (relPath) =>
        relPath === 'index.html' ||
        relPath === 'sw.js' ||
        relPath === 'manifest.webmanifest' ||
        relPath.startsWith('workbox-')
          ? 'no-cache'
          : 'public, max-age=3600'
      ),
      express.static(distPath, {
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'manifest.webmanifest' ||
            base.startsWith('workbox-')
          ) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
    void ensureAllPublicStateHydrated(ensureDatabase()).catch(() => {});
    const weeklyTimer = setInterval(() => {
      try {
        const db = ensureDatabase();
        const res = ensureWeeklyWinnersUpToDate(db);
        if (res.changed) saveDatabase(db);
      } catch {
        // Ignore periodic weekly check error
      }
    }, 60 * 60 * 1000);
    weeklyTimer.unref();
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
