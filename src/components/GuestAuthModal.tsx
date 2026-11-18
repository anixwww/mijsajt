import { signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Eye, EyeOff, KeyRound, LogIn, Smartphone, Trash2, UserCheck, UserPlus, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase.ts';
import type { GuestUser } from '../types.ts';
import {
  clearStoredDeviceIdentity,
  ensureDeviceKeypair,
  getDeviceDisplayLabel,
  getStoredDeviceIdentity,
  signDeviceChallenge,
  type StoredDeviceIdentity,
} from '../utils/deviceAccess.ts';
import {
  clearActiveUserFromDevice,
  getRememberedProfile,
  type RememberedUserProfile,
} from '../utils/userMemory.ts';

interface GuestAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (user: GuestUser, rememberOnDevice?: boolean) => void;
}

interface AuthorAccessStatus {
  adminEmail: string;
  domain: string;
  domainAllowed: boolean;
  hasAccessKeyConfigured: boolean;
  deviceBound: boolean;
  trustedDevicesCount: number;
}

const ADMIN_EMAIL = 'andrijdankiv5@gmail.com';

function getGoogleAuthErrorMessage(code?: string, hostname?: string): string {
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Вікно входу Google було закрито до завершення.';
    case 'auth/popup-blocked':
      return 'Браузер заблокував спливаюче вікно Google. Дозвольте спливаючі вікна або увійдіть поштою нижче.';
    case 'auth/cancelled-popup-request':
      return 'Запит входу скасовано. Спробуйте ще раз.';
    case 'auth/unauthorized-domain':
      return hostname
        ? `Домен «${hostname}» ще не додано в Authorized domains у Firebase Auth. Скористайтеся входом поштою або прив’язкою пристрою нижче.`
        : 'Поточний домен ще не додано в налаштуваннях Firebase Auth. Скористайтеся входом поштою нижче.';
    case 'auth/operation-not-allowed':
      return 'Вхід через Google не активовано в налаштуваннях проєкту. Скористайтеся входом поштою нижче.';
    case 'auth/network-request-failed':
      return 'Помилка мережі під час з’єднання з Google. Перевірте інтернет або увійдіть поштою.';
    default:
      return 'Не вдалося увійти через Google. Спробуйте увійти поштою нижче.';
  }
}

export function GuestAuthModal({ isOpen, onClose, onAuthenticated }: GuestAuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberOnDevice, setRememberOnDevice] = useState(true);
  const [bindThisDevice, setBindThisDevice] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authorStatus, setAuthorStatus] = useState<AuthorAccessStatus | null>(null);
  const [localDeviceIdentity, setLocalDeviceIdentity] = useState<StoredDeviceIdentity | null>(null);
  const [rememberedProfile, setRememberedProfile] = useState<RememberedUserProfile | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const currentHost = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';

    (async () => {
      const [identity, savedProfile] = await Promise.all([
        currentHost ? getStoredDeviceIdentity(currentHost) : Promise.resolve(null),
        getRememberedProfile(),
      ]);
      if (!active) return;
      setLocalDeviceIdentity(identity);
      setRememberedProfile(savedProfile);
      if (savedProfile?.email) {
        setEmail((prev) => (prev ? prev : savedProfile.email));
      }

      try {
        const qs = identity?.deviceId ? `?deviceId=${encodeURIComponent(identity.deviceId)}` : '';
        const res = await fetch(`/api/author/access-status${qs}`);
        if (!active || !res.ok) return;
        const data = (await res.json()) as AuthorAccessStatus;
        setAuthorStatus(data);
      } catch {
        // Ignore transient status fetch error
      }
    })();

    return () => {
      active = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isAuthorEmail = email.trim().toLowerCase() === ADMIN_EMAIL;
  const currentHost = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';

  const syncUserProfileToFirestore = async (uid: string, name: string, userEmail: string) => {
    const safeEmail = userEmail.trim().slice(0, 254);
    if (safeEmail.length < 3) return;
    const safeName = (name.trim() || 'Гість').slice(0, 80);
    const userPath = `users/${uid}`;
    const userRef = doc(db, 'users', uid);

    let existingSnap;
    try {
      existingSnap = await getDoc(userRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, userPath);
    }

    if (!existingSnap.exists()) {
      try {
        await setDoc(userRef, {
          uid,
          email: safeEmail,
          displayName: safeName,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, userPath);
      }
      return;
    }

    const existingData = existingSnap.data();
    if (existingData?.displayName !== safeName || existingData?.email !== safeEmail) {
      try {
        await updateDoc(userRef, {
          displayName: safeName,
          email: safeEmail,
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, userPath);
      }
    }
  };

  const handleQuickRememberedLogin = async () => {
    if (!rememberedProfile) return;
    if (rememberedProfile.provider === 'google' && !rememberedProfile.sessionToken) {
      await handleGoogleLogin();
      return;
    }
    if (!rememberedProfile.sessionToken) {
      setEmail(rememberedProfile.email);
      setMode('login');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/guest/session', {
        headers: { Authorization: `Bearer ${rememberedProfile.sessionToken}` },
      });
      const data = (await res.json()) as { valid?: boolean; user?: GuestUser };
      if (!res.ok || !data.valid || !data.user) {
        setEmail(rememberedProfile.email);
        setErrorMsg('Збережена сесія завершилась — введіть пароль для повторного входу.');
        return;
      }
      onAuthenticated(data.user, true);
      onClose();
    } catch {
      setErrorMsg('Не вдалося перевірити збережену сесію. Перевірте інтернет або введіть пароль.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgetRememberedProfile = async () => {
    clearActiveUserFromDevice(true);
    if (currentHost) {
      await clearStoredDeviceIdentity(currentHost);
    }
    setRememberedProfile(null);
    setEmail('');
    setPassword('');
    setErrorMsg(null);
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const fbUser = result.user;
      const name = fbUser.displayName || fbUser.email?.split('@')[0] || 'Гість';
      const userEmail = fbUser.email || '';

      if (fbUser.emailVerified) {
        try {
          await syncUserProfileToFirestore(fbUser.uid, name, userEmail);
        } catch {
          // Non-blocking profile sync
        }
      }

      if (userEmail.toLowerCase() === ADMIN_EMAIL && fbUser.emailVerified && currentHost) {
        try {
          const token = await fbUser.getIdToken();
          const deviceIdentity = await ensureDeviceKeypair(currentHost, ADMIN_EMAIL);
          await fetch('/api/author/devices/bind', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              deviceId: deviceIdentity.deviceId,
              publicKeySpki: deviceIdentity.publicKeySpki,
              label: getDeviceDisplayLabel(),
            }),
          });
        } catch {
          // Non-blocking device pairing
        }
      }

      onAuthenticated(
        {
          uid: fbUser.uid,
          displayName: name,
          email: userEmail,
          photoUrl: fbUser.photoURL || undefined,
          provider: 'google',
        },
        rememberOnDevice
      );
      onClose();
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      setErrorMsg(getGoogleAuthErrorMessage(code, currentHost));
    } finally {
      setLoading(false);
    }
  };

  const handleDeviceLogin = async () => {
    if (!localDeviceIdentity) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const challengeRes = await fetch('/api/author/device-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: localDeviceIdentity.deviceId }),
      });
      const challengeData = (await challengeRes.json()) as { nonce?: string; error?: string };
      if (!challengeRes.ok || !challengeData.nonce) {
        setErrorMsg(challengeData.error || 'Не вдалося підтвердити прив’язку цього пристрою.');
        return;
      }

      const signature = await signDeviceChallenge(localDeviceIdentity, challengeData.nonce);
      const loginRes = await fetch('/api/author/device-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: localDeviceIdentity.deviceId,
          nonce: challengeData.nonce,
          signature,
        }),
      });
      const loginData = (await loginRes.json()) as { user?: GuestUser; error?: string };
      if (!loginRes.ok || !loginData.user) {
        setErrorMsg(loginData.error || 'Не вдалося увійти з цього пристрою.');
        return;
      }

      onAuthenticated(loginData.user, true);
      onClose();
    } catch {
      setErrorMsg('Помилка перевірки ключа пристрою. Увійдіть за допомогою ключа доступу нижче.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedName = displayName.trim();

    if (mode === 'register' && trimmedName.length < 2) {
      setErrorMsg('Вкажіть ім’я або псевдонім (мін. 2 символи).');
      return;
    }
    if (!trimmedEmail.includes('@')) {
      setErrorMsg('Вкажіть коректну електронну пошту.');
      return;
    }
    if (trimmedEmail.toLowerCase() !== ADMIN_EMAIL && password.length < 6) {
      setErrorMsg('Пароль має містити щонайменше 6 символів.');
      return;
    }
    if (trimmedEmail.toLowerCase() === ADMIN_EMAIL && password.trim().length < 1) {
      setErrorMsg('Введіть ключ доступу автора.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      if (mode === 'login' && trimmedEmail.toLowerCase() === ADMIN_EMAIL) {
        let devicePayload:
          | { bindDevice: true; deviceId: string; publicKeySpki: string; label: string }
          | { bindDevice: false } = { bindDevice: false };

        if (bindThisDevice && currentHost) {
          try {
            const identity = await ensureDeviceKeypair(currentHost, ADMIN_EMAIL);
            devicePayload = {
              bindDevice: true,
              deviceId: identity.deviceId,
              publicKeySpki: identity.publicKeySpki,
              label: getDeviceDisplayLabel(),
            };
          } catch {
            devicePayload = { bindDevice: false };
          }
        }

        const res = await fetch('/api/author/key-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: trimmedEmail,
            accessKey: password,
            ...devicePayload,
          }),
        });
        const data = (await res.json()) as { user?: GuestUser; error?: string };
        if (!res.ok || !data.user) {
          setErrorMsg(data.error || 'Не вдалося виконати вхід автора.');
          return;
        }

        onAuthenticated(data.user, true);
        onClose();
        return;
      }

      if (mode === 'register') {
        const res = await fetch('/api/guest/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: trimmedName,
            email: trimmedEmail,
            password,
            rememberDevice: rememberOnDevice,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErrorMsg(data.error || 'Не вдалося створити акаунт.');
          return;
        }
        onAuthenticated(data.user, rememberOnDevice);
        onClose();
        return;
      }

      const res = await fetch('/api/guest/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          rememberDevice: rememberOnDevice,
        }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        onAuthenticated(data.user, rememberOnDevice);
        onClose();
        return;
      }

      if (res.status === 404) {
        try {
          const cred = await signInWithEmailAndPassword(auth, trimmedEmail, password);
          onAuthenticated(
            {
              uid: cred.user.uid,
              displayName: cred.user.displayName || trimmedEmail.split('@')[0],
              email: cred.user.email || trimmedEmail,
              provider: 'email',
            },
            rememberOnDevice
          );
          onClose();
          return;
        } catch {
          // Fall through to backend message
        }
      }

      setErrorMsg(data.error || 'Невірний email або пароль.');
    } catch {
      setErrorMsg('Помилка з’єднання із сервером. Спробуйте ще раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0D0D0C]/80 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-auth-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="bg-[#F5F4EF] dark:bg-[#141412] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] text-[#0D0D0C] dark:text-[#F2F1EC] max-w-[430px] w-full p-6 sm:p-8 shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Minimal Editorial Header */}
        <div className="flex items-start justify-between gap-4 pb-5 border-b border-[#0D0D0C]/14 dark:border-[#252522]">
          <div>
            <h3 id="guest-auth-title" className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight leading-none">
              {mode === 'login' ? 'Вхід' : 'Реєстрація'}
            </h3>
            <p className="mt-2 text-xs text-[#6B6B65] dark:text-[#94948C]">
              Щоб коментувати від свого імені та зберігати придбання.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC] border border-transparent hover:border-[#0D0D0C]/20 dark:hover:border-[#2E2E2A] transition-colors cursor-pointer shrink-0"
            aria-label="Закрити вікно входу"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="pt-6 space-y-5">
          {/* 1-Click Bound Author Device Login */}
          {authorStatus?.deviceBound && localDeviceIdentity && (
            <button
              type="button"
              disabled={loading}
              onClick={handleDeviceLogin}
              className="w-full py-2.5 px-4 flex items-center justify-center gap-2.5 text-xs font-semibold tracking-wide text-white bg-[#1E4631] hover:bg-[#153524] dark:bg-[#2D6A4F] dark:hover:bg-[#3A8261] transition-colors cursor-pointer disabled:opacity-60"
            >
              <Smartphone className="w-4 h-4 shrink-0" strokeWidth={1.75} />
              <span>Увійти з цього пристрою · {ADMIN_EMAIL}</span>
            </button>
          )}

          {/* Remembered User Quick Return Card (any guest or user saved on this device) */}
          {rememberedProfile &&
            !(authorStatus?.deviceBound && rememberedProfile.email.toLowerCase() === ADMIN_EMAIL) && (
              <div className="border border-[#0D0D0C]/18 dark:border-[#2E2E2A] bg-white/75 dark:bg-[#1A1A17] p-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleQuickRememberedLogin}
                  className="flex items-center gap-2.5 text-left min-w-0 flex-1 cursor-pointer group"
                >
                  <UserCheck className="w-4 h-4 text-[#1E4631] dark:text-[#4E946C] shrink-0" strokeWidth={1.75} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate group-hover:text-[#1E4631] dark:group-hover:text-[#4E946C] transition-colors">
                      Продовжити як {rememberedProfile.displayName}
                    </p>
                    <p className="text-[11px] font-mono text-[#6B6B65] dark:text-[#94948C] truncate">
                      {rememberedProfile.email}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={handleForgetRememberedProfile}
                  title="Забути профіль на цьому пристрої"
                  aria-label="Забути профіль на цьому пристрої"
                  className="p-1.5 text-[#6B6B65] dark:text-[#94948C] hover:text-rose-600 transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.6} />
                </button>
              </div>
            )}

          {/* Google Primary Sign-In */}
          <button
            type="button"
            disabled={loading}
            onClick={handleGoogleLogin}
            className="w-full py-2.5 px-4 flex items-center justify-center gap-2.5 text-sm font-medium bg-white dark:bg-[#1A1A17] text-[#0D0D0C] dark:text-[#F2F1EC] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] hover:border-[#1E4631] dark:hover:border-[#4E946C] transition-colors cursor-pointer disabled:opacity-60"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            <span>Продовжити з Google</span>
          </button>

          {/* Quiet Divider */}
          <div className="relative flex items-center">
            <div className="flex-grow border-t border-[#0D0D0C]/12 dark:border-[#252522]" />
            <span className="shrink mx-3 text-[10px] font-mono uppercase tracking-widest text-[#6B6B65] dark:text-[#94948C]">
              або поштою
            </span>
            <div className="flex-grow border-t border-[#0D0D0C]/12 dark:border-[#252522]" />
          </div>

          {/* Editorial Underline Mode Tabs */}
          <div className="flex border-b border-[#0D0D0C]/14 dark:border-[#252522]" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => {
                setMode('login');
                setErrorMsg(null);
              }}
              className={`flex-1 pb-2.5 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'border-[#1E4631] dark:border-[#4E946C] text-[#0D0D0C] dark:text-[#F2F1EC] font-semibold'
                  : 'border-transparent text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC]'
              }`}
            >
              Увійти
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => {
                setMode('register');
                setErrorMsg(null);
              }}
              className={`flex-1 pb-2.5 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
                mode === 'register'
                  ? 'border-[#1E4631] dark:border-[#4E946C] text-[#0D0D0C] dark:text-[#F2F1EC] font-semibold'
                  : 'border-transparent text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC]'
              }`}
            >
              Реєстрація
            </button>
          </div>

          {/* Email Form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-[#6B6B65] dark:text-[#94948C] mb-1.5">
                  Ім’я
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Як до вас звертатися"
                  className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-[#0B0B0A] border border-[#0D0D0C]/18 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                />
              </div>
            )}

            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-[#6B6B65] dark:text-[#94948C] mb-1.5">
                Електронна пошта
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-[#0B0B0A] border border-[#0D0D0C]/18 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
              />
            </div>

            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-[#6B6B65] dark:text-[#94948C] mb-1.5">
                {mode === 'login' && isAuthorEmail ? 'Ключ доступу автора' : 'Пароль'}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={mode === 'login' && isAuthorEmail ? 1 : 6}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === 'login' && isAuthorEmail
                      ? 'Введіть ADMIN_ACCESS_KEY із Secrets'
                      : 'Щонайменше 6 символів'
                  }
                  className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-white dark:bg-[#0B0B0A] border border-[#0D0D0C]/18 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Сховати пароль' : 'Показати пароль'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC] cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" strokeWidth={1.6} /> : <Eye className="w-4 h-4" strokeWidth={1.6} />}
                </button>
              </div>
            </div>

            {mode === 'login' && isAuthorEmail ? (
              <div className="border border-[#0D0D0C]/14 dark:border-[#252522] bg-white/60 dark:bg-[#0B0B0A]/60 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-[#6B6B65] dark:text-[#94948C]">
                  <span className="truncate">Домен: {authorStatus?.domain || currentHost}</span>
                  <span className={authorStatus?.domainAllowed ? 'text-[#1E4631] dark:text-[#4E946C]' : 'text-rose-600'}>
                    {authorStatus?.domainAllowed ? 'Дозволено' : 'Обмежено'}
                  </span>
                </div>

                {authorStatus && !authorStatus.hasAccessKeyConfigured ? (
                  <p className="text-[11px] leading-relaxed text-[#6B6B65] dark:text-[#94948C]">
                    Щоб активувати вхід поштою для <span className="font-medium text-[#0D0D0C] dark:text-[#F2F1EC]">{ADMIN_EMAIL}</span> на цьому домені, додайте змінну <span className="font-mono">ADMIN_ACCESS_KEY</span> у налаштуваннях Secrets.
                  </p>
                ) : (
                  <label className="flex items-center gap-2 text-[11px] text-[#0D0D0C] dark:text-[#F2F1EC] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={bindThisDevice}
                      onChange={(e) => setBindThisDevice(e.target.checked)}
                      className="accent-[#1E4631]"
                    />
                    <span>Прив’язати цей пристрій ({getDeviceDisplayLabel()})</span>
                  </label>
                )}
              </div>
            ) : (
              <label className="flex items-center gap-2 text-xs text-[#6B6B65] dark:text-[#94948C] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberOnDevice}
                  onChange={(e) => setRememberOnDevice(e.target.checked)}
                  className="accent-[#1E4631]"
                />
                <span>Запам’ятати мене на цьому пристрої</span>
              </label>
            )}

            {errorMsg && (
              <p
                className="text-xs leading-relaxed text-rose-700 dark:text-rose-400 border-l-2 border-rose-500 pl-3 py-0.5"
                role="alert"
              >
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 inline-flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider text-white bg-[#1E4631] hover:bg-[#153524] dark:bg-[#2D6A4F] dark:hover:bg-[#3A8261] transition-colors cursor-pointer disabled:opacity-60"
            >
              {mode === 'login' ? (
                <>
                  {isAuthorEmail ? (
                    <KeyRound className="w-3.5 h-3.5" strokeWidth={1.75} />
                  ) : (
                    <LogIn className="w-3.5 h-3.5" strokeWidth={1.75} />
                  )}
                  <span>{loading ? 'Вхід...' : isAuthorEmail ? 'Увійти як автор' : 'Увійти'}</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-3.5 h-3.5" strokeWidth={1.75} />
                  <span>{loading ? 'Створення...' : 'Створити акаунт'}</span>
                </>
              )}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
