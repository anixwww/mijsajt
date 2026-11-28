import { ArrowDown, ArrowUp, ExternalLink, ListMusic, Loader2, Play, Radio, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { RADIO_STATIONS, type RadioStationId, type RadioTrack } from '../../types.ts';
import {
  deleteRadioTrackFromFirestore,
  reorderRadioTracksInFirestore,
  saveRadioTracksToFirestore,
} from '../../utils/radioFirestore.ts';
import { STUDIO_INPUT_CLASS, type GetAuthHeadersFn } from './studioShared.ts';

interface StudioRadioTabProps {
  radioTracks: RadioTrack[];
  setRadioTracks: (tracks: RadioTrack[]) => void;
  getAuthHeaders: GetAuthHeadersFn;
  setFeedback: (msg: string | null) => void;
  onRadioTracksChanged?: (
    tracks: RadioTrack[],
    activateTrackId?: string | null,
    station?: RadioStationId
  ) => void;
  onCatalogUpdated: () => void;
}

interface ExtractedPlaylistPreview {
  playlistTitle: string | null;
  tracks: RadioTrack[];
  selectedIds: string[];
}

function mergeTrackLists(current: RadioTrack[], added: RadioTrack[]): RadioTrack[] {
  const byId = new Map<string, RadioTrack>();
  for (const t of current) byId.set(t.id, t);
  for (const t of added) byId.set(t.id, t);
  return Array.from(byId.values());
}

export function StudioRadioTab({
  radioTracks,
  setRadioTracks,
  getAuthHeaders,
  setFeedback,
  onRadioTracksChanged,
  onCatalogUpdated,
}: StudioRadioTabProps) {
  const [selectedStation, setSelectedStation] = useState<RadioStationId>('indie');
  const [radioUrlDraft, setRadioUrlDraft] = useState('');
  const [radioImporting, setRadioImporting] = useState(false);
  const [extractingPlaylist, setExtractingPlaylist] = useState(false);
  const [playlistPreview, setPlaylistPreview] = useState<ExtractedPlaylistPreview | null>(null);
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null);

  const stationCounts = useMemo(() => {
    let indie = 0;
    let electronic = 0;
    for (const track of radioTracks) {
      if ((track.station || 'indie') === 'electronic') electronic += 1;
      else indie += 1;
    }
    return { indie, electronic };
  }, [radioTracks]);

  const stationTracks = useMemo(
    () => radioTracks.filter((t) => (t.station || 'indie') === selectedStation),
    [radioTracks, selectedStation]
  );

  const activeStationLabel =
    RADIO_STATIONS.find((s) => s.id === selectedStation)?.label ?? 'Інді';

  const submitUrlsToStation = async (payloadBody: { url?: string; urls?: string[] }) => {
    if (radioImporting) return;
    setRadioImporting(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch('/api/author/radio/tracks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payloadBody, station: selectedStation }),
      });
      const data = (await res.json()) as {
        error?: string;
        addedTracks?: RadioTrack[];
        skippedDuplicates?: number;
        playlistTitle?: string | null;
        activatedTrackId?: string | null;
        radioTracks?: RadioTrack[];
      };
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося додати трек або плейлист із SoundCloud.');
        return;
      }

      const added = Array.isArray(data.addedTracks) ? data.addedTracks : [];
      const mergedTracks =
        added.length > 0
          ? mergeTrackLists(radioTracks, added)
          : Array.isArray(data.radioTracks) && data.radioTracks.length >= radioTracks.length
            ? data.radioTracks
            : radioTracks;

      if (added.length > 0) {
        try {
          await saveRadioTracksToFirestore(added, radioTracks);
        } catch {
          // Handled via structured Firestore logger; server copy remains saved
        }
      }

      setRadioTracks(mergedTracks);
      setRadioUrlDraft('');
      setPlaylistPreview(null);

      const playlistTitle = typeof data.playlistTitle === 'string' ? data.playlistTitle.trim() : '';
      if (playlistTitle) {
        setFeedback(
          added.length > 0
            ? `Витягнуто та додано ${added.length} пісень із плейлиста «${playlistTitle}» у хвилю «${activeStationLabel}».`
            : `Усі пісні з плейлиста «${playlistTitle}» уже є у хвилі «${activeStationLabel}».`
        );
      } else if (added.length > 1) {
        setFeedback(`Додано ${added.length} пісень у хвилю «${activeStationLabel}» та збережено в базі.`);
      } else if (added.length === 1) {
        setFeedback(`«${added[0].title}» додано до хвилі «${activeStationLabel}» та збережено в базі.`);
      } else {
        setFeedback(`Обрані треки уже є у хвилі «${activeStationLabel}».`);
      }

      onRadioTracksChanged?.(mergedTracks, data.activatedTrackId || null, selectedStation);
      onCatalogUpdated();
    } catch {
      setFeedback('Помилка мережі під час імпорту треку SoundCloud.');
    } finally {
      setRadioImporting(false);
    }
  };

  const handleImport = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = radioUrlDraft.trim();
    if (!trimmed || radioImporting) return;
    await submitUrlsToStation({ url: trimmed });
  };

  const handleExtractPlaylistPreview = async () => {
    const firstLine = radioUrlDraft
      .trim()
      .split(/[\r\n]+/)
      .map((s) => s.trim())
      .find(Boolean);
    if (!firstLine || extractingPlaylist || radioImporting) return;

    setExtractingPlaylist(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch('/api/author/radio/resolve-playlist', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: firstLine, station: selectedStation }),
      });
      const data = (await res.json()) as {
        error?: string;
        kind?: 'playlist' | 'track';
        playlistTitle?: string | null;
        tracks?: RadioTrack[];
      };
      if (!res.ok || !Array.isArray(data.tracks) || data.tracks.length === 0) {
        setFeedback(data.error || 'Не вдалося витягти пісні з цього посилання SoundCloud.');
        return;
      }

      setPlaylistPreview({
        playlistTitle: data.playlistTitle || null,
        tracks: data.tracks,
        selectedIds: data.tracks.map((t) => t.id),
      });
      setFeedback(
        data.playlistTitle
          ? `Знайдено ${data.tracks.length} пісень у плейлисті «${data.playlistTitle}». Оберіть потрібні та додайте в хвилю.`
          : `Знайдено ${data.tracks.length} трек за посиланням.`
      );
    } catch {
      setFeedback('Помилка мережі під час розбору плейлиста SoundCloud.');
    } finally {
      setExtractingPlaylist(false);
    }
  };

  const handleTogglePreviewTrack = (trackId: string) => {
    setPlaylistPreview((prev) => {
      if (!prev) return prev;
      const exists = prev.selectedIds.includes(trackId);
      return {
        ...prev,
        selectedIds: exists
          ? prev.selectedIds.filter((id) => id !== trackId)
          : [...prev.selectedIds, trackId],
      };
    });
  };

  const handleInsertExtractedUrlsToInput = () => {
    if (!playlistPreview) return;
    const selectedUrls = playlistPreview.tracks
      .filter((t) => playlistPreview.selectedIds.includes(t.id))
      .map((t) => t.soundcloudUrl);
    if (selectedUrls.length === 0) return;
    setRadioUrlDraft(selectedUrls.join('\n'));
    setPlaylistPreview(null);
    setFeedback(`Посилання на ${selectedUrls.length} пісень вставлено в поле.`);
  };

  const handleAddSelectedFromPreview = async () => {
    if (!playlistPreview) return;
    const selectedUrls = playlistPreview.tracks
      .filter((t) => playlistPreview.selectedIds.includes(t.id))
      .map((t) => t.soundcloudUrl);
    if (selectedUrls.length === 0) {
      setFeedback('Оберіть принаймні одну пісню зі списку.');
      return;
    }
    await submitUrlsToStation({ urls: selectedUrls });
  };

  const handleReorder = async (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= stationTracks.length) return;
    const reorderedStation = [...stationTracks];
    const [moved] = reorderedStation.splice(idx, 1);
    reorderedStation.splice(target, 0, moved);

    const otherTracks = radioTracks.filter((t) => (t.station || 'indie') !== selectedStation);
    const nextAll = [...reorderedStation, ...otherTracks].map((t, i) => ({ ...t, order: i }));

    setRadioTracks(nextAll);
    onRadioTracksChanged?.(nextAll);

    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
    if (headers) {
      await fetch('/api/author/radio/tracks/reorder', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          orderedIds: reorderedStation.map((t) => t.id),
          station: selectedStation,
        }),
      }).catch(() => {});
    }

    try {
      await reorderRadioTracksInFirestore(nextAll);
    } catch {
      // Structured Firestore error already logged
    }
    onCatalogUpdated();
  };

  const handleDelete = async (trackId: string) => {
    if (deletingTrackId) return;
    setDeletingTrackId(trackId);
    setFeedback(null);
    const nextAll = radioTracks
      .filter((t) => t.id !== trackId)
      .map((t, i) => ({ ...t, order: i }));
    setRadioTracks(nextAll);
    onRadioTracksChanged?.(nextAll);

    try {
      const headers = await getAuthHeaders();
      const serverDeletePromise = headers
        ? fetch(`/api/author/radio/tracks/${encodeURIComponent(trackId)}`, {
            method: 'DELETE',
            headers,
          })
            .then((res) => res.ok)
            .catch(() => false)
        : Promise.resolve(false);

      const firestoreDeletePromise = deleteRadioTrackFromFirestore(trackId).catch(() => false);

      const [serverOk, firestoreOk] = await Promise.all([
        serverDeletePromise,
        firestoreDeletePromise,
      ]);

      if (serverOk || firestoreOk) {
        setFeedback('Трек видалено.');
      } else {
        setFeedback('Не вдалося видалити трек із бази.');
      }
      onCatalogUpdated();
    } finally {
      setDeletingTrackId(null);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Wave / Station Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Хвилі радіостанції"
          className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#EAE7DF] dark:bg-[#202020]"
        >
          {RADIO_STATIONS.map((station) => {
            const active = selectedStation === station.id;
            const count = stationCounts[station.id];
            return (
              <button
                key={station.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedStation(station.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1.5 ${
                  active
                    ? 'bg-white dark:bg-[#323232] text-[#141413] dark:text-[#EDEAE1] shadow-xs'
                    : 'text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                }`}
              >
                <span>{station.label}</span>
                <span className="font-mono text-[11px] opacity-75 tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <form
        onSubmit={handleImport}
        className="pb-6 space-y-3"
      >
        <label
          htmlFor="studio-radio-url"
          className="block text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]"
        >
          Додати пісні або цілий плейлист у хвилю «{activeStationLabel}» (посилання SoundCloud, по одному на рядок)
        </label>
        <textarea
          id="studio-radio-url"
          rows={3}
          value={radioUrlDraft}
          onChange={(e) => setRadioUrlDraft(e.target.value)}
          placeholder={
            'https://soundcloud.com/artist/sets/my-playlist\nhttps://soundcloud.com/artist/song-1'
          }
          className={`${STUDIO_INPUT_CLASS} font-mono text-xs`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className="text-xs text-[#5C5C58] dark:text-[#A6A196]">
            Можна вставити посилання на плейлист (/sets/...) — сайт сам витягне всі пісні.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExtractPlaylistPreview}
              disabled={extractingPlaylist || radioImporting || !radioUrlDraft.trim()}
              className="btn-editorial-secondary whitespace-nowrap shrink-0"
            >
              {extractingPlaylist ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ListMusic className="w-3.5 h-3.5" />
              )}
              <span>{extractingPlaylist ? 'Витягуємо...' : 'Витягти пісні з плейлиста'}</span>
            </button>
            <button
              type="submit"
              disabled={radioImporting || extractingPlaylist || !radioUrlDraft.trim()}
              className="btn-editorial-primary whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{radioImporting ? 'Зберігаємо...' : `Додати у «${activeStationLabel}»`}</span>
            </button>
          </div>
        </div>

        {playlistPreview && (
          <div className="mt-3 rounded-xl bg-[#FAF9F5] dark:bg-[#202020] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                  {playlistPreview.playlistTitle
                    ? `Плейлист «${playlistPreview.playlistTitle}»`
                    : 'Витягнуті пісні'}{' '}
                  ({playlistPreview.selectedIds.length} / {playlistPreview.tracks.length})
                </p>
                <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                  Позначте треки, які хочете додати до хвилі «{activeStationLabel}».
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPlaylistPreview((prev) =>
                      prev
                        ? {
                            ...prev,
                            selectedIds:
                              prev.selectedIds.length === prev.tracks.length
                                ? []
                                : prev.tracks.map((t) => t.id),
                          }
                        : prev
                    )
                  }
                  className="text-xs font-medium text-[#2B5434] dark:text-[#E5E5E5] hover:underline cursor-pointer"
                >
                  {playlistPreview.selectedIds.length === playlistPreview.tracks.length
                    ? 'Зняти всі'
                    : 'Вибрати всі'}
                </button>
                <button
                  type="button"
                  onClick={() => setPlaylistPreview(null)}
                  className="text-xs font-medium text-[#5C5C58] dark:text-[#A6A196] hover:underline cursor-pointer"
                >
                  Закрити
                </button>
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto rounded-lg bg-white dark:bg-[#181818]">
              {playlistPreview.tracks.map((track, idx) => {
                const checked = playlistPreview.selectedIds.includes(track.id);
                return (
                  <label
                    key={track.id}
                    className="flex items-center gap-3 px-3 py-2 text-xs cursor-pointer hover:bg-[#FAF9F5] dark:hover:bg-[#262626]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleTogglePreviewTrack(track.id)}
                      className="rounded accent-[#2B5434] dark:accent-[#E5E5E5]"
                    />
                    <span className="font-mono text-[11px] text-[#787872] dark:text-[#C4BFB4] w-5 shrink-0 tabular-nums">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[#141413] dark:text-[#EDEAE1] truncate">
                        {track.title}
                      </p>
                      <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196] truncate">
                        {track.artist} · {track.soundcloudUrl}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleInsertExtractedUrlsToInput}
                disabled={playlistPreview.selectedIds.length === 0 || radioImporting}
                className="btn-editorial-secondary text-xs whitespace-nowrap shrink-0"
              >
                Вставити посилання в поле
              </button>
              <button
                type="button"
                onClick={handleAddSelectedFromPreview}
                disabled={playlistPreview.selectedIds.length === 0 || radioImporting}
                className="btn-editorial-primary text-xs whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>
                  {radioImporting
                    ? 'Додаємо...'
                    : `Додати вибрані (${playlistPreview.selectedIds.length})`}
                </span>
              </button>
            </div>
          </div>
        )}
      </form>

      {stationTracks.length === 0 ? (
        <div className="py-12 text-center space-y-2 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl">
          <Radio className="w-7 h-7 text-[#5C5C58] dark:text-[#A6A196] mx-auto" strokeWidth={1.5} />
          <p className="text-sm font-medium text-[#141413] dark:text-[#EDEAE1]">
            У хвилі «{activeStationLabel}» поки немає треків
          </p>
          <p className="text-xs text-[#5C5C58] dark:text-[#A6A196]">
            Вставте посилання на пісню або плейлист SoundCloud вище, щоб додати їх до цієї хвилі.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-[#FAF9F5] dark:bg-[#262626] overflow-hidden">
          {stationTracks.map((track, idx) => (
            <div
              key={track.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-[#FAF9F5] dark:hover:bg-[#2E2E2E] transition-colors"
            >
              <span className="w-6 font-mono text-xs text-[#787872] dark:text-[#C4BFB4] tabular-nums shrink-0">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#141413] dark:text-[#EDEAE1] truncate">
                  {track.title}
                </p>
                <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] truncate">
                  {track.artist}
                </p>
              </div>
              <a
                href={track.soundcloudUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg text-[#5C5C58] dark:text-[#A6A196] hover:bg-[#EFECE6] dark:hover:bg-[#323232] transition-colors shrink-0"
                title="Відкрити на SoundCloud"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                disabled={idx === 0}
                onClick={() => handleReorder(idx, -1)}
                aria-label="Підняти вище"
                className="p-1.5 rounded-lg text-[#5C5C58] dark:text-[#A6A196] hover:bg-[#EFECE6] dark:hover:bg-[#323232] disabled:opacity-30 cursor-pointer shrink-0"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={idx === stationTracks.length - 1}
                onClick={() => handleReorder(idx, 1)}
                aria-label="Опустити нижче"
                className="p-1.5 rounded-lg text-[#5C5C58] dark:text-[#A6A196] hover:bg-[#EFECE6] dark:hover:bg-[#323232] disabled:opacity-30 cursor-pointer shrink-0"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={deletingTrackId === track.id}
                onClick={() => handleDelete(track.id)}
                aria-label="Видалити трек"
                className="p-1.5 rounded-lg text-rose-700 dark:text-rose-400 hover:bg-rose-700/10 disabled:opacity-40 cursor-pointer shrink-0"
              >
                {deletingTrackId === track.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
