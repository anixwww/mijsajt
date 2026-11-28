import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { INITIAL_DATABASE, type SiteDatabase } from './seedData.ts';
import type { OrderRecord } from '../src/types.ts';
import { emitProductionAlert } from './monitoring.ts';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const STORE_JSON_PATH = path.join(DATA_DIR, 'store.json');
const PENDING_INVOICES_PATH = path.join(DATA_DIR, 'pending-invoices.json');
const RATE_LIMITS_PATH = path.join(DATA_DIR, 'rate-limits.json');

export type DbSliceKey =
  | 'meta'
  | 'poems'
  | 'prose'
  | 'blog'
  | 'products'
  | 'radio'
  | 'community'
  | 'analytics';

export const ALL_DB_SLICES: readonly DbSliceKey[] = [
  'meta',
  'poems',
  'prose',
  'blog',
  'products',
  'radio',
  'community',
  'analytics',
];

const lastSavedSliceHashes = new Map<DbSliceKey, string>();
const lastSavedOrderJsonByCode = new Map<string, string>();

let dbInstance: DatabaseSync | null = null;

export function getSqliteDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  dbInstance = new DatabaseSync(DB_PATH);
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA synchronous = NORMAL;');
  dbInstance.exec('PRAGMA busy_timeout = 5000;');

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS db_slices (
      slice_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders_records (
      order_code TEXT PRIMARY KEY,
      guest_uid TEXT,
      buyer_email_hash TEXT,
      payment_status TEXT,
      transaction_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_guest_uid ON orders_records(guest_uid);
    CREATE INDEX IF NOT EXISTS idx_orders_email_hash ON orders_records(buyer_email_hash);
    CREATE INDEX IF NOT EXISTS idx_orders_tx_id ON orders_records(transaction_id);

    CREATE TABLE IF NOT EXISTS payment_sessions (
      session_id TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      private_key_enc TEXT NOT NULL,
      kind TEXT NOT NULL,
      expected_item_ids_json TEXT NOT NULL,
      expected_amount_uah REAL NOT NULL,
      authorized_discount_uid TEXT,
      telegram_discount_tg_id INTEGER,
      expires_at_ms INTEGER NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monobank_invoices (
      invoice_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      order_code TEXT NOT NULL,
      prose_id TEXT,
      product_ids_json TEXT,
      amount_uah REAL NOT NULL,
      buyer_name TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      shipping_json TEXT,
      guest_uid TEXT,
      status TEXT NOT NULL,
      failure_reason TEXT,
      finalized_order_code TEXT,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mono_order_code ON monobank_invoices(order_code);

    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      reset_at_ms INTEGER NOT NULL DEFAULT 0,
      timestamps_json TEXT NOT NULL DEFAULT '[]',
      updated_at_ms INTEGER NOT NULL
    );
  `);

  runOneTimeMigrationIfNeeded(dbInstance);
  return dbInstance;
}

const COMPROMISED_SMOKE_UIDS = new Set([
  'guest_95cbc965b30ef33ae906',
  'guest_9f9183f4a6cc0d3869c9',
  'guest_dd146e3913c6b21481de',
  'guest_9ac2e2758fc9e9d87382',
  'guest_fc689b98ea7841e7cd13',
]);

function runOneTimeMigrationIfNeeded(db: DatabaseSync): void {
  const checkStmt = db.prepare('SELECT COUNT(*) as cnt FROM db_slices');
  const res = checkStmt.get() as { cnt: number };
  if (res.cnt > 0) return; // Already migrated

  let rawStore: Partial<SiteDatabase> | null = null;
  try {
    if (fs.existsSync(STORE_JSON_PATH)) {
      rawStore = JSON.parse(fs.readFileSync(STORE_JSON_PATH, 'utf-8')) as Partial<SiteDatabase>;
    }
  } catch {
    // Fall back to starter
  }

  const seeded = structuredClone(INITIAL_DATABASE);
  const mergedOrders: OrderRecord[] = Array.isArray(rawStore?.orders) ? rawStore.orders : seeded.orders;

  db.exec('BEGIN IMMEDIATE');
  try {
    // Insert orders into orders_records
    const insertOrderStmt = db.prepare(`
      INSERT OR REPLACE INTO orders_records (
        order_code, guest_uid, buyer_email_hash, payment_status, transaction_id, payload_json, created_at, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const nowMs = Date.now();
    for (const order of mergedOrders) {
      if (!order?.orderCode) continue;
      const orderJson = JSON.stringify(order);
      insertOrderStmt.run(
        order.orderCode,
        order.guestUid || null,
        order.buyerEmailHash || null,
        order.payment?.status || null,
        order.payment?.transactionId || null,
        orderJson,
        order.createdAt || new Date().toISOString(),
        nowMs
      );
      lastSavedOrderJsonByCode.set(order.orderCode, orderJson);
    }

    // Slice up SiteDatabase into modular slices to prevent big JSON rewrites
    const fullDb: SiteDatabase = {
      heroLeadText: rawStore?.heroLeadText ?? seeded.heroLeadText,
      authorAboutText: rawStore?.authorAboutText ?? seeded.authorAboutText,
      authorPhotoUrl: rawStore?.authorPhotoUrl ?? seeded.authorPhotoUrl,
      authorPhotos: rawStore?.authorPhotos ?? seeded.authorPhotos,
      socialLinks: rawStore?.socialLinks ?? seeded.socialLinks,
      monobankJarUrl: rawStore?.monobankJarUrl ?? seeded.monobankJarUrl,
      ...(rawStore?.monobankJarWatermark ? { monobankJarWatermark: rawStore.monobankJarWatermark } : {}),
      monobankModalTitle: rawStore?.monobankModalTitle ?? seeded.monobankModalTitle,
      monobankModalSubtitle: rawStore?.monobankModalSubtitle ?? seeded.monobankModalSubtitle,
      monobankCardLabel: rawStore?.monobankCardLabel ?? seeded.monobankCardLabel,
      monobankModalText: rawStore?.monobankModalText ?? seeded.monobankModalText,
      monobankEmptyText: rawStore?.monobankEmptyText ?? seeded.monobankEmptyText,
      contactEmail: rawStore?.contactEmail ?? seeded.contactEmail,
      interviews: rawStore?.interviews ?? seeded.interviews,
      homeActionAboutTitle: rawStore?.homeActionAboutTitle ?? seeded.homeActionAboutTitle,
      homeActionContactTitle: rawStore?.homeActionContactTitle ?? seeded.homeActionContactTitle,
      homeActionMonobankTitle: rawStore?.homeActionMonobankTitle ?? seeded.homeActionMonobankTitle,
      homeActionInterviewsTitle: rawStore?.homeActionInterviewsTitle ?? seeded.homeActionInterviewsTitle,
      homeRepeaters: rawStore?.homeRepeaters ?? seeded.homeRepeaters,
      contactMessages: rawStore?.contactMessages ?? [],
      poems: rawStore?.poems ?? seeded.poems,
      poemSubmissions: rawStore?.poemSubmissions ?? [],
      prose: rawStore?.prose ?? seeded.prose,
      proseSubmissions: rawStore?.proseSubmissions ?? [],
      proseTags: rawStore?.proseTags ?? seeded.proseTags,
      proseAuthDiscountPercent: rawStore?.proseAuthDiscountPercent ?? seeded.proseAuthDiscountPercent,
      proseTelegramDiscountPercent: rawStore?.proseTelegramDiscountPercent ?? seeded.proseTelegramDiscountPercent,
      telegramChannelId: rawStore?.telegramChannelId ?? '',
      storeAuthDiscountPercent: 0,
      blog: rawStore?.blog ?? seeded.blog,
      products: rawStore?.products ?? seeded.products,
      orders: [], // handled via orders_records table
      poemVotes: rawStore?.poemVotes ?? {},
      proseVotes: rawStore?.proseVotes ?? {},
      productVotes: rawStore?.productVotes ?? {},
      reviews: rawStore?.reviews ?? [],
      recentRatings: rawStore?.recentRatings ?? [],
      poemViews: rawStore?.poemViews ?? {},
      blogViews: rawStore?.blogViews ?? {},
      visitorIpHashes: rawStore?.visitorIpHashes ?? [],
      guestAccounts: (rawStore?.guestAccounts ?? []).filter((acc) => !COMPROMISED_SMOKE_UIDS.has(acc?.uid)),
      donations: rawStore?.donations ?? [],
      feedback: rawStore?.feedback ?? [],
      chatMessages: rawStore?.chatMessages ?? [],
      chatMeta: rawStore?.chatMeta ?? seeded.chatMeta,
      chatReports: rawStore?.chatReports ?? [],
      radioTracks: rawStore?.radioTracks ?? seeded.radioTracks,
      monthlySelections: rawStore?.monthlySelections ?? [],
      weeklyMusicSelections: rawStore?.weeklyMusicSelections ?? [],
      weeklyVoteLog: rawStore?.weeklyVoteLog ?? [],
      weeklyPoems: rawStore?.weeklyPoems ?? [],
      weeklyProse: rawStore?.weeklyProse ?? [],
      analytics: rawStore?.analytics ?? {
        totalSessions: 0,
        seenSessionIds: [],
        totalClicks: 0,
        totalTrackedSeconds: 0,
        clicksByTarget: {},
        dwellByTarget: {},
        exitsByMoment: {},
        recentEvents: [],
        visitRecords: [],
      },
    };

    const sliceKeys = [
      'meta', 'poems', 'prose', 'blog', 'products', 'radio', 'community', 'analytics'
    ];

    const getSlicePayload = (key: string, dbObj: SiteDatabase): unknown => {
      switch (key) {
        case 'meta':
          return {
            heroLeadText: dbObj.heroLeadText,
            authorAboutText: dbObj.authorAboutText,
            authorPhotoUrl: dbObj.authorPhotoUrl,
            authorPhotos: dbObj.authorPhotos,
            socialLinks: dbObj.socialLinks,
            monobankJarUrl: dbObj.monobankJarUrl,
            monobankJarWatermark: dbObj.monobankJarWatermark,
            monobankModalTitle: dbObj.monobankModalTitle,
            monobankModalSubtitle: dbObj.monobankModalSubtitle,
            monobankCardLabel: dbObj.monobankCardLabel,
            monobankModalText: dbObj.monobankModalText,
            monobankEmptyText: dbObj.monobankEmptyText,
            contactEmail: dbObj.contactEmail,
            interviews: dbObj.interviews,
            homeActionAboutTitle: dbObj.homeActionAboutTitle,
            homeActionContactTitle: dbObj.homeActionContactTitle,
            homeActionMonobankTitle: dbObj.homeActionMonobankTitle,
            homeActionInterviewsTitle: dbObj.homeActionInterviewsTitle,
            homeRepeaters: dbObj.homeRepeaters,
            telegramChannelId: dbObj.telegramChannelId,
            storeAuthDiscountPercent: dbObj.storeAuthDiscountPercent,
            proseAuthDiscountPercent: dbObj.proseAuthDiscountPercent,
            proseTelegramDiscountPercent: dbObj.proseTelegramDiscountPercent,
          };
        case 'poems':
          return {
            poems: dbObj.poems,
            poemSubmissions: dbObj.poemSubmissions,
            poemVotes: dbObj.poemVotes,
            poemViews: dbObj.poemViews,
            weeklyPoems: dbObj.weeklyPoems,
            weeklyVoteLog: dbObj.weeklyVoteLog,
          };
        case 'prose':
          return {
            prose: dbObj.prose,
            proseSubmissions: dbObj.proseSubmissions,
            proseTags: dbObj.proseTags,
            proseVotes: dbObj.proseVotes,
            weeklyProse: dbObj.weeklyProse,
          };
        case 'blog':
          return { blog: dbObj.blog, blogViews: dbObj.blogViews };
        case 'products':
          return { products: dbObj.products, productVotes: dbObj.productVotes, reviews: dbObj.reviews, recentRatings: dbObj.recentRatings };
        case 'radio':
          return { radioTracks: dbObj.radioTracks, monthlySelections: dbObj.monthlySelections, weeklyMusicSelections: dbObj.weeklyMusicSelections };
        case 'community':
          return {
            guestAccounts: dbObj.guestAccounts,
            donations: dbObj.donations,
            feedback: dbObj.feedback,
            chatMessages: dbObj.chatMessages,
            chatMeta: dbObj.chatMeta,
            chatReports: dbObj.chatReports,
            contactMessages: dbObj.contactMessages,
            visitorIpHashes: dbObj.visitorIpHashes,
          };
        case 'analytics':
          return { analytics: dbObj.analytics };
        default:
          return {};
      }
    };

    const insertSliceStmt = db.prepare(`
      INSERT OR REPLACE INTO db_slices (slice_key, payload_json, content_hash, updated_at_ms)
      VALUES (?, ?, ?, ?)
    `);

    for (const sk of ALL_DB_SLICES) {
      const payload = getSlicePayload(sk, fullDb);
      const json = JSON.stringify(payload);
      const hash = crypto.createHash('sha256').update(json).digest('hex');
      insertSliceStmt.run(sk, json, hash, nowMs);
      lastSavedSliceHashes.set(sk, hash);
    }

    // Migrate pending invoices if any
    try {
      if (fs.existsSync(PENDING_INVOICES_PATH)) {
        const pinv = JSON.parse(fs.readFileSync(PENDING_INVOICES_PATH, 'utf-8')) as {
          prose?: Array<any>;
          store?: Array<any>;
        };
        const insertInvoice = db.prepare(`
          INSERT OR REPLACE INTO monobank_invoices (
            invoice_id, kind, order_code, prose_id, product_ids_json, amount_uah, buyer_name, buyer_email, shipping_json, guest_uid, status, failure_reason, finalized_order_code, created_at_ms, expires_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        if (Array.isArray(pinv.prose)) {
          for (const item of pinv.prose) {
            if (!item?.invoiceId) continue;
            insertInvoice.run(
              item.invoiceId, 'prose', item.orderCode || '', item.proseId || null, null,
              Number(item.amountUah) || 0, item.buyerName || '', item.buyerEmail || '', null,
              item.guestUid || null, item.status || 'created', item.failureReason || null,
              item.finalizedOrderCode || null, Number(item.createdAtMs) || nowMs,
              Number(item.expiresAtMs) || (nowMs + 3600000), nowMs
            );
          }
        }
        if (Array.isArray(pinv.store)) {
          for (const item of pinv.store) {
            if (!item?.invoiceId) continue;
            insertInvoice.run(
              item.invoiceId, 'store', item.orderCode || '', null, JSON.stringify(item.productIds || []),
              Number(item.amountUah) || 0, item.buyerName || '', item.buyerEmail || '',
              item.shipping ? JSON.stringify(item.shipping) : null,
              item.guestUid || null, item.status || 'created', item.failureReason || null,
              item.finalizedOrderCode || null, Number(item.createdAtMs) || nowMs,
              Number(item.expiresAtMs) || (nowMs + 3600000), nowMs
            );
          }
        }
      }
    } catch {
      // Ignore
    }

    // Migrate rate limits if any
    try {
      if (fs.existsSync(RATE_LIMITS_PATH)) {
        const rlimits = JSON.parse(fs.readFileSync(RATE_LIMITS_PATH, 'utf-8')) as {
          fixedWindows?: Record<string, { totalHits: number; resetAtMs: number }>;
          slidingWindows?: Record<string, number[]>;
        };
        const insertRate = db.prepare(`
          INSERT OR REPLACE INTO rate_limits (bucket_key, count, reset_at_ms, timestamps_json, updated_at_ms)
          VALUES (?, ?, ?, ?, ?)
        `);
        if (rlimits.fixedWindows) {
          for (const [k, v] of Object.entries(rlimits.fixedWindows)) {
            insertRate.run(k, Number(v.totalHits) || 0, Number(v.resetAtMs) || 0, '[]', nowMs);
          }
        }
        if (rlimits.slidingWindows) {
          for (const [k, list] of Object.entries(rlimits.slidingWindows)) {
            if (Array.isArray(list)) {
              insertRate.run(k, list.length, Math.max(...list, nowMs), JSON.stringify(list), nowMs);
            }
          }
        }
      }
    } catch {
      // Ignore
    }

    db.exec('COMMIT');

    // Archive old files
    try {
      if (fs.existsSync(STORE_JSON_PATH)) fs.renameSync(STORE_JSON_PATH, `${STORE_JSON_PATH}.migrated.bak`);
      if (fs.existsSync(PENDING_INVOICES_PATH)) fs.renameSync(PENDING_INVOICES_PATH, `${PENDING_INVOICES_PATH}.migrated.bak`);
      if (fs.existsSync(RATE_LIMITS_PATH)) fs.renameSync(RATE_LIMITS_PATH, `${RATE_LIMITS_PATH}.migrated.bak`);
    } catch {
      // Ignore
    }
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', err);
  }
}

export function loadSiteDatabaseFromSqlite(): SiteDatabase {
  const db = getSqliteDb();
  const selectSlices = db.prepare('SELECT slice_key, payload_json, content_hash FROM db_slices');
  const rows = selectSlices.all() as Array<{
    slice_key: string;
    payload_json: string;
    content_hash: string;
  }>;

  const merged: Record<string, unknown> = {};
  lastSavedSliceHashes.clear();
  for (const row of rows) {
    if (ALL_DB_SLICES.includes(row.slice_key as DbSliceKey) && row.content_hash) {
      lastSavedSliceHashes.set(row.slice_key as DbSliceKey, row.content_hash);
    }
    try {
      const parsed = JSON.parse(row.payload_json);
      if (parsed && typeof parsed === 'object') {
        Object.assign(merged, parsed);
      }
    } catch {
      // Ignore
    }
  }

  // Load orders
  const selectOrders = db.prepare('SELECT payload_json FROM orders_records ORDER BY created_at DESC');
  const orderRows = selectOrders.all() as Array<{ payload_json: string }>;
  const orders: OrderRecord[] = [];
  lastSavedOrderJsonByCode.clear();
  for (const orow of orderRows) {
    try {
      const order = JSON.parse(orow.payload_json) as OrderRecord;
      if (order?.orderCode) {
        orders.push(order);
        lastSavedOrderJsonByCode.set(order.orderCode, JSON.stringify(order));
      }
    } catch {
      // Ignore
    }
  }

  const base = structuredClone(INITIAL_DATABASE);
  return {
    ...base,
    ...merged,
    orders,
  } as SiteDatabase;
}

export interface SaveSqliteOptions {
  dirtySlices?: ReadonlySet<DbSliceKey>;
  dirtyOrderCodes?: ReadonlySet<string> | 'all';
}

function getSlicePayload(key: DbSliceKey, dbObj: SiteDatabase): unknown {
  switch (key) {
    case 'meta':
      return {
        heroLeadText: dbObj.heroLeadText,
        authorAboutText: dbObj.authorAboutText,
        authorPhotoUrl: dbObj.authorPhotoUrl,
        authorPhotos: dbObj.authorPhotos,
        socialLinks: dbObj.socialLinks,
        monobankJarUrl: dbObj.monobankJarUrl,
        monobankJarWatermark: dbObj.monobankJarWatermark,
        monobankModalTitle: dbObj.monobankModalTitle,
        monobankModalSubtitle: dbObj.monobankModalSubtitle,
        monobankCardLabel: dbObj.monobankCardLabel,
        monobankModalText: dbObj.monobankModalText,
        monobankEmptyText: dbObj.monobankEmptyText,
        contactEmail: dbObj.contactEmail,
        interviews: dbObj.interviews,
        homeActionAboutTitle: dbObj.homeActionAboutTitle,
        homeActionContactTitle: dbObj.homeActionContactTitle,
        homeActionMonobankTitle: dbObj.homeActionMonobankTitle,
        homeActionInterviewsTitle: dbObj.homeActionInterviewsTitle,
        homeRepeaters: dbObj.homeRepeaters,
        telegramChannelId: dbObj.telegramChannelId,
        storeAuthDiscountPercent: dbObj.storeAuthDiscountPercent,
        proseAuthDiscountPercent: dbObj.proseAuthDiscountPercent,
        proseTelegramDiscountPercent: dbObj.proseTelegramDiscountPercent,
      };
    case 'poems':
      return {
        poems: dbObj.poems,
        poemSubmissions: dbObj.poemSubmissions,
        poemVotes: dbObj.poemVotes,
        poemViews: dbObj.poemViews,
        weeklyPoems: dbObj.weeklyPoems,
        weeklyVoteLog: dbObj.weeklyVoteLog,
      };
    case 'prose':
      return {
        prose: dbObj.prose,
        proseSubmissions: dbObj.proseSubmissions,
        proseTags: dbObj.proseTags,
        proseVotes: dbObj.proseVotes,
        weeklyProse: dbObj.weeklyProse,
      };
    case 'blog':
      return { blog: dbObj.blog, blogViews: dbObj.blogViews };
    case 'products':
      return {
        products: dbObj.products,
        productVotes: dbObj.productVotes,
        reviews: dbObj.reviews,
        recentRatings: dbObj.recentRatings,
      };
    case 'radio':
      return {
        radioTracks: dbObj.radioTracks,
        monthlySelections: dbObj.monthlySelections,
        weeklyMusicSelections: dbObj.weeklyMusicSelections,
      };
    case 'community':
      return {
        guestAccounts: dbObj.guestAccounts,
        donations: dbObj.donations,
        feedback: dbObj.feedback,
        chatMessages: dbObj.chatMessages,
        chatMeta: dbObj.chatMeta,
        chatReports: dbObj.chatReports,
        contactMessages: dbObj.contactMessages,
        visitorIpHashes: dbObj.visitorIpHashes,
      };
    case 'analytics':
      return { analytics: dbObj.analytics };
  }
}

export function saveSiteDatabaseToSqlite(
  dbObj: SiteDatabase,
  options?: SaveSqliteOptions
): void {
  const db = getSqliteDb();
  const nowMs = Date.now();

  const targetSlices: readonly DbSliceKey[] =
    options?.dirtySlices !== undefined
      ? Array.from(options.dirtySlices)
      : ALL_DB_SLICES;

  const slicesToWrite: Array<{ key: DbSliceKey; json: string; hash: string }> = [];
  const selectSlice = db.prepare('SELECT content_hash FROM db_slices WHERE slice_key = ?');

  for (const sk of targetSlices) {
    const payload = getSlicePayload(sk, dbObj);
    const json = JSON.stringify(payload);
    const hash = crypto.createHash('sha256').update(json).digest('hex');

    let knownHash = lastSavedSliceHashes.get(sk);
    if (knownHash === undefined) {
      const existing = selectSlice.get(sk) as { content_hash?: string } | undefined;
      knownHash = existing?.content_hash;
      if (knownHash) {
        lastSavedSliceHashes.set(sk, knownHash);
      }
    }
    if (knownHash !== hash) {
      slicesToWrite.push({ key: sk, json, hash });
    }
  }

  const ordersToWrite: Array<{ order: OrderRecord; json: string }> = [];
  const ordersMode = options?.dirtyOrderCodes;
  const shouldScanAllOrders =
    ordersMode === 'all' ||
    (ordersMode === undefined &&
      Array.isArray(dbObj.orders) &&
      dbObj.orders.length !== lastSavedOrderJsonByCode.size);

  if (Array.isArray(dbObj.orders) && (shouldScanAllOrders || (ordersMode instanceof Set && ordersMode.size > 0))) {
    for (const order of dbObj.orders) {
      if (!order?.orderCode) continue;
      if (
        !shouldScanAllOrders &&
        ordersMode instanceof Set &&
        !ordersMode.has(order.orderCode) &&
        lastSavedOrderJsonByCode.has(order.orderCode)
      ) {
        continue;
      }
      const json = JSON.stringify(order);
      if (lastSavedOrderJsonByCode.get(order.orderCode) !== json) {
        ordersToWrite.push({ order, json });
      }
    }
  }

  if (slicesToWrite.length === 0 && ordersToWrite.length === 0) {
    return;
  }

  const updateSlice = db.prepare(
    'INSERT OR REPLACE INTO db_slices (slice_key, payload_json, content_hash, updated_at_ms) VALUES (?, ?, ?, ?)'
  );
  const insertOrder = db.prepare(`
    INSERT OR REPLACE INTO orders_records (
      order_code, guest_uid, buyer_email_hash, payment_status, transaction_id, payload_json, created_at, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const entry of slicesToWrite) {
      updateSlice.run(entry.key, entry.json, entry.hash, nowMs);
      lastSavedSliceHashes.set(entry.key, entry.hash);
    }

    for (const entry of ordersToWrite) {
      const { order, json } = entry;
      insertOrder.run(
        order.orderCode,
        order.guestUid || null,
        order.buyerEmailHash || null,
        order.payment?.status || null,
        order.payment?.transactionId || null,
        json,
        order.createdAt || new Date().toISOString(),
        nowMs
      );
      lastSavedOrderJsonByCode.set(order.orderCode, json);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    emitProductionAlert({
      alertType: 'SQLITE_SAVE_FAILED',
      severity: 'CRITICAL',
      message: 'Failed to save to SQLite',
      error: err,
      context: {
        slicesAttempted: slicesToWrite.map((s) => s.key),
        ordersAttempted: ordersToWrite.length,
      },
    });
  }
}

// Payment sessions storage helpers in SQLite
export interface SqlitePaymentSession {
  sessionId: string;
  nonce: string;
  privateKeyEnc: string;
  kind: 'store' | 'prose';
  expectedItemIdsJson: string;
  expectedAmountUah: number;
  authorizedDiscountUid?: string;
  telegramDiscountTgId?: number;
  expiresAtMs: number;
  consumed: number;
  createdAtMs: number;
}

export function savePaymentSessionToSqlite(session: {
  sessionId: string;
  nonce: string;
  privateKeyEnc: string;
  kind: 'store' | 'prose';
  expectedItemIds: string[];
  expectedAmountUah: number;
  authorizedDiscountUid?: string;
  telegramDiscountTgId?: number;
  expiresAtMs: number;
  consumed: boolean;
}): void {
  const db = getSqliteDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO payment_sessions (
      session_id, nonce, private_key_enc, kind, expected_item_ids_json, expected_amount_uah,
      authorized_discount_uid, telegram_discount_tg_id, expires_at_ms, consumed, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    session.sessionId,
    session.nonce,
    session.privateKeyEnc,
    session.kind,
    JSON.stringify(session.expectedItemIds),
    session.expectedAmountUah,
    session.authorizedDiscountUid || null,
    session.telegramDiscountTgId || null,
    session.expiresAtMs,
    session.consumed ? 1 : 0,
    Date.now()
  );
}

export function getAndConsumePaymentSessionFromSqlite(sessionId: string): SqlitePaymentSession | null {
  const db = getSqliteDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const stmt = db.prepare('SELECT * FROM payment_sessions WHERE session_id = ?');
    const row = stmt.get(sessionId) as any;
    if (!row) {
      db.exec('ROLLBACK');
      return null;
    }
    if (row.consumed === 1 || row.expiresAtMs <= Date.now()) {
      db.exec('ROLLBACK');
      return null;
    }
    const updateStmt = db.prepare('UPDATE payment_sessions SET consumed = 1 WHERE session_id = ?');
    updateStmt.run(sessionId);
    db.exec('COMMIT');
    return {
      sessionId: row.session_id,
      nonce: row.nonce,
      privateKeyEnc: row.private_key_enc,
      kind: row.kind,
      expectedItemIdsJson: row.expected_item_ids_json,
      expectedAmountUah: row.expected_amount_uah,
      authorizedDiscountUid: row.authorized_discount_uid || undefined,
      telegramDiscountTgId: row.telegram_discount_tg_id || undefined,
      expiresAtMs: row.expiresAtMs,
      consumed: 1,
      createdAtMs: row.created_at_ms,
    };
  } catch {
    db.exec('ROLLBACK');
    return null;
  }
}

export function purgeExpiredPaymentSessionsSqlite(): void {
  const db = getSqliteDb();
  const stmt = db.prepare('DELETE FROM payment_sessions WHERE expires_at_ms <= ? OR consumed = 1');
  stmt.run(Date.now());
}

// Monobank invoices persistence in SQLite
export interface SqliteMonobankInvoice {
  invoiceId: string;
  kind: 'store' | 'prose';
  orderCode: string;
  proseId?: string;
  productIds?: string[];
  amountUah: number;
  buyerName: string;
  buyerEmail: string;
  shipping?: any;
  guestUid?: string;
  status: string;
  failureReason?: string;
  finalizedOrderCode?: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export function upsertMonobankInvoiceSqlite(inv: SqliteMonobankInvoice): void {
  const db = getSqliteDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO monobank_invoices (
      invoice_id, kind, order_code, prose_id, product_ids_json, amount_uah, buyer_name, buyer_email, shipping_json, guest_uid, status, failure_reason, finalized_order_code, created_at_ms, expires_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    inv.invoiceId,
    inv.kind,
    inv.orderCode,
    inv.proseId || null,
    inv.productIds ? JSON.stringify(inv.productIds) : null,
    inv.amountUah,
    inv.buyerName,
    inv.buyerEmail,
    inv.shipping ? JSON.stringify(inv.shipping) : null,
    inv.guestUid || null,
    inv.status,
    inv.failureReason || null,
    inv.finalizedOrderCode || null,
    inv.createdAtMs,
    inv.expiresAtMs,
    Date.now()
  );
}

export function getMonobankInvoiceSqlite(invoiceId: string): SqliteMonobankInvoice | null {
  const db = getSqliteDb();
  const stmt = db.prepare('SELECT * FROM monobank_invoices WHERE invoice_id = ?');
  const row = stmt.get(invoiceId) as any;
  if (!row) return null;
  return {
    invoiceId: row.invoice_id,
    kind: row.kind,
    orderCode: row.order_code,
    proseId: row.prose_id || undefined,
    productIds: row.product_ids_json ? JSON.parse(row.product_ids_json) : undefined,
    amountUah: row.amount_uah,
    buyerName: row.buyer_name,
    buyerEmail: row.buyer_email,
    shipping: row.shipping_json ? JSON.parse(row.shipping_json) : undefined,
    guestUid: row.guest_uid || undefined,
    status: row.status,
    failureReason: row.failure_reason || undefined,
    finalizedOrderCode: row.finalized_order_code || undefined,
    createdAtMs: row.created_at_ms,
    expiresAtMs: row.expires_at_ms,
  };
}

export function purgeExpiredMonobankInvoicesSqlite(): void {
  const db = getSqliteDb();
  // Retain finalized or active invoices, purge unfinalized past 90 days or expired without finalization
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const stmt = db.prepare('DELETE FROM monobank_invoices WHERE expires_at_ms <= ? AND finalized_order_code IS NULL AND created_at_ms < ?');
  stmt.run(Date.now(), cutoff);
}
