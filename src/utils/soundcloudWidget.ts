export interface SCPlayProgressPayload {
  currentPosition: number;
  loadedProgress: number;
  relativePosition: number;
}

export interface SCCurrentSound {
  id?: number;
  title?: string;
  duration?: number;
  waveform_url?: string;
  artwork_url?: string;
}

export interface SCWidgetInstance {
  bind: (eventName: string, listener: (payload?: unknown) => void) => void;
  unbind: (eventName: string) => void;
  load: (
    url: string,
    options?: {
      auto_play?: boolean;
      buying?: boolean;
      sharing?: boolean;
      download?: boolean;
      show_artwork?: boolean;
      show_playcount?: boolean;
      show_user?: boolean;
      hide_related?: boolean;
      show_comments?: boolean;
      show_reposts?: boolean;
      show_teaser?: boolean;
      visual?: boolean;
      callback?: () => void;
    }
  ) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (milliseconds: number) => void;
  setVolume: (volume: number) => void;
  getDuration: (callback: (durationMs: number) => void) => void;
  getPosition: (callback: (positionMs: number) => void) => void;
  getCurrentSound: (callback: (sound: SCCurrentSound | null) => void) => void;
  isPaused: (callback: (paused: boolean) => void) => void;
}

export interface SCWidgetNamespace {
  (iframeOrId: HTMLIFrameElement | string): SCWidgetInstance;
  Events: {
    READY: string;
    PLAY: string;
    PAUSE: string;
    FINISH: string;
    PLAY_PROGRESS: string;
    SEEK: string;
    ERROR: string;
  };
}

declare global {
  interface Window {
    SC?: {
      Widget?: SCWidgetNamespace;
    };
  }
}

let scApiPromise: Promise<SCWidgetNamespace> | null = null;

export function loadSoundCloudWidgetApi(): Promise<SCWidgetNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('SoundCloud Widget API is browser-only.'));
  }
  if (window.SC?.Widget) {
    return Promise.resolve(window.SC.Widget);
  }
  if (scApiPromise) {
    return scApiPromise;
  }

  scApiPromise = new Promise<SCWidgetNamespace>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-sc-widget-api="true"]'
    );
    if (existingScript) {
      if (existingScript.dataset.scLoaded === 'true') {
        if (window.SC?.Widget) {
          resolve(window.SC.Widget);
          return;
        }
        existingScript.remove();
      } else if (existingScript.dataset.scError === 'true') {
        existingScript.remove();
      } else {
        const timer = window.setTimeout(() => {
          scApiPromise = null;
          reject(new Error('Час очікування SoundCloud Widget API вичерпано.'));
        }, 10000);
        const checkReady = () => {
          window.clearTimeout(timer);
          if (window.SC?.Widget) {
            resolve(window.SC.Widget);
            return;
          }
          scApiPromise = null;
          reject(new Error('Не вдалося ініціалізувати SoundCloud Widget API.'));
        };
        existingScript.addEventListener('load', checkReady, { once: true });
        existingScript.addEventListener(
          'error',
          () => {
            window.clearTimeout(timer);
            scApiPromise = null;
            reject(new Error('Помилка завантаження SoundCloud Widget API.'));
          },
          { once: true }
        );
        return;
      }
    }

    const script = document.createElement('script');
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.async = true;
    script.setAttribute('data-sc-widget-api', 'true');
    const timer = window.setTimeout(() => {
      scApiPromise = null;
      reject(new Error('Час очікування завантаження плеєра SoundCloud вичерпано.'));
    }, 10000);
    script.onload = () => {
      window.clearTimeout(timer);
      script.dataset.scLoaded = 'true';
      if (window.SC?.Widget) {
        resolve(window.SC.Widget);
      } else {
        scApiPromise = null;
        reject(new Error('SoundCloud Widget API недоступний після завантаження.'));
      }
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      script.dataset.scError = 'true';
      scApiPromise = null;
      reject(new Error('Не вдалося завантажити плеєр SoundCloud.'));
    };
    document.head.appendChild(script);
  });

  return scApiPromise;
}

const ALLOWED_EMBED_HOSTS = new Set([
  'api.soundcloud.com',
  'w.soundcloud.com',
  'soundcloud.com',
  'www.soundcloud.com',
]);

export function getSoundCloudPlayerSrc(embedTargetUrl: string, autoPlay = false): string | null {
  try {
    const parsed = new URL(embedTargetUrl);
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_EMBED_HOSTS.has(parsed.hostname.toLowerCase())) return null;

    const params = new URLSearchParams({
      url: parsed.toString(),
      auto_play: autoPlay ? 'true' : 'false',
      hide_related: 'true',
      show_comments: 'false',
      show_user: 'true',
      show_reposts: 'false',
      show_teaser: 'false',
      show_artwork: 'true',
      visual: 'false',
      buying: 'false',
      sharing: 'false',
      download: 'false',
    });
    return `https://w.soundcloud.com/player/?${params.toString()}`;
  } catch {
    return null;
  }
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const waveformCache = new Map<string, number[]>();

export function normalizeWaveformJsonUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'wave.sndcdn.com' && !host.endsWith('.sndcdn.com')) return null;
    if (parsed.pathname.endsWith('.png')) {
      parsed.pathname = parsed.pathname.replace(/\.png$/i, '.json');
    }
    if (!parsed.pathname.endsWith('.json')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function fetchSoundCloudWaveform(rawWaveformUrl: string): Promise<number[] | null> {
  const jsonUrl = normalizeWaveformJsonUrl(rawWaveformUrl);
  if (!jsonUrl) return null;
  const cached = waveformCache.get(jsonUrl);
  if (cached) return cached;

  try {
    const res = await fetch(jsonUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { height?: number; samples?: unknown };
    if (!Array.isArray(data.samples) || data.samples.length === 0) return null;
    const maxHeight = typeof data.height === 'number' && data.height > 0 ? data.height : 140;
    const normalized = data.samples.map((v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.min(1, Math.max(0, n / maxHeight));
    });
    waveformCache.set(jsonUrl, normalized);
    return normalized;
  } catch {
    return null;
  }
}
