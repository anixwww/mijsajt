import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CornerUpLeft, LogIn, MessagesSquare, Send, Trash2, User, X } from 'lucide-react';
import type { GlobalChatMessage, GuestUser, UserTopBadges } from '../types.ts';
import { UserRankBadges } from './UserRankBadges.tsx';
import {
  deleteChatMessageDirectInFirestore,
  generateChatMessageId,
  getCachedGlobalChatState,
  prewarmChatFirestore,
  saveCachedGlobalChatState,
  sendChatMessageDirectToFirestore,
  subscribeGlobalChatMessages,
  type ChatAuthorMeta,
} from '../utils/chatFirestore.ts';

function ChatAvatar({ photoUrl }: { photoUrl?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full object-cover"
      />
    );
  }
  return <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" />;
}

interface GlobalChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  guestUser: GuestUser | null;
  isAdmin: boolean;
  getGuestToken: (forceRefresh?: boolean) => Promise<string | null>;
  onOpenAuthModal: () => void;
  onGuestUserUpdated?: (user: GuestUser) => void;
}

type WsStatus = 'connecting' | 'connected' | 'reconnecting';

function formatMessageTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    const time = d.toLocaleTimeString('uk-UA', {
      hour: '2-digit',
      minute: '2-digit',
    });
    if (isToday) return time;

    const date = d.toLocaleDateString('uk-UA', {
      day: 'numeric',
      month: 'short',
    });
    return `${date}, ${time}`;
  } catch {
    return '';
  }
}

export function GlobalChatModal({
  isOpen,
  onClose,
  guestUser,
  isAdmin,
  getGuestToken,
  onOpenAuthModal,
  onGuestUserUpdated,
}: GlobalChatModalProps) {
  const initialCacheRef = useRef<ReturnType<typeof getCachedGlobalChatState> | null>(null);
  if (!initialCacheRef.current) {
    initialCacheRef.current = getCachedGlobalChatState();
  }

  const [messages, setMessages] = useState<GlobalChatMessage[]>(
    () => initialCacheRef.current?.messages || []
  );
  const [onlineCount, setOnlineCount] = useState<number>(1);
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [firestoreConnected, setFirestoreConnected] = useState<boolean>(false);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(
    () => (initialCacheRef.current?.messages.length || 0) === 0
  );
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<GlobalChatMessage | null>(null);
  const [liveBadges, setLiveBadges] = useState<UserTopBadges | undefined>(guestUser?.badges);
  const [donorTextDraft, setDonorTextDraft] = useState(guestUser?.donorChatText || '');
  const [savedDonorText, setSavedDonorText] = useState(guestUser?.donorChatText || '');
  const [savingDonorText, setSavingDonorText] = useState(false);
  const [donorTextSavedFlash, setDonorTextSavedFlash] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const fallbackPollRef = useRef<number | null>(null);
  const pendingSendTimersRef = useRef<Map<string, number>>(new Map());
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const authorMetaByUidRef = useRef<Record<string, ChatAuthorMeta>>(
    initialCacheRef.current?.authorMetaByUid || {}
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const getGuestTokenRef = useRef(getGuestToken);
  getGuestTokenRef.current = getGuestToken;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  const scrollToBottomRef = useRef(scrollToBottom);
  scrollToBottomRef.current = scrollToBottom;

  const syncAuthOnSocket = useCallback(async (socket: WebSocket) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      const token = await getGuestTokenRef.current();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'auth', token: token || '' }));
      }
    } catch {
      // Ignore auth sync failure
    }
  }, []);

  const syncAuthOnSocketRef = useRef(syncAuthOnSocket);
  syncAuthOnSocketRef.current = syncAuthOnSocket;

  const clearPendingTimer = useCallback((clientMessageId?: string) => {
    if (!clientMessageId) return;
    const timer = pendingSendTimersRef.current.get(clientMessageId);
    if (timer) {
      window.clearTimeout(timer);
      pendingSendTimersRef.current.delete(clientMessageId);
    }
  }, []);

  const mergeIncomingMessages = useCallback(
    (
      incomingList: GlobalChatMessage[],
      mode: 'merge' | 'authoritative' | 'firestore' = 'merge'
    ) => {
      const metaMap = authorMetaByUidRef.current;
      for (const msg of incomingList) {
        if (!msg.authorUid) continue;
        const prevMeta = metaMap[msg.authorUid] || {};
        if (msg.authorBadges || msg.authorDonorText || msg.authorPhotoUrl) {
          metaMap[msg.authorUid] = {
            badges: msg.authorBadges ?? prevMeta.badges,
            donorText: msg.authorDonorText ?? prevMeta.donorText,
            photoUrl: msg.authorPhotoUrl ?? prevMeta.photoUrl,
          };
        }
      }

      const enrichWithMeta = (msg: GlobalChatMessage): GlobalChatMessage => {
        const meta = metaMap[msg.authorUid];
        if (!meta) return msg;
        const resolvedBadges = msg.authorBadges || meta.badges;
        const resolvedDonorText =
          resolvedBadges?.donorRank && resolvedBadges.donorRank <= 3
            ? msg.authorDonorText || meta.donorText
            : undefined;
        const resolvedPhoto = msg.authorPhotoUrl || meta.photoUrl;
        if (
          resolvedBadges === msg.authorBadges &&
          resolvedDonorText === msg.authorDonorText &&
          resolvedPhoto === msg.authorPhotoUrl
        ) {
          return msg;
        }
        return {
          ...msg,
          ...(resolvedPhoto ? { authorPhotoUrl: resolvedPhoto } : {}),
          ...(resolvedBadges ? { authorBadges: resolvedBadges } : {}),
          ...(resolvedDonorText ? { authorDonorText: resolvedDonorText } : {}),
        };
      };

      setMessages((prev) => {
        const byId = new Map<string, GlobalChatMessage>();
        if (mode === 'merge') {
          for (const existing of prev) {
            if (!deletedIdsRef.current.has(existing.id)) {
              byId.set(existing.id, enrichWithMeta(existing));
            }
          }
        } else if (mode === 'firestore') {
          const incomingIds = new Set(incomingList.map((m) => m.id));
          const isWindowTruncated = incomingList.length >= 100;
          const oldestIncomingMs =
            isWindowTruncated && incomingList.length > 0
              ? Date.parse(incomingList[0].createdAt) || 0
              : Infinity;

          for (const existing of prev) {
            if (deletedIdsRef.current.has(existing.id)) continue;
            const isPending = pendingIdsRef.current.has(existing.id);
            const inWindow = incomingIds.has(existing.id);
            const olderThanWindow =
              isWindowTruncated && (Date.parse(existing.createdAt) || 0) < oldestIncomingMs;
            if (isPending || inWindow || olderThanWindow) {
              byId.set(existing.id, enrichWithMeta(existing));
            }
          }
        } else {
          // Keep optimistic/pending local items that haven't landed in the authoritative batch yet
          for (const existing of prev) {
            if (
              !deletedIdsRef.current.has(existing.id) &&
              pendingIdsRef.current.has(existing.id)
            ) {
              byId.set(existing.id, enrichWithMeta(existing));
            }
          }
        }

        for (const rawMsg of incomingList) {
          if (!rawMsg?.id || deletedIdsRef.current.has(rawMsg.id)) continue;
          const prevEntry = prev.find((p) => p.id === rawMsg.id) || byId.get(rawMsg.id);
          const merged: GlobalChatMessage = enrichWithMeta({
            ...rawMsg,
            ...(rawMsg.authorPhotoUrl || prevEntry?.authorPhotoUrl
              ? { authorPhotoUrl: rawMsg.authorPhotoUrl || prevEntry?.authorPhotoUrl }
              : {}),
            ...(rawMsg.authorBadges || prevEntry?.authorBadges
              ? { authorBadges: rawMsg.authorBadges || prevEntry?.authorBadges }
              : {}),
            ...(rawMsg.authorDonorText || prevEntry?.authorDonorText
              ? { authorDonorText: rawMsg.authorDonorText || prevEntry?.authorDonorText }
              : {}),
          });
          byId.set(rawMsg.id, merged);
          pendingIdsRef.current.delete(rawMsg.id);
        }

        const sorted = Array.from(byId.values())
          .sort((a, b) => {
            const ta = Date.parse(a.createdAt) || 0;
            const tb = Date.parse(b.createdAt) || 0;
            if (ta !== tb) return ta - tb;
            return a.id.localeCompare(b.id);
          })
          .slice(-200);

        saveCachedGlobalChatState(sorted, metaMap);
        return sorted;
      });
    },
    []
  );

  const mergeIncomingMessagesRef = useRef(mergeIncomingMessages);
  mergeIncomingMessagesRef.current = mergeIncomingMessages;

  useEffect(() => {
    prewarmChatFirestore();
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setConfirmDeleteId(null);
      setReplyingTo(null);
      setFirestoreConnected(false);
      for (const timer of pendingSendTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      pendingSendTimersRef.current.clear();
      return;
    }

    let unmounted = false;
    let attempt = 0;
    let unsubscribeFirestore: () => void = () => {};
    shouldAutoScrollRef.current = true;
    setError(null);
    prewarmChatFirestore();

    void subscribeGlobalChatMessages({
      limitCount: 100,
      onConnected: () => {
        if (!unmounted) {
          setFirestoreConnected(true);
          setLoadingInitial(false);
        }
      },
      onMessages: (fsMessages) => {
        if (unmounted) return;
        setLoadingInitial(false);
        mergeIncomingMessagesRef.current(fsMessages, 'firestore');
        if (shouldAutoScrollRef.current) {
          window.requestAnimationFrame(() => scrollToBottomRef.current(false));
        }
      },
      onError: () => {
        if (!unmounted) {
          setFirestoreConnected(false);
        }
      },
    }).then((unsub) => {
      if (unmounted) {
        unsub();
      } else {
        unsubscribeFirestore = unsub;
      }
    });

    const fetchSnapshot = async () => {
      try {
        const headers: Record<string, string> = {};
        const token = await getGuestTokenRef.current().catch(() => null);
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/chat/messages', { headers });
        if (!res.ok) return;
        const json = (await res.json()) as {
          messages?: GlobalChatMessage[];
          onlineCount?: number;
          currentUserBadges?: UserTopBadges;
          currentUserDonorText?: string;
        };
        if (unmounted) return;
        if (Array.isArray(json.messages)) {
          mergeIncomingMessagesRef.current(json.messages, 'merge');
        }
        if (typeof json.onlineCount === 'number') {
          setOnlineCount(Math.max(1, json.onlineCount));
        }
        if (json.currentUserBadges !== undefined) {
          setLiveBadges(json.currentUserBadges);
        }
        if (typeof json.currentUserDonorText === 'string') {
          setSavedDonorText(json.currentUserDonorText);
          setDonorTextDraft(json.currentUserDonorText);
        }
      } catch {
        // Firestore onSnapshot and WebSocket hydrate state
      } finally {
        if (!unmounted) {
          setLoadingInitial(false);
          window.requestAnimationFrame(() => scrollToBottomRef.current(false));
        }
      }
    };

    void fetchSnapshot();

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/chat`;
      setWsStatus(attempt === 0 ? 'connecting' : 'reconnecting');

      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (unmounted) {
          socket.close();
          return;
        }
        attempt = 0;
        setWsStatus('connected');
        void syncAuthOnSocketRef.current(socket);

        if (pingTimerRef.current) {
          window.clearInterval(pingTimerRef.current);
        }
        pingTimerRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      socket.onmessage = (event) => {
        if (unmounted) return;
        try {
          const payload = JSON.parse(event.data as string) as {
            type?: string;
            messages?: GlobalChatMessage[];
            message?: GlobalChatMessage;
            clientMessageId?: string;
            id?: string;
            onlineCount?: number;
            badges?: UserTopBadges;
            donorChatText?: string;
            authenticated?: boolean;
            error?: string;
          };

          if (payload.type === 'chat:init') {
            if (Array.isArray(payload.messages)) {
              mergeIncomingMessagesRef.current(payload.messages, 'merge');
              setLoadingInitial(false);
              window.requestAnimationFrame(() => scrollToBottomRef.current(false));
            }
            if (typeof payload.onlineCount === 'number') {
              setOnlineCount(Math.max(1, payload.onlineCount));
            }
            return;
          }

          if (payload.type === 'chat:refresh' && Array.isArray(payload.messages)) {
            mergeIncomingMessagesRef.current(payload.messages, 'merge');
            return;
          }

          if (payload.type === 'chat:auth') {
            if (payload.authenticated) {
              setLiveBadges(payload.badges);
              if (typeof payload.donorChatText === 'string') {
                setSavedDonorText(payload.donorChatText);
                setDonorTextDraft(payload.donorChatText);
              }
            } else {
              setLiveBadges(undefined);
            }
            return;
          }

          if (payload.type === 'chat:presence' && typeof payload.onlineCount === 'number') {
            setOnlineCount(Math.max(1, payload.onlineCount));
            return;
          }

          if (payload.type === 'chat:message' && payload.message) {
            const incoming = payload.message;
            const clientId = payload.clientMessageId;
            clearPendingTimer(clientId);
            clearPendingTimer(incoming.id);
            pendingIdsRef.current.delete(incoming.id);
            if (clientId) pendingIdsRef.current.delete(clientId);
            mergeIncomingMessagesRef.current([incoming], 'merge');
            setError(null);
            if (shouldAutoScrollRef.current) {
              window.requestAnimationFrame(() => scrollToBottomRef.current(true));
            }
            return;
          }

          if (payload.type === 'chat:deleted' && payload.id) {
            const deletedId = payload.id;
            deletedIdsRef.current.add(deletedId);
            pendingIdsRef.current.delete(deletedId);
            setMessages((prev) => {
              const next = prev.filter((m) => m.id !== deletedId);
              saveCachedGlobalChatState(next, authorMetaByUidRef.current);
              return next;
            });
            return;
          }

          if (payload.type === 'chat:error' && payload.error) {
            if (payload.clientMessageId) {
              clearPendingTimer(payload.clientMessageId);
              pendingIdsRef.current.delete(payload.clientMessageId);
              setMessages((prev) => prev.filter((m) => m.id !== payload.clientMessageId));
            }
            setError(payload.error);
          }
        } catch {
          // Ignore malformed frame
        }
      };

      socket.onclose = () => {
        if (pingTimerRef.current) {
          window.clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        if (unmounted) return;
        setWsStatus('reconnecting');
        attempt += 1;
        const delayMs = Math.min(6000, 700 * Math.pow(1.5, Math.min(attempt, 5)));
        reconnectTimerRef.current = window.setTimeout(connect, delayMs);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unmounted = true;
      unsubscribeFirestore();
      window.removeEventListener('keydown', handleKeyDown);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (fallbackPollRef.current) {
        window.clearInterval(fallbackPollRef.current);
        fallbackPollRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isOpen, clearPendingTimer]);

  // Fallback HTTP poll ONLY when BOTH WebSocket and Firestore real-time listener are disconnected
  useEffect(() => {
    if (!isOpen || wsStatus === 'connected' || firestoreConnected) return;
    const poll = async () => {
      try {
        const headers: Record<string, string> = {};
        const token = await getGuestTokenRef.current().catch(() => null);
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/chat/messages', { headers });
        if (!res.ok) return;
        const json = (await res.json()) as {
          messages?: GlobalChatMessage[];
          onlineCount?: number;
        };
        if (Array.isArray(json.messages)) {
          mergeIncomingMessagesRef.current(json.messages, 'merge');
        }
        if (typeof json.onlineCount === 'number') {
          setOnlineCount(Math.max(1, json.onlineCount));
        }
      } catch {
        // Ignore poll failure
      }
    };
    const timer = window.setInterval(() => {
      void poll();
    }, 3500);
    return () => window.clearInterval(timer);
  }, [isOpen, wsStatus, firestoreConnected]);

  // Sync local donor badge/text when guestUser changes
  useEffect(() => {
    setLiveBadges(guestUser?.badges);
    setDonorTextDraft(guestUser?.donorChatText || '');
    setSavedDonorText(guestUser?.donorChatText || '');
    const uids = [guestUser?.firebaseUid, guestUser?.uid].filter((v): v is string => Boolean(v));
    for (const uid of uids) {
      authorMetaByUidRef.current[uid] = {
        badges: guestUser?.badges ?? authorMetaByUidRef.current[uid]?.badges,
        donorText: guestUser?.donorChatText ?? authorMetaByUidRef.current[uid]?.donorText,
        photoUrl: guestUser?.photoUrl ?? authorMetaByUidRef.current[uid]?.photoUrl,
      };
    }
  }, [guestUser?.uid, guestUser?.firebaseUid, guestUser?.badges, guestUser?.donorChatText, guestUser?.photoUrl]);

  // Re-authenticate active WebSocket whenever guestUser changes
  useEffect(() => {
    if (!isOpen || !wsRef.current) return;
    void syncAuthOnSocketRef.current(wsRef.current);
  }, [guestUser?.uid, isOpen]);

  if (!isOpen) return null;

  const effectiveDonorRank = liveBadges?.donorRank ?? guestUser?.badges?.donorRank;
  const canSetDonorText = Boolean(
    guestUser && effectiveDonorRank && effectiveDonorRank >= 1 && effectiveDonorRank <= 3
  );

  const handleSaveDonorText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSetDonorText || savingDonorText) return;
    setSavingDonorText(true);
    setError(null);
    try {
      const token = await getGuestToken();
      if (!token) {
        setError('Сесія входу застаріла. Увійдіть повторно.');
        return;
      }
      const res = await fetch('/api/chat/donor-text', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: donorTextDraft.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        donorChatText?: string;
        user?: GuestUser;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || 'Не вдалося зберегти власний текст.');
        return;
      }
      const nextText = typeof data.donorChatText === 'string' ? data.donorChatText : '';
      setSavedDonorText(nextText);
      setDonorTextDraft(nextText);
      setDonorTextSavedFlash(true);
      window.setTimeout(() => setDonorTextSavedFlash(false), 1800);
      if (data.user && onGuestUserUpdated) {
        onGuestUserUpdated(data.user);
      }
    } catch {
      setError('Помилка мережі при збереженні тексту.');
    } finally {
      setSavingDonorText(false);
    }
  };

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distFromBottom < 80;
  };

  const sendViaHttp = async (params: {
    id: string;
    cleanText: string;
    replyToId: string | undefined;
    clientMessageId: string;
    token: string;
    skipFirestoreSync?: boolean;
  }) => {
    const res = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({
        id: params.id,
        text: params.cleanText,
        clientMessageId: params.clientMessageId,
        ...(params.replyToId ? { replyToId: params.replyToId } : {}),
        ...(params.skipFirestoreSync ? { skipFirestoreSync: true } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      message?: GlobalChatMessage;
      error?: string;
    };
    if (!res.ok) {
      pendingIdsRef.current.delete(params.id);
      if (!params.skipFirestoreSync) {
        setMessages((prev) => prev.filter((m) => m.id !== params.id));
        setError(data.error || 'Не вдалося надіслати повідомлення.');
      }
      return false;
    }
    if (data.message) {
      pendingIdsRef.current.delete(params.id);
      mergeIncomingMessagesRef.current([data.message], 'merge');
      window.requestAnimationFrame(() => scrollToBottom(true));
    }
    return true;
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    const cleanText = draft.trim();
    if (!cleanText) return;

    setError(null);
    shouldAutoScrollRef.current = true;

    const replyTarget = replyingTo;
    const replyToId = replyTarget?.id;
    const messageId = generateChatMessageId();
    pendingIdsRef.current.add(messageId);

    const optimisticMessage: GlobalChatMessage = {
      id: messageId,
      authorUid: guestUser.firebaseUid || guestUser.uid,
      authorName: guestUser.displayName || 'Читач',
      ...(guestUser.photoUrl ? { authorPhotoUrl: guestUser.photoUrl } : {}),
      ...(isAdmin ? { isAdmin: true } : {}),
      ...(liveBadges || guestUser.badges ? { authorBadges: liveBadges || guestUser.badges } : {}),
      ...(savedDonorText ? { authorDonorText: savedDonorText } : {}),
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

    // Instant UI update & clear input synchronously so rapid messaging has zero lag
    setMessages((prev) => {
      const next = [...prev, optimisticMessage].slice(-200);
      saveCachedGlobalChatState(next, authorMetaByUidRef.current);
      return next;
    });
    setDraft('');
    setReplyingTo(null);
    window.requestAnimationFrame(() => scrollToBottom(true));

    try {
      const directPromise = sendChatMessageDirectToFirestore({
        id: messageId,
        text: cleanText,
        authorName: guestUser.displayName || 'Читач',
        authorPhotoUrl: guestUser.photoUrl,
        isAdmin,
        replyTo: optimisticMessage.replyTo,
      });

      const tokenPromise = (async () => {
        let token = await getGuestToken();
        if (token?.startsWith('guest_v1.')) {
          const refreshed = await getGuestToken(true);
          if (refreshed) token = refreshed;
        }
        return token;
      })();

      const [directResult, token] = await Promise.all([directPromise, tokenPromise]);

      if (directResult.ok) {
        pendingIdsRef.current.delete(messageId);
        // Mirror to server memory / WS in background without duplicate Firestore write
        if (token) {
          const socket = wsRef.current;
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: 'chat:send',
                id: messageId,
                text: cleanText,
                clientMessageId: messageId,
                ...(replyToId ? { replyToId } : {}),
                skipFirestoreSync: true,
                token,
              })
            );
          } else {
            void sendViaHttp({
              id: messageId,
              cleanText,
              replyToId,
              clientMessageId: messageId,
              token,
              skipFirestoreSync: true,
            });
          }
        }
        return;
      }

      if (directResult.permissionDenied) {
        pendingIdsRef.current.delete(messageId);
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setDraft(cleanText);
        setError('Немає прав на надсилання повідомлення. Перезавантажте або увійдіть знову.');
        return;
      }

      if (!token) {
        pendingIdsRef.current.delete(messageId);
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setDraft(cleanText);
        setError('Сесія входу застаріла. Увійдіть повторно.');
        return;
      }

      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        const fallbackTimer = window.setTimeout(() => {
          pendingSendTimersRef.current.delete(messageId);
          void sendViaHttp({
            id: messageId,
            cleanText,
            replyToId,
            clientMessageId: messageId,
            token,
          });
        }, 450);
        pendingSendTimersRef.current.set(messageId, fallbackTimer);

        socket.send(
          JSON.stringify({
            type: 'chat:send',
            id: messageId,
            text: cleanText,
            clientMessageId: messageId,
            ...(replyToId ? { replyToId } : {}),
            token,
          })
        );
      } else {
        await sendViaHttp({
          id: messageId,
          cleanText,
          replyToId,
          clientMessageId: messageId,
          token,
        });
      }
    } catch {
      clearPendingTimer(messageId);
      pendingIdsRef.current.delete(messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      setError('Помилка мережі при надсиланні повідомлення.');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    setError(null);
    deletedIdsRef.current.add(id);
    pendingIdsRef.current.delete(id);

    const previousSnapshot = messages;
    setMessages((prev) => {
      const next = prev.filter((m) => m.id !== id);
      saveCachedGlobalChatState(next, authorMetaByUidRef.current);
      return next;
    });

    try {
      const [directDeleted, token] = await Promise.all([
        deleteChatMessageDirectInFirestore(id),
        getGuestToken().catch(() => null),
      ]);

      if (!directDeleted && !token) {
        deletedIdsRef.current.delete(id);
        setMessages(previousSnapshot);
        saveCachedGlobalChatState(previousSnapshot, authorMetaByUidRef.current);
        setError('Потрібна авторизація для видалення.');
        return;
      }

      if (token) {
        const res = await fetch(
          `/api/chat/messages/${encodeURIComponent(id)}${directDeleted ? '?skipFirestoreSync=1' : ''}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        if (!res.ok && !directDeleted) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          deletedIdsRef.current.delete(id);
          setMessages(previousSnapshot);
          saveCachedGlobalChatState(previousSnapshot, authorMetaByUidRef.current);
          setError(errData.error || 'Не вдалося видалити повідомлення.');
          return;
        }
      }
    } catch {
      deletedIdsRef.current.delete(id);
      setMessages(previousSnapshot);
      saveCachedGlobalChatState(previousSnapshot, authorMetaByUidRef.current);
      setError('Не вдалося видалити повідомлення.');
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/65 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-chat-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl bg-[#202020] rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[min(86dvh,640px)]"
      >
        {/* Header */}
        <div className="px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-2 bg-[#262626] shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#323232] flex items-center justify-center text-[#E5E5E5] shrink-0">
              <MessagesSquare className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="global-chat-title"
                className="text-base sm:text-lg font-bold text-[#FAF9F5] tracking-tight truncate"
              >
                Глобальний чат
              </h2>
              <p className="text-[11px] sm:text-xs text-[#C4BFB4] flex items-center gap-1.5 truncate">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                    wsStatus === 'connected' || firestoreConnected
                      ? 'bg-emerald-400'
                      : 'bg-amber-400 animate-pulse'
                  }`}
                />
                <span>
                  {wsStatus === 'connected' || firestoreConnected
                    ? `Онлайн: ${onlineCount}`
                    : wsStatus === 'reconnecting'
                      ? 'Перепідключення...'
                      : 'Підключення...'}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl hover:bg-white/10 flex items-center justify-center text-[#FAF9F5]/70 transition-colors cursor-pointer shrink-0"
            aria-label="Закрити чат"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Message List */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 space-y-2.5"
        >
          {loadingInitial && messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[#C4BFB4] animate-pulse">
              Завантаження чату...
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2 text-[#C4BFB4]">
              <MessagesSquare className="w-8 h-8 opacity-40" />
              <p className="text-sm font-medium text-[#F4F1EA]">Поки немає повідомлень</p>
              <p className="text-xs text-[#C4BFB4]">
                Напишіть першим, щоб почати спілкування з читачами сайту.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isOwn = Boolean(
                guestUser &&
                  (msg.authorUid === guestUser.uid ||
                    (guestUser.firebaseUid && msg.authorUid === guestUser.firebaseUid))
              );
              const canDelete = isOwn || isAdmin;
              const isConfirming = confirmDeleteId === msg.id;
              const isAdminMsg = Boolean(msg.isAdmin);
              const donorRank = !isAdminMsg ? msg.authorBadges?.donorRank : undefined;
              const isTop3Donor = donorRank === 1 || donorRank === 2 || donorRank === 3;
              const isTop1Activity = !isAdminMsg && msg.authorBadges?.activityRank === 1;
              const hasFramedCard = isTop3Donor || isTop1Activity;
              const hasDonorCustomText = Boolean(
                !isAdminMsg &&
                  isTop3Donor &&
                  msg.authorDonorText &&
                  msg.authorDonorText.trim()
              );

              const outerFrameClass =
                donorRank === 1
                  ? 'rounded-2xl p-[1.5px] bg-gradient-to-br from-[#FFF1B8] via-[#D4AF37] to-[#F5D061] shadow-[0_12px_32px_-12px_rgba(234,179,8,0.6)]'
                  : donorRank === 2
                    ? 'rounded-2xl p-[1.5px] bg-gradient-to-br from-[#F8FAFC] via-[#94A3B8] to-[#E2E8F0] shadow-[0_12px_30px_-12px_rgba(203,213,225,0.52)]'
                    : donorRank === 3
                      ? 'rounded-2xl p-[1.5px] bg-gradient-to-br from-[#F6C89F] via-[#B87333] to-[#E09F67] shadow-[0_12px_30px_-12px_rgba(217,119,6,0.5)]'
                      : 'rounded-2xl p-[1.5px] bg-gradient-to-br from-[#F3D999]/85 via-[#B8860B]/50 to-[#EBD08A]/80 shadow-[0_10px_28px_-14px_rgba(217,119,6,0.4)]';

              const innerSurfaceClass =
                donorRank === 1
                  ? 'relative rounded-[14.5px] bg-gradient-to-br from-[#352B14] via-[#272014] to-[#1D180F] ring-1 ring-inset ring-[#FFE89E]/35'
                  : donorRank === 2
                    ? 'relative rounded-[14.5px] bg-gradient-to-br from-[#2B313B] via-[#21262E] to-[#191C23] ring-1 ring-inset ring-[#E2E8F0]/30'
                    : donorRank === 3
                      ? 'relative rounded-[14.5px] bg-gradient-to-br from-[#332217] via-[#271B14] to-[#1E1510] ring-1 ring-inset ring-[#F3BC8D]/30'
                      : 'relative rounded-[14.5px] bg-gradient-to-br from-[#2B271E] via-[#24211B] to-[#1F1D18]';

              const filigreeCornerColor =
                donorRank === 1
                  ? 'border-[#FFE58F]/85'
                  : donorRank === 2
                    ? 'border-[#E2E8F0]/80'
                    : donorRank === 3
                      ? 'border-[#F3BC8D]/80'
                      : 'border-[#F3D999]/55';

              const avatarRingClass =
                donorRank === 1
                  ? 'ring-1 ring-[#FFE58F]/85 shadow-[0_0_14px_-3px_rgba(250,204,21,0.65)]'
                  : donorRank === 2
                    ? 'ring-1 ring-[#E2E8F0]/80 shadow-[0_0_12px_-3px_rgba(226,232,240,0.55)]'
                    : donorRank === 3
                      ? 'ring-1 ring-[#F3BC8D]/80 shadow-[0_0_12px_-3px_rgba(217,119,6,0.5)]'
                      : isTop1Activity
                        ? 'ring-1 ring-[#F3D999]/75 shadow-[0_0_12px_-3px_rgba(243,217,153,0.42)]'
                        : '';

              const donorCustomTextColorClass =
                donorRank === 1
                  ? 'text-[#FDE68A]'
                  : donorRank === 2
                    ? 'text-[#E2E8F0]'
                    : 'text-[#F6CFA9]';

              const messageCardBody = (
                <div
                  id={hasFramedCard ? undefined : `chat-msg-${msg.id}`}
                  className={`flex items-start gap-2.5 p-2.5 sm:p-3 transition-colors ${
                    hasFramedCard
                      ? innerSurfaceClass
                      : `rounded-xl ${isOwn && !isAdminMsg ? 'bg-[#303531]' : 'bg-[#262626]'}`
                  }`}
                >
                  {hasFramedCard && (
                    <>
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute top-1.5 left-1.5 w-2.5 h-2.5 border-t border-l rounded-tl-[5px] ${filigreeCornerColor}`}
                      />
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute top-1.5 right-1.5 w-2.5 h-2.5 border-t border-r rounded-tr-[5px] ${filigreeCornerColor}`}
                      />
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute bottom-1.5 left-1.5 w-2.5 h-2.5 border-b border-l rounded-bl-[5px] ${filigreeCornerColor}`}
                      />
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute bottom-1.5 right-1.5 w-2.5 h-2.5 border-b border-r rounded-br-[5px] ${filigreeCornerColor}`}
                      />
                    </>
                  )}

                  <div
                    className={`relative z-10 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#323232] flex items-center justify-center overflow-hidden text-[#E5E5E5] shrink-0 mt-0.5 ${avatarRingClass}`}
                  >
                    <ChatAvatar photoUrl={msg.authorPhotoUrl} />
                  </div>

                  <div className="relative z-10 min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="text-xs font-semibold text-[#FAF9F5] truncate max-w-full">
                          {msg.authorName}
                        </span>
                        {!isAdminMsg && <UserRankBadges badges={msg.authorBadges} size="xs" />}
                        {isAdminMsg && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E5E5E5] text-[#181818] font-semibold shrink-0">
                            Адмін
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-[#C4BFB4] tabular-nums whitespace-nowrap">
                          {formatMessageTime(msg.createdAt)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (!guestUser) {
                              onClose();
                              onOpenAuthModal();
                              return;
                            }
                            setReplyingTo(msg);
                            window.requestAnimationFrame(() => inputRef.current?.focus());
                          }}
                          title="Відповісти"
                          aria-label={`Відповісти ${msg.authorName}`}
                          className="p-1 rounded text-[#C4BFB4] hover:text-[#FAF9F5] hover:bg-white/10 transition-colors cursor-pointer"
                        >
                          <CornerUpLeft className="w-3.5 h-3.5" />
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(msg.id)}
                            className={`px-1 py-0.5 rounded transition-colors cursor-pointer ${
                              isConfirming
                                ? 'bg-red-500 text-white text-[10px] font-semibold px-1.5'
                                : 'text-[#C4BFB4] hover:text-red-400'
                            }`}
                            title={
                              isConfirming
                                ? 'Натисніть ще раз для видалення'
                                : 'Видалити повідомлення'
                            }
                            aria-label="Видалити повідомлення"
                          >
                            {isConfirming ? 'Видалити?' : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {hasDonorCustomText && (
                      <p className={`text-[11px] italic leading-snug break-words ${donorCustomTextColorClass}`}>
                        {msg.authorDonorText}
                      </p>
                    )}

                    {msg.replyTo && (
                      <button
                        type="button"
                        onClick={() => {
                          const targetEl = document.getElementById(`chat-msg-${msg.replyTo!.id}`);
                          targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg bg-black/28 border border-white/10 hover:bg-black/38 transition-colors cursor-pointer"
                      >
                        <span className="block text-[10px] font-semibold text-[#D6D3CB] truncate">
                          {msg.replyTo.authorName}
                        </span>
                        <span className="block text-[11px] text-[#C4BFB4] truncate">
                          {msg.replyTo.text}
                        </span>
                      </button>
                    )}
                    <p className="text-xs sm:text-[13px] text-[#F4F1EA] leading-relaxed break-words whitespace-pre-wrap">
                      {msg.text}
                    </p>
                  </div>
                </div>
              );

              if (hasFramedCard) {
                return (
                  <div
                    key={msg.id}
                    id={`chat-msg-${msg.id}`}
                    className={outerFrameClass}
                  >
                    {messageCardBody}
                  </div>
                );
              }

              return <div key={msg.id}>{messageCardBody}</div>;
            })
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-3 sm:mx-4 mb-2 px-3 py-2 rounded-xl bg-red-500/15 text-red-300 text-xs text-center">
            {error}
          </div>
        )}

        {/* Composer */}
        <div className="p-3 sm:p-4 bg-[#262626] border-t border-white/5 shrink-0 space-y-2.5">
          {canSetDonorText && (
            <form
              onSubmit={(e) => void handleSaveDonorText(e)}
              className="flex flex-col sm:flex-row sm:items-center gap-1.5 px-2.5 py-2 rounded-xl bg-[#1E1A1D] border border-[#F5C6CE]/20"
            >
              <label
                htmlFor="top3-donor-chat-text"
                className="text-[11px] font-medium text-[#F5C6CE] whitespace-nowrap shrink-0"
              >
                Топ-{effectiveDonorRank} донат · Ваш текст:
              </label>
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <input
                  id="top3-donor-chat-text"
                  type="text"
                  maxLength={80}
                  value={donorTextDraft}
                  onChange={(e) => setDonorTextDraft(e.target.value.slice(0, 80))}
                  placeholder="Введіть власний текст у чаті..."
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg bg-[#141414] focus:bg-[#232323] text-[#FAF9F5] placeholder:text-[#7E7B73] focus:outline-none transition-colors"
                />
                <button
                  type="submit"
                  disabled={savingDonorText || donorTextDraft.trim() === savedDonorText.trim()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#E5E5E5] text-[#181818] text-[11px] font-semibold hover:opacity-95 transition-opacity whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:pointer-events-none"
                >
                  {donorTextSavedFlash ? (
                    <>
                      <Check className="w-3 h-3" />
                      <span>Збережено</span>
                    </>
                  ) : (
                    <span>{savingDonorText ? '...' : 'Зберегти'}</span>
                  )}
                </button>
              </div>
            </form>
          )}
          {guestUser ? (
            <form onSubmit={(e) => void handleSend(e)} className="space-y-2">
              {replyingTo && (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-[#1C1C1C] border border-white/10">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold text-[#E5E5E5] flex items-center gap-1 truncate">
                      <CornerUpLeft className="w-3 h-3 shrink-0" />
                      <span>Відповідь для {replyingTo.authorName}</span>
                    </p>
                    <p className="text-[11px] text-[#C4BFB4] truncate">{replyingTo.text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    aria-label="Скасувати відповідь"
                    className="p-1 rounded-lg text-[#C4BFB4] hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 600))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={
                    replyingTo
                      ? `Відповісти ${replyingTo.authorName}...`
                      : 'Напишіть повідомлення...'
                  }
                  rows={1}
                  className="flex-1 min-w-0 max-h-28 px-3.5 py-2.5 text-xs sm:text-sm rounded-xl bg-[#1C1C1C] focus:bg-[#2F2F2F] text-[#FAF9F5] placeholder:text-[#7E7B73] focus:outline-none transition-colors resize-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label="Надіслати повідомлення"
                  className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#E5E5E5] text-[#181818] hover:opacity-95 transition-opacity shrink-0 cursor-pointer disabled:opacity-45 disabled:pointer-events-none"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              {draft.length > 480 && (
                <p className="text-[10px] text-[#C4BFB4] text-right tabular-nums">
                  {draft.length} / 600
                </p>
              )}
            </form>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[#C4BFB4]">
                Увійдіть в акаунт, щоб писати в чат
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuthModal();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E5E5E5] text-[#181818] text-xs font-semibold hover:opacity-95 transition-opacity shrink-0 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Увійти</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
