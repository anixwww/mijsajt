import { useCallback, useEffect, useMemo, type MutableRefObject } from 'react';
import { testFirestoreConnection } from '../firebase.ts';
import { useAuthStore } from '../store/useAuthStore.ts';
import { useUiStore } from '../store/useUiStore.ts';
import type { FeedbackRecord, GlobalChatMessage } from '../types.ts';
import { prewarmChatFirestore, subscribeGlobalChatMessages } from '../utils/chatFirestore.ts';
import {
  mergeSiteFeedbackLists,
  subscribeUserSiteFeedback,
} from '../utils/feedbackFirestore.ts';

interface UseUserRealtimeSyncOptions {
  getGuestToken: (forceRefresh?: boolean) => Promise<string | null>;
  guestSessionTokenRef: MutableRefObject<string | null>;
}

export function useUserRealtimeSync({
  getGuestToken,
  guestSessionTokenRef,
}: UseUserRealtimeSyncOptions) {
  const guestUser = useAuthStore((s) => s.guestUser);
  const hasFirebaseSession = useAuthStore((s) => s.hasFirebaseSession);
  const mySiteFeedback = useAuthStore((s) => s.mySiteFeedback);
  const setHasUnreadReply = useAuthStore((s) => s.setHasUnreadReply);
  const setMySiteFeedback = useAuthStore((s) => s.setMySiteFeedback);

  const chatOpen = useUiStore((s) => s.chatOpen);
  const setChatOpen = useUiStore((s) => s.setChatOpen);

  // Unread reply indicator polling / Firestore subscription
  useEffect(() => {
    if (!guestUser?.uid || chatOpen) {
      setHasUnreadReply(false);
      return;
    }
    let active = true;
    let unsubscribeFs: () => void = () => {};
    let fallbackTimer: number | null = null;
    let idleHandle: number | null = null;

    const runChatSub = () => {
      if (!active) return;
      prewarmChatFirestore();

      const ownUids = new Set(
        [guestUser.uid, guestUser.firebaseUid].filter((v): v is string => Boolean(v))
      );

      const evaluateMessages = (list: GlobalChatMessage[]) => {
        if (!active) return;
        const lastReadTime = Number(localStorage.getItem('dankiv_last_read_chat_reply') || '0');
        const hasUnread = list.some((msg) => {
          if (!msg.replyTo) return false;
          if (!ownUids.has(msg.replyTo.authorUid)) return false;
          if (ownUids.has(msg.authorUid)) return false;
          const msgTime = new Date(msg.createdAt).getTime();
          return msgTime > lastReadTime;
        });
        setHasUnreadReply(hasUnread);
      };

      const startFallbackPoll = () => {
        if (fallbackTimer !== null) return;
        const checkReplies = async () => {
          try {
            const token =
              guestSessionTokenRef.current || (await getGuestToken().catch(() => null));
            const headers: Record<string, string> = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch('/api/chat/messages', { headers });
            if (!res.ok) return;
            const json = await res.json();
            if (active && Array.isArray(json.messages)) {
              evaluateMessages(json.messages as GlobalChatMessage[]);
            }
          } catch {
            // Ignore
          }
        };
        void checkReplies();
        fallbackTimer = window.setInterval(() => {
          if (document.visibilityState === 'hidden') return;
          if (document.visibilityState === 'visible') {
            void checkReplies();
          }
        }, 30000);
      };

      void subscribeGlobalChatMessages({
        limitCount: 30,
        onMessages: (fsMessages) => {
          evaluateMessages(fsMessages);
        },
        onError: () => {
          startFallbackPoll();
        },
      }).then((unsub) => {
        if (!active) {
          unsub();
        } else {
          unsubscribeFs = unsub;
        }
      });
    };

    if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
      idleHandle = (window as any).requestIdleCallback(
        () => {
          if (active) runChatSub();
        },
        { timeout: 4000 }
      );
    } else {
      idleHandle = window.setTimeout(() => {
        if (active) runChatSub();
      }, 1500) as any;
    }

    return () => {
      active = false;
      if (
        typeof window !== 'undefined' &&
        typeof (window as any).cancelIdleCallback === 'function' &&
        typeof idleHandle === 'number'
      ) {
        (window as any).cancelIdleCallback(idleHandle);
      } else if (idleHandle !== null) {
        window.clearTimeout(idleHandle as number);
      }
      unsubscribeFs();
      if (fallbackTimer !== null) {
        window.clearInterval(fallbackTimer);
      }
    };
  }, [
    guestUser?.uid,
    guestUser?.firebaseUid,
    chatOpen,
    getGuestToken,
    guestSessionTokenRef,
    setHasUnreadReply,
  ]);

  const handleOpenChatModal = useCallback(() => {
    setChatOpen(true);
    localStorage.setItem('dankiv_last_read_chat_reply', Date.now().toString());
    setHasUnreadReply(false);
  }, [setChatOpen, setHasUnreadReply]);

  // Sync user's own site feedback & unread admin replies (Firestore realtime + API polling)
  useEffect(() => {
    if (!guestUser?.uid) {
      setMySiteFeedback([]);
      return;
    }
    let active = true;
    let unsubscribeFs = () => {};

    const syncFromApi = async () => {
      try {
        const token = await getGuestToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/feedback/my', {
          credentials: 'include',
          headers,
        });
        if (!active || !res.ok) return;
        const data = (await res.json()) as { feedback?: FeedbackRecord[] };
        if (active && Array.isArray(data.feedback)) {
          setMySiteFeedback((prev) => mergeSiteFeedbackLists(data.feedback!, prev));
        }
      } catch {
        // Ignore transient polling failures
      }
    };

    void syncFromApi();

    const fbUid = guestUser.firebaseUid;
    if (hasFirebaseSession && fbUid) {
      void subscribeUserSiteFeedback({
        firebaseUid: fbUid,
        onItems: (fsItems) => {
          if (!active) return;
          setMySiteFeedback((prev) => mergeSiteFeedbackLists(fsItems, prev));
        },
      }).then((unsub) => {
        if (active) {
          unsubscribeFs = unsub;
        } else {
          unsub();
        }
      });
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncFromApi();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (document.visibilityState === 'visible') {
        void syncFromApi();
      }
    }, 45000);

    return () => {
      active = false;
      unsubscribeFs();
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
    };
  }, [guestUser?.uid, guestUser?.firebaseUid, hasFirebaseSession, getGuestToken, setMySiteFeedback]);

  const unreadFeedbackRepliesCount = useMemo(
    () =>
      mySiteFeedback.filter(
        (item) => Boolean(item.adminReply?.trim()) && item.readByUser === false
      ).length,
    [mySiteFeedback]
  );

  useEffect(() => {
    if (!guestUser?.uid) return;
    const sendHeartbeat = async () => {
      if (document.visibilityState !== 'visible') return;
      const token = (await getGuestToken().catch(() => null)) || guestSessionTokenRef.current;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch('/api/users/time-heartbeat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ uid: guestUser.uid, seconds: 90 }),
      }).catch(() => {});
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void sendHeartbeat();
    }, 90000);
    return () => window.clearInterval(interval);
  }, [guestUser?.uid, getGuestToken, guestSessionTokenRef]);

  useEffect(() => {
    let idleHandle: number | null = null;
    let timer: number | null = null;

    const runPrewarm = () => {
      void testFirestoreConnection();
      timer = window.setTimeout(() => prewarmChatFirestore(), 1500);
    };

    if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
      idleHandle = (window as any).requestIdleCallback(runPrewarm, { timeout: 5000 });
    } else {
      idleHandle = window.setTimeout(runPrewarm, 2500) as any;
    }

    return () => {
      if (
        typeof window !== 'undefined' &&
        'cancelIdleCallback' in window &&
        typeof idleHandle === 'number'
      ) {
        window.cancelIdleCallback(idleHandle);
      } else if (idleHandle !== null) {
        window.clearTimeout(idleHandle as number);
      }
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  return {
    unreadFeedbackRepliesCount,
    handleOpenChatModal,
  };
}
