const DB_NAME = 'dankiv_device_access_v1';
const STORE_NAME = 'device_keys';

export interface StoredDeviceIdentity {
  domain: string;
  deviceId: string;
  email: string;
  label: string;
  publicKeySpki: string;
  privateKey: CryptoKey;
  createdAt: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  return arrayBufferToBase64(buffer)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function openDeviceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступний у цьому браузері.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'domain' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Не вдалося відкрити сховище пристрою.'));
  });
}

export function getDeviceDisplayLabel(): string {
  if (typeof navigator === 'undefined') return 'Поточний пристрій';
  const ua = navigator.userAgent || '';
  const platform =
    /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Android/i.test(ua)
        ? 'Android'
        : /Mac OS X/i.test(ua)
          ? 'macOS'
          : /Windows/i.test(ua)
            ? 'Windows'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Пристрій';
  const browser =
    /Edg\//i.test(ua)
      ? 'Edge'
      : /Chrome\//i.test(ua)
        ? 'Chrome'
        : /Firefox\//i.test(ua)
          ? 'Firefox'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : 'Браузер';
  return `${platform} · ${browser}`;
}

export async function getStoredDeviceIdentity(
  domain: string
): Promise<StoredDeviceIdentity | null> {
  try {
    const db = await openDeviceDb();
    return await new Promise<StoredDeviceIdentity | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(domain.toLowerCase());
      req.onsuccess = () => {
        const record = req.result as StoredDeviceIdentity | undefined;
        resolve(record && record.privateKey && record.deviceId ? record : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function ensureDeviceKeypair(
  domain: string,
  email: string
): Promise<StoredDeviceIdentity> {
  const normalizedDomain = domain.trim().toLowerCase();
  const existing = await getStoredDeviceIdentity(normalizedDomain);
  if (existing && existing.email.toLowerCase() === email.trim().toLowerCase()) {
    return existing;
  }

  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Браузер не підтримує WebCrypto для прив’язки пристрою.');
  }

  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    false,
    ['sign', 'verify']
  );

  const spkiBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeySpki = arrayBufferToBase64(spkiBuffer);
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  const deviceId =
    'dev_' +
    Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  const identity: StoredDeviceIdentity = {
    domain: normalizedDomain,
    deviceId,
    email: email.trim().toLowerCase(),
    label: getDeviceDisplayLabel(),
    publicKeySpki,
    privateKey: keyPair.privateKey,
    createdAt: new Date().toISOString(),
  };

  const db = await openDeviceDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(identity);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  return identity;
}

export async function signDeviceChallenge(
  identity: StoredDeviceIdentity,
  nonce: string
): Promise<string> {
  const message = `${nonce}|${identity.domain}|${identity.deviceId}|${identity.email}`;
  const encoded = new TextEncoder().encode(message);
  const signatureBuffer = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
    identity.privateKey,
    encoded
  );
  return arrayBufferToBase64Url(signatureBuffer);
}

export async function clearStoredDeviceIdentity(domain: string): Promise<void> {
  try {
    const db = await openDeviceDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(domain.trim().toLowerCase());
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore storage cleanup errors
  }
}
