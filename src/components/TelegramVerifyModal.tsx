import { CheckCircle2, ExternalLink, RefreshCw, Send, ShieldCheck, X } from 'lucide-react';
import { m } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TelegramSubscriptionState } from '../types.ts';

interface TelegramVerifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  discountPercent: number;
  subscription: TelegramSubscriptionState;
  onVerified: (next: TelegramSubscriptionState) => void;
  onClearVerification: () => void;
}

interface ChallengePayload {
  configured: boolean;
  code?: string;
  botUsername?: string;
  deepLinkUrl?: string;
  channelUrl: string;
  channelLabel: string;
  error?: string;
}

export function TelegramVerifyModal({
  isOpen,
  onClose,
  discountPercent,
  subscription,
  onVerified,
  onClearVerification,
}: TelegramVerifyModalProps) {
  const [loadingChallenge, setLoadingChallenge] = useState(false);
  const [challenge, setChallenge] = useState<ChallengePayload | null>(null);
  const [checking, setChecking] = useState(false);
  const [recheckingStatus, setRecheckingStatus] = useState(false);
  const [statusNote, setStatusNote] = useState<{ kind: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [botOpened, setBotOpened] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  const loadChallenge = useCallback(async () => {
    setLoadingChallenge(true);
    setStatusNote(null);
    setBotOpened(false);
    try {
      const res = await fetch('/api/telegram/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json()) as ChallengePayload;
      setChallenge(data);
      if (!res.ok && data.error) {
        setStatusNote({ kind: 'error', text: data.error });
      }
    } catch {
      setStatusNote({
        kind: 'error',
        text: 'Не вдалося з’єднатися із сервером для створення коду перевірки.',
      });
    } finally {
      setLoadingChallenge(false);
    }
  }, []);

  const verifyCode = useCallback(
    async (silent = false) => {
      if (!challenge?.code) return;
      if (!silent) {
        setChecking(true);
        setStatusNote(null);
      }
      try {
        const res = await fetch('/api/telegram/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: challenge.code }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          status?: 'pending' | 'not_subscribed' | 'verified' | 'expired' | 'invalid';
          subscription?: TelegramSubscriptionState;
          error?: string;
        };

        if (data.status === 'verified' && data.subscription?.subscribed) {
          setStatusNote({
            kind: 'success',
            text: `Підписку підтверджено! Знижка −${discountPercent}% у розділі «Проза» активована.`,
          });
          onVerified(data.subscription);
          return;
        }

        if (data.status === 'not_subscribed') {
          setStatusNote({
            kind: 'error',
            text:
              data.error ||
              'Ви ще не підписалися на канал. Підпишіться та натисніть «Перевірити підписку» ще раз.',
          });
          return;
        }

        if (data.status === 'expired' || data.status === 'invalid') {
          setStatusNote({
            kind: 'error',
            text: data.error || 'Код перевірки застарів. Натисніть «Оновити код».',
          });
          setChallenge((prev) => (prev ? { ...prev, code: undefined, deepLinkUrl: undefined } : prev));
          return;
        }

        if (!silent && data.status === 'pending') {
          setStatusNote({
            kind: 'info',
            text: 'Очікуємо запуску бота в Telegram. Відкрийте бота та натисніть «Start / Розпочати».',
          });
        }
      } catch {
        if (!silent) {
          setStatusNote({
            kind: 'error',
            text: 'Помилка перевірки підписки. Спробуйте ще раз.',
          });
        }
      } finally {
        if (!silent) {
          setChecking(false);
        }
      }
    },
    [challenge?.code, discountPercent, onVerified]
  );

  const handleRecheckExisting = async () => {
    if (!subscription.token) return;
    setRecheckingStatus(true);
    setStatusNote(null);
    try {
      const res = await fetch('/api/telegram/status?fresh=1', {
        headers: { 'X-Telegram-Discount-Token': subscription.token },
      });
      const data = (await res.json()) as {
        subscription?: TelegramSubscriptionState;
        unsubscribedNotice?: string;
      };
      if (data.subscription?.subscribed) {
        onVerified({
          ...data.subscription,
          token: subscription.token,
        });
        setStatusNote({
          kind: 'success',
          text: 'Підписка активна, знижка діє.',
        });
      } else {
        onClearVerification();
        setStatusNote({
          kind: 'error',
          text: data.unsubscribedNotice || 'Підписку на канал не знайдено. Підтвердіть її повторно.',
        });
        void loadChallenge();
      }
    } catch {
      setStatusNote({
        kind: 'error',
        text: 'Не вдалося перевірити статус підписки.',
      });
    } finally {
      setRecheckingStatus(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setStatusNote(null);
    if (!subscription.subscribed) {
      void loadChallenge();
    }
  }, [isOpen, subscription.subscribed, loadChallenge]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || subscription.subscribed || !challenge?.configured || !challenge?.code) {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    const intervalMs = botOpened ? 2200 : 3500;
    pollTimerRef.current = window.setInterval(() => {
      void verifyCode(true);
    }, intervalMs);

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isOpen, subscription.subscribed, challenge?.configured, challenge?.code, botOpened, verifyCode]);

  if (!isOpen) return null;

  const channelUrl = subscription.channelUrl || challenge?.channelUrl || 'https://t.me/andriidankiv';
  const channelLabel = subscription.channelLabel || challenge?.channelLabel || '@andriidankiv';
  const subscriberHandle = subscription.telegramUser?.username
    ? `@${subscription.telegramUser.username}`
    : subscription.telegramUser?.firstName || 'Підписник';

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-50 bg-ink/55 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tg-verify-modal-title"
    >
      <m.div
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-paper dark:bg-night-panel rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-4 bg-paper-warm dark:bg-night-card flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-[#E6ECE7] dark:bg-night-elevated text-pine-deep dark:text-silver inline-flex items-center justify-center shrink-0">
              <Send className="w-4 h-4" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h3
                id="tg-verify-modal-title"
                className="text-base font-semibold text-ink dark:text-cream-soft truncate"
              >
                Знижка −{discountPercent}% за підписку
              </h3>
              <p className="text-xs text-ink-muted dark:text-sandstone truncate">
                Перевірка підписки на Telegram {channelLabel}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити вікно перевірки Telegram"
            className="w-9 h-9 rounded-lg inline-flex items-center justify-center text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft hover:bg-paper-warm dark:hover:bg-night-elevated transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {subscription.subscribed ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#ECF3EE] dark:bg-night-card space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-pine-deep dark:text-silver">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Підписку підтверджено</span>
                </div>
                <p className="text-xs text-[#344038] dark:text-[#D4D4D4] leading-relaxed">
                  Акаунт <span className="font-mono font-semibold">{subscriberHandle}</span> підписаний на канал{' '}
                  <a
                    href={channelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 font-medium"
                  >
                    {channelLabel}
                  </a>
                  . У розділі «Проза» для вас автоматично діє знижка −{discountPercent}% на платні твори.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <button
                  type="button"
                  onClick={handleRecheckExisting}
                  disabled={recheckingStatus}
                  className="btn-editorial-secondary min-h-[42px] px-4 py-2 text-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${recheckingStatus ? 'animate-spin' : ''}`} />
                  <span>{recheckingStatus ? 'Перевірка...' : 'Перевірити повторно'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClearVerification();
                    void loadChallenge();
                  }}
                  className="text-xs font-medium text-ink-muted dark:text-sandstone hover:text-rose-700 dark:hover:text-rose-400 px-2 py-2 cursor-pointer transition-colors"
                >
                  Відв’язати акаунт
                </button>
              </div>
            </div>
          ) : loadingChallenge ? (
            <div className="py-6 text-center text-xs text-ink-muted dark:text-sandstone">
              Готуємо одноразовий код перевірки...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-white dark:bg-night-card flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink dark:text-cream-soft">
                      Крок 1. Підпишіться на канал
                    </p>
                    <p className="text-[11px] text-ink-muted dark:text-sandstone mt-0.5 truncate">
                      {channelLabel}
                    </p>
                  </div>
                  <a
                    href={channelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-editorial-secondary min-h-[40px] px-3.5 py-2 text-xs shrink-0"
                  >
                    <span>Відкрити канал</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {challenge?.configured && challenge?.deepLinkUrl ? (
                  <div className="p-3.5 rounded-xl bg-white dark:bg-night-card space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink dark:text-cream-soft">
                          Крок 2. Підтвердіть у боті
                        </p>
                        <p className="text-[11px] text-ink-muted dark:text-sandstone mt-0.5">
                          Натисніть «Start / Розпочати» в боті @{challenge.botUsername}
                        </p>
                      </div>
                      <a
                        href={challenge.deepLinkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setBotOpened(true)}
                        className="btn-editorial-primary min-h-[40px] px-3.5 py-2 text-xs shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Підтвердити</span>
                      </a>
                    </div>

                    <div className="pt-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-ink-muted dark:text-stone-warm truncate">
                        Код: {challenge.code}
                      </span>
                      <button
                        type="button"
                        onClick={() => void verifyCode(false)}
                        disabled={checking}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-pine dark:text-silver hover:underline underline-offset-4 cursor-pointer shrink-0"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                        <span>{checking ? 'Перевірка...' : 'Перевірити підписку'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-white dark:bg-night-card space-y-2">
                    <p className="text-xs font-semibold text-ink dark:text-cream-soft flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-pine dark:text-silver shrink-0" />
                      <span>Перевірка підписки через бота</span>
                    </p>
                    <p className="text-[11px] text-ink-muted dark:text-sandstone leading-relaxed">
                      Автоматична перевірка стане доступною щойно автор підключить токен Telegram-бота на сервері.
                    </p>
                  </div>
                )}
              </div>

              {!challenge?.code && challenge?.configured !== false && !loadingChallenge && (
                <button
                  type="button"
                  onClick={() => void loadChallenge()}
                  className="btn-editorial-secondary w-full min-h-[42px] text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Оновити код перевірки</span>
                </button>
              )}
            </div>
          )}

          {statusNote && (
            <p
              role="status"
              className={`text-xs leading-relaxed ${
                statusNote.kind === 'success'
                  ? 'text-pine-deep dark:text-silver font-medium'
                  : statusNote.kind === 'error'
                    ? 'text-rose-700 dark:text-rose-400'
                    : 'text-ink-muted dark:text-sandstone'
              }`}
            >
              {statusNote.text}
            </p>
          )}
        </div>
      </m.div>
    </m.div>
  );
}
