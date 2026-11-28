import {
  ArrowLeft,
  ArrowRight,
  Heart,
  Mail,
  Mic,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  DEFAULT_HOME_REPEATERS,
  normalizeHomeRepeatersConfig,
  type BlogRepeaterMode,
  type ContactMessageRecord,
  type HomeRepeatersConfig,
  type InterviewLinkItem,
  type ProseRepeaterMode,
  type SocialLinkItem,
  type StoreRepeaterMode,
} from '../../types.ts';
import { readImageAsOptimizedDataUrl } from '../../utils/imageUpload.ts';
import { EditorialImage } from '../EditorialImage.tsx';
import { SOCIAL_PLATFORM_META, SocialPlatformIcon } from '../SocialIcons.tsx';
import { STUDIO_INPUT_CLASS, STUDIO_LABEL_CLASS, type GetAuthHeadersFn } from './studioShared.ts';

type HomeSubTab = 'texts' | 'repeaters' | 'profile' | 'contacts' | 'interviews' | 'messages';

interface StudioHomeTabProps {
  heroLeadText: string;
  authorAboutText: string;
  authorPhotoUrl: string;
  authorPhotos: string[];
  socialLinks: SocialLinkItem[];
  monobankJarUrl: string;
  monobankModalTitle: string;
  monobankModalSubtitle: string;
  monobankCardLabel: string;
  monobankModalText: string;
  monobankEmptyText: string;
  contactEmail: string;
  interviews: InterviewLinkItem[];
  contactMessages: ContactMessageRecord[];
  setContactMessages: (items: ContactMessageRecord[]) => void;
  homeActionAboutTitle: string;
  homeActionContactTitle: string;
  homeActionMonobankTitle: string;
  homeActionInterviewsTitle: string;
  homeRepeaters?: HomeRepeatersConfig;
  onHeroLeadUpdated: (text: string) => void;
  onAuthorAboutUpdated: (text: string) => void;
  onAuthorPhotoUpdated: (url: string) => void;
  onAuthorPhotosUpdated?: (urls: string[]) => void;
  onSocialLinksUpdated: (links: SocialLinkItem[]) => void;
  onMonobankJarUpdated: (url: string) => void;
  onMonobankModalTextsUpdated?: (next: {
    monobankModalTitle: string;
    monobankModalSubtitle: string;
    monobankCardLabel: string;
    monobankModalText: string;
    monobankEmptyText: string;
  }) => void;
  onContactEmailUpdated: (email: string) => void;
  onInterviewsUpdated: (items: InterviewLinkItem[]) => void;
  onHomeActionAboutUpdated: (title: string) => void;
  onHomeActionContactUpdated: (title: string) => void;
  onHomeActionMonobankUpdated: (title: string) => void;
  onHomeActionInterviewsUpdated: (title: string) => void;
  onHomeRepeatersUpdated?: (next: HomeRepeatersConfig) => void;
  getAuthHeaders: GetAuthHeadersFn;
  setFeedback: (msg: string | null) => void;
  requestedSubTab?: HomeSubTab | null;
  onSubTabHandled?: () => void;
}

export function StudioHomeTab({
  heroLeadText,
  authorAboutText,
  authorPhotoUrl,
  authorPhotos,
  socialLinks,
  monobankJarUrl,
  monobankModalTitle,
  monobankModalSubtitle,
  monobankCardLabel,
  monobankModalText,
  monobankEmptyText,
  contactEmail,
  interviews,
  contactMessages,
  setContactMessages,
  homeActionAboutTitle,
  homeActionContactTitle,
  homeActionMonobankTitle,
  homeActionInterviewsTitle,
  homeRepeaters,
  onHeroLeadUpdated,
  onAuthorAboutUpdated,
  onAuthorPhotoUpdated,
  onAuthorPhotosUpdated,
  onSocialLinksUpdated,
  onMonobankJarUpdated,
  onMonobankModalTextsUpdated,
  onContactEmailUpdated,
  onInterviewsUpdated,
  onHomeActionAboutUpdated,
  onHomeActionContactUpdated,
  onHomeActionMonobankUpdated,
  onHomeActionInterviewsUpdated,
  onHomeRepeatersUpdated,
  getAuthHeaders,
  setFeedback,
  requestedSubTab,
  onSubTabHandled,
}: StudioHomeTabProps) {
  const [subTab, setSubTab] = useState<HomeSubTab>('texts');

  useEffect(() => {
    if (requestedSubTab) {
      setSubTab(requestedSubTab);
      onSubTabHandled?.();
    }
  }, [requestedSubTab, onSubTabHandled]);

  const [leadDraft, setLeadDraft] = useState(heroLeadText);
  const [aboutDraft, setAboutDraft] = useState(authorAboutText);
  const [photoDraft, setPhotoDraft] = useState(authorPhotoUrl);
  const [photosDraft, setPhotosDraft] = useState<string[]>(() =>
    authorPhotos && authorPhotos.length > 0
      ? authorPhotos
      : authorPhotoUrl
        ? [authorPhotoUrl]
        : []
  );
  const [manualPhotoUrlDraft, setManualPhotoUrlDraft] = useState('');
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoUploadProgress, setPhotoUploadProgress] = useState<string | null>(null);
  const [socialDraft, setSocialDraft] = useState<SocialLinkItem[]>(socialLinks);
  const [monobankDraft, setMonobankDraft] = useState(monobankJarUrl);
  const [monobankModalTitleDraft, setMonobankModalTitleDraft] = useState(monobankModalTitle);
  const [monobankSubtitleDraft, setMonobankModalSubtitleDraft] = useState(monobankModalSubtitle);
  const [monobankCardLabelDraft, setMonobankCardLabelDraft] = useState(monobankCardLabel);
  const [monobankTextDraft, setMonobankModalTextDraft] = useState(monobankModalText);
  const [monobankEmptyDraft, setMonobankEmptyTextDraft] = useState(monobankEmptyText);
  const [contactEmailDraft, setContactEmailDraft] = useState(contactEmail);
  const [telegramDraft, setTelegramDraft] = useState(
    () => socialLinks.find((s) => s.platform === 'telegram')?.url || ''
  );
  const [interviewsDraft, setInterviewsDraft] = useState<InterviewLinkItem[]>(interviews);
  const [aboutTitleDraft, setAboutTitleDraft] = useState(homeActionAboutTitle);
  const [contactTitleDraft, setContactTitleDraft] = useState(homeActionContactTitle);
  const [monobankTitleDraft, setMonobankTitleDraft] = useState(homeActionMonobankTitle);
  const [interviewsTitleDraft, setInterviewsTitleDraft] = useState(homeActionInterviewsTitle);
  const [repeatersDraft, setRepeatersDraft] = useState<HomeRepeatersConfig>(() =>
    normalizeHomeRepeatersConfig(homeRepeaters)
  );
  const [savingRepeaters, setSavingRepeaters] = useState(false);

  const [newInterviewTitle, setNewInterviewTitle] = useState('');
  const [newInterviewOutlet, setNewInterviewOutlet] = useState('');
  const [newInterviewDate, setNewInterviewDate] = useState('');
  const [newInterviewContent, setNewInterviewContent] = useState('');
  const [newInterviewUrl, setNewInterviewUrl] = useState('');
  const [editingInterviewId, setEditingInterviewId] = useState<string | null>(null);

  useEffect(() => setLeadDraft(heroLeadText), [heroLeadText]);
  useEffect(() => setAboutDraft(authorAboutText), [authorAboutText]);
  useEffect(() => setPhotoDraft(authorPhotoUrl), [authorPhotoUrl]);
  useEffect(() => {
    if (authorPhotos && authorPhotos.length > 0) {
      setPhotosDraft(authorPhotos);
    } else if (authorPhotoUrl) {
      setPhotosDraft([authorPhotoUrl]);
    }
  }, [authorPhotos, authorPhotoUrl]);
  useEffect(() => {
    setSocialDraft(socialLinks);
    setTelegramDraft(socialLinks.find((s) => s.platform === 'telegram')?.url || '');
  }, [socialLinks]);
  useEffect(() => setMonobankDraft(monobankJarUrl), [monobankJarUrl]);
  useEffect(() => setMonobankModalTitleDraft(monobankModalTitle), [monobankModalTitle]);
  useEffect(() => setMonobankModalSubtitleDraft(monobankModalSubtitle), [monobankModalSubtitle]);
  useEffect(() => setMonobankCardLabelDraft(monobankCardLabel), [monobankCardLabel]);
  useEffect(() => setMonobankModalTextDraft(monobankModalText), [monobankModalText]);
  useEffect(() => setMonobankEmptyTextDraft(monobankEmptyText), [monobankEmptyText]);
  useEffect(() => setContactEmailDraft(contactEmail), [contactEmail]);
  useEffect(() => setInterviewsDraft(interviews), [interviews]);
  useEffect(() => {
    setAboutTitleDraft(homeActionAboutTitle);
    setContactTitleDraft(homeActionContactTitle);
    setMonobankTitleDraft(homeActionMonobankTitle);
    setInterviewsTitleDraft(homeActionInterviewsTitle);
  }, [homeActionAboutTitle, homeActionContactTitle, homeActionMonobankTitle, homeActionInterviewsTitle]);
  useEffect(() => {
    setRepeatersDraft(normalizeHomeRepeatersConfig(homeRepeaters));
  }, [homeRepeaters]);

  const unreadCount = contactMessages.filter((m) => !m.read).length;

  const handleSaveRepeaters = async (e: FormEvent) => {
    e.preventDefault();
    if (savingRepeaters) return;
    setSavingRepeaters(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ homeRepeaters: repeatersDraft }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося зберегти налаштування ретрансляторів.');
        return;
      }
      const next = normalizeHomeRepeatersConfig(data.homeRepeaters ?? repeatersDraft);
      setRepeatersDraft(next);
      onHomeRepeatersUpdated?.(next);
      setFeedback('Налаштування ретрансляторів на головній збережено.');
    } catch {
      setFeedback('Помилка з’єднання із сервером.');
    } finally {
      setSavingRepeaters(false);
    }
  };

  const handleSaveHomeTitlesAndLead = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          heroLeadText: leadDraft,
          homeActionAboutTitle: aboutTitleDraft,
          homeActionContactTitle: contactTitleDraft,
          homeActionMonobankTitle: monobankTitleDraft,
          homeActionInterviewsTitle: interviewsTitleDraft,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Помилка збереження головної сторінки.');
        return;
      }
      if (typeof data.heroLeadText === 'string') {
        setLeadDraft(data.heroLeadText);
        onHeroLeadUpdated(data.heroLeadText);
      }
      if (typeof data.homeActionAboutTitle === 'string') {
        setAboutTitleDraft(data.homeActionAboutTitle);
        onHomeActionAboutUpdated(data.homeActionAboutTitle);
      }
      if (typeof data.homeActionContactTitle === 'string') {
        setContactTitleDraft(data.homeActionContactTitle);
        onHomeActionContactUpdated(data.homeActionContactTitle);
      }
      if (typeof data.homeActionMonobankTitle === 'string') {
        setMonobankTitleDraft(data.homeActionMonobankTitle);
        onHomeActionMonobankUpdated(data.homeActionMonobankTitle);
      }
      if (typeof data.homeActionInterviewsTitle === 'string') {
        setInterviewsTitleDraft(data.homeActionInterviewsTitle);
        onHomeActionInterviewsUpdated(data.homeActionInterviewsTitle);
      }
      setFeedback('Тексти та назви кнопок на головній оновлено.');
    } catch {
      setFeedback('Помилка з’єднання із сервером.');
    }
  };

  const handleAuthorPhotosUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    e.target.value = '';
    if (selectedFiles.length === 0) return;

    const remainingSlots = Math.max(0, 20 - photosDraft.length);
    if (remainingSlots <= 0) {
      setFeedback('Досягнуто максимум у 20 фото в галереї.');
      return;
    }

    const filesToUpload = selectedFiles.slice(0, remainingSlots);
    setUploadingPhotos(true);
    setFeedback(null);

    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;

      const uploadedUrls: string[] = [];
      for (let i = 0; i < filesToUpload.length; i += 1) {
        const file = filesToUpload[i];
        setPhotoUploadProgress(
          filesToUpload.length > 1
            ? `Завантаження (${i + 1}/${filesToUpload.length})...`
            : 'Завантаження...'
        );
        const dataUrl = await readImageAsOptimizedDataUrl(file);
        const response = await fetch('/api/author/upload-cover', {
          method: 'POST',
          headers,
          body: JSON.stringify({ dataUrl }),
        });
        const data = await response.json();
        if (!response.ok) {
          setFeedback(data.error || `Не вдалося завантажити фото «${file.name}».`);
          break;
        }
        if (typeof data.url === 'string' && data.url) {
          uploadedUrls.push(data.url);
        }
      }

      if (uploadedUrls.length > 0) {
        setPhotosDraft((prev) => {
          const merged = Array.from(new Set([...prev, ...uploadedUrls])).slice(0, 20);
          setPhotoDraft(merged[0] || '');
          return merged;
        });
        setFeedback(
          uploadedUrls.length > 1
            ? `Додано ${uploadedUrls.length} фото до галереї. Натисніть «Зберегти», щоб оновити сайт.`
            : 'Фото додано до галереї. Натисніть «Зберегти», щоб оновити сайт.'
        );
      }
    } catch {
      setFeedback('Не вдалося завантажити файл зображення.');
    } finally {
      setPhotoUploadProgress(null);
      setUploadingPhotos(false);
    }
  };

  const handleAddManualPhotoUrl = () => {
    const trimmed = manualPhotoUrlDraft.trim();
    if (!trimmed) return;
    if (!/^(\/src\/assets\/|\/uploads\/|\/assets\/|https?:\/\/)/i.test(trimmed)) {
      setFeedback('Посилання на фото має починатися з https://, http:// або /uploads/...');
      return;
    }
    if (photosDraft.length >= 20) {
      setFeedback('У галереї може бути щонайбільше 20 фото.');
      return;
    }
    setPhotosDraft((prev) => {
      if (prev.includes(trimmed)) return prev;
      const next = [...prev, trimmed];
      setPhotoDraft(next[0] || '');
      return next;
    });
    setManualPhotoUrlDraft('');
    setFeedback(null);
  };

  const handleMovePhoto = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= photosDraft.length) return;
    setPhotosDraft((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      setPhotoDraft(next[0] || '');
      return next;
    });
  };

  const handleRemovePhoto = (index: number) => {
    setPhotosDraft((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setPhotoDraft(next[0] || '');
      return next;
    });
  };

  const handleSaveAuthorProfile = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          authorAboutText: aboutDraft,
          authorPhotos: photosDraft,
          authorPhotoUrl: photosDraft[0] || photoDraft,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Помилка збереження профілю автора.');
        return;
      }
      if (typeof data.authorAboutText === 'string') {
        setAboutDraft(data.authorAboutText);
        onAuthorAboutUpdated(data.authorAboutText);
      }
      if (Array.isArray(data.authorPhotos) && data.authorPhotos.length > 0) {
        setPhotosDraft(data.authorPhotos);
        setPhotoDraft(data.authorPhotos[0]);
        onAuthorPhotoUpdated(data.authorPhotos[0]);
        onAuthorPhotosUpdated?.(data.authorPhotos);
      } else if (typeof data.authorPhotoUrl === 'string') {
        setPhotoDraft(data.authorPhotoUrl);
        setPhotosDraft([data.authorPhotoUrl]);
        onAuthorPhotoUpdated(data.authorPhotoUrl);
        onAuthorPhotosUpdated?.([data.authorPhotoUrl]);
      }
      setFeedback('Фотогалерею автора та блок «Про мене» оновлено.');
    } catch {
      setFeedback('Помилка з’єднання із сервером.');
    }
  };

  const handleSaveContactsAndSocials = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const rawTg = telegramDraft.trim();
      const normalizedTg = rawTg
        ? rawTg.startsWith('@')
          ? `https://t.me/${rawTg.slice(1)}`
          : /^t\.me\//i.test(rawTg)
            ? `https://${rawTg}`
            : rawTg
        : '';
      const hasTelegramRow = socialDraft.some((row) => row.platform === 'telegram');
      const nextSocialLinks = hasTelegramRow
        ? socialDraft.map((row) =>
            row.platform === 'telegram'
              ? {
                  ...row,
                  url: normalizedTg,
                  enabled: normalizedTg.length > 0 ? row.enabled : false,
                }
              : row
          )
        : [
            ...socialDraft,
            {
              platform: 'telegram' as const,
              label: 'Telegram',
              url: normalizedTg,
              enabled: normalizedTg.length > 0,
            },
          ];
      const response = await fetch('/api/author/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          monobankJarUrl: monobankDraft,
          monobankModalTitle: monobankModalTitleDraft,
          monobankModalSubtitle: monobankSubtitleDraft,
          monobankCardLabel: monobankCardLabelDraft,
          monobankModalText: monobankTextDraft,
          monobankEmptyText: monobankEmptyDraft,
          contactEmail: contactEmailDraft,
          socialLinks: nextSocialLinks,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Помилка збереження контактів та мереж.');
        return;
      }
      if (typeof data.monobankJarUrl === 'string') {
        setMonobankDraft(data.monobankJarUrl);
        onMonobankJarUpdated(data.monobankJarUrl);
      }
      const nextModalTitle =
        typeof data.monobankModalTitle === 'string'
          ? data.monobankModalTitle
          : monobankModalTitleDraft;
      const nextModalSubtitle =
        typeof data.monobankModalSubtitle === 'string'
          ? data.monobankModalSubtitle
          : monobankSubtitleDraft;
      const nextCardLabel =
        typeof data.monobankCardLabel === 'string' ? data.monobankCardLabel : monobankCardLabelDraft;
      const nextModalText =
        typeof data.monobankModalText === 'string' ? data.monobankModalText : monobankTextDraft;
      const nextEmptyText =
        typeof data.monobankEmptyText === 'string' ? data.monobankEmptyText : monobankEmptyDraft;
      setMonobankModalTitleDraft(nextModalTitle);
      setMonobankModalSubtitleDraft(nextModalSubtitle);
      setMonobankCardLabelDraft(nextCardLabel);
      setMonobankModalTextDraft(nextModalText);
      setMonobankEmptyTextDraft(nextEmptyText);
      onMonobankModalTextsUpdated?.({
        monobankModalTitle: nextModalTitle,
        monobankModalSubtitle: nextModalSubtitle,
        monobankCardLabel: nextCardLabel,
        monobankModalText: nextModalText,
        monobankEmptyText: nextEmptyText,
      });
      if (typeof data.contactEmail === 'string') {
        setContactEmailDraft(data.contactEmail);
        onContactEmailUpdated(data.contactEmail);
      }
      if (Array.isArray(data.socialLinks)) {
        setSocialDraft(data.socialLinks);
        const tg = (data.socialLinks as SocialLinkItem[]).find((s) => s.platform === 'telegram');
        setTelegramDraft(tg?.url || '');
        onSocialLinksUpdated(data.socialLinks);
      }
      setFeedback('Контакти, Монобанку та соціальні мережі оновлено.');
    } catch {
      setFeedback('Помилка з’єднання із сервером.');
    }
  };

  const persistInterviews = async (nextItems: InterviewLinkItem[], successText: string) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ interviews: nextItems }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Помилка збереження списку розмов.');
        return;
      }
      if (Array.isArray(data.interviews)) {
        setInterviewsDraft(data.interviews);
        onInterviewsUpdated(data.interviews);
      }
      setFeedback(successText);
    } catch {
      setFeedback('Помилка з’єднання із сервером.');
    }
  };

  const handleAddInterviewDraft = async (e: FormEvent) => {
    e.preventDefault();
    const title = newInterviewTitle.trim();
    const content = newInterviewContent.trim();
    const url = newInterviewUrl.trim();
    if (!title || (!content && !url)) {
      setFeedback('Вкажіть назву розмови та текст або посилання.');
      return;
    }

    if (editingInterviewId) {
      const nextItems = interviewsDraft.map((row) =>
        row.id === editingInterviewId
          ? {
              ...row,
              title,
              outlet: newInterviewOutlet.trim(),
              dateLabel: newInterviewDate.trim(),
              ...(content ? { content } : { content: undefined }),
              ...(url ? { url } : { url: undefined }),
            }
          : row
      );
      await persistInterviews(nextItems, 'Розмову оновлено.');
      setEditingInterviewId(null);
    } else {
      const item: InterviewLinkItem = {
        id: `interview-${Date.now()}`,
        title,
        outlet: newInterviewOutlet.trim(),
        dateLabel: newInterviewDate.trim(),
        ...(content ? { content } : {}),
        ...(url ? { url } : {}),
      };
      const nextItems = [item, ...interviewsDraft];
      await persistInterviews(nextItems, 'Розмову додано до списку.');
    }

    setNewInterviewTitle('');
    setNewInterviewOutlet('');
    setNewInterviewDate('');
    setNewInterviewContent('');
    setNewInterviewUrl('');
  };

  const handleMarkMessageRead = async (id: string) => {
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`/api/author/messages/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        headers,
      });
      const data = await response.json();
      if (response.ok && Array.isArray(data.contactMessages)) {
        setContactMessages(data.contactMessages);
      }
    } catch {
      // Ignore transient error
    }
  };

  const handleDeleteMessage = async (id: string) => {
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`/api/author/messages/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });
      const data = await response.json();
      if (response.ok && Array.isArray(data.contactMessages)) {
        setContactMessages(data.contactMessages);
      }
    } catch {
      // Ignore transient error
    }
  };

  const SUB_TABS: { id: HomeSubTab; label: string; count?: number; highlight?: boolean }[] = [
    { id: 'texts', label: 'Тексти й кнопки' },
    { id: 'repeaters', label: 'Ретранслятори' },
    { id: 'profile', label: 'Фото й «Про мене»', count: photosDraft.length },
    { id: 'contacts', label: 'Контакти й мережі' },
    { id: 'interviews', label: 'Розмови', count: interviewsDraft.length },
    { id: 'messages', label: 'Звернення', count: unreadCount > 0 ? unreadCount : contactMessages.length, highlight: unreadCount > 0 },
  ];

  return (
    <div className="space-y-6">
      {/* Sub-navigation bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
        {SUB_TABS.map((t) => {
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-[#141413] dark:bg-[#EDEAE1] text-white dark:text-[#181818] font-semibold'
                  : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] hover:bg-[#F5F4EE] dark:hover:bg-[#323232]'
              }`}
            >
              <span>{t.label}</span>
              {typeof t.count === 'number' && t.count > 0 && (
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    t.highlight && !active
                      ? 'text-[#2C5937] dark:text-[#E5E5E5] font-semibold'
                      : 'opacity-75'
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 1. Texts & Home Buttons */}
      {subTab === 'texts' && (
        <form onSubmit={handleSaveHomeTitlesAndLead} className="max-w-2xl space-y-6">
          <div className="space-y-2">
            <label htmlFor="studio-hero-lead" className={STUDIO_LABEL_CLASS}>
              Короткий підпис під іменем (епіграф на головній)
            </label>
            <textarea
              id="studio-hero-lead"
              rows={3}
              required
              minLength={3}
              maxLength={500}
              value={leadDraft}
              onChange={(e) => setLeadDraft(e.target.value)}
              className={STUDIO_INPUT_CLASS}
            />
          </div>

          <div className="pt-3 space-y-4">
            <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
              Назви чотирьох кнопок під фото на головній
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={STUDIO_LABEL_CLASS}>Кнопка «Про мене»</label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={aboutTitleDraft}
                  onChange={(e) => setAboutTitleDraft(e.target.value)}
                  className={STUDIO_INPUT_CLASS}
                />
              </div>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Кнопка «Зв’язок»</label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={contactTitleDraft}
                  onChange={(e) => setContactTitleDraft(e.target.value)}
                  className={STUDIO_INPUT_CLASS}
                />
                <button
                  type="button"
                  onClick={() => setSubTab('contacts')}
                  className="mt-1.5 text-[11px] font-medium text-[#2C5937] dark:text-[#E5E5E5] hover:underline cursor-pointer"
                >
                  Редагувати пошту і Telegram →
                </button>
              </div>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Кнопка «Підтримати через Монобанк»</label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={monobankTitleDraft}
                  onChange={(e) => setMonobankTitleDraft(e.target.value)}
                  className={STUDIO_INPUT_CLASS}
                />
                <button
                  type="button"
                  onClick={() => setSubTab('contacts')}
                  className="mt-1.5 text-[11px] font-medium text-[#2C5937] dark:text-[#E5E5E5] hover:underline cursor-pointer"
                >
                  Редагувати текст вікна Монобанки →
                </button>
              </div>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Кнопка «Розмови»</label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={interviewsTitleDraft}
                  onChange={(e) => setInterviewsTitleDraft(e.target.value)}
                  className={STUDIO_INPUT_CLASS}
                />
              </div>
            </div>
          </div>

          <button type="submit" className="btn-editorial-primary">
            <Save className="w-4 h-4" />
            <span>Зберегти зміни</span>
          </button>
        </form>
      )}

      {/* 1b. Home Repeaters Configuration */}
      {subTab === 'repeaters' && (
        <form onSubmit={handleSaveRepeaters} className="max-w-3xl space-y-5">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
              Що відображається в ретрансляторах на головній
            </p>
            <p className="text-xs text-[#5C5C58] dark:text-[#A6A196]">
              Оберіть добірку та кількість елементів для кожного з чотирьох блоків вітрини.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Вірші */}
            <div className="p-4 rounded-xl bg-[#FAF9F5] dark:bg-[#262626] space-y-2.5 flex flex-col justify-between">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                  Ретранслятор «Вірші»
                </p>
                <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] leading-relaxed">
                  Автоматично чергує твори автора (адміністратора) та вірші користувачів: один показ — твір автора, наступний — твір читача.
                </p>
              </div>
              <div className="text-[11px] font-mono text-[#2C5937] dark:text-[#E5E5E5] opacity-85">
                Режим: чергування (Адмін ↔ Користувач)
              </div>
            </div>

            {/* Проза */}
            <div className="p-4 rounded-xl bg-[#FAF9F5] dark:bg-[#262626] space-y-3">
              <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                Ретранслятор «Проза»
              </p>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Добірка прози</label>
                <select
                  value={repeatersDraft.proseMode}
                  onChange={(e) =>
                    setRepeatersDraft((prev) => ({
                      ...prev,
                      proseMode: e.target.value as ProseRepeaterMode,
                    }))
                  }
                  className={STUDIO_INPUT_CLASS}
                >
                  <option value="latest">Найновіші твори</option>
                  <option value="top_rated">За рейтингом читачів</option>
                  <option value="free_only">Лише у вільному доступі</option>
                  <option value="paid_only">Платні видання</option>
                </select>
              </div>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Кількість у циклі</label>
                <select
                  value={repeatersDraft.proseLimit}
                  onChange={(e) =>
                    setRepeatersDraft((prev) => ({
                      ...prev,
                      proseLimit: Number(e.target.value) || DEFAULT_HOME_REPEATERS.proseLimit,
                    }))
                  }
                  className={STUDIO_INPUT_CLASS}
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                    <option key={n} value={n}>
                      {n} шт.
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Блог */}
            <div className="p-4 rounded-xl bg-[#FAF9F5] dark:bg-[#262626] space-y-3">
              <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                Ретранслятор «БДК»
              </p>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Добірка дописів</label>
                <select
                  value={repeatersDraft.blogMode}
                  onChange={(e) =>
                    setRepeatersDraft((prev) => ({
                      ...prev,
                      blogMode: e.target.value as BlogRepeaterMode,
                    }))
                  }
                  className={STUDIO_INPUT_CLASS}
                >
                  <option value="latest">Найновіші дописи</option>
                  <option value="most_viewed">Найпопулярніші за переглядами</option>
                  <option value="quick_read">Коротке читання (найменше хвилин)</option>
                </select>
              </div>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Кількість у циклі</label>
                <select
                  value={repeatersDraft.blogLimit}
                  onChange={(e) =>
                    setRepeatersDraft((prev) => ({
                      ...prev,
                      blogLimit: Number(e.target.value) || DEFAULT_HOME_REPEATERS.blogLimit,
                    }))
                  }
                  className={STUDIO_INPUT_CLASS}
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                    <option key={n} value={n}>
                      {n} шт.
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Крамниця */}
            <div className="p-4 rounded-xl bg-[#FAF9F5] dark:bg-[#262626] space-y-3">
              <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                Ретранслятор «Крамниця»
              </p>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Які товари показувати</label>
                <select
                  value={repeatersDraft.storeMode}
                  onChange={(e) =>
                    setRepeatersDraft((prev) => ({
                      ...prev,
                      storeMode: e.target.value as StoreRepeaterMode,
                    }))
                  }
                  className={STUDIO_INPUT_CLASS}
                >
                  <option value="smart_highlights">Акції, знижки та бестселери</option>
                  <option value="discounted">Лише товари зі знижкою</option>
                  <option value="promo_active">Лише товари на акції</option>
                  <option value="bestsellers">Лише бестселери</option>
                  <option value="top_rated">За рейтингом покупців</option>
                  <option value="latest">Найновіші товари</option>
                </select>
              </div>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Кількість у циклі</label>
                <select
                  value={repeatersDraft.storeLimit}
                  onChange={(e) =>
                    setRepeatersDraft((prev) => ({
                      ...prev,
                      storeLimit: Number(e.target.value) || DEFAULT_HOME_REPEATERS.storeLimit,
                    }))
                  }
                  className={STUDIO_INPUT_CLASS}
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                    <option key={n} value={n}>
                      {n} шт.
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <button type="submit" disabled={savingRepeaters} className="btn-editorial-primary">
            <Save className="w-4 h-4" />
            <span>{savingRepeaters ? 'Збереження...' : 'Зберегти налаштування ретрансляторів'}</span>
          </button>
        </form>
      )}

      {/* 2. Author Photo Gallery & Bio */}
      {subTab === 'profile' && (
        <form onSubmit={handleSaveAuthorProfile} className="max-w-3xl space-y-5">
          <div>
            <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] mb-3">
              Фото плавно змінюються на головній сторінці (до 20 фото). Перше фото є головним.
            </p>
            {photosDraft.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {photosDraft.map((url, idx) => (
                  <div
                    key={`${url}-${idx}`}
                    className="relative group rounded-xl overflow-hidden bg-[#F5F4EE] dark:bg-[#262626]"
                  >
                    <EditorialImage
                      key={url}
                      src={url}
                      alt={`Фото автора ${idx + 1}`}
                      titleFallback={`Фото ${idx + 1}`}
                      aspectClassName="aspect-[3/4]"
                      className="w-full"
                    />
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-black/65 text-white tabular-nums">
                      {idx === 0 ? 'Головне' : `#${idx + 1}`}
                    </span>
                    <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMovePhoto(idx, -1)}
                          disabled={idx === 0}
                          title="Пересунути ліворуч"
                          aria-label="Пересунути фото ліворуч"
                          className="w-6 h-6 rounded-md bg-black/65 hover:bg-black/85 text-white inline-flex items-center justify-center disabled:opacity-35 cursor-pointer"
                        >
                          <ArrowLeft className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMovePhoto(idx, 1)}
                          disabled={idx === photosDraft.length - 1}
                          title="Пересунути праворуч"
                          aria-label="Пересунути фото праворуч"
                          className="w-6 h-6 rounded-md bg-black/65 hover:bg-black/85 text-white inline-flex items-center justify-center disabled:opacity-35 cursor-pointer"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(idx)}
                        title="Видалити фото"
                        aria-label="Видалити фото"
                        className="w-6 h-6 rounded-md bg-rose-600/90 hover:bg-rose-600 text-white inline-flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-[#FAF9F5] dark:bg-[#262626] text-xs text-[#5C5C58] dark:text-[#A6A196]">
                Список порожній — при збереженні відновиться стандартний портрет.
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
            <label className="btn-editorial-secondary cursor-pointer shrink-0">
              <Upload className="w-3.5 h-3.5" />
              <span>
                {uploadingPhotos ? photoUploadProgress || 'Завантаження...' : 'Завантажити фото'}
              </span>
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleAuthorPhotosUpload}
                disabled={uploadingPhotos}
                className="sr-only"
              />
            </label>

            <div className="flex-1 flex items-center gap-2">
              <input
                type="text"
                value={manualPhotoUrlDraft}
                onChange={(e) => setManualPhotoUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddManualPhotoUrl();
                  }
                }}
                placeholder="Або додайте URL фото (https://...)"
                className={`${STUDIO_INPUT_CLASS} font-mono text-xs`}
              />
              <button
                type="button"
                onClick={handleAddManualPhotoUrl}
                disabled={!manualPhotoUrlDraft.trim()}
                className="btn-editorial-secondary shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Додати</span>
              </button>
            </div>
          </div>

          <div className="pt-2">
            <label htmlFor="studio-about-text" className={STUDIO_LABEL_CLASS}>
              Текст блоку «Про мене» (порожні рядки розділяють текст на абзаци)
            </label>
            <textarea
              id="studio-about-text"
              rows={6}
              required
              minLength={10}
              maxLength={2500}
              value={aboutDraft}
              onChange={(e) => setAboutDraft(e.target.value)}
              className={`${STUDIO_INPUT_CLASS} leading-relaxed`}
            />
          </div>

          <button type="submit" className="btn-editorial-primary">
            <Save className="w-4 h-4" />
            <span>Зберегти галерею і «Про мене»</span>
          </button>
        </form>
      )}

      {/* 3. Contacts, Monobank & Social Links */}
      {subTab === 'contacts' && (
        <form onSubmit={handleSaveContactsAndSocials} className="max-w-2xl space-y-6">
          <div className="space-y-4">
            <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1] flex items-center gap-2">
              <Heart className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" />
              <span>Прямий зв’язок та підтримка</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className={STUDIO_LABEL_CLASS}>Електронна пошта для зв’язку</label>
                <input
                  type="email"
                  value={contactEmailDraft}
                  onChange={(e) => setContactEmailDraft(e.target.value)}
                  placeholder="andrijdankiv5@gmail.com"
                  className={STUDIO_INPUT_CLASS}
                />
              </div>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Посилання на Telegram (@username або URL)</label>
                <input
                  type="text"
                  value={telegramDraft}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setTelegramDraft(nextVal);
                    setSocialDraft((prev) => {
                      const hasTg = prev.some((row) => row.platform === 'telegram');
                      if (!hasTg) {
                        return [
                          ...prev,
                          {
                            platform: 'telegram',
                            label: 'Telegram',
                            url: nextVal,
                            enabled: nextVal.trim().length > 0,
                          },
                        ];
                      }
                      return prev.map((row) =>
                        row.platform === 'telegram'
                          ? { ...row, url: nextVal, enabled: nextVal.trim().length > 0 }
                          : row
                      );
                    });
                  }}
                  placeholder="https://t.me/username або @username"
                  className={STUDIO_INPUT_CLASS}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={STUDIO_LABEL_CLASS}>Посилання на банку Монобанку</label>
                <input
                  type="url"
                  value={monobankDraft}
                  onChange={(e) => setMonobankDraft(e.target.value)}
                  placeholder="https://send.monobank.ua/jar/..."
                  className={`${STUDIO_INPUT_CLASS} font-mono text-xs`}
                />
              </div>
            </div>
          </div>

          <div className="pt-3 space-y-3.5">
            <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
              Текст вікна «Підтримати через Монобанк»
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className={STUDIO_LABEL_CLASS}>Заголовок вікна</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={monobankModalTitleDraft}
                  onChange={(e) => setMonobankModalTitleDraft(e.target.value)}
                  placeholder="Підтримати через Монобанк"
                  className={STUDIO_INPUT_CLASS}
                />
              </div>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Підпис картки (біля серця)</label>
                <input
                  type="text"
                  maxLength={80}
                  value={monobankCardLabelDraft}
                  onChange={(e) => setMonobankCardLabelDraft(e.target.value)}
                  placeholder="Банка Монобанку"
                  className={STUDIO_INPUT_CLASS}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={STUDIO_LABEL_CLASS}>Підзаголовок вікна</label>
                <input
                  type="text"
                  maxLength={300}
                  value={monobankSubtitleDraft}
                  onChange={(e) => setMonobankModalSubtitleDraft(e.target.value)}
                  placeholder=""
                  className={STUDIO_INPUT_CLASS}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={STUDIO_LABEL_CLASS}>Основний текст у картці</label>
                <textarea
                  rows={3}
                  required
                  maxLength={1500}
                  value={monobankTextDraft}
                  onChange={(e) => setMonobankModalTextDraft(e.target.value)}
                  placeholder="Якщо вірші чи проза відгукнулися вам, можна підтримати мене довільним донатом через Монобанк. Мені буде приємно."
                  className={`${STUDIO_INPUT_CLASS} leading-relaxed`}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={STUDIO_LABEL_CLASS}>
                  Текст, коли посилання на банку ще не додано
                </label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={monobankEmptyDraft}
                  onChange={(e) => setMonobankEmptyTextDraft(e.target.value)}
                  placeholder="Пряме посилання на банку Монобанку наразі оновлюється автором. Ви можете уточнити реквізити через форму зворотного зв’язку."
                  className={`${STUDIO_INPUT_CLASS} leading-relaxed`}
                />
              </div>
            </div>
          </div>

          <div className="pt-3 space-y-3">
            <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
              Соціальні мережі у футері
            </p>
            <div className="rounded-xl space-y-1.5">
              {socialDraft.map((item) => {
                const meta = SOCIAL_PLATFORM_META[item.platform];
                return (
                  <div
                    key={item.platform}
                    className="px-3.5 py-2.5 rounded-xl flex flex-col sm:flex-row sm:items-center gap-2.5 bg-[#FAF9F5] dark:bg-[#262626]"
                  >
                    <label className="inline-flex items-center gap-2.5 min-w-[140px] text-xs font-medium text-[#141413] dark:text-[#EDEAE1] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSocialDraft((prev) =>
                            prev.map((row) =>
                              row.platform === item.platform ? { ...row, enabled: checked } : row
                            )
                          );
                        }}
                        className="accent-[#315E3C] dark:accent-[#E5E5E5] w-4 h-4 rounded cursor-pointer"
                      />
                      <SocialPlatformIcon
                        platform={item.platform}
                        className="w-4 h-4 text-[#5C5C58] dark:text-[#A6A196]"
                      />
                      <span>{meta?.label || item.label}</span>
                    </label>

                    <input
                      type={item.platform === 'telegram' ? 'text' : 'url'}
                      value={item.url}
                      placeholder={meta?.placeholder || 'https://...'}
                      onChange={(e) => {
                        const nextUrl = e.target.value;
                        if (item.platform === 'telegram') {
                          setTelegramDraft(nextUrl);
                        }
                        setSocialDraft((prev) =>
                          prev.map((row) =>
                            row.platform === item.platform
                              ? {
                                  ...row,
                                  url: nextUrl,
                                  enabled:
                                    nextUrl.trim().length > 0
                                      ? row.url.trim().length === 0
                                        ? true
                                        : row.enabled
                                      : false,
                                }
                              : row
                          )
                        );
                      }}
                      className="flex-1 min-w-0 px-3 py-1.5 text-xs font-mono bg-[#EFECE6] dark:bg-[#1B1B1B] rounded-lg text-[#141413] dark:text-[#EDEAE1] focus:outline-none focus:bg-white dark:focus:bg-[#323232]"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <button type="submit" className="btn-editorial-primary">
            <Save className="w-4 h-4" />
            <span>Зберегти контакти й мережі</span>
          </button>
        </form>
      )}

      {/* 4. Conversations */}
      {subTab === 'interviews' && (
        <div className="max-w-3xl space-y-6">
          <form
            onSubmit={handleAddInterviewDraft}
            className="pb-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1] flex items-center gap-2">
                <Mic className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" />
                <span>{editingInterviewId ? 'Редагувати розмову' : 'Додати розмову'}</span>
              </p>
              {editingInterviewId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingInterviewId(null);
                    setNewInterviewTitle('');
                    setNewInterviewOutlet('');
                    setNewInterviewDate('');
                    setNewInterviewContent('');
                    setNewInterviewUrl('');
                  }}
                  className="text-xs font-medium text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] cursor-pointer"
                >
                  Скасувати
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={newInterviewTitle}
                onChange={(e) => setNewInterviewTitle(e.target.value)}
                placeholder="Назва розмови або заголовок *"
                className={`sm:col-span-2 ${STUDIO_INPUT_CLASS}`}
              />
              <input
                type="text"
                value={newInterviewOutlet}
                onChange={(e) => setNewInterviewOutlet(e.target.value)}
                placeholder="Медіа або співрозмовник"
                className={STUDIO_INPUT_CLASS}
              />
              <input
                type="text"
                value={newInterviewDate}
                onChange={(e) => setNewInterviewDate(e.target.value)}
                placeholder="Період (напр., Осінь 2026)"
                className={STUDIO_INPUT_CLASS}
              />
              <textarea
                rows={5}
                value={newInterviewContent}
                onChange={(e) => setNewInterviewContent(e.target.value)}
                placeholder="Текст розмови (відкриватиметься прямо на сайті)..."
                className={`sm:col-span-2 ${STUDIO_INPUT_CLASS} leading-relaxed`}
              />
              <input
                type="url"
                value={newInterviewUrl}
                onChange={(e) => setNewInterviewUrl(e.target.value)}
                placeholder="Зовнішнє посилання https://... (необов’язково)"
                className={`sm:col-span-2 ${STUDIO_INPUT_CLASS} font-mono text-xs`}
              />
            </div>

            <button type="submit" className="btn-editorial-primary">
              {editingInterviewId ? <Save className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{editingInterviewId ? 'Зберегти зміни' : 'Додати розмову'}</span>
            </button>
          </form>

          {interviewsDraft.length === 0 ? (
            <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] py-6 text-center">
              Список розмов поки порожній.
            </p>
          ) : (
            <div className="space-y-2">
              {interviewsDraft.map((item) => (
                <div
                  key={item.id}
                  className="px-4 py-3 rounded-xl flex items-start justify-between gap-3 bg-[#FAF9F5] dark:bg-[#262626]"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium text-[#141413] dark:text-[#EDEAE1]">
                      {item.title}
                    </p>
                    <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] truncate">
                      {[item.outlet, item.dateLabel, item.content ? 'Текст на сайті' : '', item.url]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingInterviewId(item.id);
                        setNewInterviewTitle(item.title);
                        setNewInterviewOutlet(item.outlet || '');
                        setNewInterviewDate(item.dateLabel || '');
                        setNewInterviewContent(item.content || '');
                        setNewInterviewUrl(item.url || '');
                      }}
                      title="Редагувати"
                      aria-label={`Редагувати: ${item.title}`}
                      className="p-1.5 rounded-lg text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] hover:bg-[#F5F4EE] dark:hover:bg-[#323232] cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextItems = interviewsDraft.filter((row) => row.id !== item.id);
                        if (editingInterviewId === item.id) {
                          setEditingInterviewId(null);
                          setNewInterviewTitle('');
                          setNewInterviewOutlet('');
                          setNewInterviewDate('');
                          setNewInterviewContent('');
                          setNewInterviewUrl('');
                        }
                        persistInterviews(nextItems, 'Розмову видалено зі списку.');
                      }}
                      title="Видалити"
                      aria-label={`Видалити: ${item.title}`}
                      className="p-1.5 rounded-lg text-rose-700 dark:text-rose-400 hover:bg-rose-700/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. Contact Messages Inbox */}
      {subTab === 'messages' && (
        <div className="max-w-3xl space-y-4">
          {contactMessages.length === 0 ? (
            <div className="py-12 text-center space-y-2 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl">
              <Mail className="w-7 h-7 text-[#5C5C58] dark:text-[#A6A196] mx-auto" strokeWidth={1.5} />
              <p className="text-sm font-medium text-[#141413] dark:text-[#EDEAE1]">
                Нових звернень немає
              </p>
              <p className="text-xs text-[#5C5C58] dark:text-[#A6A196]">
                Повідомлення з форми «Зв’язатися з автором» з’являтимуться тут.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {contactMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-4 rounded-xl space-y-2 ${
                    msg.read
                      ? 'bg-[#FAF9F5] dark:bg-[#262626]'
                      : 'bg-[#F2F6EE] dark:bg-[#323232]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                      {msg.name}{' '}
                      <span className="font-normal text-[#5C5C58] dark:text-[#A6A196]">
                        · {msg.contact}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-mono text-[#5C5C58] dark:text-[#C4BFB4] tabular-nums">
                        {new Date(msg.createdAt).toLocaleDateString('uk-UA')}
                      </span>
                      {!msg.read && (
                        <button
                          type="button"
                          onClick={() => handleMarkMessageRead(msg.id)}
                          className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-white dark:bg-[#202020] text-[#2C5937] dark:text-[#E5E5E5] cursor-pointer whitespace-nowrap"
                        >
                          Прочитано
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteMessage(msg.id)}
                        title="Видалити повідомлення"
                        aria-label="Видалити повідомлення"
                        className="p-1.5 rounded-lg text-rose-700 dark:text-rose-400 hover:bg-rose-700/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-[#2B2B28] dark:text-[#D5D1C8] leading-relaxed whitespace-pre-line">
                    {msg.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
