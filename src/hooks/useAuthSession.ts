import { useCallback, useEffect, useRef } from 'react';
import { getCachedAuthUser, getFirebaseAuth } from '../firebase.ts';
import {
  TELEGRAM_SUB_STORAGE_KEY,
  useAuthStore,
  writeRememberedGuestHint,
} from '../store/useAuthStore.ts';
import { useUiStore } from '../store/useUiStore.ts';
import type { GuestUser, TelegramSubscriptionState } from '../types.ts';
import { readLocalUserLikedPoemIds, writeLocalUserLikedPoemIds } from '../utils/offlineCache.ts';

const LEGACY_GUEST_STORAGE_KEY = 'dankiv_guest_user_v1';

export function useAuthSession() {
  const guestSessionToken = useAuthStore((s) => s.guestSessionToken);
  const telegramSubscription = useAuthStore((s) => s.telegramSubscription);
  const setGuestUser = useAuthStore((s) => s.setGuestUser);
  const setRememberedGuest = useAuthStore((s) => s.setRememberedGuest);
  const setIsAdmin = useAuthStore((s) => s.setIsAdmin);
  const setHasFirebaseSession = useAuthStore((s) => s.setHasFirebaseSession);
  const setRequiresGoogleForAdmin = useAuthStore((s) => s.setRequiresGoogleForAdmin);
  const setTelegramSubscription = useAuthStore((s) => s.setTelegramSubscription);
  const setGuestSessionToken = useAuthStore((s) => s.setGuestSessionToken);
  const setAuthorStudioOpen = useUiStore((s) => s.setAuthorStudioOpen);

  const guestSessionTokenRef = useRef<string | null>(guestSessionToken);
  guestSessionTokenRef.current = guestSessionToken;
  const firebaseSignedInRef = useRef(false);
  const authObserverStartedRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_GUEST_STORAGE_KEY);
    } catch {
      // Clean up legacy key if present
    }
  }, []);

  const handleTelegramVerified = useCallback(
    (next: TelegramSubscriptionState) => {
      setTelegramSubscription(next);
      try {
        if (next.subscribed && next.token) {
          localStorage.setItem(TELEGRAM_SUB_STORAGE_KEY, JSON.stringify(next));
        } else {
          localStorage.removeItem(TELEGRAM_SUB_STORAGE_KEY);
        }
      } catch {
        // Ignore storage errors
      }
    },
    [setTelegramSubscription]
  );

  const handleClearTelegramVerification = useCallback(() => {
    setTelegramSubscription((prev) => ({
      subscribed: false,
      channelLabel: prev.channelLabel,
      channelUrl: prev.channelUrl,
    }));
    try {
      localStorage.removeItem(TELEGRAM_SUB_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }, [setTelegramSubscription]);

  useEffect(() => {
    const token = telegramSubscription.token;
    if (!token) return;
    let active = true;
    fetch('/api/telegram/status', {
      headers: { 'X-Telegram-Discount-Token': token },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { subscription?: TelegramSubscriptionState } | null) => {
        if (!active || !data?.subscription) return;
        if (data.subscription.subscribed) {
          handleTelegramVerified({ ...data.subscription, token });
        } else {
          handleClearTelegramVerification();
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [telegramSubscription.token, handleTelegramVerified, handleClearTelegramVerification]);

  const getAdminToken = useCallback(async (forceRefresh = false): Promise<string | null> => {
    try {
      const cachedUser = getCachedAuthUser();
      if (cachedUser) {
        try {
          return await cachedUser.getIdToken(forceRefresh);
        } catch {
          return forceRefresh ? null : await cachedUser.getIdToken(true);
        }
      }
      const auth = await getFirebaseAuth();
      await auth.authStateReady().catch(() => {});
      if (!auth.currentUser) return null;
      try {
        return await auth.currentUser.getIdToken(forceRefresh);
      } catch {
        return forceRefresh ? null : await auth.currentUser.getIdToken(true);
      }
    } catch {
      return null;
    }
  }, []);

  const getGuestToken = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      const firebaseToken = await getAdminToken(forceRefresh);
      if (firebaseToken) {
        return firebaseToken;
      }
      return guestSessionTokenRef.current || useAuthStore.getState().guestSessionToken;
    },
    [getAdminToken]
  );

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    const restoreRememberedCookieSession = async () => {
      try {
        const res = await fetch('/api/guest/session', {
          method: 'GET',
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!active || !res.ok) return;
        const data = (await res.json()) as {
          authenticated?: boolean;
          user?: GuestUser | null;
          isAdmin?: boolean;
          requiresGoogleForAdmin?: boolean;
        };
        if (!active || !data.authenticated || !data.user) return;
        if (firebaseSignedInRef.current) return;
        const cleanUser: GuestUser = { ...data.user, sessionToken: undefined };
        writeLocalUserLikedPoemIds(cleanUser.email, cleanUser.likedPoemIds ?? []);
        const nextTok = data.user.sessionToken || null;
        guestSessionTokenRef.current = nextTok;
        setGuestSessionToken(nextTok);
        setRequiresGoogleForAdmin(Boolean(data.requiresGoogleForAdmin));
        setGuestUser(cleanUser);
        setRememberedGuest(writeRememberedGuestHint(cleanUser));
      } catch {
        // Ignore transient session check errors
      }
    };

    void restoreRememberedCookieSession();

    const attachAuthObserver = async () => {
      if (authObserverStartedRef.current) return;
      authObserverStartedRef.current = true;
      try {
        const [
          auth,
          { browserPopupRedirectResolver, getRedirectResult, onAuthStateChanged },
        ] = await Promise.all([getFirebaseAuth(), import('firebase/auth')]);
        await auth.authStateReady().catch(() => {});
        await getRedirectResult(auth, browserPopupRedirectResolver).catch(() => null);
        if (!active) return;

        unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
          firebaseSignedInRef.current = Boolean(fbUser);
          setHasFirebaseSession(Boolean(fbUser));
          if (fbUser) {
            setRequiresGoogleForAdmin(false);
            try {
              let token = await fbUser.getIdToken();
              const fallbackLikedPoemIds = readLocalUserLikedPoemIds(fbUser.email);
              const postGoogleSession = (idToken: string) =>
                fetch('/api/guest/google-session', {
                  method: 'POST',
                  credentials: 'include',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    Authorization: `Bearer ${idToken}`,
                  },
                  body: JSON.stringify(
                    fallbackLikedPoemIds.length > 0 ? { fallbackLikedPoemIds } : {}
                  ),
                });
              let sessionRes = await postGoogleSession(token);
              if (sessionRes.status === 401) {
                token = await fbUser.getIdToken(true);
                sessionRes = await postGoogleSession(token);
              }
              if (!active) return;
              if (sessionRes.ok) {
                const sessionData = (await sessionRes.json()) as {
                  user?: GuestUser;
                  isAdmin?: boolean;
                };
                if (sessionData.user) {
                  const cleanUser: GuestUser = {
                    ...sessionData.user,
                    sessionToken: undefined,
                  };
                  writeLocalUserLikedPoemIds(cleanUser.email, cleanUser.likedPoemIds ?? []);
                  const nextTok = sessionData.user.sessionToken || null;
                  guestSessionTokenRef.current = nextTok;
                  setGuestSessionToken(nextTok);
                  setIsAdmin(Boolean(sessionData.isAdmin));
                  if (!sessionData.isAdmin) {
                    setAuthorStudioOpen(false);
                  }
                  setGuestUser(cleanUser);
                  setRememberedGuest(writeRememberedGuestHint(cleanUser));
                  return;
                }
              }

              if (sessionRes.status === 401 || sessionRes.status === 403) {
                return;
              }

              const roleRes = await fetch('/api/auth/role', {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!active) return;
              const roleData = roleRes.ok
                ? ((await roleRes.json()) as { isAdmin?: boolean })
                : { isAdmin: false };
              setIsAdmin(Boolean(roleData.isAdmin));
              setGuestUser((prev) => {
                const preservedLikes =
                  prev?.likedPoemIds && prev.likedPoemIds.length > 0
                    ? prev.likedPoemIds
                    : readLocalUserLikedPoemIds(fbUser.email);
                const fallbackUser: GuestUser = {
                  uid: fbUser.uid,
                  displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Читач',
                  email: fbUser.email || '',
                  photoUrl: fbUser.photoURL || undefined,
                  provider: 'google',
                  likedPoemIds: preservedLikes,
                };
                setRememberedGuest(writeRememberedGuestHint(fallbackUser));
                return fallbackUser;
              });
            } catch {
              if (active) {
                setIsAdmin(false);
                setAuthorStudioOpen(false);
              }
            }
          } else {
            if (!guestSessionTokenRef.current) {
              setIsAdmin(false);
              setAuthorStudioOpen(false);
              setGuestUser(null);
            }
          }
        });
      } catch {
        authObserverStartedRef.current = false;
      }
    };

    void attachAuthObserver();

    return () => {
      active = false;
      unsubscribe?.();
      authObserverStartedRef.current = false;
    };
  }, [
    setAuthorStudioOpen,
    setGuestSessionToken,
    setGuestUser,
    setHasFirebaseSession,
    setIsAdmin,
    setRememberedGuest,
    setRequiresGoogleForAdmin,
  ]);

  const handleAuthenticatedGuest = useCallback(
    (
      user: GuestUser,
      options?: { isAdmin?: boolean; sessionToken?: string; requiresGoogleForAdmin?: boolean }
    ) => {
      const cleanUser: GuestUser = { ...user, sessionToken: undefined };
      writeLocalUserLikedPoemIds(cleanUser.email, cleanUser.likedPoemIds ?? []);
      if (options?.sessionToken || user.sessionToken) {
        const tok = options?.sessionToken || user.sessionToken || null;
        guestSessionTokenRef.current = tok;
        setGuestSessionToken(tok);
      }
      if (typeof options?.isAdmin === 'boolean') {
        setIsAdmin(options.isAdmin);
        if (!options.isAdmin) {
          setAuthorStudioOpen(false);
        }
      }
      if (typeof options?.requiresGoogleForAdmin === 'boolean') {
        setRequiresGoogleForAdmin(options.requiresGoogleForAdmin);
      }
      setGuestUser(cleanUser);
      setRememberedGuest(writeRememberedGuestHint(cleanUser));
    },
    [
      setAuthorStudioOpen,
      setGuestSessionToken,
      setGuestUser,
      setIsAdmin,
      setRememberedGuest,
      setRequiresGoogleForAdmin,
    ]
  );

  const handleGuestUserUpdated = useCallback(
    (user: GuestUser) => {
      const cleanUser: GuestUser = { ...user, sessionToken: undefined };
      writeLocalUserLikedPoemIds(cleanUser.email, cleanUser.likedPoemIds ?? []);
      setGuestUser(cleanUser);
      setRememberedGuest(writeRememberedGuestHint(cleanUser));
    },
    [setGuestUser, setRememberedGuest]
  );

  const handleForgetRememberedGuest = useCallback(() => {
    try {
      localStorage.removeItem('dankiv_guest_hint_v1');
    } catch {
      // Ignore storage errors
    }
    setRememberedGuest(null);
  }, [setRememberedGuest]);

  const handleLogoutGuest = useCallback(
    async (mode: 'lock' | 'forget' = 'lock') => {
      guestSessionTokenRef.current = null;
      setGuestSessionToken(null);
      firebaseSignedInRef.current = false;
      setHasFirebaseSession(false);
      setRequiresGoogleForAdmin(false);
      try {
        await fetch('/api/guest/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
      } catch {
        // Ignore cookie clear network errors
      }
      try {
        const [auth, { signOut }] = await Promise.all([getFirebaseAuth(), import('firebase/auth')]);
        if (auth.currentUser) {
          await signOut(auth);
        }
      } catch {
        // Ignore Firebase signOut failure
      }
      setGuestUser(null);
      setIsAdmin(false);
      setAuthorStudioOpen(false);
      if (mode === 'forget') {
        handleForgetRememberedGuest();
      }
    },
    [
      handleForgetRememberedGuest,
      setAuthorStudioOpen,
      setGuestSessionToken,
      setGuestUser,
      setHasFirebaseSession,
      setIsAdmin,
      setRequiresGoogleForAdmin,
    ]
  );

  return {
    getAdminToken,
    getGuestToken,
    guestSessionTokenRef,
    handleTelegramVerified,
    handleClearTelegramVerification,
    handleAuthenticatedGuest,
    handleGuestUserUpdated,
    handleForgetRememberedGuest,
    handleLogoutGuest,
  };
}
