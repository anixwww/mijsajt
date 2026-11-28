import { GoogleAuthProvider } from 'firebase/auth';
import { FIREBASE_PROJECT_ID, preloadGoogleAuthBundle } from './firebase.ts';

const BRIDGE_SUCCESS_TYPE = 'dankiv-google-auth-bridge-success';
const BRIDGE_ERROR_TYPE = 'dankiv-google-auth-bridge-error';

function isAllowedTargetOrigin(rawOrigin: string): string | null {
  if (!rawOrigin) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    return null;
  }

  if (parsed.origin !== rawOrigin) return null;

  if (parsed.origin === window.location.origin) return parsed.origin;
  if (
    parsed.origin === `https://${FIREBASE_PROJECT_ID}.web.app` ||
    parsed.origin === `https://${FIREBASE_PROJECT_ID}.firebaseapp.com`
  ) {
    return parsed.origin;
  }

  if (
    parsed.protocol === 'https:' &&
    /^ais-(dev|pre)-[a-z0-9-]+-\d+\.[a-z0-9-]+\.run\.app$/i.test(parsed.hostname)
  ) {
    return parsed.origin;
  }

  if (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  ) {
    return parsed.origin;
  }

  const extraOrigins = String(import.meta.env.VITE_AUTH_BRIDGE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (extraOrigins.includes(parsed.origin)) {
    return parsed.origin;
  }

  return null;
}

function initAuthBridge() {
  const statusEl = document.getElementById('bridge-status');
  const subtitleEl = document.getElementById('bridge-subtitle');
  const btn = document.getElementById('bridge-signin-btn') as HTMLButtonElement | null;

  const params = new URLSearchParams(window.location.search);
  const targetOrigin = isAllowedTargetOrigin(params.get('origin') || '');

  if (!targetOrigin || !window.opener || window.opener.closed) {
    if (btn) btn.disabled = true;
    if (subtitleEl) {
      subtitleEl.textContent =
        'Цю сторінку потрібно відкривати кнопкою «Увійти через Google» із сайту.';
    }
    if (statusEl) {
      statusEl.textContent = !targetOrigin
        ? 'Недозволений домен джерела запиту.'
        : 'Батьківське вікно недоступне.';
    }
    return;
  }

  const postToOpener = (payload: Record<string, unknown>) => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, targetOrigin);
      }
    } catch {
      // Ignore postMessage delivery failures if opener closed
    }
  };

  let inFlight = false;

  const runSignIn = async () => {
    if (inFlight) return;
    inFlight = true;
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = 'Відкривається вікно вибору акаунта Google...';

    try {
      const bundle = await preloadGoogleAuthBundle();
      const result = await bundle.signInWithPopup(
        bundle.auth,
        bundle.googleProvider,
        bundle.browserPopupRedirectResolver
      );
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleIdToken = credential?.idToken || null;
      const googleAccessToken = credential?.accessToken || null;

      if (!googleIdToken && !googleAccessToken) {
        throw new Error('Google не повернув OAuth-токен.');
      }

      if (statusEl) statusEl.textContent = 'Авторизація успішна. Повертаємо на сайт...';
      postToOpener({
        type: BRIDGE_SUCCESS_TYPE,
        googleIdToken,
        googleAccessToken,
      });
      window.setTimeout(() => {
        window.close();
      }, 120);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code || '';
      const message =
        error instanceof Error ? error.message : 'Не вдалося виконати вхід через Google.';
      if (statusEl) {
        statusEl.textContent =
          code === 'auth/popup-blocked'
            ? 'Браузер заблокував вікно Google. Натисніть кнопку вище ще раз.'
            : code === 'auth/popup-closed-by-user'
              ? 'Вікно входу було закрито. Натисніть кнопку вище, щоб повторити.'
              : message;
      }
      postToOpener({
        type: BRIDGE_ERROR_TYPE,
        code,
        message,
      });
      if (btn) btn.disabled = false;
    } finally {
      inFlight = false;
    }
  };

  btn?.addEventListener('click', () => {
    void runSignIn();
  });

  // Trigger immediately if opened directly from user click on main window
  void runSignIn();
}

initAuthBridge();
