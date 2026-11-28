import {
  Activity,
  BarChart3,
  Clock,
  Compass,
  Eye,
  Globe,
  Laptop,
  LogOut,
  MousePointerClick,
  RefreshCw,
  Smartphone,
  Tablet,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type {
  AuthorAnalyticsReport,
  VisitBreakdownItem,
  VisitDeviceType,
  VisitPeriodKey,
  VisitPeriodReport,
} from '../types.ts';

interface BehaviorAnalyticsTabProps {
  getAdminToken: () => Promise<string | null>;
  uniqueVisitors: number;
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

function sectionTitleLabel(section: string): string {
  switch (section) {
    case 'home':
      return 'Головна';
    case 'poetry':
      return 'Вірші';
    case 'prose':
      return 'Проза';
    case 'blog':
      return 'Блог';
    case 'store':
      return 'Крамниця';
    case 'radio':
      return 'Радіо';
    default:
      return section;
  }
}

function renderDeviceIcon(deviceType: VisitDeviceType) {
  switch (deviceType) {
    case 'mobile':
      return <Smartphone className="w-3.5 h-3.5 text-pine dark:text-silver shrink-0" />;
    case 'tablet':
      return <Tablet className="w-3.5 h-3.5 text-pine dark:text-silver shrink-0" />;
    case 'desktop':
    case 'bot':
      return <Laptop className="w-3.5 h-3.5 text-ink-muted dark:text-sandstone-light shrink-0" />;
  }
}

function deviceShortLabel(deviceType: VisitDeviceType): string {
  switch (deviceType) {
    case 'mobile':
      return 'Смартфон';
    case 'tablet':
      return 'Планшет';
    case 'desktop':
      return 'Комп’ютер';
    case 'bot':
      return 'Бот';
  }
}

function formatDeltaBadge(delta: number | null) {
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-pine dark:text-silver">
        Нова активність
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="text-[11px] text-ink-muted dark:text-sandstone-light">
        Без змін до попереднього
      </span>
    );
  }
  const positive = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium tabular-nums ${
        positive
          ? 'text-pine-deep dark:text-silver'
          : 'text-rose-700 dark:text-rose-400'
      }`}
    >
      {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      <span>{positive ? `+${delta}%` : `${delta}%`}</span>
      <span className="text-ink-muted dark:text-sandstone-light font-normal">до попереднього</span>
    </span>
  );
}

function BreakdownBarList({
  items,
  emptyText,
  barClassName = 'bg-pear-pine-gradient',
}: {
  items: VisitBreakdownItem[];
  emptyText: string;
  barClassName?: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-ink-muted dark:text-sandstone-light">{emptyText}</p>;
  }
  const maxVisits = items[0]?.visits || 1;
  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const widthPct = Math.max(6, Math.round((item.visits / maxVisits) * 100));
        return (
          <div key={item.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-ink dark:text-cream truncate" title={item.label}>
                {item.label}
              </span>
              <span className="font-mono text-[11px] font-semibold text-ink dark:text-cream tabular-nums shrink-0">
                {item.visits}{' '}
                <span className="font-normal text-ink-muted dark:text-sandstone-light">
                  ({item.sharePercent}%)
                </span>
              </span>
            </div>
            <div className="h-1.5 bg-paper-warm dark:bg-night-elevated rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${barClassName}`} style={{ width: `${widthPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const PERIOD_TABS: Array<{ key: VisitPeriodKey; label: string; shortLabel: string }> = [
  { key: 'day', label: 'За добу (24 год)', shortLabel: 'Доба' },
  { key: 'week', label: 'За тиждень (7 днів)', shortLabel: 'Тиждень' },
  { key: 'month', label: 'За місяць (30 днів)', shortLabel: 'Місяць' },
];

export function BehaviorAnalyticsTab({ getAdminToken, uniqueVisitors }: BehaviorAnalyticsTabProps) {
  const [report, setReport] = useState<AuthorAnalyticsReport | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<VisitPeriodKey>('week');
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
    void loadAnalytics();
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
      <div className="bg-white dark:bg-night-card rounded-xl p-8 space-y-4">
        <div className="h-5 w-48 bg-paper-warm dark:bg-night-elevated rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-paper dark:bg-night-elevated rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-52 bg-paper dark:bg-night-elevated rounded-lg animate-pulse" />
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="bg-white dark:bg-night-card rounded-xl p-8 text-center space-y-3">
        <p className="text-sm font-medium text-rose-700 dark:text-rose-400">{errorMsg}</p>
        <button
          type="button"
          onClick={loadAnalytics}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-pear-pine-gradient rounded-md cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Спробувати ще раз</span>
        </button>
      </div>
    );
  }

  if (!report) return null;

  const { summary, visits, clicks, dwell, exits, recentEvents } = report;
  const activeVisitReport: VisitPeriodReport = visits[selectedPeriod];

  const hasAnyBehaviorData =
    summary.totalSessions > 0 ||
    summary.totalClicks > 0 ||
    summary.totalExits > 0 ||
    dwell.length > 0;

  const hasAnyVisitData =
    visits.day.totalVisits > 0 || visits.week.totalVisits > 0 || visits.month.totalVisits > 0;

  const maxClicks = clicks[0]?.clicks || 1;
  const maxDwellSec = dwell[0]?.totalSeconds || 1;
  const maxExits = exits[0]?.exits || 1;

  const newVisitorPct =
    activeVisitReport.totalVisits > 0
      ? Math.round((activeVisitReport.newVisitors / activeVisitReport.totalVisits) * 100)
      : 0;
  const returningVisitorPct =
    activeVisitReport.totalVisits > 0 ? 100 - newVisitorPct : 0;

  return (
    <div className="space-y-7">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-serif text-2xl font-semibold text-ink dark:text-cream">
            Статистика відвідувань та поведінки
          </h4>
          <p className="text-xs text-ink-muted dark:text-sandstone-light">
            Відвідуваність сайту за добу, тиждень і місяць (за київським часом), джерела, пристрої та дії читачів.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadAnalytics}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-ink dark:text-cream bg-paper dark:bg-night-card hover:bg-paper-warm dark:hover:bg-night-elevated rounded-lg cursor-pointer disabled:opacity-60 whitespace-nowrap transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Оновити</span>
          </button>

          {(hasAnyBehaviorData || hasAnyVisitData) &&
            (confirmReset ? (
              <div className="inline-flex items-center gap-1.5 bg-paper dark:bg-night-card rounded-lg px-2.5 py-1.5">
                <span className="text-[11px] font-medium text-rose-700 dark:text-rose-400">
                  Скинути статистику та перегляди?
                </span>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={handleResetAnalytics}
                  className="px-2.5 py-1 text-[11px] font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded cursor-pointer disabled:opacity-60"
                >
                  Скинути
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-2 py-1 text-[11px] text-ink-muted dark:text-sandstone-light hover:text-ink dark:hover:text-cream cursor-pointer"
                >
                  Скасувати
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-ink-muted dark:text-sandstone-light hover:text-rose-700 dark:hover:text-rose-400 bg-paper dark:bg-night-card hover:bg-paper-warm dark:hover:bg-night-elevated rounded-lg cursor-pointer whitespace-nowrap transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Скинути статистику</span>
              </button>
            ))}
        </div>
      </div>

      {/* Period Summary KPI Cards: Day, Week, Month & All-Time */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {PERIOD_TABS.map((tab) => {
          const periodData = visits[tab.key];
          const isSelected = selectedPeriod === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSelectedPeriod(tab.key)}
              className={`text-left rounded-xl p-4 transition-all cursor-pointer ${
                isSelected
                  ? 'bg-[#EEF3E8] dark:bg-night-elevated shadow-xs'
                  : 'bg-paper dark:bg-night-card hover:bg-paper-warm dark:hover:bg-night-hover'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-xs font-medium text-ink-muted dark:text-sandstone-light">{tab.label}</p>
                <Eye
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isSelected
                      ? 'text-pine dark:text-silver'
                      : 'text-stone-warm dark:text-parchment'
                  }`}
                />
              </div>
              <div className="flex items-baseline gap-2">
                <p className="font-mono text-2xl font-semibold text-ink dark:text-cream tabular-nums">
                  {periodData.totalVisits}
                </p>
                <span className="text-[11px] font-mono text-ink-muted dark:text-sandstone-light tabular-nums">
                  ({periodData.uniqueVisitors} ун.)
                </span>
              </div>
              <div className="mt-1.5">{formatDeltaBadge(periodData.deltaPercent)}</div>
            </button>
          );
        })}

        <div className="bg-paper dark:bg-night-card rounded-xl p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-xs font-medium text-ink-muted dark:text-sandstone-light">
              Усього за весь час
            </p>
            <Users className="w-3.5 h-3.5 text-pine dark:text-silver shrink-0" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="font-mono text-2xl font-semibold text-pine-dark dark:text-silver tabular-nums">
              {visits.allTimeUniqueVisitors || uniqueVisitors}
            </p>
            <span className="text-[11px] text-ink-muted dark:text-sandstone-light">унікальних</span>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-muted dark:text-sandstone-light tabular-nums">
            Середній час: <strong className="text-ink dark:text-cream">{formatDuration(summary.avgSessionSeconds)}</strong>
          </p>
        </div>
      </div>

      {/* PWA Installs & Repeat Visits Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-paper dark:bg-night-card rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-ink-muted dark:text-sandstone-light">
              Встановлень додатку на робочий стіл (PWA)
            </p>
            <p className="font-mono text-2xl font-semibold text-ink dark:text-cream tabular-nums mt-1">
              {report.pwaInstallsCount}
            </p>
          </div>
          <Laptop className="w-8 h-8 text-pine dark:text-silver opacity-75" strokeWidth={1.5} />
        </div>

        <div className="bg-paper dark:bg-night-card rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-ink-muted dark:text-sandstone-light">
              Повторність входу (повторні візити сьогодні)
            </p>
            <p className="font-mono text-2xl font-semibold text-pine-dark dark:text-silver tabular-nums mt-1">
              {visits.day.returningVisitors}
            </p>
          </div>
          <UserCheck className="w-8 h-8 text-pine-dark dark:text-silver opacity-75" strokeWidth={1.5} />
        </div>
      </div>

      {/* Interactive Period Visit Trend Chart */}
      <section className="bg-paper dark:bg-night-card rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h5 className="font-serif text-xl font-semibold text-ink dark:text-cream">
              Динаміка відвідувань: {activeVisitReport.label.toLowerCase()}
            </h5>
            <p className="text-xs text-ink-muted dark:text-sandstone-light mt-0.5">
              {selectedPeriod === 'day'
                ? 'Погодинна активність за останні 24 години (візити та унікальні відвідувачі).'
                : selectedPeriod === 'week'
                  ? 'Щоденна відвідуваність за останні 7 днів.'
                  : 'Щоденна відвідуваність за останні 30 днів.'}
            </p>
          </div>

          <div
            className="inline-flex items-center p-1 bg-paper-sand dark:bg-night-panel rounded-lg"
            role="tablist"
            aria-label="Період статистики відвідувань"
          >
            {PERIOD_TABS.map((tab) => {
              const active = selectedPeriod === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedPeriod(tab.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-night-elevated text-ink dark:text-cream shadow-xs font-semibold'
                      : 'text-ink-muted dark:text-sandstone-light hover:text-ink dark:hover:text-cream'
                  }`}
                >
                  {tab.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Highlight metrics strip for active period */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 px-4 bg-white dark:bg-night-panel rounded-xl text-xs">
          <div>
            <span className="text-ink-muted dark:text-sandstone-light block">Візитів за період</span>
            <span className="font-mono text-base font-semibold text-ink dark:text-cream tabular-nums">
              {activeVisitReport.totalVisits}
            </span>
          </div>
          <div>
            <span className="text-ink-muted dark:text-sandstone-light block">Унікальних гостей</span>
            <span className="font-mono text-base font-semibold text-pine dark:text-silver tabular-nums">
              {activeVisitReport.uniqueVisitors}
            </span>
          </div>
          <div>
            <span className="text-ink-muted dark:text-sandstone-light block">Нові / Повернулися</span>
            <span className="font-mono text-base font-semibold text-ink dark:text-cream tabular-nums">
              {activeVisitReport.newVisitors} / {activeVisitReport.returningVisitors}
            </span>
          </div>
          <div>
            <span className="text-ink-muted dark:text-sandstone-light block">Піковий момент</span>
            <span className="font-mono text-base font-semibold text-pine-dark dark:text-silver tabular-nums">
              {activeVisitReport.peakLabel
                ? `${activeVisitReport.peakLabel} (${activeVisitReport.peakVisits})`
                : '—'}
            </span>
          </div>
        </div>

        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={activeVisitReport.trend}
              margin={{ top: 10, right: 10, left: -22, bottom: 0 }}
            >
              <defs>
                <linearGradient id="authorVisitGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-pear)" stopOpacity={0.34} />
                  <stop offset="60%" stopColor="var(--accent-ink)" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="var(--accent-pine)" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="authorUniqueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-pine)" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="var(--accent-pine)" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" strokeOpacity={0.45} vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#8C887E"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                interval={selectedPeriod === 'month' ? 4 : selectedPeriod === 'day' ? 2 : 0}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const row = payload[0].payload as {
                      label: string;
                      visits: number;
                      uniqueVisitors: number;
                      newVisitors: number;
                      returningVisitors: number;
                    };
                    return (
                      <div className="bg-ink dark:bg-cream text-white dark:text-ink text-[11px] font-mono px-3 py-2 rounded-lg shadow-md space-y-0.5">
                        <p className="font-semibold">{row.label}</p>
                        <p>Візитів: {row.visits}</p>
                        <p>Унікальних: {row.uniqueVisitors}</p>
                        <p className="opacity-80">
                          Нових: {row.newVisitors} · Постійних: {row.returningVisitors}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area
                type="monotone"
                dataKey="visits"
                name="Візити"
                stroke="var(--accent-pear)"
                strokeWidth={2.25}
                fillOpacity={1}
                fill="url(#authorVisitGradient)"
              />
              <Area
                type="monotone"
                dataKey="uniqueVisitors"
                name="Унікальні"
                stroke="var(--accent-pine)"
                strokeWidth={1.75}
                strokeDasharray="4 3"
                fillOpacity={1}
                fill="url(#authorUniqueGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted dark:text-sandstone-light">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#6E9429] dark:bg-[#E0E0E0] inline-block" />
              <span>Усі візити</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-b-2 border-dashed border-pine dark:border-[#CCCCCC] inline-block" />
              <span>Унікальні відвідувачі</span>
            </span>
          </div>
          <span className="font-mono tabular-nums">
            Попередній аналогічний період: {activeVisitReport.previousPeriodVisits} віз.
          </span>
        </div>
      </section>

      {/* Detailed Visit Breakdown Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
        {/* 1. Нові vs Постійні + ОС */}
        <section className="bg-paper dark:bg-night-card rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-pine dark:text-silver" />
              <h5 className="font-serif text-base font-semibold text-ink dark:text-cream">
                Аудиторія
              </h5>
            </div>
          </div>

          {activeVisitReport.totalVisits === 0 ? (
            <p className="text-xs text-ink-muted dark:text-sandstone-light">
              За обраний період візитів ще немає.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1 text-ink dark:text-cream font-medium">
                    <UserPlus className="w-3.5 h-3.5 text-pine dark:text-silver" />
                    <span>Нові</span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums">
                    {activeVisitReport.newVisitors} ({newVisitorPct}%)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1 text-ink dark:text-cream font-medium">
                    <UserCheck className="w-3.5 h-3.5 text-ink-muted dark:text-sandstone-light" />
                    <span>Повернулися</span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums">
                    {activeVisitReport.returningVisitors} ({returningVisitorPct}%)
                  </span>
                </div>
                <div className="h-2 bg-paper-warm dark:bg-night-elevated rounded-full overflow-hidden flex">
                  <div className="h-full bg-pear-pine-gradient" style={{ width: `${newVisitorPct}%` }} />
                  <div
                    className="h-full bg-stone-warm/50"
                    style={{ width: `${returningVisitorPct}%` }}
                  />
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted dark:text-sandstone-light">
                  Системи (ОС)
                </p>
                <BreakdownBarList
                  items={activeVisitReport.operatingSystems}
                  emptyText="Немає даних про ОС."
                  barClassName="bg-pine-dark dark:bg-silver"
                />
              </div>
            </div>
          )}
        </section>

        {/* 2. Джерела переходів */}
        <section className="bg-paper dark:bg-night-card rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-pine dark:text-silver" />
            <h5 className="font-serif text-base font-semibold text-ink dark:text-cream">
              Джерела переходів
            </h5>
          </div>
          <BreakdownBarList
            items={activeVisitReport.referrers}
            emptyText="Немає даних про джерела переходів."
          />
        </section>

        {/* 3. Точки входу */}
        <section className="bg-paper dark:bg-night-card rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-pine-dark dark:text-silver" />
            <h5 className="font-serif text-base font-semibold text-ink dark:text-cream">
              Точка входу (розділ)
            </h5>
          </div>
          <BreakdownBarList
            items={activeVisitReport.entrySections}
            emptyText="Немає даних про точки входу."
            barClassName="bg-pine-dark dark:bg-silver"
          />
        </section>

        {/* 4. Пристрої та браузери */}
        <section className="bg-paper dark:bg-night-card rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-pine dark:text-silver" />
            <h5 className="font-serif text-base font-semibold text-ink dark:text-cream">
              Пристрої та браузери
            </h5>
          </div>
          <BreakdownBarList
            items={activeVisitReport.devices}
            emptyText="Немає даних про пристрої."
          />
          {activeVisitReport.browsers.length > 0 && (
            <div className="pt-2 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted dark:text-sandstone-light">
                Браузери
              </p>
              <BreakdownBarList
                items={activeVisitReport.browsers}
                emptyText="Немає даних про браузери."
                barClassName="bg-ink dark:bg-cream"
              />
            </div>
          )}
        </section>
      </div>

      {/* Detailed Visit Log Table for Selected Period */}
      <section className="bg-paper dark:bg-night-card rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-pine dark:text-silver" strokeWidth={1.75} />
            <h5 className="font-serif text-lg font-semibold text-ink dark:text-cream">
              Детальний журнал відвідувань ({activeVisitReport.label.toLowerCase()})
            </h5>
          </div>
          <span className="text-xs text-ink-muted dark:text-sandstone-light font-mono tabular-nums">
            Останніх {activeVisitReport.recentVisits.length} записів
          </span>
        </div>

        {activeVisitReport.recentVisits.length === 0 ? (
          <p className="p-6 text-center text-xs text-ink-muted dark:text-sandstone-light">
            У цьому періоді відвідувань поки що не зафіксовано.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-paper dark:bg-night-card text-ink-muted dark:text-sandstone-light">
                  <th className="py-2.5 px-4 font-medium">Дата та час</th>
                  <th className="py-2.5 px-4 font-medium">Гість</th>
                  <th className="py-2.5 px-4 font-medium">Розділ входу</th>
                  <th className="py-2.5 px-4 font-medium">Джерело</th>
                  <th className="py-2.5 px-4 font-medium">Пристрій · Браузер · ОС</th>
                </tr>
              </thead>
              <tbody className="">
                {activeVisitReport.recentVisits.map((visit) => {
                  const dt = new Date(visit.timestamp);
                  const dateTimeLabel = dt.toLocaleString('uk-UA', {
                    timeZone: 'Europe/Kyiv',
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  return (
                    <tr
                      key={visit.id}
                      className="hover:bg-paper/70 dark:hover:bg-night-hover transition-colors"
                    >
                      <td className="py-2.5 px-4 font-mono text-ink-muted dark:text-sandstone-light tabular-nums whitespace-nowrap">
                        {dateTimeLabel}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <span className="font-mono text-[11px] text-ink-muted dark:text-sandstone-light">
                            #{visit.visitorCode}
                          </span>
                          <span
                            className={`text-[11px] font-medium ${
                              visit.isNewVisitor
                                ? 'text-pine-deep dark:text-silver'
                                : 'text-ink-muted dark:text-sandstone-light'
                            }`}
                          >
                            {visit.isNewVisitor ? 'Новий' : 'Повторний'}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-medium text-ink dark:text-cream whitespace-nowrap">
                        {sectionTitleLabel(visit.entrySection)}
                      </td>
                      <td className="py-2.5 px-4 text-ink dark:text-cream whitespace-nowrap">
                        {visit.referrerHost}
                      </td>
                      <td className="py-2.5 px-4 text-ink-muted dark:text-sandstone-light whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {renderDeviceIcon(visit.deviceType)}
                          <span>
                            {deviceShortLabel(visit.deviceType)} · {visit.browser} · {visit.os}
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Divider: Behavior Analytics Section */}
      <div className="pt-2 space-y-5">
        <div>
          <h4 className="font-serif text-xl font-semibold text-ink dark:text-cream">
            Поведінка читачів та покупців
          </h4>
          <p className="text-xs text-ink-muted dark:text-sandstone-light">
            На що клікають, де затримуються найдовше та після якого моменту залишають сайт.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-paper dark:bg-night-card rounded-xl p-4">
            <p className="text-xs text-ink-muted dark:text-sandstone-light mb-1">Сесій відстежено</p>
            <p className="font-mono text-2xl font-semibold text-ink dark:text-cream tabular-nums">
              {summary.totalSessions}
            </p>
          </div>

          <div className="bg-paper dark:bg-night-card rounded-xl p-4">
            <p className="text-xs text-ink-muted dark:text-sandstone-light mb-1">Кліків усього</p>
            <p className="font-mono text-2xl font-semibold text-ink dark:text-cream tabular-nums">
              {summary.totalClicks}
            </p>
          </div>

          <div className="bg-paper dark:bg-night-card rounded-xl p-4">
            <p className="text-xs text-ink-muted dark:text-sandstone-light mb-1">Середній час на сайті</p>
            <p className="font-mono text-2xl font-semibold text-pine-dark dark:text-silver tabular-nums">
              {formatDuration(summary.avgSessionSeconds)}
            </p>
          </div>

          <div className="bg-paper dark:bg-night-card rounded-xl p-4">
            <p className="text-xs text-ink-muted dark:text-sandstone-light mb-1">Зафіксовано виходів</p>
            <p className="font-mono text-2xl font-semibold text-pine dark:text-silver tabular-nums">
              {summary.totalExits}
            </p>
          </div>
        </div>

        {!hasAnyBehaviorData ? (
          <div className="bg-paper dark:bg-night-card rounded-xl p-10 text-center space-y-2">
            <BarChart3 className="w-8 h-8 text-ink-muted dark:text-sandstone-light mx-auto" strokeWidth={1.5} />
            <p className="font-serif text-xl font-semibold text-ink dark:text-cream">
              Ще немає зібраних подій взаємодії
            </p>
            <p className="text-xs text-ink-muted dark:text-sandstone-light max-w-md mx-auto leading-relaxed">
              Щойно відвідувачі почнуть відкривати розділи, гортати вірші, затримуватися на сторінках чи виходити з сайту — тут з’явиться детальна аналітика.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              {/* 1. На що клікають */}
              <section className="bg-paper dark:bg-night-card rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-3">
                  <div className="flex items-center gap-2">
                    <MousePointerClick
                      className="w-4 h-4 text-pine dark:text-silver"
                      strokeWidth={1.75}
                    />
                    <h5 className="font-serif text-lg font-semibold text-ink dark:text-cream">
                      На що клікають
                    </h5>
                  </div>
                  <span className="font-mono text-xs text-ink-muted dark:text-sandstone-light tabular-nums">
                    {clicks.length} поз.
                  </span>
                </div>

                {clicks.length === 0 ? (
                  <p className="text-xs text-ink-muted dark:text-sandstone-light">Кліки ще не зафіксовані.</p>
                ) : (
                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    {clicks.map((item) => {
                      const widthPct = Math.max(6, Math.round((item.clicks / maxClicks) * 100));
                      return (
                        <div key={item.targetKey} className="space-y-1">
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span
                              className="font-medium text-ink dark:text-cream truncate"
                              title={item.label}
                            >
                              {item.label}
                            </span>
                            <span className="font-mono font-semibold text-ink dark:text-cream tabular-nums shrink-0">
                              {item.clicks}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted dark:text-sandstone-light">
                            <span>{categoryLabel(item.category)}</span>
                          </div>
                          <div className="h-1.5 bg-paper-warm dark:bg-night-elevated rounded-full overflow-hidden">
                            <div
                              className="h-full bg-pear-pine-gradient rounded-full"
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
              <section className="bg-paper dark:bg-night-card rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-pine-dark dark:text-silver" strokeWidth={1.75} />
                    <h5 className="font-serif text-lg font-semibold text-ink dark:text-cream">
                      На чому затримуються
                    </h5>
                  </div>
                  <span className="font-mono text-xs text-ink-muted dark:text-sandstone-light tabular-nums">
                    {formatDuration(summary.totalTrackedSeconds)}
                  </span>
                </div>

                {dwell.length === 0 ? (
                  <p className="text-xs text-ink-muted dark:text-sandstone-light">
                    Затримки (від 2 секунд на елементі) ще не зафіксовані.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    {dwell.map((item) => {
                      const widthPct = Math.max(6, Math.round((item.totalSeconds / maxDwellSec) * 100));
                      return (
                        <div key={item.targetKey} className="space-y-1">
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span
                              className="font-medium text-ink dark:text-cream truncate"
                              title={item.label}
                            >
                              {item.label}
                            </span>
                            <span className="font-mono font-semibold text-pine-dark dark:text-silver tabular-nums shrink-0">
                              {formatDuration(item.totalSeconds)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted dark:text-sandstone-light tabular-nums">
                            <span>Середнє: {formatDuration(item.avgSeconds)}</span>
                            <span>
                              Макс: {formatDuration(item.maxSeconds)} · {item.sessionsCount} раз.
                            </span>
                          </div>
                          <div className="h-1.5 bg-paper-warm dark:bg-night-elevated rounded-full overflow-hidden">
                            <div
                              className="h-full bg-pine-dark dark:bg-silver rounded-full"
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
              <section className="bg-paper dark:bg-night-card rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-3">
                  <div className="flex items-center gap-2">
                    <LogOut className="w-4 h-4 text-pine dark:text-silver" strokeWidth={1.75} />
                    <h5 className="font-serif text-lg font-semibold text-ink dark:text-cream">
                      Момент виходу з сайту
                    </h5>
                  </div>
                  <span className="font-mono text-xs text-ink-muted dark:text-sandstone-light tabular-nums">
                    {summary.totalExits} вих.
                  </span>
                </div>

                {exits.length === 0 ? (
                  <p className="text-xs text-ink-muted dark:text-sandstone-light">
                    Виходи фіксуються, коли читач закриває вкладку або переходить в інший додаток.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    {exits.map((item) => {
                      const widthPct = Math.max(6, Math.round((item.exits / maxExits) * 100));
                      return (
                        <div key={item.momentKey} className="space-y-1">
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span
                              className="font-medium text-ink dark:text-cream truncate"
                              title={item.label}
                            >
                              {item.label}
                            </span>
                            <span className="font-mono font-semibold text-pine dark:text-silver tabular-nums shrink-0">
                              {item.exits} ({item.sharePercent}%)
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted dark:text-sandstone-light tabular-nums">
                            <span>Сесія перед виходом: ~{formatDuration(item.avgSessionSeconds)}</span>
                          </div>
                          <div className="h-1.5 bg-paper-warm dark:bg-night-elevated rounded-full overflow-hidden">
                            <div
                              className="h-full bg-ink dark:bg-cream rounded-full"
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

            {recentEvents.length > 0 && (
              <section className="bg-paper dark:bg-night-card rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-ink-muted dark:text-sandstone-light" strokeWidth={1.75} />
                    <h5 className="font-serif text-lg font-semibold text-ink dark:text-cream">
                      Останні дії відвідувачів
                    </h5>
                  </div>
                  <span className="text-xs text-ink-muted dark:text-sandstone-light font-mono tabular-nums">
                    {recentEvents.length} подій
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-paper dark:bg-night-card text-ink-muted dark:text-sandstone-light">
                        <th className="py-2.5 px-4 font-medium">Час</th>
                        <th className="py-2.5 px-4 font-medium">Тип</th>
                        <th className="py-2.5 px-4 font-medium">Елемент або момент</th>
                        <th className="py-2.5 px-4 font-medium text-right">Тривалість</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentEvents.slice(0, 20).map((ev) => {
                        const typeLabel =
                          ev.type === 'click'
                            ? 'Клік'
                            : ev.type === 'dwell'
                              ? 'Затримка'
                              : 'Вихід';
                        const typeColor =
                          ev.type === 'click'
                            ? 'text-ink dark:text-cream'
                            : ev.type === 'dwell'
                              ? 'text-pine-dark dark:text-silver'
                              : 'text-pine dark:text-[#D4D4D4]';
                        return (
                          <tr
                            key={ev.id}
                            className="hover:bg-paper/70 dark:hover:bg-night-hover transition-colors"
                          >
                            <td className="py-2.5 px-4 font-mono text-ink-muted dark:text-sandstone-light tabular-nums whitespace-nowrap">
                              {new Date(ev.createdAt).toLocaleTimeString('uk-UA', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </td>
                            <td className={`py-2.5 px-4 font-medium whitespace-nowrap ${typeColor}`}>
                              {typeLabel}
                            </td>
                            <td
                              className="py-2.5 px-4 text-ink dark:text-cream max-w-md truncate"
                              title={ev.label}
                            >
                              {ev.label}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-ink-muted dark:text-sandstone-light tabular-nums text-right whitespace-nowrap">
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
    </div>
  );
}
