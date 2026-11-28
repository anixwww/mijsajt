import { BellRing, Trophy, X } from 'lucide-react';
import { AnimatePresence, LazyMotion, m, MotionConfig } from 'motion/react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HeroSection } from './components/HeroSection.tsx';
import { HomeShowcaseSection } from './components/HomeShowcaseSection.tsx';
import { MinimizedRadioButton } from './components/MinimizedRadioButton.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { PoetrySpaceBackdrop } from './components/PoetrySpaceBackdrop.tsx';
import { SectionSkeleton } from './components/SectionSkeleton.tsx';
import { SiteBottomNav } from './components/SiteBottomNav.tsx';
import { FALLBACK_SOCIAL_LINKS } from './components/SocialIcons.tsx';
import { UserLeaderboardModal } from './components/UserLeaderboardModal.tsx';
import { GlobalChatModal } from './components/GlobalChatModal.tsx';
import { MusicSelectionsModal } from './components/MusicSelectionsModal.tsx';
import { FirstVisitAuthHint } from './components/FirstVisitAuthHint.tsx';
import { prewarmChatFirestore, subscribeGlobalChatMessages } from './utils/chatFirestore.ts';
import {
  mergeSiteFeedbackLists,
  subscribeUserSiteFeedback,
} from './utils/feedbackFirestore.ts';

const loadMotionFeatures = () => import('motion/react').then((mod) => mod.domMax);

const loadPoetrySection = () => import('./components/PoetrySection.tsx');
const loadProseSection = () => import('./components/ProseSection.tsx');
const loadBlogSection = () => import('./components/BlogSection.tsx');
const loadRadioSection = () => import('./components/RadioSection.tsx');
const loadStoreSection = () => import('./components/StoreSection.tsx');

const AuthorStudioModal = lazy(() =>
  import('./components/AuthorStudioModal.tsx').then((m) => ({ default: m.AuthorStudioModal }))
);
const BlogSection = lazy(() =>
  loadBlogSection().then((m) => ({ default: m.BlogSection }))
);
const CartLibraryDrawer = lazy(() =>
  import('./components/CartLibraryDrawer.tsx').then((m) => ({ default: m.CartLibraryDrawer }))
);
const GuestAuthModal = lazy(() =>
  import('./components/GuestAuthModal.tsx').then((m) => ({ default: m.GuestAuthModal }))
);
const PoetrySection = lazy(() =>
  loadPoetrySection().then((m) => ({ default: m.PoetrySection }))
);
const ProseSection = lazy(() =>
  loadProseSection().then((m) => ({ default: m.ProseSection }))
);
const RadioSection = lazy(() =>
  loadRadioSection().then((m) => ({ default: m.RadioSection }))
);
const StoreSection = lazy(() =>
  loadStoreSection().then((m) => ({ default: m.StoreSection }))
);
const TelegramVerifyModal = lazy(() =>
  import('./components/TelegramVerifyModal.tsx').then((m) => ({ default: m.TelegramVerifyModal }))
);
import { getCachedAuthUser, getFirebaseAuth, testFirestoreConnection } from './firebase.ts';
import {
  type CatalogResponse,
  type FeedbackRecord,
  type GuestUser,
  type HomePayload,
  type HomeRepeatersConfig,
  type InterviewLinkItem,
  type Poem,
  type ProseWork,
  type PurchasedAccess,
  type RadioStationId,
  type RadioTrack,
  type RememberedGuestHint,
  type SectionId,
  type SocialLinkItem,
  type StoreProduct,
  type TelegramSubscriptionState,
  type GlobalChatMessage,
  type WeeklyMusicSelection,
} from './types.ts';
import { initBehaviorAnalytics, setActiveMoment, trackClick } from './utils/analytics.ts';
import { initGlobalButtonHaptics } from './utils/haptics.ts';
import {
  collectCatalogMediaUrls,
  readLocalUserLikedPoemIds,
  readOfflineCatalog,
  saveOfflineCatalog,
  warmOfflineMediaCache,
  writeLocalUserLikedPoemIds,
} from './utils/offlineCache.ts';
import { sanitizePurchasedAccessForDevice } from './utils/paymentCrypto.ts';
import {
  hasRadioTelemetryWaveform,
  setRadioTelemetryWaveform,
  updateRadioTelemetryPlayback,
} from './utils/radioAudioTelemetry.ts';
import {
  subscribeRadioTracks,
  syncLegacyServerTracksToFirestore,
} from './utils/radioFirestore.ts';
import {
  annotateAllRadioTracksWithRepertoire,
  getSavedRadioTracks,
  selectRadioStationRepertoire,
} from './utils/radioRepertoire.ts';
import {
  sortWeeklyMusicSelections,
  subscribeWeeklyMusicSelections,
} from './utils/weeklyMusicFirestore.ts';
import {
  fetchSoundCloudWaveform,
  getSoundCloudPlayerSrc,
  loadSoundCloudWidgetApi,
  type SCPlayProgressPayload,
  type SCWidgetInstance,
} from './utils/soundcloudWidget.ts';

const CART_STORAGE_KEY = 'dankiv_cart_ids_v1';
const UNLOCKED_STORAGE_KEY = 'dankiv_unlocked_access_v1';
const GUEST_HINT_STORAGE_KEY = 'dankiv_guest_hint_v1';
const LEGACY_GUEST_STORAGE_KEY = 'dankiv_guest_user_v1';
const HOME_SHELL_STORAGE_KEY = 'dankiv_home_shell_v1';
const RADIO_ENABLED_STORAGE_KEY = 'dankiv_radio_enabled_v1';
const TELEGRAM_SUB_STORAGE_KEY = 'dankiv_tg_subscription_v1';
const FALLBACK_AUTHOR_PHOTO_URL = '/src/assets/images/author_portrait_desk_1795025673568.webp';
const FALLBACK_AUTHOR_ABOUT_TEXT = '';

const VALID_SECTIONS: SectionId[] = ['home', 'poetry', 'prose', 'blog', 'radio', 'store'];

function parseLocationHash(): { section: SectionId; itemId: string | null; isSecretAuth: boolean } {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return { section: 'home', itemId: null, isSecretAuth: false };
  const [sectionPart, itemPart] = raw.split('/');
  if (sectionPart === 'admin' || sectionPart === 'login') {
    return { section: 'home', itemId: null, isSecretAuth: true };
  }
  const section = VALID_SECTIONS.includes(sectionPart as SectionId)
    ? (sectionPart as SectionId)
    : 'home';
  return {
    section,
    itemId: itemPart ? decodeURIComponent(itemPart) : null,
    isSecretAuth: false,
  };
}

const SECTION_TRANSITION_VARIANTS = {
  initial: {
    opacity: 0,
    y: 6,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.14,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
};

const HOME_TRANSITION_VARIANTS = {
  initial: {
    opacity: 0,
  },
  animate: {
    opacity: 1,
    transition: {
      duration: 0.14,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
};

function readCachedHomeShell(): HomePayload | null {
  try {
    const raw = localStorage.getItem(HOME_SHELL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HomePayload;
    return typeof parsed?.heroLeadText === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedHomeShell(payload: HomePayload): void {
  try {
    const compact: HomePayload = {
      heroLeadText: payload.heroLeadText,
      authorAboutText: payload.authorAboutText,
      authorPhotoUrl: payload.authorPhotoUrl,
      authorPhotos: payload.authorPhotos,
      socialLinks: payload.socialLinks,
      monobankJarUrl: payload.monobankJarUrl,
      monobankModalTitle: payload.monobankModalTitle,
      monobankModalSubtitle: payload.monobankModalSubtitle,
      monobankCardLabel: payload.monobankCardLabel,
      monobankModalText: payload.monobankModalText,
      monobankEmptyText: payload.monobankEmptyText,
      contactEmail: payload.contactEmail,
      interviews: payload.interviews,
      homeActionAboutTitle: payload.homeActionAboutTitle,
      homeActionContactTitle: payload.homeActionContactTitle,
      homeActionMonobankTitle: payload.homeActionMonobankTitle,
      homeActionInterviewsTitle: payload.homeActionInterviewsTitle,
      homeRepeaters: payload.homeRepeaters,
      proseAuthDiscountPercent: payload.proseAuthDiscountPercent,
      storeAuthDiscountPercent: payload.storeAuthDiscountPercent,
      uniqueVisitors: payload.uniqueVisitors,
    };
    localStorage.setItem(HOME_SHELL_STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // Ignore storage quota errors
  }
}

function readRememberedGuestHint(): RememberedGuestHint | null {
  try {
    const raw = localStorage.getItem(GUEST_HINT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedGuestHint>;
    if (!parsed || typeof parsed.email !== 'string' || typeof parsed.displayName !== 'string') {
      return null;
    }
    return {
      uid: typeof parsed.uid === 'string' ? parsed.uid : '',
      displayName: parsed.displayName,
      email: parsed.email,
      photoUrl: typeof parsed.photoUrl === 'string' ? parsed.photoUrl : undefined,
      hasPin: Boolean(parsed.hasPin),
    };
  } catch {
    return null;
  }
}

function writeRememberedGuestHint(user: GuestUser): RememberedGuestHint {
  const hint: RememberedGuestHint = {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoUrl: user.photoUrl,
    hasPin: Boolean(user.hasPin),
  };
  try {
    localStorage.setItem(GUEST_HINT_STORAGE_KEY, JSON.stringify(hint));
  } catch {
    // Ignore storage errors
  }
  return hint;
}

export default function App() {
  const initialLocation = useMemo(() => parseLocationHash(), []);
  const initialSecretSearch = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('admin') === '1' || params.get('auth') === '1';
  }, []);
  const [homeShell, setHomeShell] = useState<HomePayload | null>(() => readCachedHomeShell());
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(() =>
    initialLocation.section === 'home' ? !readCachedHomeShell() : true
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const [uniqueVisitors, setUniqueVisitors] = useState<number>(
    () => readCachedHomeShell()?.uniqueVisitors ?? 1
  );
  const [activeSection, setActiveSection] = useState<SectionId>(initialLocation.section);
  const [poetryBackdropStyle, setPoetryBackdropStyle] = useState<{
    backgroundColor?: string;
    backgroundImage?: string;
  } | null>(null);
  const [proseHomeBackdrop, setProseHomeBackdrop] = useState(false);
  const [poetryImmersionMode, setPoetryImmersionMode] = useState(false);
  const [poetrySpaceState, setPoetrySpaceState] = useState<{
    accentColor?: string;
    swipeKey?: string;
    swipeDirection: number;
  }>({ swipeDirection: 1 });
  const [deepLinkItemId, setDeepLinkItemId] = useState<string | null>(initialLocation.itemId);

  const isPoetryImmersed = activeSection === 'poetry' && poetryImmersionMode;

  useEffect(() => {
    if (activeSection !== 'poetry' && poetryImmersionMode) {
      setPoetryImmersionMode(false);
    }
  }, [activeSection, poetryImmersionMode]);

  const handleTogglePoetryImmersion = useCallback(() => {
    setPoetryImmersionMode((prev) => !prev);
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'cart' | 'library'>('cart');
  const [authorStudioOpen, setAuthorStudioOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(
    initialLocation.isSecretAuth || initialSecretSearch
  );
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [telegramSubscription, setTelegramSubscription] = useState<TelegramSubscriptionState>(() => {
    try {
      const raw = localStorage.getItem(TELEGRAM_SUB_STORAGE_KEY);
      if (!raw) return { subscribed: false };
      const parsed = JSON.parse(raw) as TelegramSubscriptionState;
      if (parsed && typeof parsed.token === 'string' && parsed.token.startsWith('tgsub_v1.')) {
        return { ...parsed, subscribed: Boolean(parsed.subscribed) };
      }
    } catch {
      // Ignore storage errors
    }
    return { subscribed: false };
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [newWorkNotification, setNewWorkNotification] = useState<{
    section: 'poetry' | 'prose' | 'blog' | 'store';
    itemId: string;
    kindLabel: string;
    title: string;
  } | null>(null);
  const newWorkToastTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('dark');
    try {
      localStorage.removeItem('dankiv_theme_dark');
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleTelegramVerified = useCallback((next: TelegramSubscriptionState) => {
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
  }, []);

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
  }, []);

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

  const [guestUser, setGuestUser] = useState<GuestUser | null>(null);
  const [rememberedGuest, setRememberedGuest] = useState<RememberedGuestHint | null>(() =>
    readRememberedGuestHint()
  );
  const [hasFirebaseSession, setHasFirebaseSession] = useState(false);
  const [requiresGoogleForAdmin, setRequiresGoogleForAdmin] = useState(false);
  const guestSessionTokenRef = useRef<string | null>(null);
  const firebaseSignedInRef = useRef(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [musicSelectionsOpen, setMusicSelectionsOpen] = useState(false);
  const [hasUnreadReply, setHasUnreadReply] = useState(false);
  const [mySiteFeedback, setMySiteFeedback] = useState<FeedbackRecord[]>([]);

  useEffect(() => {
    if (!guestUser?.uid || chatOpen) {
      if (chatOpen) setHasUnreadReply(false);
      if (!guestUser?.uid) setHasUnreadReply(false);
      return;
    }
    let active = true;
    let unsubscribeFs: () => void = () => {};
    let fallbackTimer: number | null = null;
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
            guestSessionTokenRef.current ||
            (typeof getGuestToken === 'function' ? await getGuestToken() : null);
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
        void checkReplies();
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

    return () => {
      active = false;
      unsubscribeFs();
      if (fallbackTimer !== null) {
        window.clearInterval(fallbackTimer);
      }
    };
  }, [guestUser?.uid, guestUser?.firebaseUid, chatOpen]);

  const handleOpenChatModal = useCallback(() => {
    setChatOpen(true);
    localStorage.setItem('dankiv_last_read_chat_reply', Date.now().toString());
    setHasUnreadReply(false);
  }, []);

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_GUEST_STORAGE_KEY);
    } catch {
      // Clean up legacy key if present
    }
  }, []);

  const [cartIds, setCartIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [unlockedItems, setUnlockedItems] = useState<PurchasedAccess[]>(() => {
    try {
      const saved = localStorage.getItem(UNLOCKED_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? sanitizePurchasedAccessForDevice(parsed) : [];
    } catch {
      return [];
    }
  });

  const catalogPromiseRef = useRef<Promise<void> | null>(null);
  const catalogMutationVersionRef = useRef(0);
  const homeShellRef = useRef<HomePayload | null>(homeShell);
  homeShellRef.current = homeShell;

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
      return guestSessionTokenRef.current;
    },
    [getAdminToken]
  );

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
  }, [guestUser?.uid, guestUser?.firebaseUid, hasFirebaseSession, getGuestToken]);

  const unreadFeedbackRepliesCount = useMemo(
    () =>
      mySiteFeedback.filter(
        (item) => Boolean(item.adminReply?.trim()) && item.readByUser === false
      ).length,
    [mySiteFeedback]
  );

  const handleFeedbackRepliesMarkedRead = useCallback(() => {
    const nowIso = new Date().toISOString();
    setMySiteFeedback((prev) =>
      prev.map((item) =>
        Boolean(item.adminReply?.trim()) && item.readByUser === false
          ? { ...item, readByUser: true, updatedAt: nowIso }
          : item
      )
    );
  }, []);

  useEffect(() => {
    if (!guestUser?.uid) return;
    const sendHeartbeat = async () => {
      const token = (await getGuestToken().catch(() => null)) || guestSessionTokenRef.current;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch('/api/users/time-heartbeat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ uid: guestUser.uid, seconds: 30 }),
      }).catch(() => {});
    };
    const interval = window.setInterval(() => {
      void sendHeartbeat();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [guestUser?.uid, getGuestToken]);

  useEffect(() => {
    void testFirestoreConnection();
    const timer = window.setTimeout(() => prewarmChatFirestore(), 600);
    return () => window.clearTimeout(timer);
  }, []);

  const fetchCatalog = useCallback(async () => {
    if (catalogPromiseRef.current) {
      return catalogPromiseRef.current;
    }
    const task = (async () => {
      try {
        const startMutationVersion = catalogMutationVersionRef.current;
        const token = await getGuestToken();
        const response = await fetch('/api/catalog', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) {
          throw new Error('Помилка завантаження даних');
        }
        const data: CatalogResponse = await response.json();
        const mutatedDuringFetch = catalogMutationVersionRef.current !== startMutationVersion;
        setCatalog((prev) => {
          if (mutatedDuringFetch && prev) {
            return {
              ...data,
              poems: prev.poems,
              prose: prev.prose,
              products: prev.products,
              radioTracks: prev.radioTracks,
              recentFeedback: prev.recentFeedback,
            };
          }
          return data;
        });
        setHomeShell(data);
        writeCachedHomeShell(data);
        void saveOfflineCatalog(data);
        void warmOfflineMediaCache(collectCatalogMediaUrls(data));
        if (typeof data.uniqueVisitors === 'number') {
          setUniqueVisitors(data.uniqueVisitors);
        }

        // Check for newly published works & notify subscribed readers
        try {
          const allItems: Array<{
            key: string;
            section: 'poetry' | 'prose' | 'blog' | 'store';
            itemId: string;
            kindLabel: string;
            title: string;
          }> = [
            ...(data.poems || []).map((p) => ({
              key: `poem:${p.id}`,
              section: 'poetry' as const,
              itemId: p.id,
              kindLabel: 'Новий вірш',
              title: p.title,
            })),
            ...(data.prose || []).map((w) => ({
              key: `prose:${w.id}`,
              section: 'prose' as const,
              itemId: w.id,
              kindLabel: 'Нова проза',
              title: w.title,
            })),
            ...(data.blog || []).map((b) => ({
              key: `blog:${b.id}`,
              section: 'blog' as const,
              itemId: b.id,
              kindLabel: 'Новий допис',
              title: b.title,
            })),
            ...(data.products || []).map((prod) => ({
              key: `store:${prod.id}`,
              section: 'store' as const,
              itemId: prod.id,
              kindLabel: 'Новинка крамниці',
              title: prod.title,
            })),
          ];

          const SEEN_KEY = 'dankiv_seen_catalog_ids';
          const rawSeen = localStorage.getItem(SEEN_KEY);
          const allKeys = allItems.map((entry) => entry.key);
          if (!rawSeen) {
            localStorage.setItem(SEEN_KEY, JSON.stringify(allKeys));
          } else {
            const parsedSeen = JSON.parse(rawSeen) as unknown;
            const seenSet = new Set(Array.isArray(parsedSeen) ? parsedSeen.map(String) : []);
            const firstNew = allItems.find((entry) => !seenSet.has(entry.key));
            localStorage.setItem(SEEN_KEY, JSON.stringify(allKeys));

            if (firstNew) {
              const isInIframeNow = window.self !== window.top;
              const storedPref = localStorage.getItem('dankiv_notifications_enabled');
              const sysGranted =
                !isInIframeNow &&
                'Notification' in window &&
                Notification.permission === 'granted';
              const notificationsActive =
                storedPref === 'true' || (sysGranted && storedPref !== 'false');

              if (notificationsActive) {
                setNewWorkNotification({
                  section: firstNew.section,
                  itemId: firstNew.itemId,
                  kindLabel: firstNew.kindLabel,
                  title: firstNew.title,
                });
                if (newWorkToastTimeoutRef.current) {
                  window.clearTimeout(newWorkToastTimeoutRef.current);
                }
                newWorkToastTimeoutRef.current = window.setTimeout(() => {
                  setNewWorkNotification(null);
                }, 9000);

                if (sysGranted) {
                  const notifTitle = `${firstNew.kindLabel}: «${firstNew.title}»`;
                  const notifOptions: NotificationOptions = {
                    body: 'Натисніть, щоб відкрити публікацію.',
                    icon: '/pwa-192x192.png',
                    badge: '/pwa-192x192.png',
                    data: { url: `/#${firstNew.section}/${encodeURIComponent(firstNew.itemId)}` },
                  };
                  if ('serviceWorker' in navigator) {
                    void navigator.serviceWorker
                      .getRegistration('/')
                      .then((reg) => {
                        if (reg && typeof reg.showNotification === 'function') {
                          return reg.showNotification(notifTitle, notifOptions);
                        }
                        new Notification(notifTitle, notifOptions);
                        return undefined;
                      })
                      .catch(() => {
                        try {
                          new Notification(notifTitle, notifOptions);
                        } catch {
                          // Ignore system notification fallback errors
                        }
                      });
                  } else {
                    try {
                      new Notification(notifTitle, notifOptions);
                    } catch {
                      // Ignore system notification fallback errors
                    }
                  }
                }
              }
            }
          }
        } catch {
          // Ignore storage/notification parsing errors
        }

        setLoadError(null);
      } catch {
        const cachedCatalog = await readOfflineCatalog();
        if (cachedCatalog) {
          setCatalog((prev) => prev ?? cachedCatalog);
          setHomeShell((prev) => prev ?? cachedCatalog);
          if (typeof cachedCatalog.uniqueVisitors === 'number') {
            setUniqueVisitors((prev) => (prev > 1 ? prev : cachedCatalog.uniqueVisitors!));
          }
          setLoadError(null);
        } else {
          setLoadError((prev) =>
            prev ||
            (!homeShellRef.current
              ? 'Не вдалося завантажити матеріали сайту. Оновіть сторінку.'
              : null)
          );
        }
      } finally {
        setLoading(false);
        catalogPromiseRef.current = null;
      }
    })();
    catalogPromiseRef.current = task;
    return task;
  }, [getGuestToken]);

  useEffect(() => {
    let active = true;
    void readOfflineCatalog().then((cached) => {
      if (!active || !cached) return;
      setCatalog((prev) => prev ?? cached);
      setHomeShell((prev) => prev ?? cached);
      if (typeof cached.uniqueVisitors === 'number') {
        setUniqueVisitors((prev) => (prev > 1 ? prev : cached.uniqueVisitors!));
      }
      setLoading(false);
      setLoadError(null);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!catalog) return;
    void saveOfflineCatalog(catalog);
  }, [catalog]);

  useEffect(() => {
    const checkEnabled = () => {
      try {
        const stored = localStorage.getItem('dankiv_notifications_enabled');
        const isInIframeNow = window.self !== window.top;
        const sysGranted =
          !isInIframeNow &&
          'Notification' in window &&
          Notification.permission === 'granted';
        return stored === 'true' || (sysGranted && stored !== 'false');
      } catch {
        return false;
      }
    };

    let intervalId: number | null = null;
    const syncPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      if (checkEnabled()) {
        intervalId = window.setInterval(() => {
          if (document.visibilityState === 'visible') {
            void fetchCatalog();
          }
        }, 90000);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && checkEnabled()) {
        void fetchCatalog();
      }
    };

    syncPolling();
    window.addEventListener('dankiv:notifications-changed', syncPolling);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      window.removeEventListener('dankiv:notifications-changed', syncPolling);
      document.removeEventListener('visibilitychange', onVisibility);
      if (newWorkToastTimeoutRef.current) {
        window.clearTimeout(newWorkToastTimeoutRef.current);
      }
    };
  }, [fetchCatalog]);

  const prevGuestUidRef = useRef<string | null>(null);
  useEffect(() => {
    const currentUid = guestUser?.uid ?? null;
    if (prevGuestUidRef.current === currentUid) return;
    prevGuestUidRef.current = currentUid;
    catalogPromiseRef.current = null;
    void fetchCatalog();
  }, [guestUser?.uid, fetchCatalog]);

  useEffect(() => {
    if (initialLocation.section === 'home') {
      let cancelled = false;
      let idleHandle: number | null = null;
      let fallbackTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

      const scheduleSectionsIdle = () => {
        if (cancelled) return;
        const warmSections = () => {
          if (cancelled) return;
          void Promise.allSettled([
            loadPoetrySection(),
            loadProseSection(),
            loadStoreSection(),
            loadBlogSection(),
          ]);
        };
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
          idleHandle = window.requestIdleCallback(warmSections, { timeout: 2200 });
        } else {
          fallbackTimer = globalThis.setTimeout(warmSections, 1400);
        }
      };

      fetch('/api/home')
        .then((res) => (res.ok ? (res.json() as Promise<HomePayload>) : Promise.reject()))
        .then((data) => {
          if (cancelled) return;
          setHomeShell(data);
          writeCachedHomeShell(data);
          if (typeof data.uniqueVisitors === 'number') {
            setUniqueVisitors(data.uniqueVisitors);
          }
          setLoadError(null);
          setLoading(false);
          void fetchCatalog();
          scheduleSectionsIdle();
        })
        .catch(() => {
          if (!cancelled) {
            void fetchCatalog();
          }
        });

      return () => {
        cancelled = true;
        if (
          idleHandle !== null &&
          typeof window !== 'undefined' &&
          typeof window.cancelIdleCallback === 'function'
        ) {
          window.cancelIdleCallback(idleHandle);
        }
        if (fallbackTimer !== null) {
          globalThis.clearTimeout(fallbackTimer);
        }
      };
    }
    void fetchCatalog();
    return undefined;
  }, [fetchCatalog, initialLocation.section]);

  const authObserverStartedRef = useRef(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;

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
        // Do not downgrade if Firebase Auth already hydrated a full Google session
        if (firebaseSignedInRef.current) return;
        const cleanUser: GuestUser = { ...data.user, sessionToken: undefined };
        writeLocalUserLikedPoemIds(cleanUser.email, cleanUser.likedPoemIds ?? []);
        guestSessionTokenRef.current = data.user.sessionToken || null;
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
                  guestSessionTokenRef.current = sessionData.user.sessionToken || null;
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

              // Fallback check if google-session endpoint had a transient server/network error
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
            // Preserve active password/passkey guest session if signed in without Firebase
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
      if (idleHandle !== null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        globalThis.clearTimeout(timeoutHandle);
      }
      unsubscribe?.();
      authObserverStartedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (authModalOpen) {
      void getFirebaseAuth().catch(() => {});
    }
    if ((authModalOpen || drawerOpen || authorStudioOpen) && !catalog) {
      void fetchCatalog();
    }
  }, [authModalOpen, drawerOpen, authorStudioOpen, catalog, fetchCatalog]);

  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseLocationHash();
      if (parsed.isSecretAuth) {
        if (!isAdmin) {
          setAuthModalOpen(true);
        }
        window.history.replaceState(null, '', window.location.pathname);
        return;
      }
      setActiveSection(parsed.section);
      setDeepLinkItemId(parsed.itemId);
      if (!parsed.itemId) {
        window.scrollTo({ top: 0 });
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [isAdmin]);

  useEffect(() => {
    if (initialLocation.isSecretAuth) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [initialLocation.isSecretAuth]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isAltShiftA = e.altKey && e.shiftKey && e.code === 'KeyA';
      const isModShiftL = (e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyL';
      if (isAltShiftA || isModShiftL) {
        e.preventDefault();
        if (!isAdmin) {
          setAuthModalOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAdmin]);

  useEffect(() => {
    return initBehaviorAnalytics(initialLocation.section);
  }, [initialLocation.section]);

  useEffect(() => {
    return initGlobalButtonHaptics();
  }, []);

  // Dynamic SEO title and OpenGraph metadata updates based on active section and deep-linked item
  useEffect(() => {
    if (!catalog) return;
    const baseTitle = 'Андрій Даньків — Вірші, Проза, БДК, Крамниця';
    const baseDesc =
      'Офіційний сайт письменника Андрія Даньківа: поезія, мала і велика проза, БДК (Будда дивиться кіно) та крамниця електронних книг і гостьового доступу до поточних романів у Google Документах.';

    let pageTitle = baseTitle;
    let pageDesc = baseDesc;

    if (activeSection === 'poetry' && deepLinkItemId) {
      const poem = catalog.poems.find((p) => p.id === deepLinkItemId);
      if (poem) {
        pageTitle = `«${poem.title}» — Вірш | Андрій Даньків`;
        pageDesc = poem.excerpt || poem.content || baseDesc;
      }
    } else if (activeSection === 'poetry') {
      pageTitle = 'Поезія — Вірші та рядки | Андрій Даньків';
      pageDesc =
        'Добірка поезій письменника Андрія Даньківа: вірші, обрамлені в художні рядки та інтерактивні візуальні відгуки.';
    } else if (activeSection === 'prose' && deepLinkItemId) {
      const prose = catalog.prose.find((w) => w.id === deepLinkItemId);
      if (prose) {
        pageTitle = `«${prose.title}» — Проза | Андрій Даньків`;
        pageDesc = prose.excerpt || prose.previewText || baseDesc;
      }
    } else if (activeSection === 'prose') {
      pageTitle = 'Проза — Оповідання та історії | Андрій Даньків';
      pageDesc =
        'Розділ прози письменника Андрія Даньківа: оповідання, уривки та платний доступ до повних історій і PDF-документів.';
    } else if (activeSection === 'blog' && deepLinkItemId) {
      const post = catalog.blog.find((b) => b.id === deepLinkItemId);
      if (post) {
        pageTitle = `«${post.title}» — БДК (Будда дивиться кіно) | Андрій Даньків`;
        pageDesc = post.excerpt || post.content || baseDesc;
      }
    } else if (activeSection === 'blog') {
      pageTitle = 'БДК (Будда дивиться кіно) — Рецензії та кінороздуми | Андрій Даньків';
      pageDesc =
        'БДК (Будда дивиться кіно) Андрія Даньківа: рецензії на фільми, розбори режисерських рішень, кінороздуми та саундтреки стрічок.';
    } else if (activeSection === 'radio') {
      pageTitle = 'Радіостанція — Музичний ефір | Андрій Даньків';
      pageDesc =
        'Авторська радіостанція Андрія Даньківа: послідовний ефір композицій із SoundCloud у безперервному колі.';
    } else if (activeSection === 'store' && deepLinkItemId) {
      const product = catalog.products.find((prod) => prod.id === deepLinkItemId);
      if (product) {
        pageTitle = `«${product.title}» — Крамниця | Андрій Даньків`;
        pageDesc = product.description || product.sampleExcerpt || baseDesc;
      }
    } else if (activeSection === 'store') {
      pageTitle = 'Крамниця — Книги та видання | Андрій Даньків';
      pageDesc =
        'Офіційна крамниця Андрія Даньківа: паперові та електронні книги, скляні антирамки та гостьовий доступ до романів у процесі написання.';
    }

    document.title = pageTitle;

    const setMetaTag = (selector: string, attr: string, value: string) => {
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        if (selector.includes('name=')) {
          const nameMatch = selector.match(/name="([^"]+)"/);
          if (nameMatch) el.setAttribute('name', nameMatch[1]);
        } else if (selector.includes('property=')) {
          const propMatch = selector.match(/property="([^"]+)"/);
          if (propMatch) el.setAttribute('property', propMatch[1]);
        }
        document.head.appendChild(el);
      }
      el.setAttribute(attr, value);
    };

    setMetaTag('meta[name="description"]', 'content', pageDesc);
    setMetaTag('meta[property="og:title"]', 'content', pageTitle);
    setMetaTag('meta[property="og:description"]', 'content', pageDesc);
  }, [activeSection, deepLinkItemId, catalog]);

  useEffect(() => {
    if (activeSection === 'home') {
      setActiveMoment({
        targetKey: 'section:home',
        momentKey: 'home',
        label: 'Головна сторінка',
        category: 'section',
        section: 'home',
      });
    } else if (activeSection === 'prose') {
      setActiveMoment({
        targetKey: 'section:prose',
        momentKey: 'prose',
        label: 'Розділ: Проза',
        category: 'section',
        section: 'prose',
      });
    } else if (activeSection === 'blog') {
      setActiveMoment({
        targetKey: 'section:blog',
        momentKey: 'blog',
        label: 'Розділ: Блог',
        category: 'section',
        section: 'blog',
      });
    } else if (activeSection === 'radio') {
      setActiveMoment({
        targetKey: 'section:radio',
        momentKey: 'radio',
        label: 'Розділ: Радіостанція',
        category: 'section',
        section: 'radio',
      });
    } else if (activeSection === 'store') {
      setActiveMoment({
        targetKey: 'section:store',
        momentKey: 'store',
        label: 'Розділ: Крамниця',
        category: 'section',
        section: 'store',
      });
    }
  }, [activeSection]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartIds));
    } catch {
      // Ignore storage errors
    }
  }, [cartIds]);

  useEffect(() => {
    try {
      localStorage.setItem(
        UNLOCKED_STORAGE_KEY,
        JSON.stringify(sanitizePurchasedAccessForDevice(unlockedItems))
      );
    } catch {
      // Ignore storage errors
    }
  }, [unlockedItems]);

  const handleAuthenticatedGuest = useCallback(
    (
      user: GuestUser,
      options?: { isAdmin?: boolean; sessionToken?: string; requiresGoogleForAdmin?: boolean }
    ) => {
      const cleanUser: GuestUser = { ...user, sessionToken: undefined };
      writeLocalUserLikedPoemIds(cleanUser.email, cleanUser.likedPoemIds ?? []);
      if (options?.sessionToken || user.sessionToken) {
        guestSessionTokenRef.current = options?.sessionToken || user.sessionToken || null;
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
    []
  );

  const handleGuestUserUpdated = useCallback((user: GuestUser) => {
    const cleanUser: GuestUser = { ...user, sessionToken: undefined };
    writeLocalUserLikedPoemIds(cleanUser.email, cleanUser.likedPoemIds ?? []);
    setGuestUser(cleanUser);
    setRememberedGuest(writeRememberedGuestHint(cleanUser));
  }, []);

  const handleForgetRememberedGuest = useCallback(() => {
    try {
      localStorage.removeItem(GUEST_HINT_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    setRememberedGuest(null);
  }, []);

  const handleLogoutGuest = async (mode: 'lock' | 'forget' = 'lock') => {
    guestSessionTokenRef.current = null;
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
  };

  const handleOpenAuthorStudio = useCallback(() => {
    if (!isAdmin) return;
    setAuthorStudioOpen(true);
  }, [isAdmin]);

  const handlePrefetchSection = useCallback(
    (section: SectionId) => {
      const ignorePrefetchError = () => {
        // Ignore transient AbortError / network errors during prefetch
      };
      if (section !== 'home' && !catalog) {
        void fetchCatalog();
      }
      if (section === 'poetry') void loadPoetrySection().catch(ignorePrefetchError);
      else if (section === 'prose') void loadProseSection().catch(ignorePrefetchError);
      else if (section === 'blog') void loadBlogSection().catch(ignorePrefetchError);
      else if (section === 'radio') void loadRadioSection().catch(ignorePrefetchError);
      else if (section === 'store') void loadStoreSection().catch(ignorePrefetchError);
    },
    [catalog, fetchCatalog]
  );

  const handleNavigate = useCallback(
    (section: SectionId) => {
      const sectionLabels: Record<SectionId, string> = {
        home: 'Повернення: На головну',
        poetry: 'Розділ: Вірші',
        prose: 'Розділ: Проза',
        blog: 'Розділ: БДК (Будда дивиться кіно)',
        radio: 'Розділ: Радіо',
        store: 'Розділ: Крамниця',
      };
      trackClick(`nav:${section}`, sectionLabels[section], 'section');
      handlePrefetchSection(section);
      if (section !== 'home' && !catalog) {
        void fetchCatalog();
      }
      setActiveSection(section);
      setDeepLinkItemId(null);
      if (section !== 'store') {
        setDrawerOpen(false);
      }
      const nextHash = section === 'home' ? '' : `#${section}`;
      if (window.location.hash !== nextHash) {
        window.history.pushState(null, '', nextHash || window.location.pathname);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [catalog, fetchCatalog, handlePrefetchSection]
  );

  const handleSectionItemHash = useCallback(
    (section: 'poetry' | 'prose' | 'blog' | 'store', itemId: string | null) => {
      setDeepLinkItemId(itemId);
      const nextHash = itemId ? `#${section}/${encodeURIComponent(itemId)}` : `#${section}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
    },
    []
  );

  const handleOpenSectionItem = useCallback(
    (section: 'poetry' | 'prose' | 'blog' | 'store', itemId: string) => {
      handlePrefetchSection(section);
      if (!catalog) {
        void fetchCatalog();
      }
      setActiveSection(section);
      setDeepLinkItemId(itemId);
      if (section !== 'store') {
        setDrawerOpen(false);
      }
      const nextHash = `#${section}/${encodeURIComponent(itemId)}`;
      if (window.location.hash !== nextHash) {
        window.history.pushState(null, '', nextHash);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [catalog, fetchCatalog, handlePrefetchSection]
  );

  const handlePoemUpdated = useCallback((updatedPoem: Poem) => {
    catalogMutationVersionRef.current += 1;
    setCatalog((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        poems: prev.poems.map((p) => (p.id === updatedPoem.id ? updatedPoem : p)),
      };
    });
  }, []);

  const handleProseUpdated = useCallback((updatedProse: ProseWork) => {
    catalogMutationVersionRef.current += 1;
    setCatalog((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        prose: prev.prose.map((w) => (w.id === updatedProse.id ? updatedProse : w)),
      };
    });
  }, []);

  const handlePoemViewed = useCallback((poemId: string, viewsCount: number) => {
    setCatalog((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        poems: prev.poems.map((p) => (p.id === poemId ? { ...p, viewsCount } : p)),
      };
    });
  }, []);

  const handleBlogViewed = useCallback((postId: string, viewsCount: number) => {
    setCatalog((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        blog: prev.blog.map((post) => (post.id === postId ? { ...post, viewsCount } : post)),
      };
    });
  }, []);

  const handleProductUpdated = useCallback((updatedProduct: StoreProduct) => {
    catalogMutationVersionRef.current += 1;
    setCatalog((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        products: prev.products.map((prod) =>
          prod.id === updatedProduct.id ? updatedProduct : prod
        ),
      };
    });
  }, []);

  const updateHomeFields = useCallback((patch: Partial<HomePayload>) => {
    setCatalog((prev) => (prev ? { ...prev, ...patch } : prev));
    setHomeShell((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      writeCachedHomeShell(next);
      return next;
    });
  }, []);

  const handleHeroLeadUpdated = useCallback(
    (nextText: string) => updateHomeFields({ heroLeadText: nextText }),
    [updateHomeFields]
  );

  const handleAuthorAboutUpdated = useCallback(
    (nextAbout: string) => updateHomeFields({ authorAboutText: nextAbout }),
    [updateHomeFields]
  );

  const handleAuthorPhotoUpdated = useCallback(
    (nextPhotoUrl: string) => updateHomeFields({ authorPhotoUrl: nextPhotoUrl }),
    [updateHomeFields]
  );

  const handleAuthorPhotosUpdated = useCallback(
    (nextPhotos: string[]) => {
      const clean = nextPhotos.filter((url) => typeof url === 'string' && url.trim().length > 0);
      const resolved = clean.length > 0 ? clean : [FALLBACK_AUTHOR_PHOTO_URL];
      updateHomeFields({
        authorPhotos: resolved,
        authorPhotoUrl: resolved[0],
      });
    },
    [updateHomeFields]
  );

  const handleSocialLinksUpdated = useCallback(
    (nextLinks: SocialLinkItem[]) => updateHomeFields({ socialLinks: nextLinks }),
    [updateHomeFields]
  );

  const handleMonobankJarUpdated = useCallback(
    (nextUrl: string) => updateHomeFields({ monobankJarUrl: nextUrl }),
    [updateHomeFields]
  );

  const handleMonobankModalTextsUpdated = useCallback(
    (next: {
      monobankModalTitle: string;
      monobankModalSubtitle: string;
      monobankCardLabel: string;
      monobankModalText: string;
      monobankEmptyText: string;
    }) => updateHomeFields(next),
    [updateHomeFields]
  );

  const handleContactEmailUpdated = useCallback(
    (nextEmail: string) => updateHomeFields({ contactEmail: nextEmail }),
    [updateHomeFields]
  );

  const handleInterviewsUpdated = useCallback(
    (nextInterviews: InterviewLinkItem[]) => updateHomeFields({ interviews: nextInterviews }),
    [updateHomeFields]
  );

  const handleHomeActionAboutUpdated = useCallback(
    (title: string) => updateHomeFields({ homeActionAboutTitle: title }),
    [updateHomeFields]
  );

  const handleHomeActionContactUpdated = useCallback(
    (title: string) => updateHomeFields({ homeActionContactTitle: title }),
    [updateHomeFields]
  );

  const handleHomeActionMonobankUpdated = useCallback(
    (title: string) => updateHomeFields({ homeActionMonobankTitle: title }),
    [updateHomeFields]
  );

  const handleHomeActionInterviewsUpdated = useCallback(
    (title: string) => updateHomeFields({ homeActionInterviewsTitle: title }),
    [updateHomeFields]
  );

  const handleHomeRepeatersUpdated = useCallback(
    (nextRepeaters: HomeRepeatersConfig) => updateHomeFields({ homeRepeaters: nextRepeaters }),
    [updateHomeFields]
  );

  const handleAddToCart = (productId: string) => {
    const prod = catalog?.products.find((p) => p.id === productId);
    trackClick(
      `cart_add:${productId}`,
      prod ? `У кошик: «${prod.title}»` : `У кошик: ${productId}`,
      'store'
    );
    setCartIds((prev) => (prev.includes(productId) ? prev : [...prev, productId]));
    setDrawerTab('cart');
    setDrawerOpen(true);
  };

  const handleRemoveFromCart = (productId: string) => {
    setCartIds((prev) => prev.filter((id) => id !== productId));
  };

  const handleCheckoutSuccess = (newlyUnlocked: PurchasedAccess[]) => {
    const cleanNew = sanitizePurchasedAccessForDevice(newlyUnlocked);
    setUnlockedItems((prev) => {
      const merged = new Map<string, PurchasedAccess>();
      for (const item of prev) merged.set(item.productId, item);
      for (const item of cleanNew) merged.set(item.productId, item);
      return sanitizePurchasedAccessForDevice(Array.from(merged.values()));
    });
    setCartIds([]);
  };

  const handleProsePurchased = useCallback((unlocked: PurchasedAccess) => {
    const [cleanUnlocked] = sanitizePurchasedAccessForDevice([unlocked]);
    setUnlockedItems((prev) => {
      const merged = new Map<string, PurchasedAccess>();
      for (const item of prev) merged.set(item.productId, item);
      merged.set(cleanUnlocked.productId, cleanUnlocked);
      return sanitizePurchasedAccessForDevice(Array.from(merged.values()));
    });
  }, []);

  const handleRestoreOrders = useCallback((restored: PurchasedAccess[]) => {
    const cleanRestored = sanitizePurchasedAccessForDevice(restored);
    setUnlockedItems((prev) => {
      const merged = new Map<string, PurchasedAccess>();
      for (const item of prev) merged.set(item.productId, item);
      for (const item of cleanRestored) merged.set(item.productId, item);
      return sanitizePurchasedAccessForDevice(Array.from(merged.values()));
    });
  }, []);

  const handleClearDeviceLibrary = useCallback(() => {
    setUnlockedItems([]);
    try {
      localStorage.removeItem(UNLOCKED_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const unlockedMap = useMemo(() => {
    const map: Record<string, PurchasedAccess> = {};
    for (const item of unlockedItems) {
      map[item.productId] = item;
    }
    return map;
  }, [unlockedItems]);

  const cartProducts = useMemo(() => {
    if (!catalog) return [];
    return catalog.products.filter((p) => cartIds.includes(p.id));
  }, [catalog, cartIds]);

  const homeViewData = catalog ?? homeShell;

  // --- Authorized-only SoundCloud Radio Engine (Firestore-persisted Indie & Electronic waves) ---
  const [firestoreRadioTracks, setFirestoreRadioTracks] = useState<RadioTrack[] | null>(null);
  const [firestoreWeeklyMusic, setFirestoreWeeklyMusic] = useState<WeeklyMusicSelection[] | null>(null);
  const [activeRadioStation, setActiveRadioStation] = useState<RadioStationId>('indie');
  const legacyRadioSeededRef = useRef(false);
  const hadFirestoreRadioTracksRef = useRef(false);
  const radioCloudMutationUntilRef = useRef(0);
  const serverRadioSyncedRef = useRef<string | null>(null);

  const allRadioTracks = useMemo(() => {
    const serverTracks = catalog?.radioTracks ?? [];
    const serverById = new Map(serverTracks.map((t) => [t.id, t]));
    const likedSet = new Set(guestUser?.likedRadioTrackIds ?? []);
    const baseTracks =
      firestoreRadioTracks !== null &&
      (firestoreRadioTracks.length > 0 ||
        hadFirestoreRadioTracksRef.current ||
        legacyRadioSeededRef.current)
        ? firestoreRadioTracks
        : serverTracks;

    const annotatedInput = baseTracks.map((track) => {
      const serverTrack = serverById.get(track.id);
      const likesCount =
        typeof track.likesCount === 'number'
          ? track.likesCount
          : (serverTrack?.likesCount ?? 0);
      const isLiked = guestUser
        ? guestUser.likedRadioTrackIds !== undefined
          ? likedSet.has(track.id)
          : Boolean(track.isLiked ?? serverTrack?.isLiked)
        : false;
      return {
        ...track,
        likesCount,
        isLiked,
      };
    });

    return annotateAllRadioTracksWithRepertoire(annotatedInput);
  }, [firestoreRadioTracks, catalog?.radioTracks, guestUser]);

  const radioTracks = useMemo(
    () => selectRadioStationRepertoire(allRadioTracks, activeRadioStation).repertoireTracks,
    [allRadioTracks, activeRadioStation]
  );

  const savedRadioTracks = useMemo(
    () => getSavedRadioTracks(allRadioTracks, guestUser?.likedRadioTrackIds),
    [allRadioTracks, guestUser?.likedRadioTrackIds]
  );

  const [radioPlaybackScope, setRadioPlaybackScope] = useState<'repertoire' | 'saved'>('repertoire');
  const [radioCurrentTrackId, setRadioCurrentTrackId] = useState<string | null>(null);
  const [radioIsPlaying, setRadioIsPlaying] = useState(false);
  const [radioIsLoadingTrack, setRadioIsLoadingTrack] = useState(false);
  const [radioPositionMs, setRadioPositionMs] = useState(0);
  const [radioDurationMs, setRadioDurationMs] = useState(0);
  const [radioVolume, setRadioVolume] = useState(85);
  const [radioIsMuted, setRadioIsMuted] = useState(false);
  const [radioPlayerError, setRadioPlayerError] = useState<string | null>(null);
  const [radioBootstrapSrc, setRadioBootstrapSrc] = useState<string | null>(null);
  const [radioShowDirectEmbed, setRadioShowDirectEmbed] = useState(false);
  const [radioEnabled, setRadioEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(RADIO_ENABLED_STORAGE_KEY);
      if (saved !== null) return saved === 'true';
      return true;
    } catch {
      return true;
    }
  });

  const isGuestAuthenticated = Boolean(guestUser);

  useEffect(() => {
    try {
      localStorage.setItem(RADIO_ENABLED_STORAGE_KEY, radioEnabled ? 'true' : 'false');
    } catch {
      // Ignore storage errors
    }
  }, [radioEnabled]);

  const radioIframeRef = useRef<HTMLIFrameElement | null>(null);
  const radioWidgetRef = useRef<SCWidgetInstance | null>(null);
  const radioWidgetReadyRef = useRef(false);
  const radioBootstrapSrcRef = useRef<string | null>(null);
  radioBootstrapSrcRef.current = radioBootstrapSrc;
  const radioBootstrapInFlightRef = useRef(false);
  const allRadioTracksRef = useRef<RadioTrack[]>(allRadioTracks);
  allRadioTracksRef.current = allRadioTracks;
  const radioTracksRef = useRef<RadioTrack[]>(radioTracks);
  radioTracksRef.current = radioTracks;
  const savedRadioTracksRef = useRef<RadioTrack[]>(savedRadioTracks);
  savedRadioTracksRef.current = savedRadioTracks;
  const radioPlaybackScopeRef = useRef<'repertoire' | 'saved'>(radioPlaybackScope);
  radioPlaybackScopeRef.current = radioPlaybackScope;
  const radioIsPlayingRef = useRef(radioIsPlaying);
  radioIsPlayingRef.current = radioIsPlaying;
  const radioCurrentTrackIdRef = useRef<string | null>(radioCurrentTrackId);
  radioCurrentTrackIdRef.current = radioCurrentTrackId;
  const radioLoadedUrlRef = useRef<string | null>(null);
  const radioPendingAutoPlayRef = useRef(false);
  const radioVolumeRef = useRef(radioVolume);
  radioVolumeRef.current = radioVolume;
  const radioIsMutedRef = useRef(radioIsMuted);
  radioIsMutedRef.current = radioIsMuted;
  const userInitiatedPauseRef = useRef(false);
  const lastPlayAttemptAtRef = useRef(0);
  const playConfirmedProgressRef = useRef(false);
  const radioFinishingTransitionUntilRef = useRef(0);

  const getTrackEmbedTarget = useCallback((track?: RadioTrack | null): string | null => {
    if (!track) return null;
    return track.embedTargetUrl || track.soundcloudUrl || null;
  }, []);

  const activeRadioTrack = useMemo(() => {
    if (!guestUser) return null;
    const preferredList =
      radioPlaybackScope === 'saved' && savedRadioTracks.length > 0
        ? savedRadioTracks
        : radioTracks;
    if (radioCurrentTrackId) {
      const inPreferred = preferredList.find((t) => t.id === radioCurrentTrackId);
      if (inPreferred) return inPreferred;
      const inAll = allRadioTracks.find((t) => t.id === radioCurrentTrackId);
      if (
        inAll &&
        (radioPlaybackScope === 'saved' || (inAll.station || 'indie') === activeRadioStation)
      ) {
        return inAll;
      }
    }
    return preferredList[0] ?? radioTracks[0] ?? null;
  }, [
    guestUser,
    radioPlaybackScope,
    savedRadioTracks,
    radioTracks,
    allRadioTracks,
    radioCurrentTrackId,
    activeRadioStation,
  ]);

  const radioIframeId = 'dankiv-sc-radio-widget';

  const hydrateTrackWaveform = useCallback(
    async (trackId: string | null | undefined, widget?: SCWidgetInstance | null) => {
      if (!trackId || hasRadioTelemetryWaveform(trackId)) return;

      if (widget && typeof widget.getCurrentSound === 'function') {
        const waveformFromWidget = await new Promise<string | null>((resolve) => {
          let settled = false;
          const timer = window.setTimeout(() => {
            if (!settled) {
              settled = true;
              resolve(null);
            }
          }, 1500);
          try {
            widget.getCurrentSound((sound) => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timer);
              resolve(sound?.waveform_url ?? null);
            });
          } catch {
            if (!settled) {
              settled = true;
              window.clearTimeout(timer);
              resolve(null);
            }
          }
        });
        if (waveformFromWidget) {
          const samples = await fetchSoundCloudWaveform(waveformFromWidget);
          if (samples && samples.length > 0) {
            setRadioTelemetryWaveform(trackId, samples);
            return;
          }
        }
      }

      try {
        const token = await getGuestToken();
        if (!token) return;
        const res = await fetch(`/api/radio/waveform/${encodeURIComponent(trackId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { samples?: number[] };
        if (Array.isArray(data.samples) && data.samples.length > 0) {
          setRadioTelemetryWaveform(trackId, data.samples);
        }
      } catch {
        // Fallback rhythmic equalizer remains active if waveform unavailable
      }
    },
    [getGuestToken]
  );

  useEffect(() => {
    updateRadioTelemetryPlayback({
      isPlaying: Boolean(guestUser && radioIsPlaying),
      trackId: activeRadioTrack?.id ?? null,
      trackStation: activeRadioTrack?.station ?? activeRadioStation,
      durationMs: radioDurationMs,
      volume: radioVolume,
      isMuted: radioIsMuted,
    });
  }, [
    guestUser,
    radioIsPlaying,
    activeRadioTrack?.id,
    activeRadioTrack?.station,
    activeRadioStation,
    radioDurationMs,
    radioVolume,
    radioIsMuted,
  ]);

  const bootstrapRadioIframe = useCallback((targetUrl: string, autoPlay: boolean) => {
    const src = getSoundCloudPlayerSrc(targetUrl, autoPlay);
    if (!src) return;
    radioLoadedUrlRef.current = targetUrl;
    radioPendingAutoPlayRef.current = autoPlay;
    if (autoPlay) {
      userInitiatedPauseRef.current = false;
      lastPlayAttemptAtRef.current = Date.now();
      playConfirmedProgressRef.current = false;
      setRadioIsLoadingTrack(true);
    }
    if (radioBootstrapInFlightRef.current) return;
    radioBootstrapInFlightRef.current = true;
    void loadSoundCloudWidgetApi()
      .then(() => {
        radioBootstrapInFlightRef.current = false;
        const latestTarget = radioLoadedUrlRef.current || targetUrl;
        const latestSrc = getSoundCloudPlayerSrc(latestTarget, radioPendingAutoPlayRef.current);
        if (latestSrc) {
          setRadioBootstrapSrc(latestSrc);
        }
      })
      .catch(() => {
        radioBootstrapInFlightRef.current = false;
        setRadioIsLoadingTrack(false);
        setRadioPlayerError('Не вдалося завантажити плеєр SoundCloud.');
      });
  }, []);

  const loadTrackIntoWidget = useCallback(
    (embedTargetUrl: string, autoPlay: boolean) => {
      const widget = radioWidgetRef.current;
      if (!widget || !radioWidgetReadyRef.current) {
        radioLoadedUrlRef.current = embedTargetUrl;
        radioPendingAutoPlayRef.current = autoPlay;
        if (autoPlay) {
          userInitiatedPauseRef.current = false;
          lastPlayAttemptAtRef.current = Date.now();
          playConfirmedProgressRef.current = false;
          setRadioIsLoadingTrack(true);
        }
        return;
      }
      radioWidgetReadyRef.current = false;
      radioLoadedUrlRef.current = embedTargetUrl;
      radioPendingAutoPlayRef.current = autoPlay;
      if (autoPlay) {
        userInitiatedPauseRef.current = false;
        lastPlayAttemptAtRef.current = Date.now();
        playConfirmedProgressRef.current = false;
      }
      setRadioIsLoadingTrack(true);
      setRadioPositionMs(0);
      setRadioDurationMs(0);
      setRadioPlayerError(null);
      widget.load(embedTargetUrl, {
        auto_play: autoPlay,
        hide_related: true,
        show_comments: false,
        show_user: true,
        show_reposts: false,
        show_teaser: false,
        show_artwork: true,
        visual: false,
        buying: false,
        sharing: false,
        download: false,
        callback: () => {
          radioWidgetReadyRef.current = true;
          widget.setVolume(radioIsMutedRef.current ? 0 : radioVolumeRef.current);
          widget.getDuration((dur) => {
            if (Number.isFinite(dur) && dur > 0) {
              setRadioDurationMs(dur);
            }
          });
          const activeId = radioCurrentTrackIdRef.current ?? radioTracksRef.current[0]?.id;
          if (activeId) {
            void hydrateTrackWaveform(activeId, widget);
          }
          if (autoPlay || radioPendingAutoPlayRef.current) {
            userInitiatedPauseRef.current = false;
            lastPlayAttemptAtRef.current = Date.now();
            playConfirmedProgressRef.current = false;
            setRadioIsLoadingTrack(true);
            widget.play();
          } else {
            setRadioIsLoadingTrack(false);
          }
        },
      });
    },
    [hydrateTrackWaveform]
  );

  const handleRadioSelectTrack = useCallback(
    (trackId: string, autoPlay = true, scope?: 'repertoire' | 'saved') => {
      if (!isGuestAuthenticated) return;
      if (scope) {
        setRadioPlaybackScope(scope);
        radioPlaybackScopeRef.current = scope;
      }
      const target =
        allRadioTracksRef.current.find((t) => t.id === trackId) ??
        radioTracksRef.current.find((t) => t.id === trackId);
      if (!target) return;
      setRadioCurrentTrackId(target.id);
      setRadioPlayerError(null);
      const targetUrl = getTrackEmbedTarget(target);
      if (targetUrl) {
        if (!radioBootstrapSrcRef.current) {
          bootstrapRadioIframe(targetUrl, autoPlay);
          return;
        }
        loadTrackIntoWidget(targetUrl, autoPlay);
      }
    },
    [isGuestAuthenticated, getTrackEmbedTarget, bootstrapRadioIframe, loadTrackIntoWidget]
  );

  const handleRadioNextTrack = useCallback(() => {
    if (!isGuestAuthenticated) return;
    const list =
      radioPlaybackScopeRef.current === 'saved' && savedRadioTracksRef.current.length > 0
        ? savedRadioTracksRef.current
        : radioTracksRef.current;
    if (list.length === 0) return;
    radioFinishingTransitionUntilRef.current = Date.now() + 2000;
    if (list.length === 1) {
      const only = list[0];
      setRadioCurrentTrackId(only.id);
      setRadioPositionMs(0);
      if (radioWidgetRef.current && radioWidgetReadyRef.current) {
        radioPendingAutoPlayRef.current = true;
        userInitiatedPauseRef.current = false;
        lastPlayAttemptAtRef.current = Date.now();
        playConfirmedProgressRef.current = false;
        setRadioIsLoadingTrack(true);
        const w = radioWidgetRef.current;
        w.seekTo(0);
        window.setTimeout(() => {
          w.play();
        }, 70);
      } else {
        const targetUrl = getTrackEmbedTarget(only);
        if (targetUrl) {
          if (!radioBootstrapSrcRef.current) {
            bootstrapRadioIframe(targetUrl, true);
          } else {
            loadTrackIntoWidget(targetUrl, true);
          }
        }
      }
      return;
    }
    const curIdx = list.findIndex((t) => t.id === radioCurrentTrackIdRef.current);
    const nextTrack = list[(curIdx >= 0 ? curIdx + 1 : 0) % list.length];
    handleRadioSelectTrack(nextTrack.id, true);
  }, [
    isGuestAuthenticated,
    getTrackEmbedTarget,
    bootstrapRadioIframe,
    handleRadioSelectTrack,
    loadTrackIntoWidget,
  ]);

  const handleRadioPrevTrack = useCallback(() => {
    if (!isGuestAuthenticated) return;
    const list =
      radioPlaybackScopeRef.current === 'saved' && savedRadioTracksRef.current.length > 0
        ? savedRadioTracksRef.current
        : radioTracksRef.current;
    if (list.length === 0) return;
    const curIdx = list.findIndex((t) => t.id === radioCurrentTrackIdRef.current);
    const prevIdx = curIdx >= 0 ? (curIdx - 1 + list.length) % list.length : list.length - 1;
    handleRadioSelectTrack(list[prevIdx].id, true);
  }, [isGuestAuthenticated, handleRadioSelectTrack]);

  const handleRadioTogglePlay = useCallback(() => {
    const targetUrl = getTrackEmbedTarget(activeRadioTrack);
    if (!isGuestAuthenticated || !targetUrl) return;
    setRadioPlayerError(null);
    const widget = radioWidgetRef.current;
    if (widget && radioWidgetReadyRef.current) {
      if (radioIsPlayingRef.current) {
        radioPendingAutoPlayRef.current = false;
        userInitiatedPauseRef.current = true;
        widget.pause();
      } else {
        radioPendingAutoPlayRef.current = true;
        userInitiatedPauseRef.current = false;
        lastPlayAttemptAtRef.current = Date.now();
        playConfirmedProgressRef.current = false;
        setRadioIsLoadingTrack(true);
        widget.play();
      }
      return;
    }
    radioPendingAutoPlayRef.current = true;
    userInitiatedPauseRef.current = false;
    lastPlayAttemptAtRef.current = Date.now();
    playConfirmedProgressRef.current = false;
    setRadioIsLoadingTrack(true);
    if (!radioBootstrapSrcRef.current) {
      bootstrapRadioIframe(targetUrl, true);
    } else {
      radioLoadedUrlRef.current = targetUrl;
    }
  }, [isGuestAuthenticated, activeRadioTrack, getTrackEmbedTarget, bootstrapRadioIframe]);

  const handleRadioSeekTo = useCallback((ms: number) => {
    setRadioPositionMs(ms);
    updateRadioTelemetryPlayback({ positionMs: ms });
    if (radioWidgetRef.current && radioWidgetReadyRef.current) {
      radioWidgetRef.current.seekTo(ms);
    }
  }, []);

  const handleRadioVolumeChange = useCallback((nextVol: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextVol)));
    setRadioVolume(clamped);
    setRadioIsMuted(clamped === 0);
    updateRadioTelemetryPlayback({ volume: clamped, isMuted: clamped === 0 });
    if (radioWidgetRef.current && radioWidgetReadyRef.current) {
      radioWidgetRef.current.setVolume(clamped);
    }
  }, []);

  const handleRadioToggleMute = useCallback(() => {
    setRadioIsMuted((prev) => {
      const next = !prev;
      updateRadioTelemetryPlayback({ isMuted: next });
      if (radioWidgetRef.current && radioWidgetReadyRef.current) {
        radioWidgetRef.current.setVolume(next ? 0 : radioVolumeRef.current);
      }
      return next;
    });
  }, []);

  const handleToggleRadioSetting = useCallback(() => {
    const next = !radioEnabled;
    setRadioEnabled(next);
    trackClick(
      `settings:radio_${next ? 'on' : 'off'}`,
      `Налаштування радіо: ${next ? 'Увімкнено' : 'Вимкнено'}`,
      'action'
    );
    if (next) {
      handleNavigate('radio');
      return;
    }
    radioPendingAutoPlayRef.current = false;
    userInitiatedPauseRef.current = true;
    setRadioIsPlaying(false);
    setRadioIsLoadingTrack(false);
    setRadioShowDirectEmbed(false);
    if (radioWidgetRef.current && radioWidgetReadyRef.current) {
      radioWidgetRef.current.pause();
    }
    if (activeSection === 'radio') {
      setActiveSection('home');
      setDeepLinkItemId(null);
      if (window.location.hash !== '') {
        window.history.pushState(null, '', window.location.pathname);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [radioEnabled, activeSection, handleNavigate]);

  const handleRadioStationChange = useCallback(
    (nextStation: RadioStationId) => {
      setRadioPlaybackScope('repertoire');
      radioPlaybackScopeRef.current = 'repertoire';
      if (nextStation === activeRadioStation) return;
      setActiveRadioStation(nextStation);
      setRadioPlayerError(null);
      const nextList = selectRadioStationRepertoire(
        allRadioTracksRef.current,
        nextStation
      ).repertoireTracks;
      if (nextList.length === 0) {
        if (radioWidgetRef.current && radioWidgetReadyRef.current) {
          userInitiatedPauseRef.current = true;
          radioWidgetRef.current.pause();
        }
        radioPendingAutoPlayRef.current = false;
        setRadioCurrentTrackId(null);
        setRadioIsPlaying(false);
        setRadioIsLoadingTrack(false);
        setRadioPositionMs(0);
        setRadioDurationMs(0);
        return;
      }
      const firstTrack = nextList[0];
      setRadioCurrentTrackId(firstTrack.id);
      const shouldAutoPlay = Boolean(isGuestAuthenticated && (radioIsPlayingRef.current || activeSection === 'radio'));
      const targetUrl = getTrackEmbedTarget(firstTrack);
      if (isGuestAuthenticated && targetUrl) {
        if (!radioBootstrapSrcRef.current) {
          bootstrapRadioIframe(targetUrl, shouldAutoPlay);
          return;
        }
        loadTrackIntoWidget(targetUrl, shouldAutoPlay);
      }
    },
    [
      activeRadioStation,
      activeSection,
      isGuestAuthenticated,
      getTrackEmbedTarget,
      bootstrapRadioIframe,
      loadTrackIntoWidget,
    ]
  );

  const handleRadioTracksUpdated = useCallback(
    (
      nextAllTracks: RadioTrack[],
      activateTrackId?: string | null,
      targetStation?: RadioStationId
    ) => {
      if (targetStation) {
        setActiveRadioStation(targetStation);
      }
      const annotated = annotateAllRadioTracksWithRepertoire(nextAllTracks);
      legacyRadioSeededRef.current = true;
      hadFirestoreRadioTracksRef.current = true;
      radioCloudMutationUntilRef.current = Date.now() + 5000;
      serverRadioSyncedRef.current = annotated
        .map((t) => `${t.id}:${t.station || 'indie'}:${t.order ?? 0}`)
        .join('|');
      setFirestoreRadioTracks((prev) => (prev !== null ? annotated : prev));
      setCatalog((prev) => (prev ? { ...prev, radioTracks: annotated } : prev));
      allRadioTracksRef.current = annotated;
      const effectiveStation = targetStation ?? activeRadioStation;
      radioTracksRef.current = selectRadioStationRepertoire(
        annotated,
        effectiveStation
      ).repertoireTracks;
      if (activateTrackId && isGuestAuthenticated) {
        const target = annotated.find((t) => t.id === activateTrackId);
        if (target) {
          setRadioPlaybackScope('repertoire');
          radioPlaybackScopeRef.current = 'repertoire';
          setRadioCurrentTrackId(target.id);
          setRadioPlayerError(null);
          const targetUrl = getTrackEmbedTarget(target);
          if (targetUrl) {
            if (!radioBootstrapSrcRef.current) {
              bootstrapRadioIframe(targetUrl, true);
              return;
            }
            loadTrackIntoWidget(targetUrl, true);
          }
        }
      }
    },
    [
      activeRadioStation,
      isGuestAuthenticated,
      getTrackEmbedTarget,
      bootstrapRadioIframe,
      loadTrackIntoWidget,
    ]
  );

  const handleRadioTrackLiked = useCallback(
    (trackId: string, likesCount: number, isLiked: boolean, likedRadioTrackIds: string[]) => {
      catalogMutationVersionRef.current += 1;
      setCatalog((prev) =>
        prev
          ? {
              ...prev,
              radioTracks: (prev.radioTracks ?? []).map((t) =>
                t.id === trackId ? { ...t, likesCount, isLiked } : t
              ),
            }
          : prev
      );
      setFirestoreRadioTracks((prev) =>
        prev
          ? prev.map((t) => (t.id === trackId ? { ...t, likesCount, isLiked } : t))
          : prev
      );
      setGuestUser((prev) => {
        if (!prev) return prev;
        return { ...prev, likedRadioTrackIds };
      });
    },
    []
  );

  const handlePauseRadio = useCallback(() => {
    radioPendingAutoPlayRef.current = false;
    userInitiatedPauseRef.current = true;
    setRadioIsPlaying(false);
    setRadioIsLoadingTrack(false);
    if (radioWidgetRef.current && radioWidgetReadyRef.current) {
      radioWidgetRef.current.pause();
    }
  }, []);

  const weeklyMusicSelections = useMemo(() => {
    const serverList = catalog?.weeklyMusicSelections ?? [];
    if (firestoreWeeklyMusic === null) {
      return sortWeeklyMusicSelections(serverList);
    }
    if (firestoreWeeklyMusic.length === 0 && serverList.length > 0) {
      return sortWeeklyMusicSelections(serverList);
    }
    return sortWeeklyMusicSelections(firestoreWeeklyMusic);
  }, [catalog?.weeklyMusicSelections, firestoreWeeklyMusic]);

  const handleWeeklySelectionsUpdated = useCallback((nextSelections: WeeklyMusicSelection[]) => {
    const sorted = sortWeeklyMusicSelections(nextSelections);
    catalogMutationVersionRef.current += 1;
    setFirestoreWeeklyMusic(sorted);
    setCatalog((prev) => (prev ? { ...prev, weeklyMusicSelections: sorted } : prev));
  }, []);

  const handleCloseLeaderboard = useCallback(() => setLeaderboardOpen(false), []);
  const handleCloseChat = useCallback(() => setChatOpen(false), []);
  const handleCloseMusicSelections = useCallback(() => setMusicSelectionsOpen(false), []);
  const handleOpenAuthModalStable = useCallback(() => setAuthModalOpen(true), []);

  const handleRadioNextTrackRef = useRef(handleRadioNextTrack);
  handleRadioNextTrackRef.current = handleRadioNextTrack;
  const loadTrackIntoWidgetRef = useRef(loadTrackIntoWidget);
  loadTrackIntoWidgetRef.current = loadTrackIntoWidget;
  const hydrateTrackWaveformRef = useRef(hydrateTrackWaveform);
  hydrateTrackWaveformRef.current = hydrateTrackWaveform;

  // SoundCloud widget & Firestore radio track sync stay deferred until user authenticates

  useEffect(() => {
    if (!isGuestAuthenticated) return;
    void loadSoundCloudWidgetApi().catch(() => {});
  }, [isGuestAuthenticated]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void subscribeWeeklyMusicSelections((selections) => {
      if (active) {
        setFirestoreWeeklyMusic(selections);
      }
    })
      .then((unsub) => {
        if (active) {
          unsubscribe = unsub;
        } else {
          unsub();
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!guestUser) {
      setFirestoreRadioTracks(null);
      legacyRadioSeededRef.current = false;
      hadFirestoreRadioTracksRef.current = false;
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void subscribeRadioTracks((tracks) => {
      if (active) {
        if (tracks.length > 0) {
          hadFirestoreRadioTracksRef.current = true;
        }
        setFirestoreRadioTracks(tracks);
      }
    })
      .then((unsub) => {
        if (active) {
          unsubscribe = unsub;
        } else {
          unsub();
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [guestUser]);

  // Bidirectional backfill between server catalog and Firestore when admin is signed in
  useEffect(() => {
    if (!isAdmin || firestoreRadioTracks === null) return;
    if (Date.now() < radioCloudMutationUntilRef.current) return;
    const serverTracks = catalog?.radioTracks ?? [];
    if (
      firestoreRadioTracks.length === 0 &&
      serverTracks.length > 0 &&
      !legacyRadioSeededRef.current &&
      !hadFirestoreRadioTracksRef.current
    ) {
      legacyRadioSeededRef.current = true;
      void syncLegacyServerTracksToFirestore(serverTracks).catch(() => {});
      return;
    }
    const firestoreKey = firestoreRadioTracks
      .map((t) => `${t.id}:${t.station}:${t.order ?? 0}`)
      .join('|');
    const serverKey = serverTracks
      .map((t) => `${t.id}:${t.station || 'indie'}:${t.order ?? 0}`)
      .join('|');
    if (
      (firestoreRadioTracks.length > 0 || hadFirestoreRadioTracksRef.current) &&
      firestoreKey !== serverKey &&
      serverRadioSyncedRef.current !== firestoreKey
    ) {
      serverRadioSyncedRef.current = firestoreKey;
      void getAdminToken().then((token) => {
        if (!token) return;
        return fetch('/api/author/radio/tracks/sync', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ tracks: firestoreRadioTracks }),
        }).catch(() => {});
      });
    }
  }, [isAdmin, firestoreRadioTracks, catalog?.radioTracks, getAdminToken]);

  // Sync active track when playlist changes or guest signs out
  useEffect(() => {
    if (!isGuestAuthenticated) {
      radioWidgetRef.current = null;
      radioWidgetReadyRef.current = false;
      radioLoadedUrlRef.current = null;
      radioPendingAutoPlayRef.current = false;
      radioBootstrapInFlightRef.current = false;
      setRadioBootstrapSrc(null);
      setRadioShowDirectEmbed(false);
      setRadioIsPlaying(false);
      setRadioIsLoadingTrack(false);
      setRadioPositionMs(0);
      setRadioDurationMs(0);
      setRadioPlayerError(null);
      return;
    }
    const activeScopeList =
      radioPlaybackScope === 'saved' && savedRadioTracks.length > 0
        ? savedRadioTracks
        : radioTracks;
    if (activeScopeList.length === 0) {
      setRadioCurrentTrackId(null);
      setRadioIsPlaying(false);
      setRadioPositionMs(0);
      setRadioDurationMs(0);
      return;
    }
    if (!radioCurrentTrackId || !activeScopeList.some((t) => t.id === radioCurrentTrackId)) {
      setRadioCurrentTrackId(activeScopeList[0].id);
    }
  }, [isGuestAuthenticated, radioTracks, savedRadioTracks, radioPlaybackScope, radioCurrentTrackId]);

  // Watchdog: prevent infinite spinner if SoundCloud iframe fails to start playback
  useEffect(() => {
    if (!radioIsLoadingTrack) return;
    const timer = window.setTimeout(() => {
      if (radioIsPlayingRef.current) return;
      radioPendingAutoPlayRef.current = false;
      setRadioIsLoadingTrack(false);
      setRadioPlayerError(
        'Плеєр не відповів вчасно. Натисніть «Відкрити плеєр SoundCloud» нижче або спробуйте ще раз.'
      );
      setRadioShowDirectEmbed(true);
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [radioIsLoadingTrack]);

  // Bootstrap hidden SoundCloud iframe only AFTER Widget API script is ready (prevents missing READY event)
  useEffect(() => {
    const targetUrl = getTrackEmbedTarget(activeRadioTrack);
    if (!isGuestAuthenticated || radioBootstrapSrc || !targetUrl) return;
    if (activeSection !== 'radio' && !radioPendingAutoPlayRef.current) return;
    bootstrapRadioIframe(targetUrl, radioPendingAutoPlayRef.current);
  }, [
    isGuestAuthenticated,
    radioBootstrapSrc,
    activeRadioTrack,
    activeSection,
    getTrackEmbedTarget,
    bootstrapRadioIframe,
  ]);

  // Bind SoundCloud Widget API events once iframe is mounted
  useEffect(() => {
    if (!isGuestAuthenticated || !radioBootstrapSrc || !radioIframeRef.current) return;
    let cancelled = false;
    let widget: SCWidgetInstance | null = null;
    let scEvents: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      FINISH: string;
      PLAY_PROGRESS: string;
      ERROR: string;
    } | null = null;

    loadSoundCloudWidgetApi()
      .then((WidgetFactory) => {
        if (cancelled || !radioIframeRef.current) return;
        scEvents = WidgetFactory.Events;
        widget = WidgetFactory(radioIframeRef.current);
        radioWidgetRef.current = widget;

        widget.bind(scEvents.READY, () => {
          if (cancelled || !widget) return;
          radioWidgetReadyRef.current = true;
          widget.setVolume(radioIsMutedRef.current ? 0 : radioVolumeRef.current);
          widget.getDuration((dur) => {
            if (!cancelled && Number.isFinite(dur) && dur > 0) {
              setRadioDurationMs(dur);
            }
          });

          const list =
            radioPlaybackScopeRef.current === 'saved' && savedRadioTracksRef.current.length > 0
              ? savedRadioTracksRef.current
              : radioTracksRef.current;
          const desired =
            allRadioTracksRef.current.find((t) => t.id === radioCurrentTrackIdRef.current) ??
            list[0];
          if (desired?.id) {
            void hydrateTrackWaveformRef.current(desired.id, widget);
          }
          const desiredUrl = getTrackEmbedTarget(desired);
          if (desiredUrl && desiredUrl !== radioLoadedUrlRef.current) {
            loadTrackIntoWidgetRef.current(desiredUrl, radioPendingAutoPlayRef.current);
          } else if (radioPendingAutoPlayRef.current) {
            userInitiatedPauseRef.current = false;
            lastPlayAttemptAtRef.current = Date.now();
            playConfirmedProgressRef.current = false;
            setRadioIsLoadingTrack(true);
            widget.play();
          } else {
            setRadioIsLoadingTrack(false);
          }
        });

        widget.bind(scEvents.PLAY, () => {
          if (cancelled || !widget) return;
          radioPendingAutoPlayRef.current = false;
          userInitiatedPauseRef.current = false;
          setRadioIsLoadingTrack(false);
          setRadioIsPlaying(true);
          setRadioPlayerError(null);
          const currentId = radioCurrentTrackIdRef.current ?? radioTracksRef.current[0]?.id;
          if (currentId) {
            void hydrateTrackWaveformRef.current(currentId, widget);
          }
          widget.getDuration((dur) => {
            if (!cancelled && Number.isFinite(dur) && dur > 0) {
              setRadioDurationMs(dur);
            }
          });
        });

        widget.bind(scEvents.PAUSE, () => {
          if (cancelled) return;
          if (
            !radioWidgetReadyRef.current ||
            Date.now() < radioFinishingTransitionUntilRef.current
          ) {
            return;
          }
          setRadioIsPlaying(false);
          setRadioIsLoadingTrack(false);
          const bouncedImmediately =
            !userInitiatedPauseRef.current &&
            !playConfirmedProgressRef.current &&
            Date.now() - lastPlayAttemptAtRef.current < 1800;
          if (bouncedImmediately) {
            setRadioPlayerError(
              'Браузер обмежив автозапуск аудіо з прихованого вікна. Натисніть Play у вбудованому плеєрі SoundCloud або відкрийте трек напряму.'
            );
            setRadioShowDirectEmbed(true);
          }
          userInitiatedPauseRef.current = false;
        });

        widget.bind(scEvents.PLAY_PROGRESS, (rawPayload?: unknown) => {
          if (cancelled || !rawPayload || typeof rawPayload !== 'object') return;
          const payload = rawPayload as SCPlayProgressPayload;
          if (typeof payload.currentPosition === 'number') {
            if (payload.currentPosition > 120) {
              playConfirmedProgressRef.current = true;
              setRadioShowDirectEmbed(false);
            }
            setRadioPositionMs(payload.currentPosition);
            updateRadioTelemetryPlayback({
              positionMs: payload.currentPosition,
              relativePosition:
                typeof payload.relativePosition === 'number' ? payload.relativePosition : undefined,
            });
          }
        });

        widget.bind(scEvents.FINISH, () => {
          if (cancelled) return;
          radioFinishingTransitionUntilRef.current = Date.now() + 2000;
          setRadioIsPlaying(false);
          setRadioPositionMs(0);
          playConfirmedProgressRef.current = false;
          handleRadioNextTrackRef.current();
        });

        widget.bind(scEvents.ERROR, () => {
          if (cancelled) return;
          radioPendingAutoPlayRef.current = false;
          setRadioIsLoadingTrack(false);
          setRadioIsPlaying(false);
          setRadioPlayerError(
            'Не вдалося запустити цей трек у прихованому плеєрі. Спробуйте вбудований плеєр SoundCloud або відкрийте трек напряму.'
          );
          setRadioShowDirectEmbed(true);
        });
      })
      .catch(() => {
        if (!cancelled) {
          radioPendingAutoPlayRef.current = false;
          setRadioIsLoadingTrack(false);
          setRadioPlayerError('Не вдалося підключити плеєр SoundCloud.');
        }
      });

    return () => {
      cancelled = true;
      radioWidgetReadyRef.current = false;
      if (widget && scEvents) {
        try {
          widget.unbind(scEvents.READY);
          widget.unbind(scEvents.PLAY);
          widget.unbind(scEvents.PAUSE);
          widget.unbind(scEvents.PLAY_PROGRESS);
          widget.unbind(scEvents.FINISH);
          widget.unbind(scEvents.ERROR);
        } catch {
          // Ignore widget cleanup errors
        }
      }
      radioWidgetRef.current = null;
    };
  }, [isGuestAuthenticated, radioBootstrapSrc, getTrackEmbedTarget]);

  return (
    <LazyMotion features={loadMotionFeatures}>
      <MotionConfig reducedMotion="user">
        <div className="min-h-screen w-full flex flex-col bg-[var(--surface-canvas)] text-[var(--text-ink)] relative overflow-x-clip transition-colors duration-300">
          {activeSection === 'poetry' && poetryBackdropStyle && (
            <div
              aria-hidden="true"
              className="fixed inset-0 z-0 pointer-events-none transition-colors duration-300"
              style={poetryBackdropStyle}
            />
          )}
          {activeSection === 'prose' && proseHomeBackdrop && (
            <div
              aria-hidden="true"
              className="hero-pine-bg fixed inset-0 z-0 pointer-events-none transition-colors duration-300"
            />
          )}
          <AnimatePresence>
            {isPoetryImmersed && (
              <PoetrySpaceBackdrop
                key="poetry-space-backdrop"
                accentColor={poetrySpaceState.accentColor}
                swipeKey={poetrySpaceState.swipeKey}
                swipeDirection={poetrySpaceState.swipeDirection}
              />
            )}
          </AnimatePresence>
          <main className="w-full flex-1 flex flex-col relative z-10">
            {loading && !homeViewData ? (
              <SectionSkeleton section={activeSection} />
            ) : loadError && !homeViewData ? (
              <div className="max-w-6xl w-full mx-auto px-6 py-24 text-center">
                <p className="text-xl text-[#141413] dark:text-[#F4F1EA] mb-4">{loadError}</p>
                <button
                  type="button"
                  onClick={fetchCatalog}
                  className="btn-editorial-primary px-5 py-2.5"
                >
                  Спробувати ще раз
                </button>
              </div>
            ) : activeSection === 'home' && homeViewData ? (
                  <m.div
                    key="home-view"
                    variants={HOME_TRANSITION_VARIANTS}
                    initial="initial"
                    animate="animate"
                    className="w-full flex-1 flex flex-col"
                  >
                  <HeroSection
                    heroLeadText={homeViewData.heroLeadText}
                    authorAboutText={homeViewData.authorAboutText ?? FALLBACK_AUTHOR_ABOUT_TEXT}
                    authorPhotoUrl={homeViewData.authorPhotoUrl ?? FALLBACK_AUTHOR_PHOTO_URL}
                    authorPhotos={
                      homeViewData.authorPhotos && homeViewData.authorPhotos.length > 0
                        ? homeViewData.authorPhotos
                        : [homeViewData.authorPhotoUrl ?? FALLBACK_AUTHOR_PHOTO_URL]
                    }
                    socialLinks={homeViewData.socialLinks ?? FALLBACK_SOCIAL_LINKS}
                    monobankJarUrl={homeViewData.monobankJarUrl ?? ''}
                    monobankModalTitle={homeViewData.monobankModalTitle ?? 'Підтримати через Монобанк'}
                    monobankModalSubtitle={homeViewData.monobankModalSubtitle ?? ''}
                    monobankCardLabel={homeViewData.monobankCardLabel ?? 'Банка Монобанку'}
                    monobankModalText={homeViewData.monobankModalText ?? ''}
                    monobankEmptyText={homeViewData.monobankEmptyText ?? ''}
                    contactEmail={homeViewData.contactEmail ?? ''}
                    interviews={homeViewData.interviews ?? []}
                    homeActionAboutTitle={homeViewData.homeActionAboutTitle ?? 'Про мене'}
                    homeActionContactTitle={homeViewData.homeActionContactTitle ?? 'Зв’язок'}
                    homeActionMonobankTitle={homeViewData.homeActionMonobankTitle ?? 'Підтримати через Монобанк'}
                    homeActionInterviewsTitle={homeViewData.homeActionInterviewsTitle ?? 'Розмови'}
                    onHeroLeadUpdated={handleHeroLeadUpdated}
                    onAuthorAboutUpdated={handleAuthorAboutUpdated}
                    onContactEmailUpdated={handleContactEmailUpdated}
                    onSocialLinksUpdated={handleSocialLinksUpdated}
                    onOpenAuthorStudio={handleOpenAuthorStudio}
                    onOpenAuthModal={() => setAuthModalOpen(true)}
                    onSecretAdminTrigger={() => {
                      if (!isAdmin) {
                        setAuthModalOpen(true);
                      }
                    }}
                    guestUser={guestUser}
                    getGuestToken={getGuestToken}
                    siteFeedbackItems={mySiteFeedback}
                    onSiteFeedbackItemsChange={setMySiteFeedback}
                    unreadFeedbackRepliesCount={unreadFeedbackRepliesCount}
                    onFeedbackRepliesMarkedRead={handleFeedbackRepliesMarkedRead}
                    isAdmin={isAdmin}
                    getAdminToken={getAdminToken}
                    isRadioEnabled={radioEnabled}
                    onToggleRadio={handleToggleRadioSetting}
                    isRadioPlaying={Boolean(guestUser && radioIsPlaying)}
                    onOpenLeaderboard={() => setLeaderboardOpen(true)}
                    onOpenChat={handleOpenChatModal}
                    hasUnreadReply={hasUnreadReply}
                    onOpenRadio={() => {
                      trackClick('header:radio', 'Кнопка радіо', 'section');
                      handleNavigate('radio');
                    }}
                    onOpenWeeklyMusic={() => setMusicSelectionsOpen(true)}
                    showcaseNode={
                      <HomeShowcaseSection
                        poems={catalog?.poems ?? []}
                        prose={catalog?.prose ?? []}
                        proseTags={catalog?.proseTags ?? []}
                        blog={catalog?.blog ?? []}
                        products={catalog?.products ?? []}
                        recentFeedback={catalog?.recentFeedback ?? []}
                        homeRepeaters={catalog?.homeRepeaters ?? homeViewData?.homeRepeaters}
                        catalogLoaded={Boolean(catalog)}
                        cartIds={cartIds}
                        unlockedMap={unlockedMap}
                        onNavigateSection={handleNavigate}
                        onOpenPoem={(poemId) => handleOpenSectionItem('poetry', poemId)}
                        onOpenProse={(proseId) => handleOpenSectionItem('prose', proseId)}
                        onOpenBlog={(postId) => handleOpenSectionItem('blog', postId)}
                        onOpenProduct={(productId) => handleOpenSectionItem('store', productId)}
                        onAddToCart={handleAddToCart}
                        onOpenLibrary={() => {
                          setDrawerTab(cartProducts.length > 0 ? 'cart' : 'library');
                          setDrawerOpen(true);
                        }}
                      />
                    }
                  />
                  </m.div>
                ) : !catalog ? (
                  <SectionSkeleton section={activeSection} />
                ) : (
                  <m.div
                    key={`section-${activeSection}`}
                    variants={SECTION_TRANSITION_VARIANTS}
                    initial="initial"
                    animate="animate"
                    className={`${
                      activeSection === 'radio' ? 'max-w-6xl' : 'max-w-4xl'
                    } w-full mx-auto px-4 sm:px-6 flex flex-col transition-[padding] duration-[1500ms] ease-out ${
                      isPoetryImmersed ? 'pt-4 pb-8' : 'pt-5 pb-24 sm:pb-28 md:pt-7'
                    }`}
                  >
                   <div className="flex-1 min-w-0 w-full">
                    <Suspense
                      fallback={<SectionSkeleton section={activeSection} embedded />}
                    >
                      {activeSection === 'poetry' && (
                        <PoetrySection
                          poems={catalog.poems}
                          weeklyPoems={catalog.weeklyPoems ?? []}
                          weeklyCurrentPeriod={catalog.weeklyCurrentPeriod}
                          guestUser={guestUser}
                          getGuestToken={getGuestToken}
                          isAdmin={isAdmin}
                          getAdminToken={getAdminToken}
                          onOpenAuthModal={() => setAuthModalOpen(true)}
                          onGuestUserUpdated={handleGuestUserUpdated}
                          onPoemUpdated={handlePoemUpdated}
                          onPoemViewed={handlePoemViewed}
                          initialPoemId={deepLinkItemId}
                          onActivePoemChange={(id) => handleSectionItemHash('poetry', id)}
                          onSurfaceStyleChange={setPoetryBackdropStyle}
                          immersionMode={poetryImmersionMode}
                          onToggleImmersionMode={handleTogglePoetryImmersion}
                          onSpaceStateChange={setPoetrySpaceState}
                        />
                      )}

                      {activeSection === 'prose' && (
                        <ProseSection
                          proseList={catalog.prose}
                          weeklyProse={catalog.weeklyProse ?? []}
                          weeklyCurrentPeriod={catalog.weeklyCurrentPeriod}
                          proseTags={catalog.proseTags ?? []}
                          proseAuthDiscountPercent={catalog.proseAuthDiscountPercent ?? 0}
                          proseTelegramDiscountPercent={catalog.proseTelegramDiscountPercent ?? 50}
                          monobankJarUrl={homeViewData?.monobankJarUrl ?? ''}
                          monobankAcquiringEnabled={Boolean(homeViewData?.monobankAcquiringEnabled)}
                          telegramSubscription={telegramSubscription}
                          onOpenTelegramModal={() => setTelegramModalOpen(true)}
                          onTelegramInvalidated={handleClearTelegramVerification}
                          unlockedMap={unlockedMap}
                          guestUser={guestUser}
                          getGuestToken={getGuestToken}
                          onOpenAuthModal={() => setAuthModalOpen(true)}
                          isAdmin={isAdmin}
                          getAdminToken={getAdminToken}
                          onProsePurchased={handleProsePurchased}
                          onRestoreOrders={handleRestoreOrders}
                          onProseUpdated={handleProseUpdated}
                          initialProseId={deepLinkItemId}
                          onActiveProseChange={(id) => handleSectionItemHash('prose', id)}
                          onHomeBackdropChange={setProseHomeBackdrop}
                        />
                      )}

                      {activeSection === 'blog' && (
                        <BlogSection
                          posts={catalog.blog}
                          onPostViewed={handleBlogViewed}
                          initialPostId={deepLinkItemId}
                          onActivePostChange={(id) => handleSectionItemHash('blog', id)}
                        />
                      )}

                      {activeSection === 'radio' && (
                        <RadioSection
                          allTracks={allRadioTracks}
                          activeStation={activeRadioStation}
                          onSelectStation={handleRadioStationChange}
                          playbackScope={radioPlaybackScope}
                          onChangePlaybackScope={setRadioPlaybackScope}
                          guestUser={guestUser}
                          getGuestToken={getGuestToken}
                          isAdmin={isAdmin}
                          getAdminToken={getAdminToken}
                          onOpenAuthModal={() => setAuthModalOpen(true)}
                          onTracksUpdated={handleRadioTracksUpdated}
                          onTrackLiked={handleRadioTrackLiked}
                          currentTrackId={activeRadioTrack?.id ?? null}
                          isPlaying={radioIsPlaying}
                          isLoadingTrack={radioIsLoadingTrack}
                          positionMs={radioPositionMs}
                          durationMs={radioDurationMs}
                          volume={radioVolume}
                          isMuted={radioIsMuted}
                          playerError={radioPlayerError}
                          showDirectEmbed={radioShowDirectEmbed}
                          onToggleDirectEmbed={() => setRadioShowDirectEmbed((prev) => !prev)}
                          onTogglePlay={handleRadioTogglePlay}
                          onSelectTrack={handleRadioSelectTrack}
                          onNextTrack={handleRadioNextTrack}
                          onPrevTrack={handleRadioPrevTrack}
                          onSeekTo={handleRadioSeekTo}
                          onVolumeChange={handleRadioVolumeChange}
                          onToggleMute={handleRadioToggleMute}
                        />
                      )}


                      {activeSection === 'store' && (
                        <StoreSection
                          products={catalog.products}
                          cartIds={cartIds}
                          unlockedMap={unlockedMap}
                          guestUser={guestUser}
                          getGuestToken={getGuestToken}
                          isAdmin={isAdmin}
                          getAdminToken={getAdminToken}
                          onOpenAuthModal={() => setAuthModalOpen(true)}
                          onAddToCart={handleAddToCart}
                          onOpenLibrary={() => {
                            setDrawerTab(cartProducts.length > 0 ? 'cart' : 'library');
                            setDrawerOpen(true);
                          }}
                          onProductUpdated={handleProductUpdated}
                          initialProductId={deepLinkItemId}
                          onActiveProductChange={(id) => handleSectionItemHash('store', id)}
                        />
                      )}
                    </Suspense>
                  </div>
                  </m.div>
            )}
          </main>

        {drawerOpen && (
          <Suspense fallback={null}>
            <CartLibraryDrawer
              isOpen={drawerOpen}
              activeTab={drawerTab}
              onTabChange={setDrawerTab}
              onClose={() => setDrawerOpen(false)}
              cartProducts={cartProducts}
              onRemoveFromCart={handleRemoveFromCart}
              onCheckoutSuccess={handleCheckoutSuccess}
              unlockedItems={unlockedItems}
              guestUser={guestUser}
              getGuestToken={getGuestToken}
              monobankJarUrl={homeViewData?.monobankJarUrl ?? ''}
              onOpenAuthModal={() => setAuthModalOpen(true)}
              onRestoreOrders={handleRestoreOrders}
              onClearDeviceLibrary={handleClearDeviceLibrary}
              onOpenProse={(proseId) => {
                setActiveSection('prose');
                setDeepLinkItemId(proseId);
                setDrawerOpen(false);
                window.history.pushState(null, '', `#prose/${encodeURIComponent(proseId)}`);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </Suspense>
        )}

        {authorStudioOpen && isAdmin && (
          <Suspense fallback={null}>
            <AuthorStudioModal
              isOpen={authorStudioOpen && isAdmin}
              isAdmin={isAdmin}
              getAdminToken={getAdminToken}
              onClose={() => setAuthorStudioOpen(false)}
              onCatalogUpdated={fetchCatalog}
              heroLeadText={homeViewData?.heroLeadText || ''}
              onHeroLeadUpdated={handleHeroLeadUpdated}
              authorAboutText={homeViewData?.authorAboutText ?? FALLBACK_AUTHOR_ABOUT_TEXT}
              onAuthorAboutUpdated={handleAuthorAboutUpdated}
              authorPhotoUrl={homeViewData?.authorPhotoUrl ?? FALLBACK_AUTHOR_PHOTO_URL}
              authorPhotos={
                homeViewData?.authorPhotos && homeViewData.authorPhotos.length > 0
                  ? homeViewData.authorPhotos
                  : [homeViewData?.authorPhotoUrl ?? FALLBACK_AUTHOR_PHOTO_URL]
              }
              onAuthorPhotoUpdated={handleAuthorPhotoUpdated}
              onAuthorPhotosUpdated={handleAuthorPhotosUpdated}
              socialLinks={homeViewData?.socialLinks ?? FALLBACK_SOCIAL_LINKS}
              onSocialLinksUpdated={handleSocialLinksUpdated}
              monobankJarUrl={homeViewData?.monobankJarUrl ?? ''}
              onMonobankJarUpdated={handleMonobankJarUpdated}
              monobankModalTitle={homeViewData?.monobankModalTitle ?? 'Підтримати через Монобанк'}
              monobankModalSubtitle={homeViewData?.monobankModalSubtitle ?? ''}
              monobankCardLabel={homeViewData?.monobankCardLabel ?? 'Банка Монобанку'}
              monobankModalText={homeViewData?.monobankModalText ?? ''}
              monobankEmptyText={homeViewData?.monobankEmptyText ?? ''}
              onMonobankModalTextsUpdated={handleMonobankModalTextsUpdated}
              contactEmail={homeViewData?.contactEmail ?? ''}
              onContactEmailUpdated={handleContactEmailUpdated}
              interviews={homeViewData?.interviews ?? []}
              onInterviewsUpdated={handleInterviewsUpdated}
              homeActionAboutTitle={homeViewData?.homeActionAboutTitle ?? 'Про мене'}
              onHomeActionAboutUpdated={handleHomeActionAboutUpdated}
              homeActionContactTitle={homeViewData?.homeActionContactTitle ?? 'Зв’язок'}
              onHomeActionContactUpdated={handleHomeActionContactUpdated}
              homeActionMonobankTitle={homeViewData?.homeActionMonobankTitle ?? 'Підтримати через Монобанк'}
              onHomeActionMonobankUpdated={handleHomeActionMonobankUpdated}
              homeActionInterviewsTitle={homeViewData?.homeActionInterviewsTitle ?? 'Розмови'}
              onHomeActionInterviewsUpdated={handleHomeActionInterviewsUpdated}
              homeRepeaters={homeViewData?.homeRepeaters}
              onHomeRepeatersUpdated={handleHomeRepeatersUpdated}
              radioTracks={allRadioTracks}
              onRadioTracksChanged={handleRadioTracksUpdated}
              uniqueVisitors={uniqueVisitors}
            />
          </Suspense>
        )}

        {authModalOpen && (
          <Suspense fallback={null}>
            <GuestAuthModal
              isOpen={authModalOpen}
              onClose={() => setAuthModalOpen(false)}
              guestUser={guestUser}
              rememberedGuest={rememberedGuest}
              isAdmin={isAdmin}
              requiresGoogleForAdmin={requiresGoogleForAdmin}
              hasFirebaseSession={hasFirebaseSession}
              getGuestToken={getGuestToken}
              onAuthenticated={handleAuthenticatedGuest}
              onUserUpdated={handleGuestUserUpdated}
              onLogout={handleLogoutGuest}
              onForgetRemembered={handleForgetRememberedGuest}
              onOpenAuthorStudio={handleOpenAuthorStudio}
              poems={catalog?.poems ?? []}
              onOpenPoem={(poemId) => {
                setActiveSection('poetry');
                setDeepLinkItemId(poemId);
                setAuthModalOpen(false);
                const nextHash = `#poetry/${encodeURIComponent(poemId)}`;
                if (window.location.hash !== nextHash) {
                  window.history.pushState(null, '', nextHash);
                }
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onOpenProse={(proseId) => {
                handleOpenSectionItem('prose', proseId);
                setAuthModalOpen(false);
              }}
              onCatalogUpdated={() => void fetchCatalog()}
            />
          </Suspense>
        )}

        {telegramModalOpen && (
          <Suspense fallback={null}>
            <TelegramVerifyModal
              isOpen={telegramModalOpen}
              onClose={() => setTelegramModalOpen(false)}
              discountPercent={catalog?.proseTelegramDiscountPercent ?? homeViewData?.proseTelegramDiscountPercent ?? 50}
              subscription={telegramSubscription}
              onVerified={handleTelegramVerified}
              onClearVerification={handleClearTelegramVerification}
            />
          </Suspense>
        )}

        {/* Persistent SoundCloud Widget iframe (in-viewport unobtrusive layer, expandable when browser requires direct tap) */}
        {guestUser && radioBootstrapSrc && (
          <div
            aria-hidden={!radioShowDirectEmbed || isPoetryImmersed}
            className={
              radioShowDirectEmbed && !isPoetryImmersed
                ? 'fixed bottom-[76px] sm:bottom-[82px] right-3 sm:right-6 z-50 w-[min(calc(100vw-1.5rem),22rem)] rounded-2xl bg-[#202020] p-2 shadow-2xl space-y-1.5'
                : 'fixed bottom-0 right-0 w-[300px] h-[166px] opacity-[0.01] pointer-events-none -z-10'
            }
          >
            {radioShowDirectEmbed && !isPoetryImmersed && (
              <div className="flex items-center justify-between px-1.5 text-[11px] text-[#C4BFB4]">
                <span className="truncate font-medium">Плеєр SoundCloud</span>
                <button
                  type="button"
                  onClick={() => setRadioShowDirectEmbed(false)}
                  aria-label="Згорнути плеєр SoundCloud"
                  className="p-1 rounded-lg hover:bg-white/10 text-[#C4BFB4] hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <iframe
              ref={radioIframeRef}
              id={radioIframeId}
              title="Радіостанція SoundCloud"
              src={radioBootstrapSrc}
              allow="autoplay; encrypted-media"
              tabIndex={radioShowDirectEmbed ? 0 : -1}
              className="w-full h-[166px] rounded-xl border-0 block"
            />
          </div>
        )}



        {/* User Leaderboard Modal */}
        <UserLeaderboardModal
          isOpen={leaderboardOpen}
          onClose={handleCloseLeaderboard}
          guestUser={guestUser}
          isAdmin={isAdmin}
          getAdminToken={getAdminToken}
          getGuestToken={getGuestToken}
          authToken={guestSessionTokenRef.current}
        />

        {/* Global Community Chat Modal */}
        <GlobalChatModal
          isOpen={chatOpen}
          onClose={handleCloseChat}
          guestUser={guestUser}
          isAdmin={isAdmin}
          getGuestToken={getGuestToken}
          onOpenAuthModal={handleOpenAuthModalStable}
          onGuestUserUpdated={handleGuestUserUpdated}
        />

        {/* Monthly / Weekly Music Selections Modal */}
        <MusicSelectionsModal
          isOpen={musicSelectionsOpen}
          onClose={handleCloseMusicSelections}
          selections={weeklyMusicSelections}
          currentPeriod={catalog?.weeklyCurrentPeriod}
          isAdmin={isAdmin}
          getAdminToken={getAdminToken}
          onSelectionsUpdated={handleWeeklySelectionsUpdated}
          onBeforePlay={handlePauseRadio}
        />

        <FirstVisitAuthHint
          guestUser={guestUser}
          rememberedGuest={rememberedGuest}
          suppress={authModalOpen || chatOpen || leaderboardOpen || musicSelectionsOpen || drawerOpen || isPoetryImmersed}
          onOpenAuthModal={() => setAuthModalOpen(true)}
        />

        <AnimatePresence>
          {newWorkNotification && !isPoetryImmersed && (
            <m.div
              key="new-work-notification"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.35 } }}
              exit={{
                opacity: 0,
                pointerEvents: 'none',
                transition: { duration: 1.4, ease: [0.22, 1, 0.36, 1] },
              }}
              className="fixed bottom-[78px] sm:bottom-[86px] right-4 sm:right-6 z-50 w-[min(calc(100vw-2rem),21rem)] rounded-2xl bg-white/95 dark:bg-[#242424]/95 backdrop-blur-xl shadow-[0_18px_40px_-14px_rgba(20,20,19,0.3)] dark:shadow-[0_22px_48px_-14px_rgba(0,0,0,0.85)] p-3 flex items-center justify-between gap-2.5"
            >
              <button
                type="button"
                onClick={() => {
                  const target = newWorkNotification;
                  setNewWorkNotification(null);
                  handleOpenSectionItem(target.section, target.itemId);
                }}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer group"
              >
                <span className="w-8 h-8 rounded-xl bg-[#EAE7DF] dark:bg-[#323232] text-[#2C5937] dark:text-[#E5E5E5] inline-flex items-center justify-center shrink-0">
                  <BellRing className="w-4 h-4" strokeWidth={1.9} />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-[#2C5937] dark:text-[#C4BFB4]">
                    {newWorkNotification.kindLabel}
                  </p>
                  <p className="text-xs font-semibold text-[#141413] dark:text-[#F4F1EA] truncate group-hover:underline">
                    «{newWorkNotification.title}»
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setNewWorkNotification(null)}
                aria-label="Закрити сповіщення"
                className="p-1.5 rounded-lg text-[#5C5C58] dark:text-[#C4BFB4] hover:bg-[#EFECE6] dark:hover:bg-[#323232] shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            </m.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {!isPoetryImmersed && (
            <m.div
              key="offline-indicator-fade"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.45 } }}
              exit={{
                opacity: 0,
                pointerEvents: 'none',
                transition: { duration: 1.4, ease: [0.22, 1, 0.36, 1] },
              }}
            >
              <OfflineIndicator />
            </m.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {!isPoetryImmersed && (
            <m.div
              key="site-bottom-nav-fade"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } }}
              exit={{
                opacity: 0,
                pointerEvents: 'none',
                transition: { duration: 1.5, ease: [0.22, 1, 0.36, 1] },
              }}
              className="relative z-40"
            >
              <SiteBottomNav
                activeSection={activeSection}
                onNavigate={handleNavigate}
                onPrefetchSection={handlePrefetchSection}
                cartCount={cartProducts.length}
                unlockedCount={unlockedItems.length}
                onOpenDrawer={(tab) => {
                  if (tab) setDrawerTab(tab);
                  setDrawerOpen(true);
                }}
              />
            </m.div>
          )}
        </AnimatePresence>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
