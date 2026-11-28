import { X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/useAuthStore.ts';
import { useCatalogStore } from '../store/useCatalogStore.ts';
import { useRadioStore } from '../store/useRadioStore.ts';
import { useUiStore } from '../store/useUiStore.ts';
import type { RadioStationId, RadioTrack } from '../types.ts';
import {
  hasRadioTelemetryWaveform,
  setRadioTelemetryWaveform,
  updateRadioTelemetryPlayback,
} from '../utils/radioAudioTelemetry.ts';
import {
  subscribeRadioTracks,
  syncLegacyServerTracksToFirestore,
} from '../utils/radioFirestore.ts';
import {
  annotateAllRadioTracksWithRepertoire,
  selectRadioStationRepertoire,
} from '../utils/radioRepertoire.ts';
import { useRadioDerivedState } from '../utils/radioSelectors.ts';
import {
  fetchSoundCloudWaveform,
  getSoundCloudPlayerSrc,
  loadSoundCloudWidgetApi,
  type SCPlayProgressPayload,
  type SCWidgetInstance,
} from '../utils/soundcloudWidget.ts';
import { subscribeWeeklyMusicSelections } from '../utils/weeklyMusicFirestore.ts';

interface RadioEngineProps {
  getGuestToken: (forceRefresh?: boolean) => Promise<string | null>;
  getAdminToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const RADIO_IFRAME_ID = 'dankiv-sc-radio-widget';

export const RadioEngine = memo(function RadioEngine({
  getGuestToken,
  getAdminToken,
}: RadioEngineProps) {
  const guestUser = useAuthStore((s) => s.guestUser);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const activeSection = useUiStore((s) => s.activeSection);
  const poetryImmersionMode = useUiStore((s) => s.poetryImmersionMode);
  const isPoetryImmersed = activeSection === 'poetry' && poetryImmersionMode;

  const serverRadioTracks = useCatalogStore((s) => s.catalog?.radioTracks);
  const setRadioTracksInCatalog = useCatalogStore((s) => s.setRadioTracksInCatalog);

  const firestoreRadioTracks = useRadioStore((s) => s.firestoreRadioTracks);
  const activeRadioStation = useRadioStore((s) => s.activeRadioStation);
  const radioPlaybackScope = useRadioStore((s) => s.radioPlaybackScope);
  const radioCurrentTrackId = useRadioStore((s) => s.radioCurrentTrackId);
  const radioIsPlaying = useRadioStore((s) => s.radioIsPlaying);
  const radioIsLoadingTrack = useRadioStore((s) => s.radioIsLoadingTrack);
  const radioDurationMs = useRadioStore((s) => s.radioDurationMs);
  const radioVolume = useRadioStore((s) => s.radioVolume);
  const radioIsMuted = useRadioStore((s) => s.radioIsMuted);
  const radioBootstrapSrc = useRadioStore((s) => s.radioBootstrapSrc);
  const radioShowDirectEmbed = useRadioStore((s) => s.radioShowDirectEmbed);

  const setFirestoreRadioTracks = useRadioStore((s) => s.setFirestoreRadioTracks);
  const setHasHydratedFirestoreRadio = useRadioStore((s) => s.setHasHydratedFirestoreRadio);
  const setFirestoreWeeklyMusic = useRadioStore((s) => s.setFirestoreWeeklyMusic);
  const setActiveRadioStation = useRadioStore((s) => s.setActiveRadioStation);
  const setRadioPlaybackScope = useRadioStore((s) => s.setRadioPlaybackScope);
  const setRadioCurrentTrackId = useRadioStore((s) => s.setRadioCurrentTrackId);
  const setRadioIsPlaying = useRadioStore((s) => s.setRadioIsPlaying);
  const setRadioIsLoadingTrack = useRadioStore((s) => s.setRadioIsLoadingTrack);
  const setRadioPositionMs = useRadioStore((s) => s.setRadioPositionMs);
  const setRadioDurationMs = useRadioStore((s) => s.setRadioDurationMs);
  const setRadioVolume = useRadioStore((s) => s.setRadioVolume);
  const setRadioIsMuted = useRadioStore((s) => s.setRadioIsMuted);
  const setRadioPlayerError = useRadioStore((s) => s.setRadioPlayerError);
  const setRadioBootstrapSrc = useRadioStore((s) => s.setRadioBootstrapSrc);
  const setRadioShowDirectEmbed = useRadioStore((s) => s.setRadioShowDirectEmbed);
  const setHandlers = useRadioStore((s) => s.setHandlers);

  const { allRadioTracks, radioTracks, savedRadioTracks, activeRadioTrack } = useRadioDerivedState();

  const isGuestAuthenticated = Boolean(guestUser);

  const legacyRadioSeededRef = useRef(false);
  const hadFirestoreRadioTracksRef = useRef(false);
  const radioCloudMutationUntilRef = useRef(0);
  const serverRadioSyncedRef = useRef<string | null>(null);

  const radioIframeRef = useRef<HTMLIFrameElement | null>(null);
  const radioWidgetRef = useRef<SCWidgetInstance | null>(null);
  const radioWidgetReadyRef = useRef(false);
  const radioBootstrapSrcRef = useRef<string | null>(null);
  radioBootstrapSrcRef.current = radioBootstrapSrc;
  const radioBootstrapInFlightRef = useRef(false);
  const allRadioTracksRef = useRef<RadioTrack[]>(allRadioTracks);
  allRadioTracksRef.current = allRadioTracks;
  const radioTracksRef = useRef<RadioTrack[]>(radioTracks);
  radioTracksRef.current = radioTracks;
  const savedRadioTracksRef = useRef<RadioTrack[]>(savedRadioTracks);
  savedRadioTracksRef.current = savedRadioTracks;
  const radioPlaybackScopeRef = useRef<'repertoire' | 'saved'>(radioPlaybackScope);
  radioPlaybackScopeRef.current = radioPlaybackScope;
  const radioIsPlayingRef = useRef(radioIsPlaying);
  radioIsPlayingRef.current = radioIsPlaying;
  const radioCurrentTrackIdRef = useRef<string | null>(radioCurrentTrackId);
  radioCurrentTrackIdRef.current = radioCurrentTrackId;
  const radioLoadedUrlRef = useRef<string | null>(null);
  const radioPendingAutoPlayRef = useRef(false);
  const radioVolumeRef = useRef(radioVolume);
  radioVolumeRef.current = radioVolume;
  const radioIsMutedRef = useRef(radioIsMuted);
  radioIsMutedRef.current = radioIsMuted;
  const userInitiatedPauseRef = useRef(false);
  const lastPlayAttemptAtRef = useRef(0);
  const playConfirmedProgressRef = useRef(false);
  const radioFinishingTransitionUntilRef = useRef(0);

  const getTrackEmbedTarget = useCallback((track?: RadioTrack | null): string | null => {
    if (!track) return null;
    return track.embedTargetUrl || track.soundcloudUrl || null;
  }, []);

  const hydrateTrackWaveform = useCallback(
    async (trackId: string | null | undefined, widget?: SCWidgetInstance | null) => {
      if (!trackId || hasRadioTelemetryWaveform(trackId)) return;

      if (widget && typeof widget.getCurrentSound === 'function') {
        const waveformFromWidget = await new Promise<string | null>((resolve) => {
          let settled = false;
          const timer = window.setTimeout(() => {
            if (!settled) {
              settled = true;
              resolve(null);
            }
          }, 1500);
          try {
            widget.getCurrentSound((sound) => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timer);
              resolve(sound?.waveform_url ?? null);
            });
          } catch {
            if (!settled) {
              settled = true;
              window.clearTimeout(timer);
              resolve(null);
            }
          }
        });
        if (waveformFromWidget) {
          const samples = await fetchSoundCloudWaveform(waveformFromWidget);
          if (samples && samples.length > 0) {
            setRadioTelemetryWaveform(trackId, samples);
            return;
          }
        }
      }

      try {
        const token = await getGuestToken();
        if (!token) return;
        const res = await fetch(`/api/radio/waveform/${encodeURIComponent(trackId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { samples?: number[] };
        if (Array.isArray(data.samples) && data.samples.length > 0) {
          setRadioTelemetryWaveform(trackId, data.samples);
        }
      } catch {
        // Fallback rhythmic equalizer remains active if waveform unavailable
      }
    },
    [getGuestToken]
  );

  useEffect(() => {
    updateRadioTelemetryPlayback({
      isPlaying: Boolean(guestUser && radioIsPlaying),
      trackId: activeRadioTrack?.id ?? null,
      trackStation: activeRadioTrack?.station ?? activeRadioStation,
      durationMs: radioDurationMs,
      volume: radioVolume,
      isMuted: radioIsMuted,
    });
  }, [
    guestUser,
    radioIsPlaying,
    activeRadioTrack?.id,
    activeRadioTrack?.station,
    activeRadioStation,
    radioDurationMs,
    radioVolume,
    radioIsMuted,
  ]);

  const bootstrapRadioIframe = useCallback(
    (targetUrl: string, autoPlay: boolean) => {
      const src = getSoundCloudPlayerSrc(targetUrl, autoPlay);
      if (!src) return;
      radioLoadedUrlRef.current = targetUrl;
      radioPendingAutoPlayRef.current = autoPlay;
      if (autoPlay) {
        userInitiatedPauseRef.current = false;
        lastPlayAttemptAtRef.current = Date.now();
        playConfirmedProgressRef.current = false;
        setRadioIsLoadingTrack(true);
      }
      if (radioBootstrapInFlightRef.current) return;
      radioBootstrapInFlightRef.current = true;
      void loadSoundCloudWidgetApi()
        .then(() => {
          radioBootstrapInFlightRef.current = false;
          const latestTarget = radioLoadedUrlRef.current || targetUrl;
          const latestSrc = getSoundCloudPlayerSrc(latestTarget, radioPendingAutoPlayRef.current);
          if (latestSrc) {
            setRadioBootstrapSrc(latestSrc);
          }
        })
        .catch(() => {
          radioBootstrapInFlightRef.current = false;
          setRadioIsLoadingTrack(false);
          setRadioPlayerError('Не вдалося завантажити плеєр SoundCloud.');
        });
    },
    [setRadioBootstrapSrc, setRadioIsLoadingTrack, setRadioPlayerError]
  );

  const loadTrackIntoWidget = useCallback(
    (embedTargetUrl: string, autoPlay: boolean) => {
      const widget = radioWidgetRef.current;
      if (!widget || !radioWidgetReadyRef.current) {
        radioLoadedUrlRef.current = embedTargetUrl;
        radioPendingAutoPlayRef.current = autoPlay;
        if (autoPlay) {
          userInitiatedPauseRef.current = false;
          lastPlayAttemptAtRef.current = Date.now();
          playConfirmedProgressRef.current = false;
          setRadioIsLoadingTrack(true);
        }
        return;
      }
      radioWidgetReadyRef.current = false;
      radioLoadedUrlRef.current = embedTargetUrl;
      radioPendingAutoPlayRef.current = autoPlay;
      if (autoPlay) {
        userInitiatedPauseRef.current = false;
        lastPlayAttemptAtRef.current = Date.now();
        playConfirmedProgressRef.current = false;
      }
      setRadioIsLoadingTrack(true);
      setRadioPositionMs(0);
      setRadioDurationMs(0);
      setRadioPlayerError(null);
      widget.load(embedTargetUrl, {
        auto_play: autoPlay,
        hide_related: true,
        show_comments: false,
        show_user: true,
        show_reposts: false,
        show_teaser: false,
        show_artwork: true,
        visual: false,
        buying: false,
        sharing: false,
        download: false,
        callback: () => {
          radioWidgetReadyRef.current = true;
          widget.setVolume(radioIsMutedRef.current ? 0 : radioVolumeRef.current);
          widget.getDuration((dur) => {
            if (Number.isFinite(dur) && dur > 0) {
              setRadioDurationMs(dur);
            }
          });
          const activeId = radioCurrentTrackIdRef.current ?? radioTracksRef.current[0]?.id;
          if (activeId) {
            void hydrateTrackWaveform(activeId, widget);
          }
          if (autoPlay || radioPendingAutoPlayRef.current) {
            userInitiatedPauseRef.current = false;
            lastPlayAttemptAtRef.current = Date.now();
            playConfirmedProgressRef.current = false;
            setRadioIsLoadingTrack(true);
            widget.play();
          } else {
            setRadioIsLoadingTrack(false);
          }
        },
      });
    },
    [
      hydrateTrackWaveform,
      setRadioDurationMs,
      setRadioIsLoadingTrack,
      setRadioPlayerError,
      setRadioPositionMs,
    ]
  );

  const handleRadioSelectTrack = useCallback(
    (trackId: string, autoPlay = true, scope?: 'repertoire' | 'saved') => {
      if (!isGuestAuthenticated) return;
      if (scope) {
        setRadioPlaybackScope(scope);
        radioPlaybackScopeRef.current = scope;
      }
      const target =
        allRadioTracksRef.current.find((t) => t.id === trackId) ??
        radioTracksRef.current.find((t) => t.id === trackId);
      if (!target) return;
      setRadioCurrentTrackId(target.id);
      setRadioPlayerError(null);
      const targetUrl = getTrackEmbedTarget(target);
      if (targetUrl) {
        if (!radioBootstrapSrcRef.current) {
          bootstrapRadioIframe(targetUrl, autoPlay);
          return;
        }
        loadTrackIntoWidget(targetUrl, autoPlay);
      }
    },
    [
      isGuestAuthenticated,
      getTrackEmbedTarget,
      bootstrapRadioIframe,
      loadTrackIntoWidget,
      setRadioPlaybackScope,
      setRadioCurrentTrackId,
      setRadioPlayerError,
    ]
  );

  const handleRadioNextTrack = useCallback(() => {
    if (!isGuestAuthenticated) return;
    const list =
      radioPlaybackScopeRef.current === 'saved' && savedRadioTracksRef.current.length > 0
        ? savedRadioTracksRef.current
        : radioTracksRef.current;
    if (list.length === 0) return;
    radioFinishingTransitionUntilRef.current = Date.now() + 2000;
    if (list.length === 1) {
      const only = list[0];
      setRadioCurrentTrackId(only.id);
      setRadioPositionMs(0);
      if (radioWidgetRef.current && radioWidgetReadyRef.current) {
        radioPendingAutoPlayRef.current = true;
        userInitiatedPauseRef.current = false;
        lastPlayAttemptAtRef.current = Date.now();
        playConfirmedProgressRef.current = false;
        setRadioIsLoadingTrack(true);
        const w = radioWidgetRef.current;
        w.seekTo(0);
        window.setTimeout(() => {
          w.play();
        }, 70);
      } else {
        const targetUrl = getTrackEmbedTarget(only);
        if (targetUrl) {
          if (!radioBootstrapSrcRef.current) {
            bootstrapRadioIframe(targetUrl, true);
          } else {
            loadTrackIntoWidget(targetUrl, true);
          }
        }
      }
      return;
    }
    const curIdx = list.findIndex((t) => t.id === radioCurrentTrackIdRef.current);
    const nextTrack = list[(curIdx >= 0 ? curIdx + 1 : 0) % list.length];
    handleRadioSelectTrack(nextTrack.id, true);
  }, [
    isGuestAuthenticated,
    getTrackEmbedTarget,
    bootstrapRadioIframe,
    handleRadioSelectTrack,
    loadTrackIntoWidget,
    setRadioCurrentTrackId,
    setRadioIsLoadingTrack,
    setRadioPositionMs,
  ]);

  const handleRadioPrevTrack = useCallback(() => {
    if (!isGuestAuthenticated) return;
    const list =
      radioPlaybackScopeRef.current === 'saved' && savedRadioTracksRef.current.length > 0
        ? savedRadioTracksRef.current
        : radioTracksRef.current;
    if (list.length === 0) return;
    const curIdx = list.findIndex((t) => t.id === radioCurrentTrackIdRef.current);
    const prevIdx = curIdx >= 0 ? (curIdx - 1 + list.length) % list.length : list.length - 1;
    handleRadioSelectTrack(list[prevIdx].id, true);
  }, [isGuestAuthenticated, handleRadioSelectTrack]);

  const handleRadioTogglePlay = useCallback(() => {
    const targetUrl = getTrackEmbedTarget(activeRadioTrack);
    if (!isGuestAuthenticated || !targetUrl) return;
    setRadioPlayerError(null);
    const widget = radioWidgetRef.current;
    if (widget && radioWidgetReadyRef.current) {
      if (radioIsPlayingRef.current) {
        radioPendingAutoPlayRef.current = false;
        userInitiatedPauseRef.current = true;
        widget.pause();
      } else {
        radioPendingAutoPlayRef.current = true;
        userInitiatedPauseRef.current = false;
        lastPlayAttemptAtRef.current = Date.now();
        playConfirmedProgressRef.current = false;
        setRadioIsLoadingTrack(true);
        widget.play();
      }
      return;
    }
    radioPendingAutoPlayRef.current = true;
    userInitiatedPauseRef.current = false;
    lastPlayAttemptAtRef.current = Date.now();
    playConfirmedProgressRef.current = false;
    setRadioIsLoadingTrack(true);
    if (!radioBootstrapSrcRef.current) {
      bootstrapRadioIframe(targetUrl, true);
    } else {
      radioLoadedUrlRef.current = targetUrl;
    }
  }, [
    isGuestAuthenticated,
    activeRadioTrack,
    getTrackEmbedTarget,
    bootstrapRadioIframe,
    setRadioIsLoadingTrack,
    setRadioPlayerError,
  ]);

  const handleRadioSeekTo = useCallback(
    (ms: number) => {
      setRadioPositionMs(ms);
      updateRadioTelemetryPlayback({ positionMs: ms });
      if (radioWidgetRef.current && radioWidgetReadyRef.current) {
        radioWidgetRef.current.seekTo(ms);
      }
    },
    [setRadioPositionMs]
  );

  const handleRadioVolumeChange = useCallback(
    (nextVol: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(nextVol)));
      setRadioVolume(clamped);
      setRadioIsMuted(clamped === 0);
      updateRadioTelemetryPlayback({ volume: clamped, isMuted: clamped === 0 });
      if (radioWidgetRef.current && radioWidgetReadyRef.current) {
        radioWidgetRef.current.setVolume(clamped);
      }
    },
    [setRadioIsMuted, setRadioVolume]
  );

  const handleRadioToggleMute = useCallback(() => {
    setRadioIsMuted((prev) => {
      const next = !prev;
      updateRadioTelemetryPlayback({ isMuted: next });
      if (radioWidgetRef.current && radioWidgetReadyRef.current) {
        radioWidgetRef.current.setVolume(next ? 0 : radioVolumeRef.current);
      }
      return next;
    });
  }, [setRadioIsMuted]);

  const handleRadioStationChange = useCallback(
    (nextStation: RadioStationId) => {
      setRadioPlaybackScope('repertoire');
      radioPlaybackScopeRef.current = 'repertoire';
      if (nextStation === activeRadioStation) return;
      setActiveRadioStation(nextStation);
      setRadioPlayerError(null);
      const nextList = selectRadioStationRepertoire(
        allRadioTracksRef.current,
        nextStation
      ).repertoireTracks;
      if (nextList.length === 0) {
        if (radioWidgetRef.current && radioWidgetReadyRef.current) {
          userInitiatedPauseRef.current = true;
          radioWidgetRef.current.pause();
        }
        radioPendingAutoPlayRef.current = false;
        setRadioCurrentTrackId(null);
        setRadioIsPlaying(false);
        setRadioIsLoadingTrack(false);
        setRadioPositionMs(0);
        setRadioDurationMs(0);
        return;
      }
      const firstTrack = nextList[0];
      setRadioCurrentTrackId(firstTrack.id);
      const shouldAutoPlay = Boolean(
        isGuestAuthenticated && (radioIsPlayingRef.current || activeSection === 'radio')
      );
      const targetUrl = getTrackEmbedTarget(firstTrack);
      if (isGuestAuthenticated && targetUrl) {
        if (!radioBootstrapSrcRef.current) {
          bootstrapRadioIframe(targetUrl, shouldAutoPlay);
          return;
        }
        loadTrackIntoWidget(targetUrl, shouldAutoPlay);
      }
    },
    [
      activeRadioStation,
      activeSection,
      isGuestAuthenticated,
      getTrackEmbedTarget,
      bootstrapRadioIframe,
      loadTrackIntoWidget,
      setActiveRadioStation,
      setRadioCurrentTrackId,
      setRadioDurationMs,
      setRadioIsLoadingTrack,
      setRadioIsPlaying,
      setRadioPlaybackScope,
      setRadioPlayerError,
      setRadioPositionMs,
    ]
  );

  const handleRadioTracksUpdated = useCallback(
    (
      nextAllTracks: RadioTrack[],
      activateTrackId?: string | null,
      targetStation?: RadioStationId
    ) => {
      if (targetStation) {
        setActiveRadioStation(targetStation);
      }
      const annotated = annotateAllRadioTracksWithRepertoire(nextAllTracks);
      legacyRadioSeededRef.current = true;
      hadFirestoreRadioTracksRef.current = true;
      setHasHydratedFirestoreRadio(true);
      radioCloudMutationUntilRef.current = Date.now() + 5000;
      serverRadioSyncedRef.current = annotated
        .map((t) => `${t.id}:${t.station || 'indie'}:${t.order ?? 0}`)
        .join('|');
      setFirestoreRadioTracks((prev) => (prev !== null ? annotated : prev));
      setRadioTracksInCatalog(annotated);
      allRadioTracksRef.current = annotated;
      const effectiveStation = targetStation ?? activeRadioStation;
      radioTracksRef.current = selectRadioStationRepertoire(
        annotated,
        effectiveStation
      ).repertoireTracks;
      if (activateTrackId && isGuestAuthenticated) {
        const target = annotated.find((t) => t.id === activateTrackId);
        if (target) {
          setRadioPlaybackScope('repertoire');
          radioPlaybackScopeRef.current = 'repertoire';
          setRadioCurrentTrackId(target.id);
          setRadioPlayerError(null);
          const targetUrl = getTrackEmbedTarget(target);
          if (targetUrl) {
            if (!radioBootstrapSrcRef.current) {
              bootstrapRadioIframe(targetUrl, true);
              return;
            }
            loadTrackIntoWidget(targetUrl, true);
          }
        }
      }
    },
    [
      activeRadioStation,
      isGuestAuthenticated,
      getTrackEmbedTarget,
      bootstrapRadioIframe,
      loadTrackIntoWidget,
      setActiveRadioStation,
      setFirestoreRadioTracks,
      setHasHydratedFirestoreRadio,
      setRadioCurrentTrackId,
      setRadioPlaybackScope,
      setRadioPlayerError,
      setRadioTracksInCatalog,
    ]
  );

  const handlePauseRadio = useCallback(() => {
    radioPendingAutoPlayRef.current = false;
    userInitiatedPauseRef.current = true;
    setRadioIsPlaying(false);
    setRadioIsLoadingTrack(false);
    if (radioWidgetRef.current && radioWidgetReadyRef.current) {
      radioWidgetRef.current.pause();
    }
  }, [setRadioIsLoadingTrack, setRadioIsPlaying]);

  useEffect(() => {
    setHandlers({
      selectTrack: handleRadioSelectTrack,
      nextTrack: handleRadioNextTrack,
      prevTrack: handleRadioPrevTrack,
      togglePlay: handleRadioTogglePlay,
      seekTo: handleRadioSeekTo,
      setVolume: handleRadioVolumeChange,
      toggleMute: handleRadioToggleMute,
      changeStation: handleRadioStationChange,
      pauseRadio: handlePauseRadio,
      notifyTracksUpdated: handleRadioTracksUpdated,
    });
  }, [
    setHandlers,
    handleRadioSelectTrack,
    handleRadioNextTrack,
    handleRadioPrevTrack,
    handleRadioTogglePlay,
    handleRadioSeekTo,
    handleRadioVolumeChange,
    handleRadioToggleMute,
    handleRadioStationChange,
    handlePauseRadio,
    handleRadioTracksUpdated,
  ]);

  const handleRadioNextTrackRef = useRef(handleRadioNextTrack);
  handleRadioNextTrackRef.current = handleRadioNextTrack;
  const loadTrackIntoWidgetRef = useRef(loadTrackIntoWidget);
  loadTrackIntoWidgetRef.current = loadTrackIntoWidget;
  const hydrateTrackWaveformRef = useRef(hydrateTrackWaveform);
  hydrateTrackWaveformRef.current = hydrateTrackWaveform;

  useEffect(() => {
    if (!isGuestAuthenticated) return;
    void loadSoundCloudWidgetApi().catch(() => {});
  }, [isGuestAuthenticated]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void subscribeWeeklyMusicSelections((selections) => {
      if (active) {
        setFirestoreWeeklyMusic(selections);
      }
    })
      .then((unsub) => {
        if (active) {
          unsubscribe = unsub;
        } else {
          unsub();
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [setFirestoreWeeklyMusic]);

  useEffect(() => {
    if (!guestUser) {
      setFirestoreRadioTracks(null);
      legacyRadioSeededRef.current = false;
      hadFirestoreRadioTracksRef.current = false;
      setHasHydratedFirestoreRadio(false);
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void subscribeRadioTracks((tracks) => {
      if (active) {
        if (tracks.length > 0) {
          hadFirestoreRadioTracksRef.current = true;
          setHasHydratedFirestoreRadio(true);
        }
        setFirestoreRadioTracks(tracks);
      }
    })
      .then((unsub) => {
        if (active) {
          unsubscribe = unsub;
        } else {
          unsub();
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [guestUser, setFirestoreRadioTracks, setHasHydratedFirestoreRadio]);

  useEffect(() => {
    if (!isAdmin || firestoreRadioTracks === null) return;
    if (Date.now() < radioCloudMutationUntilRef.current) return;
    const serverTracks = serverRadioTracks ?? [];
    if (
      firestoreRadioTracks.length === 0 &&
      serverTracks.length > 0 &&
      !legacyRadioSeededRef.current &&
      !hadFirestoreRadioTracksRef.current
    ) {
      legacyRadioSeededRef.current = true;
      setHasHydratedFirestoreRadio(true);
      void syncLegacyServerTracksToFirestore(serverTracks).catch(() => {});
      return;
    }
    const firestoreKey = firestoreRadioTracks
      .map((t) => `${t.id}:${t.station}:${t.order ?? 0}`)
      .join('|');
    const serverKey = serverTracks
      .map((t) => `${t.id}:${t.station || 'indie'}:${t.order ?? 0}`)
      .join('|');
    if (
      (firestoreRadioTracks.length > 0 || hadFirestoreRadioTracksRef.current) &&
      firestoreKey !== serverKey &&
      serverRadioSyncedRef.current !== firestoreKey
    ) {
      serverRadioSyncedRef.current = firestoreKey;
      void getAdminToken().then((token) => {
        if (!token) return;
        return fetch('/api/author/radio/tracks/sync', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ tracks: firestoreRadioTracks }),
        }).catch(() => {});
      });
    }
  }, [isAdmin, firestoreRadioTracks, serverRadioTracks, getAdminToken, setHasHydratedFirestoreRadio]);

  useEffect(() => {
    if (!isGuestAuthenticated) {
      radioWidgetRef.current = null;
      radioWidgetReadyRef.current = false;
      radioLoadedUrlRef.current = null;
      radioPendingAutoPlayRef.current = false;
      radioBootstrapInFlightRef.current = false;
      setRadioBootstrapSrc(null);
      setRadioShowDirectEmbed(false);
      setRadioIsPlaying(false);
      setRadioIsLoadingTrack(false);
      setRadioPositionMs(0);
      setRadioDurationMs(0);
      setRadioPlayerError(null);
      return;
    }
    const activeScopeList =
      radioPlaybackScope === 'saved' && savedRadioTracks.length > 0
        ? savedRadioTracks
        : radioTracks;
    if (activeScopeList.length === 0) {
      setRadioCurrentTrackId(null);
      setRadioIsPlaying(false);
      setRadioPositionMs(0);
      setRadioDurationMs(0);
      return;
    }
    if (!radioCurrentTrackId || !activeScopeList.some((t) => t.id === radioCurrentTrackId)) {
      setRadioCurrentTrackId(activeScopeList[0].id);
    }
  }, [
    isGuestAuthenticated,
    radioTracks,
    savedRadioTracks,
    radioPlaybackScope,
    radioCurrentTrackId,
    setRadioBootstrapSrc,
    setRadioCurrentTrackId,
    setRadioDurationMs,
    setRadioIsLoadingTrack,
    setRadioIsPlaying,
    setRadioPlayerError,
    setRadioPositionMs,
    setRadioShowDirectEmbed,
  ]);

  useEffect(() => {
    if (!radioIsLoadingTrack) return;
    const timer = window.setTimeout(() => {
      if (radioIsPlayingRef.current) return;
      radioPendingAutoPlayRef.current = false;
      setRadioIsLoadingTrack(false);
      setRadioPlayerError(
        'Плеєр не відповів вчасно. Натисніть «Відкрити плеєр SoundCloud» нижче або спробуйте ще раз.'
      );
      setRadioShowDirectEmbed(true);
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [radioIsLoadingTrack, setRadioIsLoadingTrack, setRadioPlayerError, setRadioShowDirectEmbed]);

  useEffect(() => {
    const targetUrl = getTrackEmbedTarget(activeRadioTrack);
    if (!isGuestAuthenticated || radioBootstrapSrc || !targetUrl) return;
    if (activeSection !== 'radio' && !radioPendingAutoPlayRef.current) return;
    bootstrapRadioIframe(targetUrl, radioPendingAutoPlayRef.current);
  }, [
    isGuestAuthenticated,
    radioBootstrapSrc,
    activeRadioTrack,
    activeSection,
    getTrackEmbedTarget,
    bootstrapRadioIframe,
  ]);

  useEffect(() => {
    if (!isGuestAuthenticated || !radioBootstrapSrc || !radioIframeRef.current) return;
    let cancelled = false;
    let widget: SCWidgetInstance | null = null;
    let scEvents: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      FINISH: string;
      PLAY_PROGRESS: string;
      ERROR: string;
    } | null = null;

    loadSoundCloudWidgetApi()
      .then((WidgetFactory) => {
        if (cancelled || !radioIframeRef.current) return;
        scEvents = WidgetFactory.Events;
        widget = WidgetFactory(radioIframeRef.current);
        radioWidgetRef.current = widget;

        widget.bind(scEvents.READY, () => {
          if (cancelled || !widget) return;
          radioWidgetReadyRef.current = true;
          widget.setVolume(radioIsMutedRef.current ? 0 : radioVolumeRef.current);
          widget.getDuration((dur) => {
            if (!cancelled && Number.isFinite(dur) && dur > 0) {
              setRadioDurationMs(dur);
            }
          });

          const list =
            radioPlaybackScopeRef.current === 'saved' && savedRadioTracksRef.current.length > 0
              ? savedRadioTracksRef.current
              : radioTracksRef.current;
          const desired =
            allRadioTracksRef.current.find((t) => t.id === radioCurrentTrackIdRef.current) ??
            list[0];
          if (desired?.id) {
            void hydrateTrackWaveformRef.current(desired.id, widget);
          }
          const desiredUrl = getTrackEmbedTarget(desired);
          if (desiredUrl && desiredUrl !== radioLoadedUrlRef.current) {
            loadTrackIntoWidgetRef.current(desiredUrl, radioPendingAutoPlayRef.current);
          } else if (radioPendingAutoPlayRef.current) {
            userInitiatedPauseRef.current = false;
            lastPlayAttemptAtRef.current = Date.now();
            playConfirmedProgressRef.current = false;
            setRadioIsLoadingTrack(true);
            widget.play();
          } else {
            setRadioIsLoadingTrack(false);
          }
        });

        widget.bind(scEvents.PLAY, () => {
          if (cancelled || !widget) return;
          radioPendingAutoPlayRef.current = false;
          userInitiatedPauseRef.current = false;
          setRadioIsLoadingTrack(false);
          setRadioIsPlaying(true);
          setRadioPlayerError(null);
          const currentId = radioCurrentTrackIdRef.current ?? radioTracksRef.current[0]?.id;
          if (currentId) {
            void hydrateTrackWaveformRef.current(currentId, widget);
          }
          widget.getDuration((dur) => {
            if (!cancelled && Number.isFinite(dur) && dur > 0) {
              setRadioDurationMs(dur);
            }
          });
        });

        widget.bind(scEvents.PAUSE, () => {
          if (cancelled) return;
          if (
            !radioWidgetReadyRef.current ||
            Date.now() < radioFinishingTransitionUntilRef.current
          ) {
            return;
          }
          setRadioIsPlaying(false);
          setRadioIsLoadingTrack(false);
          const bouncedImmediately =
            !userInitiatedPauseRef.current &&
            !playConfirmedProgressRef.current &&
            Date.now() - lastPlayAttemptAtRef.current < 1800;
          if (bouncedImmediately) {
            setRadioPlayerError(
              'Браузер обмежив автозапуск аудіо з прихованого вікна. Натисніть Play у вбудованому плеєрі SoundCloud або відкрийте трек напряму.'
            );
            setRadioShowDirectEmbed(true);
          }
          userInitiatedPauseRef.current = false;
        });

        widget.bind(scEvents.PLAY_PROGRESS, (rawPayload?: unknown) => {
          if (cancelled || !rawPayload || typeof rawPayload !== 'object') return;
          const payload = rawPayload as SCPlayProgressPayload;
          if (typeof payload.currentPosition === 'number') {
            if (payload.currentPosition > 120) {
              playConfirmedProgressRef.current = true;
              setRadioShowDirectEmbed(false);
            }
            setRadioPositionMs(payload.currentPosition);
            updateRadioTelemetryPlayback({
              positionMs: payload.currentPosition,
              relativePosition:
                typeof payload.relativePosition === 'number'
                  ? payload.relativePosition
                  : undefined,
            });
          }
        });

        widget.bind(scEvents.FINISH, () => {
          if (cancelled) return;
          radioFinishingTransitionUntilRef.current = Date.now() + 2000;
          setRadioIsPlaying(false);
          setRadioPositionMs(0);
          playConfirmedProgressRef.current = false;
          handleRadioNextTrackRef.current();
        });

        widget.bind(scEvents.ERROR, () => {
          if (cancelled) return;
          radioPendingAutoPlayRef.current = false;
          setRadioIsLoadingTrack(false);
          setRadioIsPlaying(false);
          setRadioPlayerError(
            'Не вдалося запустити цей трек у прихованому плеєрі. Спробуйте вбудований плеєр SoundCloud або відкрийте трек напряму.'
          );
          setRadioShowDirectEmbed(true);
        });
      })
      .catch(() => {
        if (!cancelled) {
          radioPendingAutoPlayRef.current = false;
          setRadioIsLoadingTrack(false);
          setRadioPlayerError('Не вдалося підключити плеєр SoundCloud.');
        }
      });

    return () => {
      cancelled = true;
      radioWidgetReadyRef.current = false;
      if (widget && scEvents) {
        try {
          widget.unbind(scEvents.READY);
          widget.unbind(scEvents.PLAY);
          widget.unbind(scEvents.PAUSE);
          widget.unbind(scEvents.PLAY_PROGRESS);
          widget.unbind(scEvents.FINISH);
          widget.unbind(scEvents.ERROR);
        } catch {
          // Ignore widget cleanup errors
        }
      }
      radioWidgetRef.current = null;
    };
  }, [
    isGuestAuthenticated,
    radioBootstrapSrc,
    getTrackEmbedTarget,
    setRadioDurationMs,
    setRadioIsLoadingTrack,
    setRadioIsPlaying,
    setRadioPlayerError,
    setRadioPositionMs,
    setRadioShowDirectEmbed,
  ]);

  if (!guestUser || !radioBootstrapSrc) return null;

  return (
    <div
      aria-hidden={!radioShowDirectEmbed || isPoetryImmersed}
      className={
        radioShowDirectEmbed && !isPoetryImmersed
          ? 'fixed bottom-[76px] sm:bottom-[82px] right-3 sm:right-6 z-50 w-[min(calc(100vw-1.5rem),22rem)] rounded-2xl bg-[#202020] p-2 shadow-2xl space-y-1.5'
          : 'fixed bottom-0 right-0 w-[300px] h-[166px] opacity-[0.01] pointer-events-none -z-10'
      }
    >
      {radioShowDirectEmbed && !isPoetryImmersed && (
        <div className="flex items-center justify-between px-1.5 text-[11px] text-[#C4BFB4]">
          <span className="truncate font-medium">Плеєр SoundCloud</span>
          <button
            type="button"
            onClick={() => setRadioShowDirectEmbed(false)}
            aria-label="Згорнути плеєр SoundCloud"
            className="p-1 rounded-lg hover:bg-white/10 text-[#C4BFB4] hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <iframe
        ref={radioIframeRef}
        id={RADIO_IFRAME_ID}
        title="Радіостанція SoundCloud"
        src={radioBootstrapSrc}
        allow="autoplay; encrypted-media"
        tabIndex={radioShowDirectEmbed ? 0 : -1}
        className="w-full h-[166px] rounded-xl border-0 block"
      />
    </div>
  );
});
