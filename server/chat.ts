import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { type GuestAccountRecord, type SiteDatabase } from './seedData.ts';
import {
  CHAT_REACTION_EMOJIS,
  type ChatAttachmentType,
  type ChatMessageAttachment,
  type ChatMetaState,
  type ChatMutedUserEntry,
  type ChatReportRecord,
  type GlobalChatMessage,
} from '../src/types.ts';
import {
  cloudSyncState,
  deleteChatMessageInFirestore,
  syncChatMessageToFirestore,
  syncPublicUserProfileToFirestore,
} from './firestoreStubs.ts';
import {
  checkRateLimit,
  ensureDatabase,
  getClientIpHash,
  getTrustedWsIp,
  saveDatabase,
  verifySameOrigin,
} from './db.ts';
import {
  authenticateAdminRequest,
  authenticateGuestRequest,
  authenticateGuestTokenFast,
  ensureAllPublicStateHydrated,
  extractBearerToken,
  extractCookieGuestSessionToken,
  isAdminEmailAddress,
  sanitizeGuestUser,
} from './auth.ts';
import {
  createAccountPhotoLookup,
  createBadgeLookup,
  createDonorTextLookup,
  enrichChatMessageWithBadges,
} from './catalog.ts';

export const CHAT_EDIT_WINDOW_MS = 5 * 60 * 1000;
export const MAX_STORED_CHAT_MESSAGES = 1000;
export const DEFAULT_CHAT_PAGE_LIMIT = 100;
const VALID_ATTACHMENT_TYPES = new Set<ChatAttachmentType>(['poem', 'prose', 'radio']);
const VALID_REACTION_SET = new Set<string>(CHAT_REACTION_EMOJIS);

interface ChatClientMeta {
  uid?: string;
  firebaseUid?: string;
  displayName?: string;
  firebaseIdToken?: string;
  isAdmin?: boolean;
  ipHash: string;
  isAlive: boolean;
  lastTypingSentAtMs?: number;
}

const chatClients = new Map<WebSocket, ChatClientMeta>();
const lastChatSentAtByUid = new Map<string, number>();

function broadcastChatEvent(payload: unknown): void {
  const encoded = JSON.stringify(payload);
  for (const [client] of chatClients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(encoded);
    }
  }
}

function broadcastChatEventExcept(sender: WebSocket, payload: unknown): void {
  const encoded = JSON.stringify(payload);
  for (const [client] of chatClients.entries()) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(encoded);
    }
  }
}

function broadcastToAdmins(payload: unknown): void {
  const encoded = JSON.stringify(payload);
  for (const [client, clientMeta] of chatClients.entries()) {
    if (clientMeta.isAdmin && client.readyState === WebSocket.OPEN) {
      client.send(encoded);
    }
  }
}

function broadcastToUserSockets(targetUid: string, payload: unknown): void {
  const encoded = JSON.stringify(payload);
  for (const [client, clientMeta] of chatClients.entries()) {
    if (
      client.readyState === WebSocket.OPEN &&
      (clientMeta.uid === targetUid || clientMeta.firebaseUid === targetUid)
    ) {
      client.send(encoded);
    }
  }
}

export function ensureChatMeta(db: SiteDatabase): ChatMetaState {
  if (!db.chatMeta || typeof db.chatMeta !== 'object') {
    db.chatMeta = {
      pinnedMessage: null,
      slowModeSeconds: 0,
      mutedUsers: {},
    };
  }
  if (!db.chatMeta.mutedUsers || typeof db.chatMeta.mutedUsers !== 'object') {
    db.chatMeta.mutedUsers = {};
  }
  if (typeof db.chatMeta.slowModeSeconds !== 'number' || !Number.isFinite(db.chatMeta.slowModeSeconds)) {
    db.chatMeta.slowModeSeconds = 0;
  }
  return db.chatMeta;
}

export function getPublicChatMeta(db: SiteDatabase): {
  pinnedMessage: ChatMetaState['pinnedMessage'];
  slowModeSeconds: number;
} {
  const meta = ensureChatMeta(db);
  return {
    pinnedMessage: meta.pinnedMessage ?? null,
    slowModeSeconds: Math.max(0, Math.min(300, Math.round(Number(meta.slowModeSeconds) || 0))),
  };
}

export function getActiveMuteForAccount(
  db: SiteDatabase,
  account: Pick<GuestAccountRecord, 'uid' | 'googleUid'>
): ChatMutedUserEntry | null {
  const meta = ensureChatMeta(db);
  const mutedUsers = meta.mutedUsers || {};
  const candidateKeys = [account.uid, account.googleUid].filter((v): v is string => Boolean(v));
  const nowMs = Date.now();
  let mutated = false;
  let activeEntry: ChatMutedUserEntry | null = null;

  for (const key of candidateKeys) {
    const entry = mutedUsers[key];
    if (!entry) continue;
    if (entry.mutedUntil) {
      const untilMs = Date.parse(entry.mutedUntil);
      if (Number.isFinite(untilMs) && untilMs <= nowMs) {
        delete mutedUsers[key];
        mutated = true;
        continue;
      }
    }
    activeEntry = entry;
  }

  if (mutated) {
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
  }
  return activeEntry;
}

function getAllActiveMutedUsers(db: SiteDatabase): Record<string, ChatMutedUserEntry> {
  const meta = ensureChatMeta(db);
  const mutedUsers = meta.mutedUsers || {};
  const nowMs = Date.now();
  let mutated = false;
  const active: Record<string, ChatMutedUserEntry> = {};
  for (const [uid, entry] of Object.entries(mutedUsers)) {
    if (!entry) continue;
    if (entry.mutedUntil) {
      const untilMs = Date.parse(entry.mutedUntil);
      if (Number.isFinite(untilMs) && untilMs <= nowMs) {
        delete mutedUsers[uid];
        mutated = true;
        continue;
      }
    }
    active[uid] = entry;
  }
  if (mutated) {
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
  }
  return active;
}

function getUnresolvedReportsCount(db: SiteDatabase): number {
  if (!Array.isArray(db.chatReports)) return 0;
  return db.chatReports.filter((r) => !r.resolved).length;
}

function formatMuteMessage(entry: ChatMutedUserEntry): string {
  if (!entry.mutedUntil) {
    return 'Вам обмежено можливість писати в чат.';
  }
  const untilMs = Date.parse(entry.mutedUntil);
  if (!Number.isFinite(untilMs)) {
    return 'Вам тимчасово обмежено можливість писати в чат.';
  }
  const diffMin = Math.max(1, Math.ceil((untilMs - Date.now()) / 60000));
  if (diffMin >= 60) {
    const hrs = Math.ceil(diffMin / 60);
    return `Вам тимчасово обмежено чат (залишилось ~${hrs} год).`;
  }
  return `Вам тимчасово обмежено чат (залишилось ~${diffMin} хв).`;
}

export function checkSlowModeForAccount(
  db: SiteDatabase,
  account: Pick<GuestAccountRecord, 'uid' | 'googleUid'>,
  isAdmin: boolean
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  if (isAdmin) return { allowed: true };
  const { slowModeSeconds } = getPublicChatMeta(db);
  if (slowModeSeconds <= 0) return { allowed: true };

  const nowMs = Date.now();
  const keys = [account.uid, account.googleUid].filter((v): v is string => Boolean(v));
  let latestSentMs = 0;
  for (const k of keys) {
    const cached = lastChatSentAtByUid.get(k);
    if (cached && cached > latestSentMs) {
      latestSentMs = cached;
    }
  }
  if (latestSentMs === 0 && Array.isArray(db.chatMessages)) {
    for (let i = db.chatMessages.length - 1; i >= 0; i -= 1) {
      const m = db.chatMessages[i];
      if (keys.includes(m.authorUid)) {
        const parsed = Date.parse(m.createdAt);
        if (Number.isFinite(parsed)) {
          latestSentMs = parsed;
        }
        break;
      }
    }
  }

  const diffMs = nowMs - latestSentMs;
  const requiredMs = slowModeSeconds * 1000;
  if (latestSentMs > 0 && diffMs < requiredMs) {
    const retryAfterSec = Math.max(1, Math.ceil((requiredMs - diffMs) / 1000));
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true };
}

export function resolveChatAttachment(
  db: SiteDatabase,
  rawAttachment: unknown
): ChatMessageAttachment | undefined {
  if (!rawAttachment || typeof rawAttachment !== 'object' || Array.isArray(rawAttachment)) {
    return undefined;
  }
  const candidate = rawAttachment as Record<string, unknown>;
  const type = typeof candidate.type === 'string' ? (candidate.type.trim() as ChatAttachmentType) : null;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  if (!type || !VALID_ATTACHMENT_TYPES.has(type) || !id || id.length > 128) {
    return undefined;
  }

  if (type === 'poem') {
    const poem = (db.poems || []).find((p) => p.id === id);
    if (!poem) return undefined;
    return {
      type: 'poem',
      id: poem.id,
      title: poem.title.slice(0, 160),
      subtitle: (poem.cycle || (poem.year ? String(poem.year) : 'Поезія')).slice(0, 100),
    };
  }

  if (type === 'prose') {
    const work = (db.prose || []).find((p) => p.id === id);
    if (!work) return undefined;
    return {
      type: 'prose',
      id: work.id,
      title: work.title.slice(0, 160),
      subtitle: (work.genre || 'Проза').slice(0, 100),
    };
  }

  const track = (db.radioTracks || []).find((t) => t.id === id);
  if (track) {
    return {
      type: 'radio',
      id: track.id,
      title: track.title.slice(0, 160),
      subtitle: (track.artist || 'Радіо').slice(0, 100),
    };
  }
  // Allow client-supplied title/subtitle for Firestore-only synced radio tracks
  if (typeof candidate.title === 'string' && candidate.title.trim()) {
    return {
      type: 'radio',
      id,
      title: candidate.title.trim().slice(0, 160),
      ...(typeof candidate.subtitle === 'string' && candidate.subtitle.trim()
        ? { subtitle: candidate.subtitle.trim().slice(0, 100) }
        : { subtitle: 'Радіо' }),
    };
  }
  return undefined;
}

export function getChatMessagesPage(
  db: SiteDatabase,
  options?: {
    before?: string;
    limit?: number;
    badgeLookup?: ReturnType<typeof createBadgeLookup>;
    photoLookup?: ReturnType<typeof createAccountPhotoLookup>;
    donorTextLookup?: ReturnType<typeof createDonorTextLookup>;
  }
): {
  messages: GlobalChatMessage[];
  hasMore: boolean;
  totalCount: number;
} {
  const rawList = Array.isArray(db.chatMessages) ? db.chatMessages : [];
  const sorted = [...rawList].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  const requestedLimit = Number(options?.limit);
  const clampedLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(200, Math.floor(requestedLimit)))
    : DEFAULT_CHAT_PAGE_LIMIT;

  const cleanBefore = typeof options?.before === 'string' ? options.before.trim() : '';
  let windowSource = sorted;
  if (cleanBefore) {
    const byIdIndex = sorted.findIndex((m) => m.id === cleanBefore);
    if (byIdIndex >= 0) {
      windowSource = sorted.slice(0, byIdIndex);
    } else {
      const beforeMs = Date.parse(cleanBefore);
      if (Number.isFinite(beforeMs)) {
        windowSource = sorted.filter((m) => (Date.parse(m.createdAt) || 0) < beforeMs);
      }
    }
  }

  const pageRaw = windowSource.slice(-clampedLimit);
  const hasMore = windowSource.length > pageRaw.length;
  const badgeLookup = options?.badgeLookup ?? createBadgeLookup(db);
  const photoLookup = options?.photoLookup ?? createAccountPhotoLookup(db);
  const donorTextLookup = options?.donorTextLookup ?? createDonorTextLookup(db);

  return {
    messages: pageRaw.map((msg) =>
      enrichChatMessageWithBadges(msg, badgeLookup, photoLookup, donorTextLookup)
    ),
    hasMore,
    totalCount: sorted.length,
  };
}

export function broadcastGlobalChatRefresh(db: SiteDatabase): void {
  const page = getChatMessagesPage(db, { limit: DEFAULT_CHAT_PAGE_LIMIT });
  broadcastChatEvent({
    type: 'chat:refresh',
    messages: page.messages,
    hasMore: page.hasMore,
    totalCount: page.totalCount,
    chatMeta: getPublicChatMeta(db),
  });
}

export function appendChatMessage(
  db: SiteDatabase,
  account: GuestAccountRecord,
  rawText: string,
  replyToId?: string,
  options?: {
    id?: string;
    clientMessageId?: string;
    attachment?: unknown;
    firebaseUid?: string;
    firebaseIdToken?: string;
    skipFirestoreSync?: boolean;
  }
): { ok: true; message: GlobalChatMessage } | { ok: false; status: number; error: string; retryAfterSec?: number } {
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

  const isAuthorAdmin = isAdminEmailAddress(account.email);
  if (!isAuthorAdmin) {
    const muteEntry = getActiveMuteForAccount(db, account);
    if (muteEntry) {
      return { ok: false, status: 403, error: formatMuteMessage(muteEntry) };
    }
  }

  const slowModeCheck = checkSlowModeForAccount(db, account, isAuthorAdmin);
  if (!slowModeCheck.allowed) {
    return {
      ok: false,
      status: 429,
      retryAfterSec: slowModeCheck.retryAfterSec,
      error: `Повільний режим: зачекайте ${slowModeCheck.retryAfterSec} с перед наступним повідомленням.`,
    };
  }

  const cleanReplyId = typeof replyToId === 'string' ? replyToId.trim() : '';
  const replyTarget =
    cleanReplyId && Array.isArray(db.chatMessages)
      ? db.chatMessages.find((m) => m.id === cleanReplyId)
      : undefined;

  const attachment = resolveChatAttachment(db, options?.attachment);
  const fbUid = options?.firebaseUid || account.googleUid;
  const nowIso = new Date().toISOString();
  const record: GlobalChatMessage = {
    id: requestedId || `chat_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    authorUid: fbUid || account.uid,
    authorName: account.displayName || 'Гість',
    ...(account.photoUrl ? { authorPhotoUrl: account.photoUrl } : {}),
    ...(isAuthorAdmin ? { isAdmin: true } : {}),
    text: cleanText,
    ...(attachment ? { attachment } : {}),
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
    createdAt: nowIso,
  };

  if (!Array.isArray(db.chatMessages)) {
    db.chatMessages = [];
  }
  db.chatMessages.push(record);
  if (db.chatMessages.length > MAX_STORED_CHAT_MESSAGES) {
    db.chatMessages = db.chatMessages.slice(-MAX_STORED_CHAT_MESSAGES);
  }
  const nowMs = Date.now();
  lastChatSentAtByUid.set(account.uid, nowMs);
  if (fbUid) lastChatSentAtByUid.set(fbUid, nowMs);

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
}

export function editChatMessage(
  db: SiteDatabase,
  id: string,
  rawText: string,
  actor: {
    uid: string;
    firebaseUid?: string;
    isAdmin: boolean;
  }
): { ok: true; message: GlobalChatMessage } | { ok: false; status: number; error: string } {
  const cleanText = typeof rawText === 'string' ? rawText.trim() : '';
  if (!cleanText) {
    return { ok: false, status: 400, error: 'Текст повідомлення не може бути порожнім.' };
  }
  if (cleanText.length > 600) {
    return { ok: false, status: 400, error: 'Повідомлення не може перевищувати 600 символів.' };
  }
  if (!Array.isArray(db.chatMessages)) {
    return { ok: false, status: 404, error: 'Повідомлення не знайдено.' };
  }
  const target = db.chatMessages.find((m) => m.id === id);
  if (!target) {
    return { ok: false, status: 404, error: 'Повідомлення не знайдено.' };
  }
  const isOwner =
    target.authorUid === actor.uid ||
    (Boolean(actor.firebaseUid) && target.authorUid === actor.firebaseUid);
  if (!isOwner && !actor.isAdmin) {
    return { ok: false, status: 403, error: 'Ви можете редагувати лише власні повідомлення.' };
  }
  if (!actor.isAdmin) {
    const createdMs = Date.parse(target.createdAt);
    if (!Number.isFinite(createdMs) || Date.now() - createdMs > CHAT_EDIT_WINDOW_MS) {
      return {
        ok: false,
        status: 403,
        error: 'Редагувати повідомлення можна лише протягом 5 хвилин після надсилання.',
      };
    }
  }

  target.text = cleanText;
  target.editedAt = new Date().toISOString();

  const meta = ensureChatMeta(db);
  let metaChanged = false;
  if (meta.pinnedMessage && meta.pinnedMessage.id === target.id) {
    meta.pinnedMessage.text = cleanText.slice(0, 240);
    metaChanged = true;
  }

  saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
  const enriched = enrichChatMessageWithBadges(
    target,
    createBadgeLookup(db),
    createAccountPhotoLookup(db),
    createDonorTextLookup(db)
  );
  broadcastChatEvent({ type: 'chat:edited', message: enriched });
  if (metaChanged) {
    broadcastChatEvent({ type: 'chat:meta', chatMeta: getPublicChatMeta(db) });
  }
  return { ok: true, message: enriched };
}

export function toggleChatReaction(
  db: SiteDatabase,
  id: string,
  rawEmoji: string,
  actorUid: string
): { ok: true; id: string; reactions: Record<string, string[]> } | { ok: false; status: number; error: string } {
  const emoji = typeof rawEmoji === 'string' ? rawEmoji.trim() : '';
  if (!VALID_REACTION_SET.has(emoji)) {
    return { ok: false, status: 400, error: 'Непідтримувана реакція.' };
  }
  if (!Array.isArray(db.chatMessages)) {
    return { ok: false, status: 404, error: 'Повідомлення не знайдено.' };
  }
  const target = db.chatMessages.find((m) => m.id === id);
  if (!target) {
    return { ok: false, status: 404, error: 'Повідомлення не знайдено.' };
  }

  const nextReactions: Record<string, string[]> = {};
  if (target.reactions && typeof target.reactions === 'object') {
    for (const [k, list] of Object.entries(target.reactions)) {
      if (VALID_REACTION_SET.has(k) && Array.isArray(list) && list.length > 0) {
        nextReactions[k] = Array.from(new Set(list.filter((u) => typeof u === 'string' && u.trim())));
      }
    }
  }

  const existingUsers = nextReactions[emoji] || [];
  if (existingUsers.includes(actorUid)) {
    const filtered = existingUsers.filter((u) => u !== actorUid);
    if (filtered.length > 0) {
      nextReactions[emoji] = filtered;
    } else {
      delete nextReactions[emoji];
    }
  } else {
    nextReactions[emoji] = [...existingUsers, actorUid].slice(-200);
  }

  if (Object.keys(nextReactions).length > 0) {
    target.reactions = nextReactions;
  } else {
    delete target.reactions;
  }

  saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
  broadcastChatEvent({
    type: 'chat:reacted',
    id: target.id,
    reactions: target.reactions || {},
  });
  return { ok: true, id: target.id, reactions: target.reactions || {} };
}

export function setPinnedChatMessage(
  db: SiteDatabase,
  payload: { messageId?: string; clear?: boolean },
  actor: { displayName: string }
): { ok: true; chatMeta: ReturnType<typeof getPublicChatMeta> } | { ok: false; status: number; error: string } {
  const meta = ensureChatMeta(db);
  if (payload.clear) {
    meta.pinnedMessage = null;
  } else if (typeof payload.messageId === 'string' && payload.messageId.trim()) {
    const target = (db.chatMessages || []).find((m) => m.id === payload.messageId!.trim());
    if (!target) {
      return { ok: false, status: 404, error: 'Повідомлення для закріплення не знайдено.' };
    }
    meta.pinnedMessage = {
      id: target.id,
      authorName: target.authorName,
      text: target.text.slice(0, 240),
      pinnedAt: new Date().toISOString(),
      pinnedBy: actor.displayName || 'Адмін',
    };
  } else {
    return { ok: false, status: 400, error: 'Вкажіть messageId або clear.' };
  }

  saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
  const publicMeta = getPublicChatMeta(db);
  broadcastChatEvent({ type: 'chat:meta', chatMeta: publicMeta });
  return { ok: true, chatMeta: publicMeta };
}

export function setChatSlowMode(
  db: SiteDatabase,
  rawSeconds: unknown
): { ok: true; chatMeta: ReturnType<typeof getPublicChatMeta> } | { ok: false; status: number; error: string } {
  const numeric = Number(rawSeconds);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 300) {
    return { ok: false, status: 400, error: 'Інтервал повільного режиму має бути від 0 до 300 секунд.' };
  }
  const meta = ensureChatMeta(db);
  meta.slowModeSeconds = Math.round(numeric);
  saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
  const publicMeta = getPublicChatMeta(db);
  broadcastChatEvent({ type: 'chat:meta', chatMeta: publicMeta });
  return { ok: true, chatMeta: publicMeta };
}

export function setUserChatMute(
  db: SiteDatabase,
  params: {
    targetUid: string;
    durationMinutes?: number;
    unmute?: boolean;
    displayName?: string;
    reason?: string;
  },
  actor: { uid: string; firebaseUid?: string; displayName: string }
): { ok: true; mutedUsers: Record<string, ChatMutedUserEntry> } | { ok: false; status: number; error: string } {
  const cleanTargetUid = typeof params.targetUid === 'string' ? params.targetUid.trim() : '';
  if (!cleanTargetUid || cleanTargetUid.length > 128) {
    return { ok: false, status: 400, error: 'Некоректний ідентифікатор користувача.' };
  }
  if (cleanTargetUid === actor.uid || (actor.firebaseUid && cleanTargetUid === actor.firebaseUid)) {
    return { ok: false, status: 400, error: 'Не можна заглушити власний акаунт.' };
  }

  const meta = ensureChatMeta(db);
  const mutedUsers = meta.mutedUsers || (meta.mutedUsers = {});

  const matchedAccount = db.guestAccounts.find(
    (acc) => acc.uid === cleanTargetUid || acc.googleUid === cleanTargetUid
  );
  if (matchedAccount && isAdminEmailAddress(matchedAccount.email)) {
    return { ok: false, status: 400, error: 'Не можна обмежити адміністратора.' };
  }

  const keysToTouch = Array.from(
    new Set(
      [cleanTargetUid, matchedAccount?.uid, matchedAccount?.googleUid].filter(
        (v): v is string => Boolean(v)
      )
    )
  );

  if (params.unmute) {
    for (const k of keysToTouch) {
      delete mutedUsers[k];
      broadcastToUserSockets(k, { type: 'chat:self-mute', myMute: null });
    }
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
    return { ok: true, mutedUsers: getAllActiveMutedUsers(db) };
  }

  const mins = Number(params.durationMinutes ?? 15);
  const clampedMins = Number.isFinite(mins) && mins > 0 ? Math.min(60 * 24 * 365, Math.round(mins)) : 0;
  const nowIso = new Date().toISOString();
  const mutedUntil = clampedMins > 0 ? new Date(Date.now() + clampedMins * 60 * 1000).toISOString() : null;
  const resolvedName = (
    params.displayName ||
    matchedAccount?.displayName ||
    (db.chatMessages || []).find((m) => m.authorUid === cleanTargetUid)?.authorName ||
    'Читач'
  )
    .trim()
    .slice(0, 80);

  const entry: ChatMutedUserEntry = {
    uid: cleanTargetUid,
    displayName: resolvedName,
    mutedUntil,
    mutedAt: nowIso,
    mutedBy: actor.displayName || 'Адмін',
    ...(typeof params.reason === 'string' && params.reason.trim()
      ? { reason: params.reason.trim().slice(0, 160) }
      : {}),
  };

  mutedUsers[cleanTargetUid] = entry;
  for (const k of keysToTouch) {
    broadcastToUserSockets(k, { type: 'chat:self-mute', myMute: entry });
  }
  saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
  return { ok: true, mutedUsers: getAllActiveMutedUsers(db) };
}

export function createChatReport(
  db: SiteDatabase,
  params: { messageId: string; reason?: string },
  actor: { uid: string; firebaseUid?: string; displayName: string }
):
  | { ok: true; report: ChatReportRecord; alreadyReported: boolean }
  | { ok: false; status: number; error: string } {
  const cleanMsgId = typeof params.messageId === 'string' ? params.messageId.trim() : '';
  if (!cleanMsgId) {
    return { ok: false, status: 400, error: 'Не вказано повідомлення для скарги.' };
  }
  const target = (db.chatMessages || []).find((m) => m.id === cleanMsgId);
  if (!target) {
    return { ok: false, status: 404, error: 'Повідомлення не знайдено.' };
  }
  const reporterUid = actor.firebaseUid || actor.uid;
  if (target.authorUid === actor.uid || (actor.firebaseUid && target.authorUid === actor.firebaseUid)) {
    return { ok: false, status: 400, error: 'Не можна поскаржитись на власне повідомлення.' };
  }

  if (!Array.isArray(db.chatReports)) {
    db.chatReports = [];
  }
  const existing = db.chatReports.find(
    (r) => r.messageId === cleanMsgId && (r.reporterUid === reporterUid || r.reporterUid === actor.uid)
  );
  if (existing) {
    return { ok: true, report: existing, alreadyReported: true };
  }

  const cleanReason =
    typeof params.reason === 'string' && params.reason.trim()
      ? params.reason.trim().slice(0, 240)
      : 'Порушення правил спілкування';

  const report: ChatReportRecord = {
    id: `rep_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    messageId: target.id,
    messageText: target.text.slice(0, 300),
    messageAuthorUid: target.authorUid,
    messageAuthorName: target.authorName,
    reporterUid,
    reporterName: actor.displayName || 'Читач',
    reason: cleanReason,
    createdAt: new Date().toISOString(),
    resolved: false,
  };

  db.chatReports.unshift(report);
  if (db.chatReports.length > 100) {
    db.chatReports = db.chatReports.slice(0, 100);
  }
  saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
  broadcastToAdmins({
    type: 'chat:reports-updated',
    unresolvedCount: getUnresolvedReportsCount(db),
  });
  return { ok: true, report, alreadyReported: false };
}

function removeChatMessage(
  db: SiteDatabase,
  id: string,
  actor: {
    uid: string;
    firebaseUid?: string;
    isAdmin: boolean;
    idToken?: string;
    skipFirestoreSync?: boolean;
  }
): { ok: true; deletedId: string } | { ok: false; status: number; error: string } {
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

  const meta = ensureChatMeta(db);
  let metaChanged = false;
  if (meta.pinnedMessage && meta.pinnedMessage.id === id) {
    meta.pinnedMessage = null;
    metaChanged = true;
  }

  saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
  broadcastChatEvent({ type: 'chat:deleted', id });
  if (metaChanged) {
    broadcastChatEvent({ type: 'chat:meta', chatMeta: getPublicChatMeta(db) });
  }
  if (!actor.skipFirestoreSync && actor.idToken) {
    void deleteChatMessageInFirestore(id, actor.idToken);
  }
  return { ok: true, deletedId: id };
}

export function registerChatRoutes(app: express.Express): void {
  app.get('/api/chat/messages', async (req: Request, res: Response) => {
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
    const myMute = optionalAuth ? getActiveMuteForAccount(db, optionalAuth.account) : null;

    const beforeCursor = typeof req.query.before === 'string' ? req.query.before.trim() : undefined;
    const requestedLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const page = getChatMessagesPage(db, {
      before: beforeCursor || undefined,
      limit: requestedLimit,
      badgeLookup,
      photoLookup,
      donorTextLookup,
    });

    res.setHeader('Vary', 'Authorization, Cookie');
    if (optionalAuth || beforeCursor) {
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
    }

    res.json({
      messages: page.messages,
      hasMore: page.hasMore,
      totalCount: page.totalCount,
      onlineCount: chatClients.size,
      chatMeta: getPublicChatMeta(db),
      ...(currentUserBadges ? { currentUserBadges } : {}),
      ...(optionalAuth
        ? {
            currentUserDonorText: optionalAuth.account.donorChatText || '',
            myMute,
          }
        : {}),
      ...(optionalAuth?.isAdmin
        ? {
            mutedUsers: getAllActiveMutedUsers(db),
            unresolvedReportsCount: getUnresolvedReportsCount(db),
          }
        : {}),
    });
  });

  app.put('/api/chat/donor-text', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
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
    broadcastGlobalChatRefresh(db);

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

  app.post('/api/chat/messages', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
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

    const { id, text, replyToId, attachment, clientMessageId, skipFirestoreSync } = req.body as {
      id?: string;
      text?: string;
      replyToId?: string;
      attachment?: unknown;
      clientMessageId?: string;
      skipFirestoreSync?: boolean;
    };
    const result = appendChatMessage(db, auth.account, text || '', replyToId, {
      id: typeof id === 'string' ? id.trim() : undefined,
      attachment,
      clientMessageId:
        typeof clientMessageId === 'string' && clientMessageId.trim()
          ? clientMessageId.trim().slice(0, 80)
          : undefined,
      firebaseUid: auth.firebaseClaims?.uid || auth.account.googleUid,
      firebaseIdToken: auth.firebaseIdToken,
      skipFirestoreSync: Boolean(skipFirestoreSync),
    });
    if (!result.ok) {
      if (result.retryAfterSec) {
        res.setHeader('Retry-After', String(result.retryAfterSec));
      }
      res.status(result.status).json({ error: result.error, retryAfterSec: result.retryAfterSec });
      return;
    }
    res.status(201).json({ message: result.message });
  });

  app.patch('/api/chat/messages/:id', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
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
    const { text } = req.body as { text?: string };
    const result = editChatMessage(db, req.params.id, text || '', {
      uid: auth.account.uid,
      firebaseUid: auth.firebaseClaims?.uid || auth.account.googleUid,
      isAdmin: auth.isAdmin,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ message: result.message });
  });

  app.post('/api/chat/messages/:id/react', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
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
    const rate = checkRateLimit(`chat-react:${auth.account.uid}:${ipHash}`, 60, 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато реакцій поспіль.' });
      return;
    }

    const { emoji } = req.body as { emoji?: string };
    const actorUid = auth.firebaseClaims?.uid || auth.account.googleUid || auth.account.uid;
    const result = toggleChatReaction(db, req.params.id, emoji || '', actorUid);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ id: result.id, reactions: result.reactions });
  });

  app.post('/api/chat/pin', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const db = ensureDatabase();
    const adminAuth = await authenticateAdminRequest(req);
    if (!adminAuth.ok) {
      res.status(adminAuth.status).json({ error: adminAuth.error });
      return;
    }
    const { messageId, clear } = req.body as { messageId?: string; clear?: boolean };
    const result = setPinnedChatMessage(
      db,
      { messageId, clear: Boolean(clear) },
      { displayName: adminAuth.claims.email || 'Адмін' }
    );
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ chatMeta: result.chatMeta });
  });

  app.post('/api/chat/moderation/slow-mode', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const db = ensureDatabase();
    const adminAuth = await authenticateAdminRequest(req);
    if (!adminAuth.ok) {
      res.status(adminAuth.status).json({ error: adminAuth.error });
      return;
    }
    const { seconds } = req.body as { seconds?: number };
    const result = setChatSlowMode(db, seconds);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ chatMeta: result.chatMeta });
  });

  app.post('/api/chat/moderation/mute', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const db = ensureDatabase();
    const adminAuth = await authenticateAdminRequest(req);
    if (!adminAuth.ok) {
      res.status(adminAuth.status).json({ error: adminAuth.error });
      return;
    }
    const { targetUid, durationMinutes, unmute, displayName, reason } = req.body as {
      targetUid?: string;
      durationMinutes?: number;
      unmute?: boolean;
      displayName?: string;
      reason?: string;
    };
    const result = setUserChatMute(
      db,
      {
        targetUid: targetUid || '',
        durationMinutes,
        unmute: Boolean(unmute),
        displayName,
        reason,
      },
      {
        uid: adminAuth.claims.uid,
        firebaseUid: adminAuth.claims.uid,
        displayName: adminAuth.claims.email || 'Адмін',
      }
    );
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ mutedUsers: result.mutedUsers });
  });

  app.get('/api/chat/moderation', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    const db = ensureDatabase();
    const adminAuth = await authenticateAdminRequest(req);
    if (!adminAuth.ok) {
      res.status(adminAuth.status).json({ error: adminAuth.error });
      return;
    }
    res.json({
      chatMeta: getPublicChatMeta(db),
      mutedUsers: getAllActiveMutedUsers(db),
      reports: (db.chatReports || []).slice(0, 60),
      unresolvedReportsCount: getUnresolvedReportsCount(db),
    });
  });

  app.post('/api/chat/reports', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
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
    const rate = checkRateLimit(`chat-report:${auth.account.uid}:${ipHash}`, 15, 10 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато скарг. Зачекайте трохи.' });
      return;
    }
    const { messageId, reason } = req.body as { messageId?: string; reason?: string };
    const result = createChatReport(
      db,
      { messageId: messageId || '', reason },
      {
        uid: auth.account.uid,
        firebaseUid: auth.firebaseClaims?.uid || auth.account.googleUid,
        displayName: auth.account.displayName || 'Читач',
      }
    );
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(result.alreadyReported ? 200 : 201).json({
      ok: true,
      alreadyReported: result.alreadyReported,
      report: result.report,
    });
  });

  app.post('/api/chat/reports/:id/resolve', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const db = ensureDatabase();
    const adminAuth = await authenticateAdminRequest(req);
    if (!adminAuth.ok) {
      res.status(adminAuth.status).json({ error: adminAuth.error });
      return;
    }
    if (!Array.isArray(db.chatReports)) {
      res.status(404).json({ error: 'Скаргу не знайдено.' });
      return;
    }
    const report = db.chatReports.find((r) => r.id === req.params.id);
    if (!report) {
      res.status(404).json({ error: 'Скаргу не знайдено.' });
      return;
    }
    report.resolved = true;
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
    broadcastToAdmins({
      type: 'chat:reports-updated',
      unresolvedCount: getUnresolvedReportsCount(db),
    });
    res.json({ ok: true, report, unresolvedReportsCount: getUnresolvedReportsCount(db) });
  });

  app.delete('/api/chat/messages/:id', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
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
}

export function attachChatWebSocket(httpServer: http.Server): void {
  const chatWss = new WebSocketServer({ noServer: true, maxPayload: 16384 });

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

    const meta: ChatClientMeta = {
      ipHash,
      isAlive: true,
    };
    chatClients.set(ws, meta);

    const db = ensureDatabase();
    const sendInitSnapshot = (targetDb: SiteDatabase) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const page = getChatMessagesPage(targetDb, { limit: DEFAULT_CHAT_PAGE_LIMIT });
      ws.send(
        JSON.stringify({
          type: 'chat:init',
          messages: page.messages,
          hasMore: page.hasMore,
          totalCount: page.totalCount,
          onlineCount: chatClients.size,
          chatMeta: getPublicChatMeta(targetDb),
        })
      );
    };
    sendInitSnapshot(db);
    if (!cloudSyncState.communityHydrated) {
      void ensureAllPublicStateHydrated(db).then((changed) => {
        if (changed && ws.readyState === WebSocket.OPEN) {
          broadcastGlobalChatRefresh(db);
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
          emoji?: string;
          isTyping?: boolean;
          replyToId?: string;
          attachment?: unknown;
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
            meta.displayName = undefined;
            meta.firebaseIdToken = undefined;
            meta.isAdmin = false;
            ws.send(JSON.stringify({ type: 'chat:auth', authenticated: false }));
            return;
          }
          const auth = await authenticateGuestTokenFast(token, currentDb);
          if (auth.ok) {
            meta.uid = auth.account.uid;
            meta.firebaseUid = auth.firebaseClaims?.uid || auth.account.googleUid;
            meta.displayName = auth.account.displayName || 'Читач';
            meta.firebaseIdToken = auth.firebaseIdToken;
            meta.isAdmin = auth.isAdmin;
            const liveBadges = createBadgeLookup(currentDb).get(
              auth.account.uid,
              auth.account.displayName
            );
            const myMute = getActiveMuteForAccount(currentDb, auth.account);
            ws.send(
              JSON.stringify({
                type: 'chat:auth',
                authenticated: true,
                uid: auth.account.uid,
                isAdmin: auth.isAdmin,
                ...(liveBadges ? { badges: liveBadges } : {}),
                donorChatText: auth.account.donorChatText || '',
                myMute,
                ...(auth.isAdmin
                  ? {
                      mutedUsers: getAllActiveMutedUsers(currentDb),
                      unresolvedReportsCount: getUnresolvedReportsCount(currentDb),
                    }
                  : {}),
              })
            );
          } else {
            meta.uid = undefined;
            meta.firebaseUid = undefined;
            meta.displayName = undefined;
            meta.firebaseIdToken = undefined;
            meta.isAdmin = false;
            ws.send(JSON.stringify({ type: 'chat:auth', authenticated: false, error: auth.error }));
          }
          return;
        }

        if (parsed.type === 'chat:typing') {
          if (!meta.uid || !meta.displayName) return;
          const nowMs = Date.now();
          if (parsed.isTyping && meta.lastTypingSentAtMs && nowMs - meta.lastTypingSentAtMs < 1000) {
            return;
          }
          meta.lastTypingSentAtMs = nowMs;
          broadcastChatEventExcept(ws, {
            type: 'chat:typing',
            uid: meta.firebaseUid || meta.uid,
            displayName: meta.displayName,
            isTyping: Boolean(parsed.isTyping),
          });
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
              meta.displayName = auth.account.displayName || 'Читач';
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
              attachment: parsed.attachment,
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
                ...(result.retryAfterSec ? { retryAfterSec: result.retryAfterSec } : {}),
                error: result.error,
              })
            );
          }
          return;
        }

        if (parsed.type === 'chat:edit' && typeof parsed.id === 'string') {
          const currentDb = ensureDatabase();
          if (!meta.uid) {
            ws.send(JSON.stringify({ type: 'chat:error', error: 'Потрібна авторизація.' }));
            return;
          }
          const result = editChatMessage(currentDb, parsed.id, parsed.text || '', {
            uid: meta.uid,
            firebaseUid: meta.firebaseUid,
            isAdmin: Boolean(meta.isAdmin),
          });
          if (!result.ok) {
            ws.send(JSON.stringify({ type: 'chat:error', error: result.error }));
          }
          return;
        }

        if (parsed.type === 'chat:react' && typeof parsed.id === 'string' && typeof parsed.emoji === 'string') {
          const currentDb = ensureDatabase();
          if (!meta.uid) {
            ws.send(JSON.stringify({ type: 'chat:error', error: 'Потрібна авторизація для реакцій.' }));
            return;
          }
          const rate = checkRateLimit(`chat-react:${meta.uid}:${meta.ipHash}`, 60, 60 * 1000);
          if (!rate.allowed) return;
          const actorUid = meta.firebaseUid || meta.uid;
          const result = toggleChatReaction(currentDb, parsed.id, parsed.emoji, actorUid);
          if (!result.ok) {
            ws.send(JSON.stringify({ type: 'chat:error', error: result.error }));
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
      if (meta.uid || meta.firebaseUid) {
        broadcastChatEvent({
          type: 'chat:typing',
          uid: meta.firebaseUid || meta.uid,
          displayName: meta.displayName || '',
          isTyping: false,
        });
      }
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
}
