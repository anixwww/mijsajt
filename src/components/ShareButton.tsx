import { Check, Copy, ExternalLink, Mail, Share2, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { trackClick } from '../utils/analytics.ts';

interface ShareButtonProps {
  title: string;
  text: string;
  url: string;
  variant?: 'inline' | 'button' | 'icon';
  iconStyle?: CSSProperties;
}

export function ShareButton({ title, text, url, variant = 'inline', iconStyle }: ShareButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key ==='Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const copyToClipboard = async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText ==='function') {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2600);
        return true;
      }
    } catch {
      // Clipboard write may fail if document lacks focus
    }
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
        // Fall through to clipboard + share menu on NotAllowedError / iframe restrictions
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
        return;
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError') {
          return;
        }
      }
    }
    await copyToClipboard();
  };

  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  const encodedTitle = encodeURIComponent(title);

  const shareTargets = [
    {
      label:'Telegram',
      href:`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
    },
    {
      label:'WhatsApp',
      href:`https://wa.me/?text=${encodeURIComponent(`${text} — ${url}`)}`,
    },
    {
      label:'Facebook',
      href:`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
    {
      label:'X (Twitter)',
      href:`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    },
    {
      label:'Електронна пошта',
      href:`mailto:?subject=${encodedTitle}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
      isMail: true,
    },
  ];

  const shareModal =
    typeof document !=='undefined'
      ? createPortal(
          <AnimatePresence>
            {menuOpen && (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-[70] bg-[#141413]/45 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
                onClick={() => setMenuOpen(false)}
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-dialog-title"
              >
                <m.div
                  initial={{ opacity: 0, scale: 0.97, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 8 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-[#F9F9F7] dark:bg-[#202020] rounded-2xl max-w-md w-full p-6 shadow-xl will-change-transform text-[#141413] dark:text-[#F4F1EA]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-4 pb-4">
                    <div className="min-w-0">
                      <p className="text-xs text-[#5C5C58] dark:text-[#A8A49B] mb-1">Поділитися матеріалом</p>
                      <h4
                        id="share-dialog-title"
                        className="font-serif text-2xl font-semibold text-[#141413] dark:text-[#F4F1EA] truncate"
                      >
                        {title}
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMenuOpen(false)}
                      className="p-1.5 text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-[#F4F1EA] hover:bg-[#EFECE6] dark:hover:bg-[#323232] rounded-md transition-colors cursor-pointer shrink-0"
                      aria-label="Закрити вікно поширення"
                    >
                      <X className="w-4 h-4"/>
                    </button>
                  </div>

                  <div className="pt-4 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] mb-1.5">
                        Пряме посилання
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={url}
                          onFocus={(e) => e.target.select()}
                          className="flex-1 min-w-0 px-3 py-2 text-xs font-mono text-[#141413] dark:text-[#F4F1EA] bg-white dark:bg-[#262626] rounded-md focus:outline-none"
                        />
                      <button
                        type="button"
                        onClick={copyToClipboard}
                        className="btn-editorial-ink px-4 py-2 group"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-[#181818] dark:group-hover:text-white"/>
                            <span>Скопійовано</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5"/>
                            <span>Копіювати</span>
                          </>
                        )}
                      </button>
                    </div>
                    {copied && (
                      <p className="text-[11px] font-medium text-emerald-800 dark:text-[#E5E5E5] mt-1.5"role="status">
                        Посилання скопійовано в буфер обміну.
                      </p>
                    )}
                  </div>

                  <div className="pt-3">
                    <p className="text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] mb-2.5">
                      Або надіслати через
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {shareTargets.map((target) => (
                        <a
                          key={target.label}
                          href={target.href}
                          target={target.isMail ? undefined :'_blank'}
                          rel={target.isMail ? undefined :'noopener noreferrer'}
                          className="flex items-center justify-between px-3.5 py-2.5 text-xs font-medium text-[#141413] dark:text-[#F4F1EA] bg-white dark:bg-[#262626] hover:text-[#2C5937] dark:hover:text-[#FFFFFF] dark:hover:bg-[#323232] active:scale-[0.98] rounded-lg transition-all duration-150 whitespace-nowrap"
                        >
                          <span className="truncate">{target.label}</span>
                          {target.isMail ? (
                            <Mail className="w-3.5 h-3.5 text-[#5C5C58] dark:text-[#A8A49B] shrink-0"strokeWidth={1.75} />
                          ) : (
                            <ExternalLink className="w-3.5 h-3.5 text-[#5C5C58] dark:text-[#A8A49B] shrink-0"strokeWidth={1.75} />
                          )}
                        </a>
                      ))}

                      {typeof navigator !=='undefined'&& typeof navigator.share ==='function'&& (
                        <button
                          type="button"
                          onClick={handleNativeShareFromMenu}
                          className="flex items-center justify-between px-3.5 py-2.5 text-xs font-medium text-[#141413] dark:text-[#F4F1EA] bg-white dark:bg-[#262626] hover:text-[#2C5937] dark:hover:text-[#FFFFFF] dark:hover:bg-[#323232] active:scale-[0.98] rounded-lg transition-all duration-150 whitespace-nowrap cursor-pointer"
                        >
                          <span>Інші додатки</span>
                          <Share2 className="w-3.5 h-3.5 text-[#5C5C58] dark:text-[#A8A49B] shrink-0"strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </m.div>
            </m.div>
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
          style={!copied ? iconStyle : undefined}
          className={`btn-editorial-icon ${
            copied
              ? 'bg-emerald-50 dark:bg-[#323232] text-emerald-800 dark:text-[#E5E5E5] hover:bg-emerald-100 dark:hover:bg-[#3D3D3D] hover:text-emerald-900 dark:hover:text-[#FFFFFF]'
              : ''
          }`}
        >
          {copied ? (
            <Check className="w-4 h-4"strokeWidth={1.85} />
          ) : (
            <Share2 className="w-4 h-4"strokeWidth={1.75} />
          )}
        </button>
      ) : variant ==='button'? (
        <button
          type="button"
          onClick={handleShareClick}
          className="btn-editorial-secondary"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-[#E5E5E5]"strokeWidth={1.85} />
              <span>Посилання скопійовано</span>
            </>
          ) : (
            <>
              <Share2 className="w-3.5 h-3.5"strokeWidth={1.75} />
              <span>Поділитися</span>
            </>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleShareClick}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#2C5937] dark:hover:text-[#FFFFFF] hover:bg-[#F4F1EA] dark:hover:bg-[#323232] active:scale-[0.98] rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer"
          aria-label={`Поділитися: ${title}`}
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-[#E5E5E5]"strokeWidth={1.85} />
              <span className="text-emerald-800 dark:text-[#E5E5E5]">Скопійовано</span>
            </>
          ) : (
            <>
              <Share2 className="w-3.5 h-3.5"strokeWidth={1.75} />
              <span>Поділитися</span>
            </>
          )}
        </button>
      )}
      {shareModal}
    </>
  );
}
