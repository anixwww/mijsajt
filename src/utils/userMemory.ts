import type { GuestUser, PurchasedAccess } from '../types.ts';

const DB_NAME = 'dankiv_user_memory_v1';
const STORE_NAME = 'user_state';

export const GUEST_USER_STORAGE_KEY = 'dankiv_guest_user_v1';
export const REMEMBERED_PROFILE_STORAGE_KEY = 'dankiv_remembered_profile_v1';
export const CART_STORAGE_KEY = 'dankiv_cart_ids_v1';
export const UNLOCKED_STORAGE_KEY = 'dankiv_unlocked_access_v1';
export const THEME_STORAGE_KEY = 'dankiv_theme_v1';

export interface RememberedUserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoUrl?: string;
  provider: 'google' | 'email' | 'device';
  sessionToken?: string;
  savedAt: string;
}

export interface HydratedDeviceState {
  activeUser: GuestUser | null;
  rememberedProfile: RememberedUserProfile | null;
  cartIds: string[] | null;
  unlockedItems: PurchasedAccess[] | null;
  theme: 'light' | 'dark' | null;
}

function openMemoryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openMemoryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openMemoryDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const res = req.result as { key: string; value: T } | undefined;
        resolve(res ? res.value : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openMemoryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore cleanup errors
  }
}

export function getRememberedProfileSync(): RememberedUserProfile | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_PROFILE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RememberedUserProfile) : null;
  } catch {
    return null;
  }
}

export async function getRememberedProfile(): Promise<RememberedUserProfile | null> {
  const syncProfile = getRememberedProfileSync();
  if (syncProfile) return syncProfile;
  const idbProfile = await idbGet<RememberedUserProfile>('rememberedProfile');
  if (idbProfile) {
    try {
      localStorage.setItem(REMEMBERED_PROFILE_STORAGE_KEY, JSON.stringify(idbProfile));
    } catch {
      // Ignore storage errors
    }
  }
  return idbProfile;
}

export function saveActiveUserToDevice(user: GuestUser, rememberOnDevice = true): void {
  try {
    localStorage.setItem(GUEST_USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Ignore storage errors
  }
  void idbSet('activeUser', user);

  if (rememberOnDevice) {
    const remembered: RememberedUserProfile = {
      uid: user.uid,
      displayName: user.displayName,
      email: user.email,
      photoUrl: user.photoUrl,
      provider: user.provider,
      sessionToken: user.sessionToken,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(REMEMBERED_PROFILE_STORAGE_KEY, JSON.stringify(remembered));
    } catch {
      // Ignore storage errors
    }
    void idbSet('rememberedProfile', remembered);
  }
}

export function clearActiveUserFromDevice(forgetRememberedProfile = false): void {
  try {
    localStorage.removeItem(GUEST_USER_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
  void idbDelete('activeUser');

  if (forgetRememberedProfile) {
    try {
      localStorage.removeItem(REMEMBERED_PROFILE_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    void idbDelete('rememberedProfile');
  }
}

export function mirrorPreferenceToDevice(
  key: 'cartIds' | 'unlockedItems' | 'theme',
  value: string[] | PurchasedAccess[] | 'light' | 'dark'
): void {
  void idbSet(key, value);
}

export async function hydrateDeviceStateFromIndexedDB(): Promise<HydratedDeviceState> {
  const [activeUser, rememberedProfile, cartIds, unlockedItems, theme] = await Promise.all([
    idbGet<GuestUser>('activeUser'),
    idbGet<RememberedUserProfile>('rememberedProfile'),
    idbGet<string[]>('cartIds'),
    idbGet<PurchasedAccess[]>('unlockedItems'),
    idbGet<'light' | 'dark'>('theme'),
  ]);

  try {
    if (activeUser && !localStorage.getItem(GUEST_USER_STORAGE_KEY)) {
      localStorage.setItem(GUEST_USER_STORAGE_KEY, JSON.stringify(activeUser));
    }
    if (rememberedProfile && !localStorage.getItem(REMEMBERED_PROFILE_STORAGE_KEY)) {
      localStorage.setItem(REMEMBERED_PROFILE_STORAGE_KEY, JSON.stringify(rememberedProfile));
    }
    if (cartIds && !localStorage.getItem(CART_STORAGE_KEY)) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartIds));
    }
    if (unlockedItems && !localStorage.getItem(UNLOCKED_STORAGE_KEY)) {
      localStorage.setItem(UNLOCKED_STORAGE_KEY, JSON.stringify(unlockedItems));
    }
    if (theme && !localStorage.getItem(THEME_STORAGE_KEY)) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Ignore storage errors
  }

  return { activeUser, rememberedProfile, cartIds, unlockedItems, theme };
}
