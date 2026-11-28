import type { CatalogResponse, ProseChapter } from '../types.ts';
import { parseBlogContentBlocks } from './blogMedia.ts';

const IDB_NAME = 'dankiv_offline_library_v1';
const IDB_VERSION = 1;
const STORE_META = 'meta';
const STORE_PROSE_TEXT = 'proseTexts';
const STORE_PROSE_PDF = 'prosePdfs';
const CATALOG_KEY = 'catalog_snapshot';
const LS_CATALOG_FALLBACK_KEY = 'dankiv_offline_catalog_fallback_v1';

interface StoredProseTextRecord {
  id: string;
  content: string;
  chapters?: ProseChapter[];
  updatedAt: number;
}

interface StoredProsePdfRecord {
  id: string;
  blob: Blob;
  updatedAt: number;
}

function openOfflineDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
        if (!db.objectStoreNames.contains(STORE_PROSE_TEXT)) {
          db.createObjectStore(STORE_PROSE_TEXT, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_PROSE_PDF)) {
          db.createObjectStore(STORE_PROSE_PDF, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  return openOfflineDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

function idbPut(storeName: string, value: unknown, key?: string): Promise<void> {
  return openOfflineDb().then((db) => {
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (key !== undefined) {
          store.put(value, key);
        } else {
          store.put(value);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  });
}

export async function saveOfflineCatalog(catalog: CatalogResponse): Promise<void> {
  await idbPut(STORE_META, { catalog, updatedAt: Date.now() }, CATALOG_KEY);
  try {
    localStorage.setItem(LS_CATALOG_FALLBACK_KEY, JSON.stringify(catalog));
  } catch {
    // Ignore localStorage quota exceeded when catalog is large (IndexedDB holds full payload)
  }
}

export async function readOfflineCatalog(): Promise<CatalogResponse | null> {
  const record = await idbGet<{ catalog?: CatalogResponse }>(STORE_META, CATALOG_KEY);
  if (record?.catalog && Array.isArray(record.catalog.poems)) {
    return record.catalog;
  }
  try {
    const raw = localStorage.getItem(LS_CATALOG_FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogResponse;
    return parsed && Array.isArray(parsed.poems) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveOfflineProseContent(
  proseId: string,
  content: string,
  chapters?: ProseChapter[]
): Promise<void> {
  if (!proseId) return;
  const record: StoredProseTextRecord = {
    id: proseId,
    content,
    ...(Array.isArray(chapters) ? { chapters } : {}),
    updatedAt: Date.now(),
  };
  await idbPut(STORE_PROSE_TEXT, record);
}

export async function readOfflineProseContent(
  proseId: string
): Promise<{ content: string; chapters?: ProseChapter[] } | null> {
  if (!proseId) return null;
  const record = await idbGet<StoredProseTextRecord>(STORE_PROSE_TEXT, proseId);
  if (!record || typeof record.content !== 'string') return null;
  return {
    content: record.content,
    chapters: Array.isArray(record.chapters) ? record.chapters : undefined,
  };
}

export async function saveOfflineProsePdf(proseId: string, blob: Blob): Promise<void> {
  if (!proseId || !blob || blob.size === 0) return;
  const record: StoredProsePdfRecord = {
    id: proseId,
    blob,
    updatedAt: Date.now(),
  };
  await idbPut(STORE_PROSE_PDF, record);
}

export async function readOfflineProsePdf(proseId: string): Promise<Blob | null> {
  if (!proseId) return null;
  const record = await idbGet<StoredProsePdfRecord>(STORE_PROSE_PDF, proseId);
  if (!record || !(record.blob instanceof Blob)) return null;
  return record.blob;
}

export function collectCatalogMediaUrls(catalog: CatalogResponse): string[] {
  const urls = new Set<string>();
  const maybeAdd = (raw?: string | null) => {
    if (!raw || typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (
      trimmed.startsWith('/uploads/') ||
      trimmed.startsWith('/assets/') ||
      trimmed.startsWith('/src/assets/')
    ) {
      urls.add(trimmed);
    }
  };

  maybeAdd(catalog.authorPhotoUrl);
  for (const photo of catalog.authorPhotos || []) maybeAdd(photo);
  for (const work of catalog.prose || []) {
    for (const img of work.moodboardUrls || []) maybeAdd(img);
  }
  for (const post of catalog.blog || []) {
    maybeAdd(post.coverImage);
    for (const block of parseBlogContentBlocks(post.content || '')) {
      if (block.type === 'photo') maybeAdd(block.item.url);
    }
  }
  for (const product of catalog.products || []) {
    maybeAdd(product.coverImage);
  }
  for (const wPoem of catalog.weeklyPoems || []) {
    maybeAdd(wPoem.imageUrl);
  }
  for (const wProse of catalog.weeklyProse || []) {
    for (const img of wProse.moodboardUrls || []) maybeAdd(img);
  }

  return Array.from(urls).slice(0, 80);
}

export async function warmOfflineMediaCache(urls: string[]): Promise<void> {
  if (
    typeof window === 'undefined' ||
    !('caches' in window) ||
    !navigator.onLine ||
    urls.length === 0
  ) {
    return;
  }
  try {
    const cache = await window.caches.open('uploaded-media-cache');
    for (const url of urls) {
      if (!navigator.onLine) break;
      try {
        const existing = await cache.match(url);
        if (!existing) {
          const res = await fetch(url, { credentials: 'same-origin' });
          if (res.ok) {
            await cache.put(url, res);
          }
        }
      } catch {
        // Ignore single media warm error
      }
    }
  } catch {
    // CacheStorage unavailable
  }
}

const USER_LIKED_POEMS_KEY_PREFIX = 'dankiv_user_liked_poems_v1:';

export function readLocalUserLikedPoemIds(email?: string | null): string[] {
  if (typeof window === 'undefined' || !email) return [];
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];
  try {
    const raw = localStorage.getItem(`${USER_LIKED_POEMS_KEY_PREFIX}${normalized}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))
    );
  } catch {
    return [];
  }
}

export function writeLocalUserLikedPoemIds(
  email?: string | null,
  likedPoemIds?: string[] | null
): void {
  if (typeof window === 'undefined' || !email || !Array.isArray(likedPoemIds)) return;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  try {
    const clean = Array.from(
      new Set(
        likedPoemIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      )
    ).slice(0, 500);
    localStorage.setItem(`${USER_LIKED_POEMS_KEY_PREFIX}${normalized}`, JSON.stringify(clean));
  } catch {
    // Ignore storage quota errors
  }
}

