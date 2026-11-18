/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowUpRight, Menu, Moon, Sun, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { GuestUser, SectionId } from '../types.ts';
import { RegistrationCrosshair } from './EditorialMarks.tsx';
import { EditorialTypewriter } from './EditorialTypewriter.tsx';
import { PWAInstallControl } from './PWAInstallControl.tsx';

interface HeroSectionProps {
  onNavigate: (section: SectionId) => void;
  onOpenAuthorStudio: () => void;
  onOpenAuthModal: () => void;
  onLogoutGuest: () => void;
  guestUser: GuestUser | null;
  isAdmin: boolean;
  stats: {
    poemsCount: number;
    proseCount: number;
    blogCount: number;
    storeCount: number;
  };
  uniqueVisitors: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function HeroSection({
  onNavigate,
  onOpenAuthorStudio,
  onOpenAuthModal,
  onLogoutGuest,
  guestUser,
  isAdmin,
  stats,
  uniqueVisitors,
  theme,
  onToggleTheme,
}: HeroSectionProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [menuOpen]);

  const isDark = theme === 'dark';

  const sectionsList: {
    id: Exclude<SectionId, 'home'>;
    title: string;
    character: string;
    countLabel: string;
  }[] = [
    {
      id: 'poetry',
      title: 'Поезія',
      character: 'Тиша / ритм',
      countLabel: `${stats.poemsCount} творів`,
    },
    {
      id: 'prose',
      title: 'Проза',
      character: 'Архітектура / простір',
      countLabel: `${stats.proseCount} тексти`,
    },
    {
      id: 'blog',
      title: 'Блог',
      character: 'Фрагмент / процес',
      countLabel: `${stats.blogCount} записи`,
    },
    {
      id: 'store',
      title: 'Крамниця',
      character: 'Видання / об’єкти',
      countLabel: `${stats.storeCount} позицій`,
    },
  ];

  return (
    <section
      className={`relative min-h-screen flex flex-col justify-between transition-colors ${
        isDark ? 'bg-[#0B0B0A] text-[#F2F1EC]' : 'bg-[#F5F4EF] text-[#0D0D0C]'
      }`}
    >
      {/* Top 3-Zone Architectural Masthead */}
      <header
        className={`relative z-30 w-full border-b ${
          isDark ? 'border-[#252522]' : 'border-[#0D0D0C]/14'
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 h-[72px] flex items-center justify-between gap-8">
          <motion.h1
            initial={{ opacity: 0, clipPath: 'inset(-35% 100% -35% 0)' }}
            animate={{ opacity: 1, clipPath: 'inset(-35% 0% -35% 0)' }}
            transition={{ duration: 0.72, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
            className="font-signature text-3xl sm:text-[36px] font-normal leading-none tracking-normal whitespace-nowrap shrink-0 py-1"
          >
            Андрій Даньків
          </motion.h1>

          <nav
            aria-label="Швидкий перехід"
            className="hidden md:flex items-center gap-7 text-xs font-medium tracking-wide"
          >
            {sectionsList.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className="group inline-flex items-baseline whitespace-nowrap shrink-0 cursor-pointer text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC] transition-colors"
              >
                <span className="relative after:absolute after:left-0 after:-bottom-0.5 after:h-px after:w-0 after:bg-[#1E4631] dark:after:bg-[#4E946C] group-hover:after:w-full after:transition-all after:duration-200">
                  {item.title}
                </span>
              </button>
            ))}
          </nav>

          <div ref={menuContainerRef} className="relative flex items-center gap-3 shrink-0">
            <PWAInstallControl variant="icon" isDark={isDark} />

            <button
              type="button"
              onClick={onToggleTheme}
              title={isDark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему'}
              aria-label={isDark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему'}
              className={`w-9 h-9 flex items-center justify-center border transition-colors cursor-pointer ${
                isDark
                  ? 'border-[#2E2E2A] text-[#F2F1EC] hover:border-[#4E946C] hover:text-[#4E946C]'
                  : 'border-[#0D0D0C]/20 text-[#0D0D0C] hover:border-[#1E4631] hover:text-[#1E4631]'
              }`}
            >
              {isDark ? <Sun className="w-4 h-4" strokeWidth={1.6} /> : <Moon className="w-4 h-4" strokeWidth={1.6} />}
            </button>

            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-label="Меню"
              aria-expanded={menuOpen}
              title="Меню"
              className={`w-9 h-9 flex items-center justify-center border transition-colors cursor-pointer ${
                menuOpen
                  ? isDark
                    ? 'bg-[#2D6A4F] border-[#2D6A4F] text-white'
                    : 'bg-[#1E4631] border-[#1E4631] text-white'
                  : isDark
                    ? 'border-[#2E2E2A] text-[#F2F1EC] hover:border-[#4E946C] hover:text-[#4E946C]'
                    : 'border-[#0D0D0C]/20 text-[#0D0D0C] hover:border-[#1E4631] hover:text-[#1E4631]'
              }`}
            >
              {menuOpen ? <X className="w-4 h-4" strokeWidth={1.75} /> : <Menu className="w-4 h-4" strokeWidth={1.75} />}
            </button>

            {/* Architectural Menu Dropdown */}
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className={`absolute right-0 top-12 w-64 border shadow-2xl z-40 ${
                    isDark
                      ? 'bg-[#141412] border-[#2E2E2A] text-[#F2F1EC]'
                      : 'bg-[#F5F4EF] border-[#0D0D0C]/20 text-[#0D0D0C]'
                  }`}
                >
                  <div className="px-4 py-2.5 border-b border-[#0D0D0C]/12 dark:border-[#252522] flex items-center justify-between font-mono text-[10px] tracking-widest text-[#6B6B65] dark:text-[#94948C]">
                    <span>НАВІГАЦІЯ</span>
                    <RegistrationCrosshair className="w-3 h-3 text-[#1E4631] dark:text-[#4E946C]" />
                  </div>
                  <div className="divide-y divide-[#0D0D0C]/10 dark:divide-[#252522]">
                    {sectionsList.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onNavigate(item.id);
                        }}
                        className="w-full px-4 py-3 flex items-center justify-between text-left text-xs font-medium hover:bg-[#ECEAE2] dark:hover:bg-[#1E1E1B] hover:text-[#1E4631] dark:hover:text-[#4E946C] transition-colors cursor-pointer"
                      >
                        <span className="font-serif text-base font-semibold">{item.title}</span>
                        <ArrowUpRight className="w-3.5 h-3.5 opacity-60" strokeWidth={1.6} />
                      </button>
                    ))}
                  </div>
                  <div className="px-4 py-3 border-t border-[#0D0D0C]/14 dark:border-[#252522] space-y-2 text-xs">
                    {guestUser ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{guestUser.displayName}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            onLogoutGuest();
                          }}
                          className="underline underline-offset-2 text-[#6B6B65] dark:text-[#94948C] hover:text-[#1E4631] dark:hover:text-[#4E946C] cursor-pointer shrink-0"
                        >
                          Вийти
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onOpenAuthModal();
                        }}
                        className="w-full py-2 text-center font-semibold bg-[#1E4631] text-white hover:bg-[#153524] dark:bg-[#2D6A4F] dark:hover:bg-[#3A8261] transition-colors cursor-pointer"
                      >
                        Увійти / Реєстрація
                      </button>
                    )}

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onOpenAuthorStudio();
                        }}
                        className="w-full py-2 text-center font-semibold border border-[#1E4631] dark:border-[#4E946C] text-[#1E4631] dark:text-[#4E946C] hover:bg-[#1E4631] hover:text-white dark:hover:bg-[#2D6A4F] dark:hover:text-white transition-colors cursor-pointer"
                      >
                        Кабінет автора
                      </button>
                    )}

                    <PWAInstallControl
                      variant="menu"
                      isDark={isDark}
                      onAction={() => setMenuOpen(false)}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Main Asymmetrical Editorial Spread */}
      <div className="relative flex-1 editorial-grid-bg">
        <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 py-10 lg:py-16">
            {/* Main Typographic Plane */}
            <div className="flex flex-col justify-between">
              {/* Editorial Index List */}
              <div className="divide-y divide-[#0D0D0C]/14 dark:divide-[#F2F1EC]/14 border-t border-b border-[#0D0D0C]/14 dark:border-[#F2F1EC]/14">
                {sectionsList.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={`group w-full py-6 sm:py-7 text-left grid grid-cols-12 gap-3 sm:gap-6 items-baseline cursor-pointer transition-colors duration-200 px-2 -mx-2 ${
                      isDark
                        ? 'hover:bg-[#151513]'
                        : 'hover:bg-[#ECEAE2]/75'
                    }`}
                  >
                    <div className="col-span-8 sm:col-span-6">
                      <h2 className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight group-hover:translate-x-1.5 transition-transform duration-200">
                        <EditorialTypewriter
                          text={item.title}
                          delay={0.08 + idx * 0.1}
                          charDelay={0.036}
                          charDuration={0.22}
                        />
                      </h2>
                    </div>

                    <div className="hidden sm:block sm:col-span-3 font-mono text-[11px] text-[#6B6B65] dark:text-[#94948C]">
                      {item.character}
                    </div>

                    <div className="col-span-4 sm:col-span-3 flex items-center justify-end gap-2 font-mono text-xs tabular-nums">
                      <span className="hidden md:inline text-[#6B6B65] dark:text-[#94948C] group-hover:text-[#0D0D0C] dark:group-hover:text-[#F2F1EC] transition-colors">
                        {item.countLabel}
                      </span>
                      <ArrowUpRight
                        className="w-4 h-4 text-[#0D0D0C] dark:text-[#F2F1EC] group-hover:text-[#1E4631] dark:group-hover:text-[#4E946C] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
                        strokeWidth={1.6}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

      {/* Contrasting Saturated Black Editorial Plane: Про автора */}
      <section
        aria-label="Про автора та концепція видання"
        className={`relative z-10 border-t ${
          isDark
            ? 'bg-[#141412] text-[#F2F1EC] border-[#252522]'
            : 'bg-[#0D0D0C] text-[#F5F4EF] border-[#0D0D0C]'
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 py-14 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-3">
            <div className="border border-white/15 p-2.5 bg-[#191917]">
              <div className="aspect-[4/5] overflow-hidden bg-[#1E1E1B]">
                <img
                  src="/src/assets/images/author_portrait_desk_1795025673568.jpg"
                  alt="Андрій Даньків — портрет"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="w-full h-full object-cover grayscale contrast-125"
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-9 space-y-5 lg:pl-6">
            <div className="flex items-center gap-3 font-mono text-[11px] tracking-widest text-[#94948C]">
              <span className="inline-block w-2 h-2 bg-[#4E946C]" aria-hidden="true" />
              <span>ПРО АВТОРА</span>
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-[44px] font-medium leading-[1.15] tracking-tight text-[#F5F4EF] max-w-[34ch]">
              <EditorialTypewriter
                text="Тексти, що фіксують паузи між подіями, пам’ять простору і тиху механіку внутрішнього діалогу."
                delay={0.08}
                charDelay={0.015}
                charDuration={0.2}
                triggerOnView
                showCaret
              />
            </h2>
            <p className="text-sm leading-relaxed text-[#B8B7B0] max-w-[60ch]">
              Цей простір об’єднує поетичні цикли, прозові тексти, авторський блог із робочими спостереженнями та крамницю — від друкованих примірників і скляних антирамок до відкритих рукописів у процесі написання.
            </p>
          </div>
        </div>
      </section>

      {/* Editorial Colophon Footer */}
      <footer
        className={`relative z-10 border-t transition-colors ${
          isDark
            ? 'bg-[#0B0B0A] border-[#252522] text-[#94948C]'
            : 'bg-[#F5F4EF] border-[#0D0D0C]/14 text-[#6B6B65]'
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 py-6 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-signature text-2xl sm:text-[26px] font-normal leading-none text-[#0D0D0C] dark:text-[#F2F1EC]">
              Андрій Даньків
            </span>
            <span className="font-mono tabular-nums">© 2026</span>
            <span aria-hidden="true">/</span>
            <span className="font-mono tabular-nums">
              Переглядів: <strong className="text-[#0D0D0C] dark:text-[#F2F1EC] font-medium">{uniqueVisitors}</strong>
            </span>
          </div>

          {guestUser && (
            <div className="flex flex-wrap items-center gap-5">
              <span className="inline-flex items-center gap-3">
                <span className="text-[#0D0D0C] dark:text-[#F2F1EC]">
                  {isAdmin ? 'Адміністратор: ' : 'Читач: '}
                  <strong>{guestUser.displayName}</strong>
                </span>
                <button
                  type="button"
                  onClick={onLogoutGuest}
                  className="underline underline-offset-4 hover:text-[#1E4631] dark:hover:text-[#4E946C] cursor-pointer"
                >
                  Вийти
                </button>
              </span>
              {isAdmin && (
                <>
                  <span aria-hidden="true">/</span>
                  <button
                    type="button"
                    onClick={onOpenAuthorStudio}
                    className="text-[#1E4631] dark:text-[#4E946C] font-semibold hover:underline underline-offset-4 cursor-pointer"
                  >
                    Кабінет автора
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </footer>
    </section>
  );
}
