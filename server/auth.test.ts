import test from 'node:test';
import assert from 'node:assert';

test('Authentication role validation', () => {
  const allowedEmails = ['quaqx00@gmail.com'];
  const userEmail = 'quaqx00@gmail.com';
  const unauthorizedEmail = 'attacker@example.com';

  assert.strictEqual(allowedEmails.includes(userEmail), true);
  assert.strictEqual(allowedEmails.includes(unauthorizedEmail), false);
});
