import {
  CheckCircle2,
  Clock,
  ImagePlus,
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
import type { GuestUser, ProseStatus, ProseSubmission } from '../types.ts';
import { isValidBlogPhotoUrl } from '../utils/blogMedia.ts';
import { readImageAsOptimizedDataUrl } from '../utils/imageUpload.ts';
import { countPagesForText, countProseWords } from '../utils/prosePagination.ts';
import { preserveFormattedText } from '../utils/textFormatting.ts';

interface SubmitProseModalProps {
  isOpen: boolean;
  guestUser: GuestUser | null;
  getGuestToken?: (forceRefresh?: boolean) => Promise<string | null>;
  onClose: () => void;
  onOpenAuthModal: () => void;
  onOpenPublishedProse?: (proseId: string) => void;
}

type ModalTab = 'form' | 'mine';

const MAX_MOODBOARD_PHOTOS = 6;
const GENRE_PRESETS = ['Оповідання', 'Новела', 'Есей', 'Повість', 'Мініатюра'] as const;

const INPUT_CLASS =
  'w-full px-3.5 py-2.5 text-sm bg-[#EFECE6] dark:bg-[#1B1B1B] rounded-xl text-[#141413] dark:text-[#EDEAE1] placeholder:text-[#787872] focus:outline-none focus:bg-[#FAF9F5] dark:focus:bg-[#2E2E2E] transition-colors';

const INPUT_SM_CLASS =
  'w-full px-3 py-2 text-xs bg-[#EFECE6] dark:bg-[#1B1B1B] rounded-lg text-[#141413] dark:text-[#EDEAE1] placeholder:text-[#787872] focus:outline-none focus:bg-[#FAF9F5] dark:focus:bg-[#2E2E2E] transition-colors';

const LABEL_CLASS =
  'block text-xs font-medium text-[#5C5C58] dark:text-[#A6A196] mb-1.5';

export function SubmitProseModal({
  isOpen,
  guestUser,
  getGuestToken,
  onClose,
  onOpenAuthModal,
  onOpenPublishedProse,
}: SubmitProseModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>('form');

  // Form state
  const [authorName, setAuthorName] = useState('');
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('Оповідання');
  const [slogan, setSlogan] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [workStatus, setWorkStatus] = useState<ProseStatus>('completed');

  // Moodboard photos (optional, up to 6)
  const [moodboardUrls, setMoodboardUrls] = useState<string[]>([]);
  const [photoUrlDraft, setPhotoUrlDraft] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);

  // UI & submissions state
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; isError?: boolean } | null>(null);
  const [mySubmissions, setMySubmissions] = useState<ProseSubmission[]>([]);
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
      let res = await fetch('/api/prose/my-submissions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 && getGuestToken) {
        const refreshed = await getGuestToken(true);
        if (refreshed && refreshed !== token) {
          token = refreshed;
          res = await fetch('/api/prose/my-submissions', {
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      if (!res.ok) return;
      const data = (await res.json()) as { submissions?: ProseSubmission[] };
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

  const handleUploadPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    if (moodboardUrls.length >= MAX_MOODBOARD_PHOTOS) {
      setFeedback({
        text: `Можна прикріпити щонайбільше ${MAX_MOODBOARD_PHOTOS} фото.`,
        isError: true,
      });
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
      let response = await fetch('/api/prose/upload-image', {
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
          response = await fetch('/api/prose/upload-image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ dataUrl }),
          });
        }
      }
      const data = (await response.json()) as { error?: string; url?: string };
      if (!response.ok || typeof data.url !== 'string' || !data.url) {
        setFeedback({
          text: data.error || 'Не вдалося завантажити фото до твору.',
          isError: true,
        });
        return;
      }
      setMoodboardUrls((prev) =>
        prev.includes(data.url!) ? prev : [...prev, data.url!].slice(0, MAX_MOODBOARD_PHOTOS)
      );
      setFeedback({ text: 'Фото додано до муд-борду твору.' });
    } catch {
      setFeedback({ text: 'Помилка під час завантаження фото.', isError: true });
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleApplyPhotoUrl = () => {
    const trimmed = photoUrlDraft.trim();
    if (!trimmed) return;
    if (moodboardUrls.length >= MAX_MOODBOARD_PHOTOS) {
      setFeedback({
        text: `Можна прикріпити щонайбільше ${MAX_MOODBOARD_PHOTOS} фото.`,
        isError: true,
      });
      return;
    }
    if (!isValidBlogPhotoUrl(trimmed)) {
      setFeedback({
        text: 'Посилання на фото має починатися з https://, http:// або /uploads/...',
        isError: true,
      });
      return;
    }
    setFeedback(null);
    setMoodboardUrls((prev) =>
      prev.includes(trimmed) ? prev : [...prev, trimmed].slice(0, MAX_MOODBOARD_PHOTOS)
    );
    setPhotoUrlDraft('');
    setFeedback({ text: 'Фото додано до муд-борду твору.' });
  };

  const handleRemovePhoto = (index: number) => {
    setMoodboardUrls((prev) => prev.filter((_, i) => i !== index));
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
      setFeedback({ text: 'Вкажіть назву твору.', isError: true });
      return;
    }
    if (!cleanContent.trim()) {
      setFeedback({ text: 'Введіть текст твору.', isError: true });
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
        genre: genre.trim() || 'Оповідання',
        slogan: slogan.trim() || undefined,
        excerpt: excerpt.trim() || undefined,
        content: cleanContent,
        workStatus,
        authorName: authorName.trim() || guestUser.displayName,
        ...(moodboardUrls.length > 0 ? { moodboardUrls } : {}),
      };

      let res = await fetch('/api/prose/submissions', {
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
          res = await fetch('/api/prose/submissions', {
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
        submission?: ProseSubmission;
      };
      if (!res.ok || !data.submission) {
        setFeedback({
          text: data.error || 'Не вдалося надіслати прозу. Спробуйте ще раз.',
          isError: true,
        });
        return;
      }

      setMySubmissions((prev) => [data.submission!, ...prev]);
      setTitle('');
      setGenre('Оповідання');
      setSlogan('');
      setExcerpt('');
      setContent('');
      setWorkStatus('completed');
      setMoodboardUrls([]);
      setPhotoUrlDraft('');
      setFeedback({
        text: 'Прозу надіслано на модерацію! Коли автор сайту погодить твір, він з’явиться у вкладці «Стрічка».',
      });
      setActiveTab('mine');
    } catch {
      setFeedback({ text: 'Помилка з’єднання із сервером.', isError: true });
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || typeof document === 'undefined') return null;

  const liveWords = countProseWords(content);
  const livePages = countPagesForText(content);

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-[#141413]/55 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Запропонувати прозу"
    >
      <div
        className="relative bg-white dark:bg-[#222222] sm:rounded-2xl w-full max-w-2xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl text-[#141413] dark:text-[#EDEAE1]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-5 sm:px-6 py-4 flex items-center justify-between gap-3 bg-[#F5F4EE] dark:bg-[#181818] shrink-0">
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-[#141413] dark:text-[#EDEAE1] truncate">
              Запропонувати прозу
            </h3>
            <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] truncate">
              Після перевірки автором твір з’явиться у вкладці «Стрічка»
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити вікно"
            className="p-2 rounded-lg text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] hover:bg-[#EAE7DF] dark:hover:bg-[#323232] cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Tabs */}
        <div className="px-5 sm:px-6 pt-3 pb-2 flex items-center justify-between gap-2 bg-white dark:bg-[#222222] shrink-0 border-b border-[#EFECE6] dark:border-[#2E2E2E]">
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
                  : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] hover:bg-[#F5F4EE] dark:hover:bg-[#323232]'
              }`}
            >
              Надіслати прозу
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
                  : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] hover:bg-[#F5F4EE] dark:hover:bg-[#323232]'
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
              className="p-1.5 rounded-lg text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] hover:bg-[#F5F4EE] dark:hover:bg-[#323232] cursor-pointer disabled:opacity-50"
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
                  : 'bg-[#F2F6EE] dark:bg-[#323232] text-[#1E3A29] dark:text-[#F4F1EA]'
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
            <div className="py-10 text-center space-y-3 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl p-6">
              <p className="text-sm text-[#5C5C58] dark:text-[#A6A196]">
                Щоб запропонувати свою прозу, увійдіть на сайт.
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
                  <label className={LABEL_CLASS}>Назва твору *</label>
                  <input
                    type="text"
                    required
                    maxLength={240}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Наприклад: Теплі листи"
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
                  <label className={LABEL_CLASS}>Жанр</label>
                  <input
                    type="text"
                    maxLength={120}
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    placeholder="Оповідання"
                    className={INPUT_CLASS}
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {GENRE_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setGenre(preset)}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
                          genre.trim() === preset
                            ? 'bg-[#EAE7DF] dark:bg-[#323232] text-[#141413] dark:text-[#EDEAE1] font-semibold'
                            : 'bg-[#FAF9F5] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={LABEL_CLASS}>Слоган або епіграф (необов’язково)</label>
                  <input
                    type="text"
                    maxLength={500}
                    value={slogan}
                    onChange={(e) => setSlogan(e.target.value)}
                    placeholder="Коротка фраза або підзаголовок"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <label className={LABEL_CLASS}>Короткий опис для картки (необов’язково)</label>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  placeholder="Кілька речень про що твір (якщо залишити порожнім — сформується автоматично з першого абзацу)"
                  className={`${INPUT_CLASS} leading-relaxed`}
                />
              </div>

              <div>
                <label className={LABEL_CLASS}>Статус твору *</label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWorkStatus('completed')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                      workStatus === 'completed'
                        ? 'bg-emerald-50 text-emerald-800 dark:bg-[#323232] dark:text-[#E5E5E5] font-semibold ring-1 ring-emerald-500/30'
                        : 'bg-[#FAF9F5] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A6A196]'
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
                        : 'bg-[#FAF9F5] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A6A196]'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>У процесі (ще дописується)</span>
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-medium text-[#5C5C58] dark:text-[#A6A196]">
                    Текст твору *
                  </label>
                  <span className="font-mono text-[11px] text-[#5C5C58] dark:text-[#A6A196] tabular-nums">
                    {liveWords.toLocaleString('uk-UA')} слів · ~{livePages} стор.
                  </span>
                </div>
                <textarea
                  required
                  rows={9}
                  maxLength={250000}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Впишіть або вставте текст оповідання, новели чи есею..."
                  className={`${INPUT_CLASS} leading-relaxed`}
                />
                <p className="mt-1 text-[11px] text-[#787872] dark:text-[#8E8B82]">
                  Відступи, перенесення рядків і слова в стовпчик зберігаються без змін.
                </p>
              </div>

              {/* Moodboard Photos */}
              <div className="p-3.5 rounded-xl bg-[#FAF9F5] dark:bg-[#262626] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                    <ImagePlus className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" />
                    <span>Обкладинка / фото до твору (необов’язково)</span>
                  </span>
                  <span className="font-mono text-[11px] text-[#5C5C58] dark:text-[#A6A196] tabular-nums">
                    {moodboardUrls.length}/{MAX_MOODBOARD_PHOTOS}
                  </span>
                </div>

                {moodboardUrls.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {moodboardUrls.map((url, idx) => (
                      <div
                        key={`${url}-${idx}`}
                        className="relative group rounded-lg overflow-hidden aspect-[4/3] bg-[#EFECE6] dark:bg-[#1B1B1B]"
                      >
                        <img
                          src={url}
                          alt={`Обкладинка ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemovePhoto(idx)}
                          aria-label={`Прибрати фото ${idx + 1}`}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/65 text-white flex items-center justify-center opacity-90 hover:opacity-100 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {moodboardUrls.length < MAX_MOODBOARD_PHOTOS && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                        value={photoUrlDraft}
                        onChange={(e) => setPhotoUrlDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleApplyPhotoUrl();
                          }
                        }}
                        placeholder="Або URL фото (https://...)"
                        className={`${INPUT_SM_CLASS} font-mono flex-1`}
                      />
                      <button
                        type="button"
                        onClick={handleApplyPhotoUrl}
                        disabled={!photoUrlDraft.trim()}
                        className="btn-editorial-secondary py-1.5 px-2.5 text-xs shrink-0"
                      >
                        Ок
                      </button>
                    </div>
                  </div>
                )}
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
                  <span>{submitting ? 'Надсилання...' : 'Надіслати прозу'}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              {loadingSubmissions && mySubmissions.length === 0 ? (
                <div className="py-10 text-center text-xs text-[#5C5C58] dark:text-[#A6A196]">
                  Завантаження ваших заявок...
                </div>
              ) : mySubmissions.length === 0 ? (
                <div className="py-10 text-center space-y-2.5 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl p-6">
                  <p className="text-sm text-[#5C5C58] dark:text-[#A6A196]">
                    Ви ще не пропонували власних прозових творів.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('form')}
                    className="btn-editorial-primary px-5 py-2 text-xs font-semibold"
                  >
                    Написати перший твір
                  </button>
                </div>
              ) : (
                mySubmissions.map((sub) => {
                  const isApproved = sub.status === 'approved';
                  const isRejected = sub.status === 'rejected';
                  const words = sub.totalWords ?? countProseWords(sub.content);
                  return (
                    <div
                      key={sub.id}
                      className="p-4 rounded-xl bg-[#FAF9F5] dark:bg-[#262626] space-y-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-[#141413] dark:text-[#EDEAE1]">
                            {sub.title}
                          </h4>
                          <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                            {sub.authorName}
                            {sub.genre ? ` · ${sub.genre}` : ''}
                            {' · '}
                            {sub.pages} стор. ({words.toLocaleString('uk-UA')} слів)
                            {' · '}
                            {new Date(sub.createdAt).toLocaleDateString('uk-UA')}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          {sub.workStatus && (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                                sub.workStatus === 'completed'
                                  ? 'bg-emerald-50 text-emerald-800 dark:bg-[#323232] dark:text-[#E5E5E5]'
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

                      {sub.slogan && (
                        <p className="italic text-xs text-[#5C5C58] dark:text-[#A6A196]">
                          «{sub.slogan}»
                        </p>
                      )}

                      <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] whitespace-pre-wrap line-clamp-3">
                        {sub.excerpt || sub.content}
                      </p>

                      {sub.moodboardUrls && sub.moodboardUrls.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#2C5937] dark:text-[#E5E5E5]">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-[#202020]">
                            <ImagePlus className="w-3 h-3" />
                            <span>Обкладинка ({sub.moodboardUrls.length})</span>
                          </span>
                        </div>
                      )}

                      {sub.moderationNote && (
                        <div className="px-3 py-2 rounded-lg bg-white dark:bg-[#202020] text-xs">
                          <span className="font-semibold text-[#141413] dark:text-[#EDEAE1]">
                            Коментар редактора:{' '}
                          </span>
                          <span className="text-[#5C5C58] dark:text-[#A6A196]">
                            {sub.moderationNote}
                          </span>
                        </div>
                      )}

                      {isApproved && sub.publishedProseId && onOpenPublishedProse && (
                        <div className="pt-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              onOpenPublishedProse(sub.publishedProseId!);
                              onClose();
                            }}
                            className="text-xs font-semibold text-[#2C5937] dark:text-[#E5E5E5] hover:underline cursor-pointer"
                          >
                            Відкрити опублікований твір →
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
