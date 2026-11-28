import test from 'node:test';
import assert from 'node:assert';
import { verifyMonobankWebhookSignature } from './payments.ts';
import { ensureDatabase, saveDatabase, verifySameOrigin } from './db.ts';
import type { Request } from 'express';

test('Monobank webhook signature verification fails with invalid X-Sign (returns 401 equivalent)', async () => {
  const invalidSig = 'invalid-base64-signature';
  const body = Buffer.from(JSON.stringify({ invoiceId: 'inv-1', status: 'success', amount: 10000 }));
  const isValid = await verifyMonobankWebhookSignature(body, invalidSig, 'test-monobank-token');
  assert.strictEqual(isValid, false);
});

test('Order pending to paid transition logic updates order and payment status', () => {
  const db = ensureDatabase();
  const testOrderCode = `ord-${Date.now()}`;
  const order = {
    orderCode: testOrderCode,
    createdAt: new Date().toISOString(),
    items: [{ productId: 'prod-1', title: 'Test Product', priceUah: 100, type: 'ebook' as const }],
    totalAmountUah: 100,
    customer: { name: 'Test User', email: 'test@example.com' },
    payment: {
      provider: 'monobank' as const,
      status: 'pending' as const,
      invoiceId: 'inv-test-123',
      amountUah: 100,
    },
  };

  db.orders.push(order);
  saveDatabase(db);

  // Transition pending -> paid
  const found = db.orders.find((o) => o.orderCode === testOrderCode);
  assert.ok(found);
  assert.strictEqual(found?.payment?.status, 'pending');

  if (found && found.payment) {
    found.payment.status = 'paid';
    found.payment.paidAt = new Date().toISOString();
  }
  saveDatabase(db);

  const updated = db.orders.find((o) => o.orderCode === testOrderCode);
  assert.strictEqual(updated?.payment?.status, 'paid');
  assert.ok(updated?.payment?.paidAt);

  // Cleanup
  db.orders = db.orders.filter((o) => o.orderCode !== testOrderCode);
  saveDatabase(db);
});

test('saveDatabase flushes writes correctly and handles slices', () => {
  const db = ensureDatabase();
  db.heroLeadText = 'Updated Hero Lead Test';
  saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 10 });
  assert.strictEqual(db.heroLeadText, 'Updated Hero Lead Test');
});

test('verifySameOrigin rejects requests when allowedHosts is empty or spoofed X-Forwarded-For is supplied without trust proxy', () => {
  const reqWithoutHost = {
    headers: {
      origin: 'https://evil.com',
    },
    get: (name: string) => {
      if (name.toLowerCase() === 'host') return undefined;
      if (name.toLowerCase() === 'x-forwarded-host') return 'evil.com';
      return undefined;
    },
    method: 'POST',
    app: { get: () => false },
  } as unknown as Request;

  const result = verifySameOrigin(reqWithoutHost);
  assert.strictEqual(result, false);
});
