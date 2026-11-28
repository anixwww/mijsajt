import {
  Check,
  CheckCircle2,
  Clock,
  ImagePlus,
  Pencil,
  Save,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import type {
  ProseStatus,
  ProseSubmission,
  ProseSubmissionStatus,
  ProseWork,
} from '../../types.ts';
import { isValidBlogPhotoUrl } from '../../utils/blogMedia.ts';
import { readImageAsOptimizedDataUrl } from '../../utils/imageUpload.ts';
import { countPagesForText, countProseWords } from '../../utils/prosePagination.ts';
import { preserveFormattedText } from '../../utils/textFormatting.ts';
import {
  STUDIO_INPUT_CLASS,
  STUDIO_INPUT_SM_CLASS,
  STUDIO_LABEL_CLASS,
  type GetAuthHeadersFn,
} from './studioShared.ts';

interface StudioProseSubmissionsPanelProps {
  submissions: ProseSubmission[];
  setSubmissions: (updater: (prev: ProseSubmission[]) => ProseSubmission[]) => void;
  setProse: (updater: (prev: ProseWork[]) => ProseWork[]) => void;
  getAuthHeaders: GetAuthHeadersFn;
  setFeedback: (msg: string | null) => void;
  onCatalogUpdated: () => void;
  onReloadAuthorData: () => void;
}

type StatusFilter = 'all' | ProseSubmissionStatus;

interface ProseSubmissionDraft {
  title: string;
  authorName: string;
  genre: string;
  workStatus: ProseStatus;
  slogan: string;
  excerpt: string;
  content: string;
  moderationNote: string;
  moodboardUrls: string[];
}

function createDraftFromSubmission(sub: ProseSubmission): ProseSubmissionDraft {
  return {
    title: sub.title,
    authorName: sub.authorName,
    genre: sub.genre || 'Оповідання',
    workStatus: sub.workStatus === 'in_progress' ? 'in_progress' : 'completed',
    slogan: sub.slogan || '',
    excerpt: sub.excerpt || '',
    content: sub.content,
    moderationNote: sub.moderationNote || '',
    moodboardUrls: Array.isArray(sub.moodboardUrls) ? [...sub.moodboardUrls] : [],
  };
}

export function StudioProseSubmissionsPanel({
  submissions,
  setSubmissions,
  setProse,
  getAuthHeaders,
  setFeedback,
  onCatalogUpdated,
  onReloadAuthorData,
}: StudioProseSubmissionsPanelProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    submissions.some((s) => s.status === 'pending') ? 'pending' : 'all'
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProseSubmissionDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Reject note inline prompt
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNoteDraft, setRejectNoteDraft] = useState('');

  // Media helpers inside edit draft
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUrlDraft, setPhotoUrlDraft] = useState('');

  const pendingCount = submissions.filter((s) => s.status === 'pending').length;
  const approvedCount = submissions.filter((s) => s.status === 'approved').length;
  const rejectedCount = submissions.filter((s) => s.status === 'rejected').length;

  const filteredSubmissions = submissions.filter((s) =>
    statusFilter === 'all' ? true : s.status === statusFilter
  );

  const startEditing = (sub: ProseSubmission) => {
    setRejectingId(null);
    setEditingId(sub.id);
    setDraft(createDraftFromSubmission(sub));
    setPhotoUrlDraft('');
    setFeedback(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setDraft(null);
    setPhotoUrlDraft('');
  };

  const handleUploadDraftPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !draft) return;
    if (draft.moodboardUrls.length >= 8) {
      setFeedback('Можна додати щонайбільше 8 фото до муд-борду.');
      return;
    }
    setPhotoUploading(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const dataUrl = await readImageAsOptimizedDataUrl(file);
      const res = await fetch('/api/author/upload-cover', {
        method: 'POST',
        headers,
        body: JSON.stringify({ dataUrl }),
      });
      const data = (await res.json()) as { error?: string; url?: string };
      if (!res.ok || typeof data.url !== 'string' || !data.url) {
        setFeedback(data.error || 'Не вдалося завантажити фото.');
        return;
      }
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              moodboardUrls: prev.moodboardUrls.includes(data.url!)
                ? prev.moodboardUrls
                : [...prev.moodboardUrls, data.url!].slice(0, 8),
            }
          : prev
      );
      setPhotoUrlDraft('');
    } catch {
      setFeedback('Помилка під час завантаження фото.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleApplyDraftPhotoUrl = () => {
    const trimmed = photoUrlDraft.trim();
    if (!trimmed || !draft) return;
    if (draft.moodboardUrls.length >= 8) {
      setFeedback('Можна додати щонайбільше 8 фото до муд-борду.');
      return;
    }
    if (!isValidBlogPhotoUrl(trimmed)) {
      setFeedback('Посилання на фото має починатися з https://, http:// або /uploads/...');
      return;
    }
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            moodboardUrls: prev.moodboardUrls.includes(trimmed)
              ? prev.moodboardUrls
              : [...prev.moodboardUrls, trimmed].slice(0, 8),
          }
        : prev
    );
    setPhotoUrlDraft('');
  };

  const buildPayloadFromDraft = (d: ProseSubmissionDraft) => ({
    title: d.title.trim(),
    authorName: d.authorName.trim(),
    genre: d.genre.trim() || 'Оповідання',
    workStatus: d.workStatus,
    slogan: d.slogan.trim() || null,
    excerpt: d.excerpt.trim() || null,
    content: preserveFormattedText(d.content),
    moderationNote: d.moderationNote.trim() || null,
    moodboardUrls: d.moodboardUrls.length > 0 ? d.moodboardUrls : null,
  });

  const handleSaveEdit = async (id: string) => {
    if (!draft) return;
    if (!draft.title.trim() || !preserveFormattedText(draft.content).trim()) {
      setFeedback('Назва і текст прози не можуть бути порожніми.');
      return;
    }
    setBusyId(id);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch(`/api/author/prose-submissions/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(buildPayloadFromDraft(draft)),
      });
      const data = (await res.json()) as { error?: string; submission?: ProseSubmission };
      if (!res.ok || !data.submission) {
        setFeedback(data.error || 'Не вдалося зберегти правки.');
        return;
      }
      setSubmissions((prev) => prev.map((s) => (s.id === id ? data.submission! : s)));
      cancelEditing();
      setFeedback('Правки в заявці прози збережено.');
      onCatalogUpdated();
      onReloadAuthorData();
    } catch {
      setFeedback('Помилка під час збереження правок.');
    } finally {
      setBusyId(null);
    }
  };

  const handleApproveAndPublish = async (
    sub: ProseSubmission,
    customDraft?: ProseSubmissionDraft | null
  ) => {
    if (customDraft && (!customDraft.title.trim() || !preserveFormattedText(customDraft.content).trim())) {
      setFeedback('Назва і текст прози не можуть бути порожніми.');
      return;
    }
    setBusyId(sub.id);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch(
        `/api/author/prose-submissions/${encodeURIComponent(sub.id)}/approve`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(customDraft ? buildPayloadFromDraft(customDraft) : {}),
        }
      );
      const data = (await res.json()) as {
        error?: string;
        submission?: ProseSubmission;
        prose?: ProseWork;
      };
      if (!res.ok || !data.submission) {
        setFeedback(data.error || 'Не вдалося погодити публікацію.');
        return;
      }
      setSubmissions((prev) => prev.map((s) => (s.id === sub.id ? data.submission! : s)));
      if (data.prose) {
        setProse((prev) => {
          const exists = prev.some((p) => p.id === data.prose!.id);
          return exists
            ? prev.map((p) => (p.id === data.prose!.id ? data.prose! : p))
            : [data.prose!, ...prev];
        });
      }
      if (editingId === sub.id) cancelEditing();
      setRejectingId(null);
      setFeedback(`Твір «${data.submission.title}» погоджено та опубліковано у вкладці «Стрічка» прози.`);
      onCatalogUpdated();
      onReloadAuthorData();
    } catch {
      setFeedback('Помилка під час погодження заявки.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (sub: ProseSubmission) => {
    setBusyId(sub.id);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch(
        `/api/author/prose-submissions/${encodeURIComponent(sub.id)}/reject`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ moderationNote: rejectNoteDraft.trim() }),
        }
      );
      const data = (await res.json()) as { error?: string; submission?: ProseSubmission };
      if (!res.ok || !data.submission) {
        setFeedback(data.error || 'Не вдалося відхилити заявку.');
        return;
      }
      setSubmissions((prev) => prev.map((s) => (s.id === sub.id ? data.submission! : s)));
      setRejectingId(null);
      setRejectNoteDraft('');
      if (editingId === sub.id) cancelEditing();
      setFeedback(`Заявку «${sub.title}» відхилено.`);
      onReloadAuthorData();
    } catch {
      setFeedback('Помилка під час відхилення заявки.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (sub: ProseSubmission) => {
    setBusyId(sub.id);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch(`/api/author/prose-submissions/${encodeURIComponent(sub.id)}`, {
        method: 'DELETE',
        headers,
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося видалити заявку.');
        return;
      }
      setSubmissions((prev) => prev.filter((s) => s.id !== sub.id));
      if (editingId === sub.id) cancelEditing();
      setFeedback('Заявку прози видалено.');
    } catch {
      setFeedback('Помилка під час видалення заявки.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status Filter Pills */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {(
            [
              { id: 'pending', label: 'На розгляді', count: pendingCount },
              { id: 'approved', label: 'Опубліковані', count: approvedCount },
              { id: 'rejected', label: 'Відхилені', count: rejectedCount },
              { id: 'all', label: 'Усі', count: submissions.length },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                statusFilter === f.id
                  ? 'bg-[#EAE7DF] dark:bg-[#323232] text-[#141413] dark:text-[#EDEAE1] font-semibold'
                  : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
              }`}
            >
              {f.label}{' '}
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  f.id === 'pending' && f.count > 0
                    ? 'ml-1 px-1.5 py-0.5 rounded-full bg-red-600 text-white font-semibold'
                    : 'opacity-70'
                }`}
              >
                {f.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {filteredSubmissions.length === 0 ? (
        <div className="py-12 text-center space-y-2 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl px-4">
          <p className="text-sm font-medium text-[#141413] dark:text-[#EDEAE1]">
            {statusFilter === 'pending'
              ? 'Нових заявок прози на розгляді немає'
              : 'Заявок у цій категорії поки немає'}
          </p>
          {statusFilter !== 'all' && submissions.length > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className="btn-editorial-secondary mt-2 text-xs"
            >
              Показати всі ({submissions.length})
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSubmissions.map((sub) => {
            const isEditing = editingId === sub.id && draft !== null;
            const isRejecting = rejectingId === sub.id;
            const isBusy = busyId === sub.id;
            const words = sub.totalWords ?? countProseWords(sub.content);

            return (
              <div
                key={sub.id}
                className="p-4 rounded-xl bg-[#FAF9F5] dark:bg-[#262626] space-y-3 text-xs"
              >
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {sub.authorPhotoUrl && (
                      <img
                        src={sub.authorPhotoUrl}
                        alt={sub.authorName}
                        referrerPolicy="no-referrer"
                        className="w-7 h-7 rounded-full object-cover shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-[#141413] dark:text-[#EDEAE1]">
                          {sub.title}
                        </span>
                        {sub.genre && (
                          <span className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                            · {sub.genre}
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-[#5C5C58] dark:text-[#A6A196] tabular-nums">
                          · {sub.pages} стор. ({words.toLocaleString('uk-UA')} слів)
                        </span>
                      </div>
                      <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                        Автор:{' '}
                        <strong className="font-medium text-[#141413] dark:text-[#EDEAE1]">
                          {sub.authorName}
                        </strong>
                        {' · '}
                        {new Date(sub.createdAt).toLocaleString('uk-UA', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium ${
                        sub.workStatus === 'in_progress'
                          ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                          : 'bg-[#EFECE6] text-[#5C5C58] dark:bg-[#202020] dark:text-[#A6A196]'
                      }`}
                    >
                      {sub.workStatus === 'in_progress' ? 'У процесі' : 'Закінчено'}
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                        sub.status === 'approved'
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : sub.status === 'rejected'
                            ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                            : 'bg-red-600 text-white'
                      }`}
                    >
                      {sub.status === 'approved' ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Опубліковано</span>
                        </>
                      ) : sub.status === 'rejected' ? (
                        <>
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Відхилено</span>
                        </>
                      ) : (
                        <>
                          <Clock className="w-3.5 h-3.5" />
                          <span>Нова заявка</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Inline Editor OR Preview */}
                {isEditing && draft ? (
                  <div className="p-3.5 rounded-xl bg-white dark:bg-[#202020] space-y-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                        Редагування прози перед публікацією
                      </span>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="text-[11px] font-medium text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] cursor-pointer"
                      >
                        Скасувати
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className={STUDIO_LABEL_CLASS}>Назва твору *</label>
                        <input
                          type="text"
                          value={draft.title}
                          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                          className={STUDIO_INPUT_SM_CLASS}
                        />
                      </div>
                      <div>
                        <label className={STUDIO_LABEL_CLASS}>Ім’я автора</label>
                        <input
                          type="text"
                          value={draft.authorName}
                          onChange={(e) => setDraft({ ...draft, authorName: e.target.value })}
                          className={STUDIO_INPUT_SM_CLASS}
                        />
                      </div>
                      <div>
                        <label className={STUDIO_LABEL_CLASS}>Жанр</label>
                        <input
                          type="text"
                          value={draft.genre}
                          onChange={(e) => setDraft({ ...draft, genre: e.target.value })}
                          placeholder="Оповідання"
                          className={STUDIO_INPUT_SM_CLASS}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className={STUDIO_LABEL_CLASS}>Слоган / епіграф</label>
                        <input
                          type="text"
                          value={draft.slogan}
                          onChange={(e) => setDraft({ ...draft, slogan: e.target.value })}
                          className={STUDIO_INPUT_SM_CLASS}
                        />
                      </div>
                      <div>
                        <label className={STUDIO_LABEL_CLASS}>Коментар модератора автору</label>
                        <input
                          type="text"
                          value={draft.moderationNote}
                          onChange={(e) => setDraft({ ...draft, moderationNote: e.target.value })}
                          placeholder="Напр.: Дякуємо, підправили пунктуацію"
                          className={STUDIO_INPUT_SM_CLASS}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className={STUDIO_LABEL_CLASS}>Готовність твору</label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(
                          [
                            { id: 'completed', label: 'Закінчено' },
                            { id: 'in_progress', label: 'У процесі' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setDraft({ ...draft, workStatus: opt.id })}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                              draft.workStatus === opt.id
                                ? 'bg-pear-pine-gradient text-white'
                                : 'bg-[#FAF9F5] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A6A196]'
                            }`}
                          >
                            {opt.id === 'completed' ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <Clock className="w-3 h-3" />
                            )}
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className={STUDIO_LABEL_CLASS}>Короткий опис (для картки)</label>
                      <textarea
                        rows={2}
                        value={draft.excerpt}
                        onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })}
                        placeholder="Залиште порожнім, щоб згенерувати з першого абзацу"
                        className={`${STUDIO_INPUT_CLASS} leading-relaxed text-xs`}
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="text-xs font-medium text-[#5C5C58] dark:text-[#A6A196]">
                          Текст твору * (пробіли, стовпчики й переноси рядків зберігаються)
                        </label>
                        <span className="font-mono text-[11px] text-[#5C5C58] dark:text-[#A6A196] tabular-nums">
                          {countProseWords(draft.content).toLocaleString('uk-UA')} слів ·{' '}
                          {countPagesForText(draft.content)} стор.
                        </span>
                      </div>
                      <textarea
                        rows={10}
                        value={draft.content}
                        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                        className={`${STUDIO_INPUT_CLASS} leading-relaxed text-xs whitespace-pre`}
                      />
                    </div>

                    {/* Moodboard Editing */}
                    <div className="p-3 rounded-xl bg-[#FAF9F5] dark:bg-[#262626] space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[#141413] dark:text-[#EDEAE1]">
                          <ImagePlus className="w-3.5 h-3.5 text-[#2C5937] dark:text-[#E5E5E5]" />
                          <span>Фото / муд-борд ({draft.moodboardUrls.length}/8)</span>
                        </span>
                      </div>

                      {draft.moodboardUrls.length > 0 && (
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                          {draft.moodboardUrls.map((url, idx) => (
                            <div
                              key={`${url}-${idx}`}
                              className="relative rounded-lg overflow-hidden aspect-[4/3] bg-[#EFECE6] dark:bg-[#1B1B1B]"
                            >
                              <img
                                src={url}
                                alt={`Муд-борд ${idx + 1}`}
                                className="w-full h-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft({
                                    ...draft,
                                    moodboardUrls: draft.moodboardUrls.filter((_, i) => i !== idx),
                                  })
                                }
                                aria-label="Прибрати фото"
                                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/65 text-white flex items-center justify-center cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {draft.moodboardUrls.length < 8 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="btn-editorial-secondary w-full justify-center py-1 text-[11px] cursor-pointer">
                            <Upload className="w-3 h-3" />
                            <span>
                              {photoUploading ? 'Завантаження...' : 'Завантажити фото'}
                            </span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              onChange={handleUploadDraftPhoto}
                              disabled={photoUploading}
                              className="sr-only"
                            />
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={photoUrlDraft}
                              onChange={(e) => setPhotoUrlDraft(e.target.value)}
                              placeholder="Або URL фото"
                              className={`${STUDIO_INPUT_SM_CLASS} font-mono flex-1`}
                            />
                            <button
                              type="button"
                              onClick={handleApplyDraftPhotoUrl}
                              className="btn-editorial-secondary py-1 px-2 text-[11px]"
                            >
                              Ок
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleSaveEdit(sub.id)}
                        className="btn-editorial-secondary py-1.5 px-3.5 text-xs"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Зберегти правки</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleApproveAndPublish(sub, draft)}
                        className="btn-editorial-primary py-1.5 px-4 text-xs font-semibold"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>
                          {sub.status === 'approved'
                            ? 'Зберегти й оновити на сайті'
                            : 'Погодити й опублікувати'}
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      {sub.slogan && (
                        <p className="italic text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                          «{sub.slogan}»
                        </p>
                      )}
                      {sub.excerpt && (
                        <p className="text-[11px] font-medium text-[#5C5C58] dark:text-[#A6A196]">
                          Опис: {sub.excerpt}
                        </p>
                      )}
                      <p className="text-xs text-[#141413]/90 dark:text-[#EDEAE1]/90 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                        {sub.content}
                      </p>
                    </div>

                    {sub.moodboardUrls && sub.moodboardUrls.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        {sub.moodboardUrls.map((url, idx) => (
                          <img
                            key={`${url}-${idx}`}
                            src={url}
                            alt={`${sub.title} фото ${idx + 1}`}
                            className="w-20 h-14 rounded-lg object-cover bg-[#EFECE6] dark:bg-[#1B1B1B]"
                          />
                        ))}
                      </div>
                    )}

                    {sub.moderationNote && (
                      <div className="px-3 py-2 rounded-lg bg-white dark:bg-[#202020] text-[11px]">
                        <span className="font-semibold">Коментар модератора: </span>
                        <span className="text-[#5C5C58] dark:text-[#A6A196]">
                          {sub.moderationNote}
                        </span>
                      </div>
                    )}

                    {isRejecting && (
                      <div className="p-3 rounded-xl bg-white dark:bg-[#202020] space-y-2">
                        <label className={STUDIO_LABEL_CLASS}>
                          Причина відхилення (необов’язково, побачить автор твору)
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            maxLength={1000}
                            value={rejectNoteDraft}
                            onChange={(e) => setRejectNoteDraft(e.target.value)}
                            placeholder="Короткий коментар..."
                            className={`${STUDIO_INPUT_SM_CLASS} flex-1 min-w-[200px]`}
                          />
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleReject(sub)}
                            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                          >
                            Підтвердити відхилення
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingId(null);
                              setRejectNoteDraft('');
                            }}
                            className="p-1.5 text-[#5C5C58] hover:text-[#141413] dark:hover:text-[#EDEAE1] cursor-pointer"
                            aria-label="Скасувати"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => startEditing(sub)}
                          className="btn-editorial-secondary py-1.5 px-3 text-xs"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Редагувати</span>
                        </button>

                        {sub.status !== 'approved' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleApproveAndPublish(sub)}
                            className="btn-editorial-primary py-1.5 px-3.5 text-xs font-semibold"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Погодити й опублікувати</span>
                          </button>
                        )}

                        {sub.status !== 'rejected' && !isRejecting && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setRejectingId(sub.id);
                              setRejectNoteDraft(sub.moderationNote || '');
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#EFECE6] dark:bg-[#202020] hover:bg-rose-50 dark:hover:bg-rose-950/40 text-[#5C5C58] dark:text-[#A6A196] hover:text-rose-700 dark:hover:text-rose-300 text-xs font-medium cursor-pointer transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Відхилити</span>
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDelete(sub)}
                        aria-label={`Видалити заявку ${sub.title}`}
                        title="Видалити заявку"
                        className="p-1.5 text-[#5C5C58] dark:text-[#A6A196] hover:text-rose-700 dark:hover:text-rose-400 rounded-lg hover:bg-rose-700/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
