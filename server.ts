import 'dotenv/config';
import compression from 'compression';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { registerTelegramBotRoutes } from './src/api/telegramBot.ts';
import { ensureWeeklyWinnersUpToDate } from './server/weeklyHighlights.ts';
import {
  hydratePublicCatalogFromFirestore,
  syncAdminTelegramTokenToFirestore,
} from './server/firestoreStubs.ts';
import {
  DATA_DIR,
  checkRateLimit,
  ensureDatabase,
  getClientIpHash,
  registerUploadRoutes,
  saveDatabase,
  verifySameOrigin,
} from './server/db.ts';
import {
  decodeBase64UrlJson,
  ensureAllPublicStateHydrated,
  ensureCloudPoemLikesHydrated,
  extractBearerToken,
  registerAuthRoutes,
} from './server/auth.ts';
import { createBadgeLookup, registerCatalogRoutes } from './server/catalog.ts';
import { registerPaymentRoutes } from './server/payments.ts';
import {
  registerAuthorMiddlewareAndRawRoutes,
  registerAuthorRoutes,
} from './server/author.ts';
import {
  attachChatWebSocket,
  broadcastGlobalChatRefresh,
  registerChatRoutes,
} from './server/chat.ts';
import { createSecurityMiddleware } from './server/security.ts';
import { emitProductionAlert, reportProductionError } from './server/monitoring.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const portArgIndex = process.argv.indexOf('--port');
  const cliPort = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : NaN;
  const PORT =
    (Number.isFinite(cliPort) && cliPort > 0 ? cliPort : 0) || Number(process.env.PORT) || 3000;

  const initialDb = ensureDatabase();
  void hydratePublicCatalogFromFirestore(initialDb)
    .then((hydrated) => {
      if (hydrated) {
        saveDatabase(initialDb, {
          slices: ['meta', 'poems', 'prose', 'blog', 'products', 'radio'],
        });
      }
    })
    .catch((err) => {
      console.error('Initial catalog hydration error:', err);
    });
  void ensureCloudPoemLikesHydrated().catch((err) => {
    console.error('Initial poem likes hydration error:', err);
  });

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(createSecurityMiddleware(process.env.NODE_ENV === 'production'));
  app.use(compression({ threshold: 512 }));

  // Permissions-Policy & no-store caching for payment, auth, and protected routes
  // Note: public GET /api/leaderboard and anonymous GET /api/chat/messages manage
  // Vary + stale-while-revalidate caching directly inside their respective modules.
  app.use((req: Request, res: Response, next) => {
    res.setHeader('Permissions-Policy', 'interest-cohort=()');
    if (
      req.path.startsWith('/api/payments') ||
      req.path.startsWith('/api/orders') ||
      req.path.startsWith('/api/author') ||
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/api/guest') ||
      req.path.startsWith('/api/users') ||
      req.path.startsWith('/api/poems/my-submissions') ||
      req.path.startsWith('/api/poems/submissions') ||
      /^\/api\/prose\/[^/]+\/(read|pdf|purchase)$/.test(req.path) ||
      /^\/api\/ebooks\/[^/]+\/download$/.test(req.path)
    ) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  });

  // Author guard + raw binary uploads MUST be mounted before express.json()
  registerAuthorMiddlewareAndRawRoutes(app);

  app.use(
    express.json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  // Domain route modules
  registerUploadRoutes(app);
  registerTelegramBotRoutes(app, {
    ensureDatabase,
    saveDatabase,
    dataDir: DATA_DIR,
    extractBearerToken,
    onSyncTelegramBotTokenToCloud: syncAdminTelegramTokenToFirestore,
    verifySameOrigin,
    checkRateLimit,
    getClientIpHash,
    decodeBase64UrlJson,
  });
  registerAuthRoutes(app, {
    createBadgeLookup,
    getBroadcastGlobalChatRefresh: () => broadcastGlobalChatRefresh,
  });
  registerCatalogRoutes(app);
  registerPaymentRoutes(app);
  registerAuthorRoutes(app);
  registerChatRoutes(app);

  const httpServer = http.createServer(app);
  attachChatWebSocket(httpServer);

  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ...(hmrDisabled ? { ws: false } : {}),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    const precompressedMimeMap: Record<string, string> = {
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json; charset=utf-8',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
      '.woff2': 'font/woff2',
      '.ico': 'image/x-icon',
      '.txt': 'text/plain; charset=utf-8',
      '.xml': 'application/xml; charset=utf-8',
    };

    const createPrecompressedMiddleware = (
      rootDir: string,
      cacheControlForFile: (relPath: string) => string
    ) => {
      const resolvedRoot = path.resolve(rootDir);
      return (req: Request, res: Response, next: () => void) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          next();
          return;
        }
        let decodedPath: string;
        try {
          decodedPath = decodeURIComponent(req.path || '/');
        } catch {
          next();
          return;
        }
        const relPath = decodedPath.replace(/^\/+/, '');
        if (!relPath || decodedPath.endsWith('/')) {
          next();
          return;
        }
        const fullPath = path.resolve(resolvedRoot, relPath);
        if (!fullPath.startsWith(resolvedRoot + path.sep)) {
          next();
          return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        const contentType = precompressedMimeMap[ext];
        if (!contentType) {
          next();
          return;
        }

        const acceptEncoding = String(req.headers['accept-encoding'] || '');
        let encodedPath: string | null = null;
        let encoding: 'br' | 'gzip' | null = null;
        if (/\bbr\b/i.test(acceptEncoding) && fs.existsSync(`${fullPath}.br`)) {
          encodedPath = `${fullPath}.br`;
          encoding = 'br';
        } else if (/\bgzip\b/i.test(acceptEncoding) && fs.existsSync(`${fullPath}.gz`)) {
          encodedPath = `${fullPath}.gz`;
          encoding = 'gzip';
        }

        if (!encodedPath || !encoding) {
          next();
          return;
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Cache-Control', cacheControlForFile(relPath));
        res.sendFile(encodedPath);
      };
    };

    const assetsDir = path.join(distPath, 'assets');
    const srcAssetsDir = path.join(distPath, 'src/assets');

    app.use(
      '/assets',
      createPrecompressedMiddleware(assetsDir, () => 'public, max-age=31536000, immutable'),
      express.static(assetsDir, {
        maxAge: '1y',
        immutable: true,
      })
    );
    app.use(
      '/src/assets',
      createPrecompressedMiddleware(srcAssetsDir, () => 'public, max-age=31536000, immutable'),
      express.static(srcAssetsDir, {
        maxAge: '1y',
        immutable: true,
      })
    );
    app.use(
      createPrecompressedMiddleware(distPath, (relPath) =>
        relPath === 'index.html' ||
        relPath === 'sw.js' ||
        relPath === 'manifest.webmanifest' ||
        relPath.startsWith('workbox-')
          ? 'no-cache'
          : 'public, max-age=3600, stale-while-revalidate=86400'
      ),
      express.static(distPath, {
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'manifest.webmanifest' ||
            base.startsWith('workbox-')
          ) {
            res.setHeader('Cache-Control', 'no-cache');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
          }
        },
      })
    );
    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.use((err: unknown, req: Request, res: Response, _next: express.NextFunction) => {
    reportProductionError('Unhandled Express request error', err, {
      method: req.method,
      path: req.path,
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Внутрішня помилка сервера.' });
    }
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
    void ensureAllPublicStateHydrated(ensureDatabase()).catch((err) => {
      reportProductionError('Initial public state hydration failed', err);
    });
    const weeklyTimer = setInterval(() => {
      try {
        const db = ensureDatabase();
        const weeklyRes = ensureWeeklyWinnersUpToDate(db);
        if (weeklyRes.changed) {
          saveDatabase(db, { slices: ['poems', 'prose'] });
        }
      } catch (err) {
        reportProductionError('Periodic weekly rollover check failed', err);
      }
    }, 60 * 60 * 1000);
    weeklyTimer.unref();
  });
}

process.on('uncaughtException', (err) => {
  emitProductionAlert({
    alertType: 'UNHANDLED_SERVER_ERROR',
    severity: 'CRITICAL',
    message: 'Uncaught server exception',
    error: err,
  });
});

process.on('unhandledRejection', (reason) => {
  emitProductionAlert({
    alertType: 'UNHANDLED_SERVER_ERROR',
    severity: 'ERROR',
    message: 'Unhandled promise rejection',
    error: reason,
  });
});

startServer().catch((err) => {
  emitProductionAlert({
    alertType: 'UNHANDLED_SERVER_ERROR',
    severity: 'CRITICAL',
    message: 'Failed to start server',
    error: err,
  });
  process.exit(1);
});
