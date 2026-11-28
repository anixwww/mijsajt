import {
  Check,
  CheckCircle2,
  Clock,
  ImagePlus,
  Music2,
  Palette,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import type {
  Poem,
  PoemImagePalette,
  PoemSoundCloudTrack,
  PoemSubmission,
  PoemSubmissionStatus,
  ProseStatus,
} from '../../types.ts';
import { isValidBlogPhotoUrl } from '../../utils/blogMedia.ts';
import { extractImagePalette } from '../../utils/imagePalette.ts';
import { readImageAsOptimizedDataUrl } from '../../utils/imageUpload.ts';
import { preserveFormattedText } from '../../utils/textFormatting.ts';
import { POEM_THEME_PRESETS } from './StudioWorksTab.tsx';
import {
  STUDIO_INPUT_CLASS,
  STUDIO_INPUT_SM_CLASS,
  STUDIO_LABEL_CLASS,
  type GetAuthHeadersFn,
} from './studioShared.ts';

interface StudioPoemSubmissionsPanelProps {
  submissions: PoemSubmission[];
  setSubmissions: (updater: (prev: PoemSubmission[]) => PoemSubmission[]) => void;
  setPoems: (updater: (prev: Poem[]) => Poem[]) => void;
  getAuthHeaders: GetAuthHeadersFn;
  setFeedback: (msg: string | null) => void;
  onCatalogUpdated: () => void;
  onReloadAuthorData: () => void;
}

type StatusFilter = 'all' | PoemSubmissionStatus;

interface SubmissionDraft {
  title: string;
  authorName: string;
  cycle: string;
  workStatus: ProseStatus;
  content: string;
  note: string;
  moderationNote: string;
  fontSize: 'sm' | 'base' | 'lg' | 'xl' | '2xl';
  textAlign: 'left' | 'center' | 'right';
  lineSpacing: 'tight' | 'normal' | 'relaxed' | 'loose';
  textColor: string;
  backgroundColor: string;
  imageUrl: string;
  imagePalette: PoemImagePalette | null;
  soundcloudTracks: PoemSoundCloudTrack[];
}

function createDraftFromSubmission(sub: PoemSubmission): SubmissionDraft {
  return {
    title: sub.title,
    authorName: sub.authorName,
    cycle: sub.cycle || '',
    workStatus: sub.workStatus === 'in_progress' ? 'in_progress' : 'completed',
    content: sub.content,
    note: sub.note || '',
    moderationNote: sub.moderationNote || '',
    fontSize: sub.fontSize || 'lg',
    textAlign: sub.textAlign || 'left',
    lineSpacing: sub.lineSpacing || 'relaxed',
    textColor: sub.textColor || '',
    backgroundColor: sub.backgroundColor || '',
    imageUrl: sub.imageUrl || '',
    imagePalette: sub.imagePalette || null,
    soundcloudTracks:
      sub.soundcloudTracks && sub.soundcloudTracks.length > 0
        ? sub.soundcloudTracks
        : sub.soundcloudTrack
          ? [sub.soundcloudTrack]
          : [],
  };
}

export function StudioPoemSubmissionsPanel({
  submissions,
  setSubmissions,
  setPoems,
  getAuthHeaders,
  setFeedback,
  onCatalogUpdated,
  onReloadAuthorData,
}: StudioPoemSubmissionsPanelProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    submissions.some((s) => s.status === 'pending') ? 'pending' : 'all'
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SubmissionDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Reject note inline prompt
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNoteDraft, setRejectNoteDraft] = useState('');

  // Media helpers inside edit draft
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUrlDraft, setPhotoUrlDraft] = useState('');
  const [paletteExtracting, setPaletteExtracting] = useState(false);
  const [scUrlDraft, setScUrlDraft] = useState('');
  const [scImporting, setScImporting] = useState(false);

  const pendingCount = submissions.filter((s) => s.status === 'pending').length;
  const approvedCount = submissions.filter((s) => s.status === 'approved').length;
  const rejectedCount = submissions.filter((s) => s.status === 'rejected').length;

  const filteredSubmissions = submissions.filter((s) =>
    statusFilter === 'all' ? true : s.status === statusFilter
  );

  const startEditing = (sub: PoemSubmission) => {
    setRejectingId(null);
    setEditingId(sub.id);
    setDraft(createDraftFromSubmission(sub));
    setPhotoUrlDraft('');
    setScUrlDraft('');
    setFeedback(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setDraft(null);
    setPhotoUrlDraft('');
    setScUrlDraft('');
  };

  const extractDraftPalette = async (imageUrl: string, resetManualOverrides: boolean) => {
    const clean = imageUrl.trim();
    if (!clean) {
      setDraft((prev) => (prev ? { ...prev, imagePalette: null } : prev));
      return;
    }
    setPaletteExtracting(true);
    try {
      const headers = await getAuthHeaders();
      const palette = await extractImagePalette(clean, {
        proxyUrl: `/api/author/image-proxy?url=${encodeURIComponent(clean)}`,
        proxyHeaders: headers || undefined,
      });
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              imagePalette: palette,
              ...(resetManualOverrides && palette
                ? { backgroundColor: '', textColor: '' }
                : {}),
            }
          : prev
      );
    } finally {
      setPaletteExtracting(false);
    }
  };

  const handleUploadDraftPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !draft) return;
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
      const data = await res.json();
      if (!res.ok || typeof data.url !== 'string' || !data.url) {
        setFeedback(data.error || 'Не вдалося завантажити фото.');
        return;
      }
      setDraft((prev) => (prev ? { ...prev, imageUrl: data.url } : prev));
      setPhotoUrlDraft('');
      await extractDraftPalette(data.url, true);
    } catch {
      setFeedback('Помилка під час завантаження фото.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleApplyDraftPhotoUrl = async () => {
    const trimmed = photoUrlDraft.trim();
    if (!trimmed || !draft) return;
    if (!isValidBlogPhotoUrl(trimmed)) {
      setFeedback('Посилання на фото має починатися з https://, http:// або /uploads/...');
      return;
    }
    setDraft((prev) => (prev ? { ...prev, imageUrl: trimmed } : prev));
    setPhotoUrlDraft('');
    await extractDraftPalette(trimmed, true);
  };

  const handleImportDraftSoundCloud = async () => {
    const trimmed = scUrlDraft.trim();
    if (!trimmed || scImporting || !draft) return;
    if (draft.soundcloudTracks.length >= 10) {
      setFeedback('До одного вірша можна додати до 10 пісень.');
      return;
    }
    setScImporting(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch('/api/author/poem/resolve-soundcloud', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: trimmed }),
      });
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
        setFeedback(data.error || 'Не вдалося імпортувати трек SoundCloud.');
        return;
      }
      setDraft((prev) => {
        if (!prev) return prev;
        const existingUrls = new Set(
          prev.soundcloudTracks.map((t) => t.soundcloudUrl.toLowerCase())
        );
        const uniqueNew = incoming.filter((t) => !existingUrls.has(t.soundcloudUrl.toLowerCase()));
        return {
          ...prev,
          soundcloudTracks: [...prev.soundcloudTracks, ...uniqueNew].slice(0, 10),
        };
      });
      setScUrlDraft('');
    } catch {
      setFeedback('Помилка під час імпорту треку з SoundCloud.');
    } finally {
      setScImporting(false);
    }
  };

  const buildPayloadFromDraft = (d: SubmissionDraft) => ({
    title: d.title.trim(),
    authorName: d.authorName.trim(),
    cycle: d.cycle.trim(),
    workStatus: d.workStatus,
    content: preserveFormattedText(d.content),
    note: d.note.trim() || null,
    moderationNote: d.moderationNote.trim() || null,
    fontSize: d.fontSize,
    textAlign: d.textAlign,
    lineSpacing: d.lineSpacing,
    textColor: d.textColor.trim() || null,
    backgroundColor: d.backgroundColor.trim() || null,
    imageUrl: d.imageUrl.trim() || null,
    imagePalette: d.imageUrl.trim() && d.imagePalette ? d.imagePalette : null,
    soundcloudTracks: d.soundcloudTracks,
    soundcloudTrack: d.soundcloudTracks[0] || null,
  });

  const handleSaveEdit = async (id: string) => {
    if (!draft) return;
    if (!draft.title.trim() || !preserveFormattedText(draft.content).trim()) {
      setFeedback('Назва і текст вірша не можуть бути порожніми.');
      return;
    }
    setBusyId(id);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch(`/api/author/poem-submissions/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(buildPayloadFromDraft(draft)),
      });
      const data = (await res.json()) as { error?: string; submission?: PoemSubmission };
      if (!res.ok || !data.submission) {
        setFeedback(data.error || 'Не вдалося зберегти правки.');
        return;
      }
      setSubmissions((prev) => prev.map((s) => (s.id === id ? data.submission! : s)));
      cancelEditing();
      setFeedback('Правки в заявці збережено.');
      onCatalogUpdated();
      onReloadAuthorData();
    } catch {
      setFeedback('Помилка під час збереження правок.');
    } finally {
      setBusyId(null);
    }
  };

  const handleApproveAndPublish = async (sub: PoemSubmission, customDraft?: SubmissionDraft | null) => {
    if (customDraft && (!customDraft.title.trim() || !preserveFormattedText(customDraft.content).trim())) {
      setFeedback('Назва і текст вірша не можуть бути порожніми.');
      return;
    }
    setBusyId(sub.id);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch(
        `/api/author/poem-submissions/${encodeURIComponent(sub.id)}/approve`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(customDraft ? buildPayloadFromDraft(customDraft) : {}),
        }
      );
      const data = (await res.json()) as {
        error?: string;
        submission?: PoemSubmission;
        poem?: Poem;
      };
      if (!res.ok || !data.submission) {
        setFeedback(data.error || 'Не вдалося погодити публікацію.');
        return;
      }
      setSubmissions((prev) => prev.map((s) => (s.id === sub.id ? data.submission! : s)));
      if (data.poem) {
        setPoems((prev) => {
          const exists = prev.some((p) => p.id === data.poem!.id);
          return exists
            ? prev.map((p) => (p.id === data.poem!.id ? data.poem! : p))
            : [data.poem!, ...prev];
        });
      }
      if (editingId === sub.id) cancelEditing();
      setRejectingId(null);
      setFeedback(`Вірш «${data.submission.title}» погоджено та опубліковано у розділі «Стрічка віршів».`);
      onCatalogUpdated();
      onReloadAuthorData();
    } catch {
      setFeedback('Помилка під час погодження заявки.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (sub: PoemSubmission) => {
    setBusyId(sub.id);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch(
        `/api/author/poem-submissions/${encodeURIComponent(sub.id)}/reject`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ moderationNote: rejectNoteDraft.trim() }),
        }
      );
      const data = (await res.json()) as { error?: string; submission?: PoemSubmission };
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

  const handleDelete = async (sub: PoemSubmission) => {
    setBusyId(sub.id);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch(`/api/author/poem-submissions/${encodeURIComponent(sub.id)}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося видалити заявку.');
        return;
      }
      setSubmissions((prev) => prev.filter((s) => s.id !== sub.id));
      if (editingId === sub.id) cancelEditing();
      setFeedback('Заявку видалено.');
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
                  ? 'bg-paper-sand dark:bg-night-elevated text-ink dark:text-cream-soft font-semibold'
                  : 'text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft'
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
        <div className="py-12 text-center space-y-2 bg-paper dark:bg-night-card rounded-xl px-4">
          <p className="text-sm font-medium text-ink dark:text-cream-soft">
            {statusFilter === 'pending'
              ? 'Нових заявок на розгляді немає'
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

            return (
              <div
                key={sub.id}
                className="p-4 rounded-xl bg-paper dark:bg-night-card space-y-3 text-xs"
              >
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {sub.authorPhotoUrl && (
                      <img
                        src={sub.authorPhotoUrl}
                        alt={sub.authorName}
                        width={28}
                        height={28}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="w-7 h-7 rounded-full object-cover shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-ink dark:text-cream-soft">
                          {sub.title}
                        </span>
                        {sub.cycle && (
                          <span className="text-[11px] text-ink-muted dark:text-sandstone">
                            · {sub.cycle}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-muted dark:text-sandstone">
                        Автор: <strong className="font-medium text-ink dark:text-cream-soft">{sub.authorName}</strong>
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
                          : 'bg-paper-warm text-ink-muted dark:bg-night-panel dark:text-sandstone'
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
                  <div className="p-3.5 rounded-xl bg-white dark:bg-night-panel space-y-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-ink dark:text-cream-soft">
                        Редагування заявки перед публікацією
                      </span>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="text-[11px] font-medium text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft cursor-pointer"
                      >
                        Скасувати
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className={STUDIO_LABEL_CLASS}>Назва вірша *</label>
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
                        <label className={STUDIO_LABEL_CLASS}>Цикл</label>
                        <input
                          type="text"
                          value={draft.cycle}
                          onChange={(e) => setDraft({ ...draft, cycle: e.target.value })}
                          placeholder="Стрічка віршів"
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
                                : 'bg-paper dark:bg-night-card text-ink-muted dark:text-sandstone'
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
                      <label className={STUDIO_LABEL_CLASS}>
                        Текст вірша * (пробіли, стовпчики й переноси рядків зберігаються)
                      </label>
                      <textarea
                        rows={7}
                        value={draft.content}
                        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                        className={`${STUDIO_INPUT_CLASS} leading-relaxed text-xs whitespace-pre`}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className={STUDIO_LABEL_CLASS}>Примітка під віршем</label>
                        <input
                          type="text"
                          value={draft.note}
                          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
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

                    {/* Typesetting & Theme */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className={STUDIO_LABEL_CLASS}>Кегль</label>
                        <select
                          value={draft.fontSize}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              fontSize: e.target.value as SubmissionDraft['fontSize'],
                            })
                          }
                          className={STUDIO_INPUT_SM_CLASS}
                        >
                          <option value="sm">Маленький</option>
                          <option value="base">Стандартний</option>
                          <option value="lg">Великий</option>
                          <option value="xl">Дуже великий</option>
                          <option value="2xl">Максимальний</option>
                        </select>
                      </div>
                      <div>
                        <label className={STUDIO_LABEL_CLASS}>Вирівнювання</label>
                        <select
                          value={draft.textAlign}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              textAlign: e.target.value as SubmissionDraft['textAlign'],
                            })
                          }
                          className={STUDIO_INPUT_SM_CLASS}
                        >
                          <option value="left">Зліва</option>
                          <option value="center">По центру</option>
                          <option value="right">Справа</option>
                        </select>
                      </div>
                      <div>
                        <label className={STUDIO_LABEL_CLASS}>Міжряддя</label>
                        <select
                          value={draft.lineSpacing}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              lineSpacing: e.target.value as SubmissionDraft['lineSpacing'],
                            })
                          }
                          className={STUDIO_INPUT_SM_CLASS}
                        >
                          <option value="tight">Щільний</option>
                          <option value="normal">Нормальний</option>
                          <option value="relaxed">Збільшений</option>
                          <option value="loose">Вільний</option>
                        </select>
                      </div>
                    </div>

                    {/* Theme Presets */}
                    <div className="space-y-1.5">
                      <label className={STUDIO_LABEL_CLASS}>
                        <span className="inline-flex items-center gap-1">
                          <Palette className="w-3 h-3" />
                          <span>Палітра картки</span>
                        </span>
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {draft.imageUrl && draft.imagePalette && (
                          <button
                            type="button"
                            onClick={() =>
                              setDraft({ ...draft, backgroundColor: '', textColor: '' })
                            }
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium cursor-pointer ${
                              !draft.backgroundColor && !draft.textColor
                                ? 'bg-paper-sand dark:bg-night-elevated text-ink dark:text-cream-soft'
                                : 'bg-paper dark:bg-night-card text-ink-muted dark:text-sandstone'
                            }`}
                          >
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: draft.imagePalette.background }}
                            />
                            <span>З палітри фото</span>
                          </button>
                        )}
                        {POEM_THEME_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                backgroundColor: preset.bg,
                                textColor: preset.text,
                              })
                            }
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium cursor-pointer ${
                              draft.backgroundColor === preset.bg &&
                              draft.textColor === preset.text &&
                              !(preset.id === 'default' && draft.imageUrl && draft.imagePalette)
                                ? 'bg-paper-sand dark:bg-night-elevated text-ink dark:text-cream-soft'
                                : 'bg-paper dark:bg-night-card text-ink-muted dark:text-sandstone'
                            }`}
                          >
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: preset.bg || '#F5F4EE' }}
                            />
                            <span>{preset.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Photo & SoundCloud Editing */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl bg-paper dark:bg-night-card space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-ink dark:text-cream-soft">
                            <ImagePlus className="w-3.5 h-3.5 text-pine dark:text-silver" />
                            <span>Фото до вірша</span>
                          </span>
                          {draft.imageUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setDraft({ ...draft, imageUrl: '', imagePalette: null })
                              }
                              className="text-[11px] text-rose-700 dark:text-rose-400 hover:underline cursor-pointer"
                            >
                              Прибрати
                            </button>
                          )}
                        </div>
                        {draft.imageUrl ? (
                          <div className="space-y-1.5">
                            <img
                              src={draft.imageUrl}
                              alt={draft.title}
                              width={400}
                              height={112}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-28 object-cover rounded-lg"
                            />
                            <button
                              type="button"
                              disabled={paletteExtracting}
                              onClick={() => void extractDraftPalette(draft.imageUrl, true)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-pine dark:text-silver hover:underline cursor-pointer"
                            >
                              <RefreshCw
                                className={`w-3 h-3 ${paletteExtracting ? 'animate-spin' : ''}`}
                              />
                              <span>Перерахувати палітру фото</span>
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <label className="btn-editorial-secondary w-full justify-center py-1 text-[11px] cursor-pointer">
                              <Upload className="w-3 h-3" />
                              <span>{photoUploading ? 'Завантаження...' : 'Завантажити фото'}</span>
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
                                onClick={() => void handleApplyDraftPhotoUrl()}
                                className="btn-editorial-secondary py-1 px-2 text-[11px]"
                              >
                                Ок
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="p-3 rounded-xl bg-paper dark:bg-night-card space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-ink dark:text-cream-soft">
                            <Music2 className="w-3.5 h-3.5 text-pine dark:text-silver" />
                            <span>SoundCloud ({draft.soundcloudTracks.length}/10)</span>
                          </span>
                          {draft.soundcloudTracks.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setDraft({ ...draft, soundcloudTracks: [] })}
                              className="text-[11px] text-rose-700 dark:text-rose-400 hover:underline cursor-pointer"
                            >
                              {draft.soundcloudTracks.length > 1 ? 'Очистити все' : 'Прибрати'}
                            </button>
                          )}
                        </div>
                        {draft.soundcloudTracks.length > 0 && (
                          <div className="space-y-1">
                            {draft.soundcloudTracks.map((t, idx) => (
                              <div
                                key={`${t.id}-${idx}`}
                                className="p-2 rounded-lg bg-white dark:bg-night-panel flex items-center gap-2"
                              >
                                <span className="font-mono text-[10px] text-ink-subtle w-3.5 text-center shrink-0">
                                  {idx + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold truncate">{t.title}</p>
                                  <p className="text-[11px] text-ink-muted dark:text-sandstone truncate">
                                    {t.artist}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      soundcloudTracks: draft.soundcloudTracks.filter((_, i) => i !== idx),
                                    })
                                  }
                                  aria-label={`Видалити «${t.title}»`}
                                  className="p-1 text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 rounded cursor-pointer shrink-0"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {draft.soundcloudTracks.length < 10 && (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={scUrlDraft}
                              onChange={(e) => setScUrlDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void handleImportDraftSoundCloud();
                                }
                              }}
                              placeholder="https://soundcloud.com/..."
                              className={`${STUDIO_INPUT_SM_CLASS} font-mono flex-1`}
                            />
                            <button
                              type="button"
                              disabled={scImporting || !scUrlDraft.trim()}
                              onClick={() => void handleImportDraftSoundCloud()}
                              className="btn-editorial-secondary py-1 px-2 text-[11px]"
                            >
                              {scImporting ? '...' : 'Додати'}
                            </button>
                          </div>
                        )}
                      </div>
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
                    <div className="space-y-2">
                      <p className="text-xs text-ink/90 dark:text-cream-soft/90 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                        {sub.content}
                      </p>
                      {sub.note && (
                        <p className="italic text-[11px] text-ink-muted dark:text-sandstone">
                          Примітка: {sub.note}
                        </p>
                      )}
                    </div>

                    {(sub.imageUrl || (sub.soundcloudTracks && sub.soundcloudTracks.length > 0) || sub.soundcloudTrack) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {sub.imageUrl && (
                          <img
                            src={sub.imageUrl}
                            alt={sub.title}
                            width={80}
                            height={56}
                            loading="lazy"
                            decoding="async"
                            className="w-20 h-14 rounded-lg object-cover bg-paper-warm dark:bg-night-deep"
                          />
                        )}
                        {(sub.soundcloudTracks && sub.soundcloudTracks.length > 0
                          ? sub.soundcloudTracks
                          : sub.soundcloudTrack
                            ? [sub.soundcloudTrack]
                            : []
                        ).map((t, idx) => (
                          <div
                            key={`${t.id}-${idx}`}
                            className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-night-panel flex items-center gap-2 max-w-xs"
                          >
                            <Music2 className="w-3.5 h-3.5 text-pine dark:text-silver shrink-0" />
                            <span className="truncate text-[11px]">
                              {t.artist} — {t.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {sub.moderationNote && (
                      <div className="px-3 py-2 rounded-lg bg-white dark:bg-night-panel text-[11px]">
                        <span className="font-semibold">Коментар модератора: </span>
                        <span className="text-ink-muted dark:text-sandstone">
                          {sub.moderationNote}
                        </span>
                      </div>
                    )}

                    {isRejecting && (
                      <div className="p-3 rounded-xl bg-white dark:bg-night-panel space-y-2">
                        <label className={STUDIO_LABEL_CLASS}>
                          Причина відхилення (необов’язково, побачить автор вірша)
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
                            className="p-1.5 text-ink-muted hover:text-ink dark:hover:text-cream-soft cursor-pointer"
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
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-paper-warm dark:bg-night-panel hover:bg-rose-50 dark:hover:bg-rose-950/40 text-ink-muted dark:text-sandstone hover:text-rose-700 dark:hover:text-rose-300 text-xs font-medium cursor-pointer transition-colors"
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
                        className="p-1.5 text-ink-muted dark:text-sandstone hover:text-rose-700 dark:hover:text-rose-400 rounded-lg hover:bg-rose-700/10 cursor-pointer"
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
