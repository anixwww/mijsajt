import type { CSSProperties } from 'react';
import type { ProseTagPresetColor } from '../types.ts';

export interface ProseTagColorPreset {
  id: string;
  name: string;
  hex: string;
  badgeClass: string;
  swatchClass: string;
  badgeStyle?: CSSProperties;
  swatchStyle?: CSSProperties;
}

export const PROSE_TAG_COLORS: Record<ProseTagPresetColor, ProseTagColorPreset> = {
  rose: {
    id: 'rose',
    name: 'Малиновий',
    hex: '#E11D48',
    badgeClass:
      'bg-rose-600 text-white dark:bg-rose-500 dark:text-white shadow-[0_2px_10px_-3px_rgba(225,29,72,0.55)]',
    swatchClass: 'bg-rose-600 dark:bg-rose-500',
  },
  amber: {
    id: 'amber',
    name: 'Бурштиновий',
    hex: '#FBBF24',
    badgeClass:
      'bg-amber-400 text-[#1E1400] dark:bg-amber-400 dark:text-[#1E1400] shadow-[0_2px_10px_-3px_rgba(245,158,11,0.55)]',
    swatchClass: 'bg-amber-400',
  },
  emerald: {
    id: 'emerald',
    name: 'Смарагдовий',
    hex: '#059669',
    badgeClass:
      'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-white shadow-[0_2px_10px_-3px_rgba(16,185,129,0.5)]',
    swatchClass: 'bg-emerald-600 dark:bg-emerald-500',
  },
  sky: {
    id: 'sky',
    name: 'Небесний',
    hex: '#0284C7',
    badgeClass:
      'bg-sky-600 text-white dark:bg-sky-500 dark:text-white shadow-[0_2px_10px_-3px_rgba(2,132,199,0.5)]',
    swatchClass: 'bg-sky-600 dark:bg-sky-500',
  },
  violet: {
    id: 'violet',
    name: 'Фіолетовий',
    hex: '#7C3AED',
    badgeClass:
      'bg-violet-600 text-white dark:bg-violet-500 dark:text-white shadow-[0_2px_10px_-3px_rgba(124,58,237,0.55)]',
    swatchClass: 'bg-violet-600 dark:bg-violet-500',
  },
  coral: {
    id: 'coral',
    name: 'Кораловий',
    hex: '#EA580C',
    badgeClass:
      'bg-orange-600 text-white dark:bg-orange-500 dark:text-white shadow-[0_2px_10px_-3px_rgba(234,88,12,0.55)]',
    swatchClass: 'bg-orange-600 dark:bg-orange-500',
  },
  teal: {
    id: 'teal',
    name: 'Бірюзовий',
    hex: '#0D9488',
    badgeClass:
      'bg-teal-600 text-white dark:bg-teal-500 dark:text-white shadow-[0_2px_10px_-3px_rgba(13,148,136,0.5)]',
    swatchClass: 'bg-teal-600 dark:bg-teal-500',
  },
  indigo: {
    id: 'indigo',
    name: 'Індиго',
    hex: '#4F46E5',
    badgeClass:
      'bg-indigo-600 text-white dark:bg-indigo-500 dark:text-white shadow-[0_2px_10px_-3px_rgba(79,70,229,0.55)]',
    swatchClass: 'bg-indigo-600 dark:bg-indigo-500',
  },
};

export const PROSE_TAG_COLOR_LIST: ProseTagColorPreset[] = Object.values(PROSE_TAG_COLORS);

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexTagColor(color?: string): color is string {
  return Boolean(color && HEX_COLOR_RE.test(color.trim()));
}

function getContrastTextColor(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.42 ? '#141413' : '#FFFFFF';
}

export function getProseTagPreset(color?: string): ProseTagColorPreset {
  if (color && color in PROSE_TAG_COLORS) {
    return PROSE_TAG_COLORS[color as ProseTagPresetColor];
  }
  if (isHexTagColor(color)) {
    const normalizedHex = color.trim().toUpperCase();
    const textColor = getContrastTextColor(normalizedHex);
    return {
      id: normalizedHex,
      name: normalizedHex,
      hex: normalizedHex,
      badgeClass: 'shadow-sm',
      swatchClass: '',
      badgeStyle: {
        backgroundColor: normalizedHex,
        color: textColor,
      },
      swatchStyle: {
        backgroundColor: normalizedHex,
      },
    };
  }
  return PROSE_TAG_COLORS.rose;
}
