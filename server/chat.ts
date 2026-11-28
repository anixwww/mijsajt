import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { type GuestAccountRecord, type SiteDatabase } from './seedData.ts';
import type { GlobalChatMessage } from '../src/types.ts';
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

interface ChatClientMeta {
  uid?: string;
  firebaseUid?: string;
  firebaseIdToken?: string;
  isAdmin?: boolean;
  ipHash: string;
  isAlive: boolean;
}

const chatClients = new Map<WebSocket, ChatClientMeta>();

function broadcastChatEvent(payload: unknown): void {
  const encoded = JSON.stringify(payload);
  for (const [client] of chatClients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(encoded);
    }
  }
}

export function broadcastGlobalChatRefresh(db: SiteDatabase): void {
  const badgeLookup = createBadgeLookup(db);
  const photoLookup = createAccountPhotoLookup(db);
  const donorTextLookup = createDonorTextLookup(db);
  broadcastChatEvent({
    type: 'chat:refresh',
    messages: (db.chatMessages || [])
      .slice(-100)
      .map((msg) => enrichChatMessageWithBadges(msg, badgeLookup, photoLookup, donorTextLookup)),
  });
}

function appendChatMessage(
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
): { ok: true; message: GlobalChatMessage } | { ok: false; status: number; error: string } {
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
  saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 1500, slices: ['community'] });
  broadcastChatEvent({ type: 'chat:deleted', id });
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

    res.setHeader('Vary', 'Authorization, Cookie');
    if (optionalAuth) {
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
    }

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
  const chatWss = new WebSocketServer({ noServer: true, maxPayload: 8192 });

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
}
