import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Eye,
  ExternalLink,
  Film,
  LayoutGrid,
  List,
  Loader2,
  Music2,
  Pause,
  Play,
  Quote,
  Search,
  ShieldAlert,
  Star,
  Video,
  X,
  ZoomIn,
} from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOnlineStatus } from '../hooks/useOnlineStatus.ts';
import type { BlogPost } from '../types.ts';
import { setActiveMoment, trackClick } from '../utils/analytics.ts';
import {
  extractBlogFilmMeta,
  getYouTubeEmbedUrl,
  getYouTubeThumbnailUrl,
  getYouTubeWatchUrl,
  parseBlogContentBlocks,
  type BlogFilmMetaItem,
  type BlogPhotoMediaItem,
  type BlogTrackMediaItem,
  type BlogYoutubeMediaItem,
} from '../utils/blogMedia.ts';
import {
  formatDurationMs,
  getSoundCloudPlayerSrc,
  loadSoundCloudWidgetApi,
  type SCPlayProgressPayload,
  type SCWidgetInstance,
} from '../utils/soundcloudWidget.ts';
import { useTouchFeedback } from '../utils/useTouchFeedback.ts';
import { EmptySectionState } from './EmptySectionState.tsx';
import { ShareButton } from './ShareButton.tsx';

interface BlogSectionProps {
  posts: BlogPost[];
  onPostViewed: (postId: string, viewsCount: number) => void;
  onPostUpdated?: (post: BlogPost) => void;
  initialPostId?: string | null;
  onActivePostChange?: (postId: string | null) => void;
}

type BlogSortMode = 'newest' | 'rating' | 'views' | 'quick';
type BlogLayoutMode = 'grid' | 'list';

interface EnrichedBlogEntry {
  post: BlogPost;
  filmMeta: BlogFilmMetaItem | null;
  posterUrl: string | null;
  soundtracksCount: number;
  videosCount: number;
  stillsCount: number;
  originalIndex: number;
}

const MASTHEAD_IMAGE_URL = '/src/assets/images/cinema_buddha_masthead_1795773444987.jpg';
const SAVED_BOOKMARKS_STORAGE_KEY = 'bdk_saved_post_ids_v1';

function readSavedPostIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_BOOKMARKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
  } catch {
    return [];
  }
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

function formatRuntimeUk(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs <= 0) return `${mins} хв`;
  if (mins === 0) return `${hrs} год`;
  return `${hrs} год ${mins} хв`;
}

function FilmPosterFrame({
  src,
  alt,
  fallbackTitle,
  fallbackSubtitle,
  className = '',
  rating,
}: {
  src: string | null;
  alt: string;
  fallbackTitle: string;
  fallbackSubtitle?: string;
  className?: string;
  rating?: number;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div
      className={`relative overflow-hidden bg-[#18161A] ${className}`}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          width={640}
          height={420}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] block"
        />
      ) : (
        <div
          aria-hidden="true"
          className="w-full h-full flex flex-col items-center justify-center p-5 text-center bg-[radial-gradient(circle_at_30%_25%,rgba(229,9,20,0.22),transparent_62%),linear-gradient(145deg,#171519_0%,#221D21_55%,#141215_100%)]"
        >
          <Film className="w-7 h-7 text-[#E50914]/75 mb-2.5" strokeWidth={1.5} />
          <p className="font-editorial-display text-base sm:text-lg italic text-[#EDEAE1]/90 line-clamp-2 max-w-[26ch]">
            {fallbackTitle}
          </p>
          {fallbackSubtitle && (
            <p className="mt-1 text-[11px] text-[#B0A99E] line-clamp-1">
              {fallbackSubtitle}
            </p>
          )}
        </div>
      )}

      {/* Subtle cinema gradient scrim for contrast */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent"
      />

      {typeof rating === 'number' && rating > 0 && (
        <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-black/85 text-[#FDE68A] font-mono text-xs font-semibold tabular-nums">
          <Star className="w-3 h-3 fill-[#FACC15] text-[#FACC15]" strokeWidth={1.75} />
          <span>{rating.toFixed(1)}</span>
          <span className="text-white/55 text-[10px]">/10</span>
        </div>
      )}
    </div>
  );
}

function BlogSoundCloudTrackCard({
  track,
  isActive,
  onActivate,
  onDeactivate,
}: {
  track: BlogTrackMediaItem;
  isActive: boolean;
  onActivate: (trackId: string) => void;
  onDeactivate: (trackId: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const widgetRef = useRef<SCWidgetInstance | null>(null);
  const widgetReadyRef = useRef(false);
  const pendingPlayRef = useRef(false);
  const [iframeMounted, setIframeMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [showNativeEmbed, setShowNativeEmbed] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  const playerSrc = useMemo(
    () => getSoundCloudPlayerSrc(track.embedTargetUrl || track.soundcloudUrl, false),
    [track.embedTargetUrl, track.soundcloudUrl]
  );

  const safeHref = useMemo(
    () => getSafeExternalSoundCloudUrl(track.soundcloudUrl),
    [track.soundcloudUrl]
  );

  const safeArtwork = useMemo(() => {
    if (!track.artworkUrl) return null;
    try {
      const parsed = new URL(track.artworkUrl);
      return parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch {
      return null;
    }
  }, [track.artworkUrl]);

  useEffect(() => {
    if (!isActive && isPlaying) {
      try {
        widgetRef.current?.pause();
      } catch {
        // Ignore transient pause errors
      }
      setIsPlaying(false);
    }
  }, [isActive, isPlaying]);

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
              widget.play();
            } catch {
              setIsLoading(false);
              setShowNativeEmbed(true);
            }
          }
        });

        widget.bind(WidgetFactory.Events.PLAY, () => {
          if (cancelled || !widget) return;
          setIsPlaying(true);
          setIsLoading(false);
          setPlayerError(null);
          onActivate(track.id);
          widget.getDuration((dur) => {
            if (!cancelled && Number.isFinite(dur) && dur > 0) setDurationMs(dur);
          });
        });

        widget.bind(WidgetFactory.Events.PAUSE, () => {
          if (cancelled) return;
          setIsPlaying(false);
          setIsLoading(false);
        });

        widget.bind(WidgetFactory.Events.FINISH, () => {
          if (cancelled) return;
          setIsPlaying(false);
          setIsLoading(false);
          setPositionMs(0);
          onDeactivate(track.id);
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
          setIsPlaying(false);
          setIsLoading(false);
          setPlayerError('Не вдалося запустити аудіодоріжку фільму. Скористайтесь плеєром SoundCloud.');
          setShowNativeEmbed(true);
        });
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
        setShowNativeEmbed(true);
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
  }, [iframeMounted, playerSrc, track.id]);

  const handleTogglePlay = () => {
    setPlayerError(null);
    if (!isOnline) {
      setPlayerError('Для відтворення саундтреку потрібне підключення до інтернету.');
      return;
    }
    if (!iframeMounted) {
      pendingPlayRef.current = true;
      setIsLoading(true);
      onActivate(track.id);
      setIframeMounted(true);
      return;
    }

    const widget = widgetRef.current;
    if (!widget || !widgetReadyRef.current) {
      pendingPlayRef.current = true;
      setIsLoading(true);
      onActivate(track.id);
      return;
    }

    if (isPlaying) {
      widget.pause();
      setIsPlaying(false);
      onDeactivate(track.id);
    } else {
      onActivate(track.id);
      setIsLoading(true);
      try {
        widget.play();
      } catch {
        setIsLoading(false);
        setShowNativeEmbed(true);
      }
    }
  };

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

  const progressPct =
    durationMs > 0 ? Math.min(100, Math.max(0, (positionMs / durationMs) * 100)) : 0;

  return (
    <div className="my-6 rounded-xl bg-[#161518] text-white p-4 sm:p-5 border border-white/10 space-y-3">
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={handleTogglePlay}
          aria-label={isPlaying ? `Пауза: ${track.title}` : `Відтворити: ${track.title}`}
          className="w-11 h-11 rounded-lg bg-[#E50914] hover:bg-[#C80812] text-white inline-flex items-center justify-center shrink-0 active:scale-[0.96] transition-all cursor-pointer"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-5 h-5 fill-current" />
          ) : (
            <Play className="w-5 h-5 fill-current ml-0.5" />
          )}
        </button>

        {safeArtwork && !artworkFailed ? (
          <img
            src={safeArtwork}
            alt={track.title}
            width={44}
            height={44}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setArtworkFailed(true)}
            className="w-11 h-11 rounded-lg object-cover shrink-0 bg-[#2E2E32]"
          />
        ) : (
          <div
            aria-hidden="true"
            className="w-11 h-11 rounded-lg shrink-0 flex items-center justify-center bg-[#2E2E32] text-white/60"
          >
            <Music2 className="w-5 h-5" strokeWidth={1.65} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-[#FDA4AF] mb-0.5">
            Саундтрек до стрічки
          </p>
          <p className="text-sm font-semibold text-white truncate leading-snug">
            {track.title}
          </p>
          <p className="text-xs text-white/60 truncate">
            {track.artist} · SoundCloud
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {playerSrc && (
            <button
              type="button"
              onClick={() => {
                if (!iframeMounted) setIframeMounted(true);
                setShowNativeEmbed((prev) => !prev);
              }}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/80 hover:text-white bg-white/10 hover:bg-white/15 transition-colors cursor-pointer whitespace-nowrap"
            >
              {showNativeEmbed ? 'Сховати' : 'Плеєр'}
            </button>
          )}
          {safeHref && (
            <a
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Відкрити на SoundCloud"
              aria-label={`Відкрити «${track.title}» на SoundCloud`}
              className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              <ExternalLink className="w-4 h-4" strokeWidth={1.75} />
            </a>
          )}
        </div>
      </div>

      {(durationMs > 0 || isPlaying) && (
        <div className="flex items-center gap-2.5 pt-1">
          <span className="font-mono text-[11px] text-white/60 tabular-nums w-10">
            {formatDurationMs(positionMs)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(durationMs, 1000)}
            value={Math.min(positionMs, Math.max(durationMs, 1000))}
            onChange={(e) => handleSeek(Number(e.target.value))}
            aria-label={`Перемотати саундтрек «${track.title}»`}
            style={{
              background: `linear-gradient(to right, #E50914 ${progressPct}%, rgba(255,255,255,0.2) ${progressPct}%)`,
            }}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-[#E50914]"
          />
          <span className="font-mono text-[11px] text-white/60 tabular-nums w-10 text-right">
            {formatDurationMs(durationMs)}
          </span>
        </div>
      )}

      {playerError && (
        <p className="text-xs text-amber-300">{playerError}</p>
      )}

      {iframeMounted && playerSrc && (
        <div
          className={
            showNativeEmbed
              ? 'pt-1 overflow-hidden rounded-xl'
              : 'fixed bottom-0 right-0 w-[300px] h-[166px] opacity-[0.01] pointer-events-none -z-10'
          }
        >
          <iframe
            ref={iframeRef}
            title={`${track.title} — SoundCloud`}
            src={playerSrc}
            allow="autoplay; encrypted-media"
            tabIndex={showNativeEmbed ? 0 : -1}
            className="w-full h-[166px] rounded-xl border-0 block"
          />
        </div>
      )}
    </div>
  );
}

function BlogYouTubeVideoCard({ video }: { video: BlogYoutubeMediaItem }) {
  const [isActivated, setIsActivated] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [offlineError, setOfflineError] = useState(false);
  const isOnline = useOnlineStatus();

  const watchUrl = useMemo(() => {
    try {
      const parsed = new URL(video.youtubeUrl || getYouTubeWatchUrl(video.videoId));
      return parsed.protocol === 'https:' || parsed.protocol === 'http:'
        ? parsed.toString()
        : getYouTubeWatchUrl(video.videoId);
    } catch {
      return getYouTubeWatchUrl(video.videoId);
    }
  }, [video.videoId, video.youtubeUrl]);

  const embedUrl = useMemo(
    () => `${getYouTubeEmbedUrl(video.videoId)}&autoplay=1`,
    [video.videoId]
  );

  const thumbnailSrc = useMemo(
    () => video.thumbnailUrl || getYouTubeThumbnailUrl(video.videoId),
    [video.thumbnailUrl, video.videoId]
  );

  const handleActivate = () => {
    if (!isOnline) {
      setOfflineError(true);
      return;
    }
    setOfflineError(false);
    setIsActivated(true);
  };

  return (
    <figure className="my-7 space-y-2">
      <div className="rounded-2xl overflow-hidden bg-[#161518] text-white border border-white/10 shadow-md">
        <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-[#E50914] text-white inline-flex items-center justify-center shrink-0">
              <Video className="w-3.5 h-3.5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-white truncate leading-snug">
                {video.title}
              </p>
              <p className="text-[11px] text-white/60 truncate">
                {video.authorName ? `${video.authorName} · YouTube` : 'YouTube'}
              </p>
            </div>
          </div>

          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Відкрити на YouTube"
            aria-label={`Відкрити «${video.title}» на YouTube`}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/80 hover:text-white bg-white/10 hover:bg-white/15 transition-colors shrink-0 whitespace-nowrap"
          >
            <span>YouTube</span>
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.75} />
          </a>
        </div>

        <div className="relative aspect-video w-full bg-black">
          {isActivated ? (
            <iframe
              src={embedUrl}
              title={video.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              className="w-full h-full border-0 block"
            />
          ) : (
            <button
              type="button"
              onClick={handleActivate}
              aria-label={`Відтворити відео «${video.title}»`}
              className="group relative w-full h-full flex items-center justify-center cursor-pointer focus:outline-none"
            >
              {!thumbFailed && (
                <img
                  src={thumbnailSrc}
                  alt={video.title}
                  width={640}
                  height={360}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setThumbFailed(true)}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
                />
              )}
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/30 group-hover:bg-black/35 transition-colors"
              />
              <span className="relative z-10 w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#E50914] group-hover:bg-[#C80812] text-white inline-flex items-center justify-center shadow-xl group-hover:scale-105 transition-transform">
                <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current ml-0.5" />
              </span>
            </button>
          )}
        </div>

        {offlineError && (
          <p className="px-4 py-2 text-xs text-amber-300 bg-black/40">
            Для відтворення відео з YouTube потрібне підключення до інтернету.
          </p>
        )}
      </div>

      {video.caption && (
        <figcaption className="text-xs text-[#5C5C58] dark:text-[#A8A49B] text-center leading-relaxed">
          {video.caption}
        </figcaption>
      )}
    </figure>
  );
}

export const BlogSection = memo(function BlogSection({
  posts,
  onPostViewed,
  onPostUpdated,
  initialPostId,
  onActivePostChange,
}: BlogSectionProps) {
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [largeText, setLargeText] = useState(false);
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [zoomedPhotoIndex, setZoomedPhotoIndex] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<BlogSortMode>('newest');
  const [layoutMode, setLayoutMode] = useState<BlogLayoutMode>('grid');
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [savedPostIds, setSavedPostIds] = useState<string[]>(readSavedPostIds);
  const [revealedSpoilerIds, setRevealedSpoilerIds] = useState<Record<string, boolean>>({});
  const [readProgress, setReadProgress] = useState(0);
  const [mastheadFailed, setMastheadFailed] = useState(false);
  const [loadingPostId, setLoadingPostId] = useState<string | null>(null);

  const modalScrollRef = useRef<HTMLDivElement | null>(null);
  const handledDeepLinkRef = useRef<string | null>(null);
  const fetchingPostIdsRef = useRef<Set<string>>(new Set());
  const { getTouchProps, isTouchActive } = useTouchFeedback();

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVED_BOOKMARKS_STORAGE_KEY, JSON.stringify(savedPostIds));
    } catch {
      // Ignore storage write errors
    }
  }, [savedPostIds]);

  const savedSet = useMemo(() => new Set(savedPostIds), [savedPostIds]);

  const toggleSavePost = useCallback((postId: string) => {
    setSavedPostIds((prev) =>
      prev.includes(postId) ? prev.filter((id) => id !== postId) : [postId, ...prev]
    );
  }, []);

  const enrichedEntries = useMemo<EnrichedBlogEntry[]>(() => {
    return posts.map((post, idx) => {
      const { filmMeta, firstPhotoUrl, firstVideoThumbnailUrl } = extractBlogFilmMeta(post.content);
      const blocks = parseBlogContentBlocks(post.content);
      const soundtracksCount = blocks.filter((b) => b.type === 'track').length;
      const videosCount = blocks.filter((b) => b.type === 'youtube').length;
      const stillsCount = blocks.filter((b) => b.type === 'photo').length;
      const posterUrl =
        (typeof post.coverImage === 'string' && post.coverImage.trim()) ||
        firstPhotoUrl ||
        firstVideoThumbnailUrl ||
        null;
      return {
        post,
        filmMeta,
        posterUrl,
        soundtracksCount,
        videosCount,
        stillsCount,
        originalIndex: idx,
      };
    });
  }, [posts]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of enrichedEntries) {
      const cat = entry.post.category?.trim();
      if (!cat) continue;
      map.set(cat, (map.get(cat) || 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [enrichedEntries]);

  const cinemaStats = useMemo(() => {
    const rated = enrichedEntries
      .map((e) => e.filmMeta?.rating)
      .filter((r): r is number => typeof r === 'number' && r > 0);
    const avgRating =
      rated.length > 0 ? rated.reduce((sum, val) => sum + val, 0) / rated.length : null;
    const savedCount = enrichedEntries.filter((e) => savedSet.has(e.post.id)).length;
    return {
      total: enrichedEntries.length,
      ratedCount: rated.length,
      avgRating,
      savedCount,
    };
  }, [enrichedEntries, savedSet]);

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let list = enrichedEntries.filter((entry) => {
      if (showBookmarksOnly && !savedSet.has(entry.post.id)) {
        return false;
      }
      if (
        selectedCategory &&
        entry.post.category?.trim().toLowerCase() !== selectedCategory.toLowerCase()
      ) {
        return false;
      }
      if (query) {
        const haystack = [
          entry.post.title,
          entry.post.category,
          entry.post.excerpt,
          entry.filmMeta?.filmTitle,
          entry.filmMeta?.director,
          entry.filmMeta?.country,
          entry.filmMeta?.releaseYear ? String(entry.filmMeta.releaseYear) : '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    if (sortMode === 'rating') {
      list = [...list].sort(
        (a, b) =>
          (b.filmMeta?.rating ?? -1) - (a.filmMeta?.rating ?? -1) ||
          a.originalIndex - b.originalIndex
      );
    } else if (sortMode === 'views') {
      list = [...list].sort(
        (a, b) => (b.post.viewsCount || 0) - (a.post.viewsCount || 0) || a.originalIndex - b.originalIndex
      );
    } else if (sortMode === 'quick') {
      list = [...list].sort(
        (a, b) =>
          (a.post.readingMinutes || 1) - (b.post.readingMinutes || 1) ||
          a.originalIndex - b.originalIndex
      );
    }

    return list;
  }, [enrichedEntries, selectedCategory, searchQuery, sortMode, showBookmarksOnly, savedSet]);

  const activeEntry = useMemo(
    () => enrichedEntries.find((e) => e.post.id === activePostId) || null,
    [enrichedEntries, activePostId]
  );

  const activePost = activeEntry?.post || null;

  const activeBlocks = useMemo(
    () => (activePost ? parseBlogContentBlocks(activePost.content) : []),
    [activePost]
  );

  const activePhotos = useMemo<BlogPhotoMediaItem[]>(
    () =>
      activeBlocks
        .filter((b): b is { type: 'photo'; item: BlogPhotoMediaItem } => b.type === 'photo')
        .map((b) => b.item),
    [activeBlocks]
  );

  const activeFilteredIdx = useMemo(() => {
    if (!activePost) return -1;
    return filteredEntries.findIndex((e) => e.post.id === activePost.id);
  }, [filteredEntries, activePost]);

  const prevEntry = activeFilteredIdx > 0 ? filteredEntries[activeFilteredIdx - 1] : null;
  const nextEntry =
    activeFilteredIdx >= 0 && activeFilteredIdx < filteredEntries.length - 1
      ? filteredEntries[activeFilteredIdx + 1]
      : null;

  const trackPostView = (postId: string) => {
    fetch(`/api/blog/${encodeURIComponent(postId)}/view`, { method: 'POST' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.viewsCount === 'number') {
          onPostViewed(postId, data.viewsCount);
        }
      })
      .catch(() => {
        // Ignore transient view tracking errors
      });
  };

  const hydrateBlogPost = useCallback(
    async (post: BlogPost) => {
      if (!post.contentTruncated || fetchingPostIdsRef.current.has(post.id)) return;
      fetchingPostIdsRef.current.add(post.id);
      setLoadingPostId(post.id);
      try {
        const res = await fetch(`/api/blog/${encodeURIComponent(post.id)}/read`);
        if (!res.ok) return;
        const data = (await res.json()) as { content?: string };
        if (typeof data.content === 'string') {
          onPostUpdated?.({
            ...post,
            content: data.content,
            contentTruncated: false,
          });
        }
      } catch {
        // Keep truncated preview offline or on transient network error
      } finally {
        fetchingPostIdsRef.current.delete(post.id);
        setLoadingPostId((prev) => (prev === post.id ? null : prev));
      }
    },
    [onPostUpdated]
  );

  useEffect(() => {
    if (!initialPostId) {
      handledDeepLinkRef.current = null;
      return;
    }
    if (handledDeepLinkRef.current === initialPostId) return;
    const matched = posts.find((p) => p.id === initialPostId);
    if (matched) {
      handledDeepLinkRef.current = initialPostId;
      setActivePostId(matched.id);
      setPlayingTrackId(null);
      setReadProgress(0);
      trackPostView(matched.id);
      if (matched.contentTruncated) {
        void hydrateBlogPost(matched);
      }
    }
  }, [initialPostId, posts, hydrateBlogPost]);

  useEffect(() => {
    if (activePost) {
      setActiveMoment({
        targetKey: `blog:${activePost.id}`,
        momentKey: `blog:${activePost.id}`,
        label: `БДК: «${activePost.title}»`,
        category: 'blog',
        section: 'blog',
      });
    } else {
      setActiveMoment({
        targetKey: 'section:blog',
        momentKey: 'blog',
        label: 'Розділ: БДК (Будда дивиться кіно)',
        category: 'section',
        section: 'blog',
      });
    }
  }, [activePost]);

  const handleOpenPost = (post: BlogPost) => {
    trackClick(`blog:${post.id}`, `БДК: «${post.title}»`, 'content');
    handledDeepLinkRef.current = post.id;
    setActivePostId(post.id);
    setPlayingTrackId(null);
    setZoomedPhotoIndex(null);
    setReadProgress(0);
    onActivePostChange?.(post.id);
    trackPostView(post.id);
    if (post.contentTruncated) {
      void hydrateBlogPost(post);
    }
    if (modalScrollRef.current) {
      modalScrollRef.current.scrollTop = 0;
    }
  };

  const handleClosePost = useCallback(() => {
    setActivePostId(null);
    setPlayingTrackId(null);
    setZoomedPhotoIndex(null);
    setReadProgress(0);
    onActivePostChange?.(null);
  }, [onActivePostChange]);

  // Keyboard support for Lightbox and Reader Modal
  useEffect(() => {
    if (!activePost && zoomedPhotoIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomedPhotoIndex !== null) {
          setZoomedPhotoIndex(null);
        } else if (activePost) {
          handleClosePost();
        }
        return;
      }
      if (zoomedPhotoIndex !== null && activePhotos.length > 1) {
        if (e.key === 'ArrowRight') {
          setZoomedPhotoIndex((prev) =>
            prev === null ? 0 : (prev + 1) % activePhotos.length
          );
        } else if (e.key === 'ArrowLeft') {
          setZoomedPhotoIndex((prev) =>
            prev === null ? 0 : (prev - 1 + activePhotos.length) % activePhotos.length
          );
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activePost, zoomedPhotoIndex, activePhotos.length, handleClosePost]);

  const handleModalScroll = () => {
    const el = modalScrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) {
      setReadProgress(100);
      return;
    }
    setReadProgress(Math.min(100, Math.max(0, (el.scrollTop / maxScroll) * 100)));
  };

  const getBlogShareUrl = (postId: string) =>
    `${window.location.origin}${window.location.pathname}#blog/${encodeURIComponent(postId)}`;

  const showFeaturedLead =
    layoutMode === 'grid' &&
    !selectedCategory &&
    !searchQuery.trim() &&
    !showBookmarksOnly &&
    sortMode === 'newest' &&
    filteredEntries.length > 1;

  const leadEntry = showFeaturedLead ? filteredEntries[0] : null;
  const gridEntries = showFeaturedLead ? filteredEntries.slice(1) : filteredEntries;

  const zoomedPhoto =
    zoomedPhotoIndex !== null && activePhotos[zoomedPhotoIndex]
      ? activePhotos[zoomedPhotoIndex]
      : null;

  const isSpoilerGated = Boolean(
    activeEntry?.filmMeta?.hasSpoilers &&
      activePost &&
      !revealedSpoilerIds[activePost.id]
  );

  const hasFiltersActive =
    Boolean(selectedCategory) || Boolean(searchQuery.trim()) || showBookmarksOnly;

  return (
    <section id="blog" className="space-y-6">
      <h2 className="sr-only">Будда дивиться кіно — кіноблог Андрія Даньківа</h2>

      {/* Editorial Cinema Journal Masthead */}
      <header className="relative overflow-hidden rounded-2xl bg-[#131114] text-[#EDEAE1] shadow-xl border border-white/10">
        {!mastheadFailed && (
          <img
            src={MASTHEAD_IMAGE_URL}
            alt="Кінозал із променем проєктора"
            width={1200}
            height={400}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setMastheadFailed(true)}
            className="absolute inset-0 w-full h-full object-cover object-center opacity-55 pointer-events-none select-none"
          />
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#110F13]/95 via-[#161318]/88 to-[#121014]/72"
        />

        <div className="relative z-10 px-5 py-6 sm:px-7 sm:py-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <Clapperboard className="w-6 h-6 text-[#E50914] shrink-0" strokeWidth={1.85} />
            <h3 className="font-editorial-display text-2xl sm:text-3xl font-semibold tracking-[-0.015em] text-white leading-tight">
              Будда дивиться кіно
            </h3>
          </div>

          <div className="flex items-center gap-3 text-xs text-[#D6D1C7] tabular-nums shrink-0 font-mono">
            <span>
              {cinemaStats.total} {cinemaStats.total === 1 ? 'рецензія' : 'рецензій'}
            </span>
            {cinemaStats.avgRating !== null && (
              <>
                <span aria-hidden="true" className="text-white/25">·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-[#FDE68A]">
                  <Star className="w-3.5 h-3.5 fill-[#FACC15] text-[#FACC15]" strokeWidth={1.75} />
                  <span>{cinemaStats.avgRating.toFixed(1)}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Search, Sort, View Switcher & Genre Filters */}
      {posts.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            {/* Search Input */}
            <div className="relative flex-1 min-w-0">
              <Search
                className="w-4 h-4 text-[#787872] dark:text-[#9E978D] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                strokeWidth={1.85}
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Пошук за фільмом, режисером або назвою..."
                aria-label="Пошук у кіноблозі"
                className="w-full h-10 pl-10 pr-9 rounded-xl text-sm bg-white dark:bg-[#262626] text-[#141413] dark:text-[#F4F1EA] placeholder:text-[#787872] dark:placeholder:text-[#8E887E] border border-black/8 dark:border-white/8 focus:outline-none focus:border-[#E50914]/60 transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Очистити пошук"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md inline-flex items-center justify-center text-[#787872] hover:text-[#141413] dark:hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {/* Sort Selector */}
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as BlogSortMode)}
                aria-label="Сортування рецензій"
                className="h-10 px-3 rounded-xl text-xs font-medium bg-white dark:bg-[#262626] text-[#141413] dark:text-[#F4F1EA] border border-black/8 dark:border-white/8 focus:outline-none focus:border-[#E50914]/60 cursor-pointer"
              >
                <option value="newest">Найновіші</option>
                <option value="rating">За оцінкою автора</option>
                <option value="views">Найпопулярніші</option>
                <option value="quick">Короткі розбори</option>
              </select>

              {/* Saved Bookmarks Toggle */}
              <button
                type="button"
                onClick={() => setShowBookmarksOnly((prev) => !prev)}
                aria-pressed={showBookmarksOnly}
                aria-label="Збережені рецензії"
                title="Збережені рецензії"
                className={`h-10 px-3 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0 border ${
                  showBookmarksOnly
                    ? 'bg-[#E50914] text-white border-[#E50914]'
                    : 'bg-white dark:bg-[#262626] text-[#4D4D48] dark:text-[#D8D3C8] border-black/8 dark:border-white/8 hover:text-[#141413] dark:hover:text-white'
                }`}
              >
                <Bookmark
                  className={`w-3.5 h-3.5 ${showBookmarksOnly ? 'fill-current' : ''}`}
                  strokeWidth={1.8}
                />
                {cinemaStats.savedCount > 0 && (
                  <span className="font-mono text-[11px] tabular-nums">
                    {cinemaStats.savedCount}
                  </span>
                )}
              </button>

              {/* Layout Switcher */}
              <div
                role="group"
                aria-label="Формат списку"
                className="inline-flex items-center p-1 rounded-xl bg-[#EAE7DF] dark:bg-[#262626] border border-black/5 dark:border-white/8"
              >
                <button
                  type="button"
                  onClick={() => setLayoutMode('grid')}
                  aria-label="Сітка постерів"
                  aria-pressed={layoutMode === 'grid'}
                  className={`w-8 h-8 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                    layoutMode === 'grid'
                      ? 'bg-white dark:bg-[#383838] text-[#141413] dark:text-white shadow-xs'
                      : 'text-[#5C5C58] dark:text-[#9E978D] hover:text-[#141413] dark:hover:text-white'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode('list')}
                  aria-label="Компактний архів"
                  aria-pressed={layoutMode === 'list'}
                  className={`w-8 h-8 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                    layoutMode === 'list'
                      ? 'bg-white dark:bg-[#383838] text-[#141413] dark:text-white shadow-xs'
                      : 'text-[#5C5C58] dark:text-[#9E978D] hover:text-[#141413] dark:hover:text-white'
                  }`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Category / Genre Filter Bar */}
          {categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Жанри кіноблогу">
              <button
                type="button"
                role="tab"
                aria-selected={selectedCategory === null}
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  selectedCategory === null
                    ? 'bg-[#141413] text-white dark:bg-[#F4F1EA] dark:text-[#181818] font-semibold'
                    : 'bg-[#EAE7DF] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-white'
                }`}
              >
                Усі жанри ({posts.length})
              </button>
              {categories.map(({ name, count }) => {
                const active = selectedCategory?.toLowerCase() === name.toLowerCase();
                return (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedCategory(name)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-[#141413] text-white dark:bg-[#F4F1EA] dark:text-[#181818] font-semibold'
                        : 'bg-[#EAE7DF] dark:bg-[#262626] text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-white'
                    }`}
                  >
                    <span>{name}</span>
                    <span className="ml-1.5 font-mono text-[11px] opacity-75 tabular-nums">
                      ({count})
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Content Area */}
      {posts.length === 0 ? (
        <EmptySectionState />
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-[#262626] border border-black/5 dark:border-white/5 px-6 py-12 text-center space-y-3">
          <Film className="w-8 h-8 text-[#787872] dark:text-[#8E887E] mx-auto" strokeWidth={1.5} />
          <p className="text-sm font-semibold text-[#141413] dark:text-[#F4F1EA]">
            {showBookmarksOnly
              ? 'Немає збережених рецензій'
              : 'Нічого не знайдено'}
          </p>
          {hasFiltersActive && (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory(null);
                setSearchQuery('');
                setShowBookmarksOnly(false);
              }}
              className="btn-editorial-secondary mt-2"
            >
              Показати всі рецензії
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Featured Spotlight Review Card */}
          {leadEntry && (
            <m.article
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="group rounded-2xl overflow-hidden bg-white dark:bg-[#262626] border border-black/6 dark:border-white/8 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpenPost(leadEntry.post)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenPost(leadEntry.post);
                    }
                  }}
                  aria-label={`Читати рецензію «${leadEntry.post.title}»`}
                  className="lg:col-span-5 cursor-pointer min-h-[220px] lg:min-h-[290px]"
                >
                  <FilmPosterFrame
                    src={leadEntry.posterUrl}
                    alt={leadEntry.filmMeta?.filmTitle || leadEntry.post.title}
                    fallbackTitle={leadEntry.filmMeta?.filmTitle || leadEntry.post.title}
                    fallbackSubtitle={leadEntry.filmMeta?.director}
                    rating={leadEntry.filmMeta?.rating}
                    className="w-full h-full"
                  />
                </div>

                <div className="lg:col-span-7 p-5 sm:p-6 md:p-7 flex flex-col justify-between gap-4">
                  <div className="space-y-3">
                    {/* Unboxed Metadata Line */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                      <span className="font-semibold text-[#C80812] dark:text-[#FDA4AF]">
                        Свіжа рецензія
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{leadEntry.post.category || 'Кіноблог'}</span>
                      {leadEntry.filmMeta?.releaseYear && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{leadEntry.filmMeta.releaseYear}</span>
                        </>
                      )}
                      {leadEntry.filmMeta?.country && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{leadEntry.filmMeta.country}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{leadEntry.post.readingMinutes} хв читання</span>
                    </div>

                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleOpenPost(leadEntry.post)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleOpenPost(leadEntry.post);
                        }
                      }}
                      className="cursor-pointer space-y-2 text-left"
                    >
                      <h3 className="font-editorial-display text-2xl sm:text-3xl font-semibold tracking-[-0.015em] text-[#141413] dark:text-[#F4F1EA] group-hover:text-[#E50914] dark:group-hover:text-[#FDA4AF] transition-colors leading-tight">
                        {leadEntry.post.title}
                      </h3>

                      {(leadEntry.filmMeta?.filmTitle || leadEntry.filmMeta?.director) && (
                        <p className="text-xs sm:text-sm font-medium text-[#4D4D48] dark:text-[#D8D3C8]">
                          {[
                            leadEntry.filmMeta?.filmTitle,
                            leadEntry.filmMeta?.director ? `реж. ${leadEntry.filmMeta.director}` : null,
                            leadEntry.filmMeta?.runtimeMinutes
                              ? formatRuntimeUk(leadEntry.filmMeta.runtimeMinutes)
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}

                      <p className="text-sm text-[#5C5C58] dark:text-[#A8A49B] line-clamp-3 leading-relaxed">
                        {leadEntry.post.excerpt}
                      </p>
                    </div>

                    {leadEntry.filmMeta?.verdict && (
                      <p className="text-xs italic text-[#4D4D48] dark:text-[#D6D1C7] pt-1">
                        «{leadEntry.filmMeta.verdict}»
                      </p>
                    )}
                  </div>

                  <div className="pt-3.5 border-t border-[#EFECE6] dark:border-[#323232] flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-3 text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{leadEntry.post.publishedAt}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Eye className="w-3.5 h-3.5" strokeWidth={1.75} />
                        <span>{leadEntry.post.viewsCount}</span>
                      </span>
                      {leadEntry.soundtracksCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[#9F1239] dark:text-[#FDA4AF]">
                          <Music2 className="w-3.5 h-3.5" />
                          <span>OST</span>
                        </span>
                      )}
                      {leadEntry.videosCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[#E50914] dark:text-[#FDA4AF]">
                          <Video className="w-3.5 h-3.5" />
                          <span>{leadEntry.videosCount} відео</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSavePost(leadEntry.post.id)}
                        aria-label={
                          savedSet.has(leadEntry.post.id)
                            ? 'Прибрати із закладок'
                            : 'Зберегти у закладки'
                        }
                        aria-pressed={savedSet.has(leadEntry.post.id)}
                        className={`w-9 h-9 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                          savedSet.has(leadEntry.post.id)
                            ? 'bg-[#E50914]/12 text-[#E50914] dark:text-[#FDA4AF]'
                            : 'text-[#5C5C58] dark:text-[#A8A49B] hover:bg-[#EFECE6] dark:hover:bg-[#323232]'
                        }`}
                      >
                        <Bookmark
                          className={`w-4 h-4 ${savedSet.has(leadEntry.post.id) ? 'fill-current' : ''}`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenPost(leadEntry.post)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#141413] dark:bg-[#F4F1EA] text-white dark:text-[#181818] hover:bg-[#E50914] dark:hover:bg-[#E50914] dark:hover:text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <span>Читати рецензію</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </m.article>
          )}

          {/* Grid or Archive List View */}
          {layoutMode === 'list' ? (
            <div className="rounded-2xl bg-white dark:bg-[#262626] border border-black/6 dark:border-white/8 divide-y divide-[#EFECE6] dark:divide-[#323232] overflow-hidden">
              {gridEntries.map((entry) => {
                const { post, filmMeta } = entry;
                const isSaved = savedSet.has(post.id);
                return (
                  <div
                    key={post.id}
                    className="p-4 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#FAF9F5] dark:hover:bg-[#2C2C2E] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenPost(post)}
                      className="min-w-0 flex-1 text-left cursor-pointer space-y-1"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                        <span className="font-medium text-[#C80812] dark:text-[#FDA4AF]">
                          {post.category || 'Кіноблог'}
                        </span>
                        {filmMeta?.releaseYear && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">{filmMeta.releaseYear}</span>
                          </>
                        )}
                        {filmMeta?.director && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>реж. {filmMeta.director}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{post.readingMinutes} хв</span>
                        {filmMeta?.hasSpoilers && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700 dark:text-amber-300">Спойлери</span>
                          </>
                        )}
                      </div>
                      <p className="text-base font-semibold text-[#141413] dark:text-[#F4F1EA] hover:text-[#E50914] dark:hover:text-[#FDA4AF] transition-colors truncate">
                        {post.title}
                      </p>
                    </button>

                    <div className="flex items-center gap-3 shrink-0 text-xs tabular-nums">
                      {typeof filmMeta?.rating === 'number' && (
                        <span className="inline-flex items-center gap-1 font-mono font-semibold text-[#B45309] dark:text-[#FDE68A]">
                          <Star className="w-3.5 h-3.5 fill-[#FACC15] text-[#FACC15]" />
                          <span>{filmMeta.rating.toFixed(1)}</span>
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 font-mono text-[#5C5C58] dark:text-[#A8A49B]">
                        <Eye className="w-3.5 h-3.5" />
                        <span>{post.viewsCount}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleSavePost(post.id)}
                        aria-label={isSaved ? 'Прибрати із закладок' : 'Зберегти у закладки'}
                        aria-pressed={isSaved}
                        className={`w-8 h-8 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                          isSaved
                            ? 'text-[#E50914] dark:text-[#FDA4AF] bg-[#E50914]/10'
                            : 'text-[#5C5C58] dark:text-[#A8A49B] hover:bg-[#EFECE6] dark:hover:bg-[#363636]'
                        }`}
                      >
                        <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenPost(post)}
                        aria-label={`Читати «${post.title}»`}
                        className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-[#141413] dark:text-[#F4F1EA] hover:bg-[#EFECE6] dark:hover:bg-[#363636] cursor-pointer"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
              {gridEntries.map((entry, index) => {
                const { post, filmMeta, posterUrl, soundtracksCount, videosCount, stillsCount } = entry;
                const isSaved = savedSet.has(post.id);
                return (
                  <m.article
                    key={post.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.18,
                      delay: Math.min(index * 0.03, 0.12),
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="perf-card group h-full rounded-2xl overflow-hidden bg-white dark:bg-[#262626] flex flex-col border border-black/6 dark:border-white/8 shadow-xs hover:shadow-md transition-shadow"
                  >
                    <button
                      type="button"
                      {...getTouchProps(post.id)}
                      data-touch-active={isTouchActive(post.id) ? 'true' : undefined}
                      onClick={() => handleOpenPost(post)}
                      className="touch-card w-full text-left cursor-pointer focus:outline-none"
                    >
                      <FilmPosterFrame
                        src={posterUrl}
                        alt={filmMeta?.filmTitle || post.title}
                        fallbackTitle={filmMeta?.filmTitle || post.title}
                        fallbackSubtitle={filmMeta?.director}
                        rating={filmMeta?.rating}
                        className="w-full aspect-[16/9]"
                      />
                    </button>

                    <div className="p-5 sm:p-6 flex-1 flex flex-col justify-between gap-4">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOpenPost(post)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleOpenPost(post);
                          }
                        }}
                        className="space-y-2.5 cursor-pointer text-left"
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                          <span className="font-semibold text-[#C80812] dark:text-[#FDA4AF]">
                            {post.category || 'Кіноблог'}
                          </span>
                          {filmMeta?.releaseYear && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">{filmMeta.releaseYear}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>{post.readingMinutes} хв читання</span>
                          {filmMeta?.hasSpoilers && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-700 dark:text-amber-300">Спойлери</span>
                            </>
                          )}
                        </div>

                        <h3 className="text-lg sm:text-xl font-semibold tracking-[-0.015em] text-[#141413] dark:text-[#F4F1EA] group-hover:text-[#E50914] dark:group-hover:text-[#FDA4AF] transition-colors duration-150 leading-snug">
                          {post.title}
                        </h3>

                        {(filmMeta?.filmTitle || filmMeta?.director) && (
                          <p className="text-xs text-[#4D4D48] dark:text-[#D8D3C8] font-medium truncate">
                            {[
                              filmMeta?.filmTitle,
                              filmMeta?.director ? `реж. ${filmMeta.director}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}

                        <p className="text-xs sm:text-sm text-[#5C5C58] dark:text-[#A8A49B] line-clamp-3 leading-relaxed">
                          {post.excerpt}
                        </p>
                      </div>

                      <div className="pt-3.5 border-t border-[#EFECE6] dark:border-[#323232] flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2.5 text-[#5C5C58] dark:text-[#A8A49B] tabular-nums min-w-0">
                          <span className="inline-flex items-center gap-1.5 truncate">
                            <Calendar className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{post.publishedAt}</span>
                          </span>
                          {soundtracksCount > 0 && (
                            <span
                              title="У рецензії є саундтрек"
                              className="inline-flex items-center gap-1 text-[#9F1239] dark:text-[#FDA4AF] shrink-0"
                            >
                              <Music2 className="w-3.5 h-3.5" />
                            </span>
                          )}
                          {videosCount > 0 && (
                            <span
                              title="У рецензії є відео з YouTube"
                              className="inline-flex items-center gap-1 text-[#E50914] dark:text-[#FDA4AF] shrink-0"
                            >
                              <Video className="w-3.5 h-3.5" />
                            </span>
                          )}
                          {stillsCount > 0 && (
                            <span className="font-mono text-[11px] shrink-0">
                              {stillsCount} кадр.
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center gap-1 font-mono tabular-nums text-[#5C5C58] dark:text-[#A8A49B]">
                            <Eye className="w-3.5 h-3.5" strokeWidth={1.75} />
                            <span>{post.viewsCount}</span>
                          </span>

                          <button
                            type="button"
                            onClick={() => toggleSavePost(post.id)}
                            aria-label={isSaved ? 'Прибрати із закладок' : 'Зберегти у закладки'}
                            aria-pressed={isSaved}
                            className={`w-8 h-8 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                              isSaved
                                ? 'text-[#E50914] dark:text-[#FDA4AF] bg-[#E50914]/10'
                                : 'text-[#5C5C58] dark:text-[#A8A49B] hover:bg-[#EFECE6] dark:hover:bg-[#323232]'
                            }`}
                          >
                            <Bookmark className={`w-3.5 h-3.5 ${isSaved ? 'fill-current' : ''}`} />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenPost(post)}
                            className="inline-flex items-center gap-1 text-[#141413] dark:text-[#F4F1EA] hover:text-[#E50914] dark:hover:text-[#FDA4AF] font-semibold cursor-pointer transition-colors whitespace-nowrap"
                          >
                            <span>Читати</span>
                            <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.85} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </m.article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Cinema Review Reader Modal */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {activePost && activeEntry && (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="fixed inset-0 z-50 bg-[#141413]/65 dark:bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 md:p-6"
                onClick={handleClosePost}
                role="dialog"
                aria-modal="true"
                aria-labelledby="blog-modal-title"
              >
                <m.div
                  ref={modalScrollRef}
                  onScroll={handleModalScroll}
                  initial={{ opacity: 0, scale: 0.97, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 12 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="relative bg-[#F9F9F7] dark:bg-[#1E1E20] rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl will-change-transform text-[#141413] dark:text-[#F4F1EA]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Sticky Reading Progress Bar */}
                  <div className="sticky top-0 z-20 h-1 w-full bg-black/5 dark:bg-white/5 pointer-events-none">
                    <div
                      className="h-full bg-[#E50914] transition-[width] duration-100 ease-out"
                      style={{ width: `${readProgress}%` }}
                    />
                  </div>

                  {/* Optional Poster / Film Still Hero inside Reader */}
                  {activeEntry.posterUrl && (
                    <div className="relative h-52 sm:h-64 w-full overflow-hidden bg-[#141215]">
                      <img
                        src={activeEntry.posterUrl}
                        alt={activeEntry.filmMeta?.filmTitle || activePost.title}
                        width={960}
                        height={540}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover block"
                      />
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#F9F9F7] via-black/25 to-black/35 dark:from-[#1E1E20]"
                      />
                    </div>
                  )}

                  <div className="p-5 sm:p-8 md:p-11">
                    {/* Reader Top Header */}
                    <div className="flex items-start justify-between gap-4 pb-6 border-b border-[#EFECE6] dark:border-[#323232]">
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                          <span className="inline-flex items-center gap-1 font-semibold text-[#C80812] dark:text-[#FDA4AF]">
                            <Clapperboard className="w-3.5 h-3.5" />
                            <span>{activePost.category || 'Кіноблог'}</span>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{activePost.publishedAt}</span>
                          <span aria-hidden="true">·</span>
                          <span>{activePost.readingMinutes} хв читання</span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Eye className="w-3.5 h-3.5" strokeWidth={1.75} />
                            <span>{activePost.viewsCount}</span>
                          </span>
                        </div>

                        <h3
                          id="blog-modal-title"
                          className="font-editorial-display text-2xl sm:text-3xl md:text-4xl font-semibold tracking-[-0.015em] text-[#141413] dark:text-[#F4F1EA] leading-[1.12]"
                        >
                          {activePost.title}
                        </h3>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleSavePost(activePost.id)}
                          aria-label={
                            savedSet.has(activePost.id)
                              ? 'Прибрати із закладок'
                              : 'Зберегти у закладки'
                          }
                          aria-pressed={savedSet.has(activePost.id)}
                          className={`w-9 h-9 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                            savedSet.has(activePost.id)
                              ? 'bg-[#E50914]/12 text-[#E50914] dark:text-[#FDA4AF]'
                              : 'text-[#5C5C58] dark:text-[#A8A49B] hover:bg-[#EFECE6] dark:hover:bg-[#323232]'
                          }`}
                        >
                          <Bookmark
                            className={`w-4 h-4 ${savedSet.has(activePost.id) ? 'fill-current' : ''}`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => setLargeText((prev) => !prev)}
                          className="btn-editorial-secondary px-3 py-2 text-xs"
                          aria-label="Змінити розмір шрифту"
                        >
                          {largeText ? 'А' : 'А+'}
                        </button>
                        <button
                          type="button"
                          onClick={handleClosePost}
                          className="w-9 h-9 inline-flex items-center justify-center text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-[#F4F1EA] hover:bg-[#EFECE6] dark:hover:bg-[#323232] active:scale-[0.96] rounded-lg transition-all duration-150 cursor-pointer shrink-0"
                          aria-label="Закрити рецензію"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* Film Passport Summary Strip */}
                    {activeEntry.filmMeta && (
                      <div className="mt-6 p-4 sm:p-5 rounded-xl bg-[#EFECE6]/70 dark:bg-[#262629] grid grid-cols-2 sm:grid-cols-4 gap-3.5 text-xs">
                        {activeEntry.filmMeta.filmTitle && (
                          <div>
                            <p className="text-[11px] text-[#787872] dark:text-[#9E978D] mb-0.5">
                              Стрічка
                            </p>
                            <p className="font-semibold text-[#141413] dark:text-[#F4F1EA]">
                              {activeEntry.filmMeta.filmTitle}
                            </p>
                          </div>
                        )}
                        {activeEntry.filmMeta.director && (
                          <div>
                            <p className="text-[11px] text-[#787872] dark:text-[#9E978D] mb-0.5">
                              Режисер
                            </p>
                            <p className="font-semibold text-[#141413] dark:text-[#F4F1EA]">
                              {activeEntry.filmMeta.director}
                            </p>
                          </div>
                        )}
                        {(activeEntry.filmMeta.releaseYear || activeEntry.filmMeta.country) && (
                          <div>
                            <p className="text-[11px] text-[#787872] dark:text-[#9E978D] mb-0.5">
                              Вихід
                            </p>
                            <p className="font-semibold text-[#141413] dark:text-[#F4F1EA] tabular-nums">
                              {[activeEntry.filmMeta.releaseYear, activeEntry.filmMeta.country]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </div>
                        )}
                        {activeEntry.filmMeta.runtimeMinutes && (
                          <div>
                            <p className="text-[11px] text-[#787872] dark:text-[#9E978D] mb-0.5">
                              Хронометраж
                            </p>
                            <p className="font-semibold text-[#141413] dark:text-[#F4F1EA] inline-flex items-center gap-1 tabular-nums">
                              <Clock className="w-3.5 h-3.5 text-[#787872]" />
                              <span>{formatRuntimeUk(activeEntry.filmMeta.runtimeMinutes)}</span>
                            </p>
                          </div>
                        )}
                        {activeEntry.filmMeta.watchFormat && (
                          <div>
                            <p className="text-[11px] text-[#787872] dark:text-[#9E978D] mb-0.5">
                              Формат перегляду
                            </p>
                            <p className="font-semibold text-[#141413] dark:text-[#F4F1EA]">
                              {activeEntry.filmMeta.watchFormat}
                            </p>
                          </div>
                        )}
                        {typeof activeEntry.filmMeta.rating === 'number' && (
                          <div>
                            <p className="text-[11px] text-[#787872] dark:text-[#9E978D] mb-0.5">
                              Оцінка БДК
                            </p>
                            <p className="font-mono font-semibold text-[#B45309] dark:text-[#FDE68A] inline-flex items-center gap-1 tabular-nums">
                              <Star className="w-3.5 h-3.5 fill-[#FACC15] text-[#FACC15]" />
                              <span>{activeEntry.filmMeta.rating.toFixed(1)} / 10</span>
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Spoiler Gate or Essay Body */}
                    {isSpoilerGated ? (
                      <div className="my-8 py-10 px-6 rounded-2xl bg-[#EFECE6]/60 dark:bg-[#262629] text-center space-y-3">
                        <ShieldAlert
                          className="w-7 h-7 text-amber-600 dark:text-amber-300 mx-auto"
                          strokeWidth={1.7}
                        />
                        <h4 className="text-base font-semibold text-[#141413] dark:text-[#F4F1EA]">
                          Ця рецензія містить важливі сюжетні деталі
                        </h4>
                        <p className="text-xs sm:text-sm text-[#5C5C58] dark:text-[#A8A49B] max-w-md mx-auto leading-relaxed">
                          Якщо ви ще не дивилися стрічку й хочете зберегти інтригу, можете зберегти розбір у закладки та повернутися після перегляду.
                        </p>
                        <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              setRevealedSpoilerIds((prev) => ({
                                ...prev,
                                [activePost.id]: true,
                              }))
                            }
                            className="px-4 py-2 rounded-lg bg-[#141413] dark:bg-[#F4F1EA] text-white dark:text-[#181818] text-xs font-semibold cursor-pointer hover:opacity-90 transition-opacity"
                          >
                            Показати рецензію зі спойлерами
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!savedSet.has(activePost.id)) {
                                toggleSavePost(activePost.id);
                              }
                            }}
                            className="btn-editorial-secondary text-xs"
                          >
                            <Bookmark className="w-3.5 h-3.5" />
                            <span>
                              {savedSet.has(activePost.id)
                                ? 'Збережено у закладки'
                                : 'Зберегти на потім'}
                            </span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`py-8 max-w-[65ch] mx-auto text-[#141413] dark:text-[#E5E2DA] space-y-6 leading-[1.82] transition-all ${
                          largeText ? 'text-lg' : 'text-base'
                        }`}
                      >
                        {loadingPostId === activePost.id && activePost.contentTruncated && (
                          <div className="flex items-center gap-2 text-xs text-[#787872] dark:text-[#A8A49B]">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Завантаження повного тексту...</span>
                          </div>
                        )}
                        {activeBlocks.map((block, index) => {
                          if (block.type === 'paragraph') {
                            const isPullQuote = block.text.trim().startsWith('>');
                            if (isPullQuote) {
                              const quoteText = block.text.replace(/^>\s*/gm, '').trim();
                              return (
                                <blockquote
                                  key={`q-${index}`}
                                  className="my-7 py-4 px-5 sm:px-7 rounded-xl bg-[#EFECE6]/55 dark:bg-[#262629] text-center space-y-2"
                                >
                                  <Quote
                                    className="w-4 h-4 text-[#E50914] mx-auto opacity-80"
                                    strokeWidth={1.75}
                                  />
                                  <p className="font-editorial-display italic text-xl sm:text-2xl text-[#141413] dark:text-[#F4F1EA] leading-relaxed whitespace-pre-line">
                                    {quoteText}
                                  </p>
                                </blockquote>
                              );
                            }
                            return (
                              <p key={`p-${index}`} className="whitespace-pre-line">
                                {block.text}
                              </p>
                            );
                          }
                          if (block.type === 'photo') {
                            const photoIdx = activePhotos.findIndex((p) => p.id === block.item.id);
                            return (
                              <figure key={`img-${block.item.id}-${index}`} className="my-7 space-y-2">
                                <button
                                  type="button"
                                  onClick={() => setZoomedPhotoIndex(photoIdx >= 0 ? photoIdx : 0)}
                                  className="group relative block w-full overflow-hidden rounded-2xl bg-[#EFECE6]/70 dark:bg-[#262626] cursor-zoom-in shadow-md"
                                  aria-label={block.item.caption || 'Збільшити кадр'}
                                >
                                  <img
                                    src={block.item.url}
                                    alt={block.item.caption || activePost.title}
                                    width={800}
                                    height={540}
                                    loading="lazy"
                                    decoding="async"
                                    referrerPolicy="no-referrer"
                                    className="w-full max-h-[540px] object-contain mx-auto block"
                                  />
                                  <span className="absolute right-3 bottom-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/70 text-white text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                                    <ZoomIn className="w-3.5 h-3.5" />
                                    <span>Кадр у повному розмірі</span>
                                  </span>
                                </button>
                                {block.item.caption && (
                                  <figcaption className="text-xs text-[#5C5C58] dark:text-[#A8A49B] text-center leading-relaxed">
                                    {block.item.caption}
                                  </figcaption>
                                )}
                              </figure>
                            );
                          }
                          if (block.type === 'youtube') {
                            return (
                              <BlogYouTubeVideoCard
                                key={`yt-${block.item.id}-${index}`}
                                video={block.item}
                              />
                            );
                          }
                          return (
                            <BlogSoundCloudTrackCard
                              key={`sc-${block.item.id}-${index}`}
                              track={block.item}
                              isActive={playingTrackId === block.item.id}
                              onActivate={(id) => setPlayingTrackId(id)}
                              onDeactivate={(id) =>
                                setPlayingTrackId((prev) => (prev === id ? null : prev))
                              }
                            />
                          );
                        })}

                        {/* Author's Verdict Summary */}
                        {activeEntry.filmMeta?.verdict && (
                          <div className="mt-8 p-5 rounded-xl bg-[#EFECE6]/70 dark:bg-[#262629] space-y-1.5">
                            <p className="text-[11px] font-semibold text-[#C80812] dark:text-[#FDA4AF]">
                              Підсумок БДК
                            </p>
                            <p className="font-editorial-display text-lg sm:text-xl italic text-[#141413] dark:text-[#F4F1EA] leading-snug">
                              «{activeEntry.filmMeta.verdict}»
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Modal Footer with Share & Prev/Next Review Navigation */}
                    <div className="pt-6 border-t border-[#EFECE6] dark:border-[#323232] space-y-4">
                      {(prevEntry || nextEntry) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {prevEntry ? (
                            <button
                              type="button"
                              onClick={() => handleOpenPost(prevEntry.post)}
                              className="p-3 rounded-xl bg-[#EFECE6]/60 dark:bg-[#262629] hover:bg-[#EFECE6] dark:hover:bg-[#303034] text-left transition-colors cursor-pointer group"
                            >
                              <span className="inline-flex items-center gap-1 text-[11px] text-[#787872] dark:text-[#9E978D]">
                                <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
                                <span>Попередня рецензія</span>
                              </span>
                              <p className="mt-0.5 text-xs font-semibold text-[#141413] dark:text-[#F4F1EA] truncate">
                                {prevEntry.post.title}
                              </p>
                            </button>
                          ) : (
                            <div />
                          )}

                          {nextEntry && (
                            <button
                              type="button"
                              onClick={() => handleOpenPost(nextEntry.post)}
                              className="p-3 rounded-xl bg-[#EFECE6]/60 dark:bg-[#262629] hover:bg-[#EFECE6] dark:hover:bg-[#303034] text-right transition-colors cursor-pointer group"
                            >
                              <span className="inline-flex items-center gap-1 text-[11px] text-[#787872] dark:text-[#9E978D]">
                                <span>Наступна рецензія</span>
                                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                              </span>
                              <p className="mt-0.5 text-xs font-semibold text-[#141413] dark:text-[#F4F1EA] truncate">
                                {nextEntry.post.title}
                              </p>
                            </button>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <ShareButton
                          title={`${activePost.title} — БДК (Будда дивиться кіно)`}
                          text={`«${activePost.title}» — рецензія в БДК (Будда дивиться кіно)`}
                          url={getBlogShareUrl(activePost.id)}
                          variant="button"
                        />

                        <button
                          type="button"
                          onClick={handleClosePost}
                          className="btn-editorial-ink px-5 py-2.5 text-xs font-semibold"
                        >
                          Закрити
                        </button>
                      </div>
                    </div>
                  </div>
                </m.div>
              </m.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Photo Lightbox with Gallery Controls */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {zoomedPhoto && (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-[60] bg-black/92 backdrop-blur-xs flex flex-col items-center justify-center p-4 sm:p-6"
                onClick={() => setZoomedPhotoIndex(null)}
                role="dialog"
                aria-modal="true"
                aria-label="Перегляд кадру з фільму"
              >
                <button
                  type="button"
                  onClick={() => setZoomedPhotoIndex(null)}
                  aria-label="Закрити перегляд кадру"
                  className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>

                {activePhotos.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setZoomedPhotoIndex((prev) =>
                          prev === null
                            ? 0
                            : (prev - 1 + activePhotos.length) % activePhotos.length
                        );
                      }}
                      aria-label="Попередній кадр"
                      className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center cursor-pointer transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setZoomedPhotoIndex((prev) =>
                          prev === null ? 0 : (prev + 1) % activePhotos.length
                        );
                      }}
                      aria-label="Наступний кадр"
                      className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center cursor-pointer transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}

                <img
                  src={zoomedPhoto.url}
                  alt={zoomedPhoto.caption || 'Кадр з фільму'}
                  width={1200}
                  height={800}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onClick={(e) => e.stopPropagation()}
                  className="max-w-full max-h-[82vh] object-contain rounded-xl shadow-2xl"
                />

                <div
                  onClick={(e) => e.stopPropagation()}
                  className="mt-3 text-center space-y-1 max-w-2xl"
                >
                  {zoomedPhoto.caption && (
                    <p className="text-sm text-white/90">{zoomedPhoto.caption}</p>
                  )}
                  {activePhotos.length > 1 && zoomedPhotoIndex !== null && (
                    <p className="font-mono text-[11px] text-white/55 tabular-nums">
                      Кадр {zoomedPhotoIndex + 1} з {activePhotos.length}
                    </p>
                  )}
                </div>
              </m.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </section>
  );
});
