import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  DEFAULT_AUTHOR_PHOTO_URL,
  DEFAULT_MONOBANK_CARD_LABEL,
  DEFAULT_MONOBANK_EMPTY_TEXT,
  DEFAULT_MONOBANK_MODAL_SUBTITLE,
  DEFAULT_MONOBANK_MODAL_TEXT,
  DEFAULT_MONOBANK_MODAL_TITLE,
  DEFAULT_SOCIAL_LINKS,
  type DonorRecord,
  type FeedbackRecord,
  type PoemSubmissionRecord,
  type RawBlogPost,
  type RawPoem,
  type RawProseWork,
  type RawStoreProduct,
  type SiteDatabase,
} from './seedData.ts';
import {
  normalizeHomeRepeatersConfig,
  type AuthorAnalyticsReport,
  type InterviewLinkItem,
  type MonthlySelection,
  type MonthlySelectionTrack,
  type OrderRecord,
  type ProseAccessMode,
  type ProseChapter,
  type ProseStatus,
  type ProseTag,
  type ProseTagColor,
  type ProseWork,
  type RadioStationId,
  type RadioTrack,
  type SocialLinkItem,
  type WeeklyMusicSelection,
  type WeeklyMusicTrack,
} from '../src/types.ts';
import { computeProseWorkPages, countProseWords } from '../src/utils/prosePagination.ts';
import {
  getFirstFormattedExcerptLine,
  preserveFormattedText,
} from '../src/utils/textFormatting.ts';
import {
  extractYouTubeVideoId,
  getYouTubeThumbnailUrl,
  getYouTubeWatchUrl,
  isValidBlogPhotoUrl,
  stripBlogMediaTokens,
} from '../src/utils/blogMedia.ts';
import { applyCloudTelegramBotToken } from '../src/api/telegramBot.ts';
import { buildVisitStatisticsReport } from '../src/api/visitAnalytics.ts';
import { getWeekPeriodForDate, getWeekPeriodForWeekKey } from './weeklyHighlights.ts';
import {
  cloudSyncState,
  deleteDonationInFirestore,
  deletePoemSubmissionInFirestore,
  deleteProseSubmissionInFirestore,
  deleteRadioTrackInFirestore,
  deleteReviewsForTargetInFirestore,
  deleteSiteFeedbackInFirestore,
  deleteWeeklyMusicSelectionInFirestore,
  hydrateAdminOrdersFromFirestore,
  hydrateAdminPoemSubmissionsFromFirestore,
  hydrateAdminProseSubmissionsFromFirestore,
  hydrateAdminSecretsFromFirestore,
  hydrateAdminSiteFeedbackFromFirestore,
  hydratePublicCatalogFromFirestore,
  queueDatabaseSyncToFirestore,
  saveMediaAssetToFirestore,
  syncDonationToFirestore,
  syncPoemSubmissionToFirestore,
  syncProseSubmissionToFirestore,
  syncSingleWeeklyMusicSelectionInFirestore,
  syncSiteFeedbackToFirestore,
} from './firestoreStubs.ts';
import {
  EBOOKS_DIR,
  PROSE_PDF_DIR,
  UPLOADS_DIR,
  createEmptyAnalytics,
  ensureDatabase,
  fetchPinnedImageUrl,
  getCatalogRevision,
  missingUploadCache,
  normalizeProseStatus,
  normalizeProseTagColor,
  resolveConfinedFilePath,
  resolveProseAccessMode,
  saveDatabase,
  seenAnalyticsSessionsSet,
  validateExternalImageUrlForProxy,
  visitorIpSet,
} from './db.ts';
import type { DbSliceKey } from './sqliteStore.ts';
import {
  authenticateAdminRequest,
  cloudPoemLikesByPoemId,
  cloudPoemLikesByUid,
  extractBearerToken,
} from './auth.ts';
import {
  decryptOrderPii,
  maskEmailAddress,
  maskPersonName,
  verifyOrderReceipt,
} from './payments.ts';
import {
  enrichBlogPost,
  enrichProseForAuthor,
  getValidProseTagIds,
  isSoundCloudPlaylistUrl,
  normalizeSoundCloudInputUrl,
  resolvePoemSoundCloudTracksInput,
  resolveSoundCloudPlaylistTracks,
  resolveSoundCloudShortUrl,
  resolveSoundCloudTrackMetadata,
  sanitizePoemImagePalette,
  sanitizePoemImageUrl,
  sanitizePoemSoundCloudTrack,
  sanitizePoemSoundCloudTracks,
} from './catalog.ts';

const ALLOWED_EBOOK_EXTS = new Set([
  '.epub',
  '.pdf',
  '.fb2',
  '.mobi',
  '.azw3',
  '.txt',
  '.rtf',
  '.docx',
  '.zip',
]);

const UK_MONTH_NAMES = [
  'Січень',
  'Лютий',
  'Березень',
  'Квітень',
  'Травень',
  'Червень',
  'Липень',
  'Серпень',
  'Вересень',
  'Жовтень',
  'Листопад',
  'Грудень',
];

function formatDefaultMonthTitle(monthKey: string): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey;
  const monthIndex = Number(match[2]) - 1;
  const label = UK_MONTH_NAMES[monthIndex] || match[2];
  return `${label} ${match[1]}`;
}

function getSortedSelections(db: SiteDatabase): MonthlySelection[] {
  return [...(db.monthlySelections || [])].sort((a, b) =>
    a.monthKey !== b.monthKey ? b.monthKey.localeCompare(a.monthKey) : a.order - b.order
  );
}

function sortWeeklyMusicSelections(list: WeeklyMusicSelection[]): WeeklyMusicSelection[] {
  return [...list].sort((a, b) =>
    b.periodStart !== a.periodStart
      ? b.periodStart.localeCompare(a.periodStart)
      : b.createdAt.localeCompare(a.createdAt)
  );
}

function sanitizeWeeklyMusicPhotoList(rawPhotos: unknown): string[] {
  if (!Array.isArray(rawPhotos)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of rawPhotos) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, 1000);
    if (!trimmed) continue;
    if (!/^(\/uploads\/[^\s]+|https?:\/\/[^\s]+)$/i.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 12) break;
  }
  return out;
}

function sanitizeWeeklyMusicTrackList(rawTracks: unknown): WeeklyMusicTrack[] {
  if (!Array.isArray(rawTracks)) return [];
  const seenUrl = new Set<string>();
  const out: WeeklyMusicTrack[] = [];
  for (const raw of rawTracks) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<WeeklyMusicTrack>;
    const scUrl = typeof item.soundcloudUrl === 'string' ? item.soundcloudUrl.trim().slice(0, 500) : '';
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 200) : '';
    if (!/^https?:\/\/.+/.test(scUrl) || !title) continue;
    const key = scUrl.toLowerCase();
    if (seenUrl.has(key)) continue;
    seenUrl.add(key);
    const idRaw =
      typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(item.id.trim())
        ? item.id.trim()
        : `wmt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const embedTargetUrl =
      typeof item.embedTargetUrl === 'string' && /^https?:\/\/.+/.test(item.embedTargetUrl.trim())
        ? item.embedTargetUrl.trim().slice(0, 500)
        : scUrl;
    const artworkUrl =
      typeof item.artworkUrl === 'string' && /^https?:\/\/.+/.test(item.artworkUrl.trim())
        ? item.artworkUrl.trim().slice(0, 500)
        : undefined;
    out.push({
      id: idRaw,
      title,
      artist:
        typeof item.artist === 'string' && item.artist.trim()
          ? item.artist.trim().slice(0, 140)
          : 'SoundCloud',
      soundcloudUrl: scUrl,
      embedTargetUrl,
      ...(artworkUrl ? { artworkUrl } : {}),
    });
    if (out.length >= 50) break;
  }
  return out;
}

async function resolveWeeklySoundCloudInputs(
  rawUrl?: unknown,
  rawUrls?: unknown
): Promise<
  | { ok: true; tracks: WeeklyMusicTrack[]; playlistTitle: string | null }
  | { ok: false; error: string }
> {
  const candidateInputs: string[] = [];
  if (typeof rawUrl === 'string' && rawUrl.trim()) {
    for (const part of rawUrl.split(/[\r\n]+/)) {
      const clean = part.trim();
      if (clean) candidateInputs.push(clean);
    }
  }
  if (Array.isArray(rawUrls)) {
    for (const item of rawUrls) {
      if (typeof item === 'string' && item.trim()) {
        candidateInputs.push(item.trim());
      }
    }
  }
  const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 50);
  if (uniqueInputs.length === 0) {
    return { ok: false, error: 'Вставте посилання на пісню або плейлист SoundCloud.' };
  }

  const canonicalInputs: string[] = [];
  for (const rawInput of uniqueInputs) {
    const normalized = normalizeSoundCloudInputUrl(rawInput);
    if (!normalized) {
      return {
        ok: false,
        error:
          'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/track або /sets/playlist).',
      };
    }
    canonicalInputs.push(await resolveSoundCloudShortUrl(normalized));
  }

  const resolvedTracks: WeeklyMusicTrack[] = [];
  const singleUrls: string[] = [];
  let playlistTitle: string | null = null;

  for (const canonical of canonicalInputs) {
    if (isSoundCloudPlaylistUrl(canonical)) {
      const playlistRes = await resolveSoundCloudPlaylistTracks(canonical, 'indie', 50);
      if (!playlistRes.ok) {
        return { ok: false, error: playlistRes.error };
      }
      playlistTitle = playlistRes.playlistTitle;
      for (const t of playlistRes.tracks) {
        resolvedTracks.push({
          id: `wmt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          title: t.title,
          artist: t.artist,
          soundcloudUrl: t.soundcloudUrl,
          embedTargetUrl: t.embedTargetUrl || t.soundcloudUrl,
          ...(t.artworkUrl ? { artworkUrl: t.artworkUrl } : {}),
        });
      }
    } else {
      singleUrls.push(canonical);
    }
  }

  for (let i = 0; i < singleUrls.length; i += 8) {
    const batch = singleUrls.slice(i, i + 8);
    const batchResults = await Promise.all(
      batch.map((trackUrl) => resolveSoundCloudTrackMetadata(trackUrl, 'indie'))
    );
    for (const result of batchResults) {
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      resolvedTracks.push({
        id: `wmt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        title: result.track.title,
        artist: result.track.artist,
        soundcloudUrl: result.track.soundcloudUrl,
        embedTargetUrl: result.track.embedTargetUrl || result.track.soundcloudUrl,
        ...(result.track.artworkUrl ? { artworkUrl: result.track.artworkUrl } : {}),
      });
    }
  }

  return {
    ok: true,
    tracks: sanitizeWeeklyMusicTrackList(resolvedTracks),
    playlistTitle,
  };
}

/**
 * Registers the Admin guard middleware and raw binary upload endpoints for /api/author/*
 * MUST run BEFORE express.json().
 */
export function registerAuthorMiddlewareAndRawRoutes(app: express.Express): void {
  // Strict Admin-only guard for ALL /api/author/* endpoints (evaluated before body parsing)
  app.use('/api/author', async (req: Request, res: Response, next) => {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }
    const token = extractBearerToken(req) || '';
    const db = ensureDatabase();
    if (!cloudSyncState.publicHydrated) {
      const hadPublic = await hydratePublicCatalogFromFirestore(db);
      if (hadPublic) {
        saveDatabase(db, { slices: ['meta', 'poems', 'prose', 'blog', 'products', 'radio'] });
      }
    }
    if (!cloudSyncState.adminSecretsHydrated && token) {
      const hadSecrets = await hydrateAdminSecretsFromFirestore(db, token, {
        onTelegramBotToken: applyCloudTelegramBotToken,
      });
      if (hadSecrets) saveDatabase(db, { slices: ['meta'] });
    }

    const revBefore = getCatalogRevision();
    res.on('finish', () => {
      if (
        req.method !== 'GET' &&
        req.method !== 'HEAD' &&
        res.statusCode < 400 &&
        token &&
        (getCatalogRevision() !== revBefore || !cloudSyncState.cloudConfigExists)
      ) {
        queueDatabaseSyncToFirestore(structuredClone(ensureDatabase()), token, authResult.claims.uid);
      }
    });
    next();
  });

  // Raw binary upload for e-book files into database storage (up to 40 MB)
  app.post(
    '/api/author/upload-ebook',
    express.raw({ type: '*/*', limit: '40mb' }),
    (req: Request, res: Response) => {
      const db = ensureDatabase();
      const rawNameHeader = req.headers['x-file-name'];
      const rawMimeHeader = req.headers['x-file-type'];
      const productIdHeader = req.headers['x-product-id'];

      const decodedName =
        typeof rawNameHeader === 'string' && rawNameHeader.trim()
          ? decodeURIComponent(rawNameHeader).replace(/[/\\?%*:|"<>]/g, '_')
          : 'ebook.epub';
      const ext = path.extname(decodedName).toLowerCase();
      if (!ALLOWED_EBOOK_EXTS.has(ext)) {
        res.status(400).json({
          error: 'Підтримуються формати: EPUB, PDF, FB2, MOBI, AZW3, TXT, RTF, DOCX або ZIP.',
        });
        return;
      }

      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      if (buffer.byteLength === 0) {
        res.status(400).json({ error: 'Файл електронної книги порожній.' });
        return;
      }

      const storageKey = `ebook-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(EBOOKS_DIR, storageKey), buffer);

      const mimeType =
        typeof rawMimeHeader === 'string' && rawMimeHeader.trim()
          ? rawMimeHeader.trim()
          : 'application/octet-stream';
      const fileSize = buffer.byteLength;

      let updatedProduct: RawStoreProduct | undefined;
      const targetProductId = typeof productIdHeader === 'string' ? productIdHeader.trim() : '';
      if (targetProductId) {
        const idx = db.products.findIndex((p) => p.id === targetProductId);
        if (idx !== -1) {
          const existing = db.products[idx];
          if (existing.ebookStorageKey) {
            const oldPath = path.join(EBOOKS_DIR, path.basename(existing.ebookStorageKey));
            if (fs.existsSync(oldPath)) {
              try {
                fs.unlinkSync(oldPath);
              } catch {
                // Ignore cleanup failure
              }
            }
          }
          const nextProduct: RawStoreProduct = {
            ...existing,
            ebookFileName: decodedName,
            ebookMimeType: mimeType,
            ebookFileSize: fileSize,
            ebookStorageKey: storageKey,
            formats: existing.formats || ext.replace('.', '').toUpperCase(),
          };
          db.products[idx] = nextProduct;
          db.orders = db.orders.map((order) => ({
            ...order,
            items: order.items.map((item) =>
              item.productId === targetProductId
                ? { ...item, ebookFileName: decodedName, ebookFileSize: fileSize }
                : item
            ),
          }));
          saveDatabase(db, { slices: ['products'], ordersDirty: true });
          updatedProduct = nextProduct;
        }
      }

      res.status(201).json({
        fileName: decodedName,
        mimeType,
        fileSize,
        storageKey,
        product: updatedProduct,
      });
    }
  );

  // Raw binary upload for paid prose PDF documents (Admin-only, up to 40 MB)
  app.post(
    '/api/author/upload-prose-pdf',
    express.raw({ type: '*/*', limit: '40mb' }),
    (req: Request, res: Response) => {
      const db = ensureDatabase();
      const rawNameHeader = req.headers['x-file-name'];
      const proseIdHeader = req.headers['x-prose-id'];

      const decodedName =
        typeof rawNameHeader === 'string' && rawNameHeader.trim()
          ? decodeURIComponent(rawNameHeader).replace(/[/\\?%*:|"<>]/g, '_')
          : 'story.pdf';
      const ext = path.extname(decodedName).toLowerCase();
      if (ext !== '.pdf') {
        res.status(400).json({ error: 'Дозволено завантажувати лише PDF-документи (.pdf).' });
        return;
      }

      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      if (buffer.byteLength < 8 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        res.status(400).json({ error: 'Файл не є дійсним PDF-документом.' });
        return;
      }

      const storageKey = `prose-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf`;
      const destPath = resolveConfinedFilePath(PROSE_PDF_DIR, storageKey);
      if (!destPath) {
        res.status(400).json({ error: 'Некоректний шлях збереження.' });
        return;
      }
      fs.writeFileSync(destPath, buffer);

      const fileSize = buffer.byteLength;
      let updatedProse: ProseWork | undefined;
      const targetProseId = typeof proseIdHeader === 'string' ? proseIdHeader.trim() : '';

      if (targetProseId) {
        const idx = db.prose.findIndex((p) => p.id === targetProseId);
        if (idx !== -1) {
          const existing = db.prose[idx];
          if (existing.pdfStorageKey) {
            const oldPath = resolveConfinedFilePath(PROSE_PDF_DIR, existing.pdfStorageKey);
            if (oldPath && fs.existsSync(oldPath)) {
              try {
                fs.unlinkSync(oldPath);
              } catch {
                // Ignore cleanup error
              }
            }
          }
          const existingMode = resolveProseAccessMode(existing);
          const nextMode: ProseAccessMode = existingMode === 'authorized' ? 'authorized' : 'paid';
          const nextPrice =
            nextMode === 'paid' ? ((existing.priceUah || 0) > 0 ? existing.priceUah : 75) : 0;
          const nextWork: RawProseWork = {
            ...existing,
            accessMode: nextMode,
            requiresAuth: nextMode === 'authorized',
            isPaid: nextMode === 'paid',
            priceUah: nextPrice,
            pdfFileName: decodedName,
            pdfFileSize: fileSize,
            pdfStorageKey: storageKey,
          };
          db.prose[idx] = nextWork;
          db.orders = db.orders.map((order) => ({
            ...order,
            items: order.items.map((item) =>
              item.proseId === targetProseId || item.productId === targetProseId
                ? { ...item, hasPdf: true, pdfFileName: decodedName, pdfFileSize: fileSize }
                : item
            ),
          }));
          saveDatabase(db, { slices: ['prose'], ordersDirty: true });
          updatedProse = enrichProseForAuthor(nextWork, db);
        }
      }

      res.status(201).json({
        fileName: decodedName,
        fileSize,
        storageKey,
        prose: updatedProse,
      });
    }
  );
}

/**
 * Registers all JSON Author Studio / Admin routes (/api/author/*).
 */
export function registerAuthorRoutes(app: express.Express): void {
  // Author studio catalog: includes full fields for editing + decrypted & verified orders for fulfillment
  app.get('/api/author/catalog', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      const [poemSubsHydrated, proseSubsHydrated, ordersHydrated, feedbackHydrated] =
        await Promise.all([
          hydrateAdminPoemSubmissionsFromFirestore(db, adminToken),
          hydrateAdminProseSubmissionsFromFirestore(db, adminToken),
          hydrateAdminOrdersFromFirestore(db, adminToken),
          hydrateAdminSiteFeedbackFromFirestore(db, adminToken),
        ]);
      if (poemSubsHydrated || proseSubsHydrated || ordersHydrated || feedbackHydrated) {
        const dirtySlices: DbSliceKey[] = [];
        if (poemSubsHydrated) dirtySlices.push('poems');
        if (proseSubsHydrated) dirtySlices.push('prose');
        if (feedbackHydrated) dirtySlices.push('community');
        saveDatabase(db, {
          ...(dirtySlices.length > 0 ? { slices: dirtySlices } : {}),
          ordersDirty: ordersHydrated,
        });
      }
    }
    const adminOrders: OrderRecord[] = db.orders.map((order) => {
      const integrityVerified = order.payment?.receiptSignature ? verifyOrderReceipt(order) : false;
      if (order.encryptedPii) {
        const decrypted = decryptOrderPii(order.encryptedPii, order.orderCode);
        if (decrypted) {
          return {
            ...order,
            buyerName: decrypted.buyerName,
            buyerEmail: decrypted.buyerEmail,
            buyerNameMasked: order.buyerNameMasked || maskPersonName(decrypted.buyerName),
            buyerEmailMasked: order.buyerEmailMasked || maskEmailAddress(decrypted.buyerEmail),
            shipping: decrypted.shipping,
            integrityVerified,
            piiLocked: false,
          };
        }
        return {
          ...order,
          buyerName: order.buyerNameMasked || 'Зашифровано',
          buyerEmail: order.buyerEmailMasked || 'Зашифровано',
          buyerNameMasked: order.buyerNameMasked || 'Зашифровано',
          buyerEmailMasked: order.buyerEmailMasked || 'Зашифровано',
          shipping: undefined,
          integrityVerified,
          piiLocked: true,
        };
      }
      return {
        ...order,
        buyerNameMasked: order.buyerNameMasked || maskPersonName(order.buyerName),
        buyerEmailMasked: order.buyerEmailMasked || maskEmailAddress(order.buyerEmail),
        integrityVerified,
        piiLocked: false,
      };
    });

    const sortedSubmissions = [...(db.poemSubmissions || [])].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    const sortedProseSubmissions = [...(db.proseSubmissions || [])].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    const pendingPoemSubmissionsCount = sortedSubmissions.filter(
      (s) => s.status === 'pending'
    ).length;
    const pendingProseSubmissionsCount = sortedProseSubmissions.filter(
      (s) => s.status === 'pending'
    ).length;

    res.json({
      heroLeadText: db.heroLeadText,
      authorAboutText: db.authorAboutText,
      authorPhotoUrl: db.authorPhotoUrl,
      authorPhotos: db.authorPhotos,
      socialLinks: db.socialLinks,
      monobankJarUrl: db.monobankJarUrl,
      monobankModalTitle: db.monobankModalTitle || DEFAULT_MONOBANK_MODAL_TITLE,
      monobankModalSubtitle: db.monobankModalSubtitle ?? DEFAULT_MONOBANK_MODAL_SUBTITLE,
      monobankCardLabel: db.monobankCardLabel ?? DEFAULT_MONOBANK_CARD_LABEL,
      monobankModalText: db.monobankModalText || DEFAULT_MONOBANK_MODAL_TEXT,
      monobankEmptyText: db.monobankEmptyText ?? DEFAULT_MONOBANK_EMPTY_TEXT,
      contactEmail: db.contactEmail,
      interviews: db.interviews,
      homeRepeaters: normalizeHomeRepeatersConfig(db.homeRepeaters),
      contactMessages: db.contactMessages,
      poems: db.poems,
      poemSubmissions: sortedSubmissions,
      pendingPoemSubmissionsCount,
      proseSubmissions: sortedProseSubmissions,
      pendingProseSubmissionsCount,
      pendingSubmissionsCount: pendingPoemSubmissionsCount + pendingProseSubmissionsCount,
      prose: db.prose.map((p) => enrichProseForAuthor(p, db)),
      proseTags: db.proseTags,
      blog: db.blog,
      products: db.products,
      radioTracks: db.radioTracks.map((t) => ({
        ...t,
        station: t.station === 'electronic' ? ('electronic' as const) : ('indie' as const),
      })),
      weeklyMusicSelections: [...(db.weeklyMusicSelections || [])].sort((a, b) =>
        b.periodStart !== a.periodStart
          ? b.periodStart.localeCompare(a.periodStart)
          : b.createdAt.localeCompare(a.createdAt)
      ),
      weeklyCurrentPeriod: getWeekPeriodForDate(),
      orders: adminOrders,
      ordersCount: adminOrders.length,
      siteFeedback: [...(db.feedback || [])].sort(
        (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
      ),
      unreadSiteFeedbackCount: (db.feedback || []).filter(
        (f) => !f.readByAdmin && !f.adminReply
      ).length,
      proseAuthDiscountPercent: db.proseAuthDiscountPercent ?? 0,
      proseTelegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
      storeAuthDiscountPercent: 0,
      uniqueVisitors: db.visitorIpHashes.length,
    });
  });

  // Author behavior analytics report (Admin-only)
  app.get('/api/author/analytics', (_req: Request, res: Response) => {
    const db = ensureDatabase();
    const { analytics } = db;

    const clicks = Object.values(analytics.clicksByTarget)
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 25);

    const dwell = Object.values(analytics.dwellByTarget)
      .map((item) => ({
        ...item,
        avgSeconds: Math.round(item.totalSeconds / Math.max(1, item.sessionsCount)),
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
      .slice(0, 25);

    const rawExits = Object.values(analytics.exitsByMoment).sort((a, b) => b.exits - a.exits);
    const totalExits = rawExits.reduce((sum, item) => sum + item.exits, 0);
    const exits = rawExits.slice(0, 25).map((item) => ({
      ...item,
      sharePercent: totalExits > 0 ? Math.round((item.exits / totalExits) * 100) : 0,
    }));

    const avgSessionSeconds =
      analytics.totalSessions > 0
        ? Math.round(analytics.totalTrackedSeconds / analytics.totalSessions)
        : 0;

    const report: AuthorAnalyticsReport = {
      summary: {
        totalSessions: analytics.totalSessions,
        totalClicks: analytics.totalClicks,
        totalTrackedSeconds: analytics.totalTrackedSeconds,
        avgSessionSeconds,
        totalExits,
        topClick: clicks[0] || null,
        topDwell: dwell[0] || null,
        topExit: exits[0] || null,
      },
      visits: buildVisitStatisticsReport(db),
      clicks,
      dwell,
      exits,
      recentEvents: analytics.recentEvents.slice(0, 30),
    };

    res.json(report);
  });

  app.delete('/api/author/analytics', (_req: Request, res: Response) => {
    const db = ensureDatabase();
    db.analytics = createEmptyAnalytics();
    db.poemViews = {};
    db.blogViews = {};
    db.visitorIpHashes = [];
    seenAnalyticsSessionsSet.clear();
    visitorIpSet.clear();
    saveDatabase(db, { flushDelayMs: 0, slices: ['analytics', 'poems', 'blog', 'community'] });
    res.json({ ok: true });
  });

  // Author Studio: List recorded donations & registered users for donor leaderboard
  app.get('/api/author/donations', (_req: Request, res: Response) => {
    const db = ensureDatabase();
    const users = [...db.guestAccounts]
      .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))
      .map((acc) => ({
        uid: acc.uid,
        displayName: acc.displayName,
        photoUrl: acc.photoUrl,
        createdAt: acc.createdAt,
      }));
    res.json({
      donations: db.donations,
      users,
    });
  });

  // Author Studio: Add a verified donor entry (linked to a registered user or standalone donor name)
  app.post('/api/author/donations', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { guestUid, displayName, amountUah, note, donatedAt } = req.body as {
      guestUid?: string;
      displayName?: string;
      amountUah?: number;
      note?: string;
      donatedAt?: string;
    };

    const parsedAmount = Math.round(Number(amountUah) || 0);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 1 || parsedAmount > 10_000_000) {
      res.status(400).json({ error: 'Вкажіть коректну суму донату від 1 ₴.' });
      return;
    }

    const cleanGuestUid = typeof guestUid === 'string' ? guestUid.trim() : '';
    const linkedAccount = cleanGuestUid
      ? db.guestAccounts.find((a) => a.uid === cleanGuestUid)
      : undefined;

    const cleanName = (
      (typeof displayName === 'string' && displayName.trim()) ||
      linkedAccount?.displayName ||
      ''
    )
      .trim()
      .slice(0, 80);

    if (cleanName.length < 1) {
      res.status(400).json({ error: 'Вкажіть ім’я донатера або оберіть користувача.' });
      return;
    }

    const cleanNote = typeof note === 'string' ? note.trim().slice(0, 200) : '';
    const parsedDateMs =
      typeof donatedAt === 'string' && donatedAt.trim() ? Date.parse(donatedAt) : NaN;
    const resolvedDate = Number.isFinite(parsedDateMs)
      ? new Date(parsedDateMs).toISOString()
      : new Date().toISOString();

    const record: DonorRecord = {
      id: `don_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      ...(linkedAccount ? { guestUid: linkedAccount.uid } : {}),
      displayName: cleanName,
      ...(linkedAccount?.photoUrl ? { photoUrl: linkedAccount.photoUrl } : {}),
      amountUah: parsedAmount,
      ...(cleanNote ? { note: cleanNote } : {}),
      donatedAt: resolvedDate,
    };

    db.donations.unshift(record);
    saveDatabase(db, { flushDelayMs: 500, slices: ['community'] });
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      void syncDonationToFirestore(record, adminToken);
    }
    res.status(201).json({ donation: record });
  });

  // Author Studio: Delete a donation entry
  app.delete('/api/author/donations/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = db.donations.length;
    db.donations = db.donations.filter((d) => d.id !== id);
    if (db.donations.length === before) {
      res.status(404).json({ error: 'Запис про донат не знайдено.' });
      return;
    }
    saveDatabase(db, { flushDelayMs: 500, slices: ['community'] });
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      void deleteDonationInFirestore(id, adminToken);
    }
    res.json({ deletedId: id });
  });

  // Author Studio: Get list of user feedbacks
  app.get('/api/author/feedback', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      const hydrated = await hydrateAdminSiteFeedbackFromFirestore(db, adminToken);
      if (hydrated) saveDatabase(db, { slices: ['community'] });
    }
    const sorted = [...(db.feedback || [])].sort(
      (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
    );
    res.json({ feedback: sorted });
  });

  // Author Studio: Reply directly to a user feedback message
  const handleAuthorFeedbackReply = (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const { reply } = req.body as { reply?: string };
    const items = db.feedback || [];
    const targetIndex = items.findIndex((f) => f.id === id);
    if (targetIndex < 0) {
      res.status(404).json({ error: 'Відгук не знайдено.' });
      return;
    }

    const cleanReply = typeof reply === 'string' ? reply.trim().slice(0, 2000) : '';
    const nowIso = new Date().toISOString();
    const current = items[targetIndex];
    const updated: FeedbackRecord = {
      ...current,
      readByAdmin: true,
      updatedAt: nowIso,
      ...(cleanReply
        ? {
            adminReply: cleanReply,
            adminReplyAt: nowIso,
            adminReplyAuthorName: 'Андрій Даньків',
            readByUser: false,
          }
        : {
            readByUser: true,
          }),
    };
    if (!cleanReply) {
      delete updated.adminReply;
      delete updated.adminReplyAt;
      delete updated.adminReplyAuthorName;
    }

    items[targetIndex] = updated;
    db.feedback = items;
    saveDatabase(db, { slices: ['community'] });

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      void syncSiteFeedbackToFirestore(updated, adminToken);
    }

    res.json({ record: updated });
  };
  app.post('/api/author/feedback/:id/reply', handleAuthorFeedbackReply);
  app.put('/api/author/feedback/:id/reply', handleAuthorFeedbackReply);

  // Author Studio: Mark site feedback as read by admin
  app.patch('/api/author/feedback/:id/read', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const items = db.feedback || [];
    const targetIndex = items.findIndex((f) => f.id === id);
    if (targetIndex < 0) {
      res.status(404).json({ error: 'Відгук не знайдено.' });
      return;
    }
    const updated: FeedbackRecord = {
      ...items[targetIndex],
      readByAdmin: true,
      updatedAt: new Date().toISOString(),
    };
    items[targetIndex] = updated;
    db.feedback = items;
    saveDatabase(db, { slices: ['community'] });

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      void syncSiteFeedbackToFirestore(updated, adminToken);
    }

    res.json({ record: updated });
  });

  // Author Studio: Delete a feedback item
  app.delete('/api/author/feedback/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = (db.feedback || []).length;
    db.feedback = (db.feedback || []).filter((f) => f.id !== id);
    if (db.feedback.length === before) {
      res.status(404).json({ error: 'Відгук не знайдено.' });
      return;
    }
    saveDatabase(db, { slices: ['community'] });
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      void deleteSiteFeedbackInFirestore(id, adminToken);
    }
    res.json({ deletedId: id });
  });

  // Delete a literary work (poem, prose, or blog post) from author studio
  app.delete('/api/author/works/:kind/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { kind, id } = req.params;
    if (kind === 'poem') {
      const before = db.poems.length;
      db.poems = db.poems.filter((p) => p.id !== id);
      if (db.poems.length === before) {
        res.status(404).json({ error: 'Вірш не знайдено.' });
        return;
      }
      delete db.poemViews[id];
      delete db.poemVotes[id];
      db.reviews = db.reviews.filter((r) => !(r.targetType === 'poem' && r.targetId === id));
      if (Array.isArray(db.recentRatings)) {
        db.recentRatings = db.recentRatings.filter(
          (r) => !(r.targetType === 'poem' && r.targetId === id)
        );
      }
      cloudPoemLikesByPoemId.delete(id);
      for (const uidSet of cloudPoemLikesByUid.values()) {
        uidSet.delete(id);
      }
      db.guestAccounts = db.guestAccounts.map((acc) => ({
        ...acc,
        likedPoemIds: Array.isArray(acc.likedPoemIds)
          ? acc.likedPoemIds.filter((pid) => pid !== id)
          : [],
      }));
      saveDatabase(db, { slices: ['poems', 'products', 'community'] });
      const adminToken = extractBearerToken(req);
      if (adminToken) {
        void deleteReviewsForTargetInFirestore('poem', id, adminToken);
      }
      res.json({ deletedId: id });
      return;
    }
    if (kind === 'prose') {
      const target = db.prose.find((p) => p.id === id);
      if (!target) {
        res.status(404).json({ error: 'Твір не знайдено.' });
        return;
      }
      if (target.pdfStorageKey) {
        const pdfPath = resolveConfinedFilePath(PROSE_PDF_DIR, target.pdfStorageKey);
        if (pdfPath && fs.existsSync(pdfPath)) {
          try {
            fs.unlinkSync(pdfPath);
          } catch {
            // Ignore cleanup failure
          }
        }
      }
      db.prose = db.prose.filter((p) => p.id !== id);
      delete db.proseVotes[id];
      db.reviews = db.reviews.filter((r) => !(r.targetType === 'prose' && r.targetId === id));
      if (Array.isArray(db.recentRatings)) {
        db.recentRatings = db.recentRatings.filter(
          (r) => !(r.targetType === 'prose' && r.targetId === id)
        );
      }
      saveDatabase(db, { slices: ['prose', 'products'] });
      const adminToken = extractBearerToken(req);
      if (adminToken) {
        void deleteReviewsForTargetInFirestore('prose', id, adminToken);
      }
      res.json({ deletedId: id });
      return;
    }
    if (kind === 'blog') {
      const before = db.blog.length;
      db.blog = db.blog.filter((p) => p.id !== id);
      if (db.blog.length === before) {
        res.status(404).json({ error: 'Допис не знайдено.' });
        return;
      }
      delete db.blogViews[id];
      saveDatabase(db, { slices: ['blog'] });
      res.json({ deletedId: id });
      return;
    }
    res.status(400).json({ error: 'Невідомий розділ.' });
  });

  // Update an existing poem (title, cycle, content, note, typesetting options)
  app.put('/api/author/works/poem/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const poem = db.poems.find((p) => p.id === id);
    if (!poem) {
      res.status(404).json({ error: 'Вірш не знайдено.' });
      return;
    }
    const {
      title,
      cycle,
      excerpt,
      content,
      note,
      fontSize,
      textAlign,
      lineSpacing,
      textColor,
      backgroundColor,
      imageUrl,
      imagePalette,
      soundcloudTrack,
      soundcloudTracks,
      authorName,
      isCommunity,
      year,
      workStatus,
    } = req.body as {
      title?: unknown;
      cycle?: unknown;
      excerpt?: unknown;
      content?: unknown;
      note?: unknown;
      fontSize?: unknown;
      textAlign?: unknown;
      lineSpacing?: unknown;
      textColor?: unknown;
      backgroundColor?: unknown;
      imageUrl?: unknown;
      imagePalette?: unknown;
      soundcloudTrack?: unknown;
      soundcloudTracks?: unknown;
      authorName?: unknown;
      isCommunity?: unknown;
      year?: unknown;
      workStatus?: unknown;
    };

    if (year !== undefined) {
      const parsedYear = Math.round(Number(year));
      if (!Number.isFinite(parsedYear) || parsedYear < 1900 || parsedYear > 2200) {
        res.status(400).json({ error: 'Рік написання має бути в межах 1900–2200.' });
        return;
      }
      poem.year = parsedYear;
    }
    if (workStatus === 'completed' || workStatus === 'in_progress') {
      poem.workStatus = workStatus;
    } else if (workStatus === null || workStatus === 'none') {
      poem.workStatus = undefined;
    }

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 240) {
        res.status(400).json({ error: 'Заголовок має містити від 1 до 240 символів.' });
        return;
      }
      poem.title = title.trim();
    }
    if (cycle !== undefined) {
      poem.cycle = typeof cycle === 'string' && cycle.trim() ? cycle.trim() : 'Нові вірші';
    }
    if (content !== undefined) {
      const cleanPoemContent = typeof content === 'string' ? preserveFormattedText(content) : '';
      if (!cleanPoemContent) {
        res.status(400).json({ error: 'Текст вірша не може бути порожнім.' });
        return;
      }
      poem.content = cleanPoemContent;
      poem.excerpt =
        typeof excerpt === 'string' && excerpt.trim()
          ? excerpt.trim()
          : getFirstFormattedExcerptLine(cleanPoemContent, 140) + '...';
    } else if (excerpt !== undefined) {
      poem.excerpt = typeof excerpt === 'string' ? excerpt.trim() : poem.excerpt;
    }
    if (note !== undefined) {
      poem.note = typeof note === 'string' && note.trim() ? note.trim() : undefined;
    }
    if (fontSize !== undefined) {
      poem.fontSize = ['sm', 'base', 'lg', 'xl', '2xl'].includes(String(fontSize))
        ? (fontSize as 'sm' | 'base' | 'lg' | 'xl' | '2xl')
        : undefined;
    }
    if (textAlign !== undefined) {
      poem.textAlign = ['left', 'center', 'right'].includes(String(textAlign))
        ? (textAlign as 'left' | 'center' | 'right')
        : undefined;
    }
    if (lineSpacing !== undefined) {
      poem.lineSpacing = ['tight', 'normal', 'relaxed', 'loose'].includes(String(lineSpacing))
        ? (lineSpacing as 'tight' | 'normal' | 'relaxed' | 'loose')
        : undefined;
    }
    if (textColor !== undefined) {
      poem.textColor =
        typeof textColor === 'string' && textColor.trim()
          ? textColor.trim().slice(0, 32)
          : undefined;
    }
    if (backgroundColor !== undefined) {
      poem.backgroundColor =
        typeof backgroundColor === 'string' && backgroundColor.trim()
          ? backgroundColor.trim().slice(0, 32)
          : undefined;
    }
    if (imageUrl !== undefined) {
      if (imageUrl === null || imageUrl === '') {
        poem.imageUrl = undefined;
        poem.imagePalette = undefined;
      } else {
        const cleanImageUrl = sanitizePoemImageUrl(imageUrl);
        if (!cleanImageUrl) {
          res.status(400).json({ error: 'Некоректне посилання на фото для вірша.' });
          return;
        }
        poem.imageUrl = cleanImageUrl;
      }
    }
    if (imagePalette !== undefined) {
      if (imagePalette === null || !poem.imageUrl) {
        poem.imagePalette = undefined;
      } else {
        const cleanPalette = sanitizePoemImagePalette(imagePalette);
        if (cleanPalette) {
          poem.imagePalette = cleanPalette;
        }
      }
    }
    if (soundcloudTracks !== undefined) {
      if (
        soundcloudTracks === null ||
        (Array.isArray(soundcloudTracks) && soundcloudTracks.length === 0)
      ) {
        poem.soundcloudTracks = undefined;
        poem.soundcloudTrack = undefined;
      } else if (!Array.isArray(soundcloudTracks)) {
        res.status(400).json({ error: 'Некоректний список SoundCloud-треків для вірша.' });
        return;
      } else {
        const cleanTracks = sanitizePoemSoundCloudTracks(soundcloudTracks);
        if (cleanTracks.length === 0) {
          res.status(400).json({ error: 'Некоректні дані SoundCloud-треків для вірша.' });
          return;
        }
        poem.soundcloudTracks = cleanTracks;
        poem.soundcloudTrack = cleanTracks[0];
      }
    } else if (soundcloudTrack !== undefined) {
      if (soundcloudTrack === null) {
        poem.soundcloudTrack = undefined;
        poem.soundcloudTracks = undefined;
      } else {
        const cleanTrack = sanitizePoemSoundCloudTrack(soundcloudTrack);
        if (!cleanTrack) {
          res.status(400).json({ error: 'Некоректні дані SoundCloud-треку для вірша.' });
          return;
        }
        poem.soundcloudTrack = cleanTrack;
        poem.soundcloudTracks = [cleanTrack];
      }
    }

    if (typeof isCommunity === 'boolean') {
      poem.isCommunity = isCommunity || undefined;
    }
    if (typeof authorName === 'string') {
      poem.authorName = authorName.trim() ? authorName.trim().slice(0, 80) : undefined;
    }

    saveDatabase(db, { slices: ['poems'] });
    res.json({ item: poem });
  });

  // Author Studio: Reorder poems display sequence
  app.put('/api/author/poems/reorder', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { orderedIds } = req.body as { orderedIds?: unknown };
    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ error: 'Очікується масив ідентифікаторів віршів.' });
      return;
    }

    const byId = new Map(db.poems.map((p) => [p.id, p]));
    const seen = new Set<string>();
    const reordered: RawPoem[] = [];

    for (const rawId of orderedIds) {
      if (typeof rawId !== 'string') continue;
      const cleanId = rawId.trim();
      if (!cleanId || seen.has(cleanId)) continue;
      const found = byId.get(cleanId);
      if (found) {
        seen.add(cleanId);
        reordered.push(found);
      }
    }

    for (const poem of db.poems) {
      if (!seen.has(poem.id)) {
        reordered.push(poem);
      }
    }

    db.poems = reordered;
    saveDatabase(db, { slices: ['poems'] });
    res.json({ poems: db.poems });
  });

  // Author Studio: List all reader poem submissions
  app.get('/api/author/poem-submissions', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      const hydrated = await hydrateAdminPoemSubmissionsFromFirestore(db, adminToken);
      if (hydrated) saveDatabase(db, { slices: ['poems'] });
    }
    const items = [...(db.poemSubmissions || [])].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    res.json({ submissions: items });
  });

  // Author Studio: Edit a reader's poem submission before or alongside moderation
  app.put('/api/author/poem-submissions/:id', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.poemSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = req.body as Record<string, unknown>;

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
        res.status(400).json({ error: 'Назва вірша має містити від 1 до 200 символів.' });
        return;
      }
      submission.title = body.title.trim();
    }
    if (body.cycle !== undefined) {
      submission.cycle = typeof body.cycle === 'string' ? body.cycle.trim().slice(0, 160) : '';
    }
    if (body.authorName !== undefined) {
      if (typeof body.authorName === 'string' && body.authorName.trim()) {
        submission.authorName = body.authorName.trim().slice(0, 80);
      }
    }
    if (body.content !== undefined) {
      const cleanSubContent =
        typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
      if (!cleanSubContent || cleanSubContent.length > 50000) {
        res.status(400).json({ error: 'Текст вірша має містити від 1 до 50 000 символів.' });
        return;
      }
      submission.content = cleanSubContent;
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }
    if (body.note !== undefined) {
      submission.note =
        typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : undefined;
    }
    if (body.moderationNote !== undefined) {
      submission.moderationNote =
        typeof body.moderationNote === 'string' && body.moderationNote.trim()
          ? body.moderationNote.trim().slice(0, 1000)
          : undefined;
    }
    if (body.fontSize !== undefined) {
      submission.fontSize = ['sm', 'base', 'lg', 'xl', '2xl'].includes(String(body.fontSize))
        ? (body.fontSize as PoemSubmissionRecord['fontSize'])
        : undefined;
    }
    if (body.textAlign !== undefined) {
      submission.textAlign = ['left', 'center', 'right'].includes(String(body.textAlign))
        ? (body.textAlign as PoemSubmissionRecord['textAlign'])
        : undefined;
    }
    if (body.lineSpacing !== undefined) {
      submission.lineSpacing = ['tight', 'normal', 'relaxed', 'loose'].includes(
        String(body.lineSpacing)
      )
        ? (body.lineSpacing as PoemSubmissionRecord['lineSpacing'])
        : undefined;
    }
    if (body.textColor !== undefined) {
      submission.textColor =
        typeof body.textColor === 'string' && body.textColor.trim()
          ? body.textColor.trim().slice(0, 32)
          : undefined;
    }
    if (body.backgroundColor !== undefined) {
      submission.backgroundColor =
        typeof body.backgroundColor === 'string' && body.backgroundColor.trim()
          ? body.backgroundColor.trim().slice(0, 32)
          : undefined;
    }
    if (body.imageUrl !== undefined) {
      if (body.imageUrl === null || body.imageUrl === '') {
        submission.imageUrl = undefined;
        submission.imagePalette = undefined;
      } else {
        const cleanImageUrl = sanitizePoemImageUrl(body.imageUrl);
        if (!cleanImageUrl) {
          res.status(400).json({ error: 'Некоректне посилання на фото.' });
          return;
        }
        submission.imageUrl = cleanImageUrl;
      }
    }
    if (body.imagePalette !== undefined) {
      if (body.imagePalette === null || !submission.imageUrl) {
        submission.imagePalette = undefined;
      } else {
        const cleanPalette = sanitizePoemImagePalette(body.imagePalette);
        if (cleanPalette) {
          submission.imagePalette = cleanPalette;
        }
      }
    }
    if (body.soundcloudTracks !== undefined) {
      if (
        body.soundcloudTracks === null ||
        (Array.isArray(body.soundcloudTracks) && body.soundcloudTracks.length === 0)
      ) {
        submission.soundcloudTracks = undefined;
        submission.soundcloudTrack = undefined;
      } else if (!Array.isArray(body.soundcloudTracks)) {
        res.status(400).json({ error: 'Некоректний список SoundCloud-треків.' });
        return;
      } else {
        const cleanTracks = sanitizePoemSoundCloudTracks(body.soundcloudTracks);
        if (cleanTracks.length === 0) {
          res.status(400).json({ error: 'Некоректні дані SoundCloud-треків.' });
          return;
        }
        submission.soundcloudTracks = cleanTracks;
        submission.soundcloudTrack = cleanTracks[0];
      }
    } else if (body.soundcloudTrack !== undefined) {
      if (body.soundcloudTrack === null) {
        submission.soundcloudTrack = undefined;
        submission.soundcloudTracks = undefined;
      } else {
        const cleanTrack = sanitizePoemSoundCloudTrack(body.soundcloudTrack);
        if (!cleanTrack) {
          res.status(400).json({ error: 'Некоректні дані SoundCloud-треку.' });
          return;
        }
        submission.soundcloudTrack = cleanTrack;
        submission.soundcloudTracks = [cleanTrack];
      }
    }

    submission.updatedAt = new Date().toISOString();

    if (submission.publishedPoemId && submission.status === 'approved') {
      const published = db.poems.find((p) => p.id === submission.publishedPoemId);
      if (published) {
        published.title = submission.title;
        published.cycle = submission.cycle || 'Вірші читачів';
        published.content = submission.content;
        published.excerpt = getFirstFormattedExcerptLine(submission.content, 140) + '...';
        published.note = submission.note;
        published.workStatus = submission.workStatus;
        published.fontSize = submission.fontSize;
        published.textAlign = submission.textAlign;
        published.lineSpacing = submission.lineSpacing;
        published.textColor = submission.textColor;
        published.backgroundColor = submission.backgroundColor;
        published.imageUrl = submission.imageUrl;
        published.imagePalette = submission.imagePalette;
        published.soundcloudTracks = submission.soundcloudTracks;
        published.soundcloudTrack = submission.soundcloudTracks?.[0] || submission.soundcloudTrack;
        published.authorName = submission.authorName;
      }
    }

    saveDatabase(db, { slices: ['poems'] });
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await syncPoemSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission });
  });

  // Author Studio: Approve (with optional last-mile edits) & publish a reader's poem submission
  app.post('/api/author/poem-submissions/:id/approve', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.poemSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.title === 'string' && body.title.trim()) {
      submission.title = body.title.trim().slice(0, 200);
    }
    if (typeof body.cycle === 'string') {
      submission.cycle = body.cycle.trim().slice(0, 160);
    }
    if (typeof body.authorName === 'string' && body.authorName.trim()) {
      submission.authorName = body.authorName.trim().slice(0, 80);
    }
    if (typeof body.content === 'string') {
      const cleanApproveContent = preserveFormattedText(body.content).slice(0, 50000);
      if (cleanApproveContent) submission.content = cleanApproveContent;
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }
    if (body.note !== undefined) {
      submission.note =
        typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : undefined;
    }
    if (body.moderationNote !== undefined) {
      submission.moderationNote =
        typeof body.moderationNote === 'string' && body.moderationNote.trim()
          ? body.moderationNote.trim().slice(0, 1000)
          : undefined;
    }
    if (body.fontSize !== undefined) {
      submission.fontSize = ['sm', 'base', 'lg', 'xl', '2xl'].includes(String(body.fontSize))
        ? (body.fontSize as PoemSubmissionRecord['fontSize'])
        : undefined;
    }
    if (body.textAlign !== undefined) {
      submission.textAlign = ['left', 'center', 'right'].includes(String(body.textAlign))
        ? (body.textAlign as PoemSubmissionRecord['textAlign'])
        : undefined;
    }
    if (body.lineSpacing !== undefined) {
      submission.lineSpacing = ['tight', 'normal', 'relaxed', 'loose'].includes(
        String(body.lineSpacing)
      )
        ? (body.lineSpacing as PoemSubmissionRecord['lineSpacing'])
        : undefined;
    }
    if (body.textColor !== undefined) {
      submission.textColor =
        typeof body.textColor === 'string' && body.textColor.trim()
          ? body.textColor.trim().slice(0, 32)
          : undefined;
    }
    if (body.backgroundColor !== undefined) {
      submission.backgroundColor =
        typeof body.backgroundColor === 'string' && body.backgroundColor.trim()
          ? body.backgroundColor.trim().slice(0, 32)
          : undefined;
    }
    if (body.imageUrl !== undefined) {
      if (body.imageUrl === null || body.imageUrl === '') {
        submission.imageUrl = undefined;
        submission.imagePalette = undefined;
      } else {
        const cleanImageUrl = sanitizePoemImageUrl(body.imageUrl);
        if (cleanImageUrl) submission.imageUrl = cleanImageUrl;
      }
    }
    if (body.imagePalette !== undefined) {
      if (body.imagePalette === null || !submission.imageUrl) {
        submission.imagePalette = undefined;
      } else {
        const cleanPalette = sanitizePoemImagePalette(body.imagePalette);
        if (cleanPalette) submission.imagePalette = cleanPalette;
      }
    }
    if (body.soundcloudTracks !== undefined) {
      if (
        body.soundcloudTracks === null ||
        (Array.isArray(body.soundcloudTracks) && body.soundcloudTracks.length === 0)
      ) {
        submission.soundcloudTracks = undefined;
        submission.soundcloudTrack = undefined;
      } else if (Array.isArray(body.soundcloudTracks)) {
        const cleanTracks = sanitizePoemSoundCloudTracks(body.soundcloudTracks);
        if (cleanTracks.length > 0) {
          submission.soundcloudTracks = cleanTracks;
          submission.soundcloudTrack = cleanTracks[0];
        }
      }
    } else if (body.soundcloudTrack !== undefined) {
      if (body.soundcloudTrack === null) {
        submission.soundcloudTrack = undefined;
        submission.soundcloudTracks = undefined;
      } else {
        const cleanTrack = sanitizePoemSoundCloudTrack(body.soundcloudTrack);
        if (cleanTrack) {
          submission.soundcloudTrack = cleanTrack;
          submission.soundcloudTracks = [cleanTrack];
        }
      }
    }

    const excerpt = getFirstFormattedExcerptLine(submission.content, 140) + '...';

    let publishedPoem = submission.publishedPoemId
      ? db.poems.find((p) => p.id === submission.publishedPoemId)
      : undefined;

    const resolvedSubTracks =
      Array.isArray(submission.soundcloudTracks) && submission.soundcloudTracks.length > 0
        ? submission.soundcloudTracks
        : submission.soundcloudTrack
          ? [submission.soundcloudTrack]
          : [];

    if (!publishedPoem) {
      publishedPoem = {
        id:
          submission.publishedPoemId ||
          `poem-comm-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
        title: submission.title,
        cycle: submission.cycle || 'Вірші читачів',
        year: submission.year || new Date().getFullYear() || 2026,
        excerpt,
        content: submission.content,
        note: submission.note,
        workStatus: submission.workStatus || 'completed',
        fontSize: submission.fontSize,
        textAlign: submission.textAlign,
        lineSpacing: submission.lineSpacing,
        textColor: submission.textColor,
        backgroundColor: submission.backgroundColor,
        ...(submission.imageUrl ? { imageUrl: submission.imageUrl } : {}),
        ...(submission.imageUrl && submission.imagePalette
          ? { imagePalette: submission.imagePalette }
          : {}),
        ...(resolvedSubTracks.length > 0
          ? {
              soundcloudTrack: resolvedSubTracks[0],
              soundcloudTracks: resolvedSubTracks,
            }
          : {}),
        isCommunity: true,
        authorUid: submission.authorUid,
        authorName: submission.authorName,
        ...(submission.authorPhotoUrl ? { authorPhotoUrl: submission.authorPhotoUrl } : {}),
        submissionId: submission.id,
      };
      db.poems.unshift(publishedPoem);
    } else {
      publishedPoem.title = submission.title;
      publishedPoem.cycle = submission.cycle || 'Вірші читачів';
      publishedPoem.excerpt = excerpt;
      publishedPoem.content = submission.content;
      publishedPoem.note = submission.note;
      publishedPoem.workStatus = submission.workStatus || 'completed';
      publishedPoem.fontSize = submission.fontSize;
      publishedPoem.textAlign = submission.textAlign;
      publishedPoem.lineSpacing = submission.lineSpacing;
      publishedPoem.textColor = submission.textColor;
      publishedPoem.backgroundColor = submission.backgroundColor;
      publishedPoem.imageUrl = submission.imageUrl;
      publishedPoem.imagePalette = submission.imageUrl ? submission.imagePalette : undefined;
      publishedPoem.soundcloudTracks = resolvedSubTracks.length > 0 ? resolvedSubTracks : undefined;
      publishedPoem.soundcloudTrack = resolvedSubTracks[0];
      publishedPoem.isCommunity = true;
      publishedPoem.authorUid = submission.authorUid;
      publishedPoem.authorName = submission.authorName;
      publishedPoem.authorPhotoUrl = submission.authorPhotoUrl;
      publishedPoem.submissionId = submission.id;
    }

    submission.status = 'approved';
    submission.publishedPoemId = publishedPoem.id;
    submission.updatedAt = new Date().toISOString();
    saveDatabase(db, { slices: ['poems'] });

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      if (publishedPoem.imageUrl?.startsWith('/uploads/')) {
        const filename = path.basename(publishedPoem.imageUrl.slice('/uploads/'.length).split('?')[0]);
        const localFile = resolveConfinedFilePath(UPLOADS_DIR, filename);
        if (localFile && fs.existsSync(localFile)) {
          try {
            const buf = fs.readFileSync(localFile);
            const ext = path.extname(filename).toLowerCase();
            const mime =
              ext === '.png'
                ? 'image/png'
                : ext === '.webp'
                  ? 'image/webp'
                  : ext === '.gif'
                    ? 'image/gif'
                    : 'image/jpeg';
            await saveMediaAssetToFirestore(filename, mime, buf, adminToken);
          } catch {
            // Non-fatal media asset sync
          }
        }
      }
      await syncPoemSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission, poem: publishedPoem });
  });

  // Author Studio: Reject a reader's poem submission
  app.post('/api/author/poem-submissions/:id/reject', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.poemSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = (req.body || {}) as { moderationNote?: unknown };
    if (typeof body.moderationNote === 'string') {
      submission.moderationNote = body.moderationNote.trim()
        ? body.moderationNote.trim().slice(0, 1000)
        : undefined;
    }
    submission.status = 'rejected';
    submission.updatedAt = new Date().toISOString();
    saveDatabase(db, { slices: ['poems'] });

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await syncPoemSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission });
  });

  // Author Studio: Delete a reader's poem submission
  app.delete('/api/author/poem-submissions/:id', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = (db.poemSubmissions || []).length;
    db.poemSubmissions = (db.poemSubmissions || []).filter((s) => s.id !== id);
    if (db.poemSubmissions.length === before) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }
    saveDatabase(db, { slices: ['poems'] });

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await deletePoemSubmissionInFirestore(id, adminToken);
    }

    res.json({ deletedId: id });
  });

  // Author Studio: List all reader prose submissions
  app.get('/api/author/prose-submissions', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      const hydrated = await hydrateAdminProseSubmissionsFromFirestore(db, adminToken);
      if (hydrated) saveDatabase(db, { slices: ['prose'] });
    }
    const items = [...(db.proseSubmissions || [])].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    res.json({ submissions: items });
  });

  // Author Studio: Edit a reader's prose submission before or alongside moderation
  app.put('/api/author/prose-submissions/:id', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.proseSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = req.body as Record<string, unknown>;

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 240) {
        res.status(400).json({ error: 'Назва твору має містити від 1 до 240 символів.' });
        return;
      }
      submission.title = body.title.trim();
    }
    if (body.genre !== undefined) {
      submission.genre =
        typeof body.genre === 'string' && body.genre.trim()
          ? body.genre.trim().slice(0, 120)
          : 'Оповідання';
    }
    if (body.authorName !== undefined) {
      if (typeof body.authorName === 'string' && body.authorName.trim()) {
        submission.authorName = body.authorName.trim().slice(0, 80);
      }
    }
    if (body.slogan !== undefined) {
      submission.slogan =
        typeof body.slogan === 'string' && body.slogan.trim()
          ? body.slogan.trim().slice(0, 500)
          : undefined;
    }
    if (body.excerpt !== undefined) {
      submission.excerpt =
        typeof body.excerpt === 'string' && body.excerpt.trim()
          ? body.excerpt.trim().slice(0, 2000)
          : undefined;
    }
    if (body.content !== undefined) {
      const cleanProseSubContent =
        typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
      if (!cleanProseSubContent || cleanProseSubContent.length > 250000) {
        res.status(400).json({ error: 'Текст твору має містити від 1 до 250 000 символів.' });
        return;
      }
      submission.content = cleanProseSubContent;
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }
    if (body.moderationNote !== undefined) {
      submission.moderationNote =
        typeof body.moderationNote === 'string' && body.moderationNote.trim()
          ? body.moderationNote.trim().slice(0, 1000)
          : undefined;
    }
    if (body.moodboardUrls !== undefined) {
      if (
        body.moodboardUrls === null ||
        (Array.isArray(body.moodboardUrls) && body.moodboardUrls.length === 0)
      ) {
        submission.moodboardUrls = undefined;
      } else if (Array.isArray(body.moodboardUrls)) {
        const cleaned = Array.from(
          new Set(
            body.moodboardUrls
              .map((item) => sanitizePoemImageUrl(item))
              .filter((item): item is string => Boolean(item))
          )
        ).slice(0, 8);
        submission.moodboardUrls = cleaned.length > 0 ? cleaned : undefined;
      }
    }

    submission.pages = computeProseWorkPages({ content: submission.content, fallbackPages: 1 });
    submission.totalWords = countProseWords(submission.content);
    submission.updatedAt = new Date().toISOString();

    if (submission.publishedProseId && submission.status === 'approved') {
      const published = db.prose.find((p) => p.id === submission.publishedProseId);
      if (published) {
        published.title = submission.title;
        published.genre = submission.genre || 'Оповідання';
        published.slogan = submission.slogan || '';
        published.excerpt =
          submission.excerpt || getFirstFormattedExcerptLine(submission.content, 240);
        published.content = submission.content;
        published.status = submission.workStatus || published.status || 'completed';
        published.pages = computeProseWorkPages({
          content: submission.content,
          chapters: published.chapters,
          hasPdf: Boolean(published.pdfStorageKey),
          fallbackPages: 1,
        });
        published.moodboardUrls = submission.moodboardUrls ? [...submission.moodboardUrls] : [];
        published.authorName = submission.authorName;
      }
    }

    saveDatabase(db, { slices: ['prose'] });
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await syncProseSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission });
  });

  // Author Studio: Approve (with optional last-mile edits) & publish a reader's prose submission
  app.post('/api/author/prose-submissions/:id/approve', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.proseSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.title === 'string' && body.title.trim()) {
      submission.title = body.title.trim().slice(0, 240);
    }
    if (typeof body.genre === 'string') {
      submission.genre = body.genre.trim() ? body.genre.trim().slice(0, 120) : 'Оповідання';
    }
    if (typeof body.authorName === 'string' && body.authorName.trim()) {
      submission.authorName = body.authorName.trim().slice(0, 80);
    }
    if (body.slogan !== undefined) {
      submission.slogan =
        typeof body.slogan === 'string' && body.slogan.trim()
          ? body.slogan.trim().slice(0, 500)
          : undefined;
    }
    if (body.excerpt !== undefined) {
      submission.excerpt =
        typeof body.excerpt === 'string' && body.excerpt.trim()
          ? body.excerpt.trim().slice(0, 2000)
          : undefined;
    }
    if (typeof body.content === 'string') {
      const cleanProseApprove = preserveFormattedText(body.content).slice(0, 250000);
      if (cleanProseApprove) submission.content = cleanProseApprove;
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }
    if (body.moderationNote !== undefined) {
      submission.moderationNote =
        typeof body.moderationNote === 'string' && body.moderationNote.trim()
          ? body.moderationNote.trim().slice(0, 1000)
          : undefined;
    }
    if (body.moodboardUrls !== undefined) {
      if (
        body.moodboardUrls === null ||
        (Array.isArray(body.moodboardUrls) && body.moodboardUrls.length === 0)
      ) {
        submission.moodboardUrls = undefined;
      } else if (Array.isArray(body.moodboardUrls)) {
        const cleaned = Array.from(
          new Set(
            body.moodboardUrls
              .map((item) => sanitizePoemImageUrl(item))
              .filter((item): item is string => Boolean(item))
          )
        ).slice(0, 8);
        submission.moodboardUrls = cleaned.length > 0 ? cleaned : undefined;
      }
    }

    const computedPages = computeProseWorkPages({ content: submission.content, fallbackPages: 1 });
    const computedWords = countProseWords(submission.content);
    submission.pages = computedPages;
    submission.totalWords = computedWords;

    const resolvedExcerpt =
      submission.excerpt || getFirstFormattedExcerptLine(submission.content, 240);

    const publishedAtLabel = new Date().toLocaleDateString('uk-UA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    let publishedProse = submission.publishedProseId
      ? db.prose.find((p) => p.id === submission.publishedProseId)
      : undefined;

    if (!publishedProse) {
      publishedProse = {
        id:
          submission.publishedProseId ||
          `prose-comm-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
        title: submission.title,
        genre: submission.genre || 'Оповідання',
        pages: computedPages,
        publishedAt: publishedAtLabel,
        slogan: submission.slogan || '',
        excerpt: resolvedExcerpt,
        content: submission.content,
        chapters: [],
        tagIds: [],
        status: submission.workStatus || 'completed',
        accessMode: 'public',
        requiresAuth: false,
        isPaid: false,
        priceUah: 0,
        moodboardUrls: submission.moodboardUrls ? [...submission.moodboardUrls] : [],
        isCommunity: true,
        authorUid: submission.authorUid,
        authorName: submission.authorName,
        ...(submission.authorPhotoUrl ? { authorPhotoUrl: submission.authorPhotoUrl } : {}),
        submissionId: submission.id,
      };
      db.prose.unshift(publishedProse);
    } else {
      publishedProse.title = submission.title;
      publishedProse.genre = submission.genre || 'Оповідання';
      publishedProse.pages = computeProseWorkPages({
        content: submission.content,
        chapters: publishedProse.chapters,
        hasPdf: Boolean(publishedProse.pdfStorageKey),
        fallbackPages: 1,
      });
      publishedProse.slogan = submission.slogan || '';
      publishedProse.excerpt = resolvedExcerpt;
      publishedProse.content = submission.content;
      publishedProse.status = submission.workStatus || publishedProse.status || 'completed';
      publishedProse.accessMode = 'public';
      publishedProse.requiresAuth = false;
      publishedProse.isPaid = false;
      publishedProse.priceUah = 0;
      publishedProse.moodboardUrls = submission.moodboardUrls ? [...submission.moodboardUrls] : [];
      publishedProse.isCommunity = true;
      publishedProse.authorUid = submission.authorUid;
      publishedProse.authorName = submission.authorName;
      publishedProse.authorPhotoUrl = submission.authorPhotoUrl;
      publishedProse.submissionId = submission.id;
    }

    submission.status = 'approved';
    submission.publishedProseId = publishedProse.id;
    submission.updatedAt = new Date().toISOString();
    saveDatabase(db, { slices: ['prose'] });

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      for (const mediaUrl of publishedProse.moodboardUrls || []) {
        if (mediaUrl.startsWith('/uploads/')) {
          const filename = path.basename(mediaUrl.slice('/uploads/'.length).split('?')[0]);
          const localFile = resolveConfinedFilePath(UPLOADS_DIR, filename);
          if (localFile && fs.existsSync(localFile)) {
            try {
              const buf = fs.readFileSync(localFile);
              const ext = path.extname(filename).toLowerCase();
              const mime =
                ext === '.png'
                  ? 'image/png'
                  : ext === '.webp'
                    ? 'image/webp'
                    : ext === '.gif'
                      ? 'image/gif'
                      : 'image/jpeg';
              await saveMediaAssetToFirestore(filename, mime, buf, adminToken);
            } catch {
              // Non-fatal media asset sync
            }
          }
        }
      }
      await syncProseSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission, prose: enrichProseForAuthor(publishedProse, db) });
  });

  // Author Studio: Reject a reader's prose submission
  app.post('/api/author/prose-submissions/:id/reject', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const submission = (db.proseSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }

    const body = (req.body || {}) as { moderationNote?: unknown };
    if (typeof body.moderationNote === 'string') {
      submission.moderationNote = body.moderationNote.trim()
        ? body.moderationNote.trim().slice(0, 1000)
        : undefined;
    }
    submission.status = 'rejected';
    submission.updatedAt = new Date().toISOString();
    saveDatabase(db, { slices: ['prose'] });

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await syncProseSubmissionToFirestore(submission, adminToken);
    }

    res.json({ submission });
  });

  // Author Studio: Delete a reader's prose submission
  app.delete('/api/author/prose-submissions/:id', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = (db.proseSubmissions || []).length;
    db.proseSubmissions = (db.proseSubmissions || []).filter((s) => s.id !== id);
    if (db.proseSubmissions.length === before) {
      res.status(404).json({ error: 'Заявку не знайдено.' });
      return;
    }
    saveDatabase(db, { slices: ['prose'] });

    const adminToken = extractBearerToken(req);
    if (adminToken) {
      await deleteProseSubmissionInFirestore(id, adminToken);
    }

    res.json({ deletedId: id });
  });

  // Update an existing blog post (title, category, excerpt, content with embedded photos & SoundCloud tracks)
  app.put('/api/author/works/blog/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const post = db.blog.find((b) => b.id === id);
    if (!post) {
      res.status(404).json({ error: 'Допис не знайдено.' });
      return;
    }
    const { title, category, excerpt, content, coverImage } = req.body as {
      title?: unknown;
      category?: unknown;
      excerpt?: unknown;
      content?: unknown;
      coverImage?: unknown;
    };

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 240) {
        res.status(400).json({ error: 'Заголовок має містити від 1 до 240 символів.' });
        return;
      }
      post.title = title.trim();
    }

    if (category !== undefined && typeof category === 'string') {
      post.category = category.trim().slice(0, 120) || 'Авторське кіно';
    }

    if (coverImage !== undefined) {
      if (coverImage === null || (typeof coverImage === 'string' && !coverImage.trim())) {
        delete post.coverImage;
      } else if (isValidBlogPhotoUrl(coverImage)) {
        post.coverImage = coverImage.trim();
      }
    }

    if (content !== undefined) {
      if (typeof content !== 'string' || !content.trim() || content.length > 200000) {
        res.status(400).json({ error: 'Текст допису не може бути порожнім.' });
        return;
      }
      post.content = content.trim();
      const plainText = stripBlogMediaTokens(post.content);
      const words = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
      post.readingMinutes = Math.max(1, Math.ceil(words / 180));
    }

    if (excerpt !== undefined && typeof excerpt === 'string') {
      const trimmedExcerpt = excerpt.trim().slice(0, 2000);
      if (trimmedExcerpt) {
        post.excerpt = trimmedExcerpt;
      } else {
        const plainText = stripBlogMediaTokens(post.content);
        post.excerpt =
          (plainText.split('\n').find((line) => line.trim().length > 0)?.slice(0, 140) ||
            post.title) + '...';
      }
    }

    saveDatabase(db, { slices: ['blog'] });
    res.json({ item: enrichBlogPost(post, db) });
  });

  // Resolve SoundCloud track metadata for embedding inside blog posts (Admin-only)
  app.post('/api/author/blog/resolve-soundcloud', async (req: Request, res: Response) => {
    const body = req.body as { url?: unknown; urls?: unknown };
    const candidateInputs: string[] = [];

    if (typeof body.url === 'string' && body.url.trim()) {
      for (const part of body.url.split(/[\r\n]+/)) {
        const clean = part.trim();
        if (clean) candidateInputs.push(clean);
      }
    }
    if (Array.isArray(body.urls)) {
      for (const item of body.urls) {
        if (typeof item === 'string' && item.trim()) {
          candidateInputs.push(item.trim());
        }
      }
    }

    const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 15);
    if (uniqueInputs.length === 0) {
      res.status(400).json({ error: 'Вставте посилання на пісню або трек у SoundCloud.' });
      return;
    }

    const tracks: Array<{
      id: string;
      kind: 'track';
      title: string;
      artist: string;
      soundcloudUrl: string;
      embedTargetUrl: string;
      artworkUrl?: string;
    }> = [];

    for (const rawUrl of uniqueInputs) {
      const resolved = await resolveSoundCloudTrackMetadata(rawUrl, 'indie');
      if (!resolved.ok) {
        res.status(400).json({ error: resolved.error });
        return;
      }
      tracks.push({
        id: `blog_sc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        kind: 'track',
        title: resolved.track.title,
        artist: resolved.track.artist,
        soundcloudUrl: resolved.track.soundcloudUrl,
        embedTargetUrl: resolved.track.embedTargetUrl || resolved.track.soundcloudUrl,
        ...(resolved.track.artworkUrl ? { artworkUrl: resolved.track.artworkUrl } : {}),
      });
    }

    res.json({ tracks });
  });

  // Resolve YouTube video metadata for embedding inside blog (БДК) posts (Admin-only)
  app.post('/api/author/blog/resolve-youtube', async (req: Request, res: Response) => {
    const body = req.body as { url?: unknown; urls?: unknown };
    const candidateInputs: string[] = [];

    if (typeof body.url === 'string' && body.url.trim()) {
      for (const part of body.url.split(/[\r\n]+/)) {
        const clean = part.trim();
        if (clean) candidateInputs.push(clean);
      }
    }
    if (Array.isArray(body.urls)) {
      for (const item of body.urls) {
        if (typeof item === 'string' && item.trim()) {
          candidateInputs.push(item.trim());
        }
      }
    }

    const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 15);
    if (uniqueInputs.length === 0) {
      res.status(400).json({ error: 'Вставте посилання на відео з YouTube.' });
      return;
    }

    const videos: Array<{
      id: string;
      kind: 'youtube';
      videoId: string;
      youtubeUrl: string;
      title: string;
      authorName?: string;
      thumbnailUrl: string;
    }> = [];

    for (const rawUrl of uniqueInputs) {
      const videoId = extractYouTubeVideoId(rawUrl);
      if (!videoId) {
        res.status(400).json({
          error:
            'Не вдалося розпізнати посилання на YouTube. Використовуйте формат youtube.com/watch?v=..., youtu.be/... або youtube.com/shorts/...',
        });
        return;
      }

      const watchUrl = getYouTubeWatchUrl(videoId);
      const fallbackThumb = getYouTubeThumbnailUrl(videoId);
      let title = 'Відео з YouTube';
      let authorName: string | undefined;
      let thumbnailUrl = fallbackThumb;

      try {
        const oembedRes = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'User-Agent': 'andrii-dankiv-writer-app/1.0',
            },
            signal: AbortSignal.timeout(7000),
          }
        );
        if (oembedRes.ok) {
          const data = (await oembedRes.json()) as {
            title?: unknown;
            author_name?: unknown;
            thumbnail_url?: unknown;
          };
          if (typeof data.title === 'string' && data.title.trim()) {
            title = data.title.trim().slice(0, 200);
          }
          if (typeof data.author_name === 'string' && data.author_name.trim()) {
            authorName = data.author_name.trim().slice(0, 140);
          }
          if (
            typeof data.thumbnail_url === 'string' &&
            /^https?:\/\//i.test(data.thumbnail_url.trim())
          ) {
            thumbnailUrl = data.thumbnail_url
              .trim()
              .replace(/^http:\/\//i, 'https://')
              .slice(0, 500);
          }
        }
      } catch {
        // Fallback metadata already prepared above
      }

      videos.push({
        id: `blog_yt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        kind: 'youtube',
        videoId,
        youtubeUrl: watchUrl,
        title,
        ...(authorName ? { authorName } : {}),
        thumbnailUrl,
      });
    }

    res.json({ videos });
  });

  // Resolve one or multiple SoundCloud tracks for attaching to a poem (Admin-only)
  app.post('/api/author/poem/resolve-soundcloud', async (req: Request, res: Response) => {
    const body = req.body as { url?: unknown; urls?: unknown };
    const resolved = await resolvePoemSoundCloudTracksInput(body);
    if (!resolved.ok) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    res.json({ track: resolved.tracks[0], tracks: resolved.tracks });
  });

  // SSRF-protected pinned-IP image proxy for extracting color palette from external poem image URLs (Admin-only)
  app.get('/api/author/image-proxy', async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Потрібен параметр url.' });
      return;
    }

    let currentValid = await validateExternalImageUrlForProxy(rawUrl);
    if (!currentValid) {
      res.status(400).json({ error: 'Недозволений або небезпечний URL зображення.' });
      return;
    }

    try {
      let response: { status: number; headers: Map<string, string>; buffer: Buffer } | null = null;
      for (let hop = 0; hop < 4; hop += 1) {
        const resHop = await fetchPinnedImageUrl(currentValid.url, currentValid.pinIp, 5 * 1024 * 1024);
        if (!resHop) {
          res.status(502).json({ error: 'Не вдалося завантажити зовнішнє зображення.' });
          return;
        }
        if (resHop.status >= 300 && resHop.status < 400) {
          const location = resHop.headers.get('location');
          if (!location) {
            res.status(400).json({ error: 'Не вдалося обробити перенаправлення зображення.' });
            return;
          }
          const nextTarget = new URL(location, currentValid.url).toString();
          const validatedNext = await validateExternalImageUrlForProxy(nextTarget);
          if (!validatedNext) {
            res.status(400).json({ error: 'Перенаправлення веде на недозволену адресу.' });
            return;
          }
          currentValid = validatedNext;
          continue;
        }

        response = resHop;
        break;
      }

      if (!response || response.status < 200 || response.status >= 300) {
        res.status(502).json({ error: 'Не вдалося завантажити зовнішнє зображення.' });
        return;
      }

      const contentType = (response.headers.get('content-type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);
      if (!allowedImageTypes.has(contentType)) {
        res.status(400).json({ error: 'Дозволені лише зображення форматів PNG, JPEG, WEBP або GIF.' });
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:;");
      res.send(response.buffer);
    } catch {
      res.status(502).json({ error: 'Не вдалося завантажити зображення для аналізу палітри.' });
    }
  });

  // Preview/extract tracks from a SoundCloud playlist or single track URL for Radio (Admin-only)
  app.post('/api/author/radio/resolve-playlist', async (req: Request, res: Response) => {
    const body = req.body as { url?: unknown; station?: unknown };
    const station: RadioStationId = body.station === 'electronic' ? 'electronic' : 'indie';
    const rawUrl =
      typeof body.url === 'string' ? body.url.trim().split(/[\r\n]+/)[0]?.trim() || '' : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Вставте посилання на плейлист або трек SoundCloud.' });
      return;
    }
    const normalized = normalizeSoundCloudInputUrl(rawUrl);
    if (!normalized) {
      res.status(400).json({
        error:
          'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/sets/playlist).',
      });
      return;
    }

    const canonical = await resolveSoundCloudShortUrl(normalized);
    if (isSoundCloudPlaylistUrl(canonical)) {
      const playlistRes = await resolveSoundCloudPlaylistTracks(canonical, station, 100);
      if (!playlistRes.ok) {
        res.status(400).json({ error: playlistRes.error });
        return;
      }
      res.json({
        kind: 'playlist',
        playlistTitle: playlistRes.playlistTitle,
        soundcloudUrl: playlistRes.soundcloudUrl,
        totalFound: playlistRes.totalFound,
        tracks: playlistRes.tracks,
      });
      return;
    }

    const resolvedTrack = await resolveSoundCloudTrackMetadata(canonical, station);
    if (!resolvedTrack.ok) {
      res.status(400).json({ error: resolvedTrack.error });
      return;
    }
    res.json({
      kind: 'track',
      playlistTitle: null,
      soundcloudUrl: resolvedTrack.track.soundcloudUrl,
      totalFound: 1,
      tracks: [resolvedTrack.track],
    });
  });

  // Add one or multiple SoundCloud tracks or full SoundCloud playlists to a radio station (Admin-only)
  app.post('/api/author/radio/tracks', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const body = req.body as { url?: unknown; urls?: unknown; station?: unknown };
    const station: RadioStationId = body.station === 'electronic' ? 'electronic' : 'indie';
    const candidateInputs: string[] = [];

    if (typeof body.url === 'string' && body.url.trim()) {
      for (const part of body.url.split(/[\r\n]+/)) {
        const clean = part.trim();
        if (clean) candidateInputs.push(clean);
      }
    }
    if (Array.isArray(body.urls)) {
      for (const item of body.urls) {
        if (typeof item === 'string' && item.trim()) {
          candidateInputs.push(item.trim());
        }
      }
    }

    const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 100);
    if (uniqueInputs.length === 0) {
      res.status(400).json({ error: 'Вставте посилання на пісню або плейлист SoundCloud.' });
      return;
    }

    if (db.radioTracks.length >= 200) {
      res.status(400).json({ error: 'Список радіо заповнений (максимум 200 треків).' });
      return;
    }

    const addedTracks: RadioTrack[] = [];
    let activatedTrackId: string | null = null;
    let mutated = false;
    let skippedDuplicates = 0;
    let lastPlaylistTitle: string | null = null;
    let playlistTrackAddedCount = 0;

    const canonicalInputs: string[] = [];
    for (const rawUrl of uniqueInputs) {
      const normalized = normalizeSoundCloudInputUrl(rawUrl);
      if (!normalized) {
        res.status(400).json({
          error:
            'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/track або /sets/playlist).',
        });
        return;
      }
      canonicalInputs.push(await resolveSoundCloudShortUrl(normalized));
    }

    const resolvedTracksQueue: RadioTrack[] = [];
    const singleTrackUrls: string[] = [];

    for (const canonical of canonicalInputs) {
      if (isSoundCloudPlaylistUrl(canonical)) {
        const remainingCapacity = Math.max(
          1,
          200 - db.radioTracks.length - resolvedTracksQueue.length
        );
        const playlistRes = await resolveSoundCloudPlaylistTracks(
          canonical,
          station,
          Math.min(100, remainingCapacity + 25)
        );
        if (!playlistRes.ok) {
          res.status(400).json({ error: playlistRes.error });
          return;
        }
        lastPlaylistTitle = playlistRes.playlistTitle;
        playlistTrackAddedCount += playlistRes.tracks.length;
        resolvedTracksQueue.push(...playlistRes.tracks);
      } else {
        singleTrackUrls.push(canonical);
      }
    }

    for (let i = 0; i < singleTrackUrls.length; i += 8) {
      const batch = singleTrackUrls.slice(i, i + 8);
      const batchResults = await Promise.all(
        batch.map((trackUrl) => resolveSoundCloudTrackMetadata(trackUrl, station))
      );
      for (const result of batchResults) {
        if (!result.ok) {
          res.status(400).json({ error: result.error });
          return;
        }
        resolvedTracksQueue.push(result.track);
      }
    }

    for (const resolvedTrack of resolvedTracksQueue) {
      const existing = db.radioTracks.find(
        (t) =>
          (t.station === 'electronic' ? 'electronic' : 'indie') === station &&
          t.soundcloudUrl.toLowerCase() === resolvedTrack.soundcloudUrl.toLowerCase()
      );
      if (existing) {
        skippedDuplicates += 1;
        if (!activatedTrackId) activatedTrackId = existing.id;
        continue;
      }
      if (db.radioTracks.length >= 200) break;
      resolvedTrack.order = db.radioTracks.length;
      db.radioTracks.push(resolvedTrack);
      addedTracks.push(resolvedTrack);
      if (!activatedTrackId) activatedTrackId = resolvedTrack.id;
      mutated = true;
    }

    if (mutated) {
      saveDatabase(db, { slices: ['radio'] });
    }

    res.status(mutated ? 201 : 200).json({
      station,
      addedTracks,
      skippedDuplicates,
      playlistTitle: lastPlaylistTitle,
      playlistTrackAddedCount,
      activatedTrackId:
        activatedTrackId ||
        db.radioTracks.find((t) => (t.station === 'electronic' ? 'electronic' : 'indie') === station)
          ?.id ||
        null,
      radioTracks: db.radioTracks,
    });
  });

  // Sync persisted radio tracks into server cache when hydrated from Firestore (Admin-only)
  app.put('/api/author/radio/tracks/sync', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { tracks } = req.body as { tracks?: unknown };
    if (!Array.isArray(tracks)) {
      res.status(400).json({ error: 'Невірний формат списку треків.' });
      return;
    }
    const sanitized: RadioTrack[] = [];
    const seenIds = new Set<string>();
    for (const raw of tracks.slice(0, 200)) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Partial<RadioTrack>;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const title = typeof item.title === 'string' ? item.title.trim().slice(0, 200) : '';
      const soundcloudUrl =
        typeof item.soundcloudUrl === 'string' ? item.soundcloudUrl.trim().slice(0, 500) : '';
      if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || seenIds.has(id)) continue;
      if (!title || !/^https?:\/\/.+/.test(soundcloudUrl)) continue;
      seenIds.add(id);
      const embedTargetUrl =
        typeof item.embedTargetUrl === 'string' && /^https?:\/\/.+/.test(item.embedTargetUrl.trim())
          ? item.embedTargetUrl.trim().slice(0, 500)
          : soundcloudUrl;
      const artworkUrl =
        typeof item.artworkUrl === 'string' && /^https?:\/\/.+/.test(item.artworkUrl.trim())
          ? item.artworkUrl.trim().slice(0, 500)
          : undefined;
      sanitized.push({
        id,
        title,
        artist:
          typeof item.artist === 'string' && item.artist.trim()
            ? item.artist.trim().slice(0, 140)
            : 'SoundCloud',
        soundcloudUrl,
        embedTargetUrl,
        ...(artworkUrl ? { artworkUrl } : {}),
        station: item.station === 'electronic' ? 'electronic' : 'indie',
        order: sanitized.length,
        addedAt: typeof item.addedAt === 'string' ? item.addedAt : new Date().toISOString(),
      });
    }
    db.radioTracks = sanitized;
    saveDatabase(db, { slices: ['radio'] });
    res.json({ radioTracks: db.radioTracks });
  });

  // Reorder SoundCloud tracks in the radio playlist or within a specific station (Admin-only)
  app.put('/api/author/radio/tracks/reorder', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { orderedIds, station } = req.body as { orderedIds?: unknown; station?: unknown };
    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ error: 'Невірний формат списку треків.' });
      return;
    }
    const cleanIds = orderedIds.filter((id): id is string => typeof id === 'string');
    const targetStation: RadioStationId | null =
      station === 'indie' || station === 'electronic' ? station : null;

    if (targetStation) {
      const stationTracks = db.radioTracks.filter(
        (t) => (t.station === 'electronic' ? 'electronic' : 'indie') === targetStation
      );
      const otherTracks = db.radioTracks.filter(
        (t) => (t.station === 'electronic' ? 'electronic' : 'indie') !== targetStation
      );
      const byId = new Map(stationTracks.map((t) => [t.id, t]));
      const reorderedStation: RadioTrack[] = [];
      const seen = new Set<string>();
      for (const id of cleanIds) {
        const found = byId.get(id);
        if (found && !seen.has(id)) {
          reorderedStation.push(found);
          seen.add(id);
        }
      }
      for (const track of stationTracks) {
        if (!seen.has(track.id)) {
          reorderedStation.push(track);
        }
      }
      db.radioTracks = [...reorderedStation, ...otherTracks].map((t, idx) => ({
        ...t,
        order: idx,
      }));
    } else {
      const byId = new Map(db.radioTracks.map((t) => [t.id, t]));
      const reordered: RadioTrack[] = [];
      const seen = new Set<string>();
      for (const id of cleanIds) {
        const found = byId.get(id);
        if (found && !seen.has(id)) {
          reordered.push(found);
          seen.add(id);
        }
      }
      for (const track of db.radioTracks) {
        if (!seen.has(track.id)) {
          reordered.push(track);
        }
      }
      db.radioTracks = reordered.map((t, idx) => ({ ...t, order: idx }));
    }

    saveDatabase(db, { slices: ['radio'] });
    res.json({ radioTracks: db.radioTracks });
  });

  // Remove a track from the radio playlist (Admin-only)
  app.delete('/api/author/radio/tracks/:id', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = db.radioTracks.length;
    db.radioTracks = db.radioTracks
      .filter((t) => t.id !== id)
      .map((t, idx) => ({ ...t, order: idx }));
    const deletedLocally = db.radioTracks.length !== before;
    if (deletedLocally) {
      saveDatabase(db, { slices: ['radio'] });
    }

    const token = extractBearerToken(req);
    const deletedInCloud = token ? await deleteRadioTrackInFirestore(id, token) : false;

    if (!deletedLocally && !deletedInCloud) {
      res.json({ deletedId: id, radioTracks: db.radioTracks, alreadyAbsent: true });
      return;
    }

    res.json({ deletedId: id, radioTracks: db.radioTracks });
  });

  // ── Weekly Music Selection (beside Radio, Admin CRUD) ─────────────────
  app.post('/api/author/weekly-music/resolve-soundcloud', async (req: Request, res: Response) => {
    const body = req.body as { url?: unknown; urls?: unknown };
    const result = await resolveWeeklySoundCloudInputs(body.url, body.urls);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      playlistTitle: result.playlistTitle,
      tracks: result.tracks,
    });
  });

  app.post('/api/author/weekly-music', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const body = req.body as {
      weekKey?: unknown;
      text?: unknown;
      photos?: unknown;
      tracks?: unknown;
      soundcloudUrl?: unknown;
      soundcloudUrls?: unknown;
    };

    const rawWeekKey = typeof body.weekKey === 'string' ? body.weekKey.trim() : '';
    const period = rawWeekKey ? getWeekPeriodForWeekKey(rawWeekKey) : getWeekPeriodForDate();
    if (!period) {
      res.status(400).json({ error: 'Вкажіть коректний тиждень у форматі РРРР-WНН.' });
      return;
    }

    const cleanText = typeof body.text === 'string' ? body.text.trim().slice(0, 5000) : '';
    const cleanPhotos = sanitizeWeeklyMusicPhotoList(body.photos);
    let cleanTracks = sanitizeWeeklyMusicTrackList(body.tracks);

    const hasRawSoundCloudInput =
      (typeof body.soundcloudUrl === 'string' && body.soundcloudUrl.trim().length > 0) ||
      (Array.isArray(body.soundcloudUrls) && body.soundcloudUrls.length > 0);
    if (hasRawSoundCloudInput) {
      const scRes = await resolveWeeklySoundCloudInputs(body.soundcloudUrl, body.soundcloudUrls);
      if (!scRes.ok) {
        res.status(400).json({ error: scRes.error });
        return;
      }
      cleanTracks = sanitizeWeeklyMusicTrackList([...cleanTracks, ...scRes.tracks]);
    }

    if (!cleanText && cleanPhotos.length === 0 && cleanTracks.length === 0) {
      res.status(400).json({ error: 'Додайте музику з SoundCloud, фото або короткий текст.' });
      return;
    }

    if (!Array.isArray(db.weeklyMusicSelections)) {
      db.weeklyMusicSelections = [];
    }

    const now = new Date().toISOString();
    const existingIdx = db.weeklyMusicSelections.findIndex((s) => s.weekKey === period.weekKey);
    let savedSelection: WeeklyMusicSelection;

    if (existingIdx >= 0) {
      const existing = db.weeklyMusicSelections[existingIdx];
      savedSelection = {
        ...existing,
        weekKey: period.weekKey,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        periodLabel: period.periodLabel,
        ...(cleanText ? { text: cleanText } : {}),
        photos: cleanPhotos,
        tracks: cleanTracks,
        updatedAt: now,
      };
      if (!cleanText) {
        delete savedSelection.text;
      }
      db.weeklyMusicSelections[existingIdx] = savedSelection;
    } else {
      savedSelection = {
        id: `wmusic_${period.weekKey}`,
        weekKey: period.weekKey,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        periodLabel: period.periodLabel,
        ...(cleanText ? { text: cleanText } : {}),
        photos: cleanPhotos,
        tracks: cleanTracks,
        createdAt: now,
        updatedAt: now,
      };
      db.weeklyMusicSelections.unshift(savedSelection);
    }

    db.weeklyMusicSelections = sortWeeklyMusicSelections(db.weeklyMusicSelections);
    saveDatabase(db, { slices: ['radio'] });

    const token = extractBearerToken(req);
    if (token) {
      void syncSingleWeeklyMusicSelectionInFirestore(savedSelection, token).catch(() => {});
    }

    res.status(existingIdx >= 0 ? 200 : 201).json({
      selection: savedSelection,
      weeklyMusicSelections: db.weeklyMusicSelections,
    });
  });

  app.put('/api/author/weekly-music/:id', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const list = Array.isArray(db.weeklyMusicSelections) ? db.weeklyMusicSelections : [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Щотижневу підбірку не знайдено.' });
      return;
    }

    const existing = list[idx];
    const body = req.body as {
      weekKey?: unknown;
      text?: unknown;
      photos?: unknown;
      tracks?: unknown;
    };

    const nextPeriod =
      typeof body.weekKey === 'string' && body.weekKey.trim()
        ? getWeekPeriodForWeekKey(body.weekKey.trim())
        : {
            weekKey: existing.weekKey,
            periodStart: existing.periodStart,
            periodEnd: existing.periodEnd,
            periodLabel: existing.periodLabel,
          };
    if (!nextPeriod) {
      res.status(400).json({ error: 'Вкажіть коректний тиждень у форматі РРРР-WНН.' });
      return;
    }

    const nextText =
      typeof body.text === 'string'
        ? body.text.trim().slice(0, 5000) || undefined
        : existing.text;
    const nextPhotos =
      body.photos !== undefined ? sanitizeWeeklyMusicPhotoList(body.photos) : existing.photos;
    const nextTracks =
      body.tracks !== undefined ? sanitizeWeeklyMusicTrackList(body.tracks) : existing.tracks;

    if (!nextText && nextPhotos.length === 0 && nextTracks.length === 0) {
      res.status(400).json({ error: 'Додайте музику з SoundCloud, фото або короткий текст.' });
      return;
    }

    const updated: WeeklyMusicSelection = {
      ...existing,
      weekKey: nextPeriod.weekKey,
      periodStart: nextPeriod.periodStart,
      periodEnd: nextPeriod.periodEnd,
      periodLabel: nextPeriod.periodLabel,
      ...(nextText ? { text: nextText } : {}),
      photos: nextPhotos,
      tracks: nextTracks,
      updatedAt: new Date().toISOString(),
    };
    if (!nextText) {
      delete updated.text;
    }

    list[idx] = updated;
    db.weeklyMusicSelections = sortWeeklyMusicSelections(list);
    saveDatabase(db, { slices: ['radio'] });

    const token = extractBearerToken(req);
    if (token) {
      void syncSingleWeeklyMusicSelectionInFirestore(updated, token).catch(() => {});
    }

    res.json({
      selection: updated,
      weeklyMusicSelections: db.weeklyMusicSelections,
    });
  });

  app.delete('/api/author/weekly-music/:id', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const list = Array.isArray(db.weeklyMusicSelections) ? db.weeklyMusicSelections : [];
    const before = list.length;
    db.weeklyMusicSelections = sortWeeklyMusicSelections(list.filter((s) => s.id !== id));
    const deletedLocally = db.weeklyMusicSelections.length !== before;
    if (deletedLocally) {
      saveDatabase(db, { slices: ['radio'] });
    }

    const token = extractBearerToken(req);
    const deletedInCloud = token ? await deleteWeeklyMusicSelectionInFirestore(id, token) : false;

    res.json({
      deletedId: id,
      deletedLocally,
      deletedInCloud,
      weeklyMusicSelections: db.weeklyMusicSelections,
    });
  });

  // ── Monthly SoundCloud Selections (Admin CRUD) ──────────────────────────
  app.post('/api/author/selections', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const body = req.body as { monthKey?: unknown; title?: unknown; description?: unknown };
    const monthKey = typeof body.monthKey === 'string' ? body.monthKey.trim() : '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      res.status(400).json({ error: 'Вкажіть коректний місяць у форматі РРРР-ММ.' });
      return;
    }
    const rawTitle = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : '';
    const title = rawTitle || formatDefaultMonthTitle(monthKey);
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim().slice(0, 1000)
        : undefined;

    const now = new Date().toISOString();
    const selection: MonthlySelection = {
      id: `sel_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      monthKey,
      title,
      ...(description ? { description } : {}),
      tracks: [],
      order: 0,
      createdAt: now,
      updatedAt: now,
    };

    db.monthlySelections = [selection, ...(db.monthlySelections || [])].map((item, idx) => ({
      ...item,
      order: idx,
    }));
    saveDatabase(db, { slices: ['radio'] });
    res.status(201).json({
      selection,
      monthlySelections: getSortedSelections(db),
    });
  });

  app.put('/api/author/selections/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const list = db.monthlySelections || [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Щомісячну підбірку не знайдено.' });
      return;
    }
    const body = req.body as { monthKey?: unknown; title?: unknown; description?: unknown };
    const existing = list[idx];
    const nextMonthKey =
      typeof body.monthKey === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.monthKey.trim())
        ? body.monthKey.trim()
        : existing.monthKey;
    const nextTitle =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 160)
        : existing.title;
    const nextDescription =
      typeof body.description === 'string'
        ? body.description.trim().slice(0, 1000) || undefined
        : existing.description;

    const updated: MonthlySelection = {
      ...existing,
      monthKey: nextMonthKey,
      title: nextTitle,
      ...(nextDescription ? { description: nextDescription } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (!nextDescription) {
      delete updated.description;
    }

    list[idx] = updated;
    db.monthlySelections = list;
    saveDatabase(db, { slices: ['radio'] });
    res.json({
      selection: updated,
      monthlySelections: getSortedSelections(db),
    });
  });

  app.delete('/api/author/selections/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = (db.monthlySelections || []).length;
    db.monthlySelections = (db.monthlySelections || [])
      .filter((s) => s.id !== id)
      .map((s, idx) => ({ ...s, order: idx }));
    if (db.monthlySelections.length !== before) {
      saveDatabase(db, { slices: ['radio'] });
    }
    res.json({
      deletedId: id,
      monthlySelections: getSortedSelections(db),
    });
  });

  app.post('/api/author/selections/:id/tracks', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const list = db.monthlySelections || [];
    const selIndex = list.findIndex((s) => s.id === id);
    if (selIndex === -1) {
      res.status(404).json({ error: 'Щомісячну підбірку не знайдено.' });
      return;
    }

    const selection = list[selIndex];
    if (selection.tracks.length >= 100) {
      res.status(400).json({ error: 'У підбірці може бути максимум 100 треків.' });
      return;
    }

    const body = req.body as { url?: unknown; urls?: unknown; note?: unknown };
    const sharedNote =
      typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : undefined;
    const candidateInputs: string[] = [];

    if (typeof body.url === 'string' && body.url.trim()) {
      for (const part of body.url.split(/[\r\n]+/)) {
        const clean = part.trim();
        if (clean) candidateInputs.push(clean);
      }
    }
    if (Array.isArray(body.urls)) {
      for (const item of body.urls) {
        if (typeof item === 'string' && item.trim()) {
          candidateInputs.push(item.trim());
        }
      }
    }

    const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 100);
    if (uniqueInputs.length === 0) {
      res.status(400).json({ error: 'Вставте посилання на пісню або плейлист SoundCloud.' });
      return;
    }

    const canonicalInputs: string[] = [];
    for (const rawUrl of uniqueInputs) {
      const normalized = normalizeSoundCloudInputUrl(rawUrl);
      if (!normalized) {
        res.status(400).json({
          error:
            'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/track або /sets/playlist).',
        });
        return;
      }
      canonicalInputs.push(await resolveSoundCloudShortUrl(normalized));
    }

    const resolvedTracksQueue: RadioTrack[] = [];
    const singleTrackUrls: string[] = [];
    let lastPlaylistTitle: string | null = null;

    for (const canonical of canonicalInputs) {
      if (isSoundCloudPlaylistUrl(canonical)) {
        const remainingCapacity = Math.max(
          1,
          100 - selection.tracks.length - resolvedTracksQueue.length
        );
        const playlistRes = await resolveSoundCloudPlaylistTracks(
          canonical,
          'indie',
          Math.min(100, remainingCapacity + 25)
        );
        if (!playlistRes.ok) {
          res.status(400).json({ error: playlistRes.error });
          return;
        }
        lastPlaylistTitle = playlistRes.playlistTitle;
        resolvedTracksQueue.push(...playlistRes.tracks);
      } else {
        singleTrackUrls.push(canonical);
      }
    }

    for (let i = 0; i < singleTrackUrls.length; i += 8) {
      const batch = singleTrackUrls.slice(i, i + 8);
      const batchResults = await Promise.all(
        batch.map((trackUrl) => resolveSoundCloudTrackMetadata(trackUrl, 'indie'))
      );
      for (const result of batchResults) {
        if (!result.ok) {
          res.status(400).json({ error: result.error });
          return;
        }
        resolvedTracksQueue.push(result.track);
      }
    }

    const addedTracks: MonthlySelectionTrack[] = [];
    let skippedDuplicates = 0;
    const nextTracks = [...selection.tracks];

    for (const resolved of resolvedTracksQueue) {
      const duplicate = nextTracks.some(
        (t) => t.soundcloudUrl.toLowerCase() === resolved.soundcloudUrl.toLowerCase()
      );
      if (duplicate) {
        skippedDuplicates += 1;
        continue;
      }
      if (nextTracks.length >= 100) break;
      const track: MonthlySelectionTrack = {
        id: `seltr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        title: resolved.title,
        artist: resolved.artist,
        soundcloudUrl: resolved.soundcloudUrl,
        embedTargetUrl: resolved.embedTargetUrl || resolved.soundcloudUrl,
        ...(resolved.artworkUrl ? { artworkUrl: resolved.artworkUrl } : {}),
        ...(sharedNote ? { note: sharedNote } : {}),
        addedAt: new Date().toISOString(),
      };
      nextTracks.push(track);
      addedTracks.push(track);
    }

    const updated: MonthlySelection = {
      ...selection,
      tracks: nextTracks,
      updatedAt: new Date().toISOString(),
    };

    if (addedTracks.length > 0) {
      list[selIndex] = updated;
      db.monthlySelections = list;
      saveDatabase(db, { slices: ['radio'] });
    }

    res.status(addedTracks.length > 0 ? 201 : 200).json({
      selection: updated,
      addedTracks,
      skippedDuplicates,
      playlistTitle: lastPlaylistTitle,
      monthlySelections: getSortedSelections(db),
    });
  });

  app.put('/api/author/selections/:id/tracks/reorder', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const list = db.monthlySelections || [];
    const selIndex = list.findIndex((s) => s.id === id);
    if (selIndex === -1) {
      res.status(404).json({ error: 'Щомісячну підбірку не знайдено.' });
      return;
    }
    const { orderedIds } = req.body as { orderedIds?: unknown };
    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ error: 'Невірний формат списку треків.' });
      return;
    }
    const selection = list[selIndex];
    const byId = new Map(selection.tracks.map((t) => [t.id, t]));
    const reordered: MonthlySelectionTrack[] = [];
    const seen = new Set<string>();
    for (const rawId of orderedIds) {
      if (typeof rawId !== 'string') continue;
      const found = byId.get(rawId);
      if (found && !seen.has(rawId)) {
        reordered.push(found);
        seen.add(rawId);
      }
    }
    for (const track of selection.tracks) {
      if (!seen.has(track.id)) {
        reordered.push(track);
      }
    }
    const updated: MonthlySelection = {
      ...selection,
      tracks: reordered,
      updatedAt: new Date().toISOString(),
    };
    list[selIndex] = updated;
    db.monthlySelections = list;
    saveDatabase(db, { slices: ['radio'] });
    res.json({
      selection: updated,
      monthlySelections: getSortedSelections(db),
    });
  });

  app.patch('/api/author/selections/:id/tracks/:trackId', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id, trackId } = req.params;
    const list = db.monthlySelections || [];
    const selIndex = list.findIndex((s) => s.id === id);
    if (selIndex === -1) {
      res.status(404).json({ error: 'Щомісячну підбірку не знайдено.' });
      return;
    }
    const selection = list[selIndex];
    const trackIndex = selection.tracks.findIndex((t) => t.id === trackId);
    if (trackIndex === -1) {
      res.status(404).json({ error: 'Трек не знайдено.' });
      return;
    }

    const body = req.body as { title?: unknown; artist?: unknown; note?: unknown };
    const existingTrack = selection.tracks[trackIndex];
    const nextTitle =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 200)
        : existingTrack.title;
    const nextArtist =
      typeof body.artist === 'string' && body.artist.trim()
        ? body.artist.trim().slice(0, 140)
        : existingTrack.artist;
    const nextNote =
      typeof body.note === 'string'
        ? body.note.trim().slice(0, 300) || undefined
        : existingTrack.note;

    const updatedTrack: MonthlySelectionTrack = {
      ...existingTrack,
      title: nextTitle,
      artist: nextArtist,
      ...(nextNote ? { note: nextNote } : {}),
    };
    if (!nextNote) {
      delete updatedTrack.note;
    }

    const nextTracks = [...selection.tracks];
    nextTracks[trackIndex] = updatedTrack;
    const updatedSelection: MonthlySelection = {
      ...selection,
      tracks: nextTracks,
      updatedAt: new Date().toISOString(),
    };
    list[selIndex] = updatedSelection;
    db.monthlySelections = list;
    saveDatabase(db, { slices: ['radio'] });
    res.json({
      selection: updatedSelection,
      track: updatedTrack,
      monthlySelections: getSortedSelections(db),
    });
  });

  app.delete('/api/author/selections/:id/tracks/:trackId', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id, trackId } = req.params;
    const list = db.monthlySelections || [];
    const selIndex = list.findIndex((s) => s.id === id);
    if (selIndex === -1) {
      res.status(404).json({ error: 'Щомісячну підбірку не знайдено.' });
      return;
    }
    const selection = list[selIndex];
    const nextTracks = selection.tracks.filter((t) => t.id !== trackId);
    const updatedSelection: MonthlySelection = {
      ...selection,
      tracks: nextTracks,
      updatedAt: new Date().toISOString(),
    };
    if (nextTracks.length !== selection.tracks.length) {
      list[selIndex] = updatedSelection;
      db.monthlySelections = list;
      saveDatabase(db, { slices: ['radio'] });
    }
    res.json({
      deletedTrackId: trackId,
      selection: updatedSelection,
      monthlySelections: getSortedSelections(db),
    });
  });

  // Remove attached PDF from a prose work (Admin-only)
  app.delete('/api/author/works/prose/:id/pdf', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.prose.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }
    const existing = db.prose[index];
    if (existing.pdfStorageKey) {
      const pdfPath = resolveConfinedFilePath(PROSE_PDF_DIR, existing.pdfStorageKey);
      if (pdfPath && fs.existsSync(pdfPath)) {
        try {
          fs.unlinkSync(pdfPath);
        } catch {
          // Ignore cleanup failure
        }
      }
    }
    const { pdfFileName: _n, pdfFileSize: _s, pdfStorageKey: _k, ...rest } = existing;
    db.prose[index] = { ...rest };
    saveDatabase(db, { slices: ['prose'] });
    res.json({ item: enrichProseForAuthor(db.prose[index], db) });
  });

  // Update paid access pricing and/or collection/book tags on an existing prose work (Admin-only)
  app.put('/api/author/works/prose/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.prose.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }
    const body = req.body as {
      accessMode?: ProseAccessMode;
      requiresAuth?: boolean;
      isPaid?: boolean;
      priceUah?: number;
      tagIds?: string[];
      status?: ProseStatus | null | 'none';
      moodboardUrls?: string[];
    };
    const current = db.prose[index];
    const currentMode = resolveProseAccessMode(current);
    let nextAccessMode: ProseAccessMode = currentMode;
    if (body.accessMode === 'public' || body.accessMode === 'authorized' || body.accessMode === 'paid') {
      nextAccessMode = body.accessMode;
    } else if (body.requiresAuth === true) {
      nextAccessMode = 'authorized';
    } else if (body.isPaid !== undefined) {
      nextAccessMode = body.isPaid ? 'paid' : 'public';
    }

    const nextIsPaid = nextAccessMode === 'paid';
    const nextRequiresAuth = nextAccessMode === 'authorized';
    const nextPrice = nextIsPaid
      ? Math.max(10, Math.round(Number(body.priceUah) || current.priceUah || 75))
      : 0;
    const nextTagIds =
      body.tagIds !== undefined
        ? getValidProseTagIds(body.tagIds, db)
        : getValidProseTagIds(current.tagIds, db);
    const nextStatus =
      body.status === undefined
        ? current.status
        : body.status === null || body.status === 'none'
          ? ('none' as unknown as ProseStatus)
          : normalizeProseStatus(body.status);
    const validPhotoUrlPattern = /^(\/src\/assets\/|\/uploads\/|\/assets\/|https?:\/\/)/i;
    const nextMoodboardUrls =
      body.moodboardUrls !== undefined && Array.isArray(body.moodboardUrls)
        ? Array.from(
            new Set(
              body.moodboardUrls
                .filter((item): item is string => typeof item === 'string' && validPhotoUrlPattern.test(item.trim()))
                .map((item) => item.trim())
            )
          ).slice(0, 20)
        : current.moodboardUrls;

    db.prose[index] = {
      ...current,
      accessMode: nextAccessMode,
      requiresAuth: nextRequiresAuth,
      isPaid: nextIsPaid,
      priceUah: nextPrice,
      tagIds: nextTagIds,
      status: nextStatus,
      moodboardUrls: nextMoodboardUrls,
    };
    saveDatabase(db, { slices: ['prose'] });
    res.json({ item: enrichProseForAuthor(db.prose[index], db) });
  });

  // Add a new chapter into a prose card folder (Admin-only)
  app.post('/api/author/works/prose/:id/chapters', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.prose.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const { title, content, publishedAt } = req.body as {
      title?: string;
      content?: string;
      publishedAt?: string;
    };
    const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 140) : '';
    const cleanContent = typeof content === 'string' ? preserveFormattedText(content) : '';
    if (cleanTitle.length < 2) {
      res.status(400).json({ error: 'Назва розділу має містити щонайменше 2 символи.' });
      return;
    }
    if (cleanContent.length < 2) {
      res.status(400).json({ error: 'Додайте текст нового розділу.' });
      return;
    }

    const rawDateStr = typeof publishedAt === 'string' ? publishedAt.trim() : '';
    let formattedPublishedAt = new Date().toLocaleDateString('uk-UA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    if (rawDateStr) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawDateStr)) {
        const [y, m, d] = rawDateStr.split('-').map(Number);
        const parsedDate = new Date(y, m - 1, d);
        if (!Number.isNaN(parsedDate.getTime())) {
          formattedPublishedAt = parsedDate.toLocaleDateString('uk-UA', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });
        }
      } else {
        formattedPublishedAt = rawDateStr;
      }
    }

    const newChapter: ProseChapter = {
      id: `chap-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      title: cleanTitle,
      content: cleanContent,
      publishedAt: formattedPublishedAt,
    };

    const existingChapters = Array.isArray(db.prose[index].chapters) ? db.prose[index].chapters! : [];
    const nextChapters = [...existingChapters, newChapter];
    db.prose[index] = {
      ...db.prose[index],
      chapters: nextChapters,
      pages: computeProseWorkPages({
        content: db.prose[index].content,
        chapters: nextChapters,
        hasPdf: Boolean(db.prose[index].pdfStorageKey),
        fallbackPages: db.prose[index].pages,
      }),
    };
    saveDatabase(db, { slices: ['prose'] });
    res.status(201).json({ chapter: newChapter, item: enrichProseForAuthor(db.prose[index], db) });
  });

  // Delete a chapter from a prose card folder (Admin-only)
  app.delete('/api/author/works/prose/:id/chapters/:chapterId', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id, chapterId } = req.params;
    const index = db.prose.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const existingChapters = Array.isArray(db.prose[index].chapters) ? db.prose[index].chapters! : [];
    const nextChapters = existingChapters.filter((ch) => ch.id !== chapterId);
    if (nextChapters.length === existingChapters.length) {
      res.status(404).json({ error: 'Розділ не знайдено.' });
      return;
    }

    db.prose[index] = {
      ...db.prose[index],
      chapters: nextChapters,
      pages: computeProseWorkPages({
        content: db.prose[index].content,
        chapters: nextChapters,
        hasPdf: Boolean(db.prose[index].pdfStorageKey),
        fallbackPages: db.prose[index].pages,
      }),
    };
    saveDatabase(db, { slices: ['prose'] });
    res.json({ item: enrichProseForAuthor(db.prose[index], db) });
  });

  // Create a manual bright collection/book tag for prose (Admin-only)
  app.post('/api/author/prose-tags', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { label, color } = req.body as { label?: string; color?: ProseTagColor };
    const cleanLabel = typeof label === 'string' ? label.trim().slice(0, 60) : '';
    if (cleanLabel.length < 2) {
      res.status(400).json({ error: 'Назва тегу має містити щонайменше 2 символи.' });
      return;
    }
    if (db.proseTags.some((t) => t.label.toLowerCase() === cleanLabel.toLowerCase())) {
      res.status(409).json({ error: 'Такий тег збірки чи книги вже існує.' });
      return;
    }
    const safeColor: ProseTagColor = normalizeProseTagColor(color);
    const newTag: ProseTag = {
      id: `tag-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      label: cleanLabel,
      color: safeColor,
    };
    db.proseTags.push(newTag);
    saveDatabase(db, { slices: ['prose'] });
    res.status(201).json({ tag: newTag, proseTags: db.proseTags });
  });

  // Update color or label of an existing prose tag (Admin-only)
  app.put('/api/author/prose-tags/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.proseTags.findIndex((t) => t.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Тег не знайдено.' });
      return;
    }
    const { label, color } = req.body as { label?: string; color?: ProseTagColor };
    const current = db.proseTags[index];
    const nextLabel =
      typeof label === 'string' && label.trim().length >= 2
        ? label.trim().slice(0, 60)
        : current.label;
    const nextColor = color !== undefined ? normalizeProseTagColor(color) : current.color;

    db.proseTags[index] = {
      ...current,
      label: nextLabel,
      color: nextColor,
    };
    saveDatabase(db, { slices: ['prose'] });
    res.json({ tag: db.proseTags[index], proseTags: db.proseTags });
  });

  // Delete a prose collection/book tag and unlink from all works (Admin-only)
  app.delete('/api/author/prose-tags/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = db.proseTags.length;
    db.proseTags = db.proseTags.filter((t) => t.id !== id);
    if (db.proseTags.length === before) {
      res.status(404).json({ error: 'Тег не знайдено.' });
      return;
    }
    db.prose = db.prose.map((work) => ({
      ...work,
      tagIds: (work.tagIds || []).filter((tid) => tid !== id),
    }));
    saveDatabase(db, { slices: ['prose'] });
    res.json({ deletedId: id, proseTags: db.proseTags });
  });

  // Update homepage hero lead block text, author profile, Monobank, interviews & social links
  app.put('/api/author/settings', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const {
      heroLeadText,
      authorAboutText,
      authorPhotoUrl,
      authorPhotos,
      socialLinks,
      monobankJarUrl,
      monobankModalTitle,
      monobankModalSubtitle,
      monobankCardLabel,
      monobankModalText,
      monobankEmptyText,
      contactEmail,
      interviews,
      homeActionAboutTitle,
      homeActionContactTitle,
      homeActionMonobankTitle,
      homeActionInterviewsTitle,
      homeRepeaters,
      proseAuthDiscountPercent,
      proseTelegramDiscountPercent,
    } = req.body as {
      heroLeadText?: string;
      authorAboutText?: string;
      authorPhotoUrl?: string;
      authorPhotos?: string[];
      socialLinks?: SocialLinkItem[];
      monobankJarUrl?: string;
      monobankModalTitle?: string;
      monobankModalSubtitle?: string;
      monobankCardLabel?: string;
      monobankModalText?: string;
      monobankEmptyText?: string;
      contactEmail?: string;
      interviews?: InterviewLinkItem[];
      homeActionAboutTitle?: string;
      homeActionContactTitle?: string;
      homeActionMonobankTitle?: string;
      homeActionInterviewsTitle?: string;
      homeRepeaters?: unknown;
      proseAuthDiscountPercent?: number;
      proseTelegramDiscountPercent?: number;
    };

    if (proseAuthDiscountPercent !== undefined) {
      const parsedDiscount = Number(proseAuthDiscountPercent);
      if (!Number.isFinite(parsedDiscount)) {
        res.status(400).json({ error: 'Вкажіть коректний відсоток знижки (від 0 до 90%).' });
        return;
      }
      db.proseAuthDiscountPercent = Math.max(0, Math.min(90, Math.round(parsedDiscount)));
    }

    if (proseTelegramDiscountPercent !== undefined) {
      const parsedTgDiscount = Number(proseTelegramDiscountPercent);
      if (!Number.isFinite(parsedTgDiscount)) {
        res.status(400).json({
          error: 'Вкажіть коректний відсоток знижки в Прозі для Telegram (від 0 до 90%).',
        });
        return;
      }
      db.proseTelegramDiscountPercent = Math.max(0, Math.min(90, Math.round(parsedTgDiscount)));
    }

    if (homeActionAboutTitle !== undefined) {
      if (
        typeof homeActionAboutTitle !== 'string' ||
        homeActionAboutTitle.trim().length === 0 ||
        homeActionAboutTitle.trim().length > 60
      ) {
        res.status(400).json({ error: 'Некоректна назва кнопки (до 60 символів).' });
        return;
      }
      db.homeActionAboutTitle = homeActionAboutTitle.trim();
    }

    if (homeActionContactTitle !== undefined) {
      if (
        typeof homeActionContactTitle !== 'string' ||
        homeActionContactTitle.trim().length === 0 ||
        homeActionContactTitle.trim().length > 60
      ) {
        res.status(400).json({ error: 'Некоректна назва кнопки (до 60 символів).' });
        return;
      }
      db.homeActionContactTitle = homeActionContactTitle.trim();
    }

    if (homeActionMonobankTitle !== undefined) {
      if (
        typeof homeActionMonobankTitle !== 'string' ||
        homeActionMonobankTitle.trim().length === 0 ||
        homeActionMonobankTitle.trim().length > 60
      ) {
        res.status(400).json({ error: 'Некоректна назва кнопки (до 60 символів).' });
        return;
      }
      db.homeActionMonobankTitle = homeActionMonobankTitle.trim();
    }

    if (homeActionInterviewsTitle !== undefined) {
      if (
        typeof homeActionInterviewsTitle !== 'string' ||
        homeActionInterviewsTitle.trim().length === 0 ||
        homeActionInterviewsTitle.trim().length > 60
      ) {
        res.status(400).json({ error: 'Некоректна назва кнопки (до 60 символів).' });
        return;
      }
      db.homeActionInterviewsTitle = homeActionInterviewsTitle.trim();
    }

    if (homeRepeaters !== undefined) {
      db.homeRepeaters = normalizeHomeRepeatersConfig(homeRepeaters);
    }

    if (heroLeadText !== undefined) {
      if (typeof heroLeadText !== 'string' || heroLeadText.trim().length > 500) {
        res.status(400).json({ error: 'Текст опису не може перевищувати 500 символів.' });
        return;
      }
      db.heroLeadText = heroLeadText.trim();
    }

    if (authorAboutText !== undefined) {
      if (typeof authorAboutText !== 'string' || authorAboutText.trim().length > 2500) {
        res.status(400).json({ error: 'Текст блоку «Про мене» не може перевищувати 2500 символів.' });
        return;
      }
      db.authorAboutText = authorAboutText.trim();
    }

    const validPhotoUrlPattern = /^(\/src\/assets\/|\/uploads\/|\/assets\/|https?:\/\/)/i;

    if (authorPhotos !== undefined) {
      if (!Array.isArray(authorPhotos)) {
        res.status(400).json({ error: 'Некоректний формат галереї фото автора.' });
        return;
      }
      const nextPhotos = Array.from(
        new Set(
          authorPhotos
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
        )
      ).slice(0, 20);

      for (const photo of nextPhotos) {
        if (!validPhotoUrlPattern.test(photo)) {
          res.status(400).json({
            error: 'Кожне фото автора повинно бути завантажене або мати валідну URL-адресу.',
          });
          return;
        }
      }

      db.authorPhotos = nextPhotos.length > 0 ? nextPhotos : [DEFAULT_AUTHOR_PHOTO_URL];
      db.authorPhotoUrl = db.authorPhotos[0];
    } else if (authorPhotoUrl !== undefined) {
      if (typeof authorPhotoUrl !== 'string') {
        res.status(400).json({ error: 'Некоректне посилання на фото автора.' });
        return;
      }
      const trimmedPhoto = authorPhotoUrl.trim();
      if (!trimmedPhoto) {
        db.authorPhotoUrl = DEFAULT_AUTHOR_PHOTO_URL;
      } else if (!validPhotoUrlPattern.test(trimmedPhoto)) {
        res.status(400).json({
          error: 'Фото автора повинно бути завантажене або мати валідну URL-адресу.',
        });
        return;
      } else {
        db.authorPhotoUrl = trimmedPhoto;
      }
      const rest = (db.authorPhotos || []).filter((url) => url !== db.authorPhotoUrl);
      db.authorPhotos = [db.authorPhotoUrl, ...rest].slice(0, 20);
    }

    if (socialLinks !== undefined) {
      if (!Array.isArray(socialLinks)) {
        res.status(400).json({ error: 'Некоректний формат списку соціальних мереж.' });
        return;
      }
      const incomingMap = new Map(
        socialLinks
          .filter((item): item is SocialLinkItem => Boolean(item && typeof item.platform === 'string'))
          .map((item) => [item.platform, item])
      );

      const nextSocialLinks: SocialLinkItem[] = [];
      for (const seed of DEFAULT_SOCIAL_LINKS) {
        const incoming = incomingMap.get(seed.platform);
        if (!incoming) {
          const current = db.socialLinks.find((s) => s.platform === seed.platform);
          nextSocialLinks.push(current ? { ...current } : { ...seed });
          continue;
        }
        const rawUrl = typeof incoming.url === 'string' ? incoming.url.trim() : '';
        const normalizedUrl =
          rawUrl && !/^https?:\/\//i.test(rawUrl) && !/^[a-z]+:/i.test(rawUrl)
            ? `https://${rawUrl}`
            : rawUrl;
        if (normalizedUrl && !/^https?:\/\/\S+$/i.test(normalizedUrl)) {
          res.status(400).json({
            error: `Некоректне посилання для ${seed.label}. Використовуйте адресу http:// або https://.`,
          });
          return;
        }
        const enabled = Boolean(incoming.enabled) && Boolean(normalizedUrl);
        nextSocialLinks.push({
          platform: seed.platform,
          label: seed.label,
          url: normalizedUrl,
          enabled,
        });
      }
      db.socialLinks = nextSocialLinks;
    }

    if (monobankJarUrl !== undefined) {
      if (typeof monobankJarUrl !== 'string') {
        res.status(400).json({ error: 'Некоректне посилання на банку Монобанку.' });
        return;
      }
      const rawJar = monobankJarUrl.trim();
      const normalizedJar =
        rawJar && !/^https?:\/\//i.test(rawJar) && !/^[a-z]+:/i.test(rawJar)
          ? `https://${rawJar}`
          : rawJar;
      if (normalizedJar && !/^https?:\/\/\S+$/i.test(normalizedJar)) {
        res.status(400).json({
          error: 'Посилання на Монобанку повинно починатися з https:// або http://.',
        });
        return;
      }
      db.monobankJarUrl = normalizedJar;
    }

    if (monobankModalTitle !== undefined) {
      if (
        typeof monobankModalTitle !== 'string' ||
        monobankModalTitle.trim().length === 0 ||
        monobankModalTitle.trim().length > 120
      ) {
        res.status(400).json({ error: 'Заголовок вікна Монобанки має містити від 1 до 120 символів.' });
        return;
      }
      db.monobankModalTitle = monobankModalTitle.trim();
    }

    if (monobankModalSubtitle !== undefined) {
      if (typeof monobankModalSubtitle !== 'string' || monobankModalSubtitle.trim().length > 300) {
        res.status(400).json({
          error: 'Підзаголовок вікна Монобанки не може перевищувати 300 символів.',
        });
        return;
      }
      db.monobankModalSubtitle = monobankModalSubtitle.trim();
    }

    if (monobankCardLabel !== undefined) {
      if (typeof monobankCardLabel !== 'string' || monobankCardLabel.trim().length > 80) {
        res.status(400).json({ error: 'Підпис картки Монобанки не може перевищувати 80 символів.' });
        return;
      }
      db.monobankCardLabel = monobankCardLabel.trim();
    }

    if (monobankModalText !== undefined) {
      if (typeof monobankModalText !== 'string' || monobankModalText.trim().length > 1500) {
        res.status(400).json({
          error: 'Основний текст вікна Монобанки не може перевищувати 1500 символів.',
        });
        return;
      }
      db.monobankModalText = monobankModalText.trim();
    }

    if (monobankEmptyText !== undefined) {
      if (typeof monobankEmptyText !== 'string' || monobankEmptyText.trim().length > 1000) {
        res.status(400).json({
          error: 'Текст про відсутність посилання на банку не може перевищувати 1000 символів.',
        });
        return;
      }
      db.monobankEmptyText = monobankEmptyText.trim();
    }

    if (contactEmail !== undefined) {
      if (typeof contactEmail !== 'string') {
        res.status(400).json({ error: 'Некоректна адреса електронної пошти.' });
        return;
      }
      const trimmedEmail = contactEmail.trim();
      if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        res.status(400).json({
          error: 'Вкажіть коректний контактний email або залиште поле порожнім.',
        });
        return;
      }
      db.contactEmail = trimmedEmail;
    }

    if (interviews !== undefined) {
      if (!Array.isArray(interviews)) {
        res.status(400).json({ error: 'Некоректний формат списку розмов.' });
        return;
      }
      const nextInterviews: InterviewLinkItem[] = [];
      for (const item of interviews) {
        if (!item || typeof item !== 'object') continue;
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const outlet = typeof item.outlet === 'string' ? item.outlet.trim() : '';
        const dateLabel = typeof item.dateLabel === 'string' ? item.dateLabel.trim() : '';
        const content = typeof item.content === 'string' ? item.content.trim() : '';
        const rawUrl = typeof item.url === 'string' ? item.url.trim() : '';
        const normalizedUrl =
          rawUrl && !/^https?:\/\//i.test(rawUrl) && !/^[a-z]+:/i.test(rawUrl)
            ? `https://${rawUrl}`
            : rawUrl;
        if (!title || (!content && !normalizedUrl)) {
          res.status(400).json({ error: 'Кожна розмова повинна містити назву та текст або посилання.' });
          return;
        }
        if (normalizedUrl && !/^https?:\/\/\S+$/i.test(normalizedUrl)) {
          res.status(400).json({
            error: `Некоректне посилання для розмови «${title}». Використовуйте https:// або http://.`,
          });
          return;
        }
        nextInterviews.push({
          id:
            typeof item.id === 'string' && item.id.trim()
              ? item.id.trim()
              : `interview-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          title,
          outlet,
          dateLabel,
          ...(content ? { content: content.slice(0, 100000) } : {}),
          ...(normalizedUrl ? { url: normalizedUrl } : {}),
        });
      }
      db.interviews = nextInterviews;
    }

    saveDatabase(db, { slices: ['meta'] });
    res.json({
      heroLeadText: db.heroLeadText,
      authorAboutText: db.authorAboutText,
      authorPhotoUrl: db.authorPhotoUrl,
      authorPhotos: db.authorPhotos,
      socialLinks: db.socialLinks,
      monobankJarUrl: db.monobankJarUrl,
      monobankModalTitle: db.monobankModalTitle || DEFAULT_MONOBANK_MODAL_TITLE,
      monobankModalSubtitle: db.monobankModalSubtitle ?? DEFAULT_MONOBANK_MODAL_SUBTITLE,
      monobankCardLabel: db.monobankCardLabel ?? DEFAULT_MONOBANK_CARD_LABEL,
      monobankModalText: db.monobankModalText || DEFAULT_MONOBANK_MODAL_TEXT,
      monobankEmptyText: db.monobankEmptyText ?? DEFAULT_MONOBANK_EMPTY_TEXT,
      contactEmail: db.contactEmail,
      interviews: db.interviews,
      homeActionAboutTitle: db.homeActionAboutTitle || 'Про мене',
      homeActionContactTitle:
        db.homeActionContactTitle &&
        db.homeActionContactTitle !== 'Зв’язатися з автором' &&
        db.homeActionContactTitle !== "Зв'язатися з автором"
          ? db.homeActionContactTitle
          : 'Зв’язок',
      homeActionMonobankTitle: db.homeActionMonobankTitle || 'Підтримати через Монобанк',
      homeActionInterviewsTitle: db.homeActionInterviewsTitle || 'Розмови',
      homeRepeaters: normalizeHomeRepeatersConfig(db.homeRepeaters),
      proseAuthDiscountPercent: db.proseAuthDiscountPercent,
      proseTelegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
      storeAuthDiscountPercent: 0,
    });
  });

  // Dedicated Admin endpoint to update discounts for paid prose (authorized & Telegram subscribers)
  app.put('/api/author/prose-discount', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { discountPercent, proseAuthDiscountPercent, proseTelegramDiscountPercent } = req.body as {
      discountPercent?: number;
      proseAuthDiscountPercent?: number;
      proseTelegramDiscountPercent?: number;
    };

    if (
      proseTelegramDiscountPercent !== undefined &&
      proseAuthDiscountPercent === undefined &&
      discountPercent === undefined
    ) {
      const numeric = Number(proseTelegramDiscountPercent);
      if (!Number.isFinite(numeric)) {
        res.status(400).json({ error: 'Вкажіть коректне значення знижки від 0 до 90%.' });
        return;
      }
      const clamped = Math.max(0, Math.min(90, Math.round(numeric)));
      db.proseTelegramDiscountPercent = clamped;
      saveDatabase(db, { slices: ['meta'] });
      res.json({ proseTelegramDiscountPercent: clamped });
      return;
    }

    const raw = proseAuthDiscountPercent ?? discountPercent;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      res.status(400).json({ error: 'Вкажіть коректне значення знижки від 0 до 90%.' });
      return;
    }
    const clamped = Math.max(0, Math.min(90, Math.round(numeric)));
    db.proseAuthDiscountPercent = clamped;
    if (
      proseTelegramDiscountPercent !== undefined &&
      Number.isFinite(Number(proseTelegramDiscountPercent))
    ) {
      db.proseTelegramDiscountPercent = Math.max(
        0,
        Math.min(90, Math.round(Number(proseTelegramDiscountPercent)))
      );
    }
    saveDatabase(db, { slices: ['meta'] });
    res.json({
      proseAuthDiscountPercent: db.proseAuthDiscountPercent,
      proseTelegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
    });
  });

  // Dedicated Admin endpoint to update Telegram discount for Prose
  app.put('/api/author/prose-telegram-discount', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { discountPercent, proseTelegramDiscountPercent } = req.body as {
      discountPercent?: number;
      proseTelegramDiscountPercent?: number;
    };
    const raw = proseTelegramDiscountPercent ?? discountPercent;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      res.status(400).json({ error: 'Вкажіть коректне значення знижки від 0 до 90%.' });
      return;
    }
    const clamped = Math.max(0, Math.min(90, Math.round(numeric)));
    db.proseTelegramDiscountPercent = clamped;
    saveDatabase(db, { slices: ['meta'] });
    res.json({ proseTelegramDiscountPercent: clamped });
  });

  app.patch('/api/author/messages/:id/read', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const msg = db.contactMessages.find((m) => m.id === id);
    if (!msg) {
      res.status(404).json({ error: 'Повідомлення не знайдено.' });
      return;
    }
    msg.read = true;
    saveDatabase(db, { slices: ['community'] });
    res.json({ contactMessages: db.contactMessages });
  });

  app.delete('/api/author/messages/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const before = db.contactMessages.length;
    db.contactMessages = db.contactMessages.filter((m) => m.id !== id);
    if (db.contactMessages.length === before) {
      res.status(404).json({ error: 'Повідомлення не знайдено.' });
      return;
    }
    saveDatabase(db, { slices: ['community'] });
    res.json({ contactMessages: db.contactMessages });
  });

  // Upload a custom cover image from admin computer
  app.post('/api/author/upload-cover', async (req: Request, res: Response) => {
    ensureDatabase();
    const { dataUrl } = req.body as { dataUrl?: string };
    if (!dataUrl || typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'Файл зображення не передано.' });
      return;
    }

    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i);
    if (!match) {
      res.status(400).json({ error: 'Підтримуються лише зображення PNG, JPG, WEBP або GIF.' });
      return;
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength > 6 * 1024 * 1024) {
      res.status(400).json({ error: 'Розмір зображення не повинен перевищувати 6 МБ.' });
      return;
    }

    let processedBuffer = buffer;
    try {
      processedBuffer = await sharp(buffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();
    } catch {
      processedBuffer = buffer;
    }

    const filename = `cover-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), processedBuffer);
    missingUploadCache.delete(filename);

    let cloudSynced = false;
    const adminToken = extractBearerToken(req);
    if (adminToken) {
      const mime = 'image/jpeg';
      try {
        cloudSynced = await saveMediaAssetToFirestore(filename, mime, processedBuffer, adminToken);
      } catch {
        cloudSynced = false;
      }
    }

    res.status(201).json({ url: `/uploads/${filename}`, cloudSynced });
  });

  // Full store product customization for admin
  app.put('/api/author/products/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.products.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Товар не знайдено.' });
      return;
    }

    const existing = db.products[index];
    const body = req.body as Partial<RawStoreProduct>;

    const parsedDiscount =
      typeof body.discountPercent === 'number'
        ? Math.max(0, Math.min(90, Math.round(body.discountPercent)))
        : (existing.discountPercent ?? 0);

    const validTypes = ['ebook', 'paper_book', 'wip_gdoc', 'poem_frame', 'painting'] as const;
    const nextType = validTypes.includes(body.type as (typeof validTypes)[number])
      ? (body.type as (typeof validTypes)[number])
      : existing.type;

    const updated: RawStoreProduct = {
      ...existing,
      type: nextType,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : existing.title,
      subtitle:
        typeof body.subtitle === 'string' && body.subtitle.trim()
          ? body.subtitle.trim()
          : existing.subtitle,
      priceUah:
        typeof body.priceUah === 'number' && body.priceUah > 0
          ? Math.round(body.priceUah)
          : existing.priceUah,
      discountPercent: parsedDiscount,
      promoActive:
        typeof body.promoActive === 'boolean' ? body.promoActive : Boolean(existing.promoActive),
      promoLabel:
        typeof body.promoLabel === 'string' ? body.promoLabel.trim() : (existing.promoLabel ?? ''),
      coverImage:
        typeof body.coverImage === 'string' && body.coverImage.trim()
          ? body.coverImage.trim()
          : existing.coverImage,
      description:
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : existing.description,
      sampleExcerpt:
        typeof body.sampleExcerpt === 'string'
          ? body.sampleExcerpt.trim()
          : existing.sampleExcerpt,
      formats: typeof body.formats === 'string' ? body.formats.trim() : existing.formats,
      pages:
        typeof body.pages === 'number' && body.pages > 0 ? Math.round(body.pages) : existing.pages,
      year:
        typeof body.year === 'number' && body.year > 0 ? Math.round(body.year) : existing.year,
      binding: typeof body.binding === 'string' ? body.binding.trim() : existing.binding,
      dimensions:
        typeof body.dimensions === 'string' ? body.dimensions.trim() : existing.dimensions,
      material: typeof body.material === 'string' ? body.material.trim() : existing.material,
      ebookFullText:
        typeof body.ebookFullText === 'string' ? body.ebookFullText : existing.ebookFullText,
      ebookFileName:
        typeof body.ebookFileName === 'string' ? body.ebookFileName.trim() : existing.ebookFileName,
      ebookMimeType:
        typeof body.ebookMimeType === 'string' ? body.ebookMimeType.trim() : existing.ebookMimeType,
      ebookFileSize:
        typeof body.ebookFileSize === 'number' ? body.ebookFileSize : existing.ebookFileSize,
      ebookStorageKey:
        typeof body.ebookStorageKey === 'string'
          ? body.ebookStorageKey.trim()
          : existing.ebookStorageKey,
      progressLabel:
        typeof body.progressLabel === 'string' ? body.progressLabel.trim() : existing.progressLabel,
      wordCount:
        typeof body.wordCount === 'number' && body.wordCount >= 0
          ? Math.round(body.wordCount)
          : existing.wordCount,
      lastUpdated:
        typeof body.lastUpdated === 'string' && body.lastUpdated.trim()
          ? body.lastUpdated.trim()
          : existing.lastUpdated,
      gdocGuestUrl:
        typeof body.gdocGuestUrl === 'string' ? body.gdocGuestUrl.trim() : existing.gdocGuestUrl,
    };

    db.products[index] = updated;

    db.orders = db.orders.map((order) => ({
      ...order,
      items: order.items.map((item) =>
        item.productId === id
          ? {
              ...item,
              title: updated.title,
              ebookFileName: updated.type === 'ebook' ? updated.ebookFileName : item.ebookFileName,
              ebookFileSize: updated.type === 'ebook' ? updated.ebookFileSize : item.ebookFileSize,
              gdocGuestUrl: updated.type === 'wip_gdoc' ? updated.gdocGuestUrl : item.gdocGuestUrl,
              progressLabel: updated.type === 'wip_gdoc' ? updated.progressLabel : item.progressLabel,
            }
          : item
      ),
    }));

    saveDatabase(db, { slices: ['products'], ordersDirty: true });
    res.json({ product: updated });
  });

  app.delete('/api/author/products/:id/ebook', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const index = db.products.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Товар не знайдено.' });
      return;
    }

    const existing = db.products[index];
    if (existing.ebookStorageKey) {
      const filePath = path.join(EBOOKS_DIR, path.basename(existing.ebookStorageKey));
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Ignore file removal error
        }
      }
    }

    const updated: RawStoreProduct = {
      ...existing,
      ebookFileName: undefined,
      ebookMimeType: undefined,
      ebookFileSize: undefined,
      ebookStorageKey: undefined,
    };
    db.products[index] = updated;
    saveDatabase(db, { slices: ['products'] });
    res.json({ product: updated });
  });

  app.delete('/api/author/products/:id', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const target = db.products.find((p) => p.id === id);
    const before = db.products.length;
    db.products = db.products.filter((p) => p.id !== id);
    if (db.products.length === before) {
      res.status(404).json({ error: 'Товар не знайдено.' });
      return;
    }
    if (target?.ebookStorageKey) {
      const filePath = path.join(EBOOKS_DIR, path.basename(target.ebookStorageKey));
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Ignore cleanup failure
        }
      }
    }
    delete db.productVotes[id];
    db.reviews = db.reviews.filter((r) => !(r.targetType === 'product' && r.targetId === id));
    if (Array.isArray(db.recentRatings)) {
      db.recentRatings = db.recentRatings.filter(
        (r) => !(r.targetType === 'product' && r.targetId === id)
      );
    }
    saveDatabase(db, { slices: ['products'] });
    res.json({ deletedId: id });
  });

  app.post('/api/author/products', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const body = req.body as Partial<RawStoreProduct>;
    const validTypes = ['ebook', 'paper_book', 'wip_gdoc', 'poem_frame', 'painting'] as const;
    if (!body.title?.trim() || !body.type || !validTypes.includes(body.type) || !body.priceUah) {
      res.status(400).json({ error: 'Вкажіть назву, коректний тип і ціну.' });
      return;
    }

    const id = `${body.type}-${Date.now()}`;
    const discountPercent = Math.max(0, Math.min(90, Math.round(Number(body.discountPercent) || 0)));

    const defaultSubtitle =
      body.type === 'wip_gdoc'
        ? 'Роман у роботі · Гостьовий доступ до Google Документа'
        : body.type === 'paper_book'
          ? 'Паперова книга · Друковане видання'
          : body.type === 'poem_frame'
            ? 'Скляна антирамка · Тіло вірша'
            : 'Електронна книга · Авторське видання';

    const newProduct: RawStoreProduct = {
      id,
      type: body.type,
      title: body.title.trim(),
      subtitle: body.subtitle?.trim() || defaultSubtitle,
      priceUah: Math.max(1, Math.round(Number(body.priceUah))),
      discountPercent,
      promoActive: Boolean(body.promoActive),
      promoLabel: body.promoLabel?.trim() || '',
      coverImage:
        body.coverImage?.trim() ||
        (body.type === 'wip_gdoc'
          ? '/src/assets/images/wip_manuscript_novel_1795025674997.webp'
          : '/src/assets/images/ebook_cover_silence_1795025673857.webp'),
      description: body.description?.trim() || 'Нове видання Андрія Даньківа.',
      sampleExcerpt: body.sampleExcerpt?.trim() || 'Уривок буде додано автором найближчим часом.',
      ...(body.type === 'wip_gdoc'
        ? {
            progressLabel: body.progressLabel?.trim() || 'Розділи 1–2',
            wordCount: Number(body.wordCount) || 8500,
            lastUpdated: new Date().toLocaleDateString('uk-UA', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
            gdocGuestUrl: body.gdocGuestUrl?.trim() || 'https://docs.google.com/document/d/example/view',
          }
        : body.type === 'paper_book'
          ? {
              binding: body.binding?.trim() || 'Тверда палітурка',
              pages: Number(body.pages) || 200,
              year: Number(body.year) || 2026,
            }
          : body.type === 'poem_frame'
            ? {
                dimensions: body.dimensions?.trim() || '21 × 30 см (А4)',
                material:
                  body.material?.trim() ||
                  'Загартоване скло, металеві кліпси, бавовняний папір',
                year: Number(body.year) || 2026,
              }
            : {
                formats: body.formats?.trim() || 'EPUB · PDF · TXT',
                pages: Number(body.pages) || 160,
                year: Number(body.year) || 2026,
                ebookFileName: body.ebookFileName?.trim() || undefined,
                ebookMimeType: body.ebookMimeType?.trim() || undefined,
                ebookFileSize: typeof body.ebookFileSize === 'number' ? body.ebookFileSize : undefined,
                ebookStorageKey: body.ebookStorageKey?.trim() || undefined,
                ebookFullText:
                  body.ebookFullText?.trim() ||
                  `${body.title.trim()}\nАвтор: Андрій Даньків\n\n${body.description?.trim() || ''}`,
              }),
    };

    db.products.unshift(newProduct);
    saveDatabase(db, { slices: ['products'] });
    res.status(201).json({ product: newProduct });
  });

  app.post('/api/author/publish', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { kind, payload } = req.body as {
      kind: 'poem' | 'prose' | 'blog';
      payload: Record<string, string | number | boolean | string[]>;
    };

    if (!payload?.title) {
      res.status(400).json({ error: 'Вкажіть заголовок твору.' });
      return;
    }

    const hasAttachedPdf =
      kind === 'prose' &&
      typeof payload.pdfStorageKey === 'string' &&
      payload.pdfStorageKey.trim().length > 0;

    if (!payload?.content && !hasAttachedPdf) {
      res.status(400).json({ error: 'Заповніть текст твору або прикріть PDF-документ.' });
      return;
    }

    const contentStr = preserveFormattedText(String(payload.content || ''));
    const plainContentForSummary = kind === 'blog' ? stripBlogMediaTokens(contentStr) : contentStr;
    const excerptStr =
      String(payload.excerpt || '').trim() ||
      (plainContentForSummary
        ? getFirstFormattedExcerptLine(plainContentForSummary, 140) + '...'
        : kind === 'blog'
          ? String(payload.title).trim()
          : `Повний текст у форматі PDF (${String(payload.title).trim()}).`);

    if (kind === 'poem') {
      const validFontSize = ['sm', 'base', 'lg', 'xl', '2xl'].includes(String(payload.fontSize))
        ? (payload.fontSize as 'sm' | 'base' | 'lg' | 'xl' | '2xl')
        : undefined;
      const validTextAlign = ['left', 'center', 'right'].includes(String(payload.textAlign))
        ? (payload.textAlign as 'left' | 'center' | 'right')
        : undefined;
      const validLineSpacing = ['tight', 'normal', 'relaxed', 'loose'].includes(
        String(payload.lineSpacing)
      )
        ? (payload.lineSpacing as 'tight' | 'normal' | 'relaxed' | 'loose')
        : undefined;

      const validTextColor =
        typeof payload.textColor === 'string' && payload.textColor.trim()
          ? payload.textColor.trim().slice(0, 32)
          : undefined;
      const validBackgroundColor =
        typeof payload.backgroundColor === 'string' && payload.backgroundColor.trim()
          ? payload.backgroundColor.trim().slice(0, 32)
          : undefined;
      const validImageUrl = sanitizePoemImageUrl(payload.imageUrl);
      const validImagePalette = validImageUrl
        ? sanitizePoemImagePalette(payload.imagePalette)
        : undefined;
      const validSoundCloudTracks = sanitizePoemSoundCloudTracks(
        payload.soundcloudTracks,
        payload.soundcloudTrack
      );

      const parsedYear = Number(payload.year);
      const validYear =
        Number.isFinite(parsedYear) && parsedYear >= 1900 && parsedYear <= 2200
          ? Math.round(parsedYear)
          : new Date().getFullYear();

      const validWorkStatus: ProseStatus | undefined =
        payload.workStatus === 'completed' || payload.workStatus === 'in_progress'
          ? payload.workStatus
          : undefined;

      const poem: RawPoem = {
        id: `poem-${Date.now()}`,
        title: String(payload.title).trim(),
        cycle: String(payload.cycle || 'Нові вірші').trim(),
        year: validYear,
        excerpt: excerptStr,
        content: contentStr,
        note: payload.note ? String(payload.note).trim() : undefined,
        ...(validWorkStatus ? { workStatus: validWorkStatus } : {}),
        fontSize: validFontSize,
        textAlign: validTextAlign,
        lineSpacing: validLineSpacing,
        textColor: validTextColor,
        backgroundColor: validBackgroundColor,
        ...(validImageUrl ? { imageUrl: validImageUrl } : {}),
        ...(validImagePalette ? { imagePalette: validImagePalette } : {}),
        ...(validSoundCloudTracks.length > 0
          ? {
              soundcloudTrack: validSoundCloudTracks[0],
              soundcloudTracks: validSoundCloudTracks,
            }
          : {}),
      };

      const requestedPos = payload.position;
      const requestedInsertIdx = Number(payload.insertIndex);
      if (requestedPos === 'end') {
        db.poems.push(poem);
      } else if (Number.isFinite(requestedInsertIdx) && requestedInsertIdx >= 0) {
        const clampedIdx = Math.max(0, Math.min(db.poems.length, Math.round(requestedInsertIdx)));
        db.poems.splice(clampedIdx, 0, poem);
      } else {
        db.poems.unshift(poem);
      }

      saveDatabase(db, { slices: ['poems'] });
      res.status(201).json({ item: poem });
      return;
    }

    if (kind === 'prose') {
      let requestedAccessMode: ProseAccessMode = 'public';
      if (
        payload.accessMode === 'authorized' ||
        payload.accessMode === 'paid' ||
        payload.accessMode === 'public'
      ) {
        requestedAccessMode = payload.accessMode;
      } else if (payload.requiresAuth === true || payload.requiresAuth === 'true') {
        requestedAccessMode = 'authorized';
      } else if (hasAttachedPdf || payload.isPaid === true || payload.isPaid === 'true') {
        requestedAccessMode = 'paid';
      }
      if (hasAttachedPdf && requestedAccessMode === 'public') {
        requestedAccessMode = 'paid';
      }
      const requestedPaid = requestedAccessMode === 'paid';
      const parsedPrice = requestedPaid ? Math.max(10, Math.round(Number(payload.priceUah) || 75)) : 0;
      const explicitPages = Number(payload.pages);
      const rawDateStr = typeof payload.publishedAt === 'string' ? payload.publishedAt.trim() : '';
      let formattedPublishedAt = new Date().toLocaleDateString('uk-UA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      if (rawDateStr) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawDateStr)) {
          const [y, m, d] = rawDateStr.split('-').map(Number);
          const parsedDate = new Date(y, m - 1, d);
          if (!Number.isNaN(parsedDate.getTime())) {
            formattedPublishedAt = parsedDate.toLocaleDateString('uk-UA', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            });
          }
        } else {
          formattedPublishedAt = rawDateStr;
        }
      }
      const requestedTagIds = Array.isArray(payload.tagIds)
        ? getValidProseTagIds(payload.tagIds as string[], db)
        : [];
      const requestedMoodboardUrls = Array.isArray(payload.moodboardUrls)
        ? Array.from(
            new Set(
              payload.moodboardUrls
                .filter(
                  (item): item is string =>
                    typeof item === 'string' &&
                    /^(\/src\/assets\/|\/uploads\/|\/assets\/|https?:\/\/)/i.test(item.trim())
                )
                .map((item) => item.trim())
            )
          ).slice(0, 20)
        : [];
      const computedPages = computeProseWorkPages({
        content: contentStr,
        chapters: [],
        hasPdf: hasAttachedPdf,
        fallbackPages: Number.isFinite(explicitPages) && explicitPages > 0 ? Math.round(explicitPages) : 1,
      });
      const prose: RawProseWork = {
        id: `prose-${Date.now()}`,
        title: String(payload.title).trim(),
        genre: String(payload.genre || 'Оповідання').trim(),
        pages: computedPages,
        publishedAt: formattedPublishedAt,
        slogan: String(payload.slogan || '').trim(),
        excerpt: excerptStr,
        content: contentStr,
        chapters: [],
        tagIds: requestedTagIds,
        status: normalizeProseStatus(payload.status),
        accessMode: requestedAccessMode,
        requiresAuth: requestedAccessMode === 'authorized',
        isPaid: requestedPaid && parsedPrice > 0,
        priceUah: parsedPrice,
        moodboardUrls: requestedMoodboardUrls,
        ...(hasAttachedPdf
          ? {
              pdfStorageKey: String(payload.pdfStorageKey).trim(),
              pdfFileName: String(payload.pdfFileName || 'story.pdf').trim(),
              pdfFileSize: Number(payload.pdfFileSize) || undefined,
            }
          : {}),
      };
      db.prose.unshift(prose);
      saveDatabase(db, { slices: ['prose'] });
      res.status(201).json({ item: enrichProseForAuthor(prose, db) });
      return;
    }

    if (kind === 'blog') {
      const plainText = stripBlogMediaTokens(contentStr);
      const words = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
      const validCoverImage = isValidBlogPhotoUrl(payload.coverImage)
        ? String(payload.coverImage).trim()
        : undefined;
      const post: RawBlogPost = {
        id: `blog-${Date.now()}`,
        title: String(payload.title).trim(),
        category: String(payload.category || 'Авторське кіно').trim(),
        publishedAt: new Date().toLocaleDateString('uk-UA', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
        readingMinutes: Math.max(1, Math.ceil(words / 180)),
        ...(validCoverImage ? { coverImage: validCoverImage } : {}),
        excerpt: excerptStr,
        content: contentStr,
      };
      db.blog.unshift(post);
      saveDatabase(db, { slices: ['blog'] });
      res.status(201).json({ item: enrichBlogPost(post, db) });
      return;
    }

    res.status(400).json({ error: 'Невідомий тип публікації.' });
  });
}
