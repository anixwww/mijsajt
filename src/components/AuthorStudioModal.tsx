import {
  BarChart3,
  BookOpen,
  Home,
  Mail,
  MessageSquare,
  Mic,
  Package,
  PenTool,
  Plus,
  Radio,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { lazy, memo, Suspense, useCallback, useEffect, useState } from 'react';
import type {
  BlogPost,
  ContactMessageRecord,
  FeedbackRecord,
  HomeRepeatersConfig,
  InterviewLinkItem,
  OrderRecord,
  Poem,
  PoemSubmission,
  ProseSubmission,
  ProseTag,
  ProseWork,
  RadioStationId,
  RadioTrack,
  SocialLinkItem,
  StoreProduct,
} from '../types.ts';
import {
  mergeSiteFeedbackLists,
  subscribeAdminSiteFeedback,
} from '../utils/feedbackFirestore.ts';
import { StudioFeedbackTab } from './studio/StudioFeedbackTab.tsx';
import { StudioHomeTab } from './studio/StudioHomeTab.tsx';
import { StudioOrdersTab } from './studio/StudioOrdersTab.tsx';
import { StudioRadioTab } from './studio/StudioRadioTab.tsx';
import { StudioStoreTab } from './studio/StudioStoreTab.tsx';
import { StudioTelegramTab } from './studio/StudioTelegramTab.tsx';
import { StudioWorksTab, type WorksSubTab } from './studio/StudioWorksTab.tsx';

const BehaviorAnalyticsTab = lazy(() =>
  import('./BehaviorAnalyticsTab.tsx').then((m) => ({ default: m.BehaviorAnalyticsTab }))
);

interface AuthorStudioModalProps {
  isOpen: boolean;
  isAdmin: boolean;
  getAdminToken: () => Promise<string | null>;
  onClose: () => void;
  onCatalogUpdated: () => void;
  heroLeadText: string;
  onHeroLeadUpdated: (text: string) => void;
  authorAboutText: string;
  onAuthorAboutUpdated: (text: string) => void;
  authorPhotoUrl: string;
  authorPhotos?: string[];
  onAuthorPhotoUpdated: (url: string) => void;
  onAuthorPhotosUpdated?: (urls: string[]) => void;
  socialLinks: SocialLinkItem[];
  onSocialLinksUpdated: (links: SocialLinkItem[]) => void;
  monobankJarUrl: string;
  onMonobankJarUpdated: (url: string) => void;
  monobankModalTitle: string;
  monobankModalSubtitle: string;
  monobankCardLabel: string;
  monobankModalText: string;
  monobankEmptyText: string;
  onMonobankModalTextsUpdated?: (next: {
    monobankModalTitle: string;
    monobankModalSubtitle: string;
    monobankCardLabel: string;
    monobankModalText: string;
    monobankEmptyText: string;
  }) => void;
  contactEmail: string;
  onContactEmailUpdated: (email: string) => void;
  interviews: InterviewLinkItem[];
  onInterviewsUpdated: (items: InterviewLinkItem[]) => void;
  homeActionAboutTitle: string;
  onHomeActionAboutUpdated: (title: string) => void;
  homeActionContactTitle: string;
  onHomeActionContactUpdated: (title: string) => void;
  homeActionMonobankTitle: string;
  onHomeActionMonobankUpdated: (title: string) => void;
  homeActionInterviewsTitle: string;
  onHomeActionInterviewsUpdated: (title: string) => void;
  homeRepeaters?: HomeRepeatersConfig;
  onHomeRepeatersUpdated?: (next: HomeRepeatersConfig) => void;
  showVisitorCounter?: boolean;
  onShowVisitorCounterUpdated?: (show: boolean) => void;
  radioTracks?: RadioTrack[];
  onRadioTracksChanged?: (
    tracks: RadioTrack[],
    activateTrackId?: string | null,
    station?: RadioStationId
  ) => void;
  uniqueVisitors: number;
}

type StudioSection =
  | 'works'
  | 'store'
  | 'radio'
  | 'home'
  | 'interviews'
  | 'feedback'
  | 'telegram'
  | 'orders'
  | 'analytics';

const SECTION_TITLES: Record<StudioSection, string> = {
  works: 'Тексти й публікація',
  store: 'Крамниця',
  radio: 'Радіостанція',
  home: 'Головна сторінка',
  interviews: 'Розмови та інтервʼю',
  feedback: 'Відгуки про сайт',
  telegram: 'Telegram-бот',
  orders: 'Замовлення',
  analytics: 'Аналітика поведінки',
};

export const AuthorStudioModal = memo(function AuthorStudioModal({
  isOpen,
  isAdmin,
  getAdminToken,
  onClose,
  onCatalogUpdated,
  heroLeadText,
  onHeroLeadUpdated,
  authorAboutText,
  onAuthorAboutUpdated,
  authorPhotoUrl,
  authorPhotos = [],
  onAuthorPhotoUpdated,
  onAuthorPhotosUpdated,
  socialLinks,
  onSocialLinksUpdated,
  monobankJarUrl,
  onMonobankJarUpdated,
  monobankModalTitle,
  monobankModalSubtitle,
  monobankCardLabel,
  monobankModalText,
  monobankEmptyText,
  onMonobankModalTextsUpdated,
  contactEmail,
  onContactEmailUpdated,
  interviews,
  onInterviewsUpdated,
  homeActionAboutTitle,
  onHomeActionAboutUpdated,
  homeActionContactTitle,
  onHomeActionContactUpdated,
  homeActionMonobankTitle,
  onHomeActionMonobankUpdated,
  homeActionInterviewsTitle,
  onHomeActionInterviewsUpdated,
  homeRepeaters,
  onHomeRepeatersUpdated,
  showVisitorCounter,
  onShowVisitorCounterUpdated,
  radioTracks: externalRadioTracks,
  onRadioTracksChanged,
  uniqueVisitors,
}: AuthorStudioModalProps) {
  const [section, setSection] = useState<StudioSection>('works');
  const [worksSubTab, setWorksSubTab] = useState<WorksSubTab>('list');
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [requestedHomeSubTab, setRequestedHomeSubTab] = useState<'messages' | null>(null);

  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [poems, setPoems] = useState<Poem[]>([]);
  const [poemSubmissions, setPoemSubmissions] = useState<PoemSubmission[]>([]);
  const [proseSubmissions, setProseSubmissions] = useState<ProseSubmission[]>([]);
  const [prose, setProse] = useState<ProseWork[]>([]);
  const [proseTags, setProseTags] = useState<ProseTag[]>([]);
  const [blog, setBlog] = useState<BlogPost[]>([]);
  const [radioTracks, setRadioTracks] = useState<RadioTrack[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [contactMessages, setContactMessages] = useState<ContactMessageRecord[]>([]);
  const [siteFeedback, setSiteFeedback] = useState<FeedbackRecord[]>([]);
  const [studioVisitors, setStudioVisitors] = useState<number>(uniqueVisitors);
  const [proseAuthDiscountDraft, setProseAuthDiscountDraft] = useState('15');
  const [proseTelegramDiscountDraft, setProseTelegramDiscountDraft] = useState('50');

  const getAuthHeaders = useCallback(
    async (extra?: Record<string, string>): Promise<Record<string, string> | null> => {
      const token = await getAdminToken();
      if (!token) {
        setFeedback('Сесія адміністратора відсутня або закінчилась. Увійдіть повторно через Google.');
        return null;
      }
      return {
        ...(extra || {}),
        Authorization: `Bearer ${token}`,
      };
    },
    [getAdminToken]
  );

  const loadAuthorData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch('/api/author/catalog', { headers });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося завантажити дані автора.');
        return;
      }
      setProducts(data.products || []);
      setPoems(data.poems || []);
      setPoemSubmissions(Array.isArray(data.poemSubmissions) ? data.poemSubmissions : []);
      setProseSubmissions(Array.isArray(data.proseSubmissions) ? data.proseSubmissions : []);
      setProse(data.prose || []);
      setProseTags(Array.isArray(data.proseTags) ? data.proseTags : []);
      setBlog(data.blog || []);
      const serverTracks: RadioTrack[] = Array.isArray(data.radioTracks) ? data.radioTracks : [];
      const mergedTracks =
        externalRadioTracks !== undefined ? externalRadioTracks : serverTracks;
      setRadioTracks(mergedTracks);
      setOrders(data.orders || []);
      if (typeof data.proseAuthDiscountPercent === 'number') {
        setProseAuthDiscountDraft(String(data.proseAuthDiscountPercent));
      }
      if (typeof data.proseTelegramDiscountPercent === 'number') {
        setProseTelegramDiscountDraft(String(data.proseTelegramDiscountPercent));
      }
      if (Array.isArray(data.contactMessages)) {
        setContactMessages(data.contactMessages);
      }
      if (Array.isArray(data.siteFeedback)) {
        setSiteFeedback((prev) => mergeSiteFeedbackLists(data.siteFeedback, prev));
      }
      if (typeof data.uniqueVisitors === 'number') {
        setStudioVisitors(data.uniqueVisitors);
      }
    } catch {
      setFeedback('Не вдалося завантажити дані автора.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, getAuthHeaders]);

  useEffect(() => {
    if (!isOpen || !isAdmin) return;
    loadAuthorData();
  }, [isOpen, isAdmin, loadAuthorData]);

  useEffect(() => {
    if (!isOpen || !isAdmin) return;
    let active = true;
    let unsubscribe = () => {};
    void subscribeAdminSiteFeedback({
      onItems: (fsItems) => {
        if (!active) return;
        setSiteFeedback((prev) => mergeSiteFeedbackLists(fsItems, prev));
      },
    }).then((unsub) => {
      if (active) {
        unsubscribe = unsub;
      } else {
        unsub();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isOpen, isAdmin]);

  // Close with Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Auto-dismiss non-blocking toast after 5 seconds
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  if (!isOpen || !isAdmin) return null;

  const worksTotal = poems.length + prose.length + blog.length;
  const pendingSubmissionsCount =
    poemSubmissions.filter((s) => s.status === 'pending').length +
    proseSubmissions.filter((s) => s.status === 'pending').length;
  const unreadMessagesCount = contactMessages.filter((m) => !m.read).length;
  const unreadSiteFeedbackCount = siteFeedback.filter(
    (f) => !f.readByAdmin && !f.adminReply?.trim()
  ).length;

  const navItems: {
    id: StudioSection;
    label: string;
    icon: typeof PenTool;
    count?: number;
    highlight?: boolean;
  }[] = [
    {
      id: 'works',
      label: 'Тексти',
      icon: PenTool,
      count: pendingSubmissionsCount > 0 ? pendingSubmissionsCount : worksTotal,
      highlight: pendingSubmissionsCount > 0,
    },
    { id: 'store', label: 'Крамниця', icon: BookOpen, count: products.length },
    { id: 'radio', label: 'Радіо', icon: Radio, count: radioTracks.length },
    { id: 'interviews', label: 'Розмови', icon: Mic, count: interviews.length },
    {
      id: 'home',
      label: 'Головна',
      icon: Home,
      count: unreadMessagesCount > 0 ? unreadMessagesCount : undefined,
      highlight: unreadMessagesCount > 0,
    },
    {
      id: 'feedback',
      label: 'Відгуки про сайт',
      icon: MessageSquare,
      count: unreadSiteFeedbackCount > 0 ? unreadSiteFeedbackCount : siteFeedback.length,
      highlight: unreadSiteFeedbackCount > 0,
    },
    { id: 'telegram', label: 'ТГ-бот', icon: Send },
    { id: 'orders', label: 'Замовлення', icon: Package, count: orders.length },
    { id: 'analytics', label: 'Аналітика', icon: BarChart3 },
  ];

  const handleSelectSection = (next: StudioSection) => {
    setSection(next);
    setCreatingProduct(false);
    setFeedback(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/70 dark:bg-black/82 flex items-center justify-center p-0 sm:p-4 md:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Кабінет автора — Адміністратор"
    >
      <div
        className="relative bg-white dark:bg-night-panel sm:rounded-2xl w-full max-w-6xl h-full sm:h-[90vh] flex flex-col md:flex-row overflow-hidden shadow-2xl text-ink dark:text-cream-soft"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Navigation Sidebar (Desktop) & Top Segmented Bar (Mobile) */}
        <aside className="md:w-60 shrink-0 bg-paper-oat dark:bg-night flex flex-col">
          {/* Sidebar Header */}
          <div className="px-4 sm:px-5 py-3.5 md:py-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted dark:text-sandstone">
                Адмін-панель
              </p>
              <h3 className="text-base font-semibold text-ink dark:text-cream-soft truncate">
                Кабінет автора
              </h3>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="md:hidden p-2 rounded-lg text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft hover:bg-paper-sand dark:hover:bg-night-elevated cursor-pointer"
              aria-label="Закрити кабінет"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Items */}
          <nav
            aria-label="Розділи адмін-панелі"
            className="px-3 pb-3 md:py-3 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto flex-1"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectSection(item.id)}
                  className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-white dark:bg-night-elevated text-pine-dark dark:text-silver font-semibold shadow-2xs'
                      : 'text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft hover:bg-paper-sand/70 dark:hover:bg-night-elevated'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-pine dark:text-silver' : ''
                      }`}
                      strokeWidth={1.85}
                    />
                    <span>{item.label}</span>
                  </span>

                  {typeof item.count === 'number' && (
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        item.id === 'works' && item.highlight
                          ? 'px-1.5 py-0.5 rounded-full bg-red-600 text-white font-semibold shadow-2xs'
                          : item.highlight
                            ? 'text-pine dark:text-silver font-semibold'
                            : 'opacity-70'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Workspace Viewport */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-white dark:bg-night-panel">
          {/* Sticky Top Bar */}
          <header className="px-5 sm:px-7 py-3.5 flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <h4 className="text-lg sm:text-xl font-semibold text-ink dark:text-cream-soft truncate">
                {SECTION_TITLES[section]}
              </h4>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {pendingSubmissionsCount > 0 && (section !== 'works' || worksSubTab !== 'submissions') && (
                <button
                  type="button"
                  onClick={() => {
                    setSection('works');
                    setWorksSubTab('submissions');
                  }}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs cursor-pointer whitespace-nowrap transition-colors"
                >
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse shrink-0" aria-hidden="true" />
                  <PenTool className="w-3.5 h-3.5" />
                  <span className="tabular-nums">Заявки читачів ({pendingSubmissionsCount})</span>
                </button>
              )}

              {unreadMessagesCount > 0 && section !== 'home' && (
                <button
                  type="button"
                  onClick={() => {
                    setSection('home');
                    setRequestedHomeSubTab('messages');
                  }}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#F2F6EE] dark:bg-night-elevated text-pine dark:text-silver hover:opacity-90 cursor-pointer whitespace-nowrap"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span className="tabular-nums">Звернення ({unreadMessagesCount})</span>
                </button>
              )}

              {unreadSiteFeedbackCount > 0 && section !== 'feedback' && (
                <button
                  type="button"
                  onClick={() => handleSelectSection('feedback')}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#F2F6EE] dark:bg-night-elevated text-pine dark:text-silver hover:opacity-90 cursor-pointer whitespace-nowrap"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span className="tabular-nums">Відгуки ({unreadSiteFeedbackCount})</span>
                </button>
              )}

              {section === 'works' && worksSubTab !== 'compose' && (
                <button
                  type="button"
                  onClick={() => setWorksSubTab('compose')}
                  className="btn-editorial-primary py-1.5 px-3.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Новий текст</span>
                </button>
              )}

              {section === 'store' && !creatingProduct && (
                <button
                  type="button"
                  onClick={() => setCreatingProduct(true)}
                  className="btn-editorial-primary py-1.5 px-3.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Новий товар</span>
                </button>
              )}

              <button
                type="button"
                onClick={loadAuthorData}
                disabled={loading}
                title="Оновити дані"
                aria-label="Оновити дані"
                className="p-2 rounded-lg text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft hover:bg-paper-oat dark:hover:bg-night-elevated cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>

              <button
                type="button"
                onClick={onClose}
                className="hidden md:inline-flex p-2 rounded-lg text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft hover:bg-paper-oat dark:hover:bg-night-elevated cursor-pointer"
                aria-label="Закрити кабінет"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Non-intrusive Feedback Banner */}
          {feedback && (
            <div
              role="status"
              className="mx-5 sm:mx-7 mt-4 px-4 py-2.5 rounded-xl bg-[#F2F6EE] dark:bg-night-elevated flex items-center justify-between gap-3 text-xs font-medium text-pine-dark dark:text-cream shrink-0"
            >
              <span>{feedback}</span>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                aria-label="Приховати повідомлення"
                className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Scrollable Content Area */}
          <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-5 sm:py-6">
            {section === 'works' && (
              <StudioWorksTab
                poems={poems}
                setPoems={setPoems}
                poemSubmissions={poemSubmissions}
                setPoemSubmissions={setPoemSubmissions}
                proseSubmissions={proseSubmissions}
                setProseSubmissions={setProseSubmissions}
                prose={prose}
                setProse={setProse}
                blog={blog}
                setBlog={setBlog}
                proseTags={proseTags}
                setProseTags={setProseTags}
                proseAuthDiscountDraft={proseAuthDiscountDraft}
                setProseAuthDiscountDraft={setProseAuthDiscountDraft}
                proseTelegramDiscountDraft={proseTelegramDiscountDraft}
                setProseTelegramDiscountDraft={setProseTelegramDiscountDraft}
                getAuthHeaders={getAuthHeaders}
                setFeedback={setFeedback}
                onCatalogUpdated={onCatalogUpdated}
                onReloadAuthorData={loadAuthorData}
                subTab={worksSubTab}
                setSubTab={setWorksSubTab}
                onOpenTelegramSettings={() => handleSelectSection('telegram')}
              />
            )}

            {section === 'store' && (
              <StudioStoreTab
                products={products}
                setProducts={setProducts}
                loading={loading}
                getAuthHeaders={getAuthHeaders}
                setFeedback={setFeedback}
                onCatalogUpdated={onCatalogUpdated}
                isCreatingNew={creatingProduct}
                setIsCreatingNew={setCreatingProduct}
              />
            )}

            {section === 'radio' && (
              <StudioRadioTab
                radioTracks={radioTracks}
                setRadioTracks={setRadioTracks}
                getAuthHeaders={getAuthHeaders}
                setFeedback={setFeedback}
                onRadioTracksChanged={onRadioTracksChanged}
                onCatalogUpdated={onCatalogUpdated}
              />
            )}

            {section === 'interviews' && (
              <StudioHomeTab
                heroLeadText={heroLeadText}
                authorAboutText={authorAboutText}
                authorPhotoUrl={authorPhotoUrl}
                authorPhotos={authorPhotos}
                socialLinks={socialLinks}
                monobankJarUrl={monobankJarUrl}
                monobankModalTitle={monobankModalTitle}
                monobankModalSubtitle={monobankModalSubtitle}
                monobankCardLabel={monobankCardLabel}
                monobankModalText={monobankModalText}
                monobankEmptyText={monobankEmptyText}
                contactEmail={contactEmail}
                interviews={interviews}
                contactMessages={contactMessages}
                setContactMessages={setContactMessages}
                homeActionAboutTitle={homeActionAboutTitle}
                homeActionContactTitle={homeActionContactTitle}
                homeActionMonobankTitle={homeActionMonobankTitle}
                homeActionInterviewsTitle={homeActionInterviewsTitle}
                homeRepeaters={homeRepeaters}
                onHomeRepeatersUpdated={onHomeRepeatersUpdated}
                onHeroLeadUpdated={onHeroLeadUpdated}
                onAuthorAboutUpdated={onAuthorAboutUpdated}
                onAuthorPhotoUpdated={onAuthorPhotoUpdated}
                onAuthorPhotosUpdated={onAuthorPhotosUpdated}
                onSocialLinksUpdated={onSocialLinksUpdated}
                onMonobankJarUpdated={onMonobankJarUpdated}
                onMonobankModalTextsUpdated={onMonobankModalTextsUpdated}
                onContactEmailUpdated={onContactEmailUpdated}
                onInterviewsUpdated={onInterviewsUpdated}
                onHomeActionAboutUpdated={onHomeActionAboutUpdated}
                onHomeActionContactUpdated={onHomeActionContactUpdated}
                onHomeActionMonobankUpdated={onHomeActionMonobankUpdated}
                onHomeActionInterviewsUpdated={onHomeActionInterviewsUpdated}
                getAuthHeaders={getAuthHeaders}
                setFeedback={setFeedback}
                requestedSubTab="interviews"
              />
            )}

            {section === 'home' && (
              <StudioHomeTab
                heroLeadText={heroLeadText}
                authorAboutText={authorAboutText}
                authorPhotoUrl={authorPhotoUrl}
                authorPhotos={authorPhotos}
                socialLinks={socialLinks}
                monobankJarUrl={monobankJarUrl}
                monobankModalTitle={monobankModalTitle}
                monobankModalSubtitle={monobankModalSubtitle}
                monobankCardLabel={monobankCardLabel}
                monobankModalText={monobankModalText}
                monobankEmptyText={monobankEmptyText}
                contactEmail={contactEmail}
                interviews={interviews}
                contactMessages={contactMessages}
                setContactMessages={setContactMessages}
                homeActionAboutTitle={homeActionAboutTitle}
                homeActionContactTitle={homeActionContactTitle}
                homeActionMonobankTitle={homeActionMonobankTitle}
                homeActionInterviewsTitle={homeActionInterviewsTitle}
                homeRepeaters={homeRepeaters}
                onHomeRepeatersUpdated={onHomeRepeatersUpdated}
                showVisitorCounter={showVisitorCounter}
                onShowVisitorCounterUpdated={onShowVisitorCounterUpdated}
                onHeroLeadUpdated={onHeroLeadUpdated}
                onAuthorAboutUpdated={onAuthorAboutUpdated}
                onAuthorPhotoUpdated={onAuthorPhotoUpdated}
                onAuthorPhotosUpdated={onAuthorPhotosUpdated}
                onSocialLinksUpdated={onSocialLinksUpdated}
                onMonobankJarUpdated={onMonobankJarUpdated}
                onMonobankModalTextsUpdated={onMonobankModalTextsUpdated}
                onContactEmailUpdated={onContactEmailUpdated}
                onInterviewsUpdated={onInterviewsUpdated}
                onHomeActionAboutUpdated={onHomeActionAboutUpdated}
                onHomeActionContactUpdated={onHomeActionContactUpdated}
                onHomeActionMonobankUpdated={onHomeActionMonobankUpdated}
                onHomeActionInterviewsUpdated={onHomeActionInterviewsUpdated}
                getAuthHeaders={getAuthHeaders}
                setFeedback={setFeedback}
                requestedSubTab={requestedHomeSubTab}
                onSubTabHandled={() => setRequestedHomeSubTab(null)}
              />
            )}

            {section === 'feedback' && (
              <StudioFeedbackTab
                items={siteFeedback}
                setItems={setSiteFeedback}
                getAuthHeaders={getAuthHeaders}
                setFeedback={setFeedback}
              />
            )}

            {section === 'telegram' && (
              <StudioTelegramTab
                proseTelegramDiscountDraft={proseTelegramDiscountDraft}
                setProseTelegramDiscountDraft={setProseTelegramDiscountDraft}
                getAuthHeaders={getAuthHeaders}
                setFeedback={setFeedback}
                onCatalogUpdated={onCatalogUpdated}
              />
            )}

            {section === 'orders' && (
              <StudioOrdersTab orders={orders} isActive={section === 'orders'} />
            )}

            {section === 'analytics' && (
              <Suspense
                fallback={
                  <div className="py-12 text-center text-sm text-ink-muted dark:text-sandstone">
                    Завантаження графіків аналітики...
                  </div>
                }
              >
                <BehaviorAnalyticsTab
                  getAdminToken={getAdminToken}
                  uniqueVisitors={studioVisitors || uniqueVisitors}
                />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
