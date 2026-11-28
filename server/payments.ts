import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import type {
  DonorRecord,
  RawProseWork,
  RawStoreProduct,
  SiteDatabase,
} from './seedData.ts';
import {
  getEffectivePriceUah,
  getProseDiscountCalculation,
  isPhysicalProduct,
  type EncryptedPaymentEnvelope,
  type EncryptedPiiEnvelope,
  type OrderRecord,
  type PaymentSummary,
  type PurchasedAccess,
  type ShippingDetails,
} from '../src/types.ts';
import {
  DATA_DIR,
  EBOOKS_DIR,
  PROSE_PDF_DIR,
  checkRateLimit,
  createEndpointRateLimiter,
  ensureDataDirectories,
  ensureDatabase,
  getClientIpHash,
  resolveConfinedFilePath,
  resolveProseAccessMode,
  saveDatabase,
  verifySameOrigin,
} from './db.ts';
import { emitProductionAlert } from './monitoring.ts';
import {
  authenticateAdminRequest,
  authenticateGuestRequest,
  extractBearerToken,
  isVerifiedAdminClaims,
  tryAuthenticateOptionalGuest,
  verifyFirebaseIdToken,
} from './auth.ts';
import {
  ensurePendingInvoicesLoaded,
  getMonobankToken,
  hydrateSingleAuthorizedProse,
  paymentSessions,
  pendingMonobankProseInvoices,
  pendingMonobankStoreInvoices,
  persistPendingInvoices,
  syncOrderToFirestore,
  syncPublicUserProfileToFirestore,
  type PendingMonobankStoreInvoice,
} from './firestoreStubs.ts';
import {
  purgeExpiredMonobankInvoicesSqlite,
  purgeExpiredPaymentSessionsSqlite,
} from './sqliteStore.ts';
import { verifyTelegramSubscriberForRequest } from '../src/api/telegramBot.ts';

const DEV_VAULT_KEY_FILE = path.join(DATA_DIR, '.dev-vault-key');
const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function getOrderVaultKey(): Buffer {
  const envSecret = process.env.PAYMENT_ENCRYPTION_KEY?.trim();
  if (process.env.NODE_ENV === 'production') {
    if (!envSecret || envSecret === 'MY_PAYMENT_ENCRYPTION_KEY' || envSecret.length < 16) {
      console.error('CRITICAL: PAYMENT_ENCRYPTION_KEY must be configured with a secure secret (>= 16 chars) in production.');
      process.exit(1);
    }
    return crypto.scryptSync(envSecret, 'dankiv-order-vault-v1', 32);
  }

  if (envSecret && envSecret !== 'MY_PAYMENT_ENCRYPTION_KEY') {
    return crypto.scryptSync(envSecret, 'dankiv-order-vault-v1', 32);
  }

  try {
    ensureDataDirectories();
    if (fs.existsSync(DEV_VAULT_KEY_FILE)) {
      const stored = fs.readFileSync(DEV_VAULT_KEY_FILE, 'utf-8').trim();
      if (stored.length >= 32) {
        return crypto.scryptSync(stored, 'dankiv-order-vault-v1', 32);
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(DEV_VAULT_KEY_FILE, generated, { encoding: 'utf-8', mode: 0o600 });
    console.warn('WARNING: PAYMENT_ENCRYPTION_KEY not set. Generated persistent development vault key in data/.dev-vault-key.');
    return crypto.scryptSync(generated, 'dankiv-order-vault-v1', 32);
  } catch {
    const generated = crypto.randomBytes(32).toString('hex');
    return crypto.scryptSync(generated, 'dankiv-order-vault-v1', 32);
  }
}

export function getOrderHmacKey(): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      getOrderVaultKey(),
      Buffer.from('dankiv-hmac-salt-v1', 'utf8'),
      Buffer.from('order-integrity-v1', 'utf8'),
      32
    )
  );
}

export function hashBuyerEmailLookup(email: string): string {
  return crypto
    .createHash('sha256')
    .update(`dankiv-email-lookup-v1:${email.trim().toLowerCase()}`)
    .digest('hex');
}

export function maskPersonName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Гість';
  return parts
    .map((part) => (part.length <= 1 ? `${part}***` : `${part[0]}${'•'.repeat(Math.min(4, part.length - 1))}`))
    .join(' ');
}

export function maskEmailAddress(email: string): string {
  const clean = email.trim().toLowerCase();
  const atIdx = clean.indexOf('@');
  if (atIdx <= 0) return '***';
  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx + 1);
  const maskedLocal = local.length <= 1 ? `${local}***` : `${local[0]}***${local.length > 3 ? local.slice(-1) : ''}`;
  return `${maskedLocal}@${domain}`;
}

export interface EncryptedPiiPayload {
  buyerName: string;
  buyerEmail: string;
  shipping?: ShippingDetails;
}

export function encryptOrderPii(payload: EncryptedPiiPayload, orderCode: string): EncryptedPiiEnvelope {
  const key = getOrderVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`order-pii:${orderCode}`, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'AES-256-GCM',
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ciphertext: encrypted.toString('base64url'),
  };
}

export function decryptOrderPii(envelope: EncryptedPiiEnvelope, orderCode: string): EncryptedPiiPayload | null {
  try {
    const key = getOrderVaultKey();
    const iv = Buffer.from(envelope.iv, 'base64url');
    const tag = Buffer.from(envelope.tag, 'base64url');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`order-pii:${orderCode}`, 'utf8'));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted) as EncryptedPiiPayload;
  } catch {
    return null;
  }
}

export function signOrderReceipt(params: {
  orderCode: string;
  transactionId: string;
  totalUah: number;
  paidAt: string;
  cardLast4?: string;
}): string {
  const canonical = `${params.orderCode}|${params.transactionId}|${params.totalUah}|${params.paidAt}|${params.cardLast4 || ''}`;
  return crypto.createHmac('sha256', getOrderHmacKey()).update(canonical, 'utf8').digest('hex');
}

export function verifyOrderReceipt(order: OrderRecord): boolean {
  const sig = order.payment?.receiptSignature;
  const txId = order.payment?.transactionId;
  const paidAt = order.payment?.paidAt;
  if (!sig || !txId || !paidAt) return false;
  const expected = signOrderReceipt({
    orderCode: order.orderCode,
    transactionId: txId,
    totalUah: order.totalUah,
    paidAt,
    cardLast4: order.payment?.cardLast4,
  });
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export function generateHighEntropyOrderCode(db: SiteDatabase): string {
  const generateChunk = (len: number) => {
    const bytes = crypto.randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) {
      out += ORDER_CODE_ALPHABET[bytes[i] % ORDER_CODE_ALPHABET.length];
    }
    return out;
  };
  let code = `AD-${generateChunk(4)}-${generateChunk(4)}`;
  while (db.orders.some((o) => o.orderCode.toLowerCase() === code.toLowerCase())) {
    code = `AD-${generateChunk(4)}-${generateChunk(4)}`;
  }
  return code;
}

export function purgeExpiredPaymentSessions(): void {
  purgeExpiredPaymentSessionsSqlite();
}

export interface DecryptedPaymentAssertion {
  sessionId: string;
  nonce: string;
  amountUah: number;
  method: 'card' | 'apple_google_pay' | 'monobank';
  cardBrand?: string;
  cardLast4?: string;
  cardFingerprint?: string;
  buyerName: string;
  buyerEmail: string;
  shipping?: Partial<ShippingDetails>;
  clientIssuedAt?: string;
}

export type MonobankInvoiceStatus =
  | 'created'
  | 'processing'
  | 'hold'
  | 'success'
  | 'failure'
  | 'reversed'
  | 'expired';

let cachedMonobankPubKey: { pem: string; fetchedAtMs: number } | null = null;

export function purgeExpiredMonobankInvoices(): void {
  purgeExpiredMonobankInvoicesSqlite();
}

export function getServerPublicBaseUrl(req: Request): string {
  const envUrl = (process.env.APP_URL || '').trim();
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, '');
  }
  const rawHost = (req.get('x-forwarded-host') || req.get('host') || 'localhost:3000')
    .split(',')[0]
    .trim();
  const protoHeader = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  return `${protoHeader}://${rawHost}`;
}

export async function getMonobankWebhookPubKey(token: string): Promise<string | null> {
  const now = Date.now();
  if (cachedMonobankPubKey && now - cachedMonobankPubKey.fetchedAtMs < 6 * 60 * 60 * 1000) {
    return cachedMonobankPubKey.pem;
  }
  const res = await fetch('https://api.monobank.ua/api/merchant/pubkey', {
    headers: { 'X-Token': token },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { key?: string };
  if (typeof data.key !== 'string' || !data.key.trim()) return null;
  const pem = Buffer.from(data.key.trim(), 'base64').toString('utf8');
  cachedMonobankPubKey = { pem, fetchedAtMs: now };
  return pem;
}

export async function verifyMonobankWebhookSignature(
  rawBody: Buffer | undefined,
  xSignHeader: string | undefined,
  token: string
): Promise<boolean> {
  if (!rawBody || !xSignHeader || !token) return false;
  try {
    const pubKeyPem = await getMonobankWebhookPubKey(token);
    if (!pubKeyPem) return false;
    const signature = Buffer.from(xSignHeader.trim(), 'base64');
    return crypto.verify('sha256', rawBody, pubKeyPem, signature);
  } catch {
    return false;
  }
}

export function buildPurchasedAccess(
  product: RawStoreProduct,
  orderCode: string,
  createdAt: string,
  shipping?: ShippingDetails,
  paymentTransactionId?: string
): PurchasedAccess {
  if (product.type === 'wip_gdoc') {
    return {
      productId: product.id,
      orderCode,
      title: product.title,
      type: product.type,
      purchasedAt: createdAt,
      gdocGuestUrl: product.gdocGuestUrl,
      progressLabel: product.progressLabel,
      paymentTransactionId,
    };
  }
  if (isPhysicalProduct(product.type)) {
    const carrierLabel =
      shipping?.carrier === 'nova_poshta'
        ? 'Нова Пошта'
        : shipping?.carrier === 'ukrposhta'
          ? 'Укрпошта'
          : 'Кур’єрська доставка';
    const shippingSummary = shipping ? `Доставку оформлено · ${carrierLabel}` : 'Фізичне відправлення';
    return {
      productId: product.id,
      orderCode,
      title: product.title,
      type: product.type,
      purchasedAt: createdAt,
      shippingSummary,
      paymentTransactionId,
    };
  }
  return {
    productId: product.id,
    orderCode,
    title: product.title,
    type: product.type,
    purchasedAt: createdAt,
    downloadUrl: `/api/ebooks/${encodeURIComponent(product.id)}/download?order=${encodeURIComponent(orderCode)}`,
    ebookFileName: product.ebookFileName,
    ebookFileSize: product.ebookFileSize,
    formats: product.formats,
    paymentTransactionId,
  };
}

export function createPendingProseOrder(
  db: SiteDatabase,
  work: RawProseWork,
  options: {
    orderCode: string;
    invoiceId: string;
    cleanName: string;
    cleanEmail: string;
    effectivePriceUah: number;
    guestUid?: string;
  }
): OrderRecord {
  const createdAt = new Date().toISOString();
  const paymentSummary: PaymentSummary = {
    status: 'pending',
    providerLabel: 'monobank Acquiring',
    method: 'monobank',
    encryptionProtocol: 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
    transactionId: options.invoiceId,
    paidAt: '',
  };

  const encryptedPii = encryptOrderPii(
    {
      buyerName: options.cleanName,
      buyerEmail: options.cleanEmail,
    },
    options.orderCode
  );

  const pendingOrder: OrderRecord = {
    orderCode: options.orderCode,
    ...(options.guestUid ? { guestUid: options.guestUid } : {}),
    buyerName: maskPersonName(options.cleanName),
    buyerEmail: maskEmailAddress(options.cleanEmail),
    buyerNameMasked: maskPersonName(options.cleanName),
    buyerEmailMasked: maskEmailAddress(options.cleanEmail),
    buyerEmailHash: hashBuyerEmailLookup(options.cleanEmail),
    encryptedPii,
    createdAt,
    totalUah: options.effectivePriceUah,
    payment: paymentSummary,
    items: [],
    pendingProseId: work.id,
  };

  db.orders.unshift(pendingOrder);
  saveDatabase(db, { flushDelayMs: 0, slices: [], ordersDirty: [pendingOrder.orderCode] });
  return pendingOrder;
}

export function finalizeProsePaidOrder(
  db: SiteDatabase,
  work: RawProseWork,
  options: {
    cleanName: string;
    cleanEmail: string;
    effectivePriceUah: number;
    providerLabel: string;
    transactionId: string;
    orderCode: string;
    encryptionProtocol?: string;
    guestUid?: string;
  }
): { orderCode: string; unlockedAccess: PurchasedAccess; orderRecord: OrderRecord } {
  const existing = db.orders.find((o) => o.orderCode === options.orderCode);
  if (existing && existing.payment?.status === 'paid' && existing.items.length > 0) {
    return {
      orderCode: existing.orderCode,
      unlockedAccess: existing.items[0],
      orderRecord: existing,
    };
  }

  const paidAt = new Date().toISOString();
  const orderCode = options.orderCode;
  const receiptSignature = signOrderReceipt({
    orderCode,
    transactionId: options.transactionId,
    totalUah: options.effectivePriceUah,
    paidAt,
  });

  const paymentSummary: PaymentSummary = {
    status: 'paid',
    providerLabel: options.providerLabel,
    method: 'monobank',
    encryptionProtocol: options.encryptionProtocol || 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
    receiptSignature,
    transactionId: options.transactionId,
    paidAt,
  };

  const unlockedAccess: PurchasedAccess = {
    productId: work.id,
    proseId: work.id,
    orderCode,
    title: work.title,
    type: 'prose_access',
    purchasedAt: paidAt,
    paymentTransactionId: options.transactionId,
    hasPdf: Boolean(work.pdfStorageKey),
    pdfFileName: work.pdfFileName,
    pdfFileSize: work.pdfFileSize,
  };

  let targetOrder: OrderRecord;
  if (existing) {
    existing.payment = paymentSummary;
    existing.items = [unlockedAccess];
    delete existing.pendingProseId;
    targetOrder = existing;
  } else {
    const encryptedPii = encryptOrderPii(
      {
        buyerName: options.cleanName,
        buyerEmail: options.cleanEmail,
      },
      orderCode
    );
    targetOrder = {
      orderCode,
      ...(options.guestUid ? { guestUid: options.guestUid } : {}),
      buyerName: maskPersonName(options.cleanName),
      buyerEmail: maskEmailAddress(options.cleanEmail),
      buyerNameMasked: maskPersonName(options.cleanName),
      buyerEmailMasked: maskEmailAddress(options.cleanEmail),
      buyerEmailHash: hashBuyerEmailLookup(options.cleanEmail),
      encryptedPii,
      createdAt: paidAt,
      totalUah: options.effectivePriceUah,
      payment: paymentSummary,
      items: [unlockedAccess],
    };
    db.orders.unshift(targetOrder);
  }

  const effectiveGuestUid = targetOrder.guestUid || options.guestUid;
  if (effectiveGuestUid) {
    const acc = db.guestAccounts.find((g) => g.uid === effectiveGuestUid);
    if (acc) {
      acc.purchasesCount = Math.round(Number(acc.purchasesCount) || 0) + 1;
      acc.updatedAt = paidAt;
    }
  }

  saveDatabase(db, { flushDelayMs: 0, slices: ['community'], ordersDirty: [targetOrder.orderCode] });
  return { orderCode, unlockedAccess, orderRecord: targetOrder };
}

export function finalizePendingStoreOrder(
  db: SiteDatabase,
  pending: PendingMonobankStoreInvoice
): { orderRecord: OrderRecord; unlockedItems: PurchasedAccess[] } {
  const existing = db.orders.find((o) => o.orderCode === pending.orderCode);
  if (existing && existing.payment?.status === 'paid' && existing.items.length > 0) {
    return { orderRecord: existing, unlockedItems: existing.items };
  }

  const paidAt = new Date().toISOString();
  const matchedProducts = pending.productIds
    .map((id: string) => db.products.find((p: RawStoreProduct) => p.id === id))
    .filter((p: RawStoreProduct | undefined): p is RawStoreProduct => Boolean(p));

  const shippingFromEncrypted =
    existing?.encryptedPii
      ? decryptOrderPii(existing.encryptedPii, pending.orderCode)?.shipping
      : undefined;
  const resolvedShipping = pending.shipping || shippingFromEncrypted;

  const unlockedItems = matchedProducts.map((p: RawStoreProduct) =>
    buildPurchasedAccess(p, pending.orderCode, paidAt, resolvedShipping, pending.invoiceId)
  );

  const receiptSignature = signOrderReceipt({
    orderCode: pending.orderCode,
    transactionId: pending.invoiceId,
    totalUah: pending.amountUah,
    paidAt,
  });

  const paymentSummary: PaymentSummary = {
    status: 'paid',
    providerLabel: 'monobank Acquiring',
    method: 'monobank',
    encryptionProtocol: 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
    receiptSignature,
    transactionId: pending.invoiceId,
    paidAt,
  };

  let targetOrder: OrderRecord;
  if (existing) {
    existing.payment = paymentSummary;
    existing.items = unlockedItems;
    delete existing.pendingProductIds;
    targetOrder = existing;
  } else {
    const encryptedPii = encryptOrderPii(
      {
        buyerName: pending.buyerName,
        buyerEmail: pending.buyerEmail,
        shipping: resolvedShipping,
      },
      pending.orderCode
    );
    targetOrder = {
      orderCode: pending.orderCode,
      ...(pending.guestUid ? { guestUid: pending.guestUid } : {}),
      buyerName: maskPersonName(pending.buyerName),
      buyerEmail: maskEmailAddress(pending.buyerEmail),
      buyerNameMasked: maskPersonName(pending.buyerName),
      buyerEmailMasked: maskEmailAddress(pending.buyerEmail),
      buyerEmailHash: hashBuyerEmailLookup(pending.buyerEmail),
      encryptedPii,
      createdAt: paidAt,
      totalUah: pending.amountUah,
      payment: paymentSummary,
      items: unlockedItems,
    };
    db.orders.unshift(targetOrder);
  }

  const effectiveGuestUid = targetOrder.guestUid || pending.guestUid;
  if (effectiveGuestUid) {
    const acc = db.guestAccounts.find((g) => g.uid === effectiveGuestUid);
    if (acc) {
      acc.purchasesCount = Math.round(Number(acc.purchasesCount) || 0) + Math.max(1, unlockedItems.length);
      acc.updatedAt = paidAt;
    }
  }

  saveDatabase(db, { flushDelayMs: 0, slices: ['community'], ordersDirty: [targetOrder.orderCode] });
  return { orderRecord: targetOrder, unlockedItems };
}

export function decryptPaymentEnvelope(
  envelope: Partial<EncryptedPaymentEnvelope> | undefined,
  expectedKind: 'store' | 'prose',
  expectedItemIds: string[],
  expectedAmountUah: number
): { ok: true; payload: DecryptedPaymentAssertion } | { ok: false; status: number; error: string } {
  if (
    !envelope ||
    typeof envelope.sessionId !== 'string' ||
    !envelope.clientPublicKeyJwk ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Відсутній криптографічний конверт оплати (ECDH + AES-256-GCM). Оновіть сторінку та спробуйте знову.',
    };
  }

  const session = paymentSessions.get(envelope.sessionId);
  if (!session) {
    return { ok: false, status: 400, error: 'Платіжну сесію не знайдено або її термін дії завершився.' };
  }
  if (session.consumed) {
    return { ok: false, status: 409, error: 'Цю платіжну сесію вже використано (захист від повторного запиту).' };
  }
  if (Date.now() > session.expiresAtMs) {
    paymentSessions.delete(session.sessionId);
    return { ok: false, status: 408, error: 'Час дії платіжної сесії вийшов. Повторіть підтвердження оплати.' };
  }
  if (session.kind !== expectedKind || session.expectedAmountUah !== expectedAmountUah) {
    return { ok: false, status: 400, error: 'Сума або тип замовлення не збігаються із захищеною сесією.' };
  }
  const expectedSet = new Set(session.expectedItemIds);
  if (expectedItemIds.length !== expectedSet.size || expectedItemIds.some((id) => !expectedSet.has(id))) {
    return { ok: false, status: 400, error: 'Склад замовлення змінився. Оновіть платіжну сесію.' };
  }

  session.consumed = true;

  try {
    const clientJwk = envelope.clientPublicKeyJwk;
    if (clientJwk.kty !== 'EC' || clientJwk.crv !== 'P-256') {
      return { ok: false, status: 400, error: 'Недійсний відкритий ключ пристрою клієнта.' };
    }
    const clientPublicKey = crypto.createPublicKey({ key: clientJwk as crypto.JsonWebKey, format: 'jwk' });
    const sharedSecret = crypto.diffieHellman({
      privateKey: session.serverPrivateKey,
      publicKey: clientPublicKey,
    });
    const derivedAesKey = Buffer.from(
      crypto.hkdfSync(
        'sha256',
        sharedSecret,
        Buffer.from(session.nonce, 'utf8'),
        Buffer.from(`dankiv-e2ee-payment-v1:${session.sessionId}`, 'utf8'),
        32
      )
    );

    const rawIv = Buffer.from(envelope.iv, 'base64url');
    const rawCiphertext = Buffer.from(envelope.ciphertext, 'base64url');
    if (rawIv.length !== 12 || rawCiphertext.length <= 16) {
      return { ok: false, status: 400, error: 'Пошкоджені зашифровані дані платежу.' };
    }

    const authTag = rawCiphertext.subarray(rawCiphertext.length - 16);
    const encData = rawCiphertext.subarray(0, rawCiphertext.length - 16);
    const aad = Buffer.from(`${session.sessionId}|${session.nonce}|${session.expectedAmountUah}`, 'utf8');

    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedAesKey, rawIv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);

    const decryptedJson = Buffer.concat([decipher.update(encData), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decryptedJson) as DecryptedPaymentAssertion;

    if (
      parsed.sessionId !== session.sessionId ||
      parsed.nonce !== session.nonce ||
      Number(parsed.amountUah) !== session.expectedAmountUah
    ) {
      return { ok: false, status: 400, error: 'Порушено цілісність платіжного підтвердження.' };
    }

    return { ok: true, payload: parsed };
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Не вдалося розшифрувати або перевірити підпис оплати. Повторіть спробу.',
    };
  }
}

export function validateMonobankPaymentAmount(paidKopecks: unknown, expectedAmountUah: number): boolean {
  const expectedKopecks = Math.max(100, Math.round(expectedAmountUah * 100));
  return typeof paidKopecks === 'number' && Number.isFinite(paidKopecks) && paidKopecks >= expectedKopecks;
}

interface LiveMonobankJarSnapshot {
  jarId: string;
  extJarId: string;
  title: string;
  ownerName: string;
  amountKopecks: number;
  goalKopecks: number | null;
  closed: boolean;
  fetchedAtMs: number;
}

interface MonobankJarIntent {
  intentId: string;
  jarId: string;
  baselineKopecks: number;
  guestUid?: string;
  displayName: string;
  photoUrl?: string;
  ipHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: 'pending' | 'credited';
  creditedAmountUah?: number;
  donationId?: string;
}

export function registerPaymentRoutes(app: express.Express): void {
  const paySessionLimiter = createEndpointRateLimiter(
    'erl:pay-session',
    25,
    5 * 60 * 1000,
    'Забагато запитів на оплату. Зачекайте кілька секунд.'
  );
  const ordersCreateLimiter = createEndpointRateLimiter(
    'erl:orders-create',
    12,
    10 * 60 * 1000,
    'Перевищено ліміт спроб оплати. Спробуйте через кілька хвилин.'
  );
  const ordersStatusLimiter = createEndpointRateLimiter(
    'erl:orders-status',
    120,
    5 * 60 * 1000,
    'Забагато перевірок статусу оплати. Зачекайте кілька секунд.'
  );
  const ordersRestoreLimiter = createEndpointRateLimiter(
    'erl:orders-restore',
    10,
    10 * 60 * 1000,
    'Забагато спроб відновлення. Зачекайте кілька хвилин.'
  );
  const prosePurchaseLimiter = createEndpointRateLimiter(
    'erl:prose-purchase',
    12,
    10 * 60 * 1000,
    'Забагато спроб оплати. Спробуйте трохи пізніше.'
  );
  const proseStatusLimiter = createEndpointRateLimiter(
    'erl:prose-status',
    120,
    5 * 60 * 1000,
    'Забагато перевірок статусу оплати. Зачекайте кілька секунд.'
  );
  const ebookDownloadLimiter = createEndpointRateLimiter(
    'erl:ebook-download',
    40,
    10 * 60 * 1000,
    'Забагато спроб завантаження. Зачекайте кілька хвилин.'
  );

  // Monobank Jar Automatic Donation Tracking
  const monobankJarIntents = new Map<string, MonobankJarIntent>();
  let cachedMonobankJarSnapshot: LiveMonobankJarSnapshot | null = null;
  let inflightMonobankJarFetch: Promise<LiveMonobankJarSnapshot | null> | null = null;

  const extractMonobankJarShortId = (rawUrl: string): string | null => {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (!parsed.hostname.toLowerCase().endsWith('monobank.ua')) return null;
      const match = parsed.pathname.match(/\/jar\/([a-zA-Z0-9_-]{3,40})/);
      return match?.[1] || null;
    } catch {
      return null;
    }
  };

  const fetchLiveMonobankJarSnapshot = async (
    jarUrl: string,
    forceFresh = false
  ): Promise<LiveMonobankJarSnapshot | null> => {
    const jarId = extractMonobankJarShortId(jarUrl);
    if (!jarId) return null;

    const now = Date.now();
    if (
      !forceFresh &&
      cachedMonobankJarSnapshot &&
      cachedMonobankJarSnapshot.jarId === jarId &&
      now - cachedMonobankJarSnapshot.fetchedAtMs < 2500
    ) {
      return cachedMonobankJarSnapshot;
    }

    if (inflightMonobankJarFetch) {
      return inflightMonobankJarFetch;
    }

    inflightMonobankJarFetch = (async () => {
      try {
        const res = await fetch('https://send.monobank.ua/api/handler', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; DankivJarSync/1.0)',
          },
          body: JSON.stringify({ c: 'hello', clientId: jarId, Pc: '1' }),
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) return cachedMonobankJarSnapshot;
        const data = (await res.json()) as {
          clientType?: string;
          name?: string;
          ownerName?: string;
          jarAmount?: number;
          jarGoal?: number;
          extJarId?: string;
          jarStatus?: string;
        };
        if (typeof data.jarAmount !== 'number' || !Number.isFinite(data.jarAmount)) {
          return cachedMonobankJarSnapshot;
        }
        const snap: LiveMonobankJarSnapshot = {
          jarId,
          extJarId: typeof data.extJarId === 'string' ? data.extJarId : '',
          title: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Банка Монобанку',
          ownerName: typeof data.ownerName === 'string' ? data.ownerName.trim() : '',
          amountKopecks: Math.max(0, Math.round(data.jarAmount)),
          goalKopecks:
            typeof data.jarGoal === 'number' && Number.isFinite(data.jarGoal) && data.jarGoal > 0
              ? Math.round(data.jarGoal)
              : null,
          closed: data.jarStatus === 'CLOSED',
          fetchedAtMs: Date.now(),
        };
        cachedMonobankJarSnapshot = snap;
        return snap;
      } catch {
        return cachedMonobankJarSnapshot;
      } finally {
        inflightMonobankJarFetch = null;
      }
    })();

    return inflightMonobankJarFetch;
  };

  const cleanupExpiredMonobankIntents = () => {
    const now = Date.now();
    for (const [id, item] of monobankJarIntents.entries()) {
      if (now > item.expiresAtMs + 10 * 60 * 1000) {
        monobankJarIntents.delete(id);
      }
    }
    if (monobankJarIntents.size > 300) {
      const oldest = Array.from(monobankJarIntents.entries()).sort(
        (a, b) => a[1].createdAtMs - b[1].createdAtMs
      );
      for (const [id] of oldest.slice(0, oldest.length - 200)) {
        monobankJarIntents.delete(id);
      }
    }
  };

  app.get('/api/monobank/jar/info', async (_req: Request, res: Response) => {
    const db = ensureDatabase();
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    if (!db.monobankJarUrl) {
      res.json({ enabled: false });
      return;
    }
    const snap = await fetchLiveMonobankJarSnapshot(db.monobankJarUrl);
    if (!snap) {
      res.json({ enabled: false });
      return;
    }
    if (!db.monobankJarWatermark || db.monobankJarWatermark.jarId !== snap.jarId) {
      db.monobankJarWatermark = {
        jarId: snap.jarId,
        ...(snap.extJarId ? { extJarId: snap.extJarId } : {}),
        lastAmountKopecks: snap.amountKopecks,
        updatedAt: new Date().toISOString(),
      };
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 2500, slices: ['meta'] });
    }
    res.json({
      enabled: true,
      jarId: snap.jarId,
      title: snap.title,
      ownerName: snap.ownerName,
      amountUah: Math.round(snap.amountKopecks / 100),
      goalUah: snap.goalKopecks ? Math.round(snap.goalKopecks / 100) : null,
      closed: snap.closed,
    });
  });

  app.post('/api/monobank/jar/intent', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`mono-jar-intent:${ipHash}`, 30, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато запитів. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    if (!db.monobankJarUrl) {
      res.status(400).json({ error: 'Посилання на банку Монобанку ще не налаштовано.' });
      return;
    }

    const snap = await fetchLiveMonobankJarSnapshot(db.monobankJarUrl, true);
    if (!snap) {
      res.status(503).json({ error: 'Не вдалося з’єднатися з Monobank для перевірки банки.' });
      return;
    }

    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const rawDonorName = (req.body as { donorName?: unknown })?.donorName;
    const cleanCustomName =
      typeof rawDonorName === 'string' ? rawDonorName.trim().slice(0, 80) : '';
    const resolvedName =
      optionalAuth?.account.displayName || cleanCustomName || 'Добродій';

    const watermarkMatchesJar = db.monobankJarWatermark?.jarId === snap.jarId;
    const baselineKopecks = watermarkMatchesJar
      ? Math.max(snap.amountKopecks, db.monobankJarWatermark!.lastAmountKopecks)
      : snap.amountKopecks;

    if (!watermarkMatchesJar || snap.amountKopecks < db.monobankJarWatermark!.lastAmountKopecks) {
      db.monobankJarWatermark = {
        jarId: snap.jarId,
        ...(snap.extJarId ? { extJarId: snap.extJarId } : {}),
        lastAmountKopecks: snap.amountKopecks,
        updatedAt: new Date().toISOString(),
      };
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 2500, slices: ['meta'] });
    }

    cleanupExpiredMonobankIntents();
    const now = Date.now();
    const intentId = `mji_${now.toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
    const intent: MonobankJarIntent = {
      intentId,
      jarId: snap.jarId,
      baselineKopecks,
      ...(optionalAuth?.account.uid ? { guestUid: optionalAuth.account.uid } : {}),
      displayName: resolvedName,
      ...(optionalAuth?.account.photoUrl ? { photoUrl: optionalAuth.account.photoUrl } : {}),
      ipHash,
      createdAtMs: now,
      expiresAtMs: now + 60 * 60 * 1000,
      status: 'pending',
    };
    monobankJarIntents.set(intentId, intent);

    res.status(201).json({
      intentId,
      jarTitle: snap.title,
      amountUah: Math.round(snap.amountKopecks / 100),
      goalUah: snap.goalKopecks ? Math.round(snap.goalKopecks / 100) : null,
      donorName: resolvedName,
    });
  });

  app.post('/api/monobank/jar/check', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`mono-jar-check:${ipHash}`, 120, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато перевірок. Зачекайте кілька секунд.' });
      return;
    }

    const db = ensureDatabase();
    const { intentId, donorName } = req.body as { intentId?: unknown; donorName?: unknown };
    const cleanIntentId = typeof intentId === 'string' ? intentId.trim() : '';
    const intent = cleanIntentId ? monobankJarIntents.get(cleanIntentId) : undefined;
    if (!intent) {
      res.status(404).json({ status: 'expired' });
      return;
    }
    if (intent.ipHash !== ipHash) {
      const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
      const sameUser = Boolean(
        optionalAuth && intent.guestUid && optionalAuth.account.uid === intent.guestUid
      );
      if (!sameUser) {
        res.status(403).json({ error: 'Немає доступу до цієї перевірки.' });
        return;
      }
    }

    if (intent.status === 'credited') {
      res.json({
        status: 'credited',
        amountUah: intent.creditedAmountUah,
        donationId: intent.donationId,
      });
      return;
    }

    if (Date.now() > intent.expiresAtMs) {
      res.json({ status: 'expired' });
      return;
    }

    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    if (optionalAuth?.account) {
      intent.guestUid = optionalAuth.account.uid;
      intent.displayName = optionalAuth.account.displayName || intent.displayName;
      if (optionalAuth.account.photoUrl) {
        intent.photoUrl = optionalAuth.account.photoUrl;
      }
    } else if (typeof donorName === 'string' && donorName.trim()) {
      intent.displayName = donorName.trim().slice(0, 80);
    }

    const snap = await fetchLiveMonobankJarSnapshot(db.monobankJarUrl, true);
    if (!snap || snap.jarId !== intent.jarId) {
      res.json({ status: 'pending' });
      return;
    }

    const watermarkKopecks =
      db.monobankJarWatermark && db.monobankJarWatermark.jarId === snap.jarId
        ? db.monobankJarWatermark.lastAmountKopecks
        : intent.baselineKopecks;

    if (snap.amountKopecks < watermarkKopecks) {
      db.monobankJarWatermark = {
        jarId: snap.jarId,
        ...(snap.extJarId ? { extJarId: snap.extJarId } : {}),
        lastAmountKopecks: snap.amountKopecks,
        updatedAt: new Date().toISOString(),
      };
      intent.baselineKopecks = snap.amountKopecks;
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 2500, slices: ['meta'] });
      res.json({
        status: 'pending',
        currentJarUah: Math.round(snap.amountKopecks / 100),
      });
      return;
    }

    const effectiveFloor = Math.max(intent.baselineKopecks, watermarkKopecks);
    const deltaKopecks = snap.amountKopecks - effectiveFloor;
    const amountUah = Math.round(deltaKopecks / 100);

    if (deltaKopecks >= 100 && amountUah >= 1) {
      const nowIso = new Date().toISOString();
      const record: DonorRecord = {
        id: `don_mono_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
        ...(intent.guestUid ? { guestUid: intent.guestUid } : {}),
        displayName: intent.displayName || 'Добродій',
        ...(intent.photoUrl ? { photoUrl: intent.photoUrl } : {}),
        amountUah,
        note: 'Донат у банку Монобанку',
        donatedAt: nowIso,
      };

      db.monobankJarWatermark = {
        jarId: snap.jarId,
        ...(snap.extJarId ? { extJarId: snap.extJarId } : {}),
        lastAmountKopecks: snap.amountKopecks,
        updatedAt: nowIso,
      };
      intent.status = 'credited';
      intent.creditedAmountUah = amountUah;
      intent.donationId = record.id;

      db.donations.unshift(record);
      saveDatabase(db, { flushDelayMs: 0, slices: ['meta', 'community'] });

      res.json({
        status: 'credited',
        amountUah,
        donation: record,
        currentJarUah: Math.round(snap.amountKopecks / 100),
      });
      return;
    }

    res.json({
      status: 'pending',
      currentJarUah: Math.round(snap.amountKopecks / 100),
    });
  });

  // Issue single-use cryptographic payment session
  app.post('/api/payments/session', paySessionLimiter, async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }

    const db = ensureDatabase();
    purgeExpiredPaymentSessions();
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);

    const { kind, productIds, proseId } = req.body as {
      kind?: 'store' | 'prose';
      productIds?: string[];
      proseId?: string;
    };

    let expectedItemIds: string[] = [];
    let expectedAmountUah = 0;
    let authorizedDiscountUid: string | undefined;
    let telegramDiscountTgId: number | undefined;

    if (kind === 'prose') {
      if (!proseId || typeof proseId !== 'string') {
        res.status(400).json({ error: 'Не вказано твір для оплати.' });
        return;
      }
      const work = db.prose.find((p) => p.id === proseId);
      const basePriceUah = Number(work?.priceUah || 0);
      if (!work || resolveProseAccessMode(work) !== 'paid' || basePriceUah <= 0) {
        res.status(404).json({ error: 'Платний твір не знайдено.' });
        return;
      }
      const tgSub = await verifyTelegramSubscriberForRequest(req, db, { forceFresh: true });
      if (tgSub.tokenValid && !tgSub.subscribed) {
        res.status(403).json({
          error:
            tgSub.error ||
            'Підписку на Telegram-канал не підтверджено. Підпишіться та перевірте статус знову, щоб отримати знижку.',
        });
        return;
      }
      const pricing = getProseDiscountCalculation(basePriceUah, {
        authDiscountPercent: db.proseAuthDiscountPercent,
        isAuthorized: Boolean(optionalAuth),
        telegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
        isTelegramSubscribed: tgSub.subscribed,
      });
      expectedItemIds = [work.id];
      expectedAmountUah = pricing.finalPriceUah;
      if (pricing.appliedSource === 'telegram' && tgSub.subscribed && tgSub.tgId) {
        telegramDiscountTgId = tgSub.tgId;
      } else if (pricing.appliedSource === 'auth' && optionalAuth && pricing.finalPriceUah < basePriceUah) {
        authorizedDiscountUid = optionalAuth.account.uid;
      }
    } else {
      if (!Array.isArray(productIds) || productIds.length === 0) {
        res.status(400).json({ error: 'Кошик порожній.' });
        return;
      }
      const uniqueIds = Array.from(new Set(productIds.filter((id) => typeof id === 'string')));
      const matched = uniqueIds
        .map((id) => db.products.find((p) => p.id === id))
        .filter((p): p is RawStoreProduct => Boolean(p));
      if (matched.length === 0) {
        res.status(404).json({ error: 'Обрані видання не знайдено.' });
        return;
      }
      expectedItemIds = matched.map((p) => p.id);
      expectedAmountUah = matched.reduce((sum, p) => sum + getEffectivePriceUah(p), 0);
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const serverPublicKeyJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
    const sessionId = `ps_${crypto.randomBytes(12).toString('hex')}`;
    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAtMs = Date.now() + 5 * 60 * 1000;

    paymentSessions.set(sessionId, {
      sessionId,
      nonce,
      serverPrivateKey: privateKey,
      kind: kind === 'prose' ? 'prose' : 'store',
      expectedItemIds,
      expectedAmountUah,
      authorizedDiscountUid,
      telegramDiscountTgId,
      expiresAtMs,
      consumed: false,
    });

    res.json({
      sessionId,
      nonce,
      amountUah: expectedAmountUah,
      expiresAt: new Date(expiresAtMs).toISOString(),
      algorithm: 'ECDH-P256+HKDF-SHA256+AES-256-GCM',
      serverPublicKeyJwk,
      monobankAcquiringAvailable: Boolean(getMonobankToken()),
    });
  });

  app.post('/api/orders', ordersCreateLimiter, async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }

    const monobankToken = getMonobankToken();
    if (!monobankToken) {
      res.status(503).json({
        error: 'Оплата замовлень тимчасово недоступна: платіжний шлюз monobank не налаштовано.',
      });
      return;
    }

    purgeExpiredMonobankInvoices();

    const db = ensureDatabase();
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const { productIds, encryptedPayment } = req.body as {
      productIds?: string[];
      encryptedPayment?: EncryptedPaymentEnvelope;
    };

    if (!Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ error: 'Оберіть хоча б одне видання.' });
      return;
    }

    const uniqueIds = Array.from(new Set(productIds.filter((id) => typeof id === 'string')));
    const matchedProducts = uniqueIds
      .map((id) => db.products.find((p) => p.id === id))
      .filter((p): p is RawStoreProduct => Boolean(p));

    if (matchedProducts.length === 0) {
      res.status(404).json({ error: 'Обрані видання не знайдено.' });
      return;
    }

    const totalUah = matchedProducts.reduce((sum, p) => sum + getEffectivePriceUah(p), 0);
    if (!Number.isFinite(totalUah) || totalUah <= 0) {
      res.status(400).json({ error: 'Сума замовлення має перевищувати 0 грн.' });
      return;
    }

    const decryptedResult = decryptPaymentEnvelope(
      encryptedPayment,
      'store',
      matchedProducts.map((p) => p.id),
      totalUah
    );

    if (!decryptedResult.ok) {
      res.status(decryptedResult.status).json({ error: decryptedResult.error });
      return;
    }

    const assertion = decryptedResult.payload;
    const cleanBuyerName = assertion.buyerName?.trim() || '';
    const cleanBuyerEmail = assertion.buyerEmail?.trim().toLowerCase() || '';

    if (cleanBuyerName.length < 2 || !cleanBuyerEmail.includes('@')) {
      res.status(400).json({ error: 'Будь ласка, вкажіть ім’я та дійсний email.' });
      return;
    }

    const requiresShipping = matchedProducts.some((p) => isPhysicalProduct(p.type));
    let sanitizedShipping: ShippingDetails | undefined;

    if (requiresShipping) {
      const shipping = assertion.shipping;
      const recipientName = shipping?.recipientName?.trim() || cleanBuyerName;
      const phone = shipping?.phone?.trim() || '';
      const city = shipping?.city?.trim() || '';
      const addressOrBranch = shipping?.addressOrBranch?.trim() || '';
      if (shipping?.carrier && shipping.carrier !== 'nova_poshta') {
        res.status(400).json({ error: 'Доставка доступна лише Новою Поштою.' });
        return;
      }
      const carrier = 'nova_poshta' as const;

      if (phone.length < 9 || city.length < 2 || addressOrBranch.length < 3) {
        res.status(400).json({
          error: 'Для доставки фізичної книги або антирамки заповніть телефон, місто та відділення або поштомат Нової Пошти.',
        });
        return;
      }

      sanitizedShipping = {
        recipientName,
        phone,
        carrier,
        city,
        addressOrBranch,
        comment: shipping?.comment?.trim() || undefined,
      };
    }

    if (assertion.method !== 'monobank') {
      res.status(400).json({ error: 'Оплата замовлення доступна лише через Монобанк.' });
      return;
    }

    const orderCode = generateHighEntropyOrderCode(db);
    const baseUrl = getServerPublicBaseUrl(req);
    const redirectUrl = `${baseUrl}/#store`;
    const webHookUrl = `${baseUrl}/api/monobank/webhook`;

    try {
      const monoRes = await fetch('https://api.monobank.ua/api/merchant/invoice/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Token': monobankToken,
        },
        body: JSON.stringify({
          amount: Math.max(100, Math.round(totalUah * 100)),
          ccy: 980,
          merchantPaymInfo: {
            reference: orderCode,
            destination: `Замовлення у крамниці #${orderCode} (${matchedProducts.map((p) => p.title).join(', ').slice(0, 100)})`,
            comment: `Покупець: ${cleanBuyerName}`,
          },
          redirectUrl,
          webHookUrl,
          validity: 3600,
        }),
      });

      const monoData = (await monoRes.json().catch(() => ({}))) as {
        invoiceId?: string;
        pageUrl?: string;
        errText?: string;
      };

      if (!monoRes.ok || !monoData.invoiceId || !monoData.pageUrl) {
        res.status(502).json({
          error: monoData.errText || 'Не вдалося створити рахунок monobank. Спробуйте ще раз.',
        });
        return;
      }

      const createdAt = new Date().toISOString();
      const paymentSummary: PaymentSummary = {
        status: 'pending',
        providerLabel: 'monobank Acquiring',
        method: 'monobank',
        encryptionProtocol: 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
        transactionId: monoData.invoiceId,
        paidAt: '',
      };

      const encryptedPii = encryptOrderPii(
        {
          buyerName: cleanBuyerName,
          buyerEmail: cleanBuyerEmail,
          shipping: sanitizedShipping,
        },
        orderCode
      );

      const pendingOrderRecord: OrderRecord = {
        orderCode,
        ...(optionalAuth?.account.uid ? { guestUid: optionalAuth.account.uid } : {}),
        buyerName: maskPersonName(cleanBuyerName),
        buyerEmail: maskEmailAddress(cleanBuyerEmail),
        buyerNameMasked: maskPersonName(cleanBuyerName),
        buyerEmailMasked: maskEmailAddress(cleanBuyerEmail),
        buyerEmailHash: hashBuyerEmailLookup(cleanBuyerEmail),
        encryptedPii,
        createdAt,
        totalUah,
        payment: paymentSummary,
        items: [],
        pendingProductIds: matchedProducts.map((p) => p.id),
      };

      db.orders.unshift(pendingOrderRecord);
      saveDatabase(db, { flushDelayMs: 0, slices: [], ordersDirty: [pendingOrderRecord.orderCode] });

      const now = Date.now();
      pendingMonobankStoreInvoices.set(monoData.invoiceId, {
        invoiceId: monoData.invoiceId,
        orderCode,
        productIds: matchedProducts.map((p) => p.id),
        amountUah: totalUah,
        buyerName: cleanBuyerName,
        buyerEmail: cleanBuyerEmail,
        shipping: sanitizedShipping,
        ...(optionalAuth?.account.uid ? { guestUid: optionalAuth.account.uid } : {}),
        status: 'created',
        createdAtMs: now,
        expiresAtMs: now + 60 * 60 * 1000,
      });
      persistPendingInvoices();

      res.status(201).json({
        mode: 'acquiring',
        status: 'pending',
        orderCode,
        invoiceId: monoData.invoiceId,
        pageUrl: monoData.pageUrl,
        totalUah,
      });
    } catch {
      res.status(502).json({
        error: 'Тимчасово не вдалося з’єднатися з платіжним сервісом monobank.',
      });
    }
  });

  app.get('/api/orders/monobank/status', ordersStatusLimiter, async (req: Request, res: Response) => {
    purgeExpiredMonobankInvoices();
    const db = ensureDatabase();
    const invoiceId = typeof req.query.invoiceId === 'string' ? req.query.invoiceId.trim() : '';
    const orderCodeQuery = typeof req.query.orderCode === 'string' ? req.query.orderCode.trim() : '';
    if (!invoiceId || !orderCodeQuery) {
      res.status(400).json({ error: 'Відсутній ідентифікатор рахунку або номер замовлення.' });
      return;
    }

    const pending = pendingMonobankStoreInvoices.get(invoiceId);
    if (!pending || pending.orderCode.toLowerCase() !== orderCodeQuery.toLowerCase()) {
      res.status(404).json({ error: 'Рахунок на оплату не знайдено або його термін дії завершився.' });
      return;
    }

    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);

    const buildPaidOrderResponse = (orderRecord: OrderRecord, unlockedItems: PurchasedAccess[]) => ({
      paid: true,
      status: 'success' as const,
      order: {
        orderCode: orderRecord.orderCode,
        createdAt: orderRecord.createdAt,
        totalUah: orderRecord.totalUah,
        payment: orderRecord.payment,
        items: unlockedItems,
      },
    });

    if (pending.finalizedOrderCode) {
      const existingOrder = db.orders.find((o) => o.orderCode === pending.finalizedOrderCode);
      if (existingOrder && existingOrder.payment?.status === 'paid' && existingOrder.items.length > 0) {
        res.json(buildPaidOrderResponse(existingOrder, existingOrder.items));
        return;
      }
    }

    const monobankToken = getMonobankToken();
    if (!monobankToken) {
      res.status(503).json({
        error: 'Платіжний шлюз monobank не налаштовано.',
      });
      return;
    }

    if (pending.status !== 'success') {
      try {
        const statusRes = await fetch(
          `https://api.monobank.ua/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`,
          {
            headers: { 'X-Token': monobankToken },
          }
        );
        if (statusRes.ok) {
          const statusData = (await statusRes.json()) as {
            status?: MonobankInvoiceStatus;
            amount?: number;
            failureReason?: string;
          };
          if (statusData.status === 'success' && !validateMonobankPaymentAmount(statusData.amount, pending.amountUah)) {
            pending.status = 'failure';
            pending.failureReason = 'Сума платежу не відповідає сумі замовлення.';
          } else if (statusData.status) {
            pending.status = statusData.status;
          }
          if (statusData.failureReason) {
            pending.failureReason = statusData.failureReason;
          }
          persistPendingInvoices();
        }
      } catch {
        // Keep current status on transient network failure
      }
    }

    if (pending.status === 'success') {
      const { orderRecord, unlockedItems } = finalizePendingStoreOrder(db, pending);
      pending.finalizedOrderCode = orderRecord.orderCode;
      persistPendingInvoices();

      if (optionalAuth?.account && optionalAuth.firebaseClaims && optionalAuth.firebaseIdToken) {
        if (!orderRecord.guestUid || orderRecord.guestUid === optionalAuth.account.uid) {
          void syncPublicUserProfileToFirestore(
            {
              firebaseUid: optionalAuth.firebaseClaims.uid,
              guestUid: optionalAuth.account.uid,
              displayName: optionalAuth.account.displayName,
              photoUrl: optionalAuth.account.photoUrl,
              likedPoemIds: optionalAuth.account.likedPoemIds,
              likedRadioTrackIds: optionalAuth.account.likedRadioTrackIds,
              totalTimeSeconds: optionalAuth.account.totalTimeSeconds,
              purchasesCount: optionalAuth.account.purchasesCount,
              donorChatText: optionalAuth.account.donorChatText,
            },
            optionalAuth.firebaseIdToken
          );
          void syncOrderToFirestore(
            orderRecord,
            optionalAuth.firebaseClaims.uid,
            optionalAuth.firebaseIdToken
          );
        }
      }

      res.json(buildPaidOrderResponse(orderRecord, unlockedItems));
      return;
    }

    if (pending.status === 'failure' || pending.status === 'expired' || pending.status === 'reversed') {
      const existingOrder = db.orders.find((o) => o.orderCode === pending.orderCode);
      if (existingOrder && existingOrder.payment && existingOrder.payment.status === 'pending') {
        existingOrder.payment.status = pending.status === 'expired' ? 'expired' : 'failed';
        saveDatabase(db, { slices: [], ordersDirty: [existingOrder.orderCode] });
      }
    }

    res.json({
      paid: false,
      status: pending.status,
      failureReason: pending.failureReason,
    });
  });

  app.post('/api/prose/:id/read', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const work = db.prose.find((p) => p.id === id);
    if (!work) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const accessMode = resolveProseAccessMode(work);
    const workChapters = Array.isArray(work.chapters) ? work.chapters : [];

    if (accessMode === 'public') {
      res.json({ id: work.id, content: work.content, chapters: workChapters, unlocked: true });
      return;
    }

    if (accessMode === 'authorized') {
      const guestAuth = await authenticateGuestRequest(req, db);
      if (!guestAuth.ok) {
        res.status(401).json({
          error: 'Увійдіть в акаунт, щоб читати твори для авторизованих читачів.',
          requiresAuth: true,
        });
        return;
      }
      if (
        guestAuth.provider === 'google' &&
        !work.content &&
        (!work.chapters || work.chapters.length === 0)
      ) {
        const bearer = extractBearerToken(req);
        if (bearer) {
          const hydrated = await hydrateSingleAuthorizedProse(db, work.id, bearer);
          if (hydrated) saveDatabase(db, { slices: ['prose'] });
        }
      }
      res.json({
        id: work.id,
        content: work.content,
        chapters: Array.isArray(work.chapters) ? work.chapters : [],
        unlocked: true,
      });
      return;
    }

    const bearer = extractBearerToken(req);
    if (bearer) {
      try {
        const claims = await verifyFirebaseIdToken(bearer);
        if (isVerifiedAdminClaims(claims)) {
          res.json({
            id: work.id,
            content: work.content,
            chapters: workChapters,
            unlocked: true,
            adminPreview: true,
          });
          return;
        }
      } catch {
        // Fall through to order verification
      }
    }

    const rawCode = typeof req.body?.orderCode === 'string' ? req.body.orderCode.trim().toLowerCase() : '';
    if (!rawCode) {
      res.status(403).json({ error: 'Для читання повного тексту придбайте доступ.' });
      return;
    }

    const matchedOrder = db.orders.find(
      (o) =>
        o.orderCode.toLowerCase() === rawCode &&
        o.payment?.status === 'paid' &&
        o.items.some((it) => it.proseId === work.id || it.productId === work.id)
    );

    if (!matchedOrder) {
      res.status(403).json({ error: 'Замовлення для доступу до цього твору не знайдено.' });
      return;
    }

    res.json({
      id: work.id,
      content: work.content,
      chapters: workChapters,
      orderCode: matchedOrder.orderCode,
      unlocked: true,
    });
  });

  app.post('/api/prose/:id/monobank/invoice', prosePurchaseLimiter, async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }

    const monobankToken = getMonobankToken();
    if (!monobankToken) {
      res.status(503).json({
        error: 'Оплата платної прози тимчасово недоступна: платіжний шлюз monobank не налаштовано.',
      });
      return;
    }

    purgeExpiredMonobankInvoices();

    const db = ensureDatabase();
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const { id } = req.params;
    const work = db.prose.find((p) => p.id === id);
    if (!work) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const basePriceUah = Number(work.priceUah || 0);
    if (resolveProseAccessMode(work) !== 'paid' || basePriceUah <= 0) {
      res.status(400).json({ error: 'Цей твір не потребує оплати.' });
      return;
    }

    const tgSub = await verifyTelegramSubscriberForRequest(req, db, { forceFresh: true });
    if (tgSub.tokenValid && !tgSub.subscribed) {
      res.status(403).json({
        error:
          tgSub.error ||
          'Підписку на Telegram-канал не підтверджено. Оновіть перевірку підписки для оплати зі знижкою.',
      });
      return;
    }

    const pricing = getProseDiscountCalculation(basePriceUah, {
      authDiscountPercent: db.proseAuthDiscountPercent,
      isAuthorized: Boolean(optionalAuth),
      telegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
      isTelegramSubscribed: tgSub.subscribed,
    });
    const effectivePriceUah = pricing.finalPriceUah;

    const { encryptedPayment } = req.body as {
      encryptedPayment?: EncryptedPaymentEnvelope;
    };

    if (encryptedPayment?.sessionId) {
      const pendingSession = paymentSessions.get(encryptedPayment.sessionId);
      if (
        pendingSession?.authorizedDiscountUid &&
        optionalAuth?.account.uid !== pendingSession.authorizedDiscountUid
      ) {
        res.status(403).json({
          error: 'Для оплати зі знижкою авторизованого читача підтвердіть активну сесію входу.',
        });
        return;
      }
      if (
        pendingSession?.telegramDiscountTgId &&
        (!tgSub.subscribed || tgSub.tgId !== pendingSession.telegramDiscountTgId)
      ) {
        res.status(403).json({
          error: 'Для оплати зі знижкою підписника Telegram-каналу підтвердіть активну підписку.',
        });
        return;
      }
    }

    const decryptedResult = decryptPaymentEnvelope(
      encryptedPayment,
      'prose',
      [work.id],
      effectivePriceUah
    );
    if (!decryptedResult.ok) {
      res.status(decryptedResult.status).json({ error: decryptedResult.error });
      return;
    }

    const assertion = decryptedResult.payload;
    if (assertion.method !== 'monobank') {
      res.status(400).json({ error: 'Оплата прози доступна лише через monobank.' });
      return;
    }

    const cleanName = assertion.buyerName?.trim() || '';
    const cleanEmail = assertion.buyerEmail?.trim().toLowerCase() || '';
    if (cleanName.length < 2 || !cleanEmail.includes('@')) {
      res.status(400).json({ error: 'Будь ласка, вкажіть коректне ім’я та email.' });
      return;
    }

    const orderCode = generateHighEntropyOrderCode(db);
    const baseUrl = getServerPublicBaseUrl(req);
    const redirectUrl = `${baseUrl}/#prose/${encodeURIComponent(work.id)}`;
    const webHookUrl = `${baseUrl}/api/monobank/webhook`;

    try {
      const monoRes = await fetch('https://api.monobank.ua/api/merchant/invoice/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Token': monobankToken,
        },
        body: JSON.stringify({
          amount: Math.max(100, Math.round(effectivePriceUah * 100)),
          ccy: 980,
          merchantPaymInfo: {
            reference: orderCode,
            destination: `Повний доступ до твору «${work.title}»`,
            comment: `Читач: ${cleanName}`,
          },
          redirectUrl,
          webHookUrl,
          validity: 3600,
        }),
      });

      const monoData = (await monoRes.json().catch(() => ({}))) as {
        invoiceId?: string;
        pageUrl?: string;
        errText?: string;
      };

      if (!monoRes.ok || !monoData.invoiceId || !monoData.pageUrl) {
        res.status(502).json({
          error: monoData.errText || 'Не вдалося створити рахунок monobank. Спробуйте ще раз.',
        });
        return;
      }

      createPendingProseOrder(db, work, {
        orderCode,
        invoiceId: monoData.invoiceId,
        cleanName,
        cleanEmail,
        effectivePriceUah,
        guestUid: optionalAuth?.account.uid,
      });

      const now = Date.now();
      pendingMonobankProseInvoices.set(monoData.invoiceId, {
        invoiceId: monoData.invoiceId,
        proseId: work.id,
        orderCode,
        amountUah: effectivePriceUah,
        buyerName: cleanName,
        buyerEmail: cleanEmail,
        ...(optionalAuth?.account.uid ? { guestUid: optionalAuth.account.uid } : {}),
        status: 'created',
        createdAtMs: now,
        expiresAtMs: now + 60 * 60 * 1000,
      });
      persistPendingInvoices();

      res.status(201).json({
        mode: 'acquiring',
        invoiceId: monoData.invoiceId,
        pageUrl: monoData.pageUrl,
        orderCode,
        amountUah: effectivePriceUah,
      });
    } catch {
      res.status(502).json({
        error: 'Тимчасово не вдалося з’єднатися з платіжним сервісом monobank.',
      });
    }
  });

  app.get('/api/prose/:id/monobank/status', proseStatusLimiter, async (req: Request, res: Response) => {
    purgeExpiredMonobankInvoices();
    const db = ensureDatabase();
    const { id } = req.params;
    const invoiceId = typeof req.query.invoiceId === 'string' ? req.query.invoiceId.trim() : '';
    if (!invoiceId) {
      res.status(400).json({ error: 'Відсутній ідентифікатор рахунку monobank.' });
      return;
    }

    const work = db.prose.find((p) => p.id === id);
    if (!work) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const pending = pendingMonobankProseInvoices.get(invoiceId);
    if (!pending || pending.proseId !== work.id) {
      res.status(404).json({ error: 'Рахунок на оплату не знайдено або його термін дії завершився.' });
      return;
    }

    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);

    if (pending.finalizedOrderCode) {
      const existingOrder = db.orders.find((o) => o.orderCode === pending.finalizedOrderCode);
      if (existingOrder && existingOrder.payment?.status === 'paid') {
        const unlockedItem =
          existingOrder.items.find((it) => it.proseId === work.id || it.productId === work.id) || {
            productId: work.id,
            proseId: work.id,
            orderCode: pending.finalizedOrderCode,
            title: work.title,
            type: 'prose_access' as const,
            purchasedAt: existingOrder.createdAt || new Date().toISOString(),
            paymentTransactionId: invoiceId,
            hasPdf: Boolean(work.pdfStorageKey),
            pdfFileName: work.pdfFileName,
            pdfFileSize: work.pdfFileSize,
          };

        res.json({
          paid: true,
          status: 'success',
          orderCode: pending.finalizedOrderCode,
          unlockedAccess: unlockedItem,
          content: work.content,
          chapters: Array.isArray(work.chapters) ? work.chapters : [],
          hasPdf: Boolean(work.pdfStorageKey),
          pdfFileName: work.pdfFileName,
          pdfFileSize: work.pdfFileSize,
        });
        return;
      }
    }

    const monobankToken = getMonobankToken();
    if (!monobankToken) {
      res.status(503).json({ error: 'Платіжний шлюз monobank не налаштовано.' });
      return;
    }

    if (pending.status !== 'success') {
      try {
        const statusRes = await fetch(
          `https://api.monobank.ua/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`,
          {
            headers: { 'X-Token': monobankToken },
          }
        );
        if (statusRes.ok) {
          const statusData = (await statusRes.json()) as {
            status?: MonobankInvoiceStatus;
            amount?: number;
            failureReason?: string;
          };
          if (statusData.status === 'success' && !validateMonobankPaymentAmount(statusData.amount, pending.amountUah)) {
            pending.status = 'failure';
            pending.failureReason = 'Сума платежу не відповідає вартості твору.';
          } else if (statusData.status) {
            pending.status = statusData.status;
          }
          if (statusData.failureReason) {
            pending.failureReason = statusData.failureReason;
          }
          persistPendingInvoices();
        }
      } catch {
        // Keep cached status
      }
    }

    if (pending.status === 'success') {
      const { orderCode, unlockedAccess, orderRecord } = finalizeProsePaidOrder(db, work, {
        cleanName: pending.buyerName,
        cleanEmail: pending.buyerEmail,
        effectivePriceUah: pending.amountUah,
        providerLabel: 'monobank Acquiring',
        transactionId: pending.invoiceId,
        orderCode: pending.orderCode,
        encryptionProtocol: 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
        guestUid: pending.guestUid,
      });
      pending.finalizedOrderCode = orderCode;
      persistPendingInvoices();

      if (optionalAuth?.account && optionalAuth.firebaseClaims && optionalAuth.firebaseIdToken) {
        if (!orderRecord.guestUid || orderRecord.guestUid === optionalAuth.account.uid) {
          void syncPublicUserProfileToFirestore(
            {
              firebaseUid: optionalAuth.firebaseClaims.uid,
              guestUid: optionalAuth.account.uid,
              displayName: optionalAuth.account.displayName,
              photoUrl: optionalAuth.account.photoUrl,
              likedPoemIds: optionalAuth.account.likedPoemIds,
              likedRadioTrackIds: optionalAuth.account.likedRadioTrackIds,
              totalTimeSeconds: optionalAuth.account.totalTimeSeconds,
              purchasesCount: optionalAuth.account.purchasesCount,
              donorChatText: optionalAuth.account.donorChatText,
            },
            optionalAuth.firebaseIdToken
          );
          void syncOrderToFirestore(
            orderRecord,
            optionalAuth.firebaseClaims.uid,
            optionalAuth.firebaseIdToken
          );
        }
      }

      res.json({
        paid: true,
        status: 'success',
        orderCode,
        unlockedAccess,
        content: work.content,
        chapters: Array.isArray(work.chapters) ? work.chapters : [],
        hasPdf: Boolean(work.pdfStorageKey),
        pdfFileName: work.pdfFileName,
        pdfFileSize: work.pdfFileSize,
      });
      return;
    }

    if (pending.status === 'failure' || pending.status === 'expired' || pending.status === 'reversed') {
      const existingOrder = db.orders.find((o) => o.orderCode === pending.orderCode);
      if (existingOrder && existingOrder.payment && existingOrder.payment.status === 'pending') {
        existingOrder.payment.status = pending.status === 'expired' ? 'expired' : 'failed';
        saveDatabase(db, { slices: [], ordersDirty: [existingOrder.orderCode] });
      }
    }

    res.json({
      paid: false,
      status: pending.status,
      failureReason: pending.failureReason,
    });
  });

  app.post('/api/monobank/webhook', async (req: Request, res: Response) => {
    const monobankToken = getMonobankToken();
    if (!monobankToken) {
      emitProductionAlert({
        alertType: 'MONOBANK_WEBHOOK_REJECTED',
        severity: 'WARNING',
        message: 'Monobank webhook received while MONOBANK_TOKEN is not configured',
      });
      res.status(200).json({ ok: true });
      return;
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const xSign = req.get('x-sign');
    const signatureValid = await verifyMonobankWebhookSignature(rawBody, xSign, monobankToken);
    if (!signatureValid) {
      emitProductionAlert({
        alertType: 'MONOBANK_WEBHOOK_REJECTED',
        severity: 'ERROR',
        message: 'Monobank webhook rejected: invalid X-Sign signature',
        context: {
          hasXSign: Boolean(xSign),
          bodyBytes: rawBody?.length || 0,
        },
      });
      res.status(401).json({ error: 'Invalid monobank signature' });
      return;
    }

    ensurePendingInvoicesLoaded();

    const payload = req.body as {
      invoiceId?: string;
      status?: MonobankInvoiceStatus;
      amount?: number;
      failureReason?: string;
    };

    if (payload.invoiceId) {
      const pendingProse = pendingMonobankProseInvoices.get(payload.invoiceId);
      if (pendingProse) {
        if (payload.status === 'success' && !validateMonobankPaymentAmount(payload.amount, pendingProse.amountUah)) {
          pendingProse.status = 'failure';
          pendingProse.failureReason = 'Сума платежу не відповідає вартості твору.';
          emitProductionAlert({
            alertType: 'MONOBANK_PAYMENT_MISMATCH',
            severity: 'ERROR',
            message: 'Monobank prose webhook amount mismatch',
            context: {
              invoiceId: payload.invoiceId,
              expectedUah: pendingProse.amountUah,
              receivedAmount: payload.amount,
            },
          });
        } else if (payload.status) {
          pendingProse.status = payload.status;
        }
        if (payload.failureReason) {
          pendingProse.failureReason = payload.failureReason;
        }
        if (pendingProse.status === 'success' && !pendingProse.finalizedOrderCode) {
          const db = ensureDatabase();
          const work = db.prose.find((p) => p.id === pendingProse.proseId);
          if (work) {
            const { orderCode } = finalizeProsePaidOrder(db, work, {
              cleanName: pendingProse.buyerName,
              cleanEmail: pendingProse.buyerEmail,
              effectivePriceUah: pendingProse.amountUah,
              providerLabel: 'monobank Acquiring',
              transactionId: pendingProse.invoiceId,
              orderCode: pendingProse.orderCode,
              encryptionProtocol: 'monobank Acquiring · ECDH P-256 + AES-256-GCM',
              guestUid: pendingProse.guestUid,
            });
            pendingProse.finalizedOrderCode = orderCode;
          }
        } else if (pendingProse.status === 'failure' || pendingProse.status === 'expired' || pendingProse.status === 'reversed') {
          const db = ensureDatabase();
          const existingOrder = db.orders.find((o) => o.orderCode === pendingProse.orderCode);
          if (existingOrder && existingOrder.payment && existingOrder.payment.status === 'pending') {
            existingOrder.payment.status = pendingProse.status === 'expired' ? 'expired' : 'failed';
            saveDatabase(db, { slices: [], ordersDirty: [existingOrder.orderCode] });
          }
        }
        persistPendingInvoices();
      }

      const pendingStore = pendingMonobankStoreInvoices.get(payload.invoiceId);
      if (pendingStore) {
        if (payload.status === 'success' && !validateMonobankPaymentAmount(payload.amount, pendingStore.amountUah)) {
          pendingStore.status = 'failure';
          pendingStore.failureReason = 'Сума платежу не відповідає сумі замовлення.';
          emitProductionAlert({
            alertType: 'MONOBANK_PAYMENT_MISMATCH',
            severity: 'ERROR',
            message: 'Monobank store webhook amount mismatch',
            context: {
              invoiceId: payload.invoiceId,
              expectedUah: pendingStore.amountUah,
              receivedAmount: payload.amount,
            },
          });
        } else if (payload.status) {
          pendingStore.status = payload.status;
        }
        if (payload.failureReason) {
          pendingStore.failureReason = payload.failureReason;
        }
        if (pendingStore.status === 'success' && !pendingStore.finalizedOrderCode) {
          const db = ensureDatabase();
          const { orderRecord } = finalizePendingStoreOrder(db, pendingStore);
          pendingStore.finalizedOrderCode = orderRecord.orderCode;
        } else if (pendingStore.status === 'failure' || pendingStore.status === 'expired' || pendingStore.status === 'reversed') {
          const db = ensureDatabase();
          const existingOrder = db.orders.find((o) => o.orderCode === pendingStore.orderCode);
          if (existingOrder && existingOrder.payment && existingOrder.payment.status === 'pending') {
            existingOrder.payment.status = pendingStore.status === 'expired' ? 'expired' : 'failed';
            saveDatabase(db, { slices: [], ordersDirty: [existingOrder.orderCode] });
          }
        }
        persistPendingInvoices();
      }
    }

    res.status(200).json({ ok: true });
  });

  app.post('/api/prose/:id/purchase', prosePurchaseLimiter, async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    if (!getMonobankToken()) {
      res.status(503).json({
        error: 'Оплата платної прози тимчасово недоступна: платіжний шлюз monobank не налаштовано.',
      });
      return;
    }
    res.status(400).json({ error: 'Для оплати використовуйте рахунок monobank.' });
  });

  const handleProsePdfRequest = async (req: Request, res: Response, orderCodeInput?: string) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const work = db.prose.find((p) => p.id === id);
    if (!work || !work.pdfStorageKey) {
      res.status(404).json({ error: 'PDF-документ для цього твору не знайдено.' });
      return;
    }

    const accessMode = resolveProseAccessMode(work);
    if (accessMode === 'authorized') {
      const guestAuth = await authenticateGuestRequest(req, db);
      if (!guestAuth.ok) {
        res.status(401).json({ error: 'Увійдіть в акаунт гостя, щоб відкрити PDF-документ.' });
        return;
      }
    } else if (accessMode === 'paid') {
      let authorized = false;
      const bearer = extractBearerToken(req);
      if (bearer) {
        try {
          const claims = await verifyFirebaseIdToken(bearer);
          if (isVerifiedAdminClaims(claims)) {
            authorized = true;
          }
        } catch {
          // Fall back to order code check
        }
      }

      if (!authorized) {
        const normalizedCode = (orderCodeInput || '').trim().toLowerCase();
        if (normalizedCode) {
          authorized = db.orders.some(
            (o) =>
              o.orderCode.toLowerCase() === normalizedCode &&
              o.payment?.status === 'paid' &&
              o.items.some((it) => it.proseId === work.id || it.productId === work.id)
          );
        }
      }

      if (!authorized) {
        res.status(403).json({ error: 'Доступ до PDF-документа можливий лише після оплати.' });
        return;
      }
    }

    const pdfPath = resolveConfinedFilePath(PROSE_PDF_DIR, work.pdfStorageKey);
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      res.status(404).json({ error: 'Файл PDF не знайдено на сервері.' });
      return;
    }

    const downloadName = work.pdfFileName || `${work.id}.pdf`;
    const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, '_');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );
    res.sendFile(pdfPath);
  };

  app.post('/api/prose/:id/pdf', async (req: Request, res: Response) => {
    const orderCode = typeof req.body?.orderCode === 'string' ? req.body.orderCode : '';
    await handleProsePdfRequest(req, res, orderCode);
  });

  app.get('/api/prose/:id/pdf', async (req: Request, res: Response) => {
    const orderCode = typeof req.query?.order === 'string' ? req.query.order : '';
    await handleProsePdfRequest(req, res, orderCode);
  });

  app.post('/api/orders/restore', ordersRestoreLimiter, (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }

    const db = ensureDatabase();
    const { query } = req.body as { query?: string };
    const normalized = query?.trim().toLowerCase();
    if (!normalized) {
      res.status(400).json({ error: 'Введіть email або номер замовлення.' });
      return;
    }

    const lookupHash = normalized.includes('@') ? hashBuyerEmailLookup(normalized) : null;
    const matchedOrders = db.orders.filter((o) => {
      if (o.payment?.status !== 'paid' || !Array.isArray(o.items) || o.items.length === 0) {
        return false;
      }
      if (o.orderCode.toLowerCase() === normalized) return true;
      if (lookupHash && o.buyerEmailHash === lookupHash) return true;
      if (!o.encryptedPii && o.buyerEmail.toLowerCase() === normalized) return true;
      return false;
    });

    const items = matchedOrders.flatMap((o) =>
      o.items.map((item) => ({
        ...item,
        shippingSummary: item.shippingSummary
          ? item.shippingSummary.replace(/\([^)]*\)/g, '').split('·')[0].trim() || 'Доставку оформлено'
          : undefined,
      }))
    );
    res.json({ items, ordersCount: matchedOrders.length });
  });

  app.get('/api/ebooks/:id/download', ebookDownloadLimiter, async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const { order, preview } = req.query as { order?: string; preview?: string };
    const product = db.products.find((p) => p.id === id && p.type === 'ebook');
    if (!product) {
      res.status(404).send('Видання не знайдено');
      return;
    }

    if (preview === 'author') {
      const authResult = await authenticateAdminRequest(req);
      if (!authResult.ok) {
        res.status(authResult.status).json({ error: authResult.error });
        return;
      }
    } else {
      const normalizedOrder = typeof order === 'string' ? order.trim().toLowerCase() : '';
      const isPurchased =
        normalizedOrder.length > 0 &&
        db.orders.some(
          (o) =>
            o.orderCode.toLowerCase() === normalizedOrder &&
            o.payment?.status === 'paid' &&
            o.items.some((item) => item.productId === id)
        );
      if (!isPurchased) {
        res.status(403).send('Файл доступний для завантаження лише після оплати електронної книги.');
        return;
      }
    }

    if (product.ebookStorageKey) {
      const safeStoragePath = path.join(EBOOKS_DIR, path.basename(product.ebookStorageKey));
      if (fs.existsSync(safeStoragePath)) {
        const downloadName = product.ebookFileName || `${product.id}${path.extname(safeStoragePath)}`;
        const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, '_');
        res.setHeader('Content-Type', product.ebookMimeType || 'application/octet-stream');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
        );
        res.sendFile(safeStoragePath);
        return;
      }
    }

    const fileContent =
      product.ebookFullText ||
      `${product.title}\nАвтор: Андрій Даньків\n\n${product.description}\n\n${product.sampleExcerpt}`;

    const safeFileName = `${product.id}-andrij-dankiv.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
    res.send(fileContent);
  });
}
