import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getProseEffectivePriceUah } from '../../types.ts';
import {
  STUDIO_INPUT_CLASS,
  STUDIO_INPUT_SM_CLASS,
  STUDIO_LABEL_CLASS,
  type GetAuthHeadersFn,
} from './studioShared.ts';

export interface TelegramAdminHealth {
  botConfigured: boolean;
  botUsername: string | null;
  botFirstName?: string | null;
  tokenSource?: 'admin' | 'env' | 'none';
  hasStoredToken?: boolean;
  maskedToken?: string | null;
  channelInput?: string;
  socialTelegramUrl?: string;
  channelChatId: string;
  channelUrl: string;
  channelLabel: string;
  channelTitle?: string | null;
  channelAccessible: boolean;
  webhookActive?: boolean;
  webhookUrl?: string | null;
  webhookPendingCount?: number;
  webhookError?: string | null;
  proseTelegramDiscountPercent?: number;
  error: string | null;
}

interface StudioTelegramTabProps {
  proseTelegramDiscountDraft: string;
  setProseTelegramDiscountDraft: (val: string) => void;
  getAuthHeaders: GetAuthHeadersFn;
  setFeedback: (msg: string | null) => void;
  onCatalogUpdated: () => void;
}

export function StudioTelegramTab({
  proseTelegramDiscountDraft,
  setProseTelegramDiscountDraft,
  getAuthHeaders,
  setFeedback,
  onCatalogUpdated,
}: StudioTelegramTabProps) {
  const [health, setHealth] = useState<TelegramAdminHealth | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  const [botTokenDraft, setBotTokenDraft] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [channelInputDraft, setChannelInputDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [clearingToken, setClearingToken] = useState(false);
  const [savingChannelSettings, setSavingChannelSettings] = useState(false);
  const [configuringWebhook, setConfiguringWebhook] = useState(false);

  const applyHealthState = useCallback(
    (data: TelegramAdminHealth, syncInputs: boolean) => {
      setHealth(data);
      if (syncInputs) {
        setChannelInputDraft(data.channelInput || '');
        if (typeof data.proseTelegramDiscountPercent === 'number') {
          setProseTelegramDiscountDraft(String(data.proseTelegramDiscountPercent));
        }
      }
    },
    [setProseTelegramDiscountDraft]
  );

  const loadHealth = useCallback(
    async (syncInputs = true) => {
      setLoadingHealth(true);
      try {
        const headers = await getAuthHeaders();
        if (!headers) return;
        const res = await fetch('/api/author/telegram-health', { headers });
        const data = (await res.json()) as TelegramAdminHealth & { error?: string };
        if (!res.ok) {
          setFeedback(data.error || 'Не вдалося завантажити статус Telegram-бота.');
          return;
        }
        applyHealthState(data, syncInputs);
      } catch {
        setFeedback('Помилка з’єднання під час перевірки Telegram-бота.');
      } finally {
        setLoadingHealth(false);
      }
    },
    [getAuthHeaders, applyHealthState, setFeedback]
  );

  useEffect(() => {
    void loadHealth(true);
  }, [loadHealth]);

  const handleSaveToken = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = botTokenDraft.trim();
    if (!trimmed) {
      setFeedback('Вставте токен Telegram-бота від @BotFather.');
      return;
    }

    setSavingToken(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch('/api/author/telegram-settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          botToken: trimmed,
        }),
      });
      const data = (await res.json()) as TelegramAdminHealth & { ok?: boolean; error?: string };
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося зберегти токен Telegram-бота.');
        return;
      }
      applyHealthState(data, false);
      setBotTokenDraft('');
      setShowToken(false);
      onCatalogUpdated();
      setFeedback(
        data.botUsername
          ? `Токен збережено — підключено бота @${data.botUsername}.`
          : 'Токен Telegram-бота збережено.'
      );
    } catch {
      setFeedback('Помилка під час збереження токена Telegram-бота.');
    } finally {
      setSavingToken(false);
    }
  };

  const handleClearToken = async () => {
    setClearingToken(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch('/api/author/telegram-settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          clearBotToken: true,
        }),
      });
      const data = (await res.json()) as TelegramAdminHealth & { ok?: boolean; error?: string };
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося видалити збережений токен.');
        return;
      }
      applyHealthState(data, false);
      setBotTokenDraft('');
      onCatalogUpdated();
      setFeedback('Збережений токен Telegram-бота видалено.');
    } catch {
      setFeedback('Помилка під час видалення токена.');
    } finally {
      setClearingToken(false);
    }
  };

  const handleSaveChannelAndDiscount = async (e: FormEvent) => {
    e.preventDefault();
    setSavingChannelSettings(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const parsedDiscount = Math.max(
        0,
        Math.min(90, Math.round(Number(proseTelegramDiscountDraft) || 0))
      );
      const res = await fetch('/api/author/telegram-settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          channelId: channelInputDraft.trim(),
          proseTelegramDiscountPercent: parsedDiscount,
        }),
      });
      const data = (await res.json()) as TelegramAdminHealth & { ok?: boolean; error?: string };
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося зберегти налаштування Telegram-каналу.');
        return;
      }
      applyHealthState(data, true);
      onCatalogUpdated();
      setFeedback('Налаштування Telegram-каналу та знижки збережено.');
    } catch {
      setFeedback('Помилка під час збереження налаштувань Telegram-каналу.');
    } finally {
      setSavingChannelSettings(false);
    }
  };

  const handleToggleWebhook = async (enabled: boolean) => {
    setConfiguringWebhook(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const res = await fetch('/api/author/telegram-webhook', {
        method: 'POST',
        headers,
        body: JSON.stringify({ enabled }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        webhookActive?: boolean;
        webhookUrl?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося налаштувати Telegram Webhook.');
        return;
      }
      setFeedback(
        data.webhookActive
          ? 'Telegram Webhook увімкнено — перевірка підписок працюватиме миттєво.'
          : 'Telegram Webhook вимкнено (перевірка через опитування API).'
      );
      await loadHealth(false);
    } catch {
      setFeedback('Помилка під час налаштування Telegram Webhook.');
    } finally {
      setConfiguringWebhook(false);
    }
  };

  const isFullyReady = Boolean(health?.botConfigured && health?.channelAccessible);

  return (
    <div className="max-w-3xl space-y-6">
      {/* Live Status Overview */}
      <div className="p-4 sm:p-5 rounded-xl bg-paper dark:bg-night-card space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                isFullyReady
                  ? 'bg-[#E6F2EA] dark:bg-night-elevated text-pine-deep dark:text-silver'
                  : 'bg-paper-warm dark:bg-night-elevated text-ink-muted dark:text-sandstone'
              }`}
            >
              <Send className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h5 className="text-sm font-semibold text-ink dark:text-cream-soft">
                Стан підключення Telegram-бота
              </h5>
              <p className="text-xs text-ink-muted dark:text-sandstone truncate">
                {health?.botConfigured && health.botUsername
                  ? `Бот @${health.botUsername} підключений`
                  : 'Бот ще не підключений'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadHealth(false)}
            disabled={loadingHealth}
            className="btn-editorial-secondary py-1.5 px-3 text-xs shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? 'animate-spin' : ''}`} />
            <span>Оновити статус</span>
          </button>
        </div>

        {health && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <div className="px-3 py-2.5 rounded-lg bg-white dark:bg-night-panel">
              <p className="text-[11px] text-ink-muted dark:text-sandstone">Бот</p>
              <p className="mt-0.5 text-xs font-medium text-ink dark:text-cream-soft flex items-center gap-1.5">
                {health.botConfigured ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-pine dark:text-silver shrink-0" />
                    <span className="truncate">@{health.botUsername}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Не налаштовано</span>
                  </>
                )}
              </p>
            </div>

            <div className="px-3 py-2.5 rounded-lg bg-white dark:bg-night-panel">
              <p className="text-[11px] text-ink-muted dark:text-sandstone">Канал</p>
              <p className="mt-0.5 text-xs font-medium text-ink dark:text-cream-soft flex items-center gap-1.5">
                {health.channelAccessible ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-pine dark:text-silver shrink-0" />
                    <span className="truncate">{health.channelLabel}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="truncate">
                      {health.channelChatId ? `${health.channelLabel} (немає прав)` : 'Не вказано'}
                    </span>
                  </>
                )}
              </p>
            </div>

            <div className="px-3 py-2.5 rounded-lg bg-white dark:bg-night-panel">
              <p className="text-[11px] text-ink-muted dark:text-sandstone">Режим оновлень</p>
              <p className="mt-0.5 text-xs font-medium text-ink dark:text-cream-soft flex items-center gap-1.5">
                <Webhook className="w-3.5 h-3.5 text-pine dark:text-silver shrink-0" />
                <span>{health.webhookActive ? 'Webhook активний' : 'Опитування API'}</span>
              </p>
            </div>
          </div>
        )}

        {health?.error && (
          <div className="px-3 py-2.5 rounded-lg bg-amber-50/90 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{health.error}</span>
          </div>
        )}
      </div>

      {/* Bot Token Form */}
      <form
        onSubmit={handleSaveToken}
        className="p-4 sm:p-5 rounded-xl bg-paper dark:bg-night-card space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h5 className="text-sm font-semibold text-ink dark:text-cream-soft flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-pine dark:text-silver" />
              <span>Токен Telegram-бота (від @BotFather)</span>
            </h5>
            <p className="text-xs text-ink-muted dark:text-sandstone mt-0.5">
              Токен зберігається виключно на сервері та у захищеній адмін-конфігурації — читачам він недоступний.
            </p>
          </div>

          {health?.maskedToken && (
            <span className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-paper-warm dark:bg-night-elevated text-[#3E4C42] dark:text-[#D4D4D4]">
              {health.tokenSource === 'admin' ? 'У кабінеті: ' : 'Із сервера: '}
              {health.maskedToken}
            </span>
          )}
        </div>

        <div>
          <label htmlFor="tg-bot-token-input" className={STUDIO_LABEL_CLASS}>
            {health?.hasStoredToken ? 'Замінити токен бота' : 'Вставте токен бота'}
          </label>
          <div className="relative">
            <input
              id="tg-bot-token-input"
              type={showToken ? 'text' : 'password'}
              value={botTokenDraft}
              onChange={(e) => setBotTokenDraft(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="1234567890:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className={`${STUDIO_INPUT_CLASS} pr-10 font-mono text-xs`}
            />
            <button
              type="button"
              onClick={() => setShowToken((prev) => !prev)}
              aria-label={showToken ? 'Приховати токен' : 'Показати токен'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-ink-muted dark:text-sandstone hover:text-ink dark:hover:text-cream-soft cursor-pointer"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="submit"
            disabled={savingToken || !botTokenDraft.trim()}
            className="btn-editorial-primary py-2 px-4 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{savingToken ? 'Перевірка та збереження...' : 'Перевірити й зберегти токен'}</span>
          </button>

          {health?.hasStoredToken && (
            <button
              type="button"
              onClick={() => void handleClearToken()}
              disabled={clearingToken}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/50 cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{clearingToken ? 'Видалення...' : 'Видалити збережений токен'}</span>
            </button>
          )}
        </div>
      </form>

      {/* Channel & Discount Settings */}
      <form
        onSubmit={handleSaveChannelAndDiscount}
        className="p-4 sm:p-5 rounded-xl bg-paper dark:bg-night-card space-y-4"
      >
        <div>
          <h5 className="text-sm font-semibold text-ink dark:text-cream-soft">
            Канал для перевірки підписки та знижка у «Прозі»
          </h5>
          <p className="text-xs text-ink-muted dark:text-sandstone mt-0.5">
            За замовчуванням використовується Telegram із розділу «Контакти»
            {health?.socialTelegramUrl ? ` (${health.socialTelegramUrl})` : ''}. Тут можна вказати інший канал або числовий ID.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="sm:col-span-2">
            <label htmlFor="tg-channel-input" className={STUDIO_LABEL_CLASS}>
              Канал (@username, посилання t.me/... або ID -100...)
            </label>
            <input
              id="tg-channel-input"
              type="text"
              maxLength={200}
              value={channelInputDraft}
              onChange={(e) => setChannelInputDraft(e.target.value)}
              placeholder={health?.socialTelegramUrl || 'https://t.me/andriidankiv або @andriidankiv'}
              className={`${STUDIO_INPUT_CLASS} font-mono text-xs`}
            />
          </div>

          <div>
            <label htmlFor="tg-discount-input" className={STUDIO_LABEL_CLASS}>
              Знижка у «Прозі» (0–90%)
            </label>
            <div className="flex items-center gap-2.5">
              <div className="relative w-24 shrink-0">
                <input
                  id="tg-discount-input"
                  type="number"
                  min={0}
                  max={90}
                  step={1}
                  value={proseTelegramDiscountDraft}
                  onChange={(e) => setProseTelegramDiscountDraft(e.target.value)}
                  className={`${STUDIO_INPUT_SM_CLASS} py-2 pr-7 font-mono tabular-nums`}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-ink-muted">
                  %
                </span>
              </div>
              {Number(proseTelegramDiscountDraft) > 0 && (
                <span className="text-xs font-mono tabular-nums text-pine-deep dark:text-silver whitespace-nowrap">
                  100 ₴ →{' '}
                  {getProseEffectivePriceUah(100, Number(proseTelegramDiscountDraft) || 0, true)} ₴
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="submit"
            disabled={savingChannelSettings}
            className="btn-editorial-primary py-2 px-4 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{savingChannelSettings ? 'Збереження...' : 'Зберегти канал і знижку'}</span>
          </button>

          {health?.botConfigured && (
            <button
              type="button"
              onClick={() => void handleToggleWebhook(!health.webhookActive)}
              disabled={configuringWebhook}
              className="btn-editorial-secondary py-2 px-3.5 text-xs"
            >
              <Webhook className="w-3.5 h-3.5" />
              <span>
                {configuringWebhook
                  ? 'Налаштування...'
                  : health.webhookActive
                    ? 'Вимкнути webhook'
                    : 'Підключити webhook'}
              </span>
            </button>
          )}
        </div>

        {health?.webhookActive && health.webhookUrl && (
          <p className="text-[11px] font-mono text-ink-muted dark:text-sandstone break-all">
            Webhook URL: {health.webhookUrl}
          </p>
        )}
      </form>

      {/* Short Setup Steps */}
      <div className="p-4 rounded-xl bg-paper-oat/70 dark:bg-night-card text-xs text-ink-muted dark:text-sandstone space-y-1.5">
        <p className="font-semibold text-ink dark:text-cream-soft">Як швидко підключити:</p>
        <p>1. Відкрийте @BotFather у Telegram, створіть бота командою /newbot та скопіюйте токен.</p>
        <p>2. Вставте токен вище й натисніть «Перевірити й зберегти токен».</p>
        <p>
          3. Додайте вашого бота адміністратором каналу {health?.channelLabel || ''}, щоб він міг перевіряти підписку читачів.
        </p>
      </div>
    </div>
  );
}
