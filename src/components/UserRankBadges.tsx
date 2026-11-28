import { Crown, Flame, Heart } from 'lucide-react';
import type { TopRankNumber, UserTopBadges } from '../types.ts';

interface UserRankBadgesProps {
  badges?: UserTopBadges | null;
  size?: 'xs' | 'md';
  className?: string;
}

const ACTIVITY_TIER_STYLES: Record<
  TopRankNumber,
  { container: string; icon: string; title: string; label: string }
> = {
  1: {
    container:
      'bg-gradient-to-r from-amber-400/45 via-yellow-300/35 to-amber-500/45 border-amber-300 text-amber-50 shadow-[0_0_16px_-2px_rgba(251,191,36,0.9)]',
    icon: 'text-yellow-200 fill-amber-300/80',
    title: 'Топ-1 у рейтингу активності',
    label: 'Топ-1 Активність',
  },
  2: {
    container:
      'bg-gradient-to-r from-sky-300/38 via-slate-100/32 to-cyan-300/38 border-sky-200 text-white shadow-[0_0_14px_-2px_rgba(186,230,253,0.78)]',
    icon: 'text-sky-100 fill-white/65',
    title: 'Топ-2 у рейтингу активності',
    label: 'Топ-2 Активність',
  },
  3: {
    container:
      'bg-gradient-to-r from-orange-400/44 via-amber-400/35 to-orange-500/42 border-orange-300 text-orange-50 shadow-[0_0_14px_-2px_rgba(251,146,60,0.78)]',
    icon: 'text-orange-200 fill-orange-300/75',
    title: 'Топ-3 у рейтингу активності',
    label: 'Топ-3 Активність',
  },
  4: {
    container:
      'bg-gradient-to-r from-emerald-500/20 to-teal-500/15 border-emerald-400/40 text-emerald-200',
    icon: 'text-emerald-300 fill-emerald-400/25',
    title: 'Топ-4 у рейтингу активності',
    label: 'Топ-4 Активність',
  },
  5: {
    container:
      'bg-gradient-to-r from-sky-500/20 to-indigo-500/15 border-sky-400/40 text-sky-200',
    icon: 'text-sky-300 fill-sky-400/25',
    title: 'Топ-5 у рейтингу активності',
    label: 'Топ-5 Активність',
  },
};

const DONOR_TIER_STYLES: Record<
  TopRankNumber,
  { container: string; icon: string; title: string; label: string }
> = {
  1: {
    container:
      'bg-gradient-to-r from-rose-500/28 via-amber-400/20 to-rose-600/25 border-amber-300/60 text-rose-100 shadow-[0_0_12px_-3px_rgba(244,63,94,0.5)]',
    icon: 'text-amber-300 fill-rose-400',
    title: 'Топ-1 у рейтингу донатерів',
    label: 'Топ-1 Донатер',
  },
  2: {
    container:
      'bg-gradient-to-r from-rose-500/22 to-pink-500/18 border-rose-400/48 text-rose-200',
    icon: 'text-rose-300 fill-rose-400/80',
    title: 'Топ-2 у рейтингу донатерів',
    label: 'Топ-2 Донатер',
  },
  3: {
    container:
      'bg-gradient-to-r from-pink-500/20 to-amber-600/20 border-pink-400/42 text-pink-200',
    icon: 'text-pink-300 fill-pink-400/75',
    title: 'Топ-3 у рейтингу донатерів',
    label: 'Топ-3 Донатер',
  },
  4: {
    container:
      'bg-gradient-to-r from-fuchsia-500/20 to-purple-500/15 border-fuchsia-400/40 text-fuchsia-200',
    icon: 'text-fuchsia-300 fill-fuchsia-400/70',
    title: 'Топ-4 у рейтингу донатерів',
    label: 'Топ-4 Донатер',
  },
  5: {
    container:
      'bg-gradient-to-r from-purple-500/20 to-rose-500/15 border-purple-400/40 text-purple-200',
    icon: 'text-purple-300 fill-purple-400/70',
    title: 'Топ-5 у рейтингу донатерів',
    label: 'Топ-5 Донатер',
  },
};

function isTop5(rank: unknown): rank is TopRankNumber {
  return typeof rank === 'number' && Number.isInteger(rank) && rank >= 1 && rank <= 5;
}

export function UserRankBadges({
  badges,
  size = 'xs',
  className = '',
}: UserRankBadgesProps) {
  if (!badges) return null;
  const hasActivity = isTop5(badges.activityRank);
  const hasDonor = isTop5(badges.donorRank);
  if (!hasActivity && !hasDonor) return null;

  const isProfileSize = size === 'md';

  return (
    <span
      className={`inline-flex items-center flex-wrap ${
        isProfileSize ? 'gap-2' : 'gap-1'
      } ${className}`}
    >
      {hasActivity && badges.activityRank && (() => {
        const tier = ACTIVITY_TIER_STYLES[badges.activityRank];
        return (
          <span
            title={tier.title}
            aria-label={tier.title}
            className={`inline-flex items-center border font-bold tracking-tight select-none shrink-0 ${
              isProfileSize
                ? 'gap-1.5 px-2.5 py-1 rounded-lg text-[11px] leading-none'
                : 'gap-0.5 px-1.5 py-[2px] rounded-md text-[10px] leading-none'
            } ${tier.container}`}
          >
            {badges.activityRank === 1 ? (
              <Crown
                className={`${isProfileSize ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} shrink-0 ${tier.icon}`}
                strokeWidth={2.2}
              />
            ) : (
              <Flame
                className={`${isProfileSize ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} shrink-0 ${tier.icon}`}
                strokeWidth={2.2}
              />
            )}
            <span className="tabular-nums">
              {isProfileSize ? tier.label : `#${badges.activityRank}`}
            </span>
          </span>
        );
      })()}

      {hasDonor && badges.donorRank && (() => {
        const tier = DONOR_TIER_STYLES[badges.donorRank];
        return (
          <span
            title={tier.title}
            aria-label={tier.title}
            className={`inline-flex items-center border font-bold tracking-tight select-none shrink-0 ${
              isProfileSize
                ? 'gap-1.5 px-2.5 py-1 rounded-lg text-[11px] leading-none'
                : 'gap-0.5 px-1.5 py-[2px] rounded-md text-[10px] leading-none'
            } ${tier.container}`}
          >
            <Heart
              className={`${isProfileSize ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} shrink-0 ${tier.icon}`}
              strokeWidth={2.2}
            />
            <span className="tabular-nums">
              {isProfileSize ? tier.label : `#${badges.donorRank}`}
            </span>
          </span>
        );
      })()}
    </span>
  );
}
