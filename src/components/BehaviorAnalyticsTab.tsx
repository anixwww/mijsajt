import {
  Activity,
  BarChart3,
  Clock,
  LogOut,
  MousePointerClick,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AuthorAnalyticsReport } from '../types.ts';

interface BehaviorAnalyticsTabProps {
  getAdminToken: () => Promise<string | null>;
}

function formatDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  if (sec < 60) return `${sec} с`;
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  if (mins < 60) return `${mins} хв ${rem.toString().padStart(2, '0')} с`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours} год ${remMins} хв`;
}

function categoryLabel(category: string): string {
  switch (category) {
    case 'section':
      return 'Навігація';
    case 'poem':
    case 'content':
      return 'Твір / Контент';
    case 'prose':
      return 'Проза';
    case 'blog':
      return 'Блог';
    case 'product':
    case 'store':
      return 'Крамниця';
    case 'action':
      return 'Дія';
    default:
      return category;
  }
}

export function BehaviorAnalyticsTab({ getAdminToken }: BehaviorAnalyticsTabProps) {
  const [report, setReport] = useState<AuthorAnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const token = await getAdminToken();
      if (!token) {
        setErrorMsg('Потрібна активна сесія адміністратора.');
        return;
      }
      const res = await fetch('/api/author/analytics', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Не вдалося завантажити статистику.');
        return;
      }
      setReport(data as AuthorAnalyticsReport);
    } catch {
      setErrorMsg('Помилка з’єднання із сервером.');
    } finally {
      setLoading(false);
    }
  }, [getAdminToken]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const handleResetAnalytics = async () => {
    setResetting(true);
    setErrorMsg(null);
    try {
      const token = await getAdminToken();
      if (!token) return;
      const res = await fetch('/api/author/analytics', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setErrorMsg('Не вдалося скинути статистику.');
        return;
      }
      setConfirmReset(false);
      await loadAnalytics();
    } catch {
      setErrorMsg('Помилка з’єднання під час скидання.');
    } finally {
      setResetting(false);
    }
  };

  if (loading && !report) {
    return (
      <div className="bg-white border border-[#E4E1DA] rounded-xl p-8 space-y-4">
        <div className="h-5 w-48 bg-[#EFECE6] rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-[#F7F6F2] rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-44 bg-[#F7F6F2] rounded-lg animate-pulse" />
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="bg-white border border-[#E4E1DA] rounded-xl p-8 text-center space-y-3">
        <p className="text-sm font-medium text-[#881337]">{errorMsg}</p>
        <button
          type="button"
          onClick={loadAnalytics}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#141413] hover:bg-[#881337] rounded-md cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Спробувати ще раз</span>
        </button>
      </div>
    );
  }

  if (!report) return null;

  const { summary, clicks, dwell, exits, recentEvents } = report;
  const hasAnyData =
    summary.totalSessions > 0 ||
    summary.totalClicks > 0 ||
    summary.totalExits > 0 ||
    dwell.length > 0;

  const maxClicks = clicks[0]?.clicks || 1;
  const maxDwellSec = dwell[0]?.totalSeconds || 1;
  const maxExits = exits[0]?.exits || 1;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-serif text-2xl font-semibold text-[#141413]">
            Поведінка читачів та покупців
          </h4>
          <p className="text-xs text-[#5C5C58]">
            Реальні дані: на що клікають, де затримуються найдовше та після якого моменту залишають сайт.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadAnalytics}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#141413] bg-white border border-[#D4D4CE] hover:border-[#141413] rounded-md cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Оновити</span>
          </button>

          {hasAnyData && (
            confirmReset ? (
              <div className="inline-flex items-center gap-1.5 bg-white border border-[#881337]/30 rounded-md px-2.5 py-1.5">
                <span className="text-[11px] font-medium text-[#881337]">Очистити?</span>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={handleResetAnalytics}
                  className="px-2 py-0.5 text-[11px] font-semibold text-white bg-[#881337] rounded cursor-pointer disabled:opacity-60"
                >
                  Так
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-2 py-0.5 text-[11px] text-[#5C5C58] hover:text-[#141413] cursor-pointer"
                >
                  Ні
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#5C5C58] hover:text-[#881337] bg-white border border-[#D4D4CE] hover:border-[#881337] rounded-md cursor-pointer whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Скинути</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-[#E4E1DA] rounded-xl p-4">
          <p className="text-xs text-[#5C5C58] mb-1">Сесій відстежено</p>
          <p className="font-mono text-2xl font-semibold text-[#141413] tabular-nums">
            {summary.totalSessions}
          </p>
        </div>

        <div className="bg-white border border-[#E4E1DA] rounded-xl p-4">
          <p className="text-xs text-[#5C5C58] mb-1">Кліків усього</p>
          <p className="font-mono text-2xl font-semibold text-[#141413] tabular-nums">
            {summary.totalClicks}
          </p>
        </div>

        <div className="bg-white border border-[#E4E1DA] rounded-xl p-4">
          <p className="text-xs text-[#5C5C58] mb-1">Середній час на сайті</p>
          <p className="font-mono text-2xl font-semibold text-[#1E3A29] tabular-nums">
            {formatDuration(summary.avgSessionSeconds)}
          </p>
        </div>

        <div className="bg-white border border-[#E4E1DA] rounded-xl p-4">
          <p className="text-xs text-[#5C5C58] mb-1">Зафіксовано виходів</p>
          <p className="font-mono text-2xl font-semibold text-[#881337] tabular-nums">
            {summary.totalExits}
          </p>
        </div>
      </div>

      {!hasAnyData ? (
        <div className="bg-white border border-[#E4E1DA] rounded-xl p-10 text-center space-y-2">
          <BarChart3 className="w-8 h-8 text-[#5C5C58] mx-auto" strokeWidth={1.5} />
          <p className="font-serif text-2xl text-[#141413]">Ще немає зібраних подій</p>
          <p className="text-xs text-[#5C5C58] max-w-md mx-auto leading-relaxed">
            Щойно відвідувачі почнуть відкривати розділи, гортати вірші, затримуватися на сторінках чи виходити з сайту — тут з’явиться детальна аналітика.
          </p>
        </div>
      ) : (
        <>
          {/* Three Core Behavior Question Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            {/* 1. На що клікають */}
            <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E4E1DA]">
                <div className="flex items-center gap-2">
                  <MousePointerClick className="w-4 h-4 text-[#881337]" strokeWidth={1.75} />
                  <h5 className="font-serif text-lg font-semibold text-[#141413]">
                    На що клікають
                  </h5>
                </div>
                <span className="font-mono text-xs text-[#5C5C58] tabular-nums">
                  {clicks.length} поз.
                </span>
              </div>

              {clicks.length === 0 ? (
                <p className="text-xs text-[#5C5C58]">Кліки ще не зафіксовані.</p>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {clicks.map((item) => {
                    const widthPct = Math.max(6, Math.round((item.clicks / maxClicks) * 100));
                    return (
                      <div key={item.targetKey} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="font-medium text-[#141413] truncate" title={item.label}>
                            {item.label}
                          </span>
                          <span className="font-mono font-semibold text-[#141413] tabular-nums shrink-0">
                            {item.clicks}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[#5C5C58]">
                          <span>{categoryLabel(item.category)}</span>
                        </div>
                        <div className="h-1.5 bg-[#EFECE6] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#881337] rounded-full"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 2. На чому затримуються */}
            <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E4E1DA]">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#1E3A29]" strokeWidth={1.75} />
                  <h5 className="font-serif text-lg font-semibold text-[#141413]">
                    На чому затримуються
                  </h5>
                </div>
                <span className="font-mono text-xs text-[#5C5C58] tabular-nums">
                  {formatDuration(summary.totalTrackedSeconds)}
                </span>
              </div>

              {dwell.length === 0 ? (
                <p className="text-xs text-[#5C5C58]">
                  Затримки (від 2 секунд на елементі) ще не зафіксовані.
                </p>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {dwell.map((item) => {
                    const widthPct = Math.max(6, Math.round((item.totalSeconds / maxDwellSec) * 100));
                    return (
                      <div key={item.targetKey} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="font-medium text-[#141413] truncate" title={item.label}>
                            {item.label}
                          </span>
                          <span className="font-mono font-semibold text-[#1E3A29] tabular-nums shrink-0">
                            {formatDuration(item.totalSeconds)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[#5C5C58] tabular-nums">
                          <span>Середнє: {formatDuration(item.avgSeconds)}</span>
                          <span>Макс: {formatDuration(item.maxSeconds)} · {item.sessionsCount} раз.</span>
                        </div>
                        <div className="h-1.5 bg-[#EFECE6] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#1E3A29] rounded-full"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 3. Після якого моменту виходять з сайту */}
            <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E4E1DA]">
                <div className="flex items-center gap-2">
                  <LogOut className="w-4 h-4 text-[#881337]" strokeWidth={1.75} />
                  <h5 className="font-serif text-lg font-semibold text-[#141413]">
                    Момент виходу з сайту
                  </h5>
                </div>
                <span className="font-mono text-xs text-[#5C5C58] tabular-nums">
                  {summary.totalExits} вих.
                </span>
              </div>

              {exits.length === 0 ? (
                <p className="text-xs text-[#5C5C58]">
                  Виходи фіксуються, коли читач закриває вкладку або переходить в інший додаток.
                </p>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {exits.map((item) => {
                    const widthPct = Math.max(6, Math.round((item.exits / maxExits) * 100));
                    return (
                      <div key={item.momentKey} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="font-medium text-[#141413] truncate" title={item.label}>
                            {item.label}
                          </span>
                          <span className="font-mono font-semibold text-[#881337] tabular-nums shrink-0">
                            {item.exits} ({item.sharePercent}%)
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[#5C5C58] tabular-nums">
                          <span>Сесія перед виходом: ~{formatDuration(item.avgSessionSeconds)}</span>
                        </div>
                        <div className="h-1.5 bg-[#EFECE6] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#141413] rounded-full"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Recent Visitor Actions Table */}
          {recentEvents.length > 0 && (
            <section className="bg-white border border-[#E4E1DA] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E4E1DA] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#5C5C58]" strokeWidth={1.75} />
                  <h5 className="font-serif text-lg font-semibold text-[#141413]">
                    Останні дії відвідувачів
                  </h5>
                </div>
                <span className="text-xs text-[#5C5C58] font-mono tabular-nums">
                  {recentEvents.length} подій
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E4E1DA] bg-[#F7F6F2] text-[#5C5C58]">
                      <th className="py-2.5 px-4 font-medium">Час</th>
                      <th className="py-2.5 px-4 font-medium">Тип</th>
                      <th className="py-2.5 px-4 font-medium">Елемент або момент</th>
                      <th className="py-2.5 px-4 font-medium text-right">Тривалість</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E1DA]">
                    {recentEvents.slice(0, 20).map((ev) => {
                      const typeLabel =
                        ev.type === 'click'
                          ? 'Клік'
                          : ev.type === 'dwell'
                            ? 'Затримка'
                            : 'Вихід';
                      const typeColor =
                        ev.type === 'click'
                          ? 'text-[#141413]'
                          : ev.type === 'dwell'
                            ? 'text-[#1E3A29]'
                            : 'text-[#881337]';
                      return (
                        <tr key={ev.id} className="hover:bg-[#F7F6F2]/70 transition-colors">
                          <td className="py-2.5 px-4 font-mono text-[#5C5C58] tabular-nums whitespace-nowrap">
                            {new Date(ev.createdAt).toLocaleTimeString('uk-UA', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </td>
                          <td className={`py-2.5 px-4 font-medium whitespace-nowrap ${typeColor}`}>
                            {typeLabel}
                          </td>
                          <td className="py-2.5 px-4 text-[#141413] max-w-md truncate" title={ev.label}>
                            {ev.label}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-[#5C5C58] tabular-nums text-right whitespace-nowrap">
                            {typeof ev.durationSeconds === 'number'
                              ? formatDuration(ev.durationSeconds)
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
