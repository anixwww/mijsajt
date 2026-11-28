import {
  Award,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Filter,
  MessageSquare,
  Send,
  Star,
  X,
  ZoomIn,
} from 'lucide-react';
import { AnimatePresence, m, type PanInfo } from 'motion/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  GuestUser,
  Poem,
  WeeklyPeriodInfo,
  WeeklyPoemWinner,
} from '../types.ts';
import { setActiveMoment, trackClick } from '../utils/analytics.ts';
import { triggerLikeHapticFeedback } from '../utils/haptics.ts';
import { isHexColorDark, usePoemImagePalette } from '../utils/imagePalette.ts';
import { EmptySectionState } from './EmptySectionState.tsx';
import { HeartBloomIcon } from './HeartBloomIcon.tsx';
import { PoemSoundCloudPlayer } from './PoemSoundCloudPlayer.tsx';
import { ReviewsBlock } from './ReviewsBlock.tsx';
import { ShareButton } from './ShareButton.tsx';
import { SubmitPoemModal } from './SubmitPoemModal.tsx';
import { SwipeStarRating } from './SwipeStarRating.tsx';

interface PoetrySectionProps {
  poems: Poem[];
  weeklyPoems?: WeeklyPoemWinner[];
  weeklyCurrentPeriod?: WeeklyPeriodInfo;
  guestUser: GuestUser | null;
  getGuestToken?: (forceRefresh?: boolean) => Promise<string | null>;
  isAdmin?: boolean;
  getAdminToken?: (forceRefresh?: boolean) => Promise<string | null>;
  onOpenAuthModal: () => void;
  onGuestUserUpdated?: (user: GuestUser) => void;
  onPoemUpdated: (updatedPoem: Poem) => void;
  onPoemViewed: (poemId: string, viewsCount: number) => void;
  initialPoemId?: string | null;
  onActivePoemChange?: (poemId: string | null) => void;
  onSurfaceStyleChange?: (style: { backgroundColor?: string; backgroundImage?: string } | null) => void;
  immersionMode?: boolean;
  onToggleImmersionMode?: () => void;
  onSpaceStateChange?: (state: {
    accentColor?: string;
    swipeKey?: string;
    swipeDirection: number;
  }) => void;
}

type PoemSort = 'newest' | 'rating';
type PoemSourceTab = 'author' | 'community' | 'weekly';

function sortPoemsList(poems: Poem[], sortBy: PoemSort): Poem[] {
  if (sortBy === 'newest') return poems;
  const originalIndex = new Map<string, number>();
  poems.forEach((p, idx) => originalIndex.set(p.id, idx));
  return [...poems].sort((a, b) => {
    const avgDiff = (b.ratingAverage || 0) - (a.ratingAverage || 0);
    if (Math.abs(avgDiff) > 0.001) return avgDiff;
    const countDiff = (b.ratingCount || 0) - (a.ratingCount || 0);
    if (countDiff !== 0) return countDiff;
    return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
  });
}

function PoemViewsIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2.25 10C4.35 6.15 7.05 4.4 10 4.4C12.95 4.4 15.65 6.15 17.75 10C15.65 13.85 12.95 15.6 10 15.6C7.05 15.6 4.35 13.85 2.25 10Z"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="10"
        cy="10"
        r="3.1"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.45"
      />
      <circle cx="10" cy="10" r="1.3" fill="currentColor" />
    </svg>
  );
}

const SWIPE_VARIANTS = {
  enter: (direction: number) => ({
    x: direction >= 0 ? 50 : -50,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction >= 0 ? -50 : 50,
    opacity: 0,
  }),
};

export const PoetrySection = memo(function PoetrySection({
  poems,
  weeklyPoems = [],
  weeklyCurrentPeriod,
  guestUser,
  getGuestToken,
  isAdmin = false,
  getAdminToken,
  onOpenAuthModal,
  onGuestUserUpdated,
  onPoemUpdated,
  onPoemViewed,
  initialPoemId,
  onActivePoemChange,
  onSurfaceStyleChange,
  immersionMode = false,
  onToggleImmersionMode,
  onSpaceStateChange,
}: PoetrySectionProps) {
  const [poemSourceTab, setPoemSourceTab] = useState<PoemSourceTab>('author');
  const [sortBy, setSortBy] = useState<PoemSort>('newest');
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [selectedWeeklyIndex, setSelectedWeeklyIndex] = useState<number>(0);
  const [swipeDirection, setSwipeDirection] = useState<number>(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [likeSubmittingId, setLikeSubmittingId] = useState<string | null>(null);
  const [likeAnimState, setLikeAnimState] = useState<{
    poemId: string;
    key: number;
    phase: 'like' | 'unlike';
  } | null>(null);
  const [pendingRating, setPendingRating] = useState<number | null>(null);
  const [ratingSubmittingId, setRatingSubmittingId] = useState<string | null>(null);
  const [ratingFeedback, setRatingFeedback] = useState<{
    poemId: string;
    text: string;
    isError?: boolean;
  } | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(Boolean(guestUser));
  const [isRatingDragging, setIsRatingDragging] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [zoomedPhotoUrl, setZoomedPhotoUrl] = useState<string | null>(null);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [loadingFullPoemId, setLoadingFullPoemId] = useState<string | null>(null);

  const viewedSessionRef = useRef<Set<string>>(new Set());
  const handledDeepLinkRef = useRef<string | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const fetchingPoemIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sortMenuOpen) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (sortMenuRef.current && e.target instanceof Node && !sortMenuRef.current.contains(e.target)) {
        setSortMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [sortMenuOpen]);

  const likedPoemSet = useMemo(() => {
    if (!guestUser) return new Set<string>();
    if (Array.isArray(guestUser.likedPoemIds)) {
      return new Set<string>(guestUser.likedPoemIds);
    }
    const set = new Set<string>();
    for (const p of poems) {
      if (p.isLiked) set.add(p.id);
    }
    return set;
  }, [guestUser, poems]);

  const authorPoems = useMemo(() => poems.filter((p) => !p.isCommunity), [poems]);
  const communityPoems = useMemo(() => poems.filter((p) => Boolean(p.isCommunity)), [poems]);

  const weeklySorted = useMemo(
    () => [...weeklyPoems].sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
    [weeklyPoems]
  );
  const safeWeeklyIndex = Math.min(selectedWeeklyIndex, Math.max(0, weeklySorted.length - 1));
  const activeWeeklyWinner = weeklySorted[safeWeeklyIndex] || null;

  const currentWeekLeaderPoem = useMemo(() => {
    const rated = communityPoems.filter((p) => p.ratingCount > 0);
    if (rated.length === 0) return null;
    return [...rated].sort((a, b) => {
      const avgDiff = (b.ratingAverage || 0) - (a.ratingAverage || 0);
      if (Math.abs(avgDiff) > 0.001) return avgDiff;
      const countDiff = (b.ratingCount || 0) - (a.ratingCount || 0);
      if (countDiff !== 0) return countDiff;
      const revDiff = b.reviews.length - a.reviews.length;
      if (revDiff !== 0) return revDiff;
      return (b.viewsCount || 0) - (a.viewsCount || 0);
    })[0];
  }, [communityPoems]);

  const activePool = useMemo(
    () => (poemSourceTab === 'author' ? authorPoems : communityPoems),
    [poemSourceTab, authorPoems, communityPoems]
  );

  const sortedPoems = useMemo(() => sortPoemsList(activePool, sortBy), [activePool, sortBy]);

  const safeIndex = Math.min(activeIndex, Math.max(0, sortedPoems.length - 1));
  const currentPoem = poemSourceTab === 'weekly' ? null : sortedPoems[safeIndex] || null;
  const activeWeeklyDisplay = poemSourceTab === 'weekly'
    ? activeWeeklyWinner || currentWeekLeaderPoem
    : null;
  const surfacePoem = poemSourceTab === 'weekly' ? activeWeeklyDisplay : currentPoem;

  const isHomeSurfaceTab = poemSourceTab === 'community' || poemSourceTab === 'weekly';

  const autoImagePalette = usePoemImagePalette(
    isHomeSurfaceTab ? undefined : surfacePoem?.imageUrl,
    isHomeSurfaceTab ? undefined : surfacePoem?.imagePalette
  );

  const hasManualBg = !isHomeSurfaceTab && Boolean(surfacePoem?.backgroundColor);
  const activeBgColor = isHomeSurfaceTab
    ? undefined
    : surfacePoem?.backgroundColor ||
      (surfacePoem?.imageUrl && autoImagePalette?.background) ||
      undefined;
  const activeBgImage = isHomeSurfaceTab
    ? undefined
    : !hasManualBg && surfacePoem?.imageUrl && autoImagePalette?.secondaryBackground
      ? `linear-gradient(150deg, ${autoImagePalette.background} 0%, ${autoImagePalette.secondaryBackground} 100%)`
      : undefined;
  const activeTextColor = isHomeSurfaceTab
    ? undefined
    : surfacePoem?.textColor ||
      (!hasManualBg && surfacePoem?.imageUrl && autoImagePalette?.text) ||
      undefined;
  const isDarkSurface = activeBgColor
    ? hasManualBg
      ? isHexColorDark(activeBgColor)
      : (autoImagePalette?.isDark ?? isHexColorDark(activeBgColor))
    : false;
  const hasCustomSurface = Boolean(activeBgColor);
  const actionIconStyle = hasCustomSurface
    ? {
        backgroundColor: isDarkSurface
          ? 'rgba(255, 255, 255, 0.14)'
          : 'rgba(0, 0, 0, 0.08)',
        color: activeTextColor || 'inherit',
      }
    : undefined;

  useEffect(() => {
    if (!onSurfaceStyleChange) return;
    if (isHomeSurfaceTab) {
      onSurfaceStyleChange({ backgroundImage: 'var(--hero-gradient)' });
    } else if (!surfacePoem || (!activeBgColor && !activeBgImage)) {
      onSurfaceStyleChange(null);
    } else {
      onSurfaceStyleChange({
        ...(activeBgColor ? { backgroundColor: activeBgColor } : {}),
        ...(activeBgImage ? { backgroundImage: activeBgImage } : {}),
      });
    }
  }, [isHomeSurfaceTab, surfacePoem, activeBgColor, activeBgImage, onSurfaceStyleChange]);

  useEffect(() => {
    onSpaceStateChange?.({
      accentColor: activeBgColor,
      swipeKey: surfacePoem?.id,
      swipeDirection,
    });
  }, [activeBgColor, surfacePoem?.id, swipeDirection, onSpaceStateChange]);

  useEffect(() => {
    return () => {
      onSurfaceStyleChange?.(null);
    };
  }, [onSurfaceStyleChange]);

  // Handle deep links (#poetry/:id)
  useEffect(() => {
    if (!initialPoemId) {
      handledDeepLinkRef.current = null;
      return;
    }
    if (handledDeepLinkRef.current === initialPoemId) return;
    const targetPoem = poems.find((p) => p.id === initialPoemId);
    if (!targetPoem) return;
    const targetTab: PoemSourceTab = targetPoem.isCommunity ? 'community' : 'author';
    const poolForTab = targetTab === 'community' ? communityPoems : authorPoems;
    const baseSorted = sortPoemsList(poolForTab, sortBy);
    const idx = baseSorted.findIndex((p) => p.id === initialPoemId);
    if (idx !== -1) {
      handledDeepLinkRef.current = initialPoemId;
      setPoemSourceTab(targetTab);
      setActiveIndex(idx);
    }
  }, [initialPoemId, poems, authorPoems, communityPoems, sortBy]);

  // Reset inline UI state when switching poems
  useEffect(() => {
    setCommentsOpen(Boolean(guestUser));
    setPendingRating(null);
    setRatingFeedback(null);
    setIsRatingDragging(false);
    setZoomedPhotoUrl(null);
  }, [surfacePoem?.id, poemSourceTab, guestUser]);

  // Track view + active dwell/exit moment when a poem becomes visible
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
        .catch(() => {
          // Ignore transient view tracking errors
        });
    }
  }, [currentPoem, onPoemViewed]);

  const hydratePoemContent = useCallback(
    async (poem: Poem, showSpinner = false): Promise<string> => {
      if (!poem.contentTruncated) return poem.content;
      if (fetchingPoemIdsRef.current.has(poem.id)) return poem.content;
      fetchingPoemIdsRef.current.add(poem.id);
      if (showSpinner) setLoadingFullPoemId(poem.id);
      try {
        const res = await fetch(`/api/poems/${encodeURIComponent(poem.id)}/read`);
        if (!res.ok) return poem.content;
        const data = (await res.json()) as { content?: string };
        if (typeof data.content === 'string') {
          onPoemUpdated({
            ...poem,
            content: data.content,
            contentTruncated: false,
          });
          return data.content;
        }
        return poem.content;
      } catch {
        return poem.content;
      } finally {
        fetchingPoemIdsRef.current.delete(poem.id);
        if (showSpinner) {
          setLoadingFullPoemId((prev) => (prev === poem.id ? null : prev));
        }
      }
    },
    [onPoemUpdated]
  );

  // Lazy-load full text of truncated poems on display and prefetch immediate neighbors
  useEffect(() => {
    if (!currentPoem) return;
    if (currentPoem.contentTruncated) {
      void hydratePoemContent(currentPoem, true);
    }
    if (sortedPoems.length > 1) {
      const nextIdx = (safeIndex + 1) % sortedPoems.length;
      const prevIdx = (safeIndex - 1 + sortedPoems.length) % sortedPoems.length;
      const nextPoem = sortedPoems[nextIdx];
      const prevPoem = sortedPoems[prevIdx];
      if (nextPoem?.contentTruncated) void hydratePoemContent(nextPoem, false);
      if (prevPoem && prevPoem.id !== nextPoem?.id && prevPoem.contentTruncated) {
        void hydratePoemContent(prevPoem, false);
      }
    }
  }, [currentPoem, safeIndex, sortedPoems, hydratePoemContent]);

  const goToIndex = useCallback(
    (nextIdx: number, dir: number) => {
      if (sortedPoems.length === 0) return;
      const wrapped = (nextIdx + sortedPoems.length) % sortedPoems.length;
      setSwipeDirection(dir);
      setActiveIndex(wrapped);
      const target = sortedPoems[wrapped];
      if (target) {
        handledDeepLinkRef.current = target.id;
        onActivePoemChange?.(target.id);
      }
    },
    [sortedPoems, onActivePoemChange]
  );

  const handleSourceTabChange = useCallback(
    (nextTab: PoemSourceTab) => {
      if (nextTab === poemSourceTab) return;
      trackClick(
        `poetry_source:${nextTab}`,
        nextTab === 'author'
          ? 'Перемикач віршів: Мої вірші'
          : nextTab === 'community'
            ? 'Перемикач віршів: Стрічка віршів'
            : 'Перемикач віршів: Вірш тижня',
        'action'
      );
      setPoemSourceTab(nextTab);
      setSwipeDirection(nextTab === 'author' ? -1 : 1);
      setActiveIndex(0);
      setSortMenuOpen(false);
      if (nextTab === 'weekly') {
        setSelectedWeeklyIndex(0);
        handledDeepLinkRef.current = null;
        onActivePoemChange?.(null);
        return;
      }
      const nextPool = nextTab === 'author' ? authorPoems : communityPoems;
      const nextSorted = sortPoemsList(nextPool, sortBy);
      const firstPoem = nextSorted[0];
      if (firstPoem) {
        handledDeepLinkRef.current = firstPoem.id;
        onActivePoemChange?.(firstPoem.id);
      } else {
        handledDeepLinkRef.current = null;
        onActivePoemChange?.(null);
      }
    },
    [poemSourceTab, authorPoems, communityPoems, sortBy, onActivePoemChange]
  );

  const handleSortChange = useCallback(
    (nextSort: PoemSort) => {
      if (nextSort === sortBy) return;
      trackClick(
        `poetry_sort:${nextSort}`,
        `Сортування віршів: ${nextSort === 'newest' ? 'Найновіші' : 'За рейтингом'}`,
        'action'
      );
      setSortBy(nextSort);
      setSwipeDirection(nextSort === 'rating' ? 1 : -1);
      setActiveIndex(0);

      const nextList = sortPoemsList(activePool, nextSort);
      const firstPoem = nextList[0];
      if (firstPoem) {
        handledDeepLinkRef.current = firstPoem.id;
        onActivePoemChange?.(firstPoem.id);
      }
    },
    [activePool, sortBy, onActivePoemChange]
  );

  const handlePrev = useCallback(() => {
    if (poemSourceTab === 'weekly') {
      if (weeklySorted.length <= 1) return;
      setSwipeDirection(-1);
      setSelectedWeeklyIndex((prev) => (prev - 1 + weeklySorted.length) % weeklySorted.length);
      return;
    }
    trackClick('action:poem_prev', 'Свайп / кнопка: Попередній вірш', 'action');
    goToIndex(safeIndex - 1, -1);
  }, [poemSourceTab, weeklySorted.length, goToIndex, safeIndex]);

  const handleNext = useCallback(() => {
    if (poemSourceTab === 'weekly') {
      if (weeklySorted.length <= 1) return;
      setSwipeDirection(1);
      setSelectedWeeklyIndex((prev) => (prev + 1) % weeklySorted.length);
      return;
    }
    trackClick('action:poem_next', 'Свайп / кнопка: Наступний вірш', 'action');
    goToIndex(safeIndex + 1, 1);
  }, [poemSourceTab, weeklySorted.length, goToIndex, safeIndex]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape' && immersionMode && !zoomedPhotoUrl && !submitModalOpen) {
        onToggleImmersionMode?.();
        return;
      }
      if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePrev, handleNext, immersionMode, zoomedPhotoUrl, submitModalOpen, onToggleImmersionMode]);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const count = poemSourceTab === 'weekly' ? weeklySorted.length : sortedPoems.length;
    if (count <= 1 || isRatingDragging) return;
    if (info.offset.x < -40 || info.velocity.x < -250) {
      handleNext();
    } else if (info.offset.x > 40 || info.velocity.x > 250) {
      handlePrev();
    }
  };

  const getPoemShareUrl = (poemId: string) =>
`${window.location.origin}${window.location.pathname}#poetry/${encodeURIComponent(poemId)}`;

  const handleCopyPoem = async (poem: Poem) => {
    trackClick(`copy_poem:${poem.id}`,`Копіювання вірша: «${poem.title}»`,'action');
    const resolvedContent = poem.contentTruncated
      ? await hydratePoemContent(poem, false)
      : poem.content;
    const authorLabel =
      poem.isCommunity && poem.authorName ? poem.authorName : 'Андрій Даньків';
    const fullText =`${poem.title}\n\n${resolvedContent}\n\n— ${authorLabel}`;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopiedId(poem.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const handleToggleLike = async (poem: Poem) => {
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    if (likeSubmittingId === poem.id) return;
    trackClick(`like_poem:${poem.id}`, `Вподобайка вірша: «${poem.title}»`, 'action');

    const prevLiked = likedPoemSet.has(poem.id);
    const nextLiked = !prevLiked;
    const prevLikedIds = Array.isArray(guestUser.likedPoemIds)
      ? guestUser.likedPoemIds
      : Array.from(likedPoemSet);
    const optimisticLikedIds = nextLiked
      ? Array.from(new Set([poem.id, ...prevLikedIds]))
      : prevLikedIds.filter((id) => id !== poem.id);
    const prevLikesCount = poem.likesCount ?? 0;
    const optimisticPoem: Poem = {
      ...poem,
      isLiked: nextLiked,
      likesCount: Math.max(0, prevLikesCount + (nextLiked ? 1 : -1)),
    };

    // Instant haptic, visual bloom & optimistic UI state
    triggerLikeHapticFeedback(nextLiked);
    setLikeAnimState((prev) => ({
      poemId: poem.id,
      key: (prev?.key ?? 0) + 1,
      phase: nextLiked ? 'like' : 'unlike',
    }));
    onPoemUpdated(optimisticPoem);
    if (onGuestUserUpdated) {
      onGuestUserUpdated({
        ...guestUser,
        likedPoemIds: optimisticLikedIds,
      });
    }

    const rollbackLike = () => {
      onPoemUpdated(poem);
      if (onGuestUserUpdated) {
        onGuestUserUpdated({
          ...guestUser,
          likedPoemIds: prevLikedIds,
        });
      }
    };

    setLikeSubmittingId(poem.id);
    try {
      let token = await getGuestToken?.();
      if (token?.startsWith('guest_v1.') && getGuestToken) {
        const refreshed = await getGuestToken(true);
        if (refreshed) token = refreshed;
      }
      if (!token) {
        rollbackLike();
        onOpenAuthModal();
        return;
      }
      let res = await fetch(`/api/poems/${encodeURIComponent(poem.id)}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401 && getGuestToken) {
        const refreshedToken = await getGuestToken(true);
        if (refreshedToken && refreshedToken !== token) {
          token = refreshedToken;
          res = await fetch(`/api/poems/${encodeURIComponent(poem.id)}/like`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          });
        }
      }
      if (res.status === 401) {
        rollbackLike();
        onOpenAuthModal();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        rollbackLike();
        setRatingFeedback({
          poemId: poem.id,
          text: data.error || 'Не вдалося оновити вподобайку.',
          isError: true,
        });
        return;
      }
      if (data.poem) {
        onPoemUpdated(data.poem);
      }
      if (Array.isArray(data.likedPoemIds) && onGuestUserUpdated) {
        onGuestUserUpdated({
          ...guestUser,
          likedPoemIds: data.likedPoemIds,
        });
      }
    } catch {
      rollbackLike();
      setRatingFeedback({
        poemId: poem.id,
        text: 'Помилка з’єднання із сервером.',
        isError: true,
      });
    } finally {
      setLikeSubmittingId(null);
    }
  };

  const handleConfirmRating = async (poem: Poem, rating: number) => {
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    if (ratingSubmittingId === poem.id || poem.userRating !== null) return;
    trackClick(`rate_poem:${poem.id}`,`Підтвердження оцінки вірша: «${poem.title}»`,'action');
    setRatingSubmittingId(poem.id);
    setRatingFeedback(null);
    try {
      const token = await getGuestToken?.();
      const response = await fetch(`/api/poems/${encodeURIComponent(poem.id)}/rate`, {
        method:'POST',
        headers: {
          'Content-Type':'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ rating }),
      });
      const data = await response.json();
      if (data.poem) {
        onPoemUpdated(data.poem);
      }
      if (!response.ok) {
        setRatingFeedback({
          poemId: poem.id,
          text: data.error ||'Не вдалося зберегти оцінку.',
          isError: !data.alreadyRated,
        });
        return;
      }
      setPendingRating(null);
      setRatingFeedback({
        poemId: poem.id,
        text:`Оцінку ${rating.toFixed(1)} підтверджено.`,
      });
    } catch {
      setRatingFeedback({
        poemId: poem.id,
        text:'Помилка з’єднання із сервером.',
        isError: true,
      });
    } finally {
      setRatingSubmittingId(null);
    }
  };

  const handleOpenSubmitModal = () => {
    trackClick('poetry:open_submit_modal', 'Кнопка: Запропонувати вірш', 'action');
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    setSubmitModalOpen(true);
  };

  const handleOpenPublishedFromModal = useCallback(
    (poemId: string) => {
      const target = poems.find((p) => p.id === poemId);
      const targetTab: PoemSourceTab = target?.isCommunity ? 'community' : 'author';
      const pool = targetTab === 'community' ? communityPoems : authorPoems;
      const nextSorted = sortPoemsList(pool, sortBy);
      const idx = nextSorted.findIndex((p) => p.id === poemId);
      setPoemSourceTab(targetTab);
      if (idx !== -1) {
        setActiveIndex(idx);
        handledDeepLinkRef.current = poemId;
        onActivePoemChange?.(poemId);
      }
    },
    [poems, authorPoems, communityPoems, sortBy, onActivePoemChange]
  );

  const renderImmersionIcon = (floating: boolean) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`relative z-10 w-[18px] h-[18px] transition-transform duration-300 ${
        floating ? '' : 'group-hover:scale-110'
      }`}
    >
      <circle cx="12" cy="12" r="8.25" strokeOpacity={floating ? 0.55 : 0.45} strokeDasharray="3.2 2.8" />
      <circle
        cx="12"
        cy="12"
        r="5"
        className={floating ? '' : 'fill-[#38BDF8]/20'}
      />
    </svg>
  );

  const handleToggleImmersionClick = () => {
    trackClick(
      immersionMode ? 'poetry:immersion_off' : 'poetry:immersion_on',
      immersionMode ? 'Вихід із занурення в простір' : 'Занурення в простір вірша',
      'action'
    );
    setSortMenuOpen(false);
    onToggleImmersionMode?.();
  };

  return (
    <section id="poetry">
      {/* Immersion Toggle (slowly appears borderless & translucent when immersed) */}
      <AnimatePresence>
        {immersionMode && (
          <m.button
            key="poetry-immersion-floating"
            type="button"
            initial={{ opacity: 0 }}
            animate={{
              opacity: 0.42,
              transition: { duration: 1.8, delay: 0.45, ease: [0.22, 1, 0.36, 1] },
            }}
            exit={{
              opacity: 0,
              transition: { duration: 0.45, ease: [0.4, 0, 0.2, 1] },
            }}
            whileHover={{ opacity: 0.85, transition: { duration: 0.2 } }}
            whileFocus={{ opacity: 0.85, transition: { duration: 0.2 } }}
            onClick={handleToggleImmersionClick}
            aria-pressed={immersionMode}
            aria-label="Вийти із занурення в простір"
            title="Повернути елементи керування"
            className="fixed top-4 right-4 sm:top-6 sm:right-6 z-50 inline-flex items-center justify-center w-10 h-10 bg-transparent border-0 shadow-none ring-0 p-0 text-cream active:scale-[0.94] cursor-pointer"
          >
            {renderImmersionIcon(true)}
          </m.button>
        )}
      </AnimatePresence>

      {/* Top Switcher & Controls Bar (slowly dims out when entering immersion) */}
      <AnimatePresence initial={false}>
        {!immersionMode && (
          <m.div
            key="poetry-top-controls"
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              height: 'auto',
              marginBottom: 16,
              transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] },
            }}
            exit={{
              opacity: 0,
              height: 0,
              marginBottom: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
              transition: {
                opacity: { duration: 1.4, ease: [0.22, 1, 0.36, 1] },
                height: { duration: 0.9, delay: 0.55, ease: [0.22, 1, 0.36, 1] },
                marginBottom: { duration: 0.9, delay: 0.55, ease: [0.22, 1, 0.36, 1] },
              },
            }}
            className="mb-4 flex items-center justify-between gap-2"
          >
          <div
            role="tablist"
            aria-label="Джерело віршів"
            className="inline-flex items-center gap-0.5 sm:gap-1 p-1 rounded-xl bg-paper-sand dark:bg-night-card min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <button
              type="button"
              role="tab"
              aria-selected={poemSourceTab === 'author'}
              onClick={() => handleSourceTabChange('author')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                poemSourceTab === 'author'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-2xs'
                  : 'text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream'
              }`}
            >
              <span>Мої вірші</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={poemSourceTab === 'community'}
              onClick={() => handleSourceTabChange('community')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                poemSourceTab === 'community'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-2xs'
                  : 'text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream'
              }`}
            >
              <span>Стрічка</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={poemSourceTab === 'weekly'}
              onClick={() => handleSourceTabChange('weekly')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                poemSourceTab === 'weekly'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-2xs'
                  : 'text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream'
              }`}
            >
              <span>Вірш тижня</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleOpenSubmitModal}
              title="Запропонувати вірш"
              aria-label="Запропонувати вірш"
              className="w-10 h-10 inline-flex items-center justify-center rounded-xl bg-paper-sand dark:bg-night-card hover:bg-paper-sand dark:hover:bg-night-elevated text-ink dark:text-cream active:scale-[0.95] transition-all cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4 text-pine dark:text-silver shrink-0" strokeWidth={1.85} />
            </button>

            <button
              type="button"
              onClick={handleToggleImmersionClick}
              aria-pressed={immersionMode}
              aria-label="Занурення в простір"
              title="Занурення в простір"
              className="group relative overflow-hidden touch-surface inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[linear-gradient(135deg,#071226_0%,#0F1F44_52%,#1D1442_100%)] text-[#BAE6FD] shadow-[0_6px_16px_-6px_rgba(7,18,38,0.8),0_0_14px_-4px_rgba(56,189,248,0.38),inset_0_1px_0_rgba(255,255,255,0.18)] hover:shadow-[0_8px_20px_-6px_rgba(7,18,38,0.92),0_0_20px_-2px_rgba(125,211,252,0.58),inset_0_1px_0_rgba(255,255,255,0.28)] hover:scale-105 active:scale-[0.94] transition-all duration-200 shrink-0 cursor-pointer"
            >
              <span
                aria-hidden="true"
                style={{
                  background: 'radial-gradient(circle, rgba(56, 189, 248, 0.34) 0%, transparent 72%)',
                }}
                className="pointer-events-none absolute -left-2 -top-2 w-8 h-8 rounded-full opacity-85 group-hover:opacity-100 transition-opacity duration-300"
              />
              <span
                aria-hidden="true"
                style={{
                  background: 'radial-gradient(circle, rgba(129, 140, 248, 0.3) 0%, transparent 72%)',
                }}
                className="pointer-events-none absolute -right-2 -bottom-2 w-8 h-8 rounded-full opacity-85 group-hover:opacity-100 transition-opacity duration-300"
              />
              <svg
                aria-hidden="true"
                viewBox="0 0 40 40"
                fill="none"
                className="pointer-events-none absolute inset-0 w-full h-full opacity-80 group-hover:opacity-100 transition-opacity duration-300"
              >
                <circle cx="8" cy="10" r="0.65" fill="#E0F2FE" opacity="0.8" />
                <circle cx="32" cy="9" r="0.8" fill="#FDE68A" opacity="0.85" className="animate-pulse" />
                <circle cx="10" cy="31" r="0.6" fill="#A5B4FC" opacity="0.7" />
                <circle cx="31" cy="31" r="0.7" fill="#7DD3FC" opacity="0.75" />
              </svg>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/15 to-transparent"
              />
              {renderImmersionIcon(false)}
            </button>
          </div>
        </m.div>
      )}
      </AnimatePresence>

      {poemSourceTab === 'weekly' ? (
        activeWeeklyWinner || currentWeekLeaderPoem ? (
          (() => {
            const snapshot = activeWeeklyWinner;
            const item = snapshot || currentWeekLeaderPoem!;
            const isFixedSnapshot = Boolean(snapshot);
            const periodText = snapshot
              ? snapshot.periodLabel
              : weeklyCurrentPeriod?.periodLabel || 'Поточний тиждень';
            const authorLabel = item.authorName || 'Читач';
            const sourceStillExists = snapshot?.sourcePoemId
              ? poems.some((p) => p.id === snapshot.sourcePoemId)
              : Boolean(currentWeekLeaderPoem);
            const targetLinkId = snapshot?.sourcePoemId || currentWeekLeaderPoem?.id || '';
            const scList =
              item.soundcloudTracks && item.soundcloudTracks.length > 0
                ? item.soundcloudTracks
                : item.soundcloudTrack
                  ? [item.soundcloudTrack]
                  : [];

            return (
              <m.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-visible"
              >
                <AnimatePresence mode="wait" custom={swipeDirection} initial={false}>
                  <m.article
                    key={item.id}
                    custom={swipeDirection}
                    variants={SWIPE_VARIANTS}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    drag={isFixedSnapshot && weeklySorted.length > 1 ? 'x' : false}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.22}
                    dragDirectionLock
                    onDragEnd={handleDragEnd}
                    style={
                      immersionMode
                        ? { color: '#F4F1EA' }
                        : activeTextColor
                          ? { color: activeTextColor }
                          : undefined
                    }
                    className={`rounded-2xl select-text will-change-transform transition-all duration-[2000ms] ease-out ${
                      isFixedSnapshot && weeklySorted.length > 1
                        ? 'cursor-grab active:cursor-grabbing'
                        : ''
                    } ${
                      immersionMode
                        ? 'bg-transparent min-h-[calc(100dvh-6rem)] flex flex-col justify-center px-2 sm:px-8 md:px-10 py-10'
                        : `perf-card p-6 sm:p-8 md:p-10 ${
                            hasCustomSurface
                              ? 'bg-transparent'
                              : isHomeSurfaceTab
                                ? 'bg-white dark:bg-night-lift shadow-[0_18px_42px_-22px_rgba(24,48,33,0.28)] dark:shadow-[0_20px_46px_-20px_rgba(0,0,0,0.82)]'
                                : 'bg-white dark:bg-night-card'
                          }`
                    }`}
                  >
                    <AnimatePresence initial={false}>
                      {!immersionMode && item.imageUrl && (
                        <m.div
                          key="weekly-poem-photo"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1, height: 'auto', marginBottom: 24, transition: { duration: 0.5 } }}
                          exit={{
                            opacity: 0,
                            height: 0,
                            marginBottom: 0,
                            overflow: 'hidden',
                            pointerEvents: 'none',
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="mb-6 cursor-auto w-screen relative left-1/2 -translate-x-1/2"
                        >
                          <button
                            type="button"
                            onClick={() => setZoomedPhotoUrl(item.imageUrl || null)}
                            aria-label={`Переглянути фото до вірша «${item.title}»`}
                            className="group relative block w-full overflow-hidden bg-black/10 cursor-zoom-in shadow-[0_12px_30px_-14px_rgba(0,0,0,0.42)]"
                          >
                            <img
                              src={item.imageUrl}
                              alt={item.title}
                              width={800}
                              height={500}
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              className="w-full aspect-[16/10] max-h-[480px] object-cover mx-auto block transition-transform duration-300 group-hover:scale-[1.01]"
                            />
                            <span className="absolute right-3 bottom-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/72 text-white text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                              <ZoomIn className="w-3.5 h-3.5" />
                              <span>Переглянути</span>
                            </span>
                          </button>
                        </m.div>
                      )}
                    </AnimatePresence>

                    <div
                      className={`${
                        immersionMode
                          ? 'my-auto py-4 max-w-[58ch] w-full mx-auto'
                          : `${item.imageUrl ? 'pt-1 sm:pt-2' : 'pt-4 sm:pt-5'} pb-3 sm:pb-4 max-w-[58ch]`
                      }`}
                    >
                      {!immersionMode && (
                        <div
                          style={
                            activeTextColor
                              ? { color: activeTextColor, borderColor: isDarkSurface ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.1)' }
                              : undefined
                          }
                          className={`mb-5 pb-3.5 border-b flex flex-wrap items-center justify-between gap-3 ${
                            activeTextColor ? '' : 'border-paper-sand dark:border-night-elevated'
                          }`}
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div
                              style={activeTextColor ? { color: activeTextColor } : undefined}
                              className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                                activeTextColor ? '' : 'text-pine dark:text-[#BCD369]'
                              }`}
                            >
                              <Award className="w-3.5 h-3.5 shrink-0" strokeWidth={1.9} />
                              <span>
                                {isFixedSnapshot
                                  ? 'Вірш тижня · за підсумками оцінок'
                                  : 'Поточний тиждень · проміжний лідер'}
                              </span>
                            </div>
                            <p
                              style={activeTextColor ? { color: activeTextColor, opacity: 0.78 } : undefined}
                              className={`text-xs font-mono tabular-nums ${
                                activeTextColor ? '' : 'text-ink-muted dark:text-sandstone-light'
                              }`}
                            >
                              Період: {periodText}
                            </p>
                          </div>

                          {isFixedSnapshot && weeklySorted.length > 1 && (
                            <div className="inline-flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={handlePrev}
                                aria-label="Попередній тиждень"
                                style={hasCustomSurface ? actionIconStyle : undefined}
                                className="btn-editorial-icon w-9 h-9"
                              >
                                <ChevronLeft className="w-4 h-4" />
                              </button>
                              <span
                                style={activeTextColor ? { color: activeTextColor, opacity: 0.8 } : undefined}
                                className={`px-1.5 text-[11px] font-mono tabular-nums ${
                                  activeTextColor ? '' : 'text-ink-muted dark:text-sandstone-light'
                                }`}
                              >
                                {safeWeeklyIndex + 1}/{weeklySorted.length}
                              </span>
                              <button
                                type="button"
                                onClick={handleNext}
                                aria-label="Наступний тиждень"
                                style={hasCustomSurface ? actionIconStyle : undefined}
                                className="btn-editorial-icon w-9 h-9"
                              >
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      <div
                        style={
                          immersionMode
                            ? { color: '#F4F1EA', opacity: 0.78 }
                            : activeTextColor
                              ? { color: activeTextColor, opacity: 0.86 }
                              : undefined
                        }
                        className={`mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-medium ${
                          immersionMode || activeTextColor ? '' : 'text-ink-muted dark:text-sandstone-light'
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          {!immersionMode && item.authorPhotoUrl && (
                            <img
                              src={item.authorPhotoUrl}
                              alt={authorLabel}
                              width={20}
                              height={20}
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              className="w-5 h-5 rounded-full object-cover shrink-0"
                            />
                          )}
                          <span>{authorLabel}</span>
                          {item.cycle &&
                            item.cycle !== 'Вірші читачів' &&
                            item.cycle !== 'Стрічка віршів' && (
                              <span className="opacity-70">· {item.cycle}</span>
                            )}
                        </span>

                        {item.ratingCount > 0 && (
                          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                            <Star className="w-3.5 h-3.5 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                            <strong
                              style={activeTextColor ? { color: activeTextColor } : undefined}
                              className={activeTextColor ? 'font-semibold' : 'text-ink dark:text-cream font-semibold'}
                            >
                              {item.ratingAverage.toFixed(1)}
                            </strong>
                            <span className="opacity-75">({item.ratingCount})</span>
                          </span>
                        )}
                      </div>

                      <h2
                        style={
                          immersionMode
                            ? { color: '#F4F1EA' }
                            : activeTextColor
                              ? { color: activeTextColor }
                              : undefined
                        }
                        className={`text-2xl md:text-[30px] font-semibold tracking-[-0.02em] leading-[1.2] mb-5 ${
                          immersionMode || activeTextColor ? '' : 'text-ink dark:text-cream'
                        }`}
                      >
                        {item.title}
                      </h2>

                      <div
                        style={
                          immersionMode
                            ? { color: '#EAE6DC' }
                            : activeTextColor
                              ? { color: activeTextColor }
                              : undefined
                        }
                        className={`whitespace-pre-wrap ${
                          immersionMode || activeTextColor ? '' : 'text-ink dark:text-[#E5E2DA]'
                        } ${
                          item.fontSize === 'sm'
                            ? 'text-sm md:text-base'
                            : item.fontSize === 'base'
                              ? 'text-base md:text-lg'
                              : item.fontSize === 'xl'
                                ? 'text-lg md:text-xl'
                                : item.fontSize === '2xl'
                                  ? 'text-xl md:text-2xl'
                                  : 'text-[17px] md:text-[18px]'
                        } ${
                          item.textAlign === 'center'
                            ? 'text-center'
                            : item.textAlign === 'right'
                              ? 'text-right'
                              : 'text-left'
                        } ${
                          item.lineSpacing === 'tight'
                            ? 'leading-snug'
                            : item.lineSpacing === 'normal'
                              ? 'leading-normal'
                              : item.lineSpacing === 'loose'
                                ? 'leading-[2.1]'
                                : 'leading-[1.75]'
                        }`}
                      >
                        {item.content}
                      </div>

                      {item.note && (
                        <p
                          style={
                            immersionMode
                              ? { color: '#EAE6DC', opacity: 0.72 }
                              : activeTextColor
                                ? { color: activeTextColor, opacity: 0.82 }
                                : undefined
                          }
                          className={`italic text-sm mt-6 ${
                            immersionMode || activeTextColor ? '' : 'text-ink-muted dark:text-sandstone-light'
                          } ${
                            item.textAlign === 'center'
                              ? 'text-center'
                              : item.textAlign === 'right'
                                ? 'text-right'
                                : 'text-left'
                          }`}
                        >
                          {item.note}
                        </p>
                      )}
                    </div>

                    {!immersionMode && (
                      <div className="pt-4 space-y-4">
                        {scList.length > 0 && (
                          <PoemSoundCloudPlayer
                            tracks={scList}
                            hasCustomBackground={hasCustomSurface}
                            isDarkBackground={isDarkSurface}
                            textColor={activeTextColor}
                          />
                        )}

                        {!isFixedSnapshot && (
                          <p
                            style={activeTextColor ? { color: activeTextColor, opacity: 0.78 } : undefined}
                            className={`text-xs leading-relaxed ${
                              activeTextColor ? '' : 'text-ink-muted dark:text-sandstone-light'
                            }`}
                          >
                            Наприкінці тижня ({periodText}) вірш із найвищою оцінкою зі Стрічки буде автоматично скопійовано та зафіксовано тут.
                          </p>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                const text = `${item.title}\n\n${item.content}\n\n— ${authorLabel} (${periodText})`;
                                try {
                                  await navigator.clipboard.writeText(text);
                                  setCopiedId(item.id);
                                  setTimeout(() => setCopiedId(null), 2000);
                                } catch {
                                  // Ignore clipboard errors
                                }
                              }}
                              title={copiedId === item.id ? 'Скопійовано' : 'Скопіювати вірш'}
                              aria-label="Скопіювати вірш"
                              style={copiedId !== item.id && hasCustomSurface ? actionIconStyle : undefined}
                              className={`btn-editorial-icon ${
                                copiedId === item.id
                                  ? 'bg-emerald-50 dark:bg-night-elevated text-emerald-800 dark:text-silver'
                                  : ''
                              }`}
                            >
                              {copiedId === item.id ? (
                                <Check className="w-4 h-4" strokeWidth={1.85} />
                              ) : (
                                <Copy className="w-4 h-4" strokeWidth={1.75} />
                              )}
                            </button>

                            <ShareButton
                              title={`${item.title} — ${authorLabel}`}
                              text={`«${item.title}» (${periodText}) — ${authorLabel}`}
                              url={targetLinkId ? getPoemShareUrl(targetLinkId) : window.location.href}
                              variant="icon"
                              iconStyle={actionIconStyle}
                            />
                          </div>

                          {sourceStillExists && targetLinkId && (
                            <button
                              type="button"
                              onClick={() => handleOpenPublishedFromModal(targetLinkId)}
                              style={activeTextColor ? { color: activeTextColor } : undefined}
                              className={`text-xs font-medium underline underline-offset-4 opacity-85 hover:opacity-100 transition-opacity cursor-pointer ${
                                activeTextColor ? '' : 'text-pine dark:text-silver'
                              }`}
                            >
                              {isFixedSnapshot ? 'До вірша в Стрічці' : 'Оцінити в Стрічці'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </m.article>
                </AnimatePresence>
              </m.div>
            );
          })()
        ) : (
          <div className="perf-card rounded-2xl p-6 sm:p-10 bg-white dark:bg-night-lift shadow-[0_18px_42px_-22px_rgba(24,48,33,0.28)] dark:shadow-[0_20px_46px_-20px_rgba(0,0,0,0.82)] text-center space-y-3">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-paper-sand dark:bg-night-elevated text-pine dark:text-[#BCD369] mx-auto">
              <Award className="w-5 h-5" strokeWidth={1.8} />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold text-ink dark:text-cream">
              Вірш тижня ще формується
            </h3>
            {weeklyCurrentPeriod?.periodLabel && (
              <p className="text-xs font-mono text-ink-muted dark:text-sandstone-light tabular-nums">
                Період: {weeklyCurrentPeriod.periodLabel}
              </p>
            )}
            <p className="text-sm text-ink-muted dark:text-sandstone-light max-w-md mx-auto leading-relaxed">
              Щопонеділка найкращий вірш зі Стрічки за підсумками оцінок читачів автоматично копіюється та фіксується у цьому вікні.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => handleSourceTabChange('community')}
                className="btn-editorial-primary min-h-[42px] px-5 py-2.5 text-xs font-semibold justify-center"
              >
                Перейти до Стрічки
              </button>
            </div>
          </div>
        )
      ) : (
        <>
          {sortedPoems.length === 0 && (
            <EmptySectionState
              className={immersionMode ? 'min-h-[calc(100dvh-6rem)] justify-center' : ''}
            />
          )}

      {currentPoem && (
        <m.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-visible"
        >
          <AnimatePresence mode="wait" custom={swipeDirection} initial={false}>
            <m.article
              key={currentPoem.id}
              custom={swipeDirection}
              variants={SWIPE_VARIANTS}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              drag={sortedPoems.length > 1 && !isRatingDragging ? 'x' : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.22}
              dragDirectionLock
              onDragEnd={handleDragEnd}
              style={
                immersionMode
                  ? { color: '#F4F1EA' }
                  : activeTextColor
                    ? { color: activeTextColor }
                    : undefined
              }
              className={`rounded-2xl cursor-grab active:cursor-grabbing select-text will-change-transform transition-all duration-[2000ms] ease-out ${
                immersionMode
                  ? 'bg-transparent min-h-[calc(100dvh-6rem)] flex flex-col justify-center px-2 sm:px-8 md:px-10 py-10'
                  : `perf-card p-6 sm:p-8 md:p-10 ${
                      hasCustomSurface
                        ? 'bg-transparent'
                        : isHomeSurfaceTab
                          ? 'bg-white dark:bg-night-lift shadow-[0_18px_42px_-22px_rgba(24,48,33,0.28)] dark:shadow-[0_20px_46px_-20px_rgba(0,0,0,0.82)]'
                          : 'bg-white dark:bg-night-card'
                    }`
              }`}
            >
              {/* Poem Photo (slowly dims out during space immersion) */}
              <AnimatePresence initial={false}>
                {!immersionMode && currentPoem.imageUrl && (
                  <m.div
                    key="poem-photo"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginBottom: 24, transition: { duration: 0.5 } }}
                    exit={{
                      opacity: 0,
                      height: 0,
                      marginBottom: 0,
                      overflow: 'hidden',
                      pointerEvents: 'none',
                      transition: {
                        opacity: { duration: 1.4, ease: [0.22, 1, 0.36, 1] },
                        height: { duration: 0.9, delay: 0.5, ease: [0.22, 1, 0.36, 1] },
                        marginBottom: { duration: 0.9, delay: 0.5, ease: [0.22, 1, 0.36, 1] },
                      },
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="mb-6 cursor-auto w-screen relative left-1/2 -translate-x-1/2"
                  >
                    <button
                      type="button"
                      onClick={() => setZoomedPhotoUrl(currentPoem.imageUrl || null)}
                      aria-label={`Переглянути фото до вірша «${currentPoem.title}»`}
                      className="group relative block w-full overflow-hidden bg-black/10 cursor-zoom-in shadow-[0_12px_30px_-14px_rgba(0,0,0,0.42)]"
                    >
                      <img
                        src={currentPoem.imageUrl}
                        alt={currentPoem.title}
                        width={800}
                        height={500}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="w-full aspect-[16/10] max-h-[480px] object-cover mx-auto block transition-transform duration-300 group-hover:scale-[1.01]"
                      />
                      <span className="absolute right-3 bottom-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/72 text-white text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                        <ZoomIn className="w-3.5 h-3.5" />
                        <span>Переглянути</span>
                      </span>
                    </button>
                  </m.div>
                )}
              </AnimatePresence>

              {/* Poem Title & Body */}
              <div
                className={`${
                  immersionMode
                    ? 'my-auto py-4 max-w-[58ch] w-full mx-auto'
                    : `${currentPoem.imageUrl ? 'pt-1 sm:pt-2' : 'pt-7 sm:pt-8'} pb-3 sm:pb-4 max-w-[58ch]`
                }`}
              >
                {(currentPoem.isCommunity || currentPoem.workStatus) && (
                  <div
                    style={
                      immersionMode
                        ? { color: '#F4F1EA', opacity: 0.72 }
                        : activeTextColor
                          ? { color: activeTextColor, opacity: 0.86 }
                          : undefined
                    }
                    className={`mb-3 flex flex-wrap items-center gap-2 text-xs font-medium ${
                      immersionMode || activeTextColor ? '' : 'text-ink-muted dark:text-sandstone-light'
                    }`}
                  >
                    {currentPoem.isCommunity && (
                      <span className="inline-flex items-center gap-2">
                        {!immersionMode && currentPoem.authorPhotoUrl && (
                          <img
                            src={currentPoem.authorPhotoUrl}
                            alt={currentPoem.authorName || 'Читач'}
                            width={20}
                            height={20}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            className="w-5 h-5 rounded-full object-cover shrink-0"
                          />
                        )}
                        <span>{currentPoem.authorName || 'Читач'}</span>
                        {currentPoem.cycle &&
                          currentPoem.cycle !== 'Вірші читачів' &&
                          currentPoem.cycle !== 'Стрічка віршів' && (
                            <span className="opacity-70">· {currentPoem.cycle}</span>
                          )}
                      </span>
                    )}
                    {currentPoem.workStatus && (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                          currentPoem.workStatus === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {currentPoem.workStatus === 'completed' ? 'Закінчено' : 'У процесі'}
                      </span>
                    )}
                  </div>
                )}

                <h2
                  style={
                    immersionMode
                      ? { color: '#F4F1EA' }
                      : activeTextColor
                        ? { color: activeTextColor }
                        : undefined
                  }
                  className={`text-2xl md:text-[30px] font-semibold tracking-[-0.02em] leading-[1.2] mb-5 ${
                    immersionMode || activeTextColor ? '' : 'text-ink dark:text-cream'
                  }`}
                >
                  {currentPoem.title}
                </h2>

                <div
                  style={
                    immersionMode
                      ? { color: '#EAE6DC' }
                      : activeTextColor
                        ? { color: activeTextColor }
                        : undefined
                  }
                  className={`whitespace-pre-wrap ${
                    immersionMode || activeTextColor ? '' : 'text-ink dark:text-[#E5E2DA]'
                  } ${
                    currentPoem.fontSize === 'sm'
                      ? 'text-sm md:text-base'
                      : currentPoem.fontSize === 'base'
                        ? 'text-base md:text-lg'
                        : currentPoem.fontSize === 'xl'
                          ? 'text-lg md:text-xl'
                          : currentPoem.fontSize === '2xl'
                            ? 'text-xl md:text-2xl'
                            : 'text-[17px] md:text-[18px]'
                  } ${
                    currentPoem.textAlign === 'center'
                      ? 'text-center'
                      : currentPoem.textAlign === 'right'
                        ? 'text-right'
                        : 'text-left'
                  } ${
                    currentPoem.lineSpacing === 'tight'
                      ? 'leading-snug'
                      : currentPoem.lineSpacing === 'normal'
                        ? 'leading-normal'
                        : currentPoem.lineSpacing === 'loose'
                          ? 'leading-[2.1]'
                          : 'leading-[1.75]'
                  }`}
                >
                  {currentPoem.content}
                </div>

                {loadingFullPoemId === currentPoem.id && currentPoem.contentTruncated && (
                  <p className="mt-3 text-xs opacity-70 animate-pulse">
                    Завантаження повного тексту...
                  </p>
                )}

                {currentPoem.note && (
                  <p
                    style={
                      immersionMode
                        ? { color: '#EAE6DC', opacity: 0.72 }
                        : activeTextColor
                          ? { color: activeTextColor, opacity: 0.82 }
                          : undefined
                    }
                    className={`italic text-sm mt-6 ${
                      immersionMode || activeTextColor ? '' : 'text-ink-muted dark:text-sandstone-light'
                    } ${
                      currentPoem.textAlign === 'center'
                        ? 'text-center'
                        : currentPoem.textAlign === 'right'
                          ? 'text-right'
                          : 'text-left'
                    }`}
                  >
                    {currentPoem.note}
                  </p>
                )}
              </div>

              {/* Integrated Views + Direct Inline Rating (slowly dims out during space immersion) */}
              <AnimatePresence initial={false}>
              {!immersionMode && (
              <m.div
                key="poem-interactive-footer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, height: 'auto', transition: { duration: 0.5 } }}
                exit={{
                  opacity: 0,
                  height: 0,
                  overflow: 'hidden',
                  pointerEvents: 'none',
                  transition: {
                    opacity: { duration: 1.4, ease: [0.22, 1, 0.36, 1] },
                    height: { duration: 0.9, delay: 0.45, ease: [0.22, 1, 0.36, 1] },
                  },
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="-mx-6 sm:-mx-8 md:-mx-10 px-6 sm:px-8 md:px-10 -mb-6 sm:-mb-8 md:-mb-10 pb-6 sm:pb-8 md:pb-10 cursor-auto"
              >
                <div className="pt-4 space-y-4">
                  {/* SoundCloud Song Player (if attached) */}
                  {((currentPoem.soundcloudTracks && currentPoem.soundcloudTracks.length > 0) ||
                    currentPoem.soundcloudTrack) && (
                    <PoemSoundCloudPlayer
                      tracks={
                        currentPoem.soundcloudTracks && currentPoem.soundcloudTracks.length > 0
                          ? currentPoem.soundcloudTracks
                          : currentPoem.soundcloudTrack
                            ? [currentPoem.soundcloudTrack]
                            : []
                      }
                      hasCustomBackground={hasCustomSurface}
                      isDarkBackground={isDarkSurface}
                      textColor={activeTextColor}
                    />
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2.5 py-1">
                  {/* Direct Rating Integrated Inside the Poem (authorized) OR Sign-in Notice (guests) */}
                  {guestUser ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <SwipeStarRating
                        value={pendingRating ?? currentPoem.userRating ?? currentPoem.ratingAverage}
                        onChange={(val) => {
                          setPendingRating(val);
                          setRatingFeedback(null);
                        }}
                        onDraggingChange={setIsRatingDragging}
                        locked={currentPoem.userRating !== null || ratingSubmittingId === currentPoem.id}
                        size="sm"
                        showValue="active"
                        ariaLabel={`Оцінити вірш «${currentPoem.title}» від 0.1 до 5.0`}
                      />

                      <div
                        style={activeTextColor ? { color: activeTextColor, opacity: 0.85 } : undefined}
                        className={`flex items-center gap-2 text-xs font-mono tabular-nums ${
                          activeTextColor ? '' : 'text-ink-muted dark:text-sandstone-light'
                        }`}
                      >
                        {pendingRating !== null && currentPoem.userRating === null ? (
                          <span
                            style={activeTextColor ? { color: activeTextColor } : undefined}
                            className={`font-semibold ${activeTextColor ? '' : 'text-pine dark:text-silver'}`}
                          >
                            Обрано · {pendingRating.toFixed(1)} / 5.0
                          </span>
                        ) : currentPoem.ratingCount > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Star className="w-3 h-3 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                            <strong
                              style={activeTextColor ? { color: activeTextColor } : undefined}
                              className={`font-semibold ${activeTextColor ? '' : 'text-ink dark:text-cream'}`}
                            >
                              {currentPoem.ratingAverage.toFixed(1)}
                            </strong>
                            <span>({currentPoem.ratingCount})</span>
                          </span>
                        ) : (
                          <span>Оцінити</span>
                        )}

                        {currentPoem.userRating !== null && (
                          <>
                            <span aria-hidden="true" className="opacity-50">·</span>
                            <span
                              style={activeTextColor ? { color: activeTextColor } : undefined}
                              className={`font-medium ${activeTextColor ? '' : 'text-pine-deep dark:text-silver'}`}
                            >
                              Ваша: {currentPoem.userRating.toFixed(1)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 min-h-[24px]">
                      {currentPoem.ratingCount > 0 && (
                        <span
                          style={activeTextColor ? { color: activeTextColor, opacity: 0.88 } : undefined}
                          className={`inline-flex items-center gap-1 text-xs font-mono tabular-nums ${
                            activeTextColor ? '' : 'text-ink-muted dark:text-sandstone-light'
                          }`}
                        >
                          <Star className="w-3.5 h-3.5 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                          <strong
                            style={activeTextColor ? { color: activeTextColor } : undefined}
                            className={activeTextColor ? 'font-semibold' : 'text-ink dark:text-cream font-semibold'}
                          >
                            {currentPoem.ratingAverage.toFixed(1)}
                          </strong>
                          <span style={activeTextColor ? { color: activeTextColor, opacity: 0.75 } : undefined}>
                            ({currentPoem.ratingCount})
                          </span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Views Badge Aligned With Rating */}
                  <div
                    style={
                      hasCustomSurface
                        ? actionIconStyle
                        : undefined
                    }
                    className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl font-mono text-xs font-medium tabular-nums select-none shrink-0 ${
                      hasCustomSurface
                        ? ''
                        : 'bg-paper-warm dark:bg-night-surface text-ink/80 dark:text-cream/85'
                    }`}
                    title="Кількість переглядів"
                    aria-label={`Переглядів: ${currentPoem.viewsCount}`}
                  >
                    <PoemViewsIcon className="w-3.5 h-3.5 shrink-0 opacity-85" />
                    <span>{currentPoem.viewsCount}</span>
                  </div>
                </div>



                {ratingFeedback?.poemId === currentPoem.id && (
                  <p
                    className={`text-xs font-medium ${
                      ratingFeedback.isError
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-pine-deep dark:text-silver'
                    }`}
                  >
                    {ratingFeedback.text}
                  </p>
                )}

                {/* Bottom Action & Pagination Strip */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {(() => {
                      const isCurrentLiked = Boolean(
                        guestUser && likedPoemSet.has(currentPoem.id)
                      );
                      const label = guestUser
                        ? isCurrentLiked
                          ? 'Прибрати зі Вподобайок'
                          : 'Додати до Вподобайок'
                        : 'Увійдіть, щоб додати до Вподобайок';
                      const animForPoem =
                        likeAnimState?.poemId === currentPoem.id ? likeAnimState : null;
                      return (
                        <button
                          type="button"
                          data-haptic-like="true"
                          aria-busy={likeSubmittingId === currentPoem.id}
                          onClick={() => handleToggleLike(currentPoem)}
                          aria-pressed={isCurrentLiked}
                          aria-label={label}
                          style={
                            !isCurrentLiked && hasCustomSurface
                              ? actionIconStyle
                              : undefined
                          }
                          title={label}
                          className={`btn-editorial-icon relative overflow-visible ${
                            isCurrentLiked
                              ? 'bg-rose-500/15 dark:bg-rose-400/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/25 dark:hover:bg-rose-400/30 hover:text-rose-700 dark:hover:text-rose-300'
                              : ''
                          }`}
                        >
                          <HeartBloomIcon
                            liked={isCurrentLiked}
                            bloomKey={animForPoem?.key ?? 0}
                            phase={animForPoem?.phase ?? 'idle'}
                            className="w-4 h-4"
                            strokeWidth={1.8}
                          />
                        </button>
                      );
                    })()}

                    <button
                      type="button"
                      onClick={() => handleCopyPoem(currentPoem)}
                      title={copiedId === currentPoem.id ? 'Скопійовано' : 'Скопіювати вірш'}
                      aria-label="Скопіювати вірш"
                      style={
                        copiedId !== currentPoem.id && hasCustomSurface
                          ? actionIconStyle
                          : undefined
                      }
                      className={`btn-editorial-icon ${
                        copiedId === currentPoem.id
                          ? 'bg-emerald-50 dark:bg-night-elevated text-emerald-800 dark:text-silver hover:bg-emerald-100 dark:hover:bg-night-muted hover:text-emerald-900 dark:hover:text-[#FFFFFF]'
                          : ''
                      }`}
                    >
                      {copiedId === currentPoem.id ? (
                        <Check className="w-4 h-4" strokeWidth={1.85} />
                      ) : (
                        <Copy className="w-4 h-4" strokeWidth={1.75} />
                      )}
                    </button>

                    <ShareButton
                      title={`${currentPoem.title} — ${
                        currentPoem.isCommunity && currentPoem.authorName
                          ? currentPoem.authorName
                          : 'Андрій Даньків'
                      }`}
                      text={`«${currentPoem.title}» — вірш ${
                        currentPoem.isCommunity && currentPoem.authorName
                          ? currentPoem.authorName
                          : 'Андрія Даньківа'
                      }`}
                      url={getPoemShareUrl(currentPoem.id)}
                      variant="icon"
                      iconStyle={actionIconStyle}
                    />

                    <button
                      type="button"
                      onClick={() => setCommentsOpen((prev) => !prev)}
                      aria-expanded={commentsOpen}
                      title="Відгуки"
                      aria-label="Відгуки"
                      style={actionIconStyle}
                      className={`btn-editorial-icon ${
                        hasCustomSurface ? 'hover:opacity-95' : ''
                      }`}
                    >
                      <MessageSquare className="w-4 h-4" strokeWidth={1.75} />
                    </button>

                    {sortedPoems.length > 0 && (
                      <div ref={sortMenuRef} className="relative">
                        <button
                          type="button"
                          aria-haspopup="listbox"
                          aria-expanded={sortMenuOpen}
                          aria-label="Сортування віршів"
                          title={`Сортування: ${sortBy === 'rating' ? 'За рейтингом' : 'Найновіші'}`}
                          onClick={() => setSortMenuOpen((prev) => !prev)}
                          style={actionIconStyle}
                          className={`btn-editorial-icon ${
                            hasCustomSurface ? 'hover:opacity-95' : ''
                          }`}
                        >
                          <Filter className="w-4 h-4" strokeWidth={1.75} />
                        </button>

                        <AnimatePresence initial={false}>
                          {sortMenuOpen && (
                            <m.div
                              initial={{ opacity: 0, scale: 0.95, y: 6 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: 6 }}
                              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                              role="listbox"
                              aria-label="Оберіть порядок віршів"
                              className="absolute left-0 bottom-12 w-44 z-30 overflow-hidden rounded-xl bg-white dark:bg-night-panel shadow-[0_14px_34px_-14px_rgba(20,20,19,0.22)] dark:shadow-[0_16px_36px_-12px_rgba(0,0,0,0.72)]"
                            >
                              <div className="p-1 space-y-0.5">
                                {(
                                  [
                                    { value: 'newest', label: 'Найновіші' },
                                    { value: 'rating', label: 'За рейтингом' },
                                  ] as const
                                ).map((option) => {
                                  const selected = sortBy === option.value;
                                  return (
                                    <button
                                      key={option.value}
                                      type="button"
                                      role="option"
                                      aria-selected={selected}
                                      onClick={() => {
                                        handleSortChange(option.value);
                                        setSortMenuOpen(false);
                                      }}
                                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs text-left transition-colors duration-150 cursor-pointer ${
                                        selected
                                          ? 'bg-pear-pine-gradient text-white font-semibold'
                                          : 'font-medium text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream hover:bg-paper-warm dark:hover:bg-night-elevated'
                                      }`}
                                    >
                                      <span>{option.label}</span>
                                      {selected && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />}
                                    </button>
                                  );
                                })}
                              </div>
                            </m.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                </div>

                {!guestUser && !commentsOpen && (
                  <div className="w-full flex flex-col items-center text-center gap-2.5 pt-4 pb-1">
                    <p
                      style={activeTextColor ? { color: activeTextColor, opacity: 0.88 } : undefined}
                      className={`text-xs sm:text-sm ${
                        activeTextColor ? '' : 'text-ink-muted dark:text-sandstone-light'
                      }`}
                    >
                      Щоб залишити оцінку або відгук
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        trackClick(`poem_rate_auth:${currentPoem.id}`, 'Увійти для оцінки вірша', 'action');
                        onOpenAuthModal();
                      }}
                      className="btn-editorial-primary w-full max-w-xs min-h-[42px] px-6 py-2.5 text-xs font-semibold justify-center"
                    >
                      Увійти
                    </button>
                  </div>
                )}

                {/* Relocated Unboxed Rating Confirmation Dock (Natural Thumb Zone & Standard Action Hierarchy) */}
                <AnimatePresence initial={false}>
                  {pendingRating !== null && currentPoem.userRating === null && !commentsOpen && (
                    <m.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      className="pt-4"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                        {/* Primary Confirmation CTA (Top Full-Width Thumb Target on Mobile, Rightmost on Desktop) */}
                        <button
                          type="button"
                          disabled={ratingSubmittingId === currentPoem.id}
                          onClick={() => handleConfirmRating(currentPoem, pendingRating)}
                          className="touch-surface order-1 sm:order-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-5 py-2 text-xs font-semibold tracking-[0.01em] text-white bg-pear-pine-gradient active:scale-[0.97] rounded-xl shadow-[0_6px_16px_-8px_rgba(30,58,41,0.5)] dark:shadow-[0_6px_16px_-8px_rgba(0,0,0,0.65)] transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-55 disabled:pointer-events-none"
                        >
                          <Check className="w-3.5 h-3.5"strokeWidth={2.2} />
                          <span>
                            {ratingSubmittingId === currentPoem.id
                              ?'Збереження...'
                              :'Підтвердити оцінку'}
                          </span>
                        </button>

                        {/* Secondary & Dismiss Actions (Balanced Row on Mobile, Split Left/Right on Desktop) */}
                        <div className="order-2 sm:contents flex items-center justify-between gap-2.5">
                          <button
                            type="button"
                            onClick={() => setPendingRating(null)}
                            className="touch-surface sm:order-1 inline-flex items-center justify-center min-h-[44px] sm:min-h-[40px] px-3.5 py-2 text-xs font-medium text-ink-muted dark:text-sandstone-light hover:text-ink dark:hover:text-cream hover:bg-paper dark:hover:bg-night-elevated rounded-xl transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Скасувати
                          </button>

                          <button
                            type="button"
                            onClick={() => setCommentsOpen(true)}
                            className="touch-surface sm:order-2 sm:ml-auto flex-1 sm:flex-none inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2 text-xs font-medium text-ink dark:text-cream bg-transparent hover:bg-paper dark:hover:bg-night-elevated active:scale-[0.97] rounded-xl transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5"strokeWidth={1.75} />
                            <span>Додати коментар</span>
                          </button>
                        </div>
                      </div>
                    </m.div>
                  )}
                </AnimatePresence>

                {/* Inline Collapsible Comments (Linked Directly with Poem Rating) */}
                {commentsOpen && (
                  <div className="pt-2">
                    <ReviewsBlock
                      targetType="poem"
                      targetId={currentPoem.id}
                      ratingAverage={currentPoem.ratingAverage}
                      ratingCount={currentPoem.ratingCount}
                      reviews={currentPoem.reviews}
                      guestUser={guestUser}
                      getGuestToken={getGuestToken}
                      isAdmin={isAdmin}
                      getAdminToken={getAdminToken}
                      onOpenAuthModal={onOpenAuthModal}
                      compact
                      hideRatingSummary
                      linkedRating={pendingRating}
                      onLinkedRatingChange={setPendingRating}
                      userHasRated={currentPoem.userRating !== null}
                      userRatingValue={currentPoem.userRating}
                      onReviewSubmitted={({ poem }) => {
                        if (poem) onPoemUpdated(poem);
                      }}
                    />
                  </div>
                )}
                </div>
              </m.div>
              )}
              </AnimatePresence>
            </m.article>
          </AnimatePresence>
        </m.div>
      )}
        </>
      )}

      {/* Poem Photo Lightbox */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {zoomedPhotoUrl && (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center p-4 sm:p-6"
                onClick={() => setZoomedPhotoUrl(null)}
                role="dialog"
                aria-modal="true"
                aria-label="Перегляд фото вірша"
              >
                <button
                  type="button"
                  onClick={() => setZoomedPhotoUrl(null)}
                  aria-label="Закрити перегляд фото"
                  className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
                <img
                  src={zoomedPhotoUrl}
                  alt={surfacePoem?.title || 'Фото вірша'}
                  width={1200}
                  height={800}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onClick={(e) => e.stopPropagation()}
                  className="max-w-full max-h-[84vh] object-contain rounded-xl shadow-2xl"
                />
              </m.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      <SubmitPoemModal
        isOpen={submitModalOpen}
        guestUser={guestUser}
        getGuestToken={getGuestToken}
        onClose={() => setSubmitModalOpen(false)}
        onOpenAuthModal={onOpenAuthModal}
        onOpenPublishedPoem={handleOpenPublishedFromModal}
      />
    </section>
  );
});
