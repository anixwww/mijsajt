import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Express, Request } from 'express';
import type { SiteDatabase } from '../../server/seedData.ts';
import type { TelegramSubscriptionState } from '../types.ts';

export interface TelegramBotRouteDeps {
  ensureDatabase: () => SiteDatabase;
  saveDatabase?: (
    db: SiteDatabase,
    options?: {
      bumpCatalogRevision?: boolean;
      flushDelayMs?: number;
      slices?: Array<'meta' | 'poems' | 'prose' | 'blog' | 'products' | 'radio' | 'community' | 'analytics'>;
    }
  ) => void;
  dataDir?: string;
  extractBearerToken?: (req: Request) => string | null;
  onSyncTelegramBotTokenToCloud?: (botToken: string, adminBearerToken: string) => Promise<boolean>;
  verifySameOrigin: (req: Request) => boolean;
  checkRateLimit: (
    bucketKey: string,
    maxRequests: number,
    windowMs: number
  ) => { allowed: boolean; retryAfterSec: number };
  getClientIpHash: (req: Request) => string;
  decodeBase64UrlJson: <T>(segment: string) => T | null;
}

interface TelegramApiResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
}

interface TelegramMembershipCheckResult {
  subscribed: boolean;
  status?: string;
  error?: string;
}

interface TelegramChallengeRecord {
  code: string;
  ipHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  resolved?: {
    telegramUserId: number;
    username?: string;
    firstName?: string;
    subscribed: boolean;
    checkedAtMs: number;
    lastError?: string;
  };
}

interface TelegramUserPayload {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

interface TelegramChatPayload {
  id: number;
  type?: string;
  username?: string;
  title?: string;
}

interface TelegramChatMemberUpdated {
  chat: TelegramChatPayload;
  from?: TelegramUserPayload;
  date?: number;
  old_chat_member?: {
    user?: TelegramUserPayload;
    status?: string;
    is_member?: boolean;
  };
  new_chat_member?: {
    user?: TelegramUserPayload;
    status?: string;
    is_member?: boolean;
  };
}

export interface TelegramUpdateItem {
  update_id: number;
  message?: {
    text?: string;
    from?: TelegramUserPayload;
    chat?: TelegramChatPayload;
  };
  chat_member?: TelegramChatMemberUpdated;
  my_chat_member?: TelegramChatMemberUpdated;
}

interface TelegramDiscountTokenPayload {
  tgId: number;
  username?: string;
  firstName?: string;
  chatId: string;
  iat: number;
  exp: number;
}

interface TelegramWebhookInfoResult {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_message?: string;
  allowed_updates?: string[];
}

const EPHEMERAL_TG_DISCOUNT_SECRET = crypto.randomBytes(32);
const TELEGRAM_MEMBERSHIP_CACHE_MS = 45 * 1000;

const telegramMembershipCache = new Map<
  string,
  { subscribed: boolean; status?: string; error?: string; checkedAtMs: number }
>();

const telegramChallenges = new Map<string, TelegramChallengeRecord>();

let cachedTelegramBot: { info: TelegramBotInfo; fetchedAtMs: number; tokenDigest: string } | null = null;
let cachedWebhookInfo: {
  active: boolean;
  url: string;
  pendingUpdateCount: number;
  lastError?: string;
  fetchedAtMs: number;
  tokenDigest: string;
} | null = null;
let registeredWebhookSecret = '';
let telegramUpdateOffset = 0;
let activeTelegramPollPromise: Promise<void> | null = null;
let configuredDataDir = path.join(process.cwd(), 'data');
let storedAdminTelegramBotToken: string | null = null;

function getTelegramSecretsFilePath(): string {
  return path.join(configuredDataDir, 'telegram-bot-config.json');
}

function readAdminTelegramBotTokenFromDisk(): string {
  if (storedAdminTelegramBotToken !== null) {
    return storedAdminTelegramBotToken;
  }
  try {
    const filePath = getTelegramSecretsFilePath();
    if (!fs.existsSync(filePath)) {
      storedAdminTelegramBotToken = '';
      return '';
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { botToken?: unknown };
    storedAdminTelegramBotToken =
      typeof parsed?.botToken === 'string' ? parsed.botToken.trim() : '';
  } catch {
    storedAdminTelegramBotToken = '';
  }
  return storedAdminTelegramBotToken;
}

function writeAdminTelegramBotTokenToDisk(token: string): void {
  const clean = token.trim();
  storedAdminTelegramBotToken = clean;
  try {
    if (!fs.existsSync(configuredDataDir)) {
      fs.mkdirSync(configuredDataDir, { recursive: true });
    }
    const filePath = getTelegramSecretsFilePath();
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(
      tmpPath,
      JSON.stringify({
        botToken: clean,
        updatedAt: new Date().toISOString(),
      }),
      { encoding: 'utf8', mode: 0o600 }
    );
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[TelegramBot] Failed to persist bot config locally:', err);
  }
}

export function resetTelegramBotCaches(): void {
  cachedTelegramBot = null;
  cachedWebhookInfo = null;
  telegramMembershipCache.clear();
  telegramUpdateOffset = 0;
}

export function applyCloudTelegramBotToken(token: string): void {
  const clean = token.trim();
  if (!clean) return;
  const current = readAdminTelegramBotTokenFromDisk();
  if (!current) {
    writeAdminTelegramBotTokenToDisk(clean);
    resetTelegramBotCaches();
  }
}

function getTelegramDiscountSecret(): Buffer | string {
  const paymentKey = process.env.PAYMENT_ENCRYPTION_KEY?.trim();
  if (paymentKey) {
    return crypto.createHash('sha256').update(`tg-sub:${paymentKey}`).digest();
  }
  const guestSecret = process.env.GUEST_SESSION_SECRET?.trim();
  if (guestSecret) {
    return crypto.createHash('sha256').update(`tg-sub:${guestSecret}`).digest();
  }
  return EPHEMERAL_TG_DISCOUNT_SECRET;
}

function getTelegramBotTokenInfo(): {
  token: string;
  source: 'admin' | 'env' | 'none';
  hasStoredToken: boolean;
} {
  const adminToken = readAdminTelegramBotTokenFromDisk();
  if (adminToken) {
    return { token: adminToken, source: 'admin', hasStoredToken: true };
  }
  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  if (envToken) {
    return { token: envToken, source: 'env', hasStoredToken: false };
  }
  return { token: '', source: 'none', hasStoredToken: false };
}

function maskTelegramBotToken(token: string): string | null {
  const clean = token.trim();
  if (!clean) return null;
  const colonIdx = clean.indexOf(':');
  if (colonIdx > 0) {
    const botId = clean.slice(0, colonIdx);
    const secretPart = clean.slice(colonIdx + 1);
    const tail = secretPart.slice(-4);
    return `${botId}:••••••${tail}`;
  }
  if (clean.length <= 8) return '••••••••';
  return `${clean.slice(0, 4)}••••••${clean.slice(-4)}`;
}

/**
 * Reads the active bot token (admin-configured cabinet token first, fallback to `TELEGRAM_BOT_TOKEN`).
 * Never hardcode credentials in source code.
 */
export function getTelegramBotToken(): string {
  return getTelegramBotTokenInfo().token;
}

function getWebhookSecretForVerification(): string {
  const envSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (envSecret) return envSecret;
  return registeredWebhookSecret;
}

function getOrDeriveWebhookSecretForRegistration(): string {
  const envSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (envSecret) return envSecret;
  const derived = crypto
    .createHmac('sha256', getTelegramDiscountSecret())
    .update('telegram-webhook-secret-v1')
    .digest('hex')
    .slice(0, 48);
  registeredWebhookSecret = derived;
  return derived;
}

function timingSafeSecretEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseTelegramChannelTarget(rawInput: string): {
  chatId: string;
  username: string;
  url: string;
  isPrivateInvite: boolean;
} {
  const raw = rawInput.trim();
  if (!raw) {
    return { chatId: '', username: '', url: '', isPrivateInvite: false };
  }
  if (/^-?\d+$/.test(raw)) {
    return { chatId: raw, username: '', url: '', isPrivateInvite: false };
  }
  if (raw.startsWith('@')) {
    const username = raw.slice(1).replace(/[^a-zA-Z0-9_]/g, '');
    return {
      chatId: username ? `@${username}` : '',
      username,
      url: username ? `https://t.me/${username}` : '',
      isPrivateInvite: false,
    };
  }
  try {
    const parsed = new URL(
      raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`
    );
    if (
      parsed.hostname === 't.me' ||
      parsed.hostname === 'www.t.me' ||
      parsed.hostname === 'telegram.me'
    ) {
      const seg = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || '';
      const isPrivateInvite = Boolean(seg && (seg.startsWith('+') || seg.toLowerCase() === 'joinchat'));
      const username = !isPrivateInvite ? seg.replace(/[^a-zA-Z0-9_]/g, '') : '';
      return {
        chatId: username ? `@${username}` : '',
        username,
        url: `https://t.me${parsed.pathname}`,
        isPrivateInvite,
      };
    }
  } catch {
    // Ignore invalid URL
  }
  return { chatId: '', username: '', url: '', isPrivateInvite: false };
}

export function resolveTelegramChannelConfig(db: SiteDatabase): {
  chatId: string;
  channelUrl: string;
  channelLabel: string;
} {
  const socialTgUrl = db.socialLinks.find((s) => s.platform === 'telegram')?.url?.trim() || '';
  const socialParsed = parseTelegramChannelTarget(socialTgUrl);
  const customInput = (db.telegramChannelId || '').trim();
  const envChannel = process.env.TELEGRAM_CHANNEL_ID?.trim() || '';
  const preferredParsed = parseTelegramChannelTarget(customInput || envChannel);

  let channelUrl = 'https://t.me/andriidankiv';
  if (preferredParsed.url) {
    channelUrl = preferredParsed.url;
  } else if (socialParsed.url) {
    channelUrl = socialParsed.url;
  }

  const chatId = preferredParsed.chatId || socialParsed.chatId;
  const fallbackUsername = preferredParsed.username || socialParsed.username;

  const channelLabel = chatId.startsWith('@')
    ? chatId
    : fallbackUsername
      ? `@${fallbackUsername}`
      : 'Telegram-канал';

  return { chatId, channelUrl, channelLabel };
}

async function callTelegramBotApi<T>(
  method: string,
  params?: Record<string, unknown>
): Promise<TelegramApiResult<T>> {
  const token = getTelegramBotToken();
  if (!token) {
    return { ok: false, description: 'TELEGRAM_BOT_TOKEN is not configured' };
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params ?? {}),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await response.json()) as TelegramApiResult<T>;
    return data;
  } catch {
    return { ok: false, description: 'Не вдалося з’єднатися з Telegram Bot API.' };
  }
}

async function getTelegramBotInfo(): Promise<TelegramBotInfo | null> {
  const token = getTelegramBotToken();
  if (!token) return null;
  const tokenDigest = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
  const now = Date.now();
  if (
    cachedTelegramBot &&
    cachedTelegramBot.tokenDigest === tokenDigest &&
    now - cachedTelegramBot.fetchedAtMs < 10 * 60 * 1000
  ) {
    return cachedTelegramBot.info;
  }
  const res = await callTelegramBotApi<{ id: number; username?: string; first_name?: string }>('getMe');
  if (!res.ok || !res.result?.username) {
    return null;
  }
  const info: TelegramBotInfo = {
    id: res.result.id,
    username: res.result.username,
    firstName: res.result.first_name || res.result.username,
  };
  cachedTelegramBot = { info, fetchedAtMs: now, tokenDigest };
  return info;
}

async function getTelegramWebhookStatus(forceRefresh = false): Promise<{
  active: boolean;
  url: string;
  pendingUpdateCount: number;
  lastError?: string;
} | null> {
  const token = getTelegramBotToken();
  if (!token) return null;
  const tokenDigest = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedWebhookInfo &&
    cachedWebhookInfo.tokenDigest === tokenDigest &&
    now - cachedWebhookInfo.fetchedAtMs < 2 * 60 * 1000
  ) {
    return {
      active: cachedWebhookInfo.active,
      url: cachedWebhookInfo.url,
      pendingUpdateCount: cachedWebhookInfo.pendingUpdateCount,
      lastError: cachedWebhookInfo.lastError,
    };
  }
  const wh = await callTelegramBotApi<TelegramWebhookInfoResult>('getWebhookInfo');
  if (!wh.ok || !wh.result) {
    return null;
  }
  const url = typeof wh.result.url === 'string' ? wh.result.url : '';
  cachedWebhookInfo = {
    active: Boolean(url),
    url,
    pendingUpdateCount: Number(wh.result.pending_update_count ?? 0),
    lastError: wh.result.last_error_message || undefined,
    fetchedAtMs: now,
    tokenDigest,
  };
  return {
    active: cachedWebhookInfo.active,
    url: cachedWebhookInfo.url,
    pendingUpdateCount: cachedWebhookInfo.pendingUpdateCount,
    lastError: cachedWebhookInfo.lastError,
  };
}

function isMemberStatusSubscribed(status?: string, isMemberFlag?: boolean): boolean {
  return (
    status === 'creator' ||
    status === 'administrator' ||
    status === 'member' ||
    (status === 'restricted' && isMemberFlag === true)
  );
}

function setMembershipCacheEntry(
  chatKey: string,
  telegramUserId: number,
  entry: { subscribed: boolean; status?: string; error?: string; checkedAtMs: number }
): void {
  if (!chatKey) return;
  if (telegramMembershipCache.size > 2000) {
    telegramMembershipCache.clear();
  }
  telegramMembershipCache.set(`${chatKey.toLowerCase()}:${telegramUserId}`, entry);
}

function doesChatMatchChannel(
  chat: TelegramChatPayload | undefined,
  channel: { chatId: string; channelLabel: string }
): boolean {
  if (!chat) return false;
  const target = channel.chatId.trim().toLowerCase();
  if (!target) return false;
  if (String(chat.id) === target) return true;
  if (chat.username && `@${chat.username.toLowerCase()}` === target) return true;
  return false;
}

async function checkTelegramChannelMembership(
  chatId: string,
  telegramUserId: number,
  options?: { forceFresh?: boolean }
): Promise<TelegramMembershipCheckResult> {
  if (!chatId) {
    return {
      subscribed: false,
      error: 'Не вказано публічний @username або ID Telegram-каналу.',
    };
  }
  const cacheKey = `${chatId.toLowerCase()}:${telegramUserId}`;
  const now = Date.now();
  if (!options?.forceFresh) {
    const cached = telegramMembershipCache.get(cacheKey);
    if (cached && now - cached.checkedAtMs < TELEGRAM_MEMBERSHIP_CACHE_MS) {
      return { subscribed: cached.subscribed, status: cached.status, error: cached.error };
    }
  }

  const res = await callTelegramBotApi<{ status?: string; is_member?: boolean }>('getChatMember', {
    chat_id: chatId,
    user_id: telegramUserId,
  });

  if (!res.ok || !res.result) {
    const desc = (res.description || '').toLowerCase();
    let friendly = 'Не вдалося перевірити підписку через Telegram.';
    if (desc.includes('member list is inaccessible') || desc.includes('administrator')) {
      friendly = 'Бот має бути доданий адміністратором каналу для перевірки підписок.';
    } else if (desc.includes('chat not found')) {
      friendly = 'Telegram-канал не знайдено. Перевірте посилання або TELEGRAM_CHANNEL_ID.';
    } else if (desc.includes('user not found')) {
      friendly = 'Користувача Telegram не знайдено серед учасників каналу.';
    }
    return { subscribed: false, error: friendly };
  }

  const status = res.result.status || 'left';
  const subscribed = isMemberStatusSubscribed(status, res.result.is_member);

  setMembershipCacheEntry(chatId, telegramUserId, {
    subscribed,
    status,
    checkedAtMs: now,
  });
  return { subscribed, status };
}

function purgeExpiredTelegramChallenges(): void {
  const now = Date.now();
  for (const [code, rec] of telegramChallenges.entries()) {
    if (rec.expiresAtMs <= now) {
      telegramChallenges.delete(code);
    }
  }
}

async function processTelegramMessageUpdate(
  msg: NonNullable<TelegramUpdateItem['message']>,
  db: SiteDatabase
): Promise<void> {
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  const from = msg.from;
  if (!text || !from || from.is_bot || typeof from.id !== 'number') return;
  if (msg.chat?.type && msg.chat.type !== 'private') return;

  let code = '';
  const startMatch = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+(tgv_[a-f0-9]+)$/i);
  if (startMatch) {
    code = startMatch[1];
  } else if (/^tgv_[a-f0-9]+$/i.test(text)) {
    code = text;
  }
  if (!code) return;

  const challenge = telegramChallenges.get(code);
  if (!challenge || challenge.expiresAtMs <= Date.now()) {
    await callTelegramBotApi('sendMessage', {
      chat_id: from.id,
      text: 'Термін дії коду перевірки минув. Будь ласка, оновіть код на сайті й спробуйте ще раз.',
    });
    return;
  }

  const channel = resolveTelegramChannelConfig(db);
  const membership = await checkTelegramChannelMembership(channel.chatId, from.id, {
    forceFresh: true,
  });

  challenge.resolved = {
    telegramUserId: from.id,
    username: from.username,
    firstName: from.first_name,
    subscribed: membership.subscribed,
    checkedAtMs: Date.now(),
    lastError: membership.error,
  };

  if (membership.subscribed) {
    await callTelegramBotApi('sendMessage', {
      chat_id: from.id,
      text: `✅ Підписку на канал ${channel.channelLabel} підтверджено! Поверніться на сайт — ваша знижка −${db.proseTelegramDiscountPercent ?? 50}% у розділі «Проза» активована.`,
    });
  } else if (membership.error) {
    await callTelegramBotApi('sendMessage', {
      chat_id: from.id,
      text: membership.error,
    });
  } else {
    await callTelegramBotApi('sendMessage', {
      chat_id: from.id,
      text: `Щоб отримати знижку −${db.proseTelegramDiscountPercent ?? 50}% у розділі «Проза», спершу підпишіться на канал ${channel.channelUrl}, а потім натисніть «Перевірити підписку» на сайті.`,
    });
  }
}

function processTelegramChatMemberUpdate(
  event: TelegramChatMemberUpdated,
  db: SiteDatabase
): void {
  const channel = resolveTelegramChannelConfig(db);
  if (!doesChatMatchChannel(event.chat, channel)) return;
  const member = event.new_chat_member;
  const user = member?.user;
  if (!user || user.is_bot || typeof user.id !== 'number') return;

  const status = member.status || 'left';
  const subscribed = isMemberStatusSubscribed(status, member.is_member);
  const now = Date.now();

  setMembershipCacheEntry(channel.chatId, user.id, {
    subscribed,
    status,
    checkedAtMs: now,
  });
  setMembershipCacheEntry(String(event.chat.id), user.id, {
    subscribed,
    status,
    checkedAtMs: now,
  });
  if (event.chat.username) {
    setMembershipCacheEntry(`@${event.chat.username}`, user.id, {
      subscribed,
      status,
      checkedAtMs: now,
    });
  }

  for (const challenge of telegramChallenges.values()) {
    if (challenge.resolved?.telegramUserId === user.id) {
      challenge.resolved.subscribed = subscribed;
      challenge.resolved.checkedAtMs = now;
      challenge.resolved.lastError = undefined;
    }
  }
}

export async function processTelegramUpdate(
  update: TelegramUpdateItem,
  db: SiteDatabase
): Promise<void> {
  if (update.message) {
    await processTelegramMessageUpdate(update.message, db);
  }
  if (update.chat_member) {
    processTelegramChatMemberUpdate(update.chat_member, db);
  }
  if (update.my_chat_member) {
    const channel = resolveTelegramChannelConfig(db);
    if (doesChatMatchChannel(update.my_chat_member.chat, channel)) {
      cachedTelegramBot = null;
      telegramMembershipCache.clear();
    }
  }
}

async function pollTelegramUpdatesOnce(db: SiteDatabase): Promise<void> {
  if (activeTelegramPollPromise) {
    return activeTelegramPollPromise;
  }
  const run = (async () => {
    const token = getTelegramBotToken();
    if (!token) return;
    const whStatus = await getTelegramWebhookStatus(false);
    if (whStatus?.active) {
      return;
    }

    const res = await callTelegramBotApi<TelegramUpdateItem[]>('getUpdates', {
      offset: telegramUpdateOffset,
      limit: 50,
      timeout: 0,
      allowed_updates: ['message', 'chat_member', 'my_chat_member'],
    });
    if (!res.ok || !Array.isArray(res.result)) return;

    for (const update of res.result) {
      if (typeof update.update_id === 'number' && update.update_id >= telegramUpdateOffset) {
        telegramUpdateOffset = update.update_id + 1;
      }
      await processTelegramUpdate(update, db);
    }
  })().finally(() => {
    activeTelegramPollPromise = null;
  });

  activeTelegramPollPromise = run;
  return run;
}

function issueTelegramDiscountToken(data: {
  tgId: number;
  username?: string;
  firstName?: string;
  chatId: string;
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: TelegramDiscountTokenPayload = {
    tgId: data.tgId,
    ...(data.username ? { username: data.username } : {}),
    ...(data.firstName ? { firstName: data.firstName } : {}),
    chatId: data.chatId,
    iat: nowSec,
    exp: nowSec + 14 * 24 * 60 * 60,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getTelegramDiscountSecret())
    .update(`tgsub_v1.${payloadB64}`, 'utf8')
    .digest('base64url');
  return `tgsub_v1.${payloadB64}.${sig}`;
}

function verifyTelegramDiscountToken(
  token: string,
  decodeBase64UrlJson: <T>(segment: string) => T | null
): TelegramDiscountTokenPayload | null {
  if (!token || !token.startsWith('tgsub_v1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  try {
    const expectedSig = crypto
      .createHmac('sha256', getTelegramDiscountSecret())
      .update(`tgsub_v1.${payloadB64}`, 'utf8')
      .digest('base64url');
    const sigBuf = Buffer.from(sigB64, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = decodeBase64UrlJson<TelegramDiscountTokenPayload>(payloadB64);
    if (
      !payload ||
      typeof payload.tgId !== 'number' ||
      typeof payload.chatId !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
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

export async function verifyTelegramSubscriberForRequest(
  req: Request,
  db: SiteDatabase,
  options?: {
    forceFresh?: boolean;
    decodeBase64UrlJson?: <T>(segment: string) => T | null;
  }
): Promise<{
  subscribed: boolean;
  tgId?: number;
  username?: string;
  firstName?: string;
  channelUrl: string;
  channelLabel: string;
  tokenValid: boolean;
  error?: string;
}> {
  const channel = resolveTelegramChannelConfig(db);
  const rawHeader = req.headers['x-telegram-discount-token'];
  const rawBodyToken =
    req.body &&
    typeof (req.body as { telegramDiscountToken?: unknown }).telegramDiscountToken === 'string'
      ? (req.body as { telegramDiscountToken: string }).telegramDiscountToken
      : '';
  const token =
    typeof rawHeader === 'string' && rawHeader.trim() ? rawHeader.trim() : rawBodyToken.trim();

  if (!token) {
    return {
      subscribed: false,
      channelUrl: channel.channelUrl,
      channelLabel: channel.channelLabel,
      tokenValid: false,
    };
  }

  const decoder =
    options?.decodeBase64UrlJson ??
    (<T>(segment: string): T | null => {
      try {
        return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
      } catch {
        return null;
      }
    });

  const payload = verifyTelegramDiscountToken(token, decoder);
  if (!payload || payload.chatId !== channel.chatId || !getTelegramBotToken()) {
    return {
      subscribed: false,
      channelUrl: channel.channelUrl,
      channelLabel: channel.channelLabel,
      tokenValid: false,
    };
  }

  const membership = await checkTelegramChannelMembership(channel.chatId, payload.tgId, {
    forceFresh: options?.forceFresh,
  });

  return {
    subscribed: membership.subscribed,
    tgId: payload.tgId,
    username: payload.username,
    firstName: payload.firstName,
    channelUrl: channel.channelUrl,
    channelLabel: channel.channelLabel,
    tokenValid: true,
    error: membership.error,
  };
}

function resolvePublicAppBaseUrl(req: Request): string | null {
  const envAppUrl = process.env.APP_URL?.trim();
  if (envAppUrl) {
    try {
      const parsed = new URL(envAppUrl);
      if (parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Fall through to forwarded host check
    }
  }
  const forwardedProto = (req.get('x-forwarded-proto') || req.protocol || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const forwardedHost = (req.get('x-forwarded-host') || req.get('host') || '')
    .split(',')[0]
    .trim();
  if (forwardedProto === 'https' && forwardedHost && !forwardedHost.includes('localhost')) {
    return `https://${forwardedHost}`;
  }
  return null;
}

export function registerTelegramBotRoutes(app: Express, deps: TelegramBotRouteDeps): void {
  const {
    ensureDatabase,
    saveDatabase,
    dataDir,
    extractBearerToken,
    onSyncTelegramBotTokenToCloud,
    verifySameOrigin,
    checkRateLimit,
    getClientIpHash,
    decodeBase64UrlJson,
  } = deps;
  if (dataDir) {
    configuredDataDir = dataDir;
    storedAdminTelegramBotToken = null;
  }

  app.get('/api/telegram/status', async (req, res) => {
    const db = ensureDatabase();
    const channel = resolveTelegramChannelConfig(db);
    const bot = await getTelegramBotInfo();
    const verified = await verifyTelegramSubscriberForRequest(req, db, {
      forceFresh: req.query.fresh === '1',
      decodeBase64UrlJson,
    });

    const subscription: TelegramSubscriptionState = verified.subscribed
      ? {
          subscribed: true,
          channelLabel: channel.channelLabel,
          channelUrl: channel.channelUrl,
          telegramUser: verified.tgId
            ? {
                id: verified.tgId,
                username: verified.username,
                firstName: verified.firstName,
              }
            : undefined,
          checkedAt: new Date().toISOString(),
        }
      : {
          subscribed: false,
          channelLabel: channel.channelLabel,
          channelUrl: channel.channelUrl,
        };

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({
      configured: Boolean(bot && channel.chatId),
      botUsername: bot?.username || null,
      channelUrl: channel.channelUrl,
      channelLabel: channel.channelLabel,
      discountPercent: db.proseTelegramDiscountPercent ?? 50,
      subscription,
      ...(verified.tokenValid && !verified.subscribed
        ? {
            unsubscribedNotice:
              verified.error || 'Підписку на Telegram-канал не підтверджено.',
          }
        : {}),
    });
  });

  app.post('/api/telegram/challenge', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`tg-challenge:${ipHash}`, 20, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато запитів перевірки. Спробуйте за хвилину.' });
      return;
    }

    const db = ensureDatabase();
    purgeExpiredTelegramChallenges();
    const channel = resolveTelegramChannelConfig(db);
    const bot = await getTelegramBotInfo();

    if (!bot || !channel.chatId) {
      res.status(503).json({
        configured: false,
        channelUrl: channel.channelUrl,
        channelLabel: channel.channelLabel,
        error:
          'Перевірка підписки через Telegram-бота ще не підключена (автор має налаштувати бота в кабінеті).',
      });
      return;
    }

    const code = `tgv_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();
    const expiresAtMs = now + 15 * 60 * 1000;
    telegramChallenges.set(code, {
      code,
      ipHash,
      createdAtMs: now,
      expiresAtMs,
    });

    res.json({
      configured: true,
      code,
      botUsername: bot.username,
      deepLinkUrl: `https://t.me/${bot.username}?start=${code}`,
      channelUrl: channel.channelUrl,
      channelLabel: channel.channelLabel,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  });

  app.post('/api/telegram/verify', async (req, res) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`tg-verify:${ipHash}`, 45, 2 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Занадто часті перевірки. Зачекайте кілька секунд.' });
      return;
    }

    const db = ensureDatabase();
    purgeExpiredTelegramChallenges();
    const { code } = req.body as { code?: string };
    const cleanCode = typeof code === 'string' ? code.trim() : '';
    if (!/^tgv_[a-f0-9]{16}$/i.test(cleanCode)) {
      res.status(400).json({ ok: false, status: 'invalid', error: 'Некоректний код перевірки.' });
      return;
    }

    const challenge = telegramChallenges.get(cleanCode);
    if (!challenge || challenge.expiresAtMs <= Date.now()) {
      telegramChallenges.delete(cleanCode);
      res.status(410).json({
        ok: false,
        status: 'expired',
        error: 'Термін дії коду минув. Згенеруйте нове посилання.',
      });
      return;
    }

    await pollTelegramUpdatesOnce(db);

    const channel = resolveTelegramChannelConfig(db);
    if (!challenge.resolved) {
      res.json({
        ok: true,
        status: 'pending',
        channelUrl: channel.channelUrl,
        channelLabel: channel.channelLabel,
      });
      return;
    }

    const freshCheck = await checkTelegramChannelMembership(
      channel.chatId,
      challenge.resolved.telegramUserId,
      { forceFresh: true }
    );
    challenge.resolved.subscribed = freshCheck.subscribed;
    challenge.resolved.checkedAtMs = Date.now();
    challenge.resolved.lastError = freshCheck.error;

    if (!freshCheck.subscribed) {
      res.json({
        ok: true,
        status: 'not_subscribed',
        channelUrl: channel.channelUrl,
        channelLabel: channel.channelLabel,
        error:
          freshCheck.error ||
          `Ви ще не підписалися на ${channel.channelLabel}. Підпишіться та натисніть «Перевірити підписку» ще раз.`,
      });
      return;
    }

    const discountToken = issueTelegramDiscountToken({
      tgId: challenge.resolved.telegramUserId,
      username: challenge.resolved.username,
      firstName: challenge.resolved.firstName,
      chatId: channel.chatId,
    });

    telegramChallenges.delete(cleanCode);

    const subscription: TelegramSubscriptionState = {
      subscribed: true,
      token: discountToken,
      channelLabel: channel.channelLabel,
      channelUrl: channel.channelUrl,
      telegramUser: {
        id: challenge.resolved.telegramUserId,
        username: challenge.resolved.username,
        firstName: challenge.resolved.firstName,
      },
      checkedAt: new Date().toISOString(),
    };

    res.json({
      ok: true,
      status: 'verified',
      subscription,
    });
  });

  /**
   * Webhook endpoint for receiving real-time notifications from Telegram Bot API
   * (`message`, `chat_member`, `my_chat_member`).
   */
  app.post('/api/telegram/webhook', async (req, res) => {
    const expectedSecret = getWebhookSecretForVerification();
    if (expectedSecret) {
      const provided = req.headers['x-telegram-bot-api-secret-token'];
      if (typeof provided !== 'string' || !timingSafeSecretEquals(provided, expectedSecret)) {
        res.status(401).json({ ok: false });
        return;
      }
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || typeof (body as { update_id?: unknown }).update_id !== 'number') {
      res.status(400).json({ ok: false, error: 'Некоректний формат нотифікації Telegram.' });
      return;
    }

    const db = ensureDatabase();
    await processTelegramUpdate(body as TelegramUpdateItem, db);
    res.json({ ok: true });
  });

  async function buildTelegramHealthPayload(db: SiteDatabase) {
    const channel = resolveTelegramChannelConfig(db);
    const tokenInfo = getTelegramBotTokenInfo();
    const bot = await getTelegramBotInfo();
    const socialTelegramUrl =
      db.socialLinks.find((s) => s.platform === 'telegram')?.url?.trim() || '';
    const baseFields = {
      tokenSource: tokenInfo.source,
      hasStoredToken: tokenInfo.hasStoredToken,
      maskedToken: maskTelegramBotToken(tokenInfo.token),
      channelInput: (db.telegramChannelId || '').trim(),
      socialTelegramUrl,
      proseTelegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
    };

    if (!tokenInfo.token) {
      return {
        ...baseFields,
        botConfigured: false,
        botUsername: null,
        botFirstName: null,
        channelChatId: channel.chatId,
        channelUrl: channel.channelUrl,
        channelLabel: channel.channelLabel,
        channelTitle: null,
        channelAccessible: false,
        webhookActive: false,
        webhookUrl: null,
        webhookPendingCount: 0,
        webhookError: null,
        error: 'Токен Telegram-бота ще не задано. Вставте токен від @BotFather нижче та збережіть.',
      };
    }

    if (!bot) {
      return {
        ...baseFields,
        botConfigured: false,
        botUsername: null,
        botFirstName: null,
        channelChatId: channel.chatId,
        channelUrl: channel.channelUrl,
        channelLabel: channel.channelLabel,
        channelTitle: null,
        channelAccessible: false,
        webhookActive: false,
        webhookUrl: null,
        webhookPendingCount: 0,
        webhookError: null,
        error: 'Не вдалося авторизувати Telegram-бота за поточним токеном. Перевірте токен від @BotFather.',
      };
    }

    if (!channel.chatId) {
      return {
        ...baseFields,
        botConfigured: true,
        botUsername: bot.username,
        botFirstName: bot.firstName,
        channelChatId: '',
        channelUrl: channel.channelUrl,
        channelLabel: channel.channelLabel,
        channelTitle: null,
        channelAccessible: false,
        webhookActive: false,
        webhookUrl: null,
        webhookPendingCount: 0,
        webhookError: null,
        error: 'Вкажіть публічне посилання Telegram (t.me/username), @username або числовий ID каналу (-100...).',
      };
    }

    const [chatCheck, botMember, whStatus] = await Promise.all([
      callTelegramBotApi<{ id: number; title?: string; username?: string }>('getChat', {
        chat_id: channel.chatId,
      }),
      callTelegramBotApi<{ status?: string }>('getChatMember', {
        chat_id: channel.chatId,
        user_id: bot.id,
      }),
      getTelegramWebhookStatus(true),
    ]);

    const isAdminInChannel =
      botMember.ok &&
      (botMember.result?.status === 'administrator' || botMember.result?.status === 'creator');

    return {
      ...baseFields,
      botConfigured: true,
      botUsername: bot.username,
      botFirstName: bot.firstName,
      channelChatId: channel.chatId,
      channelUrl: channel.channelUrl,
      channelLabel: channel.channelLabel,
      channelTitle: chatCheck.result?.title || channel.channelLabel,
      channelAccessible: Boolean(chatCheck.ok && isAdminInChannel),
      webhookActive: Boolean(whStatus?.active),
      webhookUrl: whStatus?.url || null,
      webhookPendingCount: whStatus?.pendingUpdateCount ?? 0,
      webhookError: whStatus?.lastError || null,
      error: !chatCheck.ok
        ? 'Канал не знайдено або бот не має доступу.'
        : !isAdminInChannel
          ? `Додайте @${bot.username} адміністратором каналу ${channel.channelLabel}, щоб перевіряти підписників.`
          : null,
    };
  }

  app.get('/api/author/telegram-health', async (_req, res) => {
    const db = ensureDatabase();
    const health = await buildTelegramHealthPayload(db);
    res.json(health);
  });

  app.put('/api/author/telegram-settings', async (req, res) => {
    const db = ensureDatabase();
    const {
      botToken,
      clearBotToken,
      channelId,
      proseTelegramDiscountPercent,
    } = (req.body || {}) as {
      botToken?: unknown;
      clearBotToken?: unknown;
      channelId?: unknown;
      proseTelegramDiscountPercent?: unknown;
    };

    const adminBearerToken = extractBearerToken ? extractBearerToken(req) || '' : '';

    if (clearBotToken === true) {
      writeAdminTelegramBotTokenToDisk('');
      resetTelegramBotCaches();
      if (adminBearerToken && onSyncTelegramBotTokenToCloud) {
        void onSyncTelegramBotTokenToCloud('', adminBearerToken).catch(() => {});
      }
    } else if (typeof botToken === 'string' && botToken.trim().length > 0) {
      const cleanToken = botToken.trim();
      if (
        cleanToken.length > 200 ||
        !/^\d{5,16}:[A-Za-z0-9_-]{25,100}$/.test(cleanToken)
      ) {
        res.status(400).json({
          error: 'Некоректний формат токена. Токен від @BotFather має вигляд 1234567890:AAF...',
        });
        return;
      }

      try {
        const verifyRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(8000),
        });
        const verifyData = (await verifyRes.json()) as TelegramApiResult<{
          id: number;
          username?: string;
          first_name?: string;
        }>;
        if (!verifyData.ok || !verifyData.result?.username) {
          res.status(400).json({
            error:
              'Telegram відхилив цей токен. Перевірте токен у @BotFather і спробуйте ще раз.',
          });
          return;
        }
      } catch {
        res.status(502).json({
          error: 'Не вдалося перевірити токен через Telegram Bot API. Спробуйте ще раз.',
        });
        return;
      }

      writeAdminTelegramBotTokenToDisk(cleanToken);
      resetTelegramBotCaches();
      if (adminBearerToken && onSyncTelegramBotTokenToCloud) {
        void onSyncTelegramBotTokenToCloud(cleanToken, adminBearerToken).catch(() => {});
      }
    }

    let dbChanged = false;

    if (channelId !== undefined) {
      if (typeof channelId !== 'string' || channelId.trim().length > 200) {
        res.status(400).json({ error: 'Некоректне посилання або ID Telegram-каналу.' });
        return;
      }
      const cleanChannel = channelId.trim();
      if (cleanChannel) {
        const parsedChannel = parseTelegramChannelTarget(cleanChannel);
        if (parsedChannel.isPrivateInvite) {
          res.status(400).json({
            error:
              'Для приватного каналу вкажіть числовий ID (-100...) або публічний @username каналу (запрошувальні посилання +... Telegram Bot API не приймає).',
          });
          return;
        }
        if (!parsedChannel.chatId) {
          res.status(400).json({
            error:
              'Вкажіть публічний @username, посилання https://t.me/channel або числовий ID каналу (-100...).',
          });
          return;
        }
      }
      db.telegramChannelId = cleanChannel;
      telegramMembershipCache.clear();
      dbChanged = true;
    }

    if (proseTelegramDiscountPercent !== undefined) {
      const parsedDiscount = Number(proseTelegramDiscountPercent);
      if (!Number.isFinite(parsedDiscount)) {
        res.status(400).json({
          error: 'Вкажіть коректний відсоток знижки для підписників Telegram (0–90%).',
        });
        return;
      }
      db.proseTelegramDiscountPercent = Math.max(0, Math.min(90, Math.round(parsedDiscount)));
      dbChanged = true;
    }

    if (dbChanged && saveDatabase) {
      saveDatabase(db, { slices: ['meta'] });
    }

    const health = await buildTelegramHealthPayload(db);
    res.json({
      ok: true,
      ...health,
    });
  });

  app.post('/api/author/telegram-webhook', async (req, res) => {
    if (!getTelegramBotToken()) {
      res.status(400).json({ error: 'Спочатку вставте та збережіть токен Telegram-бота.' });
      return;
    }

    const { enabled } = (req.body || {}) as { enabled?: boolean };
    if (enabled === false) {
      const del = await callTelegramBotApi<boolean>('deleteWebhook', {
        drop_pending_updates: false,
      });
      cachedWebhookInfo = null;
      registeredWebhookSecret = '';
      if (!del.ok) {
        res.status(502).json({ error: del.description || 'Не вдалося вимкнути webhook.' });
        return;
      }
      res.json({ ok: true, webhookActive: false, webhookUrl: null });
      return;
    }

    const baseUrl = resolvePublicAppBaseUrl(req);
    if (!baseUrl) {
      res.status(400).json({
        error:
          'Для реєстрації Telegram Webhook потрібен публічний HTTPS-адреса сайту (APP_URL). Без нього перевірка працює через опитування Telegram API.',
      });
      return;
    }

    const webhookUrl = `${baseUrl}/api/telegram/webhook`;
    const secretToken = getOrDeriveWebhookSecretForRegistration();

    const setRes = await callTelegramBotApi<boolean>('setWebhook', {
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ['message', 'chat_member', 'my_chat_member'],
    });
    cachedWebhookInfo = null;

    if (!setRes.ok) {
      res.status(502).json({
        error: setRes.description || 'Telegram Bot API відхилив налаштування webhook.',
      });
      return;
    }

    const whStatus = await getTelegramWebhookStatus(true);
    res.json({
      ok: true,
      webhookActive: Boolean(whStatus?.active ?? true),
      webhookUrl: whStatus?.url || webhookUrl,
    });
  });
}
