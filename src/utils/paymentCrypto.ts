import type {
  EncryptedPaymentEnvelope,
  PaymentSessionResponse,
  PurchasedAccess,
  ShippingDetails,
} from '../types.ts';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildMonobankJarPayUrl(
  jarUrl: string,
  amountUah?: number,
  comment?: string
): string {
  const trimmed = jarUrl.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return '';
  try {
    const url = new URL(trimmed);
    if (url.hostname.endsWith('monobank.ua') && url.pathname.includes('/jar/')) {
      if (typeof amountUah === 'number' && Number.isFinite(amountUah) && amountUah > 0) {
        url.searchParams.set('a', String(Math.round(amountUah)));
      }
      if (comment && comment.trim()) {
        url.searchParams.set('t', comment.trim().slice(0, 120));
      }
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

export interface SealPaymentParams {
  kind: 'store' | 'prose';
  productIds?: string[];
  proseId?: string;
  method: 'monobank';
  buyerName: string;
  buyerEmail: string;
  shipping?: Partial<ShippingDetails>;
  authToken?: string | null;
  telegramDiscountToken?: string | null;
}

export async function createEncryptedPaymentEnvelope(
  params: SealPaymentParams
): Promise<{
  envelope: EncryptedPaymentEnvelope;
  amountUah: number;
  monobankAcquiringAvailable: boolean;
}> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Ваш браузер або з’єднання не підтримує сучасне апаратне шифрування Web Crypto (HTTPS).');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.authToken) {
    headers.Authorization = `Bearer ${params.authToken}`;
  }
  if (params.telegramDiscountToken) {
    headers['X-Telegram-Discount-Token'] = params.telegramDiscountToken;
  }

  const sessionRes = await fetch('/api/payments/session', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      kind: params.kind,
      productIds: params.productIds,
      proseId: params.proseId,
    }),
  });

  const sessionData = (await sessionRes.json()) as Partial<PaymentSessionResponse> & { error?: string };
  if (
    !sessionRes.ok ||
    !sessionData.sessionId ||
    !sessionData.nonce ||
    !sessionData.serverPublicKeyJwk ||
    typeof sessionData.amountUah !== 'number'
  ) {
    throw new Error(sessionData.error || 'Не вдалося відкрити захищену платіжну сесію.');
  }

  const { sessionId, nonce, amountUah, serverPublicKeyJwk } = sessionData;
  if (serverPublicKeyJwk.kty !== 'EC' || serverPublicKeyJwk.crv !== 'P-256') {
    throw new Error('Некоректний криптографічний ключ платіжного шлюзу.');
  }

  const serverPubKey = await window.crypto.subtle.importKey(
    'jwk',
    serverPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const clientKeyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const clientPublicKeyJwk = await window.crypto.subtle.exportKey('jwk', clientKeyPair.publicKey);
  const sharedBits = await window.crypto.subtle.deriveBits(
    { name: 'ECDH', public: serverPubKey },
    clientKeyPair.privateKey,
    256
  );

  const hkdfBaseKey = await window.crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, [
    'deriveKey',
  ]);
  const enc = new TextEncoder();
  const aesKey = await window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode(nonce),
      info: enc.encode(`dankiv-e2ee-payment-v1:${sessionId}`),
    },
    hkdfBaseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const aad = enc.encode(`${sessionId}|${nonce}|${amountUah}`);

  const payload = {
    sessionId,
    nonce,
    amountUah,
    method: 'monobank' as const,
    buyerName: params.buyerName.trim(),
    buyerEmail: params.buyerEmail.trim().toLowerCase(),
    shipping: params.shipping,
    clientIssuedAt: new Date().toISOString(),
  };

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aad,
      tagLength: 128,
    },
    aesKey,
    enc.encode(JSON.stringify(payload))
  );

  return {
    envelope: {
      sessionId,
      clientPublicKeyJwk,
      iv: toBase64Url(iv),
      ciphertext: toBase64Url(new Uint8Array(encryptedBuffer)),
    },
    amountUah,
    monobankAcquiringAvailable: Boolean(sessionData.monobankAcquiringAvailable),
  };
}

export function sanitizePurchasedAccessForDevice(items: PurchasedAccess[]): PurchasedAccess[] {
  return items.map((item) => ({
    ...item,
    // Ensure no raw phone numbers or street addresses are persisted in localStorage
    shippingSummary: item.shippingSummary
      ? item.shippingSummary.replace(/\([^)]*\)/g, '').split('·')[0].trim() || 'Доставку оформлено'
      : undefined,
  }));
}
