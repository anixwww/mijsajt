import { create } from 'zustand';
import type { RadioStationId, RadioTrack, WeeklyMusicSelection } from '../types.ts';

export const RADIO_ENABLED_STORAGE_KEY = 'dankiv_radio_enabled_v1';

function readInitialRadioEnabled(): boolean {
  try {
    const saved = localStorage.getItem(RADIO_ENABLED_STORAGE_KEY);
    if (saved !== null) return saved === 'true';
    return true;
  } catch {
    return true;
  }
}

export interface RadioHandlers {
  selectTrack: (trackId: string, autoPlay?: boolean, scope?: 'repertoire' | 'saved') => void;
  nextTrack: () => void;
  prevTrack: () => void;
  togglePlay: () => void;
  seekTo: (ms: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  changeStation: (station: RadioStationId) => void;
  pauseRadio: () => void;
  notifyTracksUpdated: (
    nextAllTracks: RadioTrack[],
    activateTrackId?: string | null,
    targetStation?: RadioStationId
  ) => void;
}

const noop = () => {};

interface RadioState {
  firestoreRadioTracks: RadioTrack[] | null;
  hasHydratedFirestoreRadio: boolean;
  firestoreWeeklyMusic: WeeklyMusicSelection[] | null;
  activeRadioStation: RadioStationId;
  radioPlaybackScope: 'repertoire' | 'saved';
  radioCurrentTrackId: string | null;
  radioIsPlaying: boolean;
  radioIsLoadingTrack: boolean;
  radioPositionMs: number;
  radioDurationMs: number;
  radioVolume: number;
  radioIsMuted: boolean;
  radioPlayerError: string | null;
  radioBootstrapSrc: string | null;
  radioShowDirectEmbed: boolean;
  radioEnabled: boolean;
  handlers: RadioHandlers;
  setFirestoreRadioTracks: (
    tracks: RadioTrack[] | null | ((prev: RadioTrack[] | null) => RadioTrack[] | null)
  ) => void;
  setHasHydratedFirestoreRadio: (hydrated: boolean) => void;
  setFirestoreWeeklyMusic: (selections: WeeklyMusicSelection[] | null) => void;
  setActiveRadioStation: (station: RadioStationId) => void;
  setRadioPlaybackScope: (scope: 'repertoire' | 'saved') => void;
  setRadioCurrentTrackId: (id: string | null) => void;
  setRadioIsPlaying: (playing: boolean) => void;
  setRadioIsLoadingTrack: (loading: boolean) => void;
  setRadioPositionMs: (ms: number) => void;
  setRadioDurationMs: (ms: number) => void;
  setRadioVolume: (vol: number) => void;
  setRadioIsMuted: (muted: boolean | ((prev: boolean) => boolean)) => void;
  setRadioPlayerError: (err: string | null) => void;
  setRadioBootstrapSrc: (src: string | null) => void;
  setRadioShowDirectEmbed: (show: boolean | ((prev: boolean) => boolean)) => void;
  setRadioEnabled: (enabled: boolean) => void;
  setHandlers: (handlers: RadioHandlers) => void;
}

export const useRadioStore = create<RadioState>((set) => ({
  firestoreRadioTracks: null,
  hasHydratedFirestoreRadio: false,
  firestoreWeeklyMusic: null,
  activeRadioStation: 'indie',
  radioPlaybackScope: 'repertoire',
  radioCurrentTrackId: null,
  radioIsPlaying: false,
  radioIsLoadingTrack: false,
  radioPositionMs: 0,
  radioDurationMs: 0,
  radioVolume: 85,
  radioIsMuted: false,
  radioPlayerError: null,
  radioBootstrapSrc: null,
  radioShowDirectEmbed: false,
  radioEnabled: readInitialRadioEnabled(),
  handlers: {
    selectTrack: noop,
    nextTrack: noop,
    prevTrack: noop,
    togglePlay: noop,
    seekTo: noop,
    setVolume: noop,
    toggleMute: noop,
    changeStation: noop,
    pauseRadio: noop,
    notifyTracksUpdated: noop,
  },

  setFirestoreRadioTracks: (tracks) =>
    set((state) => ({
      firestoreRadioTracks:
        typeof tracks === 'function' ? tracks(state.firestoreRadioTracks) : tracks,
    })),
  setHasHydratedFirestoreRadio: (hasHydratedFirestoreRadio) => set({ hasHydratedFirestoreRadio }),
  setFirestoreWeeklyMusic: (firestoreWeeklyMusic) => set({ firestoreWeeklyMusic }),
  setActiveRadioStation: (activeRadioStation) => set({ activeRadioStation }),
  setRadioPlaybackScope: (radioPlaybackScope) => set({ radioPlaybackScope }),
  setRadioCurrentTrackId: (radioCurrentTrackId) => set({ radioCurrentTrackId }),
  setRadioIsPlaying: (radioIsPlaying) => set({ radioIsPlaying }),
  setRadioIsLoadingTrack: (radioIsLoadingTrack) => set({ radioIsLoadingTrack }),
  setRadioPositionMs: (radioPositionMs) => set({ radioPositionMs }),
  setRadioDurationMs: (radioDurationMs) => set({ radioDurationMs }),
  setRadioVolume: (radioVolume) => set({ radioVolume }),
  setRadioIsMuted: (muted) =>
    set((state) => ({
      radioIsMuted: typeof muted === 'function' ? muted(state.radioIsMuted) : muted,
    })),
  setRadioPlayerError: (radioPlayerError) => set({ radioPlayerError }),
  setRadioBootstrapSrc: (radioBootstrapSrc) => set({ radioBootstrapSrc }),
  setRadioShowDirectEmbed: (show) =>
    set((state) => ({
      radioShowDirectEmbed:
        typeof show === 'function' ? show(state.radioShowDirectEmbed) : show,
    })),
  setRadioEnabled: (radioEnabled) => {
    try {
      localStorage.setItem(RADIO_ENABLED_STORAGE_KEY, radioEnabled ? 'true' : 'false');
    } catch {
      // Ignore storage errors
    }
    set({ radioEnabled });
  },
  setHandlers: (handlers) => set({ handlers }),
}));
