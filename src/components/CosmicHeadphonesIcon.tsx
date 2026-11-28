export function CosmicHeadphonesIcon({ className = 'relative z-10 w-[18px] h-[18px]' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* Subtle orbital halo behind headband */}
      <path
        d="M7 6.2a7.8 7.8 0 0 1 10 0"
        stroke="#F9A8D4"
        strokeOpacity={0.65}
        strokeWidth={1.25}
      />
      {/* Star glint at zenith */}
      <circle cx="12" cy="4.2" r="0.95" fill="#FDE68A" stroke="none" />

      {/* Main headband arch */}
      <path d="M4.5 13.5V12a7.5 7.5 0 0 1 15 0v1.5" />

      {/* Left earcup */}
      <rect
        x="3.5"
        y="13"
        width="3.7"
        height="6.4"
        rx="1.65"
        stroke="#F9A8D4"
        className="fill-[#F43F5E]/30"
      />
      {/* Right earcup */}
      <rect
        x="16.8"
        y="13"
        width="3.7"
        height="6.4"
        rx="1.65"
        stroke="#F9A8D4"
        className="fill-[#EC4899]/30"
      />

      {/* Acoustic star dots inside earcups */}
      <circle cx="5.35" cy="16.2" r="0.65" fill="#FCE7F3" stroke="none" />
      <circle cx="18.65" cy="16.2" r="0.65" fill="#FCE7F3" stroke="none" />

      {/* Cosmic soundwave pulse between earcups */}
      <path
        d="M9.6 16.2h1l1-2.2 1.2 4.1 1-1.9h.8"
        stroke="#FDE68A"
        strokeWidth={1.4}
        strokeOpacity={0.9}
      />
    </svg>
  );
}
