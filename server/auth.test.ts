import test from 'node:test';
import assert from 'node:assert';
import { isAdminEmailAddress, getAdminEmails, isVerifiedAdminClaims } from './auth.ts';

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
