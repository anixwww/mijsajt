import assert from 'node:assert';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { buildCspDirectives, createSecurityMiddleware } from './security.ts';

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
  assert.ok(prod.connectSrc.includes('https://api.monobank.ua'));
  assert.ok(prod.connectSrc.includes('https://*.googleapis.com'));
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
