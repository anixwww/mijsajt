import { Check, Copy, Eye } from 'lucide-react';
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GuestUser, Poem } from '../types.ts';
import { setActiveMoment, trackClick } from '../utils/analytics.ts';
import { ReviewsBlock } from './ReviewsBlock.tsx';
import { ShareButton } from './ShareButton.tsx';
import { SwipeStarRating } from './SwipeStarRating.tsx';

interface PoetrySectionProps {
  poems: Poem[];
  guestUser: GuestUser | null;
  onPoemUpdated: (updatedPoem: Poem) => void;
  onPoemViewed: (poemId: string, viewsCount: number) => void;
  initialPoemId?: string | null;
  onActivePoemChange?: (poemId: string | null) => void;
}

const SWIPE_VARIANTS = {
  enter: (direction: number) => ({
    y: direction >= 0 ? 44 : -44,
    opacity: 0,
  }),
  center: {
    y: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    y: direction >= 0 ? -44 : 44,
    opacity: 0,
  }),
};

export function PoetrySection({
  poems,
  guestUser,
  onPoemUpdated,
  onPoemViewed,
  initialPoemId,
  onActivePoemChange,
}: PoetrySectionProps) {
  const [sortBy, setSortBy] = useState<'recent' | 'rating'>('recent');
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [swipeDirection, setSwipeDirection] = useState<number>(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const viewedSessionRef = useRef<Set<string>>(new Set());
  const handledDeepLinkRef = useRef<string | null>(null);

  const orderedPoems = useMemo(() => {
    const list = [...poems];
    if (sortBy === 'rating') {
      list.sort((a, b) => {
        if (b.ratingAverage !== a.ratingAverage) return b.ratingAverage - a.ratingAverage;
        return b.ratingCount - a.ratingCount;
      });
    }
    return list;
  }, [poems, sortBy]);

  const safeIndex = Math.min(activeIndex, Math.max(0, orderedPoems.length - 1));
  const currentPoem = orderedPoems[safeIndex] || null;

  useEffect(() => {
    if (!initialPoemId) {
      handledDeepLinkRef.current = null;
      return;
    }
    if (handledDeepLinkRef.current === initialPoemId) return;
    const idx = orderedPoems.findIndex((p) => p.id === initialPoemId);
    if (idx !== -1) {
      handledDeepLinkRef.current = initialPoemId;
      setActiveIndex(idx);
      return;
    }
    const inAllIdx = poems.findIndex((p) => p.id === initialPoemId);
    if (inAllIdx !== -1) {
      handledDeepLinkRef.current = initialPoemId;
      setSortBy('recent');
      setActiveIndex(inAllIdx);
    }
  }, [initialPoemId, orderedPoems, poems]);

  useEffect(() => {
    if (!currentPoem) return;
    setActiveMoment({
      targetKey: `poem:${currentPoem.id}`,
      momentKey: `poetry:${currentPoem.id}`,
      label: `Вірш: «${currentPoem.title}»`,
      category: 'poem',
      section: 'poetry',
    });
    if (!viewedSessionRef.current.has(currentPoem.id)) {
      viewedSessionRef.current.add(currentPoem.id);
      fetch(`/api/poems/${encodeURIComponent(currentPoem.id)}/view`, { method: 'POST' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.viewsCount === 'number') {
            onPoemViewed(currentPoem.id, data.viewsCount);
          }
        })
        .catch(() => {});
    }
  }, [currentPoem, onPoemViewed]);

  const goToIndex = useCallback(
    (nextIdx: number, dir: number) => {
      if (orderedPoems.length === 0) return;
      const wrapped = (nextIdx + orderedPoems.length) % orderedPoems.length;
      setSwipeDirection(dir);
      setActiveIndex(wrapped);
      const target = orderedPoems[wrapped];
      if (target) {
        handledDeepLinkRef.current = target.id;
        onActivePoemChange?.(target.id);
      }
    },
    [orderedPoems, onActivePoemChange]
  );

  const handlePrev = useCallback(() => {
    trackClick('action:poem_prev', 'Свайп / кнопка: Попередній вірш', 'action');
    goToIndex(safeIndex - 1, -1);
  }, [goToIndex, safeIndex]);

  const handleNext = useCallback(() => {
    trackClick('action:poem_next', 'Свайп / кнопка: Наступний вірш', 'action');
    goToIndex(safeIndex + 1, 1);
  }, [goToIndex, safeIndex]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft' || (e.key === 'ArrowUp' && window.scrollY < 240)) {
        if (e.key === 'ArrowUp') e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight' || (e.key === 'ArrowDown' && window.scrollY < 240)) {
        if (e.key === 'ArrowDown') e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePrev, handleNext]);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (orderedPoems.length <= 1) return;
    if (info.offset.y < -45 || info.velocity.y < -280) {
      handleNext();
    } else if (info.offset.y > 45 || info.velocity.y > 280) {
      handlePrev();
    }
  };

  const getPoemShareUrl = (poemId: string) =>
    `${window.location.origin}${window.location.pathname}#poetry/${encodeURIComponent(poemId)}`;

  const handleCopyPoem = async (poem: Poem) => {
    trackClick(`copy_poem:${poem.id}`, `Копіювання вірша: «${poem.title}»`, 'action');
    const fullText = `${poem.title}\n\n${poem.content}\n\n— Андрій Даньків`;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopiedId(poem.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const renderAverageRatingSummary = (poem: Poem) => (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <SwipeStarRating
        value={poem.ratingAverage}
        readOnly
        size="sm"
        showValue={false}
        ariaLabel={`Середня оцінка вірша ${poem.title}: ${poem.ratingAverage.toFixed(1)} з 5.0`}
      />

      <div className="text-xs text-[#6B6B65] dark:text-[#94948C] font-mono tabular-nums">
        {poem.ratingCount > 0 ? (
          <span>
            Середня оцінка:{' '}
            <strong className="text-[#0D0D0C] dark:text-[#F2F1EC]">
              {poem.ratingAverage.toFixed(1)}
            </strong>{' '}
            / 5.0 · {poem.ratingCount}
          </span>
        ) : (
          <span>Ще без оцінок</span>
        )}
      </div>
    </div>
  );

  return (
    <section id="poetry" className="pb-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Minimalist Silence Header */}
        <header className="flex flex-wrap items-end justify-between gap-6 pb-8 mb-10 border-b border-[#0D0D0C]/14 dark:border-[#F2F1EC]/14">
          <h2 className="font-serif text-5xl sm:text-6xl font-normal italic tracking-tight text-[#0D0D0C] dark:text-[#F2F1EC]">
            Поезія
          </h2>

          <div className="flex flex-wrap items-center gap-4">
            {/* Sort Filter Control */}
            <div
              className="inline-flex border border-[#0D0D0C]/16 dark:border-[#252522] p-0.5"
              role="group"
              aria-label="Сортування віршів"
            >
              <button
                type="button"
                onClick={() => {
                  setSortBy('recent');
                  setActiveIndex(0);
                }}
                className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  sortBy === 'recent'
                    ? 'bg-[#0D0D0C] text-[#F5F4EF] dark:bg-[#F2F1EC] dark:text-[#0D0D0C]'
                    : 'text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC]'
                }`}
              >
                Останні
              </button>
              <button
                type="button"
                onClick={() => {
                  setSortBy('rating');
                  setActiveIndex(0);
                }}
                className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  sortBy === 'rating'
                    ? 'bg-[#0D0D0C] text-[#F5F4EF] dark:bg-[#F2F1EC] dark:text-[#0D0D0C]'
                    : 'text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC]'
                }`}
              >
                За рейтингом
              </button>
            </div>
          </div>
        </header>

        {/* Asymmetrical Negative-Space Reading Stage */}
        {currentPoem && (
          <div className="space-y-16">
            <div className="overflow-hidden">
              <AnimatePresence mode="wait" custom={swipeDirection}>
                <motion.article
                  key={currentPoem.id}
                  custom={swipeDirection}
                  variants={SWIPE_VARIANTS}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  drag={orderedPoems.length > 1 ? 'y' : false}
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={0.2}
                  dragDirectionLock
                  onDragEnd={handleDragEnd}
                  className="cursor-grab active:cursor-grabbing select-text will-change-transform"
                >
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-10 py-4 sm:py-10">
                    {/* Left Delicate Vertical Margin Rail */}
                    <div className="md:col-span-2 flex md:flex-col items-center md:items-start justify-between gap-4 border-b md:border-b-0 md:border-r border-[#0D0D0C]/12 dark:border-[#F2F1EC]/12 pb-4 md:pb-0 md:pr-6">
                      <span className="font-mono text-xs tabular-nums text-[#0D0D0C] dark:text-[#F2F1EC]">
                        № {String(safeIndex + 1).padStart(2, '0')}
                      </span>

                      <span
                        className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#6B6B65] dark:text-[#94948C] tabular-nums"
                        title="Кількість переглядів"
                      >
                        <Eye className="w-3.5 h-3.5" strokeWidth={1.5} />
                        <span>{currentPoem.viewsCount}</span>
                      </span>
                    </div>

                    {/* Right Generous Negative-Space Stanza Column */}
                    <div className="md:col-span-10 md:pl-6 lg:pl-12">
                      <div className="max-w-[54ch]">
                        <h3 className="font-serif text-4xl sm:text-5xl font-semibold text-[#0D0D0C] dark:text-[#F2F1EC] leading-[1.08] tracking-tight mb-10">
                          {currentPoem.title}
                        </h3>

                        <div className="font-serif text-[22px] sm:text-[25px] text-[#0D0D0C] dark:text-[#E8E7E1] leading-[1.85] whitespace-pre-line">
                          {currentPoem.content}
                        </div>

                        {currentPoem.note && (
                          <p className="text-xs font-mono text-[#6B6B65] dark:text-[#94948C] mt-10 pt-4 border-t border-[#0D0D0C]/10 dark:border-[#F2F1EC]/10 max-w-prose">
                            Примітка автора — {currentPoem.note}
                          </p>
                        )}
                      </div>

                      {/* Subtle Action Bar */}
                      <div className="mt-14 pt-6 border-t border-[#0D0D0C]/14 dark:border-[#F2F1EC]/14 space-y-6">
                        {renderAverageRatingSummary(currentPoem)}

                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => handleCopyPoem(currentPoem)}
                            title="Скопіювати вірш"
                            aria-label="Скопіювати вірш"
                            className="p-2.5 text-[#0D0D0C] dark:text-[#F2F1EC] border border-[#0D0D0C]/20 dark:border-[#252522] hover:border-[#1E4631] hover:text-[#1E4631] dark:hover:border-[#4E946C] dark:hover:text-[#4E946C] transition-colors cursor-pointer"
                          >
                            {copiedId === currentPoem.id ? (
                              <Check className="w-4 h-4 text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.75} />
                            ) : (
                              <Copy className="w-4 h-4" strokeWidth={1.6} />
                            )}
                          </button>

                          <ShareButton
                            title={`${currentPoem.title} — Андрій Даньків`}
                            text={`«${currentPoem.title}» — вірш Андрія Даньківа`}
                            url={getPoemShareUrl(currentPoem.id)}
                            variant="icon"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.article>
              </AnimatePresence>
            </div>

            {/* Quiet Unboxed Reviews Region */}
            <div className="pt-4">
              <ReviewsBlock
                targetType="poem"
                targetId={currentPoem.id}
                ratingAverage={currentPoem.ratingAverage}
                ratingCount={currentPoem.ratingCount}
                userRating={currentPoem.userRating}
                reviews={currentPoem.reviews}
                guestUser={guestUser}
                onReviewSubmitted={({ poem }) => {
                  if (poem) onPoemUpdated(poem);
                }}
              />
            </div>
          </div>
        )}
      </motion.div>
    </section>
  );
}
