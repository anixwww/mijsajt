import {
  ArrowLeft,
  ArrowUpRight,
  Award,
  BookMarked,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Lock,
  Maximize2,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Star,
  UserCheck,
  X,
} from'lucide-react';
import { AnimatePresence, m, useMotionValue, useSpring } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  getProseDiscountCalculation,
  type GuestUser,
  type ProseAccessMode,
  type ProseChapter,
  type ProseStatus,
  type ProseTag,
  type ProseWork,
  type PurchasedAccess,
  type TelegramSubscriptionState,
  type WeeklyPeriodInfo,
  type WeeklyProseWinner,
} from '../types.ts';
import { setActiveMoment, trackClick } from '../utils/analytics.ts';
import { createEncryptedPaymentEnvelope } from '../utils/paymentCrypto.ts';
import {
  readOfflineProseContent,
  readOfflineProsePdf,
  saveOfflineProseContent,
  saveOfflineProsePdf,
} from '../utils/offlineCache.ts';
import {
  countProseWords,
  paginateProseText,
  PROSE_WORDS_PER_PAGE,
} from '../utils/prosePagination.ts';
import { preserveFormattedText } from '../utils/textFormatting.ts';
import { getProseTagPreset } from '../utils/proseTagColors.ts';
import { useTouchFeedback } from '../utils/useTouchFeedback.ts';
import { ReviewsBlock } from './ReviewsBlock.tsx';
import { EditorialImage } from './EditorialImage.tsx';
import { EmptySectionState } from './EmptySectionState.tsx';
import { HryvniaIcon } from './StoreIcons.tsx';
import { SubmitProseModal } from './SubmitProseModal.tsx';
import { SwipeStarRating } from './SwipeStarRating.tsx';

interface ProseSectionProps {
  proseList: ProseWork[];
  weeklyProse?: WeeklyProseWinner[];
  weeklyCurrentPeriod?: WeeklyPeriodInfo;
  proseTags?: ProseTag[];
  proseAuthDiscountPercent?: number;
  proseTelegramDiscountPercent?: number;
  monobankJarUrl?: string;
  monobankAcquiringEnabled?: boolean;
  telegramSubscription?: TelegramSubscriptionState;
  onOpenTelegramModal?: () => void;
  onTelegramInvalidated?: () => void;
  unlockedMap: Record<string, PurchasedAccess>;
  guestUser: GuestUser | null;
  onOpenAuthModal: () => void;
  isAdmin?: boolean;
  getAdminToken?: () => Promise<string | null>;
  getGuestToken?: (forceRefresh?: boolean) => Promise<string | null>;
  onProsePurchased: (unlocked: PurchasedAccess, orderCode: string) => void;
  onRestoreOrders: (restored: PurchasedAccess[]) => void;
  onProseUpdated: (updatedProse: ProseWork) => void;
  initialProseId?: string | null;
  onActiveProseChange?: (proseId: string | null) => void;
  onHomeBackdropChange?: (useHomeBackdrop: boolean) => void;
}

type ProseSourceTab = 'author' | 'community' | 'weekly';
type ProseFilter = 'all' | 'free' | 'authorized' | 'paid' | 'unlocked';
type ProseSort = 'newest' | 'rating';
type PaywallView = 'offer' | 'checkout';

const UKRAINIAN_MONTHS: Record<string, number> = {
  січня: 0,
  січень: 0,
  лютого: 1,
  лютий: 1,
  березня: 2,
  березень: 2,
  квітня: 3,
  квітень: 3,
  травня: 4,
  травень: 4,
  червня: 5,
  червень: 5,
  липня: 6,
  липень: 6,
  серпня: 7,
  серпень: 7,
  вересня: 8,
  вересень: 8,
  жовтня: 9,
  жовтень: 9,
  листопада: 10,
  листопад: 10,
  грудня: 11,
  грудень: 11,
};

function parseUkrainianDateMs(rawDate?: string): number {
  if (!rawDate) return 0;
  const normalized = rawDate
    .trim()
    .toLowerCase()
    .replace(/\s*р\.?$/i, '');

  const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])).getTime();
  }

  const dotMatch = normalized.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    return new Date(Number(dotMatch[3]), Number(dotMatch[2]) - 1, Number(dotMatch[1])).getTime();
  }

  const textMatch = normalized.match(/^(\d{1,2})\s+([а-яіїєґ']+)\s+(\d{4})$/u);
  if (textMatch) {
    const day = Number(textMatch[1]);
    const month = UKRAINIAN_MONTHS[textMatch[2]];
    const year = Number(textMatch[3]);
    if (month !== undefined && Number.isFinite(day) && Number.isFinite(year)) {
      return new Date(year, month, day).getTime();
    }
  }

  const parsed = Date.parse(rawDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return'';
  if (bytes < 1024 * 1024) {
    return`${Math.max(1, Math.round(bytes / 1024))} КБ`;
  }
  return`${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function getWorkTotalWords(work: ProseWork, loadedText?: string, chaptersOverride?: ProseChapter[]): number {
  if (typeof work.totalWords === 'number' && work.totalWords > 0) {
    return work.totalWords;
  }
  const baseWords = countProseWords(work.content || loadedText || '');
  const chapters = chaptersOverride ?? work.chapters ?? [];
  const chaptersWords = chapters.reduce((sum, ch) => sum + countProseWords(ch.content), 0);
  return baseWords + chaptersWords;
}

function formatUkrainianWords(count: number): string {
  const abs = Math.abs(Math.floor(count));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  let unit = 'слів';
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) unit = 'слово';
    else if (mod10 >= 2 && mod10 <= 4) unit = 'слова';
  }
  return `${abs.toLocaleString('uk-UA')} ${unit}`;
}

export function ProseSection({
  proseList,
  weeklyProse = [],
  weeklyCurrentPeriod,
  proseTags = [],
  proseAuthDiscountPercent = 0,
  proseTelegramDiscountPercent = 50,
  monobankJarUrl: _monobankJarUrl = '',
  monobankAcquiringEnabled = false,
  telegramSubscription,
  onOpenTelegramModal,
  onTelegramInvalidated,
  unlockedMap,
  guestUser,
  onOpenAuthModal,
  isAdmin = false,
  getAdminToken,
  getGuestToken,
  onProsePurchased,
  onRestoreOrders,
  onProseUpdated,
  initialProseId,
  onActiveProseChange,
  onHomeBackdropChange,
}: ProseSectionProps) {
  const isTelegramSubscribed = Boolean(telegramSubscription?.subscribed);
  const [proseSourceTab, setProseSourceTab] = useState<ProseSourceTab>('author');
  const isHomeSurfaceTab = proseSourceTab === 'community' || proseSourceTab === 'weekly';
  const [selectedWeeklyIndex, setSelectedWeeklyIndex] = useState(0);
  const [weeklyChapterId, setWeeklyChapterId] = useState<string>('base');
  const [weeklyPageIndex, setWeeklyPageIndex] = useState(0);
  const [copiedWeeklyId, setCopiedWeeklyId] = useState<string | null>(null);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [filter, setFilter] = useState<ProseFilter>('all');
  const [sortBy, setSortBy] = useState<ProseSort>('newest');
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [activeStatusFilter, setActiveStatusFilter] = useState<ProseStatus | null>(null);
  const [activeWorkId, setActiveWorkId] = useState<string | null>(initialProseId || null);
  const [activeChapterId, setActiveChapterId] = useState<string>('base');
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [largeText, setLargeText] = useState(false);
  const [lightboxState, setLightboxState] = useState<{
    urls: string[];
    index: number;
    alt: string;
  } | null>(null);

  // Server-loaded full text, chapters, and protected PDF object URLs
  const [loadedContents, setLoadedContents] = useState<Record<string, string>>({});
  const [loadedChapters, setLoadedChapters] = useState<Record<string, ProseChapter[]>>({});
  const [pdfBlobUrls, setPdfBlobUrls] = useState<Record<string, string>>({});
  const pdfBlobUrlsRef = useRef<Record<string, string>>({});
  const [loadingWorkId, setLoadingWorkId] = useState<string | null>(null);
  const [loadContentError, setLoadContentError] = useState<string | null>(null);
  const [justUnlockedOrder, setJustUnlockedOrder] = useState<{ workId: string; orderCode: string } | null>(null);

  // Inline Poetry-style rating & collapsible reviews state
  const [pendingRating, setPendingRating] = useState<number | null>(null);
  const [ratingSubmittingId, setRatingSubmittingId] = useState<string | null>(null);
  const [ratingFeedback, setRatingFeedback] = useState<{
    workId: string;
    text: string;
    isError?: boolean;
  } | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(Boolean(guestUser));

  // Paywall / Inline Express Checkout state
  const [paywallView, setPaywallView] = useState<PaywallView>('offer');
  const [showRestoreBox, setShowRestoreBox] = useState(false);
  const [restoreQuery, setRestoreQuery] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [pendingMonobankInvoice, setPendingMonobankInvoice] = useState<{
    workId: string;
    invoiceId: string;
    pageUrl: string;
    orderCode: string;
    amountUah: number;
    statusText?: string;
  } | null>(null);
  const [checkingMonobankStatus, setCheckingMonobankStatus] = useState(false);

  const modalScrollRef = useRef<HTMLDivElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const reviewsDockRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [showReadingProgress, setShowReadingProgress] = useState(false);
  const readingProgressMV = useMotionValue(0);
  const smoothReadingProgress = useSpring(readingProgressMV, {
    stiffness: 340,
    damping: 36,
    restDelta: 0.001,
  });
  const { getTouchProps, isTouchActive } = useTouchFeedback();

  const prevGuestUidRef = useRef<string | null>(guestUser?.uid || null);

  useEffect(() => {
    onHomeBackdropChange?.(isHomeSurfaceTab);
  }, [isHomeSurfaceTab, onHomeBackdropChange]);

  useEffect(() => {
    return () => {
      onHomeBackdropChange?.(false);
    };
  }, [onHomeBackdropChange]);

  // Revoke any generated Blob URLs cleanly on unmount
  useEffect(() => {
    return () => {
      Object.values(pdfBlobUrlsRef.current).forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
  }, []);

  // Clear cached protected texts/PDFs if the guest signs out so locked works cannot linger in memory
  useEffect(() => {
    const currentUid = guestUser?.uid || null;
    if (prevGuestUidRef.current === currentUid) return;
    prevGuestUidRef.current = currentUid;
    if (!currentUid) {
      setLoadedContents({});
      setLoadedChapters({});
      Object.values(pdfBlobUrlsRef.current).forEach((url) => {
        URL.revokeObjectURL(url);
      });
      pdfBlobUrlsRef.current = {};
      setPdfBlobUrls({});
    }
  }, [guestUser?.uid]);

  useEffect(() => {
    if (!initialProseId) return;
    const target = proseList.find((w) => w.id === initialProseId);
    if (target) {
      setProseSourceTab(target.isCommunity ? 'community' : 'author');
      setActiveWorkId(initialProseId);
    }
  }, [initialProseId, proseList]);

  const authorProse = useMemo(() => proseList.filter((w) => !w.isCommunity), [proseList]);
  const communityProse = useMemo(() => proseList.filter((w) => Boolean(w.isCommunity)), [proseList]);

  const weeklySorted = useMemo(
    () => [...weeklyProse].sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
    [weeklyProse]
  );
  const safeWeeklyIndex = Math.min(selectedWeeklyIndex, Math.max(0, weeklySorted.length - 1));
  const activeWeeklyProse = weeklySorted[safeWeeklyIndex] || null;

  const currentWeekLeaderProse = useMemo(() => {
    const rated = communityProse.filter((w) => w.ratingCount > 0);
    if (rated.length === 0) return null;
    return [...rated].sort((a, b) => {
      const avgDiff = (b.ratingAverage || 0) - (a.ratingAverage || 0);
      if (Math.abs(avgDiff) > 0.001) return avgDiff;
      const countDiff = (b.ratingCount || 0) - (a.ratingCount || 0);
      if (countDiff !== 0) return countDiff;
      return b.reviews.length - a.reviews.length;
    })[0];
  }, [communityProse]);

  useEffect(() => {
    setWeeklyChapterId('base');
    setWeeklyPageIndex(0);
  }, [activeWeeklyProse?.id]);

  const weeklyChapters: ProseChapter[] = useMemo(
    () => (Array.isArray(activeWeeklyProse?.chapters) ? activeWeeklyProse.chapters : []),
    [activeWeeklyProse]
  );
  const weeklySelectedChapter = useMemo(
    () => (weeklyChapterId === 'base' ? null : weeklyChapters.find((ch) => ch.id === weeklyChapterId) || null),
    [weeklyChapters, weeklyChapterId]
  );
  const weeklyDisplayedText = activeWeeklyProse
    ? (weeklySelectedChapter ? weeklySelectedChapter.content : activeWeeklyProse.content) || ''
    : '';
  const weeklyPaginatedPages = useMemo(
    () => paginateProseText(weeklyDisplayedText, PROSE_WORDS_PER_PAGE),
    [weeklyDisplayedText]
  );
  const weeklyTotalPages = weeklyPaginatedPages.length;
  const safeWeeklyPageIndex = weeklyTotalPages > 0 ? Math.min(weeklyPageIndex, weeklyTotalPages - 1) : 0;
  const weeklyPageParagraphs = weeklyPaginatedPages[safeWeeklyPageIndex] ?? [];

  const activePool = useMemo(
    () => (proseSourceTab === 'author' ? authorProse : communityProse),
    [proseSourceTab, authorProse, communityProse]
  );

  const activeWork = useMemo(
    () => proseList.find((w) => w.id === activeWorkId) || null,
    [proseList, activeWorkId]
  );

  const getWorkAccessMode = (work: ProseWork): ProseAccessMode => {
    if (work.accessMode === 'paid' || (Boolean(work.isPaid) && Number(work.priceUah || 0) > 0)) {
      return 'paid';
    }
    if (work.accessMode === 'authorized' || Boolean(work.requiresAuth)) {
      return 'authorized';
    }
    return 'public';
  };
  const isWorkPaid = (work: ProseWork) => getWorkAccessMode(work) === 'paid';
  const isWorkAuthorizedOnly = (work: ProseWork) => getWorkAccessMode(work) === 'authorized';
  const isWorkUnlocked = (work: ProseWork) => {
    const mode = getWorkAccessMode(work);
    if (mode === 'public') return true;
    if (isAdmin) return true;
    if (mode === 'authorized') return Boolean(guestUser);
    return Boolean(unlockedMap[work.id]);
  };

  const unlockedWorksCount = useMemo(
    () => activePool.filter((w) => isWorkPaid(w) && Boolean(unlockedMap[w.id])).length,
    [activePool, unlockedMap]
  );

  const tagMap = useMemo(() => new Map(proseTags.map((t) => [t.id, t])), [proseTags]);

  useEffect(() => {
    if (activeTagId && !tagMap.has(activeTagId)) {
      setActiveTagId(null);
    }
  }, [activeTagId, tagMap]);

  const filteredProseList = useMemo(() => {
    const baseList = (() => {
      if (proseSourceTab === 'community') return activePool;
      switch (filter) {
        case 'free':
          return activePool.filter((w) => getWorkAccessMode(w) === 'public');
        case 'authorized':
          return activePool.filter((w) => isWorkAuthorizedOnly(w));
        case 'paid':
          return activePool.filter((w) => isWorkPaid(w));
        case 'unlocked':
          return activePool.filter((w) => isWorkPaid(w) && Boolean(unlockedMap[w.id]));
        default:
          return activePool;
      }
    })();

    const tagFiltered = activeTagId
      ? baseList.filter((w) => Array.isArray(w.tagIds) && w.tagIds.includes(activeTagId))
      : baseList;

    const statusFiltered = activeStatusFilter
      ? tagFiltered.filter((w) => w.status === activeStatusFilter)
      : tagFiltered;

    return [...statusFiltered].sort((a, b) => {
      if (sortBy === 'rating') {
        const avgDiff = (b.ratingAverage || 0) - (a.ratingAverage || 0);
        if (Math.abs(avgDiff) > 0.001) return avgDiff;
        const countDiff = (b.ratingCount || 0) - (a.ratingCount || 0);
        if (countDiff !== 0) return countDiff;
      }
      return parseUkrainianDateMs(b.publishedAt) - parseUkrainianDateMs(a.publishedAt);
    });
  }, [activePool, proseSourceTab, filter, sortBy, activeTagId, activeStatusFilter, unlockedMap]);

  const openWork = (work: ProseWork, initialView: PaywallView ='offer', openComments = false) => {
    trackClick(`prose:${work.id}`,`Проза: «${work.title}»`,'content');
    setActiveWorkId(work.id);
    setActiveChapterId('base');
    setActivePageIndex(0);
    setPaywallView(initialView);
    setShowRestoreBox(false);
    setRestoreMessage(null);
    setPaymentError(null);
    setPendingMonobankInvoice(null);
    setLoadContentError(null);
    setJustUnlockedOrder(null);
    setPendingRating(null);
    setRatingFeedback(null);
    setCommentsOpen(Boolean(guestUser) || openComments);
    setLightboxState(null);
    onActiveProseChange?.(work.id);
    if (openComments || Boolean(guestUser)) {
      window.setTimeout(() => {
        reviewsDockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 220);
    }
  };

  const closeWork = () => {
    setActiveWorkId(null);
    setActiveChapterId('base');
    setActivePageIndex(0);
    setPaywallView('offer');
    setShowRestoreBox(false);
    setRestoreMessage(null);
    setPaymentError(null);
    setPendingMonobankInvoice(null);
    setLoadContentError(null);
    setPendingRating(null);
    setRatingFeedback(null);
    setCommentsOpen(Boolean(guestUser));
    onActiveProseChange?.(null);
  };

  const handleSourceTabChange = (nextTab: ProseSourceTab) => {
    if (nextTab === proseSourceTab) return;
    trackClick(
      `prose_source:${nextTab}`,
      nextTab === 'author'
        ? 'Вкладка: Моя проза'
        : nextTab === 'community'
          ? 'Вкладка: Стрічка прози'
          : 'Вкладка: Проза тижня',
      'action'
    );
    setProseSourceTab(nextTab);
    setFilter('all');
    setActiveTagId(null);
    setActiveStatusFilter(null);
    if (nextTab === 'weekly') {
      setSelectedWeeklyIndex(0);
      setWeeklyChapterId('base');
      setWeeklyPageIndex(0);
    }
  };

  const handleOpenSubmitModal = () => {
    trackClick('prose:open_submit_modal', 'Кнопка: Запропонувати прозу', 'action');
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    setSubmitModalOpen(true);
  };

  const handleOpenPublishedFromModal = (proseId: string) => {
    const target = proseList.find((w) => w.id === proseId);
    setProseSourceTab(target?.isCommunity ? 'community' : 'author');
    setFilter('all');
    setActiveTagId(null);
    setActiveStatusFilter(null);
    if (target) {
      openWork(target, 'offer');
    } else {
      setActiveWorkId(proseId);
      onActiveProseChange?.(proseId);
    }
  };

  const handleConfirmRating = async (work: ProseWork, rating: number) => {
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    if (ratingSubmittingId === work.id || work.userRating !== null) return;
    trackClick(`rate_prose:${work.id}`, `Підтвердження оцінки прози: «${work.title}»`, 'action');
    setRatingSubmittingId(work.id);
    setRatingFeedback(null);
    try {
      const token = await getGuestToken?.();
      const response = await fetch(`/api/prose/${encodeURIComponent(work.id)}/rate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ rating }),
      });
      const data = await response.json();
      if (data.prose) {
        onProseUpdated(data.prose);
      }
      if (!response.ok) {
        setRatingFeedback({
          workId: work.id,
          text: data.error || 'Не вдалося зберегти оцінку.',
          isError: !data.alreadyRated,
        });
        return;
      }
      setPendingRating(null);
      setRatingFeedback({
        workId: work.id,
        text: `Оцінку ${rating.toFixed(1)} підтверджено.`,
      });
    } catch {
      setRatingFeedback({
        workId: work.id,
        text: 'Помилка з’єднання із сервером.',
        isError: true,
      });
    } finally {
      setRatingSubmittingId(null);
    }
  };

  // Track active reading moment
  useEffect(() => {
    if (activeWork) {
      setActiveMoment({
        targetKey:`prose:${activeWork.id}`,
        momentKey:`prose:${activeWork.id}`,
        label:`Проза: «${activeWork.title}»`,
        category:'prose',
        section:'prose',
      });
    } else {
      setActiveMoment({
        targetKey:'section:prose',
        momentKey:'prose',
        label:'Розділ: Проза',
        category:'section',
        section:'prose',
      });
    }
  }, [activeWork]);

  // Body scroll lock & Escape handler while reading modal is open
  useEffect(() => {
    if (!activeWork) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow ='hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxState) {
          setLightboxState(null);
          return;
        }
        closeWork();
        return;
      }
      if (lightboxState && lightboxState.urls.length > 1) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setLightboxState((prev) =>
            prev ? { ...prev, index: (prev.index + 1) % prev.urls.length } : null
          );
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setLightboxState((prev) =>
            prev
              ? { ...prev, index: (prev.index - 1 + prev.urls.length) % prev.urls.length }
              : null
          );
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeWork, lightboxState]);

  const buildAuthHeaders = async (includeJsonContentType = true): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {};
    if (includeJsonContentType) {
      headers['Content-Type'] ='application/json';
    }
    if (isAdmin && getAdminToken) {
      const token = await getAdminToken();
      if (token) {
        headers.Authorization =`Bearer ${token}`;
      }
    } else if (getGuestToken) {
      const token = await getGuestToken();
      if (token) {
        headers.Authorization =`Bearer ${token}`;
      }
    }
    return headers;
  };

  const attachPdfBlobUrl = (workId: string, blob: Blob) => {
    const objectUrl = URL.createObjectURL(blob);
    const prevUrl = pdfBlobUrlsRef.current[workId];
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl);
    }
    pdfBlobUrlsRef.current[workId] = objectUrl;
    setPdfBlobUrls((prev) => ({ ...prev, [workId]: objectUrl }));
  };

  const fetchUnlockedPdf = async (work: ProseWork, explicitOrderCode?: string) => {
    if (!work.hasPdf) return;
    const orderCode = explicitOrderCode || unlockedMap[work.id]?.orderCode;
    const mode = getWorkAccessMode(work);
    if (mode === 'paid' && !orderCode && !isAdmin) return;
    if (mode === 'authorized' && !guestUser && !isAdmin) return;

    setLoadingWorkId(work.id);
    setLoadContentError(null);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const cachedBlob = await readOfflineProsePdf(work.id);
        if (cachedBlob) {
          attachPdfBlobUrl(work.id, cachedBlob);
          return;
        }
        setLoadContentError('PDF ще не збережений на цьому пристрої для читання без інтернету.');
        return;
      }

      const headers = await buildAuthHeaders(true);
      const res = await fetch(`/api/prose/${encodeURIComponent(work.id)}/pdf`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ orderCode: orderCode || '' }),
      });

      if (!res.ok) {
        const cachedBlob = await readOfflineProsePdf(work.id);
        if (cachedBlob) {
          attachPdfBlobUrl(work.id, cachedBlob);
          return;
        }
        let message = 'Не вдалося завантажити PDF-документ.';
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // Ignore non-JSON error
        }
        setLoadContentError(message);
        return;
      }

      const blob = await res.blob();
      void saveOfflineProsePdf(work.id, blob);
      attachPdfBlobUrl(work.id, blob);
    } catch {
      const cachedBlob = await readOfflineProsePdf(work.id);
      if (cachedBlob) {
        attachPdfBlobUrl(work.id, cachedBlob);
        return;
      }
      setLoadContentError(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? 'PDF ще не збережений на цьому пристрої для читання без інтернету.'
          : 'Помилка з’єднання із сервером.'
      );
    } finally {
      setLoadingWorkId(null);
    }
  };

  const fetchUnlockedText = async (work: ProseWork, explicitOrderCode?: string) => {
    const orderCode = explicitOrderCode || unlockedMap[work.id]?.orderCode;
    const mode = getWorkAccessMode(work);
    if (mode === 'paid' && !orderCode && !isAdmin) return;
    if (mode === 'authorized' && !guestUser && !isAdmin) return;

    setLoadingWorkId(work.id);
    setLoadContentError(null);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const cached = await readOfflineProseContent(work.id);
        if (cached) {
          setLoadedContents((prev) => ({ ...prev, [work.id]: cached.content }));
          if (cached.chapters) {
            setLoadedChapters((prev) => ({ ...prev, [work.id]: cached.chapters! }));
          }
          return;
        }
        setLoadContentError(
          'Текст ще не завантажувався на цьому пристрої. Відкрийте його один раз із інтернетом, щоб читати офлайн.'
        );
        return;
      }

      const headers = await buildAuthHeaders(true);
      const res = await fetch(`/api/prose/${encodeURIComponent(work.id)}/read`, {
        method: 'POST',
        headers,
        body: JSON.stringify(orderCode ? { orderCode } : {}),
      });
      const data = await res.json();
      const hasChapters = Array.isArray(data.chapters) && data.chapters.length > 0;
      const expectedText =
        (work.totalWords ?? 0) > 0 || (work.chapters?.length || 0) > 0 || !work.hasPdf;
      if (!res.ok || typeof data.content !== 'string' || (!data.content && !hasChapters && !work.hasPdf && expectedText)) {
        const cached = await readOfflineProseContent(work.id);
        if (cached) {
          setLoadedContents((prev) => ({ ...prev, [work.id]: cached.content }));
          if (cached.chapters) {
            setLoadedChapters((prev) => ({ ...prev, [work.id]: cached.chapters! }));
          }
          return;
        }
        setLoadContentError(data.error || 'Не вдалося завантажити повний текст твору.');
        return;
      }
      setLoadedContents((prev) => ({ ...prev, [work.id]: data.content }));
      if (Array.isArray(data.chapters)) {
        setLoadedChapters((prev) => ({ ...prev, [work.id]: data.chapters }));
      }
      void saveOfflineProseContent(
        work.id,
        data.content,
        Array.isArray(data.chapters) ? data.chapters : undefined
      );
    } catch {
      const cached = await readOfflineProseContent(work.id);
      if (cached) {
        setLoadedContents((prev) => ({ ...prev, [work.id]: cached.content }));
        if (cached.chapters) {
          setLoadedChapters((prev) => ({ ...prev, [work.id]: cached.chapters! }));
        }
        return;
      }
      setLoadContentError(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? 'Текст ще не завантажувався на цьому пристрої. Відкрийте його один раз із інтернетом, щоб читати офлайн.'
          : 'Помилка з’єднання із сервером.'
      );
    } finally {
      setLoadingWorkId(null);
    }
  };

  useEffect(() => {
    if (!activeWork) return;
    const unlocked = isWorkUnlocked(activeWork);
    if (!unlocked) return;

    const hasInlineText = Boolean(
      activeWork.content.trim() ||
        (activeWork.chapters && activeWork.chapters.some((ch) => Boolean(ch.content && ch.content.trim())))
    );
    const hasExpectedText =
      (activeWork.totalWords ?? 0) > 0 ||
      (activeWork.chapters?.length || 0) > 0 ||
      !activeWork.hasPdf;

    const needsTextOrChapters =
      !hasInlineText &&
      loadedContents[activeWork.id] === undefined &&
      hasExpectedText;

    if (activeWork.hasPdf && !pdfBlobUrls[activeWork.id]) {
      fetchUnlockedPdf(activeWork);
    }
    if (needsTextOrChapters) {
      fetchUnlockedText(activeWork);
    }
  }, [activeWork, unlockedMap, isAdmin, guestUser?.uid, loadedContents, pdfBlobUrls]);

  const checkMonobankInvoiceStatus = useCallback(
    async (
      work: ProseWork,
      invoiceId: string,
      options?: { manual?: boolean }
    ) => {
      if (options?.manual) {
        setCheckingMonobankStatus(true);
        setPaymentError(null);
      }
      try {
        const res = await fetch(
          `/api/prose/${encodeURIComponent(work.id)}/monobank/status?invoiceId=${encodeURIComponent(invoiceId)}`
        );
        const data = await res.json();
        if (!res.ok) {
          if (options?.manual) {
            setPaymentError(data.error || 'Не вдалося перевірити статус оплати monobank.');
          }
          return;
        }
        if (data.paid) {
          if (typeof data.content === 'string') {
            setLoadedContents((prev) => ({ ...prev, [work.id]: data.content }));
          }
          if (Array.isArray(data.chapters)) {
            setLoadedChapters((prev) => ({ ...prev, [work.id]: data.chapters }));
          }
          setPendingMonobankInvoice(null);
          setJustUnlockedOrder({ workId: work.id, orderCode: data.orderCode });
          onProsePurchased(data.unlockedAccess, data.orderCode);
          setPaywallView('offer');
          setBuyerName('');
          setBuyerEmail('');
          if (data.hasPdf || work.hasPdf) {
            await fetchUnlockedPdf(work, data.orderCode);
          }
          if (modalScrollRef.current) {
            modalScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return;
        }

        if (data.status === 'failure' || data.status === 'expired' || data.status === 'reversed') {
          setPendingMonobankInvoice((prev) =>
            prev && prev.invoiceId === invoiceId
              ? {
                  ...prev,
                  statusText:
                    data.failureReason ||
                    (data.status === 'expired'
                      ? 'Термін дії рахунку вийшов. Створіть новий рахунок.'
                      : 'Оплату через monobank скасовано або не завершено.'),
                }
              : prev
          );
        } else if (options?.manual) {
          setPendingMonobankInvoice((prev) =>
            prev && prev.invoiceId === invoiceId
              ? {
                  ...prev,
                  statusText: 'Очікуємо підтвердження платежу від monobank…',
                }
              : prev
          );
        }
      } catch {
        if (options?.manual) {
          setPaymentError('Помилка з’єднання із сервером під час перевірки оплати.');
        }
      } finally {
        if (options?.manual) {
          setCheckingMonobankStatus(false);
        }
      }
    },
    [onProsePurchased]
  );

  useEffect(() => {
    if (!activeWork || !pendingMonobankInvoice || pendingMonobankInvoice.workId !== activeWork.id) {
      return;
    }
    const timer = window.setInterval(() => {
      checkMonobankInvoiceStatus(activeWork, pendingMonobankInvoice.invoiceId);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [activeWork, pendingMonobankInvoice, checkMonobankInvoiceStatus]);

  const executeMonobankInvoicePurchase = async (work: ProseWork, name: string, email: string) => {
    setPaymentError(null);
    trackClick(`prose_purchase:${work.id}`, `Оплата доступу до прози через Монобанк: «${work.title}»`, 'store');

    setSubmittingPayment(true);
    try {
      const authToken = getGuestToken ? await getGuestToken() : null;
      const tgToken = telegramSubscription?.subscribed ? telegramSubscription.token || null : null;
      const sealed = await createEncryptedPaymentEnvelope({
        kind: 'prose',
        proseId: work.id,
        method: 'monobank',
        buyerName: name,
        buyerEmail: email,
        authToken,
        telegramDiscountToken: tgToken,
      });

      const res = await fetch(`/api/prose/${encodeURIComponent(work.id)}/monobank/invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          ...(tgToken ? { 'X-Telegram-Discount-Token': tgToken } : {}),
        },
        body: JSON.stringify({
          encryptedPayment: sealed.envelope,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 && tgToken && onTelegramInvalidated) {
          onTelegramInvalidated();
        }
        setPaymentError(data.error || 'Не вдалося створити оплату через Монобанк.');
        return;
      }

      if (data.mode === 'acquiring' && typeof data.invoiceId === 'string' && typeof data.pageUrl === 'string') {
        setPendingMonobankInvoice({
          workId: work.id,
          invoiceId: data.invoiceId,
          pageUrl: data.pageUrl,
          orderCode: data.orderCode || '',
          amountUah: Number(data.amountUah || sealed.amountUah),
        });
        return;
      }

      if (data.paid && data.unlockedAccess) {
        if (typeof data.content === 'string') {
          setLoadedContents((prev) => ({ ...prev, [work.id]: data.content }));
        }
        if (Array.isArray(data.chapters)) {
          setLoadedChapters((prev) => ({ ...prev, [work.id]: data.chapters }));
        }
        setJustUnlockedOrder({ workId: work.id, orderCode: data.orderCode });
        onProsePurchased(data.unlockedAccess, data.orderCode);
        setPaywallView('offer');
        setBuyerName('');
        setBuyerEmail('');

        if (data.hasPdf || work.hasPdf) {
          await fetchUnlockedPdf(work, data.orderCode);
        }

        if (modalScrollRef.current) {
          modalScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } else {
        setPaymentError('Очікується підтвердження оплати від Монобанк.');
      }
    } catch (err) {
      setPaymentError(err instanceof Error && err.message ? err.message : 'Помилка з’єднання із сервером.');
    } finally {
      setSubmittingPayment(false);
    }
  };

  const handlePurchaseProse = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeWork) return;
    setPaymentError(null);

    const cleanName = buyerName.trim();
    const cleanEmail = buyerEmail.trim();
    if (cleanName.length < 2 || !cleanEmail.includes('@')) {
      setPaymentError('Будь ласка, вкажіть ім’я та коректний email.');
      return;
    }

    await executeMonobankInvoicePurchase(activeWork, cleanName, cleanEmail);
  };

  const handleRestoreProseAccess = async (e: FormEvent) => {
    e.preventDefault();
    if (!restoreQuery.trim() || !activeWork) return;
    setRestoring(true);
    setRestoreMessage(null);
    try {
      const res = await fetch('/api/orders/restore', {
        method:'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ query: restoreQuery }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRestoreMessage({ ok: false, text: data.error ||'Не вдалося перевірити замовлення.'});
        return;
      }
      const items: PurchasedAccess[] = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) {
        setRestoreMessage({ ok: false, text:'За цим email або кодом замовлень не знайдено.'});
        return;
      }
      onRestoreOrders(items);
      const matched = items.find((it) => it.proseId === activeWork.id || it.productId === activeWork.id);
      if (matched) {
        setRestoreMessage({ ok: true, text:`Доступ відновлено (#${matched.orderCode}).`});
        setRestoreQuery('');
        if (activeWork.hasPdf) {
          await fetchUnlockedPdf(activeWork, matched.orderCode);
        }
        if (!activeWork.hasPdf || (activeWork.chapters?.length || 0) > 0) {
          await fetchUnlockedText(activeWork, matched.orderCode);
        }
      } else {
        setRestoreMessage({
          ok: false,
          text:'Знайдено інші покупки, але доступу саме до цього твору немає.',
        });
      }
    } catch {
      setRestoreMessage({ ok: false, text:'Помилка з’єднання із сервером.'});
    } finally {
      setRestoring(false);
    }
  };

  const activeWorkMode = activeWork ? getWorkAccessMode(activeWork) : 'public';
  const activeWorkPaid = activeWorkMode === 'paid';
  const activeWorkAuthorizedOnly = activeWorkMode === 'authorized';
  const activeWorkUnlocked = activeWork ? isWorkUnlocked(activeWork) : false;
  const activeWorkBasePrice = Number(activeWork?.priceUah || 0);
  const activeWorkPricing = activeWork
    ? getProseDiscountCalculation(activeWorkBasePrice, {
        authDiscountPercent: proseAuthDiscountPercent,
        isAuthorized: Boolean(guestUser),
        telegramDiscountPercent: proseTelegramDiscountPercent,
        isTelegramSubscribed,
      })
    : {
        basePriceUah: 0,
        finalPriceUah: 0,
        appliedDiscountPercent: 0,
        appliedSource: 'none' as const,
        authDiscountPercent: 0,
        telegramDiscountPercent: 0,
      };
  const activeWorkEffectivePrice = activeWorkPricing.finalPriceUah;
  const activeWorkAppliedDiscountPercent = activeWorkPricing.appliedDiscountPercent;
  const activeWorkHasDiscount =
    activeWorkPaid && activeWorkAppliedDiscountPercent > 0 && activeWorkEffectivePrice < activeWorkBasePrice;
  const activeWorkPotentialTgPrice = activeWork
    ? getProseDiscountCalculation(activeWorkBasePrice, {
        authDiscountPercent: proseAuthDiscountPercent,
        isAuthorized: Boolean(guestUser),
        telegramDiscountPercent: proseTelegramDiscountPercent,
        isTelegramSubscribed: true,
      }).finalPriceUah
    : 0;
  const activeWorkPotentialGuestPrice = activeWork
    ? getProseDiscountCalculation(activeWorkBasePrice, {
        authDiscountPercent: proseAuthDiscountPercent,
        isAuthorized: true,
        telegramDiscountPercent: proseTelegramDiscountPercent,
        isTelegramSubscribed,
      }).finalPriceUah
    : 0;
  const activeFullText = activeWork
    ? activeWork.content || loadedContents[activeWork.id] ||''
    :'';
  const activeChapters: ProseChapter[] = useMemo(() => {
    if (!activeWork) return [];
    const raw = loadedChapters[activeWork.id] ?? activeWork.chapters ?? [];
    return Array.isArray(raw) ? raw : [];
  }, [activeWork, loadedChapters]);
  const selectedChapter = useMemo(
    () => (activeChapterId === 'base' ? null : activeChapters.find((ch) => ch.id === activeChapterId) || null),
    [activeChapters, activeChapterId]
  );
  const selectedChapterIndex = selectedChapter
    ? activeChapters.findIndex((ch) => ch.id === selectedChapter.id)
    : -1;
  const activePdfUrl = activeWork ? pdfBlobUrls[activeWork.id] : undefined;
  const activePreviewText = activeWork
    ? activeWork.previewText || activeWork.excerpt
    :'';
  const activeOrderCode = activeWork ? unlockedMap[activeWork.id]?.orderCode : undefined;
  const activeChapterText = selectedChapter ? selectedChapter.content : activeFullText;
  const paginatedPages = useMemo(
    () => paginateProseText(activeChapterText, PROSE_WORDS_PER_PAGE),
    [activeChapterText]
  );
  const totalSectionPages = paginatedPages.length;
  const safePageIndex = totalSectionPages > 0 ? Math.min(activePageIndex, totalSectionPages - 1) : 0;
  const currentPageParagraphs = paginatedPages[safePageIndex] ?? [];
  const currentPageWords = useMemo(
    () => countProseWords(currentPageParagraphs.join(' ')),
    [currentPageParagraphs]
  );

  const goToPage = useCallback((nextIndex: number) => {
    const clamped = Math.max(0, Math.min(nextIndex, Math.max(0, totalSectionPages - 1)));
    setActivePageIndex(clamped);
    if (modalScrollRef.current) {
      modalScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [totalSectionPages]);

  const showFontSizeToggle = Boolean(activeChapterText.trim()) || !activeWorkUnlocked;
  const hasReadableText = Boolean(
    activeWork &&
      activeWorkUnlocked &&
      loadingWorkId !== activeWork.id &&
      !loadContentError &&
      activeChapterText.trim().length > 0
  );

  const updateReadingProgress = useCallback(() => {
    const el = modalScrollRef.current;
    if (!el || !hasReadableText) {
      setShowReadingProgress(false);
      readingProgressMV.set(0);
      progressBarRef.current?.setAttribute('aria-valuenow', '0');
      return;
    }

    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 32) {
      setShowReadingProgress(false);
      readingProgressMV.set(0);
      progressBarRef.current?.setAttribute('aria-valuenow', '0');
      return;
    }

    setShowReadingProgress(true);
    const ratio = Math.min(1, Math.max(0, el.scrollTop / maxScroll));
    readingProgressMV.set(ratio);
    progressBarRef.current?.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  }, [hasReadableText, readingProgressMV]);

  useEffect(() => {
    setActivePageIndex(0);
    readingProgressMV.jump(0);
    setShowReadingProgress(false);
    if (modalScrollRef.current) {
      modalScrollRef.current.scrollTop = 0;
    }
  }, [activeWork?.id, activeChapterId, readingProgressMV]);

  useEffect(() => {
    if (!activeWork) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [activeWork]);

  useEffect(() => {
    if (!hasReadableText || totalSectionPages <= 1 || lightboxState) return;
    const onArrowKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowRight' && safePageIndex < totalSectionPages - 1) {
        e.preventDefault();
        goToPage(safePageIndex + 1);
      } else if (e.key === 'ArrowLeft' && safePageIndex > 0) {
        e.preventDefault();
        goToPage(safePageIndex - 1);
      }
    };
    window.addEventListener('keydown', onArrowKey);
    return () => window.removeEventListener('keydown', onArrowKey);
  }, [hasReadableText, totalSectionPages, safePageIndex, goToPage, lightboxState]);

  useEffect(() => {
    if (!activeWork) {
      setShowReadingProgress(false);
      readingProgressMV.jump(0);
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      updateReadingProgress();
    });

    const scrollEl = modalScrollRef.current;
    const contentEl = modalContentRef.current;
    const onScroll = () => updateReadingProgress();

    scrollEl?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        updateReadingProgress();
      });
      if (scrollEl) observer.observe(scrollEl);
      if (contentEl) observer.observe(contentEl);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      scrollEl?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      observer?.disconnect();
    };
  }, [
    activeWork,
    activeChapterId,
    activeChapterText,
    safePageIndex,
    largeText,
    loadingWorkId,
    activeWorkUnlocked,
    updateReadingProgress,
    readingProgressMV,
  ]);

  const renderProseCard = (work: ProseWork, index: number) => {
    const mode = getWorkAccessMode(work);
    const paid = mode === 'paid';
    const authOnly = mode === 'authorized';
    const unlocked = isWorkUnlocked(work);
    const basePrice = Number(work.priceUah || 0);
    const workPricing = getProseDiscountCalculation(basePrice, {
      authDiscountPercent: proseAuthDiscountPercent,
      isAuthorized: Boolean(guestUser),
      telegramDiscountPercent: proseTelegramDiscountPercent,
      isTelegramSubscribed,
    });
    const effectivePrice = workPricing.finalPriceUah;
    const hasActiveDiscount = paid && workPricing.appliedDiscountPercent > 0 && effectivePrice < basePrice;
    const pdfSizeLabel = formatFileSize(work.pdfFileSize);
    const workTags = (work.tagIds || [])
      .map((id) => tagMap.get(id))
      .filter((t): t is ProseTag => Boolean(t));

    return (
      <m.article
        key={work.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, delay: Math.min(index * 0.03, 0.12), ease: [0.16, 1, 0.3, 1] }}
        className="perf-card h-full"
      >
        <div
          {...getTouchProps(work.id)}
          data-touch-active={isTouchActive(work.id) ?'true': undefined}
          className={`touch-card group w-full h-full rounded-2xl p-4 sm:p-6 flex flex-col justify-between text-left transition-all duration-150 ${
            isHomeSurfaceTab
              ? 'bg-white/62 dark:bg-[#2B2B2B]/52 hover:bg-white/78 dark:hover:bg-[#323232]/65 backdrop-blur-xl shadow-[0_18px_42px_-22px_rgba(24,48,33,0.28)] hover:shadow-[0_22px_48px_-20px_rgba(24,48,33,0.36)] dark:shadow-[0_20px_46px_-20px_rgba(0,0,0,0.82)] dark:hover:shadow-[0_24px_52px_-18px_rgba(0,0,0,0.9)]'
              : 'bg-white dark:bg-[#262626]'
          }`}
        >
          <div>
            {/* Entire card body clickable to open story/preview */}
            <button
              type="button"
              onClick={() => openWork(work,'offer')}
              className="w-full text-left cursor-pointer"
            >
              {/* Quiet unboxed metadata row with genre, pages & rating */}
              <div className="flex items-start justify-between gap-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[#5C5C58] dark:text-[#C4BFB4] min-w-0">
                  <span>{work.genre}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{work.pages} стор.</span>
                  {(() => {
                    const words = getWorkTotalWords(work, loadedContents[work.id], loadedChapters[work.id]);
                    if (words <= 0) return null;
                    return (
                      <span className="hidden sm:inline-flex items-center gap-1.5">
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{formatUkrainianWords(words)}</span>
                      </span>
                    );
                  })()}
                  {authOnly && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          unlocked
                            ? 'text-[#1E563B] dark:text-[#E5E5E5]'
                            : 'text-[#2C5937] dark:text-[#E5E5E5]'
                        }`}
                      >
                        <UserCheck className="w-3 h-3 shrink-0" strokeWidth={2} />
                        <span>{unlocked ? 'Відкрито' : 'Для авторизованих'}</span>
                      </span>
                    </>
                  )}
                </div>

                {work.ratingCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 font-mono text-xs text-[#141413] dark:text-[#F4F1EA] tabular-nums whitespace-nowrap shrink-0"
                    title={`Рейтинг ${work.ratingAverage.toFixed(1)} з 5 (${work.ratingCount} оцінок)`}
                  >
                    <Star className="w-3 h-3 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                    <span className="font-semibold">{work.ratingAverage.toFixed(1)}</span>
                    <span className="text-[#5C5C58] dark:text-[#C4BFB4]">({work.ratingCount})</span>
                  </span>
                )}
              </div>

              {work.isCommunity && (
                <div className="mt-2.5 inline-flex items-center gap-2 text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B]">
                  {work.authorPhotoUrl && (
                    <img
                      src={work.authorPhotoUrl}
                      alt={work.authorName || 'Читач'}
                      referrerPolicy="no-referrer"
                      className="w-5 h-5 rounded-full object-cover shrink-0"
                    />
                  )}
                  <span>{work.authorName || 'Читач'}</span>
                </div>
              )}

              <h3 className="mt-2.5 sm:mt-3 text-lg sm:text-[22px] font-semibold tracking-[-0.015em] text-[#141413] dark:text-[#F4F1EA] group-hover:text-[#2C5937] dark:group-hover:text-white leading-snug transition-colors duration-150">
                <span className="prose-book-marker">{work.title}</span>
              </h3>

              {work.slogan && (
                <p className="mt-1 sm:mt-1.5 italic text-[13.5px] sm:text-[14px] text-[#4A4A46] dark:text-[#C8C4BA] leading-snug">
                  «{work.slogan}»
                </p>
              )}

              <p className="mt-2 text-[13.5px] sm:text-sm text-[#5C5C58] dark:text-[#A8A49B] leading-relaxed line-clamp-3">
                {work.excerpt}
              </p>
            </button>

            {/* Compact Status + Collection / Book Filter Tags */}
            {(work.status || workTags.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                {work.status && (() => {
                  const isCompleted = work.status === 'completed';
                  const isSelectedStatus = activeStatusFilter === work.status;
                  return (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveStatusFilter((prev) => (prev === work.status ? null : work.status!));
                      }}
                      className={`inline-flex items-center gap-1 py-0.5 text-[11px] font-medium tracking-[0.01em] bg-transparent border-0 transition-colors duration-150 cursor-pointer ${
                        isCompleted
                          ? 'text-emerald-700 dark:text-[#E5E5E5] hover:text-emerald-900 dark:hover:text-white'
                          : 'text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300'
                      } ${
                        isSelectedStatus
                          ? 'font-semibold underline underline-offset-4'
                          : ''
                      }`}
                      title={`Статус твору: ${isCompleted ? 'Закінчено' : 'У процесі'} (натисніть для фільтрації)`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                      ) : (
                        <Clock className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                      )}
                      <span>{isCompleted ? 'Закінчено' : 'У процесі'}</span>
                      {isSelectedStatus && <X className="w-3 h-3 shrink-0" strokeWidth={2.2} />}
                    </button>
                  );
                })()}

                {workTags.map((tag) => {
                  const preset = getProseTagPreset(tag.color);
                  const isSelectedTag = activeTagId === tag.id;
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveTagId((prev) => (prev === tag.id ? null : tag.id));
                      }}
                      style={preset.badgeStyle}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-[0.01em] transition-all duration-150 cursor-pointer ${preset.badgeClass} ${
                        isSelectedTag
                          ? 'shadow-md underline underline-offset-2'
                          : 'hover:brightness-105'
                      }`}
                      title={`Належить до: ${tag.label} (натисніть для фільтрації)`}
                    >
                      <BookMarked className="w-3 h-3 shrink-0" strokeWidth={2.1} />
                      <span>{tag.label}</span>
                      {isSelectedTag && <X className="w-3 h-3 shrink-0" strokeWidth={2.2} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card Footer with Publication Date on Bottom-Left & Read Action on Bottom-Right */}
          <div className="mt-5 pt-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-medium">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
              <span className="text-[#5C5C58] dark:text-[#C4BFB4] tabular-nums whitespace-nowrap">
                {work.publishedAt}
              </span>

              {(work.chapters?.length || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => openWork(work,'offer')}
                  className="inline-flex items-center gap-1.5 text-[#5C5C58] dark:text-[#A8A49B] cursor-pointer hover:text-[#141413] dark:hover:text-[#F4F1EA] transition-colors whitespace-nowrap"
                >
                  <FolderOpen className="w-3.5 h-3.5 shrink-0 text-[#2C5937] dark:text-[#E5E5E5]" strokeWidth={1.85} />
                  <span className="tabular-nums">
                    Тека · {(work.chapters?.length || 0) + 1} розд.
                  </span>
                </button>
              )}

              {work.hasPdf && (
                <button
                  type="button"
                  onClick={() => openWork(work,'offer')}
                  className="inline-flex items-center gap-1.5 text-[#5C5C58] dark:text-[#A8A49B] min-w-0 truncate cursor-pointer hover:text-[#141413] dark:hover:text-[#F4F1EA] transition-colors"
                >
                  <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.85} />
                  <span className="truncate tabular-nums">
                    PDF{pdfSizeLabel ? ` · ${pdfSizeLabel}` : ''}
                  </span>
                </button>
              )}

              {paid && !unlocked && (
                <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-[#2C5937] dark:text-[#E5E5E5]">
                  {hasActiveDiscount ? (
                    <>
                      <span className="line-through text-[#88857D]">{basePrice}</span>
                      <span className="font-semibold">{effectivePrice} ₴</span>
                      <span className="text-[#1E563B] dark:text-[#E5E5E5]">
                        −{workPricing.appliedDiscountPercent}%
                      </span>
                    </>
                  ) : (
                    <>
                      <span>{basePrice} ₴</span>
                      {proseTelegramDiscountPercent > 0 ? (
                        <span className="text-[#5C5C58] dark:text-[#A8A49B]">
                          (−{proseTelegramDiscountPercent}% з Telegram)
                        </span>
                      ) : (
                        proseAuthDiscountPercent > 0 && (
                          <span className="text-[#5C5C58] dark:text-[#A8A49B]">
                            (−{proseAuthDiscountPercent}% з акаунтом)
                          </span>
                        )
                      )}
                    </>
                  )}
                </span>
              )}

              {work.reviews.length > 0 && (
                <button
                  type="button"
                  onClick={() => openWork(work, 'offer', true)}
                  className="inline-flex items-center text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA] transition-colors cursor-pointer shrink-0"
                  title="Відгуки читачів"
                  aria-label="Відгуки читачів"
                >
                  <MessageSquare className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => openWork(work,'offer')}
              className={`inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                (paid || authOnly) && unlocked
                  ?'text-[#1E563B] dark:text-[#E5E5E5] font-semibold'
                  :'text-[#5C5C58] dark:text-[#C4BFB4] group-hover:text-[#2C5937] dark:group-hover:text-white'
              }`}
            >
              <span>
                {work.hasPdf && unlocked
                  ? 'Читати PDF'
                  : authOnly && !unlocked
                    ? 'Читати фрагмент'
                    : paid && !unlocked
                      ? 'Читати фрагмент'
                      : 'Читати'}
              </span>
              <ArrowUpRight
                className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-150 will-change-transform"
                strokeWidth={1.85}
              />
            </button>
          </div>
        </div>
      </m.article>
    );
  };

  return (
    <section id="prose">
      <div>
        <h2 className="sr-only">Проза</h2>

        {/* Top Switcher & Propose Bar (Matches PoetrySection) */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Джерело прози"
            className="inline-flex items-center gap-0.5 sm:gap-1 p-1 rounded-xl bg-[#EAE7DF] dark:bg-[#262626] min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <button
              type="button"
              role="tab"
              aria-selected={proseSourceTab === 'author'}
              onClick={() => handleSourceTabChange('author')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                proseSourceTab === 'author'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-2xs'
                  : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
              }`}
            >
              <span>Моя проза</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={proseSourceTab === 'community'}
              onClick={() => handleSourceTabChange('community')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                proseSourceTab === 'community'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-2xs'
                  : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
              }`}
            >
              <span>Стрічка</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={proseSourceTab === 'weekly'}
              onClick={() => handleSourceTabChange('weekly')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                proseSourceTab === 'weekly'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-2xs'
                  : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
              }`}
            >
              <span>Проза тижня</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleOpenSubmitModal}
            title="Запропонувати прозу"
            aria-label="Запропонувати прозу"
            className="w-10 h-10 inline-flex items-center justify-center rounded-xl bg-[#EAE7DF] dark:bg-[#262626] hover:bg-[#E2DFD5] dark:hover:bg-[#323232] text-[#141413] dark:text-[#F4F1EA] active:scale-[0.95] transition-all cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5] shrink-0" strokeWidth={1.85} />
          </button>
        </div>

        {proseSourceTab === 'weekly' ? (
          activeWeeklyProse ? (
            <m.article
              key={activeWeeklyProse.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="perf-card rounded-2xl p-5 sm:p-8 md:p-10 bg-white/62 dark:bg-[#2B2B2B]/52 backdrop-blur-xl shadow-[0_18px_42px_-22px_rgba(24,48,33,0.28)] dark:shadow-[0_20px_46px_-20px_rgba(0,0,0,0.82)] space-y-6"
            >
              {/* Weekly Header + Archive Switcher + Font/Copy Controls */}
              <div className="pb-4 border-b border-[#E6E3DA] dark:border-[#343434] flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2C5937] dark:text-[#BCD369]">
                    <Award className="w-3.5 h-3.5 shrink-0" strokeWidth={1.9} />
                    <span>Проза тижня · за підсумками оцінок</span>
                  </div>
                  <p className="text-xs font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                    Період: {activeWeeklyProse.periodLabel}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {weeklySorted.length > 1 && (
                    <div className="inline-flex items-center gap-1 mr-1">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedWeeklyIndex((prev) => (prev - 1 + weeklySorted.length) % weeklySorted.length)
                        }
                        aria-label="Попередній тиждень"
                        className="btn-editorial-icon w-9 h-9"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="px-1 text-[11px] font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                        {safeWeeklyIndex + 1}/{weeklySorted.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedWeeklyIndex((prev) => (prev + 1) % weeklySorted.length)}
                        aria-label="Наступний тиждень"
                        className="btn-editorial-icon w-9 h-9"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setLargeText((prev) => !prev)}
                    aria-pressed={largeText}
                    title={largeText ? 'Стандартний шрифт' : 'Збільшити шрифт'}
                    className="btn-editorial-secondary h-9 px-2.5 text-xs font-medium"
                  >
                    {largeText ? 'А' : 'А+'}
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      const text = `${activeWeeklyProse.title}\n\n${weeklyDisplayedText}\n\n— ${activeWeeklyProse.authorName} (${activeWeeklyProse.periodLabel})`;
                      try {
                        await navigator.clipboard.writeText(text);
                        setCopiedWeeklyId(activeWeeklyProse.id);
                        setTimeout(() => setCopiedWeeklyId(null), 2000);
                      } catch {
                        // Ignore clipboard errors
                      }
                    }}
                    title={copiedWeeklyId === activeWeeklyProse.id ? 'Скопійовано' : 'Скопіювати текст'}
                    aria-label="Скопіювати текст"
                    className={`btn-editorial-icon w-9 h-9 ${
                      copiedWeeklyId === activeWeeklyProse.id
                        ? 'bg-emerald-50 dark:bg-[#323232] text-emerald-800 dark:text-[#E5E5E5]'
                        : ''
                    }`}
                  >
                    {copiedWeeklyId === activeWeeklyProse.id ? (
                      <Check className="w-4 h-4" strokeWidth={1.85} />
                    ) : (
                      <Copy className="w-4 h-4" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              </div>

              {/* Author + Rating + Title + Metadata */}
              <div className="max-w-[65ch] mx-auto space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B]">
                  <span className="inline-flex items-center gap-2">
                    {activeWeeklyProse.authorPhotoUrl && (
                      <img
                        src={activeWeeklyProse.authorPhotoUrl}
                        alt={activeWeeklyProse.authorName}
                        referrerPolicy="no-referrer"
                        className="w-5 h-5 rounded-full object-cover shrink-0"
                      />
                    )}
                    <span>{activeWeeklyProse.authorName}</span>
                  </span>

                  {activeWeeklyProse.ratingCount > 0 && (
                    <span className="inline-flex items-center gap-1 font-mono text-[#141413] dark:text-[#F4F1EA] tabular-nums">
                      <Star className="w-3.5 h-3.5 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                      <strong className="font-semibold">{activeWeeklyProse.ratingAverage.toFixed(1)}</strong>
                      <span className="text-[#5C5C58] dark:text-[#A8A49B]">({activeWeeklyProse.ratingCount})</span>
                    </span>
                  )}
                </div>

                <h3 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-[#141413] dark:text-[#F4F1EA] leading-tight">
                  <span className="prose-book-marker">{activeWeeklyProse.title}</span>
                </h3>

                {activeWeeklyProse.slogan && (
                  <p className="italic text-sm sm:text-base text-[#4A4A46] dark:text-[#C8C4BA] leading-snug">
                    «{activeWeeklyProse.slogan}»
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#5C5C58] dark:text-[#A8A49B]">
                  <span>{activeWeeklyProse.genre}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{activeWeeklyProse.pages} стор.</span>
                  {typeof activeWeeklyProse.totalWords === 'number' && activeWeeklyProse.totalWords > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatUkrainianWords(activeWeeklyProse.totalWords)}</span>
                    </>
                  )}
                  {activeWeeklyProse.publishedAt && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{activeWeeklyProse.publishedAt}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Cover / Обкладинка */}
              {activeWeeklyProse.moodboardUrls && activeWeeklyProse.moodboardUrls.length > 0 && (
                <div className="max-w-[65ch] mx-auto space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B]">
                      Обкладинка
                    </span>
                    {activeWeeklyProse.moodboardUrls.length > 1 && (
                      <span className="text-[11px] font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                        {activeWeeklyProse.moodboardUrls.length} фото
                      </span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {activeWeeklyProse.moodboardUrls.map((url, mIdx) => (
                      <button
                        key={`${url}-${mIdx}`}
                        type="button"
                        onClick={() =>
                          setLightboxState({
                            urls: activeWeeklyProse.moodboardUrls || [url],
                            index: mIdx,
                            alt: `Обкладинка: ${activeWeeklyProse.title}`,
                          })
                        }
                        aria-label={`Відкрити обкладинку: ${activeWeeklyProse.title}`}
                        className="group relative block w-full rounded-xl overflow-hidden bg-[#E2DFD7] dark:bg-[#202020] shadow-xs cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C5937]/50"
                      >
                        <img
                          src={url}
                          alt={`Обкладинка: ${activeWeeklyProse.title}${
                            (activeWeeklyProse.moodboardUrls?.length || 0) > 1 ? ` (${mIdx + 1})` : ''
                          }`}
                          referrerPolicy="no-referrer"
                          className="w-full h-auto block transition-transform duration-300 group-hover:scale-[1.01]"
                        />
                        <span
                          aria-hidden="true"
                          className="absolute bottom-2.5 right-2.5 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-black/50 text-white backdrop-blur-xs opacity-80 group-hover:opacity-100 transition-opacity"
                        >
                          <Maximize2 className="w-3.5 h-3.5" strokeWidth={2} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chapters Switcher if present */}
              {weeklyChapters.length > 0 && (
                <div className="max-w-[65ch] mx-auto space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#141413] dark:text-[#F4F1EA]">
                      <FolderOpen className="w-3.5 h-3.5 text-[#2C5937] dark:text-[#E5E5E5]" strokeWidth={1.85} />
                      <span>Зміст теки</span>
                    </span>
                    <span className="text-[11px] font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                      {weeklyChapters.length + 1} розд.
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Розділи прози тижня">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={weeklyChapterId === 'base'}
                      onClick={() => {
                        setWeeklyChapterId('base');
                        setWeeklyPageIndex(0);
                      }}
                      className={`min-h-[38px] px-3 py-1.5 inline-flex items-center gap-1.5 rounded-lg text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        weeklyChapterId === 'base'
                          ? 'bg-[#141413] dark:bg-[#F4F1EA] text-white dark:text-[#181818] font-semibold'
                          : 'bg-[#EAE7DF] dark:bg-[#323232] text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-[#F4F1EA] font-medium'
                      }`}
                    >
                      <span>Основний текст</span>
                    </button>
                    {weeklyChapters.map((ch) => (
                      <button
                        key={ch.id}
                        type="button"
                        role="tab"
                        aria-selected={weeklyChapterId === ch.id}
                        onClick={() => {
                          setWeeklyChapterId(ch.id);
                          setWeeklyPageIndex(0);
                        }}
                        className={`min-h-[38px] px-3 py-1.5 inline-flex items-center gap-1.5 rounded-lg text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          weeklyChapterId === ch.id
                            ? 'bg-[#141413] dark:bg-[#F4F1EA] text-white dark:text-[#181818] font-semibold'
                            : 'bg-[#EAE7DF] dark:bg-[#323232] text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-[#F4F1EA] font-medium'
                        }`}
                      >
                        <span>{ch.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Full Copied Prose Body */}
              {weeklyDisplayedText.trim() && (
                <div className="max-w-[65ch] mx-auto space-y-5">
                  {weeklySelectedChapter && (
                    <h4 className="font-serif text-xl sm:text-2xl font-semibold text-[#141413] dark:text-[#F4F1EA]">
                      {weeklySelectedChapter.title}
                    </h4>
                  )}

                  {weeklyTotalPages > 1 && (
                    <div className="text-[11px] font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                      Сторінка {safeWeeklyPageIndex + 1} з {weeklyTotalPages}
                    </div>
                  )}

                  <div
                    className={`text-[#141413] dark:text-[#F4F1EA] space-y-5 leading-[1.78] ${
                      largeText ? 'text-lg' : 'text-base'
                    }`}
                  >
                    {weeklyPageParagraphs.map((paragraph, pIdx) => (
                      <p key={`${safeWeeklyPageIndex}-${pIdx}`} className="whitespace-pre-wrap">
                        {preserveFormattedText(paragraph)}
                      </p>
                    ))}
                  </div>

                  {weeklyTotalPages > 1 && (
                    <nav
                      aria-label="Навігація сторінками прози тижня"
                      className="pt-4 flex items-center justify-between gap-3"
                    >
                      <button
                        type="button"
                        disabled={safeWeeklyPageIndex === 0}
                        onClick={() => setWeeklyPageIndex(Math.max(0, safeWeeklyPageIndex - 1))}
                        className="btn-editorial-secondary min-h-[40px] px-3.5 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Попередня</span>
                      </button>

                      <span className="text-xs font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                        {safeWeeklyPageIndex + 1} / {weeklyTotalPages}
                      </span>

                      <button
                        type="button"
                        disabled={safeWeeklyPageIndex >= weeklyTotalPages - 1}
                        onClick={() =>
                          setWeeklyPageIndex(Math.min(weeklyTotalPages - 1, safeWeeklyPageIndex + 1))
                        }
                        className="btn-editorial-secondary min-h-[40px] px-3.5 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <span>Наступна</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </nav>
                  )}
                </div>
              )}

              {activeWeeklyProse.sourceProseId &&
                (() => {
                  const sourceWork = proseList.find((w) => w.id === activeWeeklyProse.sourceProseId);
                  if (!sourceWork) return null;
                  return (
                    <div className="max-w-[65ch] mx-auto pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => openWork(sourceWork, 'offer')}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#2C5937] dark:text-[#E5E5E5] underline underline-offset-4 hover:opacity-80 transition-opacity cursor-pointer"
                      >
                        <span>До твору в Стрічці</span>
                        <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={1.85} />
                      </button>
                    </div>
                  );
                })()}
            </m.article>
          ) : currentWeekLeaderProse ? (
            <m.article
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="perf-card rounded-2xl p-5 sm:p-8 md:p-10 bg-white/62 dark:bg-[#2B2B2B]/52 backdrop-blur-xl shadow-[0_18px_42px_-22px_rgba(24,48,33,0.28)] dark:shadow-[0_20px_46px_-20px_rgba(0,0,0,0.82)] space-y-5"
            >
              <div className="pb-4 border-b border-[#E6E3DA] dark:border-[#343434] space-y-0.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2C5937] dark:text-[#BCD369]">
                  <Award className="w-3.5 h-3.5 shrink-0" strokeWidth={1.9} />
                  <span>Поточний тиждень · проміжний лідер</span>
                </div>
                {weeklyCurrentPeriod?.periodLabel && (
                  <p className="text-xs font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                    Період: {weeklyCurrentPeriod.periodLabel}
                  </p>
                )}
              </div>

              <div className="max-w-[65ch] mx-auto space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B]">
                  <span className="inline-flex items-center gap-2">
                    {currentWeekLeaderProse.authorPhotoUrl && (
                      <img
                        src={currentWeekLeaderProse.authorPhotoUrl}
                        alt={currentWeekLeaderProse.authorName || 'Читач'}
                        referrerPolicy="no-referrer"
                        className="w-5 h-5 rounded-full object-cover shrink-0"
                      />
                    )}
                    <span>{currentWeekLeaderProse.authorName || 'Читач'}</span>
                  </span>

                  <span className="inline-flex items-center gap-1 font-mono text-[#141413] dark:text-[#F4F1EA] tabular-nums">
                    <Star className="w-3.5 h-3.5 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                    <strong className="font-semibold">{currentWeekLeaderProse.ratingAverage.toFixed(1)}</strong>
                    <span className="text-[#5C5C58] dark:text-[#A8A49B]">({currentWeekLeaderProse.ratingCount})</span>
                  </span>
                </div>

                <h3 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-[#141413] dark:text-[#F4F1EA] leading-tight">
                  <span className="prose-book-marker">{currentWeekLeaderProse.title}</span>
                </h3>

                {currentWeekLeaderProse.slogan && (
                  <p className="italic text-sm text-[#4A4A46] dark:text-[#C8C4BA]">
                    «{currentWeekLeaderProse.slogan}»
                  </p>
                )}

                <p className="text-sm text-[#5C5C58] dark:text-[#A8A49B] leading-relaxed">
                  {currentWeekLeaderProse.excerpt}
                </p>

                <p className="text-xs text-[#5C5C58] dark:text-[#A8A49B] leading-relaxed pt-1">
                  Наприкінці тижня прозовий твір із найвищою оцінкою зі Стрічки буде автоматично скопійовано та зафіксовано у цьому вікні.
                </p>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => openWork(currentWeekLeaderProse, 'offer')}
                    className="btn-editorial-primary min-h-[42px] px-5 py-2.5 text-xs font-semibold justify-center"
                  >
                    <span>Читати у Стрічці</span>
                    <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={1.85} />
                  </button>
                </div>
              </div>
            </m.article>
          ) : (
            <div className="perf-card rounded-2xl p-6 sm:p-10 bg-white/62 dark:bg-[#2B2B2B]/52 backdrop-blur-xl shadow-[0_18px_42px_-22px_rgba(24,48,33,0.28)] dark:shadow-[0_20px_46px_-20px_rgba(0,0,0,0.82)] text-center space-y-3">
              <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[#EAE7DF] dark:bg-[#323232] text-[#2C5937] dark:text-[#BCD369] mx-auto">
                <Award className="w-5 h-5" strokeWidth={1.8} />
              </div>
              <h3 className="text-lg sm:text-xl font-semibold text-[#141413] dark:text-[#F4F1EA]">
                Проза тижня ще формується
              </h3>
              {weeklyCurrentPeriod?.periodLabel && (
                <p className="text-xs font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                  Період: {weeklyCurrentPeriod.periodLabel}
                </p>
              )}
              <p className="text-sm text-[#5C5C58] dark:text-[#A8A49B] max-w-md mx-auto leading-relaxed">
                Щопонеділка найкращий прозовий твір зі Стрічки за підсумками оцінок читачів автоматично копіюється та фіксується у цьому вікні.
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
        ) : activePool.length === 0 ? (
          <EmptySectionState />
        ) : (
          <>
        {proseSourceTab === 'author' && proseTelegramDiscountPercent > 0 && (
          <div className="mb-6 relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#183624] via-[#224A32] to-[#142A1D] dark:from-[#262626] dark:via-[#2C2C2C] dark:to-[#202020] p-4 sm:p-5 text-white shadow-lg">
            <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-[#3A7552]/20 dark:bg-white/5 rounded-full blur-2xl pointer-events-none" />
            <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5">
              <div className="flex items-start gap-3 min-w-0">
                <span className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-md flex items-center justify-center text-[#BCD369] dark:text-[#E5E5E5] shrink-0 mt-0.5 shadow-inner">
                  <Send className="w-5 h-5" strokeWidth={2} />
                </span>
                <div className="space-y-0.5 min-w-0">
                  <p className="font-serif text-sm sm:text-base font-semibold tracking-tight text-white">
                    {isTelegramSubscribed
                      ? `Активна знижка −${proseTelegramDiscountPercent}% у Прозі`
                      : `Знижка −${proseTelegramDiscountPercent}% у Прозі для підписників Telegram`}
                  </p>
                  <p className="text-xs text-[#E2E8F0]/80 leading-relaxed">
                    {isTelegramSubscribed
                      ? 'Вашу підписку на Telegram-канал підтверджено. Знижка застосовується автоматично до всіх платних творів.'
                      : 'Підпишіться на Telegram-канал та підтвердіть підписку, щоб відкривати платні оповідання й повісті зі знижкою.'}
                  </p>
                </div>
              </div>
              {onOpenTelegramModal && (
                <button
                  type="button"
                  onClick={onOpenTelegramModal}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#183624] dark:bg-[#E5E5E5] dark:text-[#181818] text-xs font-semibold shadow-md hover:opacity-95 active:scale-[0.97] transition-all duration-150 cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <span>{isTelegramSubscribed ? 'Статус підписки' : 'Підтвердити підписку'}</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Filter & Sort Toolbar */}
        <div
          className={`mb-6 flex flex-nowrap items-center gap-1.5 sm:gap-3 overflow-x-auto sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            proseSourceTab === 'author' ? 'justify-between' : 'justify-end'
          }`}
        >
          {proseSourceTab === 'author' && (
          <div
            className="inline-flex shrink-0 items-center gap-0.5 p-1 bg-[#EAE7DF] dark:bg-[#262626] rounded-xl"
            role="tablist"
            aria-label="Фільтр прозових творів"
          >
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              onClick={() => setFilter('all')}
              className={`touch-surface min-h-[38px] sm:min-h-[40px] px-2 sm:px-3.5 py-1.5 sm:py-2 text-[11px] sm:text-xs rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                filter === 'all'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-xs'
                  : 'font-medium text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
              }`}
            >
              Усі
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'free'}
              onClick={() => setFilter('free')}
              className={`touch-surface min-h-[38px] sm:min-h-[40px] px-2 sm:px-3.5 py-1.5 sm:py-2 text-[11px] sm:text-xs rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                filter === 'free'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-xs'
                  : 'font-medium text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
              }`}
            >
              Відкриті
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={filter === 'paid'}
              onClick={() => setFilter('paid')}
              className={`touch-surface min-h-[38px] sm:min-h-[40px] px-2 sm:px-3.5 py-1.5 sm:py-2 text-[11px] sm:text-xs rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                filter === 'paid'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-xs'
                  : 'font-medium text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
              }`}
            >
              Платні
            </button>
            {unlockedWorksCount > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'unlocked'}
                onClick={() => setFilter('unlocked')}
                className={`touch-surface min-h-[38px] sm:min-h-[40px] px-2 sm:px-3.5 py-1.5 sm:py-2 text-[11px] sm:text-xs rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === 'unlocked'
                    ? 'bg-pear-pine-gradient text-white font-semibold shadow-xs'
                    : 'font-medium text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
                }`}
              >
                Придбані
              </button>
            )}
          </div>
          )}

          <div
            className="inline-flex shrink-0 items-center gap-0.5 p-1 bg-[#EAE7DF] dark:bg-[#262626] rounded-xl"
            role="group"
            aria-label="Сортування прозових творів"
          >
            <button
              type="button"
              aria-pressed={sortBy === 'newest'}
              onClick={() => {
                if (sortBy === 'newest') return;
                trackClick('prose_sort:newest', 'Сортування прози: Найновіші', 'action');
                setSortBy('newest');
              }}
              className={`touch-surface min-h-[38px] sm:min-h-[40px] px-2 sm:px-3.5 py-1.5 sm:py-2 text-[11px] sm:text-xs rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                sortBy === 'newest'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-xs'
                  : 'font-medium text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
              }`}
            >
              Найновіші
            </button>
            <button
              type="button"
              aria-pressed={sortBy === 'rating'}
              onClick={() => {
                if (sortBy === 'rating') return;
                trackClick('prose_sort:rating', 'Сортування прози: За рейтингом', 'action');
                setSortBy('rating');
              }}
              className={`touch-surface min-h-[38px] sm:min-h-[40px] px-2 sm:px-3.5 py-1.5 sm:py-2 text-[11px] sm:text-xs rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                sortBy === 'rating'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-xs'
                  : 'font-medium text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
              }`}
            >
              За рейтингом
            </button>
          </div>
        </div>

        {/* Unified Chronological Grid */}
        {filteredProseList.length === 0 ? (
          <div className="py-12 text-center">
            <p className="font-serif text-2xl text-[#141413] dark:text-[#F4F1EA] mb-1">
              У цій категорії поки немає творів
            </p>
            <button
              type="button"
              onClick={() => {
                setFilter('all');
                setActiveTagId(null);
                setActiveStatusFilter(null);
              }}
              className="mt-3 btn-editorial-secondary min-h-[40px] px-4 py-2 text-xs"
            >
              Показати всі тексти
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            {filteredProseList.map((work, index) => renderProseCard(work, index))}
          </div>
        )}
          </>
        )}
      </div>

      {/* Prose Reader, Protected PDF Viewer & Access Purchase Modal */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {activeWork && (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="fixed inset-0 z-50 bg-[#141413]/55 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-6"
                onClick={closeWork}
                role="dialog"
                aria-modal="true"
                aria-labelledby="prose-modal-title"
              >
                <AnimatePresence>
                  {showReadingProgress && (
                    <m.div
                      ref={progressBarRef}
                      key="prose-reading-progress"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      role="progressbar"
                      aria-label="Прогрес читання твору"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={0}
                      className="fixed top-0 left-0 right-0 z-[60] h-[3px] pointer-events-none bg-[#141413]/10 dark:bg-white/10"
                    >
                      <m.div
                        style={{ scaleX: smoothReadingProgress }}
                        className="h-full w-full origin-left bg-pear-pine-gradient"
                      />
                    </m.div>
                  )}
                </AnimatePresence>

                <m.div
                  ref={modalScrollRef}
                  initial={{ opacity: 0, scale: 0.97, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 12 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-[#F9F9F7] dark:bg-[#202020] rounded-2xl max-w-3xl w-full max-h-[92vh] sm:max-h-[90vh] overflow-y-auto overscroll-contain px-4 pt-4 pb-24 sm:px-8 sm:pt-8 sm:pb-24 md:px-11 md:pt-11 md:pb-24 shadow-xl will-change-transform text-[#141413] dark:text-[#F4F1EA]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div ref={modalContentRef}>
              {/* Streamlined Mobile-First Modal Header */}
              <div className="pb-4 sm:pb-5">
                {/* Top Utility Row: Single-Line Genre/Length + Controls */}
                <div className="flex items-center justify-between gap-2 mb-2.5 sm:mb-3">
                  <div className="flex items-center gap-1.5 text-xs text-[#5C5C58] dark:text-[#A8A49B] min-w-0 truncate">
                    <span className="truncate">{activeWork.genre}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums shrink-0">{activeWork.pages} стор.</span>
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    {showFontSizeToggle && (
                      <button
                        type="button"
                        onClick={() => setLargeText((prev) => !prev)}
                        className="btn-editorial-secondary min-h-[36px] sm:min-h-[40px] px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs"
                        aria-label="Змінити розмір шрифту"
                      >
                        {largeText ? 'А' : 'А+'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={closeWork}
                      className="w-9 h-9 sm:w-10 sm:h-10 inline-flex items-center justify-center text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA] hover:bg-[#EFECE6] dark:hover:bg-[#323232] active:scale-[0.95] rounded-lg transition-all duration-150 cursor-pointer"
                      aria-label="Закрити вікно читання"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {activeWork.isCommunity && (
                  <div className="mb-2.5 inline-flex items-center gap-2 text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B]">
                    {activeWork.authorPhotoUrl && (
                      <img
                        src={activeWork.authorPhotoUrl}
                        alt={activeWork.authorName || 'Читач'}
                        referrerPolicy="no-referrer"
                        className="w-5 h-5 rounded-full object-cover shrink-0"
                      />
                    )}
                    <span>{activeWork.authorName || 'Читач'}</span>
                  </div>
                )}

                {/* Story Title & Editorial Slogan */}
                <h3
                  id="prose-modal-title"
                  className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-[-0.02em] text-[#141413] dark:text-[#F4F1EA] leading-[1.24] sm:leading-tight"
                >
                  <span className="prose-book-marker">{activeWork.title}</span>
                </h3>
                {activeWork.slogan && (
                  <p className="mt-1.5 italic text-[14px] sm:text-base text-[#5C5C58] dark:text-[#A8A49B] leading-snug">
                    «{activeWork.slogan}»
                  </p>
                )}

                {/* Calm Unified Secondary Metadata Line */}
                <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px] sm:text-xs text-[#5C5C58] dark:text-[#A8A49B]">
                  {activeWork.status && (
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        activeWork.status === 'completed'
                          ? 'text-emerald-700 dark:text-[#E5E5E5]'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {activeWork.status === 'completed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                      ) : (
                        <Clock className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                      )}
                      <span>{activeWork.status === 'completed' ? 'Закінчено' : 'У процесі'}</span>
                    </span>
                  )}

                  {(activeWork.tagIds || [])
                    .map((id) => tagMap.get(id))
                    .filter((t): t is ProseTag => Boolean(t))
                    .map((tag) => {
                      const preset = getProseTagPreset(tag.color);
                      return (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EFECE6]/85 dark:bg-[#323232] text-[#141413] dark:text-[#F4F1EA] font-medium"
                        >
                          <BookMarked
                            className="w-3 h-3 shrink-0"
                            style={{ color: preset.hex }}
                            strokeWidth={2.1}
                          />
                          <span>{tag.label}</span>
                        </span>
                      );
                    })}

                  {(() => {
                    const modalWords = getWorkTotalWords(activeWork, activeFullText, activeChapters);
                    if (modalWords <= 0) return null;
                    return <span className="tabular-nums">{formatUkrainianWords(modalWords)}</span>;
                  })()}

                  <span className="tabular-nums">{activeWork.publishedAt}</span>

                  {activeWork.ratingCount > 0 && (
                    <span className="inline-flex items-center gap-1 font-mono text-[#141413] dark:text-[#F4F1EA] tabular-nums">
                      <Star className="w-3 h-3 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                      <span className="font-semibold">{activeWork.ratingAverage.toFixed(1)}</span>
                      <span className="text-[#5C5C58] dark:text-[#A8A49B]">({activeWork.ratingCount})</span>
                    </span>
                  )}

                  {activeWorkAuthorizedOnly && (
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        activeWorkUnlocked
                          ? 'text-[#1E563B] dark:text-[#E5E5E5]'
                          : 'text-[#2C5937] dark:text-[#E5E5E5]'
                      }`}
                    >
                      <UserCheck className="w-3.5 h-3.5" strokeWidth={2} />
                      <span>{activeWorkUnlocked ? 'Відкрито' : 'Для авторизованих'}</span>
                    </span>
                  )}

                  {activeWorkPaid && (
                    activeWorkUnlocked ? (
                      <span className="text-[#1E563B] dark:text-[#E5E5E5] font-medium tabular-nums">
                        {activeOrderCode ? `Доступ відкрито (#${activeOrderCode})` : 'Доступ відкрито'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-mono font-semibold text-[#2C5937] dark:text-[#E5E5E5] tabular-nums">
                        {activeWorkHasDiscount ? (
                          <>
                            <span>Доступ</span>
                            <span className="line-through text-[#88857D] font-normal">
                              {activeWorkBasePrice} ₴
                            </span>
                            <span>{activeWorkEffectivePrice} ₴</span>
                            <span className="text-[#1E563B] dark:text-[#E5E5E5]">
                              (−{activeWorkAppliedDiscountPercent}%)
                            </span>
                          </>
                        ) : (
                          <span>Доступ · {activeWorkBasePrice} ₴</span>
                        )}
                      </span>
                    )
                  )}
                </div>
              </div>

              {activeWork.moodboardUrls && activeWork.moodboardUrls.length > 0 && (
                activeWork.isCommunity ? (
                  <div className="pt-3 pb-4 max-w-[65ch] mx-auto space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B]">
                        Обкладинка
                      </span>
                      {activeWork.moodboardUrls.length > 1 && (
                        <span className="text-[11px] font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                          {activeWork.moodboardUrls.length} фото
                        </span>
                      )}
                    </div>
                    <div className="space-y-3">
                      {activeWork.moodboardUrls.map((url, mIdx) => (
                        <button
                          key={`${url}-${mIdx}`}
                          type="button"
                          onClick={() =>
                            setLightboxState({
                              urls: activeWork.moodboardUrls || [url],
                              index: mIdx,
                              alt: `Обкладинка: ${activeWork.title}`,
                            })
                          }
                          aria-label={`Відкрити обкладинку: ${activeWork.title}`}
                          className="group relative block w-full rounded-xl overflow-hidden bg-[#E2DFD7] dark:bg-[#262626] shadow-xs cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C5937]/50"
                        >
                          <img
                            src={url}
                            alt={`Обкладинка: ${activeWork.title}${
                              (activeWork.moodboardUrls?.length || 0) > 1 ? ` (${mIdx + 1})` : ''
                            }`}
                            referrerPolicy="no-referrer"
                            className="w-full h-auto block transition-transform duration-300 group-hover:scale-[1.01]"
                          />
                          <span
                            aria-hidden="true"
                            className="absolute bottom-2.5 right-2.5 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-black/50 text-white backdrop-blur-xs opacity-80 group-hover:opacity-100 transition-opacity"
                          >
                            <Maximize2 className="w-3.5 h-3.5" strokeWidth={2} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="pt-4 pb-5 max-w-[65ch] mx-auto">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#141413] dark:text-[#F4F1EA]">
                        <FolderOpen className="w-3.5 h-3.5 text-[#2C5937] dark:text-[#E5E5E5]" strokeWidth={1.85} />
                        <span>Муд-борд твору</span>
                      </span>
                      <span className="text-[11px] font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                        {activeWork.moodboardUrls.length} {activeWork.moodboardUrls.length === 1 ? 'фото' : 'фотографій'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                      {activeWork.moodboardUrls.map((url, mIdx) => (
                        <button
                          key={`${url}-${mIdx}`}
                          type="button"
                          onClick={() =>
                            setLightboxState({
                              urls: activeWork.moodboardUrls || [url],
                              index: mIdx,
                              alt: `Муд-борд: ${activeWork.title}`,
                            })
                          }
                          aria-label={`Відкрити фото ${mIdx + 1}`}
                          className="relative group rounded-xl overflow-hidden aspect-[4/3] bg-[#E2DFD7] dark:bg-[#262626] shadow-xs cursor-zoom-in block w-full"
                        >
                          <EditorialImage
                            src={url}
                            alt={`Муд-борд фото ${mIdx + 1}`}
                            titleFallback={`Фото ${mIdx + 1}`}
                            aspectClassName="w-full h-full"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )
              )}

              {/* Folder Table of Contents (shown when chapters exist in this prose card) */}
              {activeChapters.length > 0 && (
                <div className="pt-4 pb-5 max-w-[65ch] mx-auto">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#141413] dark:text-[#F4F1EA]">
                      <FolderOpen className="w-3.5 h-3.5 text-[#2C5937] dark:text-[#E5E5E5]" strokeWidth={1.85} />
                      <span>Зміст теки</span>
                    </span>
                    <span className="text-[11px] font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                      {activeChapters.length + 1} розд.
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Розділи твору">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeChapterId === 'base'}
                      onClick={() => setActiveChapterId('base')}
                      className={`min-h-[38px] px-3 py-1.5 inline-flex items-center gap-1.5 rounded-lg text-xs transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                        activeChapterId === 'base'
                          ? 'bg-[#141413] dark:bg-[#F4F1EA] text-white dark:text-[#181818] font-semibold'
                          : 'bg-[#EAE7DF] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-[#F4F1EA] font-medium'
                      }`}
                    >
                      <span>Основний текст</span>
                    </button>

                    {activeChapters.map((chapter) => {
                      const isActiveChapter = activeChapterId === chapter.id;
                      return (
                        <button
                          key={chapter.id}
                          type="button"
                          role="tab"
                          aria-selected={isActiveChapter}
                          onClick={() => setActiveChapterId(chapter.id)}
                          className={`min-h-[38px] px-3 py-1.5 inline-flex items-center gap-1.5 rounded-lg text-xs transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                            isActiveChapter
                              ? 'bg-[#141413] dark:bg-[#F4F1EA] text-white dark:text-[#181818] font-semibold'
                              : 'bg-[#EAE7DF] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-[#F4F1EA] font-medium'
                          }`}
                        >
                          {!activeWorkUnlocked && <Lock className="w-3 h-3 shrink-0 opacity-80" strokeWidth={2} />}
                          <span>{chapter.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Post-Purchase Confirmation Note */}
              {justUnlockedOrder && justUnlockedOrder.workId === activeWork.id && (
                <div className="mt-6 p-4 bg-emerald-50 dark:bg-[#262626] rounded-xl flex items-start gap-3 text-xs text-emerald-900 dark:text-[#F4F1EA]">
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5"/>
                  <div>
                    <p className="font-semibold tabular-nums">
                      Доступ відкрито · Замовлення #{justUnlockedOrder.orderCode}
                    </p>
                    <p className="mt-0.5 text-emerald-800/90 dark:text-[#D4D4D4] leading-relaxed">
                      {activeWork.hasPdf
                        ?'Тепер ви можете читати всі розділи або завантажити PDF-документ. Збережіть код або email, щоб відновити доступ на іншому пристрої.'
                        :'Тепер вам доступний увесь текст твору та всі розділи у цій теці. Збережіть код або вказаний email, щоб відновити доступ на іншому пристрої.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Reader Content (Unlocked Text, Chapters and/or Protected PDF) */}
              {activeWorkUnlocked ? (
                loadingWorkId === activeWork.id ? (
                  <div className="py-10 max-w-[65ch] mx-auto space-y-4 animate-pulse"aria-live="polite">
                    <div className="h-4 bg-[#E6E3DA] dark:bg-[#323232] rounded w-full"/>
                    <div className="h-4 bg-[#E6E3DA] dark:bg-[#323232] rounded w-11/12"/>
                    <div className="h-4 bg-[#E6E3DA] dark:bg-[#323232] rounded w-4/5"/>
                    <div className="h-4 bg-[#E6E3DA] dark:bg-[#323232] rounded w-full mt-6"/>
                    <div className="h-4 bg-[#E6E3DA] dark:bg-[#323232] rounded w-10/12"/>
                  </div>
                ) : loadContentError ? (
                  <div className="py-10 text-center space-y-4">
                    <p className="text-sm text-rose-700 dark:text-rose-400">{loadContentError}</p>
                    <button
                      type="button"
                      onClick={() =>
                        activeWork.hasPdf ? fetchUnlockedPdf(activeWork) : fetchUnlockedText(activeWork)
                      }
                      className="btn-editorial-secondary min-h-[42px] px-4 py-2 text-xs"
                    >
                      Спробувати ще раз
                    </button>
                  </div>
                ) : selectedChapter ? (
                  <div className="pt-6 space-y-6 max-w-[65ch] mx-auto">
                    <div className="pb-2 flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <p className="text-xs text-[#5C5C58] dark:text-[#A8A49B] tabular-nums mb-1">
                          {selectedChapter.publishedAt}
                        </p>
                        <h4 className="font-serif text-2xl sm:text-3xl font-semibold text-[#141413] dark:text-[#F4F1EA]">
                          {selectedChapter.title}
                        </h4>
                      </div>
                      {totalSectionPages > 0 && (
                        <span className="text-[11px] font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                          Сторінка {safePageIndex + 1} з {totalSectionPages} · {formatUkrainianWords(currentPageWords)}
                        </span>
                      )}
                    </div>

                    <div
                      className={`text-[#141413] dark:text-[#F4F1EA] space-y-5 leading-[1.78] ${
                        largeText ? 'text-lg' : 'text-base'
                      }`}
                    >
                      {currentPageParagraphs.map((paragraph, index) => (
                        <p key={`${safePageIndex}-${index}`} className="whitespace-pre-wrap">
                          {paragraph}
                        </p>
                      ))}
                    </div>

                    {totalSectionPages > 1 && (
                      <nav
                        aria-label="Навігація сторінками розділу"
                        className="pt-4 flex flex-wrap items-center justify-between gap-3"
                      >
                        <button
                          type="button"
                          disabled={safePageIndex === 0}
                          onClick={() => goToPage(safePageIndex - 1)}
                          className="btn-editorial-secondary min-h-[40px] px-3.5 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          <span>Попередня</span>
                        </button>

                        <div className="flex flex-wrap items-center justify-center gap-1">
                          {Array.from({ length: totalSectionPages }, (_, idx) => {
                            const isVisible =
                              totalSectionPages <= 7 ||
                              idx === 0 ||
                              idx === totalSectionPages - 1 ||
                              Math.abs(idx - safePageIndex) <= 1;
                            const showEllipsisBefore =
                              totalSectionPages > 7 && idx === safePageIndex - 2 && idx > 0;
                            const showEllipsisAfter =
                              totalSectionPages > 7 &&
                              idx === safePageIndex + 2 &&
                              idx < totalSectionPages - 1;

                            if (showEllipsisBefore || showEllipsisAfter) {
                              return (
                                <span
                                  key={`ellipsis-${idx}`}
                                  className="px-1.5 text-xs text-[#5C5C58] dark:text-[#A8A49B]"
                                >
                                  …
                                </span>
                              );
                            }
                            if (!isVisible) return null;
                            const active = idx === safePageIndex;
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => goToPage(idx)}
                                aria-current={active ? 'page' : undefined}
                                className={`min-w-[36px] min-h-[36px] px-2.5 rounded-lg text-xs font-mono tabular-nums transition-colors cursor-pointer ${
                                  active
                                    ? 'bg-[#141413] dark:bg-[#F4F1EA] text-white dark:text-[#181818] font-semibold'
                                    : 'text-[#5C5C58] dark:text-[#A8A49B] hover:bg-[#EAE7DF] dark:hover:bg-[#323232] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
                                }`}
                              >
                                {idx + 1}
                              </button>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          disabled={safePageIndex >= totalSectionPages - 1}
                          onClick={() => goToPage(safePageIndex + 1)}
                          className="btn-editorial-secondary min-h-[40px] px-3.5 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <span>Наступна</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </nav>
                    )}

                    <div className="pt-4 flex items-center justify-between gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveChapterId(
                            selectedChapterIndex <= 0 ? 'base' : activeChapters[selectedChapterIndex - 1].id
                          )
                        }
                        className="btn-editorial-secondary min-h-[40px] px-3.5 py-2"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>
                          {selectedChapterIndex <= 0
                            ? 'Основний текст'
                            : activeChapters[selectedChapterIndex - 1].title}
                        </span>
                      </button>

                      {selectedChapterIndex < activeChapters.length - 1 && (
                        <button
                          type="button"
                          onClick={() => setActiveChapterId(activeChapters[selectedChapterIndex + 1].id)}
                          className="btn-editorial-secondary min-h-[40px] px-3.5 py-2"
                        >
                          <span>{activeChapters[selectedChapterIndex + 1].title}</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="pt-6 space-y-6">
                    {activeWork.hasPdf && activePdfUrl && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-[#262626] rounded-xl">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileText className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5] shrink-0"/>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-[#141413] dark:text-[#F4F1EA] truncate">
                                {activeWork.pdfFileName ||`${activeWork.title}.pdf`}
                              </p>
                              {activeWork.pdfFileSize && (
                                <p className="text-[11px] font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                                  PDF-документ · {formatFileSize(activeWork.pdfFileSize)}
                                </p>
                              )}
                            </div>
                          </div>

                          <a
                            href={activePdfUrl}
                            download={activeWork.pdfFileName ||`${activeWork.id}.pdf`}
                            className="btn-editorial-primary min-h-[40px] px-4 py-2 text-xs whitespace-nowrap shrink-0"
                          >
                            <Download className="w-3.5 h-3.5"/>
                            <span>Завантажити PDF</span>
                          </a>
                        </div>

                        <iframe
                          src={activePdfUrl}
                          title={`PDF-документ: ${activeWork.title}`}
                          className="w-full h-[58vh] sm:h-[66vh] rounded-xl bg-white"
                        />
                      </div>
                    )}

                    {activeFullText.trim() && (
                      <div className="max-w-[65ch] mx-auto space-y-5">
                        {totalSectionPages > 1 && (
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                            <span>
                              Сторінка {safePageIndex + 1} з {totalSectionPages}
                            </span>
                            {!activeWork.isCommunity && (
                              <span>
                                {formatUkrainianWords(currentPageWords)} (по {PROSE_WORDS_PER_PAGE} слів/стор.)
                              </span>
                            )}
                          </div>
                        )}

                        <div
                          className={`py-1 text-[#141413] dark:text-[#F4F1EA] space-y-5 leading-[1.78] ${
                            largeText ?'text-lg':'text-base'
                          }`}
                        >
                          {currentPageParagraphs.map((paragraph, index) => (
                            <p key={`${safePageIndex}-${index}`} className="whitespace-pre-wrap">
                              {paragraph}
                            </p>
                          ))}
                        </div>

                        {totalSectionPages > 1 && (
                          <nav
                            aria-label="Навігація сторінками твору"
                            className="pt-4 flex flex-wrap items-center justify-between gap-3"
                          >
                            <button
                              type="button"
                              disabled={safePageIndex === 0}
                              onClick={() => goToPage(safePageIndex - 1)}
                              className="btn-editorial-secondary min-h-[40px] px-3.5 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                              <span>Попередня</span>
                            </button>

                            <div className="flex flex-wrap items-center justify-center gap-1">
                              {Array.from({ length: totalSectionPages }, (_, idx) => {
                                const isVisible =
                                  totalSectionPages <= 7 ||
                                  idx === 0 ||
                                  idx === totalSectionPages - 1 ||
                                  Math.abs(idx - safePageIndex) <= 1;
                                const showEllipsisBefore =
                                  totalSectionPages > 7 && idx === safePageIndex - 2 && idx > 0;
                                const showEllipsisAfter =
                                  totalSectionPages > 7 &&
                                  idx === safePageIndex + 2 &&
                                  idx < totalSectionPages - 1;

                                if (showEllipsisBefore || showEllipsisAfter) {
                                  return (
                                    <span
                                      key={`ellipsis-${idx}`}
                                      className="px-1.5 text-xs text-[#5C5C58] dark:text-[#A8A49B]"
                                    >
                                      …
                                    </span>
                                  );
                                }
                                if (!isVisible) return null;
                                const active = idx === safePageIndex;
                                return (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => goToPage(idx)}
                                    aria-current={active ? 'page' : undefined}
                                    className={`min-w-[36px] min-h-[36px] px-2.5 rounded-lg text-xs font-mono tabular-nums transition-colors cursor-pointer ${
                                      active
                                        ? 'bg-[#141413] dark:bg-[#F4F1EA] text-white dark:text-[#181818] font-semibold'
                                        : 'text-[#5C5C58] dark:text-[#A8A49B] hover:bg-[#EAE7DF] dark:hover:bg-[#323232] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
                                    }`}
                                  >
                                    {idx + 1}
                                  </button>
                                );
                              })}
                            </div>

                            <button
                              type="button"
                              disabled={safePageIndex >= totalSectionPages - 1}
                              onClick={() => goToPage(safePageIndex + 1)}
                              className="btn-editorial-secondary min-h-[40px] px-3.5 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <span>Наступна</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </nav>
                        )}
                      </div>
                    )}

                    {activeChapters.length > 0 && (
                      <div className="max-w-[65ch] mx-auto pt-4 flex justify-end">
                        <button
                          type="button"
                          onClick={() => setActiveChapterId(activeChapters[0].id)}
                          className="btn-editorial-secondary min-h-[40px] px-4 py-2 text-xs"
                        >
                          <span>Далі: {activeChapters[0].title}</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              ) : (
                /* Paid Prose Preview + Editorial Unlock Gate */
                <div className="pt-7 max-w-[65ch] mx-auto">
                  {selectedChapter ? (
                    <div className="py-4 space-y-2">
                      <p className="text-xs text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                        {selectedChapter.publishedAt}
                      </p>
                      <h4 className="font-serif text-2xl font-semibold text-[#141413] dark:text-[#F4F1EA] flex items-center gap-2">
                        <Lock className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5] shrink-0" />
                        <span>{selectedChapter.title}</span>
                      </h4>
                      <p className="text-sm text-[#5C5C58] dark:text-[#A8A49B] leading-relaxed">
                        Цей розділ належить до закритої теки твору. Щоб прочитати «{selectedChapter.title}» та всі інші розділи, відкрийте повний доступ нижче.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                        <p className="text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B]">
                          Вступний фрагмент
                        </p>
                        {activeWork.hasPdf && (
                          <span className="inline-flex items-center gap-1.5 text-xs text-[#2C5937] dark:text-[#E5E5E5] font-medium tabular-nums">
                            <FileText className="w-3.5 h-3.5"/>
                            <span>
                              Повна версія у PDF
                              {activeWork.pdfFileSize ?`(${formatFileSize(activeWork.pdfFileSize)})`:''}
                            </span>
                          </span>
                        )}
                      </div>

                      <div className="relative">
                        <div
                          className={`text-[#141413] dark:text-[#F4F1EA] space-y-5 leading-[1.78] ${
                            largeText ?'text-lg':'text-base'
                          }`}
                        >
                          {preserveFormattedText(activePreviewText)
                            .split(/\n{2,}/)
                            .filter(Boolean)
                            .map((paragraph, index) => (
                              <p key={index} className="whitespace-pre-wrap">
                                {paragraph}
                              </p>
                            ))}
                        </div>
                        <div
                          aria-hidden="true"
                          className="pointer-events-none h-20 -mt-20 relative bg-gradient-to-b from-transparent to-[#F9F9F7] dark:to-[#202020]"
                        />
                      </div>
                    </>
                  )}

                  {/* Unboxed Editorial Unlock Gate (Authorized-Only OR Paid Checkout) */}
                  <div className="mt-4 pt-7">
                    {activeWorkAuthorizedOnly ? (
                      <div className="space-y-5">
                        <div className="space-y-1.5">
                          <h4 className="font-serif text-2xl sm:text-3xl font-semibold text-[#141413] dark:text-[#F4F1EA] flex items-center gap-2">
                            <UserCheck className="w-5 h-5 text-[#2C5937] dark:text-[#E5E5E5] shrink-0" />
                            <span>Читати повністю після входу</span>
                          </h4>
                          <p className="text-sm text-[#5C5C58] dark:text-[#A8A49B] leading-relaxed">
                            Цей твір ({activeWork.pages} стор.) відкритий безкоштовно для всіх авторизованих читачів. Увійдіть через Google, пароль чи біометрію — і весь текст{activeWork.hasPdf ? ' та PDF-документ' : ''} одразу стане доступним у цьому вікні.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              trackClick(
                                `prose_auth_gate:${activeWork.id}`,
                                `Вхід для читання прози: «${activeWork.title}»`,
                                'action'
                              );
                              onOpenAuthModal();
                            }}
                            className="btn-editorial-primary min-h-[46px] px-6 py-3 text-sm"
                          >
                            <UserCheck className="w-4 h-4" />
                            <span>Увійти та читати безкоштовно</span>
                          </button>
                        </div>
                      </div>
                    ) : paywallView ==='offer'? (
                      <div className="space-y-5">
                        <div className="space-y-1.5">
                          <h4 className="font-serif text-2xl sm:text-3xl font-semibold text-[#141413] dark:text-[#F4F1EA] flex items-center gap-2">
                            <HryvniaIcon className="w-5 h-5 text-[#2C5937] dark:text-[#E5E5E5] shrink-0"/>
                            <span>Продовжити читання історії</span>
                          </h4>
                          <p className="text-sm text-[#5C5C58] dark:text-[#A8A49B] leading-relaxed">
                            {activeChapters.length > 0
                              ? `Обсяг твору — ${activeWork.pages} стор. (${activeChapters.length + 1} розд. у теці). Після оплати одразу відкриється весь твір та всі додані розділи.`
                              : activeWork.hasPdf
                                ?`Обсяг твору — ${activeWork.pages} стор. Після оплати PDF-документ${
                                    activeWork.pdfFileSize ?` (${formatFileSize(activeWork.pdfFileSize)})`:''
                                  } одразу відкриється для перегляду та завантаження.`
                                :`Обсяг повного тексту — ${activeWork.pages} стор. Після оплати весь твір одразу відкриється у цьому вікні.`}
                          </p>
                          {activeWorkHasDiscount ? (
                            <p className="text-xs font-medium text-[#1E563B] dark:text-[#E5E5E5]">
                              {activeWorkPricing.appliedSource === 'telegram'
                                ? `Для підписників Telegram-каналу діє знижка −${activeWorkAppliedDiscountPercent}%: ${activeWorkBasePrice} ₴ → ${activeWorkEffectivePrice} ₴.`
                                : `Для вашого акаунта діє знижка −${activeWorkAppliedDiscountPercent}%: ${activeWorkBasePrice} ₴ → ${activeWorkEffectivePrice} ₴.`}
                            </p>
                          ) : proseTelegramDiscountPercent > 0 && activeWorkPotentialTgPrice < activeWorkBasePrice ? (
                            <p className="text-xs font-medium text-[#1E563B] dark:text-[#E5E5E5]">
                              {`Для підписників Telegram-каналу діє знижка −${proseTelegramDiscountPercent}% (${activeWorkPotentialTgPrice} ₴ замість ${activeWorkBasePrice} ₴).`}
                            </p>
                          ) : (
                            proseAuthDiscountPercent > 0 && (
                              <p className="text-xs font-medium text-[#1E563B] dark:text-[#E5E5E5]">
                                {`Для авторизованих читачів діє спеціальна знижка −${proseAuthDiscountPercent}% (${activeWorkPotentialGuestPrice} ₴ замість ${activeWorkBasePrice} ₴).`}
                              </p>
                            )
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              trackClick(
`prose_unlock_start:${activeWork.id}`,
`Початок придбання прози: «${activeWork.title}»`,
'store'
                              );
                              if (guestUser) {
                                if (!buyerName.trim() && guestUser.displayName) {
                                  setBuyerName(guestUser.displayName);
                                }
                                if (!buyerEmail.trim() && guestUser.email) {
                                  setBuyerEmail(guestUser.email);
                                }
                              }
                              setPaywallView('checkout');
                              setPaymentError(null);
                            }}
                            className="btn-editorial-primary min-h-[46px] px-6 py-3 text-sm tabular-nums"
                          >
                            <HryvniaIcon className="w-4 h-4"/>
                            <span>
                              {activeWorkHasDiscount
                                ? `Читати повністю · ${activeWorkEffectivePrice} ₴`
                                : `Читати повністю · ${activeWorkBasePrice} ₴`}
                            </span>
                            {activeWorkHasDiscount && (
                              <span className="line-through opacity-75 text-xs">
                                {activeWorkBasePrice} ₴
                              </span>
                            )}
                          </button>

                          {!isTelegramSubscribed &&
                            proseTelegramDiscountPercent > 0 &&
                            onOpenTelegramModal &&
                            activeWorkPotentialTgPrice < activeWorkEffectivePrice && (
                              <button
                                type="button"
                                onClick={onOpenTelegramModal}
                                className="btn-editorial-secondary min-h-[46px] px-4 py-2.5 text-xs text-[#2C5937] dark:text-[#E5E5E5] tabular-nums"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>Підтвердити Telegram (−{proseTelegramDiscountPercent}%)</span>
                              </button>
                            )}

                          {!guestUser &&
                            proseAuthDiscountPercent > 0 &&
                            activeWorkPotentialGuestPrice < activeWorkEffectivePrice && (
                              <button
                                type="button"
                                onClick={onOpenAuthModal}
                                className="btn-editorial-secondary min-h-[46px] px-4 py-2.5 text-xs text-[#2C5937] dark:text-[#E5E5E5] tabular-nums"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                <span>Увійти зі знижкою −{proseAuthDiscountPercent}%</span>
                              </button>
                            )}

                          <button
                            type="button"
                            onClick={() => {
                              setShowRestoreBox((prev) => !prev);
                              setRestoreMessage(null);
                            }}
                            className="btn-editorial-secondary min-h-[46px] px-4 py-2.5 text-xs"
                          >
                            <BookOpen className="w-3.5 h-3.5"/>
                            <span>Вже купували? Відновити доступ</span>
                          </button>
                        </div>

                        {showRestoreBox && (
                          <form
                            onSubmit={handleRestoreProseAccess}
                            className="pt-4 space-y-2.5"
                          >
                            <label
                              htmlFor="prose-restore-input"
                              className="block text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B]"
                            >
                              Введіть email з квитанції або код замовлення (наприклад, AD-1042)
                            </label>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <input
                                id="prose-restore-input"
                                type="text"
                                value={restoreQuery}
                                onChange={(e) => setRestoreQuery(e.target.value)}
                                placeholder="reader@example.com або AD-1042"
                                className="input-editorial min-h-[44px] flex-1"
                              />
                              <button
                                type="submit"
                                disabled={restoring}
                                className="btn-editorial-ink min-h-[44px] px-4 py-2 text-xs"
                              >
                                <Search className="w-3.5 h-3.5"/>
                                <span>{restoring ?'Перевірка...':'Відкрити'}</span>
                              </button>
                            </div>
                            {restoreMessage && (
                              <p
                                className={`text-xs ${
                                  restoreMessage.ok
                                    ?'text-emerald-700 dark:text-[#E5E5E5] font-medium'
                                    :'text-rose-700 dark:text-rose-400'
                                }`}
                                role="status"
                              >
                                {restoreMessage.text}
                              </p>
                            )}
                          </form>
                        )}
                      </div>
                    ) : (
                      /* Monobank-Only Checkout Flow */
                      pendingMonobankInvoice && pendingMonobankInvoice.workId === activeWork.id ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setPendingMonobankInvoice(null);
                                setPaymentError(null);
                              }}
                              className="inline-flex items-center gap-1.5 min-h-[36px] -ml-1.5 px-1.5 text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#2C5937] dark:hover:text-white rounded-lg transition-colors cursor-pointer"
                            >
                              <ArrowLeft className="w-3.5 h-3.5" />
                              <span>Змінити дані</span>
                            </button>

                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141413] text-white text-[11px] font-semibold tracking-tight">
                              <span>Монобанк</span>
                              <span className="text-white/50">·</span>
                              <span className="font-mono tabular-nums">{pendingMonobankInvoice.amountUah} ₴</span>
                            </span>
                          </div>

                          <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-[#262626] space-y-3">
                            <p className="text-sm font-semibold text-[#141413] dark:text-[#F4F1EA]">
                              Рахунок Монобанк створено
                            </p>
                            <p className="text-xs text-[#5C5C58] dark:text-[#A8A49B] leading-relaxed">
                              Перейдіть на сторінку оплати Монобанк для підтвердження платежу через застосунок Монобанк. Після оплати доступ відкриється автоматично.
                            </p>

                            {pendingMonobankInvoice.statusText && (
                              <p className="text-xs font-medium text-[#2C5937] dark:text-[#E5E5E5]" role="status">
                                {pendingMonobankInvoice.statusText}
                              </p>
                            )}

                            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                              <a
                                href={pendingMonobankInvoice.pageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[46px] px-5 py-2.5 rounded-xl bg-[#141413] dark:bg-white text-white dark:text-[#141413] text-xs sm:text-sm font-semibold hover:opacity-92 transition-opacity"
                              >
                                <span>Відкрити оплату Монобанк</span>
                                <ExternalLink className="w-4 h-4 shrink-0" />
                              </a>

                              <button
                                type="button"
                                disabled={checkingMonobankStatus}
                                onClick={() =>
                                  checkMonobankInvoiceStatus(activeWork, pendingMonobankInvoice.invoiceId, {
                                    manual: true,
                                  })
                                }
                                className="btn-editorial-secondary min-h-[46px] px-4 py-2.5 text-xs"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${checkingMonobankStatus ? 'animate-spin' : ''}`} />
                                <span>{checkingMonobankStatus ? 'Перевірка...' : 'Я оплатив(ла)'}</span>
                              </button>
                            </div>
                          </div>

                          {paymentError && (
                            <p className="text-xs text-rose-700 dark:text-rose-400 font-medium" role="alert">
                              {paymentError}
                            </p>
                          )}
                        </div>
                      ) : (
                        <form onSubmit={handlePurchaseProse} className="space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setPaywallView('offer');
                                setPaymentError(null);
                              }}
                              className="inline-flex items-center gap-1.5 min-h-[36px] -ml-1.5 px-1.5 text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#2C5937] dark:hover:text-white rounded-lg transition-colors cursor-pointer"
                            >
                              <ArrowLeft className="w-3.5 h-3.5"/>
                              <span>Назад</span>
                            </button>

                            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-800 dark:text-[#E5E5E5]">
                              <Lock className="w-3 h-3" />
                              <span>Монобанк · E2EE</span>
                            </span>
                          </div>

                          <div className="p-3.5 sm:p-4 rounded-xl bg-[#141413] dark:bg-[#262626] text-white flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold tracking-tight">
                                Оплата тільки через Монобанк
                              </p>
                              <p className="text-[11px] text-white/70 mt-0.5 truncate">
                                Повний доступ до «{activeWork.title}»
                              </p>
                            </div>
                            <div className="text-right shrink-0 font-mono tabular-nums">
                              {activeWorkHasDiscount && (
                                <span className="block text-[11px] line-through text-white/55">
                                  {activeWorkBasePrice} ₴
                                </span>
                              )}
                              <span className="text-base sm:text-lg font-bold text-[#E5E5E5]">
                                {activeWorkEffectivePrice} ₴
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label
                                htmlFor="prose-buyer-name"
                                className="block text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] mb-1.5"
                              >
                                Ім’я та прізвище
                              </label>
                              <input
                                id="prose-buyer-name"
                                type="text"
                                required
                                autoComplete="name"
                                value={buyerName}
                                onChange={(e) => setBuyerName(e.target.value)}
                                placeholder="Олена Ковальчук"
                                className="input-editorial min-h-[44px]"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor="prose-buyer-email"
                                className="block text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] mb-1.5"
                              >
                                Email для доступу й квитанції
                              </label>
                              <input
                                id="prose-buyer-email"
                                type="email"
                                required
                                autoComplete="email"
                                value={buyerEmail}
                                onChange={(e) => setBuyerEmail(e.target.value)}
                                placeholder="reader@example.com"
                                className="input-editorial min-h-[44px]"
                              />
                            </div>
                          </div>

                          {paymentError && (
                            <p className="text-xs text-rose-700 dark:text-rose-400 font-medium" role="alert">
                              {paymentError}
                            </p>
                          )}

                          {!monobankAcquiringEnabled && (
                            <p className="text-xs text-amber-800 dark:text-amber-300 font-medium" role="status">
                              Онлайн-еквайринг Монобанк наразі не налаштовано на сервері.
                            </p>
                          )}

                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-1">
                            <p className="text-[11px] text-[#5C5C58] dark:text-[#A8A49B]">
                              Миттєве відкриття тексту після підтвердження платежу через Монобанк.
                            </p>

                            <button
                              type="submit"
                              disabled={submittingPayment || !monobankAcquiringEnabled}
                              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[48px] px-6 py-3 rounded-xl bg-[#141413] dark:bg-white text-white dark:text-[#141413] text-sm font-semibold hover:opacity-92 active:scale-[0.98] transition-all duration-150 cursor-pointer disabled:opacity-55 tabular-nums whitespace-nowrap shrink-0"
                            >
                              <span>
                                {submittingPayment
                                  ? 'Оформлення Монобанк...'
                                  : `Оплатити через Монобанк · ${activeWorkEffectivePrice} ₴`}
                              </span>
                            </button>
                          </div>
                        </form>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* Integrated Direct Rating + Collapsible Reviews Block (Matching Poetry Section) */}
              <div
                ref={reviewsDockRef}
                className="mt-8 pt-6 max-w-[65ch] mx-auto space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 py-1">
                  {/* Direct Inline Swipe Star Rating (authorized) OR Sign-in Notice (guests) */}
                  {guestUser ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <SwipeStarRating
                        value={pendingRating ?? activeWork.userRating ?? activeWork.ratingAverage}
                        onChange={(val) => {
                          setPendingRating(val);
                          setRatingFeedback(null);
                        }}
                        locked={activeWork.userRating !== null || ratingSubmittingId === activeWork.id}
                        size="sm"
                        showValue="active"
                        ariaLabel={`Оцінити твір «${activeWork.title}» від 0.1 до 5.0`}
                      />

                      <div className="flex items-center gap-2 text-xs text-[#5C5C58] dark:text-[#A8A49B] font-mono tabular-nums">
                        {pendingRating !== null && activeWork.userRating === null ? (
                          <span className="text-[#2C5937] dark:text-[#E5E5E5] font-semibold">
                            Обрано · {pendingRating.toFixed(1)} / 5.0
                          </span>
                        ) : activeWork.ratingCount > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Star className="w-3 h-3 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                            <strong className="text-[#141413] dark:text-[#F4F1EA] font-semibold">
                              {activeWork.ratingAverage.toFixed(1)}
                            </strong>
                            <span>({activeWork.ratingCount})</span>
                          </span>
                        ) : (
                          <span>Оцінити</span>
                        )}

                        {activeWork.userRating !== null && (
                          <>
                            <span aria-hidden="true" className="text-[#C8C4BA] dark:text-[#454545]">·</span>
                            <span className="text-[#1E563B] dark:text-[#E5E5E5] font-medium">
                              Ваша: {activeWork.userRating.toFixed(1)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 min-h-[24px]">
                      {activeWork.ratingCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs font-mono tabular-nums text-[#5C5C58] dark:text-[#A8A49B]">
                          <Star className="w-3.5 h-3.5 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                          <strong className="text-[#141413] dark:text-[#F4F1EA] font-semibold">
                            {activeWork.ratingAverage.toFixed(1)}
                          </strong>
                          <span>({activeWork.ratingCount})</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Collapsible Reviews Toggle Button */}
                  <button
                    type="button"
                    onClick={() => setCommentsOpen((prev) => !prev)}
                    aria-expanded={commentsOpen}
                    title="Відгуки"
                    aria-label="Відгуки"
                    className="btn-editorial-icon"
                  >
                    <MessageSquare className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                </div>

                {!guestUser && !commentsOpen && (
                  <div className="w-full flex flex-col items-center text-center gap-2.5 pt-4 pb-1">
                    <p className="text-xs sm:text-sm text-[#5C5C58] dark:text-[#A8A49B]">
                      Щоб залишити оцінку або відгук
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        trackClick(`prose_rate_auth:${activeWork.id}`, 'Увійти для оцінки прози', 'action');
                        onOpenAuthModal();
                      }}
                      className="btn-editorial-primary w-full max-w-xs min-h-[42px] px-6 py-2.5 text-xs font-semibold justify-center"
                    >
                      Увійти
                    </button>
                  </div>
                )}



                {ratingFeedback?.workId === activeWork.id && (
                  <p
                    className={`text-xs font-medium ${
                      ratingFeedback.isError
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-[#1E563B] dark:text-[#E5E5E5]'
                    }`}
                  >
                    {ratingFeedback.text}
                  </p>
                )}

                {/* Unboxed Rating Confirmation Dock */}
                <AnimatePresence initial={false}>
                  {pendingRating !== null && activeWork.userRating === null && !commentsOpen && (
                    <m.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      className="pt-2"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                        <button
                          type="button"
                          disabled={ratingSubmittingId === activeWork.id}
                          onClick={() => handleConfirmRating(activeWork, pendingRating)}
                          className="touch-surface order-1 sm:order-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-5 py-2 text-xs font-semibold tracking-[0.01em] text-white bg-pear-pine-gradient active:scale-[0.97] rounded-xl shadow-[0_6px_16px_-8px_rgba(30,58,41,0.5)] transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-55 disabled:pointer-events-none"
                        >
                          <Check className="w-3.5 h-3.5" strokeWidth={2.2} />
                          <span>
                            {ratingSubmittingId === activeWork.id
                              ? 'Збереження...'
                              : 'Підтвердити оцінку'}
                          </span>
                        </button>

                        <div className="order-2 sm:contents flex items-center justify-between gap-2.5">
                          <button
                            type="button"
                            onClick={() => setPendingRating(null)}
                            className="touch-surface sm:order-1 inline-flex items-center justify-center min-h-[44px] sm:min-h-[40px] px-3.5 py-2 text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-[#F4F1EA] hover:bg-[#EFECE6] dark:hover:bg-[#323232] rounded-xl transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Скасувати
                          </button>

                          <button
                            type="button"
                            onClick={() => setCommentsOpen(true)}
                            className="touch-surface sm:order-2 sm:ml-auto flex-1 sm:flex-none inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2 text-xs font-medium text-[#141413] dark:text-[#F4F1EA] bg-transparent hover:bg-[#EFECE6] dark:hover:bg-[#323232] active:scale-[0.97] rounded-xl transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5" strokeWidth={1.75} />
                            <span>Додати коментар</span>
                          </button>
                        </div>
                      </div>
                    </m.div>
                  )}
                </AnimatePresence>

                {/* Inline Collapsible Comments (Linked Directly with Prose Rating) */}
                {commentsOpen && (
                  <div className="pt-2">
                    <ReviewsBlock
                      targetType="prose"
                      targetId={activeWork.id}
                      ratingAverage={activeWork.ratingAverage}
                      ratingCount={activeWork.ratingCount}
                      reviews={activeWork.reviews}
                      guestUser={guestUser}
                      getGuestToken={getGuestToken}
                      isAdmin={isAdmin}
                      getAdminToken={getAdminToken}
                      onOpenAuthModal={onOpenAuthModal}
                      compact
                      hideRatingSummary
                      linkedRating={pendingRating}
                      onLinkedRatingChange={setPendingRating}
                      userHasRated={activeWork.userRating !== null}
                      userRatingValue={activeWork.userRating}
                      onReviewSubmitted={({ prose }) => {
                        if (prose) onProseUpdated(prose);
                      }}
                    />
                  </div>
                )}
              </div>
              </div>
            </m.div>
          </m.div>
        )}
          </AnimatePresence>,
          document.body
        )}

      {/* Cover / Moodboard Photo Lightbox */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {lightboxState && (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-[70] bg-black/88 backdrop-blur-xs flex flex-col items-center justify-center p-4 sm:p-6"
                onClick={() => setLightboxState(null)}
                role="dialog"
                aria-modal="true"
                aria-label={lightboxState.alt}
              >
                <button
                  type="button"
                  onClick={() => setLightboxState(null)}
                  aria-label="Закрити перегляд фото"
                  className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>

                {lightboxState.urls.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxState((prev) =>
                          prev
                            ? {
                                ...prev,
                                index: (prev.index - 1 + prev.urls.length) % prev.urls.length,
                              }
                            : null
                        );
                      }}
                      aria-label="Попереднє фото"
                      className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center cursor-pointer transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxState((prev) =>
                          prev ? { ...prev, index: (prev.index + 1) % prev.urls.length } : null
                        );
                      }}
                      aria-label="Наступне фото"
                      className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center cursor-pointer transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}

                <img
                  src={lightboxState.urls[lightboxState.index] || lightboxState.urls[0]}
                  alt={lightboxState.alt}
                  referrerPolicy="no-referrer"
                  onClick={(e) => e.stopPropagation()}
                  className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
                />

                {lightboxState.urls.length > 1 && (
                  <div className="mt-3 text-xs font-mono text-white/75 tabular-nums">
                    {lightboxState.index + 1} / {lightboxState.urls.length}
                  </div>
                )}
              </m.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      <SubmitProseModal
        isOpen={submitModalOpen}
        guestUser={guestUser}
        getGuestToken={getGuestToken}
        onClose={() => setSubmitModalOpen(false)}
        onOpenAuthModal={onOpenAuthModal}
        onOpenPublishedProse={handleOpenPublishedFromModal}
      />
    </section>
  );
}
