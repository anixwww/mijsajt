import {
  Check,
  CheckCheck,
  MessageSquare,
  Pencil,
  Reply,
  Send,
  Trash2,
  User,
} from 'lucide-react';
import { useState } from 'react';
import type { FeedbackRecord } from '../../types.ts';
import { STUDIO_INPUT_CLASS, type GetAuthHeadersFn } from './studioShared.ts';

type FeedbackFilter = 'all' | 'unreplied' | 'replied';

interface StudioFeedbackTabProps {
  items: FeedbackRecord[];
  setItems: (updater: FeedbackRecord[] | ((prev: FeedbackRecord[]) => FeedbackRecord[])) => void;
  getAuthHeaders: GetAuthHeadersFn;
  setFeedback: (msg: string | null) => void;
}

function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Intl.DateTimeFormat('uk-UA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export function StudioFeedbackTab({
  items,
  setItems,
  getAuthHeaders,
  setFeedback,
}: StudioFeedbackTabProps) {
  const [filter, setFilter] = useState<FeedbackFilter>('all');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [editingReplyIds, setEditingReplyIds] = useState<Record<string, boolean>>({});
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});

  const unrepliedCount = items.filter((item) => !item.adminReply?.trim()).length;
  const repliedCount = items.filter((item) => Boolean(item.adminReply?.trim())).length;

  const filteredItems = items.filter((item) => {
    if (filter === 'unreplied') return !item.adminReply?.trim();
    if (filter === 'replied') return Boolean(item.adminReply?.trim());
    return true;
  });

  const handleSendReply = async (item: FeedbackRecord, overrideText?: string) => {
    const rawText = overrideText !== undefined ? overrideText : replyDrafts[item.id] ?? '';
    const trimmed = rawText.trim();
    if (overrideText === undefined && !trimmed) {
      setFeedback('Введіть текст відповіді користувачеві.');
      return;
    }

    setBusyIds((prev) => ({ ...prev, [item.id]: true }));
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;

      const res = await fetch(`/api/author/feedback/${encodeURIComponent(item.id)}/reply`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reply: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося зберегти відповідь.');
        return;
      }

      if (data.record) {
        setItems((prev) => prev.map((row) => (row.id === item.id ? data.record : row)));
      }
      setEditingReplyIds((prev) => ({ ...prev, [item.id]: false }));
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setFeedback(trimmed ? 'Відповідь надіслано користувачеві.' : 'Відповідь видалено.');
    } catch {
      setFeedback('Не вдалося надіслати відповідь.');
    } finally {
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const handleMarkRead = async (item: FeedbackRecord) => {
    setBusyIds((prev) => ({ ...prev, [item.id]: true }));
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch(`/api/author/feedback/${encodeURIComponent(item.id)}/read`, {
        method: 'PATCH',
        headers,
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.record) {
        setItems((prev) => prev.map((row) => (row.id === item.id ? data.record : row)));
      }
    } finally {
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const handleDelete = async (item: FeedbackRecord) => {
    setBusyIds((prev) => ({ ...prev, [item.id]: true }));
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch(`/api/author/feedback/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        setFeedback('Не вдалося видалити відгук.');
        return;
      }
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      setFeedback('Відгук видалено.');
    } catch {
      setFeedback('Не вдалося видалити відгук.');
    } finally {
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const openInlineEditor = (item: FeedbackRecord) => {
    setEditingReplyIds((prev) => ({ ...prev, [item.id]: true }));
    setReplyDrafts((prev) => ({
      ...prev,
      [item.id]: prev[item.id] ?? item.adminReply ?? '',
    }));
  };

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header summary + Filter controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F5F4EE] dark:bg-[#181818]">
          {(
            [
              { id: 'all', label: `Усі (${items.length})` },
              { id: 'unreplied', label: `Без відповіді (${unrepliedCount})` },
              { id: 'replied', label: `З відповіддю (${repliedCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-white dark:bg-[#323232] text-[#141413] dark:text-[#F4F1EA] font-semibold shadow-2xs'
                  : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
          Відповіді синхронізуються та відображаються користувачеві у формі «Відгук про сайт»
        </p>
      </div>

      {filteredItems.length === 0 ? (
        <div className="py-12 text-center space-y-2 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl">
          <MessageSquare
            className="w-7 h-7 text-[#5C5C58] dark:text-[#A6A196] mx-auto"
            strokeWidth={1.5}
          />
          <p className="text-sm font-medium text-[#141413] dark:text-[#EDEAE1]">
            {items.length === 0
              ? 'Відгуків про сайт поки немає'
              : 'У цьому фільтрі відгуків немає'}
          </p>
          <p className="text-xs text-[#5C5C58] dark:text-[#A6A196]">
            Повідомлення користувачів із кнопки «Відгук про сайт» з’являтимуться тут.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const hasReply = Boolean(item.adminReply?.trim());
            const isEditingReply = Boolean(editingReplyIds[item.id]);
            const showReplyComposer = !hasReply || isEditingReply;
            const isBusy = Boolean(busyIds[item.id]);
            const draftValue = replyDrafts[item.id] ?? '';
            const isUnread = !item.readByAdmin && !hasReply;

            return (
              <article
                key={item.id}
                className={`p-4 sm:p-5 rounded-xl space-y-3 transition-colors ${
                  isUnread
                    ? 'bg-[#F2F6EE] dark:bg-[#2E2E2E]'
                    : 'bg-[#FAF9F5] dark:bg-[#262626]'
                }`}
              >
                {/* Top Row: User Info + Date + Actions */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {item.authorPhotoUrl ? (
                      <img
                        src={item.authorPhotoUrl}
                        alt={item.displayName}
                        referrerPolicy="no-referrer"
                        className="w-8 h-8 rounded-full object-cover shrink-0 bg-[#EAE7DF] dark:bg-[#323232]"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#EAE7DF] dark:bg-[#323232] flex items-center justify-center text-[#5C5C58] dark:text-[#C4BFB4] shrink-0">
                        <User className="w-4 h-4" strokeWidth={1.75} />
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1] truncate">
                          {item.displayName}
                        </span>
                        {item.contact && (
                          <span className="text-[11px] text-[#5C5C58] dark:text-[#A6A196] truncate">
                            · {item.contact}
                          </span>
                        )}
                        {isUnread && (
                          <span className="px-1.5 py-0.5 rounded bg-[#2C5937]/12 dark:bg-white/12 text-[#2C5937] dark:text-[#F4F1EA] text-[10px] font-semibold">
                            Новий
                          </span>
                        )}
                        {hasReply && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#EAE7DF] dark:bg-[#353535] text-[#2C5937] dark:text-[#D5D1C8] text-[10px] font-medium">
                            <Check className="w-2.5 h-2.5" />
                            <span>Відповідь надіслано</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-[#5C5C58] dark:text-[#A6A196] tabular-nums">
                        {formatDateTime(item.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isUnread && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleMarkRead(item)}
                        className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-white dark:bg-[#202020] text-[#2C5937] dark:text-[#E5E5E5] hover:opacity-90 cursor-pointer whitespace-nowrap disabled:opacity-50"
                      >
                        Прочитано
                      </button>
                    )}

                    {hasReply && !isEditingReply && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openInlineEditor(item)}
                        title="Редагувати відповідь"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-white dark:bg-[#202020] text-[#5C5C58] dark:text-[#C4BFB4] hover:text-[#141413] dark:hover:text-[#F4F1EA] cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Змінити відповідь</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDelete(item)}
                      title="Видалити відгук"
                      aria-label="Видалити відгук"
                      className="p-1.5 rounded-lg text-rose-700 dark:text-rose-400 hover:bg-rose-700/10 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* User Message Body */}
                <p className="text-xs sm:text-[13px] text-[#2B2B28] dark:text-[#E5E2DA] leading-relaxed whitespace-pre-wrap">
                  {item.message}
                </p>

                {/* Existing Admin Reply Display (when not editing) */}
                {hasReply && !isEditingReply && (
                  <div className="ml-2 sm:ml-4 pl-3.5 py-2.5 pr-3 rounded-xl bg-white/80 dark:bg-[#202020] border-l-2 border-[#2C5937] dark:border-[#9CA3AF] space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-1.5 font-semibold text-[#1E3A29] dark:text-[#F4F1EA]">
                        <Reply className="w-3 h-3" />
                        <span>{item.adminReplyAuthorName || 'Андрій Даньків'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[#5C5C58] dark:text-[#A6A196]">
                        {item.adminReplyAt && (
                          <span className="font-mono tabular-nums">
                            {formatDateTime(item.adminReplyAt)}
                          </span>
                        )}
                        {item.guestUid || item.firebaseUid ? (
                          <span
                            title={
                              item.readByUser
                                ? 'Користувач переглянув відповідь'
                                : 'Користувач ще не відкривав відповідь'
                            }
                            className="inline-flex items-center gap-0.5 text-[10px]"
                          >
                            <CheckCheck
                              className={`w-3 h-3 ${
                                item.readByUser
                                  ? 'text-[#2C5937] dark:text-emerald-400'
                                  : 'opacity-50'
                              }`}
                            />
                            <span>{item.readByUser ? 'Переглянуто' : 'Не переглянуто'}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-xs text-[#2B2B28] dark:text-[#D5D1C8] leading-relaxed whitespace-pre-wrap">
                      {item.adminReply}
                    </p>
                  </div>
                )}

                {/* Inline Direct Reply Composer inside the feedback card */}
                {showReplyComposer && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSendReply(item);
                    }}
                    className="pt-1 space-y-2"
                  >
                    <textarea
                      value={draftValue}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      placeholder={
                        hasReply
                          ? 'Оновіть вашу відповідь користувачеві...'
                          : 'Відповісти прямо на цей відгук...'
                      }
                      rows={2}
                      maxLength={2000}
                      className={`${STUDIO_INPUT_CLASS} text-xs resize-y min-h-[58px]`}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {!item.guestUid && !item.firebaseUid ? (
                        <span className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                          Анонімний відгук (відповідь збережеться у базі)
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                          Користувач побачить відповідь у розділі «Відгук про сайт»
                        </span>
                      )}

                      <div className="flex items-center gap-2 ml-auto">
                        {isEditingReply && (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleSendReply(item, '')}
                              className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-700/10 cursor-pointer disabled:opacity-50"
                            >
                              Прибрати відповідь
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                setEditingReplyIds((prev) => ({ ...prev, [item.id]: false }))
                              }
                              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white dark:bg-[#202020] text-[#5C5C58] dark:text-[#C4BFB4] hover:opacity-90 cursor-pointer"
                            >
                              Скасувати
                            </button>
                          </>
                        )}

                        <button
                          type="submit"
                          disabled={isBusy || !draftValue.trim()}
                          className="btn-editorial-primary py-1.5 px-3.5 text-xs disabled:opacity-45"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>
                            {isBusy
                              ? 'Надсилання...'
                              : hasReply
                                ? 'Зберегти відповідь'
                                : 'Відповісти'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
