import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, MessageSquare, Reply, Send, X } from 'lucide-react';
import type { FeedbackRecord, GuestUser } from '../types.ts';
import {
  markSiteFeedbackReadByUserInFirestore,
  mergeSiteFeedbackLists,
} from '../utils/feedbackFirestore.ts';

interface SiteFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  guestUser?: GuestUser | null;
  getGuestToken?: (forceRefresh?: boolean) => Promise<string | null>;
  items?: FeedbackRecord[];
  onItemsChange?: (items: FeedbackRecord[]) => void;
  onRepliesMarkedRead?: () => void;
}

function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat('uk-UA', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export function SiteFeedbackModal({
  isOpen,
  onClose,
  guestUser,
  getGuestToken,
  items: externalItems,
  onItemsChange,
  onRepliesMarkedRead,
}: SiteFeedbackModalProps) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localItems, setLocalItems] = useState<FeedbackRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const items = externalItems !== undefined ? externalItems : localItems;

  const updateItems = (next: FeedbackRecord[]) => {
    setLocalItems(next);
    onItemsChange?.(next);
  };

  // Fetch user's feedback thread & mark unread admin replies as read when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    const markUnreadRepliesRead = async (currentList: FeedbackRecord[]) => {
      const unread = currentList.filter(
        (row) => Boolean(row.adminReply?.trim()) && row.readByUser === false
      );
      if (unread.length === 0) return;

      const nowIso = new Date().toISOString();
      const marked = currentList.map((row) =>
        Boolean(row.adminReply?.trim()) && row.readByUser === false
          ? { ...row, readByUser: true, updatedAt: nowIso }
          : row
      );
      if (active) {
        updateItems(marked);
        onRepliesMarkedRead?.();
      }

      try {
        const token = await getGuestToken?.();
        if (token) {
          await fetch('/api/feedback/my/read', {
            method: 'PATCH',
            credentials: 'include',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
        }
      } catch {
        // Ignore transient mark-read failure
      }

      for (const row of unread) {
        if (row.firebaseUid) {
          void markSiteFeedbackReadByUserInFirestore(row.id);
        }
      }
    };

    const syncMyFeedback = async () => {
      if (!guestUser?.uid) {
        if (externalItems && externalItems.length > 0) {
          void markUnreadRepliesRead(externalItems);
        }
        return;
      }

      setLoadingHistory(true);
      try {
        const token = await getGuestToken?.();
        const headers: Record<string, string> = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch('/api/feedback/my', {
          credentials: 'include',
          headers,
        });
        if (!active || !res.ok) return;
        const data = (await res.json()) as { feedback?: FeedbackRecord[] };
        const fetched = Array.isArray(data.feedback) ? data.feedback : [];
        const merged = mergeSiteFeedbackLists(fetched, externalItems ?? localItems);
        if (active) {
          updateItems(merged);
        }
        await markUnreadRepliesRead(merged);
      } catch {
        // Keep cached/realtime items visible
      } finally {
        if (active) {
          setLoadingHistory(false);
        }
      }
    };

    void syncMyFeedback();

    return () => {
      active = false;
    };
  }, [isOpen, guestUser?.uid]);

  useEffect(() => {
    if (!isOpen) {
      setSuccessNotice(null);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!message.trim()) {
      setError('Будь ласка, введіть ваш відгук або пропозицію.');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      setSuccessNotice(null);
      const token = await getGuestToken?.();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          message: message.trim(),
          displayName: guestUser?.displayName?.trim() || 'Анонім',
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        record?: FeedbackRecord;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Не вдалося надіслати відгук.');
      }
      if (data.record) {
        updateItems(mergeSiteFeedbackLists([data.record], items));
      }
      setMessage('');
      setSuccessNotice(
        guestUser
          ? 'Дякуємо! Відгук надіслано — відповідь автора з’явиться тут.'
          : 'Дякуємо! Ваш відгук успішно надіслано.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Помилка надсилання відгуку';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[88vh] flex flex-col bg-[#202020] rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#323232] flex items-center justify-center text-[#E5E5E5]">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#FAF9F5] tracking-tight">
                Відгук про сайт
              </h2>
              <p className="text-[11px] text-[#A6A196]">
                Пропозиції та відповіді автора
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="w-8 h-8 rounded-xl hover:bg-white/10 flex items-center justify-center text-[#FAF9F5]/70 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 pb-6 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400 text-xs text-center">
                {error}
              </div>
            )}

            {successNotice && (
              <div className="p-2.5 rounded-xl bg-[#2C5937]/25 text-[#D8F3DC] text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successNotice}</span>
              </div>
            )}

            <div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Опишіть ваші враження або побажання щодо функціоналу, дизайну чи контенту..."
                rows={3}
                maxLength={2000}
                required
                aria-label="Текст відгуку про сайт"
                className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-[#2A2A2A] focus:bg-[#323232] text-[#FAF9F5] placeholder:text-[#7E7B73] focus:outline-none transition-colors resize-none"
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              {!guestUser ? (
                <p className="text-[11px] text-[#8A867E]">
                  Увійдіть в акаунт, щоб отримувати відповіді автора тут.
                </p>
              ) : (
                <span className="text-[11px] text-[#8A867E] truncate">
                  Від імені: {guestUser.displayName}
                </span>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#E5E5E5] text-[#181818] hover:opacity-95 transition-opacity flex items-center gap-1.5 cursor-pointer disabled:opacity-55 shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{submitting ? 'Надсилання...' : 'Надіслати'}</span>
              </button>
            </div>
          </form>

          {(items.length > 0 || loadingHistory) && (
            <div className="pt-3 border-t border-white/10 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-[#FAF9F5]/85">
                  Ваші відгуки та відповіді автора
                </h3>
                {loadingHistory && (
                  <span className="text-[11px] text-[#8A867E]">Синхронізація...</span>
                )}
              </div>

              <div className="space-y-2.5">
                {items.map((item) => {
                  const hasReply = Boolean(item.adminReply?.trim());
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl bg-[#282828] p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[#9E9A90]">
                        <span className="font-mono tabular-nums">
                          {formatDateTime(item.createdAt)}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            hasReply
                              ? 'bg-[#2C5937]/30 text-[#B7E4C7]'
                              : 'bg-white/8 text-[#B5B1A8]'
                          }`}
                        >
                          {hasReply ? 'Є відповідь автора' : 'Очікує перегляду'}
                        </span>
                      </div>

                      <p className="text-xs text-[#FAF9F5]/90 leading-relaxed whitespace-pre-wrap">
                        {item.message}
                      </p>

                      {hasReply && (
                        <div className="pl-3 py-2 pr-2.5 rounded-lg bg-[#1C1C1C] border-l-2 border-[#6B9E78] space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="inline-flex items-center gap-1 font-semibold text-[#D8F3DC]">
                              <Reply className="w-3 h-3" />
                              <span>{item.adminReplyAuthorName || 'Андрій Даньків'}</span>
                            </span>
                            {item.adminReplyAt && (
                              <span className="font-mono text-[10px] text-[#8A867E] tabular-nums">
                                {formatDateTime(item.adminReplyAt)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#E5E2DA] leading-relaxed whitespace-pre-wrap">
                            {item.adminReply}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
