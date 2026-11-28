import crypto from 'crypto';
import dns from 'dns/promises';
import express, { type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SiteDatabase, RawProseWork } from './seedData.ts';
import type { ProseAccessMode, ProseStatus, ProseTagColor, SiteAnalyticsData } from '../src/types.ts';
import {
  ALL_DB_SLICES,
  loadSiteDatabaseFromSqlite,
  saveSiteDatabaseToSqlite,
  type DbSliceKey,
} from './sqliteStore.ts';
import {
  checkPersistentRateLimit,
  createPersistentRateLimitStore,
} from './persistentRateLimit.ts';
import { loadMediaAssetFromFirestore } from './firestoreStubs.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const EBOOKS_DIR = path.join(DATA_DIR, 'ebooks');
export const PROSE_PDF_DIR = path.join(DATA_DIR, 'prose-pdfs');

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

export function normalizeProseTagColor(rawColor: unknown): ProseTagColor {
  if (typeof rawColor !== 'string') return 'rose';
  const trimmed = rawColor.trim();
  if (VALID_PRESET_TAG_COLORS.has(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  return 'rose';
}

export function normalizeProseStatus(rawStatus: unknown): ProseStatus | undefined {
  if (rawStatus === 'completed' || rawStatus === 'in_progress') {
    return rawStatus;
  }
  return undefined;
}

export function resolveProseAccessMode(
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

export function createEmptyAnalytics(): SiteAnalyticsData {
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

export function normalizeBuiltInImageUrl(url: string): string {
  return url.replace(BUILTIN_IMAGE_EXT_RE, '$1.webp');
}

let cachedDb: SiteDatabase | null = null;
let catalogRevision = 1;
export let visitorIpSet: Set<string> = new Set();
export let seenAnalyticsSessionsSet: Set<string> = new Set();
export const missingUploadCache = new Map<string, number>();

let dirsEnsured = false;
let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFlushDeadlineMs = 0;
let dirtyPendingWrite = false;
let shutdownHooksRegistered = false;
const pendingDirtySlices = new Set<DbSliceKey>();
const pendingDirtyOrderCodes = new Set<string>();
let pendingAllOrdersDirty = false;

export function getCatalogRevision(): number {
  return catalogRevision;
}

export function bumpCatalogRevision(): number {
  catalogRevision += 1;
  return catalogRevision;
}

export function syncRuntimeSets(db: SiteDatabase): void {
  visitorIpSet = new Set(db.visitorIpHashes);
  seenAnalyticsSessionsSet = new Set(db.analytics.seenSessionIds);
}

export function ensureDataDirectories(): void {
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

export function flushDatabaseSync(): void {
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

export function registerDatabaseShutdownHooks(): void {
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

export function ensureDatabase(): SiteDatabase {
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

export function saveDatabase(
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

export function resolveConfinedFilePath(baseDir: string, storageKey: string): string | null {
  const safeName = path.basename(storageKey);
  if (!safeName) return null;
  const resolved = path.resolve(baseDir, safeName);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep)) {
    return null;
  }
  return resolved;
}

export function getNormalizedClientIp(req: Request): string {
  const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  return rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
}

export function getTrustedWsIp(request: http.IncomingMessage): string {
  const remote = request.socket?.remoteAddress || '127.0.0.1';
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
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

export function getClientIpHash(req: Request): string {
  return crypto.createHash('sha256').update(getNormalizedClientIp(req)).digest('hex');
}

export function checkRateLimit(
  bucketKey: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  return checkPersistentRateLimit(bucketKey, maxRequests, windowMs);
}

export function createEndpointRateLimiter(
  prefix: string,
  limit: number,
  windowMs: number,
  errorMessage: string
) {
  return rateLimit({
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
}

export function verifySameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const secFetchSite = req.headers['sec-fetch-site'];

  if (secFetchSite === 'cross-site') {
    return false;
  }

  const allowedHosts = new Set<string>();
  const rawHost = req.get('host');
  if (rawHost) {
    for (const h of rawHost.split(',')) {
      const clean = h.trim().toLowerCase();
      if (clean) allowedHosts.add(clean);
    }
  }

  const trustProxy =
    process.env.TRUST_PROXY === 'true' ||
    process.env.NODE_ENV === 'production' ||
    Boolean(req.app?.get?.('trust proxy'));

  if (trustProxy) {
    const rawForwarded = req.get('x-forwarded-host');
    if (rawForwarded) {
      for (const h of rawForwarded.split(',')) {
        const clean = h.trim().toLowerCase();
        if (clean) allowedHosts.add(clean);
      }
    }
  }

  if (process.env.APP_URL) {
    try {
      allowedHosts.add(new URL(process.env.APP_URL).host.toLowerCase());
    } catch {
      // Ignore
    }
  }

  if (allowedHosts.size === 0) {
    return false;
  }

  const checkHostMatch = (targetUrlStr: string): boolean => {
    try {
      const targetHost = new URL(targetUrlStr).host.toLowerCase();
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

  if (secFetchSite === 'same-origin' || secFetchSite === 'same-site') {
    return true;
  }

  const isReadMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (isReadMethod) {
    return true;
  }

  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
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

export async function validateExternalImageUrlForProxy(rawUrl: string): Promise<{ url: URL; pinIp: string } | null> {
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

export function fetchPinnedImageUrl(
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

export function registerUploadRoutes(app: express.Express): void {
  ensureDataDirectories();
  app.use(
    '/uploads',
    express.static(UPLOADS_DIR, {
      maxAge: '30d',
      immutable: true,
    })
  );

  app.get('/uploads/:filename', async (req: Request, res: Response) => {
    const safeName = path.basename(req.params.filename || '');
    if (!safeName || !/^[a-z0-9._-]+$/i.test(safeName)) {
      res.status(404).end();
      return;
    }

    const localPath = path.join(UPLOADS_DIR, safeName);
    if (fs.existsSync(localPath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      res.sendFile(localPath);
      return;
    }

    const cachedMissingUntil = missingUploadCache.get(safeName);
    if (cachedMissingUntil && cachedMissingUntil > Date.now()) {
      res.status(404).end();
      return;
    }

    try {
      const asset = await loadMediaAssetFromFirestore(safeName);
      if (asset) {
        try {
          fs.writeFileSync(localPath, asset.buffer);
        } catch {
          // Serve directly even if local disk write fails
        }
        missingUploadCache.delete(safeName);
        res.setHeader('Content-Type', asset.mimeType);
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
        res.send(asset.buffer);
        return;
      }
    } catch {
      // Fall through to 404
    }

    missingUploadCache.set(safeName, Date.now() + 60_000);
    if (missingUploadCache.size > 500) {
      missingUploadCache.clear();
    }
    res.status(404).end();
  });
}
