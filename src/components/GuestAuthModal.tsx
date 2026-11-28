/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Heart,
  KeyRound,
  Pencil,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  User,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import { m } from 'motion/react';
import { memo, useCallback, useEffect, useRef, useState, useMemo, type FormEvent, type ReactElement } from 'react';
import { List, useDynamicRowHeight, type RowComponentProps } from 'react-window';
import {
  DEFAULT_GOOGLE_AUTH_BRIDGE_URL,
  FIREBASE_PROJECT_ID,
  getConfiguredAuthBridgeUrl,
  normalizeBridgeUrl,
  preloadGoogleAuthBundle,
  saveCustomAuthBridgeUrl,
  signInWithGoogleTokens,
  type GoogleAuthBundle,
} from '../firebase.ts';
import type {
  GuestUser,
  Poem,
  PoemSubmission,
  ProseStatus,
  ProseSubmission,
  RememberedGuestHint,
  UserTopBadges,
} from '../types.ts';
import { readLocalUserLikedPoemIds, writeLocalUserLikedPoemIds } from '../utils/offlineCache.ts';
import { preserveFormattedText } from '../utils/textFormatting.ts';
import { PinPad } from './PinPad.tsx';
import { UserRankBadges } from './UserRankBadges.tsx';

interface GuestAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  guestUser: GuestUser | null;
  rememberedGuest?: RememberedGuestHint | null;
  isAdmin: boolean;
  requiresGoogleForAdmin?: boolean;
  hasFirebaseSession?: boolean;
  getGuestToken: (forceRefresh?: boolean) => Promise<string | null>;
  onAuthenticated: (
    user: GuestUser,
    options?: { isAdmin?: boolean; sessionToken?: string; requiresGoogleForAdmin?: boolean }
  ) => void;
  onUserUpdated: (user: GuestUser) => void;
  onLogout: (mode?: 'lock' | 'forget') => Promise<void> | void;
  onForgetRemembered?: () => void;
  poems?: Poem[];
  onOpenPoem?: (poemId: string) => void;
  onOpenProse?: (proseId: string) => void;
  onCatalogUpdated?: () => void;
  onOpenAuthorStudio?: () => void;
}

type CabinetTab = 'profile' | 'works' | 'likes';

interface UserWorkEditDraft {
  kind: 'poem' | 'prose';
  id: string;
  title: string;
  subtitle: string;
  noteOrSlogan: string;
  excerpt: string;
  content: string;
  workStatus: ProseStatus;
}

const BRIDGE_SUCCESS_TYPE = 'dankiv-google-auth-bridge-success';
const BRIDGE_ERROR_TYPE = 'dankiv-google-auth-bridge-error';

function GoogleLogoIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

function maskEmailForHint(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 1) return trimmed;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

type UserWorkEntry =
  | { kind: 'poem'; sortTs: number; item: PoemSubmission }
  | { kind: 'prose'; sortTs: number; item: ProseSubmission };

const LikedPoemRow = memo(function LikedPoemRow({
  poem,
  onSelectPoem,
}: {
  poem: Poem;
  onSelectPoem: (poemId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelectPoem(poem.id)}
      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white dark:bg-night-card hover:bg-paper-warm dark:hover:bg-night-elevated text-left transition-colors cursor-pointer group"
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink dark:text-cream truncate">
          {poem.title}
        </p>
        <p className="text-[10px] text-ink-muted dark:text-parchment truncate">
          {poem.cycle}
        </p>
      </div>
      <ArrowUpRight className="w-3.5 h-3.5 text-ink-muted dark:text-parchment group-hover:text-ink dark:group-hover:text-cream shrink-0" />
    </button>
  );
});

interface VirtualLikedPoemRowData {
  poems: Poem[];
  onSelectPoem: (poemId: string) => void;
}

function VirtualLikedPoemRow({
  ariaAttributes,
  index,
  style,
  poems,
  onSelectPoem,
}: RowComponentProps<VirtualLikedPoemRowData>): ReactElement | null {
  const poem = poems[index];
  if (!poem) return null;
  return (
    <div {...ariaAttributes} style={style}>
      <div className="pb-1.5 pr-1">
        <LikedPoemRow poem={poem} onSelectPoem={onSelectPoem} />
      </div>
    </div>
  );
}

const UserWorkSummaryCard = memo(function UserWorkSummaryCard({
  entry,
  onStartEditPoem,
  onStartEditProse,
  onOpenPublished,
}: {
  entry: UserWorkEntry;
  onStartEditPoem: (sub: PoemSubmission) => void;
  onStartEditProse: (sub: ProseSubmission) => void;
  onOpenPublished: (kind: 'poem' | 'prose', publishedId: string) => void;
}) {
  const sub = entry.item;
  const isApproved = sub.status === 'approved';
  const isRejected = sub.status === 'rejected';
  const workStatusValue: ProseStatus = sub.workStatus || 'completed';
  const publishedId =
    entry.kind === 'poem'
      ? (sub as PoemSubmission).publishedPoemId
      : (sub as ProseSubmission).publishedProseId;

  return (
    <div className="p-3.5 rounded-xl bg-white dark:bg-night-card space-y-2.5 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="px-1.5 py-0.5 rounded bg-paper-warm dark:bg-night-elevated text-[10px] font-semibold text-ink-muted dark:text-parchment">
              {entry.kind === 'poem' ? 'Вірш' : 'Проза'}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                workStatusValue === 'completed'
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-night-elevated dark:text-silver'
                  : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
              }`}
            >
              {workStatusValue === 'completed' ? 'Закінчено' : 'У процесі'}
            </span>
          </div>
          <p className="text-sm font-semibold text-ink dark:text-cream">
            {sub.title}
          </p>
          <p className="text-[11px] text-ink-muted dark:text-parchment">
            {entry.kind === 'poem'
              ? (sub as PoemSubmission).cycle || 'Стрічка віршів'
              : (sub as ProseSubmission).genre || 'Оповідання'}
            {' · '}
            {new Date(sub.updatedAt || sub.createdAt).toLocaleDateString('uk-UA')}
          </p>
        </div>

        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold shrink-0 ${
            isApproved
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
              : isRejected
                ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
          }`}
        >
          {isApproved ? (
            <>
              <CheckCircle2 className="w-3 h-3" />
              <span>Опубліковано</span>
            </>
          ) : isRejected ? (
            <>
              <XCircle className="w-3 h-3" />
              <span>Відхилено</span>
            </>
          ) : (
            <>
              <Clock className="w-3 h-3" />
              <span>На розгляді</span>
            </>
          )}
        </span>
      </div>

      <p className="text-xs text-ink-muted dark:text-parchment whitespace-pre-wrap line-clamp-4 leading-relaxed">
        {sub.content}
      </p>

      {sub.moderationNote && (
        <div className="px-2.5 py-1.5 rounded-lg bg-paper dark:bg-night-panel text-[11px]">
          <span className="font-semibold">Коментар адміністратора: </span>
          <span className="text-ink-muted dark:text-parchment">{sub.moderationNote}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <button
          type="button"
          onClick={() =>
            entry.kind === 'poem'
              ? onStartEditPoem(sub as PoemSubmission)
              : onStartEditProse(sub as ProseSubmission)
          }
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-paper-warm dark:bg-night-elevated hover:bg-paper-sand dark:hover:bg-night-muted text-[11px] font-medium text-ink dark:text-cream cursor-pointer transition-colors"
        >
          <Pencil className="w-3 h-3" />
          <span>Редагувати / доповнити</span>
        </button>

        {isApproved && publishedId && (
          <button
            type="button"
            onClick={() => onOpenPublished(entry.kind, publishedId)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-pine dark:text-silver hover:underline cursor-pointer"
          >
            <span>Відкрити</span>
            <ArrowUpRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
});

interface VirtualUserWorkRowData {
  works: UserWorkEntry[];
  onStartEditPoem: (sub: PoemSubmission) => void;
  onStartEditProse: (sub: ProseSubmission) => void;
  onOpenPublished: (kind: 'poem' | 'prose', publishedId: string) => void;
}

function VirtualUserWorkRow({
  ariaAttributes,
  index,
  style,
  works,
  onStartEditPoem,
  onStartEditProse,
  onOpenPublished,
}: RowComponentProps<VirtualUserWorkRowData>): ReactElement | null {
  const entry = works[index];
  if (!entry) return null;
  return (
    <div {...ariaAttributes} style={style}>
      <div className="pb-2.5 pr-1">
        <UserWorkSummaryCard
          entry={entry}
          onStartEditPoem={onStartEditPoem}
          onStartEditProse={onStartEditProse}
          onOpenPublished={onOpenPublished}
        />
      </div>
    </div>
  );
}

export const GuestAuthModal = memo(function GuestAuthModal({
  isOpen,
  onClose,
  guestUser,
  rememberedGuest = null,
  isAdmin,
  requiresGoogleForAdmin = false,
  hasFirebaseSession = false,
  getGuestToken,
  onUserUpdated,
  onLogout,
  onForgetRemembered,
  onAuthenticated,
  poems = [],
  onOpenPoem,
  onOpenProse,
  onCatalogUpdated,
  onOpenAuthorStudio,
}: GuestAuthModalProps) {
  const [cabinetTab, setCabinetTab] = useState<CabinetTab>('profile');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [donorChatTextInput, setDonorChatTextInput] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null);

  const [loadingAction, setLoadingAction] = useState<null | 'google' | 'pin'>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsStandaloneTab, setNeedsStandaloneTab] = useState(false);
  const [canTryGoogleRedirect, setCanTryGoogleRedirect] = useState(false);
  const [unauthorizedDomainHost, setUnauthorizedDomainHost] = useState<string | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [bridgeSetupOpen, setBridgeSetupOpen] = useState(false);
  const [bridgeUrlInput, setBridgeUrlInput] = useState('');
  const [liveBadges, setLiveBadges] = useState<UserTopBadges | undefined>(guestUser?.badges);

  // Monobank-style 4-digit PIN states (login + profile setup)
  const [forceGoogleView, setForceGoogleView] = useState(false);
  const [loginPin, setLoginPin] = useState('');
  const [loginPinErrorTick, setLoginPinErrorTick] = useState(0);
  const [pinLockedUntilMs, setPinLockedUntilMs] = useState<number | null>(null);

  const [pinSetupStep, setPinSetupStep] = useState<null | 'current' | 'new' | 'confirm'>(null);
  const [pinSetupCurrentValue, setPinSetupCurrentValue] = useState('');
  const [pinSetupFirstValue, setPinSetupFirstValue] = useState('');
  const [pinSetupInput, setPinSetupInput] = useState('');
  const [pinSetupErrorTick, setPinSetupErrorTick] = useState(0);
  const [pinSetupSaving, setPinSetupSaving] = useState(false);

  const [myPoemSubmissions, setMyPoemSubmissions] = useState<PoemSubmission[]>([]);
  const [myProseSubmissions, setMyProseSubmissions] = useState<ProseSubmission[]>([]);
  const [loadingMyWorks, setLoadingMyWorks] = useState(false);
  const [worksFeedback, setWorksFeedback] = useState<{ text: string; isError?: boolean } | null>(null);
  const [editingWorkKey, setEditingWorkKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<UserWorkEditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const googleBundleRef = useRef<GoogleAuthBundle | null>(null);
  const bridgeCleanupRef = useRef<(() => void) | null>(null);
  const pinSubmitTimerRef = useRef<number | null>(null);

  const fetchValidToken = useCallback(async (): Promise<string | null> => {
    let token = await getGuestToken();
    if (token?.startsWith('guest_v1.')) {
      const refreshed = await getGuestToken(true);
      if (refreshed) token = refreshed;
    }
    return token;
  }, [getGuestToken]);

  const loadMyWorks = useCallback(async () => {
    if (!guestUser) return;
    setLoadingMyWorks(true);
    try {
      let token = await fetchValidToken();
      if (!token) return;

      const fetchBoth = async (authToken: string) =>
        Promise.all([
          fetch('/api/poems/my-submissions', {
            headers: { Authorization: `Bearer ${authToken}` },
          }),
          fetch('/api/prose/my-submissions', {
            headers: { Authorization: `Bearer ${authToken}` },
          }),
        ]);

      let [poemsRes, proseRes] = await fetchBoth(token);
      if (poemsRes.status === 401 || proseRes.status === 401) {
        const refreshed = await getGuestToken(true);
        if (refreshed && refreshed !== token) {
          token = refreshed;
          [poemsRes, proseRes] = await fetchBoth(token);
        }
      }

      if (poemsRes.ok) {
        const data = (await poemsRes.json()) as { submissions?: PoemSubmission[] };
        if (Array.isArray(data.submissions)) {
          setMyPoemSubmissions(data.submissions);
        }
      }
      if (proseRes.ok) {
        const data = (await proseRes.json()) as { submissions?: ProseSubmission[] };
        if (Array.isArray(data.submissions)) {
          setMyProseSubmissions(data.submissions);
        }
      }
    } catch {
      // Ignore transient load error
    } finally {
      setLoadingMyWorks(false);
    }
  }, [guestUser, fetchValidToken, getGuestToken]);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setProfileSuccessMsg(null);
    setCabinetTab('profile');
    setNeedsStandaloneTab(false);
    setCanTryGoogleRedirect(false);
    setUnauthorizedDomainHost(null);
    setCopiedDomain(false);
    setBridgeSetupOpen(false);
    setBridgeUrlInput(getConfiguredAuthBridgeUrl() || DEFAULT_GOOGLE_AUTH_BRIDGE_URL);
    setForceGoogleView(false);
    setLoginPin('');
    setPinLockedUntilMs(null);
    setPinSetupStep(null);
    setPinSetupCurrentValue('');
    setPinSetupFirstValue('');
    setPinSetupInput('');
    setWorksFeedback(null);
    setEditingWorkKey(null);
    setEditDraft(null);
    setEditingDisplayName(false);

    let active = true;
    if (guestUser) {
      setDisplayNameInput(guestUser.displayName || '');
      setDonorChatTextInput(guestUser.donorChatText || '');
      setLiveBadges(guestUser.badges);
      void loadMyWorks();
      void getGuestToken()
        .then(async (token) => {
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const res = await fetch('/api/leaderboard', { headers });
          if (!res.ok || !active) return;
          const json = (await res.json()) as { currentUserBadges?: UserTopBadges };
          if (!active) return;
          setLiveBadges(json.currentUserBadges);
        })
        .catch(() => {});
    } else {
      setLiveBadges(undefined);
      setMyPoemSubmissions([]);
      setMyProseSubmissions([]);
    }

    void preloadGoogleAuthBundle()
      .then((bundle) => {
        if (active) {
          googleBundleRef.current = bundle;
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      bridgeCleanupRef.current?.();
      bridgeCleanupRef.current = null;
      if (pinSubmitTimerRef.current !== null) {
        window.clearTimeout(pinSubmitTimerRef.current);
        pinSubmitTimerRef.current = null;
      }
    };
  }, [isOpen, guestUser, getGuestToken, loadMyWorks]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const myWorksList = useMemo<UserWorkEntry[]>(() => {
    const combined: UserWorkEntry[] = [
      ...myPoemSubmissions.map((item) => ({
        kind: 'poem' as const,
        sortTs: Date.parse(item.updatedAt || item.createdAt) || 0,
        item,
      })),
      ...myProseSubmissions.map((item) => ({
        kind: 'prose' as const,
        sortTs: Date.parse(item.updatedAt || item.createdAt) || 0,
        item,
      })),
    ];
    combined.sort((a, b) => b.sortTs - a.sortTs);
    return combined;
  }, [myPoemSubmissions, myProseSubmissions]);

  const likedPoems = useMemo(() => {
    if (!guestUser) return [];
    if (Array.isArray(guestUser.likedPoemIds)) {
      const likedSet = new Set(guestUser.likedPoemIds);
      return poems.filter((poem: Poem) => likedSet.has(poem.id));
    }
    return poems.filter((poem: Poem) => Boolean(poem.isLiked));
  }, [poems, guestUser]);

  const worksRowHeight = useDynamicRowHeight({
    defaultRowHeight: 168,
    key: `${isOpen ? 'open' : 'closed'}-${cabinetTab}-${myWorksList.length}`,
  });

  const handleStartEditPoem = useCallback((sub: PoemSubmission) => {
    setWorksFeedback(null);
    setEditingWorkKey(`poem:${sub.id}`);
    setEditDraft({
      kind: 'poem',
      id: sub.id,
      title: sub.title,
      subtitle: sub.cycle || '',
      noteOrSlogan: sub.note || '',
      excerpt: '',
      content: sub.content,
      workStatus: sub.workStatus || 'completed',
    });
  }, []);

  const handleStartEditProse = useCallback((sub: ProseSubmission) => {
    setWorksFeedback(null);
    setEditingWorkKey(`prose:${sub.id}`);
    setEditDraft({
      kind: 'prose',
      id: sub.id,
      title: sub.title,
      subtitle: sub.genre || 'Оповідання',
      noteOrSlogan: sub.slogan || '',
      excerpt: sub.excerpt || '',
      content: sub.content,
      workStatus: sub.workStatus || 'completed',
    });
  }, []);

  const handleSelectLikedPoem = useCallback(
    (poemId: string) => {
      onOpenPoem?.(poemId);
      onClose();
    },
    [onOpenPoem, onClose]
  );

  const handleOpenPublishedWork = useCallback(
    (kind: 'poem' | 'prose', publishedId: string) => {
      if (kind === 'poem') {
        onOpenPoem?.(publishedId);
      } else {
        onOpenProse?.(publishedId);
      }
      onClose();
    },
    [onOpenPoem, onOpenProse, onClose]
  );

  const likedPoemRowProps = useMemo<VirtualLikedPoemRowData>(
    () => ({ poems: likedPoems, onSelectPoem: handleSelectLikedPoem }),
    [likedPoems, handleSelectLikedPoem]
  );

  const userWorkRowProps = useMemo<VirtualUserWorkRowData>(
    () => ({
      works: myWorksList,
      onStartEditPoem: handleStartEditPoem,
      onStartEditProse: handleStartEditProse,
      onOpenPublished: handleOpenPublishedWork,
    }),
    [myWorksList, handleStartEditPoem, handleStartEditProse, handleOpenPublishedWork]
  );

  if (!isOpen) return null;

  const standaloneAuthUrl = (() => {
    if (typeof window === 'undefined') return '/?auth=1';
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('auth', '1');
      return url.toString();
    } catch {
      return '/?auth=1';
    }
  })();

  const firebaseAuthorizedDomainsUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/settings`;

  const completeFirebaseSession = async (fbToken: string, userEmail?: string | null) => {
    const fallbackLikedPoemIds = readLocalUserLikedPoemIds(userEmail);
    const sessionRes = await fetch('/api/guest/google-session', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Authorization: `Bearer ${fbToken}`,
      },
      body: JSON.stringify(
        fallbackLikedPoemIds.length > 0 ? { fallbackLikedPoemIds } : {}
      ),
    });
    const sessionData = (await sessionRes.json().catch(() => ({}))) as {
      user?: GuestUser;
      isAdmin?: boolean;
      error?: string;
    };

    if (!sessionRes.ok || !sessionData.user) {
      setErrorMsg(
        sessionData.error ||
          `Не вдалося підтвердити Google-акаунт на сервері (код ${sessionRes.status}).`
      );
      return;
    }

    const syncedUser = sessionData.user;
    writeLocalUserLikedPoemIds(syncedUser.email, syncedUser.likedPoemIds ?? []);
    onAuthenticated(syncedUser, {
      isAdmin: Boolean(sessionData.isAdmin),
      sessionToken: syncedUser.sessionToken,
      requiresGoogleForAdmin: false,
    });
    onClose();
  };

  const handlePinLoginSubmit = (completedPin: string) => {
    if (!rememberedGuest || loadingAction !== null) return;
    if (pinLockedUntilMs && Date.now() < pinLockedUntilMs) return;

    if (pinSubmitTimerRef.current !== null) {
      window.clearTimeout(pinSubmitTimerRef.current);
    }

    pinSubmitTimerRef.current = window.setTimeout(async () => {
      pinSubmitTimerRef.current = null;
      setLoadingAction('pin');
      setErrorMsg(null);
      try {
        const res = await fetch('/api/guest/pin-login', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            uid: rememberedGuest.uid,
            email: rememberedGuest.email,
            pin: completedPin,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          user?: GuestUser;
          sessionToken?: string;
          isAdmin?: boolean;
          requiresGoogleForAdmin?: boolean;
          lockedUntil?: string;
          error?: string;
        };

        if (!res.ok || !data.user) {
          setLoginPin('');
          setLoginPinErrorTick((t) => t + 1);
          if (data.lockedUntil) {
            const parsedLock = Date.parse(data.lockedUntil);
            if (Number.isFinite(parsedLock)) {
              setPinLockedUntilMs(parsedLock);
            }
          }
          setErrorMsg(data.error || 'Не вдалося увійти за ПІН-кодом.');
          return;
        }

        const syncedUser = data.user;
        writeLocalUserLikedPoemIds(syncedUser.email, syncedUser.likedPoemIds ?? []);
        onAuthenticated(syncedUser, {
          isAdmin: Boolean(data.isAdmin),
          sessionToken: data.sessionToken || syncedUser.sessionToken,
          requiresGoogleForAdmin: Boolean(data.requiresGoogleForAdmin),
        });
        onClose();
      } catch {
        setLoginPin('');
        setLoginPinErrorTick((t) => t + 1);
        setErrorMsg('Помилка з’єднання із сервером. Спробуйте ще раз.');
      } finally {
        setLoadingAction(null);
      }
    }, 110);
  };

  const startPinSetup = () => {
    setErrorMsg(null);
    setProfileSuccessMsg(null);
    setPinSetupInput('');
    setPinSetupCurrentValue('');
    setPinSetupFirstValue('');
    if (guestUser?.hasPin && !hasFirebaseSession) {
      setPinSetupStep('current');
    } else {
      setPinSetupStep('new');
    }
  };

  const handlePinSetupDigitComplete = (digits: string) => {
    if (pinSetupSaving) return;
    if (pinSubmitTimerRef.current !== null) {
      window.clearTimeout(pinSubmitTimerRef.current);
    }

    pinSubmitTimerRef.current = window.setTimeout(async () => {
      pinSubmitTimerRef.current = null;
      if (pinSetupStep === 'current') {
        setPinSetupCurrentValue(digits);
        setPinSetupInput('');
        setPinSetupStep('new');
        setErrorMsg(null);
        return;
      }
      if (pinSetupStep === 'new') {
        setPinSetupFirstValue(digits);
        setPinSetupInput('');
        setPinSetupStep('confirm');
        setErrorMsg(null);
        return;
      }
      if (pinSetupStep === 'confirm') {
        if (digits !== pinSetupFirstValue) {
          setPinSetupInput('');
          setPinSetupErrorTick((t) => t + 1);
          setErrorMsg('ПІН-коди не збігаються. Повторіть ще раз.');
          return;
        }
        setPinSetupSaving(true);
        setErrorMsg(null);
        try {
          const token = await getGuestToken();
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          };
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch('/api/guest/pin/set', {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({
              pin: digits,
              ...(pinSetupCurrentValue ? { currentPin: pinSetupCurrentValue } : {}),
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            user?: GuestUser;
            error?: string;
          };
          if (!res.ok || !data.user) {
            setPinSetupInput('');
            setPinSetupErrorTick((t) => t + 1);
            if (res.status === 401 && guestUser?.hasPin) {
              setPinSetupCurrentValue('');
              setPinSetupFirstValue('');
              setPinSetupStep('current');
            }
            setErrorMsg(data.error || 'Не вдалося зберегти ПІН-код.');
            return;
          }
          onUserUpdated(data.user);
          setPinSetupStep(null);
          setPinSetupInput('');
          setPinSetupCurrentValue('');
          setPinSetupFirstValue('');
          setProfileSuccessMsg('4-значний ПІН-код увімкнено');
        } catch {
          setPinSetupInput('');
          setPinSetupErrorTick((t) => t + 1);
          setErrorMsg('Помилка з’єднання із сервером.');
        } finally {
          setPinSetupSaving(false);
        }
      }
    }, 110);
  };

  const handleDisablePin = async () => {
    setPinSetupSaving(true);
    setErrorMsg(null);
    setProfileSuccessMsg(null);
    try {
      const token = await getGuestToken();
      const headers: Record<string, string> = {
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/guest/pin', {
        method: 'DELETE',
        credentials: 'include',
        headers,
      });
      const data = (await res.json().catch(() => ({}))) as {
        user?: GuestUser;
        error?: string;
      };
      if (!res.ok || !data.user) {
        setErrorMsg(data.error || 'Не вдалося вимкнути ПІН-код.');
        return;
      }
      onUserUpdated(data.user);
      setPinSetupStep(null);
      setProfileSuccessMsg('Швидкий ПІН-код вимкнено');
    } catch {
      setErrorMsg('Помилка з’єднання із сервером.');
    } finally {
      setPinSetupSaving(false);
    }
  };

  const openGoogleAuthBridge = (bridgeUrlRaw: string) => {
    const normalizedBridgeUrl = normalizeBridgeUrl(bridgeUrlRaw);
    if (!normalizedBridgeUrl) {
      setErrorMsg('Вкажіть коректний HTTPS-адрес Auth Bridge сторінки.');
      return;
    }

    const bridgeTarget = new URL(normalizedBridgeUrl);
    bridgeTarget.searchParams.set('origin', window.location.origin);
    const expectedOrigin = bridgeTarget.origin;

    bridgeCleanupRef.current?.();
    setLoadingAction('google');
    setErrorMsg(null);
    setNeedsStandaloneTab(false);
    setCanTryGoogleRedirect(false);

    const popup = window.open(
      bridgeTarget.toString(),
      'dankiv-google-auth-bridge',
      'width=480,height=640,menubar=no,toolbar=no,location=no,status=no'
    );

    if (!popup) {
      setLoadingAction(null);
      setErrorMsg('Браузер заблокував спливаюче вікно Auth Bridge. Дозвольте спливаючі вікна.');
      return;
    }

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedPoll);
      if (bridgeCleanupRef.current === cleanup) {
        bridgeCleanupRef.current = null;
      }
    };

    const closedPoll = window.setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        cleanup();
        setLoadingAction(null);
      }
    }, 350);

    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== expectedOrigin || event.source !== popup) return;
      const data = event.data as
        | {
            type?: string;
            googleIdToken?: string | null;
            googleAccessToken?: string | null;
            code?: string;
            message?: string;
          }
        | undefined;
      if (!data?.type) return;

      if (data.type === BRIDGE_SUCCESS_TYPE) {
        settled = true;
        cleanup();
        try {
          popup.close();
        } catch {
          // Ignore popup close error
        }
        try {
          const userCred = await signInWithGoogleTokens(
            data.googleIdToken ?? null,
            data.googleAccessToken ?? null
          );
          const fbToken = await userCred.user.getIdToken();
          await completeFirebaseSession(fbToken, userCred.user.email);
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code || '';
          setErrorMsg(
            code
              ? `Не вдалося завершити вхід через Auth Bridge (${code}).`
              : 'Не вдалося завершити вхід через Auth Bridge.'
          );
        } finally {
          setLoadingAction(null);
        }
      } else if (data.type === BRIDGE_ERROR_TYPE) {
        if (data.code === 'auth/popup-closed-by-user') {
          setErrorMsg('Вікно входу через Google було закрито до завершення авторизації.');
        } else if (data.code !== 'auth/popup-blocked') {
          settled = true;
          cleanup();
          setLoadingAction(null);
          setErrorMsg(data.message || 'Помилка входу через Auth Bridge.');
        }
      }
    };

    bridgeCleanupRef.current = cleanup;
    window.addEventListener('message', onMessage);
  };

  const saveProfileData = async (overrides?: { displayName?: string; donorChatText?: string }) => {
    if (!guestUser || profileSaving) return;
    const nextDisplayName = (overrides?.displayName ?? displayNameInput).trim();
    if (!nextDisplayName) {
      setErrorMsg('Вкажіть ім’я або псевдонім.');
      return;
    }
    setProfileSaving(true);
    setErrorMsg(null);
    setProfileSuccessMsg(null);
    try {
      let token = await getGuestToken();
      if (token?.startsWith('guest_v1.')) {
        const refreshed = await getGuestToken(true);
        if (refreshed) token = refreshed;
      }
      if (!token) {
        setErrorMsg('Сесія авторизації закінчилась. Увійдіть повторно.');
        return;
      }
      const res = await fetch('/api/guest/profile', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          displayName: nextDisplayName,
          ...(liveBadges?.donorRank && liveBadges.donorRank <= 3
            ? { donorChatText: (overrides?.donorChatText ?? donorChatTextInput).trim() }
            : {}),
        }),
      });
      const data = (await res.json()) as { user?: GuestUser; error?: string };
      if (!res.ok || !data.user) {
        setErrorMsg(data.error || 'Не вдалося оновити профіль.');
        return;
      }
      onUserUpdated(data.user);
      setEditingDisplayName(false);
      setProfileSuccessMsg('Профіль оновлено');
    } catch {
      setErrorMsg('Помилка з’єднання із сервером.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    await saveProfileData();
  };

  const handleGoogleLogin = async () => {
    const configuredBridge = getConfiguredAuthBridgeUrl();
    if (configuredBridge && typeof window !== 'undefined') {
      try {
        const bridgeOrigin = new URL(configuredBridge).origin;
        if (bridgeOrigin !== window.location.origin) {
          openGoogleAuthBridge(configuredBridge);
          return;
        }
      } catch {
        // Fall through to standard Firebase popup
      }
    }

    const preloaded = googleBundleRef.current;
    const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

    setLoadingAction('google');
    setErrorMsg(null);
    setNeedsStandaloneTab(false);
    setCanTryGoogleRedirect(false);
    setUnauthorizedDomainHost(null);

    try {
      let result;
      if (preloaded) {
        result = await preloaded.signInWithPopup(
          preloaded.auth,
          preloaded.googleProvider,
          preloaded.browserPopupRedirectResolver
        );
      } else {
        const bundle = await preloadGoogleAuthBundle();
        googleBundleRef.current = bundle;
        result = await bundle.signInWithPopup(
          bundle.auth,
          bundle.googleProvider,
          bundle.browserPopupRedirectResolver
        );
      }

      const fbUser = result.user;
      const fbToken = await fbUser.getIdToken();
      await completeFirebaseSession(fbToken, fbUser.email);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setErrorMsg(
          isInIframe
            ? 'Вікно входу через Google закрилося у вбудованому режимі. Спробуйте ще раз або відкрийте сайт у новій вкладці.'
            : 'Вікно входу через Google було закрито до завершення авторизації.'
        );
        if (isInIframe) setNeedsStandaloneTab(true);
      } else if (code === 'auth/cancelled-popup-request') {
        setErrorMsg('Попередній запит на вхід через Google було скасовано. Натисніть кнопку ще раз.');
      } else if (code === 'auth/popup-blocked') {
        setErrorMsg(
          isInIframe
            ? 'Браузер заблокував спливаюче вікно Google у вбудованому вікні. Відкрийте сторінку входу у новій вкладці.'
            : 'Браузер заблокував спливаюче вікно Google. Дозвольте спливаючі вікна або скористайтеся входом через перенаправлення.'
        );
        if (isInIframe) {
          setNeedsStandaloneTab(true);
        } else {
          setCanTryGoogleRedirect(true);
        }
      } else if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setUnauthorizedDomainHost(host || null);
        setErrorMsg(
          `Вхід через Google заблокований для тимчасового домену ${host || 'сайту'}.`
        );
      } else if (code === 'auth/operation-not-allowed') {
        setErrorMsg('Вхід через Google тимчасово вимкнений у налаштуваннях Firebase Authentication.');
      } else if (
        code === 'auth/web-storage-unsupported' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        setErrorMsg(
          'Браузер обмежує доступ до сховища для спливаючого вікна Google. Відкрийте вхід у новій вкладці.'
        );
        if (isInIframe) {
          setNeedsStandaloneTab(true);
        } else {
          setCanTryGoogleRedirect(true);
        }
      } else if (code === 'auth/network-request-failed') {
        setErrorMsg('Помилка мережі під час підключення до Google. Перевірте інтернет і спробуйте ще раз.');
      } else {
        setErrorMsg(
          code
            ? `Не вдалося виконати вхід через Google (${code}). Спробуйте ще раз.`
            : 'Не вдалося виконати вхід через Google. Спробуйте ще раз.'
        );
        if (isInIframe) setNeedsStandaloneTab(true);
      }
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCopyUnauthorizedDomain = async () => {
    if (!unauthorizedDomainHost) return;
    try {
      await navigator.clipboard.writeText(unauthorizedDomainHost);
      setCopiedDomain(true);
      window.setTimeout(() => setCopiedDomain(false), 2500);
    } catch {
      // Fallback: ignore if clipboard API restricted
    }
  };

  const handleSaveAndUseBridge = (e: FormEvent) => {
    e.preventDefault();
    const saved = saveCustomAuthBridgeUrl(bridgeUrlInput);
    if (!saved) {
      setErrorMsg('Вкажіть коректний HTTPS-адрес вашого постійного сайту + /google-auth-bridge.html');
      return;
    }
    openGoogleAuthBridge(saved);
  };

  const handleGoogleRedirectLogin = async () => {
    const preloaded = googleBundleRef.current;
    setLoadingAction('google');
    setErrorMsg(null);
    try {
      const bundle = preloaded ?? (await preloadGoogleAuthBundle());
      googleBundleRef.current = bundle;
      await bundle.signInWithRedirect(
        bundle.auth,
        bundle.googleProvider,
        bundle.browserPopupRedirectResolver
      );
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code || '';
      setErrorMsg(
        code
          ? `Не вдалося перейти на сторінку входу Google (${code}).`
          : 'Не вдалося перейти на сторінку входу Google.'
      );
      setLoadingAction(null);
    }
  };



  const handleSaveWorkEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!guestUser || !editDraft || savingEdit) return;
    const cleanTitle = editDraft.title.trim();
    const cleanContent = preserveFormattedText(editDraft.content);
    if (!cleanTitle) {
      setWorksFeedback({ text: 'Вкажіть назву твору.', isError: true });
      return;
    }
    if (!cleanContent.trim()) {
      setWorksFeedback({ text: 'Текст твору не може бути порожнім.', isError: true });
      return;
    }

    setSavingEdit(true);
    setWorksFeedback(null);
    try {
      let token = await fetchValidToken();
      if (!token) {
        setWorksFeedback({ text: 'Потрібна повторна авторизація.', isError: true });
        return;
      }

      const url =
        editDraft.kind === 'poem'
          ? `/api/poems/submissions/${encodeURIComponent(editDraft.id)}`
          : `/api/prose/submissions/${encodeURIComponent(editDraft.id)}`;
      const bodyPayload =
        editDraft.kind === 'poem'
          ? {
              title: cleanTitle,
              cycle: editDraft.subtitle.trim(),
              note: editDraft.noteOrSlogan.trim() || null,
              content: cleanContent,
              workStatus: editDraft.workStatus,
            }
          : {
              title: cleanTitle,
              genre: editDraft.subtitle.trim() || 'Оповідання',
              slogan: editDraft.noteOrSlogan.trim() || null,
              excerpt: editDraft.excerpt.trim() || null,
              content: cleanContent,
              workStatus: editDraft.workStatus,
            };

      let res = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(bodyPayload),
      });

      if (res.status === 401) {
        const refreshed = await getGuestToken(true);
        if (refreshed && refreshed !== token) {
          token = refreshed;
          res = await fetch(url, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(bodyPayload),
          });
        }
      }

      const data = (await res.json()) as {
        error?: string;
        submission?: PoemSubmission | ProseSubmission;
        unpublishedLive?: boolean;
      };
      if (!res.ok || !data.submission) {
        setWorksFeedback({
          text: data.error || 'Не вдалося зберегти оновлений твір.',
          isError: true,
        });
        return;
      }

      if (editDraft.kind === 'poem') {
        const updated = data.submission as PoemSubmission;
        setMyPoemSubmissions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const updated = data.submission as ProseSubmission;
        setMyProseSubmissions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }

      setEditingWorkKey(null);
      setEditDraft(null);
      setWorksFeedback({
        text: data.unpublishedLive
          ? 'Зміни збережено! Твір надіслано на повторну перевірку адміністратором (до підтвердження він тимчасово прихований зі стрічки).'
          : 'Зміни збережено та надіслано на перевірку адміністратором.',
      });
      onCatalogUpdated?.();
    } catch {
      setWorksFeedback({ text: 'Помилка з’єднання із сервером.', isError: true });
    } finally {
      setSavingEdit(false);
    }
  };

  const showRememberedPinLogin =
    !guestUser && Boolean(rememberedGuest && rememberedGuest.hasPin && !forceGoogleView);
  const showRememberedGoogleResume =
    !guestUser && Boolean(rememberedGuest && !rememberedGuest.hasPin && !forceGoogleView);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-auth-title"
    >
      <m.div
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className={`bg-paper dark:bg-night-panel rounded-2xl w-full p-6 shadow-2xl text-ink dark:text-cream max-h-[92vh] overflow-y-auto transition-[max-width] duration-200 ${
          guestUser && cabinetTab === 'works' ? 'max-w-xl' : 'max-w-sm'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4">
          <div className="space-y-0.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted dark:text-parchment">
              {guestUser
                ? 'Кабінет читача'
                : showRememberedPinLogin
                  ? 'Швидкий вхід'
                  : 'Авторизація'}
            </span>
            <h3
              id="guest-auth-title"
              className="font-serif text-xl font-semibold text-ink dark:text-cream"
            >
              {guestUser
                ? 'Профіль'
                : showRememberedPinLogin
                  ? 'Вхід за ПІН-кодом'
                  : 'Вхід на сайт'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 inline-flex items-center justify-center text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream hover:bg-paper-warm dark:hover:bg-night-elevated rounded-lg transition-colors cursor-pointer"
            aria-label="Закрити"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Alerts */}
        {errorMsg && (
          <div
            className="mb-4 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-xl px-3 py-2.5 space-y-2.5"
            role="alert"
          >
            <p className="leading-relaxed">{errorMsg}</p>

            {unauthorizedDomainHost && (
              <div className="pt-2 border-t border-rose-200 dark:border-rose-900/50 space-y-2">
                <p className="text-[11px] text-rose-800 dark:text-rose-200">
                  Домен <code className="bg-rose-100 dark:bg-rose-900 px-1 py-0.5 rounded font-mono select-all">{unauthorizedDomainHost}</code> необхідно додати у консолі Firebase (Authentication -&gt; Settings -&gt; Authorized domains).
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyUnauthorizedDomain}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-200/70 dark:bg-rose-900/70 text-rose-900 dark:text-rose-100 text-[11px] font-medium hover:bg-rose-200 dark:hover:bg-rose-900 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedDomain ? 'Скопійовано домен!' : 'Скопіювати домен'}</span>
                  </button>
                  <a
                    href="https://console.firebase.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-rose-900 dark:text-rose-100 underline hover:opacity-80"
                  >
                    <span>Відкрити консоль Firebase</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}

            {(needsStandaloneTab || canTryGoogleRedirect) && (
              <div className="flex flex-wrap items-center gap-2">
                {needsStandaloneTab && (
                  <a
                    href={standaloneAuthUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink text-paper dark:bg-cream dark:text-ink text-xs font-medium hover:opacity-90"
                  >
                    <span>Відкрити у новій вкладці</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {canTryGoogleRedirect && (
                  <button
                    type="button"
                    disabled={loadingAction !== null}
                    onClick={handleGoogleRedirectLogin}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink text-paper dark:bg-cream dark:text-ink text-xs font-medium hover:opacity-90"
                  >
                    <span>Увійти через перенаправлення</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* SIGNED-IN VIEW */}
        {guestUser ? (
          <div className="space-y-4">
            {/* User Info Bar */}
            <div className="flex items-center gap-3.5 p-3.5 bg-white dark:bg-night-card rounded-2xl shadow-2xs">
              {guestUser.photoUrl ? (
                <img
                  src={guestUser.photoUrl}
                  alt={guestUser.displayName}
                  width={44}
                  height={44}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="w-11 h-11 rounded-full object-cover shrink-0 ring-1 ring-black/8 dark:ring-white/12"
                />
              ) : (
                <span className="w-11 h-11 rounded-full bg-paper-warm dark:bg-night-elevated inline-flex items-center justify-center text-ink-muted dark:text-parchment shrink-0">
                  <User className="w-5 h-5" />
                </span>
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 min-w-0">
                  {editingDisplayName ? (
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <input
                        type="text"
                        autoFocus
                        maxLength={80}
                        value={displayNameInput}
                        onChange={(e) => setDisplayNameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void saveProfileData();
                          } else if (e.key === 'Escape') {
                            setDisplayNameInput(guestUser.displayName || '');
                            setEditingDisplayName(false);
                          }
                        }}
                        aria-label="Нове ім’я або псевдонім"
                        className="flex-1 min-w-0 bg-transparent border-b border-pine dark:border-cream px-0.5 py-0.5 text-sm font-semibold text-ink dark:text-cream focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={profileSaving || !displayNameInput.trim()}
                        onClick={() => void saveProfileData()}
                        aria-label="Зберегти нікнейм"
                        title="Зберегти"
                        className="p-0.5 text-pine dark:text-emerald-400 hover:opacity-80 cursor-pointer disabled:opacity-40"
                      >
                        <Check className="w-4 h-4" strokeWidth={2.2} />
                      </button>
                      <button
                        type="button"
                        disabled={profileSaving}
                        onClick={() => {
                          setDisplayNameInput(guestUser.displayName || '');
                          setEditingDisplayName(false);
                        }}
                        aria-label="Скасувати редагування нікнейма"
                        title="Скасувати"
                        className="p-0.5 text-ink-subtle dark:text-sandstone hover:text-ink dark:hover:text-cream cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <p className="text-sm font-semibold text-ink dark:text-cream truncate max-w-full">
                        {guestUser.displayName}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setDisplayNameInput(guestUser.displayName || '');
                          setEditingDisplayName(true);
                          setErrorMsg(null);
                          setProfileSuccessMsg(null);
                        }}
                        aria-label="Змінити нікнейм"
                        title="Змінити нікнейм"
                        className="p-0.5 bg-transparent border-0 text-ink-subtle dark:text-sandstone hover:text-ink dark:hover:text-cream transition-colors cursor-pointer shrink-0"
                      >
                        <Pencil className="w-3.5 h-3.5" strokeWidth={1.85} />
                      </button>
                      <UserRankBadges
                        badges={
                          (isAdmin || requiresGoogleForAdmin) && liveBadges
                            ? liveBadges.donorRank
                              ? { donorRank: liveBadges.donorRank }
                              : undefined
                            : liveBadges
                        }
                        size="xs"
                      />
                    </div>
                  )}

                  {guestUser.createdAt && !editingDisplayName && (
                    <span className="text-[11px] text-ink-subtle dark:text-sandstone font-normal tabular-nums shrink-0">
                      Зареєстрований{' '}
                      {new Date(guestUser.createdAt).toLocaleDateString('uk-UA', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                </div>

                {guestUser.email && (
                  <p className="text-[11px] text-ink-muted dark:text-sandstone truncate">
                    {guestUser.email}
                  </p>
                )}
              </div>
            </div>

            {((!(isAdmin || requiresGoogleForAdmin) && liveBadges?.activityRank) || liveBadges?.donorRank) && (
              <div className="px-3.5 py-2.5 bg-white/80 dark:bg-night-card rounded-xl space-y-2">
                <p className="text-[11px] text-ink-muted dark:text-parchment">
                  Відзнаки рейтингу:
                </p>
                <UserRankBadges
                  badges={
                    (isAdmin || requiresGoogleForAdmin) && liveBadges
                      ? liveBadges.donorRank
                        ? { donorRank: liveBadges.donorRank }
                        : undefined
                      : liveBadges
                  }
                  size="md"
                />
              </div>
            )}

            {isAdmin && onOpenAuthorStudio && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuthorStudio();
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-pear-pine-gradient text-white text-xs font-semibold shadow-[0_6px_14px_-6px_rgba(20,41,28,0.45)] dark:shadow-[0_6px_14px_-6px_rgba(0,0,0,0.65)] hover:opacity-95 active:scale-[0.98] transition-all duration-150 whitespace-nowrap cursor-pointer"
              >
                <Settings2 className="w-4 h-4 shrink-0" strokeWidth={1.8} />
                <span>Кабінет автора</span>
              </button>
            )}

            {requiresGoogleForAdmin && !isAdmin && (
              <div className="p-3 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 space-y-2">
                <p className="text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
                  Ви увійшли через швидкий ПІН-код. Для редагування в Кабінеті автора підтвердьте Google-сесію.
                </p>
                <button
                  type="button"
                  disabled={loadingAction !== null}
                  onClick={handleGoogleLogin}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-night-lift hover:bg-paper-warm dark:hover:bg-night-elevated text-xs font-medium text-ink dark:text-cream shadow-2xs transition-colors cursor-pointer disabled:opacity-55"
                >
                  <GoogleLogoIcon />
                  <span>{loadingAction === 'google' ? 'Підключення...' : 'Підтвердити через Google'}</span>
                </button>
              </div>
            )}

            {/* Simple Tab Switcher */}
            <div className="flex gap-1 p-1 rounded-xl bg-paper-warm dark:bg-night-card">
              <button
                type="button"
                onClick={() => setCabinetTab('profile')}
                className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  cabinetTab === 'profile'
                    ? 'bg-white dark:bg-night-elevated text-ink dark:text-cream shadow-2xs'
                    : 'text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream'
                }`}
              >
                Профіль
              </button>
              <button
                type="button"
                onClick={() => {
                  setCabinetTab('works');
                  void loadMyWorks();
                }}
                className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-colors cursor-pointer inline-flex items-center justify-center gap-1 ${
                  cabinetTab === 'works'
                    ? 'bg-white dark:bg-night-elevated text-ink dark:text-cream shadow-2xs'
                    : 'text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream'
                }`}
              >
                <span>Мої твори</span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-paper-warm dark:bg-night-card text-ink-muted dark:text-parchment">
                  {myWorksList.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setCabinetTab('likes')}
                className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-colors cursor-pointer inline-flex items-center justify-center gap-1 ${
                  cabinetTab === 'likes'
                    ? 'bg-white dark:bg-night-elevated text-ink dark:text-cream shadow-2xs'
                    : 'text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream'
                }`}
              >
                <span>Вподобано</span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-paper-warm dark:bg-night-card text-ink-muted dark:text-parchment">
                  {likedPoems.length}
                </span>
              </button>
            </div>

            {cabinetTab === 'profile' ? (
              pinSetupStep ? (
                <div className="space-y-4 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={pinSetupSaving}
                      onClick={() => {
                        setPinSetupStep(null);
                        setPinSetupInput('');
                        setErrorMsg(null);
                      }}
                      className="inline-flex items-center gap-1 text-xs text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Назад</span>
                    </button>
                    <span className="text-[11px] font-medium text-ink-muted dark:text-parchment">
                      {pinSetupStep === 'current'
                        ? 'Поточний ПІН'
                        : pinSetupStep === 'new'
                          ? 'Крок 1 з 2'
                          : 'Крок 2 з 2'}
                    </span>
                  </div>

                  <p className="text-center text-xs font-medium text-ink dark:text-cream">
                    {pinSetupStep === 'current'
                      ? 'Введіть поточний 4-значний ПІН-код'
                      : pinSetupStep === 'new'
                        ? 'Придумайте 4-значний ПІН-код'
                        : 'Повторіть новий ПІН-код'}
                  </p>

                  <PinPad
                    value={pinSetupInput}
                    onChange={setPinSetupInput}
                    onComplete={handlePinSetupDigitComplete}
                    loading={pinSetupSaving}
                    errorTrigger={pinSetupErrorTick}
                    keyboardActive={isOpen && Boolean(pinSetupStep)}
                  />
                </div>
              ) : (
                <form onSubmit={handleSaveProfile} className="space-y-3.5 pt-1">
                  {liveBadges?.donorRank && liveBadges.donorRank <= 3 && (
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-medium text-ink-muted dark:text-parchment">
                        Текст у глобальному чаті (Топ-{liveBadges.donorRank} донат)
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={donorChatTextInput}
                        onChange={(e) => setDonorChatTextInput(e.target.value.slice(0, 80))}
                        placeholder="Ваш підпис або статус на вибір..."
                        className="w-full bg-paper-warm dark:bg-night-lift rounded-xl px-3 py-2 text-xs text-ink dark:text-cream focus:outline-none focus:bg-white dark:focus:bg-night-elevated transition-colors"
                      />
                    </div>
                  )}

                  {/* Quick 4-digit PIN management */}
                  <div className="p-3.5 rounded-xl bg-white/85 dark:bg-night-card space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="w-7 h-7 rounded-lg bg-paper-warm dark:bg-night-elevated text-ink dark:text-cream inline-flex items-center justify-center shrink-0 mt-0.5">
                          <KeyRound className="w-3.5 h-3.5" strokeWidth={1.9} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-ink dark:text-cream">
                            Швидкий ПІН-вхід (4 цифри)
                          </p>
                          <p className="text-[11px] text-ink-muted dark:text-parchment leading-snug">
                            {guestUser.hasPin
                              ? 'Увімкнено · вхід без повторного логування через Google'
                              : 'Входьте за 4 цифрами без вибору акаунту'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        disabled={pinSetupSaving}
                        onClick={startPinSetup}
                        className="px-3 py-1.5 rounded-lg bg-paper-warm dark:bg-night-elevated hover:bg-paper-sand dark:hover:bg-night-muted text-[11px] font-medium text-ink dark:text-cream transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {guestUser.hasPin ? 'Змінити ПІН' : 'Встановити ПІН-код'}
                      </button>

                      {guestUser.hasPin && (
                        <button
                          type="button"
                          disabled={pinSetupSaving}
                          onClick={handleDisablePin}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Вимкнути</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {profileSuccessMsg && (
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium inline-flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>{profileSuccessMsg}</span>
                    </p>
                  )}

                  <div className="pt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await onLogout('lock');
                          onClose();
                        }}
                        className="text-xs text-rose-600 dark:text-rose-400 hover:underline px-2 py-1.5 cursor-pointer"
                      >
                        Вийти
                      </button>
                      {guestUser.hasPin && (
                        <button
                          type="button"
                          onClick={async () => {
                            await onLogout('forget');
                            onClose();
                          }}
                          title="Вийти та не запам’ятовувати акаунт на цьому пристрої"
                          className="text-[11px] text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream px-1.5 py-1.5 cursor-pointer"
                        >
                          Забути пристрій
                        </button>
                      )}
                    </div>

                    {liveBadges?.donorRank && liveBadges.donorRank <= 3 && (
                      <button
                        type="submit"
                        disabled={profileSaving}
                        className="px-4 py-2 bg-ink text-paper dark:bg-cream dark:text-ink rounded-xl text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                      >
                        {profileSaving ? 'Збереження...' : 'Зберегти'}
                      </button>
                    )}
                  </div>
                </form>
              )
            ) : cabinetTab === 'works' ? (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-ink-muted dark:text-parchment">
                    Ваші запропоновані вірші та проза
                  </p>
                  <button
                    type="button"
                    disabled={loadingMyWorks}
                    onClick={() => void loadMyWorks()}
                    aria-label="Оновити мої твори"
                    className="p-1.5 rounded-lg text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream hover:bg-paper-warm dark:hover:bg-night-elevated cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingMyWorks ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {worksFeedback && (
                  <div
                    role="status"
                    className={`px-3 py-2 rounded-xl text-xs leading-relaxed flex items-start justify-between gap-2 ${
                      worksFeedback.isError
                        ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                        : 'bg-[#F2F6EE] dark:bg-[#2B332C] text-pine-dark dark:text-[#E5F2E6]'
                    }`}
                  >
                    <span>{worksFeedback.text}</span>
                    <button
                      type="button"
                      onClick={() => setWorksFeedback(null)}
                      aria-label="Сховати"
                      className="p-0.5 rounded hover:bg-black/5 cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {loadingMyWorks && myWorksList.length === 0 ? (
                  <div className="py-8 text-center text-xs text-ink-muted dark:text-parchment">
                    Завантаження ваших творів...
                  </div>
                ) : myWorksList.length === 0 ? (
                  <div className="py-8 text-center space-y-2 rounded-xl bg-white dark:bg-night-card p-5 text-ink-muted dark:text-parchment">
                    <BookOpen className="w-5 h-5 mx-auto opacity-45" strokeWidth={1.6} />
                    <p className="text-xs">
                      Ви ще не пропонували власних віршів або прози.
                    </p>
                  </div>
                ) : myWorksList.length > 8 && !editingWorkKey ? (
                  <div className="h-[min(54vh,420px)] w-full overflow-hidden">
                    <List
                      rowCount={myWorksList.length}
                      rowHeight={worksRowHeight}
                      rowComponent={VirtualUserWorkRow}
                      rowProps={userWorkRowProps}
                      overscanCount={3}
                      className="h-full w-full overflow-x-hidden"
                    />
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[54vh] overflow-y-auto pr-1">
                    {myWorksList.map((entry) => {
                      const sub = entry.item;
                      const workKey = `${entry.kind}:${sub.id}`;
                      const isEditing = editingWorkKey === workKey && editDraft !== null;
                      const isApproved = sub.status === 'approved';
                      const isRejected = sub.status === 'rejected';
                      const workStatusValue: ProseStatus = sub.workStatus || 'completed';

                      if (!isEditing) {
                        return (
                          <UserWorkSummaryCard
                            key={workKey}
                            entry={entry}
                            onStartEditPoem={handleStartEditPoem}
                            onStartEditProse={handleStartEditProse}
                            onOpenPublished={handleOpenPublishedWork}
                          />
                        );
                      }

                      return (
                        <div
                          key={workKey}
                          className="p-3.5 rounded-xl bg-white dark:bg-night-card space-y-2.5 text-xs"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                <span className="px-1.5 py-0.5 rounded bg-paper-warm dark:bg-night-elevated text-[10px] font-semibold text-ink-muted dark:text-parchment">
                                  {entry.kind === 'poem' ? 'Вірш' : 'Проза'}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    workStatusValue === 'completed'
                                      ? 'bg-emerald-50 text-emerald-800 dark:bg-night-elevated dark:text-silver'
                                      : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                                  }`}
                                >
                                  {workStatusValue === 'completed' ? 'Закінчено' : 'У процесі'}
                                </span>
                              </div>
                              <p className="text-sm font-semibold text-ink dark:text-cream">
                                {sub.title}
                              </p>
                              <p className="text-[11px] text-ink-muted dark:text-parchment">
                                {entry.kind === 'poem'
                                  ? (sub as PoemSubmission).cycle || 'Стрічка віршів'
                                  : (sub as ProseSubmission).genre || 'Оповідання'}
                                {' · '}
                                {new Date(sub.updatedAt || sub.createdAt).toLocaleDateString('uk-UA')}
                              </p>
                            </div>

                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold shrink-0 ${
                                isApproved
                                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                                  : isRejected
                                    ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                                    : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                              }`}
                            >
                              {isApproved ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Опубліковано</span>
                                </>
                              ) : isRejected ? (
                                <>
                                  <XCircle className="w-3 h-3" />
                                  <span>Відхилено</span>
                                </>
                              ) : (
                                <>
                                  <Clock className="w-3 h-3" />
                                  <span>На розгляді</span>
                                </>
                              )}
                            </span>
                          </div>

                          <form
                            onSubmit={handleSaveWorkEdit}
                            className="p-3 rounded-xl bg-paper dark:bg-night-panel space-y-2.5"
                          >
                            <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50/90 dark:bg-amber-950/40 px-2.5 py-2 rounded-lg leading-relaxed">
                              Після збереження правок твір знову надійде на підтвердження адміністратору (і тимчасово не показуватиметься на сайті до схвалення).
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[11px] font-medium text-ink-muted dark:text-parchment mb-1">
                                  Назва *
                                </label>
                                <input
                                  type="text"
                                  required
                                  maxLength={240}
                                  value={editDraft.title}
                                  onChange={(e) =>
                                    setEditDraft({ ...editDraft, title: e.target.value })
                                  }
                                  className="w-full bg-paper-warm dark:bg-night-lift rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:bg-white dark:focus:bg-night-elevated"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-medium text-ink-muted dark:text-parchment mb-1">
                                  {editDraft.kind === 'poem' ? 'Цикл / тема' : 'Жанр'}
                                </label>
                                <input
                                  type="text"
                                  maxLength={160}
                                  value={editDraft.subtitle}
                                  onChange={(e) =>
                                    setEditDraft({ ...editDraft, subtitle: e.target.value })
                                  }
                                  className="w-full bg-paper-warm dark:bg-night-lift rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:bg-white dark:focus:bg-night-elevated"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-[11px] font-medium text-ink-muted dark:text-parchment mb-1">
                                Статус твору
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditDraft({ ...editDraft, workStatus: 'completed' })
                                  }
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer ${
                                    editDraft.workStatus === 'completed'
                                      ? 'bg-emerald-50 text-emerald-800 dark:bg-night-elevated dark:text-silver font-semibold'
                                      : 'bg-paper-warm dark:bg-night-lift text-ink-muted dark:text-parchment'
                                  }`}
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Закінчено</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditDraft({ ...editDraft, workStatus: 'in_progress' })
                                  }
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer ${
                                    editDraft.workStatus === 'in_progress'
                                      ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 font-semibold'
                                      : 'bg-paper-warm dark:bg-night-lift text-ink-muted dark:text-parchment'
                                  }`}
                                >
                                  <Clock className="w-3 h-3" />
                                  <span>У процесі</span>
                                </button>
                              </div>
                            </div>

                            <div>
                              <label className="block text-[11px] font-medium text-ink-muted dark:text-parchment mb-1">
                                {editDraft.kind === 'poem'
                                  ? 'Примітка або епіграф'
                                  : 'Слоган або епіграф'}
                              </label>
                              <input
                                type="text"
                                maxLength={500}
                                value={editDraft.noteOrSlogan}
                                onChange={(e) =>
                                  setEditDraft({ ...editDraft, noteOrSlogan: e.target.value })
                                }
                                className="w-full bg-paper-warm dark:bg-night-lift rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:bg-white dark:focus:bg-night-elevated"
                              />
                            </div>

                            {editDraft.kind === 'prose' && (
                              <div>
                                <label className="block text-[11px] font-medium text-ink-muted dark:text-parchment mb-1">
                                  Короткий опис для картки
                                </label>
                                <textarea
                                  rows={2}
                                  maxLength={2000}
                                  value={editDraft.excerpt}
                                  onChange={(e) =>
                                    setEditDraft({ ...editDraft, excerpt: e.target.value })
                                  }
                                  className="w-full bg-paper-warm dark:bg-night-lift rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:bg-white dark:focus:bg-night-elevated"
                                />
                              </div>
                            )}

                            <div>
                              <label className="block text-[11px] font-medium text-ink-muted dark:text-parchment mb-1">
                                Текст * (відступи й перенесення зберігаються)
                              </label>
                              <textarea
                                rows={7}
                                required
                                maxLength={editDraft.kind === 'poem' ? 50000 : 250000}
                                value={editDraft.content}
                                onChange={(e) =>
                                  setEditDraft({ ...editDraft, content: e.target.value })
                                }
                                className="w-full bg-paper-warm dark:bg-night-lift rounded-lg px-2.5 py-2 text-xs leading-relaxed focus:outline-none focus:bg-white dark:focus:bg-night-elevated"
                              />
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                disabled={savingEdit}
                                onClick={() => {
                                  setEditingWorkKey(null);
                                  setEditDraft(null);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-paper-warm dark:bg-night-hover text-xs font-medium cursor-pointer"
                              >
                                Скасувати
                              </button>
                              <button
                                type="submit"
                                disabled={savingEdit}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-ink text-paper dark:bg-cream dark:text-ink text-xs font-semibold hover:opacity-90 cursor-pointer disabled:opacity-50"
                              >
                                <Save className="w-3.5 h-3.5" />
                                <span>
                                  {savingEdit ? 'Збереження...' : 'Зберегти й на перевірку'}
                                </span>
                              </button>
                            </div>
                          </form>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2.5 pt-1">
                {likedPoems.length === 0 ? (
                  <div className="py-8 text-center space-y-1.5 text-ink-muted dark:text-parchment">
                    <Heart className="w-5 h-5 mx-auto opacity-40" strokeWidth={1.5} />
                    <p className="text-xs">У вподобаному поки нічого немає</p>
                  </div>
                ) : likedPoems.length > 8 ? (
                  <div className="h-52 w-full overflow-hidden">
                    <List
                      rowCount={likedPoems.length}
                      rowHeight={56}
                      rowComponent={VirtualLikedPoemRow}
                      rowProps={likedPoemRowProps}
                      overscanCount={4}
                      className="h-full w-full overflow-x-hidden"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {likedPoems.map((poem: Poem) => (
                      <LikedPoemRow
                        key={poem.id}
                        poem={poem}
                        onSelectPoem={handleSelectLikedPoem}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : showRememberedPinLogin && rememberedGuest ? (
          /* SIGNED-OUT MONOBANK-STYLE 4-DIGIT PIN VIEW */
          <div className="space-y-5 pt-1">
            <div className="flex flex-col items-center text-center gap-2">
              {rememberedGuest.photoUrl ? (
                <img
                  src={rememberedGuest.photoUrl}
                  alt={rememberedGuest.displayName}
                  width={56}
                  height={56}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="w-14 h-14 rounded-full object-cover shadow-xs"
                />
              ) : (
                <span className="w-14 h-14 rounded-full bg-paper-warm dark:bg-night-hover inline-flex items-center justify-center text-ink-muted dark:text-parchment">
                  <User className="w-6 h-6" />
                </span>
              )}
              <div className="space-y-0.5 max-w-full">
                <p className="text-sm font-semibold text-ink dark:text-cream truncate">
                  {rememberedGuest.displayName}
                </p>
                {rememberedGuest.email && (
                  <p className="text-[11px] text-ink-muted dark:text-parchment truncate">
                    {maskEmailForHint(rememberedGuest.email)}
                  </p>
                )}
              </div>
              <p className="text-xs text-ink-muted dark:text-parchment pt-1">
                {loadingAction === 'pin' ? 'Перевіряємо ПІН-код...' : 'Введіть 6 цифр для швидкого входу'}
              </p>
            </div>

            <PinPad
              value={loginPin}
              onChange={setLoginPin}
              onComplete={handlePinLoginSubmit}
              loading={loadingAction === 'pin'}
              disabled={loadingAction === 'google' || Boolean(pinLockedUntilMs && Date.now() < pinLockedUntilMs)}
              errorTrigger={loginPinErrorTick}
              keyboardActive={isOpen && showRememberedPinLogin}
              leftActionLabel="Google"
              onLeftAction={() => {
                setErrorMsg(null);
                setForceGoogleView(true);
                void handleGoogleLogin();
              }}
            />

            <div className="flex items-center justify-between pt-2 border-t border-black/5 dark:border-white/10 text-[11px]">
              <button
                type="button"
                disabled={loadingAction !== null}
                onClick={() => {
                  setErrorMsg(null);
                  setForceGoogleView(true);
                }}
                className="text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream transition-colors cursor-pointer"
              >
                Увійти через Google
              </button>
              {onForgetRemembered && (
                <button
                  type="button"
                  disabled={loadingAction !== null}
                  onClick={() => {
                    setErrorMsg(null);
                    setLoginPin('');
                    onForgetRemembered();
                  }}
                  className="inline-flex items-center gap-1 text-ink-muted dark:text-parchment hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                >
                  <UserX className="w-3.5 h-3.5" />
                  <span>Інший акаунт</span>
                </button>
              )}
            </div>
          </div>
        ) : showRememberedGoogleResume && rememberedGuest ? (
          /* SIGNED-OUT REMEMBERED ACCOUNT WITHOUT PIN YET */
          <div className="space-y-4 pt-1">
            <div className="flex items-center gap-3 p-3 bg-white dark:bg-night-card rounded-xl">
              {rememberedGuest.photoUrl ? (
                <img
                  src={rememberedGuest.photoUrl}
                  alt={rememberedGuest.displayName}
                  width={40}
                  height={40}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-full object-cover shrink-0"
                />
              ) : (
                <span className="w-10 h-10 rounded-full bg-paper-warm dark:bg-night-elevated inline-flex items-center justify-center text-ink-muted dark:text-parchment shrink-0">
                  <User className="w-4 h-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-ink-muted dark:text-parchment">З поверненням</p>
                <p className="text-xs font-semibold text-ink dark:text-cream truncate">
                  {rememberedGuest.displayName}
                </p>
                {rememberedGuest.email && (
                  <p className="text-[11px] text-ink-muted dark:text-parchment truncate">
                    {maskEmailForHint(rememberedGuest.email)}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={loadingAction !== null}
              onClick={handleGoogleLogin}
              className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-white dark:bg-night-card hover:bg-paper-warm dark:hover:bg-night-elevated shadow-xs text-xs font-medium text-ink dark:text-cream transition-colors cursor-pointer disabled:opacity-55"
            >
              <GoogleLogoIcon />
              <span>
                {loadingAction === 'google' ? 'Підключення...' : 'Продовжити через Google'}
              </span>
            </button>

            <p className="text-[11px] text-ink-muted dark:text-parchment leading-relaxed">
              Після входу сайт запам’ятає вас автоматично, а в профілі можна встановити 4-значний ПІН-код.
            </p>

            {onForgetRemembered && (
              <div className="pt-1 text-right">
                <button
                  type="button"
                  disabled={loadingAction !== null}
                  onClick={() => {
                    setErrorMsg(null);
                    onForgetRemembered();
                  }}
                  className="text-[11px] text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream cursor-pointer"
                >
                  Увійти в інший акаунт
                </button>
              </div>
            )}
          </div>
        ) : (
          /* STANDARD SIGNED-OUT VIEW */
          <div className="space-y-4 pt-1">
            {rememberedGuest && forceGoogleView && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setForceGoogleView(false);
                }}
                className="inline-flex items-center gap-1.5 text-xs text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Назад до швидкого входу ({rememberedGuest.displayName})</span>
              </button>
            )}

            <p className="text-xs text-ink-muted dark:text-parchment leading-relaxed">
              Увійдіть через Google — сайт запам’ятає вас для автоматичного входу, а в профілі можна налаштувати 4-значний ПІН-код.
            </p>

            <button
              type="button"
              disabled={loadingAction !== null}
              onClick={handleGoogleLogin}
              className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-white dark:bg-night-card hover:bg-paper-warm dark:hover:bg-night-elevated shadow-xs text-xs font-medium text-ink dark:text-cream transition-colors cursor-pointer disabled:opacity-55"
            >
              <GoogleLogoIcon />
              <span>
                {loadingAction === 'google' ? 'Підключення...' : 'Увійти через Google'}
              </span>
            </button>
          </div>
        )}
      </m.div>
    </div>
  );
});
