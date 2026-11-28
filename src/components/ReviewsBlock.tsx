/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Check, Loader2, MessageSquare, Pencil, Send, Star, Trash2, User, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
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
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-5 h-5 rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <span className="w-5 h-5 rounded-full bg-[#EFECE6] dark:bg-[#323232] flex items-center justify-center text-[#5C5C58] dark:text-[#A8A49B] shrink-0">
      <User className="w-3 h-3" />
    </span>
  );
}

export function ReviewsBlock({
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
      let token = (await getGuestToken?.()) || guestUser?.sessionToken || null;
      if (token?.startsWith('guest_v1.') && getGuestToken) {
        const refreshed = await getGuestToken(true);
        if (refreshed) token = refreshed;
      }
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  const handleSaveEdit = async (reviewId: string) => {
    const clean = editCommentText.trim();
    if (!clean) {
      setEditError('Коментар не може бути порожнім.');
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      let token = (await getAdminToken?.()) || (await getGuestToken?.()) || guestUser?.sessionToken || null;
      const res = await fetch(`/api/reviews/${reviewId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ comment: clean }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || 'Не вдалося відредагувати коментар.');
        return;
      }
      setLocalReviews((prev) =>
        prev.map((r) => (r.id === reviewId ? { ...r, comment: clean } : r))
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
      let token = (await getAdminToken?.()) || (await getGuestToken?.()) || guestUser?.sessionToken || null;
      const res = await fetch(`/api/reviews/${reviewId}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
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
            <MessageSquare className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5]" strokeWidth={1.75} />
            <h4 className="font-serif text-2xl font-semibold tracking-[-0.01em] text-[#141413] dark:text-[#F4F1EA]">
              Оцінки та відгуки
            </h4>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-mono text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
            {ratingCount > 0 ? (
              <>
                <Star className="w-3.5 h-3.5 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                <span>
                  <strong className="text-[#141413] dark:text-[#F4F1EA] font-semibold">{ratingAverage.toFixed(1)}</strong> / 5.0 · {ratingCount}
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
              ? 'px-4 py-4 rounded-xl bg-[#F7F6F2] dark:bg-[#262626] flex flex-col items-center text-center gap-3'
              : 'p-5 bg-white dark:bg-[#262626] rounded-2xl flex flex-col items-center text-center gap-3'
          }
        >
          <p className="text-xs sm:text-sm text-[#444440] dark:text-[#C5C1B8]">
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
          className={compact ? 'space-y-3' : 'p-5 bg-white dark:bg-[#262626] rounded-2xl space-y-4'}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[200px]">
              <label htmlFor={`guest-name-${targetId}`} className="text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] shrink-0">
                Від імені:
              </label>
              <strong className="text-xs font-semibold text-[#141413] dark:text-[#F4F1EA]">{guestUser.displayName}</strong>
              <UserRankBadges badges={guestUser.badges} size="xs" />
            </div>

            {userHasRated && typeof userRatingValue === 'number' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-mono text-[#1E563B] dark:text-[#E5E5E5] tabular-nums">
                <Check className="w-3.5 h-3.5" strokeWidth={2} />
                <span>Ваша оцінка: {userRatingValue.toFixed(1)}</span>
              </span>
            )}
          </div>

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
            className="input-editorial"
          />

          {statusMessage && (
            <p
              className={`text-xs font-medium ${
                statusMessage.isError ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-800 dark:text-[#E5E5E5]'
              }`}
            >
              {statusMessage.text}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-editorial-primary px-5 py-2.5 disabled:opacity-45 disabled:pointer-events-none"
            >
              {hasSelectedRating && !hasComment ? (
                <Check className="w-3.5 h-3.5" strokeWidth={2} />
              ) : (
                <Send className="w-3.5 h-3.5" strokeWidth={1.8} />
              )}
              <span>{submitLabel}</span>
            </button>
          </div>
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
      {localReviews.length > 0 && (
        <div className={compact ? 'space-y-2.5' : 'space-y-3'}>
          {localReviews.map((rev) => {
            const canModify = Boolean(
              isAdmin ||
                (guestUser &&
                  (rev.authorUid === guestUser.uid ||
                    (guestUser.firebaseUid && rev.authorUid === guestUser.firebaseUid)))
            );
            const isEditing = editingReviewId === rev.id;
            const isConfirmingDelete = confirmDeleteId === rev.id;

            return (
              <div
                key={rev.id}
                className={
                  compact
                    ? 'p-3.5 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl space-y-1.5'
                    : 'p-4 bg-white dark:bg-[#262626] rounded-xl space-y-2'
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <ReviewAvatar photoUrl={rev.authorPhotoUrl} name={rev.authorName} />
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="text-xs font-semibold text-[#141413] dark:text-[#F4F1EA] truncate max-w-full">
                        {rev.authorName}
                      </span>
                      <UserRankBadges badges={rev.authorBadges} size="xs" />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-[#5C5C58] dark:text-[#A8A49B] font-mono tabular-nums">
                    {typeof rev.rating === 'number' && (
                      <>
                        <span className="inline-flex items-center gap-1 text-[#141413] dark:text-[#F4F1EA] font-medium">
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

                    {/* Admin or comment author actions */}
                    {canModify && !isEditing && (
                      <div className="flex items-center gap-1 ml-1.5 pl-1.5 border-l border-black/10 dark:border-white/10">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(rev)}
                          title="Редагувати коментар"
                          aria-label="Редагувати коментар"
                          className="p-1 rounded text-[#7A7870] hover:text-[#141413] dark:text-[#A6A196] dark:hover:text-[#F4F1EA] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(isConfirmingDelete ? null : rev.id)}
                          title="Видалити коментар"
                          aria-label="Видалити коментар"
                          className="p-1 rounded text-[#7A7870] hover:text-rose-600 dark:text-[#A6A196] dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
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
                        disabled={deleteSubmittingId === rev.id}
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-1 rounded-md bg-white/70 dark:bg-black/30 hover:bg-white dark:hover:bg-black/50 transition-colors cursor-pointer"
                      >
                        Скасувати
                      </button>
                      <button
                        type="button"
                        disabled={deleteSubmittingId === rev.id}
                        onClick={() => void handleDelete(rev.id)}
                        className="px-2.5 py-1 rounded-md bg-rose-600 text-white font-semibold hover:bg-rose-700 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {deleteSubmittingId === rev.id ? 'Видалення...' : 'Так, видалити'}
                      </button>
                    </div>
                  </div>
                )}

                {isEditing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSaveEdit(rev.id);
                    }}
                    className="mt-2 space-y-2 pt-1"
                  >
                    <textarea
                      rows={2}
                      maxLength={1500}
                      value={editCommentText}
                      onChange={(e) => setEditCommentText(e.target.value)}
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
                        onClick={handleCancelEdit}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#7A7870] dark:text-[#A6A196] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
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
                  <p className="text-sm text-[#444440] dark:text-[#C5C1B8] leading-relaxed whitespace-pre-wrap">
                    {rev.comment}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
