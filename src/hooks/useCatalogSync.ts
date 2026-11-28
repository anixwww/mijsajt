import { useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/useAuthStore.ts';
import { useCatalogStore, writeCachedHomeShell } from '../store/useCatalogStore.ts';
import { useUiStore } from '../store/useUiStore.ts';
import type { CatalogResponse, HomePayload, SectionId } from '../types.ts';
import {
  collectCatalogMediaUrls,
  readOfflineCatalog,
  saveOfflineCatalog,
  warmOfflineMediaCache,
} from '../utils/offlineCache.ts';
import {
  loadBlogSection,
  loadPoetrySection,
  loadProseSection,
  loadStoreSection,
} from '../components/ConnectedSections.tsx';

interface UseCatalogSyncOptions {
  initialSection: SectionId;
  getGuestToken: (forceRefresh?: boolean) => Promise<string | null>;
}

export function useCatalogSync({ initialSection, getGuestToken }: UseCatalogSyncOptions) {
  const homeShell = useCatalogStore((s) => s.homeShell);
  const catalog = useCatalogStore((s) => s.catalog);
  const setHomeShell = useCatalogStore((s) => s.setHomeShell);
  const setCatalog = useCatalogStore((s) => s.setCatalog);
  const setLoading = useCatalogStore((s) => s.setLoading);
  const setLoadError = useCatalogStore((s) => s.setLoadError);
  const setUniqueVisitors = useCatalogStore((s) => s.setUniqueVisitors);
  const setNewWorkNotification = useUiStore((s) => s.setNewWorkNotification);
  const guestUid = useAuthStore((s) => s.guestUser?.uid ?? null);

  const newWorkToastTimeoutRef = useRef<number | null>(null);
  const catalogPromiseRef = useRef<Promise<void> | null>(null);
  const catalogMutationVersionRef = useRef(0);
  const homeShellRef = useRef<HomePayload | null>(homeShell);
  homeShellRef.current = homeShell;

  const markCatalogMutated = useCallback(() => {
    catalogMutationVersionRef.current += 1;
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
    if (prevGuestUidRef.current === guestUid) return;
    prevGuestUidRef.current = guestUid;
    catalogPromiseRef.current = null;
    void fetchCatalog();
  }, [guestUid, fetchCatalog]);

  useEffect(() => {
    if (initialSection === 'home') {
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
    initialSection,
    setHomeShell,
    setLoadError,
    setLoading,
    setUniqueVisitors,
  ]);

  return {
    fetchCatalog,
    markCatalogMutated,
  };
}
