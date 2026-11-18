/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowLeft, Settings2, ShoppingBag } from 'lucide-react';
import type { GuestUser, SectionId } from '../types.ts';

interface SectionNavBarProps {
  activeSection: Exclude<SectionId, 'home'>;
  onNavigate: (section: SectionId) => void;
  cartCount: number;
  unlockedCount: number;
  onOpenDrawer: (tab?: 'cart' | 'library') => void;
  guestUser: GuestUser | null;
  isAdmin?: boolean;
  onLogoutGuest: () => void;
  onOpenAuthorStudio?: () => void;
  theme: 'light' | 'dark';
}

export function SectionNavBar({
  activeSection,
  onNavigate,
  cartCount,
  unlockedCount,
  onOpenDrawer,
  guestUser,
  isAdmin = false,
  onLogoutGuest,
  onOpenAuthorStudio,
  theme,
}: SectionNavBarProps) {
  const isDark = theme === 'dark';
  const hasPanels = activeSection === 'store' || Boolean(guestUser) || (isAdmin && Boolean(onOpenAuthorStudio));

  return (
    <aside
      className={`shrink-0 lg:sticky lg:top-8 space-y-4 ${
        hasPanels ? 'w-full lg:w-56' : 'w-auto'
      }`}
      aria-label="Навігація розділу"
    >
      {/* Return-only-to-Home Arrow Button */}
      <button
        type="button"
        onClick={() => onNavigate('home')}
        title="На головну"
        aria-label="На головну"
        className={`w-11 h-11 flex items-center justify-center border transition-colors cursor-pointer ${
          isDark
            ? 'border-[#252522] bg-[#141412] text-[#F2F1EC] hover:bg-[#1E4631] hover:border-[#1E4631] hover:text-white'
            : 'border-[#0D0D0C]/16 bg-[#ECEAE2]/50 text-[#0D0D0C] hover:bg-[#1E4631] hover:border-[#1E4631] hover:text-white'
        }`}
      >
        <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
      </button>

      {/* Store Drawer Quick Access when in Store */}
      {activeSection === 'store' && (
        <div
          className={`border divide-y ${
            isDark
              ? 'border-[#252522] divide-[#252522] bg-[#141412]'
              : 'border-[#0D0D0C]/16 divide-[#0D0D0C]/12 bg-white'
          }`}
        >
          <button
            type="button"
            onClick={() => onOpenDrawer('cart')}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium hover:text-[#1E4631] dark:hover:text-[#4E946C] transition-colors cursor-pointer tabular-nums"
          >
            <span className="inline-flex items-center gap-2">
              <ShoppingBag className="w-3.5 h-3.5" strokeWidth={1.6} />
              <span>Кошик</span>
            </span>
            <span className="font-mono text-[11px]">{cartCount}</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenDrawer('library')}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium hover:text-[#1E4631] dark:hover:text-[#4E946C] transition-colors cursor-pointer tabular-nums"
          >
            <span>Мої придбання</span>
            <span className="font-mono text-[11px]">{unlockedCount}</span>
          </button>
        </div>
      )}

      {/* Signed-in Account Strip */}
      {guestUser && (
        <div
          className={`px-3 py-2 border flex items-center justify-between gap-2 text-[11px] ${
            isDark
              ? 'bg-[#141412] border-[#252522] text-[#94948C]'
              : 'bg-white border-[#0D0D0C]/16 text-[#6B6B65]'
          }`}
        >
          <span className="truncate font-medium text-[#0D0D0C] dark:text-[#F2F1EC]">
            {guestUser.displayName}
          </span>
          <button
            type="button"
            onClick={onLogoutGuest}
            className="underline underline-offset-2 hover:text-[#1E4631] dark:hover:text-[#4E946C] shrink-0 cursor-pointer"
          >
            Вийти
          </button>
        </div>
      )}

      {/* Quick Author Workspace Trigger (Admin-only) */}
      {isAdmin && onOpenAuthorStudio && (
        <button
          type="button"
          onClick={onOpenAuthorStudio}
          className={`w-full px-4 py-2.5 inline-flex items-center justify-center gap-2 text-xs font-semibold border transition-colors cursor-pointer ${
            isDark
              ? 'bg-[#141412] border-[#4E946C]/50 text-[#4E946C] hover:bg-[#2D6A4F] hover:text-white'
              : 'bg-[#0D0D0C] border-[#0D0D0C] text-[#F5F4EF] hover:bg-[#1E4631] hover:border-[#1E4631]'
          }`}
        >
          <Settings2 className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Кабінет автора</span>
        </button>
      )}
    </aside>
  );
}
