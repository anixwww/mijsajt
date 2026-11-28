/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import { useEffect, useState, type CSSProperties } from 'react';
import type { SectionId } from '../types.ts';
import { useTouchFeedback } from '../utils/useTouchFeedback.ts';

const FESTIVE_LIGHTS_STORAGE_KEY = 'dankiv_festive_lights_enabled';
const FESTIVE_LIGHTS_EVENT = 'dankiv:festive-lights-changed';

interface FairyBulbSpec {
  id: string;
  leftPct: number;
  topPx: number;
  sizePx: number;
  haloPx: number;
  core: string;
  glow: string;
  dur: string;
  delay: string;
  minOpacity: number;
  maxOpacity: number;
}

// Coordinates aligned directly along the 5 downward quadratic wire arcs (viewBox 0 0 1000 28)
const GARLAND_BULBS: FairyBulbSpec[] = [
  { id: 'b1', leftPct: 3.8, topPx: 7.7, sizePx: 2.5, haloPx: 14, core: '#FEF3C7', glow: 'rgba(245, 158, 11, 0.42)', dur: '4.6s', delay: '0.1s', minOpacity: 0.42, maxOpacity: 0.9 },
  { id: 'b2', leftPct: 9.6, topPx: 9.4, sizePx: 3, haloPx: 16, core: '#FDE68A', glow: 'rgba(217, 119, 6, 0.4)', dur: '5.4s', delay: '1.3s', minOpacity: 0.36, maxOpacity: 0.86 },
  { id: 'b3', leftPct: 15.6, topPx: 7.6, sizePx: 2.5, haloPx: 13, core: '#FFFBEB', glow: 'rgba(251, 191, 36, 0.42)', dur: '4.2s', delay: '2.4s', minOpacity: 0.45, maxOpacity: 0.9 },
  { id: 'b4', leftPct: 21.4, topPx: 4.5, sizePx: 3, haloPx: 16, core: '#FCD34D', glow: 'rgba(245, 158, 11, 0.42)', dur: '5.8s', delay: '0.7s', minOpacity: 0.38, maxOpacity: 0.88 },
  { id: 'b5', leftPct: 27.6, topPx: 8.5, sizePx: 2.5, haloPx: 14, core: '#FDE8E8', glow: 'rgba(251, 113, 133, 0.32)', dur: '6.1s', delay: '1.9s', minOpacity: 0.32, maxOpacity: 0.78 },
  { id: 'b6', leftPct: 33.8, topPx: 8.5, sizePx: 3, haloPx: 16, core: '#FEF3C7', glow: 'rgba(245, 158, 11, 0.42)', dur: '4.9s', delay: '0.4s', minOpacity: 0.42, maxOpacity: 0.9 },
  { id: 'b7', leftPct: 39.8, topPx: 4.5, sizePx: 2.5, haloPx: 14, core: '#ECFDF5', glow: 'rgba(52, 211, 153, 0.28)', dur: '6.4s', delay: '2.9s', minOpacity: 0.3, maxOpacity: 0.74 },
  { id: 'b8', leftPct: 46, topPx: 8.5, sizePx: 3, haloPx: 17, core: '#FDE68A', glow: 'rgba(245, 158, 11, 0.44)', dur: '5.1s', delay: '1.1s', minOpacity: 0.42, maxOpacity: 0.9 },
  { id: 'b9', leftPct: 52.2, topPx: 8.5, sizePx: 2.5, haloPx: 14, core: '#FFFBEB', glow: 'rgba(251, 191, 36, 0.42)', dur: '4.5s', delay: '2.2s', minOpacity: 0.38, maxOpacity: 0.86 },
  { id: 'b10', leftPct: 58.2, topPx: 4.5, sizePx: 3, haloPx: 16, core: '#FDE68A', glow: 'rgba(217, 119, 6, 0.4)', dur: '5.7s', delay: '0.6s', minOpacity: 0.38, maxOpacity: 0.88 },
  { id: 'b11', leftPct: 64.4, topPx: 9.1, sizePx: 2.5, haloPx: 14, core: '#FEF3C7', glow: 'rgba(245, 158, 11, 0.42)', dur: '4.8s', delay: '3.1s', minOpacity: 0.4, maxOpacity: 0.88 },
  { id: 'b12', leftPct: 70.4, topPx: 8.9, sizePx: 2.5, haloPx: 14, core: '#FDE8E8', glow: 'rgba(251, 113, 133, 0.32)', dur: '6.0s', delay: '1.5s', minOpacity: 0.32, maxOpacity: 0.76 },
  { id: 'b13', leftPct: 76.4, topPx: 5, sizePx: 3, haloPx: 17, core: '#FEF3C7', glow: 'rgba(251, 191, 36, 0.44)', dur: '5.2s', delay: '0.2s', minOpacity: 0.42, maxOpacity: 0.9 },
  { id: 'b14', leftPct: 82.6, topPx: 8.6, sizePx: 2.5, haloPx: 14, core: '#ECFDF5', glow: 'rgba(52, 211, 153, 0.28)', dur: '6.3s', delay: '2.6s', minOpacity: 0.3, maxOpacity: 0.74 },
  { id: 'b15', leftPct: 88.6, topPx: 9.5, sizePx: 3, haloPx: 16, core: '#FDE68A', glow: 'rgba(245, 158, 11, 0.42)', dur: '4.7s', delay: '1.0s', minOpacity: 0.4, maxOpacity: 0.88 },
  { id: 'b16', leftPct: 94.8, topPx: 7.4, sizePx: 2.5, haloPx: 14, core: '#FFFBEB', glow: 'rgba(251, 191, 36, 0.4)', dur: '5.5s', delay: '2.0s', minOpacity: 0.38, maxOpacity: 0.86 },
];

function FestiveBottomIllumination() {
  return (
    <m.div
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="pointer-events-none absolute inset-0 rounded-t-[20px] overflow-hidden"
    >
      {/* Whisper-soft champagne hairline glow along the upper rim */}
      <div
        className="absolute inset-x-4 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(253,230,138,0.16) 18%, rgba(254,243,199,0.34) 50%, rgba(253,230,138,0.16) 82%, transparent 100%)',
        }}
      />

      {/* Soft ambient candlelight wash hugging the top inside of the dark bar */}
      <div
        className="absolute inset-x-0 top-0 h-8 opacity-80"
        style={{
          background:
            'radial-gradient(65% 100% at 22% 0%, rgba(251,191,36,0.09) 0%, transparent 72%), radial-gradient(60% 100% at 52% 0%, rgba(254,243,199,0.11) 0%, transparent 72%), radial-gradient(65% 100% at 82% 0%, rgba(251,191,36,0.08) 0%, transparent 72%)',
        }}
      />

      {/* Fine antique-brass garland thread */}
      <svg
        viewBox="0 0 1000 28"
        preserveAspectRatio="none"
        className="absolute inset-x-0 top-0 w-full h-[28px]"
      >
        <path
          d="M -10,3 Q 102,15 214,4.5 Q 306,13.5 398,4.5 Q 490,13.5 582,4.5 Q 673,14 764,5 Q 887,15 1010,3"
          fill="none"
          stroke="rgba(253,230,138,0.18)"
          strokeWidth="0.8"
        />
      </svg>

      {/* Circular micro-bulbs with soft candlelight halos */}
      {GARLAND_BULBS.map((b) => {
        const style = {
          left: `${b.leftPct}%`,
          top: `${b.topPx}px`,
          width: `${b.haloPx}px`,
          height: `${b.haloPx}px`,
          '--twinkle-dur': b.dur,
          '--twinkle-delay': b.delay,
          '--bulb-min': b.minOpacity,
          '--bulb-max': b.maxOpacity,
          '--bulb-mid': (b.minOpacity + b.maxOpacity) * 0.52,
        } as CSSProperties;

        return (
          <span
            key={b.id}
            style={style}
            className="festive-bulb-twinkle absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
          >
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: `radial-gradient(circle, ${b.glow} 0%, transparent 70%)`,
              }}
            />
            <span
              className="relative rounded-full"
              style={{
                width: `${b.sizePx}px`,
                height: `${b.sizePx}px`,
                backgroundColor: b.core,
                boxShadow: `0 0 6px 1px ${b.glow}`,
              }}
            />
          </span>
        );
      })}
    </m.div>
  );
}

function CozyHomeIcon({ isActive }: { isActive: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="relative z-10 w-[18px] h-[18px] transition-transform duration-300 group-hover:scale-110"
    >
      <defs>
        <radialGradient id="bottomNavWindowGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FDE047" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#F59E0B" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bottomNavWindowPane" x1="12.6" y1="12.6" x2="17" y2="17" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FEF9C3" />
          <stop offset="55%" stopColor="#FDE047" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>

      {/* Chimney */}
      <path d="M16 6.8V4.5h2.1v4.1" stroke="#FDE68A" />

      {/* House walls */}
      <path d="M5 10.2v9.3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9.3" />

      {/* Overhanging pitched roof */}
      <path d="M2.5 11.6 12 3.6l9.5 8" stroke="#FEF08A" strokeWidth={1.9} />

      {/* Ground / foundation sill */}
      <path d="M3.8 20.5h16.4" strokeOpacity={0.75} />

      {/* Front door & handle */}
      <rect
        x="7"
        y="14.2"
        width="3.8"
        height="6.3"
        rx="0.6"
        className="fill-[#F59E0B]/20"
      />
      <circle cx="9.8" cy="17.4" r="0.45" fill="#FEF3C7" stroke="none" />

      {/* 4-pane window with warm lit glass */}
      <rect
        x="12.6"
        y="12.6"
        width="4.4"
        height="4.4"
        rx="0.65"
        fill="url(#bottomNavWindowPane)"
        stroke="#FEF08A"
        strokeWidth={1.1}
      />
      <path
        d="M14.8 12.6v4.4M12.6 14.8h4.4"
        strokeWidth={1.1}
        stroke="#92400E"
        strokeOpacity={0.8}
      />
      {/* Window sill */}
      <path d="M12.1 17.2h5.4" strokeWidth={1.3} stroke="#F59E0B" />
    </svg>
  );
}

interface SiteBottomNavProps {
  activeSection: SectionId;
  onNavigate: (section: SectionId) => void;
  onPrefetchSection?: (section: SectionId) => void;
  cartCount: number;
  unlockedCount: number;
  onOpenDrawer: (tab?: 'cart' | 'library') => void;
}

interface NavTabItem {
  id: SectionId;
  label: string;
  touchId: string;
  isHome?: boolean;
}

const NAV_TABS: NavTabItem[] = [
  { id: 'home', label: 'Головна', touchId: 'nav-home', isHome: true },
  { id: 'poetry', label: 'Вірші', touchId: 'nav-poetry' },
  { id: 'prose', label: 'Проза', touchId: 'nav-prose' },
  { id: 'blog', label: 'БДК', touchId: 'nav-blog' },
  { id: 'store', label: 'Крамниця', touchId: 'nav-store' },
];

export function SiteBottomNav({
  activeSection,
  onNavigate,
  onPrefetchSection,
  cartCount,
  unlockedCount,
  onOpenDrawer,
}: SiteBottomNavProps) {
  const { getTouchProps, isTouchActive } = useTouchFeedback();
  const storeBadgeCount = cartCount > 0 ? cartCount : unlockedCount;

  const [festiveLightsEnabled, setFestiveLightsEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem(FESTIVE_LIGHTS_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const handleEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled?: boolean }>).detail;
      if (typeof detail?.enabled === 'boolean') {
        setFestiveLightsEnabled(detail.enabled);
      }
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === FESTIVE_LIGHTS_STORAGE_KEY) {
        setFestiveLightsEnabled(e.newValue !== 'false');
      }
    };
    window.addEventListener(FESTIVE_LIGHTS_EVENT, handleEvent);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(FESTIVE_LIGHTS_EVENT, handleEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const handleTabClick = (id: SectionId) => {
    if (id === 'store' && activeSection === 'store') {
      onOpenDrawer(cartCount > 0 ? 'cart' : unlockedCount > 0 ? 'library' : 'cart');
      return;
    }
    onNavigate(id);
  };

  return (
    <nav
      aria-label="Нижня панель навігації"
      className="fixed bottom-0 left-0 right-0 z-40 rounded-t-[20px] bg-[#18181A] dark:bg-[#18181A] shadow-[0_-10px_30px_-18px_rgba(0,0,0,0.6)] py-2 px-3 sm:px-6 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <LayoutGroup id="site-bottom-nav">
        <div
          role="tablist"
          className="relative z-10 max-w-xl mx-auto flex items-stretch gap-1"
        >
          {NAV_TABS.map((tab) => {
            const isActive = activeSection === tab.id;
            const touchProps = getTouchProps(tab.touchId);

            if (tab.isHome) {
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label="Головна"
                  title="Головна"
                  {...touchProps}
                  data-touch-active={isTouchActive(tab.touchId) ? 'true' : undefined}
                  onPointerDown={(e) => {
                    touchProps.onPointerDown(e);
                    onPrefetchSection?.(tab.id);
                  }}
                  onTouchStart={(e) => {
                    touchProps.onTouchStart(e);
                    onPrefetchSection?.(tab.id);
                  }}
                  onMouseEnter={() => onPrefetchSection?.(tab.id)}
                  onFocus={() => onPrefetchSection?.(tab.id)}
                  onClick={() => handleTabClick(tab.id)}
                  className={`group relative overflow-hidden touch-surface inline-flex items-center justify-center w-[38px] sm:w-[42px] h-[38px] sm:h-[40px] rounded-lg transition-all duration-200 shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-[linear-gradient(135deg,#261406_0%,#3E200A_50%,#4C260D_100%)] text-[#FDE68A] shadow-[0_6px_20px_-4px_rgba(245,158,11,0.55),0_0_18px_-2px_rgba(251,191,36,0.5),inset_0_1px_0_rgba(255,255,255,0.28)] ring-1 ring-[#F59E0B]/50 scale-105'
                      : 'bg-[linear-gradient(135deg,#0E0904_0%,#1A1008_50%,#26150A_100%)] text-[#FDE68A]/80 shadow-[0_6px_16px_-6px_rgba(15,10,5,0.8),0_0_14px_-4px_rgba(245,158,11,0.25),inset_0_1px_0_rgba(255,255,255,0.14)] hover:shadow-[0_8px_20px_-6px_rgba(15,10,5,0.9),0_0_20px_-2px_rgba(251,191,36,0.48),inset_0_1px_0_rgba(255,255,255,0.25)] hover:text-[#FEF08A] hover:scale-105 active:scale-[0.94]'
                  }`}
                >
                  {/* Warm hearth glow layers */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -left-2 -top-2 w-7 h-7 rounded-full bg-[#F59E0B]/30 blur-md group-hover:bg-[#FBBF24]/45 transition-colors duration-300"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-2 -bottom-2 w-7 h-7 rounded-full bg-[#D97706]/25 blur-md group-hover:bg-[#F59E0B]/40 transition-colors duration-300"
                  />

                  {/* Cozy sparks/starfield */}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 40 40"
                    fill="none"
                    className="pointer-events-none absolute inset-0 w-full h-full opacity-80 group-hover:opacity-100 transition-opacity duration-300"
                  >
                    <circle cx="8" cy="9" r="0.65" fill="#FEF3C7" opacity="0.8" />
                    <circle cx="32" cy="8" r="0.8" fill="#FDE68A" opacity="0.9" className="animate-pulse" />
                    <circle cx="9" cy="31" r="0.6" fill="#FCD34D" opacity="0.7" />
                    <circle cx="31" cy="31" r="0.65" fill="#FBBF24" opacity="0.75" />
                  </svg>

                  {/* Starlight sweep on hover */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/15 to-transparent"
                  />

                  <CozyHomeIcon isActive={isActive} />
                </button>
              );
            }

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={tab.label}
                title={tab.label}
                {...touchProps}
                data-touch-active={isTouchActive(tab.touchId) ? 'true' : undefined}
                onPointerDown={(e) => {
                  touchProps.onPointerDown(e);
                  onPrefetchSection?.(tab.id);
                }}
                onTouchStart={(e) => {
                  touchProps.onTouchStart(e);
                  onPrefetchSection?.(tab.id);
                }}
                onMouseEnter={() => onPrefetchSection?.(tab.id)}
                onFocus={() => onPrefetchSection?.(tab.id)}
                onClick={() => handleTabClick(tab.id)}
                className={`relative min-h-[42px] sm:min-h-[44px] py-2 rounded-lg text-xs sm:text-sm transition-colors duration-150 flex items-center justify-center cursor-pointer whitespace-nowrap flex-1 min-w-0 px-2.5 ${
                  isActive
                    ? 'font-semibold text-white'
                    : 'font-medium text-[#A1A1AA] hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {isActive && (
                  <m.span
                    layoutId="bottom-nav-active-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-lg bg-[linear-gradient(135deg,rgba(63,63,70,0.8)_0%,rgba(39,39,42,0.9)_100%)] shadow-inner"
                    aria-hidden="true"
                  />
                )}

                <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
                  <span className="tracking-[-0.01em]">{tab.label}</span>
                </span>

                {tab.id === 'store' && storeBadgeCount > 0 && (
                  <span
                    aria-label={`Кількість у крамниці: ${storeBadgeCount}`}
                    className={`pointer-events-none absolute -top-1.5 right-0.5 z-20 min-w-[17px] h-[17px] px-1 rounded-full font-mono text-[10px] font-semibold leading-[17px] text-center tabular-nums shadow-xs transition-colors duration-150 ${
                      isActive
                        ? 'bg-[#52525B] text-white'
                        : 'bg-[#27272A] text-[#A1A1AA]'
                    }`}
                  >
                    {storeBadgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      <AnimatePresence>
        {festiveLightsEnabled && (
          <div className="absolute inset-0 z-35 pointer-events-none overflow-hidden rounded-t-[20px]">
            <FestiveBottomIllumination key="festive-lights" />
          </div>
        )}
      </AnimatePresence>
    </nav>
  );
}
