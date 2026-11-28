import type { FirebaseApp } from 'firebase/app';
import type { Auth, GoogleAuthProvider, User, UserCredential } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Messaging } from 'firebase/messaging';
import firebaseConfig from '../firebase-applet-config.json';

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const DEFAULT_GOOGLE_AUTH_BRIDGE_URL = `https://${firebaseConfig.projectId}.web.app/google-auth-bridge.html`;
const AUTH_BRIDGE_STORAGE_KEY = 'dankiv_google_auth_bridge_url';

export function normalizeBridgeUrl(rawUrl: string | null | undefined): string | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const isLocalhost =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    if (parsed.protocol !== 'https:' && !isLocalhost) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getConfiguredAuthBridgeUrl(): string | null {
  const envUrl = normalizeBridgeUrl(
    import.meta.env.VITE_FIREBASE_AUTH_BRIDGE_URL as string | undefined
  );
  if (envUrl) return envUrl;
  if (typeof window === 'undefined') return null;
  try {
    return normalizeBridgeUrl(window.localStorage.getItem(AUTH_BRIDGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveCustomAuthBridgeUrl(rawUrl: string | null): string | null {
  if (typeof window === 'undefined') return null;
  const normalized = normalizeBridgeUrl(rawUrl);
  try {
    if (normalized) {
      window.localStorage.setItem(AUTH_BRIDGE_STORAGE_KEY, normalized);
    } else {
      window.localStorage.removeItem(AUTH_BRIDGE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
  return normalized;
}

let appPromise: Promise<FirebaseApp> | null = null;
let authPromise: Promise<Auth> | null = null;
let dbPromise: Promise<Firestore> | null = null;
let providerPromise: Promise<GoogleAuthProvider> | null = null;
let messagingPromise: Promise<Messaging | null> | null = null;
let cachedAuthInstance: Auth | null = null;

export function getFirebaseApp(): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = import('firebase/app')
      .then(({ getApps, initializeApp }) =>
        getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig)
      )
      .catch((err) => {
        appPromise = null;
        throw err;
      });
  }
  return appPromise;
}

export function getFirebaseAuth(): Promise<Auth> {
  if (!authPromise) {
    authPromise = Promise.all([getFirebaseApp(), import('firebase/auth')])
      .then(
        ([
          app,
          {
            browserLocalPersistence,
            browserPopupRedirectResolver,
            browserSessionPersistence,
            getAuth,
            indexedDBLocalPersistence,
            initializeAuth,
            inMemoryPersistence,
          },
        ]) => {
          let instance: Auth;
          try {
            instance = initializeAuth(app, {
              popupRedirectResolver: browserPopupRedirectResolver,
              persistence: [
                indexedDBLocalPersistence,
                browserLocalPersistence,
                browserSessionPersistence,
                inMemoryPersistence,
              ],
            });
          } catch {
            instance = getAuth(app);
          }
          cachedAuthInstance = instance;
          void instance.authStateReady().catch(() => {
            // Ignore transient IndexedDB AbortError during iframe reload or storage teardown
          });
          return instance;
        }
      )
      .catch((err) => {
        authPromise = null;
        throw err;
      });
  }
  return authPromise;
}

export function getCachedAuthUser(): User | null {
  return cachedAuthInstance?.currentUser ?? null;
}

export function getGoogleAuthProvider(): Promise<GoogleAuthProvider> {
  if (!providerPromise) {
    providerPromise = import('firebase/auth')
      .then(({ GoogleAuthProvider }) => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        return provider;
      })
      .catch((err) => {
        providerPromise = null;
        throw err;
      });
  }
  return providerPromise;
}

export interface GoogleAuthBundle {
  auth: Auth;
  googleProvider: GoogleAuthProvider;
  signInWithPopup: typeof import('firebase/auth').signInWithPopup;
  signInWithRedirect: typeof import('firebase/auth').signInWithRedirect;
  getRedirectResult: typeof import('firebase/auth').getRedirectResult;
  browserPopupRedirectResolver: typeof import('firebase/auth').browserPopupRedirectResolver;
}

export async function preloadGoogleAuthBundle(): Promise<GoogleAuthBundle> {
  const [auth, googleProvider, authModule] = await Promise.all([
    getFirebaseAuth(),
    getGoogleAuthProvider(),
    import('firebase/auth'),
  ]);
  return {
    auth,
    googleProvider,
    signInWithPopup: authModule.signInWithPopup,
    signInWithRedirect: authModule.signInWithRedirect,
    getRedirectResult: authModule.getRedirectResult,
    browserPopupRedirectResolver: authModule.browserPopupRedirectResolver,
  };
}

export async function signInWithGoogleTokens(
  googleIdToken: string | null,
  googleAccessToken?: string | null
): Promise<UserCredential> {
  if (!googleIdToken && !googleAccessToken) {
    throw new Error('Missing Google OAuth credentials');
  }
  const [auth, { GoogleAuthProvider, signInWithCredential }] = await Promise.all([
    getFirebaseAuth(),
    import('firebase/auth'),
  ]);
  const credential = GoogleAuthProvider.credential(
    googleIdToken || null,
    googleAccessToken || null
  );
  return signInWithCredential(auth, credential);
}

export function getFirebaseDb(): Promise<Firestore> {
  if (!dbPromise) {
    dbPromise = Promise.all([getFirebaseApp(), import('firebase/firestore')])
      .then(([app, { getFirestore }]) => getFirestore(app, firebaseConfig.firestoreDatabaseId))
      .catch((err) => {
        dbPromise = null;
        throw err;
      });
  }
  return dbPromise;
}

let connectionTested = false;

export async function testFirestoreConnection(): Promise<void> {
  if (connectionTested) return;
  connectionTested = true;
  try {
    const [db, { doc, getDocFromServer }] = await Promise.all([
      getFirebaseDb(),
      import('firebase/firestore'),
    ]);
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export function getMessagingInstance(): Promise<Messaging | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (!messagingPromise) {
    messagingPromise = Promise.all([getFirebaseApp(), import('firebase/messaging')])
      .then(async ([app, { getMessaging, isSupported }]) => {
        const supported = await isSupported();
        return supported ? getMessaging(app) : null;
      })
      .catch(() => null);
  }
  return messagingPromise;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  currentUser: User | null = cachedAuthInstance?.currentUser ?? null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
