import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Lock,
  Package,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  getEffectivePriceUah,
  isPhysicalProduct,
  type GuestUser,
  type PurchasedAccess,
  type StoreProduct,
} from '../types.ts';
import { setActiveMoment, trackClick } from '../utils/analytics.ts';
import {
  buildMonobankJarPayUrl,
  createEncryptedPaymentEnvelope,
} from '../utils/paymentCrypto.ts';
import { EditorialImage } from './EditorialImage.tsx';

interface CartLibraryDrawerProps {
  isOpen: boolean;
  activeTab: 'cart' | 'library';
  onTabChange: (tab: 'cart' | 'library') => void;
  onClose: () => void;
  cartProducts: StoreProduct[];
  onRemoveFromCart: (productId: string) => void;
  onCheckoutSuccess: (unlocked: PurchasedAccess[], orderCode: string) => void;
  unlockedItems: PurchasedAccess[];
  guestUser?: GuestUser | null;
  getGuestToken?: () => Promise<string | null>;
  monobankJarUrl?: string;
  onOpenAuthModal?: () => void;
  onRestoreOrders: (restored: PurchasedAccess[]) => void;
  onClearDeviceLibrary?: () => void;
  onOpenProse?: (proseId: string) => void;
}

type CheckoutStep = 'review' | 'checkout' | 'monobank_jar';
type ShippingCarrier = 'nova_poshta';



function getCartItemTypeLabel(item: StoreProduct): string {
  switch (item.type) {
    case 'wip_gdoc':
      return item.progressLabel
        ? `Google Документ · ${item.progressLabel}`
        : 'Google Документ · Гостьовий доступ';
    case 'paper_book':
      return item.binding ? `Паперова книга · ${item.binding}` : 'Паперова книга · Доставка';
    case 'poem_frame':
      return item.dimensions
        ? `Скляна антирамка · ${item.dimensions}`
        : 'Скляна антирамка · Доставка';
    case 'painting':
      return item.dimensions
        ? `Оригінальна картина · ${item.dimensions}`
        : 'Оригінальна картина · Доставка';
    case 'ebook':
      return item.formats ? `Електронна книга · ${item.formats}` : 'Електронна книга';
  }
}

function formatUkCount(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return `${count} ${many}`;
  if (mod10 === 1) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

function getUnlockedTypeLabel(item: PurchasedAccess): string {
  switch (item.type) {
    case 'wip_gdoc':
      return 'Google Документ';
    case 'paper_book':
      return 'Паперова книга';
    case 'poem_frame':
      return 'Скляна антирамка';
    case 'painting':
      return 'Оригінальна картина';
    case 'prose_access':
      return 'Платна проза';
    case 'ebook':
      return 'Електронна книга';
  }
}

export function CartLibraryDrawer({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  cartProducts,
  onRemoveFromCart,
  onCheckoutSuccess,
  unlockedItems,
  guestUser = null,
  getGuestToken,
  monobankJarUrl = '',
  onOpenAuthModal: _onOpenAuthModal,
  onRestoreOrders,
  onClearDeviceLibrary,
  onOpenProse,
}: CartLibraryDrawerProps) {
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>('review');
  const scrollBodyRef = useRef<HTMLDivElement>(null);

  const [buyerName, setBuyerName] = useState(guestUser?.displayName || '');
  const [buyerEmail, setBuyerEmail] = useState(guestUser?.email || '');

  // Physical shipping fields (Nova Poshta only)
  const [phone, setPhone] = useState('');
  const carrier: ShippingCarrier = 'nova_poshta';
  const [city, setCity] = useState('');
  const [addressOrBranch, setAddressOrBranch] = useState('');
  const [deliveryComment, setDeliveryComment] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastOrderCode, setLastOrderCode] = useState<string | null>(null);
  const [copiedUrlId, setCopiedUrlId] = useState<string | null>(null);
  const [copiedJarField, setCopiedJarField] = useState<'url' | 'comment' | null>(null);

  const [restoreQuery, setRestoreQuery] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [confirmClearDevice, setConfirmClearDevice] = useState(false);
  const [deviceClearedNotice, setDeviceClearedNotice] = useState(false);

  const safeMonobankJarUrl = useMemo(() => {
    const trimmed = monobankJarUrl.trim();
    return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : '';
  }, [monobankJarUrl]);

  const {
    totalUah,
    originalTotalUah,
    catalogSavingsUah,
    savingsUah,
    hasPhysicalItems,
    hasDigitalItems,
  } = useMemo(() => {
    let total = 0;
    let original = 0;
    let physical = false;
    let digital = false;

    for (const p of cartProducts) {
      const base = Math.max(0, Math.round(Number(p.priceUah) || 0));
      const final = getEffectivePriceUah(p);
      total += final;
      original += base;
      if (isPhysicalProduct(p.type)) {
        physical = true;
      } else {
        digital = true;
      }
    }

    const savings = Math.max(0, original - total);
    return {
      totalUah: total,
      originalTotalUah: original,
      catalogSavingsUah: savings,
      savingsUah: savings,
      hasPhysicalItems: physical,
      hasDigitalItems: digital,
    };
  }, [cartProducts]);

  // Reset to cart review when cart empties or drawer closes
  useEffect(() => {
    if (cartProducts.length === 0 && checkoutStep !=='review') {
      setCheckoutStep('review');
    }
  }, [cartProducts.length, checkoutStep]);

  useEffect(() => {
    if (!isOpen) {
      setCheckoutStep('review');
      setErrorMsg(null);
      setCopiedJarField(null);
      setConfirmClearDevice(false);
      setDeviceClearedNotice(false);
      return;
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow ='hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key ==='Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (guestUser) {
      setBuyerName((prev) => prev || guestUser.displayName);
      setBuyerEmail((prev) => prev || guestUser.email);
    }
  }, [guestUser]);

  useEffect(() => {
    if (scrollBodyRef.current) {
      scrollBodyRef.current.scrollTop = 0;
    }
  }, [activeTab, checkoutStep]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab ==='cart') {
      setActiveMoment({
        targetKey:'store:checkout',
        momentKey:'store:checkout',
        label:
          checkoutStep === 'review'
            ? 'Крамниця: Кошик'
            : 'Крамниця: Оформлення оплати',
        category:'section',
        section:'store',
      });
    } else {
      setActiveMoment({
        targetKey:'store:library',
        momentKey:'store:library',
        label:'Крамниця: Мої придбання',
        category:'section',
        section:'store',
      });
    }
  }, [isOpen, activeTab, checkoutStep]);

  const handleCopyJarField = async (value: string, field: 'url' | 'comment') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedJarField(field);
      window.setTimeout(() => setCopiedJarField((prev) => (prev === field ? null : prev)), 2200);
    } catch {
      // Ignore if clipboard unavailable
    }
  };

  const jarPaymentComment = useMemo(() => {
    const cleanEmail = buyerEmail.trim();
    return cleanEmail ? `Замовлення · ${cleanEmail}` : 'Замовлення у крамниці';
  }, [buyerEmail]);

  const jarPayUrl = useMemo(() => {
    if (!safeMonobankJarUrl) return '';
    return buildMonobankJarPayUrl(safeMonobankJarUrl, totalUah, jarPaymentComment);
  }, [safeMonobankJarUrl, totalUah, jarPaymentComment]);

  const executeStoreMonobankOrder = async () => {
    if (cartProducts.length === 0) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const authToken = getGuestToken ? await getGuestToken() : null;
      const sealed = await createEncryptedPaymentEnvelope({
        kind: 'store',
        productIds: cartProducts.map((p) => p.id),
        method: 'monobank',
        buyerName,
        buyerEmail,
        authToken,
        shipping: hasPhysicalItems
          ? {
              recipientName: buyerName,
              phone,
              carrier,
              city,
              addressOrBranch,
              comment: deliveryComment || undefined,
            }
          : undefined,
      });

      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          productIds: cartProducts.map((p) => p.id),
          encryptedPayment: sealed.envelope,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setErrorMsg(data.error || 'Не вдалося оформити замовлення.');
        return;
      }

      setLastOrderCode(data.order.orderCode);
      onCheckoutSuccess(data.order.items, data.order.orderCode);
      setCheckoutStep('review');
      onTabChange('library');
      setBuyerName('');
      setBuyerEmail('');
      setPhone('');
      setCity('');
      setAddressOrBranch('');
      setDeliveryComment('');
    } catch (err) {
      setErrorMsg(err instanceof Error && err.message ? err.message : 'Помилка з’єднання із сервером.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckout = async (e: FormEvent) => {
    e.preventDefault();
    if (cartProducts.length === 0) return;
    trackClick('action:checkout_submit', 'Оформлення й оплата замовлення через Монобанк', 'store');
    setErrorMsg(null);

    if (buyerName.trim().length < 2 || !buyerEmail.includes('@')) {
      setErrorMsg('Вкажіть ім’я отримувача та дійсний email.');
      return;
    }

    if (hasPhysicalItems) {
      if (phone.replace(/\D/g, '').length < 9 || city.trim().length < 2 || addressOrBranch.trim().length < 3) {
        setErrorMsg('Будь ласка, вкажіть коректний номер телефону, місто та відділення або поштомат Нової Пошти.');
        return;
      }
    }

    if (safeMonobankJarUrl) {
      setCheckoutStep('monobank_jar');
      return;
    }

    await executeStoreMonobankOrder();
  };

  const handleCopyGdocLink = async (productId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrlId(productId);
      setTimeout(() => setCopiedUrlId(null), 2200);
    } catch {
      // Ignore if clipboard unavailable
    }
  };

  const handleRestore = async (e: FormEvent) => {
    e.preventDefault();
    if (!restoreQuery.trim()) return;
    setRestoring(true);
    setRestoreStatus(null);
    try {
      const response = await fetch('/api/orders/restore', {
        method:'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ query: restoreQuery }),
      });
      const data = await response.json();
      if (!response.ok) {
        setRestoreStatus({ ok: false, text: data.error ||'Не вдалося знайти покупки.'});
        return;
      }
      if (data.items.length === 0) {
        setRestoreStatus({ ok: false, text:'За цим email або кодом замовлень не знайдено.'});
      } else {
        onRestoreOrders(data.items);
        setRestoreStatus({ ok: true, text:`Відновлено доступ до ${data.items.length} позицій.`});
        setRestoreQuery('');
      }
    } catch {
      setRestoreStatus({ ok: false, text:'Помилка з’єднання із сервером.'});
    } finally {
      setRestoring(false);
    }
  };

  const deliveryExpectationText =
    hasPhysicalItems && hasDigitalItems
      ? 'Електронний доступ відкриється одразу · паперові видання відправляються Новою Поштою'
      : hasPhysicalItems
        ? 'Відправка виключно Новою Поштою (у відділення або поштомат)'
        : 'Миттєвий доступ до файлів і посилань одразу після оплати';

  return (
    <AnimatePresence>
      {isOpen && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 bg-[#141413]/45 dark:bg-black/70 backdrop-blur-xs flex justify-end"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Кошик та придбані видання"
        >
          <m.aside
            initial={{ x:'100%'}}
            animate={{ x: 0 }}
            exit={{ x:'100%'}}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="bg-[#F7F6F2] dark:bg-[#181818] w-full sm:max-w-[500px] h-full flex flex-col shadow-2xl will-change-transform text-[#141413] dark:text-[#F4F1EA]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Pinned Drawer Header */}
            <header className="px-5 sm:px-6 pt-4 pb-3.5 bg-white dark:bg-[#202020] shrink-0 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 bg-[#ECE9E1] dark:bg-[#262626] rounded-xl min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      onTabChange('cart');
                      setErrorMsg(null);
                    }}
                    className={`min-h-[40px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 whitespace-nowrap cursor-pointer tabular-nums ${
                      activeTab ==='cart'
                        ?'bg-white dark:bg-[#323232] text-[#141413] dark:text-[#F4F1EA] shadow-xs'
                        :'text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
                    }`}
                  >
                    Кошик ({cartProducts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onTabChange('library');
                      setErrorMsg(null);
                    }}
                    className={`min-h-[40px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 whitespace-nowrap cursor-pointer tabular-nums ${
                      activeTab ==='library'
                        ?'bg-white dark:bg-[#323232] text-[#141413] dark:text-[#F4F1EA] shadow-xs'
                        :'text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-[#F4F1EA]'
                    }`}
                  >
                    Придбання ({unlockedItems.length})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  className="w-11 h-11 sm:w-10 sm:h-10 -mr-1.5 inline-flex items-center justify-center text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#141413] dark:hover:text-[#F4F1EA] hover:bg-[#EFECE6] dark:hover:bg-[#323232] active:scale-[0.95] rounded-xl transition-all duration-150 cursor-pointer shrink-0"
                  aria-label="Закрити панель кошика"
                >
                  <X className="w-5 h-5"/>
                </button>
              </div>

              {/* Contextual Step Bar inside Cart tab when items exist */}
              {activeTab ==='cart'&& cartProducts.length > 0 && (
                <div className="flex items-center justify-between gap-3 pt-1 text-xs">
                  {checkoutStep === 'monobank_jar' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCheckoutStep('checkout');
                        setErrorMsg(null);
                      }}
                      className="inline-flex items-center gap-1.5 min-h-[32px] -ml-1.5 px-1.5 text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#2C5937] dark:hover:text-white font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 shrink-0" strokeWidth={1.85} />
                      <span>Назад до даних доставки</span>
                    </button>
                  ) : checkoutStep ==='checkout'? (
                    <button
                      type="button"
                      onClick={() => {
                        setCheckoutStep('review');
                        setErrorMsg(null);
                      }}
                      className="inline-flex items-center gap-1.5 min-h-[32px] -ml-1.5 px-1.5 text-[#5C5C58] dark:text-[#A8A49B] hover:text-[#2C5937] dark:hover:text-white font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 shrink-0"strokeWidth={1.85} />
                      <span>Назад до кошика</span>
                    </button>
                  ) : (
                    <span className="text-[#5C5C58] dark:text-[#A8A49B] font-medium">
                      Крок 1 з 2 · Перевірка замовлення
                    </span>
                  )}

                  <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-[#5C5C58] dark:text-[#A8A49B] shrink-0">
                    <span
                      className={
                        checkoutStep ==='review'
                          ?'text-[#141413] dark:text-[#F4F1EA] font-semibold'
                          :''
                      }
                    >
                      01 Кошик
                    </span>
                    <span aria-hidden="true">/</span>
                    <span
                      className={
                        checkoutStep !=='review'
                          ?'text-[#2C5937] dark:text-[#E5E5E5] font-semibold'
                          :''
                      }
                    >
                      02 Оплата
                    </span>
                  </div>
                </div>
              )}
            </header>

            {/* Independent Scrollable Drawer Body */}
            <div ref={scrollBodyRef} className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5">
              {activeTab ==='cart'? (
                cartProducts.length === 0 ? (
                  /* Empty Cart State */
                  <div className="py-12 sm:py-16 flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-2xl bg-[#EFECE6] dark:bg-[#262626] flex items-center justify-center text-[#5C5C58] dark:text-[#A8A49B] mb-4">
                      <ShoppingBag className="w-5 h-5"strokeWidth={1.65} />
                    </div>
                    <h3 className="font-serif text-2xl font-semibold text-[#141413] dark:text-[#F4F1EA] mb-2">
                      Ваш кошик порожній
                    </h3>
                    <p className="text-sm text-[#5C5C58] dark:text-[#A8A49B] max-w-xs leading-relaxed mb-6">
                      Оберіть електронну чи паперову книгу, «Тіло вірша» в антирамці або гостьовий доступ до роману.
                    </p>

                    <div className="flex flex-wrap items-center justify-center gap-2.5">
                      <button
                        type="button"
                        onClick={onClose}
                        className="btn-editorial-primary min-h-[44px] px-5 py-2.5 text-xs"
                      >
                        <span>Переглянути видання</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onTabChange('library')}
                        className="btn-editorial-secondary min-h-[44px] px-4 py-2.5 text-xs"
                      >
                        <span>Мої придбання</span>
                      </button>
                    </div>
                  </div>
                ) : checkoutStep ==='review'? (
                  /* STEP 1: Clean Cart Items Review */
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <AnimatePresence initial={false}>
                        {cartProducts.map((item) => {
                          const basePrice = Math.max(0, Math.round(Number(item.priceUah) || 0));
                          const finalPrice = getEffectivePriceUah(item);
                          const hasDiscount = finalPrice < basePrice;
                          const itemSavings = basePrice - finalPrice;

                          return (
                            <m.div
                              key={item.id}
                              layout
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, x: 24, transition: { duration: 0.16 } }}
                              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                              className="p-3.5 bg-white dark:bg-[#262626] rounded-xl flex items-start gap-3.5"
                            >
                              <div className="w-16 shrink-0 rounded-lg overflow-hidden">
                                <EditorialImage
                                  src={item.coverImage}
                                  alt={item.title}
                                  titleFallback={item.title}
                                  aspectClassName="aspect-[3/4]"
                                />
                              </div>

                              <div className="flex-1 min-w-0 pt-0.5">
                                <p className="text-[11px] text-[#5C5C58] dark:text-[#A8A49B] truncate mb-0.5">
                                  {getCartItemTypeLabel(item)}
                                </p>
                                <h4 className="font-serif text-lg font-semibold text-[#141413] dark:text-[#F4F1EA] leading-snug line-clamp-2">
                                  {item.title}
                                </h4>

                                <div className="flex flex-wrap items-baseline gap-2 font-mono tabular-nums mt-2">
                                  <span className="text-sm font-semibold text-[#141413] dark:text-[#F4F1EA]">
                                    {finalPrice} ₴
                                  </span>
                                  {hasDiscount && (
                                    <>
                                      <span className="text-xs text-[#5C5C58] dark:text-[#8D8980] line-through">
                                        {basePrice} ₴
                                      </span>
                                      <span className="text-[11px] font-medium text-[#2C5937] dark:text-[#E5E5E5]">
                                        −{itemSavings} ₴
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => onRemoveFromCart(item.id)}
                                className="w-11 h-11 sm:w-10 sm:h-10 -mr-1.5 inline-flex items-center justify-center text-[#5C5C58] dark:text-[#A8A49B] hover:text-rose-700 dark:hover:text-rose-400 hover:bg-[#EFECE6] dark:hover:bg-[#323232] active:scale-[0.94] rounded-lg transition-all duration-150 cursor-pointer shrink-0"
                                aria-label={`Видалити ${item.title} з кошика`}
                                title="Видалити позицію"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </m.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>

                    {/* Transparent Delivery & Order Expectation Note */}
                    <div className="pt-4 space-y-2.5 text-xs text-[#5C5C58] dark:text-[#A8A49B]">
                      <div className="flex items-start gap-2.5">
                        {hasPhysicalItems ? (
                          <Truck className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5] shrink-0 mt-0.5" strokeWidth={1.75} />
                        ) : (
                          <Sparkles className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5] shrink-0 mt-0.5" strokeWidth={1.75} />
                        )}
                        <p className="leading-relaxed">{deliveryExpectationText}</p>
                      </div>

                      {catalogSavingsUah > 0 && (
                        <div className="flex items-center justify-between pt-1 font-mono tabular-nums text-[#141413] dark:text-[#F4F1EA]">
                          <span className="font-sans text-[#5C5C58] dark:text-[#A8A49B]">Знижка на акційні товари</span>
                          <span className="text-[#2C5937] dark:text-[#E5E5E5] font-medium">−{catalogSavingsUah} ₴</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : checkoutStep === 'monobank_jar' ? (
                  /* STEP 2B: Monobank Jar Payment Confirmation */
                  <div className="space-y-5">
                    <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-[#262626] space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#141413] dark:text-[#F4F1EA]">
                          Оплата на банку Монобанку
                        </span>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141413] text-white text-[11px] font-semibold font-mono tabular-nums">
                          {totalUah} ₴
                        </span>
                      </div>

                      <p className="text-xs text-[#5C5C58] dark:text-[#A8A49B] leading-relaxed">
                        Перейдіть до банки Монобанку (та ж банка, що й у розділі підтримки) та перекажіть{' '}
                        <strong className="font-mono text-[#141413] dark:text-[#F4F1EA]">
                          {totalUah} ₴
                        </strong>
                        . У призначенні вкажіть коментар нижче, а після оплати натисніть кнопку підтвердження внизу.
                      </p>

                      <div className="px-3 py-2.5 rounded-lg bg-[#F5F3EE] dark:bg-[#1E1E1E] flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="block text-[10px] text-[#5C5C58] dark:text-[#C4BFB4]">
                            Коментар до переказу
                          </span>
                          <span className="block text-xs font-mono text-[#141413] dark:text-[#F4F1EA] truncate">
                            {jarPaymentComment}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyJarField(jarPaymentComment, 'comment')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-white dark:bg-[#2E2E2E] text-[#141413] dark:text-[#F4F1EA] hover:opacity-85 shrink-0 cursor-pointer"
                        >
                          {copiedJarField === 'comment' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-[#2C5937] dark:text-[#6EE7B7]" />
                              <span>Скопійовано</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Копіювати</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="space-y-2.5 pt-1">
                        <a
                          href={jarPayUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full inline-flex items-center justify-center gap-2 min-h-[46px] px-5 py-2.5 rounded-xl bg-[#141413] dark:bg-white text-white dark:text-[#141413] text-xs sm:text-sm font-semibold hover:opacity-92 transition-opacity"
                        >
                          <span>Відкрити банку Монобанку · {totalUah} ₴</span>
                          <ExternalLink className="w-4 h-4 shrink-0" />
                        </a>

                        <button
                          type="button"
                          onClick={() => handleCopyJarField(safeMonobankJarUrl, 'url')}
                          className="w-full inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl bg-[#EFECE6] dark:bg-[#323232] text-xs font-medium text-[#141413] dark:text-[#F4F1EA] hover:opacity-90 cursor-pointer"
                        >
                          {copiedJarField === 'url' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-[#2C5937] dark:text-[#6EE7B7]" />
                              <span>Посилання на банку скопійовано</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Скопіювати посилання на банку</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* STEP 2: Clean Structured Checkout Form */
                  <form id="checkout-form" onSubmit={handleCheckout} className="space-y-6">
                    {/* Compact Itemized Context Strip (non-boxed) */}
                    <div className="pb-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#141413] dark:text-[#F4F1EA] truncate">
                          {cartProducts.map((p) => p.title).join(', ')}
                        </p>
                        <p className="text-[11px] text-[#5C5C58] dark:text-[#A8A49B] mt-0.5 tabular-nums">
                          {formatUkCount(cartProducts.length,'позиція','позиції','позицій')}
                          {hasPhysicalItems ?' · Нова Пошта':' · Цифровий доступ'}
                        </p>
                      </div>
                      <span className="font-mono text-base font-semibold text-[#141413] dark:text-[#F4F1EA] tabular-nums shrink-0">
                        {totalUah} ₴
                      </span>
                    </div>

                    {/* Section 01: Recipient Contact */}
                    <fieldset className="space-y-3.5">
                      <legend className="text-xs font-semibold text-[#141413] dark:text-[#F4F1EA] tracking-[0.01em] mb-1">
                        01. Дані отримувача
                      </legend>

                      <div>
                        <label htmlFor="buyer-name"className="block text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] mb-1.5">
                          Ім’я та прізвище
                        </label>
                        <input
                          id="buyer-name"
                          type="text"
                          required
                          autoComplete="name"
                          value={buyerName}
                          onChange={(e) => setBuyerName(e.target.value)}
                          placeholder="Олена Ковальчук"
                          className="input-editorial min-h-[44px]"
                        />
                      </div>

                      <div>
                        <label htmlFor="buyer-email"className="block text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] mb-1.5">
                          Email для квитанції та доступу
                        </label>
                        <input
                          id="buyer-email"
                          type="email"
                          required
                          autoComplete="email"
                          value={buyerEmail}
                          onChange={(e) => setBuyerEmail(e.target.value)}
                          placeholder="reader@example.com"
                          className="input-editorial min-h-[44px]"
                        />
                      </div>
                    </fieldset>

                    {/* Section 02: Physical Shipping (Nova Poshta Only) */}
                    {hasPhysicalItems && (
                      <fieldset className="pt-5 space-y-3.5">
                        <legend className="flex items-center gap-2 text-xs font-semibold text-[#141413] dark:text-[#F4F1EA] tracking-[0.01em]">
                          <span>02. Доставка Новою Поштою</span>
                        </legend>

                        <div className="px-3.5 py-2.5 rounded-xl bg-[#EFECE6] dark:bg-[#262626] flex items-center justify-between gap-2 text-xs">
                          <span className="inline-flex items-center gap-2 font-semibold text-[#141413] dark:text-[#F4F1EA]">
                            <Truck className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5] shrink-0" strokeWidth={1.75} />
                            <span>Нова Пошта</span>
                          </span>
                          <span className="text-[11px] text-[#5C5C58] dark:text-[#A8A49B]">
                            Відділення або поштомат
                          </span>
                        </div>

                        <div>
                          <label htmlFor="ship-phone"className="block text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] mb-1.5">
                            Контактний телефон
                          </label>
                          <input
                            id="ship-phone"
                            type="tel"
                            required
                            autoComplete="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="+380 67 123 45 67"
                            className="input-editorial min-h-[44px] font-mono"
                          />
                        </div>

                        <div>
                          <label htmlFor="ship-city"className="block text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] mb-1.5">
                            Місто / населений пункт
                          </label>
                          <input
                            id="ship-city"
                            type="text"
                            required
                            autoComplete="address-level2"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            placeholder="Львів"
                            className="input-editorial min-h-[44px]"
                          />
                        </div>

                        <div>
                          <label htmlFor="ship-address"className="block text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] mb-1.5">
                            Номер відділення або поштомату Нової Пошти
                          </label>
                          <input
                            id="ship-address"
                            type="text"
                            required
                            autoComplete="street-address"
                            value={addressOrBranch}
                            onChange={(e) => setAddressOrBranch(e.target.value)}
                            placeholder="Відділення №12 або поштомат №..."
                            className="input-editorial min-h-[44px]"
                          />
                        </div>

                        <div>
                          <label htmlFor="ship-comment"className="block text-xs font-medium text-[#5C5C58] dark:text-[#A8A49B] mb-1.5">
                            Автограф або побажання (необов’язково)
                          </label>
                          <input
                            id="ship-comment"
                            type="text"
                            value={deliveryComment}
                            onChange={(e) => setDeliveryComment(e.target.value)}
                            placeholder="Наприклад: підписати для Олени"
                            className="input-editorial min-h-[44px]"
                          />
                        </div>
                      </fieldset>
                    )}

                    {/* Section 02/03: Monobank-Only Payment */}
                    <fieldset className="pt-5 space-y-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <legend className="text-xs font-semibold text-[#141413] dark:text-[#F4F1EA] tracking-[0.01em]">
                          {hasPhysicalItems ? '03. Оплата через Монобанк' : '02. Оплата через Монобанк'}
                        </legend>
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-800 dark:text-[#E5E5E5]">
                          <Lock className="w-3 h-3" />
                          <span>Монобанк · E2EE</span>
                        </span>
                      </div>

                      <div className="p-3.5 sm:p-4 rounded-xl bg-[#141413] dark:bg-[#262626] text-white flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold tracking-tight">
                            Оплата тільки через Монобанк
                          </p>
                          <p className="text-[11px] text-white/70 mt-0.5 truncate">
                            {safeMonobankJarUrl
                              ? 'Оплата на банку Монобанку автора'
                              : 'Безпечна оплата замовлення через Монобанк'}
                          </p>
                        </div>
                        <div className="text-right shrink-0 font-mono tabular-nums">
                          {savingsUah > 0 && (
                            <span className="block text-[11px] line-through text-white/55">
                              {originalTotalUah} ₴
                            </span>
                          )}
                          <span className="text-base sm:text-lg font-bold text-[#E5E5E5]">
                            {totalUah} ₴
                          </span>
                        </div>
                      </div>

                      <p className="text-[11px] text-[#5C5C58] dark:text-[#A8A49B] leading-relaxed">
                        Дані замовлення шифруються на вашому пристрої (ECDH P-256 + AES-256-GCM). Оплата приймається виключно через Монобанк.
                      </p>
                    </fieldset>
                  </form>
                )
              ) : (
                /* LIBRARY TAB: Unlocked & Purchased Materials */
                <div className="space-y-6">
                  {lastOrderCode && (
                    <div className="p-4 bg-emerald-50 dark:bg-[#262626] rounded-xl flex items-start justify-between gap-3">
                      <div className="text-xs text-emerald-900 dark:text-[#F4F1EA] space-y-1">
                        <p className="font-semibold flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 shrink-0"/>
                          <span className="tabular-nums">Замовлення #{lastOrderCode} підтверджено</span>
                        </p>
                        <p className="leading-relaxed text-emerald-800/90 dark:text-[#D4D4D4]">
                          Цифрові файли доступні нижче, а замовлення з доставкою передано автору для відправки.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLastOrderCode(null)}
                        className="w-8 h-8 inline-flex items-center justify-center text-emerald-800 dark:text-[#E5E5E5] hover:bg-emerald-100 dark:hover:bg-[#323232] rounded-lg transition-colors cursor-pointer shrink-0"
                        aria-label="Приховати сповіщення"
                      >
                        <X className="w-4 h-4"/>
                      </button>
                    </div>
                  )}

                  {unlockedItems.length === 0 ? (
                    <div className="py-10 flex flex-col items-center text-center">
                      <div className="w-12 h-12 rounded-2xl bg-[#EFECE6] dark:bg-[#262626] flex items-center justify-center text-[#5C5C58] dark:text-[#A8A49B] mb-4">
                        <Package className="w-5 h-5"strokeWidth={1.65} />
                      </div>
                      <h3 className="font-serif text-2xl font-semibold text-[#141413] dark:text-[#F4F1EA] mb-2">
                        Тут будуть ваші видання
                      </h3>
                      <p className="text-sm text-[#5C5C58] dark:text-[#A8A49B] max-w-xs leading-relaxed">
                        Після оформлення замовлення тут з’являться посилання на завантаження електронних книг, Google Документи та статуси доставки.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {unlockedItems.map((item) => (
                        <article
                          key={`${item.orderCode}-${item.productId}`}
                          className="p-4 bg-white dark:bg-[#262626] rounded-xl space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs text-[#5C5C58] dark:text-[#A8A49B]">
                            <span>{getUnlockedTypeLabel(item)}</span>
                            <span className="font-mono tabular-nums">#{item.orderCode}</span>
                          </div>

                          <h4 className="font-serif text-2xl font-semibold text-[#141413] dark:text-[#F4F1EA] leading-snug">
                            {item.title}
                          </h4>

                          {item.type ==='wip_gdoc'&& item.gdocGuestUrl ? (
                            <div className="space-y-3 pt-1">
                              {item.progressLabel && (
                                <p className="text-xs text-[#5C5C58] dark:text-[#A8A49B]">
                                  Актуальний обсяг: {item.progressLabel}
                                </p>
                              )}

                              <div className="px-3 py-2.5 bg-white dark:bg-[#202020] rounded-lg flex items-center gap-2">
                                <FileText className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5] shrink-0"/>
                                <span className="font-mono text-xs text-[#141413] dark:text-[#F4F1EA] truncate flex-1">
                                  {item.gdocGuestUrl}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <a
                                  href={item.gdocGuestUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn-editorial-primary min-h-[42px]"
                                >
                                  <ExternalLink className="w-3.5 h-3.5"/>
                                  <span>Відкрити Google Документ</span>
                                </a>

                                <button
                                  type="button"
                                  onClick={() => handleCopyGdocLink(item.productId, item.gdocGuestUrl!)}
                                  className="btn-editorial-secondary min-h-[42px] px-3.5 py-2"
                                >
                                  {copiedUrlId === item.productId ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-[#E5E5E5]"/>
                                      <span>Скопійовано</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5"/>
                                      <span>Копіювати</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          ) : item.type ==='prose_access'? (
                            <div className="space-y-3 pt-1">
                              <p className="text-xs font-medium text-emerald-800 dark:text-[#E5E5E5] inline-flex items-center gap-1.5">
                                <ShieldCheck className="w-3.5 h-3.5"/>
                                <span>
                                  {item.hasPdf
                                    ?'PDF-документ та текст доступні у розділі «Проза»'
                                    :'Повний текст доступний у розділі «Проза»'}
                                </span>
                              </p>
                              {item.hasPdf && item.pdfFileName && (
                                <p className="text-xs font-mono text-[#141413] dark:text-[#F4F1EA] bg-white dark:bg-[#202020] rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                                  <span className="truncate">{item.pdfFileName}</span>
                                  {item.pdfFileSize && (
                                    <span className="text-[#5C5C58] dark:text-[#A8A49B] shrink-0 tabular-nums">
                                      {item.pdfFileSize < 1024 * 1024
                                        ?`${Math.max(1, Math.round(item.pdfFileSize / 1024))} КБ`
                                        :`${(item.pdfFileSize / (1024 * 1024)).toFixed(1)} МБ`}
                                    </span>
                                  )}
                                </p>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                {onOpenProse && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onClose();
                                      onOpenProse(item.proseId || item.productId);
                                    }}
                                    className="btn-editorial-primary min-h-[42px]"
                                  >
                                    <BookOpen className="w-3.5 h-3.5"/>
                                    <span>{item.hasPdf ?'Читати PDF / історію':'Читати історію'}</span>
                                  </button>
                                )}
                                {item.hasPdf && (
                                  <a
                                    href={`/api/prose/${encodeURIComponent(item.proseId || item.productId)}/pdf?order=${encodeURIComponent(item.orderCode)}&download=1`}
                                    download={item.pdfFileName ||`${item.proseId || item.productId}.pdf`}
                                    className="btn-editorial-ink min-h-[42px]"
                                  >
                                    <Download className="w-3.5 h-3.5"/>
                                    <span>Завантажити PDF</span>
                                  </a>
                                )}
                              </div>
                            </div>
                          ) : isPhysicalProduct(item.type) ? (
                            <div className="space-y-2 pt-1 text-xs text-[#444440] dark:text-[#C5C1B8]">
                              <p className="font-medium text-emerald-800 dark:text-[#E5E5E5] inline-flex items-center gap-1.5">
                                <ShieldCheck className="w-3.5 h-3.5"/>
                                <span>Оплачено ({item.paymentTransactionId ||'Підтверджено'})</span>
                              </p>
                              {item.shippingSummary && (
                                <p className="p-3 bg-white dark:bg-[#202020] rounded-lg leading-relaxed">
                                  Доставка: {item.shippingSummary}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-3 pt-1">
                              {item.formats && (
                                <p className="text-xs text-[#5C5C58] dark:text-[#A8A49B]">
                                  Формати: {item.formats}
                                </p>
                              )}
                              {item.ebookFileName && (
                                <p className="text-xs font-mono text-[#141413] dark:text-[#F4F1EA] bg-white dark:bg-[#202020] rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                                  <span className="truncate">{item.ebookFileName}</span>
                                  {item.ebookFileSize && (
                                    <span className="text-[#5C5C58] dark:text-[#A8A49B] shrink-0 tabular-nums">
                                      {item.ebookFileSize < 1024 * 1024
                                        ?`${Math.max(1, Math.round(item.ebookFileSize / 1024))} КБ`
                                        :`${(item.ebookFileSize / (1024 * 1024)).toFixed(1)} МБ`}
                                    </span>
                                  )}
                                </p>
                              )}
                              <a
                                href={
                                  item.downloadUrl ||
`/api/ebooks/${encodeURIComponent(item.productId)}/download?order=${encodeURIComponent(item.orderCode)}`
                                }
                                download={item.ebookFileName || true}
                                className="btn-editorial-ink min-h-[42px]"
                              >
                                <Download className="w-3.5 h-3.5"/>
                                <span>
                                  {item.ebookFileName
                                    ?`Завантажити (${item.ebookFileName.split('.').pop()?.toUpperCase() ||'файл'})`
                                    :'Завантажити електронну книгу'}
                                </span>
                              </a>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}

                  {/* Restore Orders Utility */}
                  <div className="pt-5">
                    <p className="text-xs font-semibold text-[#141413] dark:text-[#F4F1EA] mb-1">
                      Відновити попередні замовлення
                    </p>
                    <p className="text-[11px] text-[#5C5C58] dark:text-[#A8A49B] mb-3">
                      Введіть email, вказаний при покупці, або номер замовлення (наприклад, AD-1042).
                    </p>
                    <form onSubmit={handleRestore} className="flex gap-2">
                      <input
                        type="text"
                        value={restoreQuery}
                        onChange={(e) => setRestoreQuery(e.target.value)}
                        placeholder="email або AD-1042"
                        className="input-editorial min-h-[42px] py-2 text-xs flex-1"
                      />
                      <button
                        type="submit"
                        disabled={restoring}
                        className="btn-editorial-secondary min-h-[42px] px-4 py-2"
                      >
                        <Search className="w-3.5 h-3.5"/>
                        <span>{restoring ?'Пошук...':'Знайти'}</span>
                      </button>
                    </form>
                    {restoreStatus && (
                      <p
                        className={`text-xs mt-2.5 ${
                          restoreStatus.ok
                            ? 'text-emerald-700 dark:text-[#E5E5E5] font-medium'
                            : 'text-rose-700 dark:text-rose-400'
                        }`}
                        role="status"
                      >
                        {restoreStatus.text}
                      </p>
                    )}
                  </div>

                  {/* Guest Device Privacy Wipe Control */}
                  {onClearDeviceLibrary && (
                    <div className="p-4 bg-white dark:bg-[#262626] rounded-xl space-y-2.5">
                      <div className="flex items-start gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5] shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-[#141413] dark:text-[#F4F1EA]">
                            Приватність на цьому пристрої
                          </p>
                          <p className="text-[11px] text-[#5C5C58] dark:text-[#A8A49B] leading-relaxed">
                            Адреса доставки, телефон і платіжні реквізити не зберігаються в пам’яті браузера. Якщо ви користуєтеся спільним пристроєм, ви можете очистити локальний список придбань — покупки легко відновити за email або кодом замовлення.
                          </p>
                        </div>
                      </div>

                      {unlockedItems.length > 0 && (
                        <div className="pt-1">
                          {confirmClearDevice ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  onClearDeviceLibrary();
                                  setConfirmClearDevice(false);
                                  setDeviceClearedNotice(true);
                                  setLastOrderCode(null);
                                }}
                                className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold bg-rose-700 text-white hover:bg-rose-800 rounded-lg transition-colors cursor-pointer"
                              >
                                Так, очистити з цього пристрою
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmClearDevice(false)}
                                className="btn-editorial-secondary min-h-[38px] px-3.5 py-1.5 text-xs"
                              >
                                Скасувати
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmClearDevice(true);
                                setDeviceClearedNotice(false);
                              }}
                              className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400 bg-rose-700/10 dark:bg-rose-400/15 hover:bg-rose-700/15 dark:hover:bg-rose-400/25 rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Очистити дані доступу на цьому пристрої</span>
                            </button>
                          )}
                        </div>
                      )}

                      {deviceClearedNotice && (
                        <p className="text-xs text-emerald-700 dark:text-[#E5E5E5] font-medium" role="status">
                          Локальні дані доступу на цьому пристрої очищено.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pinned Bottom Summary & Thumb-Zone Action Dock (Cart Tab Only when non-empty) */}
            {activeTab ==='cart'&& cartProducts.length > 0 && (
              <footer className="px-5 sm:px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-white dark:bg-[#202020] shrink-0 space-y-3">
                {errorMsg && checkoutStep !=='review'&& (
                  <p className="text-xs text-rose-700 dark:text-rose-400 font-medium leading-snug"role="alert">
                    {errorMsg}
                  </p>
                )}

                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <p className="text-xs text-[#5C5C58] dark:text-[#A8A49B] tabular-nums">
                      До сплати · {formatUkCount(cartProducts.length,'видання','видання','видань')}
                    </p>
                  </div>
                  <div className="flex items-baseline gap-2 font-mono tabular-nums">
                    {savingsUah > 0 && (
                      <span className="text-xs text-[#5C5C58] dark:text-[#8D8980] line-through">
                        {originalTotalUah} ₴
                      </span>
                    )}
                    <span className="text-2xl font-semibold text-[#141413] dark:text-[#F4F1EA]">
                      {totalUah} ₴
                    </span>
                  </div>
                </div>

                {checkoutStep ==='review'? (
                  <button
                    type="button"
                    onClick={() => {
                      trackClick('action:cart_proceed','Перехід до оформлення замовлення','store');
                      setCheckoutStep('checkout');
                      setErrorMsg(null);
                    }}
                    className="w-full btn-editorial-primary min-h-[48px] py-3 text-sm tabular-nums"
                  >
                    <span>Оформити замовлення</span>
                    <ArrowRight className="w-4 h-4"strokeWidth={1.85} />
                  </button>
                ) : checkoutStep === 'monobank_jar' ? (
                  <button
                    type="button"
                    onClick={executeStoreMonobankOrder}
                    disabled={submitting}
                    className="w-full btn-editorial-primary min-h-[48px] py-3 text-sm tabular-nums"
                  >
                    <CheckCircle2 className="w-4 h-4" strokeWidth={1.85} />
                    <span>
                      {submitting
                        ? 'Підтвердження замовлення...'
                        : 'Я оплатив(ла) — підтвердити замовлення'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    form="checkout-form"
                    disabled={submitting}
                    className="w-full btn-editorial-primary min-h-[48px] py-3 text-sm tabular-nums"
                  >
                    <Lock className="w-4 h-4"strokeWidth={1.85} />
                    <span>
                      {submitting
                        ? 'Захищена обробка оплати...'
                        : safeMonobankJarUrl
                          ? `Перейти до оплати Монобанк · ${totalUah} ₴`
                          : `Оплатити через Монобанк · ${totalUah} ₴`}
                    </span>
                  </button>
                )}
              </footer>
            )}
          </m.aside>
        </m.div>
      )}
    </AnimatePresence>
  );
}
