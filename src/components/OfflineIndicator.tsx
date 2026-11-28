import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus.ts';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[74px] sm:bottom-[78px] left-3.5 sm:left-6 right-16 sm:right-auto max-w-[calc(100vw-5.25rem)] sm:max-w-md z-40 inline-flex items-center gap-2 rounded-xl bg-[#202020]/95 px-3.5 py-2 text-xs font-medium text-[#F4F1EA] shadow-lg backdrop-blur-sm"
    >
      <WifiOff className="w-3.5 h-3.5 text-[#E5E5E5] shrink-0" strokeWidth={2} />
      <span>Офлайн-режим — доступні збережені вірші, тексти та блог</span>
    </div>
  );
}
