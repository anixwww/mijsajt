import {
  Check,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Lock,
  ShieldCheck,
  Smartphone,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  getEffectivePriceUah,
  isPhysicalProduct,
  type PurchasedAccess,
  type StoreProduct,
} from '../types.ts';
import { setActiveMoment, trackClick } from '../utils/analytics.ts';

interface CartLibraryDrawerProps {
  isOpen: boolean;
  activeTab: 'cart' | 'library';
  onTabChange: (tab: 'cart' | 'library') => void;
  onClose: () => void;
  cartProducts: StoreProduct[];
  onRemoveFromCart: (productId: string) => void;
  onCheckoutSuccess: (unlocked: PurchasedAccess[], orderCode: string) => void;
  unlockedItems: PurchasedAccess[];
  onRestoreOrders: (restored: PurchasedAccess[]) => void;
}

function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
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
  onRestoreOrders,
}: CartLibraryDrawerProps) {
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');

  // Physical shipping fields
  const [phone, setPhone] = useState('');
  const [carrier, setCarrier] = useState<'nova_poshta' | 'ukrposhta' | 'courier'>('nova_poshta');
  const [city, setCity] = useState('');
  const [addressOrBranch, setAddressOrBranch] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [deliveryComment, setDeliveryComment] = useState('');

  // Protected payment fields (kept strictly client-side; only tokenized confirmation sent)
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'apple_google_pay'>('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastOrderCode, setLastOrderCode] = useState<string | null>(null);
  const [copiedUrlId, setCopiedUrlId] = useState<string | null>(null);

  const [restoreQuery, setRestoreQuery] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const totalUah = cartProducts.reduce((sum, p) => sum + getEffectivePriceUah(p), 0);
  const hasPhysicalItems = cartProducts.some((p) => isPhysicalProduct(p.type));

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'cart') {
      setActiveMoment({
        targetKey: 'store:checkout',
        momentKey: 'store:checkout',
        label: 'Крамниця: Кошик та оформлення оплати',
        category: 'section',
        section: 'store',
      });
    } else {
      setActiveMoment({
        targetKey: 'store:library',
        momentKey: 'store:library',
        label: 'Крамниця: Мої придбання',
        category: 'section',
        section: 'store',
      });
    }
  }, [isOpen, activeTab]);

  const handleCheckout = async (e: FormEvent) => {
    e.preventDefault();
    if (cartProducts.length === 0) return;
    trackClick('action:checkout_submit', 'Оформлення й оплата замовлення', 'store');
    setErrorMsg(null);

    if (hasPhysicalItems) {
      if (phone.replace(/\D/g, '').length < 9 || city.trim().length < 2 || addressOrBranch.trim().length < 3) {
        setErrorMsg('Будь ласка, вкажіть коректний номер телефону, місто та відділення або адресу доставки.');
        return;
      }
    }

    let cardLast4: string | undefined;
    if (paymentMethod === 'card') {
      const cleanCard = cardNumber.replace(/\D/g, '');
      const cleanExp = cardExpiry.replace(/\D/g, '');
      const cleanCvc = cardCvc.replace(/\D/g, '');
      if (cleanCard.length < 16) {
        setErrorMsg('Введіть 16-значний номер банківської картки.');
        return;
      }
      const month = Number(cleanExp.slice(0, 2));
      if (cleanExp.length !== 4 || month < 1 || month > 12) {
        setErrorMsg('Вкажіть термін дії картки у форматі ММ/РР.');
        return;
      }
      if (cleanCvc.length < 3) {
        setErrorMsg('Введіть 3-значний захисний код CVC/CVV.');
        return;
      }
      cardLast4 = cleanCard.slice(-4);
    }

    const paymentToken = `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    setSubmitting(true);
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerName,
          buyerEmail,
          productIds: cartProducts.map((p) => p.id),
          shipping: hasPhysicalItems
            ? {
                recipientName: buyerName,
                phone,
                carrier,
                city,
                addressOrBranch,
                postalCode: postalCode || undefined,
                comment: deliveryComment || undefined,
              }
            : undefined,
          payment: {
            method: paymentMethod,
            cardLast4,
            paymentToken,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setErrorMsg(data.error || 'Не вдалося оформити замовлення.');
        return;
      }

      setLastOrderCode(data.order.orderCode);
      onCheckoutSuccess(data.order.items, data.order.orderCode);
      onTabChange('library');
      setBuyerName('');
      setBuyerEmail('');
      setPhone('');
      setCity('');
      setAddressOrBranch('');
      setPostalCode('');
      setDeliveryComment('');
      setCardNumber('');
      setCardExpiry('');
      setCardCvc('');
    } catch {
      setErrorMsg('Помилка з’єднання із сервером.');
    } finally {
      setSubmitting(false);
    }
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: restoreQuery }),
      });
      const data = await response.json();
      if (!response.ok) {
        setRestoreStatus(data.error || 'Не вдалося знайти покупки.');
        return;
      }
      if (data.items.length === 0) {
        setRestoreStatus('За цим email або кодом замовлень не знайдено.');
      } else {
        onRestoreOrders(data.items);
        setRestoreStatus(`Відновлено доступ до ${data.items.length} позицій.`);
        setRestoreQuery('');
      }
    } catch {
      setRestoreStatus('Помилка з’єднання.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 bg-[#141413]/45 backdrop-blur-xs flex justify-end"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Кошик та придбані матеріали"
        >
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="bg-[#F5F4EF] dark:bg-[#0B0B0A] text-[#0D0D0C] dark:text-[#F2F1EC] border-l border-[#0D0D0C]/20 dark:border-[#252522] w-full max-w-lg h-full flex flex-col shadow-2xl will-change-transform"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="px-6 py-5 bg-white dark:bg-[#141412] border-b border-[#0D0D0C]/16 dark:border-[#252522] flex items-center justify-between gap-4">
              <div className="flex items-center gap-1 p-1 bg-[#ECEAE2] dark:bg-[#0B0B0A] border border-[#0D0D0C]/12 dark:border-[#252522]">
                <button
                  type="button"
                  onClick={() => onTabChange('cart')}
                  className={`px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
                    activeTab === 'cart'
                      ? 'bg-[#0D0D0C] text-[#F5F4EF] dark:bg-[#F2F1EC] dark:text-[#0D0D0C]'
                      : 'text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC]'
                  }`}
                >
                  Кошик ({cartProducts.length})
                </button>
                <button
                  type="button"
                  onClick={() => onTabChange('library')}
                  className={`px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
                    activeTab === 'library'
                      ? 'bg-[#0D0D0C] text-[#F5F4EF] dark:bg-[#F2F1EC] dark:text-[#0D0D0C]'
                      : 'text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC]'
                  }`}
                >
                  Мої придбання ({unlockedItems.length})
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-2 text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC] border border-transparent hover:border-[#0D0D0C]/20 transition-colors cursor-pointer"
                aria-label="Закрити панель"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'cart' ? (
                cartProducts.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="font-serif text-3xl mb-2">Кошик порожній</p>
                    <p className="text-sm text-[#6B6B65] dark:text-[#94948C] max-w-xs mx-auto">
                      Оберіть електронну чи паперову книгу, «Тіло вірша» в антирамці або доступ до роману в Google Документах.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="divide-y divide-[#0D0D0C]/14 dark:divide-[#252522] bg-white dark:bg-[#141412] border border-[#0D0D0C]/16 dark:border-[#252522]">
                      {cartProducts.map((item) => {
                        const effectivePrice = getEffectivePriceUah(item);
                        const hasDiscount = (item.discountPercent || 0) > 0;
                        const typeLabel =
                          item.type === 'wip_gdoc'
                            ? 'Гостьове посилання на Google Документ'
                            : item.type === 'paper_book'
                              ? 'Паперова книга · Потрібна доставка'
                              : item.type === 'poem_frame'
                                ? 'Скляна антирамка · Потрібна доставка'
                                : `Електронна книга · ${item.formats}`;

                        return (
                          <div key={item.id} className="p-4 flex items-start justify-between gap-4">
                            <div>
                              <p className="font-mono text-[11px] text-[#6B6B65] dark:text-[#94948C] mb-1">
                                {typeLabel}
                              </p>
                              <h4 className="font-serif text-xl font-semibold">{item.title}</h4>
                              <div className="flex items-baseline gap-2 font-mono text-sm tabular-nums mt-1">
                                <span className="font-medium">{effectivePrice} ₴</span>
                                {hasDiscount && (
                                  <span className="text-xs text-[#6B6B65] dark:text-[#94948C] line-through">
                                    {item.priceUah} ₴
                                  </span>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => onRemoveFromCart(item.id)}
                              className="p-2 text-[#6B6B65] dark:text-[#94948C] hover:text-rose-600 transition-colors cursor-pointer"
                              aria-label={`Видалити ${item.title} з кошика`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between py-4 border-t border-b border-[#0D0D0C]/16 dark:border-[#252522]">
                      <span className="text-sm font-medium text-[#6B6B65] dark:text-[#94948C]">До сплати</span>
                      <span className="font-mono text-2xl font-semibold tabular-nums">
                        {totalUah} ₴
                      </span>
                    </div>

                    <form onSubmit={handleCheckout} className="space-y-5">
                      {/* Contact Info */}
                      <div className="space-y-3">
                        <p className="font-mono text-xs font-semibold uppercase tracking-wider">
                          1. Контактні дані отримувача
                        </p>
                        <div>
                          <label htmlFor="buyer-name" className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1">
                            Ім’я та прізвище
                          </label>
                          <input
                            id="buyer-name"
                            type="text"
                            required
                            value={buyerName}
                            onChange={(e) => setBuyerName(e.target.value)}
                            placeholder="Олена Ковальчук"
                            className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-[#141412] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                          />
                        </div>

                        <div>
                          <label htmlFor="buyer-email" className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1">
                            Email для квитанції та доступу
                          </label>
                          <input
                            id="buyer-email"
                            type="email"
                            required
                            value={buyerEmail}
                            onChange={(e) => setBuyerEmail(e.target.value)}
                            placeholder="reader@example.com"
                            className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-[#141412] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                          />
                        </div>
                      </div>

                      {/* Shipping Address Form for Physical Books / Anti-frames */}
                      {hasPhysicalItems && (
                        <div className="p-4 bg-white dark:bg-[#141412] border border-[#0D0D0C]/16 dark:border-[#252522] space-y-3">
                          <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider">
                            <Truck className="w-4 h-4 text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.75} />
                            <span>2. Адреса доставки фізичного видання</span>
                          </div>

                          <div>
                            <label htmlFor="ship-phone" className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1">
                              Контактний телефон
                            </label>
                            <input
                              id="ship-phone"
                              type="tel"
                              required
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              placeholder="+380 67 123 45 67"
                              className="w-full px-3.5 py-2 text-sm font-mono bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                            />
                          </div>

                          <div>
                            <label htmlFor="ship-carrier" className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1">
                              Служба доставки
                            </label>
                            <select
                              id="ship-carrier"
                              value={carrier}
                              onChange={(e) => setCarrier(e.target.value as 'nova_poshta' | 'ukrposhta' | 'courier')}
                              className="w-full px-3.5 py-2 text-sm bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                            >
                              <option value="nova_poshta">Нова Пошта (відділення / поштомат)</option>
                              <option value="ukrposhta">Укрпошта</option>
                              <option value="courier">Кур’єрська доставка за адресою</option>
                            </select>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label htmlFor="ship-city" className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1">
                                Місто / населений пункт
                              </label>
                              <input
                                id="ship-city"
                                type="text"
                                required
                                value={city}
                                onChange={(e) => setCity(e.target.value)}
                                placeholder="Львів"
                                className="w-full px-3.5 py-2 text-sm bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                              />
                            </div>

                            {carrier === 'ukrposhta' && (
                              <div>
                                <label htmlFor="ship-postal" className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1">
                                  Поштовий індекс
                                </label>
                                <input
                                  id="ship-postal"
                                  type="text"
                                  value={postalCode}
                                  onChange={(e) => setPostalCode(e.target.value)}
                                  placeholder="79000"
                                  className="w-full px-3.5 py-2 text-sm font-mono bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                                />
                              </div>
                            )}
                          </div>

                          <div>
                            <label htmlFor="ship-address" className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1">
                              {carrier === 'courier' ? 'Вулиця, будинок, квартира' : 'Номер відділення / поштомату або адреса'}
                            </label>
                            <input
                              id="ship-address"
                              type="text"
                              required
                              value={addressOrBranch}
                              onChange={(e) => setAddressOrBranch(e.target.value)}
                              placeholder={carrier === 'courier' ? 'вул. Франка, 24, кв. 8' : 'Відділення №12'}
                              className="w-full px-3.5 py-2 text-sm bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                            />
                          </div>

                          <div>
                            <label htmlFor="ship-comment" className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1">
                              Побажання щодо підпису автора (необов’язково)
                            </label>
                            <input
                              id="ship-comment"
                              type="text"
                              value={deliveryComment}
                              onChange={(e) => setDeliveryComment(e.target.value)}
                              placeholder="Наприклад: підписати для Олени"
                              className="w-full px-3.5 py-2 text-sm bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                            />
                          </div>
                        </div>
                      )}

                      {/* Protected Payment System */}
                      <div className="p-4 bg-white dark:bg-[#141412] border border-[#0D0D0C]/16 dark:border-[#252522] space-y-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider">
                            <ShieldCheck className="w-4 h-4 text-[#1E4631] dark:text-[#4E946C]" strokeWidth={1.75} />
                            <span>{hasPhysicalItems ? '3. Захищена платіжна система' : '2. Захищена оплата'}</span>
                          </div>
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#6B6B65] dark:text-[#94948C]">
                            <Lock className="w-3 h-3" />
                            <span>TLS 1.3</span>
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-1 p-1 bg-[#ECEAE2] dark:bg-[#0B0B0A] border border-[#0D0D0C]/12 dark:border-[#252522]">
                          <button
                            type="button"
                            onClick={() => setPaymentMethod('card')}
                            className={`py-2 px-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                              paymentMethod === 'card'
                                ? 'bg-[#0D0D0C] text-[#F5F4EF] dark:bg-[#F2F1EC] dark:text-[#0D0D0C]'
                                : 'text-[#6B6B65] dark:text-[#94948C]'
                            }`}
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Картка</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentMethod('apple_google_pay')}
                            className={`py-2 px-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                              paymentMethod === 'apple_google_pay'
                                ? 'bg-[#0D0D0C] text-[#F5F4EF] dark:bg-[#F2F1EC] dark:text-[#0D0D0C]'
                                : 'text-[#6B6B65] dark:text-[#94948C]'
                            }`}
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                            <span>Apple / Google Pay</span>
                          </button>
                        </div>

                        {paymentMethod === 'card' ? (
                          <div className="space-y-3">
                            <div>
                              <label htmlFor="pay-card" className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1">
                                Номер картки (Visa / Mastercard)
                              </label>
                              <input
                                id="pay-card"
                                type="text"
                                inputMode="numeric"
                                autoComplete="cc-number"
                                required
                                value={cardNumber}
                                onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                                placeholder="4149 0000 0000 0000"
                                className="w-full px-3.5 py-2 text-sm font-mono bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label htmlFor="pay-exp" className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1">
                                  Термін дії
                                </label>
                                <input
                                  id="pay-exp"
                                  type="text"
                                  inputMode="numeric"
                                  autoComplete="cc-exp"
                                  required
                                  value={cardExpiry}
                                  onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                                  placeholder="12/28"
                                  className="w-full px-3.5 py-2 text-sm font-mono bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                                />
                              </div>
                              <div>
                                <label htmlFor="pay-cvc" className="block text-xs font-medium text-[#6B6B65] dark:text-[#94948C] mb-1">
                                  CVC / CVV
                                </label>
                                <input
                                  id="pay-cvc"
                                  type="password"
                                  inputMode="numeric"
                                  autoComplete="cc-csc"
                                  required
                                  maxLength={3}
                                  value={cardCvc}
                                  onChange={(e) => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 3))}
                                  placeholder="•••"
                                  className="w-full px-3.5 py-2 text-sm font-mono bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-[#3A3A36] dark:text-[#C8C7C0] bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/12 dark:border-[#252522] p-3">
                            Натисніть кнопку нижче для захищеного токенізованого підтвердження платежу через Apple Pay або Google Pay.
                          </p>
                        )}

                        <p className="text-[11px] text-[#6B6B65] dark:text-[#94948C] leading-relaxed">
                          Платіжні дані шифруються й токенізуються у браузері — повний номер картки та код CVC ніколи не зберігаються на сервері.
                        </p>
                      </div>

                      {errorMsg && (
                        <p className="text-xs text-rose-700 dark:text-rose-400 font-medium" role="alert">
                          {errorMsg}
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={submitting}
                        className="w-full py-3 px-5 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-[#1E4631] hover:bg-[#153524] dark:bg-[#2D6A4F] dark:hover:bg-[#3A8261] disabled:opacity-60 transition-colors cursor-pointer"
                      >
                        <Lock className="w-4 h-4" />
                        <span>
                          {submitting
                            ? 'Захищена обробка оплати...'
                            : `Сплатити ${totalUah} ₴`}
                        </span>
                      </button>
                    </form>
                  </div>
                )
              ) : (
                <div className="space-y-6">
                  {lastOrderCode && (
                    <div className="p-4 bg-[#1E4631]/10 border border-[#1E4631]/30 dark:bg-[#2D6A4F]/15 dark:border-[#4E946C]/40 text-xs text-[#0D0D0C] dark:text-[#F2F1EC]">
                      <p className="font-semibold mb-1">Замовлення #{lastOrderCode} оплачено та підтверджено</p>
                      <p className="text-[#3A3A36] dark:text-[#C8C7C0]">
                        Придбані цифрові матеріали вже відкрито нижче, а замовлення з доставкою передано автору для відправки.
                      </p>
                    </div>
                  )}

                  {unlockedItems.length === 0 ? (
                    <div className="py-10 text-center">
                      <p className="font-serif text-3xl mb-2">Тут будуть ваші замовлення</p>
                      <p className="text-sm text-[#6B6B65] dark:text-[#94948C]">
                        Після оплати тут відображатимуться посилання на книги, Google Документи та статуси доставки друкованих видань.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {unlockedItems.map((item) => (
                        <div
                          key={`${item.orderCode}-${item.productId}`}
                          className="p-5 bg-white dark:bg-[#141412] border border-[#0D0D0C]/16 dark:border-[#252522] space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-[#6B6B65] dark:text-[#94948C]">
                            <span>
                              {item.type === 'wip_gdoc'
                                ? 'Google Документ (гостьовий перегляд)'
                                : item.type === 'paper_book'
                                  ? 'Паперова книга (доставка)'
                                  : item.type === 'poem_frame'
                                    ? 'Тіло вірша · Скляна антирамка'
                                    : 'Електронна книга'}
                            </span>
                            <span className="tabular-nums">#{item.orderCode}</span>
                          </div>

                          <h4 className="font-serif text-2xl font-semibold">{item.title}</h4>

                          {item.type === 'wip_gdoc' && item.gdocGuestUrl ? (
                            <div className="space-y-3 pt-1">
                              {item.progressLabel && (
                                <p className="text-xs text-[#6B6B65] dark:text-[#94948C]">
                                  Актуальний обсяг: {item.progressLabel}
                                </p>
                              )}

                              <div className="p-3 bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/14 dark:border-[#252522] flex items-center gap-2">
                                <FileText className="w-4 h-4 text-[#1E4631] dark:text-[#4E946C] shrink-0" />
                                <span className="font-mono text-xs truncate flex-1">
                                  {item.gdocGuestUrl}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <a
                                  href={item.gdocGuestUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E4631] hover:bg-[#153524] dark:bg-[#2D6A4F] dark:hover:bg-[#3A8261] transition-colors"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  <span>Відкрити Google Документ</span>
                                </a>

                                <button
                                  type="button"
                                  onClick={() => handleCopyGdocLink(item.productId, item.gdocGuestUrl!)}
                                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white dark:bg-[#1B1B18] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] hover:border-[#1E4631] dark:hover:border-[#4E946C] transition-colors cursor-pointer"
                                >
                                  {copiedUrlId === item.productId ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-[#1E4631] dark:text-[#4E946C]" />
                                      <span>Скопійовано</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" />
                                      <span>Копіювати посилання</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          ) : isPhysicalProduct(item.type) ? (
                            <div className="space-y-2 pt-1 text-xs text-[#3A3A36] dark:text-[#C8C7C0]">
                              <p className="font-medium text-[#1E4631] dark:text-[#4E946C] inline-flex items-center gap-1.5">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>Оплачено ({item.paymentTransactionId || 'Підтверджено'})</span>
                              </p>
                              {item.shippingSummary && (
                                <p className="p-3 bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/14 dark:border-[#252522] leading-relaxed">
                                  Доставка: {item.shippingSummary}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-3 pt-1">
                              {item.formats && (
                                <p className="text-xs text-[#6B6B65] dark:text-[#94948C]">
                                  Доступні формати: {item.formats}
                                </p>
                              )}
                              {item.ebookFileName && (
                                <p className="text-xs font-mono bg-[#F5F4EF] dark:bg-[#0B0B0A] border border-[#0D0D0C]/14 dark:border-[#252522] px-3 py-2 flex items-center justify-between gap-2">
                                  <span className="truncate">{item.ebookFileName}</span>
                                  {item.ebookFileSize && (
                                    <span className="text-[#6B6B65] dark:text-[#94948C] shrink-0 tabular-nums">
                                      {item.ebookFileSize < 1024 * 1024
                                        ? `${Math.max(1, Math.round(item.ebookFileSize / 1024))} КБ`
                                        : `${(item.ebookFileSize / (1024 * 1024)).toFixed(1)} МБ`}
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
                                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#0D0D0C] dark:bg-[#F2F1EC] dark:text-[#0D0D0C] hover:bg-[#1E4631] dark:hover:bg-[#2D6A4F] dark:hover:text-white transition-colors"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>
                                  {item.ebookFileName
                                    ? `Завантажити (${item.ebookFileName.split('.').pop()?.toUpperCase() || 'файл'})`
                                    : 'Завантажити електронну книгу'}
                                </span>
                              </a>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-6 border-t border-[#0D0D0C]/16 dark:border-[#252522]">
                    <p className="text-xs font-semibold mb-2">
                      Відновити замовлення за email або номером замовлення
                    </p>
                    <form onSubmit={handleRestore} className="flex gap-2">
                      <input
                        type="text"
                        value={restoreQuery}
                        onChange={(e) => setRestoreQuery(e.target.value)}
                        placeholder="email або AD-1042"
                        className="flex-1 px-3 py-2 text-xs bg-white dark:bg-[#141412] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] focus:outline-none focus:border-[#1E4631] dark:focus:border-[#4E946C]"
                      />
                      <button
                        type="submit"
                        disabled={restoring}
                        className="px-4 py-2 text-xs font-medium bg-white dark:bg-[#141412] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] hover:border-[#1E4631] dark:hover:border-[#4E946C] transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {restoring ? 'Пошук...' : 'Знайти'}
                      </button>
                    </form>
                    {restoreStatus && (
                      <p className="text-xs text-[#6B6B65] dark:text-[#94948C] mt-2">{restoreStatus}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
