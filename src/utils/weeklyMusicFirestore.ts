import {
  getFirebaseAuth,
  getFirebaseDb,
  handleFirestoreError,
  OperationType,
} from '../firebase.ts';
import type { WeeklyMusicSelection, WeeklyMusicTrack } from '../types.ts';

const WEEKLY_MUSIC_COLLECTION = 'weeklyMusicSelections';

function parseTrack(raw: unknown): WeeklyMusicTrack | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const artist = typeof r.artist === 'string' ? r.artist.trim() : 'SoundCloud';
  const soundcloudUrl = typeof r.soundcloudUrl === 'string' ? r.soundcloudUrl.trim() : '';
  const embedTargetUrl =
    typeof r.embedTargetUrl === 'string' && r.embedTargetUrl.trim()
      ? r.embedTargetUrl.trim()
      : soundcloudUrl;
  const artworkUrl =
    typeof r.artworkUrl === 'string' && r.artworkUrl.trim() ? r.artworkUrl.trim() : undefined;

  if (!id || !title || !/^https?:\/\/.+/.test(soundcloudUrl)) return null;
  return {
    id,
    title,
    artist: artist || 'SoundCloud',
    soundcloudUrl,
    embedTargetUrl,
    ...(artworkUrl ? { artworkUrl } : {}),
  };
}

function toIsoTimestamp(val: unknown, fallback: string): string {
  if (typeof val === 'string' && val.trim()) return val;
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (val as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function mapDocToWeeklyMusicSelection(
  docId: string,
  data: Record<string, unknown>
): WeeklyMusicSelection | null {
  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : docId;
  const weekKey = typeof data.weekKey === 'string' ? data.weekKey.trim() : '';
  const periodStart = typeof data.periodStart === 'string' ? data.periodStart.trim() : '';
  const periodEnd = typeof data.periodEnd === 'string' ? data.periodEnd.trim() : '';
  const periodLabel = typeof data.periodLabel === 'string' ? data.periodLabel.trim() : '';
  if (
    !id ||
    !/^\d{4}-W\d{2}$/.test(weekKey) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ||
    !periodLabel
  ) {
    return null;
  }

  const rawText = typeof data.text === 'string' ? data.text.trim().slice(0, 5000) : '';
  const photos = Array.isArray(data.photos)
    ? data.photos
        .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        .map((u) => u.trim().slice(0, 1000))
        .slice(0, 12)
    : [];
  const tracks = Array.isArray(data.tracks)
    ? data.tracks
        .map((t) => parseTrack(t))
        .filter((t): t is WeeklyMusicTrack => Boolean(t))
        .slice(0, 50)
    : [];

  const nowIso = new Date().toISOString();
  const createdAt = toIsoTimestamp(data.createdAt, nowIso);
  const updatedAt = toIsoTimestamp(data.updatedAt, createdAt);

  return {
    id,
    weekKey,
    periodStart,
    periodEnd,
    periodLabel,
    ...(rawText ? { text: rawText } : {}),
    photos,
    tracks,
    createdAt,
    updatedAt,
  };
}

export function sortWeeklyMusicSelections(
  items: WeeklyMusicSelection[]
): WeeklyMusicSelection[] {
  return [...items].sort((a, b) =>
    b.periodStart !== a.periodStart
      ? b.periodStart.localeCompare(a.periodStart)
      : b.createdAt.localeCompare(a.createdAt)
  );
}

export async function subscribeWeeklyMusicSelections(
  onSelections: (selections: WeeklyMusicSelection[]) => void
): Promise<() => void> {
  try {
    const [db, { collection, onSnapshot }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);

    return onSnapshot(
      collection(db, WEEKLY_MUSIC_COLLECTION),
      (snapshot) => {
        const loaded: WeeklyMusicSelection[] = [];
        snapshot.forEach((docSnap) => {
          const mapped = mapDocToWeeklyMusicSelection(
            docSnap.id,
            docSnap.data() as Record<string, unknown>
          );
          if (mapped) loaded.push(mapped);
        });
        onSelections(sortWeeklyMusicSelections(loaded));
      },
      (_error) => {
        // Fall back gracefully to server-hydrated catalog if offline or temporarily unavailable
      }
    );
  } catch {
    return () => {};
  }
}

export async function saveWeeklyMusicSelectionToFirestore(
  selection: WeeklyMusicSelection
): Promise<void> {
  const auth = await getFirebaseAuth();
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const cleanId = selection.id.trim();
  if (!cleanId || !/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return;

  try {
    const [db, { deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);

    const ref = doc(db, WEEKLY_MUSIC_COLLECTION, cleanId);
    const snap = await getDoc(ref);
    const cleanText = typeof selection.text === 'string' ? selection.text.trim().slice(0, 5000) : '';
    const cleanPhotos = (selection.photos || [])
      .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      .map((u) => u.trim().slice(0, 1000))
      .slice(0, 12);
    const cleanTracks = (selection.tracks || []).slice(0, 50).map((t) => ({
      id: t.id,
      title: t.title.slice(0, 200),
      artist: (t.artist || 'SoundCloud').slice(0, 140),
      soundcloudUrl: t.soundcloudUrl.slice(0, 500),
      embedTargetUrl: (t.embedTargetUrl || t.soundcloudUrl).slice(0, 500),
      ...(t.artworkUrl ? { artworkUrl: t.artworkUrl.slice(0, 500) } : {}),
    }));

    if (snap.exists()) {
      await updateDoc(ref, {
        weekKey: selection.weekKey,
        periodStart: selection.periodStart,
        periodEnd: selection.periodEnd,
        periodLabel: selection.periodLabel.slice(0, 120),
        text: cleanText ? cleanText : deleteField(),
        photos: cleanPhotos,
        tracks: cleanTracks,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: cleanId,
        weekKey: selection.weekKey,
        periodStart: selection.periodStart,
        periodEnd: selection.periodEnd,
        periodLabel: selection.periodLabel.slice(0, 120),
        ...(cleanText ? { text: cleanText } : {}),
        photos: cleanPhotos,
        tracks: cleanTracks,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${WEEKLY_MUSIC_COLLECTION}/${cleanId}`, currentUser);
  }
}

export async function deleteWeeklyMusicSelectionFromFirestore(
  selectionId: string
): Promise<void> {
  const cleanId = selectionId.trim();
  if (!cleanId || !/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return;

  const auth = await getFirebaseAuth();
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  try {
    const [db, { deleteDoc, doc }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);
    await deleteDoc(doc(db, WEEKLY_MUSIC_COLLECTION, cleanId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${WEEKLY_MUSIC_COLLECTION}/${cleanId}`, currentUser);
  }
}
