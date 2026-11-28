import { Award, Check, ExternalLink, ShoppingBag, Star, Tag, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  getEffectivePriceUah,
  isPhysicalProduct,
  parseStoreProductPromo,
  type GuestUser,
  type ProductType,
  type PurchasedAccess,
  type StoreProduct,
} from '../types.ts';
import { setActiveMoment, trackClick } from '../utils/analytics.ts';
import { useTouchFeedback } from '../utils/useTouchFeedback.ts';
import { EditorialImage } from './EditorialImage.tsx';
import { EmptySectionState } from './EmptySectionState.tsx';
import { PromoCountdown } from './PromoCountdown.tsx';
import { ReviewsBlock } from './ReviewsBlock.tsx';

interface StoreSectionProps {
  products: StoreProduct[];
  cartIds: string[];
  unlockedMap: Record<string, PurchasedAccess>;
  guestUser: GuestUser | null;
  getGuestToken?: (forceRefresh?: boolean) => Promise<string | null>;
  isAdmin?: boolean;
  getAdminToken?: (forceRefresh?: boolean) => Promise<string | null>;
  onOpenAuthModal: () => void;
  onAddToCart: (productId: string) => void;
  onOpenLibrary: () => void;
  onProductUpdated: (product: StoreProduct) => void;
  initialProductId?: string | null;
  onActiveProductChange?: (productId: string | null) => void;
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
      return 'Скляна антирамка';
    case 'painting':
      return 'Оригінальна картина';
  }
}

type StoreViewColumns = 1 | 2 | 3;

const STORE_VIEW_STORAGE_KEY = 'dankiv_store_view_columns';

function getInitialStoreViewColumns(): StoreViewColumns {
  if (typeof window === 'undefined') return 3;
  try {
    const saved = window.localStorage.getItem(STORE_VIEW_STORAGE_KEY);
    if (saved === '1' || saved === '2' || saved === '3') {
      return Number(saved) as StoreViewColumns;
    }
  } catch {
    // Ignore storage read issues
  }
  return window.innerWidth < 640 ? 2 : 3;
}

function ColumnsLayoutIcon({ columns }: { columns: StoreViewColumns }) {
  if (columns === 1) {
    return (
      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  if (columns === 2) {
    return (
      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.75" y="2.5" width="5.25" height="11" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
        <rect x="9" y="2.5" width="5.25" height="11" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="3.3" height="11" rx="1" stroke="currentColor" strokeWidth="1.35" />
      <rect x="6.35" y="2.5" width="3.3" height="11" rx="1" stroke="currentColor" strokeWidth="1.35" />
      <rect x="11.2" y="2.5" width="3.3" height="11" rx="1" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}

const StoreProductCard = memo(function StoreProductCard({
  product,
  index,
  isInCart,
  unlocked,
  viewColumns,
  touchProps,
  isTouchActive,
  onOpenProduct,
  onOpenLibrary,
  onAddToCart,
}: {
  product: StoreProduct;
  index: number;
  isInCart: boolean;
  unlocked: boolean;
  viewColumns: StoreViewColumns;
  touchProps: Record<string, unknown>;
  isTouchActive: boolean;
  onOpenProduct: (product: StoreProduct) => void;
  onOpenLibrary: () => void;
  onAddToCart: (productId: string) => void;
}) {
  const isPhysical = isPhysicalProduct(product.type);
  const basePriceUah = Math.max(0, Math.round(Number(product.priceUah) || 0));
  const finalPriceUah = getEffectivePriceUah(product);
  const discountPct = Math.max(0, Math.min(90, Math.round(Number(product.discountPercent) || 0)));
  const hasCatalogDiscount = discountPct > 0 && finalPriceUah < basePriceUah;
  const parsedPromo = parseStoreProductPromo(product);
  const promoText = product.promoActive
    ? parsedPromo.cleanPromoLabel || (!parsedPromo.isBestseller && !hasCatalogDiscount ? 'Акція' : '')
    : '';
  const hasFutureCountdown = Boolean(
    product.promoActive &&
      parsedPromo.promoEndsAt &&
      Number.isFinite(Date.parse(parsedPromo.promoEndsAt)) &&
      Date.parse(parsedPromo.promoEndsAt) > Date.now()
  );
  const hasPromoBadge =
    parsedPromo.isBestseller || Boolean(promoText) || hasCatalogDiscount || hasFutureCountdown;
  const isSingle = viewColumns === 1;
  const isCompactThree = viewColumns === 3;

  return (
    <m.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, delay: Math.min(index * 0.025, 0.1), ease: [0.16, 1, 0.3, 1] }}
      className="perf-card"
    >
      <div
        {...touchProps}
        data-touch-active={isTouchActive ? 'true' : undefined}
        className={`touch-card h-full bg-white dark:bg-night-card rounded-xl overflow-hidden flex flex-col ${
          isSingle ? 'sm:flex-row' : 'justify-between'
        } transition-colors duration-200`}
      >
        <button
          type="button"
          onClick={() => onOpenProduct(product)}
          className={`relative block text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-pine dark:focus-visible:outline-silver ${
            isSingle ? 'w-full sm:w-[44%] sm:shrink-0' : 'w-full'
          }`}
          aria-label={`Детальніше про ${product.title}`}
        >
          <EditorialImage
            src={product.coverImage}
            alt={product.title}
            titleFallback={product.title}
            aspectClassName={isSingle ? 'aspect-[4/3] sm:h-full' : 'aspect-[4/3]'}
            className="h-full"
            priority={index < 3}
          />
          {hasPromoBadge && (
            <div
              className={`absolute flex flex-wrap items-center gap-1 pointer-events-none ${
                isCompactThree ? 'top-1.5 left-1.5 right-1.5' : 'top-2.5 left-2.5 right-2.5 gap-1.5'
              }`}
            >
              {parsedPromo.isBestseller && (
                <span
                  className={`inline-flex items-center gap-1 rounded-md bg-[#2A2012]/95 text-[#F7DF9C] font-semibold tracking-wide shadow-sm ${
                    isCompactThree ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'
                  }`}
                >
                  <Award className="w-2.5 h-2.5 shrink-0" strokeWidth={2.2} />
                  <span>Бестселлер</span>
                </span>
              )}
              {promoText && (
                <span
                  className={`inline-flex items-center gap-1 rounded-md bg-pine-dark/95 dark:bg-night-surface/95 text-[#E8F1C8] dark:text-cream font-semibold tracking-wide shadow-sm max-w-full truncate ${
                    isCompactThree ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'
                  }`}
                >
                  <Tag className="w-2.5 h-2.5 shrink-0" strokeWidth={2.2} />
                  <span className="truncate">{promoText}</span>
                </span>
              )}
              {hasCatalogDiscount && (
                <span
                  className={`inline-flex items-center rounded-md bg-[#BCD369] text-[#122218] dark:bg-silver dark:text-night font-mono font-bold tabular-nums shadow-sm ${
                    isCompactThree ? 'px-1 py-0.5 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'
                  }`}
                >
                  −{discountPct}%
                </span>
              )}
              {hasFutureCountdown && (
                <PromoCountdown
                  endsAtIso={parsedPromo.promoEndsAt}
                  variant="card"
                  isCompact={isCompactThree}
                />
              )}
            </div>
          )}
        </button>

        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div className={isSingle ? 'p-4 sm:p-5 space-y-1.5' : isCompactThree ? 'p-2 sm:p-3.5 space-y-1' : 'p-3 sm:p-3.5 space-y-1'}>
            <div className="flex items-center justify-between gap-1.5 text-[11px] text-ink-muted dark:text-sandstone-light">
              <span className="truncate">{getTypeLabel(product.type)}</span>

              {product.ratingCount > 0 && (
                <span className="inline-flex items-center gap-0.5 font-mono text-ink dark:text-cream tabular-nums shrink-0">
                  <Star className="w-3 h-3 fill-[#FACC15] text-[#EAB308]" strokeWidth={1.75} />
                  <span>{product.ratingAverage.toFixed(1)}</span>
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => onOpenProduct(product)}
              className="w-full text-left cursor-pointer"
            >
              <h3
                className={`font-serif font-semibold text-ink dark:text-cream hover:text-pine dark:hover:text-[#FFFFFF] leading-snug line-clamp-2 transition-colors duration-150 ${
                  isSingle
                    ? 'text-lg sm:text-xl'
                    : isCompactThree
                      ? 'text-xs sm:text-base'
                      : 'text-base sm:text-lg'
                }`}
              >
                {product.title}
              </h3>
            </button>

            {product.subtitle && (
              <p className="text-[11px] text-ink-muted dark:text-sandstone-light truncate">
                {product.subtitle}
              </p>
            )}

            {isSingle && product.description && (
              <p className="pt-1 text-xs sm:text-sm text-[#444440] dark:text-parchment leading-relaxed line-clamp-2">
                {product.description}
              </p>
            )}
          </div>

          {/* Compact Price + Action Row Below Details */}
          <div
            className={`flex justify-between gap-2 ${
              isSingle
                ? 'px-4 sm:px-5 py-3 items-center'
                : isCompactThree
                  ? 'px-2 sm:px-3.5 py-2 sm:py-2.5 flex-col items-stretch sm:flex-row sm:items-center gap-1.5 sm:gap-2'
                  : 'px-3 sm:px-3.5 py-2.5 items-center'
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono tabular-nums min-w-0">
              <span
                className={`font-semibold text-ink dark:text-cream whitespace-nowrap ${
                  isSingle ? 'text-base' : isCompactThree ? 'text-xs sm:text-sm' : 'text-sm'
                }`}
              >
                {finalPriceUah} ₴
              </span>
              {hasCatalogDiscount && (
                <>
                  <span className="text-[11px] text-ink-muted dark:text-stone-warm line-through whitespace-nowrap">
                    {basePriceUah} ₴
                  </span>
                  {!promoText && (
                    <span className="text-[10px] font-semibold text-pine-deep dark:text-silver whitespace-nowrap">
                      −{discountPct}%
                    </span>
                  )}
                </>
              )}
            </div>

            {unlocked && !isPhysical ? (
              <button
                type="button"
                data-card-action="true"
                onClick={onOpenLibrary}
                className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-pine-deep hover:bg-pine-deep dark:bg-night-soft dark:hover:bg-[#444444] active:scale-[0.96] rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                  isCompactThree ? 'w-full sm:w-auto' : ''
                }`}
              >
                <ExternalLink className="w-3 h-3" strokeWidth={1.8} />
                <span>Відкрити</span>
              </button>
            ) : isInCart ? (
              <button
                type="button"
                data-card-action="true"
                onClick={onOpenLibrary}
                className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-ink dark:text-cream bg-paper-warm dark:bg-night-elevated hover:bg-paper-sand dark:hover:bg-night-muted active:scale-[0.96] rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                  isCompactThree ? 'w-full sm:w-auto' : ''
                }`}
              >
                <Check className="w-3 h-3 text-pine-deep dark:text-silver" strokeWidth={2} />
                <span>У кошику</span>
              </button>
            ) : (
              <button
                type="button"
                data-card-action="true"
                onClick={() => onAddToCart(product.id)}
                className={`btn-editorial-primary px-2 py-1 text-[11px] rounded-lg shrink-0 ${
                  isCompactThree ? 'w-full sm:w-auto' : ''
                }`}
              >
                <span>{isPhysical ? 'Замовити' : 'Придбати'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </m.article>
  );
});

export const StoreSection = memo(function StoreSection({
  products,
  cartIds,
  unlockedMap,
  guestUser,
  getGuestToken,
  isAdmin = false,
  getAdminToken,
  onOpenAuthModal,
  onAddToCart,
  onOpenLibrary,
  onProductUpdated,
  initialProductId,
  onActiveProductChange,
}: StoreSectionProps) {
  const [inspectProductId, setInspectProductId] = useState<string | null>(null);
  const [viewColumns, setViewColumns] = useState<StoreViewColumns>(getInitialStoreViewColumns);
  const handledDeepLinkRef = useRef<string | null>(null);
  const { getTouchProps, isTouchActive } = useTouchFeedback();

  useEffect(() => {
    if (!initialProductId) {
      handledDeepLinkRef.current = null;
      return;
    }
    if (handledDeepLinkRef.current === initialProductId) return;
    const matched = products.find((p) => p.id === initialProductId);
    if (matched) {
      handledDeepLinkRef.current = initialProductId;
      setInspectProductId(matched.id);
    }
  }, [initialProductId, products]);

  const handleOpenProduct = (product: StoreProduct) => {
    trackClick(`product:${product.id}`, `Перегляд позиції: «${product.title}»`, 'store');
    handledDeepLinkRef.current = product.id;
    setInspectProductId(product.id);
    onActiveProductChange?.(product.id);
  };

  const handleCloseProduct = () => {
    handledDeepLinkRef.current = null;
    setInspectProductId(null);
    onActiveProductChange?.(null);
  };

  const handleChangeViewColumns = (cols: StoreViewColumns) => {
    setViewColumns(cols);
    try {
      window.localStorage.setItem(STORE_VIEW_STORAGE_KEY, String(cols));
    } catch {
      // Ignore storage write issues
    }
  };

  const inspectProduct = useMemo(
    () => products.find((p) => p.id === inspectProductId) || null,
    [products, inspectProductId]
  );

  useEffect(() => {
    if (!inspectProduct) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseProduct();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inspectProduct]);

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

  const gridClassName =
    viewColumns === 1
      ? 'grid grid-cols-1 gap-4 sm:gap-5'
      : viewColumns === 2
        ? 'grid grid-cols-2 gap-3.5 sm:gap-5'
        : 'grid grid-cols-3 gap-2 sm:gap-4';

  return (
    <section id="store">
      <div>
        <h2 className="sr-only">Крамниця</h2>

        {products.length > 0 && (
          <div className="mb-4 flex items-center justify-end gap-2.5">
            <span className="text-xs font-medium text-ink-muted dark:text-sandstone-light">
              Перегляд
            </span>
            <div
              role="group"
              aria-label="Перегляд сітки товарів"
              className="inline-flex items-center gap-1 p-1 rounded-xl bg-paper-warm dark:bg-night-card"
            >
              {(
                [
                  { cols: 1, title: 'По одній картці', label: '1' },
                  { cols: 2, title: '2 стовпці', label: '2' },
                  { cols: 3, title: '3 стовпці', label: '3' },
                ] as const
              ).map(({ cols, title, label }) => {
                const isActive = viewColumns === cols;
                return (
                  <button
                    key={cols}
                    type="button"
                    onClick={() => handleChangeViewColumns(cols)}
                    aria-label={title}
                    aria-pressed={isActive}
                    title={title}
                    className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isActive
                        ? 'bg-white dark:bg-night-elevated text-ink dark:text-cream shadow-xs'
                        : 'text-ink-muted dark:text-parchment hover:text-ink dark:hover:text-cream'
                    }`}
                  >
                    <ColumnsLayoutIcon columns={cols} />
                    <span className="font-mono tabular-nums">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Gallery Product Tiles */}
        {products.length === 0 ? (
          <EmptySectionState />
        ) : (
          <div className={gridClassName}>
            {products.map((product, index) => (
              <StoreProductCard
                key={product.id}
                product={product}
                index={index}
                isInCart={cartIds.includes(product.id)}
                unlocked={Boolean(unlockedMap[product.id])}
                viewColumns={viewColumns}
                touchProps={getTouchProps(product.id, '[data-card-action]')}
                isTouchActive={isTouchActive(product.id)}
                onOpenProduct={handleOpenProduct}
                onOpenLibrary={onOpenLibrary}
                onAddToCart={onAddToCart}
              />
            ))}
          </div>
        )}
      </div>

      {/* Product Detail, Excerpt & Reviews Modal */}
      <AnimatePresence>
        {inspectProduct && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-ink/55 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 md:p-6"
            onClick={handleCloseProduct}
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
          >
            <m.div
              initial={{ opacity: 0, scale: 0.97, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 12 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="bg-paper dark:bg-night-panel rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-xl will-change-transform text-ink dark:text-cream"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-1 md:grid-cols-12">
                <div className="md:col-span-5 bg-paper-warm dark:bg-night-card p-6 flex flex-col justify-between">
                  <EditorialImage
                    src={inspectProduct.coverImage}
                    alt={inspectProduct.title}
                    titleFallback={inspectProduct.title}
                    aspectClassName="aspect-[3/4]"
                    className="rounded-xl"
                  />

                  <div className="mt-5 pt-4 text-xs text-[#444440] dark:text-sandstone-light space-y-1.5">
                    {inspectProduct.type === 'wip_gdoc' && (
                      <>
                        <p className="font-semibold text-ink dark:text-cream">Формат: Google Документи</p>
                        <p className="tabular-nums">Статус: {inspectProduct.progressLabel}</p>
                      </>
                    )}
                    {inspectProduct.type === 'ebook' && (
                      <>
                        <p className="font-semibold text-ink dark:text-cream">Формати: {inspectProduct.formats}</p>
                        <p className="tabular-nums">Обсяг: {inspectProduct.pages} сторінок</p>
                      </>
                    )}
                    {inspectProduct.type === 'paper_book' && (
                      <>
                        <p className="font-semibold text-ink dark:text-cream">
                          {inspectProduct.binding || 'Тверда палітурка'}
                        </p>
                        <p className="tabular-nums">Обсяг: {inspectProduct.pages || 200} сторінок</p>
                      </>
                    )}
                    {inspectProduct.type === 'poem_frame' && (
                      <>
                        <p className="font-semibold text-ink dark:text-cream">Скляна антирамка</p>
                        <p>{inspectProduct.dimensions || '21 × 30 см (А4)'}</p>
                      </>
                    )}
                    {inspectProduct.type === 'painting' && (
                      <>
                        <p className="font-semibold text-ink dark:text-cream">Оригінальна картина</p>
                        {inspectProduct.dimensions && <p>{inspectProduct.dimensions}</p>}
                        {inspectProduct.material && <p>{inspectProduct.material}</p>}
                      </>
                    )}
                  </div>
                </div>

                <div className="md:col-span-7 p-6 md:p-8 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <p className="text-xs text-ink-muted dark:text-sandstone-light mb-1">{inspectProduct.subtitle}</p>
                        <h3
                          id="product-modal-title"
                          className="font-serif text-3xl font-semibold tracking-[-0.015em] text-ink dark:text-cream leading-tight"
                        >
                          {inspectProduct.title}
                        </h3>
                        {(() => {
                          const modalParsed = parseStoreProductPromo(inspectProduct);
                          const hasModalCountdown = Boolean(
                            inspectProduct.promoActive &&
                              modalParsed.promoEndsAt &&
                              Number.isFinite(Date.parse(modalParsed.promoEndsAt)) &&
                              Date.parse(modalParsed.promoEndsAt) > Date.now()
                          );
                          const modalPromoText = inspectProduct.promoActive
                            ? modalParsed.cleanPromoLabel ||
                              (!modalParsed.isBestseller && !(inspectProduct.discountPercent ?? 0)
                                ? 'Акційна пропозиція'
                                : '')
                            : '';
                          const hasAnyBadge =
                            modalParsed.isBestseller ||
                            Boolean(modalPromoText) ||
                            (inspectProduct.discountPercent ?? 0) > 0 ||
                            hasModalCountdown;
                          if (!hasAnyBadge) return null;
                          return (
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              {modalParsed.isBestseller && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#2A2012] text-[#F7DF9C] text-[11px] font-semibold">
                                  <Award className="w-3 h-3 shrink-0" strokeWidth={2} />
                                  <span>Бестселлер</span>
                                </span>
                              )}
                              {modalPromoText && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-pine-dark text-[#E8F1C8] dark:bg-night-elevated dark:text-cream text-[11px] font-semibold">
                                  <Tag className="w-3 h-3 shrink-0" strokeWidth={2} />
                                  <span>{modalPromoText}</span>
                                </span>
                              )}
                              {(inspectProduct.discountPercent ?? 0) > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#BCD369] text-[#122218] dark:bg-silver dark:text-night font-mono text-[11px] font-bold tabular-nums">
                                  −{Math.max(0, Math.min(90, Math.round(Number(inspectProduct.discountPercent) || 0)))}%
                                </span>
                              )}
                              {hasModalCountdown && (
                                <PromoCountdown
                                  endsAtIso={modalParsed.promoEndsAt}
                                  variant="modal"
                                />
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      <button
                        type="button"
                        onClick={handleCloseProduct}
                        className="w-9 h-9 inline-flex items-center justify-center text-ink-muted dark:text-sandstone-light hover:text-ink dark:hover:text-cream hover:bg-paper-warm dark:hover:bg-night-elevated active:scale-[0.96] rounded-lg transition-all duration-150 cursor-pointer shrink-0"
                        aria-label="Закрити вікно"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <p className="text-sm text-[#444440] dark:text-parchment leading-relaxed mb-6">
                      {inspectProduct.description}
                    </p>

                    <div className="p-5 bg-white dark:bg-night-card rounded-xl mb-6">
                      <p className="text-xs font-medium text-ink-muted dark:text-sandstone-light mb-2">Ознайомчий фрагмент</p>
                      <p className="font-serif text-lg italic text-ink dark:text-cream leading-relaxed">
                        {inspectProduct.sampleExcerpt}
                      </p>
                    </div>
                  </div>

                  <div className="pt-5 flex flex-wrap items-center justify-between gap-4 mb-6">
                    {(() => {
                      const modalBasePrice = Math.max(0, Math.round(Number(inspectProduct.priceUah) || 0));
                      const modalFinalPrice = getEffectivePriceUah(inspectProduct);
                      const modalDiscountPct = Math.max(
                        0,
                        Math.min(90, Math.round(Number(inspectProduct.discountPercent) || 0))
                      );
                      const hasModalDiscount = modalDiscountPct > 0 && modalFinalPrice < modalBasePrice;
                      return (
                        <div className="flex items-baseline gap-2.5 font-mono tabular-nums">
                          <span className="text-2xl font-semibold text-ink dark:text-cream">
                            {modalFinalPrice} ₴
                          </span>
                          {hasModalDiscount && (
                            <>
                              <span className="text-sm text-ink-muted dark:text-stone-warm line-through">
                                {modalBasePrice} ₴
                              </span>
                              <span className="text-xs font-semibold text-pine-deep dark:text-silver">
                                −{modalDiscountPct}%
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })()}

                    {unlockedMap[inspectProduct.id] && !isPhysicalProduct(inspectProduct.type) ? (
                      <button
                        type="button"
                        onClick={() => {
                          handleCloseProduct();
                          onOpenLibrary();
                        }}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-pine-deep hover:bg-pine-deep dark:bg-night-soft dark:hover:bg-[#444444] active:scale-[0.98] rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>Перейти до мого доступу</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onAddToCart(inspectProduct.id);
                          handleCloseProduct();
                        }}
                        className="btn-editorial-primary px-5 py-2.5"
                      >
                        <ShoppingBag className="w-4 h-4" strokeWidth={1.8} />
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

                  <ReviewsBlock
                    targetType="product"
                    targetId={inspectProduct.id}
                    ratingAverage={inspectProduct.ratingAverage}
                    ratingCount={inspectProduct.ratingCount}
                    reviews={inspectProduct.reviews}
                    guestUser={guestUser}
                    getGuestToken={getGuestToken}
                    isAdmin={isAdmin}
                    getAdminToken={getAdminToken}
                    onOpenAuthModal={onOpenAuthModal}
                    userHasRated={inspectProduct.userRating !== null}
                    userRatingValue={inspectProduct.userRating}
                    onReviewSubmitted={({ product }) => {
                      if (product) onProductUpdated(product);
                    }}
                  />
                </div>
              </div>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </section>
  );
});
