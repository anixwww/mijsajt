import { X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { memo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { WeeklyMusicSelection, WeeklyPeriodInfo } from '../types.ts';
import { CosmicHeadphonesIcon } from './CosmicHeadphonesIcon.tsx';
import { WeeklyMusicBox } from './WeeklyMusicBox.tsx';

interface MusicSelectionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selections: WeeklyMusicSelection[];
  currentPeriod?: WeeklyPeriodInfo;
  isAdmin: boolean;
  getAdminToken: () => Promise<string | null>;
  onSelectionsUpdated: (nextSelections: WeeklyMusicSelection[]) => void;
  onBeforePlay?: () => void;
}

export const MusicSelectionsModal = memo(function MusicSelectionsModal({
  isOpen,
  onClose,
  selections,
  currentPeriod,
  isAdmin,
  getAdminToken,
  onSelectionsUpdated,
  onBeforePlay,
}: MusicSelectionsModalProps) {
  const modalScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="music-selections-modal-title"
        >
          <m.div
            ref={modalScrollRef}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[88vh] overflow-y-auto bg-paper dark:bg-night-panel rounded-3xl p-5 sm:p-7 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)] text-ink dark:text-cream flex flex-col gap-4"
          >
            {/* Modal Top Header Bar */}
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-black/5 dark:border-white/8 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden="true"
                  className="relative overflow-hidden w-8 h-8 rounded-xl bg-[linear-gradient(135deg,#180812_0%,#2A0E22_50%,#351326_100%)] text-[#FBCFE8] inline-flex items-center justify-center shrink-0 shadow-[0_4px_12px_-4px_rgba(24,8,18,0.75),0_0_10px_-3px_rgba(244,63,94,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]"
                >
                  <CosmicHeadphonesIcon className="relative z-10 w-[17px] h-[17px]" />
                </span>
                <div className="min-w-0">
                  <h3
                    id="music-selections-modal-title"
                    className="text-base sm:text-lg font-semibold tracking-[-0.01em] text-ink dark:text-cream truncate"
                  >
                    Щомісячні підбірки
                  </h3>
                  <p className="text-[11px] text-ink-subtle dark:text-sandstone truncate">
                    Музика, світлини та думки
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити вікно підбірок"
                title="Закрити"
                className="btn-editorial-icon w-9 h-9 shrink-0"
              >
                <X className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>

            {/* Modal Body: Weekly/Monthly Music Box */}
            <div className="min-w-0 flex-1">
              {selections.length === 0 && !isAdmin ? (
                <div className="py-12 px-4 text-center space-y-2">
                  <p className="text-sm text-ink-subtle dark:text-sandstone">
                    Підбірка незабаром з’явиться тут.
                  </p>
                </div>
              ) : (
                <WeeklyMusicBox
                  selections={selections}
                  currentPeriod={currentPeriod}
                  isAdmin={isAdmin}
                  getAdminToken={getAdminToken}
                  onSelectionsUpdated={onSelectionsUpdated}
                  onBeforePlay={onBeforePlay}
                />
              )}
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body
  );
});
