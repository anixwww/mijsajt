/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Check,
  ExternalLink,
  MessageSquare,
  ShoppingBag,
  Star,
  Truck,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import {
  getEffectivePriceUah,
  isPhysicalProduct,
  type GuestUser,
  type ProductType,
  type PurchasedAccess,
  type StoreProduct,
} from '../types.ts';
import { setActiveMoment, trackClick } from '../utils/analytics.ts';
import { EditorialImage } from './EditorialImage.tsx';
import { RegistrationCrosshair } from './EditorialMarks.tsx';
import { ReviewsBlock } from './ReviewsBlock.tsx';

interface StoreSectionProps {
  products: StoreProduct[];
  cartIds: string[];
  unlockedMap: Record<string, PurchasedAccess>;
  guestUser: GuestUser | null;
  onAddToCart: (productId: string) => void;
  onOpenLibrary: () => void;
  onProductUpdated: (product: StoreProduct) => void;
  theme?: 'light' | 'dark';
}

function getTypeLabel(type: ProductType): string {
  switch (type) {
    case 'ebook':
      return 'Електронна книга';
    case 'paper_book':
      return 'Паперова книга';
    case 'wip_gdoc':
      return 'Google Документ';
    case 'poem_frame':
      return 'Скляна антирамка · Тіло вірша';
  }
}

export function StoreSection({
  products,
  cartIds,
  unlockedMap,
  guestUser,
  onAddToCart,
  onOpenLibrary,
  onProductUpdated,
  theme = 'light',
}: StoreSectionProps) {
  const [inspectProductId, setInspectProductId] = useState<string | null>(null);

  const inspectProduct = useMemo(
    () => products.find((p) => p.id === inspectProductId) || null,
    [products, inspectProductId]
  );

  useEffect(() => {
    if (inspectProduct) {
      setActiveMoment({
        targetKey: `product:${inspectProduct.id}`,
        momentKey: `store:${inspectProduct.id}`,
        label: `Крамниця: «${inspectProduct.title}»`,
        category: 'product',
        section: 'store',
      });
    } else {
      setActiveMoment({
        targetKey: 'section:store',
        momentKey: 'store',
        label: 'Розділ: Крамниця',
        category: 'section',
        section: 'store',
      });
    }
  }, [inspectProduct]);

  const isDark = theme === 'dark';

  return (
    <section id="store" className="pb-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Store Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-8 mb-12 border-b border-[#0D0D0C]/16 dark:border-[#252522]">
          <div>
            <div className="flex items-center gap-2.5 font-mono text-[11px] tracking-widest text-[#1E4631] dark:text-[#4E946C] mb-2">
              <RegistrationCrosshair className="w-3.5 h-3.5" />
              <span>04 / ВИДАННЯ ТА ОБ’ЄКТИ</span>
            </div>
            <h2 className="font-serif text-5xl sm:text-6xl font-semibold tracking-[-0.03em] text-[#0D0D0C] dark:text-[#F2F1EC]">
              Крамниця
            </h2>
          </div>

          <button
            type="button"
            onClick={onOpenLibrary}
            className="inline-flex items-center gap-3 px-6 py-3 text-xs font-semibold tracking-wide text-[#F5F4EF] bg-[#0D0D0C] dark:bg-[#F2F1EC] dark:text-[#0D0D0C] hover:bg-[#1E4631] dark:hover:bg-[#2D6A4F] dark:hover:text-white transition-colors cursor-pointer tabular-nums self-start sm:self-auto"
          >
            <ShoppingBag className="w-4 h-4" strokeWidth={1.6} />
            <span>{cartIds.length > 0 ? `Кошик (${cartIds.length})` : 'Кошик і бібліотека'}</span>
          </button>
        </header>

        {/* Asymmetrical Editorial Store Grid */}
        {products.length === 0 ? (
          <div className="border border-[#0D0D0C]/16 dark:border-[#252522] p-12 text-center">
            <p className="font-serif text-3xl text-[#0D0D0C] dark:text-[#F2F1EC]">
              У крамниці поки немає позицій
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {products.map((product, index) => {
              const isInCart = cartIds.includes(product.id);
              const unlocked = unlockedMap[product.id];
              const isWip = product.type === 'wip_gdoc';
              const isPhysical = isPhysicalProduct(product.type);
              const discount = product.discountPercent || 0;
              const effectivePrice = getEffectivePriceUah(product);
              const hasDiscount = discount > 0;
              const hasPromo = Boolean(product.promoActive && (product.promoLabel || hasDiscount));
              const isFeatured = index === 0;
              const colSpanClass = isFeatured
                ? 'lg:col-span-12'
                : index % 2 === 1
                  ? 'lg:col-span-7'
                  : 'lg:col-span-5';

              return (
                <motion.article
                  key={product.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(index * 0.04, 0.18), ease: [0.16, 1, 0.3, 1] }}
                  className={`perf-card group border flex flex-col justify-between transition-colors ${colSpanClass} ${
                    isFeatured
                      ? isDark
                        ? 'bg-[#141412] border-[#2E2E2A] text-[#F2F1EC]'
                        : 'bg-[#0D0D0C] border-[#0D0D0C] text-[#F5F4EF]'
                      : isDark
                        ? 'bg-[#141412] border-[#252522] text-[#F2F1EC] hover:border-[#4E946C]'
                        : 'bg-white border-[#0D0D0C]/16 text-[#0D0D0C] hover:border-[#0D0D0C]'
                  }`}
                >
                  <div className={isFeatured ? 'grid grid-cols-1 lg:grid-cols-12' : ''}>
                    <button
                      type="button"
                      onClick={() => {
                        trackClick(`product:${product.id}`, `Перегляд позиції: «${product.title}»`, 'store');
                        setInspectProductId(product.id);
                      }}
                      className={`block text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1E4631] dark:focus-visible:outline-[#4E946C] ${
                        isFeatured ? 'lg:col-span-5' : 'w-full'
                      }`}
                      aria-label={`Детальніше про ${product.title}`}
                    >
                      <EditorialImage
                        src={product.coverImage}
                        alt={product.title}
                        titleFallback={product.title}
                        aspectClassName={isFeatured ? 'aspect-[4/3] lg:h-full' : 'aspect-[4/3]'}
                        className={
                          isFeatured
                            ? 'border-b lg:border-b-0 lg:border-r border-white/15'
                            : isDark
                              ? 'border-b border-[#252522]'
                              : 'border-b border-[#0D0D0C]/14'
                        }
                        priority={index < 2}
                      />
                    </button>

                    <div className={`p-6 sm:p-8 flex flex-col justify-between ${isFeatured ? 'lg:col-span-7' : ''}`}>
                      <div>
                        <div
                          className={`flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] mb-4 tabular-nums ${
                            isFeatured
                              ? 'text-[#94948C]'
                              : isDark
                                ? 'text-[#94948C]'
                                : 'text-[#6B6B65]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={isFeatured ? 'text-[#4E946C]' : 'text-[#1E4631] dark:text-[#4E946C]'}>
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span aria-hidden="true">/</span>
                            <span>{getTypeLabel(product.type)}</span>
                            {isWip && product.progressLabel && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{product.progressLabel}</span>
                              </>
                            )}
                            {product.type === 'ebook' && product.formats && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{product.formats}</span>
                              </>
                            )}
                            {product.type === 'poem_frame' && product.dimensions && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{product.dimensions}</span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {product.ratingCount > 0 ? (
                              <span
                                className={`inline-flex items-center gap-1 ${
                                  isFeatured ? 'text-[#F5F4EF]' : isDark ? 'text-[#F2F1EC]' : 'text-[#0D0D0C]'
                                }`}
                              >
                                <Star
                                  className={`w-3.5 h-3.5 fill-current ${
                                    isFeatured ? 'text-[#4E946C]' : 'text-[#1E4631] dark:text-[#4E946C]'
                                  }`}
                                  strokeWidth={1.75}
                                />
                                <span>{product.ratingAverage.toFixed(1)}</span>
                              </span>
                            ) : (
                              <span>Без оцінок</span>
                            )}
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1">
                              <MessageSquare className="w-3.5 h-3.5" strokeWidth={1.6} />
                              <span>{product.reviews.length}</span>
                            </span>
                          </div>
                        </div>

                        {hasPromo && (
                          <p
                            className={`font-mono text-xs font-semibold mb-2 ${
                              isFeatured ? 'text-[#4E946C]' : 'text-[#1E4631] dark:text-[#4E946C]'
                            }`}
                          >
                            {product.promoLabel ? `АКЦІЯ: ${product.promoLabel}` : 'СПЕЦІАЛЬНА ПРОПОЗИЦІЯ'}
                            {hasDiscount ? ` · −${discount}%` : ''}
                          </p>
                        )}

                        {!hasPromo && hasDiscount && (
                          <p
                            className={`font-mono text-xs font-semibold mb-2 tabular-nums ${
                              isFeatured ? 'text-[#4E946C]' : 'text-[#1E4631] dark:text-[#4E946C]'
                            }`}
                          >
                            ЗНИЖКА −{discount}%
                          </p>
                        )}

                        <h3
                          className={`font-serif font-semibold leading-[1.1] mb-3 ${
                            isFeatured ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'
                          }`}
                        >
                          {product.title}
                        </h3>

                        <p
                          className={`text-sm leading-relaxed line-clamp-3 mb-5 ${
                            isFeatured
                              ? 'text-[#C8C7C0]'
                              : isDark
                                ? 'text-[#B8B7B0]'
                                : 'text-[#3A3A36]'
                          }`}
                        >
                          {product.description}
                        </p>
                      </div>

                      <div className="space-y-4">
                        {isWip && product.lastUpdated && (
                          <p className="font-mono text-[11px] tabular-nums text-[#94948C]">
                            Оновлено: {product.lastUpdated} · {product.wordCount?.toLocaleString('uk-UA')} слів
                          </p>
                        )}

                        {product.type === 'ebook' && (
                          <p className="font-mono text-[11px] tabular-nums text-[#94948C]">
                            Обсяг: {product.pages || 160} стор. · {product.year || 2026}
                            {product.ebookFileName && (
                              <>
                                {' · '}
                                <span className={isFeatured || isDark ? 'text-[#F2F1EC]' : 'text-[#0D0D0C]'}>
                                  {product.ebookFileName.split('.').pop()?.toUpperCase()}
                                </span>
                              </>
                            )}
                          </p>
                        )}

                        {product.type === 'paper_book' && (
                          <p className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-[#94948C]">
                            <Truck className="w-3.5 h-3.5" strokeWidth={1.6} />
                            <span>
                              {product.binding || 'Паперове видання'} · {product.pages || 200} стор. · Доставка по Україні
                            </span>
                          </p>
                        )}

                        {product.type === 'poem_frame' && (
                          <p className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#94948C]">
                            <Truck className="w-3.5 h-3.5" strokeWidth={1.6} />
                            <span>{product.material || 'Скляна антирамка, фактурний папір'}</span>
                          </p>
                        )}

                        {isFeatured && (
                          <div className="pt-4 border-t border-white/15 flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-baseline gap-3 font-mono tabular-nums">
                              <span className="text-2xl font-medium text-[#F5F4EF]">{effectivePrice} ₴</span>
                              {hasDiscount && (
                                <span className="text-xs line-through text-[#94948C]">{product.priceUah} ₴</span>
                              )}
                            </div>

                            <div className="flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => {
                                  trackClick(`product:${product.id}`, `Перегляд позиції: «${product.title}»`, 'store');
                                  setInspectProductId(product.id);
                                }}
                                className="px-4 py-2 text-xs font-medium border border-white/25 text-[#F5F4EF] hover:border-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                Детальніше
                              </button>

                              {unlocked && !isPhysical ? (
                                <button
                                  type="button"
                                  onClick={onOpenLibrary}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0D0D0C] bg-[#F5F4EF] hover:bg-[#2D6A4F] hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  <span>Відкрити</span>
                                </button>
                              ) : isInCart ? (
                                <button
                                  type="button"
                                  onClick={onOpenLibrary}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#2A2A27] text-[#F5F4EF] hover:bg-[#3A3A36] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>У кошику</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onAddToCart(product.id)}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2D6A4F] hover:bg-[#3A8261] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <ShoppingBag className="w-3.5 h-3.5" />
                                  <span>{isPhysical ? 'Замовити' : 'Придбати'}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Secondary Cards Footer */}
                  {!isFeatured && (
                    <div
                      className={`px-6 sm:px-8 py-4 border-t flex items-center justify-between gap-3 ${
                        isDark ? 'bg-[#111110] border-[#252522]' : 'bg-[#ECEAE2]/55 border-[#0D0D0C]/14'
                      }`}
                    >
                      <div className="flex items-baseline gap-2.5 font-mono tabular-nums">
                        <span className="text-lg font-medium">{effectivePrice} ₴</span>
                        {hasDiscount && (
                          <span className="text-xs line-through text-[#6B6B65] dark:text-[#94948C]">
                            {product.priceUah} ₴
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            trackClick(`product:${product.id}`, `Перегляд позиції: «${product.title}»`, 'store');
                            setInspectProductId(product.id);
                          }}
                          className={`px-3.5 py-2 text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            isDark
                              ? 'bg-[#1B1B18] text-[#F2F1EC] border-[#2E2E2A] hover:border-[#4E946C]'
                              : 'bg-white text-[#0D0D0C] border-[#0D0D0C]/20 hover:border-[#0D0D0C]'
                          }`}
                        >
                          Детальніше
                        </button>

                        {unlocked && !isPhysical ? (
                          <button
                            type="button"
                            onClick={onOpenLibrary}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0D0D0C] dark:bg-[#F2F1EC] dark:text-[#0D0D0C] hover:bg-[#1E4631] dark:hover:bg-[#2D6A4F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Відкрити</span>
                          </button>
                        ) : isInCart ? (
                          <button
                            type="button"
                            onClick={onOpenLibrary}
                            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              isDark
                                ? 'bg-[#252522] text-[#F2F1EC] hover:bg-[#30302C]'
                                : 'bg-[#0D0D0C]/10 text-[#0D0D0C] hover:bg-[#0D0D0C]/20'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>У кошику</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onAddToCart(product.id)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1E4631] hover:bg-[#153524] dark:bg-[#2D6A4F] dark:hover:bg-[#3A8261] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <ShoppingBag className="w-3.5 h-3.5" />
                            <span>{isPhysical ? 'Замовити' : 'Придбати'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </motion.article>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Product Detail Modal */}
      <AnimatePresence>
        {inspectProduct && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-[#0D0D0C]/75 backdrop-blur-xs flex items-center justify-center p-4 md:p-6"
            onClick={() => setInspectProductId(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className={`border max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl will-change-transform ${
                isDark
                  ? 'bg-[#141412] border-[#2E2E2A] text-[#F2F1EC]'
                  : 'bg-[#F5F4EF] border-[#0D0D0C]/20 text-[#0D0D0C]'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-1 md:grid-cols-12">
                <div
                  className={`md:col-span-5 border-b md:border-b-0 md:border-r p-6 flex flex-col justify-between ${
                    isDark ? 'bg-[#0E0E0D] border-[#252522]' : 'bg-[#ECEAE2] border-[#0D0D0C]/14'
                  }`}
                >
                  <EditorialImage
                    src={inspectProduct.coverImage}
                    alt={inspectProduct.title}
                    titleFallback={inspectProduct.title}
                    aspectClassName="aspect-[3/4]"
                    className={isDark ? 'border border-[#252522]' : 'border border-[#0D0D0C]/16'}
                  />

                  <div
                    className={`mt-5 pt-4 border-t text-xs space-y-1.5 ${
                      isDark ? 'border-[#252522] text-[#94948C]' : 'border-[#0D0D0C]/14 text-[#6B6B65]'
                    }`}
                  >
                    {inspectProduct.type === 'wip_gdoc' && (
                      <>
                        <p className="font-semibold text-[#0D0D0C] dark:text-[#F2F1EC]">
                          Формат: Google Документи
                        </p>
                        <p>Постійне гостьове посилання на перегляд рукопису.</p>
                        <p className="tabular-nums">Статус: {inspectProduct.progressLabel}</p>
                      </>
                    )}
                    {inspectProduct.type === 'ebook' && (
                      <>
                        <p className="font-semibold text-[#0D0D0C] dark:text-[#F2F1EC]">
                          Формати: {inspectProduct.formats}
                        </p>
                        <p className="tabular-nums">Обсяг: {inspectProduct.pages} сторінок</p>
                        {inspectProduct.ebookFileName && (
                          <p className="font-mono text-[11px] truncate text-[#0D0D0C] dark:text-[#F2F1EC]">
                            Файл: {inspectProduct.ebookFileName}
                          </p>
                        )}
                        <p>Миттєве завантаження одразу після оплати.</p>
                      </>
                    )}
                    {inspectProduct.type === 'paper_book' && (
                      <>
                        <p className="font-semibold text-[#0D0D0C] dark:text-[#F2F1EC]">
                          Паперове видання · {inspectProduct.binding || 'Тверда палітурка'}
                        </p>
                        <p className="tabular-nums">Обсяг: {inspectProduct.pages || 200} сторінок</p>
                        <p>Доставка Новою Поштою, Укрпоштою або кур’єром після оплати карткою.</p>
                      </>
                    )}
                    {inspectProduct.type === 'poem_frame' && (
                      <>
                        <p className="font-semibold text-[#0D0D0C] dark:text-[#F2F1EC]">
                          Тіло вірша у скляній антирамці
                        </p>
                        <p>Розмір: {inspectProduct.dimensions || '21 × 30 см (А4)'}</p>
                        <p>{inspectProduct.material || 'Скло, металеві кліпси, бавовняний папір'}</p>
                      </>
                    )}
                  </div>
                </div>

                <div className="md:col-span-7 p-6 md:p-8 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <p className="font-mono text-xs text-[#6B6B65] dark:text-[#94948C] mb-1">
                          {inspectProduct.subtitle}
                        </p>
                        <h3
                          id="product-modal-title"
                          className="font-serif text-3xl sm:text-4xl font-semibold leading-tight"
                        >
                          {inspectProduct.title}
                        </h3>
                      </div>

                      <button
                        type="button"
                        onClick={() => setInspectProductId(null)}
                        className="p-2 text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC] border border-transparent hover:border-[#0D0D0C]/20 transition-colors cursor-pointer shrink-0"
                        aria-label="Закрити вікно"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {(inspectProduct.promoActive || (inspectProduct.discountPercent || 0) > 0) && (
                      <p className="font-mono text-xs font-semibold text-[#1E4631] dark:text-[#4E946C] mb-3">
                        {inspectProduct.promoActive && inspectProduct.promoLabel
                          ? `АКЦІЯ: ${inspectProduct.promoLabel}`
                          : 'ЗНИЖКА'}
                        {(inspectProduct.discountPercent || 0) > 0
                          ? ` · −${inspectProduct.discountPercent}%`
                          : ''}
                      </p>
                    )}

                    <p className="text-sm leading-relaxed mb-6 text-[#3A3A36] dark:text-[#C8C7C0]">
                      {inspectProduct.description}
                    </p>

                    <div
                      className={`p-5 border mb-6 ${
                        isDark ? 'bg-[#0B0B0A] border-[#252522]' : 'bg-white border-[#0D0D0C]/14'
                      }`}
                    >
                      <p className="font-mono text-[11px] uppercase tracking-wider text-[#6B6B65] dark:text-[#94948C] mb-2">
                        Ознайомчий фрагмент
                      </p>
                      <p className="font-serif text-xl italic leading-relaxed">
                        {inspectProduct.sampleExcerpt}
                      </p>
                    </div>
                  </div>

                  <div
                    className={`pt-5 border-t flex items-center justify-between gap-4 mb-6 ${
                      isDark ? 'border-[#252522]' : 'border-[#0D0D0C]/14'
                    }`}
                  >
                    <div className="flex items-baseline gap-2.5 font-mono tabular-nums">
                      <span className="text-2xl font-medium">
                        {getEffectivePriceUah(inspectProduct)} ₴
                      </span>
                      {(inspectProduct.discountPercent || 0) > 0 && (
                        <span className="text-sm line-through text-[#6B6B65] dark:text-[#94948C]">
                          {inspectProduct.priceUah} ₴
                        </span>
                      )}
                    </div>

                    {unlockedMap[inspectProduct.id] && !isPhysicalProduct(inspectProduct.type) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setInspectProductId(null);
                          onOpenLibrary();
                        }}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#0D0D0C] dark:bg-[#F2F1EC] dark:text-[#0D0D0C] hover:bg-[#1E4631] dark:hover:bg-[#2D6A4F] dark:hover:text-white transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>Перейти до мого доступу</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onAddToCart(inspectProduct.id);
                          setInspectProductId(null);
                        }}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#1E4631] hover:bg-[#153524] dark:bg-[#2D6A4F] dark:hover:bg-[#3A8261] transition-colors cursor-pointer"
                      >
                        <ShoppingBag className="w-4 h-4" />
                        <span>
                          {cartIds.includes(inspectProduct.id)
                            ? 'Вже у кошику'
                            : isPhysicalProduct(inspectProduct.type)
                              ? 'Оформити замовлення'
                              : 'Додати до кошика'}
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Book / Product Ratings & Reviews */}
                  <ReviewsBlock
                    targetType="product"
                    targetId={inspectProduct.id}
                    ratingAverage={inspectProduct.ratingAverage}
                    ratingCount={inspectProduct.ratingCount}
                    userRating={inspectProduct.userRating}
                    reviews={inspectProduct.reviews}
                    guestUser={guestUser}
                    onReviewSubmitted={({ product }) => {
                      if (product) onProductUpdated(product);
                    }}
                  />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
