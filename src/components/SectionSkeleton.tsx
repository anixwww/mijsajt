/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';
import type { SectionId } from '../types.ts';

interface SectionSkeletonProps {
  section: SectionId;
  embedded?: boolean;
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-[#E6E2D8]/85 dark:bg-[#323232]/90 ${className}`}
      aria-hidden="true"
    />
  );
}

function SkeletonCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-[#FAFBF8]/88 dark:bg-[#262626] ${className}`}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

export function SectionSkeleton({ section, embedded = false }: SectionSkeletonProps) {
  if (section === 'home') {
    return (
      <section
        className="w-full min-h-[calc(100vh-4rem)] hero-pine-bg flex flex-col items-center px-4 sm:px-6 pt-4 pb-28"
        role="status"
        aria-live="polite"
        aria-label="Завантаження головної сторінки"
      >
        <span className="sr-only">Завантаження сторінки...</span>

        {/* Top Header Bar Skeleton */}
        <div className="w-full max-w-5xl flex items-center justify-between py-2">
          <SkeletonBlock className="h-9 w-9 rounded-xl" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-9 w-24 rounded-full" />
            <SkeletonBlock className="h-9 w-9 rounded-xl" />
          </div>
        </div>

        {/* Author Signature + 3:4 Portrait Skeleton */}
        <div className="w-full max-w-4xl mx-auto pt-5 sm:pt-7 flex flex-col items-center">
          <SkeletonBlock className="h-10 w-44 mb-7 rounded-xl" />
          <div className="w-full max-w-[230px] sm:max-w-[260px] aspect-[3/4] rounded-2xl overflow-hidden bg-[#E6E2D8]/85 dark:bg-[#323232]/90 animate-pulse shadow-[0_20px_44px_-20px_rgba(17,30,22,0.2)] dark:shadow-[0_20px_44px_-20px_rgba(0,0,0,0.6)]" />

          {/* 4 Quick Action Cards Skeleton */}
          <div className="w-full max-w-2xl mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
            {[0, 1, 2, 3].map((idx) => (
              <SkeletonCard key={idx} className="px-3.5 py-3 flex items-center gap-3.5">
                <SkeletonBlock className="w-10 h-10 rounded-[11px] shrink-0" />
                <SkeletonBlock className="h-3.5 flex-1 max-w-[68%]" />
                <SkeletonBlock className="w-4 h-4 rounded-sm shrink-0 opacity-60" />
              </SkeletonCard>
            ))}
          </div>
        </div>
      </section>
    );
  }

  const containerClass = embedded
    ? 'w-full space-y-6'
    : 'max-w-4xl w-full mx-auto px-4 sm:px-6 pt-5 pb-24 sm:pb-28 md:pt-7 space-y-6';

  return (
    <div
      className={containerClass}
      role="status"
      aria-live="polite"
      aria-label="Завантаження розділу"
    >
      <span className="sr-only">Завантаження розділу...</span>

      {/* Section Header Skeleton */}
      <div className="flex items-end justify-between gap-4 pb-4">
        <div className="space-y-2.5 flex-1">
          <SkeletonBlock className="h-7 w-44 sm:w-56" />
          <SkeletonBlock className="h-3.5 w-64 sm:w-80 max-w-full opacity-75" />
        </div>
        {section === 'poetry' && <SkeletonBlock className="h-9 w-9 rounded-xl shrink-0" />}
        {section === 'store' && <SkeletonBlock className="h-9 w-28 rounded-xl shrink-0" />}
      </div>

      {/* Poetry Skeleton */}
      {section === 'poetry' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((idx) => (
            <SkeletonCard key={idx} className="p-5 sm:p-6 space-y-4">
              <div className="space-y-2">
                <SkeletonBlock className="h-5 w-3/4" />
                <SkeletonBlock className="h-3 w-1/3 opacity-70" />
              </div>
              <div className="space-y-2 pt-1">
                <SkeletonBlock className="h-3 w-11/12 opacity-80" />
                <SkeletonBlock className="h-3 w-9/12 opacity-80" />
                <SkeletonBlock className="h-3 w-10/12 opacity-80" />
                <SkeletonBlock className="h-3 w-7/12 opacity-80" />
              </div>
              <div className="pt-2 flex items-center justify-between">
                <SkeletonBlock className="h-3.5 w-16 opacity-65" />
                <SkeletonBlock className="h-7 w-14 rounded-lg opacity-70" />
              </div>
            </SkeletonCard>
          ))}
        </div>
      )}

      {/* Prose Skeleton */}
      {section === 'prose' && (
        <div className="space-y-4">
          <SkeletonCard className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <SkeletonBlock className="h-4 w-64 max-w-full" />
            <SkeletonBlock className="h-9 w-40 rounded-xl shrink-0" />
          </SkeletonCard>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((idx) => (
              <SkeletonCard key={idx} className="p-5 space-y-3.5">
                <SkeletonBlock className="aspect-[16/9] w-full rounded-xl" />
                <SkeletonBlock className="h-5 w-4/5" />
                <SkeletonBlock className="h-3 w-2/5 opacity-70" />
                <div className="space-y-1.5 pt-1">
                  <SkeletonBlock className="h-3 w-full opacity-80" />
                  <SkeletonBlock className="h-3 w-5/6 opacity-80" />
                </div>
                <div className="pt-2 flex items-center justify-between gap-3">
                  <SkeletonBlock className="h-4 w-20" />
                  <SkeletonBlock className="h-9 w-28 rounded-xl" />
                </div>
              </SkeletonCard>
            ))}
          </div>
        </div>
      )}

      {/* Blog Skeleton */}
      {section === 'blog' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((idx) => (
            <SkeletonCard key={idx} className="overflow-hidden">
              <SkeletonBlock className="aspect-[16/10] w-full rounded-none" />
              <div className="p-5 space-y-3">
                <SkeletonBlock className="h-3 w-28 opacity-70" />
                <SkeletonBlock className="h-5 w-4/5" />
                <div className="space-y-1.5">
                  <SkeletonBlock className="h-3 w-full opacity-80" />
                  <SkeletonBlock className="h-3 w-3/4 opacity-80" />
                </div>
              </div>
            </SkeletonCard>
          ))}
        </div>
      )}

      {/* Radio Skeleton */}
      {section === 'radio' && (
        <div className="space-y-4">
          <SkeletonCard className="p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-4">
              <SkeletonBlock className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2.5">
                <SkeletonBlock className="h-3 w-24 opacity-70" />
                <SkeletonBlock className="h-5 w-52 max-w-full" />
                <SkeletonBlock className="h-3 w-36 opacity-75" />
              </div>
            </div>
            <SkeletonBlock className="h-2 w-full rounded-full" />
            <div className="flex items-center justify-center gap-4">
              <SkeletonBlock className="w-10 h-10 rounded-full" />
              <SkeletonBlock className="w-12 h-12 rounded-full" />
              <SkeletonBlock className="w-10 h-10 rounded-full" />
            </div>
          </SkeletonCard>

          <SkeletonCard>
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <SkeletonBlock className="w-6 h-4 shrink-0 opacity-70" />
                  <SkeletonBlock className="h-4 w-48 max-w-full" />
                </div>
                <SkeletonBlock className="h-3.5 w-12 shrink-0 opacity-70" />
              </div>
            ))}
          </SkeletonCard>
        </div>
      )}

      {/* Store Skeleton */}
      {section === 'store' && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5 sm:gap-4">
          {[0, 1, 2, 3, 4, 5].map((idx) => (
            <SkeletonCard key={idx} className="p-3.5 sm:p-4 space-y-3">
              <SkeletonBlock className="aspect-[3/4] w-full rounded-xl" />
              <div className="space-y-1.5">
                <SkeletonBlock className="h-4 w-4/5" />
                <SkeletonBlock className="h-3 w-1/2 opacity-70" />
              </div>
              <div className="pt-1 flex items-center justify-between gap-2">
                <SkeletonBlock className="h-4 w-14" />
                <SkeletonBlock className="h-8 w-20 rounded-lg" />
              </div>
            </SkeletonCard>
          ))}
        </div>
      )}
    </div>
  );
}
