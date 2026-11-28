import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import {
  getAdminEmails,
  hashGuestPin,
  isAdminEmailAddress,
  issueGuestSessionToken,
  isVerifiedAdminClaims,
  registerAuthRoutes,
} from './auth.ts';
import { ensureDatabase, saveDatabase } from './db.ts';
import type { GuestAccountRecord } from './seedData.ts';

test('Authentication role validation and admin emails from environment', () => {
  process.env.ADMIN_EMAILS = 'admin@example.com, superadmin@example.com';

  const emails = getAdminEmails();
  assert.strictEqual(emails.has('admin@example.com'), true);
  assert.strictEqual(emails.has('superadmin@example.com'), true);
  assert.strictEqual(emails.has('attacker@example.com'), false);

  assert.strictEqual(isAdminEmailAddress('admin@example.com'), true);
  assert.strictEqual(isAdminEmailAddress('ATTACKER@example.com'), false);

  // Test custom claims
  const claimsAdmin = {
    uid: '123',
    email: 'admin@example.com',
    emailVerified: true,
    name: 'Admin',
    picture: null,
  };
  assert.strictEqual(isVerifiedAdminClaims(claimsAdmin), true);

  const claimsCustomRole = {
    uid: '456',
    email: 'random@example.com',
    emailVerified: true,
    name: 'Custom',
    picture: null,
    role: 'admin',
  };
  assert.strictEqual(isVerifiedAdminClaims(claimsCustomRole), true);

  const claimsUnauthorized = {
    uid: '789',
    email: 'attacker@example.com',
    emailVerified: true,
    name: 'Attacker',
    picture: null,
  };
  assert.strictEqual(isVerifiedAdminClaims(claimsUnauthorized), false);
});

test('Guest PIN login rejects legacy 4-digit PIN and rejects old 6-digit PIN after PIN change', async () => {
  const db = ensureDatabase();
  const uid = `guest_pin_test_${Date.now()}`;
  const email = `${uid}@example.com`;
  const { pinHash, pinSalt } = hashGuestPin('654321');
  const testAccount: GuestAccountRecord = {
    uid,
    displayName: 'PIN Test Reader',
    email,
    likedPoemIds: [],
    totalTimeSeconds: 0,
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    pinHash,
    pinSalt,
  };
  db.guestAccounts.push(testAccount);
  const initialToken = issueGuestSessionToken(testAccount, 'google');

  const app = express();
  app.use(express.json());
  registerAuthRoutes(app, {
    createBadgeLookup: () => ({ get: () => undefined }),
    getBroadcastGlobalChatRefresh: () => null,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const originHeaders = {
      'Content-Type': 'application/json',
      Origin: baseUrl,
    };

    // 1. Legacy 4-digit PIN is rejected with 400
    const legacyRes = await fetch(`${baseUrl}/api/guest/pin-login`, {
      method: 'POST',
      headers: originHeaders,
      body: JSON.stringify({ email, pin: '1234' }),
    });
    assert.strictEqual(legacyRes.status, 400);

    // 2. Active 6-digit PIN succeeds
    const validRes = await fetch(`${baseUrl}/api/guest/pin-login`, {
      method: 'POST',
      headers: originHeaders,
      body: JSON.stringify({ email, pin: '654321' }),
    });
    assert.strictEqual(validRes.status, 200);
    const validJson = (await validRes.json()) as { sessionToken?: string };
    assert.ok(validJson.sessionToken);

    // 3. Rotate PIN from 654321 -> 789012
    const rotateRes = await fetch(`${baseUrl}/api/guest/pin/set`, {
      method: 'POST',
      headers: {
        ...originHeaders,
        Authorization: `Bearer ${initialToken}`,
      },
      body: JSON.stringify({ currentPin: '654321', pin: '789012' }),
    });
    assert.strictEqual(rotateRes.status, 200);

    // 4. Old PIN (654321) must be rejected with 401
    const oldPinRes = await fetch(`${baseUrl}/api/guest/pin-login`, {
      method: 'POST',
      headers: originHeaders,
      body: JSON.stringify({ email, pin: '654321' }),
    });
    assert.strictEqual(oldPinRes.status, 401);

    // 5. New PIN (789012) succeeds
    const newPinRes = await fetch(`${baseUrl}/api/guest/pin-login`, {
      method: 'POST',
      headers: originHeaders,
      body: JSON.stringify({ email, pin: '789012' }),
    });
    assert.strictEqual(newPinRes.status, 200);
  } finally {
    db.guestAccounts = db.guestAccounts.filter((acc) => acc.uid !== uid);
    saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 0, slices: ['community'] });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
