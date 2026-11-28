import { AnimatePresence, LazyMotion, m, MotionConfig } from 'motion/react';
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { AppOverlays } from './components/AppOverlays.tsx';
import {
  BlogSection,
  FALLBACK_AUTHOR_ABOUT_TEXT,
  FALLBACK_AUTHOR_PHOTO_URL,
  loadBlogSection,
  loadPoetrySection,
  loadProseSection,
  loadRadioSection,
  loadStoreSection,
  PoetrySection,
  ProseSection,
  RadioSectionConnected,
  StoreSection,
} from './components/ConnectedSections.tsx';
import { HeroSection } from './components/HeroSection.tsx';
import { HomeShowcaseSection } from './components/HomeShowcaseSection.tsx';
import { PoetrySpaceBackdrop } from './components/PoetrySpaceBackdrop.tsx';
import { SectionSkeleton } from './components/SectionSkeleton.tsx';
import { FALLBACK_SOCIAL_LINKS } from './components/SocialIcons.tsx';
import { getFirebaseAuth } from './firebase.ts';
import { useAuthSession } from './hooks/useAuthSession.ts';
import { useCatalogSync } from './hooks/useCatalogSync.ts';
import { useUserRealtimeSync } from './hooks/useUserRealtimeSync.ts';
import { useAuthStore } from './store/useAuthStore.ts';
import { useCartStore } from './store/useCartStore.ts';
import { useCatalogStore } from './store/useCatalogStore.ts';
import { useRadioStore } from './store/useRadioStore.ts';
import { useUiStore } from './store/useUiStore.ts';
import type {
  BlogPost,
  HomeRepeatersConfig,
  InterviewLinkItem,
  Poem,
  ProseWork,
  PurchasedAccess,
  SectionId,
  SocialLinkItem,
  StoreProduct,
} from './types.ts';
import { initBehaviorAnalytics, setActiveMoment, trackClick } from './utils/analytics.ts';
import { initGlobalButtonHaptics } from './utils/haptics.ts';
import {
  parseInitialSecretSearch,
  parseLocationHash,
  updateDocumentSeoMetadata,
} from './utils/urlRouting.ts';

const loadMotionFeatures = () => import('motion/react').then((mod) => mod.domMax);

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

export default function App() {
  const initialLocation = useMemo(() => parseLocationHash(), []);
  const initialSecretSearch = useMemo(() => parseInitialSecretSearch(), []);

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

  const homeShell = useCatalogStore((s) => s.homeShell);
  const catalog = useCatalogStore((s) => s.catalog);
  const loading = useCatalogStore((s) => s.loading);
  const loadError = useCatalogStore((s) => s.loadError);
  const uniqueVisitors = useCatalogStore((s) => s.uniqueVisitors);
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
  const authorStudioOpen = useUiStore((s) => s.authorStudioOpen);
  const authModalOpen = useUiStore((s) => s.authModalOpen);
  const poetryBackdropStyle = useUiStore((s) => s.poetryBackdropStyle);
  const proseHomeBackdrop = useUiStore((s) => s.proseHomeBackdrop);
  const poetryImmersionMode = useUiStore((s) => s.poetryImmersionMode);
  const poetrySpaceState = useUiStore((s) => s.poetrySpaceState);

  const setActiveSection = useUiStore((s) => s.setActiveSection);
  const setDeepLinkItemId = useUiStore((s) => s.setDeepLinkItemId);
  const setDrawerOpen = useUiStore((s) => s.setDrawerOpen);
  const setDrawerTab = useUiStore((s) => s.setDrawerTab);
  const setAuthorStudioOpen = useUiStore((s) => s.setAuthorStudioOpen);
  const setAuthModalOpen = useUiStore((s) => s.setAuthModalOpen);
  const setTelegramModalOpen = useUiStore((s) => s.setTelegramModalOpen);
  const setLeaderboardOpen = useUiStore((s) => s.setLeaderboardOpen);
  const setMusicSelectionsOpen = useUiStore((s) => s.setMusicSelectionsOpen);
  const setPoetryBackdropStyle = useUiStore((s) => s.setPoetryBackdropStyle);
  const setProseHomeBackdrop = useUiStore((s) => s.setProseHomeBackdrop);
  const setPoetryImmersionMode = useUiStore((s) => s.setPoetryImmersionMode);
  const setPoetrySpaceState = useUiStore((s) => s.setPoetrySpaceState);

  const guestUser = useAuthStore((s) => s.guestUser);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const telegramSubscription = useAuthStore((s) => s.telegramSubscription);
  const hasUnreadReply = useAuthStore((s) => s.hasUnreadReply);
  const mySiteFeedback = useAuthStore((s) => s.mySiteFeedback);
  const setMySiteFeedback = useAuthStore((s) => s.setMySiteFeedback);
  const markFeedbackRepliesRead = useAuthStore((s) => s.markFeedbackRepliesRead);

  const cartIds = useCartStore((s) => s.cartIds);
  const unlockedItems = useCartStore((s) => s.unlockedItems);
  const addToCartStore = useCartStore((s) => s.addToCart);
  const clearCartStore = useCartStore((s) => s.clearCart);
  const mergeUnlockedStore = useCartStore((s) => s.mergeUnlocked);

  const radioEnabled = useRadioStore((s) => s.radioEnabled);
  const radioIsPlaying = useRadioStore((s) => s.radioIsPlaying);
  const setRadioEnabled = useRadioStore((s) => s.setRadioEnabled);

  const {
    getAdminToken,
    getGuestToken,
    guestSessionTokenRef,
    handleTelegramVerified,
    handleClearTelegramVerification,
    handleAuthenticatedGuest,
    handleGuestUserUpdated,
    handleForgetRememberedGuest,
    handleLogoutGuest,
  } = useAuthSession();

  const { unreadFeedbackRepliesCount, handleOpenChatModal } = useUserRealtimeSync({
    getGuestToken,
    guestSessionTokenRef,
  });

  const { fetchCatalog, markCatalogMutated } = useCatalogSync({
    initialSection: initialLocation.section,
    getGuestToken,
  });

  const isPoetryImmersed = activeSection === 'poetry' && poetryImmersionMode;

  useEffect(() => {
    if (activeSection !== 'poetry' && poetryImmersionMode) {
      setPoetryImmersionMode(false);
    }
  }, [activeSection, poetryImmersionMode, setPoetryImmersionMode]);

  const handleTogglePoetryImmersion = useCallback(() => {
    setPoetryImmersionMode((prev) => !prev);
  }, [setPoetryImmersionMode]);

  useEffect(() => {
    document.documentElement.classList.add('dark');
    try {
      localStorage.removeItem('dankiv_theme_dark');
    } catch {
      // Ignore storage errors
    }
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

  useEffect(() => initBehaviorAnalytics(initialLocation.section), [initialLocation.section]);
  useEffect(() => initGlobalButtonHaptics(), []);

  useEffect(() => {
    updateDocumentSeoMetadata(activeSection, deepLinkItemId, catalog);
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

  const handleOpenPoem = useCallback(
    (poemId: string) => handleOpenSectionItem('poetry', poemId),
    [handleOpenSectionItem]
  );
  const handleOpenProse = useCallback(
    (proseId: string) => handleOpenSectionItem('prose', proseId),
    [handleOpenSectionItem]
  );
  const handleOpenBlog = useCallback(
    (postId: string) => handleOpenSectionItem('blog', postId),
    [handleOpenSectionItem]
  );
  const handleOpenProduct = useCallback(
    (productId: string) => handleOpenSectionItem('store', productId),
    [handleOpenSectionItem]
  );

  const handleActivePoemChange = useCallback(
    (id: string | null) => handleSectionItemHash('poetry', id),
    [handleSectionItemHash]
  );
  const handleActiveProseChange = useCallback(
    (id: string | null) => handleSectionItemHash('prose', id),
    [handleSectionItemHash]
  );
  const handleActivePostChange = useCallback(
    (id: string | null) => handleSectionItemHash('blog', id),
    [handleSectionItemHash]
  );
  const handleActiveProductChange = useCallback(
    (id: string | null) => handleSectionItemHash('store', id),
    [handleSectionItemHash]
  );

  const handlePoemUpdated = useCallback(
    (updatedPoem: Poem) => {
      markCatalogMutated();
      updatePoem(updatedPoem);
    },
    [markCatalogMutated, updatePoem]
  );

  const handleProseUpdated = useCallback(
    (updatedProse: ProseWork) => {
      markCatalogMutated();
      updateProse(updatedProse);
    },
    [markCatalogMutated, updateProse]
  );

  const handleBlogUpdated = useCallback(
    (updatedPost: BlogPost) => {
      markCatalogMutated();
      updateBlogPost(updatedPost);
    },
    [markCatalogMutated, updateBlogPost]
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
      markCatalogMutated();
      updateProduct(updatedProduct);
    },
    [markCatalogMutated, updateProduct]
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

  const handleOpenLibrary = useCallback(() => {
    setDrawerTab(cartProducts.length > 0 ? 'cart' : 'library');
    setDrawerOpen(true);
  }, [cartProducts.length, setDrawerOpen, setDrawerTab]);

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

  const handleOpenAuthModalStable = useCallback(() => setAuthModalOpen(true), [setAuthModalOpen]);
  const handleSecretAdminTrigger = useCallback(() => {
    if (!isAdmin) {
      setAuthModalOpen(true);
    }
  }, [isAdmin, setAuthModalOpen]);
  const handleOpenTelegramModal = useCallback(
    () => setTelegramModalOpen(true),
    [setTelegramModalOpen]
  );
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
                <p className="text-xl text-ink dark:text-cream mb-4">{loadError}</p>
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
                  onSecretAdminTrigger={handleSecretAdminTrigger}
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
                      onOpenPoem={handleOpenPoem}
                      onOpenProse={handleOpenProse}
                      onOpenBlog={handleOpenBlog}
                      onOpenProduct={handleOpenProduct}
                      onAddToCart={handleAddToCart}
                      onOpenLibrary={handleOpenLibrary}
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
                        onActivePoemChange={handleActivePoemChange}
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
                        onOpenTelegramModal={handleOpenTelegramModal}
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
                        onActiveProseChange={handleActiveProseChange}
                        onHomeBackdropChange={setProseHomeBackdrop}
                      />
                    )}

                    {activeSection === 'blog' && (
                      <BlogSection
                        posts={catalog.blog}
                        onPostViewed={handleBlogViewed}
                        onPostUpdated={handleBlogUpdated}
                        initialPostId={deepLinkItemId}
                        onActivePostChange={handleActivePostChange}
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
                        onOpenLibrary={handleOpenLibrary}
                        onProductUpdated={handleProductUpdated}
                        initialProductId={deepLinkItemId}
                        onActiveProductChange={handleActiveProductChange}
                      />
                    )}
                  </Suspense>
                </div>
              </m.div>
            )}
          </main>

          <AppOverlays
            homeViewData={homeViewData}
            uniqueVisitors={uniqueVisitors}
            cartProducts={cartProducts}
            unlockedItems={unlockedItems}
            isPoetryImmersed={isPoetryImmersed}
            getAdminToken={getAdminToken}
            getGuestToken={getGuestToken}
            fetchCatalog={fetchCatalog}
            handleAuthenticatedGuest={handleAuthenticatedGuest}
            handleGuestUserUpdated={handleGuestUserUpdated}
            handleLogoutGuest={handleLogoutGuest}
            handleForgetRememberedGuest={handleForgetRememberedGuest}
            handleOpenAuthorStudio={handleOpenAuthorStudio}
            handleTelegramVerified={handleTelegramVerified}
            handleClearTelegramVerification={handleClearTelegramVerification}
            handleCheckoutSuccess={handleCheckoutSuccess}
            handleRestoreOrders={handleRestoreOrders}
            handleNavigate={handleNavigate}
            handlePrefetchSection={handlePrefetchSection}
            handleOpenSectionItem={handleOpenSectionItem}
            handleOpenDrawerFromNav={handleOpenDrawerFromNav}
            handleOpenRadioStable={handleOpenRadioStable}
            handleHeroLeadUpdated={handleHeroLeadUpdated}
            handleAuthorAboutUpdated={handleAuthorAboutUpdated}
            handleAuthorPhotoUpdated={handleAuthorPhotoUpdated}
            handleAuthorPhotosUpdated={handleAuthorPhotosUpdated}
            handleSocialLinksUpdated={handleSocialLinksUpdated}
            handleMonobankJarUpdated={handleMonobankJarUpdated}
            handleMonobankModalTextsUpdated={handleMonobankModalTextsUpdated}
            handleContactEmailUpdated={handleContactEmailUpdated}
            handleInterviewsUpdated={handleInterviewsUpdated}
            handleHomeActionAboutUpdated={handleHomeActionAboutUpdated}
            handleHomeActionContactUpdated={handleHomeActionContactUpdated}
            handleHomeActionMonobankUpdated={handleHomeActionMonobankUpdated}
            handleHomeActionInterviewsUpdated={handleHomeActionInterviewsUpdated}
            handleHomeRepeatersUpdated={handleHomeRepeatersUpdated}
          />
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
