import { useMemo } from 'react';
import { useAuthStore } from '../store/useAuthStore.ts';
import { useCatalogStore } from '../store/useCatalogStore.ts';
import { useRadioStore } from '../store/useRadioStore.ts';
import type { GuestUser, RadioStationId, RadioTrack } from '../types.ts';
import {
  annotateAllRadioTracksWithRepertoire,
  getSavedRadioTracks,
  selectRadioStationRepertoire,
} from './radioRepertoire.ts';

export function buildAllRadioTracks(
  firestoreRadioTracks: RadioTrack[] | null,
  hasHydratedFirestoreRadio: boolean,
  serverTracks: RadioTrack[],
  guestUser: GuestUser | null
): RadioTrack[] {
  const serverById = new Map(serverTracks.map((t) => [t.id, t]));
  const likedSet = new Set(guestUser?.likedRadioTrackIds ?? []);
  const baseTracks =
    firestoreRadioTracks !== null &&
    (firestoreRadioTracks.length > 0 || hasHydratedFirestoreRadio)
      ? firestoreRadioTracks
      : serverTracks;

  const annotatedInput = baseTracks.map((track) => {
    const serverTrack = serverById.get(track.id);
    const likesCount =
      typeof track.likesCount === 'number'
        ? track.likesCount
        : (serverTrack?.likesCount ?? 0);
    const isLiked = guestUser
      ? guestUser.likedRadioTrackIds !== undefined
        ? likedSet.has(track.id)
        : Boolean(track.isLiked ?? serverTrack?.isLiked)
      : false;
    return {
      ...track,
      likesCount,
      isLiked,
    };
  });

  return annotateAllRadioTracksWithRepertoire(annotatedInput);
}

export function resolveActiveRadioTrack(
  guestUser: GuestUser | null,
  radioPlaybackScope: 'repertoire' | 'saved',
  savedRadioTracks: RadioTrack[],
  radioTracks: RadioTrack[],
  allRadioTracks: RadioTrack[],
  radioCurrentTrackId: string | null,
  activeRadioStation: RadioStationId
): RadioTrack | null {
  if (!guestUser) return null;
  const preferredList =
    radioPlaybackScope === 'saved' && savedRadioTracks.length > 0
      ? savedRadioTracks
      : radioTracks;
  if (radioCurrentTrackId) {
    const inPreferred = preferredList.find((t) => t.id === radioCurrentTrackId);
    if (inPreferred) return inPreferred;
    const inAll = allRadioTracks.find((t) => t.id === radioCurrentTrackId);
    if (
      inAll &&
      (radioPlaybackScope === 'saved' || (inAll.station || 'indie') === activeRadioStation)
    ) {
      return inAll;
    }
  }
  return preferredList[0] ?? radioTracks[0] ?? null;
}

export function useAllRadioTracks(): RadioTrack[] {
  const firestoreRadioTracks = useRadioStore((s) => s.firestoreRadioTracks);
  const hasHydratedFirestoreRadio = useRadioStore((s) => s.hasHydratedFirestoreRadio);
  const serverTracks = useCatalogStore((s) => s.catalog?.radioTracks);
  const guestUser = useAuthStore((s) => s.guestUser);

  return useMemo(
    () =>
      buildAllRadioTracks(
        firestoreRadioTracks,
        hasHydratedFirestoreRadio,
        serverTracks ?? [],
        guestUser
      ),
    [firestoreRadioTracks, hasHydratedFirestoreRadio, serverTracks, guestUser]
  );
}

export function useRadioDerivedState() {
  const allRadioTracks = useAllRadioTracks();
  const guestUser = useAuthStore((s) => s.guestUser);
  const activeRadioStation = useRadioStore((s) => s.activeRadioStation);
  const radioPlaybackScope = useRadioStore((s) => s.radioPlaybackScope);
  const radioCurrentTrackId = useRadioStore((s) => s.radioCurrentTrackId);

  const radioTracks = useMemo(
    () => selectRadioStationRepertoire(allRadioTracks, activeRadioStation).repertoireTracks,
    [allRadioTracks, activeRadioStation]
  );

  const savedRadioTracks = useMemo(
    () => getSavedRadioTracks(allRadioTracks, guestUser?.likedRadioTrackIds),
    [allRadioTracks, guestUser?.likedRadioTrackIds]
  );

  const activeRadioTrack = useMemo(
    () =>
      resolveActiveRadioTrack(
        guestUser,
        radioPlaybackScope,
        savedRadioTracks,
        radioTracks,
        allRadioTracks,
        radioCurrentTrackId,
        activeRadioStation
      ),
    [
      guestUser,
      radioPlaybackScope,
      savedRadioTracks,
      radioTracks,
      allRadioTracks,
      radioCurrentTrackId,
      activeRadioStation,
    ]
  );

  return {
    allRadioTracks,
    radioTracks,
    savedRadioTracks,
    activeRadioTrack,
  };
}
