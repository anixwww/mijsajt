import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    (
      window as unknown as { __dankivDeferredInstallPrompt?: Event | null }
    ).__dankivDeferredInstallPrompt = event;
  });

  registerSW({
    immediate: true,
    onRegisteredSW() {
      // Service worker active for offline caching and installability
    },
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { name?: string } | null | undefined;
    if (reason && reason.name === 'AbortError') {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
