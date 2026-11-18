import crypto from 'crypto';
import express, { type Request } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  DEFAULT_HERO_LEAD_TEXT,
  INITIAL_DATABASE,
  type RawBlogPost,
  type RawPoem,
  type RawStoreProduct,
  type SiteDatabase,
} from './server/seedData.ts';
import {
  getEffectivePriceUah,
  isPhysicalProduct,
  type AnalyticsClickCategory,
  type AnalyticsDwellCategory,
  type AuthorAnalyticsReport,
  type BlogPost,
  type OrderRecord,
  type PaymentSummary,
  type Poem,
  type PurchasedAccess,
  type ReviewItem,
  type ShippingDetails,
  type SiteAnalyticsData,
  type StoreProduct,
} from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const EBOOKS_DIR = path.join(DATA_DIR, 'ebooks');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const AUTHOR_SECRET_FILE = path.join(DATA_DIR, '.author-session-secret');
const ADMIN_EMAIL = 'andrijdankiv5@gmail.com';
const AUTHOR_DISPLAY_NAME = 'Андрій Даньків';
const AUTHOR_TOKEN_PREFIX = 'author_v1.';
const AUTHOR_SESSION_TTL_SEC = 30 * 24 * 60 * 60;
const GUEST_TOKEN_PREFIX = 'guest_v1.';
const GUEST_SESSION_TTL_SEC = 90 * 24 * 60 * 60;
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const FIREBASE_PROJECT_ID = (() => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { projectId?: string };
    return parsed.projectId || '';
  } catch {
    return '';
  }
})();

interface VerifiedFirebaseClaims {
  uid: string;
  email: string | null;
  emailVerified: boolean;
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

async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseClaims | null> {
  if (!FIREBASE_PROJECT_ID) return null;
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
  }>(payloadB64);

  if (!payload) return null;
  const nowSec = Math.floor(Date.now() / 1000);
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

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: payload.email_verified === true,
  };
}

function normalizeHostname(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let value = raw.trim().toLowerCase();
  if (!value) return '';
  if (value.includes('://')) {
    try {
      value = new URL(value).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
  return value.split(',')[0]?.trim().split(':')[0]?.trim() || '';
}

function getAllowedAdminDomains(): string[] {
  const domains = new Set<string>(['localhost', '127.0.0.1']);
  const appHost = normalizeHostname(process.env.APP_URL);
  if (appHost) {
    domains.add(appHost);
    if (appHost.startsWith('ais-dev-')) {
      domains.add(`ais-pre-${appHost.slice('ais-dev-'.length)}`);
    } else if (appHost.startsWith('ais-pre-')) {
      domains.add(`ais-dev-${appHost.slice('ais-pre-'.length)}`);
    }
  }
  const extraRaw = process.env.ADMIN_ALLOWED_DOMAINS || '';
  for (const part of extraRaw.split(',')) {
    const host = normalizeHostname(part);
    if (host) domains.add(host);
  }
  return Array.from(domains);
}

function getRequestDomain(req: Request): string {
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const forwardedHost =
    typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'] : '';
  const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : '';
  const resolvedHost =
    normalizeHostname(req.hostname) ||
    normalizeHostname(forwardedHost) ||
    normalizeHostname(hostHeader);

  if (originHeader) {
    const originHost = normalizeHostname(originHeader);
    if (originHost && resolvedHost && originHost !== resolvedHost) {
      return '';
    }
    if (originHost) return originHost;
  }
  return resolvedHost;
}

function isDomainAllowedForAuthor(domain: string): boolean {
  if (!domain) return false;
  return getAllowedAdminDomains().includes(domain);
}

let cachedAuthorSecret: string | null = null;
function getAuthorSessionSecret(): string {
  const envSecret = process.env.AUTHOR_SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  if (cachedAuthorSecret) return cachedAuthorSecret;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(AUTHOR_SECRET_FILE)) {
    const existing = fs.readFileSync(AUTHOR_SECRET_FILE, 'utf-8').trim();
    if (existing.length >= 32) {
      cachedAuthorSecret = existing;
      return existing;
    }
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(AUTHOR_SECRET_FILE, generated, { encoding: 'utf-8', mode: 0o600 });
  cachedAuthorSecret = generated;
  return generated;
}

function signAuthorSessionToken(domain: string, deviceId?: string): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    email: ADMIN_EMAIL,
    domain,
    deviceId: deviceId || undefined,
    iat: nowSec,
    exp: nowSec + AUTHOR_SESSION_TTL_SEC,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sigB64 = crypto
    .createHmac('sha256', getAuthorSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${AUTHOR_TOKEN_PREFIX}${payloadB64}.${sigB64}`;
}

function signGuestSessionToken(uid: string, email: string): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    uid,
    email: email.toLowerCase(),
    iat: nowSec,
    exp: nowSec + GUEST_SESSION_TTL_SEC,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sigB64 = crypto
    .createHmac('sha256', getAuthorSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${GUEST_TOKEN_PREFIX}${payloadB64}.${sigB64}`;
}

function verifyGuestSessionToken(token: string): { uid: string; email: string } | null {
  if (!token.startsWith(GUEST_TOKEN_PREFIX)) return null;
  const rawToken = token.slice(GUEST_TOKEN_PREFIX.length);
  const dotIdx = rawToken.indexOf('.');
  if (dotIdx <= 0) return null;
  const payloadB64 = rawToken.slice(0, dotIdx);
  const sigB64 = rawToken.slice(dotIdx + 1);
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', getAuthorSessionSecret())
    .update(payloadB64)
    .digest();
  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length || !crypto.timingSafeEqual(providedSig, expectedSig)) {
    return null;
  }

  const payload = decodeBase64UrlJson<{ uid?: string; email?: string; exp?: number }>(payloadB64);
  if (!payload || !payload.uid || !payload.email || typeof payload.exp !== 'number') {
    return null;
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  return { uid: payload.uid, email: payload.email.toLowerCase() };
}

function verifyAuthorSessionToken(token: string, requestDomain: string): VerifiedFirebaseClaims | null {
  if (!token.startsWith(AUTHOR_TOKEN_PREFIX) || !isDomainAllowedForAuthor(requestDomain)) {
    return null;
  }
  const rawToken = token.slice(AUTHOR_TOKEN_PREFIX.length);
  const dotIdx = rawToken.indexOf('.');
  if (dotIdx <= 0) return null;
  const payloadB64 = rawToken.slice(0, dotIdx);
  const sigB64 = rawToken.slice(dotIdx + 1);
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', getAuthorSessionSecret())
    .update(payloadB64)
    .digest();
  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length || !crypto.timingSafeEqual(providedSig, expectedSig)) {
    return null;
  }

  const payload = decodeBase64UrlJson<{
    email?: string;
    domain?: string;
    deviceId?: string;
    exp?: number;
  }>(payloadB64);
  if (!payload) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (
    payload.email?.toLowerCase() !== ADMIN_EMAIL ||
    payload.domain !== requestDomain ||
    typeof payload.exp !== 'number' ||
    payload.exp <= nowSec
  ) {
    return null;
  }

  if (payload.deviceId) {
    const db = ensureDatabase();
    const deviceActive = db.trustedAuthorDevices.some(
      (d) =>
        d.deviceId === payload.deviceId &&
        d.domain === requestDomain &&
        d.email.toLowerCase() === ADMIN_EMAIL
    );
    if (!deviceActive) return null;
  }

  return {
    uid: payload.deviceId ? `author_${payload.deviceId}` : 'author_dankiv',
    email: ADMIN_EMAIL,
    emailVerified: true,
  };
}

function verifyAdminAccessKey(candidate: string): boolean {
  const configured = process.env.ADMIN_ACCESS_KEY?.trim() || '';
  if (!configured || !candidate) return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(configured).digest();
  return crypto.timingSafeEqual(a, b);
}

function verifyDeviceEcdsaSignature(
  publicKeySpkiBase64: string,
  message: string,
  signatureBase64Url: string
): boolean {
  try {
    const keyDer = Buffer.from(publicKeySpkiBase64, 'base64');
    const publicKey = crypto.createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
    const sigBuf = Buffer.from(signatureBase64Url, 'base64url');
    return crypto.verify(
      'sha256',
      Buffer.from(message, 'utf-8'),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      sigBuf
    );
  } catch {
    return false;
  }
}

interface DeviceChallengeRecord {
  nonce: string;
  deviceId: string;
  domain: string;
  expiresAt: number;
}

const activeDeviceChallenges = new Map<string, DeviceChallengeRecord>();

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function isVerifiedAdminClaims(claims: VerifiedFirebaseClaims | null): boolean {
  return Boolean(
    claims &&
      claims.emailVerified &&
      claims.email &&
      claims.email.toLowerCase() === ADMIN_EMAIL
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
      error: 'Увійдіть під акаунтом автора (andrijdankiv5@gmail.com), щоб виконувати зміни.',
    };
  }
  try {
    if (token.startsWith(AUTHOR_TOKEN_PREFIX)) {
      const requestDomain = getRequestDomain(req);
      const claims = verifyAuthorSessionToken(token, requestDomain);
      if (!claims) {
        return {
          ok: false,
          status: 401,
          error: 'Сесія доступу для цього домену або пристрою недійсна чи закінчилась. Увійдіть повторно.',
        };
      }
      return { ok: true, claims };
    }

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
  };
}

function ensureDatabase(): SiteDatabase {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(EBOOKS_DIR)) {
    fs.mkdirSync(EBOOKS_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(INITIAL_DATABASE, null, 2), 'utf-8');
    return structuredClone(INITIAL_DATABASE);
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SiteDatabase>;
    const existingProducts = parsed.products ?? INITIAL_DATABASE.products;
    const hasPaperBook = existingProducts.some((p) => p.type === 'paper_book');
    const hasPoemFrame = existingProducts.some((p) => p.type === 'poem_frame');
    let mergedProducts = existingProducts;
    if (!hasPaperBook || !hasPoemFrame) {
      const existingIds = new Set(existingProducts.map((p) => p.id));
      const missingSeeds = INITIAL_DATABASE.products.filter(
        (seed) =>
          !existingIds.has(seed.id) &&
          ((!hasPaperBook && seed.type === 'paper_book') ||
            (!hasPoemFrame && seed.type === 'poem_frame'))
      );
      if (missingSeeds.length > 0) {
        mergedProducts = [...existingProducts, ...missingSeeds];
      }
    }
    const rawAnalytics = parsed.analytics;
    const analytics: SiteAnalyticsData = rawAnalytics
      ? {
          totalSessions: Number(rawAnalytics.totalSessions) || 0,
          seenSessionIds: Array.isArray(rawAnalytics.seenSessionIds) ? rawAnalytics.seenSessionIds : [],
          totalClicks: Number(rawAnalytics.totalClicks) || 0,
          totalTrackedSeconds: Number(rawAnalytics.totalTrackedSeconds) || 0,
          clicksByTarget: rawAnalytics.clicksByTarget ?? {},
          dwellByTarget: rawAnalytics.dwellByTarget ?? {},
          exitsByMoment: rawAnalytics.exitsByMoment ?? {},
          recentEvents: Array.isArray(rawAnalytics.recentEvents) ? rawAnalytics.recentEvents : [],
        }
      : createEmptyAnalytics();

    return {
      heroLeadText:
        typeof parsed.heroLeadText === 'string' && parsed.heroLeadText.trim()
          ? parsed.heroLeadText
          : DEFAULT_HERO_LEAD_TEXT,
      poems: parsed.poems ?? INITIAL_DATABASE.poems,
      prose: parsed.prose ?? INITIAL_DATABASE.prose,
      blog: parsed.blog ?? INITIAL_DATABASE.blog,
      products: mergedProducts,
      orders: parsed.orders ?? [],
      poemVotes: parsed.poemVotes ?? {},
      productVotes: parsed.productVotes ?? {},
      reviews: parsed.reviews ?? [],
      poemViews: parsed.poemViews ?? {},
      blogViews: parsed.blogViews ?? {},
      visitorIpHashes: parsed.visitorIpHashes ?? [],
      guestAccounts: parsed.guestAccounts ?? [],
      trustedAuthorDevices: parsed.trustedAuthorDevices ?? [],
      analytics,
    };
  } catch {
    fs.writeFileSync(DATA_FILE, JSON.stringify(INITIAL_DATABASE, null, 2), 'utf-8');
    return structuredClone(INITIAL_DATABASE);
  }
}

function saveDatabase(db: SiteDatabase): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

function getClientIpHash(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp =
    (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ||
    req.socket.remoteAddress ||
    req.ip ||
    '127.0.0.1';
  return crypto.createHash('sha256').update(rawIp).digest('hex');
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function parseDecimalRating(raw: unknown): number | null {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric * 10) / 10;
  if (rounded < 0.1 || rounded > 5) return null;
  return rounded;
}

function enrichPoem(poem: RawPoem, db: SiteDatabase, ipHash: string): Poem {
  const votesForPoem = db.poemVotes[poem.id] || {};
  const scores = Object.values(votesForPoem);
  const ratingCount = scores.length;
  const ratingAverage =
    ratingCount > 0 ? Number((scores.reduce((sum, s) => sum + s, 0) / ratingCount).toFixed(1)) : 0;
  const userRating = typeof votesForPoem[ipHash] === 'number' ? votesForPoem[ipHash] : null;
  const poemReviews = db.reviews.filter((r) => r.targetType === 'poem' && r.targetId === poem.id);

  return {
    ...poem,
    viewsCount: db.poemViews[poem.id] || 0,
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

function enrichProductForPublic(product: RawStoreProduct, db: SiteDatabase, ipHash: string): StoreProduct {
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
  const userRating = typeof votesForProduct[ipHash] === 'number' ? votesForProduct[ipHash] : null;
  const productReviews = db.reviews.filter((r) => r.targetType === 'product' && r.targetId === product.id);

  return {
    ...publicFields,
    hasEbookFile: Boolean(product.ebookStorageKey || product.ebookFullText),
    ratingAverage,
    ratingCount,
    userRating,
    reviews: productReviews,
  };
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
    const shippingSummary = shipping
      ? `${carrierLabel} · ${shipping.city}, ${shipping.addressOrBranch} (${shipping.recipientName}, ${shipping.phone})`
      : 'Фізичне відправлення';
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
  const PORT = Number(process.env.PORT) || 3000;

  ensureDatabase();
  app.set('trust proxy', true);

  // Check current user's verified role (Firebase ID token or domain/device HMAC session token)
  app.get('/api/auth/role', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.json({ isAdmin: false, role: 'guest', email: null });
      return;
    }
    try {
      if (token.startsWith(AUTHOR_TOKEN_PREFIX)) {
        const claims = verifyAuthorSessionToken(token, getRequestDomain(req));
        const isAdmin = isVerifiedAdminClaims(claims);
        res.json({
          isAdmin,
          role: isAdmin ? 'admin' : 'guest',
          email: claims?.email || null,
        });
        return;
      }

      const claims = await verifyFirebaseIdToken(token);
      const isAdmin = isVerifiedAdminClaims(claims);
      res.json({
        isAdmin,
        role: isAdmin ? 'admin' : 'guest',
        email: claims?.email || null,
      });
    } catch {
      res.json({ isAdmin: false, role: 'guest', email: null });
    }
  });

  // Public domain & current-device status for author authentication UI (never exposes secrets/keys)
  app.get('/api/author/access-status', (req, res) => {
    const db = ensureDatabase();
    const domain = getRequestDomain(req);
    const domainAllowed = isDomainAllowedForAuthor(domain);
    const queryDeviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId.trim() : '';
    const deviceBound =
      Boolean(queryDeviceId) &&
      domainAllowed &&
      db.trustedAuthorDevices.some(
        (d) =>
          d.deviceId === queryDeviceId &&
          d.domain === domain &&
          d.email.toLowerCase() === ADMIN_EMAIL
      );

    res.json({
      adminEmail: ADMIN_EMAIL,
      domain,
      domainAllowed,
      hasAccessKeyConfigured: Boolean(process.env.ADMIN_ACCESS_KEY?.trim()),
      deviceBound,
      trustedDevicesCount: db.trustedAuthorDevices.filter((d) => d.domain === domain).length,
      allowedDomains: getAllowedAdminDomains(),
    });
  });

  // Author key login + optional cryptographic binding of current device to current domain
  app.post('/api/author/key-login', express.json({ limit: '1mb' }), (req, res) => {
    const domain = getRequestDomain(req);
    if (!isDomainAllowedForAuthor(domain)) {
      res.status(403).json({
        error: `Домен «${domain || 'невідомий'}» не входить до списку дозволених для входу автора.`,
      });
      return;
    }

    const { email, accessKey, bindDevice, deviceId, publicKeySpki, label } = req.body as {
      email?: string;
      accessKey?: string;
      bindDevice?: boolean;
      deviceId?: string;
      publicKeySpki?: string;
      label?: string;
    };

    const normalizedEmail = email?.trim().toLowerCase() || '';
    if (normalizedEmail !== ADMIN_EMAIL) {
      res.status(403).json({ error: `Цей вхід призначено лише для пошти ${ADMIN_EMAIL}.` });
      return;
    }

    if (!process.env.ADMIN_ACCESS_KEY?.trim()) {
      res.status(503).json({
        error:
          'На сервері ще не задано секрет ADMIN_ACCESS_KEY. Додайте ADMIN_ACCESS_KEY у Settings → Secrets або додайте домен у Firebase Console.',
      });
      return;
    }

    if (!accessKey || !verifyAdminAccessKey(accessKey.trim())) {
      res.status(401).json({ error: 'Невірний ключ доступу автора.' });
      return;
    }

    const db = ensureDatabase();
    let boundDeviceId: string | undefined;

    if (
      bindDevice &&
      typeof deviceId === 'string' &&
      deviceId.trim().length >= 6 &&
      deviceId.trim().length <= 64 &&
      typeof publicKeySpki === 'string' &&
      publicKeySpki.trim().length >= 32
    ) {
      try {
        const cleanSpki = publicKeySpki.trim();
        crypto.createPublicKey({
          key: Buffer.from(cleanSpki, 'base64'),
          format: 'der',
          type: 'spki',
        });
        const cleanDeviceId = deviceId.trim();
        const nowIso = new Date().toISOString();
        const cleanLabel = (label?.trim() || 'Пристрій автора').slice(0, 80);
        const existingIdx = db.trustedAuthorDevices.findIndex(
          (d) => d.deviceId === cleanDeviceId && d.domain === domain
        );
        if (existingIdx !== -1) {
          db.trustedAuthorDevices[existingIdx] = {
            ...db.trustedAuthorDevices[existingIdx],
            publicKeySpki: cleanSpki,
            label: cleanLabel,
            lastUsedAt: nowIso,
          };
        } else {
          db.trustedAuthorDevices.push({
            deviceId: cleanDeviceId,
            email: ADMIN_EMAIL,
            domain,
            label: cleanLabel,
            publicKeySpki: cleanSpki,
            createdAt: nowIso,
            lastUsedAt: nowIso,
          });
        }
        saveDatabase(db);
        boundDeviceId = cleanDeviceId;
      } catch {
        // Ignore malformed public key without crashing verified login
      }
    }

    const sessionToken = signAuthorSessionToken(domain, boundDeviceId);
    res.json({
      user: {
        uid: boundDeviceId ? `author_${boundDeviceId}` : 'author_dankiv',
        displayName: AUTHOR_DISPLAY_NAME,
        email: ADMIN_EMAIL,
        provider: boundDeviceId ? 'device' : 'email',
        sessionToken,
      },
      domain,
      deviceBound: Boolean(boundDeviceId),
    });
  });

  // Step 1 of device-bound author login: request single-use nonce for this device & domain
  app.post('/api/author/device-challenge', express.json({ limit: '64kb' }), (req, res) => {
    const domain = getRequestDomain(req);
    if (!isDomainAllowedForAuthor(domain)) {
      res.status(403).json({ error: 'Поточний домен не авторизовано для входу автора.' });
      return;
    }

    const { deviceId } = req.body as { deviceId?: string };
    const cleanDeviceId = deviceId?.trim() || '';
    if (!cleanDeviceId) {
      res.status(400).json({ error: 'Ідентифікатор пристрою не передано.' });
      return;
    }

    const db = ensureDatabase();
    const device = db.trustedAuthorDevices.find(
      (d) =>
        d.deviceId === cleanDeviceId &&
        d.domain === domain &&
        d.email.toLowerCase() === ADMIN_EMAIL
    );
    if (!device) {
      res.status(404).json({ error: 'Цей пристрій не прив’язано до поточного домену.' });
      return;
    }

    const now = Date.now();
    for (const [key, item] of activeDeviceChallenges.entries()) {
      if (item.expiresAt <= now) activeDeviceChallenges.delete(key);
    }
    if (activeDeviceChallenges.size >= 50) {
      const oldestKey = activeDeviceChallenges.keys().next().value;
      if (oldestKey) activeDeviceChallenges.delete(oldestKey);
    }

    const nonce = crypto.randomBytes(24).toString('base64url');
    activeDeviceChallenges.set(nonce, {
      nonce,
      deviceId: cleanDeviceId,
      domain,
      expiresAt: now + 90_000,
    });

    res.json({ nonce, domain, expiresInSec: 90 });
  });

  // Step 2 of device-bound author login: verify ECDSA P-256 signature & issue domain-bound session token
  app.post('/api/author/device-login', express.json({ limit: '64kb' }), (req, res) => {
    const domain = getRequestDomain(req);
    if (!isDomainAllowedForAuthor(domain)) {
      res.status(403).json({ error: 'Поточний домен не авторизовано для входу автора.' });
      return;
    }

    const { deviceId, nonce, signature } = req.body as {
      deviceId?: string;
      nonce?: string;
      signature?: string;
    };
    const cleanDeviceId = deviceId?.trim() || '';
    const cleanNonce = nonce?.trim() || '';
    const cleanSig = signature?.trim() || '';
    if (!cleanDeviceId || !cleanNonce || !cleanSig) {
      res.status(400).json({ error: 'Неповні дані підпису пристрою.' });
      return;
    }

    const challenge = activeDeviceChallenges.get(cleanNonce);
    activeDeviceChallenges.delete(cleanNonce);
    if (
      !challenge ||
      challenge.expiresAt <= Date.now() ||
      challenge.deviceId !== cleanDeviceId ||
      challenge.domain !== domain
    ) {
      res.status(401).json({ error: 'Термін виклику безпеки минув. Спробуйте ще раз.' });
      return;
    }

    const db = ensureDatabase();
    const deviceIdx = db.trustedAuthorDevices.findIndex(
      (d) =>
        d.deviceId === cleanDeviceId &&
        d.domain === domain &&
        d.email.toLowerCase() === ADMIN_EMAIL
    );
    if (deviceIdx === -1) {
      res.status(404).json({ error: 'Прив’язку пристрою не знайдено.' });
      return;
    }

    const device = db.trustedAuthorDevices[deviceIdx];
    const message = `${cleanNonce}|${domain}|${cleanDeviceId}|${ADMIN_EMAIL}`;
    if (!verifyDeviceEcdsaSignature(device.publicKeySpki, message, cleanSig)) {
      res.status(401).json({ error: 'Криптографічний підпис пристрою не підтверджено.' });
      return;
    }

    db.trustedAuthorDevices[deviceIdx] = {
      ...device,
      lastUsedAt: new Date().toISOString(),
    };
    saveDatabase(db);

    const sessionToken = signAuthorSessionToken(domain, cleanDeviceId);
    res.json({
      user: {
        uid: `author_${cleanDeviceId}`,
        displayName: AUTHOR_DISPLAY_NAME,
        email: ADMIN_EMAIL,
        provider: 'device',
        sessionToken,
      },
      domain,
    });
  });

  // Strict Admin-only guard for ALL /api/author/* management endpoints (evaluated before body parsing)
  app.use('/api/author', async (req, res, next) => {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }
    next();
  });

  // List & manage trusted author devices (Admin-only)
  app.get('/api/author/devices', (req, res) => {
    const db = ensureDatabase();
    const currentDomain = getRequestDomain(req);
    res.json({
      currentDomain,
      devices: db.trustedAuthorDevices.map((d) => ({
        deviceId: d.deviceId,
        domain: d.domain,
        label: d.label,
        createdAt: d.createdAt,
        lastUsedAt: d.lastUsedAt,
      })),
    });
  });

  app.post('/api/author/devices/bind', express.json({ limit: '1mb' }), (req, res) => {
    const domain = getRequestDomain(req);
    if (!isDomainAllowedForAuthor(domain)) {
      res.status(403).json({ error: 'Поточний домен не авторизовано.' });
      return;
    }
    const { deviceId, publicKeySpki, label } = req.body as {
      deviceId?: string;
      publicKeySpki?: string;
      label?: string;
    };
    const cleanDeviceId = deviceId?.trim() || '';
    const cleanSpki = publicKeySpki?.trim() || '';
    if (cleanDeviceId.length < 6 || cleanDeviceId.length > 64 || cleanSpki.length < 32) {
      res.status(400).json({ error: 'Некоректні дані ключа пристрою.' });
      return;
    }
    try {
      crypto.createPublicKey({
        key: Buffer.from(cleanSpki, 'base64'),
        format: 'der',
        type: 'spki',
      });
    } catch {
      res.status(400).json({ error: 'Недійсний публічний ключ пристрою.' });
      return;
    }

    const db = ensureDatabase();
    const nowIso = new Date().toISOString();
    const cleanLabel = (label?.trim() || 'Пристрій автора').slice(0, 80);
    const existingIdx = db.trustedAuthorDevices.findIndex(
      (d) => d.deviceId === cleanDeviceId && d.domain === domain
    );
    if (existingIdx !== -1) {
      db.trustedAuthorDevices[existingIdx] = {
        ...db.trustedAuthorDevices[existingIdx],
        publicKeySpki: cleanSpki,
        label: cleanLabel,
        lastUsedAt: nowIso,
      };
    } else {
      db.trustedAuthorDevices.push({
        deviceId: cleanDeviceId,
        email: ADMIN_EMAIL,
        domain,
        label: cleanLabel,
        publicKeySpki: cleanSpki,
        createdAt: nowIso,
        lastUsedAt: nowIso,
      });
    }
    saveDatabase(db);

    res.status(201).json({
      bound: true,
      deviceId: cleanDeviceId,
      domain,
      sessionToken: signAuthorSessionToken(domain, cleanDeviceId),
    });
  });

  app.delete('/api/author/devices/:deviceId', (req, res) => {
    const db = ensureDatabase();
    const { deviceId } = req.params;
    const before = db.trustedAuthorDevices.length;
    db.trustedAuthorDevices = db.trustedAuthorDevices.filter((d) => d.deviceId !== deviceId);
    if (db.trustedAuthorDevices.length === before) {
      res.status(404).json({ error: 'Пристрій не знайдено.' });
      return;
    }
    saveDatabase(db);
    res.json({ removedDeviceId: deviceId });
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
          saveDatabase(db);
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

  app.use(express.json({ limit: '10mb' }));
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Public catalog + tracks unique visitor by IP
  app.get('/api/catalog', (req, res) => {
    const db = ensureDatabase();
    const ipHash = getClientIpHash(req);

    if (!db.visitorIpHashes.includes(ipHash)) {
      db.visitorIpHashes.push(ipHash);
      saveDatabase(db);
    }

    res.json({
      heroLeadText: db.heroLeadText,
      poems: db.poems.map((poem) => enrichPoem(poem, db, ipHash)),
      prose: db.prose,
      blog: db.blog.map((post) => enrichBlogPost(post, db)),
      products: db.products.map((product) => enrichProductForPublic(product, db, ipHash)),
      uniqueVisitors: db.visitorIpHashes.length,
    });
  });

  // Track/refresh unique visitor count
  app.post('/api/visitors/track', (req, res) => {
    const db = ensureDatabase();
    const ipHash = getClientIpHash(req);
    let isNewVisitor = false;

    if (!db.visitorIpHashes.includes(ipHash)) {
      db.visitorIpHashes.push(ipHash);
      saveDatabase(db);
      isNewVisitor = true;
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
    saveDatabase(db);
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
    saveDatabase(db);
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

      if (cleanSessionId && !analytics.seenSessionIds.includes(cleanSessionId)) {
        analytics.seenSessionIds.push(cleanSessionId);
        if (analytics.seenSessionIds.length > 2000) {
          analytics.seenSessionIds = analytics.seenSessionIds.slice(-1500);
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

      saveDatabase(db);
      res.status(200).json({ ok: true });
    }
  );

  // Guest registration & email sign-in fallback (used when Firebase Email/Password isn't enabled in console yet)
  app.post('/api/guest/register', (req, res) => {
    const db = ensureDatabase();
    const { displayName, email, password, rememberDevice } = req.body as {
      displayName?: string;
      email?: string;
      password?: string;
      rememberDevice?: boolean;
    };

    const trimmedName = displayName?.trim() || '';
    const normalizedEmail = email?.trim().toLowerCase() || '';
    if (normalizedEmail === ADMIN_EMAIL) {
      res.status(403).json({
        error: 'Для входу автора скористайтеся вкладкою «Увійти» або кнопкою Google (Gmail).',
      });
      return;
    }
    if (trimmedName.length < 2 || !normalizedEmail.includes('@') || !password || password.length < 6) {
      res.status(400).json({ error: 'Вкажіть ім’я (мін. 2 символи), коректний email та пароль від 6 символів.' });
      return;
    }

    if (db.guestAccounts.some((acc) => acc.email === normalizedEmail)) {
      res.status(409).json({ error: 'Користувач із цією поштою вже зареєстрований.' });
      return;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const uid = `guest_${crypto.randomBytes(8).toString('hex')}`;
    const createdAt = new Date().toISOString();

    db.guestAccounts.push({
      uid,
      displayName: trimmedName,
      email: normalizedEmail,
      passwordHash,
      salt,
      createdAt,
    });
    saveDatabase(db);

    const sessionToken = rememberDevice !== false ? signGuestSessionToken(uid, normalizedEmail) : undefined;
    res.status(201).json({
      user: {
        uid,
        displayName: trimmedName,
        email: normalizedEmail,
        provider: 'email',
        sessionToken,
      },
    });
  });

  app.post('/api/guest/login', (req, res) => {
    const db = ensureDatabase();
    const { email, password, rememberDevice } = req.body as {
      email?: string;
      password?: string;
      rememberDevice?: boolean;
    };
    const normalizedEmail = email?.trim().toLowerCase() || '';
    if (normalizedEmail === ADMIN_EMAIL) {
      const domain = getRequestDomain(req);
      if (!isDomainAllowedForAuthor(domain)) {
        res.status(403).json({
          error: `Вхід автора заборонено для домену «${domain || 'невідомий'}».`,
        });
        return;
      }
      if (!process.env.ADMIN_ACCESS_KEY?.trim()) {
        res.status(403).json({
          error:
            'Для входу поштою andrijdankiv5@gmail.com на цьому домені додайте секрет ADMIN_ACCESS_KEY у налаштуваннях Secrets (або додайте домен у Firebase Auth).',
        });
        return;
      }
      if (!password || !verifyAdminAccessKey(password.trim())) {
        res.status(401).json({ error: 'Невірний ключ доступу автора (ADMIN_ACCESS_KEY).' });
        return;
      }
      const sessionToken = signAuthorSessionToken(domain);
      res.json({
        user: {
          uid: 'author_dankiv',
          displayName: AUTHOR_DISPLAY_NAME,
          email: ADMIN_EMAIL,
          provider: 'email',
          sessionToken,
        },
      });
      return;
    }
    const account = db.guestAccounts.find((acc) => acc.email === normalizedEmail);
    if (!account) {
      res.status(404).json({
        error: 'Акаунт із цією поштою ще не створено. Перейдіть у вкладку «Реєстрація».',
      });
      return;
    }
    if (!password) {
      res.status(400).json({ error: 'Введіть пароль.' });
      return;
    }

    const attemptHash = hashPassword(password, account.salt);
    if (attemptHash !== account.passwordHash) {
      res.status(401).json({ error: 'Невірний пароль.' });
      return;
    }

    const sessionToken =
      rememberDevice !== false ? signGuestSessionToken(account.uid, account.email) : undefined;
    res.json({
      user: {
        uid: account.uid,
        displayName: account.displayName,
        email: account.email,
        provider: 'email',
        sessionToken,
      },
    });
  });

  // Validate remembered device session token (guest_v1 or author_v1) across restarts / PWA launches
  app.get('/api/guest/session', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ valid: false });
      return;
    }

    if (token.startsWith(AUTHOR_TOKEN_PREFIX)) {
      const claims = verifyAuthorSessionToken(token, getRequestDomain(req));
      if (!claims) {
        res.status(401).json({ valid: false });
        return;
      }
      res.json({
        valid: true,
        isAdmin: true,
        user: {
          uid: claims.uid,
          displayName: AUTHOR_DISPLAY_NAME,
          email: ADMIN_EMAIL,
          provider: 'device',
          sessionToken: token,
        },
      });
      return;
    }

    const parsedGuest = verifyGuestSessionToken(token);
    if (!parsedGuest) {
      res.status(401).json({ valid: false });
      return;
    }

    const db = ensureDatabase();
    const account = db.guestAccounts.find(
      (acc) => acc.uid === parsedGuest.uid && acc.email.toLowerCase() === parsedGuest.email
    );
    if (!account) {
      res.status(401).json({ valid: false });
      return;
    }

    res.json({
      valid: true,
      isAdmin: false,
      user: {
        uid: account.uid,
        displayName: account.displayName,
        email: account.email,
        provider: 'email',
        sessionToken: token,
      },
    });
  });

  // Rate a poem (0.1 to 5.0), strictly once per unique IP
  app.post('/api/poems/:id/rate', (req, res) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const { rating } = req.body as { rating?: number };

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

    if (typeof db.poemVotes[id][ipHash] === 'number') {
      const enriched = enrichPoem(poem, db, ipHash);
      res.status(409).json({
        error: 'З вашої IP-адреси цей вірш уже оцінено.',
        alreadyRated: true,
        poem: enriched,
      });
      return;
    }

    db.poemVotes[id][ipHash] = numericRating;
    saveDatabase(db);

    const enriched = enrichPoem(poem, db, ipHash);
    res.json({ poem: enriched });
  });

  // Submit named or anonymous review + rating (0.1..5.0) for Poem or Book/Product
  app.post('/api/reviews', (req, res) => {
    const db = ensureDatabase();
    const { targetType, targetId, rating, comment, isAnonymous, authorUid, authorName, authorPhotoUrl } = req.body as {
      targetType?: 'poem' | 'product';
      targetId?: string;
      rating?: number;
      comment?: string;
      isAnonymous?: boolean;
      authorUid?: string;
      authorName?: string;
      authorPhotoUrl?: string;
    };

    if ((targetType !== 'poem' && targetType !== 'product') || !targetId) {
      res.status(400).json({ error: 'Некоректний об’єкт відгуку.' });
      return;
    }

    const numericRating = parseDecimalRating(rating);
    if (numericRating === null) {
      res.status(400).json({ error: 'Оцінка має бути від 0.1 до 5.0.' });
      return;
    }

    const cleanComment = comment?.trim() || '';
    if (cleanComment.length > 1500) {
      res.status(400).json({ error: 'Текст коментаря не повинен перевищувати 1500 символів.' });
      return;
    }

    const ipHash = getClientIpHash(req);
    const hasAuthUser = !isAnonymous && Boolean(authorUid?.trim()) && authorUid?.trim() !== 'anon' && Boolean(authorName?.trim());
    const cleanUid = hasAuthUser ? authorUid!.trim() : `anon_${ipHash.slice(0, 8)}`;
    const cleanName = hasAuthUser ? authorName!.trim().slice(0, 80) : 'Анонім';
    const cleanPhoto = hasAuthUser ? authorPhotoUrl?.trim() || undefined : undefined;
    const hasComment = cleanComment.length > 0;

    if (targetType === 'poem') {
      const poem = db.poems.find((p) => p.id === targetId);
      if (!poem) {
        res.status(404).json({ error: 'Вірш не знайдено.' });
        return;
      }

      if (!db.poemVotes[targetId]) db.poemVotes[targetId] = {};
      const alreadyRatedIp = typeof db.poemVotes[targetId][ipHash] === 'number';
      db.poemVotes[targetId][ipHash] = numericRating;

      let review: ReviewItem | null = null;
      if (hasComment) {
        review = {
          id: `rev_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          targetType: 'poem',
          targetId,
          authorUid: cleanUid,
          authorName: cleanName,
          authorPhotoUrl: cleanPhoto,
          rating: numericRating,
          comment: cleanComment,
          createdAt: new Date().toISOString(),
        };
        db.reviews.unshift(review);
      }

      saveDatabase(db);

      res.status(201).json({
        review,
        ratingOnly: !hasComment,
        updatedRating: alreadyRatedIp,
        appliedRating: db.poemVotes[targetId][ipHash],
        poem: enrichPoem(poem, db, ipHash),
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
    const alreadyRatedIp = typeof db.productVotes[targetId][ipHash] === 'number';
    db.productVotes[targetId][ipHash] = numericRating;

    let review: ReviewItem | null = null;
    if (hasComment) {
      review = {
        id: `rev_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        targetType: 'product',
        targetId,
        authorUid: cleanUid,
        authorName: cleanName,
        authorPhotoUrl: cleanPhoto,
        rating: numericRating,
        comment: cleanComment,
        createdAt: new Date().toISOString(),
      };
      db.reviews.unshift(review);
    }

    saveDatabase(db);

    res.status(201).json({
      review,
      ratingOnly: !hasComment,
      updatedRating: alreadyRatedIp,
      appliedRating: db.productVotes[targetId][ipHash],
      product: enrichProductForPublic(product, db, ipHash),
    });
  });

  // Author studio catalog: includes full fields for editing + orders for fulfillment
  app.get('/api/author/catalog', (_req, res) => {
    const db = ensureDatabase();
    res.json({
      heroLeadText: db.heroLeadText,
      poems: db.poems,
      prose: db.prose,
      blog: db.blog,
      products: db.products,
      orders: db.orders,
      ordersCount: db.orders.length,
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
    saveDatabase(db);
    res.json({ ok: true });
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
      saveDatabase(db);
      res.json({ deletedId: id });
      return;
    }
    if (kind === 'prose') {
      const before = db.prose.length;
      db.prose = db.prose.filter((p) => p.id !== id);
      if (db.prose.length === before) {
        res.status(404).json({ error: 'Твір не знайдено.' });
        return;
      }
      saveDatabase(db);
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

  // Update homepage hero lead block text
  app.put('/api/author/settings', (req, res) => {
    const db = ensureDatabase();
    const { heroLeadText } = req.body as { heroLeadText?: string };
    if (typeof heroLeadText !== 'string' || heroLeadText.trim().length < 3 || heroLeadText.trim().length > 500) {
      res.status(400).json({ error: 'Текст опису має містити від 3 до 500 символів.' });
      return;
    }
    db.heroLeadText = heroLeadText.trim();
    saveDatabase(db);
    res.json({ heroLeadText: db.heroLeadText });
  });

  // Upload a custom cover image from admin computer
  app.post('/api/author/upload-cover', (req, res) => {
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

    const filename = `cover-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);

    res.status(201).json({ url: `/uploads/${filename}` });
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

    const validTypes = ['ebook', 'paper_book', 'wip_gdoc', 'poem_frame'] as const;
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

    saveDatabase(db);
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
    saveDatabase(db);
    res.json({ deletedId: id });
  });

  app.post('/api/author/products', (req, res) => {
    const db = ensureDatabase();
    const body = req.body as Partial<RawStoreProduct>;
    const validTypes = ['ebook', 'paper_book', 'wip_gdoc', 'poem_frame'] as const;
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
          ? '/src/assets/images/wip_manuscript_novel_1795025674997.jpg'
          : '/src/assets/images/ebook_cover_silence_1795025673857.jpg'),
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
      payload: Record<string, string | number>;
    };

    if (!payload?.title || !payload?.content) {
      res.status(400).json({ error: 'Заповніть заголовок та текст твору.' });
      return;
    }

    const contentStr = String(payload.content).trim();
    const excerptStr =
      String(payload.excerpt || '').trim() ||
      contentStr.split('\n').find((line) => line.trim().length > 0)?.slice(0, 140) + '...';

    if (kind === 'poem') {
      const poem: RawPoem = {
        id: `poem-${Date.now()}`,
        title: String(payload.title).trim(),
        cycle: String(payload.cycle || 'Нові вірші').trim(),
        year: Number(payload.year) || 2026,
        excerpt: excerptStr,
        content: contentStr,
        note: payload.note ? String(payload.note).trim() : undefined,
      };
      db.poems.unshift(poem);
      saveDatabase(db);
      res.status(201).json({ item: poem });
      return;
    }

    if (kind === 'prose') {
      const words = contentStr.split(/\s+/).length;
      const prose = {
        id: `prose-${Date.now()}`,
        title: String(payload.title).trim(),
        genre: String(payload.genre || 'Оповідання').trim(),
        year: Number(payload.year) || 2026,
        readingMinutes: Math.max(2, Math.ceil(words / 180)),
        excerpt: excerptStr,
        content: contentStr,
      };
      db.prose.unshift(prose);
      saveDatabase(db);
      res.status(201).json({ item: prose });
      return;
    }

    if (kind === 'blog') {
      const words = contentStr.split(/\s+/).length;
      const post: RawBlogPost = {
        id: `blog-${Date.now()}`,
        title: String(payload.title).trim(),
        category: String(payload.category || 'Нотатки').trim(),
        publishedAt: new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }),
        readingMinutes: Math.max(2, Math.ceil(words / 180)),
        excerpt: excerptStr,
        content: contentStr,
      };
      db.blog.unshift(post);
      saveDatabase(db);
      res.status(201).json({ item: post });
      return;
    }

    res.status(400).json({ error: 'Невідомий тип публікації.' });
  });

  app.post('/api/orders', (req, res) => {
    const db = ensureDatabase();
    const { buyerName, buyerEmail, productIds, shipping, payment } = req.body as {
      buyerName?: string;
      buyerEmail?: string;
      productIds?: string[];
      shipping?: Partial<ShippingDetails>;
      payment?: {
        method?: 'card' | 'apple_google_pay';
        cardLast4?: string;
        paymentToken?: string;
      };
    };

    if (!buyerName?.trim() || !buyerEmail?.trim() || !Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ error: 'Будь ласка, вкажіть ім’я, email та виберіть хоча б одне видання.' });
      return;
    }

    const uniqueIds = Array.from(new Set(productIds));
    const matchedProducts = uniqueIds
      .map((id) => db.products.find((p) => p.id === id))
      .filter((p): p is RawStoreProduct => Boolean(p));

    if (matchedProducts.length === 0) {
      res.status(404).json({ error: 'Обрані видання не знайдено.' });
      return;
    }

    const requiresShipping = matchedProducts.some((p) => isPhysicalProduct(p.type));
    let sanitizedShipping: ShippingDetails | undefined;

    if (requiresShipping) {
      const recipientName = shipping?.recipientName?.trim() || buyerName.trim();
      const phone = shipping?.phone?.trim() || '';
      const city = shipping?.city?.trim() || '';
      const addressOrBranch = shipping?.addressOrBranch?.trim() || '';
      const carrier =
        shipping?.carrier === 'nova_poshta' ||
        shipping?.carrier === 'ukrposhta' ||
        shipping?.carrier === 'courier'
          ? shipping.carrier
          : 'nova_poshta';

      if (phone.length < 9 || city.length < 2 || addressOrBranch.length < 3) {
        res.status(400).json({
          error: 'Для доставки фізичної книги або антирамки заповніть телефон, місто та адресу / відділення.',
        });
        return;
      }

      sanitizedShipping = {
        recipientName,
        phone,
        carrier,
        city,
        addressOrBranch,
        postalCode: shipping?.postalCode?.trim() || undefined,
        comment: shipping?.comment?.trim() || undefined,
      };
    }

    if (!payment?.paymentToken) {
      res.status(400).json({
        error: 'Підтвердіть оплату через захищену платіжну систему.',
      });
      return;
    }

    const paidAt = new Date().toISOString();
    const transactionId = `PAY-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const paymentMethod = payment.method === 'apple_google_pay' ? 'apple_google_pay' : 'card';
    const paymentSummary: PaymentSummary = {
      status: 'paid',
      providerLabel: paymentMethod === 'apple_google_pay' ? 'Apple Pay / Google Pay (TLS 1.3)' : 'Захищений картковий шлюз (TLS 1.3)',
      method: paymentMethod,
      cardLast4: paymentMethod === 'card' && payment.cardLast4 ? payment.cardLast4.slice(-4) : undefined,
      transactionId,
      paidAt,
    };

    let orderCode = `AD-${Math.floor(1000 + Math.random() * 9000)}`;
    while (db.orders.some((o) => o.orderCode === orderCode)) {
      orderCode = `AD-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    const totalUah = matchedProducts.reduce((sum, p) => sum + getEffectivePriceUah(p), 0);
    const unlockedItems = matchedProducts.map((p) =>
      buildPurchasedAccess(p, orderCode, paidAt, sanitizedShipping, transactionId)
    );

    const orderRecord: OrderRecord = {
      orderCode,
      buyerName: buyerName.trim(),
      buyerEmail: buyerEmail.trim().toLowerCase(),
      createdAt: paidAt,
      totalUah,
      shipping: sanitizedShipping,
      payment: paymentSummary,
      items: unlockedItems,
    };

    db.orders.unshift(orderRecord);
    saveDatabase(db);

    res.status(201).json({ order: orderRecord });
  });

  app.post('/api/orders/restore', (req, res) => {
    const db = ensureDatabase();
    const { query } = req.body as { query?: string };
    const normalized = query?.trim().toLowerCase();
    if (!normalized) {
      res.status(400).json({ error: 'Введіть email або номер замовлення.' });
      return;
    }

    const matchedOrders = db.orders.filter(
      (o) => o.buyerEmail.toLowerCase() === normalized || o.orderCode.toLowerCase() === normalized
    );

    const items = matchedOrders.flatMap((o) => o.items);
    res.json({ items, ordersCount: matchedOrders.length });
  });

  app.get('/api/ebooks/:id/download', async (req, res) => {
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
            o.items.some((item) => item.productId === id)
        );
      if (!isPurchased) {
        res.status(403).send('Файл доступний для завантаження лише після придбання електронної книги.');
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

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
