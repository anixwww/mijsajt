export const COVER_PRESETS = [
  {
    label: 'Карпатська туш',
    url: '/src/assets/images/ebook_cover_silence_1795025673857.webp',
  },
  {
    label: 'Лляні аркуші',
    url: '/src/assets/images/ebook_cover_letters_1795025674171.webp',
  },
  {
    label: 'Нічний стіл',
    url: '/src/assets/images/wip_manuscript_novel_1795025674997.webp',
  },
  {
    label: 'Осіннє вікно',
    url: '/src/assets/images/blog_essay_autumn_1795025674773.webp',
  },
  {
    label: 'Портрет автора',
    url: '/src/assets/images/author_portrait_desk_1795025673568.webp',
  },
];

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export const STUDIO_INPUT_CLASS =
  'w-full px-3 py-2 text-sm bg-[#EFECE6] dark:bg-[#1B1B1B] rounded-lg text-[#141413] dark:text-[#EDEAE1] placeholder:text-[#787872] dark:placeholder:text-[#7E7B73] focus:bg-[#FAF9F5] dark:focus:bg-[#323232] focus:outline-none transition-colors';

export const STUDIO_INPUT_SM_CLASS =
  'w-full px-3 py-1.5 text-xs bg-[#EFECE6] dark:bg-[#1B1B1B] rounded-lg text-[#141413] dark:text-[#EDEAE1] placeholder:text-[#787872] dark:placeholder:text-[#7E7B73] focus:bg-[#FAF9F5] dark:focus:bg-[#323232] focus:outline-none transition-colors';

export const STUDIO_LABEL_CLASS =
  'block text-xs font-medium text-[#5C5C58] dark:text-[#A6A196] mb-1.5';

export type GetAuthHeadersFn = (
  extra?: Record<string, string>
) => Promise<Record<string, string> | null>;
