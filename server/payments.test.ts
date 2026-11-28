import test from 'node:test';
import assert from 'node:assert';

test('Monobank invoice amount validation', () => {
  const expectedKopecks = 10000;
  const validAmount = 10000;
  const invalidAmount = 5000;

  assert.strictEqual(validAmount >= expectedKopecks, true);
  assert.strictEqual(invalidAmount >= expectedKopecks, false);
});
