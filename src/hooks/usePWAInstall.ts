import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __dankivDeferredInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    typeof window !== 'undefined' ? window.__dankivDeferredInstallPrompt ?? null : null
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isMacSafari, setIsMacSafari] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);

  useEffect(() => {
    const checkStandalone = () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    setIsInstalled(checkStandalone());
    setIsInIframe(window.self !== window.top);

    const ua = window.navigator.userAgent.toLowerCase();
    const touchMac =
      window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
    const iosDevice = /iphone|ipad|ipod/.test(ua) || touchMac;
    const androidDevice = /android/.test(ua);
    const macSafari =
      !iosDevice &&
      /macintosh|mac os x/.test(ua) &&
      /safari/.test(ua) &&
      !/chrome|crios|crmo|edg|opr|firefox|fxios/.test(ua);

    setIsIOS(iosDevice);
    setIsAndroid(androidDevice);
    setIsMacSafari(macSafari);

    if (window.__dankivDeferredInstallPrompt) {
      setDeferredPrompt(window.__dankivDeferredInstallPrompt);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.__dankivDeferredInstallPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    const handleAppInstalled = () => {
      window.__dankivDeferredInstallPrompt = null;
      setIsInstalled(true);
      setDeferredPrompt(null);
      fetch('/api/analytics/pwa-install', { method: 'POST' }).catch(() => {});
    };

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = () => {
      setIsInstalled(checkStandalone());
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    mediaQuery.addEventListener?.('change', handleDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery.removeEventListener?.('change', handleDisplayChange);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    const promptObj = deferredPrompt ?? window.__dankivDeferredInstallPrompt;
    if (!promptObj) return false;
    try {
      await promptObj.prompt();
      const { outcome } = await promptObj.userChoice;
      if (outcome === 'accepted') {
        window.__dankivDeferredInstallPrompt = null;
        setIsInstalled(true);
        setDeferredPrompt(null);
        fetch('/api/analytics/pwa-install', { method: 'POST' }).catch(() => {});
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [deferredPrompt]);

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isAndroid,
    isMacSafari,
    isInIframe,
    install,
  };
}
