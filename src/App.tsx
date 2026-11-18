import { onAuthStateChanged, signOut } from 'firebase/auth';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthorStudioModal } from './components/AuthorStudioModal.tsx';
import { BlogSection } from './components/BlogSection.tsx';
import { CartLibraryDrawer } from './components/CartLibraryDrawer.tsx';
import { Footer } from './components/Footer.tsx';
import { GuestAuthModal } from './components/GuestAuthModal.tsx';
import { HeroSection } from './components/HeroSection.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { PoetrySection } from './components/PoetrySection.tsx';
import { ProseSection } from './components/ProseSection.tsx';
import { SectionNavBar } from './components/SectionNavBar.tsx';
import { StoreSection } from './components/StoreSection.tsx';
import { auth } from './firebase.ts';
import type {
  CatalogResponse,
  GuestUser,
  Poem,
  PurchasedAccess,
  SectionId,
  StoreProduct,
} from './types.ts';
import { initBehaviorAnalytics, setActiveMoment, trackClick } from './utils/analytics.ts';
import {
  CART_STORAGE_KEY,
  clearActiveUserFromDevice,
  GUEST_USER_STORAGE_KEY,
  hydrateDeviceStateFromIndexedDB,
  mirrorPreferenceToDevice,
  saveActiveUserToDevice,
  THEME_STORAGE_KEY,
  UNLOCKED_STORAGE_KEY,
} from './utils/userMemory.ts';

const VALID_SECTIONS: SectionId[] = ['home', 'poetry', 'prose', 'blog', 'store'];

function parseLocationHash(): { section: SectionId; itemId: string | null } {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return { section: 'home', itemId: null };
  const [sectionPart, itemPart] = raw.split('/');
  const section = VALID_SECTIONS.includes(sectionPart as SectionId)
    ? (sectionPart as SectionId)
    : 'home';
  return {
    section,
    itemId: itemPart ? decodeURIComponent(itemPart) : null,
  };
}

export default function App() {
  const initialLocation = useMemo(() => parseLocationHash(), []);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [uniqueVisitors, setUniqueVisitors] = useState<number>(1);
  const [activeSection, setActiveSection] = useState<SectionId>(initialLocation.section);
  const [deepLinkItemId, setDeepLinkItemId] = useState<string | null>(initialLocation.itemId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'cart' | 'library'>('cart');
  const [authorStudioOpen, setAuthorStudioOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return saved === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      document.documentElement.classList.toggle('dark', theme === 'dark');
    } catch {}
    mirrorPreferenceToDevice('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));

  const [guestUser, setGuestUser] = useState<GuestUser | null>(() => {
    try {
      const saved = localStorage.getItem(GUEST_USER_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

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
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const fetchCatalog = useCallback(async () => {
    try {
      const response = await fetch('/api/catalog');
      if (!response.ok) {
        throw new Error('Помилка завантаження даних');
      }
      const data: CatalogResponse = await response.json();
      setCatalog(data);
      if (typeof data.uniqueVisitors === 'number') {
        setUniqueVisitors(data.uniqueVisitors);
      }
      setLoadError(null);
    } catch {
      setLoadError('Не вдалося завантажити матеріали сайту. Оновіть сторінку.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  const getAdminToken = useCallback(async (): Promise<string | null> => {
    if (auth.currentUser) {
      try {
        return await auth.currentUser.getIdToken();
      } catch {
        // Fall through to domain/device author session token
      }
    }
    if (guestUser?.sessionToken) {
      return guestUser.sessionToken;
    }
    return null;
  }, [guestUser]);

  useEffect(() => {
    let active = true;
    hydrateDeviceStateFromIndexedDB().then((hydrated) => {
      if (!active) return;
      if (hydrated.activeUser) {
        setGuestUser((prev) => prev ?? hydrated.activeUser);
      }
      if (hydrated.cartIds && hydrated.cartIds.length > 0) {
        setCartIds((prev) => (prev.length > 0 ? prev : hydrated.cartIds!));
      }
      if (hydrated.unlockedItems && hydrated.unlockedItems.length > 0) {
        setUnlockedItems((prev) => (prev.length > 0 ? prev : hydrated.unlockedItems!));
      }
      if (hydrated.theme) {
        setTheme((prev) => (localStorage.getItem(THEME_STORAGE_KEY) ? prev : hydrated.theme!));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!guestUser?.sessionToken) return;

    fetch('/api/guest/session', {
      headers: { Authorization: `Bearer ${guestUser.sessionToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { valid?: boolean; isAdmin?: boolean; user?: GuestUser } | null) => {
        if (!active) return;
        if (data?.valid && data.user) {
          const adminConfirmed = Boolean(data.isAdmin);
          setIsAdmin(adminConfirmed);
          if (!adminConfirmed) {
            setAuthorStudioOpen(false);
          }
          setGuestUser((prev) => {
            if (
              prev &&
              prev.uid === data.user!.uid &&
              prev.displayName === data.user!.displayName &&
              prev.email === data.user!.email
            ) {
              return prev;
            }
            saveActiveUserToDevice(data.user!, true);
            return data.user!;
          });
          return;
        }

        setIsAdmin(false);
        setAuthorStudioOpen(false);
        setGuestUser((prev) => {
          if (!prev?.sessionToken) return prev;
          const cleaned = { ...prev };
          delete cleaned.sessionToken;
          saveActiveUserToDevice(cleaned, false);
          return cleaned;
        });
      })
      .catch(() => {
        // Keep cached offline user on transient / offline network failure
      });

    return () => {
      active = false;
    };
  }, [guestUser?.sessionToken]);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const syncedUser: GuestUser = {
          uid: fbUser.uid,
          displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Гість',
          email: fbUser.email || '',
          photoUrl: fbUser.photoURL || undefined,
          provider: fbUser.providerData.some((p) => p.providerId === 'google.com')
            ? 'google'
            : 'email',
        };
        setGuestUser(syncedUser);
        saveActiveUserToDevice(syncedUser, true);

        try {
          const token = await fbUser.getIdToken();
          const roleRes = await fetch('/api/auth/role', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!active) return;
          if (roleRes.ok) {
            const roleData = (await roleRes.json()) as { isAdmin?: boolean };
            const adminConfirmed = Boolean(roleData.isAdmin);
            setIsAdmin(adminConfirmed);
            if (!adminConfirmed) {
              setAuthorStudioOpen(false);
            }
          } else {
            setIsAdmin(false);
            setAuthorStudioOpen(false);
          }
        } catch {
          if (active) {
            setIsAdmin(false);
            setAuthorStudioOpen(false);
          }
        }
      } else {
        let hasLocalSessionToken = false;
        try {
          const savedRaw = localStorage.getItem(GUEST_USER_STORAGE_KEY);
          const savedParsed = savedRaw ? (JSON.parse(savedRaw) as GuestUser) : null;
          hasLocalSessionToken = Boolean(savedParsed?.sessionToken);
        } catch {
          hasLocalSessionToken = false;
        }

        if (!hasLocalSessionToken) {
          setIsAdmin(false);
          setAuthorStudioOpen(false);
        }
        setGuestUser((prev) => {
          if (prev?.provider === 'google') {
            try {
              localStorage.removeItem(GUEST_USER_STORAGE_KEY);
            } catch {
              // Ignore storage errors
            }
            return null;
          }
          return prev;
        });
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseLocationHash();
      setActiveSection(parsed.section);
      setDeepLinkItemId(parsed.itemId);
      if (!parsed.itemId) {
        window.scrollTo({ top: 0 });
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const visitorInterval = window.setInterval(() => {
      fetch('/api/visitors/track', { method: 'POST' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.uniqueVisitors === 'number') {
            setUniqueVisitors(data.uniqueVisitors);
          }
        })
        .catch(() => {
          // Ignore transient errors
        });
    }, 15000);

    return () => window.clearInterval(visitorInterval);
  }, []);

  useEffect(() => {
    return initBehaviorAnalytics();
  }, []);

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
    mirrorPreferenceToDevice('cartIds', cartIds);
  }, [cartIds]);

  useEffect(() => {
    try {
      localStorage.setItem(UNLOCKED_STORAGE_KEY, JSON.stringify(unlockedItems));
    } catch {
      // Ignore storage errors
    }
    mirrorPreferenceToDevice('unlockedItems', unlockedItems);
  }, [unlockedItems]);

  const handleAuthenticatedGuest = (user: GuestUser, rememberOnDevice = true) => {
    setGuestUser(user);
    saveActiveUserToDevice(user, rememberOnDevice);
  };

  const handleLogoutGuest = async () => {
    try {
      if (auth.currentUser) {
        await signOut(auth);
      }
    } catch {
      // Ignore Firebase signOut failure
    }
    setGuestUser(null);
    setIsAdmin(false);
    setAuthorStudioOpen(false);
    clearActiveUserFromDevice(false);
  };

  const handleOpenAuthorStudio = useCallback(() => {
    if (!isAdmin) return;
    setAuthorStudioOpen(true);
  }, [isAdmin]);

  const handleNavigate = (section: SectionId) => {
    const sectionLabels: Record<SectionId, string> = {
      home: 'Повернення: На головну',
      poetry: 'Розділ: Вірші',
      prose: 'Розділ: Проза',
      blog: 'Розділ: Блог',
      store: 'Розділ: Крамниця',
    };
    trackClick(`nav:${section}`, sectionLabels[section], 'section');
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
  };

  const handleSectionItemHash = useCallback(
    (section: 'poetry' | 'blog', itemId: string | null) => {
      setDeepLinkItemId(itemId);
      const nextHash = itemId ? `#${section}/${encodeURIComponent(itemId)}` : `#${section}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
    },
    []
  );

  const handlePoemUpdated = useCallback((updatedPoem: Poem) => {
    setCatalog((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        poems: prev.poems.map((p) => (p.id === updatedPoem.id ? updatedPoem : p)),
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

  const handleHeroLeadUpdated = useCallback((nextText: string) => {
    setCatalog((prev) => (prev ? { ...prev, heroLeadText: nextText } : prev));
  }, []);

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
    setUnlockedItems((prev) => {
      const merged = new Map<string, PurchasedAccess>();
      for (const item of prev) merged.set(item.productId, item);
      for (const item of newlyUnlocked) merged.set(item.productId, item);
      return Array.from(merged.values());
    });
    setCartIds([]);
  };

  const handleRestoreOrders = (restored: PurchasedAccess[]) => {
    setUnlockedItems((prev) => {
      const merged = new Map<string, PurchasedAccess>();
      for (const item of prev) merged.set(item.productId, item);
      for (const item of restored) merged.set(item.productId, item);
      return Array.from(merged.values());
    });
  };

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

  const stats = useMemo(() => {
    if (!catalog) {
      return { poemsCount: 0, proseCount: 0, blogCount: 0, storeCount: 0 };
    }
    return {
      poemsCount: catalog.poems.length,
      proseCount: catalog.prose.length,
      blogCount: catalog.blog.length,
      storeCount: catalog.products.length,
    };
  }, [catalog]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className={`min-h-screen flex flex-col transition-colors duration-200 ${
          theme === 'dark'
            ? 'bg-[#0B0B0A] text-[#F2F1EC]'
            : 'bg-[#F5F4EF] text-[#0D0D0C]'
        }`}
      >
        <main className="flex-1 flex flex-col">
          {loading ? (
            <div className="max-w-7xl w-full mx-auto px-6 py-32 flex flex-col items-start justify-center">
              <span className="font-mono text-xs tracking-widest text-[#6B6B65] dark:text-[#94948C] mb-3 tabular-nums">
                ІНІЦІАЛІЗАЦІЯ · 00
              </span>
              <p className="font-serif text-3xl sm:text-4xl italic text-[#0D0D0C] dark:text-[#F2F1EC]">
                Завантаження архіву...
              </p>
            </div>
          ) : loadError || !catalog ? (
            <div className="max-w-7xl w-full mx-auto px-6 py-32">
              <span className="font-mono text-xs tracking-widest text-[#1E4631] dark:text-[#4E946C] block mb-3">
                ПОМИЛКА З’ЄДНАННЯ
              </span>
              <p className="font-serif text-3xl mb-6 text-[#0D0D0C] dark:text-[#F2F1EC]">
                {loadError}
              </p>
              <button
                type="button"
                onClick={fetchCatalog}
                className="px-6 py-3 text-xs font-semibold tracking-wide text-white bg-[#0D0D0C] dark:bg-[#F2F1EC] dark:text-[#0D0D0C] hover:bg-[#1E4631] dark:hover:bg-[#2D6A4F] dark:hover:text-white transition-colors cursor-pointer"
              >
                Спробувати ще раз
              </button>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {activeSection === 'home' ? (
                <motion.div
                  key="home-view"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex-1 flex flex-col"
                >
                  <HeroSection
                    onNavigate={handleNavigate}
                    onOpenAuthorStudio={handleOpenAuthorStudio}
                    onOpenAuthModal={() => {
                      trackClick('action:open_auth', 'Відкриття входу / реєстрації', 'action');
                      setAuthModalOpen(true);
                    }}
                    onLogoutGuest={handleLogoutGuest}
                    guestUser={guestUser}
                    isAdmin={isAdmin}
                    stats={stats}
                    uniqueVisitors={uniqueVisitors}
                    theme={theme}
                    onToggleTheme={toggleTheme}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key={`section-${activeSection}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="max-w-[1380px] w-full mx-auto px-4 sm:px-8 lg:px-12 py-8 md:py-14 flex flex-col lg:flex-row gap-10 xl:gap-16 items-start"
                >
                  <SectionNavBar
                    activeSection={activeSection}
                    onNavigate={handleNavigate}
                    cartCount={cartProducts.length}
                    unlockedCount={unlockedItems.length}
                    onOpenDrawer={(tab) => {
                      if (tab) setDrawerTab(tab);
                      setDrawerOpen(true);
                    }}
                    guestUser={guestUser}
                    isAdmin={isAdmin}
                    onLogoutGuest={handleLogoutGuest}
                    onOpenAuthorStudio={handleOpenAuthorStudio}
                    theme={theme}
                  />

                  <div className="flex-1 min-w-0 w-full">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeSection}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      >
                        {activeSection === 'poetry' && (
                          <PoetrySection
                            poems={catalog.poems}
                            guestUser={guestUser}
                            onPoemUpdated={handlePoemUpdated}
                            onPoemViewed={handlePoemViewed}
                            initialPoemId={deepLinkItemId}
                            onActivePoemChange={(id) => handleSectionItemHash('poetry', id)}
                          />
                        )}

                        {activeSection === 'prose' && <ProseSection proseList={catalog.prose} />}

                        {activeSection === 'blog' && (
                          <BlogSection
                            posts={catalog.blog}
                            onPostViewed={handleBlogViewed}
                            initialPostId={deepLinkItemId}
                            onActivePostChange={(id) => handleSectionItemHash('blog', id)}
                          />
                        )}

                        {activeSection === 'store' && (
                          <StoreSection
                            products={catalog.products}
                            cartIds={cartIds}
                            unlockedMap={unlockedMap}
                            guestUser={guestUser}
                            onAddToCart={handleAddToCart}
                            onOpenLibrary={() => {
                              setDrawerTab(cartProducts.length > 0 ? 'cart' : 'library');
                              setDrawerOpen(true);
                            }}
                            onProductUpdated={handleProductUpdated}
                            theme={theme}
                          />
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </main>

        {!loading && !loadError && catalog && activeSection !== 'home' && (
          <Footer uniqueVisitors={uniqueVisitors} theme={theme} />
        )}

        {activeSection === 'store' && (
          <CartLibraryDrawer
            isOpen={drawerOpen}
            activeTab={drawerTab}
            onTabChange={setDrawerTab}
            onClose={() => setDrawerOpen(false)}
            cartProducts={cartProducts}
            onRemoveFromCart={handleRemoveFromCart}
            onCheckoutSuccess={handleCheckoutSuccess}
            unlockedItems={unlockedItems}
            onRestoreOrders={handleRestoreOrders}
          />
        )}

        <AuthorStudioModal
          isOpen={authorStudioOpen && isAdmin}
          isAdmin={isAdmin}
          getAdminToken={getAdminToken}
          onClose={() => setAuthorStudioOpen(false)}
          onCatalogUpdated={fetchCatalog}
          heroLeadText={catalog?.heroLeadText || ''}
          onHeroLeadUpdated={handleHeroLeadUpdated}
        />

        <GuestAuthModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onAuthenticated={handleAuthenticatedGuest}
        />

        <OfflineIndicator />
      </div>
    </MotionConfig>
  );
}
