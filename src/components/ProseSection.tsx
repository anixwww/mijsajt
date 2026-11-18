/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowUpRight, X } from 'lucide-react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useEffect, useState } from 'react';
import type { ProseWork } from '../types.ts';
import { setActiveMoment, trackClick } from '../utils/analytics.ts';
import { RegistrationCrosshair, SurrealGeometryDiagram } from './EditorialMarks.tsx';

interface ProseSectionProps {
  proseList: ProseWork[];
}

const CONTAINER_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
};

export function ProseSection({ proseList }: ProseSectionProps) {
  const [activeWork, setActiveWork] = useState<ProseWork | null>(null);
  const [largeText, setLargeText] = useState(false);

  useEffect(() => {
    if (activeWork) {
      setActiveMoment({
        targetKey: `prose:${activeWork.id}`,
        momentKey: `prose:${activeWork.id}`,
        label: `Проза: «${activeWork.title}»`,
        category: 'prose',
        section: 'prose',
      });
    } else {
      setActiveMoment({
        targetKey: 'section:prose',
        momentKey: 'prose',
        label: 'Розділ: Проза',
        category: 'section',
        section: 'prose',
      });
    }
  }, [activeWork]);

  const leadWork = proseList[0];
  const secondaryWorks = proseList.slice(1);

  return (
    <section id="prose" className="pb-12">
      <motion.div variants={CONTAINER_VARIANTS} initial="hidden" animate="visible" className="space-y-12">
        {/* Monumental High-Contrast Architectural Header Block */}
        <motion.header
          variants={ITEM_VARIANTS}
          className="bg-[#0D0D0C] dark:bg-[#141412] text-[#F5F4EF] border border-[#0D0D0C] dark:border-[#252522] p-6 sm:p-10 lg:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-end"
        >
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center gap-3 font-mono text-[11px] tracking-widest text-[#94948C]">
              <RegistrationCrosshair className="w-3.5 h-3.5 text-[#4E946C]" />
              <span>02 / АРХІТЕКТУРА ТЕКСТУ</span>
            </div>
            <h2 className="font-serif text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-[-0.03em] leading-[0.92] text-[#F5F4EF]">
              Проза
            </h2>
            <p className="text-sm text-[#B8B7B0] max-w-md leading-relaxed pt-2">
              Оповідання, новели та окремі уривки з опублікованих і підготовчих циклів — як окремі просторові конструкції.
            </p>
          </div>

          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="aspect-[16/9] overflow-hidden border border-white/15 bg-[#1C1C19]">
              <img
                src="/src/assets/images/quiet_geometry_relief_1795034931823.jpg"
                alt="Скульптурний рельєф — архітектура прози"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex items-center justify-between font-mono text-[11px] text-[#94948C] tabular-nums">
              <span>Окремий всесвіт</span>
              <span>{proseList.length} позиції</span>
            </div>
          </div>
        </motion.header>

        {/* Featured Lead Prose Spread */}
        {leadWork && (
          <motion.article
            variants={ITEM_VARIANTS}
            className="perf-card border border-[#0D0D0C]/16 dark:border-[#252522] bg-white dark:bg-[#141412] grid grid-cols-1 lg:grid-cols-12"
          >
            <div className="lg:col-span-4 p-6 sm:p-8 border-b lg:border-b-0 lg:border-r border-[#0D0D0C]/14 dark:border-[#252522] flex flex-col justify-between bg-[#ECEAE2]/50 dark:bg-[#181815]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-[#1E4631] dark:text-[#4E946C] font-semibold">
                  ТВОР № 01
                </span>
                <RegistrationCrosshair className="w-3.5 h-3.5 text-[#6B6B65] dark:text-[#94948C]" />
              </div>

              <div className="py-8">
                <SurrealGeometryDiagram className="w-full h-16 text-[#0D0D0C] dark:text-[#F2F1EC]" />
              </div>

              <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-[#6B6B65] dark:text-[#94948C] tabular-nums">
                <span>{leadWork.genre}</span>
                <span aria-hidden="true">/</span>
                <span>{leadWork.year}</span>
                <span aria-hidden="true">/</span>
                <span>{leadWork.readingMinutes} хв</span>
              </div>
            </div>

            <div className="lg:col-span-8 p-6 sm:p-10 flex flex-col justify-between gap-8">
              <div>
                <h3 className="font-serif text-3xl sm:text-5xl font-semibold text-[#0D0D0C] dark:text-[#F2F1EC] leading-[1.06] tracking-tight mb-5">
                  {leadWork.title}
                </h3>
                <p className="text-base text-[#3A3A36] dark:text-[#C8C7C0] leading-relaxed max-w-[58ch]">
                  {leadWork.excerpt}
                </p>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => {
                    trackClick(`prose:${leadWork.id}`, `Проза: «${leadWork.title}»`, 'content');
                    setActiveWork(leadWork);
                  }}
                  className="inline-flex items-center gap-3 px-6 py-3 text-xs font-semibold tracking-wide text-[#F5F4EF] bg-[#0D0D0C] dark:bg-[#F2F1EC] dark:text-[#0D0D0C] hover:bg-[#1E4631] dark:hover:bg-[#2D6A4F] dark:hover:text-white transition-colors cursor-pointer"
                >
                  <span>Читати текст</span>
                  <ArrowUpRight className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          </motion.article>
        )}

        {/* Asymmetrical Staggered Prose Grid */}
        {secondaryWorks.length > 0 && (
          <motion.div variants={ITEM_VARIANTS} className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            {secondaryWorks.map((work, idx) => {
              const isWide = idx % 2 === 0;
              return (
                <motion.article
                  key={work.id}
                  variants={ITEM_VARIANTS}
                  className={`perf-card border border-[#0D0D0C]/16 dark:border-[#252522] p-6 sm:p-8 flex flex-col justify-between gap-8 transition-colors hover:border-[#0D0D0C] dark:hover:border-[#4E946C] ${
                    isWide
                      ? 'md:col-span-7 bg-white dark:bg-[#141412]'
                      : 'md:col-span-5 md:mt-10 bg-[#ECEAE2]/45 dark:bg-[#181815]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-3 pb-4 mb-5 border-b border-[#0D0D0C]/12 dark:border-[#252522] font-mono text-xs text-[#6B6B65] dark:text-[#94948C] tabular-nums">
                      <span className="text-[#1E4631] dark:text-[#4E946C] font-semibold">
                        {String(idx + 2).padStart(2, '0')}
                      </span>
                      <div className="flex items-center gap-2">
                        <span>{work.genre}</span>
                        <span aria-hidden="true">·</span>
                        <span>{work.year}</span>
                        <span aria-hidden="true">·</span>
                        <span>{work.readingMinutes} хв</span>
                      </div>
                    </div>

                    <h3 className="font-serif text-2xl sm:text-3xl font-semibold text-[#0D0D0C] dark:text-[#F2F1EC] leading-snug mb-3">
                      {work.title}
                    </h3>

                    <p className="text-sm sm:text-[15px] text-[#3A3A36] dark:text-[#B8B7B0] leading-relaxed">
                      {work.excerpt}
                    </p>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        trackClick(`prose:${work.id}`, `Проза: «${work.title}»`, 'content');
                        setActiveWork(work);
                      }}
                      className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#0D0D0C] dark:text-[#F2F1EC] hover:text-[#1E4631] dark:hover:text-[#4E946C] transition-colors cursor-pointer"
                    >
                      <span>Читати текст</span>
                      <ArrowUpRight className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </motion.div>
        )}
      </motion.div>

      {/* Architectural Prose Reader Modal */}
      <AnimatePresence>
        {activeWork && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-[#0D0D0C]/75 backdrop-blur-xs flex items-center justify-center p-4 md:p-6"
            onClick={() => setActiveWork(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="prose-modal-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="bg-[#F5F4EF] dark:bg-[#141412] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 md:p-12 shadow-2xl will-change-transform"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 pb-6 border-b border-[#0D0D0C]/16 dark:border-[#252522]">
                <div>
                  <div className="flex items-center gap-2 font-mono text-xs text-[#6B6B65] dark:text-[#94948C] mb-2 tabular-nums">
                    <span>{activeWork.genre}</span>
                    <span aria-hidden="true">/</span>
                    <span>{activeWork.year}</span>
                    <span aria-hidden="true">/</span>
                    <span>{activeWork.readingMinutes} хв читання</span>
                  </div>
                  <h3
                    id="prose-modal-title"
                    className="font-serif text-3xl md:text-5xl font-semibold text-[#0D0D0C] dark:text-[#F2F1EC] leading-tight"
                  >
                    {activeWork.title}
                  </h3>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setLargeText((prev) => !prev)}
                    className="px-3 py-1.5 text-xs font-mono font-medium text-[#0D0D0C] dark:text-[#F2F1EC] bg-white dark:bg-[#1E1E1B] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] hover:border-[#1E4631] dark:hover:border-[#4E946C] transition-colors cursor-pointer"
                    aria-label="Змінити розмір шрифту"
                  >
                    {largeText ? 'А' : 'А+'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveWork(null)}
                    className="p-2 text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC] border border-transparent hover:border-[#0D0D0C]/20 transition-colors cursor-pointer"
                    aria-label="Закрити вікно читання"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div
                className={`py-8 max-w-[65ch] mx-auto text-[#0D0D0C] dark:text-[#E8E7E1] space-y-5 leading-[1.8] ${
                  largeText ? 'text-lg' : 'text-base'
                }`}
              >
                {activeWork.content.split('\n\n').map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>

              <div className="pt-6 border-t border-[#0D0D0C]/16 dark:border-[#252522] flex justify-end">
                <button
                  type="button"
                  onClick={() => setActiveWork(null)}
                  className="px-6 py-2.5 text-xs font-semibold text-white bg-[#0D0D0C] dark:bg-[#F2F1EC] dark:text-[#0D0D0C] hover:bg-[#1E4631] dark:hover:bg-[#2D6A4F] dark:hover:text-white transition-colors cursor-pointer"
                >
                  Повернутися до прози
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
