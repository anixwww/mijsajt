import { BellRing, Trophy, X } from 'lucide-react';
import { AnimatePresence, LazyMotion, m, MotionConfig } from 'motion/react';
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { FirstVisitAuthHint } from './components/FirstVisitAuthHint.tsx';
import { HeroSection } from './components/HeroSection.tsx';
import { HomeShowcaseSection } from './components/HomeShowcaseSection.tsx';
import { MinimizedRadioButton } from './components/MinimizedRadioButton.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { PoetrySpaceBackdrop } from './components/PoetrySpaceBackdrop.tsx';
import { RadioEngine } from './components/RadioEngine.tsx';
import { SectionSkeleton } from './components/SectionSkeleton.tsx';
import { SiteBottomNav } from './components/SiteBottomNav.tsx';
import { FALLBACK_SOCIAL_LINKS } from './components/SocialIcons.tsx';
import { getCachedAuthUser, getFirebaseAuth, testFirestoreConnection } from './firebase.ts';
import {
  TELEGRAM_SUB_STORAGE_KEY,
  useAuthStore,
  writeRememberedGuestHint,
} from './store/useAuthStore.ts';
import { useCartStore } from './store/useCartStore.ts';
import { useCatalogStore, writeCachedHomeShell } from './store/useCatalogStore.ts';
import { useRadioStore } from './store/useRadioStore.ts';
import { useUiStore } from './store/useUiStore.ts';
import type {
  BlogPost,
  CatalogResponse,
  GlobalChatMessage,
  GuestUser,
  HomePayload,
  HomeRepeatersConfig,
  InterviewLinkItem,
  Poem,
  ProseWork,
  PurchasedAccess,
  RadioStationId,
  SectionId,
  SocialLinkItem,
  StoreProduct,
  TelegramSubscriptionState,
  WeeklyMusicSelection,
} from './types.ts';
import { initBehaviorAnalytics, setActiveMoment, trackClick } from './utils/analytics.ts';
import { prewarmChatFirestore, subscribeGlobalChatMessages } from './utils/chatFirestore.ts';
import {
  mergeSiteFeedbackLists,
  subscribeUserSiteFeedback,
} from './utils/feedbackFirestore.ts';
import { initGlobalButtonHaptics } from './utils/haptics.ts';
import {
  collectCatalogMediaUrls,
  readLocalUserLikedPoemIds,
  readOfflineCatalog,
  saveOfflineCatalog,
  warmOfflineMediaCache,
  writeLocalUserLikedPoemIds,
} from './utils/offlineCache.ts';
import { useAllRadioTracks, useRadioDerivedState } from './utils/radioSelectors.ts';
import { sortWeeklyMusicSelections } from './utils/weeklyMusicFirestore.ts';

const loadMotionFeatures = () => import('motion/react').then((mod) => mod.domMax);

const loadPoetrySection = () => import('./components/PoetrySection.tsx');
const loadProseSection = () => import('./components/ProseSection.tsx');
const loadBlogSection = () => import('./components/BlogSection.tsx');
const loadRadioSection = () => import('./components/RadioSection.tsx');
const loadStoreSection = () => import('./components/StoreSection.tsx');

const AuthorStudioModal = lazy(() =>
  import('./components/AuthorStudioModal.tsx').then((mod) => ({ default: mod.AuthorStudioModal }))
);
const BlogSection = lazy(() =>
  loadBlogSection().then((mod) => ({ default: mod.BlogSection }))
);
const CartLibraryDrawer = lazy(() =>
  import('./components/CartLibraryDrawer.tsx').then((mod) => ({ default: mod.CartLibraryDrawer }))
);
const GuestAuthModal = lazy(() =>
  import('./components/GuestAuthModal.tsx').then((mod) => ({ default: mod.GuestAuthModal }))
);
const PoetrySection = lazy(() =>
  loadPoetrySection().then((mod) => ({ default: mod.PoetrySection }))
);
const ProseSection = lazy(() =>
  loadProseSection().then((mod) => ({ default: mod.ProseSection }))
);
const RadioSection = lazy(() =>
  loadRadioSection().then((mod) => ({ default: mod.RadioSection }))
);
const StoreSection = lazy(() =>
  loadStoreSection().then((mod) => ({ default: mod.StoreSection }))
);
const TelegramVerifyModal = lazy(() =>
  import('./components/TelegramVerifyModal.tsx').then((mod) => ({ default: mod.TelegramVerifyModal }))
);
const GlobalChatModal = lazy(() =>
  import('./components/GlobalChatModal.tsx').then((mod) => ({ default: mod.GlobalChatModal }))
);
const UserLeaderboardModal = lazy(() =>
  import('./components/UserLeaderboardModal.tsx').then((mod) => ({ default: mod.UserLeaderboardModal }))
);
const MusicSelectionsModal = lazy(() =>
  import('./components/MusicSelectionsModal.tsx').then((mod) => ({ default: mod.MusicSelectionsModal }))
);

const LEGACY_GUEST_STORAGE_KEY = 'dankiv_guest_user_v1';
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

interface ConnectedRadioProps {
  getGuestToken: (forceRefresh?: boolean) => Promise<string | null>;
  getAdminToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const RadioSectionConnected = memo(function RadioSectionConnected({
  getGuestToken,
  getAdminToken,
}: ConnectedRadioProps) {
  const guestUser = useAuthStore((s) => s.guestUser);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const setGuestUser = useAuthStore((s) => s.setGuestUser);
  const setAuthModalOpen = useUiStore((s) => s.setAuthModalOpen);
  const updateRadioTrackLikeInCatalog = useCatalogStore((s) => s.updateRadioTrackLikeInCatalog);

  const activeStation = useRadioStore((s) => s.activeRadioStation);
  const playbackScope = useRadioStore((s) => s.radioPlaybackScope);
  const isPlaying = useRadioStore((s) => s.radioIsPlaying);
  const isLoadingTrack = useRadioStore((s) => s.radioIsLoadingTrack);
  const positionMs = useRadioStore((s) => s.radioPositionMs);
  const durationMs = useRadioStore((s) => s.radioDurationMs);
  const volume = useRadioStore((s) => s.radioVolume);
  const isMuted = useRadioStore((s) => s.radioIsMuted);
  const playerError = useRadioStore((s) => s.radioPlayerError);
  const showDirectEmbed = useRadioStore((s) => s.radioShowDirectEmbed);
  const setPlaybackScope = useRadioStore((s) => s.setRadioPlaybackScope);
  const setShowDirectEmbed = useRadioStore((s) => s.setRadioShowDirectEmbed);
  const setFirestoreRadioTracks = useRadioStore((s) => s.setFirestoreRadioTracks);
  const handlers = useRadioStore((s) => s.handlers);

  const { allRadioTracks, activeRadioTrack } = useRadioDerivedState();

  const handleTrackLiked = useCallback(
    (trackId: string, likesCount: number, isLiked: boolean, likedRadioTrackIds: string[]) => {
      updateRadioTrackLikeInCatalog(trackId, likesCount, isLiked);
      setFirestoreRadioTracks((prev) =>
        prev ? prev.map((t) => (t.id === trackId ? { ...t, likesCount, isLiked } : t)) : prev
      );
      setGuestUser((prev) => (prev ? { ...prev, likedRadioTrackIds } : prev));
    },
    [setFirestoreRadioTracks, setGuestUser, updateRadioTrackLikeInCatalog]
  );

  const handleOpenAuth = useCallback(() => setAuthModalOpen(true), [setAuthModalOpen]);
  const handleToggleDirectEmbed = useCallback(
    () => setShowDirectEmbed((prev) => !prev),
    [setShowDirectEmbed]
  );

  return (
    <RadioSection
      allTracks={allRadioTracks}
      activeStation={activeStation}
      onSelectStation={handlers.changeStation}
      playbackScope={playbackScope}
      onChangePlaybackScope={setPlaybackScope}
      guestUser={guestUser}
      getGuestToken={getGuestToken}
      isAdmin={isAdmin}
      getAdminToken={getAdminToken}
      onOpenAuthModal={handleOpenAuth}
      onTracksUpdated={handlers.notifyTracksUpdated}
      onTrackLiked={handleTrackLiked}
      currentTrackId={activeRadioTrack?.id ?? null}
      isPlaying={isPlaying}
      isLoadingTrack={isLoadingTrack}
      positionMs={positionMs}
      durationMs={durationMs}
      volume={volume}
      isMuted={isMuted}
      playerError={playerError}
      showDirectEmbed={showDirectEmbed}
      onToggleDirectEmbed={handleToggleDirectEmbed}
      onTogglePlay={handlers.togglePlay}
      onSelectTrack={handlers.selectTrack}
      onNextTrack={handlers.nextTrack}
      onPrevTrack={handlers.prevTrack}
      onSeekTo={handlers.seekTo}
      onVolumeChange={handlers.setVolume}
      onToggleMute={handlers.toggleMute}
    />
  );
});

const MinimizedRadioButtonConnected = memo(function MinimizedRadioButtonConnected({
  onClick,
}: {
  onClick: () => void;
}) {
  const isPlaying = useRadioStore((s) => s.radioIsPlaying);
  const isMuted = useRadioStore((s) => s.radioIsMuted);
  const volume = useRadioStore((s) => s.radioVolume);
  const positionMs = useRadioStore((s) => s.radioPositionMs);
  const durationMs = useRadioStore((s) => s.radioDurationMs);
  const { activeRadioTrack } = useRadioDerivedState();

  return (
    <MinimizedRadioButton
      isPlaying={isPlaying}
      isMuted={isMuted}
      volume={volume}
      positionMs={positionMs}
      durationMs={durationMs}
      trackTitle={activeRadioTrack?.title}
      onClick={onClick}
    />
  );
});

interface AuthorStudioModalConnectedProps {
  isOpen: boolean;
  isAdmin: boolean;
  getAdminToken: (forceRefresh?: boolean) => Promise<string | null>;
  onClose: () => void;
  onCatalogUpdated: () => Promise<void>;
  homeViewData: HomePayload | null;
  uniqueVisitors: number;
  onHeroLeadUpdated: (nextText: string) => void;
  onAuthorAboutUpdated: (nextAbout: string) => void;
  onAuthorPhotoUpdated: (nextPhotoUrl: string) => void;
  onAuthorPhotosUpdated: (nextPhotos: string[]) => void;
  onSocialLinksUpdated: (nextLinks: SocialLinkItem[]) => void;
  onMonobankJarUpdated: (nextUrl: string) => void;
  onMonobankModalTextsUpdated: (next: {
    monobankModalTitle: string;
    monobankModalSubtitle: string;
    monobankCardLabel: string;
    monobankModalText: string;
    monobankEmptyText: string;
  }) => void;
  onContactEmailUpdated: (nextEmail: string) => void;
  onInterviewsUpdated: (nextInterviews: InterviewLinkItem[]) => void;
  onHomeActionAboutUpdated: (title: string) => void;
  onHomeActionContactUpdated: (title: string) => void;
  onHomeActionMonobankUpdated: (title: string) => void;
  onHomeActionInterviewsUpdated: (title: string) => void;
  onHomeRepeatersUpdated: (nextRepeaters: HomeRepeatersConfig) => void;
}

const AuthorStudioModalConnected = memo(function AuthorStudioModalConnected({
  isOpen,
  isAdmin,
  getAdminToken,
  onClose,
  onCatalogUpdated,
  homeViewData,
  uniqueVisitors,
  onHeroLeadUpdated,
  onAuthorAboutUpdated,
  onAuthorPhotoUpdated,
  onAuthorPhotosUpdated,
  onSocialLinksUpdated,
  onMonobankJarUpdated,
  onMonobankModalTextsUpdated,
  onContactEmailUpdated,
  onInterviewsUpdated,
  onHomeActionAboutUpdated,
  onHomeActionContactUpdated,
  onHomeActionMonobankUpdated,
  onHomeActionInterviewsUpdated,
  onHomeRepeatersUpdated,
}: AuthorStudioModalConnectedProps) {
  const allRadioTracks = useAllRadioTracks();
  const notifyTracksUpdated = useRadioStore((s) => s.handlers.notifyTracksUpdated);

  return (
    <AuthorStudioModal
      isOpen={isOpen}
      isAdmin={isAdmin}
      getAdminToken={getAdminToken}
      onClose={onClose}
      onCatalogUpdated={onCatalogUpdated}
      heroLeadText={homeViewData?.heroLeadText || ''}
      onHeroLeadUpdated={onHeroLeadUpdated}
      authorAboutText={homeViewData?.authorAboutText ?? FALLBACK_AUTHOR_ABOUT_TEXT}
      onAuthorAboutUpdated={onAuthorAboutUpdated}
      authorPhotoUrl={homeViewData?.authorPhotoUrl ?? FALLBACK_AUTHOR_PHOTO_URL}
      authorPhotos={
        homeViewData?.authorPhotos && homeViewData.authorPhotos.length > 0
          ? homeViewData.authorPhotos
          : [homeViewData?.authorPhotoUrl ?? FALLBACK_AUTHOR_PHOTO_URL]
      }
      onAuthorPhotoUpdated={onAuthorPhotoUpdated}
      onAuthorPhotosUpdated={onAuthorPhotosUpdated}
      socialLinks={homeViewData?.socialLinks ?? FALLBACK_SOCIAL_LINKS}
      onSocialLinksUpdated={onSocialLinksUpdated}
      monobankJarUrl={homeViewData?.monobankJarUrl ?? ''}
      onMonobankJarUpdated={onMonobankJarUpdated}
      monobankModalTitle={homeViewData?.monobankModalTitle ?? 'Підтримати через Монобанк'}
      monobankModalSubtitle={homeViewData?.monobankModalSubtitle ?? ''}
      monobankCardLabel={homeViewData?.monobankCardLabel ?? 'Банка Монобанку'}
      monobankModalText={homeViewData?.monobankModalText ?? ''}
      monobankEmptyText={homeViewData?.monobankEmptyText ?? ''}
      onMonobankModalTextsUpdated={onMonobankModalTextsUpdated}
      contactEmail={homeViewData?.contactEmail ?? ''}
      onContactEmailUpdated={onContactEmailUpdated}
      interviews={homeViewData?.interviews ?? []}
      onInterviewsUpdated={onInterviewsUpdated}
      homeActionAboutTitle={homeViewData?.homeActionAboutTitle ?? 'Про мене'}
      onHomeActionAboutUpdated={onHomeActionAboutUpdated}
      homeActionContactTitle={homeViewData?.homeActionContactTitle ?? 'Зв’язок'}
      onHomeActionContactUpdated={onHomeActionContactUpdated}
      homeActionMonobankTitle={homeViewData?.homeActionMonobankTitle ?? 'Підтримати через Монобанк'}
      onHomeActionMonobankUpdated={onHomeActionMonobankUpdated}
      homeActionInterviewsTitle={homeViewData?.homeActionInterviewsTitle ?? 'Розмови'}
      onHomeActionInterviewsUpdated={onHomeActionInterviewsUpdated}
      homeRepeaters={homeViewData?.homeRepeaters}
      onHomeRepeatersUpdated={onHomeRepeatersUpdated}
      radioTracks={allRadioTracks}
      onRadioTracksChanged={notifyTracksUpdated}
      uniqueVisitors={uniqueVisitors}
    />
  );
});

const MusicSelectionsModalConnected = memo(function MusicSelectionsModalConnected({
  isOpen,
  onClose,
  isAdmin,
  getAdminToken,
}: {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  getAdminToken: (forceRefresh?: boolean) => Promise<string | null>;
}) {
  const serverList = useCatalogStore((s) => s.catalog?.weeklyMusicSelections);
  const currentPeriod = useCatalogStore((s) => s.catalog?.weeklyCurrentPeriod);
  const setWeeklySelectionsInCatalog = useCatalogStore((s) => s.setWeeklySelectionsInCatalog);
  const firestoreWeeklyMusic = useRadioStore((s) => s.firestoreWeeklyMusic);
  const setFirestoreWeeklyMusic = useRadioStore((s) => s.setFirestoreWeeklyMusic);
  const pauseRadio = useRadioStore((s) => s.handlers.pauseRadio);

  const weeklyMusicSelections = useMemo(() => {
    const fallbackList = serverList ?? [];
    if (firestoreWeeklyMusic === null) {
      return sortWeeklyMusicSelections(fallbackList);
    }
    if (firestoreWeeklyMusic.length === 0 && fallbackList.length > 0) {
      return sortWeeklyMusicSelections(fallbackList);
    }
    return sortWeeklyMusicSelections(firestoreWeeklyMusic);
  }, [serverList, firestoreWeeklyMusic]);

  const handleWeeklySelectionsUpdated = useCallback(
    (nextSelections: WeeklyMusicSelection[]) => {
      const sorted = sortWeeklyMusicSelections(nextSelections);
      setFirestoreWeeklyMusic(sorted);
      setWeeklySelectionsInCatalog(sorted);
    },
    [setFirestoreWeeklyMusic, setWeeklySelectionsInCatalog]
  );

  return (
    <MusicSelectionsModal
      isOpen={isOpen}
      onClose={onClose}
      selections={weeklyMusicSelections}
      currentPeriod={currentPeriod}
      isAdmin={isAdmin}
      getAdminToken={getAdminToken}
      onSelectionsUpdated={handleWeeklySelectionsUpdated}
      onBeforePlay={pauseRadio}
    />
  );
});

export default function App() {
  const initialLocation = useMemo(() => parseLocationHash(), []);
  const initialSecretSearch = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('admin') === '1' || params.get('auth') === '1';
  }, []);

  const didInitUrlStateRef = useRef(false);
  if (!didInitUrlStateRef.current) {
    didInitUrlStateRef.current = true;
    const initPatch: Partial<ReturnType<typeof useUiStore.getState>> = {};
    if (initialLocation.section !== 'home') {
      initPatch.activeSection = initialLocation.section;
      useCatalogStore.setState({ loading: true });
    }
    if (initialLocation.itemId) {
      initPatch.deepLinkItemId = initialLocation.itemId;
    }
    if (initialLocation.isSecretAuth || initialSecretSearch) {
      initPatch.authModalOpen = true;
    }
    if (Object.keys(initPatch).length > 0) {
      useUiStore.setState(initPatch);
    }
  }

  // Subscribe only to coarse layout / modal booleans and catalog/auth slices needed at root
  const homeShell = useCatalogStore((s) => s.homeShell);
  const catalog = useCatalogStore((s) => s.catalog);
  const loading = useCatalogStore((s) => s.loading);
  const loadError = useCatalogStore((s) => s.loadError);
  const uniqueVisitors = useCatalogStore((s) => s.uniqueVisitors);
  const setHomeShell = useCatalogStore((s) => s.setHomeShell);
  const setCatalog = useCatalogStore((s) => s.setCatalog);
  const setLoading = useCatalogStore((s) => s.setLoading);
  const setLoadError = useCatalogStore((s) => s.setLoadError);
  const setUniqueVisitors = useCatalogStore((s) => s.setUniqueVisitors);
  const updatePoem = useCatalogStore((s) => s.updatePoem);
  const updateProse = useCatalogStore((s) => s.updateProse);
  const updateBlogPost = useCatalogStore((s) => s.updateBlogPost);
  const updateProduct = useCatalogStore((s) => s.updateProduct);
  const setPoemViews = useCatalogStore((s) => s.setPoemViews);
  const setBlogViews = useCatalogStore((s) => s.setBlogViews);
  const updateHomeFields = useCatalogStore((s) => s.updateHomeFields);

  const activeSection = useUiStore((s) => s.activeSection);
  const deepLinkItemId = useUiStore((s) => s.deepLinkItemId);
  const drawerOpen = useUiStore((s) => s.drawerOpen);
  const drawerTab = useUiStore((s) => s.drawerTab);
  const authorStudioOpen = useUiStore((s) => s.authorStudioOpen);
  const authModalOpen = useUiStore((s) => s.authModalOpen);
  const telegramModalOpen = useUiStore((s) => s.telegramModalOpen);
  const leaderboardOpen = useUiStore((s) => s.leaderboardOpen);
  const chatOpen = useUiStore((s) => s.chatOpen);
  const musicSelectionsOpen = useUiStore((s) => s.musicSelectionsOpen);
  const poetryBackdropStyle = useUiStore((s) => s.poetryBackdropStyle);
  const proseHomeBackdrop = useUiStore((s) => s.proseHomeBackdrop);
  const poetryImmersionMode = useUiStore((s) => s.poetryImmersionMode);
  const poetrySpaceState = useUiStore((s) => s.poetrySpaceState);
  const newWorkNotification = useUiStore((s) => s.newWorkNotification);

  const setActiveSection = useUiStore((s) => s.setActiveSection);
  const setDeepLinkItemId = useUiStore((s) => s.setDeepLinkItemId);
  const setDrawerOpen = useUiStore((s) => s.setDrawerOpen);
  const setDrawerTab = useUiStore((s) => s.setDrawerTab);
  const setAuthorStudioOpen = useUiStore((s) => s.setAuthorStudioOpen);
  const setAuthModalOpen = useUiStore((s) => s.setAuthModalOpen);
  const setTelegramModalOpen = useUiStore((s) => s.setTelegramModalOpen);
  const setLeaderboardOpen = useUiStore((s) => s.setLeaderboardOpen);
  const setChatOpen = useUiStore((s) => s.setChatOpen);
  const setMusicSelectionsOpen = useUiStore((s) => s.setMusicSelectionsOpen);
  const setPoetryBackdropStyle = useUiStore((s) => s.setPoetryBackdropStyle);
  const setProseHomeBackdrop = useUiStore((s) => s.setProseHomeBackdrop);
  const setPoetryImmersionMode = useUiStore((s) => s.setPoetryImmersionMode);
  const setPoetrySpaceState = useUiStore((s) => s.setPoetrySpaceState);
  const setNewWorkNotification = useUiStore((s) => s.setNewWorkNotification);

  const guestUser = useAuthStore((s) => s.guestUser);
  const rememberedGuest = useAuthStore((s) => s.rememberedGuest);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const hasFirebaseSession = useAuthStore((s) => s.hasFirebaseSession);
  const requiresGoogleForAdmin = useAuthStore((s) => s.requiresGoogleForAdmin);
  const telegramSubscription = useAuthStore((s) => s.telegramSubscription);
  const hasUnreadReply = useAuthStore((s) => s.hasUnreadReply);
  const mySiteFeedback = useAuthStore((s) => s.mySiteFeedback);
  const guestSessionToken = useAuthStore((s) => s.guestSessionToken);
  const setGuestUser = useAuthStore((s) => s.setGuestUser);
  const setRememberedGuest = useAuthStore((s) => s.setRememberedGuest);
  const setIsAdmin = useAuthStore((s) => s.setIsAdmin);
  const setHasFirebaseSession = useAuthStore((s) => s.setHasFirebaseSession);
  const setRequiresGoogleForAdmin = useAuthStore((s) => s.setRequiresGoogleForAdmin);
  const setTelegramSubscription = useAuthStore((s) => s.setTelegramSubscription);
  const setHasUnreadReply = useAuthStore((s) => s.setHasUnreadReply);
  const setMySiteFeedback = useAuthStore((s) => s.setMySiteFeedback);
  const markFeedbackRepliesRead = useAuthStore((s) => s.markFeedbackRepliesRead);
  const setGuestSessionToken = useAuthStore((s) => s.setGuestSessionToken);

  const cartIds = useCartStore((s) => s.cartIds);
  const unlockedItems = useCartStore((s) => s.unlockedItems);
  const addToCartStore = useCartStore((s) => s.addToCart);
  const removeFromCartStore = useCartStore((s) => s.removeFromCart);
  const clearCartStore = useCartStore((s) => s.clearCart);
  const mergeUnlockedStore = useCartStore((s) => s.mergeUnlocked);
  const clearDeviceLibraryStore = useCartStore((s) => s.clearDeviceLibrary);

  const radioEnabled = useRadioStore((s) => s.radioEnabled);
  const radioIsPlaying = useRadioStore((s) => s.radioIsPlaying);
  const setRadioEnabled = useRadioStore((s) => s.setRadioEnabled);

  const isPoetryImmersed = activeSection === 'poetry' && poetryImmersionMode;

  useEffect(() => {
    if (activeSection !== 'poetry' && poetryImmersionMode) {
      setPoetryImmersionMode(false);
    }
  }, [activeSection, poetryImmersionMode, setPoetryImmersionMode]);

  const handleTogglePoetryImmersion = useCallback(() => {
    setPoetryImmersionMode((prev) => !prev);
  }, [setPoetryImmersionMode]);

  const newWorkToastTimeoutRef = useRef<number | null>(null);
  const guestSessionTokenRef = useRef<string | null>(guestSessionToken);
  guestSessionTokenRef.current = guestSessionToken;
  const firebaseSignedInRef = useRef(false);
  const catalogPromiseRef = useRef<Promise<void> | null>(null);
  const catalogMutationVersionRef = useRef(0);
  const homeShellRef = useRef<HomePayload | null>(homeShell);
  homeShellRef.current = homeShell;

  useEffect(() => {
    document.documentElement.classList.add('dark');
    try {
      localStorage.removeItem('dankiv_theme_dark');
    } catch {
      // Ignore storage errors
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
  }, [guestUser?.uid, guestUser?.firebaseUid, chatOpen, getGuestToken, setHasUnreadReply]);

  const handleOpenChatModal = useCallback(() => {
    setChatOpen(true);
    localStorage.setItem('dankiv_last_read_chat_reply', Date.now().toString());
    setHasUnreadReply(false);
  }, [setChatOpen, setHasUnreadReply]);

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_GUEST_STORAGE_KEY);
    } catch {
      // Clean up legacy key if present
    }
  }, []);

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
        const data = (await res.json()) as { feedback?: import('./types.ts').FeedbackRecord[] };
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
  }, [guestUser?.uid, getGuestToken]);

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
              blog: prev.blog,
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
  }, [getGuestToken, setCatalog, setHomeShell, setLoadError, setLoading, setNewWorkNotification, setUniqueVisitors]);

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
  }, [setCatalog, setHomeShell, setLoadError, setLoading, setUniqueVisitors]);

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
          !isInIframeNow && 'Notification' in window && Notification.permission === 'granted';
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
          if (document.visibilityState === 'hidden') return;
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
  }, [
    fetchCatalog,
    initialLocation.section,
    setHomeShell,
    setLoadError,
    setLoading,
    setUniqueVisitors,
  ]);

  const authObserverStartedRef = useRef(false);

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
  }, [isAdmin, setActiveSection, setAuthModalOpen, setDeepLinkItemId]);

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
  }, [isAdmin, setAuthModalOpen]);

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

  const handleOpenAuthorStudio = useCallback(() => {
    if (!isAdmin) return;
    setAuthorStudioOpen(true);
  }, [isAdmin, setAuthorStudioOpen]);

  const handlePrefetchSection = useCallback(
    (section: SectionId) => {
      const ignorePrefetchError = () => {
        // Ignore transient AbortError / network errors during prefetch
      };
      if (section !== 'home' && !useCatalogStore.getState().catalog) {
        void fetchCatalog();
      }
      if (section === 'poetry') void loadPoetrySection().catch(ignorePrefetchError);
      else if (section === 'prose') void loadProseSection().catch(ignorePrefetchError);
      else if (section === 'blog') void loadBlogSection().catch(ignorePrefetchError);
      else if (section === 'radio') void loadRadioSection().catch(ignorePrefetchError);
      else if (section === 'store') void loadStoreSection().catch(ignorePrefetchError);
    },
    [fetchCatalog]
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
      if (section !== 'home' && !useCatalogStore.getState().catalog) {
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
    [fetchCatalog, handlePrefetchSection, setActiveSection, setDeepLinkItemId, setDrawerOpen]
  );

  const handleSectionItemHash = useCallback(
    (section: 'poetry' | 'prose' | 'blog' | 'store', itemId: string | null) => {
      setDeepLinkItemId(itemId);
      const nextHash = itemId ? `#${section}/${encodeURIComponent(itemId)}` : `#${section}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
    },
    [setDeepLinkItemId]
  );

  const handleOpenSectionItem = useCallback(
    (section: 'poetry' | 'prose' | 'blog' | 'store', itemId: string) => {
      handlePrefetchSection(section);
      if (!useCatalogStore.getState().catalog) {
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
    [fetchCatalog, handlePrefetchSection, setActiveSection, setDeepLinkItemId, setDrawerOpen]
  );

  const handlePoemUpdated = useCallback(
    (updatedPoem: Poem) => {
      catalogMutationVersionRef.current += 1;
      updatePoem(updatedPoem);
    },
    [updatePoem]
  );

  const handleProseUpdated = useCallback(
    (updatedProse: ProseWork) => {
      catalogMutationVersionRef.current += 1;
      updateProse(updatedProse);
    },
    [updateProse]
  );

  const handleBlogUpdated = useCallback(
    (updatedPost: BlogPost) => {
      catalogMutationVersionRef.current += 1;
      updateBlogPost(updatedPost);
    },
    [updateBlogPost]
  );

  const handlePoemViewed = useCallback(
    (poemId: string, viewsCount: number) => {
      setPoemViews(poemId, viewsCount);
    },
    [setPoemViews]
  );

  const handleBlogViewed = useCallback(
    (postId: string, viewsCount: number) => {
      setBlogViews(postId, viewsCount);
    },
    [setBlogViews]
  );

  const handleProductUpdated = useCallback(
    (updatedProduct: StoreProduct) => {
      catalogMutationVersionRef.current += 1;
      updateProduct(updatedProduct);
    },
    [updateProduct]
  );

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

  const handleAddToCart = useCallback(
    (productId: string) => {
      const prod = useCatalogStore.getState().catalog?.products.find((p) => p.id === productId);
      trackClick(
        `cart_add:${productId}`,
        prod ? `У кошик: «${prod.title}»` : `У кошик: ${productId}`,
        'store'
      );
      addToCartStore(productId);
      setDrawerTab('cart');
      setDrawerOpen(true);
    },
    [addToCartStore, setDrawerOpen, setDrawerTab]
  );

  const handleCheckoutSuccess = useCallback(
    (newlyUnlocked: PurchasedAccess[]) => {
      mergeUnlockedStore(newlyUnlocked);
      clearCartStore();
    },
    [clearCartStore, mergeUnlockedStore]
  );

  const handleProsePurchased = useCallback(
    (unlocked: PurchasedAccess) => {
      mergeUnlockedStore([unlocked]);
    },
    [mergeUnlockedStore]
  );

  const handleRestoreOrders = useCallback(
    (restored: PurchasedAccess[]) => {
      mergeUnlockedStore(restored);
    },
    [mergeUnlockedStore]
  );

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
    useRadioStore.getState().handlers.pauseRadio();
    useRadioStore.getState().setRadioShowDirectEmbed(false);
    if (activeSection === 'radio') {
      setActiveSection('home');
      setDeepLinkItemId(null);
      if (window.location.hash !== '') {
        window.history.pushState(null, '', window.location.pathname);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeSection, handleNavigate, radioEnabled, setActiveSection, setDeepLinkItemId, setRadioEnabled]);

  const handleCloseLeaderboard = useCallback(() => setLeaderboardOpen(false), [setLeaderboardOpen]);
  const handleCloseChat = useCallback(() => setChatOpen(false), [setChatOpen]);
  const handleCloseMusicSelections = useCallback(
    () => setMusicSelectionsOpen(false),
    [setMusicSelectionsOpen]
  );
  const handleOpenAuthModalStable = useCallback(() => setAuthModalOpen(true), [setAuthModalOpen]);
  const handleOpenLeaderboardStable = useCallback(
    () => setLeaderboardOpen(true),
    [setLeaderboardOpen]
  );
  const handleOpenWeeklyMusicStable = useCallback(
    () => setMusicSelectionsOpen(true),
    [setMusicSelectionsOpen]
  );
  const handleOpenRadioStable = useCallback(() => {
    trackClick('header:radio', 'Кнопка радіо', 'section');
    handleNavigate('radio');
  }, [handleNavigate]);
  const handleOpenDrawerFromNav = useCallback(
    (tab?: 'cart' | 'library') => {
      if (tab) setDrawerTab(tab);
      setDrawerOpen(true);
    },
    [setDrawerOpen, setDrawerTab]
  );

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
                  monobankModalTitle={
                    homeViewData.monobankModalTitle ?? 'Підтримати через Монобанк'
                  }
                  monobankModalSubtitle={homeViewData.monobankModalSubtitle ?? ''}
                  monobankCardLabel={homeViewData.monobankCardLabel ?? 'Банка Монобанку'}
                  monobankModalText={homeViewData.monobankModalText ?? ''}
                  monobankEmptyText={homeViewData.monobankEmptyText ?? ''}
                  contactEmail={homeViewData.contactEmail ?? ''}
                  interviews={homeViewData.interviews ?? []}
                  homeActionAboutTitle={homeViewData.homeActionAboutTitle ?? 'Про мене'}
                  homeActionContactTitle={homeViewData.homeActionContactTitle ?? 'Зв’язок'}
                  homeActionMonobankTitle={
                    homeViewData.homeActionMonobankTitle ?? 'Підтримати через Монобанк'
                  }
                  homeActionInterviewsTitle={homeViewData.homeActionInterviewsTitle ?? 'Розмови'}
                  onHeroLeadUpdated={handleHeroLeadUpdated}
                  onAuthorAboutUpdated={handleAuthorAboutUpdated}
                  onContactEmailUpdated={handleContactEmailUpdated}
                  onSocialLinksUpdated={handleSocialLinksUpdated}
                  onOpenAuthorStudio={handleOpenAuthorStudio}
                  onOpenAuthModal={handleOpenAuthModalStable}
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
                  onFeedbackRepliesMarkedRead={markFeedbackRepliesRead}
                  isAdmin={isAdmin}
                  getAdminToken={getAdminToken}
                  isRadioEnabled={radioEnabled}
                  onToggleRadio={handleToggleRadioSetting}
                  isRadioPlaying={Boolean(guestUser && radioIsPlaying)}
                  onOpenLeaderboard={handleOpenLeaderboardStable}
                  onOpenChat={handleOpenChatModal}
                  hasUnreadReply={hasUnreadReply}
                  onOpenRadio={handleOpenRadioStable}
                  onOpenWeeklyMusic={handleOpenWeeklyMusicStable}
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
                  <Suspense fallback={<SectionSkeleton section={activeSection} embedded />}>
                    {activeSection === 'poetry' && (
                      <PoetrySection
                        poems={catalog.poems}
                        weeklyPoems={catalog.weeklyPoems ?? []}
                        weeklyCurrentPeriod={catalog.weeklyCurrentPeriod}
                        guestUser={guestUser}
                        getGuestToken={getGuestToken}
                        isAdmin={isAdmin}
                        getAdminToken={getAdminToken}
                        onOpenAuthModal={handleOpenAuthModalStable}
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
                        onOpenAuthModal={handleOpenAuthModalStable}
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
                        onPostUpdated={handleBlogUpdated}
                        initialPostId={deepLinkItemId}
                        onActivePostChange={(id) => handleSectionItemHash('blog', id)}
                      />
                    )}

                    {activeSection === 'radio' && (
                      <RadioSectionConnected
                        getGuestToken={getGuestToken}
                        getAdminToken={getAdminToken}
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
                        onOpenAuthModal={handleOpenAuthModalStable}
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
                onRemoveFromCart={removeFromCartStore}
                onCheckoutSuccess={handleCheckoutSuccess}
                unlockedItems={unlockedItems}
                guestUser={guestUser}
                getGuestToken={getGuestToken}
                monobankJarUrl={homeViewData?.monobankJarUrl ?? ''}
                onOpenAuthModal={handleOpenAuthModalStable}
                onRestoreOrders={handleRestoreOrders}
                onClearDeviceLibrary={clearDeviceLibraryStore}
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
              <AuthorStudioModalConnected
                isOpen={authorStudioOpen && isAdmin}
                isAdmin={isAdmin}
                getAdminToken={getAdminToken}
                onClose={() => setAuthorStudioOpen(false)}
                onCatalogUpdated={fetchCatalog}
                homeViewData={homeViewData}
                uniqueVisitors={uniqueVisitors}
                onHeroLeadUpdated={handleHeroLeadUpdated}
                onAuthorAboutUpdated={handleAuthorAboutUpdated}
                onAuthorPhotoUpdated={handleAuthorPhotoUpdated}
                onAuthorPhotosUpdated={handleAuthorPhotosUpdated}
                onSocialLinksUpdated={handleSocialLinksUpdated}
                onMonobankJarUpdated={handleMonobankJarUpdated}
                onMonobankModalTextsUpdated={handleMonobankModalTextsUpdated}
                onContactEmailUpdated={handleContactEmailUpdated}
                onInterviewsUpdated={handleInterviewsUpdated}
                onHomeActionAboutUpdated={handleHomeActionAboutUpdated}
                onHomeActionContactUpdated={handleHomeActionContactUpdated}
                onHomeActionMonobankUpdated={handleHomeActionMonobankUpdated}
                onHomeActionInterviewsUpdated={handleHomeActionInterviewsUpdated}
                onHomeRepeatersUpdated={handleHomeRepeatersUpdated}
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
                discountPercent={
                  catalog?.proseTelegramDiscountPercent ??
                  homeViewData?.proseTelegramDiscountPercent ??
                  50
                }
                subscription={telegramSubscription}
                onVerified={handleTelegramVerified}
                onClearVerification={handleClearTelegramVerification}
              />
            </Suspense>
          )}

          <RadioEngine getGuestToken={getGuestToken} getAdminToken={getAdminToken} />

          {/* Floating Leaderboard Button when signed in & not on home */}
          <AnimatePresence>
            {guestUser && activeSection !== 'home' && !isPoetryImmersed && (
              <m.button
                key="floating-leaderboard-btn"
                type="button"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
                onClick={() => {
                  trackClick('floating:leaderboard', 'Рейтинг (плаваюча кнопка)', 'section');
                  setLeaderboardOpen(true);
                }}
                aria-label="Рейтинг читачів"
                title="Рейтинг читачів"
                className="fixed bottom-[74px] sm:bottom-[78px] left-3.5 sm:left-6 z-30 w-9 h-9 rounded-full bg-[#FAF9F5] dark:bg-[#202020] text-[#B45309] dark:text-amber-400 shadow-[0_6px_18px_-5px_rgba(20,20,19,0.22)] dark:shadow-[0_8px_22px_-6px_rgba(0,0,0,0.72)] flex items-center justify-center hover:scale-105 active:scale-[0.94] transition-transform duration-150 cursor-pointer"
              >
                <Trophy className="w-4 h-4" strokeWidth={1.9} />
              </m.button>
            )}
          </AnimatePresence>

          {/* Minimized persistent Radio button on non-radio sections */}
          <AnimatePresence>
            {radioEnabled && guestUser && activeSection !== 'radio' && !isPoetryImmersed && (
              <m.div
                key="minimized-radio-btn"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
              >
                <MinimizedRadioButtonConnected onClick={handleOpenRadioStable} />
              </m.div>
            )}
          </AnimatePresence>

          {/* User Leaderboard Modal */}
          {leaderboardOpen && (
            <Suspense fallback={null}>
              <UserLeaderboardModal
                isOpen={leaderboardOpen}
                onClose={handleCloseLeaderboard}
                guestUser={guestUser}
                isAdmin={isAdmin}
                getAdminToken={getAdminToken}
                getGuestToken={getGuestToken}
                authToken={guestSessionToken}
              />
            </Suspense>
          )}

          {/* Global Community Chat Modal */}
          {chatOpen && (
            <Suspense fallback={null}>
              <GlobalChatModal
                isOpen={chatOpen}
                onClose={handleCloseChat}
                guestUser={guestUser}
                isAdmin={isAdmin}
                getGuestToken={getGuestToken}
                onOpenAuthModal={handleOpenAuthModalStable}
                onGuestUserUpdated={handleGuestUserUpdated}
              />
            </Suspense>
          )}

          {/* Monthly / Weekly Music Selections Modal */}
          {musicSelectionsOpen && (
            <Suspense fallback={null}>
              <MusicSelectionsModalConnected
                isOpen={musicSelectionsOpen}
                onClose={handleCloseMusicSelections}
                isAdmin={isAdmin}
                getAdminToken={getAdminToken}
              />
            </Suspense>
          )}

          <FirstVisitAuthHint
            guestUser={guestUser}
            rememberedGuest={rememberedGuest}
            suppress={
              authModalOpen ||
              chatOpen ||
              leaderboardOpen ||
              musicSelectionsOpen ||
              drawerOpen ||
              isPoetryImmersed
            }
            onOpenAuthModal={handleOpenAuthModalStable}
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
                className="fixed bottom-[78px] sm:bottom-[86px] right-4 sm:right-6 z-50 w-[min(calc(100vw-2rem),21rem)] rounded-2xl bg-white dark:bg-[#242424] border border-black/5 dark:border-white/10 shadow-[0_18px_40px_-14px_rgba(20,20,19,0.3)] dark:shadow-[0_22px_48px_-14px_rgba(0,0,0,0.85)] p-3 flex items-center justify-between gap-2.5"
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
                  onOpenDrawer={handleOpenDrawerFromNav}
                />
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
