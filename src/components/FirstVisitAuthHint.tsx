import { LogIn, MessagesSquare, Radio, Trophy, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import type { GuestUser, RememberedGuestHint } from '../types.ts';

const FIRST_VISIT_AUTH_HINT_KEY = 'dankiv_first_visit_auth_hint_v1';
const AUTO_HIDE_MS = 12000;

interface FirstVisitAuthHintProps {
  guestUser: GuestUser | null;
  rememberedGuest: RememberedGuestHint | null;
  suppress?: boolean;
  onOpenAuthModal: () => void;
}

function hasSeenFirstVisitHint(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(FIRST_VISIT_AUTH_HINT_KEY) === 'seen';
  } catch {
    return false;
  }
}

function markFirstVisitHintSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FIRST_VISIT_AUTH_HINT_KEY, 'seen');
  } catch {
    // Ignore storage errors in private mode
  }
}

export function FirstVisitAuthHint({
  guestUser,
  rememberedGuest,
  suppress = false,
  onOpenAuthModal,
}: FirstVisitAuthHintProps) {
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => {
    markFirstVisitHintSeen();
    setVisible(false);
  }, []);

  useEffect(() => {
    if (guestUser || rememberedGuest) {
      markFirstVisitHintSeen();
      setVisible(false);
      return;
    }

    if (hasSeenFirstVisitHint() || suppress) {
      return;
    }

    const showTimer = window.setTimeout(() => {
      if (hasSeenFirstVisitHint()) return;
      markFirstVisitHintSeen();
      setVisible(true);
    }, 1100);

    return () => window.clearTimeout(showTimer);
  }, [guestUser, rememberedGuest, suppress]);

  useEffect(() => {
    if (!visible) return;
    if (suppress || guestUser) {
      setVisible(false);
      return;
    }
    const hideTimer = window.setTimeout(() => {
      setVisible(false);
    }, AUTO_HIDE_MS);

    return () => window.clearTimeout(hideTimer);
  }, [visible, suppress, guestUser]);

  return (
    <AnimatePresence>
      {visible && (
        <m.aside
          key="first-visit-auth-hint"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          role="status"
          aria-live="polite"
          aria-label="Підказка про авторизацію"
          className="fixed bottom-[76px] sm:bottom-[82px] left-3 right-3 sm:left-6 sm:right-auto sm:w-[372px] z-40 rounded-2xl bg-[#202020] border border-white/10 shadow-[0_18px_42px_-12px_rgba(0,0,0,0.8)] overflow-hidden"
        >
          <div className="p-3.5 sm:p-4 space-y-3">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-xl bg-[#323232] text-[#E5E5E5] flex items-center justify-center shrink-0 mt-0.5">
                  <LogIn className="w-4 h-4" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-xs sm:text-[13px] font-semibold text-[#FAF9F5] leading-snug">
                    Вперше на сайті?
                  </p>
                  <p className="text-[11px] sm:text-xs text-[#C5C1B8] leading-relaxed">
                    Авторизація відкриє доступ до{' '}
                    <span className="text-[#FAF9F5] font-medium">радіо</span>,{' '}
                    <span className="text-[#FAF9F5] font-medium">глобального чату</span>{' '}
                    та участі в{' '}
                    <span className="text-[#FAF9F5] font-medium">рейтингу</span>.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={dismiss}
                aria-label="Закрити підказку"
                className="w-7 h-7 rounded-lg hover:bg-white/10 text-[#C4BFB4] hover:text-[#FAF9F5] flex items-center justify-center transition-colors shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-2 text-[11px] text-[#C4BFB4] min-w-0">
                <span className="inline-flex items-center gap-1">
                  <Radio className="w-3 h-3 text-[#C4B5FD]" />
                  <span>Радіо</span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <MessagesSquare className="w-3 h-3 text-[#E5E5E5]" />
                  <span>Чат</span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Trophy className="w-3 h-3 text-amber-400" />
                  <span>Рейтинг</span>
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  dismiss();
                  onOpenAuthModal();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E5E5E5] text-[#181818] text-xs font-semibold hover:opacity-95 active:scale-[0.97] transition-all shrink-0 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" strokeWidth={2} />
                <span>Увійти</span>
              </button>
            </div>
          </div>

          {/* Temporary auto-hide progress indicator */}
          <div
            aria-hidden="true"
            className="h-[2px] w-full bg-white/5 overflow-hidden"
          >
            <m.div
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: AUTO_HIDE_MS / 1000, ease: 'linear' }}
              style={{ transformOrigin: 'left' }}
              className="h-full w-full bg-[#E5E5E5]/45"
            />
          </div>
        </m.aside>
      )}
    </AnimatePresence>
  );
}
