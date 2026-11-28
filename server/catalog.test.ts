import assert from 'node:assert';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { ensureDatabase } from './db.ts';
import {
  CATALOG_TEXT_MAX_CHARS,
  computeLeaderboardRankings,
  enrichProseForPublic,
  registerCatalogRoutes,
  truncateBlogForCatalog,
  truncatePoemForCatalog,
} from './catalog.ts';
import type { BlogPost, Poem } from '../src/types.ts';
import { INITIAL_DATABASE, type RawProseWork } from './seedData.ts';

function createBasePoem(content: string): Poem {
  return {
    id: 'poem-test-1',
    title: 'Тестовий вірш',
    cycle: 'Цикл',
    year: 2025,
    excerpt: 'Уривок',
    content,
    viewsCount: 10,
    ratingAverage: 4.8,
    ratingCount: 5,
    userRating: null,
    reviews: [],
  };
}

function createBasePost(content: string): BlogPost {
  return {
    id: 'blog-test-1',
    title: 'Тестовий допис',
    category: 'Нотатки',
    publishedAt: '2025-05-01',
    readingMinutes: 3,
    excerpt: 'Короткий опис',
    content,
    viewsCount: 7,
  };
}

test('truncatePoemForCatalog keeps short poems untouched and truncates long poems', () => {
  const shortPoem = createBasePoem('Короткий рядок\nДругий рядок');
  const shortResult = truncatePoemForCatalog(shortPoem);
  assert.strictEqual(shortResult.content, shortPoem.content);
  assert.strictEqual(shortResult.contentTruncated, undefined);

  const longContent = Array.from({ length: 14 }, (_, idx) => `Рядок ${idx + 1}: тихий вечір над ставом лягає на воду`).join('\n');
  assert.ok(longContent.length > CATALOG_TEXT_MAX_CHARS);

  const longPoem = createBasePoem(longContent);
  const truncated = truncatePoemForCatalog(longPoem);
  assert.strictEqual(truncated.contentTruncated, true);
  assert.ok(truncated.content.endsWith('…'));
  assert.ok(truncated.content.length < longContent.length);
  assert.ok(truncated.content.length <= CATALOG_TEXT_MAX_CHARS);
});

test('truncateBlogForCatalog preserves blog-media directives while truncating prose body', () => {
  const longProse = Array.from(
    { length: 8 },
    (_, idx) => `Абзац ${idx + 1} із роздумами про літературу, тишу осіннього саду та роботу над текстом.`
  ).join(' ');
  const mediaDirective = ':::blog-media {"type":"image","url":"/uploads/sample.webp"} :::';
  const post = createBasePost(`${longProse}\n${mediaDirective}`);

  const truncated = truncateBlogForCatalog(post);
  assert.strictEqual(truncated.contentTruncated, true);
  assert.ok(truncated.content.includes('…'));
  assert.ok(truncated.content.includes(mediaDirective));
  assert.ok(truncated.content.length < post.content.length);
});

test('enrichProseForPublic omits full prose content in catalog mode and enforces lock for paid/auth works', () => {
  const db = ensureDatabase();
  const publicWork: RawProseWork = {
    id: 'prose-public-1',
    title: 'Відкрите оповідання',
    genre: 'Оповідання',
    pages: 4,
    publishedAt: '2025-05-01',
    slogan: 'Слоган',
    excerpt: 'Уривок оповідання',
    content: 'Повний текст першого розділу оповідання з багатьма подробицями.',
    chapters: [
      {
        id: 'ch-1',
        title: 'Розділ 1',
        publishedAt: '2025-05-01',
        content: 'Докладний зміст розділу.',
      },
    ],
    accessMode: 'public',
  };

  const catalogView = enrichProseForPublic(publicWork, db, 'ip', false, false);
  assert.strictEqual(catalogView.content, '');
  assert.strictEqual(catalogView.chapters?.[0]?.content, '');
  assert.strictEqual(catalogView.isLocked, false);

  const fullView = enrichProseForPublic(publicWork, db, 'ip', false, true);
  assert.strictEqual(fullView.content, publicWork.content);
  assert.strictEqual(fullView.chapters?.[0]?.content, publicWork.chapters?.[0]?.content);

  const paidWork: RawProseWork = {
    ...publicWork,
    id: 'prose-paid-1',
    accessMode: 'paid',
    isPaid: true,
    priceUah: 150,
  };
  const lockedView = enrichProseForPublic(paidWork, db, 'ip', false, true);
  assert.strictEqual(lockedView.isLocked, true);
  assert.strictEqual(lockedView.content, '');
  assert.ok(typeof lockedView.previewText === 'string' && lockedView.previewText.length > 0);
});

test('Public catalog, read endpoints, and cache headers work end-to-end', async () => {
  const db = ensureDatabase();
  const originalPoems = [...db.poems];
  const originalBlog = [...db.blog];

  const longPoemText = Array.from({ length: 16 }, (_, idx) => `Строфа ${idx + 1}: вітер гойдає траву на схилі пагорба`).join('\n');
  const longBlogText = Array.from({ length: 10 }, (_, idx) => `Нотатка ${idx + 1} про книгу, чорновик і довгі прогулянки містом.`).join(' ');

  db.poems = [
    {
      id: 'unit-poem-long',
      title: 'Довгий вірш',
      cycle: 'Тест',
      year: 2026,
      excerpt: 'Коротко',
      content: longPoemText,
    },
  ];
  db.blog = [
    {
      id: 'unit-blog-long',
      title: 'Довгий допис',
      category: 'Есеї',
      publishedAt: '2026-01-10',
      readingMinutes: 4,
      excerpt: 'Есе',
      content: longBlogText,
    },
  ];

  const app = express();
  registerCatalogRoutes(app);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const homeRes = await fetch(`${baseUrl}/api/home`);
    assert.strictEqual(homeRes.status, 200);
    assert.strictEqual(homeRes.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');

    const catalogRes = await fetch(`${baseUrl}/api/catalog`);
    assert.strictEqual(catalogRes.status, 200);
    assert.strictEqual(catalogRes.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
    assert.match(catalogRes.headers.get('vary') || '', /Authorization/i);
    const catalogEtag = catalogRes.headers.get('etag');
    assert.ok(catalogEtag);

    const catalogJson = (await catalogRes.json()) as {
      poems: Poem[];
      blog: BlogPost[];
      prose: Array<{ content: string }>;
    };
    assert.strictEqual(catalogJson.poems[0].contentTruncated, true);
    assert.ok(catalogJson.poems[0].content.length < longPoemText.length);
    assert.strictEqual(catalogJson.blog[0].contentTruncated, true);
    assert.ok(catalogJson.blog[0].content.length < longBlogText.length);
    for (const work of catalogJson.prose) {
      assert.strictEqual(work.content, '');
    }

    const notModifiedRes = await fetch(`${baseUrl}/api/catalog`, {
      headers: { 'If-None-Match': catalogEtag },
    });
    assert.strictEqual(notModifiedRes.status, 304);

    const poemReadRes = await fetch(`${baseUrl}/api/poems/unit-poem-long/read`);
    assert.strictEqual(poemReadRes.status, 200);
    assert.strictEqual(poemReadRes.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
    const poemReadJson = (await poemReadRes.json()) as { id: string; content: string };
    assert.strictEqual(poemReadJson.content, longPoemText);

    const blogReadRes = await fetch(`${baseUrl}/api/blog/unit-blog-long/read`);
    assert.strictEqual(blogReadRes.status, 200);
    assert.strictEqual(blogReadRes.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
    const blogReadJson = (await blogReadRes.json()) as { id: string; content: string };
    assert.strictEqual(blogReadJson.content, longBlogText);

    const missingRes = await fetch(`${baseUrl}/api/poems/does-not-exist/read`);
    assert.strictEqual(missingRes.status, 404);
  } finally {
    db.poems = originalPoems;
    db.blog = originalBlog;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Admin accounts are excluded from activity leaderboard and never receive activityRank badges', () => {
  const prevAdminEmails = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'admin-leader@example.com';

  try {
    const db = structuredClone(INITIAL_DATABASE);
    db.poems = [
      {
        id: 'poem-lb-1',
        title: 'Тест',
        cycle: 'Цикл',
        year: 2026,
        excerpt: '...',
        content: 'Текст',
      },
    ];
    db.guestAccounts = [
      {
        uid: 'guest_admin_1',
        googleUid: 'fb_admin_1',
        displayName: 'Адмін',
        email: 'admin-leader@example.com',
        likedPoemIds: ['poem-lb-1'],
        purchasesCount: 10,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        uid: 'guest_reader_1',
        googleUid: 'fb_reader_1',
        displayName: 'Читачка',
        email: 'reader@example.com',
        likedPoemIds: ['poem-lb-1'],
        purchasesCount: 0,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ];

    const { activityRanked, lookup } = computeLeaderboardRankings(db);
    assert.strictEqual(activityRanked.some((e) => e.uid === 'guest_admin_1'), false);
    assert.strictEqual(activityRanked.length, 1);
    assert.strictEqual(activityRanked[0].uid, 'guest_reader_1');
    assert.strictEqual(activityRanked[0].rank, 1);
    assert.strictEqual(lookup.get('guest_admin_1', 'Адмін')?.activityRank, undefined);
    assert.strictEqual(lookup.get('fb_admin_1', 'Адмін')?.activityRank, undefined);
    assert.strictEqual(lookup.get('guest_reader_1', 'Читачка')?.activityRank, 1);
  } finally {
    if (prevAdminEmails === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = prevAdminEmails;
    }
  }
});
