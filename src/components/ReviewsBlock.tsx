/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Check, Loader2, MessageSquare, Pencil, Send, Star, Trash2, User, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { List, useDynamicRowHeight, type RowComponentProps } from 'react-window';
import type { GuestUser, Poem, ProseWork, ReviewItem, StoreProduct } from '../types.ts';
import { trackClick } from '../utils/analytics.ts';
import { UserRankBadges } from './UserRankBadges.tsx';

interface ReviewsBlockProps {
  targetType: 'poem' | 'prose' | 'product';
  targetId: string;
  ratingAverage: number;
  ratingCount: number;
  reviews: ReviewItem[];
  guestUser: GuestUser | null;
  getGuestToken?: (forceRefresh?: boolean) => Promise<string | null>;
  isAdmin?: boolean;
  getAdminToken?: (forceRefresh?: boolean) => Promise<string | null>;
  onOpenAuthModal: () => void;
  compact?: boolean;
  hideRatingSummary?: boolean;
  linkedRating?: number | null;
  onLinkedRatingChange?: (rating: number | null) => void;
  userHasRated?: boolean;
  userRatingValue?: number | null;
  onReviewSubmitted: (payload: { poem?: Poem; prose?: ProseWork; product?: StoreProduct }) => void;
}

function ReviewAvatar({ photoUrl, name }: { photoUrl?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={name}
        width={20}
        height={20}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-5 h-5 rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <span className="w-5 h-5 rounded-full bg-paper-warm dark:bg-night-elevated flex items-center justify-center text-ink-muted dark:text-sandstone-light shrink-0">
      <User className="w-3 h-3" />
    </span>
  );
}

interface ReviewRowData {
  reviews: ReviewItem[];
  compact: boolean;
  isAdmin: boolean;
  guestUserUid?: string;
  guestUserFirebaseUid?: string;
  editingReviewId: string | null;
  editCommentText: string;
  editSubmitting: boolean;
  editError: string | null;
  confirmDeleteId: string | null;
  deleteSubmittingId: string | null;
  onStartEdit: (rev: ReviewItem) => void;
  onCancelEdit: () => void;
  onEditTextChange: (value: string) => void;
  onSaveEdit: (reviewId: string) => void;
  onToggleConfirmDelete: (reviewId: string) => void;
  onConfirmDelete: (reviewId: string) => void;
}

const ReviewCard = memo(function ReviewCard({
  rev,
  compact,
  canModify,
  isEditing,
  editCommentText,
  editSubmitting,
  editError,
  isConfirmingDelete,
  deleteSubmitting,
  onStartEdit,
  onCancelEdit,
  onEditTextChange,
  onSaveEdit,
  onToggleConfirmDelete,
  onConfirmDelete,
}: {
  rev: ReviewItem;
  compact: boolean;
  canModify: boolean;
  isEditing: boolean;
  editCommentText: string;
  editSubmitting: boolean;
  editError: string | null;
  isConfirmingDelete: boolean;
  deleteSubmitting: boolean;
  onStartEdit: (rev: ReviewItem) => void;
  onCancelEdit: () => void;
  onEditTextChange: (value: string) => void;
  onSaveEdit: (reviewId: string) => void;
  onToggleConfirmDelete: (reviewId: string) => void;
  onConfirmDelete: (reviewId: string) => void;
}) {
  return (
    <div
      className={
        compact
          ? 'p-3.5 bg-paper dark:bg-night-card rounded-xl space-y-1.5'
          : 'p-4 bg-white dark:bg-night-card rounded-xl space-y-2'
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <ReviewAvatar photoUrl={rev.authorPhotoUrl} name={rev.authorName} />
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="text-xs font-semibold text-ink dark:text-cream truncate max-w-full">
              {rev.authorName}
            </span>
            <UserRankBadges badges={rev.authorBadges} size="xs" />
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-ink-muted dark:text-sandstone-light font-mono tabular-nums">
          {typeof rev.rating === 'number' && (
            <>
              <span className="inline-flex items-center gap-1 text-ink dark:text-cream font-medium">
                <Star className="w-3 h-3 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                <span>{rev.rating.toFixed(1)}</span>
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>
            {new Date(rev.createdAt).toLocaleDateString('uk-UA', {
              day: 'numeric',
              month: 'short',
            })}
          </span>

          {canModify && !isEditing && (
            <div className="flex items-center gap-1 ml-1.5 pl-1.5 border-l border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => onStartEdit(rev)}
                title="Редагувати коментар"
                aria-label="Редагувати коментар"
                className="p-1 rounded text-ink-subtle hover:text-ink dark:text-sandstone dark:hover:text-cream hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => onToggleConfirmDelete(rev.id)}
                title="Видалити коментар"
                aria-label="Видалити коментар"
                className="p-1 rounded text-ink-subtle hover:text-rose-600 dark:text-sandstone dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {isConfirmingDelete && (
        <div className="mt-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-800 dark:text-rose-300">
          <span className="font-medium">Видалити цей коментар?</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={deleteSubmitting}
              onClick={() => onToggleConfirmDelete(rev.id)}
              className="px-2.5 py-1 rounded-md bg-white/70 dark:bg-black/30 hover:bg-white dark:hover:bg-black/50 transition-colors cursor-pointer"
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={deleteSubmitting}
              onClick={() => onConfirmDelete(rev.id)}
              className="px-2.5 py-1 rounded-md bg-rose-600 text-white font-semibold hover:bg-rose-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              {deleteSubmitting ? 'Видалення...' : 'Так, видалити'}
            </button>
          </div>
        </div>
      )}

      {isEditing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSaveEdit(rev.id);
          }}
          className="mt-2 space-y-2 pt-1"
        >
          <textarea
            rows={2}
            maxLength={1500}
            value={editCommentText}
            onChange={(e) => onEditTextChange(e.target.value)}
            className="input-editorial w-full text-xs sm:text-sm"
            autoFocus
          />
          {editError && (
            <p className="text-xs text-rose-700 dark:text-rose-400 font-medium">{editError}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={editSubmitting}
              onClick={onCancelEdit}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-ink-subtle dark:text-sandstone hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
            >
              Скасувати
            </button>
            <button
              type="submit"
              disabled={editSubmitting || !editCommentText.trim()}
              className="btn-editorial-primary px-3 py-1.5 text-xs font-semibold gap-1.5 disabled:opacity-45"
            >
              {editSubmitting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Check className="w-3 h-3" />
              )}
              <span>Зберегти</span>
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-[#444440] dark:text-parchment leading-relaxed whitespace-pre-wrap">
          {rev.comment}
        </p>
      )}
    </div>
  );
});

function ReviewRow({
  ariaAttributes,
  index,
  style,
  reviews,
  compact,
  isAdmin,
  guestUserUid,
  guestUserFirebaseUid,
  editingReviewId,
  editCommentText,
  editSubmitting,
  editError,
  confirmDeleteId,
  deleteSubmittingId,
  onStartEdit,
  onCancelEdit,
  onEditTextChange,
  onSaveEdit,
  onToggleConfirmDelete,
  onConfirmDelete,
}: RowComponentProps<ReviewRowData>): ReactElement | null {
  const rev = reviews[index];
  if (!rev) return null;
  const canModify = Boolean(
    isAdmin ||
      (guestUserUid &&
        (rev.authorUid === guestUserUid ||
          (guestUserFirebaseUid && rev.authorUid === guestUserFirebaseUid)))
  );
  const spacingClass =
    index < reviews.length - 1 ? (compact ? 'pb-2.5' : 'pb-3') : '';
  return (
    <div {...ariaAttributes} style={style}>
      <div className={spacingClass}>
        <ReviewCard
          rev={rev}
          compact={compact}
          canModify={canModify}
          isEditing={editingReviewId === rev.id}
          editCommentText={editCommentText}
          editSubmitting={editSubmitting}
          editError={editError}
          isConfirmingDelete={confirmDeleteId === rev.id}
          deleteSubmitting={deleteSubmittingId === rev.id}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onEditTextChange={onEditTextChange}
          onSaveEdit={onSaveEdit}
          onToggleConfirmDelete={onToggleConfirmDelete}
          onConfirmDelete={onConfirmDelete}
        />
      </div>
    </div>
  );
}

export const ReviewsBlock = memo(function ReviewsBlock({
  targetType,
  targetId,
  ratingAverage,
  ratingCount,
  reviews,
  guestUser,
  getGuestToken,
  isAdmin = false,
  getAdminToken,
  onOpenAuthModal,
  compact = false,
  hideRatingSummary = false,
  linkedRating,
  userHasRated = false,
  userRatingValue = null,
  onReviewSubmitted,
}: ReviewsBlockProps) {
  const [comment, setComment] = useState('');
  const [guestNameInput, setGuestNameInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const [localReviews, setLocalReviews] = useState<ReviewItem[]>(reviews);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState<string>('');
  const [editSubmitting, setEditSubmitting] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteSubmittingId, setDeleteSubmittingId] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<{ text: string; isError?: boolean } | null>(null);

  useEffect(() => {
    setComment('');
    setStatusMessage(null);
    setEditingReviewId(null);
    setConfirmDeleteId(null);
    setActionStatus(null);
  }, [targetId]);

  useEffect(() => {
    setLocalReviews(reviews);
  }, [reviews]);

  const activeRating = userHasRated
    ? null
    : (linkedRating ?? null);

  const trimmedComment = comment.trim();
  const hasComment = trimmedComment.length > 0;
  const hasSelectedRating = activeRating !== null;
  const canSubmit = !submitting && (hasComment || hasSelectedRating);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!guestUser) {
      onOpenAuthModal();
      return;
    }
    if (!canSubmit) return;

    const effectiveAuthorName = (guestUser.displayName || guestNameInput || 'Гість').trim().slice(0, 80);
    const effectiveAuthorUid = guestUser.uid;

    trackClick(
      `review:${targetType}:${targetId}`,
      hasComment && hasSelectedRating
        ? 'Коментар з оцінкою'
        : hasComment
          ? 'Коментар без оцінки'
          : 'Підтверджена оцінка',
      'action'
    );
    setSubmitting(true);
    setStatusMessage(null);
    try {
      const sendCreate = async (authToken: string | null) =>
        fetch('/api/reviews', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            targetType,
            targetId,
            rating: activeRating,
            comment: trimmedComment,
            authorUid: effectiveAuthorUid,
            authorName: effectiveAuthorName,
            authorPhotoUrl: guestUser?.photoUrl,
          }),
        });

      let token = (await getGuestToken?.()) || guestUser?.sessionToken || null;
      if (token?.startsWith('guest_v1.') && getGuestToken) {
        const refreshed = await getGuestToken(true);
        if (refreshed) token = refreshed;
      }
      let response = await sendCreate(token);
      if ((response.status === 401 || response.status === 403) && getGuestToken) {
        const refreshed = await getGuestToken(true);
        if (refreshed && refreshed !== token) {
          response = await sendCreate(refreshed);
        }
      }
      const data = await response.json();
      if (!response.ok) {
        setStatusMessage({ text: data.error || 'Не вдалося зберегти відгук.', isError: true });
        return;
      }

      onReviewSubmitted({ poem: data.poem, prose: data.prose, product: data.product });
      setComment('');

      if (data.ratingOnly && activeRating !== null) {
        setStatusMessage({
          text: data.alreadyRatedIp
            ? `Вашу оцінку (${Number(data.appliedRating || activeRating).toFixed(1)}/5.0) з цієї IP-адреси вже враховано.`
            : `Оцінку ${activeRating.toFixed(1)}/5.0 підтверджено.`,
        });
      } else if (data.commentOnly) {
        setStatusMessage({
          text: 'Коментар опубліковано.',
        });
      } else {
        setStatusMessage({
          text: data.alreadyRatedIp
            ? 'Коментар опубліковано! Оцінка збережена з вашого попереднього голосу.'
            : 'Дякуємо! Вашу оцінку та коментар опубліковано.',
        });
      }
    } catch {
      setStatusMessage({ text: 'Помилка з’єднання із сервером.', isError: true });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEdit = (rev: ReviewItem) => {
    setEditingReviewId(rev.id);
    setEditCommentText(rev.comment);
    setEditError(null);
    setConfirmDeleteId(null);
    setActionStatus(null);
  };

  const handleCancelEdit = () => {
    setEditingReviewId(null);
    setEditCommentText('');
    setEditError(null);
  };

  const resolveModifyToken = async (forceRefresh = false): Promise<string | null> => {
    if (isAdmin && getAdminToken) {
      const adminTok = await getAdminToken(forceRefresh).catch(() => null);
      if (adminTok) return adminTok;
    }
    let guestTok = (await getGuestToken?.(forceRefresh).catch(() => null)) || guestUser?.sessionToken || null;
    if (!forceRefresh && guestTok?.startsWith('guest_v1.') && getGuestToken) {
      const refreshed = await getGuestToken(true).catch(() => null);
      if (refreshed) guestTok = refreshed;
    }
    return guestTok;
  };

  const handleSaveEdit = async (reviewId: string) => {
    const clean = editCommentText.trim();
    if (!clean) {
      setEditError('Коментар не може бути порожнім.');
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      const sendPatch = async (authToken: string | null) =>
        fetch(`/api/reviews/${encodeURIComponent(reviewId)}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ comment: clean }),
        });

      const firstToken = await resolveModifyToken(false);
      let res = await sendPatch(firstToken);
      if (res.status === 401 || res.status === 403) {
        const refreshed = await resolveModifyToken(true);
        if (refreshed && refreshed !== firstToken) {
          res = await sendPatch(refreshed);
        }
      }
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || 'Не вдалося відредагувати коментар.');
        return;
      }
      setLocalReviews((prev) =>
        prev.map((r) => (r.id === reviewId ? (data.review ? { ...r, ...data.review } : { ...r, comment: clean }) : r))
      );
      if (data.poem || data.prose || data.product) {
        onReviewSubmitted({ poem: data.poem, prose: data.prose, product: data.product });
      }
      setEditingReviewId(null);
      setActionStatus({ text: 'Коментар успішно оновлено.' });
    } catch {
      setEditError('Помилка з’єднання із сервером.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async (reviewId: string) => {
    setDeleteSubmittingId(reviewId);
    setActionStatus(null);
    try {
      const sendDelete = async (authToken: string | null) =>
        fetch(`/api/reviews/${encodeURIComponent(reviewId)}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
        });

      const firstToken = await resolveModifyToken(false);
      let res = await sendDelete(firstToken);
      if (res.status === 401 || res.status === 403) {
        const refreshed = await resolveModifyToken(true);
        if (refreshed && refreshed !== firstToken) {
          res = await sendDelete(refreshed);
        }
      }
      const data = await res.json();
      if (!res.ok) {
        setActionStatus({ text: data.error || 'Не вдалося видалити коментар.', isError: true });
        return;
      }
      setLocalReviews((prev) => prev.filter((r) => r.id !== reviewId));
      if (data.poem || data.prose || data.product) {
        onReviewSubmitted({ poem: data.poem, prose: data.prose, product: data.product });
      }
      setConfirmDeleteId(null);
      setActionStatus({ text: 'Коментар видалено.' });
    } catch {
      setActionStatus({ text: 'Помилка з’єднання із сервером.', isError: true });
    } finally {
      setDeleteSubmittingId(null);
    }
  };

  const saveEditRef = useRef(handleSaveEdit);
  saveEditRef.current = handleSaveEdit;
  const deleteRef = useRef(handleDelete);
  deleteRef.current = handleDelete;

  const stableStartEdit = useCallback((rev: ReviewItem) => handleStartEdit(rev), []);
  const stableCancelEdit = useCallback(() => handleCancelEdit(), []);
  const stableSaveEdit = useCallback((reviewId: string) => {
    void saveEditRef.current(reviewId);
  }, []);
  const stableToggleConfirmDelete = useCallback((reviewId: string) => {
    setConfirmDeleteId((prev) => (prev === reviewId ? null : reviewId));
  }, []);
  const stableConfirmDelete = useCallback((reviewId: string) => {
    void deleteRef.current(reviewId);
  }, []);

  const shouldVirtualize = localReviews.length > 15;
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: compact ? 92 : 108,
    key: `${targetId}:${localReviews.length}:${editingReviewId ?? ''}:${confirmDeleteId ?? ''}`,
  });

  const reviewRowProps = useMemo<ReviewRowData>(
    () => ({
      reviews: localReviews,
      compact,
      isAdmin,
      guestUserUid: guestUser?.uid,
      guestUserFirebaseUid: guestUser?.firebaseUid,
      editingReviewId,
      editCommentText,
      editSubmitting,
      editError,
      confirmDeleteId,
      deleteSubmittingId,
      onStartEdit: stableStartEdit,
      onCancelEdit: stableCancelEdit,
      onEditTextChange: setEditCommentText,
      onSaveEdit: stableSaveEdit,
      onToggleConfirmDelete: stableToggleConfirmDelete,
      onConfirmDelete: stableConfirmDelete,
    }),
    [
      localReviews,
      compact,
      isAdmin,
      guestUser?.uid,
      guestUser?.firebaseUid,
      editingReviewId,
      editCommentText,
      editSubmitting,
      editError,
      confirmDeleteId,
      deleteSubmittingId,
      stableStartEdit,
      stableCancelEdit,
      stableSaveEdit,
      stableToggleConfirmDelete,
      stableConfirmDelete,
    ]
  );

  const submitLabel = submitting
    ? 'Надсилання...'
    : hasSelectedRating && hasComment
      ? 'Підтвердити оцінку і коментар'
      : hasSelectedRating && activeRating !== null
        ? `Підтвердити оцінку (${activeRating.toFixed(1)})`
        : 'Опублікувати коментар';

  return (
    <div className={compact ? 'pt-4 space-y-4' : 'pt-6 space-y-5'}>
      {!hideRatingSummary && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="w-4 h-4 text-pine dark:text-silver" strokeWidth={1.75} />
            <h4 className="font-serif text-2xl font-semibold tracking-[-0.01em] text-ink dark:text-cream">
              Оцінки та відгуки
            </h4>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-mono text-ink-muted dark:text-sandstone-light tabular-nums">
            {ratingCount > 0 ? (
              <>
                <Star className="w-3.5 h-3.5 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                <span>
                  <strong className="text-ink dark:text-cream font-semibold">{ratingAverage.toFixed(1)}</strong> / 5.0 · {ratingCount}
                </span>
              </>
            ) : (
              <span>Без оцінок</span>
            )}
          </div>
        </div>
      )}

      {/* Rating & Review Form (authorized) OR Sign-in Notice (guests) */}
      {!guestUser ? (
        <div
          className={
            compact
              ? 'px-4 py-4 rounded-xl bg-paper dark:bg-night-card flex flex-col items-center text-center gap-3'
              : 'p-5 bg-white dark:bg-night-card rounded-2xl flex flex-col items-center text-center gap-3'
          }
        >
          <p className="text-xs sm:text-sm text-[#444440] dark:text-parchment">
            Щоб залишити оцінку або відгук
          </p>
          <button
            type="button"
            onClick={() => {
              trackClick(`review_auth:${targetType}:${targetId}`, 'Увійти для оцінки/відгуку', 'action');
              onOpenAuthModal();
            }}
            className="btn-editorial-primary w-full max-w-xs min-h-[42px] px-6 py-2.5 text-xs font-semibold justify-center"
          >
            Увійти
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className={compact ? 'space-y-3' : 'p-5 bg-white dark:bg-night-card rounded-2xl space-y-4'}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[200px]">
              <label htmlFor={`guest-name-${targetId}`} className="text-xs font-medium text-ink-muted dark:text-sandstone-light shrink-0">
                Від імені:
              </label>
              <strong className="text-xs font-semibold text-ink dark:text-cream">{guestUser.displayName}</strong>
              <UserRankBadges badges={guestUser.badges} size="xs" />
            </div>

            {userHasRated && typeof userRatingValue === 'number' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-mono text-pine-deep dark:text-silver tabular-nums">
                <Check className="w-3.5 h-3.5" strokeWidth={2} />
                <span>Ваша оцінка: {userRatingValue.toFixed(1)}</span>
              </span>
            )}
          </div>

          <div className="rounded-xl bg-paper-warm dark:bg-night-hover focus-within:ring-1 focus-within:ring-pine/30 dark:focus-within:ring-white/25 transition-all">
            <textarea
              rows={2}
              maxLength={1500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                activeRating !== null
                  ? 'Додайте коментар до вашої оцінки (або підтвердьте саму оцінку)...'
                  : 'Напишіть коментар...'
              }
              className="w-full bg-transparent px-3.5 pt-3 pb-1 text-sm text-ink dark:text-cream placeholder:text-ink-subtle dark:placeholder:text-[#8E8A80] focus:outline-none resize-none"
            />
            <div className="flex items-center justify-end px-2.5 pb-2">
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-pine text-white dark:bg-cream dark:text-ink hover:opacity-90 active:scale-[0.97] transition-all cursor-pointer disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap shrink-0"
              >
                {hasSelectedRating && !hasComment ? (
                  <Check className="w-3 h-3" strokeWidth={2.2} />
                ) : (
                  <Send className="w-3 h-3" strokeWidth={1.9} />
                )}
                <span>{submitLabel}</span>
              </button>
            </div>
          </div>

          {statusMessage && (
            <p
              className={`text-xs font-medium ${
                statusMessage.isError ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-800 dark:text-silver'
              }`}
            >
              {statusMessage.text}
            </p>
          )}
        </form>
      )}

      {actionStatus && (
        <div
          className={`p-2.5 rounded-xl text-xs font-medium flex items-center justify-between gap-2 ${
            actionStatus.isError
              ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/40'
              : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40'
          }`}
        >
          <span>{actionStatus.text}</span>
          <button
            type="button"
            onClick={() => setActionStatus(null)}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Existing Reviews List */}
      {localReviews.length > 0 &&
        (shouldVirtualize ? (
          <div className="h-[460px] w-full overflow-hidden">
            <List
              rowCount={localReviews.length}
              rowHeight={dynamicRowHeight}
              rowComponent={ReviewRow}
              rowProps={reviewRowProps}
              overscanCount={4}
              className="h-full w-full overflow-x-hidden pr-1"
            />
          </div>
        ) : (
          <div className={compact ? 'space-y-2.5' : 'space-y-3'}>
            {localReviews.map((rev) => {
              const canModify = Boolean(
                isAdmin ||
                  (guestUser &&
                    (rev.authorUid === guestUser.uid ||
                      (guestUser.firebaseUid && rev.authorUid === guestUser.firebaseUid)))
              );
              return (
                <ReviewCard
                  key={rev.id}
                  rev={rev}
                  compact={compact}
                  canModify={canModify}
                  isEditing={editingReviewId === rev.id}
                  editCommentText={editCommentText}
                  editSubmitting={editSubmitting}
                  editError={editError}
                  isConfirmingDelete={confirmDeleteId === rev.id}
                  deleteSubmitting={deleteSubmittingId === rev.id}
                  onStartEdit={stableStartEdit}
                  onCancelEdit={stableCancelEdit}
                  onEditTextChange={setEditCommentText}
                  onSaveEdit={stableSaveEdit}
                  onToggleConfirmDelete={stableToggleConfirmDelete}
                  onConfirmDelete={stableConfirmDelete}
                />
              );
            })}
          </div>
        ))}
    </div>
  );
});
