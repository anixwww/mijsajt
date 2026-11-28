import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  normalizeHomeRepeatersConfig,
  type GlobalChatMessage,
  type InterviewLinkItem,
  type OrderRecord,
  type PoemImagePalette,
  type PoemSoundCloudTrack,
  type PoemSubmissionStatus,
  type ProseAccessMode,
  type ProseChapter,
  type ProseStatus,
  type ProseSubmissionStatus,
  type ProseTag,
  type ProseTagColor,
  type RadioStationId,
  type RadioTrack,
  type ReviewItem,
  type SocialLinkItem,
  type SocialPlatform,
  type WeeklyMusicSelection,
  type WeeklyMusicTrack,
  type WeeklyPoemWinner,
  type WeeklyProseWinner,
} from '../src/types.ts';
import type {
  DonorRecord,
  FeedbackRecord,
  GuestAccountRecord,
  PoemSubmissionRecord,
  ProseSubmissionRecord,
  RawBlogPost,
  RawPoem,
  RawProseWork,
  RawStoreProduct,
  SiteDatabase,
} from './seedData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseAppletConfig {
  projectId?: string;
  apiKey?: string;
  firestoreDatabaseId?: string;
}

function parsePoemSoundCloudTrack(raw: unknown): PoemSoundCloudTrack | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.title !== 'string' ||
    typeof r.artist !== 'string' ||
    typeof r.soundcloudUrl !== 'string' ||
    typeof r.embedTargetUrl !== 'string'
  ) {
    return undefined;
  }
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    soundcloudUrl: r.soundcloudUrl,
    embedTargetUrl: r.embedTargetUrl,
    ...(typeof r.artworkUrl === 'string' && r.artworkUrl ? { artworkUrl: r.artworkUrl } : {}),
  };
}

function parsePoemSoundCloudFields(data: Record<string, unknown>): {
  soundcloudTrack?: PoemSoundCloudTrack;
  soundcloudTracks?: PoemSoundCloudTrack[];
} {
  const list: PoemSoundCloudTrack[] = [];
  if (Array.isArray(data.soundcloudTracks)) {
    for (const item of data.soundcloudTracks) {
      const parsed = parsePoemSoundCloudTrack(item);
      if (parsed && list.length < 10) list.push(parsed);
    }
  }
  const single = parsePoemSoundCloudTrack(data.soundcloudTrack);
  if (list.length === 0 && single) {
    list.push(single);
  }
  if (list.length === 0) return {};
  return {
    soundcloudTrack: single || list[0],
    soundcloudTracks: list,
  };
}

function serializePoemSoundCloudFields(
  single?: PoemSoundCloudTrack,
  many?: PoemSoundCloudTrack[]
): {
  soundcloudTrack?: Record<string, unknown>;
  soundcloudTracks?: Array<Record<string, unknown>>;
} {
  const listSource =
    Array.isArray(many) && many.length > 0 ? many : single ? [single] : [];
  const cleanList = listSource.slice(0, 10).map((t) => ({
    id: String(t.id).slice(0, 128),
    title: String(t.title).slice(0, 200),
    artist: String(t.artist).slice(0, 140),
    soundcloudUrl: String(t.soundcloudUrl).slice(0, 500),
    embedTargetUrl: String(t.embedTargetUrl).slice(0, 500),
    ...(t.artworkUrl ? { artworkUrl: String(t.artworkUrl).slice(0, 500) } : {}),
  }));
  if (cleanList.length === 0) return {};
  return {
    soundcloudTrack: cleanList[0],
    soundcloudTracks: cleanList,
  };
}

function loadFirebaseConfig(): {
  projectId: string;
  apiKey: string;
  databaseId: string;
} | null {
  const candidates = [
    path.join(path.dirname(__dirname), 'firebase-applet-config.json'),
    path.join(process.cwd(), 'firebase-applet-config.json'),
  ];
  for (const configPath of candidates) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as FirebaseAppletConfig;
      if (parsed.projectId && parsed.apiKey) {
        return {
          projectId: parsed.projectId,
          apiKey: parsed.apiKey,
          databaseId: parsed.firestoreDatabaseId || '(default)',
        };
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}

type FsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

interface FsDocument {
  name: string;
  fields?: Record<string, FsValue>;
  createTime?: string;
  updateTime?: string;
}

function toFsValue(val: unknown): FsValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { integerValue: '0' };
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((item) => toFsValue(item)),
      },
    };
  }
  if (val instanceof Date) {
    return {
      timestampValue: Number.isNaN(val.getTime()) ? new Date().toISOString() : val.toISOString(),
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v === undefined) continue;
      fields[k] = toFsValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFsFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    fields[k] = toFsValue(v);
  }
  return fields;
}

function fromFsValue(val: FsValue | undefined): unknown {
  if (!val) return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) {
    return Array.isArray(val.arrayValue?.values)
      ? val.arrayValue.values.map((v) => fromFsValue(v))
      : [];
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    const fields = val.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFsValue(v);
    }
    return out;
  }
  return undefined;
}

function fromFsDocument(doc: FsDocument): { id: string; data: Record<string, unknown> } {
  const parts = doc.name.split('/');
  const id = parts[parts.length - 1] || '';
  const data: Record<string, unknown> = {};
  if (doc.fields) {
    for (const [k, v] of Object.entries(doc.fields)) {
      data[k] = fromFsValue(v);
    }
  }
  return { id, data };
}

function getBaseUrls() {
  const cfg = loadFirebaseConfig();
  if (!cfg) return null;
  const docRoot = `projects/${encodeURIComponent(cfg.projectId)}/databases/${encodeURIComponent(cfg.databaseId)}/documents`;
  const baseUrl = `https://firestore.googleapis.com/v1/${docRoot}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/${encodeURIComponent(cfg.databaseId)}/documents:commit`;
  return { ...cfg, docRoot, baseUrl, commitUrl };
}

async function fetchFsGet(
  docPath: string,
  authToken?: string
): Promise<{ status: number; doc: FsDocument | null }> {
  const urls = getBaseUrls();
  if (!urls) return { status: 0, doc: null };
  const url = authToken
    ? `${urls.baseUrl}/${docPath}`
    : `${urls.baseUrl}/${docPath}?key=${encodeURIComponent(urls.apiKey)}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return { status: 404, doc: null };
  if (!res.ok) return { status: res.status, doc: null };
  const doc = (await res.json()) as FsDocument;
  return { status: res.status, doc };
}

async function fetchFsList(
  collection: string,
  authToken?: string
): Promise<{ ok: boolean; docs: FsDocument[] }> {
  const urls = getBaseUrls();
  if (!urls) return { ok: false, docs: [] };

  const docs: FsDocument[] = [];
  let lastDocName = '';
  try {
    const queryUrl = authToken
      ? `https://firestore.googleapis.com/v1/${urls.docRoot}:runQuery`
      : `https://firestore.googleapis.com/v1/${urls.docRoot}:runQuery?key=${encodeURIComponent(urls.apiKey)}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    for (let page = 0; page < 20; page++) {
      const structuredQuery: Record<string, unknown> = {
        from: [{ collectionId: collection }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: 300,
      };
      if (lastDocName) {
        structuredQuery.where = {
          fieldFilter: {
            field: { fieldPath: '__name__' },
            op: 'GREATER_THAN',
            value: { referenceValue: lastDocName },
          },
        };
      }

      const res = await fetch(queryUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ structuredQuery }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return { ok: false, docs: [] };
      }
      const rows = (await res.json()) as Array<{ document?: FsDocument }>;
      const pageDocs = Array.isArray(rows)
        ? rows.map((r) => r.document).filter((d): d is FsDocument => Boolean(d && d.name))
        : [];
      docs.push(...pageDocs);
      if (pageDocs.length < 300) break;
      lastDocName = pageDocs[pageDocs.length - 1].name;
    }
    return { ok: true, docs };
  } catch {
    return { ok: false, docs: [] };
  }
}

async function fetchFsListOrdered(
  collection: string,
  orderField: string,
  direction: 'ASCENDING' | 'DESCENDING',
  limit: number,
  authToken?: string
): Promise<{ ok: boolean; docs: FsDocument[] }> {
  const urls = getBaseUrls();
  if (!urls) return { ok: false, docs: [] };
  try {
    const queryUrl = authToken
      ? `https://firestore.googleapis.com/v1/${urls.docRoot}:runQuery`
      : `https://firestore.googleapis.com/v1/${urls.docRoot}:runQuery?key=${encodeURIComponent(urls.apiKey)}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const res = await fetch(queryUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: collection }],
          orderBy: [{ field: { fieldPath: orderField }, direction }],
          limit: Math.max(1, Math.min(500, limit)),
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return fetchFsList(collection, authToken);
    }
    const rows = (await res.json()) as Array<{ document?: FsDocument }>;
    const docs = Array.isArray(rows)
      ? rows.map((r) => r.document).filter((d): d is FsDocument => Boolean(d && d.name))
      : [];
    return { ok: true, docs };
  } catch {
    return fetchFsList(collection, authToken);
  }
}

interface CommitWrite {
  update?: {
    name: string;
    fields: Record<string, FsValue>;
  };
  delete?: string;
  updateMask?: {
    fieldPaths: string[];
  };
  updateTransforms?: Array<{
    fieldPath: string;
    setToServerValue: 'REQUEST_TIME';
  }>;
}

async function commitWritesDetailed(
  writes: CommitWrite[],
  authToken: string
): Promise<{ ok: boolean; status: number }> {
  const urls = getBaseUrls();
  if (!urls || writes.length === 0) return { ok: true, status: 200 };

  for (let i = 0; i < writes.length; i += 350) {
    const chunk = writes.slice(i, i + 350);
    const res = await fetch(urls.commitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ writes: chunk }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(
        `[FirestoreSync] Commit failed (${res.status}):`,
        errText.replace(/\s+/g, ' ').slice(0, 600)
      );
      return { ok: false, status: res.status };
    }
  }
  return { ok: true, status: 200 };
}

async function commitWrites(writes: CommitWrite[], authToken: string): Promise<boolean> {
  const res = await commitWritesDetailed(writes, authToken);
  return res.ok;
}

async function fetchFsAuthenticatedRadioTracks(authToken: string): Promise<{ ok: boolean; docs: FsDocument[] }> {
  const urls = getBaseUrls();
  if (!urls || !authToken) return { ok: false, docs: [] };
  try {
    const queryUrl = `https://firestore.googleapis.com/v1/${urls.docRoot}:runQuery`;
    const res = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'radioTracks' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'visibility' },
              op: 'EQUAL',
              value: { stringValue: 'authenticated' },
            },
          },
          limit: 300,
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { ok: false, docs: [] };
    }
    const rows = (await res.json()) as Array<{ document?: FsDocument }>;
    const docs = Array.isArray(rows)
      ? rows.map((r) => r.document).filter((d): d is FsDocument => Boolean(d && d.name))
      : [];
    return { ok: true, docs };
  } catch {
    return { ok: false, docs: [] };
  }
}

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function sanitizeId(raw: string): string | null {
  const trimmed = raw.trim();
  return VALID_ID_RE.test(trimmed) ? trimmed : null;
}

function normalizeProseAccessMode(raw: unknown, work?: Partial<RawProseWork>): ProseAccessMode {
  if (raw === 'paid' || raw === 'authorized' || raw === 'public') return raw;
  if (work?.isPaid) return 'paid';
  if (work?.requiresAuth) return 'authorized';
  return 'public';
}

function normalizeProseStatus(raw: unknown): ProseStatus {
  if (raw === 'in_progress') return 'in_progress';
  return 'completed';
}

function normalizeChapters(raw: unknown): ProseChapter[] {
  if (!Array.isArray(raw)) return [];
  const out: ProseChapter[] = [];
  for (const ch of raw.slice(0, 200)) {
    if (!ch || typeof ch !== 'object') continue;
    const item = ch as Partial<ProseChapter>;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `ch-${out.length + 1}`;
    const title = typeof item.title === 'string' ? item.title : '';
    const content = typeof item.content === 'string' ? item.content : '';
    const publishedAt = typeof item.publishedAt === 'string' ? item.publishedAt : '';
    out.push({
      id,
      title,
      content,
      publishedAt,
    });
  }
  return out;
}

export interface CloudSyncState {
  publicHydrated: boolean;
  communityHydrated: boolean;
  cloudConfigExists: boolean;
  radioHydrated: boolean;
  adminSecretsHydrated: boolean;
}

export const cloudSyncState: CloudSyncState = {
  publicHydrated: false,
  communityHydrated: false,
  cloudConfigExists: false,
  radioHydrated: false,
  adminSecretsHydrated: false,
};

let pendingPublicHydration: Promise<boolean> | null = null;
let pendingCommunityHydration: Promise<boolean> | null = null;
let pendingAdminSync: Promise<void> = Promise.resolve();

function parseWorkVoteKey(id: string): {
  targetType: 'poem' | 'prose' | 'product';
  targetId: string;
  userId: string;
} | null {
  const parts = id.split('__');
  if (parts.length < 3) return null;
  const targetType = parts[0];
  if (targetType !== 'poem' && targetType !== 'prose' && targetType !== 'product') return null;
  const userId = parts[parts.length - 1];
  const targetId = parts.slice(1, -1).join('__');
  if (!targetId || !userId) return null;
  return { targetType, targetId, userId };
}

function mergeCommunityDocsIntoDb(
  db: SiteDatabase,
  results: {
    reviewsRes: { ok: boolean; docs: FsDocument[] };
    workVotesRes: { ok: boolean; docs: FsDocument[] };
    chatRes: { ok: boolean; docs: FsDocument[] };
    profilesRes: { ok: boolean; docs: FsDocument[] };
    donationsRes: { ok: boolean; docs: FsDocument[] };
  }
): boolean {
  let changed = false;

  // 1. Reviews (merge by ID so recent local entries are preserved, sorted newest first)
  if (results.reviewsRes.ok) {
    const byId = new Map<string, ReviewItem>();
    for (const r of db.reviews || []) {
      if (r?.id) byId.set(r.id, r);
    }
    for (const doc of results.reviewsRes.docs) {
      const { id, data } = fromFsDocument(doc);
      const revId = typeof data.id === 'string' && data.id ? data.id : id;
      const targetType = data.targetType;
      const targetId = typeof data.targetId === 'string' ? data.targetId : '';
      const authorUid = typeof data.authorUid === 'string' ? data.authorUid : '';
      const authorName = typeof data.authorName === 'string' ? data.authorName : 'Гість';
      const comment = typeof data.comment === 'string' ? data.comment : '';
      const rating =
        typeof data.rating === 'number' && Number.isFinite(data.rating) ? data.rating : null;
      const createdAt =
        typeof data.createdAt === 'string' && data.createdAt
          ? data.createdAt
          : doc.createTime || new Date().toISOString();
      if (
        !revId ||
        (targetType !== 'poem' && targetType !== 'prose' && targetType !== 'product') ||
        !targetId ||
        !authorUid ||
        (!comment.trim() && rating === null)
      ) {
        continue;
      }
      const authorPhotoUrl =
        typeof data.authorPhotoUrl === 'string' && data.authorPhotoUrl.trim()
          ? data.authorPhotoUrl.trim()
          : undefined;
      byId.set(revId, {
        id: revId,
        targetType,
        targetId,
        authorUid,
        authorName,
        ...(authorPhotoUrl ? { authorPhotoUrl } : {}),
        rating,
        comment,
        createdAt,
      });
      changed = true;
    }
    db.reviews = Array.from(byId.values()).sort(
      (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
    );
  }

  // 2. Work votes (merge under `u:${userId}` keys alongside IP-hash votes)
  if (results.workVotesRes.ok) {
    for (const doc of results.workVotesRes.docs) {
      const { id, data } = fromFsDocument(doc);
      const parsedFromId = parseWorkVoteKey(typeof data.id === 'string' && data.id ? data.id : id);
      const targetType =
        data.targetType === 'poem' || data.targetType === 'prose' || data.targetType === 'product'
          ? data.targetType
          : parsedFromId?.targetType;
      const targetId =
        typeof data.targetId === 'string' && data.targetId ? data.targetId : parsedFromId?.targetId;
      const userId =
        typeof data.userId === 'string' && data.userId ? data.userId : parsedFromId?.userId;
      const rating = typeof data.rating === 'number' && Number.isFinite(data.rating) ? data.rating : null;
      if (!targetType || !targetId || !userId || rating === null) continue;

      const voteMap =
        targetType === 'poem'
          ? db.poemVotes
          : targetType === 'prose'
            ? db.proseVotes
            : db.productVotes;
      if (!voteMap[targetId]) voteMap[targetId] = {};
      const key = `u:${userId}`;
      if (voteMap[targetId][key] !== rating) {
        voteMap[targetId][key] = rating;
        changed = true;
      }
    }
  }

  // 3. Chat messages (merge by ID, chronological ascending, keep latest 200)
  if (results.chatRes.ok) {
    const byId = new Map<string, GlobalChatMessage>();
    for (const m of db.chatMessages || []) {
      if (m?.id && m?.text) byId.set(m.id, m);
    }
    for (const doc of results.chatRes.docs) {
      const { id, data } = fromFsDocument(doc);
      const msgId = typeof data.id === 'string' && data.id ? data.id : id;
      const authorUid = typeof data.authorUid === 'string' ? data.authorUid : '';
      const authorName = typeof data.authorName === 'string' ? data.authorName : 'Гість';
      const text = typeof data.text === 'string' ? data.text : '';
      const createdAt =
        typeof data.createdAt === 'string' && data.createdAt
          ? data.createdAt
          : doc.createTime || new Date().toISOString();
      if (!msgId || !authorUid || !text.trim()) continue;
      const rawReply =
        data.replyTo && typeof data.replyTo === 'object' && !Array.isArray(data.replyTo)
          ? (data.replyTo as Record<string, unknown>)
          : null;
      const replyTo =
        rawReply &&
        typeof rawReply.id === 'string' &&
        typeof rawReply.authorUid === 'string' &&
        typeof rawReply.authorName === 'string' &&
        typeof rawReply.text === 'string'
          ? {
              id: rawReply.id,
              authorUid: rawReply.authorUid,
              authorName: rawReply.authorName,
              text: rawReply.text,
            }
          : undefined;
      byId.set(msgId, {
        id: msgId,
        authorUid,
        authorName,
        ...(typeof data.authorPhotoUrl === 'string' && data.authorPhotoUrl
          ? { authorPhotoUrl: data.authorPhotoUrl }
          : {}),
        ...(data.isAdmin === true ? { isAdmin: true } : {}),
        text,
        ...(replyTo ? { replyTo } : {}),
        createdAt,
      });
      changed = true;
    }
    db.chatMessages = Array.from(byId.values())
      .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))
      .slice(-200);
  }

  // 4. Public user profiles (non-PII leaderboard/profile mirror)
  if (results.profilesRes.ok) {
    for (const doc of results.profilesRes.docs) {
      const { id, data } = fromFsDocument(doc);
      const fbUid = sanitizeId(typeof data.uid === 'string' && data.uid ? data.uid : id);
      if (!fbUid) continue;
      const guestUid =
        typeof data.guestUid === 'string' && sanitizeId(data.guestUid) ? data.guestUid.trim() : '';
      const displayName =
        typeof data.displayName === 'string' && data.displayName.trim()
          ? data.displayName.trim().slice(0, 80)
          : 'Читач';
      const photoUrl =
        typeof data.photoUrl === 'string' && data.photoUrl.trim() ? data.photoUrl.trim() : undefined;
      const fsLikes = Array.isArray(data.likedPoemIds)
        ? Array.from(
            new Set(
              (data.likedPoemIds as unknown[])
                .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
                .map((v) => v.trim())
            )
          ).slice(0, 500)
        : undefined;
      const fsRadioLikes = Array.isArray(data.likedRadioTrackIds)
        ? Array.from(
            new Set(
              (data.likedRadioTrackIds as unknown[])
                .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
                .map((v) => v.trim())
            )
          ).slice(0, 500)
        : undefined;
      const fsTotalTime =
        typeof data.totalTimeSeconds === 'number' && Number.isFinite(data.totalTimeSeconds)
          ? Math.max(0, Math.round(data.totalTimeSeconds))
          : 0;
      const fsPurchases =
        typeof data.purchasesCount === 'number' && Number.isFinite(data.purchasesCount)
          ? Math.max(0, Math.round(data.purchasesCount))
          : 0;
      const fsDonorText =
        typeof data.donorChatText === 'string' && data.donorChatText.trim()
          ? data.donorChatText.trim().slice(0, 80)
          : undefined;
      const fsCreatedAt =
        typeof data.createdAt === 'string' && data.createdAt
          ? data.createdAt
          : doc.createTime || new Date().toISOString();
      const fsUpdatedAt =
        typeof data.updatedAt === 'string' && data.updatedAt
          ? data.updatedAt
          : doc.updateTime || fsCreatedAt;
      const fsLastSeenAt =
        typeof data.lastSeenAt === 'string' && data.lastSeenAt ? data.lastSeenAt : fsUpdatedAt;

      const existing = db.guestAccounts.find(
        (acc) =>
          acc.googleUid === fbUid ||
          acc.uid === fbUid ||
          (guestUid && acc.uid === guestUid)
      );

      if (existing) {
        if (!existing.googleUid) existing.googleUid = fbUid;
        if (!existing.displayName && displayName) existing.displayName = displayName;
        if (!existing.photoUrl && photoUrl) existing.photoUrl = photoUrl;
        if (fsDonorText && !existing.donorChatText) existing.donorChatText = fsDonorText;
        existing.totalTimeSeconds = Math.max(
          Math.round(Number(existing.totalTimeSeconds) || 0),
          fsTotalTime
        );
        existing.purchasesCount = Math.max(
          Math.round(Number(existing.purchasesCount) || 0),
          fsPurchases
        );

        const localLikedMs = existing.likedUpdatedAt ? Date.parse(existing.likedUpdatedAt) : 0;
        const fsUpdatedMs = Date.parse(fsUpdatedAt) || 0;
        const localLikes = Array.isArray(existing.likedPoemIds) ? existing.likedPoemIds : [];
        if (
          fsLikes &&
          (fsLikes.length > 0 || localLikes.length === 0) &&
          (!existing.likedUpdatedAt ||
            (localLikes.length === 0 && fsLikes.length > 0) ||
            fsUpdatedMs > localLikedMs)
        ) {
          existing.likedPoemIds = fsLikes;
          existing.likedUpdatedAt = fsUpdatedAt;
        }
        const localRadio = Array.isArray(existing.likedRadioTrackIds)
          ? existing.likedRadioTrackIds
          : [];
        if (
          fsRadioLikes &&
          (fsRadioLikes.length > 0 || localRadio.length === 0) &&
          ((localRadio.length === 0 && fsRadioLikes.length > 0) || fsUpdatedMs > localLikedMs)
        ) {
          existing.likedRadioTrackIds = fsRadioLikes;
        }
      } else {
        db.guestAccounts.push({
          uid: guestUid || fbUid,
          googleUid: fbUid,
          displayName,
          email: '',
          ...(photoUrl ? { photoUrl } : {}),
          likedPoemIds: fsLikes || [],
          likedRadioTrackIds: fsRadioLikes || [],
          ...(fsDonorText ? { donorChatText: fsDonorText } : {}),
          likedUpdatedAt: fsUpdatedAt,
          purchasesCount: fsPurchases,
          totalTimeSeconds: fsTotalTime,
          lastSeenAt: fsLastSeenAt,
          createdAt: fsCreatedAt,
          updatedAt: fsUpdatedAt,
        });
      }
      changed = true;
    }
  }

  // 5. Donations
  if (results.donationsRes.ok) {
    const byId = new Map<string, DonorRecord>();
    for (const d of db.donations || []) {
      if (d?.id) byId.set(d.id, d);
    }
    for (const doc of results.donationsRes.docs) {
      const { id, data } = fromFsDocument(doc);
      const donId = typeof data.id === 'string' && data.id ? data.id : id;
      const displayName = typeof data.displayName === 'string' ? data.displayName : '';
      const amountUah =
        typeof data.amountUah === 'number' && Number.isFinite(data.amountUah) ? data.amountUah : 0;
      const donatedAt =
        typeof data.donatedAt === 'string' && data.donatedAt
          ? data.donatedAt
          : doc.createTime || new Date().toISOString();
      if (!donId || !displayName || amountUah <= 0) continue;
      byId.set(donId, {
        id: donId,
        ...(typeof data.guestUid === 'string' && data.guestUid ? { guestUid: data.guestUid } : {}),
        displayName,
        ...(typeof data.photoUrl === 'string' && data.photoUrl ? { photoUrl: data.photoUrl } : {}),
        amountUah,
        ...(typeof data.note === 'string' && data.note ? { note: data.note } : {}),
        donatedAt,
      });
      changed = true;
    }
    db.donations = Array.from(byId.values()).sort(
      (a, b) => (Date.parse(b.donatedAt) || 0) - (Date.parse(a.donatedAt) || 0)
    );
  }

  return changed;
}

export async function hydrateCommunityStateFromFirestore(db: SiteDatabase): Promise<boolean> {
  if (cloudSyncState.communityHydrated) return true;
  if (pendingCommunityHydration) return pendingCommunityHydration;

  pendingCommunityHydration = (async () => {
    try {
      const [reviewsRes, workVotesRes, chatRes, profilesRes, donationsRes] = await Promise.all([
        fetchFsListOrdered('reviews', 'createdAt', 'DESCENDING', 300),
        fetchFsList('workVotes'),
        fetchFsListOrdered('chatMessages', 'createdAt', 'DESCENDING', 200),
        fetchFsList('publicProfiles'),
        fetchFsList('donations'),
      ]);
      mergeCommunityDocsIntoDb(db, {
        reviewsRes,
        workVotesRes,
        chatRes,
        profilesRes,
        donationsRes,
      });
      const anyOk =
        reviewsRes.ok || workVotesRes.ok || chatRes.ok || profilesRes.ok || donationsRes.ok;
      if (anyOk) {
        cloudSyncState.communityHydrated = true;
      }
      return anyOk;
    } catch {
      return false;
    } finally {
      pendingCommunityHydration = null;
    }
  })();

  return pendingCommunityHydration;
}

export async function hydratePublicCatalogFromFirestore(db: SiteDatabase): Promise<boolean> {
  if (cloudSyncState.publicHydrated && cloudSyncState.communityHydrated) return true;
  if (pendingPublicHydration) return pendingPublicHydration;

  pendingPublicHydration = (async () => {
    try {
      const [configResp, communityOk] = await Promise.all([
        cloudSyncState.publicHydrated ? Promise.resolve(null) : fetchFsGet('siteConfig/main'),
        cloudSyncState.communityHydrated
          ? Promise.resolve(true)
          : hydrateCommunityStateFromFirestore(db),
      ]);

      if (!configResp) {
        return communityOk;
      }
      if (configResp.status === 0) {
        return communityOk;
      }
      if (configResp.status === 404) {
        cloudSyncState.publicHydrated = true;
        cloudSyncState.cloudConfigExists = false;
        return communityOk;
      }
      if (!configResp.doc) {
        return communityOk;
      }

      cloudSyncState.cloudConfigExists = true;
      const { data: cfg } = fromFsDocument(configResp.doc);

      if (typeof cfg.heroLeadText === 'string') db.heroLeadText = cfg.heroLeadText;
      if (typeof cfg.authorAboutText === 'string') db.authorAboutText = cfg.authorAboutText;
      if (typeof cfg.authorPhotoUrl === 'string' && cfg.authorPhotoUrl) {
        db.authorPhotoUrl = cfg.authorPhotoUrl;
      }
      if (Array.isArray(cfg.authorPhotos)) {
        const photos = cfg.authorPhotos.filter((u): u is string => typeof u === 'string' && u.length > 0);
        if (photos.length > 0) db.authorPhotos = photos;
      }
      if (Array.isArray(cfg.socialLinks)) {
        db.socialLinks = cfg.socialLinks
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            platform: String(item.platform || 'telegram') as SocialPlatform,
            label: String(item.label || ''),
            url: String(item.url || ''),
            enabled: Boolean(item.enabled),
          })) as SocialLinkItem[];
      }
      if (typeof cfg.monobankJarUrl === 'string') db.monobankJarUrl = cfg.monobankJarUrl;
      if (typeof cfg.monobankModalTitle === 'string' && cfg.monobankModalTitle.trim()) {
        db.monobankModalTitle = cfg.monobankModalTitle;
      }
      if (typeof cfg.monobankModalSubtitle === 'string') {
        db.monobankModalSubtitle = cfg.monobankModalSubtitle;
      }
      if (typeof cfg.monobankCardLabel === 'string') {
        db.monobankCardLabel = cfg.monobankCardLabel;
      }
      if (typeof cfg.monobankModalText === 'string' && cfg.monobankModalText.trim()) {
        db.monobankModalText = cfg.monobankModalText;
      }
      if (typeof cfg.monobankEmptyText === 'string') {
        db.monobankEmptyText = cfg.monobankEmptyText;
      }
      if (typeof cfg.contactEmail === 'string') db.contactEmail = cfg.contactEmail;
      if (Array.isArray(cfg.interviews)) {
        db.interviews = cfg.interviews
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: String(item.id || ''),
            title: String(item.title || ''),
            outlet: String(item.outlet || ''),
            dateLabel: String(item.dateLabel || ''),
            ...(typeof item.content === 'string' && item.content ? { content: item.content } : {}),
            ...(typeof item.url === 'string' && item.url ? { url: item.url } : {}),
          })) as InterviewLinkItem[];
      }
      if (typeof cfg.homeActionAboutTitle === 'string' && cfg.homeActionAboutTitle) {
        db.homeActionAboutTitle = cfg.homeActionAboutTitle;
      }
      if (typeof cfg.homeActionContactTitle === 'string' && cfg.homeActionContactTitle) {
        const normalizedContact = cfg.homeActionContactTitle.trim();
        db.homeActionContactTitle =
          normalizedContact === 'Зв’язатися з автором' ||
          normalizedContact === "Зв'язатися з автором"
            ? 'Зв’язок'
            : normalizedContact;
      }
      if (typeof cfg.homeActionMonobankTitle === 'string' && cfg.homeActionMonobankTitle) {
        db.homeActionMonobankTitle = cfg.homeActionMonobankTitle;
      }
      if (typeof cfg.homeActionInterviewsTitle === 'string' && cfg.homeActionInterviewsTitle) {
        db.homeActionInterviewsTitle = cfg.homeActionInterviewsTitle;
      }
      if (cfg.homeRepeaters && typeof cfg.homeRepeaters === 'object') {
        db.homeRepeaters = normalizeHomeRepeatersConfig(cfg.homeRepeaters);
      }
      if (typeof cfg.proseAuthDiscountPercent === 'number') {
        db.proseAuthDiscountPercent = cfg.proseAuthDiscountPercent;
      }
      if (typeof cfg.proseTelegramDiscountPercent === 'number') {
        db.proseTelegramDiscountPercent = cfg.proseTelegramDiscountPercent;
      } else if (typeof cfg.storeAuthDiscountPercent === 'number' && cfg.storeAuthDiscountPercent > 0) {
        db.proseTelegramDiscountPercent = cfg.storeAuthDiscountPercent;
      }
      if (typeof cfg.telegramChannelId === 'string') {
        db.telegramChannelId = cfg.telegramChannelId.trim();
      }
      db.storeAuthDiscountPercent = 0;
      if (Array.isArray(cfg.proseTags)) {
        db.proseTags = cfg.proseTags
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: String(item.id || ''),
            label: String(item.label || ''),
            color: String(item.color || 'sage') as ProseTagColor,
          }))
          .filter((t) => t.id && t.label) as ProseTag[];
      }

      const [poemsRes, proseRes, blogRes, productsRes, weeklyRes, weeklyMusicRes] = await Promise.all([
        fetchFsList('poems'),
        fetchFsList('prose'),
        fetchFsList('blogPosts'),
        fetchFsList('products'),
        fetchFsList('weeklyHighlights'),
        fetchFsList('weeklyMusicSelections'),
      ]);

      if (poemsRes.ok) {
        const loadedPoems = poemsRes.docs
          .map((doc) => {
            const { id, data } = fromFsDocument(doc);
            const order = typeof data.order === 'number' ? data.order : 0;
            const noteStr = typeof data.note === 'string' && data.note ? data.note : undefined;
            const imageUrlStr =
              typeof data.imageUrl === 'string' && data.imageUrl.trim() ? data.imageUrl.trim() : undefined;
            const rawPalette =
              data.imagePalette && typeof data.imagePalette === 'object' && !Array.isArray(data.imagePalette)
                ? (data.imagePalette as Record<string, unknown>)
                : null;
            const imagePalette: PoemImagePalette | undefined =
              imageUrlStr &&
              rawPalette &&
              typeof rawPalette.background === 'string' &&
              typeof rawPalette.text === 'string'
                ? {
                    background: rawPalette.background,
                    ...(typeof rawPalette.secondaryBackground === 'string' && rawPalette.secondaryBackground
                      ? { secondaryBackground: rawPalette.secondaryBackground }
                      : {}),
                    text: rawPalette.text,
                    ...(typeof rawPalette.isDark === 'boolean' ? { isDark: rawPalette.isDark } : {}),
                  }
                : undefined;
            const scFields = parsePoemSoundCloudFields(data);
            const poem: RawPoem & { _order: number } = {
              id: typeof data.id === 'string' && data.id ? data.id : id,
              title: String(data.title || ''),
              cycle: String(data.cycle || ''),
              year: typeof data.year === 'number' ? data.year : 2026,
              excerpt: String(data.excerpt || ''),
              content: String(data.content || ''),
              ...(noteStr ? { note: noteStr } : {}),
              ...(typeof data.fontSize === 'string' ? { fontSize: data.fontSize as any } : {}),
              ...(typeof data.textAlign === 'string' ? { textAlign: data.textAlign as any } : {}),
              ...(typeof data.lineSpacing === 'string' ? { lineSpacing: data.lineSpacing as any } : {}),
              ...(typeof data.textColor === 'string' && data.textColor ? { textColor: data.textColor } : {}),
              ...(typeof data.backgroundColor === 'string' && data.backgroundColor ? { backgroundColor: data.backgroundColor } : {}),
              ...(imageUrlStr ? { imageUrl: imageUrlStr } : {}),
              ...(imagePalette ? { imagePalette } : {}),
              ...scFields,
              ...(data.isCommunity === true ? { isCommunity: true } : {}),
              ...(typeof data.authorUid === 'string' && data.authorUid ? { authorUid: data.authorUid } : {}),
              ...(typeof data.authorName === 'string' && data.authorName ? { authorName: data.authorName } : {}),
              ...(typeof data.authorPhotoUrl === 'string' && data.authorPhotoUrl ? { authorPhotoUrl: data.authorPhotoUrl } : {}),
              ...(typeof data.submissionId === 'string' && data.submissionId ? { submissionId: data.submissionId } : {}),
              ...(data.workStatus === 'completed' || data.workStatus === 'in_progress'
                ? { workStatus: data.workStatus }
                : {}),
              _order: order,
            };
            return poem;
          })
          .filter((p) => p.id && p.title)
          .sort((a, b) => a._order - b._order)
          .map(({ _order: _o, ...poem }) => poem);
        db.poems = loadedPoems;
      }

      if (proseRes.ok) {
        const localById = new Map(db.prose.map((p) => [p.id, p]));
        const loadedProse = proseRes.docs
          .map((doc) => {
            const { id, data } = fromFsDocument(doc);
            const workId = typeof data.id === 'string' && data.id ? data.id : id;
            const localExisting = localById.get(workId);
            const accessMode = normalizeProseAccessMode(data.accessMode);
            const publicContent = typeof data.content === 'string' ? data.content : '';
            const publicChapters = normalizeChapters(data.chapters);
            const order = typeof data.order === 'number' ? data.order : 0;

            const work: RawProseWork & { _order: number } = {
              id: workId,
              title: String(data.title || ''),
              genre: String(data.genre || 'Оповідання'),
              pages: typeof data.pages === 'number' ? data.pages : 1,
              publishedAt: String(data.publishedAt || ''),
              slogan: String(data.slogan || ''),
              excerpt: String(data.excerpt || ''),
              content:
                accessMode === 'public'
                  ? publicContent
                  : localExisting?.content || publicContent || '',
              chapters:
                accessMode === 'public'
                  ? publicChapters
                  : localExisting?.chapters && localExisting.chapters.length > 0
                    ? localExisting.chapters
                    : publicChapters,
              tagIds: Array.isArray(data.tagIds)
                ? data.tagIds.filter((t): t is string => typeof t === 'string')
                : [],
              status: normalizeProseStatus(data.status),
              accessMode,
              requiresAuth: accessMode === 'authorized',
              isPaid: accessMode === 'paid',
              priceUah: typeof data.priceUah === 'number' ? data.priceUah : 0,
              moodboardUrls: Array.isArray(data.moodboardUrls)
                ? data.moodboardUrls.filter((u): u is string => typeof u === 'string')
                : [],
              ...(data.isCommunity === true ? { isCommunity: true } : {}),
              ...(typeof data.authorUid === 'string' && data.authorUid ? { authorUid: data.authorUid } : {}),
              ...(typeof data.authorName === 'string' && data.authorName ? { authorName: data.authorName } : {}),
              ...(typeof data.authorPhotoUrl === 'string' && data.authorPhotoUrl ? { authorPhotoUrl: data.authorPhotoUrl } : {}),
              ...(typeof data.submissionId === 'string' && data.submissionId ? { submissionId: data.submissionId } : {}),
              ...(localExisting?.pdfStorageKey ? { pdfStorageKey: localExisting.pdfStorageKey } : {}),
              ...(localExisting?.pdfFileName ? { pdfFileName: localExisting.pdfFileName } : {}),
              ...(localExisting?.pdfFileSize ? { pdfFileSize: localExisting.pdfFileSize } : {}),
              _order: order,
            };
            return work;
          })
          .filter((w) => w.id && w.title)
          .sort((a, b) => a._order - b._order)
          .map(({ _order: _o, ...work }) => work);
        db.prose = loadedProse;
      }

      if (blogRes.ok) {
        const loadedBlog = blogRes.docs
          .map((doc) => {
            const { id, data } = fromFsDocument(doc);
            const order = typeof data.order === 'number' ? data.order : 0;
            const coverImage =
              typeof data.coverImage === 'string' && data.coverImage ? data.coverImage : undefined;
            const post: RawBlogPost & { _order: number } = {
              id: typeof data.id === 'string' && data.id ? data.id : id,
              title: String(data.title || ''),
              category: String(data.category || ''),
              publishedAt: String(data.publishedAt || ''),
              readingMinutes: typeof data.readingMinutes === 'number' ? data.readingMinutes : 3,
              ...(coverImage ? { coverImage } : {}),
              excerpt: String(data.excerpt || ''),
              content: String(data.content || ''),
              _order: order,
            };
            return post;
          })
          .filter((b) => b.id && b.title)
          .sort((a, b) => a._order - b._order)
          .map(({ _order: _o, ...post }) => post);
        db.blog = loadedBlog;
      }

      if (productsRes.ok) {
        const localById = new Map(db.products.map((p) => [p.id, p]));
        const loadedProducts = productsRes.docs
          .map((doc) => {
            const { id, data } = fromFsDocument(doc);
            const productId = typeof data.id === 'string' && data.id ? data.id : id;
            const localExisting = localById.get(productId);
            const order = typeof data.order === 'number' ? data.order : 0;
            const strOpt = (val: unknown) =>
              typeof val === 'string' && val ? val : undefined;
            const numOpt = (val: unknown) =>
              typeof val === 'number' && val > 0 ? val : undefined;

            const product: RawStoreProduct & { _order: number } = {
              id: productId,
              type: (data.type as RawStoreProduct['type']) || 'ebook',
              title: String(data.title || ''),
              subtitle: String(data.subtitle || ''),
              priceUah: typeof data.priceUah === 'number' ? data.priceUah : 0,
              discountPercent: typeof data.discountPercent === 'number' ? data.discountPercent : 0,
              promoActive: Boolean(data.promoActive),
              ...(strOpt(data.promoLabel) ? { promoLabel: strOpt(data.promoLabel) } : {}),
              coverImage: String(data.coverImage || ''),
              description: String(data.description || ''),
              sampleExcerpt: String(data.sampleExcerpt || ''),
              ...(strOpt(data.formats) ? { formats: strOpt(data.formats) } : {}),
              ...(numOpt(data.pages) ? { pages: numOpt(data.pages) } : {}),
              ...(numOpt(data.year) ? { year: numOpt(data.year) } : {}),
              ...(strOpt(data.binding) ? { binding: strOpt(data.binding) } : {}),
              ...(strOpt(data.dimensions) ? { dimensions: strOpt(data.dimensions) } : {}),
              ...(strOpt(data.material) ? { material: strOpt(data.material) } : {}),
              ...(strOpt(data.progressLabel) ? { progressLabel: strOpt(data.progressLabel) } : {}),
              ...(numOpt(data.wordCount) ? { wordCount: numOpt(data.wordCount) } : {}),
              ...(strOpt(data.lastUpdated) ? { lastUpdated: strOpt(data.lastUpdated) } : {}),
              ...(localExisting?.gdocGuestUrl ? { gdocGuestUrl: localExisting.gdocGuestUrl } : {}),
              ...(localExisting?.ebookFullText ? { ebookFullText: localExisting.ebookFullText } : {}),
              ...(localExisting?.ebookFileName ? { ebookFileName: localExisting.ebookFileName } : {}),
              ...(localExisting?.ebookMimeType ? { ebookMimeType: localExisting.ebookMimeType } : {}),
              ...(localExisting?.ebookFileSize ? { ebookFileSize: localExisting.ebookFileSize } : {}),
              ...(localExisting?.ebookStorageKey ? { ebookStorageKey: localExisting.ebookStorageKey } : {}),
              _order: order,
            };
            return product;
          })
          .filter((p) => p.id && p.title)
          .sort((a, b) => a._order - b._order)
          .map(({ _order: _o, ...product }) => product);
        db.products = loadedProducts;
      }


      if (weeklyRes.ok && weeklyRes.docs.length > 0) {
        const poemByWeek = new Map<string, WeeklyPoemWinner>(
          (db.weeklyPoems || []).map((w) => [w.weekKey, w])
        );
        const proseByWeek = new Map<string, WeeklyProseWinner>(
          (db.weeklyProse || []).map((w) => [w.weekKey, w])
        );

        for (const doc of weeklyRes.docs) {
          const { id, data } = fromFsDocument(doc);
          const highlightId = typeof data.id === 'string' && data.id ? data.id : id;
          const targetType = data.targetType === 'poem' ? 'poem' : data.targetType === 'prose' ? 'prose' : null;
          const weekKey = typeof data.weekKey === 'string' ? data.weekKey.trim() : '';
          const periodStart = typeof data.periodStart === 'string' ? data.periodStart.trim() : '';
          const periodEnd = typeof data.periodEnd === 'string' ? data.periodEnd.trim() : '';
          const periodLabel = typeof data.periodLabel === 'string' ? data.periodLabel.trim() : '';
          const selectedAt = typeof data.selectedAt === 'string' ? data.selectedAt.trim() : new Date().toISOString();
          const authorName = typeof data.authorName === 'string' && data.authorName.trim() ? data.authorName.trim() : 'Читач';
          const title = typeof data.title === 'string' ? data.title.trim() : '';
          const content = typeof data.content === 'string' ? data.content : '';
          if (
            !highlightId ||
            !targetType ||
            !/^\d{4}-W\d{2}$/.test(weekKey) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ||
            !periodLabel ||
            !title
          ) {
            continue;
          }

          const ratingAverage = typeof data.ratingAverage === 'number' && Number.isFinite(data.ratingAverage)
            ? Math.max(0, Math.min(5, Number(data.ratingAverage.toFixed(1))))
            : 0;
          const ratingCount = typeof data.ratingCount === 'number' && Number.isFinite(data.ratingCount)
            ? Math.max(0, Math.round(data.ratingCount))
            : 0;

          if (targetType === 'poem') {
            const imageUrlStr =
              typeof data.imageUrl === 'string' && data.imageUrl.trim() ? data.imageUrl.trim() : undefined;
            const rawPalette =
              data.imagePalette && typeof data.imagePalette === 'object' && !Array.isArray(data.imagePalette)
                ? (data.imagePalette as Record<string, unknown>)
                : null;
            const imagePalette: PoemImagePalette | undefined =
              imageUrlStr &&
              rawPalette &&
              typeof rawPalette.background === 'string' &&
              typeof rawPalette.text === 'string'
                ? {
                    background: rawPalette.background,
                    ...(typeof rawPalette.secondaryBackground === 'string' && rawPalette.secondaryBackground
                      ? { secondaryBackground: rawPalette.secondaryBackground }
                      : {}),
                    text: rawPalette.text,
                    ...(typeof rawPalette.isDark === 'boolean' ? { isDark: rawPalette.isDark } : {}),
                  }
                : undefined;
            const scFields = parsePoemSoundCloudFields(data);
            poemByWeek.set(weekKey, {
              id: highlightId,
              weekKey,
              periodStart,
              periodEnd,
              periodLabel,
              selectedAt,
              ...(typeof data.sourcePoemId === 'string' && data.sourcePoemId ? { sourcePoemId: data.sourcePoemId } : {}),
              ...(typeof data.sourceSubmissionId === 'string' && data.sourceSubmissionId ? { sourceSubmissionId: data.sourceSubmissionId } : {}),
              ...(typeof data.authorUid === 'string' && data.authorUid ? { authorUid: data.authorUid } : {}),
              authorName,
              ...(typeof data.authorPhotoUrl === 'string' && data.authorPhotoUrl ? { authorPhotoUrl: data.authorPhotoUrl } : {}),
              title,
              ...(typeof data.cycle === 'string' && data.cycle ? { cycle: data.cycle } : {}),
              ...(typeof data.year === 'number' ? { year: data.year } : {}),
              content,
              ...(typeof data.note === 'string' && data.note ? { note: data.note } : {}),
              ...(typeof data.fontSize === 'string' ? { fontSize: data.fontSize as WeeklyPoemWinner['fontSize'] } : {}),
              ...(typeof data.textAlign === 'string' ? { textAlign: data.textAlign as WeeklyPoemWinner['textAlign'] } : {}),
              ...(typeof data.lineSpacing === 'string' ? { lineSpacing: data.lineSpacing as WeeklyPoemWinner['lineSpacing'] } : {}),
              ...(typeof data.textColor === 'string' && data.textColor ? { textColor: data.textColor } : {}),
              ...(typeof data.backgroundColor === 'string' && data.backgroundColor ? { backgroundColor: data.backgroundColor } : {}),
              ...(imageUrlStr ? { imageUrl: imageUrlStr } : {}),
              ...(imagePalette ? { imagePalette } : {}),
              ...scFields,
              ratingAverage,
              ratingCount,
            });
          } else {
            const chapters = normalizeChapters(data.chapters);
            const moodboardUrls = Array.isArray(data.moodboardUrls)
              ? data.moodboardUrls.filter((u): u is string => typeof u === 'string' && u.length > 0)
              : [];
            proseByWeek.set(weekKey, {
              id: highlightId,
              weekKey,
              periodStart,
              periodEnd,
              periodLabel,
              selectedAt,
              ...(typeof data.sourceProseId === 'string' && data.sourceProseId ? { sourceProseId: data.sourceProseId } : {}),
              ...(typeof data.sourceSubmissionId === 'string' && data.sourceSubmissionId ? { sourceSubmissionId: data.sourceSubmissionId } : {}),
              ...(typeof data.authorUid === 'string' && data.authorUid ? { authorUid: data.authorUid } : {}),
              authorName,
              ...(typeof data.authorPhotoUrl === 'string' && data.authorPhotoUrl ? { authorPhotoUrl: data.authorPhotoUrl } : {}),
              title,
              genre: typeof data.genre === 'string' && data.genre.trim() ? data.genre.trim() : 'Оповідання',
              pages: typeof data.pages === 'number' && data.pages >= 1 ? Math.round(data.pages) : 1,
              ...(typeof data.totalWords === 'number' && data.totalWords >= 0 ? { totalWords: Math.round(data.totalWords) } : {}),
              ...(typeof data.slogan === 'string' && data.slogan ? { slogan: data.slogan } : {}),
              content,
              ...(chapters.length > 0 ? { chapters } : {}),
              ...(moodboardUrls.length > 0 ? { moodboardUrls } : {}),
              ...(typeof data.publishedAt === 'string' && data.publishedAt ? { publishedAt: data.publishedAt } : {}),
              ratingAverage,
              ratingCount,
            });
          }
        }

        db.weeklyPoems = Array.from(poemByWeek.values()).sort((a, b) =>
          b.periodStart.localeCompare(a.periodStart)
        );
        db.weeklyProse = Array.from(proseByWeek.values()).sort((a, b) =>
          b.periodStart.localeCompare(a.periodStart)
        );
      }

      if (weeklyMusicRes.ok) {
        const loadedWeeklyMusic: WeeklyMusicSelection[] = [];
        for (const doc of weeklyMusicRes.docs) {
          const { id, data } = fromFsDocument(doc);
          const selId = typeof data.id === 'string' && data.id ? data.id : id;
          const weekKey = typeof data.weekKey === 'string' ? data.weekKey.trim() : '';
          const periodStart = typeof data.periodStart === 'string' ? data.periodStart.trim() : '';
          const periodEnd = typeof data.periodEnd === 'string' ? data.periodEnd.trim() : '';
          const periodLabel = typeof data.periodLabel === 'string' ? data.periodLabel.trim() : '';
          if (
            !selId ||
            !/^\d{4}-W\d{2}$/.test(weekKey) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ||
            !periodLabel
          ) {
            continue;
          }
          const rawText = typeof data.text === 'string' ? data.text.trim().slice(0, 5000) : '';
          const photos = Array.isArray(data.photos)
            ? data.photos
                .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
                .map((u) => u.trim().slice(0, 1000))
                .slice(0, 12)
            : [];
          const tracks: WeeklyMusicTrack[] = Array.isArray(data.tracks)
            ? data.tracks
                .map((raw) => parsePoemSoundCloudTrack(raw))
                .filter((t): t is WeeklyMusicTrack => Boolean(t))
                .slice(0, 50)
            : [];
          const createdAt =
            typeof data.createdAt === 'string' && data.createdAt
              ? data.createdAt
              : new Date().toISOString();
          const updatedAt =
            typeof data.updatedAt === 'string' && data.updatedAt
              ? data.updatedAt
              : createdAt;
          loadedWeeklyMusic.push({
            id: selId,
            weekKey,
            periodStart,
            periodEnd,
            periodLabel,
            ...(rawText ? { text: rawText } : {}),
            photos,
            tracks,
            createdAt,
            updatedAt,
          });
        }
        db.weeklyMusicSelections = loadedWeeklyMusic.sort((a, b) =>
          b.periodStart !== a.periodStart
            ? b.periodStart.localeCompare(a.periodStart)
            : b.createdAt.localeCompare(a.createdAt)
        );
      }

      const allOk = poemsRes.ok && proseRes.ok && blogRes.ok && productsRes.ok;
      if (allOk) {
        cloudSyncState.publicHydrated = true;
      }
      return allOk;
    } catch (err) {
      console.warn('[FirestoreSync] Public catalog hydration failed:', err);
      return false;
    } finally {
      pendingPublicHydration = null;
    }
  })();

  return pendingPublicHydration;
}

export async function hydrateAuthorizedProseAndRadio(
  db: SiteDatabase,
  idToken: string
): Promise<boolean> {
  if (!idToken) return false;
  let updated = false;

  if (!cloudSyncState.radioHydrated) {
    const radioRes = await fetchFsAuthenticatedRadioTracks(idToken);
    if (radioRes.ok) {
      cloudSyncState.radioHydrated = true;
      if (radioRes.docs.length > 0 || cloudSyncState.cloudConfigExists) {
        const tracks = radioRes.docs
          .map((doc) => {
            const { id, data } = fromFsDocument(doc);
            const trackId = typeof data.id === 'string' && data.id ? data.id : id;
            const soundcloudUrl = typeof data.soundcloudUrl === 'string' ? data.soundcloudUrl : '';
            const title = typeof data.title === 'string' ? data.title : '';
            if (!trackId || !soundcloudUrl || !title) return null;
            const artworkUrl =
              typeof data.artworkUrl === 'string' && data.artworkUrl ? data.artworkUrl : undefined;
            const createdAtStr =
              typeof data.createdAt === 'string' && data.createdAt
                ? data.createdAt
                : new Date().toISOString();
            const track: RadioTrack = {
              id: trackId,
              title,
              artist: typeof data.artist === 'string' && data.artist ? data.artist : 'SoundCloud',
              soundcloudUrl,
              embedTargetUrl:
                typeof data.embedTargetUrl === 'string' && data.embedTargetUrl
                  ? data.embedTargetUrl
                  : soundcloudUrl,
              ...(artworkUrl ? { artworkUrl } : {}),
              station: data.station === 'electronic' ? ('electronic' as RadioStationId) : 'indie',
              order: typeof data.order === 'number' ? data.order : 0,
              addedAt: createdAtStr,
            };
            return track;
          })
          .filter((t): t is RadioTrack => Boolean(t))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        db.radioTracks = tracks;
        updated = true;
      }
    }
  }

  return updated;
}

export async function hydrateSingleAuthorizedProse(
  db: SiteDatabase,
  proseId: string,
  idToken: string
): Promise<boolean> {
  const safeId = sanitizeId(proseId);
  if (!safeId || !idToken) return false;
  const work = db.prose.find((p) => p.id === proseId);
  if (!work) return false;
  const accessMode = normalizeProseAccessMode(work.accessMode, work);
  if (accessMode !== 'authorized') return false;
  if (work.content || (work.chapters && work.chapters.length > 0)) return false;

  const resp = await fetchFsGet(`prosePrivate/${safeId}`, idToken);
  if (!resp.doc) return false;
  const { data: priv } = fromFsDocument(resp.doc);
  let changed = false;
  if (typeof priv.content === 'string' && priv.content) {
    work.content = priv.content;
    changed = true;
  }
  const ch = normalizeChapters(priv.chapters);
  if (ch.length > 0) {
    work.chapters = ch;
    changed = true;
  }
  if (typeof priv.pdfStorageKey === 'string' && priv.pdfStorageKey) {
    work.pdfStorageKey = priv.pdfStorageKey;
  }
  if (typeof priv.pdfFileName === 'string' && priv.pdfFileName) {
    work.pdfFileName = priv.pdfFileName;
  }
  if (typeof priv.pdfFileSize === 'number' && priv.pdfFileSize > 0) {
    work.pdfFileSize = priv.pdfFileSize;
  }
  return changed;
}

export async function hydrateAdminSecretsFromFirestore(
  db: SiteDatabase,
  adminToken: string,
  options?: { onTelegramBotToken?: (token: string) => void }
): Promise<boolean> {
  if (!adminToken) return false;
  if (cloudSyncState.adminSecretsHydrated) return false;

  let changed = false;

  const radioChanged = await hydrateAuthorizedProseAndRadio(db, adminToken);
  if (radioChanged) changed = true;

  const [privateRes, secretsRes, tgSecretRes] = await Promise.all([
    fetchFsList('prosePrivate', adminToken),
    fetchFsList('productSecrets', adminToken),
    fetchFsGet('adminSecrets/telegram', adminToken),
  ]);

  if (privateRes.ok) {
    const privateById = new Map<string, Record<string, unknown>>();
    for (const doc of privateRes.docs) {
      const { id, data } = fromFsDocument(doc);
      privateById.set(typeof data.id === 'string' && data.id ? data.id : id, data);
    }
    for (const work of db.prose) {
      const priv = privateById.get(work.id);
      if (!priv) continue;
      if (typeof priv.content === 'string' && priv.content) {
        work.content = priv.content;
        changed = true;
      }
      const ch = normalizeChapters(priv.chapters);
      if (ch.length > 0) {
        work.chapters = ch;
        changed = true;
      }
      if (typeof priv.pdfStorageKey === 'string' && priv.pdfStorageKey) {
        work.pdfStorageKey = priv.pdfStorageKey;
      }
      if (typeof priv.pdfFileName === 'string' && priv.pdfFileName) {
        work.pdfFileName = priv.pdfFileName;
      }
      if (typeof priv.pdfFileSize === 'number' && priv.pdfFileSize > 0) {
        work.pdfFileSize = priv.pdfFileSize;
      }
    }
  }

  if (secretsRes.ok) {
    const secretsById = new Map<string, Record<string, unknown>>();
    for (const doc of secretsRes.docs) {
      const { id, data } = fromFsDocument(doc);
      secretsById.set(typeof data.id === 'string' && data.id ? data.id : id, data);
    }
    for (const prod of db.products) {
      const sec = secretsById.get(prod.id);
      if (!sec) continue;
      if (typeof sec.gdocGuestUrl === 'string' && sec.gdocGuestUrl) {
        prod.gdocGuestUrl = sec.gdocGuestUrl;
        changed = true;
      }
      if (typeof sec.ebookFullText === 'string' && sec.ebookFullText) {
        prod.ebookFullText = sec.ebookFullText;
        changed = true;
      }
      if (typeof sec.ebookFileName === 'string' && sec.ebookFileName) {
        prod.ebookFileName = sec.ebookFileName;
      }
      if (typeof sec.ebookMimeType === 'string' && sec.ebookMimeType) {
        prod.ebookMimeType = sec.ebookMimeType;
      }
      if (typeof sec.ebookFileSize === 'number' && sec.ebookFileSize > 0) {
        prod.ebookFileSize = sec.ebookFileSize;
      }
    }
  }

  if (tgSecretRes.doc) {
    const { data } = fromFsDocument(tgSecretRes.doc);
    if (typeof data.telegramBotToken === 'string') {
      options?.onTelegramBotToken?.(data.telegramBotToken.trim());
    }
  }

  if (privateRes.ok && secretsRes.ok) {
    cloudSyncState.adminSecretsHydrated = true;
  }

  const submissionsChanged = await hydrateAdminPoemSubmissionsFromFirestore(db, adminToken);
  if (submissionsChanged) changed = true;

  return changed;
}

export function queueDatabaseSyncToFirestore(
  dbSnapshot: SiteDatabase,
  adminToken: string,
  adminUid: string
): void {
  pendingAdminSync = pendingAdminSync
    .then(async () => {
      await syncDatabaseToFirestore(dbSnapshot, adminToken, adminUid);
    })
    .catch((err) => {
      console.error('[FirestoreSync] Background sync error:', err);
    });
}

export async function syncDatabaseToFirestore(
  db: SiteDatabase,
  adminToken: string,
  adminUid: string
): Promise<boolean> {
  const urls = getBaseUrls();
  if (!urls || !adminToken || !sanitizeId(adminUid)) return false;

  const writes: CommitWrite[] = [];
  const docName = (collection: string, id: string) => `${urls.docRoot}/${collection}/${id}`;

  // 1. siteConfig/main
  const baseSiteConfigFields = {
    id: 'main',
    heroLeadText: String(db.heroLeadText || '').slice(0, 2000),
    authorAboutText: String(db.authorAboutText || '').slice(0, 10000),
    authorPhotoUrl: String(db.authorPhotoUrl || '').slice(0, 500),
    authorPhotos: (db.authorPhotos || []).slice(0, 20).map((u) => String(u).slice(0, 500)),
    socialLinks: (db.socialLinks || []).slice(0, 20).map((s) => ({
      platform: String(s.platform || 'telegram'),
      label: String(s.label || ''),
      url: String(s.url || ''),
      enabled: Boolean(s.enabled),
    })),
    monobankJarUrl: String(db.monobankJarUrl || '').slice(0, 500),
    contactEmail: String(db.contactEmail || '').slice(0, 254),
    interviews: (db.interviews || []).slice(0, 50).map((i) => ({
      id: String(i.id || ''),
      title: String(i.title || ''),
      outlet: String(i.outlet || ''),
      dateLabel: String(i.dateLabel || ''),
      ...(i.content ? { content: String(i.content) } : {}),
      ...(i.url ? { url: String(i.url) } : {}),
    })),
    homeActionAboutTitle: String(db.homeActionAboutTitle || 'Про мене').slice(0, 120),
    homeActionContactTitle: String(db.homeActionContactTitle || 'Зв’язок').slice(0, 120),
    homeActionMonobankTitle: String(db.homeActionMonobankTitle || 'Підтримати через Монобанк').slice(0, 120),
    homeActionInterviewsTitle: String(db.homeActionInterviewsTitle || 'Розмови').slice(0, 120),
    homeRepeaters: normalizeHomeRepeatersConfig(db.homeRepeaters),
    proseAuthDiscountPercent: Math.max(0, Math.min(90, Math.round(Number(db.proseAuthDiscountPercent) || 0))),
    proseTelegramDiscountPercent: Math.max(0, Math.min(90, Math.round(Number(db.proseTelegramDiscountPercent ?? 50) || 0))),
    telegramChannelId: String(db.telegramChannelId || '').trim().slice(0, 200),
    storeAuthDiscountPercent: 0,
    proseTags: (db.proseTags || []).slice(0, 50).map((t) => ({
      id: String(t.id || ''),
      label: String(t.label || ''),
      color: String(t.color || 'sage'),
    })),
  };

  writes.push({
    update: {
      name: docName('siteConfig', 'main'),
      fields: toFsFields({
        ...baseSiteConfigFields,
        monobankModalTitle: String(db.monobankModalTitle || 'Підтримати через Монобанк').slice(0, 120),
        monobankModalSubtitle: String(db.monobankModalSubtitle ?? '').slice(0, 300),
        monobankCardLabel: String(db.monobankCardLabel ?? '').slice(0, 80),
        monobankModalText: String(db.monobankModalText || '').slice(0, 1500),
        monobankEmptyText: String(db.monobankEmptyText ?? '').slice(0, 1000),
      }),
    },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
  });

  // 2. Poems
  const poemIds = new Set<string>();
  db.poems.forEach((poem, idx) => {
    const id = sanitizeId(poem.id);
    if (!id) return;
    poemIds.add(id);
    writes.push({
      update: {
        name: docName('poems', id),
        fields: toFsFields({
          id,
          title: String(poem.title || 'Без назви').slice(0, 200),
          cycle: String(poem.cycle || '').slice(0, 160),
          year: Math.max(1900, Math.min(2200, Math.round(Number(poem.year) || 2026))),
          excerpt: String(poem.excerpt || '').slice(0, 1000),
          content: String(poem.content || '').slice(0, 50000),
          note: String(poem.note || '').slice(0, 1000),
          ...(poem.fontSize ? { fontSize: poem.fontSize } : {}),
          ...(poem.textAlign ? { textAlign: poem.textAlign } : {}),
          ...(poem.lineSpacing ? { lineSpacing: poem.lineSpacing } : {}),
          ...(poem.textColor ? { textColor: poem.textColor } : {}),
          ...(poem.backgroundColor ? { backgroundColor: poem.backgroundColor } : {}),
          ...(poem.imageUrl ? { imageUrl: String(poem.imageUrl).slice(0, 1000) } : {}),
          ...(poem.imageUrl && poem.imagePalette
            ? {
                imagePalette: {
                  background: String(poem.imagePalette.background).slice(0, 32),
                  ...(poem.imagePalette.secondaryBackground
                    ? { secondaryBackground: String(poem.imagePalette.secondaryBackground).slice(0, 32) }
                    : {}),
                  text: String(poem.imagePalette.text).slice(0, 32),
                  ...(typeof poem.imagePalette.isDark === 'boolean'
                    ? { isDark: poem.imagePalette.isDark }
                    : {}),
                },
              }
            : {}),
          ...serializePoemSoundCloudFields(poem.soundcloudTrack, poem.soundcloudTracks),
          ...(poem.isCommunity ? { isCommunity: true } : {}),
          ...(poem.authorUid && sanitizeId(poem.authorUid) ? { authorUid: sanitizeId(poem.authorUid)! } : {}),
          ...(poem.authorName ? { authorName: String(poem.authorName).slice(0, 80) } : {}),
          ...(poem.authorPhotoUrl ? { authorPhotoUrl: String(poem.authorPhotoUrl).slice(0, 500) } : {}),
          ...(poem.submissionId && sanitizeId(poem.submissionId) ? { submissionId: sanitizeId(poem.submissionId)! } : {}),
          ...(poem.workStatus === 'completed' || poem.workStatus === 'in_progress'
            ? { workStatus: poem.workStatus }
            : {}),
          order: Math.min(100000, idx),
        }),
      },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    });
  });

  // 3. Prose & ProsePrivate
  const proseIds = new Set<string>();
  const privateProseIds = new Set<string>();
  db.prose.forEach((work, idx) => {
    const id = sanitizeId(work.id);
    if (!id) return;
    proseIds.add(id);
    const accessMode = normalizeProseAccessMode(work.accessMode, work);
    const isPublic = accessMode === 'public';
    writes.push({
      update: {
        name: docName('prose', id),
        fields: toFsFields({
          id,
          title: String(work.title || 'Без назви').slice(0, 240),
          genre: String(work.genre || 'Оповідання').slice(0, 120),
          pages: Math.max(1, Math.min(50000, Math.round(Number(work.pages) || 1))),
          publishedAt: String(work.publishedAt || '').slice(0, 120),
          slogan: String(work.slogan || '').slice(0, 500),
          excerpt: String(work.excerpt || '').slice(0, 2000),
          content: isPublic ? String(work.content || '').slice(0, 400000) : '',
          chapters: isPublic ? normalizeChapters(work.chapters) : [],
          tagIds: (work.tagIds || []).slice(0, 30).map((t) => String(t)),
          status: normalizeProseStatus(work.status),
          accessMode,
          requiresAuth: accessMode === 'authorized',
          isPaid: accessMode === 'paid',
          priceUah: Math.max(0, Math.min(1000000, Math.round(Number(work.priceUah) || 0))),
          moodboardUrls: (work.moodboardUrls || []).slice(0, 20).map((u) => String(u).slice(0, 500)),
          ...(work.isCommunity ? { isCommunity: true } : {}),
          ...(work.authorUid && sanitizeId(work.authorUid) ? { authorUid: sanitizeId(work.authorUid)! } : {}),
          ...(work.authorName ? { authorName: String(work.authorName).slice(0, 80) } : {}),
          ...(work.authorPhotoUrl ? { authorPhotoUrl: String(work.authorPhotoUrl).slice(0, 500) } : {}),
          ...(work.submissionId && sanitizeId(work.submissionId) ? { submissionId: sanitizeId(work.submissionId)! } : {}),
          order: Math.min(100000, idx),
        }),
      },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    });

    if (!isPublic) {
      privateProseIds.add(id);
      writes.push({
        update: {
          name: docName('prosePrivate', id),
          fields: toFsFields({
            id,
            accessMode,
            content: String(work.content || '').slice(0, 400000),
            chapters: normalizeChapters(work.chapters),
            pdfStorageKey: String(work.pdfStorageKey || '').slice(0, 250),
            pdfFileName: String(work.pdfFileName || '').slice(0, 250),
            pdfFileSize: Math.max(0, Math.min(200000000, Math.round(Number(work.pdfFileSize) || 0))),
          }),
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      });
    }
  });

  // 4. Blog Posts
  const blogIds = new Set<string>();
  db.blog.forEach((post, idx) => {
    const id = sanitizeId(post.id);
    if (!id) return;
    blogIds.add(id);
    writes.push({
      update: {
        name: docName('blogPosts', id),
        fields: toFsFields({
          id,
          title: String(post.title || 'Без назви').slice(0, 240),
          category: String(post.category || '').slice(0, 120),
          publishedAt: String(post.publishedAt || '').slice(0, 120),
          readingMinutes: Math.max(1, Math.min(500, Math.round(Number(post.readingMinutes) || 2))),
          coverImage: String(post.coverImage || '').slice(0, 1000),
          excerpt: String(post.excerpt || '').slice(0, 2000),
          content: String(post.content || '').slice(0, 200000),
          order: Math.min(100000, idx),
        }),
      },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    });
  });

  // 5. Store Products & ProductSecrets
  const productIds = new Set<string>();
  const productSecretIds = new Set<string>();
  db.products.forEach((prod, idx) => {
    const id = sanitizeId(prod.id);
    if (!id) return;
    productIds.add(id);
    writes.push({
      update: {
        name: docName('products', id),
        fields: toFsFields({
          id,
          type: prod.type,
          title: String(prod.title || 'Видання').slice(0, 240),
          subtitle: String(prod.subtitle || '').slice(0, 300),
          priceUah: Math.max(0, Math.min(1000000, Math.round(Number(prod.priceUah) || 0))),
          discountPercent: Math.max(0, Math.min(90, Math.round(Number(prod.discountPercent) || 0))),
          promoActive: Boolean(prod.promoActive),
          promoLabel: String(prod.promoLabel || '').slice(0, 120),
          coverImage: String(prod.coverImage || '').slice(0, 1000),
          description: String(prod.description || '').slice(0, 10000),
          sampleExcerpt: String(prod.sampleExcerpt || '').slice(0, 10000),
          formats: String(prod.formats || '').slice(0, 200),
          pages: Math.max(0, Math.min(50000, Math.round(Number(prod.pages) || 0))),
          year: Math.max(0, Math.min(2200, Math.round(Number(prod.year) || 0))),
          binding: String(prod.binding || '').slice(0, 200),
          dimensions: String(prod.dimensions || '').slice(0, 200),
          material: String(prod.material || '').slice(0, 200),
          progressLabel: String(prod.progressLabel || '').slice(0, 200),
          wordCount: Math.max(0, Math.min(5000000, Math.round(Number(prod.wordCount) || 0))),
          lastUpdated: String(prod.lastUpdated || '').slice(0, 120),
          order: Math.min(100000, idx),
        }),
      },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    });

    if (prod.gdocGuestUrl || prod.ebookFullText || prod.ebookFileName) {
      productSecretIds.add(id);
      writes.push({
        update: {
          name: docName('productSecrets', id),
          fields: toFsFields({
            id,
            gdocGuestUrl: String(prod.gdocGuestUrl || '').slice(0, 1000),
            ebookFullText: String(prod.ebookFullText || '').slice(0, 400000),
            ebookFileName: String(prod.ebookFileName || '').slice(0, 250),
            ebookMimeType: String(prod.ebookMimeType || '').slice(0, 150),
            ebookFileSize: Math.max(0, Math.min(200000000, Math.round(Number(prod.ebookFileSize) || 0))),
          }),
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      });
    }
  });

  // 6. Radio Tracks (preserve createdByUid & createdAt on existing docs!)
  const existingRadioRes = await fetchFsList('radioTracks', adminToken);
  const existingRadioIds = new Set<string>();
  if (existingRadioRes.ok) {
    for (const doc of existingRadioRes.docs) {
      const { id } = fromFsDocument(doc);
      if (id) existingRadioIds.add(id);
    }
  }

  const radioIds = new Set<string>();
  db.radioTracks.forEach((track, idx) => {
    const id = sanitizeId(track.id);
    if (!id) return;
    const scUrl = /^https?:\/\/.+/.test(track.soundcloudUrl || '') ? track.soundcloudUrl.slice(0, 500) : '';
    if (!scUrl) return;
    radioIds.add(id);
    const targetUrl =
      track.embedTargetUrl && /^https?:\/\/.+/.test(track.embedTargetUrl)
        ? track.embedTargetUrl.slice(0, 500)
        : scUrl;

    if (existingRadioIds.has(id)) {
      writes.push({
        update: {
          name: docName('radioTracks', id),
          fields: toFsFields({
            title: String(track.title || 'Трек').slice(0, 200),
            artist: String(track.artist || 'SoundCloud').slice(0, 140),
            soundcloudUrl: scUrl,
            embedTargetUrl: targetUrl,
            artworkUrl: String(track.artworkUrl || '').slice(0, 500),
            station: track.station === 'electronic' ? 'electronic' : 'indie',
            order: Math.min(100000, idx),
            visibility: 'authenticated',
          }),
        },
        updateMask: {
          fieldPaths: [
            'title',
            'artist',
            'soundcloudUrl',
            'embedTargetUrl',
            'artworkUrl',
            'station',
            'order',
            'visibility',
          ],
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      });
    } else {
      writes.push({
        update: {
          name: docName('radioTracks', id),
          fields: toFsFields({
            id,
            title: String(track.title || 'Трек').slice(0, 200),
            artist: String(track.artist || 'SoundCloud').slice(0, 140),
            soundcloudUrl: scUrl,
            embedTargetUrl: targetUrl,
            artworkUrl: String(track.artworkUrl || '').slice(0, 500),
            station: track.station === 'electronic' ? 'electronic' : 'indie',
            order: Math.min(100000, idx),
            visibility: 'authenticated',
            createdByUid: adminUid,
          }),
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      });
    }
  });


  // 8. Weekly Highlights (immutable weekly snapshots for community poem & prose)
  for (const wPoem of db.weeklyPoems || []) {
    const id = sanitizeId(wPoem.id || `poem_${wPoem.weekKey}`);
    if (!id || !/^\d{4}-W\d{2}$/.test(wPoem.weekKey || '')) continue;
    const scFields = serializePoemSoundCloudFields(wPoem.soundcloudTrack, wPoem.soundcloudTracks);
    const hasImg = typeof wPoem.imageUrl === 'string' && wPoem.imageUrl.trim().length > 0;
    const palette =
      hasImg && wPoem.imagePalette?.background && wPoem.imagePalette?.text
        ? {
            background: wPoem.imagePalette.background.slice(0, 32),
            ...(wPoem.imagePalette.secondaryBackground
              ? { secondaryBackground: wPoem.imagePalette.secondaryBackground.slice(0, 32) }
              : {}),
            text: wPoem.imagePalette.text.slice(0, 32),
            ...(typeof wPoem.imagePalette.isDark === 'boolean'
              ? { isDark: wPoem.imagePalette.isDark }
              : {}),
          }
        : undefined;
    writes.push({
      update: {
        name: docName('weeklyHighlights', id),
        fields: toFsFields({
          id,
          targetType: 'poem',
          weekKey: wPoem.weekKey,
          periodStart: wPoem.periodStart,
          periodEnd: wPoem.periodEnd,
          periodLabel: String(wPoem.periodLabel || wPoem.weekKey).slice(0, 120),
          selectedAt: String(wPoem.selectedAt || new Date().toISOString()).slice(0, 64),
          ...(wPoem.sourcePoemId && sanitizeId(wPoem.sourcePoemId) ? { sourcePoemId: sanitizeId(wPoem.sourcePoemId) } : {}),
          ...(wPoem.sourceSubmissionId && sanitizeId(wPoem.sourceSubmissionId) ? { sourceSubmissionId: sanitizeId(wPoem.sourceSubmissionId) } : {}),
          ...(wPoem.authorUid && sanitizeId(wPoem.authorUid) ? { authorUid: sanitizeId(wPoem.authorUid) } : {}),
          authorName: String(wPoem.authorName || 'Читач').slice(0, 80),
          ...(wPoem.authorPhotoUrl ? { authorPhotoUrl: String(wPoem.authorPhotoUrl).slice(0, 500) } : {}),
          title: String(wPoem.title || 'Вірш').slice(0, 240),
          content: String(wPoem.content || '').slice(0, 400000),
          ...(wPoem.cycle ? { cycle: String(wPoem.cycle).slice(0, 160) } : {}),
          ...(typeof wPoem.year === 'number' ? { year: Math.max(1900, Math.min(2200, Math.round(wPoem.year))) } : {}),
          ...(wPoem.note ? { note: String(wPoem.note).slice(0, 1000) } : {}),
          ...(wPoem.fontSize ? { fontSize: String(wPoem.fontSize).slice(0, 10) } : {}),
          ...(wPoem.textAlign ? { textAlign: String(wPoem.textAlign).slice(0, 10) } : {}),
          ...(wPoem.lineSpacing ? { lineSpacing: String(wPoem.lineSpacing).slice(0, 10) } : {}),
          ...(wPoem.textColor ? { textColor: String(wPoem.textColor).slice(0, 32) } : {}),
          ...(wPoem.backgroundColor ? { backgroundColor: String(wPoem.backgroundColor).slice(0, 32) } : {}),
          ...(hasImg ? { imageUrl: String(wPoem.imageUrl).trim().slice(0, 1000) } : {}),
          ...(palette ? { imagePalette: palette } : {}),
          ...scFields,
          ratingAverage: Math.max(0, Math.min(5, Number(wPoem.ratingAverage) || 0)),
          ratingCount: Math.max(0, Math.round(Number(wPoem.ratingCount) || 0)),
        }),
      },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    });
  }

  for (const wProse of db.weeklyProse || []) {
    const id = sanitizeId(wProse.id || `prose_${wProse.weekKey}`);
    if (!id || !/^\d{4}-W\d{2}$/.test(wProse.weekKey || '')) continue;
    const cleanChapters = (wProse.chapters || []).slice(0, 200).map((ch) => ({
      id: String(ch.id || ''),
      title: String(ch.title || '').slice(0, 240),
      content: String(ch.content || '').slice(0, 200000),
      publishedAt: String(ch.publishedAt || '').slice(0, 120),
    }));
    const cleanMoodboard = (wProse.moodboardUrls || [])
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
      .slice(0, 20);
    writes.push({
      update: {
        name: docName('weeklyHighlights', id),
        fields: toFsFields({
          id,
          targetType: 'prose',
          weekKey: wProse.weekKey,
          periodStart: wProse.periodStart,
          periodEnd: wProse.periodEnd,
          periodLabel: String(wProse.periodLabel || wProse.weekKey).slice(0, 120),
          selectedAt: String(wProse.selectedAt || new Date().toISOString()).slice(0, 64),
          ...(wProse.sourceProseId && sanitizeId(wProse.sourceProseId) ? { sourceProseId: sanitizeId(wProse.sourceProseId) } : {}),
          ...(wProse.sourceSubmissionId && sanitizeId(wProse.sourceSubmissionId) ? { sourceSubmissionId: sanitizeId(wProse.sourceSubmissionId) } : {}),
          ...(wProse.authorUid && sanitizeId(wProse.authorUid) ? { authorUid: sanitizeId(wProse.authorUid) } : {}),
          authorName: String(wProse.authorName || 'Читач').slice(0, 80),
          ...(wProse.authorPhotoUrl ? { authorPhotoUrl: String(wProse.authorPhotoUrl).slice(0, 500) } : {}),
          title: String(wProse.title || 'Проза').slice(0, 240),
          content: String(wProse.content || '').slice(0, 400000),
          genre: String(wProse.genre || 'Оповідання').slice(0, 120),
          pages: Math.max(1, Math.min(50000, Math.round(Number(wProse.pages) || 1))),
          ...(typeof wProse.totalWords === 'number'
            ? { totalWords: Math.max(0, Math.min(500000, Math.round(wProse.totalWords))) }
            : {}),
          ...(wProse.slogan ? { slogan: String(wProse.slogan).slice(0, 500) } : {}),
          ...(cleanChapters.length > 0 ? { chapters: cleanChapters } : {}),
          ...(cleanMoodboard.length > 0 ? { moodboardUrls: cleanMoodboard } : {}),
          ...(wProse.publishedAt ? { publishedAt: String(wProse.publishedAt).slice(0, 120) } : {}),
          ratingAverage: Math.max(0, Math.min(5, Number(wProse.ratingAverage) || 0)),
          ratingCount: Math.max(0, Math.round(Number(wProse.ratingCount) || 0)),
        }),
      },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    });
  }

  // 9. Weekly Music Selections beside Radio
  const existingWeeklyMusicRes = await fetchFsList('weeklyMusicSelections', adminToken);
  const existingWeeklyMusicIds = new Set<string>();
  if (existingWeeklyMusicRes.ok) {
    for (const doc of existingWeeklyMusicRes.docs) {
      const { id } = fromFsDocument(doc);
      if (id) existingWeeklyMusicIds.add(id);
    }
  }

  const weeklyMusicIds = new Set<string>();
  for (const sel of db.weeklyMusicSelections || []) {
    const id = sanitizeId(sel.id);
    if (!id) continue;
    if (
      !/^\d{4}-W\d{2}$/.test(sel.weekKey || '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(sel.periodStart || '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(sel.periodEnd || '') ||
      !sel.periodLabel
    ) {
      continue;
    }
    weeklyMusicIds.add(id);
    const cleanText = typeof sel.text === 'string' ? sel.text.trim().slice(0, 5000) : '';
    const cleanPhotos = (sel.photos || [])
      .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      .map((u) => u.trim().slice(0, 1000))
      .slice(0, 12);
    const cleanTracks = (sel.tracks || [])
      .map((t) => parsePoemSoundCloudTrack(t))
      .filter((t): t is WeeklyMusicTrack => Boolean(t))
      .slice(0, 50)
      .map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        soundcloudUrl: t.soundcloudUrl,
        embedTargetUrl: t.embedTargetUrl,
        ...(t.artworkUrl ? { artworkUrl: t.artworkUrl } : {}),
      }));

    if (existingWeeklyMusicIds.has(id)) {
      writes.push({
        update: {
          name: docName('weeklyMusicSelections', id),
          fields: toFsFields({
            weekKey: sel.weekKey,
            periodStart: sel.periodStart,
            periodEnd: sel.periodEnd,
            periodLabel: String(sel.periodLabel).slice(0, 120),
            ...(cleanText ? { text: cleanText } : {}),
            photos: cleanPhotos,
            tracks: cleanTracks,
          }),
        },
        updateMask: {
          fieldPaths: ['weekKey', 'periodStart', 'periodEnd', 'periodLabel', 'text', 'photos', 'tracks'],
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      });
    } else {
      writes.push({
        update: {
          name: docName('weeklyMusicSelections', id),
          fields: toFsFields({
            id,
            weekKey: sel.weekKey,
            periodStart: sel.periodStart,
            periodEnd: sel.periodEnd,
            periodLabel: String(sel.periodLabel).slice(0, 120),
            ...(cleanText ? { text: cleanText } : {}),
            photos: cleanPhotos,
            tracks: cleanTracks,
          }),
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      });
    }
  }

  // Delete orphaned documents in Firestore that were removed by admin
  const [exPoems, exProse, exProsePriv, exBlog, exProducts, exProdSec] = await Promise.all([
    fetchFsList('poems', adminToken),
    fetchFsList('prose', adminToken),
    fetchFsList('prosePrivate', adminToken),
    fetchFsList('blogPosts', adminToken),
    fetchFsList('products', adminToken),
    fetchFsList('productSecrets', adminToken),
  ]);

  const queueDeletes = (res: { ok: boolean; docs: FsDocument[] }, collection: string, keep: Set<string>) => {
    if (!res.ok) return;
    for (const doc of res.docs) {
      const { id } = fromFsDocument(doc);
      if (id && !keep.has(id)) {
        writes.push({ delete: docName(collection, id) });
      }
    }
  };

  queueDeletes(exPoems, 'poems', poemIds);
  queueDeletes(exProse, 'prose', proseIds);
  queueDeletes(exProsePriv, 'prosePrivate', privateProseIds);
  queueDeletes(exBlog, 'blogPosts', blogIds);
  queueDeletes(exProducts, 'products', productIds);
  queueDeletes(exProdSec, 'productSecrets', productSecretIds);
  queueDeletes(existingRadioRes, 'radioTracks', radioIds);
  queueDeletes(existingWeeklyMusicRes, 'weeklyMusicSelections', weeklyMusicIds);

  let commitRes = await commitWritesDetailed(writes, adminToken);
  if (!commitRes.ok && commitRes.status === 403 && writes.length > 0) {
    const withoutOptionalCollections = writes.filter(
      (w) =>
        !(w.update?.name && w.update.name.includes('/weeklyHighlights/')) &&
        !(w.delete && w.delete.includes('/weeklyHighlights/'))
    );
    const fallbackWrites = [...withoutOptionalCollections];
    if (fallbackWrites[0]?.update?.name.endsWith('/siteConfig/main')) {
      fallbackWrites[0] = {
        update: {
          name: docName('siteConfig', 'main'),
          fields: toFsFields(baseSiteConfigFields),
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      };
    }
    commitRes = await commitWritesDetailed(fallbackWrites, adminToken);
  }
  if (commitRes.ok) {
    cloudSyncState.cloudConfigExists = true;
    cloudSyncState.publicHydrated = true;
    cloudSyncState.radioHydrated = true;
    cloudSyncState.adminSecretsHydrated = true;
  }
  return commitRes.ok;
}

export async function deleteRadioTrackInFirestore(
  trackId: string,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const trimmedId = trackId.trim();
  if (!urls || !adminToken || !trimmedId) return false;

  const deleteTargets = new Set<string>();
  const safeId = sanitizeId(trimmedId);
  if (safeId) {
    deleteTargets.add(`${urls.docRoot}/radioTracks/${safeId}`);
  }

  const listRes = await fetchFsList('radioTracks', adminToken);
  if (listRes.ok) {
    for (const doc of listRes.docs) {
      const { id: docId, data } = fromFsDocument(doc);
      const fieldId = typeof data.id === 'string' ? data.id.trim() : '';
      if (docId === trimmedId || fieldId === trimmedId) {
        deleteTargets.add(doc.name);
      }
    }
  }

  if (deleteTargets.size === 0) return false;
  const writes: CommitWrite[] = Array.from(deleteTargets).map((name) => ({ delete: name }));
  return commitWrites(writes, adminToken);
}

export async function syncSingleWeeklyMusicSelectionInFirestore(
  selection: WeeklyMusicSelection,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(selection.id);
  if (!urls || !adminToken || !safeId) return false;

  const docPath = `weeklyMusicSelections/${safeId}`;
  const fullName = `${urls.docRoot}/${docPath}`;
  const existing = await fetchFsGet(docPath, adminToken);

  const cleanText = typeof selection.text === 'string' ? selection.text.trim().slice(0, 5000) : '';
  const cleanPhotos = (selection.photos || [])
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .map((u) => u.trim().slice(0, 1000))
    .slice(0, 12);
  const cleanTracks = (selection.tracks || [])
    .map((t) => parsePoemSoundCloudTrack(t))
    .filter((t): t is WeeklyMusicTrack => Boolean(t))
    .slice(0, 50)
    .map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      soundcloudUrl: t.soundcloudUrl,
      embedTargetUrl: t.embedTargetUrl,
      ...(t.artworkUrl ? { artworkUrl: t.artworkUrl } : {}),
    }));

  if (existing.doc) {
    return commitWrites(
      [
        {
          update: {
            name: fullName,
            fields: toFsFields({
              weekKey: selection.weekKey,
              periodStart: selection.periodStart,
              periodEnd: selection.periodEnd,
              periodLabel: String(selection.periodLabel).slice(0, 120),
              ...(cleanText ? { text: cleanText } : {}),
              photos: cleanPhotos,
              tracks: cleanTracks,
            }),
          },
          updateMask: {
            fieldPaths: ['weekKey', 'periodStart', 'periodEnd', 'periodLabel', 'text', 'photos', 'tracks'],
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ],
      adminToken
    );
  }

  return commitWrites(
    [
      {
        update: {
          name: fullName,
          fields: toFsFields({
            id: safeId,
            weekKey: selection.weekKey,
            periodStart: selection.periodStart,
            periodEnd: selection.periodEnd,
            periodLabel: String(selection.periodLabel).slice(0, 120),
            ...(cleanText ? { text: cleanText } : {}),
            photos: cleanPhotos,
            tracks: cleanTracks,
          }),
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      },
    ],
    adminToken
  );
}

export async function deleteWeeklyMusicSelectionInFirestore(
  selectionId: string,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(selectionId.trim());
  if (!urls || !adminToken || !safeId) return false;
  return commitWrites([{ delete: `${urls.docRoot}/weeklyMusicSelections/${safeId}` }], adminToken);
}

function toMediaAssetId(filename: string): string | null {
  const clean = path.basename(filename).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return VALID_ID_RE.test(clean) ? clean : null;
}

export async function saveMediaAssetToFirestore(
  filename: string,
  mimeType: string,
  buffer: Buffer,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const assetId = toMediaAssetId(filename);
  if (!urls || !assetId || !adminToken) return false;
  const dataBase64 = buffer.toString('base64');
  if (dataBase64.length > 900000) {
    return false;
  }
  return commitWrites(
    [
      {
        update: {
          name: `${urls.docRoot}/mediaAssets/${assetId}`,
          fields: toFsFields({
            id: assetId,
            filename: path.basename(filename).slice(0, 128),
            mimeType: mimeType.slice(0, 80),
            dataBase64,
          }),
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ],
    adminToken
  );
}

export async function loadMediaAssetFromFirestore(
  filename: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const assetId = toMediaAssetId(filename);
  if (!assetId) return null;
  const resp = await fetchFsGet(`mediaAssets/${assetId}`);
  if (!resp.doc) return null;
  const { data } = fromFsDocument(resp.doc);
  if (typeof data.dataBase64 !== 'string' || !data.dataBase64) return null;
  const mimeType = typeof data.mimeType === 'string' && data.mimeType ? data.mimeType : 'image/png';
  return {
    buffer: Buffer.from(data.dataBase64, 'base64'),
    mimeType,
  };
}

export async function syncAdminTelegramTokenToFirestore(
  botToken: string,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  if (!urls || !adminToken) return false;
  const cleanToken = botToken.trim().slice(0, 200);
  return commitWrites(
    [
      {
        update: {
          name: `${urls.docRoot}/adminSecrets/telegram`,
          fields: toFsFields({
            id: 'telegram',
            telegramBotToken: cleanToken,
          }),
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ],
    adminToken
  );
}

export async function hydrateGuestLikesFromFirestore(
  firebaseUid: string,
  idToken: string
): Promise<{
  found: boolean;
  hasLikedField: boolean;
  likedPoemIds: string[];
  hasRadioLikedField: boolean;
  likedRadioTrackIds: string[];
  totalTimeSeconds?: number;
  purchasesCount?: number;
  donorChatText?: string;
  updatedAt?: string;
}> {
  const safeUid = sanitizeId(firebaseUid);
  if (!safeUid || !idToken) {
    return {
      found: false,
      hasLikedField: false,
      likedPoemIds: [],
      hasRadioLikedField: false,
      likedRadioTrackIds: [],
    };
  }
  try {
    const [userResp, profileResp] = await Promise.all([
      fetchFsGet(`users/${safeUid}`, idToken),
      fetchFsGet(`publicProfiles/${safeUid}`, idToken),
    ]);
    if (!userResp.doc && !profileResp.doc) {
      return {
        found: false,
        hasLikedField: false,
        likedPoemIds: [],
        hasRadioLikedField: false,
        likedRadioTrackIds: [],
      };
    }
    const userData = userResp.doc ? fromFsDocument(userResp.doc).data : {};
    const profileData = profileResp.doc ? fromFsDocument(profileResp.doc).data : {};

    const parseStrList = (raw: unknown): string[] =>
      Array.isArray(raw)
        ? Array.from(
            new Set(
              raw
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
                .map((id) => id.trim())
            )
          ).slice(0, 500)
        : [];

    const userHasLiked = Array.isArray(userData.likedPoemIds);
    const profHasLiked = Array.isArray(profileData.likedPoemIds);
    const userUpdatedMs =
      typeof userData.updatedAt === 'string' ? Date.parse(userData.updatedAt) || 0 : 0;
    const profUpdatedMs =
      typeof profileData.updatedAt === 'string' ? Date.parse(profileData.updatedAt) || 0 : 0;

    const likedPoemIds =
      profHasLiked && (!userHasLiked || profUpdatedMs > userUpdatedMs)
        ? parseStrList(profileData.likedPoemIds)
        : userHasLiked
          ? parseStrList(userData.likedPoemIds)
          : parseStrList(profileData.likedPoemIds);

    const userHasRadio = Array.isArray(userData.likedRadioTrackIds);
    const profHasRadio = Array.isArray(profileData.likedRadioTrackIds);
    const likedRadioTrackIds =
      profHasRadio && (!userHasRadio || profUpdatedMs > userUpdatedMs)
        ? parseStrList(profileData.likedRadioTrackIds)
        : userHasRadio
          ? parseStrList(userData.likedRadioTrackIds)
          : parseStrList(profileData.likedRadioTrackIds);

    const updatedAt =
      profUpdatedMs >= userUpdatedMs && typeof profileData.updatedAt === 'string'
        ? profileData.updatedAt
        : typeof userData.updatedAt === 'string'
          ? userData.updatedAt
          : typeof profileData.updatedAt === 'string'
            ? profileData.updatedAt
            : undefined;

    return {
      found: true,
      hasLikedField: userHasLiked || profHasLiked,
      likedPoemIds,
      hasRadioLikedField: userHasRadio || profHasRadio,
      likedRadioTrackIds,
      ...(typeof profileData.totalTimeSeconds === 'number'
        ? { totalTimeSeconds: Math.max(0, Math.round(profileData.totalTimeSeconds)) }
        : {}),
      ...(typeof profileData.purchasesCount === 'number'
        ? { purchasesCount: Math.max(0, Math.round(profileData.purchasesCount)) }
        : {}),
      ...(typeof profileData.donorChatText === 'string' && profileData.donorChatText.trim()
        ? { donorChatText: profileData.donorChatText.trim().slice(0, 80) }
        : {}),
      updatedAt,
    };
  } catch {
    return {
      found: false,
      hasLikedField: false,
      likedPoemIds: [],
      hasRadioLikedField: false,
      likedRadioTrackIds: [],
    };
  }
}

let loggedUsersRulePermissionHint = false;

export async function syncPublicUserProfileToFirestore(
  params: {
    firebaseUid: string;
    guestUid?: string;
    displayName: string;
    photoUrl?: string;
    likedPoemIds?: string[];
    likedRadioTrackIds?: string[];
    totalTimeSeconds?: number;
    purchasesCount?: number;
    donorChatText?: string;
  },
  idToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeUid = sanitizeId(params.firebaseUid);
  if (!urls || !safeUid || !idToken) return false;

  const cleanName = (params.displayName || 'Читач').trim().slice(0, 80) || 'Читач';
  const cleanGuestUid = params.guestUid ? sanitizeId(params.guestUid) : null;
  const cleanPhoto =
    typeof params.photoUrl === 'string' && params.photoUrl.trim()
      ? params.photoUrl.trim().slice(0, 500)
      : undefined;
  const cleanLikes = Array.isArray(params.likedPoemIds)
    ? Array.from(
        new Set(
          params.likedPoemIds
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .map((id) => id.trim())
        )
      ).slice(0, 500)
    : undefined;
  const cleanRadioLikes = Array.isArray(params.likedRadioTrackIds)
    ? Array.from(
        new Set(
          params.likedRadioTrackIds
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .map((id) => id.trim())
        )
      ).slice(0, 500)
    : undefined;

  try {
    const existingResp = await fetchFsGet(`publicProfiles/${safeUid}`, idToken);
    if (existingResp.status !== 200 && existingResp.status !== 404) {
      return false;
    }

    const docPath = `${urls.docRoot}/publicProfiles/${safeUid}`;
    const existingData = existingResp.doc ? fromFsDocument(existingResp.doc).data : null;
    const rawCreatedTs =
      existingResp.doc?.fields?.createdAt && 'timestampValue' in existingResp.doc.fields.createdAt
        ? existingResp.doc.fields.createdAt.timestampValue
        : null;
    const parsedCreatedAt = rawCreatedTs ? new Date(rawCreatedTs) : null;
    const preserveCreatedAt = Boolean(
      existingData &&
        existingData.uid === safeUid &&
        parsedCreatedAt &&
        !Number.isNaN(parsedCreatedAt.getTime())
    );

    const existingTime =
      existingData && typeof existingData.totalTimeSeconds === 'number'
        ? Math.max(0, Math.round(existingData.totalTimeSeconds))
        : 0;
    const existingPurchases =
      existingData && typeof existingData.purchasesCount === 'number'
        ? Math.max(0, Math.round(existingData.purchasesCount))
        : 0;

    const mergedTime = Math.max(existingTime, Math.max(0, Math.round(params.totalTimeSeconds || 0)));
    const mergedPurchases = Math.max(
      existingPurchases,
      Math.max(0, Math.round(params.purchasesCount || 0))
    );

    const fieldsObj: Record<string, unknown> = {
      uid: safeUid,
      ...(cleanGuestUid ? { guestUid: cleanGuestUid } : {}),
      displayName: cleanName,
      ...(cleanPhoto ? { photoUrl: cleanPhoto } : {}),
      ...(cleanLikes ? { likedPoemIds: cleanLikes } : existingData?.likedPoemIds ? { likedPoemIds: existingData.likedPoemIds } : {}),
      ...(cleanRadioLikes
        ? { likedRadioTrackIds: cleanRadioLikes }
        : existingData?.likedRadioTrackIds
          ? { likedRadioTrackIds: existingData.likedRadioTrackIds }
          : {}),
      totalTimeSeconds: mergedTime,
      purchasesCount: mergedPurchases,
      ...(typeof params.donorChatText === 'string' && params.donorChatText.trim()
        ? { donorChatText: params.donorChatText.trim().slice(0, 80) }
        : {}),
      lastSeenAt: new Date().toISOString(),
    };

    let write: CommitWrite;
    if (preserveCreatedAt && parsedCreatedAt) {
      const updateFields: Record<string, unknown> = { ...fieldsObj };
      delete updateFields.uid;
      write = {
        update: {
          name: docPath,
          fields: toFsFields(updateFields),
        },
        updateMask: {
          fieldPaths: Object.keys(updateFields),
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      };
    } else {
      write = {
        update: {
          name: docPath,
          fields: toFsFields(fieldsObj),
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      };
    }

    const res = await commitWritesDetailed([write], idToken);
    return res.ok;
  } catch {
    return false;
  }
}

export async function syncGuestLikesToFirestore(
  params: {
    firebaseUid: string;
    email: string;
    displayName: string;
    likedPoemIds: string[];
    likedRadioTrackIds?: string[];
    photoUrl?: string;
    guestUid?: string;
    totalTimeSeconds?: number;
    purchasesCount?: number;
    donorChatText?: string;
    syncPublicProfile?: boolean;
  },
  idToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeUid = sanitizeId(params.firebaseUid);
  if (!urls || !safeUid || !idToken) return false;

  const cleanEmail = (params.email || '').trim().slice(0, 254);
  const cleanName =
    (params.displayName || cleanEmail.split('@')[0] || 'Читач').trim().slice(0, 80) || 'Читач';
  const cleanLikes = Array.from(
    new Set(
      params.likedPoemIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
    )
  ).slice(0, 500);
  const cleanRadioLikes = Array.isArray(params.likedRadioTrackIds)
    ? Array.from(
        new Set(
          params.likedRadioTrackIds
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .map((id) => id.trim())
        )
      ).slice(0, 500)
    : undefined;

  let userOk = false;
  if (cleanEmail.length >= 3) {
    try {
      const existingResp = await fetchFsGet(`users/${safeUid}`, idToken);
      if (existingResp.status === 200 || existingResp.status === 404) {
        const docPath = `${urls.docRoot}/users/${safeUid}`;
        const buildUserWrite = (includeRadio: boolean): CommitWrite => {
          const extraRadio = includeRadio && cleanRadioLikes ? { likedRadioTrackIds: cleanRadioLikes } : {};
          if (existingResp.doc) {
            const rawFields = existingResp.doc.fields || {};
            const hasValidUid = Boolean(
              rawFields.uid && 'stringValue' in rawFields.uid && rawFields.uid.stringValue === safeUid
            );
            const createdAtTs =
              rawFields.createdAt && 'timestampValue' in rawFields.createdAt
                ? rawFields.createdAt.timestampValue
                : null;
            const allowedKeys = new Set([
              'uid',
              'email',
              'displayName',
              'likedPoemIds',
              ...(includeRadio ? ['likedRadioTrackIds'] : []),
              'createdAt',
              'updatedAt',
            ]);
            const hasOnlyAllowedKeys = Object.keys(rawFields).every((k) => allowedKeys.has(k));

            if (hasValidUid && createdAtTs && hasOnlyAllowedKeys) {
              const maskFields = [
                'displayName',
                'email',
                'likedPoemIds',
                ...(includeRadio && cleanRadioLikes ? ['likedRadioTrackIds'] : []),
              ];
              return {
                update: {
                  name: docPath,
                  fields: toFsFields({
                    displayName: cleanName,
                    email: cleanEmail,
                    likedPoemIds: cleanLikes,
                    ...extraRadio,
                  }),
                },
                updateMask: {
                  fieldPaths: maskFields,
                },
                updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              };
            }
            const parsedCreatedAt = createdAtTs ? new Date(createdAtTs) : null;
            const preserveCreatedAt = Boolean(
              parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime())
            );
            return {
              update: {
                name: docPath,
                fields: toFsFields({
                  uid: safeUid,
                  email: cleanEmail,
                  displayName: cleanName,
                  likedPoemIds: cleanLikes,
                  ...extraRadio,
                  ...(preserveCreatedAt && parsedCreatedAt ? { createdAt: parsedCreatedAt } : {}),
                }),
              },
              updateTransforms: [
                ...(!preserveCreatedAt
                  ? [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' as const }]
                  : []),
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' as const },
              ],
            };
          }
          return {
            update: {
              name: docPath,
              fields: toFsFields({
                uid: safeUid,
                email: cleanEmail,
                displayName: cleanName,
                likedPoemIds: cleanLikes,
                ...extraRadio,
              }),
            },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          };
        };

        let res = await commitWritesDetailed([buildUserWrite(Boolean(cleanRadioLikes))], idToken);
        if (!res.ok && res.status === 403 && cleanRadioLikes) {
          res = await commitWritesDetailed([buildUserWrite(false)], idToken);
        }
        if (!res.ok && res.status === 403 && !loggedUsersRulePermissionHint) {
          loggedUsersRulePermissionHint = true;
          console.warn(
            '[FirestoreSync] users/{uid} write returned 403 — deploy updated firestore.rules to persist user likes in Firestore.'
          );
        }
        userOk = res.ok;
      }
    } catch {
      userOk = false;
    }
  }

  let profileOk = false;
  if (params.syncPublicProfile !== false) {
    profileOk = await syncPublicUserProfileToFirestore(
      {
        firebaseUid: safeUid,
        guestUid: params.guestUid,
        displayName: cleanName,
        photoUrl: params.photoUrl,
        likedPoemIds: cleanLikes,
        likedRadioTrackIds: cleanRadioLikes,
        totalTimeSeconds: params.totalTimeSeconds,
        purchasesCount: params.purchasesCount,
        donorChatText: params.donorChatText,
      },
      idToken
    );
  }

  return userOk || profileOk;
}

const VALID_POEM_LIKE_ID_RE = /^[a-zA-Z0-9_-]{3,256}$/;

export async function hydratePoemLikesFromFirestore(): Promise<{
  ok: boolean;
  likesByPoemId: Map<string, Set<string>>;
  likesByUid: Map<string, Set<string>>;
}> {
  const likesByPoemId = new Map<string, Set<string>>();
  const likesByUid = new Map<string, Set<string>>();
  try {
    const res = await fetchFsList('poemLikes');
    if (!res.ok) {
      return { ok: false, likesByPoemId, likesByUid };
    }
    for (const doc of res.docs) {
      const { data } = fromFsDocument(doc);
      const poemId = typeof data.poemId === 'string' ? sanitizeId(data.poemId) : null;
      const userId = typeof data.userId === 'string' ? sanitizeId(data.userId) : null;
      if (!poemId || !userId) continue;

      let poemSet = likesByPoemId.get(poemId);
      if (!poemSet) {
        poemSet = new Set<string>();
        likesByPoemId.set(poemId, poemSet);
      }
      poemSet.add(userId);

      let uidSet = likesByUid.get(userId);
      if (!uidSet) {
        uidSet = new Set<string>();
        likesByUid.set(userId, uidSet);
      }
      uidSet.add(poemId);
    }
    return { ok: true, likesByPoemId, likesByUid };
  } catch {
    return { ok: false, likesByPoemId, likesByUid };
  }
}

export async function syncPoemLikeEntryToFirestore(
  params: {
    poemId: string;
    firebaseUid: string;
    liked: boolean;
  },
  idToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safePoemId = sanitizeId(params.poemId);
  const safeUid = sanitizeId(params.firebaseUid);
  if (!urls || !safePoemId || !safeUid || !idToken) return false;

  const likeId = `${safePoemId}__${safeUid}`;
  if (!VALID_POEM_LIKE_ID_RE.test(likeId)) return false;

  try {
    const existingResp = await fetchFsGet(`poemLikes/${likeId}`, idToken);
    if (existingResp.status !== 200 && existingResp.status !== 404) {
      return false;
    }

    const docPath = `${urls.docRoot}/poemLikes/${likeId}`;
    if (params.liked) {
      if (existingResp.doc) return true;
      const res = await commitWritesDetailed(
        [
          {
            update: {
              name: docPath,
              fields: toFsFields({
                id: likeId,
                poemId: safePoemId,
                userId: safeUid,
              }),
            },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
        idToken
      );
      return res.ok;
    }

    if (!existingResp.doc) return true;
    const res = await commitWritesDetailed([{ delete: docPath }], idToken);
    return res.ok;
  } catch {
    return false;
  }
}

export async function syncUserPoemLikeEntriesToFirestore(
  params: {
    firebaseUid: string;
    likedPoemIds: string[];
  },
  idToken: string
): Promise<void> {
  const safeUid = sanitizeId(params.firebaseUid);
  if (!safeUid || !idToken) return;
  const cleanIds = Array.from(
    new Set(params.likedPoemIds.map((id) => sanitizeId(id)).filter((id): id is string => Boolean(id)))
  ).slice(0, 100);
  await Promise.allSettled(
    cleanIds.map((poemId) =>
      syncPoemLikeEntryToFirestore({ poemId, firebaseUid: safeUid, liked: true }, idToken)
    )
  );
}

const VALID_COMPOSITE_ID_RE = /^[a-zA-Z0-9_-]{3,300}$/;

export async function syncReviewToFirestore(
  review: {
    id: string;
    targetType: 'poem' | 'prose' | 'product';
    targetId: string;
    firebaseUid: string;
    authorName: string;
    authorPhotoUrl?: string;
    rating: number | null;
    comment: string;
  },
  idToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(review.id);
  const safeTargetId = sanitizeId(review.targetId);
  const safeUid = sanitizeId(review.firebaseUid);
  if (!urls || !safeId || !safeTargetId || !safeUid || !idToken) return false;

  const docPath = `${urls.docRoot}/reviews/${safeId}`;
  const cleanName = (review.authorName || 'Читач').trim().slice(0, 80) || 'Читач';
  const cleanComment = (review.comment || '').trim().slice(0, 1500);
  const cleanRating =
    typeof review.rating === 'number' && Number.isFinite(review.rating)
      ? Math.max(0.1, Math.min(5, Math.round(review.rating * 10) / 10))
      : null;
  if (!cleanComment && cleanRating === null) return false;

  const cleanPhoto =
    typeof review.authorPhotoUrl === 'string' && review.authorPhotoUrl.trim()
      ? review.authorPhotoUrl.trim().slice(0, 500)
      : undefined;

  const buildWrite = (includePhoto: boolean): CommitWrite => ({
    update: {
      name: docPath,
      fields: toFsFields({
        id: safeId,
        targetType: review.targetType,
        targetId: safeTargetId,
        authorUid: safeUid,
        authorName: cleanName,
        ...(includePhoto && cleanPhoto ? { authorPhotoUrl: cleanPhoto } : {}),
        rating: cleanRating,
        comment: cleanComment,
      }),
    },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  });

  try {
    let res = await commitWritesDetailed([buildWrite(Boolean(cleanPhoto))], idToken);
    if (!res.ok && res.status === 403 && cleanPhoto && cleanRating !== null) {
      res = await commitWritesDetailed([buildWrite(false)], idToken);
    }
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteReviewsForTargetInFirestore(
  targetType: 'poem' | 'prose' | 'product',
  targetId: string,
  adminToken: string
): Promise<void> {
  const urls = getBaseUrls();
  const safeTargetId = sanitizeId(targetId);
  if (!urls || !safeTargetId || !adminToken) return;
  try {
    const [revRes, votesRes] = await Promise.all([
      fetchFsList('reviews', adminToken),
      fetchFsList('workVotes', adminToken),
    ]);
    const writes: CommitWrite[] = [];
    if (revRes.ok) {
      for (const doc of revRes.docs) {
        const { data } = fromFsDocument(doc);
        if (data.targetType === targetType && data.targetId === safeTargetId) {
          writes.push({ delete: doc.name });
        }
      }
    }
    if (votesRes.ok) {
      for (const doc of votesRes.docs) {
        const { data } = fromFsDocument(doc);
        if (data.targetType === targetType && data.targetId === safeTargetId) {
          writes.push({ delete: doc.name });
        }
      }
    }
    if (writes.length > 0) {
      await commitWritesDetailed(writes, adminToken);
    }
  } catch {
    // Non-fatal cleanup
  }
}

export async function updateSingleReviewInFirestore(
  reviewId: string,
  updatedComment: string,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(reviewId);
  if (!urls || !safeId || !adminToken) return false;

  const docPath = `${urls.docRoot}/reviews/${safeId}`;
  const cleanComment = updatedComment.trim().slice(0, 1500);

  const write: CommitWrite = {
    update: {
      name: docPath,
      fields: toFsFields({
        comment: cleanComment,
      }),
    },
    updateMask: {
      fieldPaths: ['comment'],
    },
  };

  try {
    const res = await commitWritesDetailed([write], adminToken);
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteSingleReviewInFirestore(
  reviewId: string,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(reviewId);
  if (!urls || !safeId || !adminToken) return false;

  const docPath = `${urls.docRoot}/reviews/${safeId}`;
  try {
    const res = await commitWritesDetailed([{ delete: docPath }], adminToken);
    return res.ok;
  } catch {
    return false;
  }
}

export async function syncWorkVoteToFirestore(
  params: {
    targetType: 'poem' | 'prose' | 'product';
    targetId: string;
    firebaseUid: string;
    rating: number;
  },
  idToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeTargetId = sanitizeId(params.targetId);
  const safeUid = sanitizeId(params.firebaseUid);
  if (!urls || !safeTargetId || !safeUid || !idToken) return false;

  const voteId = `${params.targetType}__${safeTargetId}__${safeUid}`;
  if (!VALID_COMPOSITE_ID_RE.test(voteId)) return false;

  const rating = Math.max(0.1, Math.min(5, Math.round(Number(params.rating) * 10) / 10));
  if (!Number.isFinite(rating)) return false;

  try {
    const existingResp = await fetchFsGet(`workVotes/${voteId}`, idToken);
    if (existingResp.doc) return true;
    if (existingResp.status !== 404 && existingResp.status !== 200) return false;

    const docPath = `${urls.docRoot}/workVotes/${voteId}`;
    const res = await commitWritesDetailed(
      [
        {
          update: {
            name: docPath,
            fields: toFsFields({
              id: voteId,
              targetType: params.targetType,
              targetId: safeTargetId,
              userId: safeUid,
              rating,
            }),
          },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
      ],
      idToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function syncChatMessageToFirestore(
  params: {
    id: string;
    firebaseUid: string;
    authorName: string;
    authorPhotoUrl?: string;
    isAdmin?: boolean;
    text: string;
    replyTo?: {
      id: string;
      authorUid: string;
      authorName: string;
      text: string;
    };
  },
  idToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(params.id);
  const safeUid = sanitizeId(params.firebaseUid);
  if (!urls || !safeId || !safeUid || !idToken) return false;

  const cleanText = (params.text || '').trim().slice(0, 600);
  if (!cleanText) return false;
  const cleanName = (params.authorName || 'Гість').trim().slice(0, 80) || 'Гість';
  const cleanPhoto =
    typeof params.authorPhotoUrl === 'string' && params.authorPhotoUrl.trim()
      ? params.authorPhotoUrl.trim().slice(0, 500)
      : undefined;

  const replySafeId = params.replyTo?.id ? sanitizeId(params.replyTo.id) : null;
  const replySafeUid = params.replyTo?.authorUid ? sanitizeId(params.replyTo.authorUid) : null;
  const replyClean =
    replySafeId && replySafeUid && params.replyTo
      ? {
          id: replySafeId,
          authorUid: replySafeUid,
          authorName: (params.replyTo.authorName || 'Гість').trim().slice(0, 80) || 'Гість',
          text: (params.replyTo.text || '').trim().slice(0, 180) || '…',
        }
      : undefined;

  try {
    const docPath = `${urls.docRoot}/chatMessages/${safeId}`;
    const res = await commitWritesDetailed(
      [
        {
          update: {
            name: docPath,
            fields: toFsFields({
              id: safeId,
              authorUid: safeUid,
              authorName: cleanName,
              ...(cleanPhoto ? { authorPhotoUrl: cleanPhoto } : {}),
              ...(params.isAdmin ? { isAdmin: true } : {}),
              text: cleanText,
              ...(replyClean ? { replyTo: replyClean } : {}),
            }),
          },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ],
      idToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteChatMessageInFirestore(
  messageId: string,
  idToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(messageId);
  if (!urls || !safeId || !idToken) return false;
  try {
    const res = await commitWritesDetailed(
      [{ delete: `${urls.docRoot}/chatMessages/${safeId}` }],
      idToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function syncDonationToFirestore(
  donation: DonorRecord,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(donation.id);
  if (!urls || !safeId || !adminToken) return false;
  const safeGuestUid = donation.guestUid ? sanitizeId(donation.guestUid) : null;
  try {
    const res = await commitWritesDetailed(
      [
        {
          update: {
            name: `${urls.docRoot}/donations/${safeId}`,
            fields: toFsFields({
              id: safeId,
              ...(safeGuestUid ? { guestUid: safeGuestUid } : {}),
              displayName: (donation.displayName || 'Донатер').trim().slice(0, 80),
              ...(donation.photoUrl ? { photoUrl: donation.photoUrl.trim().slice(0, 500) } : {}),
              amountUah: Math.max(1, Math.min(10_000_000, Math.round(donation.amountUah))),
              ...(donation.note ? { note: donation.note.trim().slice(0, 200) } : {}),
              donatedAt: (donation.donatedAt || new Date().toISOString()).slice(0, 64),
            }),
          },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ],
      adminToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteDonationInFirestore(
  donationId: string,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(donationId);
  if (!urls || !safeId || !adminToken) return false;
  try {
    const res = await commitWritesDetailed(
      [{ delete: `${urls.docRoot}/donations/${safeId}` }],
      adminToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

function parsePoemSubmissionFromFsDoc(doc: FsDocument): PoemSubmissionRecord | null {
  const { id, data } = fromFsDocument(doc);
  const subId = typeof data.id === 'string' && data.id ? data.id : id;
  const authorUid = typeof data.authorUid === 'string' ? data.authorUid.trim() : '';
  const authorName = typeof data.authorName === 'string' ? data.authorName.trim() : '';
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const content = typeof data.content === 'string' ? data.content : '';
  if (!subId || !authorUid || !authorName || !title || !content) return null;

  const rawStatus = typeof data.status === 'string' ? data.status : 'pending';
  const status: PoemSubmissionStatus =
    rawStatus === 'approved' || rawStatus === 'rejected' ? rawStatus : 'pending';

  const imageUrlStr =
    typeof data.imageUrl === 'string' && data.imageUrl.trim() ? data.imageUrl.trim() : undefined;
  const rawPalette =
    data.imagePalette && typeof data.imagePalette === 'object' && !Array.isArray(data.imagePalette)
      ? (data.imagePalette as Record<string, unknown>)
      : null;
  const imagePalette: PoemImagePalette | undefined =
    imageUrlStr &&
    rawPalette &&
    typeof rawPalette.background === 'string' &&
    typeof rawPalette.text === 'string'
      ? {
          background: rawPalette.background,
          ...(typeof rawPalette.secondaryBackground === 'string' && rawPalette.secondaryBackground
            ? { secondaryBackground: rawPalette.secondaryBackground }
            : {}),
          text: rawPalette.text,
          ...(typeof rawPalette.isDark === 'boolean' ? { isDark: rawPalette.isDark } : {}),
        }
      : undefined;

  const scFields = parsePoemSoundCloudFields(data);

  return {
    id: subId,
    authorUid,
    authorName,
    ...(typeof data.authorPhotoUrl === 'string' && data.authorPhotoUrl.trim()
      ? { authorPhotoUrl: data.authorPhotoUrl.trim() }
      : {}),
    title,
    cycle: typeof data.cycle === 'string' ? data.cycle.trim() : '',
    year: typeof data.year === 'number' && Number.isFinite(data.year) ? data.year : 2026,
    content,
    ...(typeof data.note === 'string' && data.note.trim() ? { note: data.note.trim() } : {}),
    ...(typeof data.fontSize === 'string' ? { fontSize: data.fontSize as PoemSubmissionRecord['fontSize'] } : {}),
    ...(typeof data.textAlign === 'string' ? { textAlign: data.textAlign as PoemSubmissionRecord['textAlign'] } : {}),
    ...(typeof data.lineSpacing === 'string' ? { lineSpacing: data.lineSpacing as PoemSubmissionRecord['lineSpacing'] } : {}),
    ...(typeof data.textColor === 'string' && data.textColor.trim() ? { textColor: data.textColor.trim() } : {}),
    ...(typeof data.backgroundColor === 'string' && data.backgroundColor.trim() ? { backgroundColor: data.backgroundColor.trim() } : {}),
    ...(imageUrlStr ? { imageUrl: imageUrlStr } : {}),
    ...(imagePalette ? { imagePalette } : {}),
    ...scFields,
    status,
    workStatus: data.workStatus === 'in_progress' ? 'in_progress' : 'completed',
    ...(typeof data.moderationNote === 'string' && data.moderationNote.trim()
      ? { moderationNote: data.moderationNote.trim() }
      : {}),
    ...(typeof data.publishedPoemId === 'string' && data.publishedPoemId.trim()
      ? { publishedPoemId: data.publishedPoemId.trim() }
      : {}),
    createdAt: typeof data.createdAt === 'string' && data.createdAt ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' && data.updatedAt ? data.updatedAt : new Date().toISOString(),
  };
}

export async function syncPoemSubmissionToFirestore(
  submission: PoemSubmissionRecord,
  authToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(submission.id);
  const safeAuthorUid = sanitizeId(submission.authorUid);
  if (!urls || !safeId || !safeAuthorUid || !authToken) return false;

  try {
    const existingResp = await fetchFsGet(`poemSubmissions/${safeId}`, authToken);
    const existingCreatedAtField = existingResp.doc?.fields?.createdAt;
    const existingAuthorUidField = existingResp.doc?.fields?.authorUid;

    const payloadFields = toFsFields({
      id: safeId,
      authorUid: safeAuthorUid,
      authorName: String(submission.authorName || 'Читач').trim().slice(0, 80),
      ...(submission.authorPhotoUrl ? { authorPhotoUrl: String(submission.authorPhotoUrl).trim().slice(0, 500) } : {}),
      title: String(submission.title || 'Без назви').trim().slice(0, 200),
      cycle: String(submission.cycle || '').trim().slice(0, 160),
      year: Math.max(1900, Math.min(2200, Math.round(Number(submission.year) || 2026))),
      content: String(submission.content || '').slice(0, 50000),
      ...(submission.note ? { note: String(submission.note).trim().slice(0, 1000) } : {}),
      ...(submission.fontSize ? { fontSize: submission.fontSize } : {}),
      ...(submission.textAlign ? { textAlign: submission.textAlign } : {}),
      ...(submission.lineSpacing ? { lineSpacing: submission.lineSpacing } : {}),
      ...(submission.textColor ? { textColor: String(submission.textColor).trim().slice(0, 32) } : {}),
      ...(submission.backgroundColor ? { backgroundColor: String(submission.backgroundColor).trim().slice(0, 32) } : {}),
      ...(submission.imageUrl ? { imageUrl: String(submission.imageUrl).trim().slice(0, 1000) } : {}),
      ...(submission.imageUrl && submission.imagePalette
        ? {
            imagePalette: {
              background: String(submission.imagePalette.background).slice(0, 32),
              ...(submission.imagePalette.secondaryBackground
                ? { secondaryBackground: String(submission.imagePalette.secondaryBackground).slice(0, 32) }
                : {}),
              text: String(submission.imagePalette.text).slice(0, 32),
              ...(typeof submission.imagePalette.isDark === 'boolean'
                ? { isDark: submission.imagePalette.isDark }
                : {}),
            },
          }
        : {}),
      ...serializePoemSoundCloudFields(submission.soundcloudTrack, submission.soundcloudTracks),
      status: submission.status,
      workStatus: submission.workStatus === 'in_progress' ? 'in_progress' : 'completed',
      ...(submission.moderationNote
        ? { moderationNote: String(submission.moderationNote).trim().slice(0, 1000) }
        : {}),
      ...(submission.publishedPoemId && sanitizeId(submission.publishedPoemId)
        ? { publishedPoemId: sanitizeId(submission.publishedPoemId)! }
        : {}),
    });

    if (existingResp.doc && existingCreatedAtField) {
      payloadFields.createdAt = existingCreatedAtField;
      if (existingAuthorUidField) {
        payloadFields.authorUid = existingAuthorUidField;
      }
    }

    const updateTransforms: Array<{ fieldPath: string; setToServerValue: 'REQUEST_TIME' }> = existingResp.doc
      ? [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }]
      : [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ];

    const res = await commitWritesDetailed(
      [
        {
          update: {
            name: `${urls.docRoot}/poemSubmissions/${safeId}`,
            fields: payloadFields,
          },
          updateTransforms,
        },
      ],
      authToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deletePoemSubmissionInFirestore(
  submissionId: string,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(submissionId);
  if (!urls || !safeId || !adminToken) return false;
  try {
    const res = await commitWritesDetailed(
      [{ delete: `${urls.docRoot}/poemSubmissions/${safeId}` }],
      adminToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function hydrateAdminPoemSubmissionsFromFirestore(
  db: SiteDatabase,
  adminToken: string
): Promise<boolean> {
  if (!adminToken) return false;
  const listRes = await fetchFsList('poemSubmissions', adminToken);
  if (!listRes.ok) return false;

  const cloudSubs = listRes.docs
    .map(parsePoemSubmissionFromFsDoc)
    .filter((item): item is PoemSubmissionRecord => Boolean(item));

  const localById = new Map((db.poemSubmissions || []).map((s) => [s.id, s]));
  const cloudIdSet = new Set(cloudSubs.map((s) => s.id));
  const merged = cloudSubs.map((cloudItem) => {
    const localItem = localById.get(cloudItem.id);
    if (!localItem) return cloudItem;
    return {
      ...cloudItem,
      ...(localItem.guestUid ? { guestUid: localItem.guestUid } : {}),
    };
  });
  for (const localItem of db.poemSubmissions || []) {
    if (!cloudIdSet.has(localItem.id)) {
      merged.push(localItem);
    }
  }

  merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  db.poemSubmissions = merged;
  const nonApprovedPoemIds = new Set<string>();
  const nonApprovedSubIds = new Set<string>();
  for (const sub of merged) {
    if (sub.status !== 'approved') {
      nonApprovedSubIds.add(sub.id);
      if (sub.publishedPoemId) nonApprovedPoemIds.add(sub.publishedPoemId);
    }
  }
  if (nonApprovedSubIds.size > 0 || nonApprovedPoemIds.size > 0) {
    db.poems = (db.poems || []).filter(
      (p) => !nonApprovedPoemIds.has(p.id) && !(p.submissionId && nonApprovedSubIds.has(p.submissionId))
    );
  }
  return true;
}

export async function hydrateUserPoemSubmissionsFromFirestore(
  db: SiteDatabase,
  firebaseUid: string,
  idToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeUid = sanitizeId(firebaseUid);
  if (!urls || !safeUid || !idToken) return false;

  try {
    const res = await fetch(`${urls.docRoot}:runQuery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'poemSubmissions' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'authorUid' },
              op: 'EQUAL',
              value: { stringValue: safeUid },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;

    const rows = (await res.json()) as Array<{ document?: FsDocument }>;
    const cloudSubs = rows
      .map((row) => (row.document ? parsePoemSubmissionFromFsDoc(row.document) : null))
      .filter((item): item is PoemSubmissionRecord => Boolean(item));

    if (!Array.isArray(db.poemSubmissions)) {
      db.poemSubmissions = [];
    }

    const otherUserSubs = db.poemSubmissions.filter((s) => s.authorUid !== safeUid);
    const mergedUserSubs = new Map<string, PoemSubmissionRecord>();
    for (const localSub of db.poemSubmissions) {
      if (localSub.authorUid === safeUid) {
        mergedUserSubs.set(localSub.id, localSub);
      }
    }
    for (const cloudSub of cloudSubs) {
      const existing = mergedUserSubs.get(cloudSub.id);
      mergedUserSubs.set(cloudSub.id, {
        ...cloudSub,
        ...(existing?.guestUid ? { guestUid: existing.guestUid } : {}),
      });
    }

    db.poemSubmissions = [...otherUserSubs, ...Array.from(mergedUserSubs.values())].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    return true;
  } catch {
    return false;
  }
}

function parseProseSubmissionFromFsDoc(doc: FsDocument): ProseSubmissionRecord | null {
  const { id, data } = fromFsDocument(doc);
  const subId = typeof data.id === 'string' && data.id ? data.id : id;
  const authorUid = typeof data.authorUid === 'string' ? data.authorUid.trim() : '';
  const authorName = typeof data.authorName === 'string' ? data.authorName.trim() : '';
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const content = typeof data.content === 'string' ? data.content : '';
  if (!subId || !authorUid || !authorName || !title || !content) return null;

  const rawStatus = typeof data.status === 'string' ? data.status : 'pending';
  const status: ProseSubmissionStatus =
    rawStatus === 'approved' || rawStatus === 'rejected' ? rawStatus : 'pending';

  const moodboardUrls = Array.isArray(data.moodboardUrls)
    ? data.moodboardUrls
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 1000))
        .slice(0, 8)
    : undefined;

  return {
    id: subId,
    authorUid,
    authorName,
    ...(typeof data.authorPhotoUrl === 'string' && data.authorPhotoUrl.trim()
      ? { authorPhotoUrl: data.authorPhotoUrl.trim() }
      : {}),
    title,
    genre: typeof data.genre === 'string' && data.genre.trim() ? data.genre.trim() : 'Оповідання',
    ...(typeof data.slogan === 'string' && data.slogan.trim() ? { slogan: data.slogan.trim() } : {}),
    ...(typeof data.excerpt === 'string' && data.excerpt.trim() ? { excerpt: data.excerpt.trim() } : {}),
    content,
    pages: typeof data.pages === 'number' && Number.isFinite(data.pages) ? Math.max(1, Math.round(data.pages)) : 1,
    ...(typeof data.totalWords === 'number' && Number.isFinite(data.totalWords)
      ? { totalWords: Math.max(0, Math.round(data.totalWords)) }
      : {}),
    ...(moodboardUrls && moodboardUrls.length > 0 ? { moodboardUrls } : {}),
    status,
    workStatus: data.workStatus === 'in_progress' ? 'in_progress' : 'completed',
    ...(typeof data.moderationNote === 'string' && data.moderationNote.trim()
      ? { moderationNote: data.moderationNote.trim() }
      : {}),
    ...(typeof data.publishedProseId === 'string' && data.publishedProseId.trim()
      ? { publishedProseId: data.publishedProseId.trim() }
      : {}),
    createdAt: typeof data.createdAt === 'string' && data.createdAt ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' && data.updatedAt ? data.updatedAt : new Date().toISOString(),
  };
}

export async function syncProseSubmissionToFirestore(
  submission: ProseSubmissionRecord,
  authToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(submission.id);
  const safeAuthorUid = sanitizeId(submission.authorUid);
  if (!urls || !safeId || !safeAuthorUid || !authToken) return false;

  try {
    const existingResp = await fetchFsGet(`proseSubmissions/${safeId}`, authToken);
    const existingCreatedAtField = existingResp.doc?.fields?.createdAt;
    const existingAuthorUidField = existingResp.doc?.fields?.authorUid;

    const payloadFields = toFsFields({
      id: safeId,
      authorUid: safeAuthorUid,
      authorName: String(submission.authorName || 'Читач').trim().slice(0, 80),
      ...(submission.authorPhotoUrl ? { authorPhotoUrl: String(submission.authorPhotoUrl).trim().slice(0, 500) } : {}),
      title: String(submission.title || 'Без назви').trim().slice(0, 240),
      genre: String(submission.genre || 'Оповідання').trim().slice(0, 120),
      ...(submission.slogan ? { slogan: String(submission.slogan).trim().slice(0, 500) } : {}),
      ...(submission.excerpt ? { excerpt: String(submission.excerpt).trim().slice(0, 2000) } : {}),
      content: String(submission.content || '').slice(0, 250000),
      pages: Math.max(1, Math.min(50000, Math.round(Number(submission.pages) || 1))),
      ...(typeof submission.totalWords === 'number'
        ? { totalWords: Math.max(0, Math.min(500000, Math.round(submission.totalWords))) }
        : {}),
      ...(Array.isArray(submission.moodboardUrls) && submission.moodboardUrls.length > 0
        ? {
            moodboardUrls: submission.moodboardUrls
              .slice(0, 8)
              .map((u) => String(u).trim().slice(0, 1000))
              .filter(Boolean),
          }
        : {}),
      status: submission.status,
      workStatus: submission.workStatus === 'in_progress' ? 'in_progress' : 'completed',
      ...(submission.moderationNote
        ? { moderationNote: String(submission.moderationNote).trim().slice(0, 1000) }
        : {}),
      ...(submission.publishedProseId && sanitizeId(submission.publishedProseId)
        ? { publishedProseId: sanitizeId(submission.publishedProseId)! }
        : {}),
    });

    if (existingResp.doc && existingCreatedAtField) {
      payloadFields.createdAt = existingCreatedAtField;
      if (existingAuthorUidField) {
        payloadFields.authorUid = existingAuthorUidField;
      }
    }

    const updateTransforms: Array<{ fieldPath: string; setToServerValue: 'REQUEST_TIME' }> = existingResp.doc
      ? [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }]
      : [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ];

    const res = await commitWritesDetailed(
      [
        {
          update: {
            name: `${urls.docRoot}/proseSubmissions/${safeId}`,
            fields: payloadFields,
          },
          updateTransforms,
        },
      ],
      authToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteProseSubmissionInFirestore(
  submissionId: string,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(submissionId);
  if (!urls || !safeId || !adminToken) return false;
  try {
    const res = await commitWritesDetailed(
      [{ delete: `${urls.docRoot}/proseSubmissions/${safeId}` }],
      adminToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function hydrateAdminProseSubmissionsFromFirestore(
  db: SiteDatabase,
  adminToken: string
): Promise<boolean> {
  if (!adminToken) return false;
  const listRes = await fetchFsList('proseSubmissions', adminToken);
  if (!listRes.ok) return false;

  const cloudSubs = listRes.docs
    .map(parseProseSubmissionFromFsDoc)
    .filter((item): item is ProseSubmissionRecord => Boolean(item));

  const localById = new Map((db.proseSubmissions || []).map((s) => [s.id, s]));
  const cloudIdSet = new Set(cloudSubs.map((s) => s.id));
  const merged = cloudSubs.map((cloudItem) => {
    const localItem = localById.get(cloudItem.id);
    if (!localItem) return cloudItem;
    return {
      ...cloudItem,
      ...(localItem.guestUid ? { guestUid: localItem.guestUid } : {}),
    };
  });
  for (const localItem of db.proseSubmissions || []) {
    if (!cloudIdSet.has(localItem.id)) {
      merged.push(localItem);
    }
  }

  merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  db.proseSubmissions = merged;
  const nonApprovedProseIds = new Set<string>();
  const nonApprovedSubIds = new Set<string>();
  for (const sub of merged) {
    if (sub.status !== 'approved') {
      nonApprovedSubIds.add(sub.id);
      if (sub.publishedProseId) nonApprovedProseIds.add(sub.publishedProseId);
    }
  }
  if (nonApprovedSubIds.size > 0 || nonApprovedProseIds.size > 0) {
    db.prose = (db.prose || []).filter(
      (w) => !nonApprovedProseIds.has(w.id) && !(w.submissionId && nonApprovedSubIds.has(w.submissionId))
    );
  }
  return true;
}

export async function hydrateUserProseSubmissionsFromFirestore(
  db: SiteDatabase,
  firebaseUid: string,
  idToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeUid = sanitizeId(firebaseUid);
  if (!urls || !safeUid || !idToken) return false;

  try {
    const res = await fetch(`${urls.docRoot}:runQuery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'proseSubmissions' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'authorUid' },
              op: 'EQUAL',
              value: { stringValue: safeUid },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;

    const rows = (await res.json()) as Array<{ document?: FsDocument }>;
    const cloudSubs = rows
      .map((row) => (row.document ? parseProseSubmissionFromFsDoc(row.document) : null))
      .filter((item): item is ProseSubmissionRecord => Boolean(item));

    if (!Array.isArray(db.proseSubmissions)) {
      db.proseSubmissions = [];
    }

    const otherUserSubs = db.proseSubmissions.filter((s) => s.authorUid !== safeUid);
    const mergedUserSubs = new Map<string, ProseSubmissionRecord>();
    for (const localSub of db.proseSubmissions) {
      if (localSub.authorUid === safeUid) {
        mergedUserSubs.set(localSub.id, localSub);
      }
    }
    for (const cloudSub of cloudSubs) {
      const existing = mergedUserSubs.get(cloudSub.id);
      mergedUserSubs.set(cloudSub.id, {
        ...cloudSub,
        ...(existing?.guestUid ? { guestUid: existing.guestUid } : {}),
      });
    }

    db.proseSubmissions = [...otherUserSubs, ...Array.from(mergedUserSubs.values())].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    return true;
  } catch {
    return false;
  }
}

export async function hydrateRadioLikesFromFirestore(): Promise<{
  ok: boolean;
  likesByTrackId: Map<string, Set<string>>;
  likesByUid: Map<string, Set<string>>;
}> {
  const likesByTrackId = new Map<string, Set<string>>();
  const likesByUid = new Map<string, Set<string>>();
  try {
    const res = await fetchFsList('radioLikes');
    if (!res.ok) {
      return { ok: false, likesByTrackId, likesByUid };
    }
    for (const doc of res.docs) {
      const { data } = fromFsDocument(doc);
      const trackId = typeof data.trackId === 'string' ? sanitizeId(data.trackId) : null;
      const userId = typeof data.userId === 'string' ? sanitizeId(data.userId) : null;
      if (!trackId || !userId) continue;

      let trackSet = likesByTrackId.get(trackId);
      if (!trackSet) {
        trackSet = new Set<string>();
        likesByTrackId.set(trackId, trackSet);
      }
      trackSet.add(userId);

      let uidSet = likesByUid.get(userId);
      if (!uidSet) {
        uidSet = new Set<string>();
        likesByUid.set(userId, uidSet);
      }
      uidSet.add(trackId);
    }
    return { ok: true, likesByTrackId, likesByUid };
  } catch {
    return { ok: false, likesByTrackId, likesByUid };
  }
}

export async function syncRadioLikeEntryToFirestore(
  params: {
    trackId: string;
    firebaseUid: string;
    liked: boolean;
  },
  idToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeTrackId = sanitizeId(params.trackId);
  const safeUid = sanitizeId(params.firebaseUid);
  if (!urls || !safeTrackId || !safeUid || !idToken) return false;

  const likeId = `${safeTrackId}__${safeUid}`;
  if (!VALID_COMPOSITE_ID_RE.test(likeId)) return false;

  try {
    const existingResp = await fetchFsGet(`radioLikes/${likeId}`, idToken);
    if (existingResp.status !== 200 && existingResp.status !== 404) {
      return false;
    }

    const docPath = `${urls.docRoot}/radioLikes/${likeId}`;
    if (params.liked) {
      if (existingResp.doc) return true;
      const res = await commitWritesDetailed(
        [
          {
            update: {
              name: docPath,
              fields: toFsFields({
                id: likeId,
                trackId: safeTrackId,
                userId: safeUid,
              }),
            },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
        idToken
      );
      return res.ok;
    }

    if (!existingResp.doc) return true;
    const res = await commitWritesDetailed([{ delete: docPath }], idToken);
    return res.ok;
  } catch {
    return false;
  }
}

export async function syncOrderToFirestore(
  order: OrderRecord,
  firebaseUid: string | undefined,
  authToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeOrderId = sanitizeId(order.orderCode);
  const safeGuestUid = firebaseUid ? sanitizeId(firebaseUid) : null;
  if (!urls || !safeOrderId || !safeGuestUid || !authToken) return false;
  if (!Array.isArray(order.items) || order.items.length === 0) return false;

  try {
    const cleanItems = order.items.slice(0, 50).map((it) => ({
      productId: String(it.productId || '').slice(0, 128),
      orderCode: String(it.orderCode || safeOrderId).slice(0, 128),
      title: String(it.title || 'Видання').slice(0, 240),
      type: String(it.type || 'ebook').slice(0, 32),
      ...(it.proseId ? { proseId: String(it.proseId).slice(0, 128) } : {}),
      purchasedAt: String(it.purchasedAt || order.createdAt || new Date().toISOString()).slice(0, 64),
      ...(it.shippingSummary ? { shippingSummary: String(it.shippingSummary).slice(0, 300) } : {}),
      ...(it.paymentTransactionId
        ? { paymentTransactionId: String(it.paymentTransactionId).slice(0, 128) }
        : {}),
    }));

    const paymentObj = order.payment
      ? {
          status: 'paid' as const,
          providerLabel: String(order.payment.providerLabel || 'monobank').slice(0, 120),
          method: order.payment.method || 'monobank',
          ...(order.payment.cardBrand ? { cardBrand: String(order.payment.cardBrand).slice(0, 40) } : {}),
          ...(order.payment.cardLast4 ? { cardLast4: String(order.payment.cardLast4).slice(0, 8) } : {}),
          ...(order.payment.cardFingerprint
            ? { cardFingerprint: String(order.payment.cardFingerprint).slice(0, 128) }
            : {}),
          ...(order.payment.encryptionProtocol
            ? { encryptionProtocol: String(order.payment.encryptionProtocol).slice(0, 120) }
            : {}),
          ...(order.payment.receiptSignature
            ? { receiptSignature: String(order.payment.receiptSignature).slice(0, 256) }
            : {}),
          transactionId: String(order.payment.transactionId || '').slice(0, 128),
          paidAt: String(order.payment.paidAt || order.createdAt || new Date().toISOString()).slice(0, 64),
        }
      : undefined;

    const payloadFields = toFsFields({
      id: safeOrderId,
      orderCode: safeOrderId,
      guestUid: safeGuestUid,
      buyerName: String(order.buyerNameMasked || order.buyerName || 'Покупець').slice(0, 120),
      buyerEmail: String(order.buyerEmailMasked || order.buyerEmail || 'hidden@example.com').slice(0, 254),
      ...(order.buyerNameMasked ? { buyerNameMasked: String(order.buyerNameMasked).slice(0, 120) } : {}),
      ...(order.buyerEmailMasked ? { buyerEmailMasked: String(order.buyerEmailMasked).slice(0, 254) } : {}),
      ...(order.buyerEmailHash ? { buyerEmailHash: String(order.buyerEmailHash).slice(0, 128) } : {}),
      ...(order.encryptedPii
        ? {
            encryptedPii: {
              alg: String(order.encryptedPii.alg || 'AES-256-GCM').slice(0, 32),
              iv: String(order.encryptedPii.iv || '').slice(0, 128),
              tag: String(order.encryptedPii.tag || '').slice(0, 128),
              ciphertext: String(order.encryptedPii.ciphertext || '').slice(0, 20000),
            },
          }
        : {}),
      totalUah: Math.max(0, Math.min(10_000_000, Math.round(Number(order.totalUah) || 0))),
      ...(paymentObj ? { payment: paymentObj } : {}),
      items: cleanItems,
    });

    const res = await commitWritesDetailed(
      [
        {
          update: {
            name: `${urls.docRoot}/orders/${safeOrderId}`,
            fields: payloadFields,
          },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
      ],
      authToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function hydrateAdminOrdersFromFirestore(
  db: SiteDatabase,
  adminToken: string
): Promise<boolean> {
  if (!adminToken) return false;
  const listRes = await fetchFsList('orders', adminToken);
  if (!listRes.ok) return false;

  const byCode = new Map<string, OrderRecord>();
  for (const ord of db.orders || []) {
    if (ord?.orderCode) byCode.set(ord.orderCode, ord);
  }

  let changed = false;
  for (const doc of listRes.docs) {
    const { id, data } = fromFsDocument(doc);
    const orderCode = typeof data.orderCode === 'string' && data.orderCode ? data.orderCode : id;
    if (!orderCode || byCode.has(orderCode)) continue;

    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems
      .filter((it): it is Record<string, unknown> => Boolean(it && typeof it === 'object'))
      .map((it) => ({
        productId: String(it.productId || ''),
        orderCode: String(it.orderCode || orderCode),
        title: String(it.title || 'Видання'),
        type: (String(it.type || 'ebook') as OrderRecord['items'][number]['type']),
        ...(typeof it.proseId === 'string' && it.proseId ? { proseId: it.proseId } : {}),
        purchasedAt:
          typeof it.purchasedAt === 'string' && it.purchasedAt
            ? it.purchasedAt
            : new Date().toISOString(),
        ...(typeof it.shippingSummary === 'string' && it.shippingSummary
          ? { shippingSummary: it.shippingSummary }
          : {}),
        ...(typeof it.paymentTransactionId === 'string' && it.paymentTransactionId
          ? { paymentTransactionId: it.paymentTransactionId }
          : {}),
      }))
      .filter((it) => Boolean(it.productId));

    if (items.length === 0) continue;

    const enc =
      data.encryptedPii && typeof data.encryptedPii === 'object' && !Array.isArray(data.encryptedPii)
        ? (data.encryptedPii as Record<string, unknown>)
        : null;
    const encryptedPii =
      enc &&
      typeof enc.iv === 'string' &&
      typeof enc.tag === 'string' &&
      typeof enc.ciphertext === 'string'
        ? {
            alg: 'AES-256-GCM' as const,
            iv: enc.iv,
            tag: enc.tag,
            ciphertext: enc.ciphertext,
          }
        : undefined;

    const pay =
      data.payment && typeof data.payment === 'object' && !Array.isArray(data.payment)
        ? (data.payment as Record<string, unknown>)
        : null;
    const payment =
      pay && typeof pay.transactionId === 'string'
        ? {
            status: 'paid' as const,
            providerLabel: typeof pay.providerLabel === 'string' ? pay.providerLabel : 'monobank',
            method: (pay.method === 'card' || pay.method === 'apple_google_pay'
              ? pay.method
              : 'monobank') as 'card' | 'apple_google_pay' | 'monobank',
            ...(typeof pay.cardBrand === 'string' ? { cardBrand: pay.cardBrand } : {}),
            ...(typeof pay.cardLast4 === 'string' ? { cardLast4: pay.cardLast4 } : {}),
            ...(typeof pay.cardFingerprint === 'string' ? { cardFingerprint: pay.cardFingerprint } : {}),
            ...(typeof pay.encryptionProtocol === 'string'
              ? { encryptionProtocol: pay.encryptionProtocol }
              : {}),
            ...(typeof pay.receiptSignature === 'string'
              ? { receiptSignature: pay.receiptSignature }
              : {}),
            transactionId: pay.transactionId,
            paidAt:
              typeof pay.paidAt === 'string' && pay.paidAt
                ? pay.paidAt
                : doc.createTime || new Date().toISOString(),
          }
        : undefined;

    byCode.set(orderCode, {
      orderCode,
      ...(typeof data.guestUid === 'string' && data.guestUid ? { guestUid: data.guestUid } : {}),
      buyerName: typeof data.buyerName === 'string' ? data.buyerName : 'Покупець',
      buyerEmail: typeof data.buyerEmail === 'string' ? data.buyerEmail : '',
      ...(typeof data.buyerNameMasked === 'string' ? { buyerNameMasked: data.buyerNameMasked } : {}),
      ...(typeof data.buyerEmailMasked === 'string'
        ? { buyerEmailMasked: data.buyerEmailMasked }
        : {}),
      ...(typeof data.buyerEmailHash === 'string' ? { buyerEmailHash: data.buyerEmailHash } : {}),
      ...(encryptedPii ? { encryptedPii } : {}),
      createdAt:
        typeof data.createdAt === 'string' && data.createdAt
          ? data.createdAt
          : doc.createTime || new Date().toISOString(),
      totalUah: typeof data.totalUah === 'number' && Number.isFinite(data.totalUah) ? data.totalUah : 0,
      ...(payment ? { payment } : {}),
      items,
    });
    changed = true;
  }

  if (changed) {
    db.orders = Array.from(byCode.values()).sort(
      (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
    );
  }
  return changed;
}

function parseSiteFeedbackFromFsDoc(doc: FsDocument): FeedbackRecord | null {
  const { id, data } = fromFsDocument(doc);
  const fbId = typeof data.id === 'string' && data.id ? data.id : id;
  const message = typeof data.message === 'string' ? data.message.trim() : '';
  if (!fbId || !message) return null;

  const displayName =
    typeof data.displayName === 'string' && data.displayName.trim()
      ? data.displayName.trim().slice(0, 80)
      : 'Гість';
  const createdAt =
    typeof data.createdAt === 'string' && data.createdAt
      ? data.createdAt
      : doc.createTime || new Date().toISOString();
  const updatedAt =
    typeof data.updatedAt === 'string' && data.updatedAt
      ? data.updatedAt
      : doc.updateTime || createdAt;

  return {
    id: fbId,
    ...(typeof data.guestUid === 'string' && data.guestUid.trim()
      ? { guestUid: data.guestUid.trim() }
      : {}),
    ...(typeof data.authorUid === 'string' && data.authorUid.trim()
      ? { firebaseUid: data.authorUid.trim() }
      : {}),
    displayName,
    ...(typeof data.authorPhotoUrl === 'string' && data.authorPhotoUrl.trim()
      ? { authorPhotoUrl: data.authorPhotoUrl.trim().slice(0, 500) }
      : {}),
    ...(typeof data.contact === 'string' && data.contact.trim()
      ? { contact: data.contact.trim().slice(0, 100) }
      : {}),
    message: message.slice(0, 2000),
    createdAt,
    updatedAt,
    readByAdmin: Boolean(data.readByAdmin),
    ...(typeof data.adminReply === 'string' && data.adminReply.trim()
      ? { adminReply: data.adminReply.trim().slice(0, 2000) }
      : {}),
    ...(typeof data.adminReplyAt === 'string' && data.adminReplyAt.trim()
      ? { adminReplyAt: data.adminReplyAt.trim().slice(0, 64) }
      : {}),
    ...(typeof data.adminReplyAuthorName === 'string' && data.adminReplyAuthorName.trim()
      ? { adminReplyAuthorName: data.adminReplyAuthorName.trim().slice(0, 80) }
      : {}),
    readByUser: typeof data.readByUser === 'boolean' ? data.readByUser : true,
  };
}

function getFeedbackFreshnessMs(item: FeedbackRecord): number {
  const candidates = [item.updatedAt, item.adminReplyAt, item.createdAt]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => Date.parse(v))
    .filter((ms) => Number.isFinite(ms));
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

export async function syncSiteFeedbackToFirestore(
  record: FeedbackRecord,
  authToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(record.id);
  if (!urls || !safeId || !authToken) return false;

  try {
    const existingResp = await fetchFsGet(`siteFeedback/${safeId}`, authToken);
    const existingCreatedAtField = existingResp.doc?.fields?.createdAt;
    const existingAuthorUidField = existingResp.doc?.fields?.authorUid;

    const safeAuthorUid = record.firebaseUid ? sanitizeId(record.firebaseUid) : null;
    const safeGuestUid = record.guestUid ? sanitizeId(record.guestUid) : null;
    const cleanReply = typeof record.adminReply === 'string' ? record.adminReply.trim().slice(0, 2000) : '';

    const payloadFields = toFsFields({
      id: safeId,
      ...(safeAuthorUid ? { authorUid: safeAuthorUid } : {}),
      ...(safeGuestUid ? { guestUid: safeGuestUid } : {}),
      displayName: String(record.displayName || 'Гість').trim().slice(0, 80) || 'Гість',
      ...(record.authorPhotoUrl
        ? { authorPhotoUrl: String(record.authorPhotoUrl).trim().slice(0, 500) }
        : {}),
      ...(record.contact ? { contact: String(record.contact).trim().slice(0, 100) } : {}),
      message: String(record.message || '').trim().slice(0, 2000),
      readByAdmin: Boolean(record.readByAdmin),
      readByUser: record.readByUser !== false,
      ...(cleanReply
        ? {
            adminReply: cleanReply,
            ...(record.adminReplyAt
              ? { adminReplyAt: String(record.adminReplyAt).trim().slice(0, 64) }
              : {}),
            ...(record.adminReplyAuthorName
              ? { adminReplyAuthorName: String(record.adminReplyAuthorName).trim().slice(0, 80) }
              : {}),
          }
        : {}),
    });

    if (existingResp.doc && existingCreatedAtField) {
      payloadFields.createdAt = existingCreatedAtField;
      if (existingAuthorUidField) {
        payloadFields.authorUid = existingAuthorUidField;
      }
    }

    const updateTransforms: Array<{ fieldPath: string; setToServerValue: 'REQUEST_TIME' }> = existingResp.doc
      ? [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }]
      : [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ];

    const res = await commitWritesDetailed(
      [
        {
          update: {
            name: `${urls.docRoot}/siteFeedback/${safeId}`,
            fields: payloadFields,
          },
          updateTransforms,
        },
      ],
      authToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteSiteFeedbackInFirestore(
  feedbackId: string,
  adminToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeId = sanitizeId(feedbackId);
  if (!urls || !safeId || !adminToken) return false;
  try {
    const res = await commitWritesDetailed(
      [{ delete: `${urls.docRoot}/siteFeedback/${safeId}` }],
      adminToken
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function hydrateAdminSiteFeedbackFromFirestore(
  db: SiteDatabase,
  adminToken: string
): Promise<boolean> {
  if (!adminToken) return false;
  const listRes = await fetchFsList('siteFeedback', adminToken);
  if (!listRes.ok) return false;

  const cloudItems = listRes.docs
    .map(parseSiteFeedbackFromFsDoc)
    .filter((item): item is FeedbackRecord => Boolean(item));

  const mergedById = new Map<string, FeedbackRecord>();
  const cloudIdSet = new Set<string>();

  for (const cloudItem of cloudItems) {
    cloudIdSet.add(cloudItem.id);
    mergedById.set(cloudItem.id, cloudItem);
  }

  let changed = false;
  const localToUpload: FeedbackRecord[] = [];

  for (const localItem of db.feedback || []) {
    const cloudItem = mergedById.get(localItem.id);
    if (!cloudItem) {
      mergedById.set(localItem.id, localItem);
      localToUpload.push(localItem);
      continue;
    }

    const localMs = getFeedbackFreshnessMs(localItem);
    const cloudMs = getFeedbackFreshnessMs(cloudItem);
    if (localMs > cloudMs) {
      mergedById.set(localItem.id, {
        ...cloudItem,
        ...localItem,
        ...(localItem.firebaseUid || cloudItem.firebaseUid
          ? { firebaseUid: localItem.firebaseUid || cloudItem.firebaseUid }
          : {}),
        ...(localItem.guestUid || cloudItem.guestUid
          ? { guestUid: localItem.guestUid || cloudItem.guestUid }
          : {}),
      });
      localToUpload.push(mergedById.get(localItem.id)!);
    } else {
      mergedById.set(localItem.id, {
        ...localItem,
        ...cloudItem,
        ...(localItem.guestUid && !cloudItem.guestUid ? { guestUid: localItem.guestUid } : {}),
        ...(localItem.firebaseUid && !cloudItem.firebaseUid
          ? { firebaseUid: localItem.firebaseUid }
          : {}),
      });
      changed = true;
    }
  }

  if (cloudItems.length > 0) {
    changed = true;
  }

  db.feedback = Array.from(mergedById.values()).sort(
    (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
  );

  for (const item of localToUpload.slice(0, 20)) {
    if (!cloudIdSet.has(item.id) || getFeedbackFreshnessMs(item) > 0) {
      void syncSiteFeedbackToFirestore(item, adminToken);
    }
  }

  return changed;
}

export async function hydrateUserSiteFeedbackFromFirestore(
  db: SiteDatabase,
  firebaseUid: string,
  idToken: string
): Promise<boolean> {
  const urls = getBaseUrls();
  const safeUid = sanitizeId(firebaseUid);
  if (!urls || !safeUid || !idToken) return false;

  try {
    const res = await fetch(`${urls.docRoot}:runQuery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'siteFeedback' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'authorUid' },
              op: 'EQUAL',
              value: { stringValue: safeUid },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;

    const rows = (await res.json()) as Array<{ document?: FsDocument }>;
    const cloudItems = rows
      .map((row) => (row.document ? parseSiteFeedbackFromFsDoc(row.document) : null))
      .filter((item): item is FeedbackRecord => Boolean(item));

    if (!Array.isArray(db.feedback)) {
      db.feedback = [];
    }

    const byId = new Map<string, FeedbackRecord>();
    for (const localItem of db.feedback) {
      byId.set(localItem.id, localItem);
    }

    let changed = false;
    for (const cloudItem of cloudItems) {
      const existing = byId.get(cloudItem.id);
      if (!existing || getFeedbackFreshnessMs(cloudItem) >= getFeedbackFreshnessMs(existing)) {
        byId.set(cloudItem.id, {
          ...existing,
          ...cloudItem,
          ...(existing?.guestUid && !cloudItem.guestUid ? { guestUid: existing.guestUid } : {}),
        });
        changed = true;
      }
    }

    if (changed) {
      db.feedback = Array.from(byId.values()).sort(
        (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
      );
    }
    return changed;
  } catch {
    return false;
  }
}
