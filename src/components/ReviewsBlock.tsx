import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { MessageSquare, Send, Star, User } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase.ts';
import type { GuestUser, Poem, ReviewItem, StoreProduct } from '../types.ts';
import { trackClick } from '../utils/analytics.ts';
import { SwipeStarRating } from './SwipeStarRating.tsx';

interface ReviewsBlockProps {
  targetType: 'poem' | 'product';
  targetId: string;
  ratingAverage: number;
  ratingCount: number;
  userRating?: number | null;
  reviews: ReviewItem[];
  guestUser: GuestUser | null;
  onReviewSubmitted: (payload: { poem?: Poem; product?: StoreProduct }) => void;
}

export function ReviewsBlock({
  targetType,
  targetId,
  ratingAverage,
  ratingCount,
  userRating = null,
  reviews,
  guestUser,
  onReviewSubmitted,
}: ReviewsBlockProps) {
  const [selectedRating, setSelectedRating] = useState<number>(userRating ?? 5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  useEffect(() => {
    setSelectedRating(userRating ?? 5);
    setComment('');
    setStatusMessage(null);
  }, [targetId, userRating]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const trimmedComment = comment.trim();
    const isSignedInGuest = Boolean(guestUser);
    const effectiveAuthorName = isSignedInGuest ? guestUser!.displayName.trim().slice(0, 80) : 'Анонім';
    const effectiveAuthorUid = isSignedInGuest ? guestUser!.uid : 'anon';

    trackClick(
      `review:${targetType}:${targetId}`,
      trimmedComment.length > 0 ? 'Відгук з оцінкою' : 'Оцінка без коментаря',
      'action'
    );
    setSubmitting(true);
    setStatusMessage(null);
    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType,
          targetId,
          rating: selectedRating,
          comment: trimmedComment,
          isAnonymous: !isSignedInGuest,
          authorUid: effectiveAuthorUid,
          authorName: effectiveAuthorName,
          authorPhotoUrl: isSignedInGuest ? guestUser?.photoUrl : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatusMessage({ text: data.error || 'Не вдалося додати оцінку.', isError: true });
        return;
      }

      if (isSignedInGuest && auth.currentUser && auth.currentUser.emailVerified && data.review?.id) {
        const safeAuthorName = guestUser!.displayName.trim().slice(0, 80) || 'Гість';
        const safeComment = trimmedComment.slice(0, 1500);
        try {
          await setDoc(doc(db, 'reviews', data.review.id), {
            id: data.review.id,
            targetType,
            targetId,
            authorUid: auth.currentUser.uid,
            authorName: safeAuthorName,
            rating: data.review.rating,
            comment: safeComment,
            createdAt: serverTimestamp(),
          });
        } catch (fsErr) {
          try {
            handleFirestoreError(fsErr, OperationType.CREATE, `reviews/${data.review.id}`);
          } catch {}
        }
      }

      onReviewSubmitted({ poem: data.poem, product: data.product });
      setComment('');
      if (data.ratingOnly) {
        setStatusMessage({
          text: data.updatedRating
            ? `Вашу оцінку оновлено до ${selectedRating.toFixed(1)}/5.0.`
            : `Дякуємо! Оцінку ${selectedRating.toFixed(1)}/5.0 збережено без коментаря.`,
        });
      } else {
        setStatusMessage({
          text: isSignedInGuest
            ? 'Дякуємо! Ваш відгук та оцінку опубліковано.'
            : 'Дякуємо! Анонімний відгук та оцінку опубліковано.',
        });
      }
    } catch {
      setStatusMessage({ text: 'Помилка з’єднання із сервером.', isError: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pt-8 border-t border-[#0D0D0C]/16 dark:border-[#252522] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <MessageSquare className="w-4 h-4 text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.6} />
          <h4 className="font-serif text-2xl font-semibold text-[#0D0D0C] dark:text-[#F2F1EC]">
            Оцінки та коментарі
          </h4>
        </div>

        <div className="flex items-center gap-1.5 text-xs font-mono text-[#6B6B65] dark:text-[#94948C] tabular-nums">
          {ratingCount > 0 ? (
            <>
              <Star className="w-3.5 h-3.5 fill-current text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.75} />
              <span>
                {ratingAverage.toFixed(1)} / 5.0 · {ratingCount} оц. · {reviews.length} комент.
              </span>
            </>
          ) : (
            <span>Ще немає оцінок</span>
          )}
        </div>
      </div>

      {/* Rating & Comment Form */}
      <form
        onSubmit={handleSubmit}
        className="p-5 bg-white dark:bg-[#141412] border border-[#0D0D0C]/16 dark:border-[#252522] space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#6B6B65] dark:text-[#94948C]">
              Автор:
            </span>
            {guestUser ? (
              <strong className="text-[#0D0D0C] dark:text-[#F2F1EC]">
                {guestUser.displayName}
              </strong>
            ) : (
              <span className="text-[#6B6B65] dark:text-[#94948C]">
                <strong className="text-[#0D0D0C] dark:text-[#F2F1EC] font-medium">Анонім</strong>
                {' '}· увійдіть через Google у меню на головній, щоб коментувати від свого імені
              </span>
            )}
          </div>

          <SwipeStarRating
            value={selectedRating}
            onChange={setSelectedRating}
            size="md"
            showHint
            ariaLabel="Оберіть оцінку свайпом від 0.1 до 5.0"
          />
        </div>

        <textarea
          rows={2}
          maxLength={1500}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Коментар (необов’язково — оцінку можна надіслати без коментаря)..."
          className="w-full px-3.5 py-2.5 text-sm bg-[#F5F4EF] dark:bg-[#0B0B0A] text-[#0D0D0C] dark:text-[#F2F1EC] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
        />

        {statusMessage && (
          <p
            className={`text-xs font-medium ${
              statusMessage.isError
                ? 'text-rose-700 dark:text-rose-400'
                : 'text-[#1E4631] dark:text-[#4E946C]'
            }`}
          >
            {statusMessage.text}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="ml-auto inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-[#0D0D0C] dark:bg-[#F2F1EC] dark:text-[#0D0D0C] hover:bg-[#1E4631] dark:hover:bg-[#2D6A4F] dark:hover:text-white disabled:opacity-60 transition-colors cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {submitting
                ? 'Надсилання...'
                : comment.trim().length > 0
                  ? 'Опублікувати коментар'
                  : 'Надіслати оцінку'}
            </span>
          </button>
        </div>
      </form>

      {/* Existing Comments List */}
      {reviews.length > 0 && (
        <div className="divide-y divide-[#0D0D0C]/14 dark:divide-[#252522] border-t border-b border-[#0D0D0C]/14 dark:border-[#252522]">
          {reviews.map((rev) => (
            <div key={rev.id} className="py-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {rev.authorPhotoUrl ? (
                    <img
                      src={rev.authorPhotoUrl}
                      alt={rev.authorName}
                      referrerPolicy="no-referrer"
                      className="w-6 h-6 object-cover grayscale"
                    />
                  ) : (
                    <span className="w-6 h-6 bg-[#ECEAE2] dark:bg-[#1E1E1B] flex items-center justify-center text-[#6B6B65] dark:text-[#94948C]">
                      <User className="w-3.5 h-3.5" />
                    </span>
                  )}
                  <span className="text-xs font-semibold text-[#0D0D0C] dark:text-[#F2F1EC]">
                    {rev.authorName || 'Анонім'}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-[#6B6B65] dark:text-[#94948C] font-mono tabular-nums">
                  <span className="inline-flex items-center gap-1 text-[#0D0D0C] dark:text-[#F2F1EC] font-medium">
                    <Star className="w-3.5 h-3.5 fill-current text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.75} />
                    <span>{rev.rating.toFixed(1)}/5.0</span>
                  </span>
                  <span aria-hidden="true">/</span>
                  <span>
                    {new Date(rev.createdAt).toLocaleDateString('uk-UA', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </div>
              </div>

              {rev.comment && (
                <p className="text-sm text-[#3A3A36] dark:text-[#C8C7C0] leading-relaxed pl-8">
                  {rev.comment}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
