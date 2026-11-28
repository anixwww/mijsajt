import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Music2, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus.ts';
import type { PoemSoundCloudTrack } from '../types.ts';
import {
  formatDurationMs,
  getSoundCloudPlayerSrc,
  loadSoundCloudWidgetApi,
  type SCPlayProgressPayload,
  type SCWidgetInstance,
} from '../utils/soundcloudWidget.ts';

interface PoemSoundCloudPlayerProps {
  track?: PoemSoundCloudTrack;
  tracks?: PoemSoundCloudTrack[];
  hasCustomBackground?: boolean;
  isDarkBackground?: boolean;
  textColor?: string;
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

export function PoemSoundCloudPlayer({
  track,
  tracks,
  hasCustomBackground = false,
  isDarkBackground = false,
  textColor,
}: PoemSoundCloudPlayerProps) {
  const effectiveTracks = useMemo(() => {
    if (Array.isArray(tracks) && tracks.length > 0) return tracks;
    return track ? [track] : [];
  }, [tracks, track]);

  const tracksSignature = useMemo(
    () => effectiveTracks.map((t) => `${t.id}:${t.soundcloudUrl}`).join('|'),
    [effectiveTracks]
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const widgetRef = useRef<SCWidgetInstance | null>(null);
  const widgetReadyRef = useRef(false);
  const pendingPlayRef = useRef(false);
  const activeIndexRef = useRef(0);
  const totalTracksRef = useRef(effectiveTracks.length);

  const [iframeMounted, setIframeMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  const safeActiveIndex =
    effectiveTracks.length > 0 ? Math.min(activeIndex, effectiveTracks.length - 1) : 0;
  const activeTrack = effectiveTracks[safeActiveIndex] || null;

  activeIndexRef.current = safeActiveIndex;
  totalTracksRef.current = effectiveTracks.length;

  useEffect(() => {
    pendingPlayRef.current = false;
    setActiveIndex(0);
    setIframeMounted(false);
    setIsLoading(false);
    setIsPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
    setPlayerError(null);
  }, [tracksSignature]);

  const playerSrc = useMemo(
    () =>
      activeTrack
        ? getSoundCloudPlayerSrc(activeTrack.embedTargetUrl || activeTrack.soundcloudUrl, false)
        : '',
    [activeTrack]
  );

  const safeHref = useMemo(
    () => getSafeExternalSoundCloudUrl(activeTrack?.soundcloudUrl),
    [activeTrack?.soundcloudUrl]
  );

  const safeArtwork = useMemo(() => {
    if (!activeTrack?.artworkUrl) return null;
    try {
      const parsed = new URL(activeTrack.artworkUrl);
      return parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch {
      return null;
    }
  }, [activeTrack?.artworkUrl]);

  useEffect(() => {
    setArtworkFailed(false);
    setPositionMs(0);
    setDurationMs(0);
    setIsPlaying(false);
    setPlayerError(null);
    if (!pendingPlayRef.current) {
      setIsLoading(false);
      setIframeMounted(false);
    }
  }, [activeTrack?.id, activeTrack?.soundcloudUrl]);

  const selectAndPlayIndex = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= effectiveTracks.length) return;
      setPlayerError(null);
      if (!isOnline) {
        setActiveIndex(nextIndex);
        setPlayerError('Для відтворення пісні з SoundCloud потрібне підключення до інтернету.');
        return;
      }
      if (nextIndex === safeActiveIndex) {
        if (!iframeMounted) {
          pendingPlayRef.current = true;
          setIsLoading(true);
          setIframeMounted(true);
          return;
        }
        const widget = widgetRef.current;
        if (widget && widgetReadyRef.current) {
          if (isPlaying) {
            widget.pause();
            setIsPlaying(false);
          } else {
            setIsLoading(true);
            try {
              widget.play();
            } catch {
              setIsLoading(false);
              setPlayerError('Не вдалося запустити трек — спробуйте відкрити на SoundCloud.');
            }
          }
        } else {
          pendingPlayRef.current = true;
          setIsLoading(true);
        }
        return;
      }
      pendingPlayRef.current = true;
      setIsLoading(true);
      setIframeMounted(true);
      setActiveIndex(nextIndex);
    },
    [effectiveTracks.length, iframeMounted, isOnline, isPlaying, safeActiveIndex]
  );

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
              setPlayerError('Не вдалося запустити трек — спробуйте відкрити на SoundCloud.');
            }
          }
        });

        widget.bind(WidgetFactory.Events.PLAY, () => {
          if (cancelled || !widget) return;
          setIsPlaying(true);
          setIsLoading(false);
          setPlayerError(null);
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
          setPositionMs(0);
          const nextIdx = activeIndexRef.current + 1;
          if (nextIdx < totalTracksRef.current) {
            pendingPlayRef.current = true;
            setIsLoading(true);
            setIframeMounted(true);
            setActiveIndex(nextIdx);
          } else {
            setIsLoading(false);
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
          setIsLoading(false);
          setPlayerError('Не вдалося запустити трек — спробуйте відкрити на SoundCloud.');
        });
      })
      .catch(() => {
        if (cancelled) return;
        pendingPlayRef.current = false;
        setIsLoading(false);
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
  }, [iframeMounted, playerSrc]);

  const handleTogglePlay = () => {
    selectAndPlayIndex(safeActiveIndex);
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

  if (!activeTrack) return null;

  const hasPlaylist = effectiveTracks.length > 1;
  const progressPct =
    durationMs > 0 ? Math.min(100, Math.max(0, (positionMs / durationMs) * 100)) : 0;

  const containerStyle = hasCustomBackground
    ? {
        backgroundColor: isDarkBackground
          ? 'rgba(0, 0, 0, 0.24)'
          : 'rgba(255, 255, 255, 0.42)',
        color: textColor || undefined,
      }
    : undefined;

  const buttonSecondaryStyle = hasCustomBackground
    ? {
        backgroundColor: isDarkBackground
          ? 'rgba(255, 255, 255, 0.14)'
          : 'rgba(0, 0, 0, 0.08)',
        color: textColor || undefined,
      }
    : undefined;

  const playButtonStyle = hasCustomBackground
    ? {
        backgroundColor: isDarkBackground
          ? 'rgba(255, 255, 255, 0.92)'
          : '#141413',
        color: isDarkBackground ? '#141413' : '#FFFFFF',
      }
    : undefined;

  const rangeTrackColor = hasCustomBackground
    ? isDarkBackground
      ? 'rgba(255,255,255,0.9)'
      : '#141413'
    : '#315E3C';
  const rangeBaseColor = hasCustomBackground
    ? isDarkBackground
      ? 'rgba(255,255,255,0.22)'
      : 'rgba(0,0,0,0.16)'
    : 'rgba(120,120,114,0.22)';

  return (
    <div
      style={containerStyle}
      className={`rounded-2xl p-3.5 sm:p-4 space-y-3 transition-colors ${
        hasCustomBackground
          ? ''
          : 'bg-paper-oat dark:bg-night-panel'
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleTogglePlay}
          style={playButtonStyle}
          aria-label={isPlaying ? `Пауза: ${activeTrack.title}` : `Відтворити: ${activeTrack.title}`}
          className={`w-10 h-10 rounded-xl inline-flex items-center justify-center shrink-0 shadow-xs active:scale-[0.96] transition-transform cursor-pointer ${
            hasCustomBackground ? '' : 'bg-pear-pine-gradient text-white'
          }`}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        {safeArtwork && !artworkFailed ? (
          <img
            src={safeArtwork}
            alt={activeTrack.title}
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            onError={() => setArtworkFailed(true)}
            className="w-10 h-10 rounded-lg object-cover shrink-0 bg-black/10"
          />
        ) : (
          <div
            aria-hidden="true"
            style={buttonSecondaryStyle}
            className={`w-10 h-10 rounded-lg shrink-0 flex items-center justify-center ${
              hasCustomBackground
                ? ''
                : 'bg-paper-sand dark:bg-night-hover text-ink-muted dark:text-parchment'
            }`}
          >
            <Music2 className="w-4 h-4" strokeWidth={1.65} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p
            style={textColor ? { color: textColor } : undefined}
            className={`text-sm font-semibold truncate leading-snug ${
              textColor ? '' : 'text-ink dark:text-cream'
            }`}
          >
            {activeTrack.title}
          </p>
          <p
            style={textColor ? { color: textColor, opacity: 0.78 } : undefined}
            className={`text-xs truncate ${
              textColor ? '' : 'text-ink-muted dark:text-sandstone-light'
            }`}
          >
            {activeTrack.artist} · SoundCloud
            {hasPlaylist ? ` · ${safeActiveIndex + 1}/${effectiveTracks.length}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {hasPlaylist && (
            <>
              <button
                type="button"
                onClick={() =>
                  selectAndPlayIndex(
                    (safeActiveIndex - 1 + effectiveTracks.length) % effectiveTracks.length
                  )
                }
                aria-label="Попередня пісня"
                title="Попередня пісня"
                style={textColor ? { color: textColor, opacity: 0.85 } : undefined}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  hasCustomBackground
                    ? 'hover:bg-black/10'
                    : 'text-ink-muted dark:text-sandstone-light hover:text-ink dark:hover:text-cream hover:bg-paper-sand dark:hover:bg-night-elevated'
                }`}
              >
                <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() =>
                  selectAndPlayIndex((safeActiveIndex + 1) % effectiveTracks.length)
                }
                aria-label="Наступна пісня"
                title="Наступна пісня"
                style={textColor ? { color: textColor, opacity: 0.85 } : undefined}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  hasCustomBackground
                    ? 'hover:bg-black/10'
                    : 'text-ink-muted dark:text-sandstone-light hover:text-ink dark:hover:text-cream hover:bg-paper-sand dark:hover:bg-night-elevated'
                }`}
              >
                <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </>
          )}
          {safeHref && (
            <a
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Відкрити на SoundCloud"
              aria-label={`Відкрити «${activeTrack.title}» на SoundCloud`}
              style={textColor ? { color: textColor, opacity: 0.85 } : undefined}
              className={`p-2 rounded-lg transition-colors ${
                hasCustomBackground
                  ? 'hover:bg-black/10'
                  : 'text-ink-muted dark:text-sandstone-light hover:text-ink dark:hover:text-cream hover:bg-paper-sand dark:hover:bg-night-elevated'
              }`}
            >
              <ExternalLink className="w-4 h-4" strokeWidth={1.75} />
            </a>
          )}
        </div>
      </div>

      {(durationMs > 0 || isPlaying) && (
        <div className="flex items-center gap-2.5">
          <span
            style={textColor ? { color: textColor, opacity: 0.78 } : undefined}
            className={`font-mono text-[11px] tabular-nums w-10 ${
              textColor ? '' : 'text-ink-muted dark:text-sandstone-light'
            }`}
          >
            {formatDurationMs(positionMs)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(durationMs, 1000)}
            value={Math.min(positionMs, Math.max(durationMs, 1000))}
            onChange={(e) => handleSeek(Number(e.target.value))}
            aria-label={`Перемотати «${activeTrack.title}»`}
            style={{
              background: `linear-gradient(to right, ${rangeTrackColor} ${progressPct}%, ${rangeBaseColor} ${progressPct}%)`,
            }}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-current"
          />
          <span
            style={textColor ? { color: textColor, opacity: 0.78 } : undefined}
            className={`font-mono text-[11px] tabular-nums w-10 text-right ${
              textColor ? '' : 'text-ink-muted dark:text-sandstone-light'
            }`}
          >
            {formatDurationMs(durationMs)}
          </span>
        </div>
      )}

      {hasPlaylist && (
        <div
          className={`pt-2 border-t space-y-1 ${
            hasCustomBackground
              ? isDarkBackground
                ? 'border-white/15'
                : 'border-black/10'
              : 'border-black/8 dark:border-white/10'
          }`}
        >
          {effectiveTracks.map((item, idx) => {
            const isCurrent = idx === safeActiveIndex;
            const activeRowClass = hasCustomBackground
              ? isDarkBackground
                ? 'bg-white/15 font-semibold'
                : 'bg-black/10 font-semibold'
              : 'bg-paper-sand dark:bg-night-lift font-semibold';
            const idleRowClass = hasCustomBackground
              ? isDarkBackground
                ? 'hover:bg-white/10'
                : 'hover:bg-black/5'
              : 'hover:bg-paper-sand/60 dark:hover:bg-night-card';
            return (
              <button
                key={`${item.id}-${idx}`}
                type="button"
                onClick={() => selectAndPlayIndex(idx)}
                style={
                  textColor
                    ? { color: textColor, opacity: isCurrent ? 1 : 0.82 }
                    : undefined
                }
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                  isCurrent ? activeRowClass : idleRowClass
                }`}
              >
                <span className="font-mono text-[11px] tabular-nums w-5 text-center shrink-0 opacity-75">
                  {isCurrent && isPlaying ? (
                    <Pause className="w-3 h-3 inline fill-current" />
                  ) : isCurrent ? (
                    <Play className="w-3 h-3 inline fill-current" />
                  ) : (
                    String(idx + 1).padStart(2, '0')
                  )}
                </span>
                <span className="truncate flex-1 min-w-0">
                  {item.title}
                </span>
                <span className="truncate max-w-[38%] text-[11px] opacity-70 shrink-0">
                  {item.artist}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {playerError && (
        <p
          style={textColor ? { color: textColor, opacity: 0.9 } : undefined}
          className={`text-xs ${textColor ? '' : 'text-amber-700 dark:text-amber-300'}`}
        >
          {playerError}
        </p>
      )}

      {iframeMounted && playerSrc && (
        <div
          aria-hidden="true"
          className="fixed bottom-0 right-0 w-[300px] h-[166px] opacity-[0.01] pointer-events-none -z-10"
        >
          <iframe
            key={`${activeTrack.id}:${playerSrc}`}
            ref={iframeRef}
            title={`${activeTrack.title} — SoundCloud`}
            src={playerSrc}
            allow="autoplay; encrypted-media"
            tabIndex={-1}
            className="w-full h-[166px] rounded-xl border-0 block"
          />
        </div>
      )}
    </div>
  );
}
