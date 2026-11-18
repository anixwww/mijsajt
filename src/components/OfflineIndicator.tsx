import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 border border-[#0D0D0C]/20 dark:border-[#2E2E2A] bg-[#0D0D0C] dark:bg-[#F5F4EF] text-[#F5F4EF] dark:text-[#0D0D0C] px-3.5 py-2 text-xs font-mono shadow-xl"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
      <span>Офлайн-режим · збережений архів</span>
    </div>
  );
}
