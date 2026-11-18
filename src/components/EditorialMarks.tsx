import type { SVGProps } from 'react';

export function RegistrationCrosshair({ className = 'w-3.5 h-3.5', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M8 1v14M1 8h14" />
      <circle cx="8" cy="8" r="3" />
    </svg>
  );
}

export function SurrealGeometryDiagram({ className = 'w-full h-auto', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 320 120"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <line x1="0" y1="60" x2="320" y2="60" strokeWidth="0.75" strokeOpacity="0.25" />
      <line x1="112" y1="0" x2="112" y2="120" strokeWidth="0.75" strokeOpacity="0.25" />
      <circle cx="112" cy="60" r="38" strokeWidth="1" strokeDasharray="3 4" />
      <path d="M112 22 A38 38 0 0 1 150 60" stroke="#2D6A4F" strokeWidth="1.75" />
      <rect x="176" y="34" width="52" height="52" strokeWidth="1" />
      <line x1="176" y1="86" x2="228" y2="34" strokeWidth="0.85" strokeOpacity="0.65" />
      <circle cx="268" cy="60" r="4" fill="#2D6A4F" stroke="none" />
      <line x1="268" y1="16" x2="268" y2="104" strokeWidth="0.75" strokeOpacity="0.4" />
    </svg>
  );
}

export function PineconeIcon({ className = 'w-4 h-4', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M12 2c-3 3-4 6-4 9 0 3.5 2 5 4 8 2-3 4-4.5 4-8 0-3-1-6-4-9z" />
      <path d="M9 7c1.5 1 3 1.5 6 1.5" />
      <path d="M8 11c2 1.5 4 2 8 2" />
      <path d="M9 15c1.5 1 3 1.2 6 1" />
    </svg>
  );
}

export function PineTreeIcon({ className = 'w-4 h-4', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M12 2L3 14h5l-3 7h14l-3-7h5L12 2z" />
      <path d="M12 17v5" />
    </svg>
  );
}

