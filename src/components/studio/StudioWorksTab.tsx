import {
  ArrowDown,
  ArrowUp,
  BookMarked,
  Check,
  CheckCircle2,
  Clapperboard,
  Clock,
  FileText,
  Film,
  FolderOpen,
  FolderPlus,
  GripVertical,
  ImagePlus,
  Music2,
  Palette,
  Pencil,
  Percent,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  Upload,
  UserCheck,
  Video,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  getProseEffectivePriceUah,
  type BlogPost,
  type Poem,
  type PoemImagePalette,
  type PoemSoundCloudTrack,
  type PoemSubmission,
  type ProseAccessMode,
  type ProseStatus,
  type ProseSubmission,
  type ProseTag,
  type ProseTagColor,
  type ProseWork,
} from '../../types.ts';
import {
  isValidBlogPhotoUrl,
  packBlogContentWithMedia,
  parseBlogContentBlocks,
  sanitizeFilmMeta,
  splitBlogParagraphs,
  unpackBlogContentForEditor,
  type BlogMediaDraftItem,
  type BlogMediaPlacement,
} from '../../utils/blogMedia.ts';
import { extractImagePalette } from '../../utils/imagePalette.ts';
import { readImageAsOptimizedDataUrl } from '../../utils/imageUpload.ts';
import { countPagesForText, countProseWords, PROSE_WORDS_PER_PAGE } from '../../utils/prosePagination.ts';
import { getProseTagPreset, isHexTagColor, PROSE_TAG_COLOR_LIST } from '../../utils/proseTagColors.ts';
import { preserveFormattedText } from '../../utils/textFormatting.ts';
import { HryvniaIcon } from '../StoreIcons.tsx';
import { StudioPoemSubmissionsPanel } from './StudioPoemSubmissionsPanel.tsx';
import { StudioProseSubmissionsPanel } from './StudioProseSubmissionsPanel.tsx';
import {
  formatFileSize,
  STUDIO_INPUT_CLASS,
  STUDIO_INPUT_SM_CLASS,
  STUDIO_LABEL_CLASS,
  type GetAuthHeadersFn,
} from './studioShared.ts';

export type WorksSubTab = 'list' | 'compose' | 'submissions' | 'settings';
type WorkTypeFilter = 'all' | 'prose' | 'poem' | 'blog';

export interface PoemThemePreset {
  id: string;
  label: string;
  bg: string;
  text: string;
}

export const POEM_THEME_PRESETS: ReadonlyArray<PoemThemePreset> = [
  { id: 'default', label: 'Тема сайту', bg: '', text: '' },
  { id: 'velvet', label: 'Нічний оксамит', bg: '#0D1117', text: '#F0F6FC' },
  { id: 'parchment', label: 'Старий пергамент', bg: '#F6F1E7', text: '#2D2319' },
  { id: 'forest', label: 'Карпатський ліс', bg: '#0D1C15', text: '#D1FAE5' },
  { id: 'wine', label: 'Винний сутінок', bg: '#241018', text: '#FCE7F3' },
  { id: 'amber', label: 'Графіт і бурштин', bg: '#1C1917', text: '#FDE68A' },
  { id: 'indigo', label: 'Глибокий індиго', bg: '#0F172A', text: '#E2E8F0' },
  { id: 'olive', label: 'Оливковий туман', bg: '#1A1D16', text: '#E9EDC9' },
];

interface StudioWorksTabProps {
  poems: Poem[];
  setPoems: (updater: (prev: Poem[]) => Poem[]) => void;
  poemSubmissions: PoemSubmission[];
  setPoemSubmissions: (updater: (prev: PoemSubmission[]) => PoemSubmission[]) => void;
  proseSubmissions: ProseSubmission[];
  setProseSubmissions: (updater: (prev: ProseSubmission[]) => ProseSubmission[]) => void;
  prose: ProseWork[];
  setProse: (updater: (prev: ProseWork[]) => ProseWork[]) => void;
  blog: BlogPost[];
  setBlog: (updater: (prev: BlogPost[]) => BlogPost[]) => void;
  proseTags: ProseTag[];
  setProseTags: (tags: ProseTag[]) => void;
  proseAuthDiscountDraft: string;
  setProseAuthDiscountDraft: (val: string) => void;
  proseTelegramDiscountDraft: string;
  setProseTelegramDiscountDraft: (val: string) => void;
  getAuthHeaders: GetAuthHeadersFn;
  setFeedback: (msg: string | null) => void;
  onCatalogUpdated: () => void;
  onReloadAuthorData: () => void;
  subTab: WorksSubTab;
  setSubTab: (tab: WorksSubTab) => void;
  onOpenTelegramSettings?: () => void;
}

export function StudioWorksTab({
  poems,
  setPoems,
  poemSubmissions,
  setPoemSubmissions,
  proseSubmissions,
  setProseSubmissions,
  prose,
  setProse,
  blog,
  setBlog,
  proseTags,
  setProseTags,
  proseAuthDiscountDraft,
  setProseAuthDiscountDraft,
  proseTelegramDiscountDraft,
  setProseTelegramDiscountDraft,
  getAuthHeaders,
  setFeedback,
  onCatalogUpdated,
  onReloadAuthorData,
  subTab,
  setSubTab,
  onOpenTelegramSettings,
}: StudioWorksTabProps) {
  // List filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<WorkTypeFilter>('all');
  const [submissionKindTab, setSubmissionKindTab] = useState<'poems' | 'prose'>(() =>
    proseSubmissions.some((s) => s.status === 'pending') &&
    !poemSubmissions.some((s) => s.status === 'pending')
      ? 'prose'
      : 'poems'
  );
  const [draggedPoemId, setDraggedPoemId] = useState<string | null>(null);
  const [dragOverPoemId, setDragOverPoemId] = useState<string | null>(null);
  const [editingOrderPoemId, setEditingOrderPoemId] = useState<string | null>(null);
  const [orderIndexDraft, setOrderIndexDraft] = useState('');
  const [reorderingPoems, setReorderingPoems] = useState(false);
  const poemsRef = useRef<Poem[]>(poems);
  poemsRef.current = poems;
  const reorderQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Publish form state
  const [pubKind, setPubKind] = useState<'poem' | 'prose' | 'blog'>('poem');
  const [pubTitle, setPubTitle] = useState('');
  const [pubMeta, setPubMeta] = useState('');
  const [pubProsePages, setPubProsePages] = useState('12');
  const [pubProseDate, setPubProseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pubProseSlogan, setPubProseSlogan] = useState('');
  const [pubExcerpt, setPubExcerpt] = useState('');
  const [pubContent, setPubContent] = useState('');
  const [pubProseAccessMode, setPubProseAccessMode] = useState<ProseAccessMode>('public');
  const [pubProsePrice, setPubProsePrice] = useState('75');
  const [pubProsePdfMeta, setPubProsePdfMeta] = useState<{
    fileName: string;
    fileSize: number;
    storageKey: string;
  } | null>(null);
  const [pubProseTagIds, setPubProseTagIds] = useState<string[]>([]);
  const [pubProseStatus, setPubProseStatus] = useState<ProseStatus | ''>('completed');
  const [pubProseMoodboardUrls, setPubProseMoodboardUrls] = useState<string[]>([]);

  // Blog rich media & cinema passport editing state
  const [editingBlogId, setEditingBlogId] = useState<string | null>(null);
  const [pubBlogCoverImage, setPubBlogCoverImage] = useState('');
  const [blogCoverUploadBusy, setBlogCoverUploadBusy] = useState(false);
  const [blogCoverUrlDraft, setBlogCoverUrlDraft] = useState('');
  const [pubBlogFilmTitle, setPubBlogFilmTitle] = useState('');
  const [pubBlogDirector, setPubBlogDirector] = useState('');
  const [pubBlogReleaseYear, setPubBlogReleaseYear] = useState('');
  const [pubBlogCountry, setPubBlogCountry] = useState('');
  const [pubBlogRuntimeMinutes, setPubBlogRuntimeMinutes] = useState('');
  const [pubBlogRating, setPubBlogRating] = useState('');
  const [pubBlogWatchFormat, setPubBlogWatchFormat] = useState('');
  const [pubBlogVerdict, setPubBlogVerdict] = useState('');
  const [pubBlogHasSpoilers, setPubBlogHasSpoilers] = useState(false);
  const [pubBlogMedia, setPubBlogMedia] = useState<BlogMediaDraftItem[]>([]);
  const [blogPhotoUploadBusy, setBlogPhotoUploadBusy] = useState(false);
  const [blogPhotoUrlDraft, setBlogPhotoUrlDraft] = useState('');
  const [blogPhotoCaptionDraft, setBlogPhotoCaptionDraft] = useState('');
  const [blogPhotoPlacementDraft, setBlogPhotoPlacementDraft] = useState<BlogMediaPlacement>('end');
  const [blogScUrlDraft, setBlogScUrlDraft] = useState('');
  const [blogScImporting, setBlogScImporting] = useState(false);
  const [blogScPlacementDraft, setBlogScPlacementDraft] = useState<BlogMediaPlacement>('end');
  const [blogYtUrlDraft, setBlogYtUrlDraft] = useState('');
  const [blogYtCaptionDraft, setBlogYtCaptionDraft] = useState('');
  const [blogYtImporting, setBlogYtImporting] = useState(false);
  const [blogYtPlacementDraft, setBlogYtPlacementDraft] = useState<BlogMediaPlacement>('end');

  // Poem editing & typesetting state
  const [editingPoemId, setEditingPoemId] = useState<string | null>(null);
  const [pubPoemYear, setPubPoemYear] = useState(() => String(new Date().getFullYear()));
  const [pubPoemWorkStatus, setPubPoemWorkStatus] = useState<ProseStatus | ''>('completed');
  const [pubPoemPositionMode, setPubPoemPositionMode] = useState<'start' | 'end' | 'custom'>('start');
  const [pubPoemCustomPosition, setPubPoemCustomPosition] = useState('1');
  const [pubPoemNote, setPubPoemNote] = useState('');
  const [pubPoemFontSize, setPubPoemFontSize] = useState<'sm' | 'base' | 'lg' | 'xl' | '2xl'>('lg');
  const [pubPoemTextAlign, setPubPoemTextAlign] = useState<'left' | 'center' | 'right'>('left');
  const [pubPoemLineSpacing, setPubPoemLineSpacing] = useState<'tight' | 'normal' | 'relaxed' | 'loose'>('relaxed');
  const [pubPoemTextColor, setPubPoemTextColor] = useState<string>('');
  const [pubPoemBackgroundColor, setPubPoemBackgroundColor] = useState<string>('');
  const [pubPoemImageUrl, setPubPoemImageUrl] = useState<string>('');
  const [pubPoemImagePalette, setPubPoemImagePalette] = useState<PoemImagePalette | null>(null);
  const [poemPhotoUploadBusy, setPoemPhotoUploadBusy] = useState(false);
  const [poemPhotoUrlDraft, setPoemPhotoUrlDraft] = useState('');
  const [poemPaletteExtracting, setPoemPaletteExtracting] = useState(false);
  const [pubPoemSoundCloudTracks, setPubPoemSoundCloudTracks] = useState<PoemSoundCloudTrack[]>([]);
  const [poemScUrlDraft, setPoemScUrlDraft] = useState('');
  const [poemScImporting, setPoemScImporting] = useState(false);

  // Settings & prose item controls
  const [savingProseDiscount, setSavingProseDiscount] = useState(false);
  const [savingProseTelegramDiscount, setSavingProseTelegramDiscount] = useState(false);
  const [tgHealth, setTgHealth] = useState<{
    botConfigured: boolean;
    botUsername: string | null;
    channelLabel: string;
    channelAccessible: boolean;
    webhookActive?: boolean;
    webhookUrl?: string | null;
    error: string | null;
  } | null>(null);
  const [checkingTgHealth, setCheckingTgHealth] = useState(false);
  const [configuringWebhook, setConfiguringWebhook] = useState(false);
  const [prosePriceDrafts, setProsePriceDrafts] = useState<Record<string, string>>({});
  const [uploadingProsePdfId, setUploadingProsePdfId] = useState<string | null>(null);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState<ProseTagColor>('rose');
  const [customHexDraft, setCustomHexDraft] = useState('#4D7C3F');
  const [savingTag, setSavingTag] = useState(false);
  const [expandedProseFolderId, setExpandedProseFolderId] = useState<string | null>(null);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [newChapterDate, setNewChapterDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newChapterContent, setNewChapterContent] = useState('');
  const [savingChapter, setSavingChapter] = useState(false);

  useEffect(() => {
    setProsePriceDrafts(() => {
      const next: Record<string, string> = {};
      for (const item of prose) {
        next[item.id] = String(item.priceUah || 75);
      }
      return next;
    });
  }, [prose]);

  const loadTgHealth = useCallback(async () => {
    setCheckingTgHealth(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch('/api/author/telegram-health', { headers });
      if (!res.ok) return;
      const data = (await res.json()) as {
        botConfigured: boolean;
        botUsername: string | null;
        channelLabel: string;
        channelAccessible: boolean;
        webhookActive?: boolean;
        webhookUrl?: string | null;
        error: string | null;
      };
      setTgHealth(data);
    } catch {
      // Ignore transient errors
    } finally {
      setCheckingTgHealth(false);
    }
  }, [getAuthHeaders]);

  const handleToggleWebhook = async (enabled: boolean) => {
    setConfiguringWebhook(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch('/api/author/telegram-webhook', {
        method: 'POST',
        headers,
        body: JSON.stringify({ enabled }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        webhookActive?: boolean;
        webhookUrl?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося налаштувати Telegram Webhook.');
        return;
      }
      setFeedback(
        data.webhookActive
          ? 'Telegram Webhook увімкнено — нотифікації про підписки надходитимуть миттєво.'
          : 'Telegram Webhook вимкнено (перевірка через опитування API).'
      );
      await loadTgHealth();
    } catch {
      setFeedback('Помилка під час налаштування Telegram Webhook.');
    } finally {
      setConfiguringWebhook(false);
    }
  };

  useEffect(() => {
    if (subTab === 'settings') {
      void loadTgHealth();
    }
  }, [subTab, loadTgHealth]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredProse = useMemo(() => {
    if (typeFilter !== 'all' && typeFilter !== 'prose') return [];
    if (!normalizedQuery) return prose;
    return prose.filter((p) => p.title.toLowerCase().includes(normalizedQuery));
  }, [prose, typeFilter, normalizedQuery]);

  const filteredPoems = useMemo(() => {
    if (typeFilter !== 'all' && typeFilter !== 'poem') return [];
    if (!normalizedQuery) return poems;
    return poems.filter((p) => p.title.toLowerCase().includes(normalizedQuery));
  }, [poems, typeFilter, normalizedQuery]);

  const filteredBlog = useMemo(() => {
    if (typeFilter !== 'all' && typeFilter !== 'blog') return [];
    if (!normalizedQuery) return blog;
    return blog.filter((b) => b.title.toLowerCase().includes(normalizedQuery));
  }, [blog, typeFilter, normalizedQuery]);

  const totalCount = poems.length + prose.length + blog.length;
  const filteredCount = filteredProse.length + filteredPoems.length + filteredBlog.length;
  const pendingPoemSubmissionsCount = poemSubmissions.filter((s) => s.status === 'pending').length;
  const pendingProseSubmissionsCount = proseSubmissions.filter((s) => s.status === 'pending').length;
  const pendingSubmissionsCount = pendingPoemSubmissionsCount + pendingProseSubmissionsCount;
  const totalSubmissionsCount = poemSubmissions.length + proseSubmissions.length;

  const getProseItemAccessMode = (work: ProseWork): ProseAccessMode => {
    if (work.accessMode === 'paid' || (Boolean(work.isPaid) && Number(work.priceUah || 0) > 0)) {
      return 'paid';
    }
    if (work.accessMode === 'authorized' || Boolean(work.requiresAuth)) {
      return 'authorized';
    }
    return 'public';
  };

  const uploadProsePdfFile = async (file: File, proseId?: string) => {
    const targetKey = proseId || 'new-prose-pdf';
    setUploadingProsePdfId(targetKey);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({
        'Content-Type': 'application/pdf',
        'X-File-Name': encodeURIComponent(file.name),
        ...(proseId ? { 'X-Prose-Id': proseId } : {}),
      });
      if (!headers) return;
      const response = await fetch('/api/author/upload-prose-pdf', {
        method: 'POST',
        headers,
        body: file,
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося завантажити PDF-документ.');
        return;
      }

      if (proseId && data.prose) {
        setProse((prev) => prev.map((p) => (p.id === proseId ? data.prose : p)));
        setFeedback(`PDF «${data.fileName}» прикріплено до твору.`);
        onCatalogUpdated();
      } else {
        setPubProsePdfMeta({
          fileName: data.fileName,
          fileSize: data.fileSize,
          storageKey: data.storageKey,
        });
        if (pubProseAccessMode === 'public') {
          setPubProseAccessMode('paid');
          setFeedback(`PDF «${data.fileName}» завантажено (встановлено платний доступ).`);
        } else {
          setFeedback(`PDF «${data.fileName}» завантажено та прикріплено.`);
        }
      }
    } catch {
      setFeedback('Помилка під час завантаження PDF-документа.');
    } finally {
      setUploadingProsePdfId(null);
    }
  };

  const handleClearProsePdf = async (proseId: string) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`/api/author/works/prose/${encodeURIComponent(proseId)}/pdf`, {
        method: 'DELETE',
        headers,
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося видалити PDF.');
        return;
      }
      setProse((prev) => prev.map((p) => (p.id === proseId ? data.item : p)));
      setFeedback('PDF-документ відкріплено.');
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося видалити PDF-документ.');
    }
  };

  const handleImportTextFile = (
    e: ChangeEvent<HTMLInputElement>,
    onLoaded: (content: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : '';
      const text = preserveFormattedText(raw);
      if (!text.trim()) {
        setFeedback('Файл порожній або не містить тексту.');
        return;
      }
      onLoaded(text);
      const words = countProseWords(text);
      const pages = Math.max(1, countPagesForText(text));
      setFeedback(
        `Текст із «${file.name}» завантажено (${words.toLocaleString('uk-UA')} слів · ${pages} стор.).`
      );
    };
    reader.onerror = () => {
      setFeedback('Не вдалося прочитати текстовий файл.');
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const blogParagraphs = useMemo(() => splitBlogParagraphs(pubContent), [pubContent]);

  const blogPlacementOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [
      { value: 'start', label: 'На початку тексту' },
    ];
    for (let i = 1; i < blogParagraphs.length; i += 1) {
      const preview = blogParagraphs[i - 1].replace(/\s+/g, ' ').slice(0, 22);
      opts.push({
        value: String(i),
        label: `Після абзацу ${i}${preview ? ` («${preview}…»)` : ''}`,
      });
    }
    opts.push({ value: 'end', label: 'Під текстом' });
    return opts;
  }, [blogParagraphs]);

  const encodePlacement = (p: BlogMediaPlacement): string =>
    p === 'start' || p === 'end' ? p : String(p);

  const decodePlacement = (raw: string): BlogMediaPlacement => {
    if (raw === 'start' || raw === 'end') return raw;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : 'end';
  };

  const resetComposeForm = () => {
    setEditingBlogId(null);
    setEditingPoemId(null);
    setPubTitle('');
    setPubMeta('');
    setPubProsePages('12');
    setPubProseDate(new Date().toISOString().slice(0, 10));
    setPubProseSlogan('');
    setPubProseTagIds([]);
    setPubProseStatus('completed');
    setPubProseMoodboardUrls([]);
    setPubExcerpt('');
    setPubContent('');
    setPubPoemYear(String(new Date().getFullYear()));
    setPubPoemWorkStatus('completed');
    setPubPoemPositionMode('start');
    setPubPoemCustomPosition('1');
    setPubPoemNote('');
    setPubPoemFontSize('lg');
    setPubPoemTextAlign('left');
    setPubPoemLineSpacing('relaxed');
    setPubPoemTextColor('');
    setPubPoemBackgroundColor('');
    setPubPoemImageUrl('');
    setPubPoemImagePalette(null);
    setPoemPhotoUrlDraft('');
    setPubPoemSoundCloudTracks([]);
    setPoemScUrlDraft('');
    setPubProseAccessMode('public');
    setPubProsePrice('75');
    setPubProsePdfMeta(null);
    setPubBlogCoverImage('');
    setBlogCoverUrlDraft('');
    setPubBlogFilmTitle('');
    setPubBlogDirector('');
    setPubBlogReleaseYear('');
    setPubBlogCountry('');
    setPubBlogRuntimeMinutes('');
    setPubBlogRating('');
    setPubBlogWatchFormat('');
    setPubBlogVerdict('');
    setPubBlogHasSpoilers(false);
    setPubBlogMedia([]);
    setBlogPhotoUrlDraft('');
    setBlogPhotoCaptionDraft('');
    setBlogPhotoPlacementDraft('end');
    setBlogScUrlDraft('');
    setBlogScPlacementDraft('end');
    setBlogYtUrlDraft('');
    setBlogYtCaptionDraft('');
    setBlogYtPlacementDraft('end');
  };

  const extractAndApplyPoemPalette = useCallback(
    async (imageUrl: string, resetManualOverrides: boolean) => {
      const clean = imageUrl.trim();
      if (!clean) {
        setPubPoemImagePalette(null);
        return;
      }
      setPoemPaletteExtracting(true);
      try {
        const headers = await getAuthHeaders();
        const palette = await extractImagePalette(clean, {
          proxyUrl: `/api/author/image-proxy?url=${encodeURIComponent(clean)}`,
          proxyHeaders: headers || undefined,
        });
        setPubPoemImagePalette(palette);
        if (resetManualOverrides && palette) {
          setPubPoemBackgroundColor('');
          setPubPoemTextColor('');
        }
      } finally {
        setPoemPaletteExtracting(false);
      }
    },
    [getAuthHeaders]
  );

  const handleStartEditPoem = async (poem: Poem) => {
    let resolvedPoem = poem;
    if (poem.contentTruncated) {
      setFeedback('Завантаження повного тексту вірша...');
      try {
        const res = await fetch(`/api/poems/${encodeURIComponent(poem.id)}/read`);
        if (res.ok) {
          const data = (await res.json()) as { content?: string };
          if (typeof data.content === 'string') {
            resolvedPoem = { ...poem, content: data.content, contentTruncated: false };
            setPoems((prev) =>
              prev.map((p) => (p.id === poem.id ? resolvedPoem : p))
            );
          }
        }
      } catch {
        // Fall back to existing content if offline
      }
    }
    setEditingPoemId(resolvedPoem.id);
    setPubKind('poem');
    setPubTitle(resolvedPoem.title);
    setPubMeta(resolvedPoem.cycle || '');
    setPubPoemYear(String(resolvedPoem.year || new Date().getFullYear()));
    setPubPoemWorkStatus(resolvedPoem.workStatus || '');
    setPubPoemPositionMode('start');
    setPubContent(resolvedPoem.content);
    setPubPoemNote(resolvedPoem.note || '');
    setPubPoemFontSize(resolvedPoem.fontSize || 'lg');
    setPubPoemTextAlign(resolvedPoem.textAlign || 'left');
    setPubPoemLineSpacing(resolvedPoem.lineSpacing || 'relaxed');
    setPubPoemTextColor(resolvedPoem.textColor || '');
    setPubPoemBackgroundColor(resolvedPoem.backgroundColor || '');
    setPubPoemImageUrl(resolvedPoem.imageUrl || '');
    setPubPoemImagePalette(resolvedPoem.imagePalette || null);
    setPoemPhotoUrlDraft('');
    setPubPoemSoundCloudTracks(
      resolvedPoem.soundcloudTracks && resolvedPoem.soundcloudTracks.length > 0
        ? resolvedPoem.soundcloudTracks
        : resolvedPoem.soundcloudTrack
          ? [resolvedPoem.soundcloudTrack]
          : []
    );
    setPoemScUrlDraft('');
    setFeedback(null);
    setSubTab('compose');
    if (resolvedPoem.imageUrl && !resolvedPoem.imagePalette) {
      void extractAndApplyPoemPalette(resolvedPoem.imageUrl, false);
    }
  };

  const handleUploadPoemPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPoemPhotoUploadBusy(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const dataUrl = await readImageAsOptimizedDataUrl(file);
      const response = await fetch('/api/author/upload-cover', {
        method: 'POST',
        headers,
        body: JSON.stringify({ dataUrl }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.url !== 'string' || !data.url) {
        setFeedback(data.error || 'Не вдалося завантажити фото до вірша.');
        return;
      }
      setPubPoemImageUrl(data.url);
      setPoemPhotoUrlDraft('');
      await extractAndApplyPoemPalette(data.url, true);
      setFeedback('Фото додано, а фон вірша підлаштовано під його палітру.');
    } catch {
      setFeedback('Не вдалося завантажити фото до вірша.');
    } finally {
      setPoemPhotoUploadBusy(false);
    }
  };

  const handleSetPoemPhotoUrl = async () => {
    const trimmed = poemPhotoUrlDraft.trim();
    if (!trimmed) return;
    if (!isValidBlogPhotoUrl(trimmed)) {
      setFeedback('Посилання на фото має починатися з https://, http:// або /uploads/...');
      return;
    }
    setFeedback(null);
    setPubPoemImageUrl(trimmed);
    setPoemPhotoUrlDraft('');
    await extractAndApplyPoemPalette(trimmed, true);
    setFeedback('Фото додано, а фон вірша підлаштовано під його палітру.');
  };

  const handleClearPoemPhoto = () => {
    setPubPoemImageUrl('');
    setPubPoemImagePalette(null);
    setPoemPhotoUrlDraft('');
  };

  const handleImportPoemSoundCloud = async () => {
    const trimmed = poemScUrlDraft.trim();
    if (!trimmed || poemScImporting) return;
    if (pubPoemSoundCloudTracks.length >= 10) {
      setFeedback('До одного вірша можна додати до 10 пісень.');
      return;
    }
    setPoemScImporting(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/poem/resolve-soundcloud', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: trimmed }),
      });
      const data = (await response.json()) as {
        error?: string;
        track?: PoemSoundCloudTrack;
        tracks?: PoemSoundCloudTrack[];
      };
      const incoming =
        Array.isArray(data.tracks) && data.tracks.length > 0
          ? data.tracks
          : data.track
            ? [data.track]
            : [];
      if (!response.ok || incoming.length === 0) {
        setFeedback(data.error || 'Не вдалося імпортувати пісню з SoundCloud.');
        return;
      }
      const existingUrls = new Set(
        pubPoemSoundCloudTracks.map((t) => t.soundcloudUrl.toLowerCase())
      );
      const uniqueNew = incoming.filter((t) => !existingUrls.has(t.soundcloudUrl.toLowerCase()));
      const merged = [...pubPoemSoundCloudTracks, ...uniqueNew].slice(0, 10);
      const addedCount = merged.length - pubPoemSoundCloudTracks.length;
      setPubPoemSoundCloudTracks(merged);
      setPoemScUrlDraft('');
      if (addedCount === 0) {
        setFeedback('Ці треки вже додані до вірша.');
      } else if (addedCount === 1) {
        const added = uniqueNew[0];
        setFeedback(`Пісню «${added?.title || ''}» додано до вірша.`);
      } else {
        setFeedback(`Додано пісень до вірша: ${addedCount}.`);
      }
    } catch {
      setFeedback('Помилка мережі під час імпорту треку з SoundCloud.');
    } finally {
      setPoemScImporting(false);
    }
  };

  const movePoemSoundCloudTrack = (index: number, delta: -1 | 1) => {
    setPubPoemSoundCloudTracks((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const removePoemSoundCloudTrack = (id: string) => {
    setPubPoemSoundCloudTracks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleStartEditBlog = async (post: BlogPost) => {
    let resolvedPost = post;
    if (post.contentTruncated) {
      setFeedback('Завантаження повного тексту допису...');
      try {
        const res = await fetch(`/api/blog/${encodeURIComponent(post.id)}/read`);
        if (res.ok) {
          const data = (await res.json()) as { content?: string };
          if (typeof data.content === 'string') {
            resolvedPost = { ...post, content: data.content, contentTruncated: false };
            setBlog((prev) =>
              prev.map((b) => (b.id === post.id ? resolvedPost : b))
            );
          }
        }
      } catch {
        // Fall back to existing content if offline
      }
    }
    const unpacked = unpackBlogContentForEditor(resolvedPost.content);
    setEditingBlogId(resolvedPost.id);
    setPubKind('blog');
    setPubTitle(resolvedPost.title);
    setPubMeta(resolvedPost.category || '');
    setPubExcerpt(resolvedPost.excerpt || '');
    setPubContent(unpacked.text);
    setPubBlogCoverImage(resolvedPost.coverImage || '');
    setBlogCoverUrlDraft('');
    setPubBlogFilmTitle(unpacked.filmMeta?.filmTitle || '');
    setPubBlogDirector(unpacked.filmMeta?.director || '');
    setPubBlogReleaseYear(
      unpacked.filmMeta?.releaseYear ? String(unpacked.filmMeta.releaseYear) : ''
    );
    setPubBlogCountry(unpacked.filmMeta?.country || '');
    setPubBlogRuntimeMinutes(
      unpacked.filmMeta?.runtimeMinutes ? String(unpacked.filmMeta.runtimeMinutes) : ''
    );
    setPubBlogRating(
      typeof unpacked.filmMeta?.rating === 'number' ? String(unpacked.filmMeta.rating) : ''
    );
    setPubBlogWatchFormat(unpacked.filmMeta?.watchFormat || '');
    setPubBlogVerdict(unpacked.filmMeta?.verdict || '');
    setPubBlogHasSpoilers(Boolean(unpacked.filmMeta?.hasSpoilers));
    setPubBlogMedia(unpacked.media);
    setBlogPhotoUrlDraft('');
    setBlogPhotoCaptionDraft('');
    setBlogPhotoPlacementDraft('end');
    setBlogScUrlDraft('');
    setBlogScPlacementDraft('end');
    setBlogYtUrlDraft('');
    setBlogYtCaptionDraft('');
    setBlogYtPlacementDraft('end');
    setFeedback(null);
    setSubTab('compose');
  };

  const handleUploadBlogCover = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBlogCoverUploadBusy(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const dataUrl = await readImageAsOptimizedDataUrl(file);
      const response = await fetch('/api/author/upload-cover', {
        method: 'POST',
        headers,
        body: JSON.stringify({ dataUrl }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) {
        setFeedback(data.error || 'Не вдалося завантажити постер фільму.');
        return;
      }
      setPubBlogCoverImage(String(data.url));
      setFeedback('Постер / кадр-обкладинку завантажено.');
    } catch {
      setFeedback('Не вдалося завантажити постер.');
    } finally {
      setBlogCoverUploadBusy(false);
    }
  };

  const handleSetBlogCoverUrl = () => {
    const trimmed = blogCoverUrlDraft.trim();
    if (!trimmed) return;
    if (!isValidBlogPhotoUrl(trimmed)) {
      setFeedback('Посилання на постер має починатися з https://, http:// або /uploads/...');
      return;
    }
    setPubBlogCoverImage(trimmed);
    setBlogCoverUrlDraft('');
    setFeedback('Постер / кадр-обкладинку додано.');
  };

  const handleUploadBlogPhotos = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    setBlogPhotoUploadBusy(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;

      const uploadedItems: BlogMediaDraftItem[] = [];
      for (const file of files.slice(0, 12)) {
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
          uploadedItems.push({
            id: `blog_img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            kind: 'photo',
            url: data.url,
            ...(blogPhotoCaptionDraft.trim() ? { caption: blogPhotoCaptionDraft.trim() } : {}),
            placement: blogPhotoPlacementDraft,
          });
        }
      }

      if (uploadedItems.length > 0) {
        setPubBlogMedia((prev) => [...prev, ...uploadedItems]);
        setBlogPhotoCaptionDraft('');
        setFeedback(
          uploadedItems.length > 1
            ? `Додано ${uploadedItems.length} фото до допису.`
            : 'Фото додано до допису.'
        );
      }
    } catch {
      setFeedback('Не вдалося завантажити фото.');
    } finally {
      setBlogPhotoUploadBusy(false);
    }
  };

  const handleAddBlogPhotoUrl = () => {
    const trimmed = blogPhotoUrlDraft.trim();
    if (!trimmed) return;
    if (!isValidBlogPhotoUrl(trimmed)) {
      setFeedback('Посилання на фото має починатися з https://, http:// або /uploads/...');
      return;
    }
    setPubBlogMedia((prev) => [
      ...prev,
      {
        id: `blog_img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        kind: 'photo',
        url: trimmed,
        ...(blogPhotoCaptionDraft.trim() ? { caption: blogPhotoCaptionDraft.trim() } : {}),
        placement: blogPhotoPlacementDraft,
      },
    ]);
    setBlogPhotoUrlDraft('');
    setBlogPhotoCaptionDraft('');
    setFeedback('Фото додано до допису.');
  };

  const handleImportBlogSoundCloud = async () => {
    const trimmed = blogScUrlDraft.trim();
    if (!trimmed || blogScImporting) return;
    setBlogScImporting(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/blog/resolve-soundcloud', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: trimmed }),
      });
      const data = (await response.json()) as {
        error?: string;
        tracks?: Array<{
          id: string;
          kind: 'track';
          title: string;
          artist: string;
          soundcloudUrl: string;
          embedTargetUrl: string;
          artworkUrl?: string;
        }>;
      };
      if (!response.ok || !Array.isArray(data.tracks) || data.tracks.length === 0) {
        setFeedback(data.error || 'Не вдалося імпортувати трек із SoundCloud.');
        return;
      }

      const nextItems: BlogMediaDraftItem[] = data.tracks.map((t) => ({
        ...t,
        placement: blogScPlacementDraft,
      }));
      setPubBlogMedia((prev) => [...prev, ...nextItems]);
      setBlogScUrlDraft('');
      setFeedback(
        nextItems.length > 1
          ? `Імпортовано ${nextItems.length} треків із SoundCloud до допису.`
          : `Пісню «${data.tracks[0].title}» додано до допису.`
      );
    } catch {
      setFeedback('Помилка мережі під час імпорту треку з SoundCloud.');
    } finally {
      setBlogScImporting(false);
    }
  };

  const handleImportBlogYouTube = async () => {
    const trimmed = blogYtUrlDraft.trim();
    if (!trimmed || blogYtImporting) return;
    setBlogYtImporting(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/blog/resolve-youtube', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: trimmed }),
      });
      const data = (await response.json()) as {
        error?: string;
        videos?: Array<{
          id: string;
          kind: 'youtube';
          videoId: string;
          youtubeUrl: string;
          title: string;
          authorName?: string;
          thumbnailUrl?: string;
        }>;
      };
      if (!response.ok || !Array.isArray(data.videos) || data.videos.length === 0) {
        setFeedback(data.error || 'Не вдалося імпортувати відео з YouTube.');
        return;
      }

      const cleanCaption = blogYtCaptionDraft.trim();
      const nextItems: BlogMediaDraftItem[] = data.videos.map((v) => ({
        ...v,
        ...(cleanCaption ? { caption: cleanCaption } : {}),
        placement: blogYtPlacementDraft,
      }));
      setPubBlogMedia((prev) => [...prev, ...nextItems]);
      setBlogYtUrlDraft('');
      setBlogYtCaptionDraft('');
      setFeedback(
        nextItems.length > 1
          ? `Імпортовано ${nextItems.length} відео з YouTube до допису.`
          : `Відео «${data.videos[0].title}» додано до допису.`
      );
    } catch {
      setFeedback('Помилка мережі під час імпорту відео з YouTube.');
    } finally {
      setBlogYtImporting(false);
    }
  };

  const handlePublishWork = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const formattedContent =
      pubKind === 'poem' || pubKind === 'prose' ? preserveFormattedText(pubContent) : pubContent;
    if (pubKind === 'poem' && !formattedContent.trim()) {
      setFeedback('Заповніть текст твору.');
      return;
    }
    if (pubKind === 'blog' && !pubContent.trim() && pubBlogMedia.length === 0) {
      setFeedback('Додайте текст допису, фото, відео з YouTube або пісню з SoundCloud.');
      return;
    }
    if (pubKind === 'prose' && !formattedContent.trim() && !pubProsePdfMeta) {
      setFeedback('Додайте вступний текст або завантажте PDF-документ твору.');
      return;
    }
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const resolvedPoemYear = Math.max(
        1900,
        Math.min(2200, Math.round(Number(pubPoemYear) || new Date().getFullYear()))
      );
      const payload: Record<string, unknown> = {
        title: pubTitle,
        content: formattedContent,
        year: resolvedPoemYear,
      };
      if (pubExcerpt.trim()) {
        payload.excerpt = pubExcerpt.trim();
      }
      if (pubKind === 'poem') {
        payload.cycle = pubMeta || 'Нові вірші';
        if (pubPoemWorkStatus) payload.workStatus = pubPoemWorkStatus;
        if (pubPoemNote.trim()) payload.note = pubPoemNote.trim();
        payload.fontSize = pubPoemFontSize;
        payload.textAlign = pubPoemTextAlign;
        payload.lineSpacing = pubPoemLineSpacing;
        if (pubPoemTextColor.trim()) payload.textColor = pubPoemTextColor.trim();
        if (pubPoemBackgroundColor.trim()) payload.backgroundColor = pubPoemBackgroundColor.trim();
        if (pubPoemImageUrl.trim()) {
          payload.imageUrl = pubPoemImageUrl.trim();
          if (pubPoemImagePalette) {
            payload.imagePalette = pubPoemImagePalette;
          }
        }
        if (pubPoemSoundCloudTracks.length > 0) {
          payload.soundcloudTracks = pubPoemSoundCloudTracks;
          payload.soundcloudTrack = pubPoemSoundCloudTracks[0];
        }
        if (!editingPoemId) {
          if (pubPoemPositionMode === 'end') {
            payload.position = 'end';
          } else if (pubPoemPositionMode === 'custom') {
            const targetPos = Math.max(
              1,
              Math.min(poems.length + 1, Math.round(Number(pubPoemCustomPosition) || 1))
            );
            payload.insertIndex = targetPos - 1;
          }
        }
      }

      if (editingPoemId && pubKind === 'poem') {
        const editResp = await fetch(`/api/author/works/poem/${encodeURIComponent(editingPoemId)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            title: pubTitle,
            cycle: pubMeta || 'Нові вірші',
            year: resolvedPoemYear,
            workStatus: pubPoemWorkStatus || null,
            content: formattedContent,
            note: pubPoemNote.trim() || null,
            fontSize: pubPoemFontSize,
            textAlign: pubPoemTextAlign,
            lineSpacing: pubPoemLineSpacing,
            textColor: pubPoemTextColor.trim() || null,
            backgroundColor: pubPoemBackgroundColor.trim() || null,
            imageUrl: pubPoemImageUrl.trim() || null,
            imagePalette: pubPoemImageUrl.trim() && pubPoemImagePalette ? pubPoemImagePalette : null,
            soundcloudTracks: pubPoemSoundCloudTracks,
            soundcloudTrack: pubPoemSoundCloudTracks[0] || null,
          }),
        });
        const editData = await editResp.json();
        if (!editResp.ok) {
          setFeedback(editData.error || 'Не вдалося оновити вірш.');
          return;
        }
        if (editData.item) {
          setPoems((prev) => prev.map((p) => (p.id === editingPoemId ? editData.item : p)));
        }
        resetComposeForm();
        setFeedback('Вірш оновлено.');
        setSubTab('list');
        onReloadAuthorData();
        onCatalogUpdated();
        return;
      }
      if (pubKind === 'prose') {
        const wordsCount = countProseWords(pubContent);
        const autoPages = Math.max(1, countPagesForText(pubContent));
        payload.genre = pubMeta || 'Оповідання';
        payload.pages =
          pubProsePdfMeta && wordsCount < PROSE_WORDS_PER_PAGE
            ? Math.max(1, Number(pubProsePages) || 1)
            : autoPages;
        if (pubProseDate.trim()) {
          payload.publishedAt = pubProseDate.trim();
        }
        if (pubProseSlogan.trim()) {
          payload.slogan = pubProseSlogan.trim();
        }
        if (pubProseTagIds.length > 0) {
          payload.tagIds = pubProseTagIds;
        }
        if (pubProseStatus) {
          payload.status = pubProseStatus;
        }
        const effectiveMode: ProseAccessMode =
          pubProsePdfMeta && pubProseAccessMode === 'public' ? 'paid' : pubProseAccessMode;
        const effectivePaid = effectiveMode === 'paid';
        payload.accessMode = effectiveMode;
        payload.requiresAuth = effectiveMode === 'authorized';
        payload.isPaid = effectivePaid;
        payload.priceUah = effectivePaid ? Math.max(10, Number(pubProsePrice) || 75) : 0;
        if (pubProsePdfMeta) {
          payload.pdfStorageKey = pubProsePdfMeta.storageKey;
          payload.pdfFileName = pubProsePdfMeta.fileName;
          payload.pdfFileSize = pubProsePdfMeta.fileSize;
        }
        if (pubProseMoodboardUrls.length > 0) {
          payload.moodboardUrls = pubProseMoodboardUrls;
        }
      }
      if (pubKind === 'blog') {
        const cleanFilmMeta = sanitizeFilmMeta({
          filmTitle: pubBlogFilmTitle,
          director: pubBlogDirector,
          releaseYear: pubBlogReleaseYear ? Number(pubBlogReleaseYear) : undefined,
          country: pubBlogCountry,
          runtimeMinutes: pubBlogRuntimeMinutes ? Number(pubBlogRuntimeMinutes) : undefined,
          rating: pubBlogRating ? Number(pubBlogRating) : undefined,
          watchFormat: pubBlogWatchFormat,
          verdict: pubBlogVerdict,
          hasSpoilers: pubBlogHasSpoilers,
        });
        const packedContent = packBlogContentWithMedia(pubContent, pubBlogMedia, cleanFilmMeta);
        const cleanCoverImage = pubBlogCoverImage.trim();

        if (editingBlogId) {
          const editResp = await fetch(`/api/author/works/blog/${encodeURIComponent(editingBlogId)}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              title: pubTitle,
              category: pubMeta || 'Авторське кіно',
              coverImage: cleanCoverImage || null,
              excerpt: pubExcerpt.trim(),
              content: packedContent,
            }),
          });
          const editData = await editResp.json();
          if (!editResp.ok) {
            setFeedback(editData.error || 'Не вдалося оновити рецензію.');
            return;
          }
          if (editData.item) {
            setBlog((prev) => prev.map((b) => (b.id === editingBlogId ? editData.item : b)));
          }
          resetComposeForm();
          setFeedback('Рецензію в кіноблозі БДК оновлено.');
          setSubTab('list');
          onReloadAuthorData();
          onCatalogUpdated();
          return;
        }

        payload.category = pubMeta || 'Авторське кіно';
        if (cleanCoverImage) {
          payload.coverImage = cleanCoverImage;
        }
        payload.content = packedContent;
      }

      const response = await fetch('/api/author/publish', {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: pubKind, payload }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Помилка публікації.');
        return;
      }
      resetComposeForm();
      setFeedback('Твір опубліковано на сайті.');
      setSubTab('list');
      onReloadAuthorData();
      onCatalogUpdated();
    } catch {
      setFeedback('Помилка публікації.');
    }
  };

  const handleSaveProseDiscount = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = Math.max(0, Math.min(90, Math.round(Number(proseAuthDiscountDraft) || 0)));
    setFeedback(null);
    setSavingProseDiscount(true);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/prose-discount', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ proseAuthDiscountPercent: parsed }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося зберегти знижку для авторизованих читачів.');
        return;
      }
      const nextPercent = Number(data.proseAuthDiscountPercent ?? parsed);
      setProseAuthDiscountDraft(String(nextPercent));
      setFeedback(
        nextPercent > 0
          ? `Спеціальну знижку −${nextPercent}% на платну прозу для авторизованих збережено.`
          : 'Спеціальну знижку на платну прозу вимкнено (0%).'
      );
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося зберегти знижку для авторизованих читачів.');
    } finally {
      setSavingProseDiscount(false);
    }
  };

  const handleSaveProseTelegramDiscount = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = Math.max(0, Math.min(90, Math.round(Number(proseTelegramDiscountDraft) || 0)));
    setFeedback(null);
    setSavingProseTelegramDiscount(true);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/prose-telegram-discount', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ proseTelegramDiscountPercent: parsed }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося зберегти знижку для підписників Telegram у Прозі.');
        return;
      }
      const nextPercent = Number(data.proseTelegramDiscountPercent ?? parsed);
      setProseTelegramDiscountDraft(String(nextPercent));
      setFeedback(
        nextPercent > 0
          ? `Знижку −${nextPercent}% на платну прозу для підписників Telegram-каналу збережено.`
          : 'Знижку для підписників Telegram-каналу в Прозі вимкнено (0%).'
      );
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося зберегти знижку для підписників Telegram у Прозі.');
    } finally {
      setSavingProseTelegramDiscount(false);
    }
  };

  const handleUpdateProseAccessMode = async (
    work: ProseWork,
    nextMode: ProseAccessMode,
    nextPriceUah?: number
  ) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const resolvedPrice =
        nextMode === 'paid'
          ? Math.max(10, Math.round(nextPriceUah ?? Number(prosePriceDrafts[work.id] || work.priceUah || 75)))
          : 0;
      const response = await fetch(`/api/author/works/prose/${encodeURIComponent(work.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          accessMode: nextMode,
          requiresAuth: nextMode === 'authorized',
          isPaid: nextMode === 'paid',
          priceUah: resolvedPrice,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося оновити доступ до твору.');
        return;
      }
      setProse((prev) => prev.map((item) => (item.id === work.id ? data.item : item)));
      if (data.item?.priceUah) {
        setProsePriceDrafts((prev) => ({ ...prev, [work.id]: String(data.item.priceUah) }));
      }
      setFeedback(
        nextMode === 'paid'
          ? `Увімкнено платний доступ (${data.item.priceUah} ₴) для «${work.title}».`
          : nextMode === 'authorized'
            ? `Твір «${work.title}» відкрито для авторизованих користувачів.`
            : `Твір «${work.title}» відкрито для вільного читання.`
      );
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося оновити параметри доступу.');
    }
  };

  const handleCreateProseTag = async (e: FormEvent) => {
    e.preventDefault();
    const cleanLabel = newTagLabel.trim();
    if (cleanLabel.length < 2) {
      setFeedback('Вкажіть назву тегу (мінімум 2 символи).');
      return;
    }
    setFeedback(null);
    setSavingTag(true);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/prose-tags', {
        method: 'POST',
        headers,
        body: JSON.stringify({ label: cleanLabel, color: newTagColor }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося створити тег.');
        return;
      }
      setProseTags(data.proseTags || []);
      setNewTagLabel('');
      setFeedback(`Створено тег «${data.tag.label}».`);
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося створити тег.');
    } finally {
      setSavingTag(false);
    }
  };

  const handleDeleteProseTag = async (tagId: string) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`/api/author/prose-tags/${encodeURIComponent(tagId)}`, {
        method: 'DELETE',
        headers,
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося видалити тег.');
        return;
      }
      setProseTags(data.proseTags || []);
      setProse((prev) =>
        prev.map((w) => ({
          ...w,
          tagIds: (w.tagIds || []).filter((id) => id !== tagId),
        }))
      );
      setPubProseTagIds((prev) => prev.filter((id) => id !== tagId));
      setFeedback('Тег видалено.');
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося видалити тег.');
    }
  };

  const handleUpdateProseTagColor = async (tagId: string, nextColor: string) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch(`/api/author/prose-tags/${encodeURIComponent(tagId)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ color: nextColor }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося оновити колір тегу.');
        return;
      }
      setProseTags(data.proseTags || []);
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося оновити колір тегу.');
    }
  };

  const handleToggleProseWorkTag = async (work: ProseWork, tagId: string) => {
    setFeedback(null);
    const currentIds = work.tagIds || [];
    const nextIds = currentIds.includes(tagId)
      ? currentIds.filter((id) => id !== tagId)
      : [...currentIds, tagId];

    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch(`/api/author/works/prose/${encodeURIComponent(work.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ tagIds: nextIds }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося оновити теги твору.');
        return;
      }
      setProse((prev) => prev.map((item) => (item.id === work.id ? data.item : item)));
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося оновити теги твору.');
    }
  };

  const handleUpdateProseStatus = async (work: ProseWork, nextStatus: ProseStatus | null) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch(`/api/author/works/prose/${encodeURIComponent(work.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося оновити статус твору.');
        return;
      }
      setProse((prev) => prev.map((item) => (item.id === work.id ? data.item : item)));
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося оновити статус твору.');
    }
  };

  const handleUpdatePoemWorkStatus = async (poem: Poem, nextStatus: ProseStatus | null) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch(`/api/author/works/poem/${encodeURIComponent(poem.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ workStatus: nextStatus }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося оновити статус вірша.');
        return;
      }
      setPoems((prev) => prev.map((item) => (item.id === poem.id ? data.item : item)));
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося оновити статус вірша.');
    }
  };

  const handleAddProseChapter = async (proseId: string, e: FormEvent) => {
    e.preventDefault();
    const cleanTitle = newChapterTitle.trim();
    const cleanContent = preserveFormattedText(newChapterContent);
    if (cleanTitle.length < 2 || cleanContent.trim().length < 2) {
      setFeedback('Вкажіть назву та текст нового розділу.');
      return;
    }
    setFeedback(null);
    setSavingChapter(true);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch(`/api/author/works/prose/${encodeURIComponent(proseId)}/chapters`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: cleanTitle,
          content: cleanContent,
          publishedAt: newChapterDate.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося додати розділ.');
        return;
      }
      setProse((prev) => prev.map((item) => (item.id === proseId ? data.item : item)));
      setNewChapterTitle('');
      setNewChapterContent('');
      setNewChapterDate(new Date().toISOString().slice(0, 10));
      setFeedback(`Розділ «${data.chapter.title}» додано в теку твору.`);
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося додати розділ.');
    } finally {
      setSavingChapter(false);
    }
  };

  const handleDeleteProseChapter = async (proseId: string, chapterId: string) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(
        `/api/author/works/prose/${encodeURIComponent(proseId)}/chapters/${encodeURIComponent(chapterId)}`,
        { method: 'DELETE', headers }
      );
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося видалити розділ.');
        return;
      }
      setProse((prev) => prev.map((item) => (item.id === proseId ? data.item : item)));
      setFeedback('Розділ видалено з теки твору.');
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося видалити розділ.');
    }
  };

  const persistPoemsOrder = useCallback(
    (nextPoems: Poem[]) => {
      poemsRef.current = nextPoems;
      setPoems(() => nextPoems);
      setReorderingPoems(true);

      const orderedIds = nextPoems.map((p) => p.id);
      reorderQueueRef.current = reorderQueueRef.current.then(async () => {
        try {
          const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
          if (!headers) return;
          const res = await fetch('/api/author/poems/reorder', {
            method: 'PUT',
            headers,
            body: JSON.stringify({ orderedIds }),
          });
          if (!res.ok) {
            const errData = (await res.json().catch(() => ({}))) as { error?: string };
            setFeedback(errData.error || 'Не вдалося зберегти порядок віршів.');
            onReloadAuthorData();
            return;
          }
          setFeedback('Порядок показу віршів збережено.');
          onCatalogUpdated();
        } catch {
          setFeedback('Помилка мережі під час збереження порядку віршів.');
          onReloadAuthorData();
        } finally {
          setReorderingPoems(false);
        }
      });
    },
    [getAuthHeaders, onCatalogUpdated, onReloadAuthorData, setFeedback, setPoems]
  );

  const handleMovePoemByDelta = (poemId: string, delta: -1 | 1) => {
    const list = poemsRef.current;
    const idx = list.findIndex((p) => p.id === poemId);
    const targetIdx = idx + delta;
    if (idx < 0 || targetIdx < 0 || targetIdx >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(idx, 1);
    next.splice(targetIdx, 0, moved);
    persistPoemsOrder(next);
  };

  const handleMovePoemToPosition = (poemId: string, oneBasedPos: number) => {
    const list = poemsRef.current;
    const fromIdx = list.findIndex((p) => p.id === poemId);
    if (fromIdx < 0) return;
    const targetIdx = Math.max(0, Math.min(list.length - 1, Math.round(oneBasedPos) - 1));
    setEditingOrderPoemId(null);
    if (targetIdx === fromIdx) return;
    const next = [...list];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(targetIdx, 0, moved);
    persistPoemsOrder(next);
  };

  const handleDropPoemOn = (targetPoemId: string) => {
    const fromId = draggedPoemId;
    setDraggedPoemId(null);
    setDragOverPoemId(null);
    if (!fromId || fromId === targetPoemId) return;
    const list = poemsRef.current;
    const fromIdx = list.findIndex((p) => p.id === fromId);
    const toIdx = list.findIndex((p) => p.id === targetPoemId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const next = [...list];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    persistPoemsOrder(next);
  };

  const handleDeleteWork = async (kind: 'poem' | 'prose' | 'blog', id: string) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`/api/author/works/${kind}/${id}`, {
        method: 'DELETE',
        headers,
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося видалити запис.');
        return;
      }
      if (kind === 'poem') setPoems((prev) => prev.filter((p) => p.id !== id));
      if (kind === 'prose') setProse((prev) => prev.filter((p) => p.id !== id));
      if (kind === 'blog') setBlog((prev) => prev.filter((p) => p.id !== id));
      setFeedback('Запис видалено.');
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося видалити запис.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSubTab('list')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              subTab === 'list'
                ? 'bg-[#141413] dark:bg-[#EDEAE1] text-white dark:text-[#181818] font-semibold'
                : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] hover:bg-[#F5F4EE] dark:hover:bg-[#323232]'
            }`}
          >
            <span>Усі твори</span>
            <span className="font-mono text-[11px] tabular-nums opacity-75">{totalCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('compose')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              subTab === 'compose'
                ? 'bg-[#141413] dark:bg-[#EDEAE1] text-white dark:text-[#181818] font-semibold'
                : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] hover:bg-[#F5F4EE] dark:hover:bg-[#323232]'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Опублікувати</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('submissions')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              subTab === 'submissions'
                ? 'bg-[#141413] dark:bg-[#EDEAE1] text-white dark:text-[#181818] font-semibold'
                : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] hover:bg-[#F5F4EE] dark:hover:bg-[#323232]'
            }`}
          >
            <span>Заявки читачів</span>
            {totalSubmissionsCount > 0 && (
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  pendingSubmissionsCount > 0
                    ? 'px-1.5 py-0.5 rounded-full bg-red-600 text-white font-semibold'
                    : 'opacity-75'
                }`}
              >
                {pendingSubmissionsCount > 0 ? pendingSubmissionsCount : totalSubmissionsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubTab('settings')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              subTab === 'settings'
                ? 'bg-[#141413] dark:bg-[#EDEAE1] text-white dark:text-[#181818] font-semibold'
                : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] hover:bg-[#F5F4EE] dark:hover:bg-[#323232]'
            }`}
          >
            <span>Теги й знижки</span>
            {proseTags.length > 0 && (
              <span className="font-mono text-[11px] tabular-nums opacity-75">{proseTags.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* 1. Works List View */}
      {subTab === 'list' && (
        <div className="space-y-4">
          {/* Search + Type Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-[#787872] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Пошук за назвою..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#EFECE6] dark:bg-[#1B1B1B] rounded-lg text-[#141413] dark:text-[#EDEAE1] placeholder:text-[#787872] focus:outline-none focus:bg-[#FAF9F5] dark:focus:bg-[#323232]"
              />
            </div>

            <div className="flex items-center gap-1 overflow-x-auto">
              {(
                [
                  { id: 'all', label: 'Усі', count: totalCount },
                  { id: 'prose', label: 'Проза', count: prose.length },
                  { id: 'poem', label: 'Вірші', count: poems.length },
                  { id: 'blog', label: 'БДК', count: blog.length },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTypeFilter(f.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                    typeFilter === f.id
                      ? 'bg-[#EAE7DF] dark:bg-[#323232] text-[#141413] dark:text-[#EDEAE1] font-semibold'
                      : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                  }`}
                >
                  {f.label} <span className="font-mono text-[11px] opacity-70 tabular-nums">{f.count}</span>
                </button>
              ))}
            </div>
          </div>

          {filteredCount === 0 ? (
            <div className="py-12 text-center space-y-2 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl">
              <p className="text-sm font-medium text-[#141413] dark:text-[#EDEAE1]">
                {normalizedQuery ? 'Нічого не знайдено' : 'Матеріалів поки немає'}
              </p>
              <button
                type="button"
                onClick={() => (normalizedQuery ? setSearchQuery('') : setSubTab('compose'))}
                className="btn-editorial-secondary mt-2"
              >
                {normalizedQuery ? 'Скинути пошук' : 'Опублікувати перший твір'}
              </button>
            </div>
          ) : (
            (() => {
              const adminProse = filteredProse.filter((p) => !p.isCommunity);
              const userProse = filteredProse.filter((p) => Boolean(p.isCommunity));
              const adminPoems = filteredPoems.filter((p) => !p.isCommunity);
              const userPoems = filteredPoems.filter((p) => Boolean(p.isCommunity));
              const adminTotal = adminProse.length + adminPoems.length + filteredBlog.length;
              const userTotal = userProse.length + userPoems.length;

              const canReorderPoems = !normalizedQuery && poems.length > 1;
              const firstAuthorPoemId = poems.find((item) => !item.isCommunity)?.id ?? poems[0]?.id;
              const poemIndexMap = new Map(poems.map((item, idx) => [item.id, idx]));

              const renderProseCard = (p: ProseWork) => {
                const pMode = getProseItemAccessMode(p);
                const activeDiscountPct = Math.max(0, Math.min(90, Number(proseAuthDiscountDraft) || 0));
                const discountedPreview =
                  pMode === 'paid' && activeDiscountPct > 0
                    ? getProseEffectivePriceUah(p.priceUah || 0, activeDiscountPct, true)
                    : null;

                return (
                  <div key={p.id} className="p-4 rounded-xl text-xs space-y-2.5 bg-[#FAF9F5] dark:bg-[#262626]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-[11px] font-medium text-[#5C5C58] dark:text-[#A6A196]">
                            Проза
                          </span>
                          {p.isCommunity && (
                            <>
                              <span aria-hidden="true" className="text-[#C4BFB4]">·</span>
                              <span className="text-[11px] font-medium text-[#2C5937] dark:text-[#E5E5E5]">
                                {p.authorName || 'Читач'}
                              </span>
                            </>
                          )}
                          <span aria-hidden="true" className="text-[#C4BFB4]">·</span>
                          <span className="text-sm font-semibold text-[#141413] dark:text-[#EDEAE1]">
                            {p.title}
                          </span>
                          <span aria-hidden="true" className="text-[#C4BFB4]">·</span>
                          <span className="font-mono text-[11px] text-[#5C5C58] dark:text-[#A6A196] tabular-nums">
                            {p.pages} стор.
                          </span>
                          <span aria-hidden="true" className="text-[#C4BFB4]">·</span>
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#2C5937] dark:text-[#E5E5E5] tabular-nums">
                            {pMode === 'paid' ? (
                              <>
                                <HryvniaIcon className="w-3 h-3" />
                                <span>{p.priceUah}</span>
                                {discountedPreview !== null && (
                                  <span className="text-[#1E563B] dark:text-[#E5E5E5]">
                                    ({discountedPreview} ₴ авториз.)
                                  </span>
                                )}
                              </>
                            ) : pMode === 'authorized' ? (
                              <span className="inline-flex items-center gap-1 font-sans font-medium">
                                <UserCheck className="w-3 h-3" />
                                <span>Авторизованим</span>
                              </span>
                            ) : (
                              <span className="font-sans">Відкритий</span>
                            )}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteWork('prose', p.id)}
                        className="p-1.5 text-[#5C5C58] dark:text-[#A6A196] hover:text-rose-700 dark:hover:text-rose-400 rounded-lg hover:bg-rose-700/10 cursor-pointer shrink-0"
                        aria-label={`Видалити твір ${p.title}`}
                        title="Видалити твір"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Inline Action Controls */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div
                        className="inline-flex items-center gap-0.5 p-0.5 bg-[#EFECE6] dark:bg-[#202020] rounded-lg"
                        role="group"
                        aria-label={`Доступ для ${p.title}`}
                      >
                        {(['public', 'authorized', 'paid'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() =>
                              handleUpdateProseAccessMode(
                                p,
                                mode,
                                mode === 'paid' ? Number(prosePriceDrafts[p.id] || p.priceUah || 75) : undefined
                              )
                            }
                            className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap transition-colors ${
                              pMode === mode
                                ? 'bg-pear-pine-gradient text-white font-semibold'
                                : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                            }`}
                          >
                            {mode === 'public' ? 'Відкритий' : mode === 'authorized' ? 'Авторизованим' : 'Платний'}
                          </button>
                        ))}
                      </div>

                      {pMode === 'paid' && (
                        <div className="inline-flex items-center gap-1 bg-[#EFECE6] dark:bg-[#202020] rounded-lg px-2 py-0.5">
                          <input
                            type="number"
                            min={10}
                            value={prosePriceDrafts[p.id] ?? String(p.priceUah || 75)}
                            onChange={(e) =>
                              setProsePriceDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            aria-label={`Ціна для ${p.title}`}
                            className="w-12 py-0.5 text-[11px] font-mono tabular-nums bg-transparent text-[#141413] dark:text-[#EDEAE1] focus:outline-none"
                          />
                          <span className="text-[11px] font-mono text-[#5C5C58]">₴</span>
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateProseAccessMode(
                                p,
                                'paid',
                                Number(prosePriceDrafts[p.id] || p.priceUah || 75)
                              )
                            }
                            className="px-1.5 py-0.5 text-[10px] font-semibold bg-white dark:bg-[#323232] text-[#2C5937] dark:text-[#E5E5E5] rounded cursor-pointer"
                          >
                            Ок
                          </button>
                        </div>
                      )}

                      <label className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#EFECE6] dark:bg-[#202020] rounded-lg cursor-pointer whitespace-nowrap hover:bg-[#E5E1D8] dark:hover:bg-[#323232] transition-colors">
                        <Upload className="w-3 h-3 text-[#2C5937] dark:text-[#E5E5E5]" />
                        <span>
                          {uploadingProsePdfId === p.id
                            ? 'Завантаження...'
                            : p.hasPdf || p.pdfFileName
                              ? 'Оновити PDF'
                              : 'Додати PDF'}
                        </span>
                        <input
                          type="file"
                          accept=".pdf,application/pdf"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadProsePdfFile(file, p.id);
                            e.target.value = '';
                          }}
                          className="hidden"
                        />
                      </label>

                      {(p.hasPdf || p.pdfFileName) && (
                        <button
                          type="button"
                          onClick={() => handleClearProsePdf(p.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-[#5C5C58] dark:text-[#A6A196] hover:text-rose-700 dark:hover:text-rose-400 cursor-pointer"
                          title={p.pdfFileName || 'Прибрати PDF'}
                        >
                          <FileText className="w-3 h-3" />
                          <span>Прибрати PDF</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setExpandedProseFolderId((prev) => (prev === p.id ? null : p.id));
                          setNewChapterTitle('');
                          setNewChapterContent('');
                          setNewChapterDate(new Date().toISOString().slice(0, 10));
                        }}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg cursor-pointer whitespace-nowrap transition-colors ${
                          expandedProseFolderId === p.id
                            ? 'bg-pear-pine-gradient text-white'
                            : 'bg-[#EFECE6] dark:bg-[#202020] text-[#141413] dark:text-[#EDEAE1]'
                        }`}
                      >
                        <FolderPlus className="w-3 h-3" />
                        <span className="tabular-nums">Розділи ({(p.chapters || []).length})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateProseStatus(p, p.status === 'completed' ? null : 'completed')
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg cursor-pointer whitespace-nowrap transition-colors ${
                          p.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-800 dark:bg-[#323232] dark:text-[#E5E5E5]'
                            : 'bg-[#EFECE6] dark:bg-[#202020] text-[#5C5C58] dark:text-[#A6A196]'
                        }`}
                      >
                        <CheckCircle2 className="w-3 h-3" strokeWidth={2} />
                        <span>Закінчено</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateProseStatus(p, p.status === 'in_progress' ? null : 'in_progress')
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg cursor-pointer whitespace-nowrap transition-colors ${
                          p.status === 'in_progress'
                            ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                            : 'bg-[#EFECE6] dark:bg-[#202020] text-[#5C5C58] dark:text-[#A6A196]'
                        }`}
                      >
                        <Clock className="w-3 h-3" strokeWidth={2} />
                        <span>У процесі</span>
                      </button>
                    </div>

                    {/* Prose Collection Tags */}
                    {proseTags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {proseTags.map((tag) => {
                          const assigned = (p.tagIds || []).includes(tag.id);
                          const preset = getProseTagPreset(tag.color);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => handleToggleProseWorkTag(p, tag.id)}
                              style={assigned ? preset.badgeStyle : undefined}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                                assigned
                                  ? preset.badgeClass
                                  : 'bg-[#EFECE6] dark:bg-[#202020] text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                              }`}
                            >
                              <span
                                style={!assigned ? preset.swatchStyle : undefined}
                                className={`w-1.5 h-1.5 rounded-full ${assigned ? 'bg-current opacity-85' : preset.swatchClass}`}
                              />
                              <span>{tag.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Expandable Chapters Folder */}
                    {expandedProseFolderId === p.id && (
                      <div className="mt-2 p-3.5 rounded-xl bg-white dark:bg-[#202020] space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                            <FolderOpen className="w-3.5 h-3.5 text-[#2C5937] dark:text-[#E5E5E5]" />
                            <span>Тека твору · {(p.chapters || []).length + 1} ч.</span>
                          </div>
                          <span className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                            {p.isPaid && (p.priceUah || 0) > 0
                              ? 'Платна картка: розділи відкриються після покупки'
                              : 'Доступні читачам одразу'}
                          </span>
                        </div>

                        {(p.chapters || []).length > 0 && (
                          <div className="rounded-lg space-y-1">
                            {(p.chapters || []).map((ch, chIdx) => (
                              <div key={ch.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#FAF9F5] dark:bg-[#262626]">
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-[#141413] dark:text-[#EDEAE1] truncate">
                                    {chIdx + 2}. {ch.title}
                                  </p>
                                  <p className="text-[10px] font-mono text-[#5C5C58] dark:text-[#A6A196] tabular-nums">
                                    {ch.publishedAt}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteProseChapter(p.id, ch.id)}
                                  className="p-1 text-[#5C5C58] hover:text-rose-700 dark:hover:text-rose-400 cursor-pointer shrink-0"
                                  aria-label={`Видалити розділ ${ch.title}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <form onSubmit={(e) => handleAddProseChapter(p.id, e)} className="space-y-2 pt-1">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="text"
                              required
                              minLength={2}
                              maxLength={140}
                              value={newChapterTitle}
                              onChange={(e) => setNewChapterTitle(e.target.value)}
                              placeholder="Назва нового розділу"
                              className={`sm:col-span-2 ${STUDIO_INPUT_SM_CLASS}`}
                            />
                            <input
                              type="date"
                              value={newChapterDate}
                              onChange={(e) => setNewChapterDate(e.target.value)}
                              className={`${STUDIO_INPUT_SM_CLASS} font-mono`}
                            />
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="btn-editorial-secondary py-1 px-2.5 text-[11px] cursor-pointer">
                              <Upload className="w-3 h-3 text-[#2C5937] dark:text-[#E5E5E5]" />
                              <span>Завантажити .txt / .md</span>
                              <input
                                type="file"
                                accept=".txt,.md,text/plain,text/markdown"
                                onChange={(e) => handleImportTextFile(e, setNewChapterContent)}
                                className="hidden"
                              />
                            </label>
                            {newChapterContent.trim() && (
                              <span className="text-[11px] font-mono text-[#5C5C58] dark:text-[#A6A196] tabular-nums">
                                Авто: {Math.max(1, countPagesForText(newChapterContent))} стор. ·{' '}
                                {countProseWords(newChapterContent).toLocaleString('uk-UA')} слів
                              </span>
                            )}
                          </div>
                          <textarea
                            rows={4}
                            required
                            minLength={2}
                            value={newChapterContent}
                            onChange={(e) => setNewChapterContent(e.target.value)}
                            placeholder={`Текст нового розділу (автоматично розбивається по ${PROSE_WORDS_PER_PAGE} слів на сторінку)...`}
                            className={`${STUDIO_INPUT_SM_CLASS} leading-relaxed whitespace-pre`}
                          />
                          <button type="submit" disabled={savingChapter} className="btn-editorial-primary py-1.5 px-3 text-xs">
                            <Plus className="w-3.5 h-3.5" />
                            <span>{savingChapter ? 'Збереження...' : 'Додати розділ'}</span>
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                );
              };

              const renderPoemCard = (p: Poem) => {
                const globalIdx = poemIndexMap.get(p.id) ?? 0;
                const isDragging = draggedPoemId === p.id;
                const isDropTarget = dragOverPoemId === p.id && draggedPoemId !== p.id;
                const isFeaturedHome = firstAuthorPoemId === p.id;
                const isEditingPos = editingOrderPoemId === p.id;

                return (
                  <div
                    key={p.id}
                    draggable={canReorderPoems && !isEditingPos}
                    onDragStart={(e) => {
                      if (!canReorderPoems) return;
                      setDraggedPoemId(p.id);
                      setDragOverPoemId(null);
                      e.dataTransfer.effectAllowed = 'move';
                      try {
                        e.dataTransfer.setData('text/plain', p.id);
                      } catch {
                        // Ignore restricted dataTransfer
                      }
                    }}
                    onDragOver={(e) => {
                      if (!canReorderPoems || !draggedPoemId) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (draggedPoemId !== p.id && dragOverPoemId !== p.id) {
                        setDragOverPoemId(p.id);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverPoemId === p.id) {
                        setDragOverPoemId(null);
                      }
                    }}
                    onDrop={(e) => {
                      if (!canReorderPoems) return;
                      e.preventDefault();
                      handleDropPoemOn(p.id);
                    }}
                    onDragEnd={() => {
                      setDraggedPoemId(null);
                      setDragOverPoemId(null);
                    }}
                    className={`px-3 sm:px-4 py-3 rounded-xl flex items-center justify-between gap-2.5 text-xs transition-all ${
                      isDragging
                        ? 'opacity-45 scale-[0.99] bg-[#EAE7DF] dark:bg-[#1E1E1E]'
                        : isDropTarget
                          ? 'bg-[#EEF3E8] dark:bg-[#2E362F] ring-2 ring-[#2C5937]/65 dark:ring-[#E5E5E5]/55'
                          : 'bg-[#FAF9F5] dark:bg-[#262626]'
                    } ${canReorderPoems && !isEditingPos ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    <div className="min-w-0 flex items-center gap-2 sm:gap-2.5 flex-1">
                      {canReorderPoems && (
                        <span
                          aria-hidden="true"
                          title="Перетягніть, щоб змінити порядок"
                          className="text-[#8E8B82] dark:text-[#78756E] hover:text-[#141413] dark:hover:text-[#EDEAE1] shrink-0"
                        >
                          <GripVertical className="w-4 h-4" />
                        </span>
                      )}

                      {isEditingPos ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const num = Number(orderIndexDraft);
                            if (Number.isFinite(num)) {
                              handleMovePoemToPosition(p.id, num);
                            } else {
                              setEditingOrderPoemId(null);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 shrink-0"
                        >
                          <input
                            type="number"
                            min={1}
                            max={poems.length}
                            autoFocus
                            value={orderIndexDraft}
                            onChange={(e) => setOrderIndexDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setEditingOrderPoemId(null);
                            }}
                            aria-label={`Нова позиція для ${p.title}`}
                            className="w-12 px-1.5 py-0.5 rounded bg-white dark:bg-[#1C1C1C] font-mono text-[11px] tabular-nums text-[#141413] dark:text-[#EDEAE1] ring-1 ring-[#2C5937]/50 focus:outline-none"
                          />
                          <button
                            type="submit"
                            aria-label="Застосувати позицію"
                            className="p-1 rounded bg-[#2C5937] text-white cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingOrderPoemId(null)}
                            aria-label="Скасувати"
                            className="p-1 rounded text-[#5C5C58] hover:text-[#141413] dark:hover:text-white cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          disabled={!canReorderPoems}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!canReorderPoems) return;
                            setEditingOrderPoemId(p.id);
                            setOrderIndexDraft(String(globalIdx + 1));
                          }}
                          title={canReorderPoems ? 'Натисніть, щоб перемістити на точний номер' : undefined}
                          className={`font-mono text-[11px] tabular-nums px-1.5 py-0.5 rounded shrink-0 transition-colors ${
                            isFeaturedHome
                              ? 'bg-[#EEF3E8] dark:bg-[#323232] text-[#2C5937] dark:text-[#E5E5E5] font-semibold'
                              : 'bg-[#EFECE6] dark:bg-[#202020] text-[#5C5C58] dark:text-[#A6A196]'
                          } ${canReorderPoems ? 'hover:bg-[#E4E0D6] dark:hover:bg-[#383838] cursor-pointer' : 'cursor-default'}`}
                        >
                          #{globalIdx + 1}
                        </button>
                      )}

                      <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
                        <span className="text-[11px] font-medium text-[#5C5C58] dark:text-[#A6A196] shrink-0">
                          {p.isCommunity ? (p.authorName || 'Читач') : 'Вірш'}
                        </span>
                        <span aria-hidden="true" className="text-[#C4BFB4]">·</span>
                        <span className="text-sm font-medium text-[#141413] dark:text-[#EDEAE1] truncate">
                          {p.title}
                        </span>
                        {isFeaturedHome && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#EEF3E8] dark:bg-[#323232] text-[#2C5937] dark:text-[#E5E5E5] shrink-0">
                            На головній
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdatePoemWorkStatus(
                              p,
                              p.workStatus === 'in_progress'
                                ? 'completed'
                                : p.workStatus === 'completed'
                                  ? null
                                  : 'in_progress'
                            )
                          }
                          title="Натисніть, щоб перемкнути готовність вірша"
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer shrink-0 ${
                            p.workStatus === 'in_progress'
                              ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                              : p.workStatus === 'completed'
                                ? 'bg-emerald-50 text-emerald-800 dark:bg-[#323232] dark:text-[#E5E5E5]'
                                : 'bg-[#EFECE6] text-[#787872] dark:bg-[#202020] dark:text-[#8E8B82]'
                          }`}
                        >
                          {p.workStatus === 'in_progress'
                            ? 'У процесі'
                            : p.workStatus === 'completed'
                              ? 'Закінчено'
                              : 'Статус +'}
                        </button>
                        {Number.isFinite(p.year) && (
                          <span className="text-[11px] font-mono text-[#787872] dark:text-[#C4BFB4] tabular-nums shrink-0">
                            · {p.year}
                          </span>
                        )}
                        {p.cycle && (
                          <>
                            <span aria-hidden="true" className="text-[#C4BFB4] hidden sm:inline">·</span>
                            <span className="text-[11px] text-[#5C5C58] dark:text-[#A6A196] truncate hidden sm:inline">
                              {p.cycle}
                            </span>
                          </>
                        )}
                        {p.imageUrl && (
                          <span className="text-[11px] font-mono text-[#2C5937] dark:text-[#E5E5E5] shrink-0">
                            · Фото
                          </span>
                        )}
                        {(p.soundcloudTracks?.length || p.soundcloudTrack) && (
                          <span className="text-[11px] font-mono text-[#2C5937] dark:text-[#E5E5E5] shrink-0">
                            ·{' '}
                            {p.soundcloudTracks && p.soundcloudTracks.length > 1
                              ? `SoundCloud (${p.soundcloudTracks.length})`
                              : 'SoundCloud'}
                          </span>
                        )}
                        {(p.backgroundColor || p.textColor || p.imagePalette?.background) && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0"
                            style={{
                              backgroundColor: p.backgroundColor || p.imagePalette?.background || undefined,
                              color: p.textColor || (!p.backgroundColor ? p.imagePalette?.text : undefined) || undefined,
                            }}
                            title={`Колір фону: ${p.backgroundColor || p.imagePalette?.background || 'авто'}`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            <span>{!p.backgroundColor && p.imagePalette?.background ? 'Фото-палітра' : 'Тема'}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                      {canReorderPoems && (
                        <>
                          <button
                            type="button"
                            disabled={globalIdx === 0}
                            onClick={() => handleMovePoemByDelta(p.id, -1)}
                            className="p-1.5 text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] rounded-lg hover:bg-[#EFECE6] dark:hover:bg-[#323232] disabled:opacity-30 cursor-pointer disabled:cursor-default shrink-0"
                            title="Підняти вище у списку"
                            aria-label={`Підняти вірш ${p.title} вище`}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={globalIdx >= poems.length - 1}
                            onClick={() => handleMovePoemByDelta(p.id, 1)}
                            className="p-1.5 text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] rounded-lg hover:bg-[#EFECE6] dark:hover:bg-[#323232] disabled:opacity-30 cursor-pointer disabled:cursor-default shrink-0"
                            title="Опустити нижче у списку"
                            aria-label={`Опустити вірш ${p.title} нижче`}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleStartEditPoem(p)}
                        className="p-1.5 text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] rounded-lg hover:bg-[#F5F4EE] dark:hover:bg-[#323232] cursor-pointer shrink-0"
                        title="Редагувати вірш"
                        aria-label={`Редагувати вірш ${p.title}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteWork('poem', p.id)}
                        className="p-1.5 text-[#5C5C58] dark:text-[#A6A196] hover:text-rose-700 dark:hover:text-rose-400 rounded-lg hover:bg-rose-700/10 cursor-pointer shrink-0"
                        aria-label={`Видалити вірш ${p.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              };

              return (
                <div className="space-y-6">
                  {filteredPoems.length > 0 && poems.length > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold uppercase tracking-[0.06em] text-[#141413] dark:text-[#EDEAE1]">
                          Вірші · порядок показу
                        </span>
                        {reorderingPoems && (
                          <span className="text-[#2C5937] dark:text-[#A7F3D0] font-medium">
                            Збереження...
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span>
                          {normalizedQuery
                            ? 'Очистіть пошук, щоб переміщувати вірші'
                            : 'Перетягуйте за ⋮⋮ або змінюйте позицію ↑ ↓ чи #'}
                        </span>
                        {typeFilter === 'all' && (prose.length > 0 || blog.length > 0) && (
                          <button
                            type="button"
                            onClick={() => setTypeFilter('poem')}
                            className="font-semibold text-[#2C5937] dark:text-[#E5E5E5] hover:underline cursor-pointer"
                          >
                            Лише вірші
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Section 1: Author / Admin Works */}
                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2 px-1 pb-1 border-b border-[#E5E0D5]/70 dark:border-[#333333]">
                      <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-[#141413] dark:text-[#EDEAE1]">
                        Твори автора (адміністратора)
                      </h4>
                      <span className="font-mono text-[11px] tabular-nums text-[#5C5C58] dark:text-[#A6A196]">
                        {adminTotal}
                      </span>
                    </div>

                    {adminTotal === 0 ? (
                      <div className="py-6 text-center text-xs text-[#5C5C58] dark:text-[#A6A196] bg-[#FAF9F5] dark:bg-[#262626] rounded-xl">
                        У цьому фільтрі творів адміністратора поки немає.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {adminProse.map(renderProseCard)}
                        {adminPoems.map(renderPoemCard)}
                        {filteredBlog.map((b) => {
                          const blocks = parseBlogContentBlocks(b.content);
                          const photoCount = blocks.filter((bl) => bl.type === 'photo').length;
                          const videoCount = blocks.filter((bl) => bl.type === 'youtube').length;
                          const trackCount = blocks.filter((bl) => bl.type === 'track').length;
                          return (
                            <div
                              key={b.id}
                              className="px-4 py-3 rounded-xl flex items-center justify-between gap-3 bg-[#FAF9F5] dark:bg-[#262626] text-xs"
                            >
                              <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
                                <span className="text-[11px] font-medium text-[#5C5C58] dark:text-[#A6A196] shrink-0">
                                  БДК
                                </span>
                                <span aria-hidden="true" className="text-[#C4BFB4]">·</span>
                                <span className="text-sm font-medium text-[#141413] dark:text-[#EDEAE1] truncate">
                                  {b.title}
                                </span>
                                {b.category && (
                                  <>
                                    <span aria-hidden="true" className="text-[#C4BFB4] hidden sm:inline">·</span>
                                    <span className="text-[11px] text-[#5C5C58] dark:text-[#A6A196] truncate hidden sm:inline">
                                      {b.category}
                                    </span>
                                  </>
                                )}
                                {photoCount > 0 && (
                                  <span className="text-[11px] font-mono text-[#2C5937] dark:text-[#E5E5E5] tabular-nums">
                                    · {photoCount} фото
                                  </span>
                                )}
                                {videoCount > 0 && (
                                  <span className="text-[11px] font-mono text-[#E50914] dark:text-[#FDA4AF] tabular-nums">
                                    · {videoCount} відео
                                  </span>
                                )}
                                {trackCount > 0 && (
                                  <span className="text-[11px] font-mono text-[#2C5937] dark:text-[#E5E5E5] tabular-nums">
                                    · {trackCount} трек.
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleStartEditBlog(b)}
                                  className="p-1.5 text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] rounded-lg hover:bg-[#F5F4EE] dark:hover:bg-[#323232] cursor-pointer shrink-0"
                                  title="Редагувати допис"
                                  aria-label={`Редагувати допис ${b.title}`}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteWork('blog', b.id)}
                                  className="p-1.5 text-[#5C5C58] dark:text-[#A6A196] hover:text-rose-700 dark:hover:text-rose-400 rounded-lg hover:bg-rose-700/10 cursor-pointer shrink-0"
                                  aria-label={`Видалити допис ${b.title}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* Section 2: User / Reader Works */}
                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2 px-1 pb-1 border-b border-[#E5E0D5]/70 dark:border-[#333333]">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-[#2C5937] dark:text-[#E5E5E5]">
                          Твори користувачів
                        </h4>
                        {pendingSubmissionsCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setSubTab('submissions')}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-semibold cursor-pointer hover:bg-red-700 transition-colors"
                          >
                            <span>Нових на модерації: {pendingSubmissionsCount}</span>
                          </button>
                        )}
                      </div>
                      <span className="font-mono text-[11px] tabular-nums text-[#5C5C58] dark:text-[#A6A196]">
                        {userTotal}
                      </span>
                    </div>

                    {userTotal === 0 ? (
                      <div className="py-6 text-center text-xs text-[#5C5C58] dark:text-[#A6A196] bg-[#FAF9F5] dark:bg-[#262626] rounded-xl">
                        Опублікованих творів користувачів у цьому фільтрі поки немає.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {userProse.map(renderProseCard)}
                        {userPoems.map(renderPoemCard)}
                      </div>
                    )}
                  </section>
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* 2. Compose New Work View */}
      {subTab === 'compose' && (
        <form onSubmit={handlePublishWork} className="max-w-3xl space-y-5">
          {editingBlogId && pubKind === 'blog' ? (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[#EEF3E8] dark:bg-[#323232]">
              <div className="text-xs font-medium text-[#1F4229] dark:text-[#F4F1EA]">
                Редагування рецензії в кіноблозі БДК
              </div>
              <button
                type="button"
                onClick={resetComposeForm}
                className="text-xs font-semibold text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] cursor-pointer"
              >
                Скасувати редагування
              </button>
            </div>
          ) : editingPoemId && pubKind === 'poem' ? (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[#EEF3E8] dark:bg-[#323232]">
              <div className="text-xs font-medium text-[#1F4229] dark:text-[#F4F1EA]">
                Редагування вірша
              </div>
              <button
                type="button"
                onClick={resetComposeForm}
                className="text-xs font-semibold text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] cursor-pointer"
              >
                Скасувати редагування
              </button>
            </div>
          ) : (
            /* Kind Switcher */
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'poem', label: 'Вірш' },
                  { id: 'prose', label: 'Проза' },
                  { id: 'blog', label: 'Кіноблог (БДК)' },
                ] as const
              ).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setPubKind(k.id)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    pubKind === k.id
                      ? 'bg-pear-pine-gradient text-white'
                      : 'bg-[#FAF9F5] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className={STUDIO_LABEL_CLASS}>
                {pubKind === 'blog' ? 'Заголовок рецензії *' : 'Заголовок *'}
              </label>
              <input
                type="text"
                required
                value={pubTitle}
                onChange={(e) => setPubTitle(e.target.value)}
                placeholder={pubKind === 'blog' ? 'Наприклад: Тиша перед титрами — про «Дні досконалі»' : 'Назва твору'}
                className={STUDIO_INPUT_CLASS}
              />
            </div>
            <div>
              <label className={STUDIO_LABEL_CLASS}>
                {pubKind === 'poem' ? 'Цикл' : pubKind === 'prose' ? 'Жанр' : 'Жанр / рубрика кіно'}
              </label>
              <input
                type="text"
                value={pubMeta}
                onChange={(e) => setPubMeta(e.target.value)}
                placeholder={pubKind === 'poem' ? 'Карпатські зошити' : pubKind === 'prose' ? 'Новела' : 'Авторське кіно'}
                className={STUDIO_INPUT_CLASS}
              />
            </div>
          </div>

          {pubKind === 'poem' && (
            <div className="p-4 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl space-y-4">
              {/* Year & Display Order Position */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pb-2 border-b border-[#E5E0D5]/70 dark:border-[#333333]">
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Рік написання</label>
                  <input
                    type="number"
                    min={1900}
                    max={2200}
                    value={pubPoemYear}
                    onChange={(e) => setPubPoemYear(e.target.value)}
                    className={`${STUDIO_INPUT_SM_CLASS} font-mono tabular-nums`}
                  />
                </div>

                {!editingPoemId && (
                  <div className="sm:col-span-2 space-y-1.5">
                    <label className={STUDIO_LABEL_CLASS}>Місце у списку показу</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          { id: 'start', label: 'На початок (#1 — найновіший)' },
                          { id: 'end', label: `В кінець (#${poems.length + 1} — давніший)` },
                          { id: 'custom', label: 'Обрати позицію №' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setPubPoemPositionMode(opt.id)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                            pubPoemPositionMode === opt.id
                              ? 'bg-pear-pine-gradient text-white font-semibold'
                              : 'bg-white dark:bg-[#202020] text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}

                      {pubPoemPositionMode === 'custom' && (
                        <input
                          type="number"
                          min={1}
                          max={poems.length + 1}
                          value={pubPoemCustomPosition}
                          onChange={(e) => setPubPoemCustomPosition(e.target.value)}
                          aria-label="Номер позиції вірша у списку"
                          className="w-16 px-2 py-1 rounded-lg bg-white dark:bg-[#202020] font-mono text-xs tabular-nums text-[#141413] dark:text-[#EDEAE1] ring-1 ring-[#D7D2C6] dark:ring-[#3E3E3E] focus:outline-none"
                        />
                      )}
                    </div>
                    <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                      Якщо публікуєте давній вірш, оберіть «В кінець» або вкажіть позицію — тоді він не витіснить найновіший вірш із головної сторінки.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className={STUDIO_LABEL_CLASS}>Готовність вірша</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'completed', label: 'Закінчено' },
                      { id: 'in_progress', label: 'У процесі' },
                      { id: '', label: 'Не вказувати' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id || 'none'}
                      type="button"
                      onClick={() => setPubPoemWorkStatus(opt.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        pubPoemWorkStatus === opt.id
                          ? 'bg-pear-pine-gradient text-white font-semibold'
                          : 'bg-white dark:bg-[#202020] text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                      }`}
                    >
                      {opt.id === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                      {opt.id === 'in_progress' && <Clock className="w-3 h-3" />}
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" />
                <h4 className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                  Верстка та візуальна тема вірша
                </h4>
              </div>
              <p className="text-xs text-[#5C5C58] dark:text-[#A6A196]">
                Налаштуйте кегль, вирівнювання, інтервал між рядками, колір тексту та колір фону для створення унікальної естетики твору.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Кегль (розмір тексту)</label>
                  <select
                    value={pubPoemFontSize}
                    onChange={(e) => setPubPoemFontSize(e.target.value as any)}
                    className={STUDIO_INPUT_SM_CLASS}
                  >
                    <option value="sm">Маленький (sm)</option>
                    <option value="base">Стандартний (base)</option>
                    <option value="lg">Великий (lg)</option>
                    <option value="xl">Дуже великий (xl)</option>
                    <option value="2xl">Величезний (2xl)</option>
                  </select>
                </div>

                <div>
                  <label className={STUDIO_LABEL_CLASS}>Вирівнювання тексту</label>
                  <select
                    value={pubPoemTextAlign}
                    onChange={(e) => setPubPoemTextAlign(e.target.value as any)}
                    className={STUDIO_INPUT_SM_CLASS}
                  >
                    <option value="left">Зліва (класичне)</option>
                    <option value="center">По центру</option>
                    <option value="right">Справа</option>
                  </select>
                </div>

                <div>
                  <label className={STUDIO_LABEL_CLASS}>Міжрядковий інтервал</label>
                  <select
                    value={pubPoemLineSpacing}
                    onChange={(e) => setPubPoemLineSpacing(e.target.value as any)}
                    className={STUDIO_INPUT_SM_CLASS}
                  >
                    <option value="tight">Щільний</option>
                    <option value="normal">Нормальний</option>
                    <option value="relaxed">Збільшений (рекомендовано)</option>
                    <option value="loose">Вільний (просторий)</option>
                  </select>
                </div>
              </div>

              {/* Visual Theme Presets */}
              <div className="space-y-1.5 pt-1">
                <label className={STUDIO_LABEL_CLASS}>Готові палітри для вірша</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {pubPoemImageUrl && pubPoemImagePalette && (
                    <button
                      type="button"
                      onClick={() => {
                        setPubPoemBackgroundColor('');
                        setPubPoemTextColor('');
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                        !pubPoemBackgroundColor && !pubPoemTextColor
                          ? 'bg-[#EAE7DF] dark:bg-[#323232] text-[#141413] dark:text-[#EDEAE1] shadow-xs'
                          : 'bg-white dark:bg-[#202020] text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold"
                        style={{
                          backgroundColor: pubPoemImagePalette.background,
                          color: pubPoemImagePalette.text,
                        }}
                      >
                        А
                      </span>
                      <span>З палітри фото</span>
                    </button>
                  )}
                  {POEM_THEME_PRESETS.map((preset) => {
                    const isActive =
                      pubPoemBackgroundColor === preset.bg &&
                      pubPoemTextColor === preset.text &&
                      !(preset.id === 'default' && pubPoemImageUrl && pubPoemImagePalette);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setPubPoemBackgroundColor(preset.bg);
                          setPubPoemTextColor(preset.text);
                        }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                          isActive
                            ? 'bg-[#EAE7DF] dark:bg-[#323232] text-[#141413] dark:text-[#EDEAE1] shadow-xs'
                            : 'bg-white dark:bg-[#202020] text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold"
                          style={{
                            backgroundColor: preset.bg || '#F5F4EE',
                            color: preset.text || '#141413',
                          }}
                        >
                          А
                        </span>
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Poem Photo & SoundCloud Track */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                {/* Photo Uploader / URL */}
                <div className="p-3.5 rounded-xl bg-white dark:bg-[#202020] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                      <ImagePlus className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" />
                      <span>Фотографія до вірша</span>
                    </div>
                    {pubPoemImageUrl && (
                      <button
                        type="button"
                        onClick={handleClearPoemPhoto}
                        className="text-[11px] font-medium text-rose-700 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        Видалити
                      </button>
                    )}
                  </div>

                  <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196] leading-relaxed">
                    Фон картки вірша автоматично підлаштується під переважаючий тон фотографії.
                  </p>

                  {pubPoemImageUrl ? (
                    <div className="space-y-2.5">
                      <div className="relative overflow-hidden rounded-xl bg-[#EFECE6] dark:bg-[#1B1B1B]">
                        <img
                          src={pubPoemImageUrl}
                          alt="Фото до вірша"
                          width={400}
                          height={144}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-36 object-cover block"
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-2 min-w-0">
                          {poemPaletteExtracting ? (
                            <span className="text-[#5C5C58] dark:text-[#A6A196]">
                              Визначення палітри...
                            </span>
                          ) : pubPoemImagePalette ? (
                            <>
                              <span
                                className="w-5 h-5 rounded-md shrink-0 shadow-xs"
                                style={{
                                  backgroundColor: pubPoemImagePalette.background,
                                  backgroundImage: pubPoemImagePalette.secondaryBackground
                                    ? `linear-gradient(135deg, ${pubPoemImagePalette.background}, ${pubPoemImagePalette.secondaryBackground})`
                                    : undefined,
                                }}
                              />
                              <span className="font-mono text-[#141413] dark:text-[#EDEAE1]">
                                {pubPoemImagePalette.background}
                              </span>
                            </>
                          ) : (
                            <span className="text-[#5C5C58] dark:text-[#A6A196]">
                              Палітра визначиться автоматично
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          disabled={poemPaletteExtracting}
                          onClick={() => void extractAndApplyPoemPalette(pubPoemImageUrl, true)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2C5937] dark:text-[#E5E5E5] hover:underline cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3 h-3 ${poemPaletteExtracting ? 'animate-spin' : ''}`} />
                          <span>Оновити фон із фото</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="btn-editorial-secondary w-full justify-center cursor-pointer text-xs py-1.5">
                        <Upload className="w-3.5 h-3.5" />
                        <span>
                          {poemPhotoUploadBusy ? 'Завантаження...' : 'Завантажити фото з пристрою'}
                        </span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={handleUploadPoemPhoto}
                          disabled={poemPhotoUploadBusy}
                          className="sr-only"
                        />
                      </label>

                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={poemPhotoUrlDraft}
                          onChange={(e) => setPoemPhotoUrlDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleSetPoemPhotoUrl();
                            }
                          }}
                          placeholder="Або URL фото (https://...)"
                          className={`${STUDIO_INPUT_SM_CLASS} font-mono text-xs flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => void handleSetPoemPhotoUrl()}
                          disabled={!poemPhotoUrlDraft.trim()}
                          className="btn-editorial-secondary py-1.5 px-2.5 shrink-0 text-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* SoundCloud Track Importer */}
                <div className="p-3.5 rounded-xl bg-white dark:bg-[#202020] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                      <Music2 className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" />
                      <span>Пісні з SoundCloud</span>
                      {pubPoemSoundCloudTracks.length > 0 && (
                        <span className="font-mono text-[11px] text-[#787872] dark:text-[#8E8B82]">
                          {pubPoemSoundCloudTracks.length}/10
                        </span>
                      )}
                    </div>
                    {pubPoemSoundCloudTracks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setPubPoemSoundCloudTracks([])}
                        className="text-[11px] font-medium text-rose-700 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        {pubPoemSoundCloudTracks.length > 1 ? 'Очистити все' : 'Прибрати'}
                      </button>
                    )}
                  </div>

                  {pubPoemSoundCloudTracks.length > 0 && (
                    <div className="space-y-1.5">
                      {pubPoemSoundCloudTracks.map((trackItem, idx) => (
                        <div
                          key={`${trackItem.id}-${idx}`}
                          className="p-2 rounded-xl bg-[#FAF9F5] dark:bg-[#262626] flex items-center gap-2.5"
                        >
                          <span className="font-mono text-[11px] text-[#787872] dark:text-[#8E8B82] w-4 text-center shrink-0">
                            {idx + 1}
                          </span>
                          {trackItem.artworkUrl ? (
                            <img
                              src={trackItem.artworkUrl}
                              alt={trackItem.title}
                              width={36}
                              height={36}
                              loading="lazy"
                              decoding="async"
                              className="w-9 h-9 rounded-lg object-cover shrink-0 bg-[#EFECE6] dark:bg-[#323232]"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center bg-[#EFECE6] dark:bg-[#323232] text-[#2C5937] dark:text-[#E5E5E5]">
                              <Music2 className="w-4 h-4" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1] truncate">
                              {trackItem.title}
                            </p>
                            <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196] truncate">
                              {trackItem.artist}
                            </p>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {pubPoemSoundCloudTracks.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => movePoemSoundCloudTrack(idx, -1)}
                                  aria-label="Перемістити вгору"
                                  className="p-1 rounded-md text-[#5C5C58] dark:text-[#A6A196] hover:bg-[#EFECE6] dark:hover:bg-[#323232] disabled:opacity-30 cursor-pointer"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === pubPoemSoundCloudTracks.length - 1}
                                  onClick={() => movePoemSoundCloudTrack(idx, 1)}
                                  aria-label="Перемістити вниз"
                                  className="p-1 rounded-md text-[#5C5C58] dark:text-[#A6A196] hover:bg-[#EFECE6] dark:hover:bg-[#323232] disabled:opacity-30 cursor-pointer"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => removePoemSoundCloudTrack(trackItem.id)}
                              aria-label={`Видалити «${trackItem.title}»`}
                              className="p-1 rounded-md text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {pubPoemSoundCloudTracks.length < 10 && (
                    <div className="space-y-2">
                      <textarea
                        rows={2}
                        value={poemScUrlDraft}
                        onChange={(e) => setPoemScUrlDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleImportPoemSoundCloud();
                          }
                        }}
                        placeholder="https://soundcloud.com/artist/song (можна кілька з нового рядка)"
                        className={`${STUDIO_INPUT_SM_CLASS} font-mono text-xs resize-none`}
                      />
                      <button
                        type="button"
                        onClick={() => void handleImportPoemSoundCloud()}
                        disabled={poemScImporting || !poemScUrlDraft.trim()}
                        className="btn-editorial-secondary w-full justify-center py-1.5 text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>
                          {poemScImporting
                            ? 'Додаємо...'
                            : pubPoemSoundCloudTracks.length > 0
                              ? 'Додати ще пісню'
                              : 'Додати з SoundCloud'}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Custom Color Pickers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={STUDIO_LABEL_CLASS}>Колір тексту</label>
                    {pubPoemTextColor && (
                      <button
                        type="button"
                        onClick={() => setPubPoemTextColor('')}
                        className="text-[10px] text-[#5C5C58] hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                      >
                        Скинути
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative w-9 h-9 rounded-lg overflow-hidden shrink-0 cursor-pointer shadow-xs">
                      <input
                        type="color"
                        value={pubPoemTextColor || pubPoemImagePalette?.text || '#141413'}
                        onChange={(e) => setPubPoemTextColor(e.target.value)}
                        className="absolute -top-2 -left-2 w-14 h-14 cursor-pointer opacity-0"
                        aria-label="Обрати колір тексту"
                      />
                      <div
                        className="w-full h-full"
                        style={{ backgroundColor: pubPoemTextColor || pubPoemImagePalette?.text || '#141413' }}
                      />
                    </div>
                    <input
                      type="text"
                      maxLength={24}
                      value={pubPoemTextColor}
                      onChange={(e) => setPubPoemTextColor(e.target.value)}
                      placeholder={pubPoemImagePalette ? `Авто з фото (${pubPoemImagePalette.text})` : 'За замовчуванням (#141413)'}
                      className={`${STUDIO_INPUT_SM_CLASS} font-mono text-xs flex-1`}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={STUDIO_LABEL_CLASS}>Колір фону картки</label>
                    {pubPoemBackgroundColor && (
                      <button
                        type="button"
                        onClick={() => setPubPoemBackgroundColor('')}
                        className="text-[10px] text-[#5C5C58] hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                      >
                        Скинути
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative w-9 h-9 rounded-lg overflow-hidden shrink-0 cursor-pointer shadow-xs">
                      <input
                        type="color"
                        value={pubPoemBackgroundColor || pubPoemImagePalette?.background || '#FFFFFF'}
                        onChange={(e) => setPubPoemBackgroundColor(e.target.value)}
                        className="absolute -top-2 -left-2 w-14 h-14 cursor-pointer opacity-0"
                        aria-label="Обрати колір фону картки"
                      />
                      <div
                        className="w-full h-full"
                        style={{ backgroundColor: pubPoemBackgroundColor || pubPoemImagePalette?.background || '#FFFFFF' }}
                      />
                    </div>
                    <input
                      type="text"
                      maxLength={24}
                      value={pubPoemBackgroundColor}
                      onChange={(e) => setPubPoemBackgroundColor(e.target.value)}
                      placeholder={pubPoemImagePalette ? `Авто з фото (${pubPoemImagePalette.background})` : 'За замовчуванням (#FFFFFF / #262626)'}
                      className={`${STUDIO_INPUT_SM_CLASS} font-mono text-xs flex-1`}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className={STUDIO_LABEL_CLASS}>Примітка під віршем (необов’язково)</label>
                <input
                  type="text"
                  maxLength={280}
                  value={pubPoemNote}
                  onChange={(e) => setPubPoemNote(e.target.value)}
                  placeholder="Наприклад: Карпати, листопад 2025..."
                  className={STUDIO_INPUT_SM_CLASS}
                />
              </div>

              {/* Live Preview Box */}
              {(() => {
                const previewBg =
                  pubPoemBackgroundColor ||
                  (pubPoemImageUrl && pubPoemImagePalette?.background) ||
                  undefined;
                const previewGradient =
                  !pubPoemBackgroundColor && pubPoemImageUrl && pubPoemImagePalette?.secondaryBackground
                    ? `linear-gradient(150deg, ${pubPoemImagePalette.background} 0%, ${pubPoemImagePalette.secondaryBackground} 100%)`
                    : undefined;
                const previewText =
                  pubPoemTextColor ||
                  (!pubPoemBackgroundColor && pubPoemImageUrl && pubPoemImagePalette?.text) ||
                  undefined;
                return (
                  <div className="space-y-1.5 pt-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-[#5C5C58] dark:text-[#A6A196]">
                      <span>Попередній перегляд теми вірша</span>
                      <span className="font-mono text-[11px] opacity-75">
                        {pubPoemBackgroundColor
                          ? pubPoemBackgroundColor
                          : pubPoemImageUrl && pubPoemImagePalette
                            ? `Палітра з фото (${pubPoemImagePalette.background})`
                            : 'Тема сайту'}{' '}
                        · {previewText || 'Автоколір'}
                      </span>
                    </div>
                    <div
                      style={{
                        backgroundColor: previewBg,
                        backgroundImage: previewGradient,
                        color: previewText,
                      }}
                      className={`p-4 rounded-xl transition-all duration-200 overflow-hidden space-y-3 ${
                        previewBg ? 'shadow-xs' : 'bg-white dark:bg-[#202020]'
                      }`}
                    >
                      {pubPoemImageUrl && (
                        <img
                          src={pubPoemImageUrl}
                          alt="Попередній перегляд фото"
                          width={400}
                          height={144}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-36 object-cover rounded-lg block"
                        />
                      )}
                      <h4
                        style={previewText ? { color: previewText } : undefined}
                        className={`text-base font-semibold tracking-[-0.01em] mb-2 ${
                          previewText ? '' : 'text-[#141413] dark:text-[#F4F1EA]'
                        }`}
                      >
                        {pubTitle.trim() || 'Назва вірша'}
                      </h4>
                      <div
                        style={previewText ? { color: previewText } : undefined}
                        className={`whitespace-pre-wrap ${
                          previewText ? '' : 'text-[#141413] dark:text-[#E5E2DA]'
                        } ${
                          pubPoemFontSize === 'sm'
                            ? 'text-xs'
                            : pubPoemFontSize === 'base'
                              ? 'text-sm'
                              : pubPoemFontSize === 'xl'
                                ? 'text-base'
                                : pubPoemFontSize === '2xl'
                                  ? 'text-lg'
                                  : 'text-sm'
                        } ${
                          pubPoemTextAlign === 'center'
                            ? 'text-center'
                            : pubPoemTextAlign === 'right'
                              ? 'text-right'
                              : 'text-left'
                        } ${
                          pubPoemLineSpacing === 'tight'
                            ? 'leading-snug'
                            : pubPoemLineSpacing === 'normal'
                              ? 'leading-normal'
                              : pubPoemLineSpacing === 'loose'
                                ? 'leading-[2.1]'
                                : 'leading-[1.75]'
                        }`}
                      >
                        {preserveFormattedText(pubContent).trim()
                          ? preserveFormattedText(pubContent).slice(0, 240) +
                            (preserveFormattedText(pubContent).length > 240 ? '…' : '')
                          : 'Тут відображатиметься фрагмент вірша у вибраній кольоровій темі та верстці...'}
                      </div>
                      {pubPoemNote.trim() && (
                        <p
                          style={previewText ? { color: previewText, opacity: 0.8 } : undefined}
                          className={`italic text-xs mt-3 ${
                            previewText ? '' : 'text-[#5C5C58] dark:text-[#A8A49B]'
                          } ${
                            pubPoemTextAlign === 'center'
                              ? 'text-center'
                              : pubPoemTextAlign === 'right'
                                ? 'text-right'
                                : 'text-left'
                          }`}
                        >
                          {pubPoemNote.trim()}
                        </p>
                      )}
                      {pubPoemSoundCloudTracks.length > 0 && (
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/15 text-xs font-medium max-w-full">
                          <Music2 className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">
                            {pubPoemSoundCloudTracks[0].title} — {pubPoemSoundCloudTracks[0].artist}
                            {pubPoemSoundCloudTracks.length > 1
                              ? ` (+${pubPoemSoundCloudTracks.length - 1})`
                              : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {pubKind === 'prose' && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={STUDIO_LABEL_CLASS}>
                    Кількість сторінок{' '}
                    {pubProsePdfMeta && countProseWords(pubContent) < PROSE_WORDS_PER_PAGE
                      ? '(PDF)'
                      : `(авто · по ${PROSE_WORDS_PER_PAGE} слів)`}
                  </label>
                  {pubProsePdfMeta && countProseWords(pubContent) < PROSE_WORDS_PER_PAGE ? (
                    <input
                      type="number"
                      min={1}
                      required
                      value={pubProsePages}
                      onChange={(e) => setPubProsePages(e.target.value)}
                      className={`${STUDIO_INPUT_CLASS} font-mono tabular-nums`}
                    />
                  ) : (
                    <div className="w-full px-3 py-2 text-sm bg-[#EFECE6] dark:bg-[#1B1B1B] rounded-lg flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-[#141413] dark:text-[#EDEAE1] tabular-nums">
                        {pubContent.trim() ? Math.max(1, countPagesForText(pubContent)) : 0} стор.
                      </span>
                      <span className="text-[11px] font-mono text-[#5C5C58] dark:text-[#A6A196] tabular-nums">
                        {countProseWords(pubContent).toLocaleString('uk-UA')} слів
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label className={STUDIO_LABEL_CLASS}>Дата публікації</label>
                  <input
                    type="date"
                    required
                    value={pubProseDate}
                    onChange={(e) => setPubProseDate(e.target.value)}
                    className={`${STUDIO_INPUT_CLASS} font-mono`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Короткий слоган</label>
                  <input
                    type="text"
                    maxLength={180}
                    value={pubProseSlogan}
                    onChange={(e) => setPubProseSlogan(e.target.value)}
                    placeholder="Один рядок про настрій твору..."
                    className={STUDIO_INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Готовність твору</label>
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setPubProseStatus((prev) => (prev === 'completed' ? '' : 'completed'))}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        pubProseStatus === 'completed'
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-[#323232] dark:text-[#E5E5E5]'
                          : 'bg-[#FAF9F5] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A6A196]'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Закінчено</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPubProseStatus((prev) => (prev === 'in_progress' ? '' : 'in_progress'))}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        pubProseStatus === 'in_progress'
                          ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                          : 'bg-[#FAF9F5] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A6A196]'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>У процесі</span>
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className={STUDIO_LABEL_CLASS}>Короткий опис / анотація</label>
                <textarea
                  rows={2}
                  value={pubExcerpt}
                  onChange={(e) => setPubExcerpt(e.target.value)}
                  placeholder="Про що ця історія (1–2 речення)..."
                  className={STUDIO_INPUT_CLASS}
                />
              </div>

              {proseTags.length > 0 && (
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Належність до збірки або книги</label>
                  <div className="flex flex-wrap gap-1.5">
                    {proseTags.map((tag) => {
                      const preset = getProseTagPreset(tag.color);
                      const selected = pubProseTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() =>
                            setPubProseTagIds((prev) =>
                              prev.includes(tag.id)
                                ? prev.filter((id) => id !== tag.id)
                                : [...prev, tag.id]
                            )
                          }
                          style={selected ? preset.badgeStyle : undefined}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                            selected
                              ? `${preset.badgeClass} shadow-md scale-[1.03]`
                              : 'bg-[#FAF9F5] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A6A196]'
                          }`}
                        >
                          <span
                            style={!selected ? preset.swatchStyle : undefined}
                            className={`w-2 h-2 rounded-full ${selected ? 'bg-current opacity-85' : preset.swatchClass}`}
                          />
                          <span>{tag.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {pubKind === 'blog' && (
            <div className="space-y-4">
              {/* Quick Cinema Genre Chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  'Авторське кіно',
                  'Драма',
                  'Трилер / Нуар',
                  'Сай-фай',
                  'Документальне',
                  'Комедія / Сатира',
                  'Класика',
                  'Анімація',
                ].map((genre) => (
                  <button
                    key={genre}
                    type="button"
                    onClick={() => setPubMeta(genre)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-colors ${
                      pubMeta.trim().toLowerCase() === genre.toLowerCase()
                        ? 'bg-[#141413] text-white dark:bg-[#F4F1EA] dark:text-[#181818] font-semibold'
                        : 'bg-[#EFECE6] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                    }`}
                  >
                    {genre}
                  </button>
                ))}
              </div>

              {/* Poster / Cover Image + Film Passport Panel */}
              <div className="p-4 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                  <Clapperboard className="w-4 h-4 text-[#E50914]" />
                  <span>Паспорт фільму та постер (необов’язково)</span>
                </div>

                {/* Cover Poster */}
                <div className="p-3.5 rounded-xl bg-white dark:bg-[#202020] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                      <Film className="w-3.5 h-3.5 text-[#E50914]" />
                      <span>Постер або головний кадр-обкладинка</span>
                    </span>
                    {pubBlogCoverImage && (
                      <button
                        type="button"
                        onClick={() => setPubBlogCoverImage('')}
                        className="text-[11px] font-medium text-rose-700 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        Прибрати
                      </button>
                    )}
                  </div>

                  {pubBlogCoverImage ? (
                    <div className="overflow-hidden rounded-xl bg-[#141215]">
                      <img
                        src={pubBlogCoverImage}
                        alt="Постер рецензії"
                        width={400}
                        height={176}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-44 object-cover block"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="btn-editorial-secondary justify-center cursor-pointer text-xs py-2">
                        <Upload className="w-3.5 h-3.5" />
                        <span>
                          {blogCoverUploadBusy ? 'Завантаження...' : 'Завантажити постер / кадр'}
                        </span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={handleUploadBlogCover}
                          disabled={blogCoverUploadBusy}
                          className="sr-only"
                        />
                      </label>

                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={blogCoverUrlDraft}
                          onChange={(e) => setBlogCoverUrlDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSetBlogCoverUrl();
                            }
                          }}
                          placeholder="Або URL постера (https://...)"
                          className={`${STUDIO_INPUT_SM_CLASS} font-mono text-xs flex-1`}
                        />
                        <button
                          type="button"
                          onClick={handleSetBlogCoverUrl}
                          disabled={!blogCoverUrlDraft.trim()}
                          className="btn-editorial-secondary py-1.5 px-2.5 shrink-0 text-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Film Passport Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Назва стрічки</label>
                    <input
                      type="text"
                      maxLength={180}
                      value={pubBlogFilmTitle}
                      onChange={(e) => setPubBlogFilmTitle(e.target.value)}
                      placeholder="Наприклад: Perfect Days"
                      className={STUDIO_INPUT_SM_CLASS}
                    />
                  </div>
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Режисер</label>
                    <input
                      type="text"
                      maxLength={140}
                      value={pubBlogDirector}
                      onChange={(e) => setPubBlogDirector(e.target.value)}
                      placeholder="Вім Вендерс"
                      className={STUDIO_INPUT_SM_CLASS}
                    />
                  </div>
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Країна</label>
                    <input
                      type="text"
                      maxLength={100}
                      value={pubBlogCountry}
                      onChange={(e) => setPubBlogCountry(e.target.value)}
                      placeholder="Японія, Німеччина"
                      className={STUDIO_INPUT_SM_CLASS}
                    />
                  </div>
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Рік виходу</label>
                    <input
                      type="number"
                      min={1888}
                      max={2100}
                      value={pubBlogReleaseYear}
                      onChange={(e) => setPubBlogReleaseYear(e.target.value)}
                      placeholder="2023"
                      className={`${STUDIO_INPUT_SM_CLASS} font-mono tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Хронометраж (хв)</label>
                    <input
                      type="number"
                      min={1}
                      max={1500}
                      value={pubBlogRuntimeMinutes}
                      onChange={(e) => setPubBlogRuntimeMinutes(e.target.value)}
                      placeholder="124"
                      className={`${STUDIO_INPUT_SM_CLASS} font-mono tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Оцінка БДК (0.5 – 10)</label>
                    <div className="relative">
                      <Star className="w-3.5 h-3.5 text-[#EAB308] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="number"
                        min={0.5}
                        max={10}
                        step={0.5}
                        value={pubBlogRating}
                        onChange={(e) => setPubBlogRating(e.target.value)}
                        placeholder="9.0"
                        className={`${STUDIO_INPUT_SM_CLASS} pl-8 font-mono tabular-nums`}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Формат перегляду</label>
                    <input
                      type="text"
                      maxLength={80}
                      value={pubBlogWatchFormat}
                      onChange={(e) => setPubBlogWatchFormat(e.target.value)}
                      placeholder="Кінотеатр / 35mm / Нічний сеанс вдома"
                      className={STUDIO_INPUT_SM_CLASS}
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <button
                      type="button"
                      onClick={() => setPubBlogHasSpoilers((prev) => !prev)}
                      aria-pressed={pubBlogHasSpoilers}
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors w-full sm:w-auto ${
                        pubBlogHasSpoilers
                          ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 ring-1 ring-amber-500/35'
                          : 'bg-white dark:bg-[#202020] text-[#5C5C58] dark:text-[#A6A196]'
                      }`}
                    >
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {pubBlogHasSpoilers
                          ? 'Рецензія зі спойлерами (захищено)'
                          : 'Позначити: містить спойлери'}
                      </span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className={STUDIO_LABEL_CLASS}>Короткий вердикт одним рядком</label>
                  <input
                    type="text"
                    maxLength={260}
                    value={pubBlogVerdict}
                    onChange={(e) => setPubBlogVerdict(e.target.value)}
                    placeholder="Кіно, яке вчить чути тишу між звичними ранками..."
                    className={STUDIO_INPUT_SM_CLASS}
                  />
                </div>
              </div>

              <div>
                <label className={STUDIO_LABEL_CLASS}>
                  Короткий опис для картки (необов’язково)
                </label>
                <input
                  type="text"
                  maxLength={280}
                  value={pubExcerpt}
                  onChange={(e) => setPubExcerpt(e.target.value)}
                  placeholder="Якщо залишити порожнім — сформується автоматично з першого абзацу..."
                  className={STUDIO_INPUT_CLASS}
                />
              </div>
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <label className="text-xs font-medium text-[#5C5C58] dark:text-[#A6A196]">
                {pubKind === 'prose' && pubProsePdfMeta
                  ? 'Вступний фрагмент (необов’язково з PDF)'
                  : pubKind === 'blog'
                    ? `Текст рецензії (абзаци через порожній рядок; «>» на початку — цитата з фільму${blogParagraphs.length > 0 ? ` · ${blogParagraphs.length} абз.` : ''})`
                    : 'Текст *'}
              </label>
              {(pubKind === 'prose' || pubKind === 'blog') && (
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium bg-[#EFECE6] dark:bg-[#262626] rounded-lg cursor-pointer hover:bg-[#EAE7DF] dark:hover:bg-[#323232] transition-colors">
                  <Upload className="w-3 h-3 text-[#2C5937] dark:text-[#E5E5E5]" />
                  <span>Завантажити .txt / .md</span>
                  <input
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    onChange={(e) => handleImportTextFile(e, setPubContent)}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            <textarea
              rows={pubKind === 'prose' && pubProsePdfMeta ? 4 : 8}
              required={
                !(pubKind === 'prose' && pubProsePdfMeta) &&
                !(pubKind === 'blog' && pubBlogMedia.length > 0)
              }
              value={pubContent}
              onChange={(e) => setPubContent(e.target.value)}
              placeholder={
                pubKind === 'prose' && pubProsePdfMeta
                  ? 'Перші кілька абзаців перед PDF...'
                  : pubKind === 'prose'
                    ? `Вставте текст або завантажте .txt файл — сторінки розіб’ються автоматично по ${PROSE_WORDS_PER_PAGE} слів...`
                    : pubKind === 'blog'
                      ? 'Напишіть кінорецензію або роздуми. Порожній рядок розділяє абзаци, щоб кадри й саундтреки можна було вставляти між ними...'
                      : 'Текст твору...'
              }
              className={`${STUDIO_INPUT_CLASS} leading-relaxed ${
                pubKind === 'poem' || pubKind === 'prose' ? 'whitespace-pre' : ''
              }`}
            />
            {(pubKind === 'poem' || pubKind === 'prose') && (
              <p className="mt-1 text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                Пробіли, слова в стовпчик і переноси рядків зберігаються точно як у полі введення.
              </p>
            )}
          </div>

          {pubKind === 'blog' && (
            <div className="p-4 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl space-y-5">
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                  Фото, відео з YouTube та пісні з SoundCloud у дописі
                </h4>
                <p className="text-xs text-[#5C5C58] dark:text-[#A6A196]">
                  Додавайте фото, відео з YouTube або треки SoundCloud і вибирайте, де їх показати: на початку тексту, між абзацами чи під текстом.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Photo Importer */}
                <div className="p-3.5 rounded-xl bg-white dark:bg-[#202020] space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                    <ImagePlus className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" />
                    <span>Додати фото</span>
                  </div>

                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Де вставити</label>
                    <select
                      value={encodePlacement(blogPhotoPlacementDraft)}
                      onChange={(e) => setBlogPhotoPlacementDraft(decodePlacement(e.target.value))}
                      className={STUDIO_INPUT_SM_CLASS}
                    >
                      {blogPlacementOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Підпис під фото (необов’язково)</label>
                    <input
                      type="text"
                      maxLength={240}
                      value={blogPhotoCaptionDraft}
                      onChange={(e) => setBlogPhotoCaptionDraft(e.target.value)}
                      placeholder="Наприклад: Львів, ранкова кав’ярня..."
                      className={STUDIO_INPUT_SM_CLASS}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="btn-editorial-secondary justify-center cursor-pointer text-xs py-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {blogPhotoUploadBusy ? 'Завантаження...' : 'Завантажити фото з пристрою'}
                      </span>
                      <input
                        type="file"
                        multiple
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={handleUploadBlogPhotos}
                        disabled={blogPhotoUploadBusy}
                        className="sr-only"
                      />
                    </label>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={blogPhotoUrlDraft}
                        onChange={(e) => setBlogPhotoUrlDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddBlogPhotoUrl();
                          }
                        }}
                        placeholder="Або URL фото (https://...)"
                        className={`${STUDIO_INPUT_SM_CLASS} font-mono text-xs flex-1`}
                      />
                      <button
                        type="button"
                        onClick={handleAddBlogPhotoUrl}
                        disabled={!blogPhotoUrlDraft.trim()}
                        className="btn-editorial-secondary py-1.5 px-2.5 shrink-0 text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* YouTube Video Importer */}
                <div className="p-3.5 rounded-xl bg-white dark:bg-[#202020] space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                    <Video className="w-4 h-4 text-[#E50914] dark:text-[#FDA4AF]" />
                    <span>Імпортувати відео з YouTube</span>
                  </div>

                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Де вставити</label>
                    <select
                      value={encodePlacement(blogYtPlacementDraft)}
                      onChange={(e) => setBlogYtPlacementDraft(decodePlacement(e.target.value))}
                      className={STUDIO_INPUT_SM_CLASS}
                    >
                      {blogPlacementOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Підпис під відео (необов’язково)</label>
                    <input
                      type="text"
                      maxLength={240}
                      value={blogYtCaptionDraft}
                      onChange={(e) => setBlogYtCaptionDraft(e.target.value)}
                      placeholder="Наприклад: Офіційний трейлер або сцена..."
                      className={STUDIO_INPUT_SM_CLASS}
                    />
                  </div>

                  <div>
                    <label className={STUDIO_LABEL_CLASS}>
                      Посилання на YouTube (по одному на рядок)
                    </label>
                    <textarea
                      rows={2}
                      value={blogYtUrlDraft}
                      onChange={(e) => setBlogYtUrlDraft(e.target.value)}
                      placeholder={'https://www.youtube.com/watch?v=...'}
                      className={`${STUDIO_INPUT_SM_CLASS} font-mono text-xs`}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleImportBlogYouTube}
                    disabled={blogYtImporting || !blogYtUrlDraft.trim()}
                    className="btn-editorial-secondary w-full justify-center py-1.5 text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>
                      {blogYtImporting ? 'Імпортуємо...' : 'Імпортувати з YouTube'}
                    </span>
                  </button>
                </div>

                {/* SoundCloud Track Importer */}
                <div className="p-3.5 rounded-xl bg-white dark:bg-[#202020] space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                    <Music2 className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" />
                    <span>Імпортувати пісню з SoundCloud</span>
                  </div>

                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Де вставити</label>
                    <select
                      value={encodePlacement(blogScPlacementDraft)}
                      onChange={(e) => setBlogScPlacementDraft(decodePlacement(e.target.value))}
                      className={STUDIO_INPUT_SM_CLASS}
                    >
                      {blogPlacementOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={STUDIO_LABEL_CLASS}>
                      Посилання SoundCloud (по одному на рядок)
                    </label>
                    <textarea
                      rows={3}
                      value={blogScUrlDraft}
                      onChange={(e) => setBlogScUrlDraft(e.target.value)}
                      placeholder={'https://soundcloud.com/artist/song'}
                      className={`${STUDIO_INPUT_SM_CLASS} font-mono text-xs`}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleImportBlogSoundCloud}
                    disabled={blogScImporting || !blogScUrlDraft.trim()}
                    className="btn-editorial-secondary w-full justify-center py-1.5 text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>
                      {blogScImporting ? 'Імпортуємо...' : 'Імпортувати з SoundCloud'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Added Media List */}
              {pubBlogMedia.length > 0 && (
                <div className="space-y-2.5 pt-2">
                  <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                    Додані медіа ({pubBlogMedia.length})
                  </p>
                  <div className="space-y-2">
                    {pubBlogMedia.map((item, idx) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-xl bg-white dark:bg-[#202020] flex flex-col sm:flex-row sm:items-center gap-3 text-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {item.kind === 'photo' ? (
                            <img
                              src={item.url}
                              alt={item.caption || 'Фото допису'}
                              width={48}
                              height={48}
                              loading="lazy"
                              decoding="async"
                              className="w-12 h-12 rounded-lg object-cover shrink-0 bg-[#EFECE6] dark:bg-[#323232]"
                            />
                          ) : item.kind === 'youtube' ? (
                            item.thumbnailUrl ? (
                              <img
                                src={item.thumbnailUrl}
                                alt={item.title}
                                width={64}
                                height={48}
                                loading="lazy"
                                decoding="async"
                                className="w-16 h-12 rounded-lg object-cover shrink-0 bg-[#EFECE6] dark:bg-[#323232]"
                              />
                            ) : (
                              <div className="w-16 h-12 rounded-lg shrink-0 flex items-center justify-center bg-[#E50914]/15 text-[#E50914] dark:text-[#FDA4AF]">
                                <Video className="w-5 h-5" />
                              </div>
                            )
                          ) : item.artworkUrl ? (
                            <img
                              src={item.artworkUrl}
                              alt={item.title}
                              width={48}
                              height={48}
                              loading="lazy"
                              decoding="async"
                              className="w-12 h-12 rounded-lg object-cover shrink-0 bg-[#EFECE6] dark:bg-[#323232]"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center bg-[#EFECE6] dark:bg-[#323232] text-[#2C5937] dark:text-[#E5E5E5]">
                              <Music2 className="w-5 h-5" />
                            </div>
                          )}

                          <div className="min-w-0 flex-1 space-y-1">
                            {item.kind === 'photo' ? (
                              <>
                                <p className="font-medium text-[#141413] dark:text-[#EDEAE1] truncate">
                                  Фото #{idx + 1}
                                </p>
                                <input
                                  type="text"
                                  maxLength={240}
                                  value={item.caption || ''}
                                  onChange={(e) => {
                                    const nextCaption = e.target.value;
                                    setPubBlogMedia((prev) =>
                                      prev.map((row) =>
                                        row.id === item.id && row.kind === 'photo'
                                          ? { ...row, caption: nextCaption }
                                          : row
                                      )
                                    );
                                  }}
                                  placeholder="Підпис під фото (необов’язково)..."
                                  className="w-full px-2 py-1 text-[11px] bg-[#EFECE6] dark:bg-[#1B1B1B] rounded-md text-[#141413] dark:text-[#EDEAE1] focus:outline-none focus:bg-[#FAF9F5] dark:focus:bg-[#323232]"
                                />
                              </>
                            ) : item.kind === 'youtube' ? (
                              <>
                                <p className="font-medium text-[#141413] dark:text-[#EDEAE1] truncate">
                                  {item.title}
                                </p>
                                <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196] truncate">
                                  {item.authorName ? `${item.authorName} · ` : ''}YouTube
                                </p>
                                <input
                                  type="text"
                                  maxLength={240}
                                  value={item.caption || ''}
                                  onChange={(e) => {
                                    const nextCaption = e.target.value;
                                    setPubBlogMedia((prev) =>
                                      prev.map((row) =>
                                        row.id === item.id && row.kind === 'youtube'
                                          ? { ...row, caption: nextCaption }
                                          : row
                                      )
                                    );
                                  }}
                                  placeholder="Підпис під відео (необов’язково)..."
                                  className="w-full px-2 py-1 text-[11px] bg-[#EFECE6] dark:bg-[#1B1B1B] rounded-md text-[#141413] dark:text-[#EDEAE1] focus:outline-none focus:bg-[#FAF9F5] dark:focus:bg-[#323232]"
                                />
                              </>
                            ) : (
                              <>
                                <p className="font-medium text-[#141413] dark:text-[#EDEAE1] truncate">
                                  {item.title}
                                </p>
                                <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196] truncate">
                                  {item.artist} · SoundCloud
                                </p>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <select
                            value={encodePlacement(item.placement)}
                            onChange={(e) => {
                              const nextPlace = decodePlacement(e.target.value);
                              setPubBlogMedia((prev) =>
                                prev.map((row) =>
                                  row.id === item.id ? { ...row, placement: nextPlace } : row
                                )
                              );
                            }}
                            aria-label="Розташування елемента"
                            className="px-2 py-1.5 text-[11px] bg-[#EFECE6] dark:bg-[#1B1B1B] rounded-lg text-[#141413] dark:text-[#EDEAE1] focus:outline-none focus:bg-[#FAF9F5] dark:focus:bg-[#323232] max-w-[190px]"
                          >
                            {blogPlacementOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() =>
                              setPubBlogMedia((prev) => {
                                const next = [...prev];
                                const [moved] = next.splice(idx, 1);
                                next.splice(idx - 1, 0, moved);
                                return next;
                              })
                            }
                            aria-label="Підняти вище"
                            className="p-1.5 rounded-lg text-[#5C5C58] dark:text-[#A6A196] hover:bg-[#EFECE6] dark:hover:bg-[#323232] disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === pubBlogMedia.length - 1}
                            onClick={() =>
                              setPubBlogMedia((prev) => {
                                const next = [...prev];
                                const [moved] = next.splice(idx, 1);
                                next.splice(idx + 1, 0, moved);
                                return next;
                              })
                            }
                            aria-label="Опустити нижче"
                            className="p-1.5 rounded-lg text-[#5C5C58] dark:text-[#A6A196] hover:bg-[#EFECE6] dark:hover:bg-[#323232] disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPubBlogMedia((prev) => prev.filter((row) => row.id !== item.id))
                            }
                            aria-label="Видалити з допису"
                            className="p-1.5 rounded-lg text-rose-700 dark:text-rose-400 hover:bg-rose-700/10 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {pubKind === 'prose' && (
            <div className="p-4 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl space-y-3.5">
              <div className="space-y-2">
                <span className="block text-xs font-medium text-[#5C5C58] dark:text-[#A6A196]">
                  Режим доступу до твору
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup">
                  {(
                    [
                      { id: 'public', label: 'Відкритий' },
                      { id: 'authorized', label: 'Авторизованим' },
                      { id: 'paid', label: 'Платний' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      role="radio"
                      aria-checked={pubProseAccessMode === mode.id}
                      onClick={() => setPubProseAccessMode(mode.id)}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        pubProseAccessMode === mode.id
                          ? 'bg-pear-pine-gradient text-white'
                          : 'bg-white dark:bg-[#202020] text-[#5C5C58] dark:text-[#A6A196]'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {(pubProseAccessMode === 'paid' || pubProseAccessMode === 'authorized' || Boolean(pubProsePdfMeta)) && (
                <div className="flex flex-wrap items-end gap-4 pt-1">
                  {pubProseAccessMode === 'paid' && (
                    <div className="w-36">
                      <label className={STUDIO_LABEL_CLASS}>Ціна (₴)</label>
                      <input
                        type="number"
                        min={10}
                        required
                        value={pubProsePrice}
                        onChange={(e) => setPubProsePrice(e.target.value)}
                        className={`${STUDIO_INPUT_SM_CLASS} font-mono tabular-nums`}
                      />
                    </div>
                  )}

                  <div className="flex-1 min-w-[220px] flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white dark:bg-[#202020] rounded-lg">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[#141413] dark:text-[#EDEAE1] truncate">
                        {pubProsePdfMeta
                          ? `${pubProsePdfMeta.fileName} (${formatFileSize(pubProsePdfMeta.fileSize)})`
                          : 'PDF-документ (необов’язково)'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <label className="btn-editorial-secondary py-1 px-2.5 text-[11px] cursor-pointer">
                        <Upload className="w-3 h-3 text-[#2C5937] dark:text-[#E5E5E5]" />
                        <span>
                          {uploadingProsePdfId === 'new-prose-pdf'
                            ? 'Завантаження...'
                            : pubProsePdfMeta
                              ? 'Змінити'
                              : 'Завантажити PDF'}
                        </span>
                        <input
                          type="file"
                          accept=".pdf,application/pdf"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadProsePdfFile(file);
                            e.target.value = '';
                          }}
                          className="hidden"
                        />
                      </label>
                      {pubProsePdfMeta && (
                        <button
                          type="button"
                          onClick={() => setPubProsePdfMeta(null)}
                          className="p-1 text-[#5C5C58] hover:text-rose-700 cursor-pointer"
                          aria-label="Прибрати PDF"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <button type="submit" className="btn-editorial-primary">
              {editingBlogId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              <span>{editingBlogId ? 'Зберегти зміни у блозі' : 'Опублікувати на сайті'}</span>
            </button>
            {editingBlogId && (
              <button
                type="button"
                onClick={() => {
                  resetComposeForm();
                  setSubTab('list');
                }}
                className="btn-editorial-secondary"
              >
                Скасувати
              </button>
            )}
          </div>
        </form>
      )}

      {/* 2b. Reader Submissions Moderation View (Poems + Prose) */}
      {subTab === 'submissions' && (
        <div className="space-y-4">
          <div
            role="tablist"
            aria-label="Тип заявок читачів"
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#EAE7DF] dark:bg-[#1B1B1B]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={submissionKindTab === 'poems'}
              onClick={() => setSubmissionKindTab('poems')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                submissionKindTab === 'poems'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-2xs'
                  : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
              }`}
            >
              <span>Вірші</span>
              {poemSubmissions.length > 0 && (
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    pendingPoemSubmissionsCount > 0
                      ? 'px-1.5 py-0.5 rounded-full bg-red-600 text-white font-semibold'
                      : 'opacity-85'
                  }`}
                >
                  {pendingPoemSubmissionsCount > 0 ? pendingPoemSubmissionsCount : poemSubmissions.length}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={submissionKindTab === 'prose'}
              onClick={() => setSubmissionKindTab('prose')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                submissionKindTab === 'prose'
                  ? 'bg-pear-pine-gradient text-white font-semibold shadow-2xs'
                  : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
              }`}
            >
              <span>Проза</span>
              {proseSubmissions.length > 0 && (
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    pendingProseSubmissionsCount > 0
                      ? 'px-1.5 py-0.5 rounded-full bg-red-600 text-white font-semibold'
                      : 'opacity-85'
                  }`}
                >
                  {pendingProseSubmissionsCount > 0 ? pendingProseSubmissionsCount : proseSubmissions.length}
                </span>
              )}
            </button>
          </div>

          {submissionKindTab === 'poems' ? (
            <StudioPoemSubmissionsPanel
              submissions={poemSubmissions}
              setSubmissions={setPoemSubmissions}
              setPoems={setPoems}
              getAuthHeaders={getAuthHeaders}
              setFeedback={setFeedback}
              onCatalogUpdated={onCatalogUpdated}
              onReloadAuthorData={onReloadAuthorData}
            />
          ) : (
            <StudioProseSubmissionsPanel
              submissions={proseSubmissions}
              setSubmissions={setProseSubmissions}
              setProse={setProse}
              getAuthHeaders={getAuthHeaders}
              setFeedback={setFeedback}
              onCatalogUpdated={onCatalogUpdated}
              onReloadAuthorData={onReloadAuthorData}
            />
          )}
        </div>
      )}

      {/* 3. Prose Tags & Reader Discount Settings */}
      {subTab === 'settings' && (
        <div className="max-w-2xl space-y-8">
          {/* Authorized Reader Discount */}
          <form
            onSubmit={handleSaveProseDiscount}
            className="pb-4 space-y-3"
          >
            <div>
              <h4 className="text-sm font-semibold text-[#141413] dark:text-[#EDEAE1] flex items-center gap-2">
                <Percent className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" />
                <span>Знижка на платну прозу для авторизованих</span>
              </h4>
              <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] mt-0.5">
                Авторизовані читачі отримують цей відсоток знижки на всі платні прозові твори (0–90%).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-24">
                <input
                  type="number"
                  min={0}
                  max={90}
                  step={1}
                  value={proseAuthDiscountDraft}
                  onChange={(e) => setProseAuthDiscountDraft(e.target.value)}
                  aria-label="Відсоток знижки для авторизованих читачів"
                  className={`${STUDIO_INPUT_SM_CLASS} pr-7 font-mono tabular-nums`}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-[#5C5C58]">
                  %
                </span>
              </div>

              <button type="submit" disabled={savingProseDiscount} className="btn-editorial-primary py-1.5 px-3.5">
                <Save className="w-3.5 h-3.5" />
                <span>{savingProseDiscount ? 'Збереження...' : 'Зберегти'}</span>
              </button>

              {Number(proseAuthDiscountDraft) > 0 && (
                <span className="text-xs font-mono tabular-nums text-[#1E563B] dark:text-[#E5E5E5]">
                  100 ₴ → {getProseEffectivePriceUah(100, Number(proseAuthDiscountDraft) || 0, true)} ₴
                </span>
              )}
            </div>
          </form>

          {/* Telegram Subscriber Discount for Prose */}
          <form
            onSubmit={handleSaveProseTelegramDiscount}
            className="pb-4 space-y-3"
          >
            <div>
              <h4 className="text-sm font-semibold text-[#141413] dark:text-[#EDEAE1] flex items-center gap-2">
                <Send className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" />
                <span>Знижка на платну прозу для підписників Telegram</span>
              </h4>
              <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] mt-0.5">
                Підписники Telegram-каналу отримують цю знижку на всі платні твори у розділі «Проза» (0–90%).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-24">
                <input
                  type="number"
                  min={0}
                  max={90}
                  step={1}
                  value={proseTelegramDiscountDraft}
                  onChange={(e) => setProseTelegramDiscountDraft(e.target.value)}
                  aria-label="Відсоток знижки у Прозі для підписників Telegram-каналу"
                  className={`${STUDIO_INPUT_SM_CLASS} pr-7 font-mono tabular-nums`}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-[#5C5C58]">
                  %
                </span>
              </div>

              <button
                type="submit"
                disabled={savingProseTelegramDiscount}
                className="btn-editorial-primary py-1.5 px-3.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingProseTelegramDiscount ? 'Збереження...' : 'Зберегти'}</span>
              </button>

              {Number(proseTelegramDiscountDraft) > 0 && (
                <span className="text-xs font-mono tabular-nums text-[#1E563B] dark:text-[#E5E5E5]">
                  100 ₴ → {getProseEffectivePriceUah(100, Number(proseTelegramDiscountDraft) || 0, true)} ₴
                </span>
              )}
            </div>

            {tgHealth && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#5C5C58] dark:text-[#A6A196] pt-1">
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <Send className="w-3 h-3 text-[#2C5937] dark:text-[#E5E5E5] shrink-0" />
                  {tgHealth.botConfigured && tgHealth.channelAccessible ? (
                    <span className="text-[#1E563B] dark:text-[#E5E5E5]">
                      Перевірка активна: @{tgHealth.botUsername} перевіряє підписку на {tgHealth.channelLabel}
                      {tgHealth.webhookActive ? ' · Webhook увімкнено' : ''}
                    </span>
                  ) : (
                    <span>
                      {tgHealth.error || 'Вставте токен бота у вкладці «ТГ-бот» та призначте бота адміністратором каналу.'}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  {onOpenTelegramSettings && (
                    <button
                      type="button"
                      onClick={onOpenTelegramSettings}
                      className="font-medium text-[#2C5937] dark:text-[#E5E5E5] hover:underline underline-offset-4 cursor-pointer"
                    >
                      Налаштувати токен бота →
                    </button>
                  )}
                  {tgHealth.botConfigured && tgHealth.channelAccessible && (
                    <button
                      type="button"
                      onClick={() => void handleToggleWebhook(!tgHealth.webhookActive)}
                      disabled={configuringWebhook}
                      className="font-medium text-[#2C5937] dark:text-[#E5E5E5] hover:underline underline-offset-4 cursor-pointer"
                    >
                      {configuringWebhook
                        ? 'Налаштування...'
                        : tgHealth.webhookActive
                          ? 'Вимкнути webhook'
                          : 'Підключити webhook'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void loadTgHealth()}
                    disabled={checkingTgHealth}
                    className="inline-flex items-center gap-1 font-medium text-[#2C5937] dark:text-[#E5E5E5] hover:underline underline-offset-4 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${checkingTgHealth ? 'animate-spin' : ''}`} />
                    <span>Оновити статус</span>
                  </button>
                </div>
              </div>
            )}
          </form>

          {/* Prose Collection Tags */}
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-[#141413] dark:text-[#EDEAE1] flex items-center gap-2">
                <BookMarked className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" />
                <span>Теги збірок і книг (Проза)</span>
              </h4>
              <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] mt-0.5">
                Позначайте, до якої збірки або книги належить кожен прозовий твір.
              </p>
            </div>

            <form onSubmit={handleCreateProseTag} className="space-y-3">
              <input
                type="text"
                maxLength={60}
                value={newTagLabel}
                onChange={(e) => setNewTagLabel(e.target.value)}
                placeholder="Напр.: Книга «Сіль на кінчиках пальців»"
                className={STUDIO_INPUT_CLASS}
              />

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Колір тегу">
                  {PROSE_TAG_COLOR_LIST.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setNewTagColor(preset.id);
                        setCustomHexDraft(preset.hex);
                      }}
                      title={preset.name}
                      aria-label={preset.name}
                      className={`w-6 h-6 rounded-full ${preset.swatchClass} transition-transform cursor-pointer ${
                        newTagColor === preset.id
                          ? 'scale-125 shadow-md'
                          : 'opacity-70 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-1.5 pl-2">
                  <label
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#EFECE6] dark:bg-[#262626] cursor-pointer ${
                      isHexTagColor(newTagColor) ? 'bg-[#EAE7DF] dark:bg-[#323232] font-semibold' : ''
                    }`}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0"
                      style={{ backgroundColor: getProseTagPreset(newTagColor).hex }}
                    />
                    <Palette className="w-3 h-3 text-[#5C5C58]" />
                    <span>Свій</span>
                    <input
                      type="color"
                      value={getProseTagPreset(newTagColor).hex}
                      onChange={(e) => {
                        const hex = e.target.value.toUpperCase();
                        setCustomHexDraft(hex);
                        setNewTagColor(hex);
                      }}
                      className="sr-only"
                    />
                  </label>
                  <input
                    type="text"
                    value={customHexDraft}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      setCustomHexDraft(val);
                      if (isHexTagColor(val)) {
                        setNewTagColor(val.trim().toUpperCase());
                      }
                    }}
                    maxLength={7}
                    className="w-[74px] px-2 py-1 text-[11px] font-mono bg-[#EFECE6] dark:bg-[#1B1B1B] rounded-lg uppercase tabular-nums focus:outline-none focus:bg-[#FAF9F5] dark:focus:bg-[#323232]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2 text-xs text-[#5C5C58] dark:text-[#A6A196]">
                  <span>Вигляд:</span>
                  <span
                    style={getProseTagPreset(newTagColor).badgeStyle}
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold ${getProseTagPreset(newTagColor).badgeClass}`}
                  >
                    <BookMarked className="w-3 h-3 shrink-0" strokeWidth={2.1} />
                    <span>{newTagLabel.trim() || 'Назва тегу'}</span>
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={savingTag || newTagLabel.trim().length < 2}
                  className="btn-editorial-primary py-1.5 px-3.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{savingTag ? 'Створення...' : 'Створити тег'}</span>
                </button>
              </div>
            </form>

            {proseTags.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {proseTags.map((tag) => {
                  const preset = getProseTagPreset(tag.color);
                  return (
                    <span
                      key={tag.id}
                      style={preset.badgeStyle}
                      className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg text-xs font-semibold ${preset.badgeClass}`}
                    >
                      <BookMarked className="w-3 h-3 shrink-0" strokeWidth={2.1} />
                      <span>{tag.label}</span>
                      <label
                        className="p-0.5 rounded hover:bg-black/15 cursor-pointer"
                        title="Змінити колір тегу"
                      >
                        <Palette className="w-3 h-3" strokeWidth={2} />
                        <input
                          type="color"
                          value={preset.hex}
                          onChange={(e) => handleUpdateProseTagColor(tag.id, e.target.value.toUpperCase())}
                          className="sr-only"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => handleDeleteProseTag(tag.id)}
                        className="p-0.5 rounded hover:bg-black/15 cursor-pointer"
                        aria-label={`Видалити тег ${tag.label}`}
                      >
                        <X className="w-3 h-3" strokeWidth={2.2} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
