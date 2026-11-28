import { Eye, EyeOff, Lock, Package, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OrderRecord } from '../../types.ts';

interface StudioOrdersTabProps {
  orders: OrderRecord[];
  isActive: boolean;
}

export function StudioOrdersTab({ orders, isActive }: StudioOrdersTabProps) {
  const [revealedOrderCodes, setRevealedOrderCodes] = useState<Record<string, boolean>>({});
  const [showSecurityNote, setShowSecurityNote] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setRevealedOrderCodes({});
    }
  }, [isActive]);

  useEffect(() => {
    const hasRevealed = Object.values(revealedOrderCodes).some(Boolean);
    if (!hasRevealed) return;
    const timer = window.setTimeout(() => {
      setRevealedOrderCodes({});
    }, 45000);
    return () => window.clearTimeout(timer);
  }, [revealedOrderCodes]);

  const totalRevenue = orders.reduce((acc, o) => {
    const status = o.payment?.status;
    if (status && status !== 'paid') return acc;
    return acc + (Number(o.totalUah) || 0);
  }, 0);

  return (
    <div className="max-w-4xl space-y-5">
      {/* Compact Header Summary & Toggleable Security Note */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-4 text-xs text-ink-muted dark:text-sandstone tabular-nums">
          <span>
            Усього: <strong className="text-ink dark:text-cream-soft font-mono">{orders.length}</strong>
          </span>
          {orders.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Сума: <strong className="text-ink dark:text-cream-soft font-mono">{totalRevenue} ₴</strong>
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowSecurityNote((prev) => !prev)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-pine dark:text-silver hover:underline cursor-pointer"
        >
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span>{showSecurityNote ? 'Сховати деталі шифрування' : 'Захист персональних даних'}</span>
        </button>
      </div>

      {showSecurityNote && (
        <div className="px-4 py-3 rounded-xl bg-paper dark:bg-night-card text-xs text-ink-muted dark:text-sandstone leading-relaxed">
          Усі платежі проходять наскрізне шифрування (ECDH P-256 + HKDF-SHA256 + AES-256-GCM) на пристрої покупця. Імена, email і адреси доставки зберігаються у сховищі зашифрованими, квитанції підписуються HMAC-SHA256, а персональні дані автоматично маскуються через 45 с після відкриття.
        </div>
      )}

      {orders.length === 0 ? (
        <div className="py-12 text-center space-y-2 bg-paper dark:bg-night-card rounded-xl">
          <Package className="w-7 h-7 text-ink-muted dark:text-sandstone mx-auto" strokeWidth={1.5} />
          <p className="text-sm font-medium text-ink dark:text-cream-soft">Замовлень ще немає</p>
          <p className="text-xs text-ink-muted dark:text-sandstone max-w-sm mx-auto">
            Тут з’являться оплачені книги, антирамки з адресами доставки та електронні видання.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((ord) => {
            const isRevealed = Boolean(revealedOrderCodes[ord.orderCode]) && !ord.piiLocked;
            const displayName = isRevealed ? ord.buyerName : ord.buyerNameMasked || ord.buyerName;
            const displayEmail = isRevealed ? ord.buyerEmail : ord.buyerEmailMasked || ord.buyerEmail;
            const carrierLabel =
              ord.shipping?.carrier === 'nova_poshta'
                ? 'Нова Пошта'
                : ord.shipping?.carrier === 'ukrposhta'
                  ? 'Укрпошта'
                  : 'Кур’єр';

            return (
              <div key={ord.orderCode} className="p-4 sm:p-5 space-y-3 rounded-xl bg-paper dark:bg-night-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted dark:text-sandstone">
                    <span className="font-mono font-semibold text-ink dark:text-cream-soft tabular-nums">
                      #{ord.orderCode}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-ink dark:text-cream-soft font-medium">{displayName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[11px]">{displayEmail}</span>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {!ord.piiLocked && (
                      <button
                        type="button"
                        onClick={() =>
                          setRevealedOrderCodes((prev) => ({
                            ...prev,
                            [ord.orderCode]: !prev[ord.orderCode],
                          }))
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium bg-paper-warm dark:bg-night-elevated text-ink dark:text-cream-soft hover:bg-paper-sand dark:hover:bg-night-muted rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {isRevealed ? (
                          <>
                            <EyeOff className="w-3.5 h-3.5 text-ink-muted dark:text-sandstone" />
                            <span>Приховати</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5 text-pine dark:text-silver" />
                            <span>Показати дані</span>
                          </>
                        )}
                      </button>
                    )}
                    <span className="font-mono text-sm font-semibold text-ink dark:text-cream-soft tabular-nums">
                      {ord.totalUah} ₴
                    </span>
                  </div>
                </div>

                {ord.piiLocked && (
                  <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/35 rounded-lg text-[11px] text-amber-900 dark:text-amber-200 flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Персональні дані зашифровано ключем іншої сесії (задайте <code className="font-mono">PAYMENT_ENCRYPTION_KEY</code> у секретах середовища).
                    </span>
                  </div>
                )}

                <div className="text-xs text-ink dark:text-cream-soft space-y-0.5">
                  {ord.items.map((it) => (
                    <p key={it.productId}>• {it.title}</p>
                  ))}
                </div>

                {ord.shipping && (
                  <div className="px-3.5 py-2.5 bg-white dark:bg-night-panel rounded-lg text-xs text-[#444440] dark:text-parchment space-y-1">
                    <p className="font-medium text-ink dark:text-cream-soft">
                      Доставка · {carrierLabel}
                    </p>
                    {isRevealed ? (
                      <>
                        <p>
                          {ord.shipping.recipientName} · {ord.shipping.phone} · {ord.shipping.city},{' '}
                          {ord.shipping.addressOrBranch}
                        </p>
                        {ord.shipping.comment && <p className="italic">Коментар: {ord.shipping.comment}</p>}
                      </>
                    ) : (
                      <p className="text-ink-muted dark:text-sandstone">
                        Адреса та контакти отримувача приховані. Натисніть «Показати дані» для перегляду.
                      </p>
                    )}
                  </div>
                )}

                {ord.payment && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono pt-1">
                    <span
                      className={
                        ord.payment.status === 'pending'
                          ? 'text-amber-700 dark:text-amber-300'
                          : ord.payment.status === 'failed' || ord.payment.status === 'expired'
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-emerald-800 dark:text-silver'
                      }
                    >
                      {ord.payment.status === 'pending'
                        ? 'Очікує оплати'
                        : ord.payment.status === 'failed' || ord.payment.status === 'expired'
                          ? 'Не оплачено'
                          : 'Оплачено'}{' '}
                      · {ord.payment.providerLabel}
                      {ord.payment.cardLast4 ? ` (•••• ${ord.payment.cardLast4})` : ''} · {ord.payment.transactionId}
                    </span>
                    {ord.payment.status === 'paid' && ord.integrityVerified === true && (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-silver">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>HMAC перевірено</span>
                      </span>
                    )}
                    {ord.payment.status === 'paid' && ord.integrityVerified === false && (
                      <span className="text-rose-700 dark:text-rose-400">
                        Підпис квитанції потребує перевірки
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
