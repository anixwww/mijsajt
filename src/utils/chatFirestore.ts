import {
  getCachedAuthUser,
  getFirebaseAuth,
  getFirebaseDb,
  handleFirestoreError,
  OperationType,
} from '../firebase.ts';
import type { GlobalChatMessage, UserTopBadges } from '../types.ts';

const CHAT_COLLECTION = 'chatMessages';
const CHAT_CACHE_STORAGE_KEY = 'dankiv_global_chat_cache_v1';
const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const ADMIN_EMAILS = new Set(['andrijdankiv5@gmail.com', 'andriidankiv.writer@gmail.com']);

export interface ChatAuthorMeta {
  badges?: UserTopBadges;
  donorText?: string;
  photoUrl?: string;
}

interface PersistedChatCache {
  messages: GlobalChatMessage[];
  authorMetaByUid: Record<string, ChatAuthorMeta>;
  updatedAt: number;
}

let memoryMessagesCache: GlobalChatMessage[] | null = null;
let memoryAuthorMetaCache: Record<string, ChatAuthorMeta> | null = null;
let prewarmStarted = false;

function normalizeAuthorMetaMap(raw: unknown): Record<string, ChatAuthorMeta> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ChatAuthorMeta> = {};
  for (const [uid, entry] of Object.entries(raw as Record<string, unknown>).slice(0, 300)) {
    if (!uid || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const meta: ChatAuthorMeta = {};
    if (obj.badges && typeof obj.badges === 'object' && !Array.isArray(obj.badges)) {
      meta.badges = obj.badges as UserTopBadges;
    }
    if (typeof obj.donorText === 'string' && obj.donorText.trim()) {
      meta.donorText = obj.donorText.trim().slice(0, 80);
    }
    if (typeof obj.photoUrl === 'string' && obj.photoUrl.trim()) {
      meta.photoUrl = obj.photoUrl.trim().slice(0, 500);
    }
    if (meta.badges || meta.donorText || meta.photoUrl) {
      out[uid] = meta;
    }
  }
  return out;
}

function loadCacheFromStorage(): PersistedChatCache {
  if (memoryMessagesCache && memoryAuthorMetaCache) {
    return {
      messages: memoryMessagesCache,
      authorMetaByUid: memoryAuthorMetaCache,
      updatedAt: Date.now(),
    };
  }
  if (typeof window === 'undefined') {
    memoryMessagesCache = [];
    memoryAuthorMetaCache = {};
    return { messages: [], authorMetaByUid: {}, updatedAt: 0 };
  }
  try {
    const raw = window.localStorage.getItem(CHAT_CACHE_STORAGE_KEY);
    if (!raw) {
      memoryMessagesCache = [];
      memoryAuthorMetaCache = {};
      return { messages: [], authorMetaByUid: {}, updatedAt: 0 };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedChatCache>;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter(
            (m): m is GlobalChatMessage =>
              Boolean(m && typeof m.id === 'string' && typeof m.text === 'string')
          )
          .slice(-100)
      : [];
    const authorMetaByUid = normalizeAuthorMetaMap(parsed.authorMetaByUid);
    memoryMessagesCache = messages;
    memoryAuthorMetaCache = authorMetaByUid;
    return {
      messages,
      authorMetaByUid,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    memoryMessagesCache = [];
    memoryAuthorMetaCache = {};
    return { messages: [], authorMetaByUid: {}, updatedAt: 0 };
  }
}

export function getCachedGlobalChatState(): {
  messages: GlobalChatMessage[];
  authorMetaByUid: Record<string, ChatAuthorMeta>;
} {
  const cached = loadCacheFromStorage();
  return {
    messages: cached.messages,
    authorMetaByUid: cached.authorMetaByUid,
  };
}

export function saveCachedGlobalChatState(
  messages: GlobalChatMessage[],
  authorMetaByUid: Record<string, ChatAuthorMeta>
): void {
  const trimmedMessages = messages.slice(-100);
  const trimmedMeta: Record<string, ChatAuthorMeta> = {};
  const entries = Object.entries(authorMetaByUid);
  for (const [uid, meta] of entries.slice(-250)) {
    if (meta && (meta.badges || meta.donorText || meta.photoUrl)) {
      trimmedMeta[uid] = meta;
    }
  }
  memoryMessagesCache = trimmedMessages;
  memoryAuthorMetaCache = trimmedMeta;

  if (typeof window === 'undefined') return;
  try {
    const payload: PersistedChatCache = {
      messages: trimmedMessages,
      authorMetaByUid: trimmedMeta,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(CHAT_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

export function prewarmChatFirestore(): void {
  if (prewarmStarted || typeof window === 'undefined') return;
  prewarmStarted = true;
  void Promise.all([
    getFirebaseAuth().catch(() => null),
    getFirebaseDb().catch(() => null),
    import('firebase/firestore').catch(() => null),
  ]);
}

export function generateChatMessageId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : Math.random().toString(36).slice(2, 10);
  return `chat_${Date.now().toString(36)}_${rand}`;
}

function parseTimestampIso(raw: unknown): string {
  if (raw && typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (raw as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  if (typeof raw === 'string' && raw.trim()) return raw;
  return new Date().toISOString();
}

function mapDocToChatMessage(
  docId: string,
  data: Record<string, unknown>
): GlobalChatMessage | null {
  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : docId;
  const authorUid = typeof data.authorUid === 'string' ? data.authorUid.trim() : '';
  const authorName =
    typeof data.authorName === 'string' && data.authorName.trim()
      ? data.authorName.trim()
      : 'Читач';
  const text = typeof data.text === 'string' ? data.text : '';
  if (!id || !authorUid || !text.trim()) return null;

  const authorPhotoUrl =
    typeof data.authorPhotoUrl === 'string' && data.authorPhotoUrl.trim()
      ? data.authorPhotoUrl.trim()
      : undefined;

  const rawReply =
    data.replyTo && typeof data.replyTo === 'object' && !Array.isArray(data.replyTo)
      ? (data.replyTo as Record<string, unknown>)
      : null;
  const replyTo =
    rawReply &&
    typeof rawReply.id === 'string' &&
    typeof rawReply.authorUid === 'string' &&
    typeof rawReply.authorName === 'string' &&
    typeof rawReply.text === 'string'
      ? {
          id: rawReply.id,
          authorUid: rawReply.authorUid,
          authorName: rawReply.authorName,
          text: rawReply.text,
        }
      : undefined;

  return {
    id,
    authorUid,
    authorName,
    ...(authorPhotoUrl ? { authorPhotoUrl } : {}),
    ...(data.isAdmin === true ? { isAdmin: true } : {}),
    text,
    ...(replyTo ? { replyTo } : {}),
    createdAt: parseTimestampIso(data.createdAt),
  };
}

export async function subscribeGlobalChatMessages(options: {
  limitCount?: number;
  onMessages: (messages: GlobalChatMessage[]) => void;
  onConnected?: () => void;
  onError?: (error: unknown) => void;
}): Promise<() => void> {
  const limitCount = Math.max(10, Math.min(150, options.limitCount ?? 100));
  try {
    const [db, { collection, limit, onSnapshot, orderBy, query }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);

    const chatQuery = query(
      collection(db, CHAT_COLLECTION),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );

    const unsubscribe = onSnapshot(
      chatQuery,
      (snapshot) => {
        const mapped: GlobalChatMessage[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
          const item = mapDocToChatMessage(docSnap.id, data);
          if (item) mapped.push(item);
        });
        mapped.reverse();
        options.onConnected?.();
        options.onMessages(mapped);
      },
      (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.toLowerCase().includes('permission')) {
          try {
            handleFirestoreError(error, OperationType.GET, CHAT_COLLECTION);
          } catch {
            // Structured error already logged; notify caller to keep WS/HTTP active
          }
        }
        options.onError?.(error);
      }
    );

    return unsubscribe;
  } catch (err) {
    options.onError?.(err);
    return () => {};
  }
}

export async function sendChatMessageDirectToFirestore(params: {
  id: string;
  text: string;
  authorName: string;
  authorPhotoUrl?: string;
  isAdmin?: boolean;
  replyTo?: {
    id: string;
    authorUid: string;
    authorName: string;
    text: string;
  };
}): Promise<{ ok: true } | { ok: false; permissionDenied?: boolean }> {
  if (!VALID_ID_RE.test(params.id)) return { ok: false };

  let currentUser = getCachedAuthUser();
  if (!currentUser) {
    const auth = await getFirebaseAuth().catch(() => null);
    if (auth) {
      await auth.authStateReady().catch(() => {});
      currentUser = auth.currentUser;
    }
  }
  if (!currentUser || !currentUser.emailVerified || !VALID_ID_RE.test(currentUser.uid)) {
    return { ok: false };
  }

  const cleanText = params.text.trim().slice(0, 600);
  if (!cleanText) return { ok: false };

  const cleanName = (params.authorName || currentUser.displayName || 'Читач')
    .trim()
    .slice(0, 80) || 'Читач';
  const cleanPhoto =
    typeof params.authorPhotoUrl === 'string' && params.authorPhotoUrl.trim()
      ? params.authorPhotoUrl.trim().slice(0, 500)
      : undefined;

  const userEmailLower = (currentUser.email || '').trim().toLowerCase();
  const canSetAdminFlag = Boolean(params.isAdmin && ADMIN_EMAILS.has(userEmailLower));

  const cleanReply =
    params.replyTo &&
    VALID_ID_RE.test(params.replyTo.id) &&
    VALID_ID_RE.test(params.replyTo.authorUid) &&
    params.replyTo.text.trim().length > 0
      ? {
          id: params.replyTo.id,
          authorUid: params.replyTo.authorUid,
          authorName: (params.replyTo.authorName || 'Читач').trim().slice(0, 80) || 'Читач',
          text: params.replyTo.text.trim().slice(0, 180),
        }
      : undefined;

  try {
    const [db, { doc, serverTimestamp, setDoc }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);

    await setDoc(doc(db, CHAT_COLLECTION, params.id), {
      id: params.id,
      authorUid: currentUser.uid,
      authorName: cleanName,
      ...(cleanPhoto ? { authorPhotoUrl: cleanPhoto } : {}),
      ...(canSetAdminFlag ? { isAdmin: true } : {}),
      text: cleanText,
      ...(cleanReply ? { replyTo: cleanReply } : {}),
      createdAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('permission')) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `${CHAT_COLLECTION}/${params.id}`, currentUser);
      } catch {
        return { ok: false, permissionDenied: true };
      }
    }
    return { ok: false };
  }
}

export async function deleteChatMessageDirectInFirestore(messageId: string): Promise<boolean> {
  const cleanId = messageId.trim();
  if (!VALID_ID_RE.test(cleanId)) return false;

  let currentUser = getCachedAuthUser();
  if (!currentUser) {
    const auth = await getFirebaseAuth().catch(() => null);
    if (auth) {
      await auth.authStateReady().catch(() => {});
      currentUser = auth.currentUser;
    }
  }
  if (!currentUser || !currentUser.emailVerified) return false;

  try {
    const [db, { deleteDoc, doc }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);
    await deleteDoc(doc(db, CHAT_COLLECTION, cleanId));
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('permission')) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `${CHAT_COLLECTION}/${cleanId}`, currentUser);
      } catch {
        return false;
      }
    }
    return false;
  }
}
