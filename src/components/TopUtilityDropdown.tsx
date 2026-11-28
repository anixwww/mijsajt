import {
  Bell,
  BellRing,
  Download,
  ExternalLink,
  Menu,
  MessageSquare,
  Trophy,
  X,
} from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { getMessagingInstance } from '../firebase.ts';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import type { FeedbackRecord, GuestUser } from '../types.ts';
import { trackClick } from '../utils/analytics.ts';
import { PWAInstallGuideModal } from './PWAInstallButton.tsx';
const SiteFeedbackModal = lazy(() =>
  import('./SiteFeedbackModal.tsx').then((m) => ({ default: m.SiteFeedbackModal }))
);

interface TopUtilityDropdownProps {
  isRadioEnabled: boolean;
  onToggleRadio: () => void;
  isRadioPlaying?: boolean;
  guestUser?: GuestUser | null;
  getGuestToken?: (forceRefresh?: boolean) => Promise<string | null>;
  siteFeedbackItems?: FeedbackRecord[];
  onSiteFeedbackItemsChange?: (items: FeedbackRecord[]) => void;
  unreadFeedbackRepliesCount?: number;
  onFeedbackRepliesMarkedRead?: () => void;
  onOpenLeaderboard?: () => void;
}

function FestiveLightsIcon({
  active,
  className = 'w-4 h-4',
}: {
  active: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 3.5v2.2" />
      <path d="M12 18.3v2.2" />
      <path d="M3.5 12h2.2" />
      <path d="M18.3 12h2.2" />
      <path
        d="M12 6.8c.55 2.7 2.5 4.65 5.2 5.2-2.7.55-4.65 2.5-5.2 5.2-.55-2.7-2.5-4.65-5.2-5.2 2.7-.55 4.65-2.5 5.2-5.2Z"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.25 : 0}
      />
    </svg>
  );
}

function RadioBroadcastIcon({
  className = 'w-4 h-4',
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="2.25" fill="currentColor" stroke="none" />
      <path d="M8.35 15.65a5.2 5.2 0 0 1 0-7.3" />
      <path d="M15.65 8.35a5.2 5.2 0 0 1 0 7.3" />
      <path d="M5.25 18.75a9.55 9.55 0 0 1 0-13.5" />
      <path d="M18.75 5.25a9.55 9.55 0 0 1 0 13.5" />
    </svg>
  );
}



function ToggleSwitchControl({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/50 dark:focus-visible:ring-white/40 cursor-pointer ${
        checked
          ? 'bg-pear-pine-gradient'
          : 'bg-paper-stone dark:bg-night-muted'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 will-change-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

export function TopUtilityDropdown({
  isRadioEnabled: _isRadioEnabled,
  onToggleRadio: _onToggleRadio,
  isRadioPlaying: _isRadioPlaying = false,
  guestUser,
  getGuestToken,
  siteFeedbackItems,
  onSiteFeedbackItemsChange,
  unreadFeedbackRepliesCount = 0,
  onFeedbackRepliesMarkedRead,
  onOpenLeaderboard,
}: TopUtilityDropdownProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const menuWrapperRef = useRef<HTMLDivElement | null>(null);
  const {
    isInstallable,
    isInstalled,
    isIOS,
    isAndroid,
    isMacSafari,
    isInIframe: isPWAInIframe,
    install: installPWA,
  } = usePWAInstall();

  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  const [notifStatus, setNotifStatus] = useState<'default' | 'granted' | 'denied'>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission as 'default' | 'granted' | 'denied';
    }
    return 'default';
  });

  const [festiveLightsEnabled, setFestiveLightsEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem('dankiv_festive_lights_enabled') !== 'false';
    } catch {
      return true;
    }
  });

  const [notifEnabled, setNotifEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const stored = localStorage.getItem('dankiv_notifications_enabled');
      if (
        !isInIframe &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        return stored !== 'false';
      }
      return stored === 'true';
    } catch {
      return (
        !isInIframe &&
        'Notification' in window &&
        Notification.permission === 'granted'
      );
    }
  });

  const [notifNotice, setNotifNotice] = useState<{
    text: string;
    needsStandaloneTab?: boolean;
  } | null>(null);
  const notifTimeoutRef = useRef<number | null>(null);

  const standaloneNotifyUrl = (() => {
    if (typeof window === 'undefined') return '/?notify=1';
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('notify', '1');
      return url.toString();
    } catch {
      return '/?notify=1';
    }
  })();

  const showNotifBanner = (
    notice: { text: string; needsStandaloneTab?: boolean },
    durationMs = 6500
  ) => {
    if (notifTimeoutRef.current) {
      window.clearTimeout(notifTimeoutRef.current);
    }
    setNotifNotice(notice);
    notifTimeoutRef.current = window.setTimeout(() => {
      setNotifNotice(null);
    }, durationMs);
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const perm = Notification.permission as 'default' | 'granted' | 'denied';
    setNotifStatus(perm);
    if (!isInIframe && perm === 'granted') {
      try {
        setNotifEnabled(localStorage.getItem('dankiv_notifications_enabled') !== 'false');
      } catch {
        setNotifEnabled(true);
      }
    }

    let permStatus: PermissionStatus | null = null;
    if ('permissions' in navigator && typeof navigator.permissions.query === 'function') {
      navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then((status) => {
          permStatus = status;
          const syncState = () => {
            const nextPerm = Notification.permission as 'default' | 'granted' | 'denied';
            setNotifStatus(nextPerm);
          };
          status.onchange = syncState;
        })
        .catch(() => {
          // Ignore Permissions API fallback
        });
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('notify') === '1' && !isInIframe && Notification.permission === 'default') {
      setMenuOpen(true);
      setNotifNotice({
        text: 'Натисніть перемикач «Сповіщення», щоб підтвердити системні сповіщення у браузері.',
      });
    }

    return () => {
      if (permStatus) {
        permStatus.onchange = null;
      }
      if (notifTimeoutRef.current) {
        window.clearTimeout(notifTimeoutRef.current);
      }
    };
  }, [isInIframe]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (menuWrapperRef.current && target && !menuWrapperRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const emitNotificationsPreference = (enabled: boolean) => {
    try {
      localStorage.setItem('dankiv_notifications_enabled', enabled ? 'true' : 'false');
    } catch {
      // Ignore storage error
    }
    window.dispatchEvent(
      new CustomEvent('dankiv:notifications-changed', { detail: { enabled } })
    );
  };

  const handleToggleFestiveLights = () => {
    const next = !festiveLightsEnabled;
    setFestiveLightsEnabled(next);
    try {
      localStorage.setItem('dankiv_festive_lights_enabled', next ? 'true' : 'false');
    } catch {
      // Ignore storage error
    }
    window.dispatchEvent(
      new CustomEvent('dankiv:festive-lights-changed', { detail: { enabled: next } })
    );
    trackClick(
      'settings:festive_lights',
      `Святкова ілюмінація: ${next ? 'Увімкнено' : 'Вимкнено'}`,
      'action'
    );
  };

  const handleToggleNotifications = async () => {
    if (notifEnabled) {
      setNotifEnabled(false);
      emitNotificationsPreference(false);
      showNotifBanner({ text: 'Сповіщення про новинки вимкнено.' }, 3500);
      return;
    }

    // Always enable on-site alerts immediately so the switch works in all environments
    setNotifEnabled(true);
    emitNotificationsPreference(true);

    if (typeof window === 'undefined' || !('Notification' in window)) {
      showNotifBanner({
        text: 'Сповіщення на сайті увімкнено! Повідомлятимемо про нові публікації.',
      });
      return;
    }

    if (isInIframe) {
      showNotifBanner(
        {
          text: 'Сповіщення на сайті увімкнено. Щоб отримувати також системні сповіщення поза вкладкою, відкрийте сайт окремо:',
          needsStandaloneTab: true,
        },
        9000
      );
      return;
    }

    try {
      const permission: NotificationPermission =
        Notification.permission === 'granted'
          ? 'granted'
          : Notification.permission === 'denied'
            ? 'denied'
            : await new Promise((resolve, reject) => {
                try {
                  const maybePromise = Notification.requestPermission((legacyResult) => {
                    resolve(legacyResult);
                  });
                  if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then(resolve, reject);
                  }
                } catch (err) {
                  reject(err);
                }
              });

      setNotifStatus(permission as 'default' | 'granted' | 'denied');

      if (permission === 'granted') {
        let swReg: ServiceWorkerRegistration | undefined;
        if ('serviceWorker' in navigator) {
          try {
            swReg = await navigator.serviceWorker.getRegistration('/');
            if (!swReg) {
              swReg = await navigator.serviceWorker.register('/sw-notifications.js');
            }
            const readyWithTimeout = Promise.race([
              navigator.serviceWorker.ready,
              new Promise<undefined>((resolve) =>
                window.setTimeout(() => resolve(undefined), 1500)
              ),
            ]);
            const resolvedReady = await readyWithTimeout;
            if (resolvedReady) {
              swReg = resolvedReady;
            }
          } catch (e) {
            console.warn('ServiceWorker registration warning:', e);
          }
        }

        const vapidKey = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim();
        if (vapidKey) {
          try {
            const messaging = await getMessagingInstance();
            if (messaging) {
              const { getToken } = await import('firebase/messaging');
              await getToken(messaging, {
                vapidKey,
                serviceWorkerRegistration: swReg,
              });
            }
          } catch (e) {
            console.warn('FCM getToken notice:', e);
          }
        }

        showNotifBanner({
          text: 'Сповіщення увімкнено! Ви отримуватимете новини про публікації.',
        });

        const title = 'Андрій Даньків';
        const options: NotificationOptions = {
          body: 'Дякуємо! Ви отримуватимете сповіщення про вихід нових віршів, оповідань та публікацій.',
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
        };

        if (swReg && typeof swReg.showNotification === 'function') {
          try {
            await swReg.showNotification(title, options);
            return;
          } catch {
            // Fall back to direct Notification constructor
          }
        }

        try {
          new Notification(title, options);
        } catch {
          // Ignore if direct Notification constructor is restricted
        }
      } else if (permission === 'denied') {
        showNotifBanner(
          {
            text: 'Сповіщення на сайті увімкнено. Щоб дозволити й системні push у браузері, натисніть значок налаштувань зліва від адреси сайту.',
          },
          7000
        );
      } else {
        showNotifBanner({
          text: 'Сповіщення на сайті увімкнено. Підтвердьте запит браузера для системних сповіщень.',
        });
      }
    } catch {
      showNotifBanner({
        text: 'Сповіщення на сайті увімкнено! Ви отримуватимете повідомлення про нові публікації.',
      });
    }
  };

  const isNotifActive = notifEnabled;
  const hasSystemPush = !isInIframe && notifStatus === 'granted' && notifEnabled;

  const handleInstallFromMenu = async () => {
    setMenuOpen(false);
    trackClick('pwa:install_menu', 'Встановити додаток (меню)', 'action');
    if (isInstallable) {
      const accepted = await installPWA();
      if (!accepted) {
        setInstallGuideOpen(true);
      }
      return;
    }
    setInstallGuideOpen(true);
  };

  return (
    <div className="relative flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {onOpenLeaderboard && (
          <button
            type="button"
            onClick={onOpenLeaderboard}
            aria-label="Рейтинг активності та донатерів"
            title="Рейтинг активності та донатерів"
            className="touch-surface inline-flex items-center justify-center w-[38px] sm:w-[40px] h-[38px] sm:h-[40px] rounded-xl bg-paper-sand dark:bg-night-card text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream hover:bg-paper-stone dark:hover:bg-night-elevated transition-all cursor-pointer shadow-xs shrink-0"
          >
            <Trophy className="w-[18px] h-[18px]" strokeWidth={1.9} />
          </button>
        )}
        {/* Burger Menu with Notifications, Feedback & Install Controls */}
        <div
          ref={menuWrapperRef}
          className="relative inline-flex shrink-0 items-center p-1 bg-paper-sand dark:bg-night-card rounded-xl"
        >
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Закрити меню налаштувань' : 'Відкрити меню налаштувань'}
            title={
              unreadFeedbackRepliesCount > 0
                ? 'Налаштування · Є відповідь автора на ваш відгук'
                : 'Налаштування, сповіщення та відгук'
            }
            className={`relative touch-surface inline-flex items-center justify-center w-[38px] sm:w-[40px] h-[38px] sm:h-[40px] rounded-lg transition-all duration-150 shrink-0 cursor-pointer ${
              menuOpen
                ? 'bg-white dark:bg-night-elevated text-ink dark:text-cream shadow-xs'
                : 'text-ink dark:text-cream hover:bg-white/75 dark:hover:bg-night-elevated'
            }`}
          >
            {menuOpen ? (
              <X className="w-[18px] h-[18px]" strokeWidth={2} />
            ) : (
              <Menu className="w-[18px] h-[18px]" strokeWidth={2} />
            )}
            {unreadFeedbackRepliesCount > 0 && !menuOpen && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-paper-sand dark:ring-night-card"
              />
            )}
          </button>

          <AnimatePresence>
            {menuOpen && (
              <m.div
                role="menu"
                aria-label="Налаштування, сповіщення та відгук"
                initial={{ opacity: 0, y: 6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                className="absolute right-0 top-full mt-2 w-72 z-50 rounded-2xl bg-paper dark:bg-night-panel shadow-[0_18px_40px_-14px_rgba(20,20,19,0.28)] dark:shadow-[0_22px_48px_-14px_rgba(0,0,0,0.8)] p-3 space-y-2 text-left"
              >
                {/* Notifications Toggle Switch Row */}
                <div
                  role="menuitem"
                  onClick={() => void handleToggleNotifications()}
                  className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl hover:bg-paper-warm dark:hover:bg-night-surface transition-colors cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-paper-sand dark:bg-night-elevated text-pine dark:text-silver inline-flex items-center justify-center shrink-0">
                      {isNotifActive ? (
                        <BellRing className="w-4 h-4" strokeWidth={1.9} />
                      ) : (
                        <Bell className="w-4 h-4" strokeWidth={1.9} />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink dark:text-cream truncate">
                        Сповіщення
                      </p>
                      <p className="text-[11px] text-ink-muted dark:text-parchment truncate">
                        {isInstalled && hasSystemPush
                          ? 'Увімкнено у додатку'
                          : hasSystemPush
                            ? 'Системні й на сайті увімк.'
                            : isNotifActive
                              ? 'Увімкнено на сайті'
                              : 'Нові вірші, проза та дописи'}
                      </p>
                    </div>
                  </div>
                  <ToggleSwitchControl
                    checked={isNotifActive}
                    label="Увімкнути або вимкнути сповіщення"
                    onToggle={() => void handleToggleNotifications()}
                  />
                </div>

                {notifNotice && (
                  <div className="mx-1 px-2.5 py-2 rounded-xl bg-paper-warm dark:bg-night-lift text-[11px] leading-relaxed text-[#3B3B37] dark:text-paper-stone space-y-1.5">
                    <p>{notifNotice.text}</p>
                    {notifNotice.needsStandaloneTab && (
                      <a
                        href={standaloneNotifyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-pine-dark text-white dark:bg-cream dark:text-night font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                      >
                        <span>Відкрити вкладку</span>
                        <ExternalLink className="w-3 h-3" strokeWidth={2} />
                      </a>
                    )}
                  </div>
                )}

                <div className="h-px bg-paper-stone/75 dark:bg-night-soft mx-1" />

                {/* Festive Bottom Navigation Illumination Toggle Row */}
                <div
                  role="menuitem"
                  onClick={handleToggleFestiveLights}
                  className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl hover:bg-paper-warm dark:hover:bg-night-surface transition-colors cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-8 h-8 rounded-lg inline-flex items-center justify-center shrink-0 transition-colors ${
                        festiveLightsEnabled
                          ? 'bg-paper-sand dark:bg-night-elevated text-[#D97706] dark:text-[#FDE68A]'
                          : 'bg-paper-sand dark:bg-night-elevated text-pine dark:text-silver'
                      }`}
                    >
                      <FestiveLightsIcon active={festiveLightsEnabled} className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink dark:text-cream truncate">
                        Святкова ілюмінація
                      </p>
                      <p className="text-[11px] text-ink-muted dark:text-parchment truncate">
                        {festiveLightsEnabled ? 'Увімкнено' : 'Вимкнено'}
                      </p>
                    </div>
                  </div>
                  <ToggleSwitchControl
                    checked={festiveLightsEnabled}
                    label="Увімкнути або вимкнути святкову ілюмінацію"
                    onToggle={handleToggleFestiveLights}
                  />
                </div>

                <div className="h-px bg-paper-stone/75 dark:bg-night-soft mx-1" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setFeedbackOpen(true);
                  }}
                  className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl hover:bg-paper-warm dark:hover:bg-night-surface transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-paper-sand dark:bg-night-elevated text-pine dark:text-silver inline-flex items-center justify-center shrink-0">
                      <MessageSquare className="w-4 h-4" strokeWidth={1.9} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink dark:text-cream truncate">
                        Відгук про сайт
                      </p>
                      <p className="text-[11px] text-ink-muted dark:text-parchment truncate">
                        {unreadFeedbackRepliesCount > 0
                          ? 'Є нова відповідь автора'
                          : 'Що змінити чи додати'}
                      </p>
                    </div>
                  </div>
                  {unreadFeedbackRepliesCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-semibold tabular-nums shrink-0">
                      {unreadFeedbackRepliesCount}
                    </span>
                  )}
                </button>

                <div className="h-px bg-paper-stone/75 dark:bg-night-soft mx-1" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleInstallFromMenu()}
                  className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl hover:bg-paper-warm dark:hover:bg-night-surface transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-paper-sand dark:bg-night-elevated text-pine dark:text-silver inline-flex items-center justify-center shrink-0">
                      <Download className="w-4 h-4" strokeWidth={1.9} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink dark:text-cream truncate">
                        Встановити додаток
                      </p>
                      <p className="text-[11px] text-ink-muted dark:text-parchment truncate">
                        {isInstalled
                          ? 'Встановлено на пристрій'
                          : isInstallable
                            ? 'На робочий стіл або екран'
                            : isIOS
                              ? 'На екран «Додому» (Apple)'
                              : isMacSafari
                                ? 'Додати до Dock (Safari)'
                                : 'ПК, Android, iPhone / iPad'}
                      </p>
                    </div>
                  </div>
                </button>
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <PWAInstallGuideModal
        open={installGuideOpen}
        onClose={() => setInstallGuideOpen(false)}
        isIOS={isIOS}
        isAndroid={isAndroid}
        isMacSafari={isMacSafari}
        isInIframe={isPWAInIframe}
      />

      {feedbackOpen && (
        <Suspense fallback={null}>
          <SiteFeedbackModal
            isOpen={feedbackOpen}
            onClose={() => setFeedbackOpen(false)}
            guestUser={guestUser}
            getGuestToken={getGuestToken}
            items={siteFeedbackItems}
            onItemsChange={onSiteFeedbackItemsChange}
            onRepliesMarkedRead={onFeedbackRepliesMarkedRead}
          />
        </Suspense>
      )}

      {!menuOpen && notifNotice && (
        <div className="absolute right-0 top-full mt-2 z-40 w-[min(90vw,24rem)] px-3.5 py-2.5 rounded-xl bg-emerald-100/95 dark:bg-night-card text-[11px] text-emerald-900 dark:text-cream shadow-md flex flex-wrap items-center justify-end gap-2 text-right">
          <span>{notifNotice.text}</span>
          {notifNotice.needsStandaloneTab && (
            <a
              href={standaloneNotifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-pine-dark text-white dark:bg-cream dark:text-night font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <span>Відкрити вкладку</span>
              <ExternalLink className="w-3 h-3" strokeWidth={2} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
