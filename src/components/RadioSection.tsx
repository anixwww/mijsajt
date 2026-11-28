import {
  ExternalLink,
  Heart,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import { m } from 'motion/react';
import { memo, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus.ts';
import {
  RADIO_STATIONS,
  type GuestUser,
  type RadioStationId,
  type RadioTrack,
} from '../types.ts';
import { trackClick } from '../utils/analytics.ts';
import { deleteRadioTrackFromFirestore, saveRadioTracksToFirestore } from '../utils/radioFirestore.ts';
import {
  getSavedRadioTracks,
  selectRadioStationRepertoire,
} from '../utils/radioRepertoire.ts';
import { formatDurationMs } from '../utils/soundcloudWidget.ts';
import { EmptySectionState } from './EmptySectionState.tsx';
import { LiveRadioEqualizer } from './LiveRadioEqualizer.tsx';

interface RadioSectionProps {
  allTracks: RadioTrack[];
  activeStation: RadioStationId;
  onSelectStation: (station: RadioStationId) => void;
  playbackScope?: 'repertoire' | 'saved';
  onChangePlaybackScope?: (scope: 'repertoire' | 'saved') => void;
  guestUser: GuestUser | null;
  getGuestToken?: (forceRefresh?: boolean) => Promise<string | null>;
  isAdmin: boolean;
  getAdminToken: () => Promise<string | null>;
  onOpenAuthModal: () => void;
  onTracksUpdated: (
    tracks: RadioTrack[],
    activateTrackId?: string | null,
    station?: RadioStationId
  ) => void;
  onTrackLiked?: (
    trackId: string,
    likesCount: number,
    isLiked: boolean,
    likedRadioTrackIds: string[]
  ) => void;
  currentTrackId: string | null;
  isPlaying: boolean;
  isLoadingTrack: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  isMuted: boolean;
  playerError: string | null;
  showDirectEmbed?: boolean;
  onToggleDirectEmbed?: () => void;
  onTogglePlay: () => void;
  onSelectTrack?: (trackId: string, autoPlay?: boolean, scope?: 'repertoire' | 'saved') => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  onSeekTo: (ms: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
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

function mergeTrackLists(current: RadioTrack[], added: RadioTrack[]): RadioTrack[] {
  const byId = new Map<string, RadioTrack>();
  for (const t of current) byId.set(t.id, t);
  for (const t of added) byId.set(t.id, t);
  return Array.from(byId.values());
}

function TrackArtwork({
  artworkUrl,
  title,
  size = 'md',
}: {
  artworkUrl?: string;
  title: string;
  size?: 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const safeArtwork = useMemo(() => {
    if (!artworkUrl) return null;
    try {
      const parsed = new URL(artworkUrl);
      return parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch {
      return null;
    }
  }, [artworkUrl]);

  const dimClass = size === 'lg' ? 'w-20 h-20 sm:w-24 sm:h-24 rounded-xl' : 'w-11 h-11 rounded-lg';
  const iconClass = size === 'lg' ? 'w-7 h-7' : 'w-4 h-4';

  if (safeArtwork && !failed) {
    return (
      <img
        src={safeArtwork}
        alt={title}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`${dimClass} object-cover shrink-0 bg-[#262626]`}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`${dimClass} shrink-0 flex items-center justify-center bg-[#EBE7DF] dark:bg-[#323232] text-[#5C5C58] dark:text-[#C4BFB4]`}
    >
      <Music2 className={iconClass} strokeWidth={1.65} />
    </div>
  );
}

export const RadioSection = memo(function RadioSection({
  allTracks,
  activeStation,
  onSelectStation,
  playbackScope = 'repertoire',
  onChangePlaybackScope,
  guestUser,
  getGuestToken,
  isAdmin,
  getAdminToken,
  onOpenAuthModal,
  onTracksUpdated,
  onTrackLiked,
  currentTrackId,
  isPlaying,
  isLoadingTrack,
  positionMs,
  durationMs,
  volume,
  isMuted,
  playerError,
  showDirectEmbed = false,
  onToggleDirectEmbed,
  onTogglePlay,
  onSelectTrack,
  onNextTrack,
  onPrevTrack,
  onSeekTo,
  onVolumeChange,
  onToggleMute,
}: RadioSectionProps) {
  const [urlInput, setUrlInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [likingTrackId, setLikingTrackId] = useState<string | null>(null);
  const [localViewMode, setLocalViewMode] = useState<'stream' | 'saved'>(
    playbackScope === 'saved' ? 'saved' : 'stream'
  );
  const [adminMessage, setAdminMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const isOnline = useOnlineStatus();
  const isAuthorized = Boolean(guestUser);

  const radioViewMode: 'stream' | 'saved' = isAuthorized ? localViewMode : 'stream';

  const indieRepertoire = useMemo(
    () => selectRadioStationRepertoire(allTracks, 'indie').repertoireTracks,
    [allTracks]
  );
  const electronicRepertoire = useMemo(
    () => selectRadioStationRepertoire(allTracks, 'electronic').repertoireTracks,
    [allTracks]
  );

  const stationCounts = useMemo(
    () => ({
      indie: indieRepertoire.length,
      electronic: electronicRepertoire.length,
    }),
    [indieRepertoire.length, electronicRepertoire.length]
  );

  const tracks = useMemo(
    () => (activeStation === 'electronic' ? electronicRepertoire : indieRepertoire),
    [activeStation, indieRepertoire, electronicRepertoire]
  );

  const savedTracks = useMemo(
    () => getSavedRadioTracks(allTracks, guestUser?.likedRadioTrackIds),
    [allTracks, guestUser?.likedRadioTrackIds]
  );

  const activeStationLabel =
    RADIO_STATIONS.find((s) => s.id === activeStation)?.label ?? 'Інді';

  const activePlaybackList =
    playbackScope === 'saved' && savedTracks.length > 0 ? savedTracks : tracks;

  const currentIndex = useMemo(() => {
    if (activePlaybackList.length === 0) return -1;
    const found = activePlaybackList.findIndex((t) => t.id === currentTrackId);
    if (found >= 0) return found;
    return 0;
  }, [activePlaybackList, currentTrackId]);

  const activeTrack = useMemo(() => {
    if (currentTrackId) {
      const exact = allTracks.find((t) => t.id === currentTrackId);
      if (exact && (playbackScope === 'saved' || (exact.station || 'indie') === activeStation)) {
        return exact;
      }
    }
    return currentIndex >= 0 ? activePlaybackList[currentIndex] : null;
  }, [allTracks, currentTrackId, playbackScope, activeStation, currentIndex, activePlaybackList]);

  const activeSafeHref = getSafeExternalSoundCloudUrl(activeTrack?.soundcloudUrl);
  const progressPercent =
    durationMs > 0 ? Math.min(100, Math.max(0, (positionMs / durationMs) * 100)) : 0;

  const submitUrls = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed || importing) return;
    setImporting(true);
    setAdminMessage(null);
    try {
      const token = await getAdminToken();
      if (!token) {
        setAdminMessage({ type: 'err', text: 'Сесія адміністратора закінчилась. Увійдіть повторно.' });
        return;
      }
      const res = await fetch('/api/author/radio/tracks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: trimmed, station: activeStation }),
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
        setAdminMessage({
          type: 'err',
          text: data.error || 'Не вдалося імпортувати посилання із SoundCloud.',
        });
        return;
      }

      const added = Array.isArray(data.addedTracks) ? data.addedTracks : [];
      const mergedTracks =
        added.length > 0
          ? mergeTrackLists(allTracks, added)
          : Array.isArray(data.radioTracks) && data.radioTracks.length >= allTracks.length
            ? data.radioTracks
            : allTracks;

      if (added.length > 0) {
        try {
          await saveRadioTracksToFirestore(added, allTracks);
        } catch {
          // Structured error logged; server copy remains persisted
        }
      }

      const activateId = data.activatedTrackId || mergedTracks.find((t) => (t.station || 'indie') === activeStation)?.id || null;
      setUrlInput('');
      const addedCount = added.length;
      const playlistTitle = typeof data.playlistTitle === 'string' ? data.playlistTitle.trim() : '';
      setAdminMessage({
        type: 'ok',
        text: playlistTitle
          ? addedCount > 0
            ? `Імпортовано ${addedCount} пісень із плейлиста «${playlistTitle}» у хвилю «${activeStationLabel}».`
            : `Усі пісні з плейлиста «${playlistTitle}» вже є у хвилі «${activeStationLabel}».`
          : addedCount > 1
            ? `Додано ${addedCount} треків у хвилю «${activeStationLabel}».`
            : addedCount === 1
              ? `«${added[0]?.title}» додано у хвилю «${activeStationLabel}» та збережено в базі.`
              : `Трек уже у хвилі «${activeStationLabel}» — перемкнено відтворення на нього.`,
      });
      onTracksUpdated(mergedTracks, activateId, activeStation);
    } catch {
      setAdminMessage({ type: 'err', text: 'Помилка мережі під час додавання треку.' });
    } finally {
      setImporting(false);
    }
  };

  const handleImportSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitUrls();
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitUrls();
    }
  };

  const handleDeleteTrack = async (trackId: string) => {
    if (!isAdmin) return;
    const nextAll = allTracks
      .filter((t) => t.id !== trackId)
      .map((t, i) => ({ ...t, order: i }));
    onTracksUpdated(nextAll, undefined, activeStation);

    const serverDeletePromise = getAdminToken()
      .then((token) =>
        token
          ? fetch(`/api/author/radio/tracks/${encodeURIComponent(trackId)}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }).then((res) => res.ok)
          : false
      )
      .catch(() => false);

    const firestoreDeletePromise = deleteRadioTrackFromFirestore(trackId).catch(() => false);

    const [serverOk, firestoreOk] = await Promise.all([
      serverDeletePromise,
      firestoreDeletePromise,
    ]);

    if (!serverOk && !firestoreOk) {
      setAdminMessage({ type: 'err', text: 'Не вдалося видалити трек із бази.' });
    }
  };

  const handleToggleTrackLike = async (track: RadioTrack) => {
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    if (likingTrackId === track.id) return;
    trackClick(`like_radio:${track.id}`, `Вподобайка треку: «${track.title}»`, 'action');
    setLikingTrackId(track.id);
    try {
      let token = await getGuestToken?.();
      if (token?.startsWith('guest_v1.') && getGuestToken) {
        const refreshed = await getGuestToken(true);
        if (refreshed) token = refreshed;
      }
      if (!token) {
        onOpenAuthModal();
        return;
      }
      let res = await fetch(`/api/radio/tracks/${encodeURIComponent(track.id)}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401 && getGuestToken) {
        const refreshedToken = await getGuestToken(true);
        if (refreshedToken && refreshedToken !== token) {
          token = refreshedToken;
          res = await fetch(`/api/radio/tracks/${encodeURIComponent(track.id)}/like`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          });
        }
      }
      if (res.status === 401) {
        onOpenAuthModal();
        return;
      }
      const data = (await res.json()) as {
        liked?: boolean;
        likedRadioTrackIds?: string[];
        likesCount?: number;
      };
      if (!res.ok) return;
      onTrackLiked?.(
        track.id,
        typeof data.likesCount === 'number' ? data.likesCount : (track.likesCount ?? 0),
        Boolean(data.liked),
        Array.isArray(data.likedRadioTrackIds) ? data.likedRadioTrackIds : []
      );
    } catch {
      // Ignore transient network errors
    } finally {
      setLikingTrackId(null);
    }
  };

  const waveSelector = (
    <div className="flex flex-wrap items-center gap-2.5">
      <div
        role="tablist"
        aria-label="Хвилі радіостанції"
        className="inline-flex items-center gap-1 p-1 bg-[#EAE7DF] dark:bg-[#262626] rounded-xl"
      >
        {RADIO_STATIONS.map((station) => {
          const active = radioViewMode === 'stream' && activeStation === station.id;
          const count = stationCounts[station.id];
          return (
            <button
              key={station.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                trackClick(`radio:wave:${station.id}`, `Хвиля: ${station.label}`, 'action');
                setLocalViewMode('stream');
                onChangePlaybackScope?.('repertoire');
                onSelectStation(station.id);
              }}
              className={`touch-surface px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-2 ${
                active
                  ? 'bg-white dark:bg-[#323232] text-[#141413] dark:text-[#F4F1EA] shadow-xs'
                  : 'text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
              }`}
            >
              <span>{station.label}</span>
              {count > 0 && (
                <span className="font-mono text-[11px] opacity-65 tabular-nums">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          const nextMode = radioViewMode === 'saved' ? 'stream' : 'saved';
          setLocalViewMode(nextMode);
          onChangePlaybackScope?.(nextMode === 'saved' ? 'saved' : 'repertoire');
          trackClick(
            nextMode === 'saved' ? 'radio:open_saved_list' : 'radio:close_saved_list',
            nextMode === 'saved' ? 'Радіо: Мій список' : 'Радіо: Ефір',
            'action'
          );
        }}
        aria-pressed={radioViewMode === 'saved'}
        className={`touch-surface px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-2 ${
          radioViewMode === 'saved'
            ? 'bg-[#2C5937] text-white dark:bg-[#F4F1EA] dark:text-[#141413] shadow-xs'
            : 'bg-[#EAE7DF] dark:bg-[#262626] text-[#141413] dark:text-[#F4F1EA] hover:bg-[#E1DDD3] dark:hover:bg-[#323232]'
        }`}
      >
        <ListMusic className="w-4 h-4 shrink-0" strokeWidth={1.85} />
        <span>Мій список</span>
        {savedTracks.length > 0 && (
          <span className="font-mono text-[11px] opacity-80 tabular-nums">
            {savedTracks.length}
          </span>
        )}
      </button>
    </div>
  );

  return (
    <section aria-labelledby="radio-section-heading" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1
          id="radio-section-heading"
          className="text-3xl sm:text-4xl font-semibold tracking-tight text-[#141413] dark:text-[#F4F1EA]"
        >
          Радіо
        </h1>

        {isAuthorized && waveSelector}
      </div>

      <div className="space-y-6">

      {!isAuthorized && (
        <m.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-[28px] bg-gradient-to-b from-[#EFECE4] via-[#EAE6DC] to-[#E2DDD1] dark:from-[#262626] dark:via-[#222222] dark:to-[#1C1C1C] px-6 py-10 sm:px-12 sm:py-14 shadow-[0_24px_60px_-32px_rgba(20,30,22,0.2)] dark:shadow-[0_28px_70px_-30px_rgba(0,0,0,0.8)]"
        >
          {/* Soft ambient lighting */}
          <div
            aria-hidden="true"
            style={{
              background:
                'radial-gradient(ellipse at center, rgba(116, 150, 42, 0.14) 0%, transparent 72%)',
            }}
            className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[420px] h-[240px] rounded-full"
          />
          <div
            aria-hidden="true"
            style={{
              background:
                'radial-gradient(ellipse at center, rgba(44, 89, 55, 0.1) 0%, transparent 72%)',
            }}
            className="pointer-events-none absolute -bottom-24 left-1/2 -translate-x-1/2 w-[340px] h-[180px] rounded-full"
          />

          {/* Delicate corner botanical filigree */}
          <svg
            aria-hidden="true"
            viewBox="0 0 64 64"
            fill="none"
            className="pointer-events-none absolute top-4 left-4 sm:top-5 sm:left-5 w-11 h-11 text-[#2C5937]/18 dark:text-white/15"
          >
            <path
              d="M6 44C7 24 19 11 42 7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <path
              d="M14 27c-3.5-1.2-5.2-3.8-4.5-6.8 3 .3 5.5 2.2 6.1 5.2"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M26 14c-1.4-3.4-.3-6.4 2.3-8.1 2.5 1.8 3.4 4.9 2.2 7.8"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <svg
            aria-hidden="true"
            viewBox="0 0 64 64"
            fill="none"
            className="pointer-events-none absolute bottom-4 right-4 sm:bottom-5 sm:right-5 w-11 h-11 rotate-180 text-[#2C5937]/18 dark:text-white/15"
          >
            <path
              d="M6 44C7 24 19 11 42 7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <path
              d="M14 27c-3.5-1.2-5.2-3.8-4.5-6.8 3 .3 5.5 2.2 6.1 5.2"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M26 14c-1.4-3.4-.3-6.4 2.3-8.1 2.5 1.8 3.4 4.9 2.2 7.8"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <div className="relative z-10 max-w-md mx-auto flex flex-col items-center text-center">
            <div className="space-y-4">
              <p className="text-[15px] sm:text-[17px] leading-[1.75] text-[#242B26] dark:text-[#D4D4D4]">
                Колись хотів зробити свою радіостанцію з красивою музикою, щоб слухати вдень і вночі.
              </p>
              <p className="text-[15px] sm:text-[17px] leading-[1.75] text-[#141A16] dark:text-[#F1EFE7] font-medium">
                Тільки ти і потік музики, який не припиняється.{' '}
                <span className="text-[#2C5937] dark:text-[#E5E5E5] italic">
                  Занурення гарантую!
                </span>
              </p>
            </div>

            {/* Editorial hairline divider */}
            <div aria-hidden="true" className="my-5 flex items-center justify-center gap-3 w-36">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#2C5937]/30 dark:to-white/25" />
              <span className="w-1.5 h-1.5 rotate-45 bg-[#2C5937]/45 dark:bg-white/45" />
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#2C5937]/30 dark:to-white/25" />
            </div>

            <p className="text-xs sm:text-sm tracking-[0.015em] text-[#5C5C58] dark:text-[#C4BFB4] mb-7">
              На вибір дві хвилі — інді та електронна.
            </p>

            <button
              type="button"
              onClick={() => {
                trackClick('radio:open_auth', 'Радіо: Увійти', 'action');
                onOpenAuthModal();
              }}
              className="group relative overflow-hidden inline-flex items-center justify-center gap-3 px-8 py-3.5 rounded-2xl bg-[linear-gradient(135deg,#090D1A_0%,#141B33_50%,#1E1635_100%)] border border-[#818CF8]/40 hover:border-[#C4B5FD]/75 text-[#F4F6FF] text-sm font-medium tracking-[0.04em] shadow-[0_14px_34px_-12px_rgba(10,14,32,0.85),0_0_24px_-8px_rgba(129,140,248,0.38),inset_0_1px_0_rgba(255,255,255,0.18)] hover:shadow-[0_18px_40px_-10px_rgba(10,14,32,0.92),0_0_32px_-4px_rgba(167,139,250,0.55),inset_0_1px_0_rgba(255,255,255,0.28)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all duration-250 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {/* Nebula glow layers */}
              <span
                aria-hidden="true"
                style={{
                  background: 'radial-gradient(circle, rgba(99, 102, 241, 0.34) 0%, transparent 72%)',
                }}
                className="pointer-events-none absolute -left-5 -top-5 w-24 h-24 rounded-full opacity-80 group-hover:opacity-100 transition-opacity duration-300"
              />
              <span
                aria-hidden="true"
                style={{
                  background: 'radial-gradient(circle, rgba(168, 85, 247, 0.28) 0%, transparent 72%)',
                }}
                className="pointer-events-none absolute -right-5 -bottom-5 w-24 h-24 rounded-full opacity-80 group-hover:opacity-100 transition-opacity duration-300"
              />

              {/* Subtle starfield inside the button */}
              <svg
                aria-hidden="true"
                viewBox="0 0 160 52"
                fill="none"
                className="pointer-events-none absolute inset-0 w-full h-full opacity-75 group-hover:opacity-100 transition-opacity duration-300"
              >
                <circle cx="18" cy="12" r="0.8" fill="#E0E7FF" opacity="0.7" />
                <circle cx="34" cy="39" r="0.6" fill="#C4B5FD" opacity="0.6" />
                <circle cx="58" cy="9" r="0.7" fill="#FDE68A" opacity="0.75" />
                <circle cx="116" cy="11" r="0.8" fill="#E0E7FF" opacity="0.65" />
                <circle cx="141" cy="17" r="1" fill="#FDE68A" opacity="0.85" className="animate-pulse" />
                <circle cx="132" cy="40" r="0.7" fill="#A5B4FC" opacity="0.75" />
                <circle cx="88" cy="43" r="0.6" fill="#E0E7FF" opacity="0.5" />
              </svg>

              {/* Starlight sweep on hover */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/14 to-transparent"
              />

              {/* Cosmic radio icon */}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="relative z-10 w-5 h-5 text-[#C7D2FE] transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110"
                aria-hidden="true"
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

              <span className="relative z-10 drop-shadow-[0_1px_8px_rgba(165,180,252,0.45)]">
                Увійти
              </span>
            </button>
          </div>
        </m.div>
      )}

      {!isOnline && (
        <div
          role="status"
          className="rounded-2xl bg-[#EAE7DF]/90 dark:bg-[#262626] px-4 py-3 flex items-center gap-3 text-xs sm:text-sm text-[#3F453E] dark:text-[#D4D4D4]"
        >
          <WifiOff className="w-4 h-4 text-[#2B5434] dark:text-[#E5E5E5] shrink-0" />
          <span>
            Для потокового радіо SoundCloud потрібне підключення до інтернету. Збережені вірші, проза та блог доступні офлайн.
          </span>
        </div>
      )}

      {/* Admin Inline Importer (adds directly to active wave & persists in DB) */}
      {isAdmin && (
        <form
          onSubmit={handleImportSubmit}
          className="rounded-2xl bg-[var(--surface-card)] p-4 sm:p-5 space-y-3 shadow-xs"
        >


          <div className="flex flex-col sm:flex-row gap-2.5">
            <textarea
              id="radio-soundcloud-import"
              rows={1}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="https://soundcloud.com/artist/track або .../sets/playlist"
              disabled={importing || !isOnline}
              className="input-editorial flex-1 min-h-[44px] resize-y font-mono text-xs sm:text-sm py-2.5"
            />
            <button
              type="submit"
              disabled={importing || !urlInput.trim() || !isOnline}
              className="btn-editorial-primary min-h-[44px] px-5 whitespace-nowrap shrink-0"
            >
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Зберігаємо...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Додати й увімкнути</span>
                </>
              )}
            </button>
          </div>

          {adminMessage && (
            <p
              className={`text-xs font-medium ${
                adminMessage.type === 'ok'
                  ? 'text-[#2B5434] dark:text-[#E5E5E5]'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {adminMessage.text}
            </p>
          )}
        </form>
      )}

      {/* Main Deck: Authorized Player */}
      {!isAuthorized ? null : tracks.length === 0 ? (
        <EmptySectionState />
      ) : (
        <div className="space-y-4">
          <m.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl bg-[#202020] text-[#F4F1EA] p-5 sm:p-7 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.65)] space-y-6"
          >
            {/* Active Track Header */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
              <TrackArtwork
                artworkUrl={activeTrack?.artworkUrl}
                title={activeTrack?.title || 'Трек'}
                size="lg"
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-[#E5E5E5]">
                  <span>
                    {playbackScope === 'saved' ? 'Мій список' : activeStationLabel}
                  </span>
                  <span className="text-[#666666]">·</span>
                  <span className="tabular-nums text-[#D8D3C8]">
                    {String(currentIndex + 1).padStart(2, '0')} /{' '}
                    {String(activePlaybackList.length).padStart(2, '0')}
                  </span>
                  {isPlaying && (
                    <>
                      <span className="text-[#666666]">·</span>
                      <span className="inline-flex items-center gap-1.5 text-[#E5E5E5]">
                        <LiveRadioEqualizer isPlaying={isPlaying} tone="accent" size="sm" />
                        <span>В ефірі</span>
                      </span>
                    </>
                  )}
                </div>

                <h2 className="text-xl sm:text-2xl font-semibold text-white truncate">
                  {activeTrack?.title}
                </h2>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-[#B3B3B3] truncate">{activeTrack?.artist}</p>
                  <div className="flex items-center gap-3 shrink-0">
                    {activeTrack && (
                      <button
                        type="button"
                        disabled={likingTrackId === activeTrack.id}
                        onClick={() => void handleToggleTrackLike(activeTrack)}
                        aria-pressed={Boolean(activeTrack.isLiked)}
                        aria-label={
                          activeTrack.isLiked
                            ? `Прибрати вподобайку з «${activeTrack.title}»`
                            : `Вподобати «${activeTrack.title}»`
                        }
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono tabular-nums transition-colors cursor-pointer disabled:opacity-60 ${
                          activeTrack.isLiked
                            ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
                            : 'bg-white/8 text-[#D6D3CB] hover:bg-white/15 hover:text-white'
                        }`}
                      >
                        <Heart
                          className={`w-3.5 h-3.5 transition-transform ${
                            activeTrack.isLiked ? 'fill-rose-400 text-rose-400 scale-110' : ''
                          }`}
                          strokeWidth={1.85}
                        />
                        <span>{activeTrack.likesCount ?? 0}</span>
                      </button>
                    )}
                    {activeSafeHref && (
                      <a
                        href={activeSafeHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#E5E5E5] hover:text-white transition-colors"
                      >
                        <span>Відкрити на SoundCloud</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Seek Bar + Timestamps */}
            <div className="space-y-2">
              <div className="relative flex items-center">
                <input
                  type="range"
                  aria-label="Позиція відтворення"
                  min={0}
                  max={Math.max(1000, durationMs || 1000)}
                  value={Math.min(positionMs, Math.max(1000, durationMs || 1000))}
                  disabled={!durationMs}
                  onChange={(e) => onSeekTo(Number(e.target.value))}
                  style={{
                    background: `linear-gradient(to right, #E5E5E5 ${progressPercent}%, rgba(255,255,255,0.14) ${progressPercent}%)`,
                  }}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[#E5E5E5] disabled:opacity-50"
                />
              </div>
              <div className="flex items-center justify-between font-mono text-[11px] text-[#C4BFB4] tabular-nums">
                <span>{formatDurationMs(positionMs)}</span>
                <span>{durationMs > 0 ? formatDurationMs(durationMs) : '--:--'}</span>
              </div>
            </div>

            {/* Transport Controls + Volume */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={onPrevTrack}
                  disabled={tracks.length === 0}
                  aria-label="Попередній трек"
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-white/8 hover:bg-white/15 text-[#F4F1EA] transition-colors cursor-pointer disabled:opacity-40"
                >
                  <SkipBack className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={onTogglePlay}
                  aria-label={isPlaying ? 'Пауза' : 'Відтворити'}
                  className="w-12 h-12 rounded-full flex items-center justify-center bg-pear-pine-gradient text-white shadow-md hover:brightness-105 active:scale-[0.96] transition-all cursor-pointer"
                >
                  {isLoadingTrack ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="w-5 h-5 fill-current" />
                  ) : (
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={onNextTrack}
                  disabled={tracks.length === 0}
                  aria-label="Наступний трек"
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-white/8 hover:bg-white/15 text-[#F4F1EA] transition-colors cursor-pointer disabled:opacity-40"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onToggleMute}
                  aria-label={isMuted || volume === 0 ? 'Увімкнути звук' : 'Вимкнути звук'}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-[#C4C4C4] hover:text-white hover:bg-white/8 transition-colors cursor-pointer"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  aria-label="Гучність"
                  min={0}
                  max={100}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => onVolumeChange(Number(e.target.value))}
                  className="w-24 sm:w-28 h-1.5 rounded-full appearance-none bg-white/15 accent-[#E5E5E5] cursor-pointer"
                />
              </div>
            </div>

            {playerError && (
              <div className="rounded-xl bg-rose-950/50 px-4 py-3 text-xs text-rose-200 flex flex-wrap items-center justify-between gap-2">
                <span>{playerError}</span>
                <div className="flex flex-wrap items-center gap-3">
                  {onToggleDirectEmbed && (
                    <button
                      type="button"
                      onClick={onToggleDirectEmbed}
                      className="underline font-semibold text-[#E5E5E5] hover:text-white cursor-pointer"
                    >
                      {showDirectEmbed ? 'Сховати плеєр SoundCloud' : 'Відкрити плеєр SoundCloud'}
                    </button>
                  )}
                  {activeSafeHref && (
                    <a
                      href={activeSafeHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-medium hover:text-white"
                    >
                      Слухати на SoundCloud
                    </a>
                  )}
                  {tracks.length > 1 && (
                    <button
                      type="button"
                      onClick={onNextTrack}
                      className="underline font-medium hover:text-white cursor-pointer"
                    >
                      Наступний трек
                    </button>
                  )}
                </div>
              </div>
            )}
          </m.div>

          {/* General Repertoire Queue is intentionally hidden in stream mode; User Saved Playlist shows in Мій список mode */}
          {radioViewMode === 'saved' && (
            <div className="rounded-2xl bg-[var(--surface-card)] overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-black/[0.06] dark:border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 text-rose-500 fill-rose-500" strokeWidth={1.8} />
                  <h3 className="text-sm font-semibold text-[#141413] dark:text-[#F4F1EA]">
                    Мій список вподобаних пісень
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLocalViewMode('stream');
                    onChangePlaybackScope?.('repertoire');
                  }}
                  className="text-xs font-medium text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Повернутись до ефіру
                </button>
              </div>

              {savedTracks.length === 0 ? (
                <div className="px-6 py-10 text-center space-y-2">
                  <Heart
                    className="w-6 h-6 text-[#787872] dark:text-[#A6A196] mx-auto"
                    strokeWidth={1.6}
                  />
                  <p className="text-sm font-medium text-[#141413] dark:text-[#F4F1EA]">
                    Ваш список поки порожній
                  </p>
                  <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] max-w-sm mx-auto">
                    Натискайте серце на плеєрі під час прослуховування — улюблені пісні автоматично збиратимуться тут у ваш персональний плейлист.
                  </p>
                </div>
              ) : (
                <div>
                  {savedTracks.map((track, idx) => {
                    const isCurrent = track.id === activeTrack?.id;
                    const href = getSafeExternalSoundCloudUrl(track.soundcloudUrl);
                    const stationLabel =
                      RADIO_STATIONS.find((s) => s.id === (track.station || 'indie'))?.label ??
                      'Інді';
                    return (
                      <div
                        key={track.id}
                        className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                          isCurrent
                            ? 'bg-[#EAE7DF]/70 dark:bg-[#323232]'
                            : 'hover:bg-[#FAF9F5] dark:hover:bg-[#2C2C2C]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectTrack?.(track.id, true, 'saved')}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer py-0.5"
                        >
                          <span
                            className={`w-6 font-mono text-xs tabular-nums shrink-0 ${
                              isCurrent
                                ? 'text-[#2B5434] dark:text-[#E5E5E5] font-semibold'
                                : 'text-[#787872] dark:text-[#C4BFB4]'
                            }`}
                          >
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <TrackArtwork artworkUrl={track.artworkUrl} title={track.title} />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm truncate ${
                                isCurrent
                                  ? 'font-semibold text-[#141413] dark:text-white'
                                  : 'font-medium text-[#141413] dark:text-[#F4F1EA]'
                              }`}
                            >
                              {track.title}
                            </p>
                            <p className="text-xs text-[#5C5C58] dark:text-[#A6A196] truncate">
                              {track.artist} · {stationLabel}
                            </p>
                          </div>
                        </button>
                        <button
                          type="button"
                          disabled={likingTrackId === track.id}
                          onClick={() => void handleToggleTrackLike(track)}
                          aria-pressed={Boolean(track.isLiked)}
                          aria-label={`Прибрати вподобайку з «${track.title}»`}
                          title="Прибрати зі списку"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg font-mono text-xs tabular-nums transition-colors cursor-pointer shrink-0 disabled:opacity-60 text-rose-600 dark:text-rose-400 bg-rose-500/12 hover:bg-rose-500/20"
                        >
                          <Heart className="w-3.5 h-3.5 fill-rose-600 dark:fill-rose-400" strokeWidth={1.8} />
                          {(track.likesCount ?? 0) > 0 && <span>{track.likesCount}</span>}
                        </button>
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Відкрити ${track.title} на SoundCloud`}
                            title="Відкрити на SoundCloud"
                            className="p-2 rounded-lg text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-white hover:bg-[#EAE7DF] dark:hover:bg-[#3A3A3A] transition-colors shrink-0"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteTrack(track.id)}
                            aria-label="Видалити трек із бази"
                            title="Видалити трек"
                            className="p-2 rounded-lg text-rose-700 dark:text-rose-400 hover:bg-rose-700/10 cursor-pointer shrink-0 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </section>
  );
});
