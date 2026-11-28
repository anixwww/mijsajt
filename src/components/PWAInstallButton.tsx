import { Download, ExternalLink, Laptop, Share, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

interface PWAInstallGuideModalProps {
  open: boolean;
  onClose: () => void;
  isIOS: boolean;
  isAndroid: boolean;
  isMacSafari: boolean;
  isInIframe: boolean;
}

function getExternalBrowserTarget(
  rawUrl: string,
  { isAndroid, isIOS, isInIframe }: { isAndroid: boolean; isIOS: boolean; isInIframe: boolean }
): { href: string; openInNewTab: boolean } {
  if (typeof window === 'undefined' || !rawUrl) {
    return { href: rawUrl || '/', openInNewTab: true };
  }

  try {
    const parsed = new URL(rawUrl, window.location.origin);
    const scheme = parsed.protocol.replace(':', '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return { href: parsed.toString(), openInNewTab: true };
    }

    const fullUrl = parsed.toString();
    const ua = (window.navigator?.userAgent || '').toLowerCase();
    const isInAppWebView =
      /wv\b|webview|telegram|tgweb|instagram|fbav|fban|fb_iab|tiktok|bytedance|musical_ly|viber|line\/|micromessenger|snapchat|linkedinapp/i.test(
        ua
      );

    if (isAndroid) {
      const urlWithoutScheme = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
      const intentUrl = `intent://${urlWithoutScheme}#Intent;scheme=${scheme};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${encodeURIComponent(fullUrl)};end`;
      return { href: intentUrl, openInNewTab: false };
    }

    if (isIOS && (isInAppWebView || isInIframe)) {
      return { href: `x-safari-${fullUrl}`, openInNewTab: false };
    }

    return { href: fullUrl, openInNewTab: true };
  } catch {
    return { href: rawUrl, openInNewTab: true };
  }
}

export function PWAInstallGuideModal({
  open,
  onClose,
  isIOS,
  isAndroid,
  isMacSafari,
  isInIframe,
}: PWAInstallGuideModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const standaloneUrl = typeof window !== 'undefined' ? window.location.href : '/';
  const browserTarget = getExternalBrowserTarget(standaloneUrl, {
    isAndroid,
    isIOS,
    isInIframe,
  });

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-install-guide-title"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-paper dark:bg-night-panel p-5 sm:p-6 shadow-2xl space-y-4 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3
              id="pwa-install-guide-title"
              className="text-base sm:text-lg font-semibold text-ink dark:text-cream"
            >
              Встановити як додаток
            </h3>
            <p className="text-xs text-ink-muted dark:text-sandstone mt-0.5">
              Швидкий запуск із робочого столу та читання без інтернету.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-ink-muted dark:text-sandstone hover:bg-paper-sand dark:hover:bg-night-elevated cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isInIframe && (
          <div className="rounded-xl bg-paper-sand/80 dark:bg-night-card p-3.5">
            <p className="text-xs text-ink dark:text-cream leading-relaxed">
              Браузер обмежує встановлення всередині вікна перегляду. Натисніть «Відкрити у браузері» нижче, щоб відкрити сайт без обмежень.
            </p>
          </div>
        )}

        {isIOS ? (
          <div className="rounded-xl bg-white dark:bg-night-card p-4 space-y-2.5 text-xs sm:text-sm text-ink dark:text-cream">
            <div className="flex items-center gap-2 font-semibold text-pine dark:text-silver">
              <Smartphone className="w-4 h-4 shrink-0" />
              <span>iPhone та iPad (Safari)</span>
            </div>
            <ol className="space-y-1.5 text-xs text-[#454541] dark:text-parchment list-decimal list-inside leading-relaxed">
              <li>
                Натисніть кнопку{' '}
                <span className="inline-flex items-center gap-1 font-semibold text-ink dark:text-white">
                  Поділитися <Share className="w-3.5 h-3.5 inline" />
                </span>{' '}
                на панелі Safari.
              </li>
              <li>Прогорніть список униз і оберіть «На екран «Додому»» (Add to Home Screen).</li>
              <li>Натисніть «Додати» у верхньому правому куті.</li>
            </ol>
          </div>
        ) : isMacSafari ? (
          <div className="rounded-xl bg-white dark:bg-night-card p-4 space-y-2.5 text-xs sm:text-sm text-ink dark:text-cream">
            <div className="flex items-center gap-2 font-semibold text-pine dark:text-silver">
              <Laptop className="w-4 h-4 shrink-0" />
              <span>Mac (Safari)</span>
            </div>
            <ol className="space-y-1.5 text-xs text-[#454541] dark:text-parchment list-decimal list-inside leading-relaxed">
              <li>У верхньому меню Safari натисніть «Файл» → «Додати до Dock» (або іконку «Поділитися»).</li>
              <li>Підтвердьте назву «Андрій Даньків» і натисніть «Додати».</li>
            </ol>
          </div>
        ) : isAndroid ? (
          <div className="rounded-xl bg-white dark:bg-night-card p-4 space-y-2.5 text-xs sm:text-sm text-ink dark:text-cream">
            <div className="flex items-center gap-2 font-semibold text-pine dark:text-silver">
              <Smartphone className="w-4 h-4 shrink-0" />
              <span>Android (Chrome / Edge / Samsung)</span>
            </div>
            <ol className="space-y-1.5 text-xs text-[#454541] dark:text-parchment list-decimal list-inside leading-relaxed">
              <li>Натисніть меню браузера (три крапки у верхньому куті).</li>
              <li>Оберіть «Додати на головний екран» або «Встановити додаток».</li>
            </ol>
          </div>
        ) : (
          <div className="rounded-xl bg-white dark:bg-night-card p-4 space-y-2.5 text-xs sm:text-sm text-ink dark:text-cream">
            <div className="flex items-center gap-2 font-semibold text-pine dark:text-silver">
              <Laptop className="w-4 h-4 shrink-0" />
              <span>Комп’ютер (Chrome / Edge / Safari)</span>
            </div>
            <ol className="space-y-1.5 text-xs text-[#454541] dark:text-parchment list-decimal list-inside leading-relaxed">
              <li>Натисніть іконку встановлення справа в адресному рядку браузера або відкрийте меню «⋮».</li>
              <li>Оберіть «Встановити Андрій Даньків» — ярлик з’явиться на робочому столі.</li>
            </ol>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <a
            href={browserTarget.href}
            {...(browserTarget.openInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : { rel: 'noopener noreferrer' })}
            className="btn-editorial-primary w-full justify-center py-2.5 text-xs"
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            <span>Відкрити у браузері</span>
          </a>

          <button
            type="button"
            onClick={onClose}
            className="btn-editorial-secondary w-full justify-center py-2.5 text-xs"
          >
            Зрозуміло
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { isInstallable, isInstalled, isIOS, isAndroid, isMacSafari, isInIframe, install } =
    usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (!isInstallable && !isIOS && !isMacSafari) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (!ok && isInIframe) {
        setShowGuide(true);
      }
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        aria-label="Встановити додаток на пристрій"
        title="Встановити сайт на робочий стіл або головний екран"
        className={`touch-surface inline-flex items-center justify-center gap-1.5 rounded-xl bg-paper-sand dark:bg-night-card px-3 py-2 text-[11px] sm:text-xs font-medium text-ink dark:text-cream hover:text-pine dark:hover:text-[#F5F5F5] transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
          compact ? 'min-h-[38px] sm:min-h-[40px]' : 'min-h-[40px]'
        }`}
      >
        <Download className="w-3.5 h-3.5 text-pine dark:text-silver shrink-0" strokeWidth={1.9} />
        <span>Встановити</span>
      </button>

      <PWAInstallGuideModal
        open={showGuide}
        onClose={() => setShowGuide(false)}
        isIOS={isIOS}
        isAndroid={isAndroid}
        isMacSafari={isMacSafari}
        isInIframe={isInIframe}
      />
    </>
  );
}
