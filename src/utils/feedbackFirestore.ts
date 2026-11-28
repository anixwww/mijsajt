import {
  getCachedAuthUser,
  getFirebaseAuth,
  getFirebaseDb,
  handleFirestoreError,
  OperationType,
} from '../firebase.ts';
import type { FeedbackRecord } from '../types.ts';

const SITE_FEEDBACK_COLLECTION = 'siteFeedback';
const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function parseTimestampIso(raw: unknown): string {
  if (raw && typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (raw as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  if (typeof raw === 'string' && raw.trim()) return raw;
  return new Date().toISOString();
}

function mapDocToFeedbackRecord(
  docId: string,
  data: Record<string, unknown>
): FeedbackRecord | null {
  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : docId;
  const message = typeof data.message === 'string' ? data.message.trim() : '';
  if (!id || !message) return null;

  const displayName =
    typeof data.displayName === 'string' && data.displayName.trim()
      ? data.displayName.trim().slice(0, 80)
      : 'Гість';

  const adminReply =
    typeof data.adminReply === 'string' && data.adminReply.trim()
      ? data.adminReply.trim().slice(0, 2000)
      : undefined;

  return {
    id,
    ...(typeof data.guestUid === 'string' && data.guestUid.trim()
      ? { guestUid: data.guestUid.trim() }
      : {}),
    ...(typeof data.authorUid === 'string' && data.authorUid.trim()
      ? { firebaseUid: data.authorUid.trim() }
      : {}),
    displayName,
    ...(typeof data.authorPhotoUrl === 'string' && data.authorPhotoUrl.trim()
      ? { authorPhotoUrl: data.authorPhotoUrl.trim().slice(0, 500) }
      : {}),
    ...(typeof data.contact === 'string' && data.contact.trim()
      ? { contact: data.contact.trim().slice(0, 100) }
      : {}),
    message: message.slice(0, 2000),
    createdAt: parseTimestampIso(data.createdAt),
    updatedAt: parseTimestampIso(data.updatedAt ?? data.createdAt),
    readByAdmin: Boolean(data.readByAdmin),
    ...(adminReply
      ? {
          adminReply,
          ...(typeof data.adminReplyAt === 'string' && data.adminReplyAt.trim()
            ? { adminReplyAt: data.adminReplyAt.trim().slice(0, 64) }
            : {}),
          ...(typeof data.adminReplyAuthorName === 'string' && data.adminReplyAuthorName.trim()
            ? { adminReplyAuthorName: data.adminReplyAuthorName.trim().slice(0, 80) }
            : {}),
        }
      : {}),
    readByUser: typeof data.readByUser === 'boolean' ? data.readByUser : true,
  };
}

export function mergeSiteFeedbackLists(
  primary: FeedbackRecord[],
  secondary: FeedbackRecord[]
): FeedbackRecord[] {
  const byId = new Map<string, FeedbackRecord>();
  const freshness = (item: FeedbackRecord) => {
    const times = [item.updatedAt, item.adminReplyAt, item.createdAt]
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
      .map((t) => Date.parse(t))
      .filter((ms) => Number.isFinite(ms));
    return times.length > 0 ? Math.max(...times) : 0;
  };

  for (const item of secondary) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const item of primary) {
    if (!item?.id) continue;
    const prev = byId.get(item.id);
    if (!prev || freshness(item) >= freshness(prev)) {
      byId.set(item.id, { ...prev, ...item });
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
  );
}

export async function subscribeUserSiteFeedback(options: {
  firebaseUid: string;
  onItems: (items: FeedbackRecord[]) => void;
  onError?: (error: unknown) => void;
}): Promise<() => void> {
  const cleanUid = options.firebaseUid.trim();
  if (!VALID_ID_RE.test(cleanUid)) {
    return () => {};
  }

  let currentUser = getCachedAuthUser();
  if (!currentUser) {
    const auth = await getFirebaseAuth().catch(() => null);
    if (auth) {
      await auth.authStateReady().catch(() => {});
      currentUser = auth.currentUser;
    }
  }
  if (!currentUser || !currentUser.emailVerified || currentUser.uid !== cleanUid) {
    return () => {};
  }

  try {
    const [db, { collection, onSnapshot, query, where }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);

    const q = query(
      collection(db, SITE_FEEDBACK_COLLECTION),
      where('authorUid', '==', cleanUid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: FeedbackRecord[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
          const mapped = mapDocToFeedbackRecord(docSnap.id, data);
          if (mapped) items.push(mapped);
        });
        items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
        options.onItems(items);
      },
      (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.toLowerCase().includes('permission')) {
          try {
            handleFirestoreError(error, OperationType.LIST, SITE_FEEDBACK_COLLECTION, currentUser);
          } catch {
            // Structured error logged; HTTP polling remains active
          }
        }
        options.onError?.(error);
      }
    );

    return unsubscribe;
  } catch (err) {
    options.onError?.(err);
    return () => {};
  }
}

export async function subscribeAdminSiteFeedback(options: {
  limitCount?: number;
  onItems: (items: FeedbackRecord[]) => void;
  onError?: (error: unknown) => void;
}): Promise<() => void> {
  let currentUser = getCachedAuthUser();
  if (!currentUser) {
    const auth = await getFirebaseAuth().catch(() => null);
    if (auth) {
      await auth.authStateReady().catch(() => {});
      currentUser = auth.currentUser;
    }
  }
  if (!currentUser || !currentUser.emailVerified) {
    return () => {};
  }

  const limitCount = Math.max(20, Math.min(250, options.limitCount ?? 200));

  try {
    const [db, { collection, limit, onSnapshot, orderBy, query }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);

    const q = query(
      collection(db, SITE_FEEDBACK_COLLECTION),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: FeedbackRecord[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
          const mapped = mapDocToFeedbackRecord(docSnap.id, data);
          if (mapped) items.push(mapped);
        });
        options.onItems(items);
      },
      (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.toLowerCase().includes('permission')) {
          try {
            handleFirestoreError(error, OperationType.LIST, SITE_FEEDBACK_COLLECTION, currentUser);
          } catch {
            // Structured error logged; API remains active
          }
        }
        options.onError?.(error);
      }
    );

    return unsubscribe;
  } catch (err) {
    options.onError?.(err);
    return () => {};
  }
}

export async function markSiteFeedbackReadByUserInFirestore(feedbackId: string): Promise<boolean> {
  const cleanId = feedbackId.trim();
  if (!VALID_ID_RE.test(cleanId)) return false;

  let currentUser = getCachedAuthUser();
  if (!currentUser) {
    const auth = await getFirebaseAuth().catch(() => null);
    if (auth) {
      await auth.authStateReady().catch(() => {});
      currentUser = auth.currentUser;
    }
  }
  if (!currentUser || !currentUser.emailVerified) return false;

  try {
    const [db, { doc, serverTimestamp, updateDoc }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);
    await updateDoc(doc(db, SITE_FEEDBACK_COLLECTION, cleanId), {
      readByUser: true,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('permission')) {
      try {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `${SITE_FEEDBACK_COLLECTION}/${cleanId}`,
          currentUser
        );
      } catch {
        return false;
      }
    }
    return false;
  }
}
