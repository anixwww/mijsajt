export type BlogMediaPlacement = 'start' | 'end' | number;

export interface BlogPhotoMediaItem {
  id: string;
  kind: 'photo';
  url: string;
  caption?: string;
}

export interface BlogTrackMediaItem {
  id: string;
  kind: 'track';
  title: string;
  artist: string;
  soundcloudUrl: string;
  embedTargetUrl: string;
  artworkUrl?: string;
}

export interface BlogYoutubeMediaItem {
  id: string;
  kind: 'youtube';
  videoId: string;
  youtubeUrl: string;
  title: string;
  authorName?: string;
  thumbnailUrl?: string;
  caption?: string;
}

export interface BlogFilmMetaItem {
  id: string;
  kind: 'film';
  filmTitle?: string;
  director?: string;
  releaseYear?: number;
  country?: string;
  runtimeMinutes?: number;
  rating?: number;
  verdict?: string;
  watchFormat?: string;
  hasSpoilers?: boolean;
}

export type BlogMediaItem = BlogPhotoMediaItem | BlogTrackMediaItem | BlogYoutubeMediaItem;

export type BlogMediaDraftItem = BlogMediaItem & {
  placement: BlogMediaPlacement;
};

export type BlogContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'photo'; item: BlogPhotoMediaItem }
  | { type: 'track'; item: BlogTrackMediaItem }
  | { type: 'youtube'; item: BlogYoutubeMediaItem };

const BLOG_MEDIA_PREFIX = ':::blog-media ';
const BLOG_MEDIA_SUFFIX = ':::';
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function isValidBlogPhotoUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 1000) return false;
  return /^(\/src\/assets\/|\/uploads\/|\/assets\/|https?:\/\/)/i.test(trimmed);
}

export function extractYouTubeVideoId(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 500) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

    let candidateId: string | null = null;
    if (host === 'youtu.be') {
      const seg = parsed.pathname.split('/').filter(Boolean)[0] || '';
      candidateId = seg;
    } else if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (parsed.pathname === '/watch' || parsed.pathname === '/watch/') {
        candidateId = parsed.searchParams.get('v');
      } else if (
        pathParts[0] === 'embed' ||
        pathParts[0] === 'shorts' ||
        pathParts[0] === 'live' ||
        pathParts[0] === 'v'
      ) {
        candidateId = pathParts[1] || null;
      } else {
        candidateId = parsed.searchParams.get('v');
      }
    }

    if (candidateId && YOUTUBE_VIDEO_ID_RE.test(candidateId)) {
      return candidateId;
    }
    return null;
  } catch {
    return null;
  }
}

export function isValidYouTubeUrl(rawUrl: unknown): rawUrl is string {
  return Boolean(extractYouTubeVideoId(rawUrl));
}

export function getYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function getYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?rel=0`;
}

export function getYouTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

export function isValidSoundCloudUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 500) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'soundcloud.com' ||
      host.endsWith('.soundcloud.com') ||
      host === 'snd.sc'
    );
  } catch {
    return false;
  }
}

export function sanitizeFilmMeta(raw: unknown): BlogFilmMetaItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const filmTitle =
    typeof obj.filmTitle === 'string' && obj.filmTitle.trim()
      ? obj.filmTitle.trim().slice(0, 180)
      : undefined;
  const director =
    typeof obj.director === 'string' && obj.director.trim()
      ? obj.director.trim().slice(0, 140)
      : undefined;
  const country =
    typeof obj.country === 'string' && obj.country.trim()
      ? obj.country.trim().slice(0, 100)
      : undefined;
  const verdict =
    typeof obj.verdict === 'string' && obj.verdict.trim()
      ? obj.verdict.trim().slice(0, 260)
      : undefined;
  const watchFormat =
    typeof obj.watchFormat === 'string' && obj.watchFormat.trim()
      ? obj.watchFormat.trim().slice(0, 80)
      : undefined;

  const yearNum = Number(obj.releaseYear);
  const releaseYear =
    Number.isFinite(yearNum) && yearNum >= 1888 && yearNum <= 2100
      ? Math.round(yearNum)
      : undefined;

  const runtimeNum = Number(obj.runtimeMinutes);
  const runtimeMinutes =
    Number.isFinite(runtimeNum) && runtimeNum >= 1 && runtimeNum <= 1500
      ? Math.round(runtimeNum)
      : undefined;

  const ratingNum = Number(obj.rating);
  const rating =
    Number.isFinite(ratingNum) && ratingNum >= 0.5 && ratingNum <= 10
      ? Math.round(ratingNum * 2) / 2
      : undefined;

  const hasSpoilers = obj.hasSpoilers === true ? true : undefined;

  if (
    !filmTitle &&
    !director &&
    !releaseYear &&
    !country &&
    !runtimeMinutes &&
    !rating &&
    !verdict &&
    !watchFormat &&
    !hasSpoilers
  ) {
    return null;
  }

  return {
    id: 'film-meta',
    kind: 'film',
    ...(filmTitle ? { filmTitle } : {}),
    ...(director ? { director } : {}),
    ...(releaseYear ? { releaseYear } : {}),
    ...(country ? { country } : {}),
    ...(runtimeMinutes ? { runtimeMinutes } : {}),
    ...(rating ? { rating } : {}),
    ...(verdict ? { verdict } : {}),
    ...(watchFormat ? { watchFormat } : {}),
    ...(hasSpoilers ? { hasSpoilers } : {}),
  };
}

function sanitizeParsedSegmentItem(
  raw: unknown,
  fallbackId: string
): BlogMediaItem | BlogFilmMetaItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id =
    typeof obj.id === 'string' && obj.id.trim()
      ? obj.id.trim().slice(0, 80)
      : fallbackId;

  if (obj.kind === 'film') {
    return sanitizeFilmMeta(obj);
  }

  if (obj.kind === 'photo') {
    if (!isValidBlogPhotoUrl(obj.url)) return null;
    const caption =
      typeof obj.caption === 'string' && obj.caption.trim()
        ? obj.caption.trim().slice(0, 240)
        : undefined;
    return {
      id,
      kind: 'photo',
      url: obj.url.trim(),
      ...(caption ? { caption } : {}),
    };
  }

  if (obj.kind === 'track') {
    if (!isValidSoundCloudUrl(obj.soundcloudUrl)) return null;
    const embedRaw =
      typeof obj.embedTargetUrl === 'string' && obj.embedTargetUrl.trim()
        ? obj.embedTargetUrl.trim()
        : obj.soundcloudUrl.trim();
    if (!isValidSoundCloudUrl(embedRaw)) return null;
    const artwork =
      typeof obj.artworkUrl === 'string' &&
      obj.artworkUrl.trim().startsWith('https://')
        ? obj.artworkUrl.trim().slice(0, 500)
        : undefined;
    return {
      id,
      kind: 'track',
      title:
        typeof obj.title === 'string' && obj.title.trim()
          ? obj.title.trim().slice(0, 200)
          : 'Трек із SoundCloud',
      artist:
        typeof obj.artist === 'string' && obj.artist.trim()
          ? obj.artist.trim().slice(0, 140)
          : 'SoundCloud',
      soundcloudUrl: obj.soundcloudUrl.trim(),
      embedTargetUrl: embedRaw,
      ...(artwork ? { artworkUrl: artwork } : {}),
    };
  }

  if (obj.kind === 'youtube') {
    const rawVideoId = typeof obj.videoId === 'string' ? obj.videoId.trim() : '';
    const videoId = YOUTUBE_VIDEO_ID_RE.test(rawVideoId)
      ? rawVideoId
      : extractYouTubeVideoId(obj.youtubeUrl);
    if (!videoId) return null;
    const youtubeUrl = getYouTubeWatchUrl(videoId);
    const thumbnailUrl =
      typeof obj.thumbnailUrl === 'string' &&
      /^https:\/\//i.test(obj.thumbnailUrl.trim())
        ? obj.thumbnailUrl.trim().slice(0, 500)
        : getYouTubeThumbnailUrl(videoId);
    const caption =
      typeof obj.caption === 'string' && obj.caption.trim()
        ? obj.caption.trim().slice(0, 240)
        : undefined;
    const authorName =
      typeof obj.authorName === 'string' && obj.authorName.trim()
        ? obj.authorName.trim().slice(0, 140)
        : undefined;
    return {
      id,
      kind: 'youtube',
      videoId,
      youtubeUrl,
      title:
        typeof obj.title === 'string' && obj.title.trim()
          ? obj.title.trim().slice(0, 200)
          : 'Відео з YouTube',
      ...(authorName ? { authorName } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(caption ? { caption } : {}),
    };
  }

  return null;
}

export function serializeBlogMediaToken(item: BlogMediaItem | BlogFilmMetaItem): string {
  if (item.kind === 'film') {
    const clean = sanitizeFilmMeta(item);
    if (!clean) return '';
    return `${BLOG_MEDIA_PREFIX}${JSON.stringify(clean)}${BLOG_MEDIA_SUFFIX}`;
  }

  const clean: Record<string, string> =
    item.kind === 'photo'
      ? {
          id: item.id,
          kind: 'photo',
          url: item.url.trim(),
          ...(item.caption?.trim() ? { caption: item.caption.trim().slice(0, 240) } : {}),
        }
      : item.kind === 'youtube'
        ? {
            id: item.id,
            kind: 'youtube',
            videoId: item.videoId.trim(),
            youtubeUrl: item.youtubeUrl.trim(),
            title: item.title.trim().slice(0, 200),
            ...(item.authorName?.trim() ? { authorName: item.authorName.trim().slice(0, 140) } : {}),
            ...(item.thumbnailUrl?.trim() ? { thumbnailUrl: item.thumbnailUrl.trim().slice(0, 500) } : {}),
            ...(item.caption?.trim() ? { caption: item.caption.trim().slice(0, 240) } : {}),
          }
        : {
            id: item.id,
            kind: 'track',
            title: item.title.trim().slice(0, 200),
            artist: item.artist.trim().slice(0, 140),
            soundcloudUrl: item.soundcloudUrl.trim(),
            embedTargetUrl: item.embedTargetUrl.trim(),
            ...(item.artworkUrl?.trim() ? { artworkUrl: item.artworkUrl.trim().slice(0, 500) } : {}),
          };
  return `${BLOG_MEDIA_PREFIX}${JSON.stringify(clean)}${BLOG_MEDIA_SUFFIX}`;
}

function tryParseMediaSegment(
  segment: string,
  fallbackIndex: number
): BlogMediaItem | BlogFilmMetaItem | null {
  const trimmed = segment.trim();
  if (!trimmed.startsWith(BLOG_MEDIA_PREFIX) || !trimmed.endsWith(BLOG_MEDIA_SUFFIX)) {
    return null;
  }
  const jsonPart = trimmed
    .slice(BLOG_MEDIA_PREFIX.length, trimmed.length - BLOG_MEDIA_SUFFIX.length)
    .trim();
  if (!jsonPart) return null;
  try {
    const parsed = JSON.parse(jsonPart);
    return sanitizeParsedSegmentItem(parsed, `blog-media-${fallbackIndex}`);
  } catch {
    return null;
  }
}

export function extractBlogFilmMeta(rawContent: string): {
  filmMeta: BlogFilmMetaItem | null;
  firstPhotoUrl: string | null;
  firstVideoThumbnailUrl: string | null;
} {
  if (!rawContent || typeof rawContent !== 'string') {
    return { filmMeta: null, firstPhotoUrl: null, firstVideoThumbnailUrl: null };
  }
  const lines = rawContent.split('\n');
  let filmMeta: BlogFilmMetaItem | null = null;
  let firstPhotoUrl: string | null = null;
  let firstVideoThumbnailUrl: string | null = null;
  let counter = 0;

  for (const line of lines) {
    const parsed = tryParseMediaSegment(line, counter + 1);
    if (!parsed) continue;
    counter += 1;
    if (parsed.kind === 'film' && !filmMeta) {
      filmMeta = parsed;
    } else if (parsed.kind === 'photo' && !firstPhotoUrl) {
      firstPhotoUrl = parsed.url;
    } else if (parsed.kind === 'youtube' && !firstVideoThumbnailUrl) {
      firstVideoThumbnailUrl = parsed.thumbnailUrl || getYouTubeThumbnailUrl(parsed.videoId);
    }
    if (filmMeta && firstPhotoUrl && firstVideoThumbnailUrl) break;
  }

  return { filmMeta, firstPhotoUrl, firstVideoThumbnailUrl };
}

export function parseBlogContentBlocks(rawContent: string): BlogContentBlock[] {
  if (!rawContent || typeof rawContent !== 'string') return [];
  const rawSegments = rawContent
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  const blocks: BlogContentBlock[] = [];
  let mediaCounter = 0;

  for (const segment of rawSegments) {
    // Handle case where a media token is on its own line inside a segment
    const lines = segment.split('\n');
    let textBuffer: string[] = [];

    const flushText = () => {
      const joined = textBuffer.join('\n').trim();
      if (joined) {
        blocks.push({ type: 'paragraph', text: joined });
      }
      textBuffer = [];
    };

    for (const line of lines) {
      const maybeMedia = tryParseMediaSegment(line, mediaCounter + 1);
      if (maybeMedia) {
        flushText();
        mediaCounter += 1;
        if (maybeMedia.kind === 'photo') {
          blocks.push({ type: 'photo', item: maybeMedia });
        } else if (maybeMedia.kind === 'track') {
          blocks.push({ type: 'track', item: maybeMedia });
        } else if (maybeMedia.kind === 'youtube') {
          blocks.push({ type: 'youtube', item: maybeMedia });
        }
      } else {
        textBuffer.push(line);
      }
    }

    flushText();
  }

  return blocks;
}

export function splitBlogParagraphs(plainText: string): string[] {
  if (!plainText || typeof plainText !== 'string') return [];
  return plainText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function stripBlogMediaTokens(rawContent: string): string {
  return parseBlogContentBlocks(rawContent)
    .filter((b): b is { type: 'paragraph'; text: string } => b.type === 'paragraph')
    .map((b) => b.text)
    .join('\n\n');
}

export function unpackBlogContentForEditor(rawContent: string): {
  text: string;
  media: BlogMediaDraftItem[];
  filmMeta: BlogFilmMetaItem | null;
} {
  const { filmMeta } = extractBlogFilmMeta(rawContent);
  const blocks = parseBlogContentBlocks(rawContent);
  const totalParagraphs = blocks.filter((b) => b.type === 'paragraph').length;
  const paragraphs: string[] = [];
  const media: BlogMediaDraftItem[] = [];

  let seenParagraphs = 0;
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      paragraphs.push(block.text);
      seenParagraphs += 1;
    } else {
      let placement: BlogMediaPlacement;
      if (seenParagraphs === 0) {
        placement = 'start';
      } else if (seenParagraphs >= totalParagraphs) {
        placement = 'end';
      } else {
        placement = seenParagraphs;
      }
      media.push({
        ...block.item,
        placement,
      });
    }
  }

  return {
    text: paragraphs.join('\n\n'),
    media,
    filmMeta,
  };
}

export function packBlogContentWithMedia(
  plainText: string,
  mediaItems: BlogMediaDraftItem[],
  filmMeta?: BlogFilmMetaItem | null
): string {
  const paragraphs = splitBlogParagraphs(plainText);
  const out: string[] = [];

  if (filmMeta) {
    const token = serializeBlogMediaToken(filmMeta);
    if (token) out.push(token);
  }

  for (const item of mediaItems) {
    if (item.placement === 'start') {
      const token = serializeBlogMediaToken(item);
      if (token) out.push(token);
    }
  }

  paragraphs.forEach((paragraph, idx) => {
    out.push(paragraph);
    const paragraphNumber = idx + 1;
    const isLastParagraph = paragraphNumber === paragraphs.length;
    if (!isLastParagraph) {
      for (const item of mediaItems) {
        if (item.placement === paragraphNumber) {
          const token = serializeBlogMediaToken(item);
          if (token) out.push(token);
        }
      }
    }
  });

  // After the last paragraph: items explicitly placed after paragraph N (when N == total) or > N or 'end'
  for (const item of mediaItems) {
    if (
      item.placement === 'end' ||
      (typeof item.placement === 'number' && item.placement >= paragraphs.length)
    ) {
      const token = serializeBlogMediaToken(item);
      if (token) out.push(token);
    }
  }

  return out.join('\n\n');
}
