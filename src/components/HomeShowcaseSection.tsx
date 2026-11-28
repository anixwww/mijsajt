import {
  ArrowUpRight,
  BookMarked,
  Music2,
  Star,
  User,
} from 'lucide-react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { useViewportActivity } from '../hooks/useViewportActivity.ts';
import {
  getEffectivePriceUah,
  isPhysicalProduct,
  normalizeHomeRepeatersConfig,
  parseStoreProductPromo,
  type BlogPost,
  type HomeFeedbackItem,
  type HomeRepeatersConfig,
  type Poem,
  type PoemImagePalette,
  type ProductType,
  type ProseTag,
  type ProseWork,
  type PurchasedAccess,
  type SectionId,
  type StoreProduct,
} from '../types.ts';
import { trackClick } from '../utils/analytics.ts';
import { extractBlogFilmMeta, stripBlogMediaTokens } from '../utils/blogMedia.ts';
import { extractImagePalette, usePoemImagePalette } from '../utils/imagePalette.ts';
import { getProseTagPreset } from '../utils/proseTagColors.ts';
import { preserveFormattedText } from '../utils/textFormatting.ts';
import { EditorialImage } from './EditorialImage.tsx';
import { PromoCountdown } from './PromoCountdown.tsx';
import { UserRankBadges } from './UserRankBadges.tsx';

interface HomeShowcaseSectionProps {
  poems: Poem[];
  prose: ProseWork[];
  proseTags?: ProseTag[];
  blog: BlogPost[];
  products: StoreProduct[];
  recentFeedback: HomeFeedbackItem[];
  homeRepeaters?: HomeRepeatersConfig;
  catalogLoaded: boolean;
  cartIds: string[];
  unlockedMap: Record<string, PurchasedAccess>;
  onNavigateSection: (section: SectionId) => void;
  onOpenPoem: (poemId: string) => void;
  onOpenProse: (proseId: string) => void;
  onOpenBlog: (postId: string) => void;
  onOpenProduct: (productId: string) => void;
  onAddToCart: (productId: string) => void;
  onOpenLibrary: () => void;
}

type FeedbackFilter = 'all' | 'poem' | 'prose' | 'product';


function getProductTypeLabel(type: ProductType): string {
  switch (type) {
    case 'ebook':
      return 'Електронна книга';
    case 'paper_book':
      return 'Паперова книга';
    case 'wip_gdoc':
      return 'Google Документ';
    case 'poem_frame':
      return 'Скляна антирамка';
    case 'painting':
      return 'Оригінальна картина';
  }
}

function getProseAccessSummary(work: ProseWork): { label: string; isPaid: boolean } {
  const mode =
    work.accessMode || (work.isPaid ? 'paid' : work.requiresAuth ? 'authorized' : 'public');
  if (mode === 'paid') {
    const price = Math.max(0, Math.round(Number(work.priceUah) || 0));
    return {
      label: price > 0 ? `Платно · ${price} ₴` : 'Платно',
      isPaid: true,
    };
  }
  return {
    label: 'Безкоштовно',
    isPaid: false,
  };
}

function getProseWordsCount(work: ProseWork): number {
  if (typeof work.totalWords === 'number' && work.totalWords > 0) {
    return Math.round(work.totalWords);
  }
  const combined = [
    work.content || '',
    ...(work.chapters || []).map((ch) => ch.content || ''),
  ]
    .join(' ')
    .trim();
  if (!combined) return 0;
  return combined.split(/\s+/).filter(Boolean).length;
}

function formatUkrainianWords(count: number): string {
  const abs = Math.max(0, Math.floor(count));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  let unit = 'слів';
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) unit = 'слово';
    else if (mod10 >= 2 && mod10 <= 4) unit = 'слова';
  }
  return `${abs.toLocaleString('uk-UA')} ${unit}`;
}

function interleaveAdminAndUserWorks<T>(
  items: T[],
  isUserWork: (item: T) => boolean
): T[] {
  const adminItems = items.filter((item) => !isUserWork(item));
  const userItems = items.filter((item) => isUserWork(item));
  if (adminItems.length === 0) return userItems;
  if (userItems.length === 0) return adminItems;
  const interleaved: T[] = [];
  const maxLen = Math.max(adminItems.length, userItems.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i < adminItems.length) interleaved.push(adminItems[i]);
    if (i < userItems.length) interleaved.push(userItems[i]);
  }
  return interleaved;
}

function formatFeedbackDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Intl.DateTimeFormat('uk-UA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(ms));
  } catch {
    return iso.slice(0, 10);
  }
}

function getFeedbackTargetKindLabel(targetType: HomeFeedbackItem['targetType']): string {
  switch (targetType) {
    case 'poem':
      return 'Вірш';
    case 'prose':
      return 'Проза';
    case 'product':
      return 'Крамниця';
  }
}

const VITRINE_GLASS_SHELL =
  'group/card relative overflow-hidden rounded-2xl shadow-[0_18px_42px_-22px_rgba(24,48,33,0.28)] hover:shadow-[0_22px_48px_-20px_rgba(24,48,33,0.36)] dark:shadow-[0_20px_46px_-20px_rgba(0,0,0,0.82)] dark:hover:shadow-[0_24px_52px_-18px_rgba(0,0,0,0.9)] transition-all duration-300';

const VITRINE_GLASS_BASE =
  `${VITRINE_GLASS_SHELL} bg-white dark:bg-night-lift hover:bg-paper dark:hover:bg-night-elevated`;

const VITRINE_GLASS_CARD = `${VITRINE_GLASS_BASE} p-4 sm:p-5`;

function handleSpotlightMove(e: ReactMouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const x = Math.round(e.clientX - rect.left);
  const y = Math.round(e.clientY - rect.top);
  el.style.setProperty('--spot-x', `${x}px`);
  el.style.setProperty('--spot-y', `${y}px`);
}

function GlassOverlays() {
  return (
    <>
      {/* Diagonal electronic glass specular reflection (light mode) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 dark:hidden"
        style={{
          background:
            'linear-gradient(126deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.14) 36%, rgba(255,255,255,0) 62%)',
        }}
      />
      {/* Diagonal electronic glass specular reflection (dark mode) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden dark:block"
        style={{
          background:
            'linear-gradient(126deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 34%, rgba(255,255,255,0) 58%)',
        }}
      />
      {/* Interactive cursor sheen (light mode) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 dark:hidden"
        style={{
          background:
            'radial-gradient(240px circle at var(--spot-x, 50%) var(--spot-y, 20%), rgba(49, 94, 60, 0.09), transparent 72%)',
        }}
      />
      {/* Interactive cursor sheen (dark mode) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 hidden dark:block"
        style={{
          background:
            'radial-gradient(240px circle at var(--spot-x, 50%) var(--spot-y, 20%), rgba(255, 255, 255, 0.09), transparent 72%)',
        }}
      />
    </>
  );
}

function FeedbackAvatar({ photoUrl, name }: { photoUrl?: string; name: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={name}
        width={32}
        height={32}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-8 h-8 rounded-full object-cover shrink-0 bg-paper-sand dark:bg-night-hover"
      />
    );
  }

  return (
    <div className="w-8 h-8 rounded-full bg-paper-warm dark:bg-night-elevated flex items-center justify-center shrink-0 text-ink-muted dark:text-parchment">
      <User className="w-3.5 h-3.5" strokeWidth={1.75} />
    </div>
  );
}

interface VitrineSlide {
  id: string;
  meta?: ReactNode | ((hasCustomText: boolean) => ReactNode);
  metaPosition?: 'top' | 'bottom';
  title: string;
  body?: string;
  preserveLines?: boolean;
  smoothScrollBody?: boolean;
  thumbnailUrl?: string;
  thumbnailUrls?: string[];
  paletteImageUrl?: string;
  imagePalette?: PoemImagePalette;
  manualBackgroundColor?: string;
  manualTextColor?: string;
  onOpen: () => void;
}

interface WorkGlassVitrineProps {
  sectionLabel: string;
  slides: VitrineSlide[];
  autoIntervalMs: number;
  catalogLoaded: boolean;
  fullHeightThumbnail?: boolean;
}

function WorkGlassVitrine({
  sectionLabel,
  slides,
  autoIntervalMs,
  catalogLoaded,
  fullHeightThumbnail = false,
}: WorkGlassVitrineProps) {
  const prefersReducedMotion = useReducedMotion();
  const vitrineRef = useRef<HTMLDivElement | null>(null);
  const vitrineActivity = useViewportActivity(vitrineRef);
  const [slideIndex, setSlideIndex] = useState(0);
  const [singleSlidePhotoTick, setSingleSlidePhotoTick] = useState(0);

  const total = slides.length;
  const safeIndex = total > 0 ? slideIndex % total : 0;
  const roundIndex = total > 0 ? Math.floor(slideIndex / total) : 0;
  const activeSlide = slides[safeIndex] ?? null;

  const activeThumbnailList = useMemo(() => {
    if (!activeSlide) return [];
    if (activeSlide.thumbnailUrls && activeSlide.thumbnailUrls.length > 0) {
      return activeSlide.thumbnailUrls;
    }
    return activeSlide.thumbnailUrl ? [activeSlide.thumbnailUrl] : [];
  }, [activeSlide]);

  const activeThumbStep = total <= 1 ? singleSlidePhotoTick : roundIndex;
  const activeThumbnailUrl =
    activeThumbnailList.length > 0
      ? activeThumbnailList[activeThumbStep % activeThumbnailList.length]
      : undefined;

  useEffect(() => {
    setSlideIndex(0);
    setSingleSlidePhotoTick(0);
  }, [total]);

  useEffect(() => {
    if (total <= 1 || !vitrineActivity.isActive) return;
    const timer = window.setInterval(() => {
      setSlideIndex((prev) => prev + 1);
    }, autoIntervalMs);
    return () => window.clearInterval(timer);
  }, [total, autoIntervalMs, vitrineActivity.isActive]);

  useEffect(() => {
    if (total !== 1 || activeThumbnailList.length <= 1 || !vitrineActivity.isActive) return;
    const timer = window.setInterval(() => {
      setSingleSlidePhotoTick((prev) => prev + 1);
    }, autoIntervalMs);
    return () => window.clearInterval(timer);
  }, [total, activeThumbnailList.length, autoIntervalMs, vitrineActivity.isActive]);

  const paletteSourceUrl = (
    activeThumbnailUrl ||
    activeSlide?.paletteImageUrl ||
    activeSlide?.thumbnailUrl ||
    ''
  ).trim();
  const activeAutoPalette = usePoemImagePalette(paletteSourceUrl, activeSlide?.imagePalette);

  useEffect(() => {
    for (const slide of slides) {
      const urls = new Set<string>();
      const primary = (slide.paletteImageUrl || slide.thumbnailUrl || '').trim();
      if (primary) urls.add(primary);
      for (const extra of slide.thumbnailUrls || []) {
        const trimmed = extra.trim();
        if (trimmed) urls.add(trimmed);
      }
      for (const url of urls) {
        if (!slide.imagePalette?.background) {
          void extractImagePalette(url);
        }
      }
    }
  }, [slides]);

  if (!catalogLoaded && total === 0) {
    return (
      <div
        aria-label={sectionLabel}
        className={`flex flex-col justify-center h-[152px] sm:h-[158px] ${VITRINE_GLASS_CARD}`}
      >
        <GlassOverlays />
        <div className="relative z-10 space-y-2.5">
          <div className="h-3 w-28 rounded bg-pine-dark/10 dark:bg-white/10" />
          <div className="h-5 w-4/5 rounded bg-pine-dark/12 dark:bg-white/14" />
          <div className="h-10 w-full rounded bg-pine-dark/8 dark:bg-white/[0.08]" />
        </div>
      </div>
    );
  }

  const hasFullHeightThumb = Boolean(fullHeightThumbnail && activeThumbnailUrl);
  const hasManualBg = Boolean(activeSlide?.manualBackgroundColor);
  const activeBgColor =
    activeSlide?.manualBackgroundColor ||
    (paletteSourceUrl && activeAutoPalette?.background) ||
    undefined;
  const activeBgImage =
    !hasManualBg && paletteSourceUrl && activeAutoPalette?.secondaryBackground
      ? `linear-gradient(150deg, ${activeAutoPalette.background} 0%, ${activeAutoPalette.secondaryBackground} 100%)`
      : undefined;
  const customTextColor =
    activeSlide?.manualTextColor ||
    (!hasManualBg && paletteSourceUrl && activeAutoPalette?.text) ||
    undefined;
  const hasCustomSurface = Boolean(activeBgColor || activeBgImage);
  const activeSurfaceStyle = hasCustomSurface
    ? {
        ...(activeBgColor ? { backgroundColor: activeBgColor } : {}),
        ...(activeBgImage ? { backgroundImage: activeBgImage } : {}),
      }
    : undefined;
  const hasCustomText = Boolean(hasCustomSurface && customTextColor);
  const rawMeta = activeSlide?.meta;
  const renderedMeta: ReactNode =
    typeof rawMeta === 'function' ? rawMeta(hasCustomText) : rawMeta;

  const fadeEase = [0.45, 0, 0.55, 1] as const;
  const fadeDuration = prefersReducedMotion ? 0.2 : 1.35;

  return (
    <div
      ref={vitrineRef}
      aria-label={sectionLabel}
      onMouseMove={handleSpotlightMove}
      className={`${VITRINE_GLASS_BASE} ${
        vitrineActivity.isActive ? '' : 'vitrine-paused '
      }h-[152px] sm:h-[158px] flex flex-col justify-center`}
    >
      {/* Smoothly crossfaded adaptive palette background */}
      <AnimatePresence initial={false} mode="sync">
        {hasCustomSurface && (
          <m.div
            key={`bg-${activeBgColor || ''}-${activeBgImage || ''}`}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: fadeDuration, ease: fadeEase }}
            style={activeSurfaceStyle}
            className="pointer-events-none absolute inset-0 z-0 will-change-[opacity]"
          />
        )}
      </AnimatePresence>

      <GlassOverlays />

      {/* Stationary Crossfade Viewport */}
      {activeSlide && (
        <div className="relative z-10 grid w-full h-full overflow-hidden">
          <AnimatePresence initial={false} mode="sync">
            <m.div
              key={`${sectionLabel}-${activeSlide.id}-${safeIndex}`}
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { duration: fadeDuration, ease: fadeEase },
              }}
              exit={{
                opacity: 0,
                transition: { duration: fadeDuration, ease: fadeEase },
              }}
              className="col-start-1 row-start-1 flex items-stretch justify-between w-full h-full min-w-0 will-change-[opacity]"
            >
              <button
                type="button"
                onClick={activeSlide.onOpen}
                className={`group flex-1 min-w-0 h-full p-4 sm:p-5 flex items-center justify-between gap-3 overflow-hidden cursor-pointer focus-visible:outline-2 focus-visible:outline-pine dark:focus-visible:outline-silver ${
                  !activeSlide.body && !renderedMeta ? 'text-center justify-center' : 'text-left'
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  {renderedMeta && activeSlide.metaPosition !== 'bottom' && (
                    <div
                      style={hasCustomText ? { color: customTextColor } : undefined}
                      className={`flex items-center gap-x-1.5 gap-y-0.5 text-[11px] tabular-nums ${
                        hasCustomText ? '' : 'text-ink-muted dark:text-parchment'
                      } ${
                        activeSlide.smoothScrollBody ? 'flex-nowrap min-w-0 overflow-hidden' : 'flex-wrap'
                      }`}
                    >
                      {renderedMeta}
                    </div>
                  )}

                  <h3
                    style={customTextColor ? { color: customTextColor } : undefined}
                    className={`font-serif tracking-[-0.015em] leading-snug line-clamp-1 transition-colors duration-200 ${
                      !activeSlide.body && !renderedMeta
                        ? 'text-[15px] sm:text-base font-normal italic text-ink-muted dark:text-parchment group-hover:text-pine-night dark:group-hover:text-cream'
                        : customTextColor
                          ? 'text-base sm:text-[17px] font-semibold group-hover:opacity-80'
                          : 'text-base sm:text-[17px] font-semibold text-pine-night dark:text-[#F2F0EA] group-hover:text-pine dark:group-hover:text-white'
                    }`}
                  >
                    {activeSlide.title}
                  </h3>

                  {activeSlide.body &&
                    (activeSlide.smoothScrollBody ? (
                      (() => {
                        const lineCount = activeSlide.body
                          .split('\n')
                          .filter((l) => l.trim().length > 0).length;
                        const shouldAnimate = lineCount > 2 || activeSlide.body.length > 75;
                        const durationSec = Math.max(10, Math.min(45, lineCount * 2.2));
                        const boxHeightClass = activeSlide.meta
                          ? 'h-[70px] sm:h-[74px]'
                          : 'h-[90px] sm:h-[94px]';
                        const poemTextClass = `text-[13.5px] leading-[1.6] font-serif italic whitespace-pre-wrap ${
                          customTextColor ? '' : 'text-[#444440] dark:text-parchment'
                        }`;

                        if (!shouldAnimate) {
                          return (
                            <div
                              aria-label={activeSlide.body}
                              className={`relative overflow-hidden ${boxHeightClass}`}
                            >
                              <div
                                className={poemTextClass}
                                style={
                                  customTextColor
                                    ? { color: customTextColor, opacity: 0.9 }
                                    : undefined
                                }
                              >
                                {activeSlide.body}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            aria-label={activeSlide.body}
                            className={`relative overflow-hidden ${boxHeightClass}`}
                            style={{
                              maskImage:
                                'linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)',
                              WebkitMaskImage:
                                'linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)',
                            }}
                          >
                            <div
                              className={`vitrine-poem-scroll ${poemTextClass}`}
                              style={{
                                ['--poem-scroll-duration' as string]: `${durationSec}s`,
                                ...(customTextColor ? { color: customTextColor, opacity: 0.9 } : {}),
                              }}
                            >
                              {activeSlide.body}
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <p
                        style={customTextColor ? { color: customTextColor, opacity: 0.9 } : undefined}
                        className={`text-[13px] leading-relaxed line-clamp-2 ${
                          customTextColor ? '' : 'text-[#444440] dark:text-parchment'
                        } ${
                          activeSlide.preserveLines ? 'font-serif italic whitespace-pre-wrap' : ''
                        }`}
                      >
                        {activeSlide.body}
                      </p>
                    ))}

                  {renderedMeta && activeSlide.metaPosition === 'bottom' && (
                    <div
                      style={hasCustomText ? { color: customTextColor } : undefined}
                      className={`pt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] tabular-nums max-h-[38px] overflow-hidden ${
                        hasCustomText ? '' : 'text-ink-muted dark:text-parchment'
                      }`}
                    >
                      {renderedMeta}
                    </div>
                  )}
                </div>

                {activeThumbnailUrl && !fullHeightThumbnail && (
                  <div className="rounded-xl overflow-hidden shrink-0">
                    <EditorialImage
                      src={activeThumbnailUrl}
                      alt={activeSlide.title}
                      titleFallback={activeSlide.title}
                      aspectClassName="w-14 h-14"
                      className="rounded-xl group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                )}
              </button>

              {/* Full-Height Edge-to-Edge Thumbnail Column */}
              {hasFullHeightThumb && activeThumbnailUrl && (
                <button
                  type="button"
                  onClick={activeSlide.onOpen}
                  aria-label={`Відкрити ${activeSlide.title}`}
                  className={`group/thumb relative w-28 sm:w-36 shrink-0 self-stretch overflow-hidden cursor-pointer ${
                    hasCustomSurface ? 'bg-black/10' : 'bg-paper-warm dark:bg-night-card'
                  }`}
                >
                  <AnimatePresence initial={false} mode="sync">
                    <m.div
                      key={`${sectionLabel}-thumb-${activeSlide.id}-${activeThumbnailUrl}`}
                      initial={{ opacity: 0 }}
                      animate={{
                        opacity: 1,
                        transition: { duration: fadeDuration, ease: fadeEase },
                      }}
                      exit={{
                        opacity: 0,
                        transition: { duration: fadeDuration, ease: fadeEase },
                      }}
                      className="absolute inset-0 w-full h-full will-change-[opacity]"
                    >
                      <EditorialImage
                        src={activeThumbnailUrl}
                        alt={activeSlide.title}
                        titleFallback={activeSlide.title}
                        aspectClassName="w-full h-full"
                        className="w-full h-full group-hover/thumb:scale-105 transition-transform duration-300"
                      />
                    </m.div>
                  </AnimatePresence>
                </button>
              )}
            </m.div>
          </AnimatePresence>
        </div>
      )}

      {/* Bottom Live Cycle Progress Hairline */}
      {(total > 1 || activeThumbnailList.length > 1) && vitrineActivity.isActive && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[2px] overflow-hidden ${
            hasCustomSurface ? 'bg-black/10' : 'bg-pine-dark/6 dark:bg-white/[0.06]'
          }`}
        >
          <m.div
            key={`progress-${sectionLabel}-${safeIndex}-${activeThumbStep}`}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: autoIntervalMs / 1000, ease: 'linear' }}
            style={{
              transformOrigin: 'left',
              ...(hasCustomText ? { backgroundColor: customTextColor, opacity: 0.38 } : {}),
            }}
            className={`h-full w-full ${
              hasCustomText ? '' : 'bg-pine/55 dark:bg-white/35'
            }`}
          />
        </div>
      )}
    </div>
  );
}

export const HomeShowcaseSection = memo(function HomeShowcaseSection({
  poems,
  prose,
  proseTags = [],
  blog,
  products,
  recentFeedback,
  homeRepeaters,
  catalogLoaded,
  cartIds,
  unlockedMap,
  onNavigateSection,
  onOpenPoem,
  onOpenProse,
  onOpenBlog,
  onOpenProduct,
}: HomeShowcaseSectionProps) {
  const prefersReducedMotion = useReducedMotion();
  const repeatersConfig = useMemo(
    () => normalizeHomeRepeatersConfig(homeRepeaters),
    [homeRepeaters]
  );

  // Ретранслятор віршів: чергує адмінські (авторські) твори та вірші користувачів
  const selectedPoems = useMemo(() => {
    const adminPoems = poems.filter((p) => !p.isCommunity);
    const userPoems = poems.filter((p) => Boolean(p.isCommunity));
    if (adminPoems.length > 0 && userPoems.length > 0) {
      const interleaved = interleaveAdminAndUserWorks(poems, (p) => Boolean(p.isCommunity));
      return interleaved.slice(0, Math.max(repeatersConfig.poemLimit, 6));
    }
    if (adminPoems.length > 0) return [adminPoems[0]];
    return userPoems.length > 0 ? [userPoems[0]] : [];
  }, [poems, repeatersConfig.poemLimit]);

  const selectedProse = useMemo(() => {
    const isPaidWork = (w: ProseWork) =>
      w.accessMode === 'paid' || (Boolean(w.isPaid) && Number(w.priceUah || 0) > 0);

    let list = [...prose];
    if (repeatersConfig.proseMode === 'free_only') {
      list = list.filter((w) => !isPaidWork(w) && w.accessMode !== 'authorized' && !w.requiresAuth);
    } else if (repeatersConfig.proseMode === 'paid_only') {
      list = list.filter((w) => isPaidWork(w));
    } else if (repeatersConfig.proseMode === 'top_rated') {
      list.sort((a, b) => {
        if (b.ratingAverage !== a.ratingAverage) return b.ratingAverage - a.ratingAverage;
        return b.ratingCount - a.ratingCount;
      });
    }
    const hasAdmin = list.some((w) => !w.isCommunity);
    const hasUser = list.some((w) => Boolean(w.isCommunity));
    const interleaved = interleaveAdminAndUserWorks(list, (w) => Boolean(w.isCommunity));
    const effectiveLimit =
      hasAdmin && hasUser
        ? Math.max(repeatersConfig.proseLimit, 2)
        : repeatersConfig.proseLimit;
    return interleaved.slice(0, effectiveLimit);
  }, [prose, repeatersConfig.proseMode, repeatersConfig.proseLimit]);

  const selectedBlog = useMemo(() => {
    const list = [...blog];
    if (repeatersConfig.blogMode === 'most_viewed') {
      list.sort((a, b) => (b.viewsCount || 0) - (a.viewsCount || 0));
    } else if (repeatersConfig.blogMode === 'quick_read') {
      list.sort((a, b) => (a.readingMinutes || 1) - (b.readingMinutes || 1));
    }
    return list.slice(0, repeatersConfig.blogLimit);
  }, [blog, repeatersConfig.blogMode, repeatersConfig.blogLimit]);

  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackFilter>('all');

  // Build dynamic slides for Вірші, Проза, Блог, Крамниця
  const poemSlides: VitrineSlide[] = useMemo(() => {
    if (selectedPoems.length === 0) {
      return [
        {
          id: 'poem-empty-1',
          title: 'Тут поки що тиша',
          onOpen: () => onNavigateSection('poetry'),
        },
      ];
    }

    return selectedPoems.map((p) => {
      const fullPoemText = preserveFormattedText(p.content || p.excerpt || '');
      const poemTracks = (
        p.soundcloudTracks && p.soundcloudTracks.length > 0
          ? p.soundcloudTracks
          : p.soundcloudTrack
            ? [p.soundcloudTrack]
            : []
      ).filter((t) => Boolean(t && (t.soundcloudUrl?.trim() || t.embedTargetUrl?.trim())));
      const hasSong = poemTracks.length > 0;
      const authorLabel = p.authorName || (p.isCommunity ? 'Читач' : 'Андрій Даньків');

      return {
        id: p.id,
        title: p.title,
        body: fullPoemText,
        preserveLines: true,
        smoothScrollBody: true,
        ...(p.imageUrl ? { thumbnailUrl: p.imageUrl } : {}),
        ...(p.imagePalette ? { imagePalette: p.imagePalette } : {}),
        ...(p.backgroundColor ? { manualBackgroundColor: p.backgroundColor } : {}),
        ...(p.textColor ? { manualTextColor: p.textColor } : {}),
        onOpen: () => {
          trackClick(`home_repeater:poem:${p.id}`, `Головна · Вірш: «${p.title}»`, 'content');
          onOpenPoem(p.id);
        },
        meta: (hasCustomText: boolean) => (
          <>
            <span className="font-medium truncate max-w-[18ch]">{authorLabel}</span>
            {p.workStatus && (
              <>
                <span aria-hidden="true">·</span>
                <span>{p.workStatus === 'completed' ? 'Закінчено' : 'У процесі'}</span>
              </>
            )}
            {p.ratingCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={`inline-flex items-center gap-0.5 font-mono shrink-0 ${
                    hasCustomText ? '' : 'text-pine-night dark:text-cream'
                  }`}
                >
                  <Star className="w-3 h-3 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                  <span>{p.ratingAverage.toFixed(1)}</span>
                </span>
              </>
            )}
            {hasSong && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  title="Є аудіозапис"
                  aria-label="Є аудіозапис"
                  className={`inline-flex items-center shrink-0 ${
                    hasCustomText ? '' : 'text-pine dark:text-silver'
                  }`}
                >
                  <Music2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.85} />
                </span>
              </>
            )}
          </>
        ),
      };
    });
  }, [selectedPoems, onNavigateSection, onOpenPoem]);

  const proseTagMap = useMemo(
    () => new Map(proseTags.map((tag) => [tag.id, tag])),
    [proseTags]
  );

  const proseSlides: VitrineSlide[] = useMemo(() => {
    if (selectedProse.length === 0) {
      return [
        {
          id: 'prose-empty-1',
          title: 'Тут поки що тиша',
          onOpen: () => onNavigateSection('prose'),
        },
      ];
    }

    return selectedProse.map((w) => {
      const moodboardPhotos = (w.moodboardUrls || [])
        .map((u) => (typeof u === 'string' ? u.trim() : ''))
        .filter(Boolean);
      const coverPhoto = moodboardPhotos[0];
      const pagesCount = Math.max(1, Math.round(Number(w.pages) || 1));
      const wordsCount = getProseWordsCount(w);
      const accessInfo = getProseAccessSummary(w);
      const workTags = (w.tagIds || [])
        .map((id) => proseTagMap.get(id))
        .filter((t): t is ProseTag => Boolean(t));
      const authorLabel = w.authorName || (w.isCommunity ? 'Читач' : 'Андрій Даньків');

      return {
        id: w.id,
        title: `«${w.title}»`,
        body: preserveFormattedText(w.slogan || w.excerpt || w.previewText || ''),
        metaPosition: 'bottom',
        ...(coverPhoto ? { thumbnailUrl: coverPhoto, paletteImageUrl: coverPhoto } : {}),
        ...(moodboardPhotos.length > 1 ? { thumbnailUrls: moodboardPhotos } : {}),
        onOpen: () => {
          trackClick(`home_repeater:prose:${w.id}`, `Головна · Проза: «${w.title}»`, 'content');
          onOpenProse(w.id);
        },
        meta: (hasCustomText: boolean) => (
          <>
            <span className="font-medium truncate max-w-[16ch]">{authorLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{pagesCount} стор.</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{formatUkrainianWords(wordsCount)}</span>
            <span aria-hidden="true">·</span>
            <span
              className={`font-semibold ${
                hasCustomText
                  ? ''
                  : accessInfo.isPaid
                    ? 'text-[#B45309] dark:text-[#FCD34D]'
                    : 'text-pine-deep dark:text-[#6EE7B7]'
              }`}
            >
              {accessInfo.label}
            </span>
            {workTags.map((tag) => {
              const preset = getProseTagPreset(tag.color);
              return (
                <span
                  key={tag.id}
                  style={preset.badgeStyle}
                  className={`inline-flex items-center gap-1 px-1.5 py-[1px] rounded-md text-[10px] font-semibold leading-tight max-w-[16ch] ${preset.badgeClass}`}
                >
                  <BookMarked className="w-2.5 h-2.5 shrink-0" strokeWidth={2.1} />
                  <span className="truncate">{tag.label}</span>
                </span>
              );
            })}
            {w.ratingCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={`inline-flex items-center gap-0.5 font-mono ${
                    hasCustomText ? '' : 'text-pine-night dark:text-cream'
                  }`}
                >
                  <Star className="w-3 h-3 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                  <span>{w.ratingAverage.toFixed(1)}</span>
                </span>
              </>
            )}
          </>
        ),
      };
    });
  }, [selectedProse, prose.length, proseTagMap, repeatersConfig.proseMode, onNavigateSection, onOpenProse]);

  const blogSlides: VitrineSlide[] = useMemo(() => {
    if (selectedBlog.length === 0) {
      return [
        {
          id: 'blog-empty-1',
          title: 'Тут поки що тиша',
          onOpen: () => onNavigateSection('blog'),
        },
      ];
    }

    return selectedBlog.map((b) => {
      const { filmMeta, firstPhotoUrl, firstVideoThumbnailUrl } = extractBlogFilmMeta(b.content);
      const posterThumb =
        (typeof b.coverImage === 'string' && b.coverImage.trim()) ||
        firstPhotoUrl ||
        firstVideoThumbnailUrl ||
        undefined;
      const cleanBody = b.excerpt?.trim() || stripBlogMediaTokens(b.content);
      return {
        id: b.id,
        title: b.title,
        body: cleanBody,
        ...(posterThumb ? { thumbnailUrl: posterThumb } : {}),
        onOpen: () => {
          trackClick(`home_repeater:blog:${b.id}`, `Головна · Блог: «${b.title}»`, 'content');
          onOpenBlog(b.id);
        },
        meta: (hasCustomText: boolean) => (
          <>
            <span className="truncate max-w-[14ch]">{b.category || 'Кіноблог'}</span>
            {filmMeta?.releaseYear && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{filmMeta.releaseYear}</span>
              </>
            )}
            {typeof filmMeta?.rating === 'number' && filmMeta.rating > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={`inline-flex items-center gap-0.5 font-mono tabular-nums ${
                    hasCustomText ? '' : 'text-pine-night dark:text-[#FDE68A]'
                  }`}
                >
                  <Star className="w-3 h-3 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                  <span>{filmMeta.rating.toFixed(1)}</span>
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{b.readingMinutes} хв</span>
          </>
        ),
      };
    });
  }, [selectedBlog, onNavigateSection, onOpenBlog]);

  // Store 4th Repeater filtered & sorted according to admin homeRepeaters config
  const highlightedProducts = useMemo(() => {
    const nowSnapshot = Date.now();
    const indexed = products.map((product, index) => {
      const parsed = parseStoreProductPromo(product);
      const basePrice = Math.max(0, Math.round(Number(product.priceUah) || 0));
      const effectivePrice = getEffectivePriceUah(product);
      const discountPct =
        effectivePrice < basePrice
          ? Math.max(0, Math.min(90, Math.round(Number(product.discountPercent) || 0)))
          : 0;
      const timerTargetMs = parsed.promoEndsAt ? Date.parse(parsed.promoEndsAt) : NaN;
      const hasValidFutureTimer =
        Boolean(product.promoActive) && Number.isFinite(timerTargetMs) && timerTargetMs > nowSnapshot;

      return {
        product,
        index,
        parsed,
        discountPct,
        timerTargetMs,
        hasValidFutureTimer,
      };
    });

    let listToShow = indexed;

    switch (repeatersConfig.storeMode) {
      case 'discounted':
        listToShow = indexed.filter((entry) => entry.discountPct > 0);
        listToShow.sort((a, b) => b.discountPct - a.discountPct || a.index - b.index);
        break;
      case 'promo_active':
        listToShow = indexed.filter((entry) => Boolean(entry.product.promoActive));
        listToShow.sort((a, b) => {
          if (a.hasValidFutureTimer !== b.hasValidFutureTimer) {
            return a.hasValidFutureTimer ? -1 : 1;
          }
          if (b.discountPct !== a.discountPct) return b.discountPct - a.discountPct;
          return a.index - b.index;
        });
        break;
      case 'bestsellers':
        listToShow = indexed.filter((entry) => entry.parsed.isBestseller);
        listToShow.sort((a, b) => (b.product.ratingAverage || 0) - (a.product.ratingAverage || 0) || a.index - b.index);
        break;
      case 'top_rated':
        listToShow = [...indexed].sort((a, b) => {
          if (b.product.ratingAverage !== a.product.ratingAverage) {
            return b.product.ratingAverage - a.product.ratingAverage;
          }
          return b.product.ratingCount - a.product.ratingCount || a.index - b.index;
        });
        break;
      case 'latest':
        listToShow = [...indexed];
        break;
      case 'smart_highlights':
      default: {
        const filtered = indexed.filter(
          (entry) =>
            entry.parsed.isBestseller ||
            entry.discountPct > 0 ||
            Boolean(entry.product.promoActive)
        );
        listToShow = filtered.length > 0 ? filtered : [...indexed];
        listToShow.sort((a, b) => {
          if (b.discountPct !== a.discountPct) return b.discountPct - a.discountPct;
          if (a.hasValidFutureTimer !== b.hasValidFutureTimer) {
            return a.hasValidFutureTimer ? -1 : 1;
          }
          if (a.hasValidFutureTimer && b.hasValidFutureTimer && a.timerTargetMs !== b.timerTargetMs) {
            return a.timerTargetMs - b.timerTargetMs;
          }
          if (a.parsed.isBestseller !== b.parsed.isBestseller) {
            return a.parsed.isBestseller ? -1 : 1;
          }
          if (Boolean(a.product.promoActive) !== Boolean(b.product.promoActive)) {
            return a.product.promoActive ? -1 : 1;
          }
          return a.index - b.index;
        });
        break;
      }
    }

    return listToShow.slice(0, repeatersConfig.storeLimit);
  }, [products, repeatersConfig.storeMode, repeatersConfig.storeLimit]);

  const storeSlides: VitrineSlide[] = useMemo(() => {
    if (highlightedProducts.length === 0) {
      return [
        {
          id: 'store-empty-1',
          title: 'Тут поки що тиша',
          onOpen: () => onNavigateSection('store'),
        },
      ];
    }

    const buildProductMeta = (
      entry: (typeof highlightedProducts)[number],
      basePriceUah: number,
      finalPriceUah: number,
      hasDiscount: boolean,
      hasCustomText: boolean
    ) => {
      const isPromoActive = Boolean(entry.product.promoActive);
      const rawPromoLabel = entry.parsed.cleanPromoLabel.trim();
      const promoText = isPromoActive
        ? rawPromoLabel && !/^бестсел/i.test(rawPromoLabel)
          ? rawPromoLabel.toUpperCase()
          : 'АКЦІЯ'
        : hasDiscount
          ? 'ЗНИЖКА'
          : '';
      const redTextStyle = hasCustomText
        ? { color: '#FF5A5F', textShadow: '0 1px 2px rgba(0, 0, 0, 0.45)' }
        : undefined;
      const redTextClass = hasCustomText
        ? ''
        : 'text-[#DC2626] dark:text-[#FF5A5F]';

      return (
        <>
          {promoText && (
            <>
              <span
                style={redTextStyle}
                className={`font-bold uppercase tracking-[0.04em] ${redTextClass}`}
              >
                {promoText}
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="truncate max-w-[14ch]">{getProductTypeLabel(entry.product.type)}</span>
          <span aria-hidden="true">·</span>
          {hasDiscount ? (
            <>
              <span className="font-mono line-through opacity-70">{basePriceUah} ₴</span>
              <span
                style={redTextStyle}
                className={`font-mono font-bold ${redTextClass}`}
              >
                {finalPriceUah} ₴
              </span>
              <span
                style={redTextStyle}
                className={`font-mono font-semibold ${redTextClass}`}
              >
                −{entry.discountPct}%
              </span>
            </>
          ) : (
            <span
              style={isPromoActive ? redTextStyle : undefined}
              className={`font-mono font-semibold ${
                isPromoActive
                  ? redTextClass
                  : hasCustomText
                    ? ''
                    : 'text-pine-night dark:text-cream'
              }`}
            >
              {finalPriceUah} ₴
            </span>
          )}
          {entry.parsed.isBestseller && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className={`font-medium ${
                  hasCustomText ? '' : 'text-[#9A6B16] dark:text-[#F7DF9C]'
                }`}
              >
                Бестселлер
              </span>
            </>
          )}
          {entry.product.promoActive && entry.parsed.promoEndsAt && (
            <PromoCountdown endsAtIso={entry.parsed.promoEndsAt} variant="vitrine" />
          )}
          {entry.product.ratingCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className={`inline-flex items-center gap-0.5 font-mono ${
                  hasCustomText ? '' : 'text-pine-night dark:text-cream'
                }`}
              >
                <Star className="w-3 h-3 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                <span>{entry.product.ratingAverage.toFixed(1)}</span>
              </span>
            </>
          )}
        </>
      );
    };

    return highlightedProducts.map((entry) => {
      const { product, discountPct } = entry;
      const basePriceUah = Math.max(0, Math.round(Number(product.priceUah) || 0));
      const finalPriceUah = getEffectivePriceUah(product);
      const hasDiscount = discountPct > 0 && finalPriceUah < basePriceUah;

      return {
        id: product.id,
        title: product.title,
        body: product.description,
        thumbnailUrl: product.coverImage,
        onOpen: () => {
          trackClick(`home_store:${product.id}`, `Головна · Крамниця: «${product.title}»`, 'store');
          onOpenProduct(product.id);
        },
        meta: (hasCustomText: boolean) =>
          buildProductMeta(entry, basePriceUah, finalPriceUah, hasDiscount, hasCustomText),
      };
    });
  }, [highlightedProducts, products.length, repeatersConfig.storeMode, onNavigateSection, onOpenProduct]);

  // Merge recentFeedback + live reviews inside poems, prose, products
  const mergedFeedback = useMemo(() => {
    const poemMap = new Map(poems.map((p) => [p.id, p]));
    const proseMap = new Map(prose.map((w) => [w.id, w]));
    const productMap = new Map(products.map((p) => [p.id, p]));

    const byKey = new Map<string, HomeFeedbackItem>();
    const addEntry = (entry: HomeFeedbackItem) => {
      if (!entry.targetTitle) return;
      const key = `${entry.targetType}:${entry.targetId}:${entry.id}`;
      const existing = byKey.get(key);
      if (!existing || (entry.comment && !existing.comment)) {
        byKey.set(key, entry);
      }
    };

    for (const item of recentFeedback) {
      addEntry(item);
    }

    for (const poem of poems) {
      for (const rev of poem.reviews ?? []) {
        addEntry({ ...rev, targetTitle: poem.title });
      }
    }
    for (const work of prose) {
      for (const rev of work.reviews ?? []) {
        addEntry({ ...rev, targetTitle: work.title });
      }
    }
    for (const prod of products) {
      for (const rev of prod.reviews ?? []) {
        addEntry({ ...rev, targetTitle: prod.title });
      }
    }

    const list = Array.from(byKey.values()).filter((entry) => {
      if (entry.targetType === 'poem') return poemMap.has(entry.targetId);
      if (entry.targetType === 'prose') return proseMap.has(entry.targetId);
      return productMap.has(entry.targetId);
    });

    list.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    return list;
  }, [recentFeedback, poems, prose, products]);

  const feedbackCounts = useMemo(
    () => ({
      all: mergedFeedback.length,
      poem: mergedFeedback.filter((i) => i.targetType === 'poem').length,
      prose: mergedFeedback.filter((i) => i.targetType === 'prose').length,
      product: mergedFeedback.filter((i) => i.targetType === 'product').length,
    }),
    [mergedFeedback]
  );

  const filteredFeedback = useMemo(() => {
    if (feedbackFilter === 'all') return mergedFeedback;
    return mergedFeedback.filter((item) => item.targetType === feedbackFilter);
  }, [mergedFeedback, feedbackFilter]);

  const FEEDBACK_PAGE_SIZE = 2;
  const visibleFeedback = filteredFeedback.slice(0, FEEDBACK_PAGE_SIZE);

  const handleOpenFeedbackTarget = useCallback(
    (item: HomeFeedbackItem) => {
      trackClick(`home_feedback:${item.targetType}:${item.targetId}`, `Відгук -> «${item.targetTitle}»`, 'content');
      if (item.targetType === 'poem') {
        onOpenPoem(item.targetId);
      } else if (item.targetType === 'prose') {
        onOpenProse(item.targetId);
      } else {
        onOpenProduct(item.targetId);
      }
    },
    [onOpenPoem, onOpenProse, onOpenProduct]
  );

  return (
    <div className="relative z-10 w-full max-w-4xl mx-auto px-4 sm:px-6 pt-1 pb-24 sm:pb-28 space-y-6 sm:space-y-8">
      {/* 1. Four Electronic Glass Vitrines: Вірші · Проза · Блог · Крамниця */}
      <section aria-label="Електронні вітрини розділів Вірші, Проза, Блог та Крамниця">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <WorkGlassVitrine
            sectionLabel="Вірші"
            slides={poemSlides}
            autoIntervalMs={8000}
            catalogLoaded={catalogLoaded}
            fullHeightThumbnail
          />

          <WorkGlassVitrine
            sectionLabel="Проза"
            slides={proseSlides}
            autoIntervalMs={9200}
            catalogLoaded={catalogLoaded}
            fullHeightThumbnail
          />

          <WorkGlassVitrine
            sectionLabel="БДК"
            slides={blogSlides}
            autoIntervalMs={10400}
            catalogLoaded={catalogLoaded}
          />

          <WorkGlassVitrine
            sectionLabel="Крамниця"
            slides={storeSlides}
            autoIntervalMs={11600}
            catalogLoaded={catalogLoaded}
            fullHeightThumbnail
          />
        </div>
      </section>

      {/* 3. Fifth Electronic Glass Vitrine: Оцінки та коментарі читачів */}
      <section
        aria-label="Скляна вітрина останніх оцінок і коментарів"
        className="space-y-3"
      >
        {!catalogLoaded && mergedFeedback.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {[0, 1].map((idx) => (
              <div
                key={idx}
                className={`${VITRINE_GLASS_CARD} space-y-2.5`}
              >
                <div className="h-3.5 w-36 rounded bg-pine-dark/10 dark:bg-white/10" />
                <div className="h-10 w-full rounded bg-pine-dark/8 dark:bg-white/[0.08]" />
              </div>
            ))}
          </div>
        ) : (
          <div
            onMouseMove={handleSpotlightMove}
            className={`${VITRINE_GLASS_CARD} space-y-3.5`}
          >
            <GlassOverlays />

            {mergedFeedback.length > 0 && (
              <div className="relative z-10 flex items-center justify-between pb-1">
                <h3 className="font-serif text-[16px] sm:text-[17px] font-semibold text-pine-night dark:text-cream">
                  Остання активність
                </h3>
              </div>
            )}

            {visibleFeedback.length === 0 ? (
              <div className="relative z-10 flex items-center justify-center min-h-[76px]">
                <p className="font-serif text-[15px] sm:text-base font-normal italic text-ink-muted dark:text-parchment text-center">
                  Тут поки що тиша
                </p>
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <m.div
                  key={feedbackFilter}
                  initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -10 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-3"
                >
                  {visibleFeedback.map((item) => {
                    const hasComment = Boolean(item.comment && item.comment.trim());
                    return (
                      <article
                        key={`${item.targetType}:${item.targetId}:${item.id}`}
                        onClick={() => handleOpenFeedbackTarget(item)}
                        className="rounded-xl p-3.5 bg-white/55 dark:bg-night-panel/65 hover:bg-white/80 dark:hover:bg-night-lift/85 flex flex-col justify-between gap-2.5 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99] cursor-pointer"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FeedbackAvatar photoUrl={item.authorPhotoUrl} name={item.authorName} />

                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                  <p className="text-xs sm:text-[13px] font-semibold text-pine-night dark:text-cream truncate max-w-full">
                                    {item.authorName}
                                  </p>
                                  <UserRankBadges badges={item.authorBadges} size="xs" />
                                </div>
                                <p className="text-[11px] text-ink-muted dark:text-parchment font-mono tabular-nums">
                                  {formatFeedbackDate(item.createdAt)}
                                </p>
                              </div>
                            </div>

                            {item.rating !== null && (
                              <span
                                aria-label={`Оцінка ${item.rating} з 5`}
                                className="inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums text-pine-night dark:text-cream shrink-0"
                              >
                                <Star className="w-3.5 h-3.5 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                                <span>{item.rating.toFixed(1)}</span>
                              </span>
                            )}
                          </div>

                          {hasComment ? (
                            <p className="text-[13.5px] leading-relaxed text-[#2F2F2C] dark:text-paper-stone line-clamp-3 whitespace-pre-line">
                              {item.comment}
                            </p>
                          ) : (
                            <p className="text-xs italic text-ink-muted dark:text-parchment">
                              Оцінка без коментаря
                            </p>
                          )}
                        </div>

                        <div className="pt-1.5 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenFeedbackTarget(item);
                            }}
                            className="group inline-flex items-center gap-1.5 text-xs font-medium text-pine dark:text-silver hover:opacity-80 transition-opacity min-w-0 cursor-pointer"
                          >
                            <span className="text-ink-muted dark:text-parchment shrink-0">
                              {getFeedbackTargetKindLabel(item.targetType)} ·
                            </span>
                            <span className="truncate">«{item.targetTitle}»</span>
                            <ArrowUpRight className="w-3.5 h-3.5 shrink-0 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" strokeWidth={1.85} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </m.div>
              </AnimatePresence>
            )}

          </div>
        )}
      </section>
    </div>
  );
});
