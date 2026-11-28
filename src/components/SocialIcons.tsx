import type { SocialLinkItem, SocialPlatform } from '../types.ts';

export const SOCIAL_PLATFORM_META: Record<
  SocialPlatform,
  { label: string; placeholder: string }
> = {
  telegram: {
    label: 'Telegram',
    placeholder: 'https://t.me/username',
  },
  instagram: {
    label: 'Instagram',
    placeholder: 'https://instagram.com/username',
  },
  facebook: {
    label: 'Facebook',
    placeholder: 'https://facebook.com/username',
  },
  youtube: {
    label: 'YouTube',
    placeholder: 'https://youtube.com/@channel',
  },
  threads: {
    label: 'Threads',
    placeholder: 'https://threads.net/@username',
  },
  x: {
    label: 'X (Twitter)',
    placeholder: 'https://x.com/username',
  },
  tiktok: {
    label: 'TikTok',
    placeholder: 'https://tiktok.com/@username',
  },
};

export const FALLBACK_SOCIAL_LINKS: SocialLinkItem[] = [
  { platform: 'telegram', label: 'Telegram', url: 'https://t.me/andriidankiv', enabled: true },
  { platform: 'instagram', label: 'Instagram', url: '', enabled: false },
  { platform: 'facebook', label: 'Facebook', url: '', enabled: false },
  { platform: 'youtube', label: 'YouTube', url: '', enabled: false },
  { platform: 'threads', label: 'Threads', url: '', enabled: false },
  { platform: 'x', label: 'X (Twitter)', url: '', enabled: false },
  { platform: 'tiktok', label: 'TikTok', url: '', enabled: false },
];

export function SocialPlatformIcon({
  platform,
  className = 'w-4 h-4',
}: {
  platform: SocialPlatform;
  className?: string;
}) {
  switch (platform) {
    case 'telegram':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path
            d="M21.2 4.6L2.9 11.7c-.8.3-.8 1.4.1 1.7l4.6 1.5 1.8 5.5c.2.7 1.1.9 1.6.4l2.6-2.5 4.9 3.6c.7.5 1.6.1 1.8-.7L22.5 5.8c.2-.9-.5-1.5-1.3-1.2z"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinejoin="round"
          />
          <path
            d="M7.6 14.9L18.4 7.7"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <rect
            x="3.5"
            y="3.5"
            width="17"
            height="17"
            rx="5"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <circle cx="12" cy="12" r="3.8" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="17.2" cy="6.8" r="1" fill="currentColor" />
        </svg>
      );
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path
            d="M14.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.5V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 4v2.2H9v3h2.5V21h3z"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <rect
            x="2.8"
            y="5.5"
            width="18.4"
            height="13"
            rx="3.8"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <path
            d="M10.4 9.3l4.9 2.7-4.9 2.7V9.3z"
            fill="currentColor"
          />
        </svg>
      );
    case 'threads':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path
            d="M16.2 10.6c-.4-2.5-1.9-3.9-4.3-3.9-2.7 0-4.6 2.1-4.6 5.3s1.9 5.3 4.8 5.3c2.2 0 3.7-1.1 4.2-2.7"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <path
            d="M14.8 12.1c0 1.6-1.1 2.7-2.6 2.7-1.3 0-2.2-.8-2.2-2 0-1.3 1-2.1 2.5-2.1 1.3 0 2.3.5 3.1 1.4.8.8 1.5 1.1 2.3.7 1.1-.5 1.6-2 1.4-3.9C18.9 5.3 16 3 12 3 7.2 3 3.8 6.8 3.8 12s3.4 9 8.2 9c2.8 0 5.1-1.1 6.5-3"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'x':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path
            d="M4.5 4.5l15 15M19.5 4.5l-15 15"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path
            d="M14.2 4.2v10.2a3.7 3.7 0 1 1-2.8-3.6M14.2 4.2c.7 2 2.4 3.4 4.6 3.7"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}
