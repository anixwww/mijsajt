import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  ArrowDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  CornerUpLeft,
  FileText,
  Flag,
  History,
  LogIn,
  MessagesSquare,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Radio,
  Search,
  Send,
  Shield,
  SmilePlus,
  Trash2,
  User,
  VolumeX,
  X,
} from 'lucide-react';
import { List, useDynamicRowHeight, type ListImperativeAPI, type RowComponentProps } from 'react-window';
import {
  CHAT_REACTION_EMOJIS,
  type ChatAttachmentType,
  type ChatMessageAttachment,
  type ChatMetaState,
  type ChatMutedUserEntry,
  type ChatReportRecord,
  type GlobalChatMessage,
  type GuestUser,
  type UserTopBadges,
} from '../types.ts';
import { useCatalogStore } from '../store/useCatalogStore.ts';
import { useAllRadioTracks } from '../utils/radioSelectors.ts';
import { triggerHapticFeedback, triggerLikeHapticFeedback } from '../utils/haptics.ts';
import { UserRankBadges } from './UserRankBadges.tsx';
import {
  clearAllChatMessagesInFirestore,
  clearCachedGlobalChatState,
  deleteChatMessageDirectInFirestore,
  fetchOlderGlobalChatMessagesFromFirestore,
  generateChatMessageId,
  getCachedGlobalChatState,
  prewarmChatFirestore,
  saveCachedGlobalChatState,
  sendChatMessageDirectToFirestore,
  subscribeGlobalChatMessages,
  type ChatAuthorMeta,
} from '../utils/chatFirestore.ts';

const EDIT_WINDOW_MS = 5 * 60 * 1000;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const SLOW_MODE_OPTIONS = [0, 10, 30, 60] as const;

function ChatAvatar({ photoUrl }: { photoUrl?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt=""
        width={32}
        height={32}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full object-cover"
      />
    );
  }
  return <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" />;
}

interface GlobalChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  guestUser: GuestUser | null;
  isAdmin: boolean;
  getGuestToken: (forceRefresh?: boolean) => Promise<string | null>;
  getAdminToken?: (forceRefresh?: boolean) => Promise<string | null>;
  onOpenAuthModal: () => void;
  onGuestUserUpdated?: (user: GuestUser) => void;
  onOpenAttachment?: (attachment: ChatMessageAttachment) => void;
}

type WsStatus = 'connecting' | 'connected' | 'reconnecting';

function getDateKey(isoStr: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateDivider(isoStr: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const todayKey = getDateKey(now.toISOString());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = getDateKey(yesterday.toISOString());
  const key = getDateKey(isoStr);
  if (key === todayKey) return 'Сьогодні';
  if (key === yesterdayKey) return 'Вчора';
  return d.toLocaleDateString('uk-UA', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function formatMessageTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('uk-UA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function isFramedAuthorMessage(msg: GlobalChatMessage): boolean {
  if (msg.isAdmin) return false;
  const donorRank = msg.authorBadges?.donorRank;
  const isTop3Donor = donorRank === 1 || donorRank === 2 || donorRank === 3;
  const isTop1Activity = msg.authorBadges?.activityRank === 1;
  return isTop3Donor || isTop1Activity;
}

function canGroupMessages(prev: GlobalChatMessage | undefined, curr: GlobalChatMessage): boolean {
  if (!prev) return false;
  if (prev.authorUid !== curr.authorUid) return false;
  if (getDateKey(prev.createdAt) !== getDateKey(curr.createdAt)) return false;
  if (curr.replyTo) return false;
  if (isFramedAuthorMessage(prev) || isFramedAuthorMessage(curr)) return false;
  const prevMs = Date.parse(prev.createdAt);
  const currMs = Date.parse(curr.createdAt);
  if (!Number.isFinite(prevMs) || !Number.isFinite(currMs)) return false;
  return currMs - prevMs >= 0 && currMs - prevMs <= GROUP_WINDOW_MS;
}

function doesMessageMentionUser(text: string, displayName?: string): boolean {
  if (!displayName || !displayName.trim()) return false;
  const cleanName = displayName.trim().toLowerCase();
  const lower = text.toLowerCase();
  if (!lower.includes('@')) return false;
  const firstToken = cleanName.split(/\s+/)[0];
  return (
    lower.includes(`@${cleanName}`) ||
    (Boolean(firstToken && firstToken.length >= 2) && lower.includes(`@${firstToken}`))
  );
}

function renderHighlightedText(
  text: string,
  searchQuery: string,
  currentUserDisplayName?: string
): ReactNode {
  const trimmedSearch = searchQuery.trim();
  const lowerCurrent = currentUserDisplayName?.trim().toLowerCase() || '';
  const mentionPattern = /(@[A-Za-zА-Яа-яІіЇїЄєҐґ0-9_.-]+(?:\s+[A-Za-zА-Яа-яІіЇїЄєҐґ0-9_.-]+)?)/g;

  const renderSearchMarks = (segment: string, keyPrefix: string): ReactNode => {
    if (!trimmedSearch) return segment;
    const lowerSeg = segment.toLowerCase();
    const lowerQ = trimmedSearch.toLowerCase();
    if (!lowerSeg.includes(lowerQ)) return segment;
    const nodes: ReactNode[] = [];
    let cursor = 0;
    let idx = lowerSeg.indexOf(lowerQ, cursor);
    let partIdx = 0;
    while (idx !== -1) {
      if (idx > cursor) {
        nodes.push(segment.slice(cursor, idx));
      }
      nodes.push(
        <mark
          key={`${keyPrefix}-m-${partIdx++}`}
          className="bg-amber-400/30 text-paper rounded px-0.5"
        >
          {segment.slice(idx, idx + trimmedSearch.length)}
        </mark>
      );
      cursor = idx + trimmedSearch.length;
      idx = lowerSeg.indexOf(lowerQ, cursor);
    }
    if (cursor < segment.length) {
      nodes.push(segment.slice(cursor));
    }
    return nodes;
  };

  const parts = text.split(mentionPattern);
  return parts.map((part, idx) => {
    if (part.startsWith('@') && part.length > 1) {
      const mentionBody = part.slice(1).toLowerCase();
      const mentionsSelf =
        Boolean(lowerCurrent) &&
        (mentionBody === lowerCurrent ||
          mentionBody.startsWith(`${lowerCurrent} `) ||
          lowerCurrent.startsWith(mentionBody));
      return (
        <span
          key={`p-${idx}`}
          className={
            mentionsSelf
              ? 'bg-silver/20 text-paper font-semibold px-1 rounded'
              : 'text-silver font-medium'
          }
        >
          {renderSearchMarks(part, `p-${idx}`)}
        </span>
      );
    }
    return <span key={`p-${idx}`}>{renderSearchMarks(part, `p-${idx}`)}</span>;
  });
}

function AttachmentBadgeIcon({ type }: { type: ChatAttachmentType }) {
  if (type === 'poem') return <BookOpen className="w-3.5 h-3.5 shrink-0 text-amber-300" />;
  if (type === 'prose') return <FileText className="w-3.5 h-3.5 shrink-0 text-sky-300" />;
  return <Radio className="w-3.5 h-3.5 shrink-0 text-emerald-300" />;
}

function getAttachmentTypeLabel(type: ChatAttachmentType): string {
  if (type === 'poem') return 'Вірш';
  if (type === 'prose') return 'Проза';
  return 'Радіо';
}

interface ChatMessageRowData {
  messages: GlobalChatMessage[];
  guestUserUid?: string;
  guestUserFirebaseUid?: string;
  guestUserDisplayName?: string;
  isAdmin: boolean;
  isSignedIn: boolean;
  confirmDeleteId: string | null;
  activeReactionPickerId: string | null;
  activeMuteMenuId: string | null;
  editingMessageId: string | null;
  editingDraft: string;
  reportedMessageIds: ReadonlySet<string>;
  pinnedMessageId?: string | null;
  searchQuery: string;
  activeSearchMatchId: string | null;
  highlightedMessageId: string | null;
  onReply: (msg: GlobalChatMessage) => void;
  onDelete: (id: string) => void;
  onJumpToMessage: (id: string) => void;
  onToggleReaction: (id: string, emoji: string) => void;
  onToggleReactionPicker: (id: string) => void;
  onStartEdit: (msg: GlobalChatMessage) => void;
  onChangeEditDraft: (value: string) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onTogglePin: (msg: GlobalChatMessage) => void;
  onToggleMuteMenu: (id: string) => void;
  onMuteUser: (targetUid: string, displayName: string, minutes: number) => void;
  onReportMessage: (msg: GlobalChatMessage) => void;
  onOpenAttachment?: (attachment: ChatMessageAttachment) => void;
}

const ChatMessageItem = memo(function ChatMessageItem({
  msg,
  prevMsg,
  nextMsg,
  isFirst,
  isLast,
  guestUserUid,
  guestUserFirebaseUid,
  guestUserDisplayName,
  isAdmin,
  isSignedIn,
  confirmDeleteId,
  activeReactionPickerId,
  activeMuteMenuId,
  editingMessageId,
  editingDraft,
  isReported,
  isPinned,
  searchQuery,
  isSearchMatchActive,
  isJumpHighlighted,
  onReply,
  onDelete,
  onJumpToMessage,
  onToggleReaction,
  onToggleReactionPicker,
  onStartEdit,
  onChangeEditDraft,
  onSaveEdit,
  onCancelEdit,
  onTogglePin,
  onToggleMuteMenu,
  onMuteUser,
  onReportMessage,
  onOpenAttachment,
}: {
  msg: GlobalChatMessage;
  prevMsg?: GlobalChatMessage;
  nextMsg?: GlobalChatMessage;
  isFirst: boolean;
  isLast: boolean;
  guestUserUid?: string;
  guestUserFirebaseUid?: string;
  guestUserDisplayName?: string;
  isAdmin: boolean;
  isSignedIn: boolean;
  confirmDeleteId: string | null;
  activeReactionPickerId: string | null;
  activeMuteMenuId: string | null;
  editingMessageId: string | null;
  editingDraft: string;
  isReported: boolean;
  isPinned: boolean;
  searchQuery: string;
  isSearchMatchActive: boolean;
  isJumpHighlighted: boolean;
  onReply: (msg: GlobalChatMessage) => void;
  onDelete: (id: string) => void;
  onJumpToMessage: (id: string) => void;
  onToggleReaction: (id: string, emoji: string) => void;
  onToggleReactionPicker: (id: string) => void;
  onStartEdit: (msg: GlobalChatMessage) => void;
  onChangeEditDraft: (value: string) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onTogglePin: (msg: GlobalChatMessage) => void;
  onToggleMuteMenu: (id: string) => void;
  onMuteUser: (targetUid: string, displayName: string, minutes: number) => void;
  onReportMessage: (msg: GlobalChatMessage) => void;
  onOpenAttachment?: (attachment: ChatMessageAttachment) => void;
}) {
  const showDateDivider = isFirst || (prevMsg ? getDateKey(prevMsg.createdAt) !== getDateKey(msg.createdAt) : false);
  const isGrouped = !isFirst && canGroupMessages(prevMsg, msg);
  const nextIsGrouped = nextMsg ? canGroupMessages(msg, nextMsg) : false;

  const isOwn = Boolean(
    guestUserUid &&
      (msg.authorUid === guestUserUid ||
        (guestUserFirebaseUid && msg.authorUid === guestUserFirebaseUid))
  );
  const canDelete = isOwn || isAdmin;
  const createdMs = Date.parse(msg.createdAt);
  const canEdit =
    isOwn &&
    (isAdmin || (Number.isFinite(createdMs) && Date.now() - createdMs <= EDIT_WINDOW_MS));
  const isConfirming = confirmDeleteId === msg.id;
  const isEditing = editingMessageId === msg.id;
  const showReactionPicker = activeReactionPickerId === msg.id;
  const showMuteMenu = activeMuteMenuId === msg.id;

  const isAdminMsg = Boolean(msg.isAdmin);
  const donorRank = !isAdminMsg ? msg.authorBadges?.donorRank : undefined;
  const isTop3Donor = donorRank === 1 || donorRank === 2 || donorRank === 3;
  const isTop1Activity = !isAdminMsg && msg.authorBadges?.activityRank === 1;
  const hasFramedCard = isTop3Donor || isTop1Activity;
  const hasDonorCustomText = Boolean(
    !isAdminMsg &&
      !isGrouped &&
      isTop3Donor &&
      msg.authorDonorText &&
      msg.authorDonorText.trim()
  );
  const mentionsMe = !isOwn && doesMessageMentionUser(msg.text, guestUserDisplayName);
  const currentActorUid = guestUserFirebaseUid || guestUserUid || '';
  const reactionEntries = msg.reactions
    ? Object.entries(msg.reactions).filter(([, list]) => Array.isArray(list) && list.length > 0)
    : [];

  const outerFrameClass =
    donorRank === 1
      ? 'rounded-2xl p-[1.5px] bg-gradient-to-br from-[#FFF1B8] via-[#D4AF37] to-[#F5D061] shadow-[0_12px_32px_-12px_rgba(234,179,8,0.6)]'
      : donorRank === 2
        ? 'rounded-2xl p-[1.5px] bg-gradient-to-br from-[#F8FAFC] via-[#94A3B8] to-[#E2E8F0] shadow-[0_12px_30px_-12px_rgba(203,213,225,0.52)]'
        : donorRank === 3
          ? 'rounded-2xl p-[1.5px] bg-gradient-to-br from-[#F6C89F] via-[#B87333] to-[#E09F67] shadow-[0_12px_30px_-12px_rgba(217,119,6,0.5)]'
          : 'rounded-2xl p-[1.5px] bg-gradient-to-br from-[#F3D999]/85 via-[#B8860B]/50 to-[#EBD08A]/80 shadow-[0_10px_28px_-14px_rgba(217,119,6,0.4)]';

  const innerSurfaceClass =
    donorRank === 1
      ? 'relative rounded-[14.5px] bg-gradient-to-br from-[#352B14] via-[#272014] to-[#1D180F] ring-1 ring-inset ring-[#FFE89E]/35'
      : donorRank === 2
        ? 'relative rounded-[14.5px] bg-gradient-to-br from-[#2B313B] via-[#21262E] to-[#191C23] ring-1 ring-inset ring-[#E2E8F0]/30'
        : donorRank === 3
          ? 'relative rounded-[14.5px] bg-gradient-to-br from-[#332217] via-[#271B14] to-[#1E1510] ring-1 ring-inset ring-[#F3BC8D]/30'
          : 'relative rounded-[14.5px] bg-gradient-to-br from-[#2B271E] via-[#24211B] to-[#1F1D18]';

  const filigreeCornerColor =
    donorRank === 1
      ? 'border-[#FFE58F]/85'
      : donorRank === 2
        ? 'border-[#E2E8F0]/80'
        : donorRank === 3
          ? 'border-[#F3BC8D]/80'
          : 'border-[#F3D999]/55';

  const avatarRingClass =
    donorRank === 1
      ? 'ring-1 ring-[#FFE58F]/85 shadow-[0_0_14px_-3px_rgba(250,204,21,0.65)]'
      : donorRank === 2
        ? 'ring-1 ring-[#E2E8F0]/80 shadow-[0_0_12px_-3px_rgba(226,232,240,0.55)]'
        : donorRank === 3
          ? 'ring-1 ring-[#F3BC8D]/80 shadow-[0_0_12px_-3px_rgba(217,119,6,0.5)]'
          : isTop1Activity
            ? 'ring-1 ring-[#F3D999]/75 shadow-[0_0_12px_-3px_rgba(243,217,153,0.42)]'
            : '';

  const donorCustomTextColorClass =
    donorRank === 1
      ? 'text-[#FDE68A]'
      : donorRank === 2
        ? 'text-[#E2E8F0]'
        : 'text-[#F6CFA9]';

  const highlightRingClass = isSearchMatchActive
    ? 'ring-1 ring-amber-400/75'
    : isJumpHighlighted
      ? 'ring-1 ring-silver/70'
      : mentionsMe && !hasFramedCard
        ? 'border-l-2 border-l-silver/80'
        : '';

  const actionControls = (
    <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
      <span className="text-[10px] text-parchment/85 tabular-nums whitespace-nowrap mr-0.5">
        {formatMessageTime(msg.createdAt)}
        {msg.editedAt ? ' · ред.' : ''}
      </span>
      {isSignedIn && (
        <button
          type="button"
          onClick={() => onToggleReactionPicker(msg.id)}
          title="Реакція"
          aria-label="Додати реакцію"
          className={`p-1 rounded transition-colors cursor-pointer ${
            showReactionPicker
              ? 'text-paper bg-white/15'
              : 'text-parchment hover:text-paper hover:bg-white/10'
          }`}
        >
          <SmilePlus className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onReply(msg)}
        title="Відповісти"
        aria-label={`Відповісти ${msg.authorName}`}
        className="p-1 rounded text-parchment hover:text-paper hover:bg-white/10 transition-colors cursor-pointer"
      >
        <CornerUpLeft className="w-3.5 h-3.5" />
      </button>
      {canEdit && !isEditing && (
        <button
          type="button"
          onClick={() => onStartEdit(msg)}
          title="Редагувати"
          aria-label="Редагувати повідомлення"
          className="p-1 rounded text-parchment hover:text-paper hover:bg-white/10 transition-colors cursor-pointer"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      {isAdmin && (
        <button
          type="button"
          onClick={() => onTogglePin(msg)}
          title={isPinned ? 'Відкріпити' : 'Закріпити вгорі чату'}
          aria-label={isPinned ? 'Відкріпити' : 'Закріпити повідомлення'}
          className={`p-1 rounded transition-colors cursor-pointer ${
            isPinned
              ? 'text-amber-300 bg-amber-400/15'
              : 'text-parchment hover:text-amber-300 hover:bg-white/10'
          }`}
        >
          {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        </button>
      )}
      {isAdmin && !isOwn && !isAdminMsg && (
        <button
          type="button"
          onClick={() => onToggleMuteMenu(msg.id)}
          title="Обмежити користувача"
          aria-label={`Обмежити ${msg.authorName}`}
          className={`p-1 rounded transition-colors cursor-pointer ${
            showMuteMenu
              ? 'text-amber-300 bg-amber-500/15'
              : 'text-parchment hover:text-amber-300 hover:bg-white/10'
          }`}
        >
          <VolumeX className="w-3.5 h-3.5" />
        </button>
      )}
      {isSignedIn && !isOwn && (
        <button
          type="button"
          onClick={() => onReportMessage(msg)}
          disabled={isReported}
          title={isReported ? 'Скаргу надіслано' : 'Поскаржитись'}
          aria-label={isReported ? 'Скаргу надіслано' : 'Поскаржитись на повідомлення'}
          className={`p-1 rounded transition-colors ${
            isReported
              ? 'text-amber-400/70 cursor-default'
              : 'text-parchment hover:text-amber-300 hover:bg-white/10 cursor-pointer'
          }`}
        >
          <Flag className="w-3 h-3" />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete(msg.id)}
          className={`px-1 py-0.5 rounded transition-colors cursor-pointer ${
            isConfirming
              ? 'bg-red-500 text-white text-[10px] font-semibold px-1.5'
              : 'text-parchment hover:text-red-400'
          }`}
          title={isConfirming ? 'Натисніть ще раз для видалення' : 'Видалити повідомлення'}
          aria-label="Видалити повідомлення"
        >
          {isConfirming ? 'Видалити?' : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );

  const messageCardBody = (
    <div
      id={hasFramedCard ? undefined : `chat-msg-${msg.id}`}
      className={`group flex items-start gap-2.5 transition-colors ${
        hasFramedCard
          ? `p-2.5 sm:p-3 ${innerSurfaceClass}`
          : `${isGrouped ? 'px-2.5 sm:px-3 py-1.5' : 'p-2.5 sm:p-3'} rounded-xl ${
              isOwn && !isAdminMsg ? 'bg-[#303531]' : 'bg-night-card'
            }`
      } ${highlightRingClass}`}
    >
      {hasFramedCard && (
        <>
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute top-1.5 left-1.5 w-2.5 h-2.5 border-t border-l rounded-tl-[5px] ${filigreeCornerColor}`}
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute top-1.5 right-1.5 w-2.5 h-2.5 border-t border-r rounded-tr-[5px] ${filigreeCornerColor}`}
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-1.5 left-1.5 w-2.5 h-2.5 border-b border-l rounded-bl-[5px] ${filigreeCornerColor}`}
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-1.5 right-1.5 w-2.5 h-2.5 border-b border-r rounded-br-[5px] ${filigreeCornerColor}`}
          />
        </>
      )}

      {isGrouped ? (
        <div className="w-7 sm:w-8 shrink-0" aria-hidden="true" />
      ) : (
        <div
          className={`relative z-10 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-night-elevated flex items-center justify-center overflow-hidden text-silver shrink-0 mt-0.5 ${avatarRingClass}`}
        >
          <ChatAvatar photoUrl={msg.authorPhotoUrl} />
        </div>
      )}

      <div className="relative z-10 min-w-0 flex-1 space-y-1">
        {!isGrouped ? (
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-xs font-semibold text-paper truncate max-w-full">
                {msg.authorName}
              </span>
              {!isAdminMsg && <UserRankBadges badges={msg.authorBadges} size="xs" />}
              {isAdminMsg && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-silver text-night font-semibold shrink-0">
                  Адмін
                </span>
              )}
              {isPinned && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-300 font-medium">
                  <Pin className="w-2.5 h-2.5" />
                  закріплено
                </span>
              )}
            </div>
            {actionControls}
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1 -mt-0.5 mb-0.5 opacity-75 sm:opacity-55 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {actionControls}
          </div>
        )}

        {hasDonorCustomText && (
          <p className={`text-[11px] italic leading-snug break-words ${donorCustomTextColorClass}`}>
            {msg.authorDonorText}
          </p>
        )}

        {msg.replyTo && (
          <button
            type="button"
            onClick={() => onJumpToMessage(msg.replyTo!.id)}
            className="w-full text-left px-2.5 py-1.5 rounded-lg bg-black/28 border border-white/10 hover:bg-black/38 transition-colors cursor-pointer"
          >
            <span className="block text-[10px] font-semibold text-paper-stone truncate">
              {msg.replyTo.authorName}
            </span>
            <span className="block text-[11px] text-parchment truncate">
              {msg.replyTo.text}
            </span>
          </button>
        )}

        {isEditing ? (
          <div className="space-y-1.5 pt-0.5">
            <textarea
              value={editingDraft}
              onChange={(e) => onChangeEditDraft(e.target.value.slice(0, 600))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSaveEdit(msg.id);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelEdit();
                }
              }}
              rows={2}
              autoFocus
              className="w-full px-2.5 py-1.5 text-xs sm:text-[13px] rounded-lg bg-night-deep text-paper border border-white/15 focus:outline-none focus:border-silver/60 resize-none"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={onCancelEdit}
                className="px-2 py-1 rounded-lg text-[11px] text-parchment hover:bg-white/10 cursor-pointer"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={() => onSaveEdit(msg.id)}
                disabled={!editingDraft.trim()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-silver text-night text-[11px] font-semibold hover:opacity-95 disabled:opacity-45 cursor-pointer"
              >
                <Check className="w-3 h-3" />
                Зберегти
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs sm:text-[13px] text-cream leading-relaxed break-words whitespace-pre-wrap">
            {renderHighlightedText(msg.text, searchQuery, guestUserDisplayName)}
          </p>
        )}

        {msg.attachment && (
          <button
            type="button"
            onClick={() => onOpenAttachment?.(msg.attachment!)}
            className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl bg-black/30 border border-white/10 hover:border-silver/35 hover:bg-black/45 transition-colors text-left cursor-pointer"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                <AttachmentBadgeIcon type={msg.attachment.type} />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-parchment/80">
                  {getAttachmentTypeLabel(msg.attachment.type)}
                  {msg.attachment.subtitle ? ` · ${msg.attachment.subtitle}` : ''}
                </p>
                <p className="text-xs font-medium text-paper truncate">
                  {msg.attachment.title}
                </p>
              </div>
            </div>
            <span className="text-[10px] font-medium text-silver shrink-0">
              {msg.attachment.type === 'radio' ? 'Слухати →' : 'Відкрити →'}
            </span>
          </button>
        )}

        {/* Quick Reaction Picker */}
        {showReactionPicker && (
          <div className="flex items-center gap-1 pt-1 flex-wrap">
            {CHAT_REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                data-haptic-like="1"
                onClick={() => onToggleReaction(msg.id, emoji)}
                className="px-2 py-0.5 rounded-full bg-night-deep hover:bg-white/15 border border-white/10 text-xs transition-transform active:scale-90 cursor-pointer"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* Quick Mute Options for Admin */}
        {showMuteMenu && isAdmin && (
          <div className="flex items-center gap-1.5 pt-1 flex-wrap text-[11px]">
            <span className="text-parchment/80">Мут:</span>
            <button
              type="button"
              onClick={() => onMuteUser(msg.authorUid, msg.authorName, 15)}
              className="px-2 py-0.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 cursor-pointer"
            >
              15 хв
            </button>
            <button
              type="button"
              onClick={() => onMuteUser(msg.authorUid, msg.authorName, 60)}
              className="px-2 py-0.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 cursor-pointer"
            >
              1 год
            </button>
            <button
              type="button"
              onClick={() => onMuteUser(msg.authorUid, msg.authorName, 0)}
              className="px-2 py-0.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 cursor-pointer"
            >
              Назавжди
            </button>
          </div>
        )}

        {/* Reactions Row */}
        {reactionEntries.length > 0 && (
          <div className="flex items-center gap-1 pt-0.5 flex-wrap">
            {reactionEntries.map(([emoji, users]) => {
              const reactedByMe = Boolean(currentActorUid && users.includes(currentActorUid));
              return (
                <button
                  key={emoji}
                  type="button"
                  data-haptic-like="1"
                  onClick={() => onToggleReaction(msg.id, emoji)}
                  disabled={!isSignedIn}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                    reactedByMe
                      ? 'bg-silver/20 border-silver/50 text-paper'
                      : 'bg-black/25 border-white/10 text-parchment hover:bg-white/10'
                  } ${isSignedIn ? 'cursor-pointer active:scale-95' : 'cursor-default'}`}
                >
                  <span>{emoji}</span>
                  <span className="tabular-nums font-medium">{users.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={isLast ? 'pb-3 sm:pb-4' : nextIsGrouped ? 'pb-1' : 'pb-2.5'}>
      {showDateDivider && (
        <div className="flex items-center gap-2.5 py-2 px-1" aria-label={formatDateDivider(msg.createdAt)}>
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] font-medium text-parchment/85 tracking-wide uppercase">
            {formatDateDivider(msg.createdAt)}
          </span>
          <div className="flex-1 h-px bg-white/10" />
        </div>
      )}
      {hasFramedCard ? (
        <div id={`chat-msg-${msg.id}`} className={outerFrameClass}>
          {messageCardBody}
        </div>
      ) : (
        messageCardBody
      )}
    </div>
  );
});

function ChatMessageRow({
  ariaAttributes,
  index,
  style,
  messages,
  guestUserUid,
  guestUserFirebaseUid,
  guestUserDisplayName,
  isAdmin,
  isSignedIn,
  confirmDeleteId,
  activeReactionPickerId,
  activeMuteMenuId,
  editingMessageId,
  editingDraft,
  reportedMessageIds,
  pinnedMessageId,
  searchQuery,
  activeSearchMatchId,
  highlightedMessageId,
  onReply,
  onDelete,
  onJumpToMessage,
  onToggleReaction,
  onToggleReactionPicker,
  onStartEdit,
  onChangeEditDraft,
  onSaveEdit,
  onCancelEdit,
  onTogglePin,
  onToggleMuteMenu,
  onMuteUser,
  onReportMessage,
  onOpenAttachment,
}: RowComponentProps<ChatMessageRowData>): ReactElement | null {
  const msg = messages[index];
  if (!msg) return null;
  return (
    <div {...ariaAttributes} style={style}>
      <ChatMessageItem
        msg={msg}
        prevMsg={index > 0 ? messages[index - 1] : undefined}
        nextMsg={index < messages.length - 1 ? messages[index + 1] : undefined}
        isFirst={index === 0}
        isLast={index === messages.length - 1}
        guestUserUid={guestUserUid}
        guestUserFirebaseUid={guestUserFirebaseUid}
        guestUserDisplayName={guestUserDisplayName}
        isAdmin={isAdmin}
        isSignedIn={isSignedIn}
        confirmDeleteId={confirmDeleteId}
        activeReactionPickerId={activeReactionPickerId}
        activeMuteMenuId={activeMuteMenuId}
        editingMessageId={editingMessageId}
        editingDraft={editingDraft}
        isReported={reportedMessageIds.has(msg.id)}
        isPinned={pinnedMessageId === msg.id}
        searchQuery={searchQuery}
        isSearchMatchActive={activeSearchMatchId === msg.id}
        isJumpHighlighted={highlightedMessageId === msg.id}
        onReply={onReply}
        onDelete={onDelete}
        onJumpToMessage={onJumpToMessage}
        onToggleReaction={onToggleReaction}
        onToggleReactionPicker={onToggleReactionPicker}
        onStartEdit={onStartEdit}
        onChangeEditDraft={onChangeEditDraft}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
        onTogglePin={onTogglePin}
        onToggleMuteMenu={onToggleMuteMenu}
        onMuteUser={onMuteUser}
        onReportMessage={onReportMessage}
        onOpenAttachment={onOpenAttachment}
      />
    </div>
  );
}

export const GlobalChatModal = memo(function GlobalChatModal({
  isOpen,
  onClose,
  guestUser,
  isAdmin,
  getGuestToken,
  getAdminToken,
  onOpenAuthModal,
  onGuestUserUpdated,
  onOpenAttachment,
}: GlobalChatModalProps) {
  const initialCacheRef = useRef<ReturnType<typeof getCachedGlobalChatState> | null>(null);
  if (!initialCacheRef.current) {
    initialCacheRef.current = getCachedGlobalChatState();
  }

  const catalog = useCatalogStore((s) => s.catalog);
  const allRadioTracks = useAllRadioTracks();

  const [messages, setMessages] = useState<GlobalChatMessage[]>(
    () => initialCacheRef.current?.messages || []
  );
  const [chatMeta, setChatMeta] = useState<ChatMetaState>(
    () =>
      initialCacheRef.current?.chatMeta || {
        pinnedMessage: null,
        slowModeSeconds: 0,
      }
  );
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);
  const [isNearTop, setIsNearTop] = useState(false);
  const [myMute, setMyMute] = useState<ChatMutedUserEntry | null>(null);
  const [mutedUsers, setMutedUsers] = useState<Record<string, ChatMutedUserEntry>>({});
  const [reports, setReports] = useState<ChatReportRecord[]>([]);
  const [unresolvedReportsCount, setUnresolvedReportsCount] = useState(0);

  const [onlineCount, setOnlineCount] = useState<number>(1);
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [firestoreConnected, setFirestoreConnected] = useState<boolean>(false);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(
    () => (initialCacheRef.current?.messages.length || 0) === 0
  );
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<GlobalChatMessage | null>(null);
  const [selectedAttachment, setSelectedAttachment] = useState<ChatMessageAttachment | null>(null);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [attachmentTab, setAttachmentTab] = useState<ChatAttachmentType>('poem');
  const [attachmentSearch, setAttachmentSearch] = useState('');

  const [activeReactionPickerId, setActiveReactionPickerId] = useState<string | null>(null);
  const [activeMuteMenuId, setActiveMuteMenuId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [reportedMessageIds, setReportedMessageIds] = useState<Set<string>>(() => new Set());

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchCursor, setSearchMatchCursor] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const [moderationPanelOpen, setModerationPanelOpen] = useState(false);
  const [confirmClearChat, setConfirmClearChat] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
  const [pinnedExpanded, setPinnedExpanded] = useState(false);

  const [typingUsers, setTypingUsers] = useState<Record<string, { displayName: string; expiresAt: number }>>({});
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);
  const [slowModeCooldownSec, setSlowModeCooldownSec] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);

  const [liveBadges, setLiveBadges] = useState<UserTopBadges | undefined>(guestUser?.badges);
  const [donorTextDraft, setDonorTextDraft] = useState(guestUser?.donorChatText || '');
  const [savedDonorText, setSavedDonorText] = useState(guestUser?.donorChatText || '');
  const [savingDonorText, setSavingDonorText] = useState(false);
  const [donorTextSavedFlash, setDonorTextSavedFlash] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const fallbackPollRef = useRef<number | null>(null);
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingEmitMsRef = useRef<number>(0);
  const isTypingActiveRef = useRef<boolean>(false);
  const highlightTimerRef = useRef<number | null>(null);
  const pendingSendTimersRef = useRef<Map<string, number>>(new Map());
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const firestoreKnownIdsRef = useRef<Set<string>>(new Set());
  const serverHasMoreRef = useRef(false);
  const firestoreHasMoreRef = useRef(false);
  const pendingHistoryAnchorIdRef = useRef<string | null>(null);
  const chatMetaRef = useRef<ChatMetaState>(chatMeta);
  chatMetaRef.current = chatMeta;
  const authorMetaByUidRef = useRef<Record<string, ChatAuthorMeta>>(
    initialCacheRef.current?.authorMetaByUid || {}
  );
  const listRef = useRef<ListImperativeAPI | null>(null);
  const messagesCountRef = useRef(messages.length);
  messagesCountRef.current = messages.length;
  const messagesRefSnapshot = useRef(messages);
  messagesRefSnapshot.current = messages;
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: 88,
    key: `${isOpen ? 'open' : 'closed'}-${messages[0]?.id ?? 'empty'}`,
  });
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const guestUserRef = useRef(guestUser);
  guestUserRef.current = guestUser;
  const getGuestTokenRef = useRef(getGuestToken);
  getGuestTokenRef.current = getGuestToken;
  const getAdminTokenRef = useRef(getAdminToken);
  getAdminTokenRef.current = getAdminToken;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const scrollToBottom = useCallback(
    (smooth = false) => {
      const api = listRef.current;
      const count = messagesCountRef.current;
      if (!api || count <= 0) return;
      shouldAutoScrollRef.current = true;
      setIsScrolledUp(false);
      setUnreadWhileScrolled(0);
      api.scrollToRow({
        index: count - 1,
        align: 'end',
        behavior: smooth ? 'smooth' : 'auto',
      });
    },
    [listRef]
  );

  const scrollToBottomRef = useRef(scrollToBottom);
  scrollToBottomRef.current = scrollToBottom;

  const resolveToken = useCallback(async (preferAdmin = false): Promise<string | null> => {
    if (preferAdmin && getAdminTokenRef.current) {
      const adminToken = await getAdminTokenRef.current().catch(() => null);
      if (adminToken) return adminToken;
    }
    return getGuestTokenRef.current().catch(() => null);
  }, []);

  const syncAuthOnSocket = useCallback(async (socket: WebSocket) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      const token = await getGuestTokenRef.current();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'auth', token: token || '' }));
      }
    } catch {
      // Ignore auth sync failure
    }
  }, []);

  const syncAuthOnSocketRef = useRef(syncAuthOnSocket);
  syncAuthOnSocketRef.current = syncAuthOnSocket;

  const clearPendingTimer = useCallback((clientMessageId?: string) => {
    if (!clientMessageId) return;
    const timer = pendingSendTimersRef.current.get(clientMessageId);
    if (timer) {
      window.clearTimeout(timer);
      pendingSendTimersRef.current.delete(clientMessageId);
    }
  }, []);

  const mergeIncomingMessages = useCallback(
    (
      incomingList: GlobalChatMessage[],
      mode: 'merge' | 'authoritative' | 'firestore' | 'server-full' = 'merge'
    ) => {
      const metaMap = authorMetaByUidRef.current;
      for (const msg of incomingList) {
        if (!msg.authorUid) continue;
        const prevMeta = metaMap[msg.authorUid] || {};
        if (msg.authorBadges || msg.authorDonorText || msg.authorPhotoUrl) {
          metaMap[msg.authorUid] = {
            badges: msg.authorBadges ?? prevMeta.badges,
            donorText: msg.authorDonorText ?? prevMeta.donorText,
            photoUrl: msg.authorPhotoUrl ?? prevMeta.photoUrl,
          };
        }
      }

      const enrichWithMeta = (msg: GlobalChatMessage): GlobalChatMessage => {
        const meta = metaMap[msg.authorUid];
        if (!meta) return msg;
        const resolvedBadges = msg.authorBadges || meta.badges;
        const resolvedDonorText =
          resolvedBadges?.donorRank && resolvedBadges.donorRank <= 3
            ? msg.authorDonorText || meta.donorText
            : undefined;
        const resolvedPhoto = msg.authorPhotoUrl || meta.photoUrl;
        if (
          resolvedBadges === msg.authorBadges &&
          resolvedDonorText === msg.authorDonorText &&
          resolvedPhoto === msg.authorPhotoUrl
        ) {
          return msg;
        }
        return {
          ...msg,
          ...(resolvedPhoto ? { authorPhotoUrl: resolvedPhoto } : {}),
          ...(resolvedBadges ? { authorBadges: resolvedBadges } : {}),
          ...(resolvedDonorText ? { authorDonorText: resolvedDonorText } : {}),
        };
      };

      setMessages((prev) => {
        const byId = new Map<string, GlobalChatMessage>();
        if (mode === 'merge') {
          for (const existing of prev) {
            if (!deletedIdsRef.current.has(existing.id)) {
              byId.set(existing.id, enrichWithMeta(existing));
            }
          }
        } else if (mode === 'server-full') {
          const incomingIds = new Set(incomingList.map((m) => m.id));
          for (const existing of prev) {
            if (deletedIdsRef.current.has(existing.id)) continue;
            if (
              pendingIdsRef.current.has(existing.id) ||
              firestoreKnownIdsRef.current.has(existing.id) ||
              incomingIds.has(existing.id)
            ) {
              byId.set(existing.id, enrichWithMeta(existing));
            }
          }
        } else if (mode === 'firestore') {
          const incomingIds = new Set(incomingList.map((m) => m.id));
          const isWindowTruncated = incomingList.length >= 100;
          const oldestIncomingMs =
            isWindowTruncated && incomingList.length > 0
              ? Date.parse(incomingList[0].createdAt) || 0
              : Infinity;

          for (const existing of prev) {
            if (deletedIdsRef.current.has(existing.id)) continue;
            const isPending = pendingIdsRef.current.has(existing.id);
            const inWindow = incomingIds.has(existing.id);
            const existingMs = Date.parse(existing.createdAt) || 0;
            const olderThanWindow = isWindowTruncated && existingMs < oldestIncomingMs;
            // Preserve non-Firestore messages (e.g. PIN guest / SQLite history) alongside Firestore updates
            const notOwnedByFirestoreSnapshot = !firestoreKnownIdsRef.current.has(existing.id);
            if (isPending || inWindow || olderThanWindow || notOwnedByFirestoreSnapshot) {
              byId.set(existing.id, enrichWithMeta(existing));
            }
          }

          for (const knownId of Array.from(firestoreKnownIdsRef.current)) {
            if (incomingIds.has(knownId)) continue;
            const prevEntry = prev.find((p) => p.id === knownId);
            const prevMs = prevEntry ? Date.parse(prevEntry.createdAt) || 0 : 0;
            if (!isWindowTruncated || prevMs >= oldestIncomingMs) {
              firestoreKnownIdsRef.current.delete(knownId);
            }
          }
          for (const id of incomingIds) {
            firestoreKnownIdsRef.current.add(id);
          }
        } else {
          for (const existing of prev) {
            if (
              !deletedIdsRef.current.has(existing.id) &&
              pendingIdsRef.current.has(existing.id)
            ) {
              byId.set(existing.id, enrichWithMeta(existing));
            }
          }
        }

        for (const rawMsg of incomingList) {
          if (!rawMsg?.id || deletedIdsRef.current.has(rawMsg.id)) continue;
          const prevEntry = prev.find((p) => p.id === rawMsg.id) || byId.get(rawMsg.id);
          const preserveFirestoreExtras = mode === 'firestore' && prevEntry;
          const mergedText =
            preserveFirestoreExtras && prevEntry.editedAt && !rawMsg.editedAt
              ? prevEntry.text
              : rawMsg.text;
          const mergedEditedAt =
            rawMsg.editedAt ?? (preserveFirestoreExtras ? prevEntry.editedAt : undefined);
          const mergedReactions =
            rawMsg.reactions ?? (preserveFirestoreExtras ? prevEntry.reactions : undefined);
          const mergedAttachment =
            rawMsg.attachment ?? prevEntry?.attachment;

          const merged: GlobalChatMessage = enrichWithMeta({
            ...rawMsg,
            text: mergedText,
            ...(mergedEditedAt ? { editedAt: mergedEditedAt } : {}),
            ...(mergedReactions && Object.keys(mergedReactions).length > 0
              ? { reactions: mergedReactions }
              : {}),
            ...(mergedAttachment ? { attachment: mergedAttachment } : {}),
            ...(rawMsg.authorPhotoUrl || prevEntry?.authorPhotoUrl
              ? { authorPhotoUrl: rawMsg.authorPhotoUrl || prevEntry?.authorPhotoUrl }
              : {}),
            ...(rawMsg.authorBadges || prevEntry?.authorBadges
              ? { authorBadges: rawMsg.authorBadges || prevEntry?.authorBadges }
              : {}),
            ...(rawMsg.authorDonorText || prevEntry?.authorDonorText
              ? { authorDonorText: rawMsg.authorDonorText || prevEntry?.authorDonorText }
              : {}),
          });
          byId.set(rawMsg.id, merged);
          pendingIdsRef.current.delete(rawMsg.id);
        }

        const sorted = Array.from(byId.values())
          .sort((a, b) => {
            const ta = Date.parse(a.createdAt) || 0;
            const tb = Date.parse(b.createdAt) || 0;
            if (ta !== tb) return ta - tb;
            return a.id.localeCompare(b.id);
          })
          .slice(-1000);

        saveCachedGlobalChatState(sorted, metaMap, chatMetaRef.current);
        return sorted;
      });
    },
    []
  );

  const mergeIncomingMessagesRef = useRef(mergeIncomingMessages);
  mergeIncomingMessagesRef.current = mergeIncomingMessages;

  useEffect(() => {
    prewarmChatFirestore();
  }, []);

  // Expire typing indicators automatically
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTypingUsers((prev) => {
        let changed = false;
        const next: Record<string, { displayName: string; expiresAt: number }> = {};
        for (const [uid, entry] of Object.entries(prev)) {
          if (entry.expiresAt > now) {
            next[uid] = entry;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 800);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  // Countdown slow mode timer
  useEffect(() => {
    if (!isOpen || slowModeCooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      setSlowModeCooldownSec((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, slowModeCooldownSec]);

  useEffect(() => {
    if (!isOpen) {
      setConfirmDeleteId(null);
      setReplyingTo(null);
      setActiveReactionPickerId(null);
      setActiveMuteMenuId(null);
      setEditingMessageId(null);
      setAttachmentPickerOpen(false);
      setSearchOpen(false);
      setSearchQuery('');
      setModerationPanelOpen(false);
      setConfirmClearChat(false);
      setTypingUsers({});
      setFirestoreConnected(false);
      for (const timer of pendingSendTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      pendingSendTimersRef.current.clear();
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }
      return;
    }

    let unmounted = false;
    let attempt = 0;
    let unsubscribeFirestore: () => void = () => {};
    shouldAutoScrollRef.current = true;
    setIsScrolledUp(false);
    setIsNearTop(false);
    setUnreadWhileScrolled(0);
    setError(null);
    prewarmChatFirestore();

    void subscribeGlobalChatMessages({
      limitCount: 100,
      onConnected: () => {
        if (!unmounted) {
          setFirestoreConnected(true);
          setLoadingInitial(false);
        }
      },
      onMessages: (fsMessages) => {
        if (unmounted) return;
        setLoadingInitial(false);
        firestoreHasMoreRef.current = fsMessages.length >= 100;
        setHasMoreHistory(serverHasMoreRef.current || firestoreHasMoreRef.current);
        mergeIncomingMessagesRef.current(fsMessages, 'firestore');
        if (shouldAutoScrollRef.current) {
          window.requestAnimationFrame(() => scrollToBottomRef.current(false));
        }
      },
      onError: () => {
        if (!unmounted) {
          setFirestoreConnected(false);
        }
      },
    }).then((unsub) => {
      if (unmounted) {
        unsub();
      } else {
        unsubscribeFirestore = unsub;
      }
    });

    const fetchSnapshot = async () => {
      try {
        const headers: Record<string, string> = {};
        const token = await getGuestTokenRef.current().catch(() => null);
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/chat/messages', { headers });
        if (!res.ok) return;
        const json = (await res.json()) as {
          messages?: GlobalChatMessage[];
          hasMore?: boolean;
          onlineCount?: number;
          chatMeta?: ChatMetaState;
          currentUserBadges?: UserTopBadges;
          currentUserDonorText?: string;
          myMute?: ChatMutedUserEntry | null;
          mutedUsers?: Record<string, ChatMutedUserEntry>;
          unresolvedReportsCount?: number;
        };
        if (unmounted) return;
        serverHasMoreRef.current = Boolean(json.hasMore);
        setHasMoreHistory(serverHasMoreRef.current || firestoreHasMoreRef.current);
        if (Array.isArray(json.messages)) {
          mergeIncomingMessagesRef.current(json.messages, json.hasMore ? 'merge' : 'server-full');
        }
        if (json.chatMeta) {
          setChatMeta(json.chatMeta);
          saveCachedGlobalChatState(messagesRefSnapshot.current, authorMetaByUidRef.current, json.chatMeta);
        }
        if (typeof json.onlineCount === 'number') {
          setOnlineCount(Math.max(1, json.onlineCount));
        }
        if (json.currentUserBadges !== undefined) {
          setLiveBadges(json.currentUserBadges);
        }
        if (typeof json.currentUserDonorText === 'string') {
          setSavedDonorText(json.currentUserDonorText);
          setDonorTextDraft(json.currentUserDonorText);
        }
        if (json.myMute !== undefined) {
          setMyMute(json.myMute);
        }
        if (json.mutedUsers) {
          setMutedUsers(json.mutedUsers);
        }
        if (typeof json.unresolvedReportsCount === 'number') {
          setUnresolvedReportsCount(json.unresolvedReportsCount);
        }
      } catch {
        // Firestore onSnapshot and WebSocket hydrate state
      } finally {
        if (!unmounted) {
          setLoadingInitial(false);
          window.requestAnimationFrame(() => scrollToBottomRef.current(false));
        }
      }
    };

    void fetchSnapshot();

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/chat`;
      setWsStatus(attempt === 0 ? 'connecting' : 'reconnecting');

      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (unmounted) {
          socket.close();
          return;
        }
        attempt = 0;
        setWsStatus('connected');
        void syncAuthOnSocketRef.current(socket);

        if (pingTimerRef.current) {
          window.clearInterval(pingTimerRef.current);
        }
        pingTimerRef.current = window.setInterval(() => {
          if (document.visibilityState === 'hidden') return;
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      socket.onmessage = (event) => {
        if (unmounted) return;
        try {
          const payload = JSON.parse(event.data as string) as {
            type?: string;
            messages?: GlobalChatMessage[];
            hasMore?: boolean;
            message?: GlobalChatMessage;
            chatMeta?: ChatMetaState;
            clientMessageId?: string;
            id?: string;
            reactions?: Record<string, string[]>;
            uid?: string;
            displayName?: string;
            isTyping?: boolean;
            onlineCount?: number;
            badges?: UserTopBadges;
            donorChatText?: string;
            authenticated?: boolean;
            myMute?: ChatMutedUserEntry | null;
            mutedUsers?: Record<string, ChatMutedUserEntry>;
            unresolvedReportsCount?: number;
            unresolvedCount?: number;
            retryAfterSec?: number;
            error?: string;
          };

          if (payload.type === 'chat:init') {
            serverHasMoreRef.current = Boolean(payload.hasMore);
            setHasMoreHistory(serverHasMoreRef.current || firestoreHasMoreRef.current);
            if (Array.isArray(payload.messages)) {
              mergeIncomingMessagesRef.current(
                payload.messages,
                payload.hasMore ? 'merge' : 'server-full'
              );
              setLoadingInitial(false);
              window.requestAnimationFrame(() => scrollToBottomRef.current(false));
            }
            if (payload.chatMeta) {
              setChatMeta(payload.chatMeta);
              saveCachedGlobalChatState(messagesRefSnapshot.current, authorMetaByUidRef.current, payload.chatMeta);
            }
            if (typeof payload.onlineCount === 'number') {
              setOnlineCount(Math.max(1, payload.onlineCount));
            }
            return;
          }

          if (payload.type === 'chat:refresh' && Array.isArray(payload.messages)) {
            serverHasMoreRef.current = Boolean(payload.hasMore);
            setHasMoreHistory(serverHasMoreRef.current || firestoreHasMoreRef.current);
            mergeIncomingMessagesRef.current(
              payload.messages,
              payload.hasMore ? 'merge' : 'server-full'
            );
            if (payload.chatMeta) {
              setChatMeta(payload.chatMeta);
              saveCachedGlobalChatState(messagesRefSnapshot.current, authorMetaByUidRef.current, payload.chatMeta);
            }
            return;
          }

          if (payload.type === 'chat:cleared') {
            deletedIdsRef.current.clear();
            firestoreKnownIdsRef.current.clear();
            pendingIdsRef.current.clear();
            for (const timer of pendingSendTimersRef.current.values()) {
              window.clearTimeout(timer);
            }
            pendingSendTimersRef.current.clear();
            serverHasMoreRef.current = false;
            firestoreHasMoreRef.current = false;
            setHasMoreHistory(false);
            setMessages([]);
            setIsScrolledUp(false);
            setIsNearTop(false);
            setUnreadWhileScrolled(0);
            setReplyingTo(null);
            setEditingMessageId(null);
            setConfirmDeleteId(null);
            setReports([]);
            setUnresolvedReportsCount(0);
            const nextMeta: ChatMetaState = payload.chatMeta || {
              pinnedMessage: null,
              slowModeSeconds: chatMetaRef.current.slowModeSeconds || 0,
            };
            setChatMeta(nextMeta);
            clearCachedGlobalChatState(nextMeta);
            return;
          }

          if (payload.type === 'chat:meta' && payload.chatMeta) {
            setChatMeta(payload.chatMeta);
            saveCachedGlobalChatState(messagesRefSnapshot.current, authorMetaByUidRef.current, payload.chatMeta);
            return;
          }

          if (payload.type === 'chat:self-mute') {
            setMyMute(payload.myMute ?? null);
            return;
          }

          if (payload.type === 'chat:reports-updated' && typeof payload.unresolvedCount === 'number') {
            setUnresolvedReportsCount(payload.unresolvedCount);
            return;
          }

          if (payload.type === 'chat:auth') {
            if (payload.authenticated) {
              setLiveBadges(payload.badges);
              if (typeof payload.donorChatText === 'string') {
                setSavedDonorText(payload.donorChatText);
                setDonorTextDraft(payload.donorChatText);
              }
              if (payload.myMute !== undefined) {
                setMyMute(payload.myMute);
              }
              if (payload.mutedUsers) {
                setMutedUsers(payload.mutedUsers);
              }
              if (typeof payload.unresolvedReportsCount === 'number') {
                setUnresolvedReportsCount(payload.unresolvedReportsCount);
              }
            } else {
              setLiveBadges(undefined);
              setMyMute(null);
            }
            return;
          }

          if (payload.type === 'chat:presence' && typeof payload.onlineCount === 'number') {
            setOnlineCount(Math.max(1, payload.onlineCount));
            return;
          }

          if (payload.type === 'chat:typing' && payload.uid) {
            const currentUid = guestUserRef.current?.firebaseUid || guestUserRef.current?.uid;
            if (payload.uid === currentUid || payload.uid === guestUserRef.current?.uid) return;
            const tUid = payload.uid;
            if (payload.isTyping && payload.displayName) {
              setTypingUsers((prev) => ({
                ...prev,
                [tUid]: { displayName: payload.displayName!, expiresAt: Date.now() + 3500 },
              }));
            } else {
              setTypingUsers((prev) => {
                if (!(tUid in prev)) return prev;
                const next = { ...prev };
                delete next[tUid];
                return next;
              });
            }
            return;
          }

          if (payload.type === 'chat:message' && payload.message) {
            const incoming = payload.message;
            const clientId = payload.clientMessageId;
            clearPendingTimer(clientId);
            clearPendingTimer(incoming.id);
            pendingIdsRef.current.delete(incoming.id);
            if (clientId) pendingIdsRef.current.delete(clientId);

            // Clear typing indicator for sender
            setTypingUsers((prev) => {
              if (!(incoming.authorUid in prev)) return prev;
              const next = { ...prev };
              delete next[incoming.authorUid];
              return next;
            });

            mergeIncomingMessagesRef.current([incoming], 'merge');
            setError(null);
            if (shouldAutoScrollRef.current) {
              window.requestAnimationFrame(() => scrollToBottomRef.current(true));
            } else {
              const myUid = guestUserRef.current?.uid;
              const myFbUid = guestUserRef.current?.firebaseUid;
              const fromMe = incoming.authorUid === myUid || (myFbUid && incoming.authorUid === myFbUid);
              if (!fromMe) {
                setUnreadWhileScrolled((c) => c + 1);
              }
            }
            return;
          }

          if (payload.type === 'chat:edited' && payload.message) {
            mergeIncomingMessagesRef.current([payload.message], 'merge');
            return;
          }

          if (payload.type === 'chat:reacted' && payload.id) {
            const targetId = payload.id;
            const nextReactions = payload.reactions || {};
            setMessages((prev) => {
              const next = prev.map((m) =>
                m.id === targetId
                  ? {
                      ...m,
                      ...(Object.keys(nextReactions).length > 0
                        ? { reactions: nextReactions }
                        : { reactions: undefined }),
                    }
                  : m
              );
              saveCachedGlobalChatState(next, authorMetaByUidRef.current);
              return next;
            });
            return;
          }

          if (payload.type === 'chat:deleted' && payload.id) {
            const deletedId = payload.id;
            deletedIdsRef.current.add(deletedId);
            pendingIdsRef.current.delete(deletedId);
            setMessages((prev) => {
              const next = prev.filter((m) => m.id !== deletedId);
              saveCachedGlobalChatState(next, authorMetaByUidRef.current);
              return next;
            });
            return;
          }

          if (payload.type === 'chat:error' && payload.error) {
            if (payload.clientMessageId) {
              clearPendingTimer(payload.clientMessageId);
              pendingIdsRef.current.delete(payload.clientMessageId);
              setMessages((prev) => prev.filter((m) => m.id !== payload.clientMessageId));
            }
            if (typeof payload.retryAfterSec === 'number' && payload.retryAfterSec > 0) {
              setSlowModeCooldownSec(payload.retryAfterSec);
            }
            setError(payload.error);
          }
        } catch {
          // Ignore malformed frame
        }
      };

      socket.onclose = () => {
        if (pingTimerRef.current) {
          window.clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        if (unmounted) return;
        setWsStatus('reconnecting');
        attempt += 1;
        const delayMs = Math.min(6000, 700 * Math.pow(1.5, Math.min(attempt, 5)));
        reconnectTimerRef.current = window.setTimeout(connect, delayMs);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingMessageId) {
          setEditingMessageId(null);
          return;
        }
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unmounted = true;
      unsubscribeFirestore();
      window.removeEventListener('keydown', handleKeyDown);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (fallbackPollRef.current) {
        window.clearInterval(fallbackPollRef.current);
        fallbackPollRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isOpen, clearPendingTimer]);

  // Fallback HTTP poll ONLY when BOTH WebSocket and Firestore real-time listener are disconnected
  useEffect(() => {
    if (!isOpen || wsStatus === 'connected' || firestoreConnected) return;
    const poll = async () => {
      try {
        const headers: Record<string, string> = {};
        const token = await getGuestTokenRef.current().catch(() => null);
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/chat/messages', { headers });
        if (!res.ok) return;
        const json = (await res.json()) as {
          messages?: GlobalChatMessage[];
          onlineCount?: number;
          chatMeta?: ChatMetaState;
          myMute?: ChatMutedUserEntry | null;
        };
        if (Array.isArray(json.messages)) {
          mergeIncomingMessagesRef.current(json.messages, 'merge');
        }
        if (json.chatMeta) setChatMeta(json.chatMeta);
        if (json.myMute !== undefined) setMyMute(json.myMute);
        if (typeof json.onlineCount === 'number') {
          setOnlineCount(Math.max(1, json.onlineCount));
        }
      } catch {
        // Ignore poll failure
      }
    };
    const timer = window.setInterval(() => {
      void poll();
    }, 3500);
    return () => window.clearInterval(timer);
  }, [isOpen, wsStatus, firestoreConnected]);

  // Sync local donor badge/text when guestUser changes
  useEffect(() => {
    setLiveBadges(guestUser?.badges);
    setDonorTextDraft(guestUser?.donorChatText || '');
    setSavedDonorText(guestUser?.donorChatText || '');
    const uids = [guestUser?.firebaseUid, guestUser?.uid].filter((v): v is string => Boolean(v));
    for (const uid of uids) {
      authorMetaByUidRef.current[uid] = {
        badges: guestUser?.badges ?? authorMetaByUidRef.current[uid]?.badges,
        donorText: guestUser?.donorChatText ?? authorMetaByUidRef.current[uid]?.donorText,
        photoUrl: guestUser?.photoUrl ?? authorMetaByUidRef.current[uid]?.photoUrl,
      };
    }
  }, [guestUser?.uid, guestUser?.firebaseUid, guestUser?.badges, guestUser?.donorChatText, guestUser?.photoUrl]);

  // Re-authenticate active WebSocket whenever guestUser changes
  useEffect(() => {
    if (!isOpen || !wsRef.current) return;
    void syncAuthOnSocketRef.current(wsRef.current);
  }, [guestUser?.uid, isOpen]);

  // Load admin moderation details when panel opens
  const loadAdminModeration = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const token = await resolveToken(true);
      if (!token) return;
      const res = await fetch('/api/chat/moderation', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        chatMeta?: ChatMetaState;
        mutedUsers?: Record<string, ChatMutedUserEntry>;
        reports?: ChatReportRecord[];
        unresolvedReportsCount?: number;
      };
      if (data.chatMeta) setChatMeta(data.chatMeta);
      if (data.mutedUsers) setMutedUsers(data.mutedUsers);
      if (Array.isArray(data.reports)) setReports(data.reports);
      if (typeof data.unresolvedReportsCount === 'number') {
        setUnresolvedReportsCount(data.unresolvedReportsCount);
      }
    } catch {
      // Ignore moderation fetch errors
    }
  }, [isAdmin, resolveToken]);

  useEffect(() => {
    if (isOpen && moderationPanelOpen && isAdmin) {
      void loadAdminModeration();
    }
  }, [isOpen, moderationPanelOpen, isAdmin, loadAdminModeration]);

  const handleScroll = useCallback(() => {
    const el = listRef.current?.element;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom < 80;
    const nearTop = el.scrollTop <= 72;
    shouldAutoScrollRef.current = nearBottom;
    setIsScrolledUp(!nearBottom);
    setIsNearTop(nearTop);
    if (nearBottom) {
      setUnreadWhileScrolled(0);
    }
  }, [listRef]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (loadingOlderHistory || messages.length === 0) return;
    const oldestMsg = messages[0];
    if (!oldestMsg?.createdAt) return;

    setLoadingOlderHistory(true);
    shouldAutoScrollRef.current = false;
    pendingHistoryAnchorIdRef.current = oldestMsg.id;

    try {
      const token = await getGuestTokenRef.current().catch(() => null);
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const [serverRes, fsResult] = await Promise.all([
        fetch(
          `/api/chat/messages?before=${encodeURIComponent(oldestMsg.createdAt)}&limit=80`,
          { headers }
        )
          .then(async (r) => {
            if (!r.ok) return null;
            return (await r.json()) as {
              messages?: GlobalChatMessage[];
              hasMore?: boolean;
            };
          })
          .catch(() => null),
        fetchOlderGlobalChatMessagesFromFirestore({
          beforeCreatedAt: oldestMsg.createdAt,
          limitCount: 80,
        }).catch(() => ({ messages: [] as GlobalChatMessage[], hasMore: false })),
      ]);

      const combinedOlder: GlobalChatMessage[] = [
        ...(Array.isArray(serverRes?.messages) ? serverRes.messages : []),
        ...(Array.isArray(fsResult?.messages) ? fsResult.messages : []),
      ];

      if (fsResult?.messages?.length) {
        for (const m of fsResult.messages) {
          firestoreKnownIdsRef.current.add(m.id);
        }
      }

      if (combinedOlder.length > 0) {
        mergeIncomingMessagesRef.current(combinedOlder, 'merge');
      } else {
        pendingHistoryAnchorIdRef.current = null;
      }

      serverHasMoreRef.current = Boolean(serverRes?.hasMore);
      firestoreHasMoreRef.current = Boolean(fsResult?.hasMore);
      setHasMoreHistory(serverHasMoreRef.current || firestoreHasMoreRef.current);
    } catch {
      pendingHistoryAnchorIdRef.current = null;
    } finally {
      setLoadingOlderHistory(false);
    }
  }, [loadingOlderHistory, messages]);

  const handleJumpToMessage = useCallback(
    (targetId: string) => {
      const targetIndex = messages.findIndex((m) => m.id === targetId);
      if (targetIndex >= 0 && listRef.current) {
        shouldAutoScrollRef.current = false;
        listRef.current.scrollToRow({
          index: targetIndex,
          align: 'center',
          behavior: 'smooth',
        });
        setHighlightedMessageId(targetId);
        if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = window.setTimeout(() => {
          setHighlightedMessageId(null);
        }, 1800);
      }
    },
    [listRef, messages]
  );

  useEffect(() => {
    if (!isOpen || messages.length === 0) return;
    if (pendingHistoryAnchorIdRef.current) {
      const anchorId = pendingHistoryAnchorIdRef.current;
      pendingHistoryAnchorIdRef.current = null;
      const anchorIdx = messages.findIndex((m) => m.id === anchorId);
      if (anchorIdx > 0 && listRef.current) {
        const frameId = window.requestAnimationFrame(() => {
          listRef.current?.scrollToRow({
            index: anchorIdx,
            align: 'start',
            behavior: 'auto',
          });
        });
        return () => window.cancelAnimationFrame(frameId);
      }
      return;
    }
    if (!shouldAutoScrollRef.current) return;
    const frameId = window.requestAnimationFrame(() => {
      scrollToBottomRef.current(false);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen, messages, messages.length]);

  // Search matches
  const searchMatchIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter(
        (m) =>
          m.text.toLowerCase().includes(q) ||
          m.authorName.toLowerCase().includes(q) ||
          Boolean(m.attachment?.title.toLowerCase().includes(q))
      )
      .map((m) => m.id);
  }, [messages, searchQuery]);

  const activeSearchMatchId =
    searchMatchIds.length > 0
      ? searchMatchIds[Math.min(searchMatchCursor, searchMatchIds.length - 1)]
      : null;

  useEffect(() => {
    setSearchMatchCursor(searchMatchIds.length > 0 ? searchMatchIds.length - 1 : 0);
  }, [searchQuery, searchMatchIds.length]);

  const jumpToSearchMatch = useCallback(
    (direction: -1 | 1) => {
      if (searchMatchIds.length === 0) return;
      const nextCursor =
        (searchMatchCursor + direction + searchMatchIds.length) % searchMatchIds.length;
      setSearchMatchCursor(nextCursor);
      handleJumpToMessage(searchMatchIds[nextCursor]);
    },
    [handleJumpToMessage, searchMatchCursor, searchMatchIds]
  );

  // Recent participants for @mention autocomplete
  const mentionQueryInfo = useMemo(() => {
    const match = draft.match(/(?:^|\s)@([^\s@]{0,24})$/);
    if (!match) return null;
    return match[1].toLowerCase();
  }, [draft]);

  const mentionSuggestions = useMemo(() => {
    if (mentionQueryInfo === null) return [];
    const seen = new Set<string>();
    const list: Array<{ uid: string; name: string; photoUrl?: string }> = [];
    const myUid = guestUser?.uid;
    const myFbUid = guestUser?.firebaseUid;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m.authorUid || !m.authorName) continue;
      if (m.authorUid === myUid || (myFbUid && m.authorUid === myFbUid)) continue;
      const key = m.authorName.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!mentionQueryInfo || key.includes(mentionQueryInfo)) {
        list.push({ uid: m.authorUid, name: m.authorName.trim(), photoUrl: m.authorPhotoUrl });
      }
      if (list.length >= 6) break;
    }
    return list;
  }, [guestUser?.firebaseUid, guestUser?.uid, mentionQueryInfo, messages]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionSuggestions.length, mentionQueryInfo]);

  const applyMentionSuggestion = useCallback((name: string) => {
    setDraft((prev) => prev.replace(/(^|\s)@([^\s@]{0,24})$/, `$1@${name} `).slice(0, 600));
    inputRef.current?.focus();
  }, []);

  // Attachment picker filtered options
  const attachmentOptions = useMemo(() => {
    const q = attachmentSearch.trim().toLowerCase();
    if (attachmentTab === 'poem') {
      return (catalog?.poems ?? [])
        .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.cycle || '').toLowerCase().includes(q))
        .slice(0, 20)
        .map((p) => ({
          type: 'poem' as const,
          id: p.id,
          title: p.title,
          subtitle: p.cycle || (p.year ? String(p.year) : 'Поезія'),
        }));
    }
    if (attachmentTab === 'prose') {
      return (catalog?.prose ?? [])
        .filter((w) => !q || w.title.toLowerCase().includes(q) || (w.genre || '').toLowerCase().includes(q))
        .slice(0, 20)
        .map((w) => ({
          type: 'prose' as const,
          id: w.id,
          title: w.title,
          subtitle: w.genre || 'Проза',
        }));
    }
    return allRadioTracks
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
      .slice(0, 20)
      .map((t) => ({
        type: 'radio' as const,
        id: t.id,
        title: t.title,
        subtitle: t.artist || 'Радіо',
      }));
  }, [allRadioTracks, attachmentSearch, attachmentTab, catalog?.poems, catalog?.prose]);

  const emitTypingState = useCallback((isTyping: boolean) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!guestUserRef.current) return;
    const now = Date.now();
    if (isTyping && isTypingActiveRef.current && now - lastTypingEmitMsRef.current < 1500) {
      return;
    }
    isTypingActiveRef.current = isTyping;
    lastTypingEmitMsRef.current = now;
    socket.send(JSON.stringify({ type: 'chat:typing', isTyping }));
  }, []);

  const handleDraftChange = useCallback(
    (nextVal: string) => {
      const clamped = nextVal.slice(0, 600);
      setDraft(clamped);
      if (clamped.trim().length > 0) {
        emitTypingState(true);
        if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = window.setTimeout(() => {
          emitTypingState(false);
        }, 2500);
      } else {
        if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
        emitTypingState(false);
      }
    },
    [emitTypingState]
  );

  const handleReplyMessage = useCallback(
    (msg: GlobalChatMessage) => {
      if (!guestUser) {
        onClose();
        onOpenAuthModal();
        return;
      }
      setReplyingTo(msg);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    },
    [guestUser, onClose, onOpenAuthModal]
  );

  const handleToggleReactionPicker = useCallback((id: string) => {
    setActiveReactionPickerId((prev) => (prev === id ? null : id));
    setActiveMuteMenuId(null);
  }, []);

  const handleToggleMuteMenu = useCallback((id: string) => {
    setActiveMuteMenuId((prev) => (prev === id ? null : id));
    setActiveReactionPickerId(null);
  }, []);

  const handleToggleReaction = useCallback(
    async (id: string, emoji: string) => {
      if (!guestUser) {
        onClose();
        onOpenAuthModal();
        return;
      }
      setActiveReactionPickerId(null);
      const actorUid = guestUser.firebaseUid || guestUser.uid;
      const targetMsg = messages.find((m) => m.id === id);
      const alreadyReacted = Boolean(targetMsg?.reactions?.[emoji]?.includes(actorUid));
      if (emoji === '❤️') {
        triggerLikeHapticFeedback(!alreadyReacted);
      } else {
        triggerHapticFeedback(10);
      }

      // Optimistic reaction update
      const prevMessagesSnapshot = messages;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const nextMap: Record<string, string[]> = { ...(m.reactions || {}) };
          const list = nextMap[emoji] || [];
          if (list.includes(actorUid)) {
            const filtered = list.filter((u) => u !== actorUid);
            if (filtered.length > 0) nextMap[emoji] = filtered;
            else delete nextMap[emoji];
          } else {
            nextMap[emoji] = [...list, actorUid];
          }
          return {
            ...m,
            ...(Object.keys(nextMap).length > 0 ? { reactions: nextMap } : { reactions: undefined }),
          };
        })
      );

      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'chat:react', id, emoji }));
        return;
      }

      try {
        const token = await getGuestToken();
        if (!token) {
          setMessages(prevMessagesSnapshot);
          return;
        }
        const res = await fetch(`/api/chat/messages/${encodeURIComponent(id)}/react`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ emoji }),
        });
        if (!res.ok) {
          setMessages(prevMessagesSnapshot);
        }
      } catch {
        setMessages(prevMessagesSnapshot);
      }
    },
    [getGuestToken, guestUser, messages, onClose, onOpenAuthModal]
  );

  const handleStartEdit = useCallback((msg: GlobalChatMessage) => {
    setEditingMessageId(msg.id);
    setEditingDraft(msg.text);
    setActiveReactionPickerId(null);
    setActiveMuteMenuId(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingDraft('');
  }, []);

  const handleSaveEdit = useCallback(
    async (id: string) => {
      const clean = editingDraft.trim();
      if (!clean) return;
      setError(null);
      try {
        const token = await getGuestToken();
        if (!token) {
          setError('Сесія входу застаріла.');
          return;
        }
        const res = await fetch(`/api/chat/messages/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ text: clean }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          message?: GlobalChatMessage;
          error?: string;
        };
        if (!res.ok) {
          setError(data.error || 'Не вдалося зберегти редагування.');
          return;
        }
        if (data.message) {
          mergeIncomingMessagesRef.current([data.message], 'merge');
        }
        setEditingMessageId(null);
        setEditingDraft('');
      } catch {
        setError('Помилка мережі при редагуванні.');
      }
    },
    [editingDraft, getGuestToken]
  );

  const handleTogglePin = useCallback(
    async (msg: GlobalChatMessage) => {
      if (!isAdmin) return;
      const isCurrentlyPinned = chatMeta.pinnedMessage?.id === msg.id;
      try {
        const token = await resolveToken(true);
        if (!token) return;
        const res = await fetch('/api/chat/pin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(isCurrentlyPinned ? { clear: true } : { messageId: msg.id }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          chatMeta?: ChatMetaState;
          error?: string;
        };
        if (!res.ok) {
          setError(data.error || 'Не вдалося змінити закріплення.');
          return;
        }
        if (data.chatMeta) setChatMeta(data.chatMeta);
      } catch {
        setError('Помилка мережі при закріпленні.');
      }
    },
    [chatMeta.pinnedMessage?.id, isAdmin, resolveToken]
  );

  const handleClearPin = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const token = await resolveToken(true);
      if (!token) return;
      const res = await fetch('/api/chat/pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clear: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { chatMeta?: ChatMetaState };
      if (res.ok && data.chatMeta) setChatMeta(data.chatMeta);
    } catch {
      // Ignore
    }
  }, [isAdmin, resolveToken]);

  const handleSetSlowMode = useCallback(
    async (seconds: number) => {
      if (!isAdmin) return;
      try {
        const token = await resolveToken(true);
        if (!token) return;
        const res = await fetch('/api/chat/moderation/slow-mode', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ seconds }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          chatMeta?: ChatMetaState;
          error?: string;
        };
        if (res.ok && data.chatMeta) {
          setChatMeta(data.chatMeta);
        } else if (data.error) {
          setError(data.error);
        }
      } catch {
        setError('Не вдалося оновити повільний режим.');
      }
    },
    [isAdmin, resolveToken]
  );

  const handleMuteUser = useCallback(
    async (targetUid: string, displayName: string, durationMinutes: number, unmute = false) => {
      if (!isAdmin) return;
      setActiveMuteMenuId(null);
      try {
        const token = await resolveToken(true);
        if (!token) return;
        const res = await fetch('/api/chat/moderation/mute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            targetUid,
            displayName,
            durationMinutes,
            unmute,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          mutedUsers?: Record<string, ChatMutedUserEntry>;
          error?: string;
        };
        if (!res.ok) {
          setError(data.error || 'Не вдалося оновити обмеження.');
          return;
        }
        if (data.mutedUsers) {
          setMutedUsers(data.mutedUsers);
        }
        setInfoNotice(
          unmute
            ? `Користувача ${displayName} розблоковано.`
            : `Користувача ${displayName} обмежено в чаті.`
        );
        window.setTimeout(() => setInfoNotice(null), 2400);
      } catch {
        setError('Помилка мережі при модерації.');
      }
    },
    [isAdmin, resolveToken]
  );

  const handleReportMessage = useCallback(
    async (msg: GlobalChatMessage) => {
      if (!guestUser) return;
      try {
        const token = await getGuestToken();
        if (!token) return;
        const res = await fetch('/api/chat/reports', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ messageId: msg.id }),
        });
        if (res.ok) {
          setReportedMessageIds((prev) => {
            const next = new Set(prev);
            next.add(msg.id);
            return next;
          });
          setInfoNotice('Скаргу надіслано модератору.');
          window.setTimeout(() => setInfoNotice(null), 2200);
        }
      } catch {
        setError('Не вдалося надіслати скаргу.');
      }
    },
    [getGuestToken, guestUser]
  );

  const handleResolveReport = useCallback(
    async (reportId: string) => {
      if (!isAdmin) return;
      try {
        const token = await resolveToken(true);
        if (!token) return;
        const res = await fetch(`/api/chat/reports/${encodeURIComponent(reportId)}/resolve`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as { unresolvedReportsCount?: number };
        if (res.ok) {
          setReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, resolved: true } : r)));
          if (typeof data.unresolvedReportsCount === 'number') {
            setUnresolvedReportsCount(data.unresolvedReportsCount);
          }
        }
      } catch {
        // Ignore
      }
    },
    [isAdmin, resolveToken]
  );

  const handleClearAllChat = useCallback(async () => {
    if (!isAdmin || clearingChat) return;
    setClearingChat(true);
    setError(null);
    try {
      const [fsResult, token] = await Promise.all([
        clearAllChatMessagesInFirestore().catch(() => ({ ok: false, deletedCount: 0 })),
        resolveToken(true),
      ]);

      if (!token) {
        setError('Потрібна авторизація адміністратора для очищення чату.');
        return;
      }

      const res = await fetch('/api/chat/messages', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        chatMeta?: ChatMetaState;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || 'Не вдалося очистити чат.');
        return;
      }

      const nextMeta: ChatMetaState = data.chatMeta || {
        pinnedMessage: null,
        slowModeSeconds: chatMetaRef.current.slowModeSeconds || 0,
      };
      deletedIdsRef.current.clear();
      firestoreKnownIdsRef.current.clear();
      pendingIdsRef.current.clear();
      for (const timer of pendingSendTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      pendingSendTimersRef.current.clear();

      serverHasMoreRef.current = false;
      firestoreHasMoreRef.current = false;
      setHasMoreHistory(false);
      setMessages([]);
      setIsScrolledUp(false);
      setIsNearTop(false);
      setUnreadWhileScrolled(0);
      setReplyingTo(null);
      setEditingMessageId(null);
      setConfirmDeleteId(null);
      setReports([]);
      setUnresolvedReportsCount(0);
      setChatMeta(nextMeta);
      clearCachedGlobalChatState(nextMeta);
      setConfirmClearChat(false);
      setInfoNotice(
        fsResult.ok
          ? 'Чат повністю очищено.'
          : 'Серверну історію чату очищено.'
      );
      window.setTimeout(() => setInfoNotice(null), 2400);
    } catch {
      setError('Помилка мережі при очищенні чату.');
    } finally {
      setClearingChat(false);
    }
  }, [clearingChat, isAdmin, resolveToken]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (confirmDeleteId !== id) {
        setConfirmDeleteId(id);
        return;
      }
      setConfirmDeleteId(null);
      setError(null);
      deletedIdsRef.current.add(id);
      pendingIdsRef.current.delete(id);

      const previousSnapshot = messages;
      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== id);
        saveCachedGlobalChatState(next, authorMetaByUidRef.current);
        return next;
      });

      try {
        const [directDeleted, token] = await Promise.all([
          deleteChatMessageDirectInFirestore(id),
          getGuestToken().catch(() => null),
        ]);

        if (!directDeleted && !token) {
          deletedIdsRef.current.delete(id);
          setMessages(previousSnapshot);
          saveCachedGlobalChatState(previousSnapshot, authorMetaByUidRef.current);
          setError('Потрібна авторизація для видалення.');
          return;
        }

        if (token) {
          const res = await fetch(
            `/api/chat/messages/${encodeURIComponent(id)}${directDeleted ? '?skipFirestoreSync=1' : ''}`,
            {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );
          if (!res.ok && !directDeleted) {
            const errData = (await res.json().catch(() => ({}))) as { error?: string };
            deletedIdsRef.current.delete(id);
            setMessages(previousSnapshot);
            saveCachedGlobalChatState(previousSnapshot, authorMetaByUidRef.current);
            setError(errData.error || 'Не вдалося видалити повідомлення.');
            return;
          }
        }
      } catch {
        deletedIdsRef.current.delete(id);
        setMessages(previousSnapshot);
        saveCachedGlobalChatState(previousSnapshot, authorMetaByUidRef.current);
        setError('Не вдалося видалити повідомлення.');
      }
    },
    [confirmDeleteId, getGuestToken, messages]
  );

  const handleDeleteRef = useRef(handleDelete);
  handleDeleteRef.current = handleDelete;
  const stableDeleteHandler = useCallback((id: string) => {
    void handleDeleteRef.current(id);
  }, []);

  const sendViaHttp = async (params: {
    id: string;
    cleanText: string;
    replyToId: string | undefined;
    attachment?: ChatMessageAttachment;
    clientMessageId: string;
    token: string;
    skipFirestoreSync?: boolean;
  }) => {
    const res = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({
        id: params.id,
        text: params.cleanText,
        clientMessageId: params.clientMessageId,
        ...(params.replyToId ? { replyToId: params.replyToId } : {}),
        ...(params.attachment ? { attachment: params.attachment } : {}),
        ...(params.skipFirestoreSync ? { skipFirestoreSync: true } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      message?: GlobalChatMessage;
      retryAfterSec?: number;
      error?: string;
    };
    if (!res.ok) {
      pendingIdsRef.current.delete(params.id);
      if (typeof data.retryAfterSec === 'number' && data.retryAfterSec > 0) {
        setSlowModeCooldownSec(data.retryAfterSec);
      }
      if (!params.skipFirestoreSync) {
        setMessages((prev) => prev.filter((m) => m.id !== params.id));
        setError(data.error || 'Не вдалося надіслати повідомлення.');
      }
      return false;
    }
    if (data.message) {
      pendingIdsRef.current.delete(params.id);
      mergeIncomingMessagesRef.current([data.message], 'merge');
      window.requestAnimationFrame(() => scrollToBottom(true));
    }
    return true;
  };

  const isUserMutedActive = Boolean(
    !isAdmin &&
      myMute &&
      (!myMute.mutedUntil ||
        (Number.isFinite(Date.parse(myMute.mutedUntil)) && Date.parse(myMute.mutedUntil) > Date.now()))
  );

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    if (isUserMutedActive) {
      setError('Вам обмежено можливість писати в чат.');
      return;
    }
    if (slowModeCooldownSec > 0 && !isAdmin) {
      setError(`Повільний режим: зачекайте ${slowModeCooldownSec} с.`);
      return;
    }

    let cleanText = draft.trim();
    if (!cleanText && selectedAttachment) {
      cleanText =
        selectedAttachment.type === 'radio'
          ? 'Ділюся треком 🎧'
          : 'Ділюся твором ✨';
    }
    if (!cleanText) return;

    emitTypingState(false);
    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }

    setError(null);
    shouldAutoScrollRef.current = true;
    setIsScrolledUp(false);
    setUnreadWhileScrolled(0);

    const replyTarget = replyingTo;
    const replyToId = replyTarget?.id;
    const attachmentToSend = selectedAttachment ?? undefined;
    const messageId = generateChatMessageId();
    pendingIdsRef.current.add(messageId);

    const optimisticMessage: GlobalChatMessage = {
      id: messageId,
      authorUid: guestUser.firebaseUid || guestUser.uid,
      authorName: guestUser.displayName || 'Читач',
      ...(guestUser.photoUrl ? { authorPhotoUrl: guestUser.photoUrl } : {}),
      ...(isAdmin ? { isAdmin: true } : {}),
      ...(liveBadges || guestUser.badges ? { authorBadges: liveBadges || guestUser.badges } : {}),
      ...(savedDonorText ? { authorDonorText: savedDonorText } : {}),
      text: cleanText,
      ...(attachmentToSend ? { attachment: attachmentToSend } : {}),
      ...(replyTarget
        ? {
            replyTo: {
              id: replyTarget.id,
              authorUid: replyTarget.authorUid,
              authorName: replyTarget.authorName,
              text: replyTarget.text.slice(0, 180),
            },
          }
        : {}),
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => {
      const next = [...prev, optimisticMessage].slice(-1000);
      saveCachedGlobalChatState(next, authorMetaByUidRef.current, chatMetaRef.current);
      return next;
    });
    setDraft('');
    setReplyingTo(null);
    setSelectedAttachment(null);
    setAttachmentPickerOpen(false);
    if ((chatMeta.slowModeSeconds || 0) > 0 && !isAdmin) {
      setSlowModeCooldownSec(chatMeta.slowModeSeconds || 0);
    }
    window.requestAnimationFrame(() => scrollToBottom(true));

    try {
      const directPromise = sendChatMessageDirectToFirestore({
        id: messageId,
        text: cleanText,
        authorName: guestUser.displayName || 'Читач',
        authorPhotoUrl: guestUser.photoUrl,
        isAdmin,
        replyTo: optimisticMessage.replyTo,
      });

      const tokenPromise = (async () => {
        let token = await getGuestToken();
        if (token?.startsWith('guest_v1.')) {
          const refreshed = await getGuestToken(true);
          if (refreshed) token = refreshed;
        }
        return token;
      })();

      const [directResult, token] = await Promise.all([directPromise, tokenPromise]);

      if (directResult.ok) {
        pendingIdsRef.current.delete(messageId);
        if (token) {
          const socket = wsRef.current;
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: 'chat:send',
                id: messageId,
                text: cleanText,
                clientMessageId: messageId,
                ...(replyToId ? { replyToId } : {}),
                ...(attachmentToSend ? { attachment: attachmentToSend } : {}),
                skipFirestoreSync: true,
                token,
              })
            );
          } else {
            void sendViaHttp({
              id: messageId,
              cleanText,
              replyToId,
              attachment: attachmentToSend,
              clientMessageId: messageId,
              token,
              skipFirestoreSync: true,
            });
          }
        }
        return;
      }

      if (directResult.permissionDenied) {
        pendingIdsRef.current.delete(messageId);
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setDraft(cleanText);
        setError('Немає прав на надсилання повідомлення. Перезавантажте або увійдіть знову.');
        return;
      }

      if (!token) {
        pendingIdsRef.current.delete(messageId);
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setDraft(cleanText);
        setError('Сесія входу застаріла. Увійдіть повторно.');
        return;
      }

      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        const fallbackTimer = window.setTimeout(() => {
          pendingSendTimersRef.current.delete(messageId);
          void sendViaHttp({
            id: messageId,
            cleanText,
            replyToId,
            attachment: attachmentToSend,
            clientMessageId: messageId,
            token,
          });
        }, 450);
        pendingSendTimersRef.current.set(messageId, fallbackTimer);

        socket.send(
          JSON.stringify({
            type: 'chat:send',
            id: messageId,
            text: cleanText,
            clientMessageId: messageId,
            ...(replyToId ? { replyToId } : {}),
            ...(attachmentToSend ? { attachment: attachmentToSend } : {}),
            token,
          })
        );
      } else {
        await sendViaHttp({
          id: messageId,
          cleanText,
          replyToId,
          attachment: attachmentToSend,
          clientMessageId: messageId,
          token,
        });
      }
    } catch {
      clearPendingTimer(messageId);
      pendingIdsRef.current.delete(messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      setError('Помилка мережі при надсиланні повідомлення.');
    }
  };

  const handleSaveDonorText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSetDonorText || savingDonorText) return;
    setSavingDonorText(true);
    setError(null);
    try {
      const token = await getGuestToken();
      if (!token) {
        setError('Сесія входу застаріла. Увійдіть повторно.');
        return;
      }
      const res = await fetch('/api/chat/donor-text', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: donorTextDraft.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        donorChatText?: string;
        user?: GuestUser;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || 'Не вдалося зберегти власний текст.');
        return;
      }
      const nextText = typeof data.donorChatText === 'string' ? data.donorChatText : '';
      setSavedDonorText(nextText);
      setDonorTextDraft(nextText);
      setDonorTextSavedFlash(true);
      window.setTimeout(() => setDonorTextSavedFlash(false), 1800);
      if (data.user && onGuestUserUpdated) {
        onGuestUserUpdated(data.user);
      }
    } catch {
      setError('Помилка мережі при збереженні тексту.');
    } finally {
      setSavingDonorText(false);
    }
  };

  const chatRowProps = useMemo<ChatMessageRowData>(
    () => ({
      messages,
      guestUserUid: guestUser?.uid,
      guestUserFirebaseUid: guestUser?.firebaseUid,
      guestUserDisplayName: guestUser?.displayName,
      isAdmin,
      isSignedIn: Boolean(guestUser),
      confirmDeleteId,
      activeReactionPickerId,
      activeMuteMenuId,
      editingMessageId,
      editingDraft,
      reportedMessageIds,
      pinnedMessageId: chatMeta.pinnedMessage?.id ?? null,
      searchQuery,
      activeSearchMatchId,
      highlightedMessageId,
      onReply: handleReplyMessage,
      onDelete: stableDeleteHandler,
      onJumpToMessage: handleJumpToMessage,
      onToggleReaction: (id, emoji) => void handleToggleReaction(id, emoji),
      onToggleReactionPicker: handleToggleReactionPicker,
      onStartEdit: handleStartEdit,
      onChangeEditDraft: setEditingDraft,
      onSaveEdit: (id) => void handleSaveEdit(id),
      onCancelEdit: handleCancelEdit,
      onTogglePin: (msg) => void handleTogglePin(msg),
      onToggleMuteMenu: handleToggleMuteMenu,
      onMuteUser: (targetUid, displayName, minutes) =>
        void handleMuteUser(targetUid, displayName, minutes),
      onReportMessage: (msg) => void handleReportMessage(msg),
      onOpenAttachment,
    }),
    [
      messages,
      guestUser,
      isAdmin,
      confirmDeleteId,
      activeReactionPickerId,
      activeMuteMenuId,
      editingMessageId,
      editingDraft,
      reportedMessageIds,
      chatMeta.pinnedMessage?.id,
      searchQuery,
      activeSearchMatchId,
      highlightedMessageId,
      handleReplyMessage,
      stableDeleteHandler,
      handleJumpToMessage,
      handleToggleReaction,
      handleToggleReactionPicker,
      handleStartEdit,
      handleSaveEdit,
      handleCancelEdit,
      handleTogglePin,
      handleToggleMuteMenu,
      handleMuteUser,
      handleReportMessage,
      onOpenAttachment,
    ]
  );

  const effectiveDonorRank = liveBadges?.donorRank ?? guestUser?.badges?.donorRank;
  const canSetDonorText = Boolean(
    guestUser && effectiveDonorRank && effectiveDonorRank >= 1 && effectiveDonorRank <= 3
  );

  const typingLabel = useMemo(() => {
    const names = Object.values(typingUsers)
      .map((t) => t.displayName)
      .filter(Boolean);
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} друкує...`;
    if (names.length === 2) return `${names[0]}, ${names[1]} друкують...`;
    return `${names.slice(0, 2).join(', ')} та ще ${names.length - 2} друкують...`;
  }, [typingUsers]);

  if (!isOpen) return null;

  const slowModeSec = chatMeta.slowModeSeconds || 0;
  const activeMutedList = Object.values(mutedUsers);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/75 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-chat-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl bg-night-panel rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[min(88dvh,680px)]"
      >
        {/* Header */}
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 flex items-center justify-between gap-2 bg-night-card shrink-0 border-b border-white/5">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-night-elevated flex items-center justify-center text-silver shrink-0">
              <MessagesSquare className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="global-chat-title"
                className="text-base sm:text-lg font-bold text-paper tracking-tight truncate"
              >
                Глобальний чат
              </h2>
              <p className="text-[11px] sm:text-xs text-parchment flex items-center gap-1.5 truncate">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                    wsStatus === 'connected' || firestoreConnected
                      ? 'bg-emerald-400'
                      : 'bg-amber-400 animate-pulse'
                  }`}
                />
                <span>
                  {wsStatus === 'connected' || firestoreConnected
                    ? `Онлайн: ${onlineCount}`
                    : wsStatus === 'reconnecting'
                      ? 'Перепідключення...'
                      : 'Підключення...'}
                </span>
                {slowModeSec > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-300/90 ml-1">
                    <Clock className="w-3 h-3" />
                    {slowModeSec}с
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSearchOpen((prev) => !prev);
                if (searchOpen) setSearchQuery('');
              }}
              aria-label="Пошук у чаті"
              title="Пошук у чаті"
              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                searchOpen
                  ? 'bg-white/15 text-paper'
                  : 'text-paper/70 hover:bg-white/10'
              }`}
            >
              <Search className="w-4 h-4" />
            </button>
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmClearChat((prev) => !prev)}
                  disabled={clearingChat}
                  aria-label="Очистити чат"
                  title="Очистити чат"
                  className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 ${
                    confirmClearChat
                      ? 'bg-rose-500/20 text-rose-300'
                      : 'text-paper/70 hover:text-rose-300 hover:bg-rose-500/10'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setModerationPanelOpen((prev) => !prev)}
                  aria-label="Модерація чату"
                  title="Модерація чату"
                  className={`relative w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                    moderationPanelOpen
                      ? 'bg-white/15 text-paper'
                      : 'text-paper/70 hover:bg-white/10'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  {unresolvedReportsCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-400 text-night text-[9px] font-bold flex items-center justify-center">
                      {unresolvedReportsCount}
                    </span>
                  )}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl hover:bg-white/10 flex items-center justify-center text-paper/70 transition-colors cursor-pointer"
              aria-label="Закрити чат"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>

        {/* Admin Clear Chat Confirmation */}
        {isAdmin && confirmClearChat && (
          <div className="px-4 py-2.5 bg-rose-950/50 border-b border-rose-500/25 flex items-center justify-between gap-2 flex-wrap shrink-0">
            <p className="text-xs text-rose-100 font-medium">
              Очистити всі повідомлення в чаті для всіх читачів?
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmClearChat(false)}
                disabled={clearingChat}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] font-medium text-paper transition-colors cursor-pointer disabled:opacity-50"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={() => void handleClearAllChat()}
                disabled={clearingChat}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 text-[11px] font-semibold text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                <span>{clearingChat ? 'Очищення...' : 'Очистити чат'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Search Bar */}
        {searchOpen && (
          <div className="px-3.5 py-2 bg-night-deep/90 border-b border-white/10 flex items-center gap-2 shrink-0">
            <Search className="w-3.5 h-3.5 text-parchment shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  jumpToSearchMatch(e.shiftKey ? -1 : 1);
                }
              }}
              placeholder="Пошук за текстом, автором або твором..."
              autoFocus
              className="flex-1 min-w-0 bg-transparent text-xs text-paper placeholder:text-ink-subtle focus:outline-none"
            />
            {searchQuery.trim() && (
              <span className="text-[11px] text-parchment tabular-nums shrink-0">
                {searchMatchIds.length > 0
                  ? `${searchMatchCursor + 1}/${searchMatchIds.length}`
                  : '0'}
              </span>
            )}
            {searchMatchIds.length > 1 && (
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => jumpToSearchMatch(-1)}
                  aria-label="Попередній збіг"
                  className="p-1 rounded hover:bg-white/10 text-parchment cursor-pointer"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => jumpToSearchMatch(1)}
                  aria-label="Наступний збіг"
                  className="p-1 rounded hover:bg-white/10 text-parchment cursor-pointer"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {hasMoreHistory && (
              <button
                type="button"
                onClick={() => void handleLoadOlderMessages()}
                disabled={loadingOlderHistory}
                title="Завантажити раніші повідомлення для пошуку"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/8 hover:bg-white/15 text-[11px] text-parchment hover:text-paper transition-colors shrink-0 cursor-pointer disabled:opacity-50"
              >
                <History className="w-3 h-3" />
                <span>{loadingOlderHistory ? '...' : 'Раніше'}</span>
              </button>
            )}
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Очистити пошук"
                className="p-1 rounded hover:bg-white/10 text-parchment cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Admin Moderation Panel */}
        {isAdmin && moderationPanelOpen && (
          <div className="px-4 py-3 bg-night-deep border-b border-white/10 shrink-0 space-y-3 max-h-60 overflow-y-auto">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-semibold text-paper flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-silver" />
                Повільний режим
              </span>
              <div className="flex items-center gap-1">
                {SLOW_MODE_OPTIONS.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => void handleSetSlowMode(sec)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      slowModeSec === sec
                        ? 'bg-silver text-night'
                        : 'bg-white/5 text-parchment hover:bg-white/10'
                    }`}
                  >
                    {sec === 0 ? 'Вимк.' : `${sec}с`}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setConfirmClearChat(true)}
                disabled={clearingChat}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/25 text-[11px] font-semibold text-rose-200 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                <span>Очистити чат</span>
              </button>
            </div>

            {activeMutedList.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-parchment">
                  Обмежені читачі ({activeMutedList.length})
                </p>
                <div className="space-y-1">
                  {activeMutedList.map((entry) => (
                    <div
                      key={entry.uid}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white/5 text-xs"
                    >
                      <span className="text-paper truncate">
                        {entry.displayName || entry.uid}
                        <span className="text-[10px] text-parchment ml-1.5">
                          {entry.mutedUntil
                            ? `до ${new Date(entry.mutedUntil).toLocaleTimeString('uk-UA', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}`
                            : 'назавжди'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void handleMuteUser(entry.uid, entry.displayName || 'Читач', 0, true)
                        }
                        className="text-[11px] text-emerald-300 hover:underline shrink-0 cursor-pointer"
                      >
                        Зняти мут
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-parchment">
                Скарги ({unresolvedReportsCount} нових)
              </p>
              {reports.length === 0 ? (
                <p className="text-[11px] text-parchment/70">Скарг поки немає.</p>
              ) : (
                <div className="space-y-1.5">
                  {reports.slice(0, 10).map((rep) => (
                    <div
                      key={rep.id}
                      className={`p-2 rounded-lg border text-[11px] space-y-1 ${
                        rep.resolved
                          ? 'bg-white/3 border-white/5 opacity-60'
                          : 'bg-amber-500/10 border-amber-400/25'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-paper truncate">
                          На {rep.messageAuthorName} · від {rep.reporterName}
                        </span>
                        {!rep.resolved && (
                          <button
                            type="button"
                            onClick={() => void handleResolveReport(rep.id)}
                            className="text-emerald-300 hover:underline shrink-0 cursor-pointer"
                          >
                            Позначити розглянутою
                          </button>
                        )}
                      </div>
                      <p className="text-cream/90 line-clamp-2">«{rep.messageText}»</p>
                      <div className="flex items-center gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleJumpToMessage(rep.messageId)}
                          className="text-silver hover:underline cursor-pointer"
                        >
                          Перейти
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleMuteUser(rep.messageAuthorUid, rep.messageAuthorName, 60)
                          }
                          className="text-amber-300 hover:underline cursor-pointer"
                        >
                          Мут 1 год
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pinned Message Banner */}
        {chatMeta.pinnedMessage && (
          <div className="px-3.5 py-2 bg-night-elevated/90 border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                const exists = messages.some((m) => m.id === chatMeta.pinnedMessage?.id);
                if (exists) {
                  handleJumpToMessage(chatMeta.pinnedMessage!.id);
                } else {
                  setPinnedExpanded((p) => !p);
                }
              }}
              className="flex items-start gap-2 min-w-0 flex-1 text-left cursor-pointer"
            >
              <Pin className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-amber-300 truncate">
                  Закріплено · {chatMeta.pinnedMessage.authorName}
                </p>
                <p
                  className={`text-xs text-cream/95 ${
                    pinnedExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'
                  }`}
                >
                  {chatMeta.pinnedMessage.text}
                </p>
              </div>
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => void handleClearPin()}
                title="Відкріпити"
                aria-label="Відкріпити повідомлення"
                className="p-1 rounded-lg text-parchment hover:text-paper hover:bg-white/10 shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Message List */}
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {messages.length > 0 && hasMoreHistory && (isNearTop || messages.length <= 105) && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">
              <button
                type="button"
                onClick={() => void handleLoadOlderMessages()}
                disabled={loadingOlderHistory}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-night-card/95 border border-white/15 shadow-lg text-[11px] font-medium text-paper hover:bg-night-elevated transition-all cursor-pointer disabled:opacity-60"
              >
                <History className={`w-3.5 h-3.5 ${loadingOlderHistory ? 'animate-spin' : ''}`} />
                <span>
                  {loadingOlderHistory ? 'Завантаження історії...' : 'Показати попередні повідомлення'}
                </span>
              </button>
            </div>
          )}

          {loadingInitial && messages.length === 0 ? (
            <div className="h-full p-3 sm:p-4 flex items-center justify-center text-sm text-parchment animate-pulse">
              Завантаження чату...
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full p-3 sm:p-4 flex flex-col items-center justify-center text-center gap-2 text-parchment">
              <MessagesSquare className="w-8 h-8 opacity-40" />
              <p className="text-sm font-medium text-cream">Поки немає повідомлень</p>
              <p className="text-xs text-parchment">
                Напишіть першим, щоб почати спілкування з читачами сайту.
              </p>
            </div>
          ) : (
            <List
              listRef={listRef}
              rowCount={messages.length}
              rowHeight={dynamicRowHeight}
              rowComponent={ChatMessageRow}
              rowProps={chatRowProps}
              overscanCount={6}
              onScroll={handleScroll}
              className="h-full w-full overflow-x-hidden px-3 sm:px-4 pt-3 sm:pt-4"
            />
          )}

          {/* Jump to bottom button */}
          {isScrolledUp && messages.length > 0 && (
            <button
              type="button"
              onClick={() => scrollToBottom(true)}
              className="absolute bottom-3 right-3.5 z-20 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-night-card/95 border border-white/15 shadow-lg text-xs font-medium text-paper hover:bg-night-elevated transition-all cursor-pointer"
            >
              <span>До останніх</span>
              {unreadWhileScrolled > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-silver text-night text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadWhileScrolled}
                </span>
              )}
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Typing indicator bar */}
        {typingLabel && (
          <div className="px-4 py-1 text-[11px] text-parchment/90 flex items-center gap-1.5 shrink-0 bg-night-panel">
            <span className="inline-flex gap-0.5" aria-hidden="true">
              <span className="w-1 h-1 rounded-full bg-silver animate-bounce" />
              <span className="w-1 h-1 rounded-full bg-silver animate-bounce [animation-delay:120ms]" />
              <span className="w-1 h-1 rounded-full bg-silver animate-bounce [animation-delay:240ms]" />
            </span>
            <span className="truncate">{typingLabel}</span>
          </div>
        )}

        {/* Notice & Error banners */}
        {infoNotice && (
          <div className="mx-3 sm:mx-4 mb-2 px-3 py-1.5 rounded-xl bg-emerald-500/15 text-emerald-200 text-xs text-center">
            {infoNotice}
          </div>
        )}
        {error && (
          <div className="mx-3 sm:mx-4 mb-2 px-3 py-2 rounded-xl bg-red-500/15 text-red-300 text-xs text-center">
            {error}
          </div>
        )}

        {/* Composer */}
        <div className="relative p-3 sm:p-4 bg-night-card border-t border-white/5 shrink-0 space-y-2.5">
          {canSetDonorText && (
            <form
              onSubmit={(e) => void handleSaveDonorText(e)}
              className="flex flex-col sm:flex-row sm:items-center gap-1.5 px-2.5 py-2 rounded-xl bg-[#1E1A1D] border border-[#F5C6CE]/20"
            >
              <label
                htmlFor="top3-donor-chat-text"
                className="text-[11px] font-medium text-[#F5C6CE] whitespace-nowrap shrink-0"
              >
                Топ-{effectiveDonorRank} донат · Ваш текст:
              </label>
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <input
                  id="top3-donor-chat-text"
                  type="text"
                  maxLength={80}
                  value={donorTextDraft}
                  onChange={(e) => setDonorTextDraft(e.target.value.slice(0, 80))}
                  placeholder="Введіть власний текст у чаті..."
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg bg-ink focus:bg-night-panel text-paper placeholder:text-ink-subtle focus:outline-none transition-colors"
                />
                <button
                  type="submit"
                  disabled={savingDonorText || donorTextDraft.trim() === savedDonorText.trim()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-silver text-night text-[11px] font-semibold hover:opacity-95 transition-opacity whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:pointer-events-none"
                >
                  {donorTextSavedFlash ? (
                    <>
                      <Check className="w-3 h-3" />
                      <span>Збережено</span>
                    </>
                  ) : (
                    <span>{savingDonorText ? '...' : 'Зберегти'}</span>
                  )}
                </button>
              </div>
            </form>
          )}

          {guestUser ? (
            isUserMutedActive ? (
              <div className="px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-400/25 text-xs text-amber-200 flex items-center gap-2">
                <VolumeX className="w-4 h-4 shrink-0" />
                <span>
                  Вам обмежено можливість писати в чат
                  {myMute?.mutedUntil
                    ? ` до ${new Date(myMute.mutedUntil).toLocaleString('uk-UA', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : ''}
                  .
                </span>
              </div>
            ) : (
              <form onSubmit={(e) => void handleSend(e)} className="relative space-y-2">
                {/* @mention Autocomplete Popup */}
                {mentionSuggestions.length > 0 && (
                  <div className="absolute bottom-full left-0 right-0 mb-2 z-30 rounded-xl bg-night-deep border border-white/15 shadow-2xl overflow-hidden">
                    {mentionSuggestions.map((person, idx) => (
                      <button
                        key={person.uid}
                        type="button"
                        onClick={() => applyMentionSuggestion(person.name)}
                        className={`w-full px-3 py-2 flex items-center gap-2 text-left text-xs transition-colors cursor-pointer ${
                          idx === mentionIndex
                            ? 'bg-white/10 text-paper'
                            : 'text-cream hover:bg-white/5'
                        }`}
                      >
                        <div className="w-5 h-5 rounded-full bg-night-elevated overflow-hidden flex items-center justify-center shrink-0">
                          <ChatAvatar photoUrl={person.photoUrl} />
                        </div>
                        <span className="font-medium truncate">@{person.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Attachment Picker Popup */}
                {attachmentPickerOpen && (
                  <div className="rounded-xl bg-night-deep border border-white/15 p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        {(
                          [
                            { id: 'poem', label: 'Вірші' },
                            { id: 'prose', label: 'Проза' },
                            { id: 'radio', label: 'Радіо' },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setAttachmentTab(tab.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                              attachmentTab === tab.id
                                ? 'bg-silver text-night'
                                : 'text-parchment hover:bg-white/10'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setAttachmentPickerOpen(false)}
                        aria-label="Закрити вибір вкладення"
                        className="p-1 rounded-lg text-parchment hover:bg-white/10 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <input
                      type="text"
                      value={attachmentSearch}
                      onChange={(e) => setAttachmentSearch(e.target.value)}
                      placeholder="Знайти за назвою..."
                      className="w-full px-2.5 py-1.5 rounded-lg bg-night-card text-xs text-paper placeholder:text-ink-subtle focus:outline-none"
                    />

                    <div className="max-h-36 overflow-y-auto space-y-1">
                      {attachmentOptions.length === 0 ? (
                        <p className="text-[11px] text-parchment/70 py-2 text-center">
                          Нічого не знайдено
                        </p>
                      ) : (
                        attachmentOptions.map((item) => (
                          <button
                            key={`${item.type}:${item.id}`}
                            type="button"
                            onClick={() => {
                              setSelectedAttachment(item);
                              setAttachmentPickerOpen(false);
                              setAttachmentSearch('');
                              inputRef.current?.focus();
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg hover:bg-white/10 flex items-center gap-2 text-left transition-colors cursor-pointer"
                          >
                            <AttachmentBadgeIcon type={item.type} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-paper truncate">{item.title}</p>
                              {item.subtitle && (
                                <p className="text-[10px] text-parchment/75 truncate">
                                  {item.subtitle}
                                </p>
                              )}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {replyingTo && (
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-night-deep border border-white/10">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold text-silver flex items-center gap-1 truncate">
                        <CornerUpLeft className="w-3 h-3 shrink-0" />
                        <span>Відповідь для {replyingTo.authorName}</span>
                      </p>
                      <p className="text-[11px] text-parchment truncate">{replyingTo.text}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      aria-label="Скасувати відповідь"
                      className="p-1 rounded-lg text-parchment hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {selectedAttachment && (
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-night-deep border border-white/10">
                    <div className="flex items-center gap-2 min-w-0">
                      <AttachmentBadgeIcon type={selectedAttachment.type} />
                      <div className="min-w-0">
                        <p className="text-[10px] text-parchment/80 truncate">
                          {getAttachmentTypeLabel(selectedAttachment.type)}
                        </p>
                        <p className="text-xs font-medium text-paper truncate">
                          {selectedAttachment.title}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedAttachment(null)}
                      aria-label="Прибрати вкладення"
                      className="p-1 rounded-lg text-parchment hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => setAttachmentPickerOpen((p) => !p)}
                    title="Прикріпити твір або трек"
                    aria-label="Прикріпити твір або трек"
                    className={`inline-flex items-center justify-center w-10 h-10 rounded-xl transition-colors shrink-0 cursor-pointer ${
                      attachmentPickerOpen || selectedAttachment
                        ? 'bg-white/15 text-paper'
                        : 'bg-night-deep text-parchment hover:text-paper hover:bg-night-hover'
                    }`}
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => handleDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (mentionSuggestions.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setMentionIndex((i) => (i + 1) % mentionSuggestions.length);
                          return;
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setMentionIndex(
                            (i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length
                          );
                          return;
                        }
                        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                          e.preventDefault();
                          const chosen = mentionSuggestions[mentionIndex];
                          if (chosen) applyMentionSuggestion(chosen.name);
                          return;
                        }
                      }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={
                      replyingTo
                        ? `Відповісти ${replyingTo.authorName}...`
                        : selectedAttachment
                          ? 'Додайте коментар до вкладення...'
                          : 'Напишіть повідомлення (можна @імʼя)...'
                    }
                    rows={1}
                    className="flex-1 min-w-0 max-h-28 px-3.5 py-2.5 text-xs sm:text-sm rounded-xl bg-night-deep focus:bg-night-hover text-paper placeholder:text-ink-subtle focus:outline-none transition-colors resize-none"
                  />
                  <button
                    type="submit"
                    disabled={
                      (!draft.trim() && !selectedAttachment) ||
                      (slowModeCooldownSec > 0 && !isAdmin)
                    }
                    aria-label="Надіслати повідомлення"
                    className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-silver text-night hover:opacity-95 transition-opacity shrink-0 cursor-pointer disabled:opacity-45 disabled:pointer-events-none text-xs font-semibold tabular-nums"
                  >
                    {slowModeCooldownSec > 0 && !isAdmin ? (
                      <span>{slowModeCooldownSec}</span>
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {draft.length > 480 && (
                  <p className="text-[10px] text-parchment text-right tabular-nums">
                    {draft.length} / 600
                  </p>
                )}
              </form>
            )
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-parchment">
                Увійдіть в акаунт, щоб писати в чат
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuthModal();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-silver text-night text-xs font-semibold hover:opacity-95 transition-opacity shrink-0 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Увійти</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
