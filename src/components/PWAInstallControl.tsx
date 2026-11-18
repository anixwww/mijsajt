import { Download, MoreVertical, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

interface PWAInstallControlProps {
  variant?: 'icon' | 'menu';
  isDark?: boolean;
  onAction?: () => void;
}

export function PWAInstallControl({ variant = 'icon', isDark = false, onAction }: PWAInstallControlProps) {
  const { isInstallable, isInstalled, isIOS, isAndroid, isInIframe, install } = usePWAInstall();
  const [guideOpen, setGuideOpen] = useState(false);
  const [platformTab, setPlatformTab] = useState<'apple' | 'android'>(() =>
    isIOS ? 'apple' : isAndroid ? 'android' : 'apple'
  );

  if (isInstalled) return null;

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      onAction?.();
      if (accepted) return;
    }
    setPlatformTab(isIOS ? 'apple' : 'android');
    setGuideOpen(true);
  };

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={handleClick}
          title="Встановити на робочий стіл (Android / Apple)"
          aria-label="Встановити додаток на робочий стіл"
          className={`w-9 h-9 flex items-center justify-center border transition-colors cursor-pointer ${
            isDark
              ? 'border-[#2E2E2A] text-[#F2F1EC] hover:border-[#4E946C] hover:text-[#4E946C]'
              : 'border-[#0D0D0C]/20 text-[#0D0D0C] hover:border-[#1E4631] hover:text-[#1E4631]'
          }`}
        >
          <Download className="w-4 h-4" strokeWidth={1.6} />
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className="w-full py-2 px-3 flex items-center justify-center gap-2 text-xs font-medium border border-[#0D0D0C]/20 dark:border-[#2E2E2A] text-[#0D0D0C] dark:text-[#F2F1EC] hover:border-[#1E4631] dark:hover:border-[#4E946C] hover:text-[#1E4631] dark:hover:text-[#4E946C] transition-colors cursor-pointer"
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0" strokeWidth={1.7} />
          <span>На робочий стіл (iOS / Android)</span>
        </button>
      )}

      {guideOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0D0D0C]/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setGuideOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div
            className="bg-[#F5F4EF] dark:bg-[#141412] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] text-[#0D0D0C] dark:text-[#F2F1EC] max-w-[420px] w-full p-6 sm:p-7 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#0D0D0C]/14 dark:border-[#252522]">
              <div>
                <h3 id="pwa-install-guide-title" className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight leading-none">
                  Встановлення додатку
                </h3>
                <p className="mt-2 text-xs text-[#6B6B65] dark:text-[#94948C]">
                  Додайте сайт на головний екран телефону або планшета для швидкого доступу.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC] cursor-pointer shrink-0"
                aria-label="Закрити інструкцію"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex border-b border-[#0D0D0C]/14 dark:border-[#252522] mt-4">
              <button
                type="button"
                onClick={() => setPlatformTab('apple')}
                className={`flex-1 pb-2.5 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
                  platformTab === 'apple'
                    ? 'border-[#1E4631] dark:border-[#4E946C] text-[#0D0D0C] dark:text-[#F2F1EC] font-semibold'
                    : 'border-transparent text-[#6B6B65] dark:text-[#94948C]'
                }`}
              >
                Apple (iPhone / iPad)
              </button>
              <button
                type="button"
                onClick={() => setPlatformTab('android')}
                className={`flex-1 pb-2.5 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
                  platformTab === 'android'
                    ? 'border-[#1E4631] dark:border-[#4E946C] text-[#0D0D0C] dark:text-[#F2F1EC] font-semibold'
                    : 'border-transparent text-[#6B6B65] dark:text-[#94948C]'
                }`}
              >
                Android
              </button>
            </div>

            {platformTab === 'apple' ? (
              <ol className="mt-5 space-y-3.5 text-xs leading-relaxed text-[#0D0D0C] dark:text-[#F2F1EC]">
                <li className="flex items-start gap-3">
                  <span className="font-mono text-[11px] text-[#1E4631] dark:text-[#4E946C] font-semibold pt-0.5">01</span>
                  <span>
                    Відкрийте сайт у браузері <strong>Safari</strong> (або <strong>Chrome</strong> на iOS) напряму за посиланням.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="font-mono text-[11px] text-[#1E4631] dark:text-[#4E946C] font-semibold pt-0.5">02</span>
                  <span className="inline-flex flex-wrap items-center gap-1">
                    Натисніть кнопку <strong>Поділитися</strong>
                    <Share className="w-3.5 h-3.5 inline text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.75} />
                    на панелі браузера.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="font-mono text-[11px] text-[#1E4631] dark:text-[#4E946C] font-semibold pt-0.5">03</span>
                  <span className="inline-flex flex-wrap items-center gap-1">
                    Прокрутіть униз і виберіть <strong>На початковий екран</strong>
                    <PlusSquare className="w-3.5 h-3.5 inline text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.75} />
                    та натисніть <strong>Додати</strong>.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="mt-5 space-y-3.5 text-xs leading-relaxed text-[#0D0D0C] dark:text-[#F2F1EC]">
                <li className="flex items-start gap-3">
                  <span className="font-mono text-[11px] text-[#1E4631] dark:text-[#4E946C] font-semibold pt-0.5">01</span>
                  <span>
                    Відкрийте сайт у <strong>Google Chrome</strong>, <strong>Edge</strong> або <strong>Samsung Internet</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="font-mono text-[11px] text-[#1E4631] dark:text-[#4E946C] font-semibold pt-0.5">02</span>
                  <span className="inline-flex flex-wrap items-center gap-1">
                    Натисніть меню браузера
                    <MoreVertical className="w-3.5 h-3.5 inline text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.75} />
                    у правому верхньому куті.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="font-mono text-[11px] text-[#1E4631] dark:text-[#4E946C] font-semibold pt-0.5">03</span>
                  <span>
                    Оберіть <strong>Додати на головний екран</strong> або <strong>Встановити додаток</strong> та підтвердіть.
                  </span>
                </li>
              </ol>
            )}

            {isInIframe && (
              <p className="mt-4 text-[11px] leading-relaxed text-[#6B6B65] dark:text-[#94948C] border-l-2 border-[#1E4631] dark:border-[#4E946C] pl-3 py-0.5">
                Якщо сайт відкрито у вікні попереднього перегляду, спершу відкрийте його в окремій вкладці браузера — тоді системний діалог встановлення з’явиться автоматично.
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                setGuideOpen(false);
                onAction?.();
              }}
              className="mt-6 w-full py-2.5 text-xs font-semibold uppercase tracking-wider text-white bg-[#1E4631] hover:bg-[#153524] dark:bg-[#2D6A4F] dark:hover:bg-[#3A8261] transition-colors cursor-pointer"
            >
              Зрозуміло
            </button>
          </div>
        </div>
      )}
    </>
  );
}
