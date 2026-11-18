import { Check, Copy, ExternalLink, Mail, Share2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { trackClick } from '../utils/analytics.ts';

interface ShareButtonProps {
  title: string;
  text: string;
  url: string;
  variant?: 'inline' | 'button' | 'icon';
}

export function ShareButton({ title, text, url, variant = 'inline' }: ShareButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const copyToClipboard = async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2600);
        return true;
      }
    } catch {}
    return false;
  };

  const handleShareClick = async () => {
    trackClick('action:share', `Поділитися: ${title}`, 'action');
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError') {
          return;
        }
      }
    }

    await copyToClipboard();
    setMenuOpen(true);
  };

  const handleNativeShareFromMenu = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url });
        setMenuOpen(false);
      } catch {}
    }
  };

  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  const encodedTitle = encodeURIComponent(title);

  const shareTargets = [
    {
      label: 'Telegram',
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
    },
    {
      label: 'WhatsApp',
      href: `https://wa.me/?text=${encodeURIComponent(`${text} — ${url}`)}`,
    },
    {
      label: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
    {
      label: 'X (Twitter)',
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    },
    {
      label: 'Електронна пошта',
      href: `mailto:?subject=${encodedTitle}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
      isMail: true,
    },
  ];

  const shareModal =
    typeof document !== 'undefined'
      ? createPortal(
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-[70] bg-[#0D0D0C]/70 backdrop-blur-xs flex items-center justify-center p-4"
                onClick={() => setMenuOpen(false)}
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-dialog-title"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.98, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: 8 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-[#F5F4EF] dark:bg-[#141412] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] text-[#0D0D0C] dark:text-[#F2F1EC] max-w-md w-full p-6 shadow-2xl will-change-transform"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#0D0D0C]/16 dark:border-[#252522]">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] uppercase tracking-wider text-[#6B6B65] dark:text-[#94948C] mb-1">
                        Поділитися матеріалом
                      </p>
                      <h4
                        id="share-dialog-title"
                        className="font-serif text-2xl font-semibold truncate"
                      >
                        {title}
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMenuOpen(false)}
                      className="p-1.5 text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC] border border-transparent hover:border-[#0D0D0C]/20 transition-colors cursor-pointer shrink-0"
                      aria-label="Закрити вікно поширення"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="pt-4 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1.5">
                        Пряме посилання
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={url}
                          onFocus={(e) => e.target.select()}
                          className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-white dark:bg-[#0B0B0A] text-[#0D0D0C] dark:text-[#F2F1EC] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                        />
                        <button
                          type="button"
                          onClick={copyToClipboard}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0D0D0C] dark:bg-[#F2F1EC] dark:text-[#0D0D0C] hover:bg-[#1E4631] dark:hover:bg-[#2D6A4F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {copied ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Скопійовано</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Копіювати</span>
                            </>
                          )}
                        </button>
                      </div>
                      {copied && (
                        <p className="text-[11px] font-medium text-[#1E4631] dark:text-[#4E946C] mt-1.5" role="status">
                          Посилання скопійовано в буфер обміну.
                        </p>
                      )}
                    </div>

                    <div className="pt-3 border-t border-[#0D0D0C]/16 dark:border-[#252522]">
                      <p className="text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-2.5">
                        Або надіслати через
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {shareTargets.map((target) => (
                          <a
                            key={target.label}
                            href={target.href}
                            target={target.isMail ? undefined : '_blank'}
                            rel={target.isMail ? undefined : 'noopener noreferrer'}
                            className="flex items-center justify-between px-3 py-2 text-xs font-medium bg-white dark:bg-[#1B1B18] border border-[#0D0D0C]/16 dark:border-[#252522] hover:border-[#1E4631] hover:text-[#1E4631] dark:hover:border-[#4E946C] dark:hover:text-[#4E946C] transition-colors"
                          >
                            <span>{target.label}</span>
                            {target.isMail ? (
                              <Mail className="w-3.5 h-3.5 text-[#6B6B65] dark:text-[#94948C]" strokeWidth={1.6} />
                            ) : (
                              <ExternalLink className="w-3.5 h-3.5 text-[#6B6B65] dark:text-[#94948C]" strokeWidth={1.6} />
                            )}
                          </a>
                        ))}

                        {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                          <button
                            type="button"
                            onClick={handleNativeShareFromMenu}
                            className="flex items-center justify-between px-3 py-2 text-xs font-medium bg-white dark:bg-[#1B1B18] border border-[#0D0D0C]/16 dark:border-[#252522] hover:border-[#1E4631] hover:text-[#1E4631] dark:hover:border-[#4E946C] dark:hover:text-[#4E946C] transition-colors cursor-pointer"
                          >
                            <span>Інші додатки</span>
                            <Share2 className="w-3.5 h-3.5 text-[#6B6B65] dark:text-[#94948C]" strokeWidth={1.6} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )
      : null;

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={handleShareClick}
          title="Поділитися"
          aria-label={`Поділитися: ${title}`}
          className="p-2.5 text-[#0D0D0C] dark:text-[#F2F1EC] border border-[#0D0D0C]/20 dark:border-[#252522] hover:border-[#1E4631] hover:text-[#1E4631] dark:hover:border-[#4E946C] dark:hover:text-[#4E946C] transition-colors cursor-pointer"
        >
          {copied ? (
            <Check className="w-4 h-4 text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.75} />
          ) : (
            <Share2 className="w-4 h-4" strokeWidth={1.6} />
          )}
        </button>
      ) : variant === 'button' ? (
        <button
          type="button"
          onClick={handleShareClick}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#0D0D0C] dark:text-[#F2F1EC] bg-white dark:bg-[#1B1B18] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] hover:border-[#1E4631] hover:text-[#1E4631] dark:hover:border-[#4E946C] dark:hover:text-[#4E946C] transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.75} />
              <span>Посилання скопійовано</span>
            </>
          ) : (
            <>
              <Share2 className="w-3.5 h-3.5" strokeWidth={1.6} />
              <span>Поділитися</span>
            </>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleShareClick}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B6B65] dark:text-[#94948C] hover:text-[#1E4631] dark:hover:text-[#4E946C] transition-colors cursor-pointer"
          aria-label={`Поділитися: ${title}`}
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.75} />
              <span className="text-[#1E4631] dark:text-[#4E946C]">Скопійовано</span>
            </>
          ) : (
            <>
              <Share2 className="w-3.5 h-3.5" strokeWidth={1.6} />
              <span>Поділитися</span>
            </>
          )}
        </button>
      )}
      {shareModal}
    </>
  );
}
