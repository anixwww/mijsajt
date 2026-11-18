/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PineconeIcon } from './EditorialMarks.tsx';

interface FooterProps {
  uniqueVisitors: number;
  theme?: 'light' | 'dark';
}

export function Footer({ uniqueVisitors, theme = 'light' }: FooterProps) {
  const isDark = theme === 'dark';
  return (
    <footer
      className={`py-8 border-t transition-colors ${
        isDark
          ? 'bg-[#101813] border-[#253528] text-[#9AA89E]'
          : 'bg-[#F1F4EE] border-[#1B3B2B]/14 text-[#526356]'
      }`}
    >
      <div className="max-w-[1380px] mx-auto px-4 sm:px-8 lg:px-12 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <PineconeIcon className="w-4 h-4 text-[#1B3B2B] dark:text-[#52B788]" />
          <p className="font-signature text-2xl font-normal leading-none text-[#1A261E] dark:text-[#EAF0EC]">
            Андрій Даньків
          </p>
          <span className="font-mono text-xs tabular-nums">© 2026 Усі права захищено.</span>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
          <span>Переглядів:</span>
          <span className="font-medium text-[#0D0D0C] dark:text-[#F2F1EC]">
            {uniqueVisitors}
          </span>
        </div>
      </div>
    </footer>
  );
}
