import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { checkRateLimit, createEndpointRateLimiter } from './db.ts';
import { emitProductionAlert, parseSentryDsn } from './monitoring.ts';
import { buildCspDirectives, createSecurityMiddleware } from './security.ts';
import { getSqliteDb } from './sqliteStore.ts';

test('buildCspDirectives enforces strict production script-src without unsafe-inline or wildcards', () => {
  const prod = buildCspDirectives(true);
  assert.strictEqual(prod.scriptSrc.includes("'unsafe-inline'"), false);
  assert.strictEqual(prod.scriptSrc.includes("'unsafe-eval'"), false);
  assert.strictEqual(prod.scriptSrc.includes('*'), false);
  assert.deepStrictEqual(prod.objectSrc, ["'none'"]);
  assert.deepStrictEqual(prod.baseUri, ["'self'"]);
  assert.deepStrictEqual(prod.scriptSrcAttr, ["'none'"]);

  assert.ok(prod.scriptSrc.includes('https://w.soundcloud.com'));
  assert.ok(prod.scriptSrc.includes('https://apis.google.com'));
  assert.ok(prod.frameSrc.includes('https://www.youtube.com'));
  assert.ok(prod.frameSrc.includes('https://w.soundcloud.com'));
  assert.ok(prod.frameSrc.includes('https://www.google.com'));
  assert.ok(prod.connectSrc.includes('https://api.monobank.ua'));
  assert.ok(prod.connectSrc.includes('https://*.googleapis.com'));
  assert.ok(prod.connectSrc.includes('https://www.google.com'));
  assert.ok(Array.isArray(prod.upgradeInsecureRequests));

  const dev = buildCspDirectives(false);
  assert.strictEqual(dev.upgradeInsecureRequests, null);
  assert.strictEqual(dev.scriptSrc.includes("'unsafe-inline'"), true);
});

test('createSecurityMiddleware emits Content-Security-Policy, HSTS, and safe cross-origin headers', async () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(createSecurityMiddleware(true));
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const res = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.strictEqual(res.status, 200);

    const csp = res.headers.get('content-security-policy') || '';
    const hsts = res.headers.get('strict-transport-security') || '';
    assert.ok(csp.includes("default-src 'self'"));
    assert.ok(csp.includes("object-src 'none'"));
    assert.ok(csp.includes('https://api.monobank.ua'));
    assert.ok(csp.includes('https://www.youtube.com'));
    assert.ok(csp.includes('https://w.soundcloud.com'));
    assert.ok(csp.includes('https://*.googleapis.com'));
    assert.strictEqual(csp.includes("script-src 'self' 'unsafe-inline'"), false);

    assert.strictEqual(hsts, 'max-age=31536000; includeSubDomains; preload');
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.strictEqual(res.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    assert.strictEqual(res.headers.get('x-frame-options'), null);
    assert.strictEqual(res.headers.get('x-powered-by'), null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('server.ts mounts createSecurityMiddleware (helmet CSP) globally', () => {
  const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.match(serverSrc, /import\s*\{[^}]*createSecurityMiddleware[^}]*\}\s*from\s*'\.\/server\/security\.ts'/);
  assert.match(serverSrc, /app\.use\(createSecurityMiddleware\(/);
});

test('Rate limiter blocks excessive requests with HTTP 429 and Retry-After', async () => {
  const bucketKey = `test-bucket-${Date.now()}`;
  const prefix = `test-erl-${Date.now()}`;
  const sqlite = getSqliteDb();

  try {
    assert.strictEqual(checkRateLimit(bucketKey, 2, 60_000).allowed, true);
    assert.strictEqual(checkRateLimit(bucketKey, 2, 60_000).allowed, true);
    const blocked = checkRateLimit(bucketKey, 2, 60_000);
    assert.strictEqual(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec >= 1);

    const app = express();
    app.post('/limited', createEndpointRateLimiter(prefix, 2, 60_000, 'Too many requests'), (_req, res) => {
      res.json({ ok: true });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const url = `http://127.0.0.1:${address.port}/limited`;

      const r1 = await fetch(url, { method: 'POST' });
      const r2 = await fetch(url, { method: 'POST' });
      const r3 = await fetch(url, { method: 'POST' });

      assert.strictEqual(r1.status, 200);
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r3.status, 429);
      const body = (await r3.json()) as { error?: string };
      assert.strictEqual(body.error, 'Too many requests');
      assert.ok(r3.headers.get('ratelimit') || r3.headers.get('retry-after'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    sqlite.prepare('DELETE FROM rate_limits WHERE bucket_key = ? OR bucket_key LIKE ?').run(bucketKey, `${prefix}:%`);
  }
});

test('Monitoring parses Sentry DSN and emits structured alerts without throwing', () => {
  assert.strictEqual(parseSentryDsn(''), null);
  assert.strictEqual(parseSentryDsn('not-a-url'), null);
  const parsed = parseSentryDsn('https://abc123@o42.ingest.sentry.io/98765');
  assert.deepStrictEqual(parsed, {
    storeUrl: 'https://o42.ingest.sentry.io/api/98765/store/',
    publicKey: 'abc123',
  });

  assert.doesNotThrow(() => {
    emitProductionAlert({
      alertType: 'SQLITE_SAVE_FAILED',
      severity: 'CRITICAL',
      message: 'Failed to save to SQLite',
      error: new Error('SQLITE_BUSY'),
    });
    emitProductionAlert({
      alertType: 'MONOBANK_WEBHOOK_REJECTED',
      severity: 'WARNING',
      message: 'Monobank webhook rejected',
      context: { reason: 'invalid_signature' },
    });
  });
});
