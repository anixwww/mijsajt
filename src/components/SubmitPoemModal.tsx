import {
  CheckCircle2,
  Clock,
  ImagePlus,
  Music2,
  Palette,
  RefreshCw,
  Send,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  GuestUser,
  PoemImagePalette,
  PoemSoundCloudTrack,
  PoemSubmission,
  ProseStatus,
} from '../types.ts';
import { isValidBlogPhotoUrl } from '../utils/blogMedia.ts';
import { extractImagePalette } from '../utils/imagePalette.ts';
import { readImageAsOptimizedDataUrl } from '../utils/imageUpload.ts';
import { preserveFormattedText } from '../utils/textFormatting.ts';
import { POEM_THEME_PRESETS } from './studio/StudioWorksTab.tsx';

interface SubmitPoemModalProps {
  isOpen: boolean;
  guestUser: GuestUser | null;
  getGuestToken?: (forceRefresh?: boolean) => Promise<string | null>;
  onClose: () => void;
  onOpenAuthModal: () => void;
  onOpenPublishedPoem?: (poemId: string) => void;
}

type ModalTab = 'form' | 'mine';

const INPUT_CLASS =
  'w-full px-3.5 py-2.5 text-sm bg-paper-warm dark:bg-night-deep rounded-xl text-ink dark:text-cream-soft placeholder:text-ink-subtle focus:outline-none focus:bg-paper dark:focus:bg-night-hover transition-colors';

const INPUT_SM_CLASS =
  'w-full px-3 py-2 text-xs bg-paper-warm dark:bg-night-deep rounded-lg text-ink dark:text-cream-soft placeholder:text-ink-subtle focus:outline-none focus:bg-paper dark:focus:bg-night-hover transition-colors';

const LABEL_CLASS =
  'block text-xs font-medium text-ink-muted dark:text-sandstone mb-1.5';

export function SubmitPoemModal({
  isOpen,
  guestUser,
  getGuestToken,
  onClose,
  onOpenAuthModal,
  onOpenPublishedPoem,
}: SubmitPoemModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>('form');

  // Form state
  const [authorName, setAuthorName] = useState('');
  const [title, setTitle] = useState('');
  const [cycle, setCycle] = useState('');
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const [workStatus, setWorkStatus] = useState<ProseStatus>('completed');
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg' | 'xl' | '2xl'>('lg');
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left');
  const [lineSpacing, setLineSpacing] = useState<'tight' | 'normal' | 'relaxed' | 'loose'>('relaxed');
  const [backgroundColor, setBackgroundColor] = useState('');
  const [textColor, setTextColor] = useState('');

  // Photo & palette
  const [imageUrl, setImageUrl] = useState('');
  const [imageUrlDraft, setImageUrlDraft] = useState('');
  const [imagePalette, setImagePalette] = useState<PoemImagePalette | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [paletteExtracting, setPaletteExtracting] = useState(false);

  // SoundCloud
  const [scUrlDraft, setScUrlDraft] = useState('');
  const [scTracks, setScTracks] = useState<PoemSoundCloudTrack[]>([]);
  const [scImporting, setScImporting] = useState(false);

  // UI & submissions state
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; isError?: boolean } | null>(null);
  const [mySubmissions, setMySubmissions] = useState<PoemSubmission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (guestUser?.displayName && !authorName) {
      setAuthorName(guestUser.displayName);
    }
  }, [isOpen, guestUser?.displayName, authorName]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const fetchValidToken = useCallback(async (): Promise<string | null> => {
    if (!getGuestToken) return null;
    let token = await getGuestToken();
    if (token?.startsWith('guest_v1.')) {
      const refreshed = await getGuestToken(true);
      if (refreshed) token = refreshed;
    }
    return token;
  }, [getGuestToken]);

  const loadMySubmissions = useCallback(async () => {
    if (!guestUser) return;
    setLoadingSubmissions(true);
    try {
      let token = await fetchValidToken();
      if (!token) return;
      let res = await fetch('/api/poems/my-submissions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 && getGuestToken) {
        const refreshed = await getGuestToken(true);
        if (refreshed && refreshed !== token) {
          token = refreshed;
          res = await fetch('/api/poems/my-submissions', {
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      if (!res.ok) return;
      const data = (await res.json()) as { submissions?: PoemSubmission[] };
      if (Array.isArray(data.submissions)) {
        setMySubmissions(data.submissions);
      }
    } catch {
      // Ignore transient load error
    } finally {
      setLoadingSubmissions(false);
    }
  }, [guestUser, fetchValidToken, getGuestToken]);

  useEffect(() => {
    if (isOpen && guestUser) {
      void loadMySubmissions();
    }
  }, [isOpen, guestUser, loadMySubmissions]);

  const extractAndApplyPalette = useCallback(
    async (targetUrl: string, resetManualOverrides: boolean) => {
      const clean = targetUrl.trim();
      if (!clean) {
        setImagePalette(null);
        return;
      }
      setPaletteExtracting(true);
      try {
        const token = await fetchValidToken();
        const palette = await extractImagePalette(clean, {
          proxyUrl: `/api/poems/image-proxy?url=${encodeURIComponent(clean)}`,
          proxyHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        setImagePalette(palette);
        if (resetManualOverrides && palette) {
          setBackgroundColor('');
          setTextColor('');
        }
      } finally {
        setPaletteExtracting(false);
      }
    },
    [fetchValidToken]
  );

  const handleUploadPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    setPhotoUploading(true);
    setFeedback(null);
    try {
      let token = await fetchValidToken();
      if (!token) {
        onOpenAuthModal();
        return;
      }
      const dataUrl = await readImageAsOptimizedDataUrl(file);
      let response = await fetch('/api/poems/upload-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ dataUrl }),
      });
      if (response.status === 401 && getGuestToken) {
        const refreshed = await getGuestToken(true);
        if (refreshed && refreshed !== token) {
          token = refreshed;
          response = await fetch('/api/poems/upload-image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ dataUrl }),
          });
        }
      }
      const data = await response.json();
      if (!response.ok || typeof data.url !== 'string' || !data.url) {
        setFeedback({
          text: data.error || 'Не вдалося завантажити фото до вірша.',
          isError: true,
        });
        return;
      }
      setImageUrl(data.url);
      setImageUrlDraft('');
      await extractAndApplyPalette(data.url, true);
      setFeedback({ text: 'Фото додано до вірша.' });
    } catch {
      setFeedback({ text: 'Помилка під час завантаження фото.', isError: true });
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleApplyPhotoUrl = async () => {
    const trimmed = imageUrlDraft.trim();
    if (!trimmed) return;
    if (!isValidBlogPhotoUrl(trimmed)) {
      setFeedback({
        text: 'Посилання на фото має починатися з https://, http:// або /uploads/...',
        isError: true,
      });
      return;
    }
    setFeedback(null);
    setImageUrl(trimmed);
    setImageUrlDraft('');
    await extractAndApplyPalette(trimmed, true);
    setFeedback({ text: 'Фото додано до вірша.' });
  };

  const handleImportSoundCloud = async () => {
    const trimmed = scUrlDraft.trim();
    if (!trimmed || scImporting) return;
    if (scTracks.length >= 10) {
      setFeedback({ text: 'Можна додати до 10 пісень до одного вірша.', isError: true });
      return;
    }
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    setScImporting(true);
    setFeedback(null);
    try {
      let token = await fetchValidToken();
      if (!token) {
        onOpenAuthModal();
        return;
      }
      let res = await fetch('/api/poems/resolve-soundcloud', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: trimmed }),
      });
      if (res.status === 401 && getGuestToken) {
        const refreshed = await getGuestToken(true);
        if (refreshed && refreshed !== token) {
          token = refreshed;
          res = await fetch('/api/poems/resolve-soundcloud', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ url: trimmed }),
          });
        }
      }
      const data = (await res.json()) as {
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
      if (!res.ok || incoming.length === 0) {
        setFeedback({
          text: data.error || 'Не вдалося розпізнати трек SoundCloud.',
          isError: true,
        });
        return;
      }
      const existingUrls = new Set(scTracks.map((t) => t.soundcloudUrl.toLowerCase()));
      const uniqueNew = incoming.filter((t) => !existingUrls.has(t.soundcloudUrl.toLowerCase()));
      const merged = [...scTracks, ...uniqueNew].slice(0, 10);
      const addedCount = merged.length - scTracks.length;
      setScTracks(merged);
      setScUrlDraft('');
      setFeedback({
        text:
          addedCount === 0
            ? 'Ці пісні вже додані.'
            : addedCount === 1
              ? `Пісню «${uniqueNew[0]?.title || ''}» додано.`
              : `Додано пісень: ${addedCount}.`,
      });
    } catch {
      setFeedback({
        text: 'Помилка мережі під час додавання треку SoundCloud.',
        isError: true,
      });
    } finally {
      setScImporting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    const cleanTitle = title.trim();
    const cleanContent = preserveFormattedText(content);
    if (!cleanTitle) {
      setFeedback({ text: 'Вкажіть назву вірша.', isError: true });
      return;
    }
    if (!cleanContent.trim()) {
      setFeedback({ text: 'Введіть текст вірша.', isError: true });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      let token = await fetchValidToken();
      if (!token) {
        onOpenAuthModal();
        return;
      }
      const payload = {
        title: cleanTitle,
        cycle: cycle.trim(),
        content: cleanContent,
        note: note.trim() || undefined,
        workStatus,
        authorName: authorName.trim() || guestUser.displayName,
        fontSize,
        textAlign,
        lineSpacing,
        ...(textColor.trim() ? { textColor: textColor.trim() } : {}),
        ...(backgroundColor.trim() ? { backgroundColor: backgroundColor.trim() } : {}),
        ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        ...(imageUrl.trim() && imagePalette ? { imagePalette } : {}),
        ...(scTracks.length > 0
          ? { soundcloudTrack: scTracks[0], soundcloudTracks: scTracks }
          : {}),
      };

      let res = await fetch('/api/poems/submissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 401 && getGuestToken) {
        const refreshed = await getGuestToken(true);
        if (refreshed && refreshed !== token) {
          token = refreshed;
          res = await fetch('/api/poems/submissions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });
        }
      }

      const data = (await res.json()) as {
        error?: string;
        submission?: PoemSubmission;
      };
      if (!res.ok || !data.submission) {
        setFeedback({
          text: data.error || 'Не вдалося надіслати вірш. Спробуйте ще раз.',
          isError: true,
        });
        return;
      }

      setMySubmissions((prev) => [data.submission!, ...prev]);
      setTitle('');
      setCycle('');
      setContent('');
      setNote('');
      setWorkStatus('completed');
      setImageUrl('');
      setImageUrlDraft('');
      setImagePalette(null);
      setScTracks([]);
      setScUrlDraft('');
      setBackgroundColor('');
      setTextColor('');
      setFontSize('lg');
      setTextAlign('left');
      setLineSpacing('relaxed');
      setFeedback({
        text: 'Вірш надіслано на модерацію! Коли автор сайту погодить його, він з’явиться у вкладці «Стрічка віршів».',
      });
      setActiveTab('mine');
    } catch {
      setFeedback({ text: 'Помилка з’єднання із сервером.', isError: true });
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-ink/55 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Запропонувати вірш"
    >
      <div
        className="relative bg-white dark:bg-night-panel sm:rounded-2xl w-full max-w-2xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl text-ink dark:text-cream-soft"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-5 sm:px-6 py-4 flex items-center justify-between gap-3 bg-paper-oat dark:bg-night shrink-0">
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-ink dark:text-cream-soft truncate">
              Запропонувати вірш
            </h3>
            <p className="text-xs text-ink-muted dark:text-sandstone truncate">
              Після перевірки автором твір з’явиться у вкладці «Стрічка віршів»
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити вікно"
            className="p-2 rounded-lg text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft hover:bg-paper-sand dark:hover:bg-night-elevated cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Tabs */}
        <div className="px-5 sm:px-6 pt-3 pb-2 flex items-center justify-between gap-2 bg-white dark:bg-night-panel shrink-0 border-b border-paper-warm dark:border-night-hover">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveTab('form');
                setFeedback(null);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'form'
                  ? 'bg-pear-pine-gradient text-white font-semibold'
                  : 'text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft hover:bg-paper-oat dark:hover:bg-night-elevated'
              }`}
            >
              Надіслати вірш
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('mine');
                void loadMySubmissions();
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'mine'
                  ? 'bg-pear-pine-gradient text-white font-semibold'
                  : 'text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft hover:bg-paper-oat dark:hover:bg-night-elevated'
              }`}
            >
              <span>Мої заявки</span>
              {mySubmissions.length > 0 && (
                <span className="font-mono text-[11px] tabular-nums opacity-85">
                  {mySubmissions.length}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'mine' && guestUser && (
            <button
              type="button"
              onClick={() => void loadMySubmissions()}
              disabled={loadingSubmissions}
              aria-label="Оновити заявки"
              className="p-1.5 rounded-lg text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft hover:bg-paper-oat dark:hover:bg-night-elevated cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingSubmissions ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
          {feedback && (
            <div
              role="status"
              className={`px-4 py-2.5 rounded-xl flex items-center justify-between gap-3 text-xs font-medium ${
                feedback.isError
                  ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                  : 'bg-[#F2F6EE] dark:bg-night-elevated text-pine-dark dark:text-cream'
              }`}
            >
              <span>{feedback.text}</span>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                aria-label="Сховати повідомлення"
                className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {!guestUser ? (
            <div className="py-10 text-center space-y-3 bg-paper dark:bg-night-card rounded-xl p-6">
              <p className="text-sm text-ink-muted dark:text-sandstone">
                Щоб запропонувати свій вірш, увійдіть через Google.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuthModal();
                }}
                className="btn-editorial-primary px-6 py-2.5 text-xs font-semibold"
              >
                Увійти
              </button>
            </div>
          ) : activeTab === 'form' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className={LABEL_CLASS}>Назва вірша *</label>
                  <input
                    type="text"
                    required
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Наприклад: Вечірній вітер"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Ваш підпис (ім’я або псевдонім)</label>
                  <input
                    type="text"
                    maxLength={80}
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder={guestUser.displayName}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className={LABEL_CLASS}>Цикл або тема (необов’язково)</label>
                  <input
                    type="text"
                    maxLength={160}
                    value={cycle}
                    onChange={(e) => setCycle(e.target.value)}
                    placeholder="Стрічка віршів"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Примітка або епіграф (необов’язково)</label>
                  <input
                    type="text"
                    maxLength={1000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Рік, присвята або коротка нотатка"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <label className={LABEL_CLASS}>Статус твору *</label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWorkStatus('completed')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                      workStatus === 'completed'
                        ? 'bg-emerald-50 text-emerald-800 dark:bg-night-elevated dark:text-silver font-semibold ring-1 ring-emerald-500/30'
                        : 'bg-paper dark:bg-night-card text-ink-muted dark:text-sandstone'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Закінчено</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkStatus('in_progress')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                      workStatus === 'in_progress'
                        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 font-semibold ring-1 ring-amber-500/30'
                        : 'bg-paper dark:bg-night-card text-ink-muted dark:text-sandstone'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>У процесі (ще дописується)</span>
                  </button>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-medium text-ink-muted dark:text-sandstone">
                    Текст вірша *
                  </label>
                  <span className="text-[11px] text-ink-subtle dark:text-stone-warm">
                    Відступи й слова в стовпчик зберігаються точно
                  </span>
                </div>
                <textarea
                  required
                  rows={8}
                  maxLength={50000}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Впишіть або вставте текст вірша..."
                  className={`${INPUT_CLASS} leading-relaxed`}
                />
              </div>

              {/* Photo & SoundCloud Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Photo Box */}
                <div className="p-3.5 rounded-xl bg-paper dark:bg-night-card space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink dark:text-cream-soft">
                      <ImagePlus className="w-4 h-4 text-pine dark:text-silver" />
                      <span>Фото до вірша</span>
                    </span>
                    {imageUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setImageUrl('');
                          setImagePalette(null);
                          setImageUrlDraft('');
                        }}
                        className="text-[11px] font-medium text-rose-700 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        Прибрати
                      </button>
                    )}
                  </div>

                  {imageUrl ? (
                    <div className="space-y-2">
                      <img
                        src={imageUrl}
                        alt="Прев’ю фото до вірша"
                        width={400}
                        height={128}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-32 object-cover rounded-lg bg-paper-warm dark:bg-night-deep"
                      />
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        {paletteExtracting ? (
                          <span className="text-ink-muted dark:text-sandstone">
                            Визначення палітри...
                          </span>
                        ) : imagePalette ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-ink-muted dark:text-sandstone">
                            <span
                              className="w-4 h-4 rounded shrink-0"
                              style={{ backgroundColor: imagePalette.background }}
                            />
                            <span>{imagePalette.background}</span>
                          </span>
                        ) : (
                          <span className="text-ink-muted dark:text-sandstone">
                            Фото прикріплено
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={paletteExtracting}
                          onClick={() => void extractAndApplyPalette(imageUrl, true)}
                          className="text-[11px] font-medium text-pine dark:text-silver hover:underline cursor-pointer"
                        >
                          Оновити тон
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="btn-editorial-secondary w-full justify-center cursor-pointer text-xs py-1.5">
                        <Upload className="w-3.5 h-3.5" />
                        <span>
                          {photoUploading ? 'Завантаження...' : 'Завантажити фото'}
                        </span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={handleUploadPhoto}
                          disabled={photoUploading}
                          className="sr-only"
                        />
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={imageUrlDraft}
                          onChange={(e) => setImageUrlDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleApplyPhotoUrl();
                            }
                          }}
                          placeholder="Або URL фото (https://...)"
                          className={`${INPUT_SM_CLASS} font-mono flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => void handleApplyPhotoUrl()}
                          disabled={!imageUrlDraft.trim()}
                          className="btn-editorial-secondary py-1.5 px-2.5 text-xs shrink-0"
                        >
                          Ок
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* SoundCloud Box */}
                <div className="p-3.5 rounded-xl bg-paper dark:bg-night-card space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink dark:text-cream-soft">
                      <Music2 className="w-4 h-4 text-pine dark:text-silver" />
                      <span>Пісні з SoundCloud</span>
                      {scTracks.length > 0 && (
                        <span className="font-mono text-[11px] text-ink-subtle dark:text-stone-warm">
                          {scTracks.length}/10
                        </span>
                      )}
                    </span>
                    {scTracks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setScTracks([])}
                        className="text-[11px] font-medium text-rose-700 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        {scTracks.length > 1 ? 'Очистити все' : 'Прибрати'}
                      </button>
                    )}
                  </div>

                  {scTracks.length > 0 && (
                    <div className="space-y-1.5">
                      {scTracks.map((trackItem, idx) => (
                        <div
                          key={`${trackItem.id}-${idx}`}
                          className="p-2 rounded-lg bg-white dark:bg-night-panel flex items-center gap-2.5"
                        >
                          {trackItem.artworkUrl ? (
                            <img
                              src={trackItem.artworkUrl}
                              alt={trackItem.title}
                              width={36}
                              height={36}
                              loading="lazy"
                              decoding="async"
                              className="w-9 h-9 rounded-lg object-cover shrink-0 bg-paper-warm dark:bg-night-elevated"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center bg-paper-warm dark:bg-night-elevated text-pine dark:text-silver">
                              <Music2 className="w-4 h-4" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold truncate">{trackItem.title}</p>
                            <p className="text-[11px] text-ink-muted dark:text-sandstone truncate">
                              {trackItem.artist}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setScTracks((prev) => prev.filter((_, i) => i !== idx))
                            }
                            aria-label={`Видалити «${trackItem.title}»`}
                            className="p-1 text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 rounded cursor-pointer shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {scTracks.length < 10 && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={scUrlDraft}
                        onChange={(e) => setScUrlDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleImportSoundCloud();
                          }
                        }}
                        placeholder="https://soundcloud.com/..."
                        className={`${INPUT_SM_CLASS} font-mono flex-1`}
                      />
                      <button
                        type="button"
                        disabled={scImporting || !scUrlDraft.trim()}
                        onClick={() => void handleImportSoundCloud()}
                        className="btn-editorial-secondary py-1.5 px-2.5 text-xs shrink-0"
                      >
                        {scImporting ? '...' : scTracks.length > 0 ? 'Ще' : 'Додати'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Compact Typesetting & Palette */}
              <div className="p-3.5 rounded-xl bg-paper dark:bg-night-card space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-ink dark:text-cream-soft">
                  <Palette className="w-3.5 h-3.5 text-pine dark:text-silver" />
                  <span>Оформлення картки вірша (необов’язково)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className={LABEL_CLASS}>Розмір тексту</label>
                    <select
                      value={fontSize}
                      onChange={(e) =>
                        setFontSize(e.target.value as 'sm' | 'base' | 'lg' | 'xl' | '2xl')
                      }
                      className={INPUT_SM_CLASS}
                    >
                      <option value="sm">Маленький</option>
                      <option value="base">Стандартний</option>
                      <option value="lg">Великий</option>
                      <option value="xl">Дуже великий</option>
                      <option value="2xl">Максимальний</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Вирівнювання</label>
                    <select
                      value={textAlign}
                      onChange={(e) =>
                        setTextAlign(e.target.value as 'left' | 'center' | 'right')
                      }
                      className={INPUT_SM_CLASS}
                    >
                      <option value="left">Зліва</option>
                      <option value="center">По центру</option>
                      <option value="right">Справа</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Міжряддя</label>
                    <select
                      value={lineSpacing}
                      onChange={(e) =>
                        setLineSpacing(
                          e.target.value as 'tight' | 'normal' | 'relaxed' | 'loose'
                        )
                      }
                      className={INPUT_SM_CLASS}
                    >
                      <option value="tight">Щільний</option>
                      <option value="normal">Звичайний</option>
                      <option value="relaxed">Просторий</option>
                      <option value="loose">Вільний</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {imageUrl && imagePalette && (
                    <button
                      type="button"
                      onClick={() => {
                        setBackgroundColor('');
                        setTextColor('');
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-all ${
                        !backgroundColor && !textColor
                          ? 'bg-paper-sand dark:bg-night-elevated text-ink dark:text-cream-soft shadow-xs'
                          : 'bg-white dark:bg-night-panel text-ink-muted dark:text-sandstone'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: imagePalette.background }}
                      />
                      <span>З палітри фото</span>
                    </button>
                  )}
                  {POEM_THEME_PRESETS.map((preset) => {
                    const isActive =
                      backgroundColor === preset.bg &&
                      textColor === preset.text &&
                      !(preset.id === 'default' && imageUrl && imagePalette);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setBackgroundColor(preset.bg);
                          setTextColor(preset.text);
                        }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-all ${
                          isActive
                            ? 'bg-paper-sand dark:bg-night-elevated text-ink dark:text-cream-soft shadow-xs'
                            : 'bg-white dark:bg-night-panel text-ink-muted dark:text-sandstone'
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: preset.bg || '#F5F4EE' }}
                        />
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-editorial-secondary px-4 py-2 text-xs"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-editorial-primary px-5 py-2 text-xs font-semibold"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Надсилання...' : 'Надіслати вірш'}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              {loadingSubmissions && mySubmissions.length === 0 ? (
                <div className="py-10 text-center text-xs text-ink-muted dark:text-sandstone">
                  Завантаження ваших заявок...
                </div>
              ) : mySubmissions.length === 0 ? (
                <div className="py-10 text-center space-y-2.5 bg-paper dark:bg-night-card rounded-xl p-6">
                  <p className="text-sm text-ink-muted dark:text-sandstone">
                    Ви ще не пропонували власних віршів.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('form')}
                    className="btn-editorial-primary px-5 py-2 text-xs font-semibold"
                  >
                    Написати перший вірш
                  </button>
                </div>
              ) : (
                mySubmissions.map((sub) => {
                  const isApproved = sub.status === 'approved';
                  const isRejected = sub.status === 'rejected';
                  return (
                    <div
                      key={sub.id}
                      className="p-4 rounded-xl bg-paper dark:bg-night-card space-y-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-ink dark:text-cream-soft">
                            {sub.title}
                          </h4>
                          <p className="text-[11px] text-ink-muted dark:text-sandstone">
                            {sub.authorName}
                            {sub.cycle ? ` · ${sub.cycle}` : ''}
                            {' · '}
                            {new Date(sub.createdAt).toLocaleDateString('uk-UA')}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          {sub.workStatus && (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                                sub.workStatus === 'completed'
                                  ? 'bg-emerald-50 text-emerald-800 dark:bg-night-elevated dark:text-silver'
                                  : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                              }`}
                            >
                              {sub.workStatus === 'completed' ? 'Закінчено' : 'У процесі'}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 ${
                              isApproved
                                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : isRejected
                                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                                  : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                            }`}
                          >
                            {isApproved ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Опубліковано</span>
                              </>
                            ) : isRejected ? (
                              <>
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Відхилено</span>
                              </>
                            ) : (
                              <>
                                <Clock className="w-3.5 h-3.5" />
                                <span>На розгляді</span>
                              </>
                            )}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-ink-muted dark:text-sandstone whitespace-pre-wrap line-clamp-3">
                        {sub.content}
                      </p>

                      {(sub.imageUrl || (sub.soundcloudTracks && sub.soundcloudTracks.length > 0) || sub.soundcloudTrack) && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-pine dark:text-silver">
                          {sub.imageUrl && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-night-panel">
                              <ImagePlus className="w-3 h-3" />
                              <span>Фото</span>
                            </span>
                          )}
                          {(sub.soundcloudTracks && sub.soundcloudTracks.length > 0
                            ? sub.soundcloudTracks
                            : sub.soundcloudTrack
                              ? [sub.soundcloudTrack]
                              : []
                          ).map((t, idx) => (
                            <span
                              key={`${t.id}-${idx}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-night-panel max-w-full truncate"
                            >
                              <Music2 className="w-3 h-3 shrink-0" />
                              <span className="truncate">
                                {t.artist} — {t.title}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}

                      {sub.moderationNote && (
                        <div className="px-3 py-2 rounded-lg bg-white dark:bg-night-panel text-xs">
                          <span className="font-semibold text-ink dark:text-cream-soft">
                            Коментар редактора:{' '}
                          </span>
                          <span className="text-ink-muted dark:text-sandstone">
                            {sub.moderationNote}
                          </span>
                        </div>
                      )}

                      {isApproved && sub.publishedPoemId && onOpenPublishedPoem && (
                        <div className="pt-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              onOpenPublishedPoem(sub.publishedPoemId!);
                              onClose();
                            }}
                            className="text-xs font-semibold text-pine dark:text-silver hover:underline cursor-pointer"
                          >
                            Відкрити опублікований вірш →
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
