import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImagePlus,
  Loader2,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { m } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus.ts';
import type {
  WeeklyMusicSelection,
  WeeklyMusicTrack,
  WeeklyPeriodInfo,
} from '../types.ts';
import { readImageAsOptimizedDataUrl } from '../utils/imageUpload.ts';
import {
  formatDurationMs,
  getSoundCloudPlayerSrc,
  loadSoundCloudWidgetApi,
  type SCPlayProgressPayload,
  type SCWidgetInstance,
} from '../utils/soundcloudWidget.ts';
import { preserveFormattedText } from '../utils/textFormatting.ts';
import {
  deleteWeeklyMusicSelectionFromFirestore,
  saveWeeklyMusicSelectionToFirestore,
} from '../utils/weeklyMusicFirestore.ts';

interface WeeklyMusicBoxProps {
  selections: WeeklyMusicSelection[];
  currentPeriod?: WeeklyPeriodInfo;
  isAdmin: boolean;
  getAdminToken: () => Promise<string | null>;
  onSelectionsUpdated: (nextSelections: WeeklyMusicSelection[]) => void;
  onBeforePlay?: () => void;
  pauseSignal?: number;
}

function getSafeExternalSoundCloudUrl(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'soundcloud.com' ||
      host.endsWith('.soundcloud.com') ||
      host === 'snd.sc'
    ) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function WeeklyTrackThumb({
  artworkUrl,
  title,
}: {
  artworkUrl?: string;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  const safeArt = useMemo(() => {
    if (!artworkUrl) return null;
    try {
      const parsed = new URL(artworkUrl);
      return parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch {
      return null;
    }
  }, [artworkUrl]);

  if (safeArt && !failed) {
    return (
      <img
        src={safeArt}
        alt={title}
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-10 h-10 rounded-lg object-cover shrink-0 bg-[#262626]"
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center bg-[#E4DFD4] dark:bg-[#323232] text-[#5C5C58] dark:text-[#C4BFB4]"
    >
      <Music2 className="w-4 h-4" strokeWidth={1.65} />
    </div>
  );
}

export function WeeklyMusicBox({
  selections,
  currentPeriod,
  isAdmin,
  getAdminToken,
  onSelectionsUpdated,
  onBeforePlay,
  pauseSignal = 0,
}: WeeklyMusicBoxProps) {
  const isOnline = useOnlineStatus();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Composer / editor state (title-less, cozy)
  const [editingMode, setEditingMode] = useState<'none' | 'create' | 'edit'>('none');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftWeekKey, setDraftWeekKey] = useState(currentPeriod?.weekKey || '');
  const [draftText, setDraftText] = useState('');
  const [draftPhotos, setDraftPhotos] = useState<string[]>([]);
  const [draftTracks, setDraftTracks] = useState<WeeklyMusicTrack[]>([]);
  const [scInput, setScInput] = useState('');
  const [photoUrlInput, setPhotoUrlInput] = useState('');
  const [resolvingSc, setResolvingSc] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editorMessage, setEditorMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Inline SoundCloud player state
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);
  const [iframeMounted, setIframeMounted] = useState(false);
  const [isLoadingTrack, setIsLoadingTrack] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const widgetRef = useRef<SCWidgetInstance | null>(null);
  const widgetReadyRef = useRef(false);
  const pendingPlayRef = useRef(false);
  const activeTrackIndexRef = useRef(0);
  const totalTracksRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const safeSelIndex =
    selections.length > 0 ? Math.min(selectedIndex, selections.length - 1) : 0;
  const activeSelection = selections[safeSelIndex] ?? null;

  const tracks = activeSelection?.tracks ?? [];
  const photos = activeSelection?.photos ?? [];

  const safeTrackIndex =
    tracks.length > 0 ? Math.min(activeTrackIndex, tracks.length - 1) : 0;
  const activeTrack = tracks[safeTrackIndex] ?? null;

  activeTrackIndexRef.current = safeTrackIndex;
  totalTracksRef.current = tracks.length;

  const selectionSignature = useMemo(
    () =>
      activeSelection
        ? `${activeSelection.id}:${activeSelection.tracks.map((t) => t.id).join(',')}`
        : 'none',
    [activeSelection]
  );

  useEffect(() => {
    pendingPlayRef.current = false;
    setActiveTrackIndex(0);
    setIframeMounted(false);
    setIsLoadingTrack(false);
    setIsPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
    setPlayerError(null);
    setLightboxIndex(null);
  }, [selectionSignature]);

  const playerSrc = useMemo(
    () =>
      activeTrack
        ? getSoundCloudPlayerSrc(activeTrack.embedTargetUrl || activeTrack.soundcloudUrl, false)
        : '',
    [activeTrack]
  );

  useEffect(() => {
    setPositionMs(0);
    setDurationMs(0);
    setIsPlaying(false);
    setPlayerError(null);
    if (!pendingPlayRef.current) {
      setIsLoadingTrack(false);
      setIframeMounted(false);
    }
  }, [activeTrack?.id, activeTrack?.soundcloudUrl]);

  useEffect(() => {
    if (!iframeMounted || !iframeRef.current || !playerSrc) return;
    let cancelled = false;
    let widget: SCWidgetInstance | null = null;

    loadSoundCloudWidgetApi()
      .then((WidgetFactory) => {
        if (cancelled || !iframeRef.current) return;
        widget = WidgetFactory(iframeRef.current);
        widgetRef.current = widget;

        widget.bind(WidgetFactory.Events.READY, () => {
          if (cancelled || !widget) return;
          widgetReadyRef.current = true;
          widget.setVolume(85);
          widget.getDuration((dur) => {
            if (!cancelled && Number.isFinite(dur) && dur > 0) setDurationMs(dur);
          });
          if (pendingPlayRef.current) {
            pendingPlayRef.current = false;
            try {
              onBeforePlay?.();
              widget.play();
            } catch {
              setIsLoadingTrack(false);
              setPlayerError('Не вдалося запустити трек — відкрийте на SoundCloud.');
            }
          }
        });

        widget.bind(WidgetFactory.Events.PLAY, () => {
          if (cancelled || !widget) return;
          onBeforePlay?.();
          setIsPlaying(true);
          setIsLoadingTrack(false);
          setPlayerError(null);
          widget.getDuration((dur) => {
            if (!cancelled && Number.isFinite(dur) && dur > 0) setDurationMs(dur);
          });
        });

        widget.bind(WidgetFactory.Events.PAUSE, () => {
          if (cancelled) return;
          setIsPlaying(false);
          setIsLoadingTrack(false);
        });

        widget.bind(WidgetFactory.Events.FINISH, () => {
          if (cancelled) return;
          setIsPlaying(false);
          setPositionMs(0);
          const nextIdx = activeTrackIndexRef.current + 1;
          if (nextIdx < totalTracksRef.current) {
            pendingPlayRef.current = true;
            setIsLoadingTrack(true);
            setIframeMounted(true);
            setActiveTrackIndex(nextIdx);
          } else {
            setIsLoadingTrack(false);
          }
        });

        widget.bind(WidgetFactory.Events.PLAY_PROGRESS, (payload) => {
          if (cancelled || !payload || typeof payload !== 'object') return;
          const p = payload as SCPlayProgressPayload;
          if (Number.isFinite(p.currentPosition)) {
            setPositionMs(p.currentPosition);
          }
        });

        widget.bind(WidgetFactory.Events.ERROR, () => {
          if (cancelled) return;
          pendingPlayRef.current = false;
          setIsPlaying(false);
          setIsLoadingTrack(false);
          setPlayerError('Не вдалося запустити трек — відкрийте на SoundCloud.');
        });
      })
      .catch(() => {
        if (cancelled) return;
        pendingPlayRef.current = false;
        setIsLoadingTrack(false);
        setPlayerError('Не вдалося завантажити плеєр SoundCloud.');
      });

    return () => {
      cancelled = true;
      widgetReadyRef.current = false;
      try {
        widget?.pause();
      } catch {
        // Ignore cleanup errors
      }
      widgetRef.current = null;
    };
  }, [iframeMounted, playerSrc, onBeforePlay]);

  useEffect(() => {
    if (!pauseSignal) return;
    pendingPlayRef.current = false;
    setIsLoadingTrack(false);
    setIsPlaying(false);
    if (widgetRef.current && widgetReadyRef.current) {
      try {
        widgetRef.current.pause();
      } catch {
        // Ignore pause error
      }
    }
  }, [pauseSignal]);

  const handleTrackPlayToggle = useCallback(
    (index: number) => {
      if (index < 0 || index >= tracks.length) return;
      setPlayerError(null);
      if (!isOnline) {
        setActiveTrackIndex(index);
        setPlayerError('Для прослуховування з SoundCloud потрібен інтернет.');
        return;
      }
      if (index === safeTrackIndex) {
        if (!iframeMounted) {
          onBeforePlay?.();
          pendingPlayRef.current = true;
          setIsLoadingTrack(true);
          setIframeMounted(true);
          return;
        }
        const widget = widgetRef.current;
        if (widget && widgetReadyRef.current) {
          if (isPlaying) {
            widget.pause();
            setIsPlaying(false);
          } else {
            onBeforePlay?.();
            setIsLoadingTrack(true);
            try {
              widget.play();
            } catch {
              setIsLoadingTrack(false);
              setPlayerError('Не вдалося запустити трек.');
            }
          }
        } else {
          onBeforePlay?.();
          pendingPlayRef.current = true;
          setIsLoadingTrack(true);
        }
        return;
      }
      onBeforePlay?.();
      pendingPlayRef.current = true;
      setIsLoadingTrack(true);
      setIframeMounted(true);
      setActiveTrackIndex(index);
    },
    [tracks.length, isOnline, safeTrackIndex, iframeMounted, isPlaying, onBeforePlay]
  );

  const handleSeek = (nextMs: number) => {
    setPositionMs(nextMs);
    if (widgetRef.current && widgetReadyRef.current) {
      try {
        widgetRef.current.seekTo(nextMs);
      } catch {
        // Ignore seek error
      }
    }
  };

  // Lightbox keyboard handling
  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxIndex(null);
      } else if (e.key === 'ArrowRight' && photos.length > 1) {
        setLightboxIndex((prev) => (prev === null ? null : (prev + 1) % photos.length));
      } else if (e.key === 'ArrowLeft' && photos.length > 1) {
        setLightboxIndex((prev) =>
          prev === null ? null : (prev - 1 + photos.length) % photos.length
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, photos.length]);

  const openCreateEditor = () => {
    setEditingMode('create');
    setEditingId(null);
    setDraftWeekKey(currentPeriod?.weekKey || '');
    setDraftText('');
    setDraftPhotos([]);
    setDraftTracks([]);
    setScInput('');
    setPhotoUrlInput('');
    setEditorMessage(null);
  };

  const openEditEditor = () => {
    if (!activeSelection) return;
    setEditingMode('edit');
    setEditingId(activeSelection.id);
    setDraftWeekKey(activeSelection.weekKey);
    setDraftText(activeSelection.text || '');
    setDraftPhotos([...activeSelection.photos]);
    setDraftTracks([...activeSelection.tracks]);
    setScInput('');
    setPhotoUrlInput('');
    setEditorMessage(null);
  };

  const closeEditor = () => {
    setEditingMode('none');
    setEditingId(null);
    setEditorMessage(null);
  };

  const handlePhotoFilesChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, Math.max(0, 12 - draftPhotos.length));
    e.target.value = '';
    if (files.length === 0) {
      setEditorMessage({ type: 'err', text: 'Можна додати до 12 фото.' });
      return;
    }

    setUploadingPhotos(true);
    setEditorMessage(null);
    try {
      const token = await getAdminToken();
      if (!token) {
        setEditorMessage({ type: 'err', text: 'Сесія адміністратора закінчилась.' });
        return;
      }

      const uploadedUrls: string[] = [];
      for (const file of files) {
        const dataUrl = await readImageAsOptimizedDataUrl(file);
        const res = await fetch('/api/author/upload-cover', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ dataUrl }),
        });
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) {
          throw new Error(data.error || 'Не вдалося завантажити фото.');
        }
        uploadedUrls.push(data.url);
      }

      setDraftPhotos((prev) => Array.from(new Set([...prev, ...uploadedUrls])).slice(0, 12));
    } catch (err) {
      setEditorMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Не вдалося завантажити фото.',
      });
    } finally {
      setUploadingPhotos(false);
    }
  };

  const handleAddPhotoUrl = () => {
    const clean = photoUrlInput.trim();
    if (!clean) return;
    if (!/^(\/uploads\/[^\s]+|https?:\/\/[^\s]+)$/i.test(clean)) {
      setEditorMessage({ type: 'err', text: 'Вкажіть коректне посилання на фото.' });
      return;
    }
    setDraftPhotos((prev) => Array.from(new Set([...prev, clean])).slice(0, 12));
    setPhotoUrlInput('');
    setEditorMessage(null);
  };

  const moveDraftPhoto = (idx: number, delta: -1 | 1) => {
    setDraftPhotos((prev) => {
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const moveDraftTrack = (idx: number, delta: -1 | 1) => {
    setDraftTracks((prev) => {
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const resolveSoundCloudLinks = async (rawText: string): Promise<WeeklyMusicTrack[] | null> => {
    const token = await getAdminToken();
    if (!token) {
      setEditorMessage({ type: 'err', text: 'Сесія адміністратора закінчилась.' });
      return null;
    }
    const res = await fetch('/api/author/weekly-music/resolve-soundcloud', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: rawText }),
    });
    const data = (await res.json()) as {
      error?: string;
      tracks?: WeeklyMusicTrack[];
    };
    if (!res.ok || !Array.isArray(data.tracks)) {
      setEditorMessage({
        type: 'err',
        text: data.error || 'Не вдалося імпортувати посилання SoundCloud.',
      });
      return null;
    }
    return data.tracks;
  };

  const handleImportSoundCloud = async () => {
    const trimmed = scInput.trim();
    if (!trimmed || resolvingSc) return;
    setResolvingSc(true);
    setEditorMessage(null);
    try {
      const resolved = await resolveSoundCloudLinks(trimmed);
      if (!resolved) return;
      setDraftTracks((prev) => {
        const existingUrls = new Set(prev.map((t) => t.soundcloudUrl.toLowerCase()));
        const uniqueNew = resolved.filter((t) => !existingUrls.has(t.soundcloudUrl.toLowerCase()));
        return [...prev, ...uniqueNew].slice(0, 50);
      });
      setScInput('');
    } catch {
      setEditorMessage({ type: 'err', text: 'Помилка мережі під час імпорту із SoundCloud.' });
    } finally {
      setResolvingSc(false);
    }
  };

  const handleSave = async () => {
    if (saving || uploadingPhotos || resolvingSc) return;
    setSaving(true);
    setEditorMessage(null);

    try {
      let finalTracks = [...draftTracks];
      const pendingSc = scInput.trim();
      if (pendingSc) {
        const resolved = await resolveSoundCloudLinks(pendingSc);
        if (!resolved) {
          setSaving(false);
          return;
        }
        const existingUrls = new Set(finalTracks.map((t) => t.soundcloudUrl.toLowerCase()));
        const uniqueNew = resolved.filter((t) => !existingUrls.has(t.soundcloudUrl.toLowerCase()));
        finalTracks = [...finalTracks, ...uniqueNew].slice(0, 50);
      }

      const trimmedText = draftText.trim();
      if (!trimmedText && draftPhotos.length === 0 && finalTracks.length === 0) {
        setEditorMessage({ type: 'err', text: 'Додайте музику, фото або текст.' });
        setSaving(false);
        return;
      }

      const token = await getAdminToken();
      if (!token) {
        setEditorMessage({ type: 'err', text: 'Сесія адміністратора закінчилась.' });
        setSaving(false);
        return;
      }

      const isEdit = editingMode === 'edit' && editingId;
      const endpoint = isEdit
        ? `/api/author/weekly-music/${encodeURIComponent(editingId)}`
        : '/api/author/weekly-music';

      const res = await fetch(endpoint, {
        method: isEdit ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          weekKey: draftWeekKey.trim() || undefined,
          text: trimmedText,
          photos: draftPhotos,
          tracks: finalTracks,
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        selection?: WeeklyMusicSelection;
        weeklyMusicSelections?: WeeklyMusicSelection[];
      };

      if (!res.ok || !data.selection) {
        setEditorMessage({ type: 'err', text: data.error || 'Не вдалося зберегти підбірку.' });
        setSaving(false);
        return;
      }

      void saveWeeklyMusicSelectionToFirestore(data.selection).catch(() => {});

      const nextList = Array.isArray(data.weeklyMusicSelections)
        ? data.weeklyMusicSelections
        : [data.selection];
      onSelectionsUpdated(nextList);

      const newIdx = nextList.findIndex((item) => item.id === data.selection?.id);
      if (newIdx >= 0) setSelectedIndex(newIdx);
      setEditingMode('none');
      setEditingId(null);
      setScInput('');
    } catch {
      setEditorMessage({ type: 'err', text: 'Помилка мережі під час збереження.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteActive = async () => {
    if (!isAdmin || !activeSelection || deleting) return;
    setDeleting(true);
    setEditorMessage(null);
    const targetId = activeSelection.id;
    try {
      const token = await getAdminToken();
      if (!token) return;
      const res = await fetch(`/api/author/weekly-music/${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        weeklyMusicSelections?: WeeklyMusicSelection[];
      };
      void deleteWeeklyMusicSelectionFromFirestore(targetId).catch(() => {});
      const nextList = Array.isArray(data.weeklyMusicSelections)
        ? data.weeklyMusicSelections
        : selections.filter((s) => s.id !== targetId);
      onSelectionsUpdated(nextList);
      setSelectedIndex(0);
      setEditingMode('none');
    } catch {
      setEditorMessage({ type: 'err', text: 'Не вдалося видалити запис.' });
    } finally {
      setDeleting(false);
    }
  };

  if (selections.length === 0 && !isAdmin && editingMode === 'none') {
    return null;
  }

  return (
    <aside className="space-y-4">
      {editingMode !== 'none' ? (
        <m.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="rounded-[26px] bg-[#EFECE4]/90 dark:bg-[#222222] p-5 sm:p-6 space-y-4 shadow-[0_18px_42px_-28px_rgba(20,30,22,0.18)] dark:shadow-[0_24px_54px_-28px_rgba(0,0,0,0.75)]"
        >
          {/* Quiet week picker + close */}
          <div className="flex items-center justify-between gap-2">
            <input
              type="week"
              aria-label="Тиждень"
              value={draftWeekKey}
              onChange={(e) => setDraftWeekKey(e.target.value)}
              className="rounded-lg bg-[#E4DFD4]/80 dark:bg-[#2C2C2C] px-2.5 py-1.5 text-xs font-mono text-[#3A3D38] dark:text-[#D4CFC4] border-0 focus:outline-none"
            />
            <button
              type="button"
              onClick={closeEditor}
              aria-label="Закрити"
              className="p-1.5 rounded-lg text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Cozy text without title */}
          <textarea
            rows={4}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Кілька слів..."
            className="w-full rounded-xl bg-white/75 dark:bg-[#2A2A2A] px-3.5 py-3 text-sm leading-[1.7] text-[#141413] dark:text-[#F4F1EA] placeholder:text-[#7A7A73] dark:placeholder:text-[#7E7B73] resize-y focus:outline-none"
          />

          {/* Photos uploader & preview */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                onChange={handlePhotoFilesChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploadingPhotos || draftPhotos.length >= 12}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#E4DFD4]/90 dark:bg-[#2E2E2E] hover:bg-[#DBD5C8] dark:hover:bg-[#383838] text-xs font-medium text-[#1F211E] dark:text-[#F4F1EA] transition-colors cursor-pointer disabled:opacity-50"
              >
                {uploadingPhotos ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="w-3.5 h-3.5" />
                )}
                <span>Додати фото</span>
              </button>

              <div className="flex flex-1 min-w-[160px] items-center gap-1.5">
                <input
                  type="url"
                  value={photoUrlInput}
                  onChange={(e) => setPhotoUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddPhotoUrl();
                    }
                  }}
                  placeholder="або URL фото..."
                  className="flex-1 rounded-xl bg-white/65 dark:bg-[#2A2A2A] px-2.5 py-1.5 text-xs text-[#141413] dark:text-[#F4F1EA] placeholder:text-[#7A7A73] focus:outline-none"
                />
                {photoUrlInput.trim() && (
                  <button
                    type="button"
                    onClick={handleAddPhotoUrl}
                    className="px-2.5 py-1.5 rounded-xl bg-[#2C5937] dark:bg-[#3A3A3A] text-white text-xs cursor-pointer"
                  >
                    +
                  </button>
                )}
              </div>
            </div>

            {draftPhotos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {draftPhotos.map((src, idx) => (
                  <div
                    key={`${src}-${idx}`}
                    className="group relative aspect-square rounded-xl overflow-hidden bg-black/10 dark:bg-black/30"
                  >
                    <img
                      src={src}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-x-1 bottom-1 flex items-center justify-between gap-1 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <div className="flex items-center gap-0.5">
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => moveDraftPhoto(idx, -1)}
                            aria-label="Ліворуч"
                            className="w-6 h-6 rounded-md bg-black/65 text-white flex items-center justify-center cursor-pointer"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {idx < draftPhotos.length - 1 && (
                          <button
                            type="button"
                            onClick={() => moveDraftPhoto(idx, 1)}
                            aria-label="Праворуч"
                            className="w-6 h-6 rounded-md bg-black/65 text-white flex items-center justify-center cursor-pointer"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftPhotos((prev) => prev.filter((_, i) => i !== idx))
                        }
                        aria-label="Прибрати фото"
                        className="w-6 h-6 rounded-md bg-rose-700/90 text-white flex items-center justify-center cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SoundCloud importer */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <textarea
                rows={1}
                value={scInput}
                onChange={(e) => setScInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleImportSoundCloud();
                  }
                }}
                placeholder="https://soundcloud.com/... (трек або плейлист)"
                disabled={resolvingSc || !isOnline}
                className="flex-1 min-h-[38px] rounded-xl bg-white/75 dark:bg-[#2A2A2A] px-3 py-2 font-mono text-xs text-[#141413] dark:text-[#F4F1EA] placeholder:text-[#7A7A73] resize-y focus:outline-none"
              />
              <button
                type="button"
                disabled={resolvingSc || !scInput.trim() || !isOnline}
                onClick={() => void handleImportSoundCloud()}
                className="px-3.5 py-2 rounded-xl bg-[#E4DFD4] dark:bg-[#343434] hover:bg-[#DBD4C6] dark:hover:bg-[#3F3F3F] text-xs font-medium text-[#141413] dark:text-[#F4F1EA] whitespace-nowrap cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {resolvingSc && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Імпорт</span>
              </button>
            </div>

            {draftTracks.length > 0 && (
              <div className="rounded-xl bg-white/50 dark:bg-[#1B1B1B]/65 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
                {draftTracks.map((track, idx) => (
                  <div
                    key={track.id}
                    className="flex items-center gap-2.5 px-3 py-2"
                  >
                    <WeeklyTrackThumb artworkUrl={track.artworkUrl} title={track.title} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[#141413] dark:text-[#F4F1EA] truncate">
                        {track.title}
                      </p>
                      <p className="text-[11px] text-[#6B6B65] dark:text-[#9E998E] truncate">
                        {track.artist}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => moveDraftTrack(idx, -1)}
                          aria-label="Вгору"
                          className="p-1 rounded-md text-[#5C5C58] dark:text-[#A6A196] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {idx < draftTracks.length - 1 && (
                        <button
                          type="button"
                          onClick={() => moveDraftTrack(idx, 1)}
                          aria-label="Вниз"
                          className="p-1 rounded-md text-[#5C5C58] dark:text-[#A6A196] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setDraftTracks((prev) => prev.filter((_, i) => i !== idx))
                        }
                        aria-label="Прибрати трек"
                        className="p-1 rounded-md text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {editorMessage && (
            <p
              className={`text-xs ${
                editorMessage.type === 'ok'
                  ? 'text-[#2B5434] dark:text-[#D4CFC4]'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {editorMessage.text}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={closeEditor}
              className="btn-editorial-secondary px-3.5 py-2 text-xs"
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={saving || uploadingPhotos || resolvingSc}
              onClick={() => void handleSave()}
              className="btn-editorial-primary px-4 py-2 text-xs"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Зберегти</span>
            </button>
          </div>
        </m.div>
      ) : !activeSelection ? (
        isAdmin && (
          <div className="rounded-[26px] border border-dashed border-black/15 dark:border-white/12 bg-[#EFECE4]/45 dark:bg-[#222222]/55 p-6 flex items-center justify-center">
            <button
              type="button"
              onClick={openCreateEditor}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#EFECE4] dark:bg-[#2E2E2E] hover:bg-[#E4DFD4] dark:hover:bg-[#383838] text-xs font-medium text-[#1F211E] dark:text-[#F4F1EA] transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Додати тижневу підбірку</span>
            </button>
          </div>
        )
      ) : (
        <m.div
          key={activeSelection.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-[26px] bg-[#EFECE4]/85 dark:bg-[#222222] p-5 sm:p-6 space-y-4 shadow-[0_18px_42px_-28px_rgba(20,30,22,0.18)] dark:shadow-[0_24px_54px_-28px_rgba(0,0,0,0.75)]"
        >
          {/* Cozy Photos (1 or multiple, no header) */}
          {photos.length === 1 && (
            <button
              type="button"
              onClick={() => setLightboxIndex(0)}
              className="block w-full overflow-hidden rounded-2xl bg-black/5 dark:bg-black/30 cursor-zoom-in focus:outline-none"
            >
              <img
                src={photos[0]}
                alt=""
                loading="lazy"
                className="w-full max-h-[340px] object-cover transition-transform duration-500 hover:scale-[1.015]"
              />
            </button>
          )}

          {photos.length === 2 && (
            <div className="grid grid-cols-2 gap-2">
              {photos.map((src, idx) => (
                <button
                  key={`${src}-${idx}`}
                  type="button"
                  onClick={() => setLightboxIndex(idx)}
                  className="block w-full aspect-[4/3] overflow-hidden rounded-2xl bg-black/5 dark:bg-black/30 cursor-zoom-in"
                >
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-500 hover:scale-[1.03]"
                  />
                </button>
              ))}
            </div>
          )}

          {photos.length >= 3 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {photos.map((src, idx) => (
                <button
                  key={`${src}-${idx}`}
                  type="button"
                  onClick={() => setLightboxIndex(idx)}
                  className={`block w-full overflow-hidden rounded-2xl bg-black/5 dark:bg-black/30 cursor-zoom-in ${
                    idx === 0 ? 'col-span-2 sm:col-span-3 aspect-[16/10]' : 'aspect-square'
                  }`}
                >
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-500 hover:scale-[1.03]"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Cozy freeform text (no heading) */}
          {activeSelection.text && (
            <p className="text-[14.5px] sm:text-[15px] leading-[1.78] text-[#282B27] dark:text-[#E2DDD3] whitespace-pre-line">
              {preserveFormattedText(activeSelection.text)}
            </p>
          )}

          {/* SoundCloud tracks (no heading) */}
          {tracks.length > 0 && (
            <div className="space-y-1.5 pt-0.5">
              {tracks.map((track, idx) => {
                const isCurrent = idx === safeTrackIndex;
                const isCurrentPlaying = isCurrent && isPlaying;
                const isCurrentLoading = isCurrent && isLoadingTrack;
                const safeHref = getSafeExternalSoundCloudUrl(track.soundcloudUrl);

                return (
                  <div
                    key={track.id}
                    className={`rounded-xl px-3 py-2 transition-colors ${
                      isCurrent && (isPlaying || isLoadingTrack || iframeMounted)
                        ? 'bg-white/75 dark:bg-[#2D2D2D]'
                        : 'bg-white/40 dark:bg-[#292929]/70 hover:bg-white/65 dark:hover:bg-[#2E2E2E]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleTrackPlayToggle(idx)}
                        aria-label={isCurrentPlaying ? `Пауза ${track.title}` : `Відтворити ${track.title}`}
                        className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center bg-[#2C5937] dark:bg-[#3A3A3A] text-white hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                      >
                        {isCurrentLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isCurrentPlaying ? (
                          <Pause className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        )}
                      </button>

                      <WeeklyTrackThumb artworkUrl={track.artworkUrl} title={track.title} />

                      <button
                        type="button"
                        onClick={() => handleTrackPlayToggle(idx)}
                        className="min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <p className="text-[13px] font-medium text-[#141413] dark:text-[#F4F1EA] truncate">
                          {track.title}
                        </p>
                        <p className="text-[11px] text-[#6B6B65] dark:text-[#A6A196] truncate">
                          {track.artist}
                        </p>
                      </button>

                      {safeHref && (
                        <a
                          href={safeHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Відкрити ${track.title} на SoundCloud`}
                          className="p-1.5 rounded-lg text-[#6B6B65] dark:text-[#9E998E] hover:text-[#141413] dark:hover:text-white transition-colors shrink-0"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    {isCurrent && (iframeMounted || positionMs > 0 || durationMs > 0) && (
                      <div className="mt-2 flex items-center gap-2.5 px-0.5">
                        <span className="font-mono text-[10px] text-[#6B6B65] dark:text-[#9E998E] tabular-nums w-8 shrink-0">
                          {formatDurationMs(positionMs)}
                        </span>
                        <input
                          type="range"
                          aria-label="Позиція треку"
                          min={0}
                          max={Math.max(1000, durationMs || 1000)}
                          value={Math.min(positionMs, Math.max(1000, durationMs || 1000))}
                          disabled={!durationMs}
                          onChange={(e) => handleSeek(Number(e.target.value))}
                          className="flex-1 h-1 rounded-full appearance-none bg-black/15 dark:bg-white/15 accent-[#2C5937] dark:accent-[#E5E5E5] cursor-pointer"
                        />
                        <span className="font-mono text-[10px] text-[#6B6B65] dark:text-[#9E998E] tabular-nums w-8 text-right shrink-0">
                          {durationMs > 0 ? formatDurationMs(durationMs) : '--:--'}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              {playerError && (
                <p className="text-[11px] text-rose-700 dark:text-rose-400 px-1 pt-1">
                  {playerError}
                </p>
              )}
            </div>
          )}

          {/* Hidden SoundCloud iframe for inline weekly music playback */}
          {iframeMounted && playerSrc && (
            <iframe
              ref={iframeRef}
              title="SoundCloud weekly track player"
              src={playerSrc}
              allow="autoplay"
              className="hidden"
            />
          )}

          {/* Whispered period footer + discreet navigation / admin controls */}
          {(selections.length > 1 || isAdmin || activeSelection.periodLabel) && (
            <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-[#70706A] dark:text-[#989388]">
              <span className="truncate">{activeSelection.periodLabel}</span>

              <div className="flex items-center gap-1 shrink-0">
                {selections.length > 1 && (
                  <>
                    <button
                      type="button"
                      disabled={safeSelIndex >= selections.length - 1}
                      onClick={() => setSelectedIndex((prev) => Math.min(selections.length - 1, prev + 1))}
                      aria-label="Попередній тиждень"
                      className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={safeSelIndex <= 0}
                      onClick={() => setSelectedIndex((prev) => Math.max(0, prev - 1))}
                      aria-label="Наступний тиждень"
                      className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 cursor-pointer"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}

                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={openEditEditor}
                      aria-label="Редагувати"
                      title="Редагувати"
                      className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={openCreateEditor}
                      aria-label="Новий тиждень"
                      title="Новий тиждень"
                      className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void handleDeleteActive()}
                      aria-label="Видалити"
                      title="Видалити"
                      className="p-1 rounded-md text-rose-700/80 dark:text-rose-400/80 hover:bg-rose-500/10 cursor-pointer disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </m.div>
      )}

      {/* Calm Fullscreen Photo Lightbox */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxIndex(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 sm:p-8"
        >
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            aria-label="Закрити"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          {photos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((prev) =>
                  prev === null ? null : (prev - 1 + photos.length) % photos.length
                );
              }}
              aria-label="Попереднє фото"
              className="absolute left-3 sm:left-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          <img
            src={photos[lightboxIndex]}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[88vh] rounded-2xl object-contain shadow-2xl"
          />

          {photos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((prev) => (prev === null ? null : (prev + 1) % photos.length));
              }}
              aria-label="Наступне фото"
              className="absolute right-3 sm:right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
