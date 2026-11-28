import { create } from 'zustand';
import type {
  FeedbackRecord,
  GuestUser,
  RememberedGuestHint,
  TelegramSubscriptionState,
} from '../types.ts';

export const GUEST_HINT_STORAGE_KEY = 'dankiv_guest_hint_v1';
export const TELEGRAM_SUB_STORAGE_KEY = 'dankiv_tg_subscription_v1';

export function readRememberedGuestHint(): RememberedGuestHint | null {
  try {
    const raw = localStorage.getItem(GUEST_HINT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedGuestHint>;
    if (!parsed || typeof parsed.email !== 'string' || typeof parsed.displayName !== 'string') {
      return null;
    }
    return {
      uid: typeof parsed.uid === 'string' ? parsed.uid : '',
      displayName: parsed.displayName,
      email: parsed.email,
      photoUrl: typeof parsed.photoUrl === 'string' ? parsed.photoUrl : undefined,
      hasPin: Boolean(parsed.hasPin),
    };
  } catch {
    return null;
  }
}

export function writeRememberedGuestHint(user: GuestUser): RememberedGuestHint {
  const hint: RememberedGuestHint = {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoUrl: user.photoUrl,
    hasPin: Boolean(user.hasPin),
  };
  try {
    localStorage.setItem(GUEST_HINT_STORAGE_KEY, JSON.stringify(hint));
  } catch {
    // Ignore storage errors
  }
  return hint;
}

function readInitialTelegramSubscription(): TelegramSubscriptionState {
  try {
    const raw = localStorage.getItem(TELEGRAM_SUB_STORAGE_KEY);
    if (!raw) return { subscribed: false };
    const parsed = JSON.parse(raw) as TelegramSubscriptionState;
    if (parsed && typeof parsed.token === 'string' && parsed.token.startsWith('tgsub_v1.')) {
      return { ...parsed, subscribed: Boolean(parsed.subscribed) };
    }
  } catch {
    // Ignore storage errors
  }
  return { subscribed: false };
}

interface AuthState {
  guestUser: GuestUser | null;
  rememberedGuest: RememberedGuestHint | null;
  isAdmin: boolean;
  hasFirebaseSession: boolean;
  requiresGoogleForAdmin: boolean;
  telegramSubscription: TelegramSubscriptionState;
  hasUnreadReply: boolean;
  mySiteFeedback: FeedbackRecord[];
  guestSessionToken: string | null;
  setGuestUser: (user: GuestUser | null | ((prev: GuestUser | null) => GuestUser | null)) => void;
  setRememberedGuest: (hint: RememberedGuestHint | null) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  setHasFirebaseSession: (has: boolean) => void;
  setRequiresGoogleForAdmin: (req: boolean) => void;
  setTelegramSubscription: (
    next:
      | TelegramSubscriptionState
      | ((prev: TelegramSubscriptionState) => TelegramSubscriptionState)
  ) => void;
  setHasUnreadReply: (hasUnread: boolean) => void;
  setMySiteFeedback: (
    items: FeedbackRecord[] | ((prev: FeedbackRecord[]) => FeedbackRecord[])
  ) => void;
  markFeedbackRepliesRead: () => void;
  setGuestSessionToken: (token: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  guestUser: null,
  rememberedGuest: readRememberedGuestHint(),
  isAdmin: false,
  hasFirebaseSession: false,
  requiresGoogleForAdmin: false,
  telegramSubscription: readInitialTelegramSubscription(),
  hasUnreadReply: false,
  mySiteFeedback: [],
  guestSessionToken: null,

  setGuestUser: (user) =>
    set((state) => ({
      guestUser: typeof user === 'function' ? user(state.guestUser) : user,
    })),
  setRememberedGuest: (rememberedGuest) => set({ rememberedGuest }),
  setIsAdmin: (isAdmin) => set({ isAdmin }),
  setHasFirebaseSession: (hasFirebaseSession) => set({ hasFirebaseSession }),
  setRequiresGoogleForAdmin: (requiresGoogleForAdmin) => set({ requiresGoogleForAdmin }),
  setTelegramSubscription: (next) =>
    set((state) => ({
      telegramSubscription:
        typeof next === 'function' ? next(state.telegramSubscription) : next,
    })),
  setHasUnreadReply: (hasUnreadReply) => set({ hasUnreadReply }),
  setMySiteFeedback: (items) =>
    set((state) => ({
      mySiteFeedback: typeof items === 'function' ? items(state.mySiteFeedback) : items,
    })),
  markFeedbackRepliesRead: () =>
    set((state) => {
      const nowIso = new Date().toISOString();
      return {
        mySiteFeedback: state.mySiteFeedback.map((item) =>
          Boolean(item.adminReply?.trim()) && item.readByUser === false
            ? { ...item, readByUser: true, updatedAt: nowIso }
            : item
        ),
      };
    }),
  setGuestSessionToken: (guestSessionToken) => set({ guestSessionToken }),
}));
