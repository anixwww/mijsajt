export function preserveFormattedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '')
    .replace(/[ \t]+$/gm, '');
}

export function getFirstFormattedExcerptLine(raw: string, maxLen = 140): string {
  const normalized = preserveFormattedText(raw);
  const firstLine = normalized.split('\n').find((line) => line.trim().length > 0);
  return firstLine ? firstLine.trim().slice(0, maxLen) : '';
}
