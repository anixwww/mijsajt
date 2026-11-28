import {
  getFirebaseAuth,
  getFirebaseDb,
  handleFirestoreError,
  OperationType,
} from '../firebase.ts';
import type { RadioStationId, RadioTrack } from '../types.ts';

const RADIO_COLLECTION = 'radioTracks';

function normalizeStation(value: unknown): RadioStationId {
  return value === 'electronic' ? 'electronic' : 'indie';
}

function sanitizeSafeHttpUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().slice(0, 500);
  return /^https?:\/\/.+/.test(trimmed) ? trimmed : '';
}

function sortTracks(tracks: RadioTrack[]): RadioTrack[] {
  return [...tracks].sort((a, b) => {
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.addedAt.localeCompare(b.addedAt);
  });
}

function mapDocToRadioTrack(docId: string, data: Record<string, unknown>): RadioTrack | null {
  const soundcloudUrl = sanitizeSafeHttpUrl(data.soundcloudUrl);
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!soundcloudUrl || !title) return null;

  const embedTargetUrl = sanitizeSafeHttpUrl(data.embedTargetUrl) || soundcloudUrl;
  const artworkUrl = sanitizeSafeHttpUrl(data.artworkUrl);
  const artist =
    typeof data.artist === 'string' && data.artist.trim() ? data.artist.trim() : 'SoundCloud';
  const order = typeof data.order === 'number' && Number.isFinite(data.order) ? data.order : 0;

  let addedAt = new Date().toISOString();
  const createdAt = data.createdAt as { toDate?: () => Date } | undefined;
  if (createdAt && typeof createdAt.toDate === 'function') {
    addedAt = createdAt.toDate().toISOString();
  }

  return {
    id: typeof data.id === 'string' && data.id.trim() ? data.id.trim() : docId,
    title,
    artist,
    soundcloudUrl,
    embedTargetUrl,
    ...(artworkUrl ? { artworkUrl } : {}),
    station: normalizeStation(data.station),
    order,
    addedAt,
  };
}

export async function subscribeRadioTracks(
  onTracks: (tracks: RadioTrack[]) => void,
  _onPermissionOrReadError?: (err: unknown) => void
): Promise<() => void> {
  const auth = await getFirebaseAuth();
  await auth.authStateReady().catch(() => {});
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    return () => {};
  }

  try {
    const [db, { collection, onSnapshot, query, where }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);

    const radioQuery = query(
      collection(db, RADIO_COLLECTION),
      where('visibility', '==', 'authenticated')
    );

    return onSnapshot(
      radioQuery,
      (snapshot) => {
        const loaded: RadioTrack[] = [];
        snapshot.forEach((docSnap) => {
          const mapped = mapDocToRadioTrack(docSnap.id, docSnap.data() as Record<string, unknown>);
          if (mapped) loaded.push(mapped);
        });
        onTracks(sortTracks(loaded));
      },
      (_error) => {
        // Suppress permission popup; fall back to server-side catalog tracks
      }
    );
  } catch {
    return () => {};
  }
}

export async function saveRadioTracksToFirestore(
  tracksToAdd: RadioTrack[],
  existingAllTracks: RadioTrack[]
): Promise<void> {
  if (tracksToAdd.length === 0) return;
  const auth = await getFirebaseAuth();
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  try {
    const [db, { doc, serverTimestamp, writeBatch }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);

    const existingIds = new Set(existingAllTracks.map((t) => t.id));
    let maxOrder = existingAllTracks.reduce((acc, item, idx) => {
      const candidate = typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : idx;
      return Math.max(acc, candidate);
    }, -1);

    const batch = writeBatch(db);
    let hasWrites = false;

    for (const track of tracksToAdd) {
      if (!track.id || !/^[a-zA-Z0-9_-]{1,128}$/.test(track.id)) continue;
      if (existingIds.has(track.id)) continue;

      const soundcloudUrl = sanitizeSafeHttpUrl(track.soundcloudUrl);
      if (!soundcloudUrl) continue;
      const embedTargetUrl = sanitizeSafeHttpUrl(track.embedTargetUrl) || soundcloudUrl;
      const artworkUrl = sanitizeSafeHttpUrl(track.artworkUrl);
      const title = (track.title || 'Трек').trim().slice(0, 200) || 'Трек';
      const artist = (track.artist || 'SoundCloud').trim().slice(0, 140) || 'SoundCloud';
      const station = normalizeStation(track.station);
      maxOrder = Math.min(100000, maxOrder + 1);

      const ref = doc(db, RADIO_COLLECTION, track.id);
      batch.set(ref, {
        id: track.id,
        title,
        artist,
        soundcloudUrl,
        embedTargetUrl,
        artworkUrl,
        station,
        order: maxOrder,
        visibility: 'authenticated',
        createdByUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      existingIds.add(track.id);
      hasWrites = true;
    }

    if (!hasWrites) return;
    await batch.commit();
  } catch {
    // Gracefully fallback to server session storage
  }
}

export async function syncLegacyServerTracksToFirestore(serverTracks: RadioTrack[]): Promise<void> {
  if (serverTracks.length === 0) return;
  await saveRadioTracksToFirestore(
    serverTracks.map((t, idx) => ({ ...t, order: t.order ?? idx })),
    []
  );
}

export async function reorderRadioTracksInFirestore(
  orderedAllTracks: RadioTrack[]
): Promise<void> {
  if (orderedAllTracks.length === 0) return;
  const auth = await getFirebaseAuth();
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  try {
    const [db, { collection, doc, getDocs, query, serverTimestamp, where, writeBatch }] =
      await Promise.all([getFirebaseDb(), import('firebase/firestore')]);

    const existingSnap = await getDocs(
      query(collection(db, RADIO_COLLECTION), where('visibility', '==', 'authenticated'))
    );
    const existingIds = new Set<string>();
    existingSnap.forEach((snap) => existingIds.add(snap.id));

    const batch = writeBatch(db);
    orderedAllTracks.forEach((track, idx) => {
      if (!track.id || !/^[a-zA-Z0-9_-]{1,128}$/.test(track.id)) return;
      const ref = doc(db, RADIO_COLLECTION, track.id);
      const boundedOrder = Math.min(100000, Math.max(0, idx));
      if (existingIds.has(track.id)) {
        batch.update(ref, {
          order: boundedOrder,
          station: normalizeStation(track.station),
          updatedAt: serverTimestamp(),
        });
      } else {
        const soundcloudUrl = sanitizeSafeHttpUrl(track.soundcloudUrl);
        if (!soundcloudUrl) return;
        batch.set(ref, {
          id: track.id,
          title: (track.title || 'Трек').trim().slice(0, 200) || 'Трек',
          artist: (track.artist || 'SoundCloud').trim().slice(0, 140) || 'SoundCloud',
          soundcloudUrl,
          embedTargetUrl: sanitizeSafeHttpUrl(track.embedTargetUrl) || soundcloudUrl,
          artworkUrl: sanitizeSafeHttpUrl(track.artworkUrl),
          station: normalizeStation(track.station),
          order: boundedOrder,
          visibility: 'authenticated',
          createdByUid: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
    await batch.commit();
  } catch {
    // Fallback to server session storage
  }
}

export async function deleteRadioTrackFromFirestore(trackId: string): Promise<boolean> {
  const trimmedId = trackId.trim();
  if (!trimmedId) return false;

  const auth = await getFirebaseAuth();
  await auth.authStateReady().catch(() => {});
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return false;

  try {
    const [db, { collection, deleteDoc, doc, getDocs, query, where, writeBatch }] =
      await Promise.all([getFirebaseDb(), import('firebase/firestore')]);

    const targets = new Map<string, ReturnType<typeof doc>>();
    if (/^[a-zA-Z0-9_-]{1,128}$/.test(trimmedId)) {
      const directRef = doc(db, RADIO_COLLECTION, trimmedId);
      targets.set(directRef.path, directRef);
    }

    try {
      const matchingSnap = await getDocs(
        query(collection(db, RADIO_COLLECTION), where('id', '==', trimmedId))
      );
      matchingSnap.forEach((docSnap) => {
        targets.set(docSnap.ref.path, docSnap.ref);
      });
    } catch {
      // Direct doc reference remains queued below if query listing is unavailable
    }

    if (targets.size === 0) return false;

    if (targets.size === 1) {
      const [onlyRef] = Array.from(targets.values());
      await deleteDoc(onlyRef);
    } else {
      const batch = writeBatch(db);
      for (const ref of targets.values()) {
        batch.delete(ref);
      }
      await batch.commit();
    }
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${RADIO_COLLECTION}/${trimmedId}`, currentUser);
  }
}
