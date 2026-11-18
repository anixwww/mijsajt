import type { SVGProps } from 'react';

export function AntiFrameIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Glass plate */}
      <rect x="4" y="3" width="16" height="18" rx="1" />
      {/* Four metallic anti-frame clips */}
      <path d="M4 6.5h2M18 6.5h2M4 17.5h2M18 17.5h2" />
      {/* Poetic stanza inside */}
      <path d="M8.5 8.5h7M8.5 11.5h5.5M8.5 14.5h6.5" />
      {/* Subtle glass reflection */}
      <path d="M14.5 5l3 3" opacity={0.45} />
    </svg>
  );
}
