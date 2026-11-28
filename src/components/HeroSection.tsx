import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Headphones,
  Heart,
  LogIn,
  Mail,
  Pencil,
  RefreshCw,
  Settings2,
  User,
  X,
} from 'lucide-react';
import { AnimatePresence, m, type Variants } from 'motion/react';
import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useViewportActivity } from '../hooks/useViewportActivity.ts';
import type {
  FeedbackRecord,
  GuestUser,
  InterviewLinkItem,
  SocialLinkItem,
} from '../types.ts';
import { trackClick } from '../utils/analytics.ts';
import { sanitizeSafeHref } from '../utils/urlRouting.ts';
import { EditorialImage } from './EditorialImage.tsx';
import { SignatureLogo } from './SignatureLogo.tsx';
import { SocialPlatformIcon } from './SocialIcons.tsx';
import { TopUtilityDropdown } from './TopUtilityDropdown.tsx';

const HERO_CENTER_SLIDE_VARIANTS: Variants = {
  enter: (dir: 1 | -1) => ({
    opacity: 0,
    x: dir * 18,
    scale: 1.03,
    zIndex: 2,
  }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
    zIndex: 2,
    transition: {
      opacity: { duration: 1.05, ease: [0.25, 0.1, 0.25, 1] as const },
      x: { duration: 1.15, ease: [0.22, 1, 0.36, 1] as const },
      scale: { duration: 1.25, ease: [0.22, 1, 0.36, 1] as const },
    },
  },
  exit: (dir: 1 | -1) => ({
    opacity: [1, 0.92, 0],
    x: dir * -14,
    scale: 0.975,
    zIndex: 1,
    transition: {
      opacity: { duration: 1.05, times: [0, 0.65, 1], ease: 'easeInOut' },
      x: { duration: 1.15, ease: [0.32, 0, 0.2, 1] as const },
      scale: { duration: 1.15, ease: [0.32, 0, 0.2, 1] as const },
    },
  }),
};

const HERO_SIDE_SLIDE_VARIANTS: Variants = {
  enter: (dir: 1 | -1) => ({
    opacity: 0,
    x: dir * 12,
    scale: 1.03,
    zIndex: 2,
  }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
    zIndex: 2,
    transition: {
      opacity: { duration: 1.0, ease: [0.25, 0.1, 0.25, 1] as const },
      x: { duration: 1.1, ease: [0.22, 1, 0.36, 1] as const },
      scale: { duration: 1.2, ease: [0.22, 1, 0.36, 1] as const },
    },
  },
  exit: (dir: 1 | -1) => ({
    opacity: [1, 0.9, 0],
    x: dir * -10,
    scale: 0.97,
    zIndex: 1,
    transition: {
      opacity: { duration: 1.0, times: [0, 0.6, 1], ease: 'easeInOut' },
      x: { duration: 1.1, ease: [0.32, 0, 0.2, 1] as const },
      scale: { duration: 1.1, ease: [0.32, 0, 0.2, 1] as const },
    },
  }),
};

interface HeroSectionProps {
  heroLeadText: string;
  authorAboutText: string;
  authorPhotoUrl: string;
  authorPhotos?: string[];
  socialLinks: SocialLinkItem[];
  monobankJarUrl?: string;
  monobankModalTitle?: string;
  monobankModalSubtitle?: string;
  monobankCardLabel?: string;
  monobankModalText?: string;
  monobankEmptyText?: string;
  contactEmail?: string;
  interviews?: InterviewLinkItem[];
  homeActionAboutTitle?: string;
  homeActionContactTitle?: string;
  homeActionMonobankTitle?: string;
  homeActionInterviewsTitle?: string;
  onHeroLeadUpdated: (nextText: string) => void;
  onAuthorAboutUpdated: (nextAbout: string) => void;
  onContactEmailUpdated?: (nextEmail: string) => void;
  onSocialLinksUpdated?: (nextLinks: SocialLinkItem[]) => void;
  onOpenAuthorStudio: () => void;
  onOpenAuthModal: () => void;
  onSecretAdminTrigger: () => void;
  guestUser: GuestUser | null;
  getGuestToken?: (forceRefresh?: boolean) => Promise<string | null>;
  siteFeedbackItems?: FeedbackRecord[];
  onSiteFeedbackItemsChange?: (items: FeedbackRecord[]) => void;
  unreadFeedbackRepliesCount?: number;
  onFeedbackRepliesMarkedRead?: () => void;
  isAdmin: boolean;
  getAdminToken: () => Promise<string | null>;
  isRadioEnabled: boolean;
  onToggleRadio: () => void;
  isRadioPlaying?: boolean;
  showcaseNode?: ReactNode;
  onOpenLeaderboard: () => void;
  onOpenChat: () => void;
  onOpenRadio: () => void;
  onOpenWeeklyMusic?: () => void;
  hasUnreadReply?: boolean;
}

function HomeActionIcon({ kind }: { kind: 'about' | 'contact' | 'monobank' | 'interviews' }) {
  if (kind === 'about') {
    return (
      <svg
        viewBox="0 0 24 24"
        className="w-[19px] h-[19px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path
          d="M2.25 12s3.75-6.25 9.75-6.25S21.75 12 21.75 12s-3.75 6.25-9.75 6.25S2.25 12 2.25 12Z"
          fill="currentColor"
          fillOpacity="0.22"
        />
        <circle cx="12" cy="12" r="3.1" fill="currentColor" fillOpacity="0.35" />
        <circle cx="12" cy="12" r="0.95" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (kind === 'contact') {
    return (
      <svg
        viewBox="0 0 24 24"
        className="w-[19px] h-[19px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path
          d="M4.1 12.2c0-4.4 3.55-7.7 7.9-7.7s7.9 3.3 7.9 7.7c0 2.4-1.35 4.35-3.65 5.4l-.85 1.9H8.6l-.85-1.9c-2.3-1.05-3.65-3-3.65-5.4Z"
          fill="currentColor"
          fillOpacity="0.22"
        />
        <path d="M12 19V5.4" strokeOpacity="0.75" />
        <path d="M10.75 19 7.5 7.3" strokeOpacity="0.7" />
        <path d="M13.25 19 16.5 7.3" strokeOpacity="0.7" />
      </svg>
    );
  }

  if (kind === 'monobank') {
    return (
      <svg
        viewBox="0 0 24 24"
        className="w-[19px] h-[19px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path
          d="M12 20.1s-7.25-4.55-7.25-10.1a4.35 4.35 0 0 1 7.25-3.22A4.35 4.35 0 0 1 19.25 10c0 5.55-7.25 10.1-7.25 10.1Z"
          fill="currentColor"
          fillOpacity="0.25"
        />
        <path d="M8.5 9.65a1.85 1.85 0 0 1 1.65-1.35" strokeOpacity="0.8" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className="w-[19px] h-[19px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M3.2 17.2 9.8 11.4C11 8.5 13 5.2 16 5.2c1.7 0 3 1.1 3.3 2.4l2.1.7-2 1.2c-.2 3.9-3 6.9-7.2 7.1l-6 1.2-3-.6Z"
        fill="currentColor"
        fillOpacity="0.22"
      />
      <path d="M9.6 13.7c1.9 0 4.1-1.2 5.2-3.1" strokeOpacity="0.8" />
      <path d="M11.6 16.6v3M14.4 16.2v3.4" strokeOpacity="0.85" />
      <circle cx="16.8" cy="7.6" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export const HeroSection = memo(function HeroSection({
  heroLeadText: _heroLeadText,
  authorAboutText,
  authorPhotoUrl,
  authorPhotos = [],
  socialLinks,
  monobankJarUrl = '',
  monobankModalTitle = 'Підтримати через Монобанк',
  monobankModalSubtitle = '',
  monobankCardLabel = 'Банка Монобанку',
  monobankModalText = '',
  monobankEmptyText = '',
  contactEmail = '',
  interviews = [],
  homeActionAboutTitle = 'Про мене',
  homeActionContactTitle = 'Зв’язок',
  homeActionMonobankTitle = 'Підтримати через Монобанк',
  homeActionInterviewsTitle = 'Розмови',
  onHeroLeadUpdated: _onHeroLeadUpdated,
  onAuthorAboutUpdated,
  onContactEmailUpdated,
  onSocialLinksUpdated,
  onOpenAuthorStudio,
  onOpenAuthModal,
  onSecretAdminTrigger,
  guestUser,
  getGuestToken,
  siteFeedbackItems,
  onSiteFeedbackItemsChange,
  unreadFeedbackRepliesCount = 0,
  onFeedbackRepliesMarkedRead,
  isAdmin,
  getAdminToken,
  isRadioEnabled,
  onToggleRadio,
  isRadioPlaying = false,
  showcaseNode,
  onOpenLeaderboard,
  onOpenChat,
  onOpenRadio,
  onOpenWeeklyMusic,
  hasUnreadReply = false,
}: HeroSectionProps) {
  const [editingAbout, setEditingAbout] = useState(false);
  const [aboutDraft, setAboutDraft] = useState(authorAboutText);
  const [savingAbout, setSavingAbout] = useState(false);
  const [aboutError, setAboutError] = useState<string | null>(null);

  // Homepage quick-action modals
  const [activeModal, setActiveModal] = useState<'about' | 'contact' | 'monobank' | 'interviews' | null>(null);
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null);
  const modalScrollRef = useRef<HTMLDivElement | null>(null);
  const [editingContact, setEditingContact] = useState(false);
  const [contactEmailDraft, setContactEmailDraft] = useState(contactEmail);
  const [contactTelegramDraft, setContactTelegramDraft] = useState(
    () => socialLinks.find((s) => s.platform === 'telegram')?.url || ''
  );
  const [savingContact, setSavingContact] = useState(false);
  const [contactEditError, setContactEditError] = useState<string | null>(null);
  const [copiedMonobank, setCopiedMonobank] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Live Monobank jar tracking state
  const MONOBANK_INTENT_STORAGE_KEY = 'dankiv_pending_monobank_intent';
  const [jarInfo, setJarInfo] = useState<{
    enabled: boolean;
    title?: string;
    amountUah?: number;
    goalUah?: number | null;
  } | null>(null);
  const [jarIntentId, setJarIntentId] = useState<string | null>(null);
  const [donorNameDraft, setDonorNameDraft] = useState('');
  const [jarCheckState, setJarCheckState] = useState<'idle' | 'watching' | 'checking' | 'credited'>('idle');
  const [creditedAmountUah, setCreditedAmountUah] = useState<number | null>(null);
  const [jarStatusNote, setJarStatusNote] = useState<string | null>(null);

  const selectedInterview =
    activeModal === 'interviews' && selectedInterviewId
      ? interviews.find((item) => item.id === selectedInterviewId) || null
      : null;

  const [failedPhotoUrls, setFailedPhotoUrls] = useState<Record<string, true>>({});
  const galleryRef = useRef<HTMLDivElement | null>(null);
  const galleryActivity = useViewportActivity(galleryRef);

  const galleryPhotos = useMemo(() => {
    const raw = (authorPhotos && authorPhotos.length > 0 ? authorPhotos : [authorPhotoUrl])
      .map((url) => (typeof url === 'string' ? url.trim() : ''))
      .filter(Boolean);
    const unique = Array.from(new Set(raw)).filter((url) => !failedPhotoUrls[url]);
    if (unique.length > 0) return unique;
    const fallbackPortrait = '/src/assets/images/author_portrait_desk_1795025673568.webp';
    if (!failedPhotoUrls[authorPhotoUrl] && authorPhotoUrl) return [authorPhotoUrl];
    return [fallbackPortrait];
  }, [authorPhotos, authorPhotoUrl, failedPhotoUrls]);

  const handleMarkPhotoFailed = (url: string) => {
    if (!url || url.startsWith('/src/assets/')) return;
    setFailedPhotoUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [photoDirection, setPhotoDirection] = useState<1 | -1>(1);
  const [isGalleryPaused, setIsGalleryPaused] = useState(false);

  const safePhotoIndex =
    galleryPhotos.length > 0 ? activePhotoIndex % galleryPhotos.length : 0;
  const currentGalleryPhoto = galleryPhotos[safePhotoIndex] || authorPhotoUrl;
  const prevPhotoIndex =
    galleryPhotos.length > 1
      ? (safePhotoIndex - 1 + galleryPhotos.length) % galleryPhotos.length
      : 0;
  const nextPhotoIndex =
    galleryPhotos.length > 1
      ? (safePhotoIndex + 1) % galleryPhotos.length
      : 0;
  const prevGalleryPhoto = galleryPhotos[prevPhotoIndex] || authorPhotoUrl;
  const nextGalleryPhoto = galleryPhotos[nextPhotoIndex] || authorPhotoUrl;

  const tapCounterRef = useRef<{ count: number; lastTap: number }>({ count: 0, lastTap: 0 });

  const handleColophonTap = () => {
    const now = Date.now();
    if (now - tapCounterRef.current.lastTap > 1200) {
      tapCounterRef.current = { count: 1, lastTap: now };
    } else {
      tapCounterRef.current = { count: tapCounterRef.current.count + 1, lastTap: now };
    }
    if (tapCounterRef.current.count >= 3) {
      tapCounterRef.current = { count: 0, lastTap: 0 };
      if (!isAdmin) {
        onSecretAdminTrigger();
      }
    }
  };

  useEffect(() => {
    setAboutDraft(authorAboutText);
  }, [authorAboutText]);

  useEffect(() => {
    setActivePhotoIndex(0);
  }, [galleryPhotos.length]);

  useEffect(() => {
    if (galleryPhotos.length <= 1 || typeof Image === 'undefined') return;
    let cancelled = false;
    const warmSecondaryPhotos = () => {
      if (cancelled) return;
      galleryPhotos.slice(1).forEach((src) => {
        const img = new Image();
        img.src = src;
      });
    };
    let idleId: number | null = null;
    let timerId: number | null = null;
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(warmSecondaryPhotos, { timeout: 2000 });
    } else {
      timerId = window.setTimeout(warmSecondaryPhotos, 900);
    }
    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [galleryPhotos]);

  useEffect(() => {
    if (galleryPhotos.length <= 1 || typeof Image === 'undefined') return;
    const lookAheadIndices = [
      prevPhotoIndex,
      nextPhotoIndex,
      (safePhotoIndex + 2) % galleryPhotos.length,
      (safePhotoIndex - 2 + galleryPhotos.length) % galleryPhotos.length,
    ];
    const seen = new Set<string>();
    lookAheadIndices.forEach((idx) => {
      const src = galleryPhotos[idx];
      if (!src || seen.has(src)) return;
      seen.add(src);
      const img = new Image();
      img.src = src;
      if (typeof img.decode === 'function') {
        img.decode().catch(() => {});
      }
    });
  }, [galleryPhotos, prevPhotoIndex, nextPhotoIndex, safePhotoIndex]);

  useEffect(() => {
    if (
      galleryPhotos.length <= 1 ||
      isGalleryPaused ||
      activeModal !== null ||
      !galleryActivity.isActive
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setPhotoDirection(1);
      setActivePhotoIndex((prev) => (prev + 1) % galleryPhotos.length);
    }, 4800);
    return () => window.clearInterval(timer);
  }, [galleryPhotos.length, isGalleryPaused, activeModal, safePhotoIndex, galleryActivity.isActive]);

  const handleNextGalleryPhoto = () => {
    if (galleryPhotos.length <= 1) return;
    setPhotoDirection(1);
    setActivePhotoIndex((prev) => (prev + 1) % galleryPhotos.length);
  };

  const handlePrevGalleryPhoto = () => {
    if (galleryPhotos.length <= 1) return;
    setPhotoDirection(-1);
    setActivePhotoIndex((prev) => (prev - 1 + galleryPhotos.length) % galleryPhotos.length);
  };

  const handleSelectGalleryPhoto = (index: number) => {
    if (index === safePhotoIndex || galleryPhotos.length <= 1) return;
    setPhotoDirection(index > safePhotoIndex ? 1 : -1);
    setActivePhotoIndex(index);
  };

  useEffect(() => {
    if (!isAdmin && editingAbout) {
      setEditingAbout(false);
      setAboutError(null);
    }
    if (!isAdmin && editingContact) {
      setEditingContact(false);
      setContactEditError(null);
    }
  }, [isAdmin, editingAbout, editingContact]);

  useEffect(() => {
    setContactEmailDraft(contactEmail);
  }, [contactEmail]);

  useEffect(() => {
    setContactTelegramDraft(socialLinks.find((s) => s.platform === 'telegram')?.url || '');
  }, [socialLinks]);

  useEffect(() => {
    if (!activeModal) {
      setSelectedInterviewId(null);
      setEditingContact(false);
      setContactEditError(null);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeModal === 'interviews' && selectedInterviewId) {
          setSelectedInterviewId(null);
          return;
        }
        setActiveModal(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeModal, selectedInterviewId]);

  useEffect(() => {
    if (selectedInterviewId && modalScrollRef.current) {
      modalScrollRef.current.scrollTop = 0;
    }
  }, [selectedInterviewId]);

  const buildMonobankHeaders = async (withJson = false): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (withJson) headers['Content-Type'] = 'application/json';
    const token = await getGuestToken?.().catch(() => null);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  const ensureMonobankIntent = async (forceNew = false): Promise<string | null> => {
    if (!monobankJarUrl) return null;
    if (!forceNew && jarIntentId) return jarIntentId;
    try {
      if (!forceNew) {
        const raw = localStorage.getItem(MONOBANK_INTENT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            intentId?: string;
            createdAtMs?: number;
            donorName?: string;
          };
          if (
            parsed?.intentId &&
            typeof parsed.createdAtMs === 'number' &&
            Date.now() - parsed.createdAtMs < 55 * 60 * 1000
          ) {
            setJarIntentId(parsed.intentId);
            if (!guestUser && parsed.donorName && !donorNameDraft) {
              setDonorNameDraft(parsed.donorName);
            }
            return parsed.intentId;
          }
        }
      }
    } catch {
      // Ignore storage read failures
    }

    try {
      const headers = await buildMonobankHeaders(true);
      const res = await fetch('/api/monobank/jar/intent', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          donorName: guestUser?.displayName || donorNameDraft.trim() || undefined,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        intentId?: string;
        jarTitle?: string;
        amountUah?: number;
        goalUah?: number | null;
      };
      if (data.intentId) {
        setJarIntentId(data.intentId);
        if (typeof data.amountUah === 'number') {
          setJarInfo((prev) => ({
            enabled: true,
            title: data.jarTitle || prev?.title,
            amountUah: data.amountUah,
            goalUah: data.goalUah ?? prev?.goalUah ?? null,
          }));
        }
        try {
          localStorage.setItem(
            MONOBANK_INTENT_STORAGE_KEY,
            JSON.stringify({
              intentId: data.intentId,
              createdAtMs: Date.now(),
              donorName: guestUser?.displayName || donorNameDraft.trim() || undefined,
            })
          );
        } catch {
          // Ignore storage write failures
        }
        return data.intentId;
      }
      return null;
    } catch {
      return null;
    }
  };

  const checkMonobankDonation = async (manualTrigger = false) => {
    const activeId = jarIntentId || (await ensureMonobankIntent(false));
    if (!activeId) return;
    if (manualTrigger) {
      setJarCheckState('checking');
      setJarStatusNote(null);
    }
    try {
      const headers = await buildMonobankHeaders(true);
      const res = await fetch('/api/monobank/jar/check', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          intentId: activeId,
          donorName: !guestUser && donorNameDraft.trim() ? donorNameDraft.trim() : undefined,
        }),
      });
      if (!res.ok) {
        if (manualTrigger) {
          setJarCheckState('watching');
          setJarStatusNote('Поки не вдалося перевірити стан банки. Спробуйте за кілька секунд.');
        }
        return;
      }
      const data = (await res.json()) as {
        status?: 'pending' | 'credited' | 'expired';
        amountUah?: number;
        currentJarUah?: number;
      };
      if (typeof data.currentJarUah === 'number') {
        setJarInfo((prev) => (prev ? { ...prev, amountUah: data.currentJarUah } : prev));
      }
      if (data.status === 'credited' && typeof data.amountUah === 'number') {
        setJarCheckState('credited');
        setCreditedAmountUah(data.amountUah);
        setJarStatusNote(null);
        setJarIntentId(null);
        try {
          localStorage.removeItem(MONOBANK_INTENT_STORAGE_KEY);
        } catch {
          // Ignore storage removal errors
        }
        return;
      }
      if (data.status === 'expired') {
        try {
          localStorage.removeItem(MONOBANK_INTENT_STORAGE_KEY);
        } catch {
          // Ignore storage removal errors
        }
        setJarIntentId(null);
        const freshId = await ensureMonobankIntent(true);
        setJarCheckState(freshId ? 'watching' : 'idle');
        if (manualTrigger) {
          setJarStatusNote('Очікуємо надходження донату на банку...');
        }
        return;
      }
      if (manualTrigger) {
        setJarCheckState('watching');
        setJarStatusNote('Нового зарахування ще не зафіксовано. Monobank оновлює баланс протягом кількох секунд.');
      }
    } catch {
      if (manualTrigger) {
        setJarCheckState('watching');
        setJarStatusNote('Помилка перевірки з’єднання. Спробуйте ще раз.');
      }
    }
  };

  useEffect(() => {
    if (activeModal !== 'monobank' || !monobankJarUrl) return;
    let active = true;
    void fetch('/api/monobank/jar/info')
      .then((res) => (res.ok ? res.json() : null))
      .then((info) => {
        if (active && info && info.enabled) {
          setJarInfo(info);
        }
      })
      .catch(() => {});
    void ensureMonobankIntent(false);
    return () => {
      active = false;
    };
  }, [activeModal, monobankJarUrl]);

  useEffect(() => {
    if (activeModal !== 'monobank' || !monobankJarUrl || jarCheckState !== 'watching') return;
    const intervalId = window.setInterval(() => {
      void checkMonobankDonation(false);
    }, 4000);
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkMonobankDonation(false);
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [activeModal, monobankJarUrl, jarCheckState, jarIntentId, donorNameDraft, guestUser]);

  const handleOpenModal = (modal: 'about' | 'contact' | 'monobank' | 'interviews') => {
    trackClick(`home_action:${modal}`, `Головна: ${modal}`, 'action');
    if (modal === 'contact') {
      setEditingContact(false);
      setContactEditError(null);
      setContactEmailDraft(contactEmail);
      setContactTelegramDraft(socialLinks.find((s) => s.platform === 'telegram')?.url || '');
    }
    if (modal === 'about') {
      setEditingAbout(false);
      setAboutError(null);
    }
    if (modal === 'interviews') {
      setSelectedInterviewId(null);
    }
    if (modal === 'monobank') {
      setJarCheckState('idle');
      setCreditedAmountUah(null);
      setJarStatusNote(null);
    }
    setActiveModal(modal);
  };

  const handleSaveDirectContact = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdmin || savingContact) return;
    setSavingContact(true);
    setContactEditError(null);
    try {
      const token = await getAdminToken();
      if (!token) {
        setContactEditError('Потрібна авторизація в ролі Адміністратора.');
        return;
      }
      const rawTg = contactTelegramDraft.trim();
      const normalizedTg = rawTg
        ? rawTg.startsWith('@')
          ? `https://t.me/${rawTg.slice(1)}`
          : /^t\.me\//i.test(rawTg)
            ? `https://${rawTg}`
            : rawTg
        : '';

      const hasTelegramRow = socialLinks.some((row) => row.platform === 'telegram');
      const nextSocialLinks = hasTelegramRow
        ? socialLinks.map((row) =>
            row.platform === 'telegram'
              ? {
                  ...row,
                  url: normalizedTg,
                  enabled: normalizedTg.length > 0,
                }
              : row
          )
        : [
            ...socialLinks,
            {
              platform: 'telegram' as const,
              label: 'Telegram',
              url: normalizedTg,
              enabled: normalizedTg.length > 0,
            },
          ];

      const response = await fetch('/api/author/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          contactEmail: contactEmailDraft.trim(),
          socialLinks: nextSocialLinks,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setContactEditError(data.error || 'Не вдалося зберегти контакти.');
        return;
      }
      if (typeof data.contactEmail === 'string') {
        setContactEmailDraft(data.contactEmail);
        onContactEmailUpdated?.(data.contactEmail);
      }
      if (Array.isArray(data.socialLinks)) {
        const tg = (data.socialLinks as SocialLinkItem[]).find((s) => s.platform === 'telegram');
        setContactTelegramDraft(tg?.url || '');
        onSocialLinksUpdated?.(data.socialLinks);
      }
      setEditingContact(false);
    } catch {
      setContactEditError('Помилка з’єднання із сервером.');
    } finally {
      setSavingContact(false);
    }
  };

  const handleCopyText = async (value: string, kind: 'monobank' | 'email') => {
    try {
      await navigator.clipboard.writeText(value);
      if (kind === 'monobank') {
        setCopiedMonobank(true);
        window.setTimeout(() => setCopiedMonobank(false), 2000);
      } else {
        setCopiedEmail(true);
        window.setTimeout(() => setCopiedEmail(false), 2000);
      }
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleSaveAbout = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingAbout(true);
    setAboutError(null);
    try {
      const token = await getAdminToken();
      if (!token) {
        setAboutError('Потрібна авторизація в ролі Адміністратора.');
        return;
      }
      const response = await fetch('/api/author/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ authorAboutText: aboutDraft.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        setAboutError(data.error || 'Не вдалося зберегти текст.');
        return;
      }
      onAuthorAboutUpdated(data.authorAboutText);
      setEditingAbout(false);
    } catch {
      setAboutError('Помилка з’єднання із сервером.');
    } finally {
      setSavingAbout(false);
    }
  };

  const aboutParagraphs = authorAboutText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <section
      className="hero-pine-bg w-full relative flex-1 flex flex-col justify-between overflow-hidden text-pine-night dark:text-cream transition-colors duration-200"
    >

      {/* Top Utility Strip with Auth Button (left) and Radio & Settings Burger Menu (right) */}
      <header className="relative z-20 w-full max-w-5xl mx-auto px-3 sm:px-6 pt-4 sm:pt-5 flex flex-col items-end gap-2">
        <div className="w-full flex items-center justify-between gap-1.5 sm:gap-2 min-w-0">
          <div
            className="inline-flex shrink-0 items-center p-1 bg-paper-sand dark:bg-night-card rounded-xl gap-1 min-w-0"
            role="group"
            aria-label="Акаунт гостя, радіо та рейтинг"
          >
            <button
              type="button"
              onClick={() => {
                trackClick('header:radio', 'Кнопка радіо', 'section');
                onOpenRadio();
              }}
              aria-label={isRadioPlaying ? 'Радіостанція (в ефірі)' : 'Відкрити радіостанцію'}
              title={isRadioPlaying ? 'Радіостанція · В ефірі' : 'Радіостанція автора'}
              className={`group relative overflow-hidden touch-surface inline-flex items-center justify-center w-[38px] sm:w-[40px] h-[38px] sm:h-[40px] rounded-lg bg-[linear-gradient(135deg,#090D1A_0%,#141B33_50%,#1E1635_100%)] text-[#C7D2FE] shadow-[0_6px_16px_-6px_rgba(10,14,32,0.75),0_0_14px_-4px_rgba(129,140,248,0.38),inset_0_1px_0_rgba(255,255,255,0.18)] hover:shadow-[0_8px_20px_-6px_rgba(10,14,32,0.88),0_0_20px_-2px_rgba(167,139,250,0.55),inset_0_1px_0_rgba(255,255,255,0.28)] hover:scale-105 active:scale-[0.94] transition-all duration-200 shrink-0 cursor-pointer ${
                isRadioPlaying ? 'shadow-[0_0_20px_-2px_rgba(167,139,250,0.65)]' : ''
              }`}
            >
              {/* Nebula glow layers */}
              <span
                aria-hidden="true"
                style={{
                  background: 'radial-gradient(circle, rgba(99, 102, 241, 0.36) 0%, transparent 72%)',
                }}
                className="pointer-events-none absolute -left-2 -top-2 w-8 h-8 rounded-full opacity-85 group-hover:opacity-100 transition-opacity duration-300"
              />
              <span
                aria-hidden="true"
                style={{
                  background: 'radial-gradient(circle, rgba(168, 85, 247, 0.3) 0%, transparent 72%)',
                }}
                className="pointer-events-none absolute -right-2 -bottom-2 w-8 h-8 rounded-full opacity-85 group-hover:opacity-100 transition-opacity duration-300"
              />

              {/* Subtle starfield inside the button */}
              <svg
                aria-hidden="true"
                viewBox="0 0 40 40"
                fill="none"
                className="pointer-events-none absolute inset-0 w-full h-full opacity-80 group-hover:opacity-100 transition-opacity duration-300"
              >
                <circle cx="8" cy="9" r="0.65" fill="#E0E7FF" opacity="0.75" />
                <circle cx="32" cy="8" r="0.8" fill="#FDE68A" opacity="0.85" className="animate-pulse" />
                <circle cx="10" cy="31" r="0.6" fill="#C4B5FD" opacity="0.65" />
                <circle cx="31" cy="32" r="0.7" fill="#A5B4FC" opacity="0.7" />
              </svg>

              {/* Starlight sweep on hover */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/15 to-transparent"
              />

              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={`relative z-10 w-[18px] h-[18px] transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110 ${
                  isRadioPlaying ? 'animate-pulse' : ''
                }`}
              >
                <path d="M8.2 10.8 13.7 6.2" />
                <path d="M15.3 3.9a2.8 2.8 0 0 1 1.1 3" stroke="#A5B4FC" />
                <path d="M16.45 2.25a4.8 4.8 0 0 1 1.9 5.2" stroke="#C4B5FD" opacity="0.85" />
                <circle cx="13.7" cy="6.2" r="1.15" fill="#FDE68A" stroke="none" />
                <rect
                  x="4"
                  y="10.8"
                  width="16"
                  height="9.4"
                  rx="2.4"
                  className="fill-[#818CF8]/25"
                />
                <circle
                  cx="9.2"
                  cy="15.5"
                  r="2.2"
                  className="fill-[#A855F7]/25"
                />
                <circle cx="9.2" cy="15.5" r="0.65" fill="#E0E7FF" stroke="none" />
                <path d="M13.8 14h3.2" />
                <path d="M13.8 17h3.2" />
              </svg>
            </button>

            {onOpenWeeklyMusic && (
              <button
                type="button"
                onClick={() => {
                  trackClick('header:weekly_music', 'Кнопка музичних підбірок', 'section');
                  onOpenWeeklyMusic();
                }}
                aria-label="Щомісячні підбірки музики"
                title="Щомісячні підбірки музики"
                className="group relative overflow-hidden touch-surface inline-flex items-center justify-center w-[38px] sm:w-[40px] h-[38px] sm:h-[40px] rounded-lg bg-[#F7F0EE] dark:bg-[#2D1B1D] text-[#8B1E1E] dark:text-[#D13B3B] hover:bg-[#EFE3E0] dark:hover:bg-[#3A2225] shadow-[0_4px_12px_-6px_rgba(139,30,30,0.35),inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[0_6px_16px_-6px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)] hover:scale-105 active:scale-[0.94] transition-all duration-200 shrink-0 cursor-pointer"
              >
                <Headphones
                  className="relative z-10 w-[18px] h-[18px] transition-transform duration-300 group-hover:scale-110"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                trackClick('header:chat', 'Кнопка глобального чату', 'section');
                onOpenChat();
              }}
              aria-label={hasUnreadReply ? "Глобальний чат (є нові відповіді)" : "Глобальний чат спільноти"}
              title={hasUnreadReply ? "Є нова відповідь на ваш допис у чаті!" : "Глобальний чат"}
              className={`group relative overflow-hidden touch-surface inline-flex items-center justify-center w-[38px] sm:w-[40px] h-[38px] sm:h-[40px] rounded-lg transition-all duration-200 shrink-0 cursor-pointer ${
                hasUnreadReply
                  ? "bg-[linear-gradient(135deg,#3A1F04_0%,#4A2806_50%,#261502_100%)] text-[#FCD34D] shadow-[0_6px_20px_-4px_rgba(245,158,11,0.5),0_0_18px_-2px_rgba(251,191,36,0.5),inset_0_1px_0_rgba(255,255,255,0.25)] hover:scale-105 active:scale-[0.94]"
                  : "bg-[linear-gradient(135deg,#061816_0%,#0B2825_50%,#0D2335_100%)] text-[#A7F3D0] shadow-[0_6px_16px_-6px_rgba(6,24,22,0.8),0_0_14px_-4px_rgba(45,212,191,0.38),inset_0_1px_0_rgba(255,255,255,0.18)] hover:shadow-[0_8px_20px_-6px_rgba(6,24,22,0.9),0_0_20px_-2px_rgba(52,211,153,0.55),inset_0_1px_0_rgba(255,255,255,0.28)] hover:scale-105 active:scale-[0.94]"
              }`}
            >
              {hasUnreadReply ? (
                <>
                  <span
                    aria-hidden="true"
                    style={{
                      background: 'radial-gradient(circle, rgba(245, 158, 11, 0.45) 0%, transparent 72%)',
                    }}
                    className={`pointer-events-none absolute -left-2 -top-2 w-9 h-9 rounded-full ${
                      galleryActivity.isVisible && !galleryActivity.reducedMotion ? 'animate-pulse' : ''
                    }`}
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      background: 'radial-gradient(circle, rgba(217, 119, 6, 0.38) 0%, transparent 72%)',
                    }}
                    className="pointer-events-none absolute -right-2 -bottom-2 w-9 h-9 rounded-full"
                  />
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-[#F59E0B] ring-2 ring-[#261502] animate-ping" />
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-[#FCD34D] ring-2 ring-[#261502]" />

                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="relative z-10 w-[18px] h-[18px] text-[#FCD34D] transition-transform duration-300 group-hover:scale-110"
                  >
                    <path
                      d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
                      className="fill-[#F59E0B]/25"
                    />
                    <path d="M9 10h6" />
                    <path d="M9 13.5h3.5" />
                    <path d="M14 6l3 3-3 3" stroke="#FCD34D" strokeWidth={2} />
                  </svg>
                </>
              ) : (
                <>
                  {/* Aurora emerald-cyan glow layers */}
                  <span
                    aria-hidden="true"
                    style={{
                      background: 'radial-gradient(circle, rgba(16, 185, 129, 0.36) 0%, transparent 72%)',
                    }}
                    className="pointer-events-none absolute -left-2 -top-2 w-8 h-8 rounded-full opacity-85 group-hover:opacity-100 transition-opacity duration-300"
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      background: 'radial-gradient(circle, rgba(6, 182, 212, 0.3) 0%, transparent 72%)',
                    }}
                    className="pointer-events-none absolute -right-2 -bottom-2 w-8 h-8 rounded-full opacity-85 group-hover:opacity-100 transition-opacity duration-300"
                  />

                  {/* Subtle aurora glints inside the button */}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 40 40"
                    fill="none"
                    className="pointer-events-none absolute inset-0 w-full h-full opacity-80 group-hover:opacity-100 transition-opacity duration-300"
                  >
                    <circle cx="8" cy="9" r="0.65" fill="#CCFBF1" opacity="0.8" />
                    <circle cx="32" cy="9" r="0.75" fill="#6EE7B7" opacity="0.85" className="animate-pulse" />
                    <circle cx="9" cy="31" r="0.6" fill="#5EEAD4" opacity="0.65" />
                    <circle cx="31" cy="31" r="0.65" fill="#67E8F9" opacity="0.75" />
                  </svg>

                  {/* Light sweep on hover */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/15 to-transparent"
                  />

                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="relative z-10 w-[18px] h-[18px] transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110"
                  >
                    <path
                      d="M15.5 4.75h2.25A2.25 2.25 0 0 1 20 7v5.5a2.25 2.25 0 0 1-2.25 2.25H16.5v2.75l-2.6-2.25"
                      stroke="#67E8F9"
                      className="fill-[#06B6D4]/20"
                    />
                    <path
                      d="M4 6.75A2.25 2.25 0 0 1 6.25 4.5h8A2.25 2.25 0 0 1 16.5 6.75v5.5a2.25 2.25 0 0 1-2.25 2.25H9l-3.25 2.75V14.5H6.25A2.25 2.25 0 0 1 4 12.25v-5.5Z"
                      className="fill-[#10B981]/28"
                    />
                    <circle cx="7.75" cy="9.5" r="0.8" fill="#ECFDF5" stroke="none" />
                    <circle cx="10.25" cy="9.5" r="0.8" fill="#ECFDF5" stroke="none" />
                    <circle cx="12.75" cy="9.5" r="0.8" fill="#ECFDF5" stroke="none" />
                  </svg>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenAuthModal}
              aria-label={guestUser ? `Профіль: ${guestUser.displayName}` : 'Увійти в акаунт гостя'}
              title={
                guestUser
                  ? `${guestUser.displayName} · Налаштування швидкого входу`
                  : 'Увійти через Google або 4-значний ПІН-код'
              }
              className={`touch-surface inline-flex items-center justify-center gap-1.5 min-h-[38px] sm:min-h-[40px] px-1.5 sm:px-3.5 py-1.5 sm:py-2 text-[11px] sm:text-xs rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                guestUser
                  ? 'bg-white dark:bg-night-elevated text-ink dark:text-cream font-semibold shadow-xs'
                  : 'font-medium text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream'
              }`}
            >
              {guestUser ? (
                <>
                  {guestUser.photoUrl ? (
                    <img
                      src={guestUser.photoUrl}
                      alt={guestUser.displayName}
                      width={16}
                      height={16}
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="w-4 h-4 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <User className="w-3.5 h-3.5 text-pine dark:text-silver shrink-0" strokeWidth={1.85} />
                  )}
                  <span className="max-w-[58px] sm:max-w-[140px] truncate">
                    {guestUser.displayName}
                  </span>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5 shrink-0" strokeWidth={1.85} />
                  <span>Увійти</span>
                </>
              )}
            </button>
          </div>

          <TopUtilityDropdown
            isRadioEnabled={isRadioEnabled}
            onToggleRadio={onToggleRadio}
            isRadioPlaying={isRadioPlaying}
            guestUser={guestUser}
            getGuestToken={getGuestToken}
            siteFeedbackItems={siteFeedbackItems}
            onSiteFeedbackItemsChange={onSiteFeedbackItemsChange}
            unreadFeedbackRepliesCount={unreadFeedbackRepliesCount}
            onFeedbackRepliesMarkedRead={onFeedbackRepliesMarkedRead}
            onOpenLeaderboard={onOpenLeaderboard}
          />
        </div>
      </header>

      {/* Author Identity, Full-Width Frameless Gallery & Quick Actions */}
      <div className="relative z-10 w-full flex flex-col items-center">
        <m.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-4xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-6 sm:pb-8 flex flex-col items-center text-center"
        >
          <h1 onClick={handleColophonTap} className="flex flex-col items-center">
            <span className="sr-only">Андрій Даньків</span>
            <SignatureLogo />
          </h1>
        </m.div>

        {/* Full-Width Frameless Author Photo Gallery */}
        <m.div
          ref={galleryRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.42, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
          onPointerEnter={() => {
            if (galleryPhotos.length > 1) setIsGalleryPaused(true);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setIsGalleryPaused(false);
          }}
          className="group relative z-10 w-full h-[340px] sm:h-[440px] md:h-[520px] lg:h-[580px] overflow-hidden select-none"
        >
          <div
            onClick={galleryPhotos.length > 1 ? handleNextGalleryPhoto : undefined}
            className={`relative w-full h-full ${galleryPhotos.length > 1 ? 'cursor-pointer' : ''}`}
            role={galleryPhotos.length > 1 ? 'region' : undefined}
            aria-roledescription={galleryPhotos.length > 1 ? 'carousel' : undefined}
            aria-label="Галерея фото Андрія Даньківа"
          >
            <AnimatePresence initial={false} mode="sync" custom={photoDirection}>
              <m.div
                key={`${currentGalleryPhoto}-${safePhotoIndex}`}
                custom={photoDirection}
                variants={HERO_CENTER_SLIDE_VARIANTS}
                initial="enter"
                animate="center"
                exit="exit"
                style={{ willChange: 'transform, opacity' }}
                className="absolute inset-0"
              >
                <EditorialImage
                  src={currentGalleryPhoto}
                  alt={`Андрій Даньків — фото автора${
                    galleryPhotos.length > 1 ? ` (${safePhotoIndex + 1} з ${galleryPhotos.length})` : ''
                  }`}
                  titleFallback="Андрій Даньків"
                  priority
                  transparentBg
                  width={1200}
                  height={800}
                  aspectClassName="w-full h-full"
                  className="w-full h-full"
                  onImageError={() => handleMarkPhotoFailed(currentGalleryPhoto)}
                />
              </m.div>
            </AnimatePresence>
          </div>

          {galleryPhotos.length > 1 && (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/38 via-black/12 to-transparent"
              />

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrevGalleryPhoto();
                }}
                aria-label="Попереднє фото"
                className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" strokeWidth={2} />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNextGalleryPhoto();
                }}
                aria-label="Наступне фото"
                className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" strokeWidth={2} />
              </button>

              <div className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-1.5 z-10">
                {(() => {
                  const total = galleryPhotos.length;
                  const maxVisible = 9;
                  let start = 0;
                  let end = total;
                  if (total > maxVisible) {
                    const half = Math.floor(maxVisible / 2);
                    start = Math.max(0, Math.min(safePhotoIndex - half, total - maxVisible));
                    end = start + maxVisible;
                  }
                  return galleryPhotos.slice(start, end).map((photoUrl, offset) => {
                    const idx = start + offset;
                    const active = idx === safePhotoIndex;
                    const isEdge =
                      total > maxVisible &&
                      ((offset === 0 && start > 0) ||
                        (offset === maxVisible - 1 && end < total));
                    return (
                      <button
                        key={`${photoUrl}-${idx}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectGalleryPhoto(idx);
                        }}
                        aria-label={`Показати фото ${idx + 1} з ${total}`}
                        aria-current={active ? 'true' : undefined}
                        className={`h-1 rounded-full transition-all duration-300 cursor-pointer ${
                          active
                            ? 'w-5 bg-white shadow-xs'
                            : isEdge
                              ? 'w-1 bg-white/35 hover:bg-white/70'
                              : 'w-1.5 bg-white/48 hover:bg-white/80'
                        }`}
                      />
                    );
                  });
                })()}
              </div>
            </>
          )}
        </m.div>

        {/* Homepage Quick Actions: About Me, Contact Author, Monobank Support & Interviews */}
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 pb-6 sm:pb-8 flex flex-col items-center text-center">
          <m.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-2xl mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 text-left"
          >
            {(
              [
                { key: 'about', label: homeActionAboutTitle },
                { key: 'contact', label: homeActionContactTitle },
                { key: 'monobank', label: homeActionMonobankTitle },
                { key: 'interviews', label: homeActionInterviewsTitle },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => handleOpenModal(key)}
                className="touch-surface group w-full text-left bg-paper dark:bg-night-card hover:bg-white dark:hover:bg-night-elevated rounded-2xl px-3.5 py-3 shadow-[0_12px_28px_-20px_rgba(17,30,22,0.26)] dark:shadow-[0_14px_30px_-18px_rgba(0,0,0,0.68)] flex items-center gap-3.5 transition-all duration-150 active:scale-[0.985] cursor-pointer"
              >
                <span
                  className="w-10 h-10 rounded-[11px] inline-flex items-center justify-center shrink-0 transition-all duration-150 group-hover:scale-[1.04] shadow-xs bg-paper-sand dark:bg-night-elevated text-ink-muted dark:text-parchment group-hover:text-ink dark:group-hover:text-cream"
                >
                  <HomeActionIcon kind={key} />
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] sm:text-[14px] font-medium tracking-[-0.005em] dark:tracking-[0.005em] text-pine-night dark:text-cream leading-snug">
                  {label}
                </span>
                <ChevronRight
                  className="w-4 h-4 text-[#6A736C] dark:text-[#8E8E8E] group-hover:translate-x-0.5 group-hover:text-pine dark:group-hover:text-cream transition-all duration-150 shrink-0"
                  strokeWidth={1.85}
                />
              </button>
            ))}
          </m.div>
        </div>
      </div>

      {/* Home Repeaters, Store Highlights & Latest Feedback */}
      {showcaseNode ?? (
        <footer
          className="relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-6 pb-24 sm:pb-28 pt-4"
          aria-hidden="true"
        />
      )}

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {activeModal && (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-50 bg-black/45 dark:bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
                onClick={() => setActiveModal(null)}
              >
                <m.div
                  ref={modalScrollRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="home-action-modal-title"
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  onClick={(e) => e.stopPropagation()}
                  className={`w-full ${
                    selectedInterview ? 'max-w-2xl' : 'max-w-lg'
                  } max-h-[85vh] overflow-y-auto bg-paper dark:bg-night-panel rounded-2xl p-6 sm:p-7 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)] text-ink dark:text-cream transition-[max-width] duration-200`}
                >
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="min-w-0 flex-1">
                      {activeModal === 'interviews' && selectedInterview ? (
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setSelectedInterviewId(null)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-pine dark:text-silver hover:opacity-80 transition-opacity cursor-pointer"
                          >
                            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
                            <span>До списку розмов</span>
                          </button>

                          {(selectedInterview.outlet || selectedInterview.dateLabel) && (
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted dark:text-parchment">
                              {selectedInterview.outlet && <span>{selectedInterview.outlet}</span>}
                              {selectedInterview.outlet && selectedInterview.dateLabel && (
                                <span aria-hidden="true">·</span>
                              )}
                              {selectedInterview.dateLabel && <span>{selectedInterview.dateLabel}</span>}
                            </div>
                          )}

                          <h3
                            id="home-action-modal-title"
                            className="font-serif text-xl sm:text-2xl font-semibold tracking-[-0.015em] text-ink dark:text-cream leading-snug"
                          >
                            {selectedInterview.title}
                          </h3>
                        </div>
                      ) : (
                        <>
                          <h3
                            id="home-action-modal-title"
                            className="font-serif text-2xl sm:text-[26px] font-semibold tracking-[-0.01em] text-ink dark:text-cream leading-tight"
                          >
                            {activeModal === 'about' && 'Про мене'}
                            {activeModal === 'contact' && (homeActionContactTitle || 'Зв’язок')}
                            {activeModal === 'monobank' && (monobankModalTitle || 'Підтримати через Монобанк')}
                            {activeModal === 'interviews' && 'Розмови'}
                          </h3>
                          {activeModal === 'monobank' && monobankModalSubtitle.trim().length > 0 && (
                            <p className="text-xs text-ink-muted dark:text-parchment mt-1">
                              {monobankModalSubtitle}
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {activeModal === 'about' && isAdmin && !editingAbout && (
                        <button
                          type="button"
                          onClick={() => setEditingAbout(true)}
                          title="Редагувати блок «Про мене»"
                          aria-label="Редагувати блок «Про мене»"
                          className="btn-editorial-icon"
                        >
                          <Pencil className="w-4 h-4" strokeWidth={1.75} />
                        </button>
                      )}
                      {activeModal === 'contact' && isAdmin && !editingContact && (
                        <button
                          type="button"
                          onClick={() => {
                            setContactEmailDraft(contactEmail);
                            setContactTelegramDraft(
                              socialLinks.find((s) => s.platform === 'telegram')?.url || ''
                            );
                            setContactEditError(null);
                            setEditingContact(true);
                          }}
                          title="Редагувати пошту та Telegram"
                          aria-label="Редагувати пошту та Telegram"
                          className="btn-editorial-icon"
                        >
                          <Pencil className="w-4 h-4" strokeWidth={1.75} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setActiveModal(null)}
                        aria-label="Закрити вікно"
                        className="btn-editorial-icon"
                      >
                        <X className="w-4 h-4" strokeWidth={1.85} />
                      </button>
                    </div>
                  </div>

                  {/* About Me Modal Body */}
                  {activeModal === 'about' && (
                    <div className="space-y-4">
                      {isAdmin && editingAbout ? (
                        <form onSubmit={handleSaveAbout} className="space-y-3">
                          <textarea
                            rows={7}
                            maxLength={2500}
                            value={aboutDraft}
                            onChange={(e) => setAboutDraft(e.target.value)}
                            className="w-full px-3.5 py-2.5 text-sm leading-relaxed text-ink dark:text-cream bg-paper-warm dark:bg-night-lift rounded-xl focus:outline-none focus:bg-white dark:focus:bg-night-elevated transition-colors"
                            aria-label="Текст блоку Про мене"
                          />
                          {aboutError && (
                            <p className="text-xs text-rose-700 dark:text-rose-400 font-medium">{aboutError}</p>
                          )}
                          <div className="flex items-center gap-2.5">
                            <button
                              type="submit"
                              disabled={savingAbout}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-pear-pine-gradient active:scale-[0.98] rounded-lg transition-all duration-150 whitespace-nowrap cursor-pointer disabled:opacity-60"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>{savingAbout ? 'Збереження...' : 'Зберегти'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAbout(false);
                                setAboutDraft(authorAboutText);
                                setAboutError(null);
                              }}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-ink dark:text-cream bg-paper-sand dark:bg-night-elevated dark:hover:bg-night-muted active:scale-[0.98] rounded-lg transition-all duration-150 whitespace-nowrap cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Скасувати</span>
                            </button>
                          </div>
                        </form>
                      ) : aboutParagraphs.length > 0 ? (
                        <div className="p-5 rounded-xl bg-white dark:bg-night-card space-y-3.5 text-[15px] leading-[1.74] text-[#1E3025] dark:text-[#D4D4D4]">
                          {aboutParagraphs.map((paragraph, index) => (
                            <p key={index} className="whitespace-pre-line">
                              {paragraph}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <div className="p-5 rounded-xl bg-white dark:bg-night-card text-center space-y-3">
                          <p className="text-sm text-ink-muted dark:text-sandstone-light">
                            Інформації поки що немає.
                          </p>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setEditingAbout(true)}
                              className="btn-editorial-primary px-4 py-2 text-xs"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Додати текст</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Contact Author Modal Body (Email & Telegram only) */}
                  {activeModal === 'contact' && (
                    <div className="space-y-3">
                      {isAdmin && editingContact ? (
                        <form onSubmit={handleSaveDirectContact} className="space-y-3">
                          <div>
                            <label
                              htmlFor="contact-email-inline"
                              className="block text-xs font-medium text-ink-muted dark:text-sandstone-light mb-1"
                            >
                              Електронна пошта
                            </label>
                            <input
                              id="contact-email-inline"
                              type="email"
                              value={contactEmailDraft}
                              onChange={(e) => setContactEmailDraft(e.target.value)}
                              placeholder="email@example.com"
                              className="w-full px-3.5 py-2.5 text-sm bg-paper-warm dark:bg-night-lift text-ink dark:text-cream placeholder:text-stone-warm rounded-xl focus:outline-none focus:bg-white dark:focus:bg-night-elevated transition-colors"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="contact-telegram-inline"
                              className="block text-xs font-medium text-ink-muted dark:text-sandstone-light mb-1"
                            >
                              Посилання на Telegram (@username або URL)
                            </label>
                            <input
                              id="contact-telegram-inline"
                              type="text"
                              value={contactTelegramDraft}
                              onChange={(e) => setContactTelegramDraft(e.target.value)}
                              placeholder="https://t.me/username або @username"
                              className="w-full px-3.5 py-2.5 text-sm bg-paper-warm dark:bg-night-lift text-ink dark:text-cream placeholder:text-stone-warm rounded-xl focus:outline-none focus:bg-white dark:focus:bg-night-elevated transition-colors"
                            />
                          </div>

                          {contactEditError && (
                            <p className="text-xs font-medium text-rose-700 dark:text-rose-400">
                              {contactEditError}
                            </p>
                          )}

                          <div className="flex items-center gap-2.5 pt-1">
                            <button
                              type="submit"
                              disabled={savingContact}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-pear-pine-gradient active:scale-[0.98] rounded-lg transition-all duration-150 whitespace-nowrap cursor-pointer disabled:opacity-60"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>{savingContact ? 'Збереження...' : 'Зберегти'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingContact(false);
                                setContactEmailDraft(contactEmail);
                                setContactTelegramDraft(
                                  socialLinks.find((s) => s.platform === 'telegram')?.url || ''
                                );
                                setContactEditError(null);
                              }}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-ink dark:text-cream bg-paper-sand dark:bg-night-elevated dark:hover:bg-night-muted active:scale-[0.98] rounded-lg transition-all duration-150 whitespace-nowrap cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Скасувати</span>
                            </button>
                          </div>
                        </form>
                      ) : (() => {
                        const tg = socialLinks.find(
                          (s) => s.platform === 'telegram' && s.enabled && s.url.trim()
                        );
                        const tgHandle = tg?.url
                          ? tg.url.replace(/^https?:\/\/(www\.)?t\.me\//i, '@').replace(/\/+$/, '')
                          : '';
                        const hasEmail = Boolean(contactEmail.trim());
                        const hasTelegram = Boolean(tg);

                        if (!hasEmail && !hasTelegram) {
                          return (
                            <div className="p-5 rounded-xl bg-white dark:bg-night-card space-y-3 text-center">
                              <p className="text-sm text-ink-muted dark:text-sandstone-light">
                                Пошта та посилання на Telegram ще не вказані.
                              </p>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => setEditingContact(true)}
                                  className="btn-editorial-primary px-4 py-2 text-xs"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                  <span>Вказати контакти</span>
                                </button>
                              )}
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-3">
                            {hasEmail && (
                              <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-night-card space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted dark:text-parchment">
                                    Електронна пошта
                                  </p>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(contactEmail, 'email')}
                                      title={copiedEmail ? 'Пошту скопійовано' : 'Скопіювати пошту'}
                                      aria-label={copiedEmail ? 'Пошту скопійовано' : 'Скопіювати пошту'}
                                      className="inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-paper-sand dark:bg-night-elevated text-ink dark:text-cream hover:opacity-85 transition-opacity cursor-pointer"
                                    >
                                      {copiedEmail ? (
                                        <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-pine dark:text-silver" strokeWidth={2} />
                                      ) : (
                                        <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" strokeWidth={1.85} />
                                      )}
                                    </button>
                                    <a
                                      href={`mailto:${contactEmail}`}
                                      aria-label={`Написати на ${contactEmail}`}
                                      title="Написати листа"
                                      className="inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-pear-pine-gradient text-white hover:opacity-95 transition-opacity"
                                    >
                                      <Mail className="w-3.5 h-3.5 sm:w-4 sm:h-4" strokeWidth={1.9} />
                                    </a>
                                  </div>
                                </div>
                                <a
                                  href={`mailto:${contactEmail}`}
                                  className="block text-[13px] sm:text-[15px] font-semibold text-pine dark:text-silver hover:underline break-words"
                                >
                                  {contactEmail}
                                </a>
                              </div>
                            )}

                            {hasTelegram && tg && (
                              <a
                                href={sanitizeSafeHref(tg.url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full touch-surface flex items-center justify-between gap-3 p-4 sm:p-5 rounded-xl bg-white dark:bg-night-card hover:bg-paper-warm dark:hover:bg-night-elevated transition-colors group"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="w-10 h-10 rounded-xl bg-pear-pine-gradient text-white inline-flex items-center justify-center shrink-0 shadow-xs">
                                    <SocialPlatformIcon platform="telegram" className="w-4 h-4" />
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted dark:text-parchment">
                                      Telegram
                                    </p>
                                    <p className="text-sm sm:text-base font-semibold text-ink dark:text-cream truncate">
                                      {tgHandle.startsWith('@') ? tgHandle : 'Написати у Telegram'}
                                    </p>
                                  </div>
                                </div>
                                <ExternalLink className="w-4 h-4 text-ink-muted dark:text-parchment group-hover:text-pine dark:group-hover:text-cream shrink-0 transition-colors" />
                              </a>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Monobank Donation Modal Body */}
                  {activeModal === 'monobank' && (
                    <div className="space-y-4">
                      {(monobankCardLabel.trim().length > 0 || monobankModalText.trim().length > 0) && (
                        <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-night-card space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            {monobankCardLabel.trim().length > 0 && (
                              <div className="inline-flex items-center gap-2 text-xs font-semibold text-pine dark:text-silver">
                                <Heart className="w-4 h-4" strokeWidth={1.85} />
                                <span>{monobankCardLabel}</span>
                              </div>
                            )}
                            {jarInfo?.enabled && typeof jarInfo.amountUah === 'number' && (
                              <span className="font-mono text-xs font-semibold text-pine dark:text-emerald-400 tabular-nums">
                                У банці: {jarInfo.amountUah.toLocaleString('uk-UA')} ₴
                                {jarInfo.goalUah ? ` / ${jarInfo.goalUah.toLocaleString('uk-UA')} ₴` : ''}
                              </span>
                            )}
                          </div>
                          {monobankModalText.trim().length > 0 && (
                            <p className="text-sm text-night-soft dark:text-[#D4D4D4] leading-relaxed whitespace-pre-line">
                              {monobankModalText}
                            </p>
                          )}
                        </div>
                      )}

                      {monobankJarUrl ? (
                        <div className="space-y-2.5">
                          {guestUser ? (
                            <p className="text-xs text-ink-muted dark:text-sandstone-light px-1">
                              Донат автоматично зарахується у рейтинг на ім’я <strong className="text-ink dark:text-cream">{guestUser.displayName}</strong>.
                            </p>
                          ) : (
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={donorNameDraft}
                                onChange={(e) => setDonorNameDraft(e.target.value)}
                                maxLength={80}
                                placeholder="Ваше ім’я для рейтингу (необов’язково)"
                                aria-label="Ваше ім’я для рейтингу донатерів"
                                className="input-editorial text-xs py-2.5"
                              />
                            </div>
                          )}

                          <a
                            href={sanitizeSafeHref(monobankJarUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              trackClick('monobank:open', 'Донат: Відкрито банку Монобанку', 'action');
                              setJarStatusNote(null);
                              setJarCheckState('watching');
                              void ensureMonobankIntent(false);
                            }}
                            className="w-full touch-surface inline-flex items-center justify-center gap-2 min-h-[46px] px-5 py-2.5 text-xs sm:text-sm font-semibold text-white bg-pear-pine-gradient rounded-xl shadow-[0_8px_20px_-8px_rgba(30,58,41,0.5)] dark:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.65)] active:scale-[0.98] transition-all duration-150 whitespace-nowrap shrink-0"
                          >
                            <span>Відкрити банку Монобанку</span>
                            <ExternalLink className="w-4 h-4" strokeWidth={1.9} />
                          </a>

                          {jarCheckState === 'credited' && creditedAmountUah !== null && (
                            <div className="p-3 rounded-xl bg-emerald-500/12 text-emerald-800 dark:text-emerald-300 text-xs font-medium flex items-center gap-2">
                              <Check className="w-4 h-4 shrink-0" strokeWidth={2.2} />
                              <span>
                                Дякуємо! +{creditedAmountUah.toLocaleString('uk-UA')} ₴ автоматично додано до рейтингу донатерів.
                              </span>
                            </div>
                          )}

                          {(jarCheckState === 'watching' || jarCheckState === 'checking') && (
                            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-paper-sand/70 dark:bg-night-lift text-xs text-night-soft dark:text-[#D4D4D4]">
                              <span>Очікуємо переказ у банку…</span>
                              <button
                                type="button"
                                disabled={jarCheckState === 'checking'}
                                onClick={() => void checkMonobankDonation(true)}
                                className="inline-flex items-center gap-1.5 font-semibold text-pine dark:text-cream hover:underline cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                              >
                                <RefreshCw
                                  className={`w-3.5 h-3.5 ${jarCheckState === 'checking' ? 'animate-spin' : ''}`}
                                />
                                <span>Перевірити зарахування</span>
                              </button>
                            </div>
                          )}

                          {jarStatusNote && (
                            <p className="text-[11px] text-ink-muted dark:text-sandstone-light px-1">
                              {jarStatusNote}
                            </p>
                          )}

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleCopyText(monobankJarUrl, 'monobank')}
                              className="flex-1 touch-surface inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 text-xs font-medium text-ink dark:text-cream bg-paper-sand dark:bg-night-elevated hover:bg-paper-stone dark:hover:bg-night-muted rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              {copiedMonobank ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-pine dark:text-silver" />
                                  <span>Посилання скопійовано</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Скопіювати посилання</span>
                                </>
                              )}
                            </button>

                            {jarCheckState === 'idle' && (
                              <button
                                type="button"
                                onClick={() => void checkMonobankDonation(true)}
                                className="touch-surface inline-flex items-center justify-center gap-1.5 min-h-[42px] px-3.5 py-2 text-xs font-medium text-pine dark:text-silver bg-paper-sand dark:bg-night-elevated hover:bg-paper-stone dark:hover:bg-night-muted rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Я вже задонатив</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {monobankEmptyText.trim().length > 0 && (
                            <p className="text-xs text-ink-muted dark:text-sandstone-light leading-relaxed whitespace-pre-line">
                              {monobankEmptyText}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setActiveModal('contact')}
                              className="flex-1 touch-surface inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 text-xs font-semibold text-white bg-pear-pine-gradient rounded-xl cursor-pointer"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              <span>Написати автору</span>
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveModal(null);
                                  onOpenAuthorStudio();
                                }}
                                className="touch-surface inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 text-xs font-medium text-ink dark:text-cream bg-paper-sand dark:bg-night-elevated dark:hover:bg-night-muted rounded-xl cursor-pointer"
                              >
                                <Settings2 className="w-3.5 h-3.5" />
                                <span>Додати банку</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Conversations List & Reader Modal Body */}
                  {activeModal === 'interviews' && (
                    <div className="space-y-2.5">
                      {selectedInterview ? (
                        <div className="space-y-5">
                          {selectedInterview.content && (
                            <div className="p-5 sm:p-6 rounded-xl bg-white dark:bg-night-card text-[15px] sm:text-base leading-[1.78] text-[#1C1C1A] dark:text-[#E5E2DA] whitespace-pre-line">
                              {selectedInterview.content}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                            <button
                              type="button"
                              onClick={() => setSelectedInterviewId(null)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-ink-muted dark:text-sandstone-light hover:text-ink dark:hover:text-cream bg-paper-sand dark:bg-night-elevated hover:bg-paper-stone dark:hover:bg-night-muted rounded-xl transition-colors cursor-pointer"
                            >
                              <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.85} />
                              <span>Усі розмови</span>
                            </button>

                            {selectedInterview.url && (
                              <a
                                href={sanitizeSafeHref(selectedInterview.url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() =>
                                  trackClick(
                                    `interview_link:${selectedInterview.id}`,
                                    `Посилання на розмову: «${selectedInterview.title}»`,
                                    'action'
                                  )
                                }
                                className="btn-editorial-primary px-4 py-2 text-xs"
                              >
                                <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.85} />
                                <span>Відкрити посилання</span>
                              </a>
                            )}
                          </div>
                        </div>
                      ) : interviews.length === 0 ? (
                        <div className="p-6 rounded-xl bg-white dark:bg-night-card text-center space-y-3">
                          <p className="text-sm text-ink-muted dark:text-sandstone-light">
                            Розмов поки що немає.
                          </p>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveModal(null);
                                onOpenAuthorStudio();
                              }}
                              className="btn-editorial-primary px-4 py-2 text-xs"
                            >
                              Додати в Кабінеті автора
                            </button>
                          )}
                        </div>
                      ) : (
                        interviews.map((item) => {
                          const hasContent = Boolean(item.content && item.content.trim());
                          if (hasContent) {
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  trackClick(`interview:${item.id}`, `Розмова: «${item.title}»`, 'action');
                                  setSelectedInterviewId(item.id);
                                }}
                                className="touch-surface group w-full text-left block p-4 rounded-xl bg-white dark:bg-night-card hover:bg-[#F3F5EE] dark:hover:bg-night-elevated transition-colors duration-150 cursor-pointer"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1 space-y-1.5">
                                    {(item.outlet || item.dateLabel) && (
                                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-ink-muted dark:text-parchment">
                                        {item.outlet && <span>{item.outlet}</span>}
                                        {item.outlet && item.dateLabel && <span aria-hidden="true">·</span>}
                                        {item.dateLabel && <span>{item.dateLabel}</span>}
                                      </div>
                                    )}
                                    <h4 className="font-serif text-base sm:text-lg font-semibold text-ink dark:text-cream group-hover:text-pine dark:group-hover:text-[#F5F5F5] leading-snug transition-colors">
                                      {item.title}
                                    </h4>
                                    {item.content && (
                                      <p className="text-xs text-ink-muted dark:text-sandstone-light line-clamp-2 leading-relaxed">
                                        {item.content}
                                      </p>
                                    )}
                                  </div>
                                  <span className="w-8 h-8 rounded-lg bg-paper-sand dark:bg-night-elevated text-ink-muted dark:text-sandstone-light group-hover:bg-pear-pine-gradient group-hover:text-white dark:group-hover:text-white inline-flex items-center justify-center shrink-0 transition-all duration-150">
                                    <ChevronRight className="w-4 h-4" strokeWidth={1.85} />
                                  </span>
                                </div>
                              </button>
                            );
                          }

                          return (
                            <a
                              key={item.id}
                              href={sanitizeSafeHref(item.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() =>
                                trackClick(`interview:${item.id}`, `Розмова: «${item.title}»`, 'action')
                              }
                              className="touch-surface group block p-4 rounded-xl bg-white dark:bg-night-card hover:bg-[#F3F5EE] dark:hover:bg-night-elevated transition-colors duration-150"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1 space-y-1">
                                  {(item.outlet || item.dateLabel) && (
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-ink-muted dark:text-parchment">
                                      {item.outlet && <span>{item.outlet}</span>}
                                      {item.outlet && item.dateLabel && <span aria-hidden="true">·</span>}
                                      {item.dateLabel && <span>{item.dateLabel}</span>}
                                    </div>
                                  )}
                                  <h4 className="font-serif text-base sm:text-lg font-semibold text-ink dark:text-cream group-hover:text-pine dark:group-hover:text-[#F5F5F5] leading-snug transition-colors">
                                    {item.title}
                                  </h4>
                                </div>
                                <span className="w-8 h-8 rounded-lg bg-paper-sand dark:bg-night-elevated text-ink-muted dark:text-sandstone-light group-hover:bg-pear-pine-gradient group-hover:text-white dark:group-hover:text-white inline-flex items-center justify-center shrink-0 transition-all duration-150">
                                  <ArrowUpRight className="w-4 h-4" strokeWidth={1.85} />
                                </span>
                              </div>
                            </a>
                          );
                        })
                      )}
                    </div>
                  )}
                </m.div>
              </m.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </section>
  );
});
