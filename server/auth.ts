import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import type { GuestAccountRecord, SiteDatabase } from './seedData.ts';
import type { GuestUser, UserTopBadges } from '../src/types.ts';
import {
  DATA_DIR,
  ROOT_DIR,
  bumpCatalogRevision,
  checkRateLimit,
  createEndpointRateLimiter,
  ensureDataDirectories,
  ensureDatabase,
  getClientIpHash,
  saveDatabase,
  verifySameOrigin,
} from './db.ts';
import type { DbSliceKey } from './sqliteStore.ts';
import {
  cloudSyncState,
  hydrateAdminSecretsFromFirestore,
  hydrateCommunityStateFromFirestore,
  hydrateGuestLikesFromFirestore,
  hydratePoemLikesFromFirestore,
  hydratePublicCatalogFromFirestore,
  hydrateRadioLikesFromFirestore,
  queueDatabaseSyncToFirestore,
  syncGuestLikesToFirestore,
  syncPublicUserProfileToFirestore,
  syncUserPoemLikeEntriesToFirestore,
} from './firestoreStubs.ts';
import { applyCloudTelegramBotToken } from '../src/api/telegramBot.ts';
import { ensureWeeklyWinnersUpToDate } from './weeklyHighlights.ts';

export function getAdminEmails(): Set<string> {
  const envEmails = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '';
  if (envEmails.trim()) {
    return new Set(envEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
  }
  return new Set<string>(['admin@example.com']);
}

export function isAdminEmailAddress(email?: string | null): boolean {
  if (!email) return false;
  const emails = getAdminEmails();
  return emails.has(email.trim().toLowerCase());
}

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const FIREBASE_PROJECT_ID = (() => {
  const candidates = [
    path.join(ROOT_DIR, 'firebase-applet-config.json'),
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

export interface VerifiedFirebaseClaims {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  email_verified?: boolean;
  name: string | null;
  picture: string | null;
}

export interface UserBadgesLookup {
  get: (uid?: string | null, displayName?: string | null) => UserTopBadges | undefined;
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

export function decodeBase64UrlJson<T>(segment: string): T | null {
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

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseClaims | null> {
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

export function extractBearerToken(req: Request): string | null {
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

export function isVerifiedAdminClaims(claims: VerifiedFirebaseClaims | null): boolean {
  if (!claims) return false;
  const customClaimsAdmin = (claims as unknown as { admin?: boolean; role?: string }).admin === true || 
    (claims as unknown as { admin?: boolean; role?: string }).role === 'admin';
  return Boolean((claims.emailVerified && isAdminEmailAddress(claims.email)) || customClaimsAdmin);
}

export async function authenticateAdminRequest(
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

const GUEST_SESSION_SECRET_FILE = path.join(DATA_DIR, '.guest-session-secret');
export const GUEST_SESSION_COOKIE_NAME = 'dankiv_guest_session';
export const GUEST_SESSION_TTL_SEC = 30 * 24 * 60 * 60;
export const PIN_MAX_FAILED_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 15 * 60 * 1000;
let cachedGuestSessionSecret: string | null = null;

export function getGuestSessionSecret(): Buffer | string {
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

export function parseCookies(req: Request): Record<string, string> {
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

export function extractCookieGuestSessionToken(req: Request): string | null {
  const cookies = parseCookies(req);
  const val = cookies[GUEST_SESSION_COOKIE_NAME];
  return typeof val === 'string' && val.startsWith('guest_v1.') ? val : null;
}

function isHttpsRequest(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '').toLowerCase();
  return req.secure || proto.includes('https');
}

export function setGuestSessionCookie(req: Request, res: Response, token: string): void {
  const httpsReq = isHttpsRequest(req);
  const parts = [
    `${GUEST_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${GUEST_SESSION_TTL_SEC}`,
  ];
  if (httpsReq) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.append('Set-Cookie', parts.join('; '));
}

export function clearGuestSessionCookie(req: Request, res: Response): void {
  const httpsReq = isHttpsRequest(req);
  const parts = [
    `${GUEST_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (httpsReq) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.append('Set-Cookie', parts.join('; '));
}

export function isValidSecurePasscode(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[0-9]{6,32}$/.test(raw.trim());
}

export function hashGuestPin(pin: string): { pinHash: string; pinSalt: string } {
  const pinSalt = crypto.randomBytes(16).toString('hex');
  const pinHash = crypto.scryptSync(pin, pinSalt, 64).toString('hex');
  return { pinHash, pinSalt };
}

export function verifyGuestPinHash(pin: string, pinHash: string, pinSalt: string): boolean {
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

export interface GuestSessionTokenPayload {
  uid: string;
  email: string;
  provider: 'google';
  exp: number;
}

export function issueGuestSessionToken(
  account: Pick<GuestAccountRecord, 'uid' | 'email'>,
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

export function verifyGuestSessionToken(token: string): GuestSessionTokenPayload | null {
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

export function sanitizeGuestUser(
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

export function normalizeEmailAddress(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 254) : '';
}

export const hydratedGuestLikesUids = new Set<string>();
let cloudPoemLikesHydrated = false;
let pendingPoemLikesHydration: Promise<boolean> | null = null;
export const cloudPoemLikesByPoemId = new Map<string, Set<string>>();
export const cloudPoemLikesByUid = new Map<string, Set<string>>();

let cloudRadioLikesHydrated = false;
let pendingRadioLikesHydration: Promise<boolean> | null = null;
export const cloudRadioLikesByTrackId = new Map<string, Set<string>>();
export const cloudRadioLikesByUid = new Map<string, Set<string>>();

export async function ensureCloudPoemLikesHydrated(): Promise<boolean> {
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
      bumpCatalogRevision();
      return true;
    } catch {
      return false;
    } finally {
      pendingPoemLikesHydration = null;
    }
  })();
  return pendingPoemLikesHydration;
}

export async function ensureCloudRadioLikesHydrated(): Promise<boolean> {
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
      bumpCatalogRevision();
      return true;
    } catch {
      return false;
    } finally {
      pendingRadioLikesHydration = null;
    }
  })();
  return pendingRadioLikesHydration;
}

export function recordCloudRadioLikeState(trackId: string, firebaseUid: string, liked: boolean): void {
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

export async function ensureAllPublicStateHydrated(db: SiteDatabase): Promise<boolean> {
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
    const dirtySlices = new Set<DbSliceKey>();
    if (publicRes) {
      dirtySlices.add('meta');
      dirtySlices.add('poems');
      dirtySlices.add('prose');
      dirtySlices.add('blog');
      dirtySlices.add('products');
      dirtySlices.add('radio');
    }
    if (communityRes || likesRes || radioLikesRes) {
      dirtySlices.add('community');
    }
    if (weeklyRollover.changed) {
      dirtySlices.add('poems');
      dirtySlices.add('prose');
    }
    bumpCatalogRevision();
    saveDatabase(db, {
      bumpCatalogRevision: false,
      flushDelayMs: 300,
      slices: Array.from(dirtySlices),
    });
    return true;
  }
  return false;
}

export function recordCloudPoemLikeState(poemId: string, firebaseUid: string, liked: boolean): void {
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

export function syncCloudPoemLikesForUid(firebaseUid: string, likedPoemIds: string[]): void {
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

export function findOrCreateGoogleGuestAccount(
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

export async function hydrateAccountLikesFromFirestoreIfNeeded(
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

export async function authenticateGuestTokenFast(
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

export async function authenticateGuestToken(
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

export async function authenticateGuestRequest(
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

export async function tryAuthenticateOptionalGuest(
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

export function registerAuthRoutes(
  app: express.Express,
  deps: {
    createBadgeLookup: (db: SiteDatabase) => UserBadgesLookup;
    getBroadcastGlobalChatRefresh: () => ((db: SiteDatabase) => void) | null;
  }
): void {
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

  // Check current user's verified role
  app.get('/api/auth/role', async (req: Request, res: Response) => {
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
          saveDatabase(db, {
            slices: hadPublic
              ? ['meta', 'poems', 'prose', 'blog', 'products', 'radio']
              : ['meta'],
          });
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

  // Track authenticated user's active time on site
  const userHeartbeatLastMs = new Map<string, number>();
  const userTimeCloudSyncLastMs = new Map<string, number>();

  app.post(
    '/api/users/time-heartbeat',
    express.text({ type: 'text/plain', limit: '16kb' }),
    async (req: Request, res: Response) => {
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

  // Guest Google Sign-In session sync
  app.post('/api/guest/google-session', async (req: Request, res: Response) => {
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
        if (hadPublic) {
          saveDatabase(db, { slices: ['meta', 'poems', 'prose', 'blog', 'products', 'radio'] });
        }
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
        user: sanitizeGuestUser(account, 'google', sessionToken, deps.createBadgeLookup(db)),
        isAdmin,
        role: isAdmin ? 'admin' : 'guest',
      });
    } catch {
      res.status(401).json({ error: 'Помилка перевірки Google-сесії.' });
    }
  });

  // Restore remembered guest session transparently from HttpOnly cookie
  app.get('/api/guest/session', async (req: Request, res: Response) => {
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
        deps.createBadgeLookup(db)
      ),
      isAdmin: Boolean(authResult.firebaseClaims && authResult.isAdmin),
      requiresGoogleForAdmin,
    });
  });

  // Clear remembered HttpOnly session cookie on explicit logout
  app.post('/api/guest/logout', (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    clearGuestSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Set or update 4-digit PIN
  app.post('/api/guest/pin/set', pinSetLimiter, async (req: Request, res: Response) => {
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
    if (!isValidSecurePasscode(pin)) {
      res.status(400).json({ error: 'ПІН-код має складатися щонайменше з 6 цифр.' });
      return;
    }

    const account = authResult.account;
    const alreadyHasPin = Boolean(account.pinHash && account.pinSalt);
    if (alreadyHasPin && !authResult.firebaseClaims) {
      if (!isValidSecurePasscode(currentPin) || !verifyGuestPinHash(currentPin as string, account.pinHash!, account.pinSalt!)) {
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
    delete account.pinFailedAttemptsByIp;
    account.pinUpdatedAt = nowIso;
    account.updatedAt = nowIso;
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 0, slices: ['community'] });

    const freshSessionToken = issueGuestSessionToken(account, 'google');
    setGuestSessionCookie(req, res, freshSessionToken);

    res.json({
      ok: true,
      user: sanitizeGuestUser(account, 'google', freshSessionToken, deps.createBadgeLookup(db)),
    });
  });

  // Disable PIN for current account
  app.delete('/api/guest/pin', async (req: Request, res: Response) => {
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
    delete account.pinFailedAttemptsByIp;
    delete account.pinUpdatedAt;
    account.updatedAt = new Date().toISOString();
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 0, slices: ['community'] });

    const freshSessionToken = issueGuestSessionToken(account, 'google');
    setGuestSessionCookie(req, res, freshSessionToken);

    res.json({
      ok: true,
      user: sanitizeGuestUser(account, 'google', freshSessionToken, deps.createBadgeLookup(db)),
    });
  });

  // Quick PIN sign-in with per-IP + account lockout tracking
  app.post('/api/guest/pin-login', pinLoginLimiter, async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }

    const { uid, email, pin } = req.body as { uid?: unknown; email?: unknown; pin?: unknown };
    const cleanUid = typeof uid === 'string' ? uid.trim() : '';
    const cleanEmail = normalizeEmailAddress(email);

    if ((!cleanUid && !cleanEmail) || !isValidSecurePasscode(pin)) {
      res.status(400).json({ error: 'Введіть ПІН-код (найменше 6 цифр).' });
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

    const ipHash = getClientIpHash(req);
    const nowMs = Date.now();

    if (!account.pinFailedAttemptsByIp) {
      account.pinFailedAttemptsByIp = {};
    }
    const ipRecord = account.pinFailedAttemptsByIp[ipHash] || { count: 0 };

    if (ipRecord.lockedUntil) {
      const lockedUntilMs = Date.parse(ipRecord.lockedUntil);
      if (Number.isFinite(lockedUntilMs) && lockedUntilMs > nowMs) {
        const retryAfterSec = Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000));
        const mins = Math.ceil(retryAfterSec / 60);
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(429).json({
          error: `ПІН-вхід з вашої IP-адреси тимчасово заблоковано на ${mins} хв через невдалі спроби. Використайте вхід через Google.`,
          retryAfterSec,
          lockedUntil: ipRecord.lockedUntil,
        });
        return;
      }
      ipRecord.count = 0;
      delete ipRecord.lockedUntil;
    }

    const isPinValid = verifyGuestPinHash(pin as string, account.pinHash, account.pinSalt);
    if (!isPinValid) {
      ipRecord.count = (ipRecord.count || 0) + 1;
      account.pinFailedAttemptsByIp[ipHash] = ipRecord;

      if (ipRecord.count >= PIN_MAX_FAILED_ATTEMPTS) {
        const lockIso = new Date(nowMs + PIN_LOCKOUT_MS).toISOString();
        ipRecord.lockedUntil = lockIso;
        saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 0, slices: ['community'] });
        res.setHeader('Retry-After', String(Math.ceil(PIN_LOCKOUT_MS / 1000)));
        res.status(429).json({
          error: 'Забагато невірних спроб з цієї IP-адреси. ПІН-вхід заблоковано на 15 хвилин — увійдіть через Google.',
          retryAfterSec: Math.ceil(PIN_LOCKOUT_MS / 1000),
          lockedUntil: lockIso,
          attemptsRemaining: 0,
        });
        return;
      }
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
      const attemptsRemaining = Math.max(0, PIN_MAX_FAILED_ATTEMPTS - ipRecord.count);
      res.status(401).json({
        error: `Невірний ПІН-код. Залишилось спроб: ${attemptsRemaining}.`,
        attemptsRemaining,
      });
      return;
    }

    delete account.pinFailedAttemptsByIp[ipHash];
    account.pinFailedAttempts = 0;
    delete account.pinLockedUntil;
    account.lastSeenAt = new Date().toISOString();
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 3000, slices: ['community'] });

    const sessionToken = issueGuestSessionToken(account, 'google');
    setGuestSessionCookie(req, res, sessionToken);
    const requiresGoogleForAdmin = isAdminEmailAddress(account.email);

    res.json({
      user: sanitizeGuestUser(account, 'google', sessionToken, deps.createBadgeLookup(db)),
      sessionToken,
      isAdmin: false,
      requiresGoogleForAdmin,
      role: 'guest',
    });
  });

  // Update guest profile
  app.post('/api/guest/profile', async (req: Request, res: Response) => {
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

    const badgeLookup = deps.createBadgeLookup(db);
    const liveBadges = badgeLookup.get(authResult.account.uid, authResult.account.displayName);
    let donorTextUpdated = false;
    if (typeof donorChatText === 'string' && liveBadges?.donorRank && liveBadges.donorRank <= 3) {
      const normalizedDonorText = donorChatText.replace(/\s+/g, ' ').trim().slice(0, 80);
      authResult.account.donorChatText = normalizedDonorText || undefined;
      donorTextUpdated = true;
    }

    authResult.account.updatedAt = new Date().toISOString();
    saveDatabase(db, { flushDelayMs: 1000, slices: ['community'] });
    const broadcastFn = deps.getBroadcastGlobalChatRefresh();
    if (donorTextUpdated && broadcastFn) {
      broadcastFn(db);
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
}
