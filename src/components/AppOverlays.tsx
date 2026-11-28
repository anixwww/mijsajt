import { BellRing, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { memo, Suspense, useCallback } from 'react';
import { useAuthStore } from '../store/useAuthStore.ts';
import { useCartStore } from '../store/useCartStore.ts';
import { useCatalogStore } from '../store/useCatalogStore.ts';
import { useRadioStore } from '../store/useRadioStore.ts';
import { useUiStore } from '../store/useUiStore.ts';
import type {
  ChatMessageAttachment,
  GuestUser,
  HomePayload,
  HomeRepeatersConfig,
  InterviewLinkItem,
  PurchasedAccess,
  SectionId,
  SocialLinkItem,
  StoreProduct,
  TelegramSubscriptionState,
} from '../types.ts';
import { useAllRadioTracks } from '../utils/radioSelectors.ts';
import {
  AuthorStudioModalConnected,
  CartLibraryDrawer,
  GlobalChatModal,
  GuestAuthModal,
  MusicSelectionsModalConnected,
  TelegramVerifyModal,
  UserLeaderboardModal,
} from './ConnectedSections.tsx';
import { FirstVisitAuthHint } from './FirstVisitAuthHint.tsx';
import { OfflineIndicator } from './OfflineIndicator.tsx';
import { RadioEngine } from './RadioEngine.tsx';
import { SiteBottomNav } from './SiteBottomNav.tsx';

export interface AppOverlaysProps {
  homeViewData: HomePayload | null;
  uniqueVisitors: number;
  cartProducts: StoreProduct[];
  unlockedItems: PurchasedAccess[];
  isPoetryImmersed: boolean;
  getAdminToken: (forceRefresh?: boolean) => Promise<string | null>;
  getGuestToken: (forceRefresh?: boolean) => Promise<string | null>;
  fetchCatalog: () => Promise<void>;
  handleAuthenticatedGuest: (
    user: GuestUser,
    options?: { isAdmin?: boolean; sessionToken?: string; requiresGoogleForAdmin?: boolean }
  ) => void;
  handleGuestUserUpdated: (user: GuestUser) => void;
  handleLogoutGuest: (mode?: 'lock' | 'forget') => Promise<void> | void;
  handleForgetRememberedGuest: () => void;
  handleOpenAuthorStudio: () => void;
  handleTelegramVerified: (next: TelegramSubscriptionState) => void;
  handleClearTelegramVerification: () => void;
  handleCheckoutSuccess: (newlyUnlocked: PurchasedAccess[]) => void;
  handleRestoreOrders: (restored: PurchasedAccess[]) => void;
  handleNavigate: (section: SectionId) => void;
  handlePrefetchSection: (section: SectionId) => void;
  handleOpenSectionItem: (section: 'poetry' | 'prose' | 'blog' | 'store', itemId: string) => void;
  handleOpenDrawerFromNav: (tab?: 'cart' | 'library') => void;
  handleOpenRadioStable: () => void;
  handleHeroLeadUpdated: (nextText: string) => void;
  handleAuthorAboutUpdated: (nextAbout: string) => void;
  handleAuthorPhotoUpdated: (nextPhotoUrl: string) => void;
  handleAuthorPhotosUpdated: (nextPhotos: string[]) => void;
  handleSocialLinksUpdated: (nextLinks: SocialLinkItem[]) => void;
  handleMonobankJarUpdated: (nextUrl: string) => void;
  handleMonobankModalTextsUpdated: (next: {
    monobankModalTitle: string;
    monobankModalSubtitle: string;
    monobankCardLabel: string;
    monobankModalText: string;
    monobankEmptyText: string;
  }) => void;
  handleContactEmailUpdated: (nextEmail: string) => void;
  handleInterviewsUpdated: (nextInterviews: InterviewLinkItem[]) => void;
  handleHomeActionAboutUpdated: (title: string) => void;
  handleHomeActionContactUpdated: (title: string) => void;
  handleHomeActionMonobankUpdated: (title: string) => void;
  handleHomeActionInterviewsUpdated: (title: string) => void;
  handleHomeRepeatersUpdated: (nextRepeaters: HomeRepeatersConfig) => void;
  handleShowVisitorCounterUpdated?: (show: boolean) => void;
}

export const AppOverlays = memo(function AppOverlays({
  homeViewData,
  uniqueVisitors,
  cartProducts,
  unlockedItems,
  isPoetryImmersed,
  getAdminToken,
  getGuestToken,
  fetchCatalog,
  handleAuthenticatedGuest,
  handleGuestUserUpdated,
  handleLogoutGuest,
  handleForgetRememberedGuest,
  handleOpenAuthorStudio,
  handleTelegramVerified,
  handleClearTelegramVerification,
  handleCheckoutSuccess,
  handleRestoreOrders,
  handleNavigate,
  handlePrefetchSection,
  handleOpenSectionItem,
  handleOpenDrawerFromNav,
  handleOpenRadioStable,
  handleHeroLeadUpdated,
  handleAuthorAboutUpdated,
  handleAuthorPhotoUpdated,
  handleAuthorPhotosUpdated,
  handleSocialLinksUpdated,
  handleMonobankJarUpdated,
  handleMonobankModalTextsUpdated,
  handleContactEmailUpdated,
  handleInterviewsUpdated,
  handleHomeActionAboutUpdated,
  handleHomeActionContactUpdated,
  handleHomeActionMonobankUpdated,
  handleHomeActionInterviewsUpdated,
  handleHomeRepeatersUpdated,
  handleShowVisitorCounterUpdated,
}: AppOverlaysProps) {
  const catalog = useCatalogStore((s) => s.catalog);

  const activeSection = useUiStore((s) => s.activeSection);
  const drawerOpen = useUiStore((s) => s.drawerOpen);
  const drawerTab = useUiStore((s) => s.drawerTab);
  const authorStudioOpen = useUiStore((s) => s.authorStudioOpen);
  const authModalOpen = useUiStore((s) => s.authModalOpen);
  const telegramModalOpen = useUiStore((s) => s.telegramModalOpen);
  const leaderboardOpen = useUiStore((s) => s.leaderboardOpen);
  const chatOpen = useUiStore((s) => s.chatOpen);
  const musicSelectionsOpen = useUiStore((s) => s.musicSelectionsOpen);
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
  const setNewWorkNotification = useUiStore((s) => s.setNewWorkNotification);

  const guestUser = useAuthStore((s) => s.guestUser);
  const rememberedGuest = useAuthStore((s) => s.rememberedGuest);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const hasFirebaseSession = useAuthStore((s) => s.hasFirebaseSession);
  const requiresGoogleForAdmin = useAuthStore((s) => s.requiresGoogleForAdmin);
  const telegramSubscription = useAuthStore((s) => s.telegramSubscription);
  const guestSessionToken = useAuthStore((s) => s.guestSessionToken);

  const removeFromCartStore = useCartStore((s) => s.removeFromCart);
  const clearDeviceLibraryStore = useCartStore((s) => s.clearDeviceLibrary);
  const selectRadioTrack = useRadioStore((s) => s.handlers.selectTrack);
  const changeRadioStation = useRadioStore((s) => s.handlers.changeStation);
  const allRadioTracks = useAllRadioTracks();

  const handleCloseDrawer = useCallback(() => setDrawerOpen(false), [setDrawerOpen]);
  const handleCloseAuthorStudio = useCallback(() => setAuthorStudioOpen(false), [setAuthorStudioOpen]);
  const handleCloseAuthModal = useCallback(() => setAuthModalOpen(false), [setAuthModalOpen]);
  const handleCloseTelegramModal = useCallback(() => setTelegramModalOpen(false), [setTelegramModalOpen]);
  const handleCloseLeaderboard = useCallback(() => setLeaderboardOpen(false), [setLeaderboardOpen]);
  const handleCloseChat = useCallback(() => setChatOpen(false), [setChatOpen]);
  const handleCloseMusicSelections = useCallback(
    () => setMusicSelectionsOpen(false),
    [setMusicSelectionsOpen]
  );
  const handleOpenAuthModalStable = useCallback(() => setAuthModalOpen(true), [setAuthModalOpen]);

  const handleOpenProseFromDrawer = useCallback(
    (proseId: string) => {
      setActiveSection('prose');
      setDeepLinkItemId(proseId);
      setDrawerOpen(false);
      window.history.pushState(null, '', `#prose/${encodeURIComponent(proseId)}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [setActiveSection, setDeepLinkItemId, setDrawerOpen]
  );

  const handleOpenPoemFromAuth = useCallback(
    (poemId: string) => {
      setActiveSection('poetry');
      setDeepLinkItemId(poemId);
      setAuthModalOpen(false);
      const nextHash = `#poetry/${encodeURIComponent(poemId)}`;
      if (window.location.hash !== nextHash) {
        window.history.pushState(null, '', nextHash);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [setActiveSection, setAuthModalOpen, setDeepLinkItemId]
  );

  const handleOpenProseFromAuth = useCallback(
    (proseId: string) => {
      handleOpenSectionItem('prose', proseId);
      setAuthModalOpen(false);
    },
    [handleOpenSectionItem, setAuthModalOpen]
  );

  const handleCatalogRefresh = useCallback(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  const handleOpenChatAttachment = useCallback(
    (attachment: ChatMessageAttachment) => {
      setChatOpen(false);
      if (attachment.type === 'poem') {
        handleOpenSectionItem('poetry', attachment.id);
      } else if (attachment.type === 'prose') {
        handleOpenSectionItem('prose', attachment.id);
      } else if (attachment.type === 'radio') {
        const track = allRadioTracks.find((t) => t.id === attachment.id);
        if (track?.station) {
          changeRadioStation(track.station);
        }
        selectRadioTrack(attachment.id, true, 'repertoire');
        handleOpenRadioStable();
      }
    },
    [
      allRadioTracks,
      changeRadioStation,
      handleOpenRadioStable,
      handleOpenSectionItem,
      selectRadioTrack,
      setChatOpen,
    ]
  );

  return (
    <>
      {drawerOpen && (
        <Suspense fallback={null}>
          <CartLibraryDrawer
            isOpen={drawerOpen}
            activeTab={drawerTab}
            onTabChange={setDrawerTab}
            onClose={handleCloseDrawer}
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
            onOpenProse={handleOpenProseFromDrawer}
          />
        </Suspense>
      )}

      {authorStudioOpen && isAdmin && (
        <Suspense fallback={null}>
          <AuthorStudioModalConnected
            isOpen={authorStudioOpen && isAdmin}
            isAdmin={isAdmin}
            getAdminToken={getAdminToken}
            onClose={handleCloseAuthorStudio}
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
            onShowVisitorCounterUpdated={handleShowVisitorCounterUpdated}
          />
        </Suspense>
      )}

      {authModalOpen && (
        <Suspense fallback={null}>
          <GuestAuthModal
            isOpen={authModalOpen}
            onClose={handleCloseAuthModal}
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
            onOpenPoem={handleOpenPoemFromAuth}
            onOpenProse={handleOpenProseFromAuth}
            onCatalogUpdated={handleCatalogRefresh}
          />
        </Suspense>
      )}

      {telegramModalOpen && (
        <Suspense fallback={null}>
          <TelegramVerifyModal
            isOpen={telegramModalOpen}
            onClose={handleCloseTelegramModal}
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
            getAdminToken={getAdminToken}
            onOpenAuthModal={handleOpenAuthModalStable}
            onGuestUserUpdated={handleGuestUserUpdated}
            onOpenAttachment={handleOpenChatAttachment}
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
            className="fixed bottom-[78px] sm:bottom-[86px] right-4 sm:right-6 z-50 w-[min(calc(100vw-2rem),21rem)] rounded-2xl bg-white dark:bg-night-card border border-black/5 dark:border-white/10 shadow-[0_18px_40px_-14px_rgba(20,20,19,0.3)] dark:shadow-[0_22px_48px_-14px_rgba(0,0,0,0.85)] p-3 flex items-center justify-between gap-2.5"
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
              <span className="w-8 h-8 rounded-xl bg-paper-sand dark:bg-night-elevated text-pine dark:text-silver inline-flex items-center justify-center shrink-0">
                <BellRing className="w-4 h-4" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-pine dark:text-parchment">
                  {newWorkNotification.kindLabel}
                </p>
                <p className="text-xs font-semibold text-ink dark:text-cream truncate group-hover:underline">
                  «{newWorkNotification.title}»
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setNewWorkNotification(null)}
              aria-label="Закрити сповіщення"
              className="p-1.5 rounded-lg text-ink-muted dark:text-parchment hover:bg-paper-warm dark:hover:bg-night-elevated shrink-0 cursor-pointer"
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
    </>
  );
});
