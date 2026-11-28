import { preserveFormattedText } from './textFormatting.ts';

export const PROSE_WORDS_PER_PAGE = 260;

export function countProseWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function countPagesForText(text: string, wordsPerPage = PROSE_WORDS_PER_PAGE): number {
  const words = countProseWords(text);
  if (words <= 0) return 0;
  return Math.max(1, Math.ceil(words / wordsPerPage));
}

export function computeProseWorkPages(options: {
  content?: string;
  chapters?: Array<{ content?: string }>;
  hasPdf?: boolean;
  fallbackPages?: number;
}): number {
  const mainPages = countPagesForText(options.content || '');
  const chapterPages = Array.isArray(options.chapters)
    ? options.chapters.reduce((sum, ch) => sum + countPagesForText(ch.content || ''), 0)
    : 0;
  const textPages = mainPages + chapterPages;
  const fallback =
    typeof options.fallbackPages === 'number' &&
    Number.isFinite(options.fallbackPages) &&
    options.fallbackPages > 0
      ? Math.round(options.fallbackPages)
      : 1;

  if (options.hasPdf) {
    return Math.max(1, textPages, fallback);
  }
  return textPages > 0 ? textPages : Math.max(1, fallback);
}

/**
 * Splits prose text into readable pages (~wordsPerPage words per page)
 * while preserving paragraph structure, explicit line breaks, and column indentation.
 */
export function paginateProseText(text: string, wordsPerPage = PROSE_WORDS_PER_PAGE): string[][] {
  const normalized = preserveFormattedText(text);
  if (!normalized) return [];

  const safeLimit = Math.max(120, Math.round(wordsPerPage));
  const rawParagraphs = normalized
    .split(/\n{2,}/)
    .map((p) => preserveFormattedText(p))
    .filter(Boolean);

  const units: string[] = [];

  for (const para of rawParagraphs) {
    const lines = para.split('\n');
    const totalParaWords = countProseWords(para);

    if (totalParaWords <= safeLimit) {
      units.push(para);
      continue;
    }

    if (lines.length > 1) {
      let currentBlockLines: string[] = [];
      let currentBlockWords = 0;

      for (const line of lines) {
        const lineWords = countProseWords(line);
        if (currentBlockLines.length > 0 && currentBlockWords + lineWords > safeLimit) {
          units.push(currentBlockLines.join('\n'));
          currentBlockLines = [line];
          currentBlockWords = lineWords;
        } else {
          currentBlockLines.push(line);
          currentBlockWords += lineWords;
        }
      }

      if (currentBlockLines.length > 0) {
        units.push(currentBlockLines.join('\n'));
      }
      continue;
    }

    // Single long prose paragraph without explicit internal line breaks
    const leadingIndentMatch = para.match(/^[ \t]*/);
    const leadingIndent = leadingIndentMatch ? leadingIndentMatch[0] : '';
    const words = para.trimStart().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += safeLimit) {
      const slice = words.slice(i, i + safeLimit).join(' ');
      units.push(i === 0 && leadingIndent ? `${leadingIndent}${slice}` : slice);
    }
  }

  const pages: string[][] = [];
  let currentParts: string[] = [];
  let currentWords = 0;

  for (const unit of units) {
    const unitWords = countProseWords(unit);
    if (currentParts.length > 0 && currentWords + unitWords > safeLimit) {
      pages.push(currentParts);
      currentParts = [unit];
      currentWords = unitWords;
    } else {
      currentParts.push(unit);
      currentWords += unitWords;
    }
  }

  if (currentParts.length > 0) {
    pages.push(currentParts);
  }

  return pages.length > 0 ? pages : [[normalized]];
}

export function getProsePreviewPages(
  text: string,
  maxPreviewPages = 2,
  wordsPerPage = PROSE_WORDS_PER_PAGE
): { previewPages: string[]; previewText: string; totalPages: number } {
  const allPages = paginateProseText(text, wordsPerPage);
  if (allPages.length === 0) {
    return { previewPages: [], previewText: '', totalPages: 0 };
  }
  const previewPages = allPages
    .slice(0, Math.max(1, maxPreviewPages))
    .map((parts) => parts.join('\n\n'));
  return {
    previewPages,
    previewText: previewPages.join('\n\n'),
    totalPages: allPages.length,
  };
}
