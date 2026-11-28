import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'awesome-ripsaw-nlxdt';
const ADMIN_UID = 'admin_uid_1';
const ADMIN_EMAIL = 'andrijdankiv5@gmail.com';
const RBAC_ADMIN_UID = 'rbac_admin_2';
const ALICE_UID = 'alice_uid_1';
const ALICE_EMAIL = 'alice@example.com';
const BOB_UID = 'bob_uid_2';
const BOB_EMAIL = 'bob@example.com';

const serverTs = () => firebase.firestore.FieldValue.serverTimestamp();
const deleteVal = () => firebase.firestore.FieldValue.delete();

function dbFor(ctx: RulesTestContext) {
  return ctx.firestore();
}

let testEnv: RulesTestEnvironment;

test.before(async () => {
  const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  const hostEnv = process.env.FIRESTORE_EMULATOR_HOST;
  const [host, portStr] = hostEnv ? hostEnv.split(':') : ['127.0.0.1', '8080'];

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      ...(hostEnv ? {} : { host, port: Number(portStr) || 8080 }),
    },
  });
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
});

test.after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

function guestUnverified(uid = ALICE_UID, email = ALICE_EMAIL) {
  return testEnv.authenticatedContext(uid, { email, email_verified: false });
}

function verifiedUser(uid = ALICE_UID, email = ALICE_EMAIL) {
  return testEnv.authenticatedContext(uid, { email, email_verified: true });
}

function bootstrapAdmin() {
  return testEnv.authenticatedContext(ADMIN_UID, {
    email: ADMIN_EMAIL,
    email_verified: true,
  });
}

test('Global deny, connection probe, and /admins RBAC rules', async () => {
  const anon = dbFor(testEnv.unauthenticatedContext());
  const alice = dbFor(verifiedUser());
  const spoofAdmin = dbFor(
    testEnv.authenticatedContext('spoof_admin', {
      email: ADMIN_EMAIL,
      email_verified: false,
    })
  );

  await assertFails(anon.doc('test/connection').get());
  await assertFails(alice.doc('unknownCollection/doc1').get());
  await assertFails(alice.doc('unknownCollection/doc1').set({ foo: 'bar' }));

  // Unverified admin email spoof must be denied
  await assertFails(
    spoofAdmin.doc('poems/p1').set({
      id: 'p1',
      title: 'T',
      cycle: 'C',
      year: 2026,
      excerpt: '',
      content: 'Body',
      note: '',
      order: 1,
      updatedAt: serverTs(),
    })
  );

  // /admins/{uid}: RBAC admin works when doc exists; clients cannot write /admins
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await dbFor(ctx).doc(`admins/${RBAC_ADMIN_UID}`).set({ uid: RBAC_ADMIN_UID, role: 'admin' });
  });

  const rbacAdmin = dbFor(verifiedUser(RBAC_ADMIN_UID, 'coauthor@example.com'));
  await assertSucceeds(rbacAdmin.doc(`admins/${RBAC_ADMIN_UID}`).get());
  await assertFails(alice.doc(`admins/${RBAC_ADMIN_UID}`).get());
  await assertFails(alice.collection('admins').get());
  await assertFails(alice.doc(`admins/${ALICE_UID}`).set({ uid: ALICE_UID, role: 'admin' }));
  await assertSucceeds(
    rbacAdmin.doc('blogPosts/b1').set({
      id: 'b1',
      title: 'Rbac post',
      category: 'Думки',
      publishedAt: '2026-01-01',
      readingMinutes: 3,
      coverImage: '',
      excerpt: 'Ex',
      content: 'Content',
      order: 0,
      updatedAt: serverTs(),
    })
  );
});

test('chatMessages: public read, verified create, anti-admin-spoof, owner/admin delete', async () => {
  const anon = dbFor(testEnv.unauthenticatedContext());
  const alice = dbFor(verifiedUser(ALICE_UID, ALICE_EMAIL));
  const bob = dbFor(verifiedUser(BOB_UID, BOB_EMAIL));
  const unverified = dbFor(guestUnverified());
  const admin = dbFor(bootstrapAdmin());

  await assertFails(
    unverified.doc('chatMessages/m1').set({
      id: 'm1',
      authorUid: ALICE_UID,
      authorName: 'Alice',
      text: 'Hello',
      createdAt: serverTs(),
    })
  );

  // Spoofing isAdmin: true as regular user must fail
  await assertFails(
    alice.doc('chatMessages/m_spoof').set({
      id: 'm_spoof',
      authorUid: ALICE_UID,
      authorName: 'Alice',
      isAdmin: true,
      text: 'I am admin',
      createdAt: serverTs(),
    })
  );

  // Spoofing authorPhotoUrl javascript: URI must fail
  await assertFails(
    alice.doc('chatMessages/m_xss').set({
      id: 'm_xss',
      authorUid: ALICE_UID,
      authorName: 'Alice',
      authorPhotoUrl: 'javascript:alert(1)',
      text: 'XSS',
      createdAt: serverTs(),
    })
  );

  await assertSucceeds(
    alice.doc('chatMessages/m1').set({
      id: 'm1',
      authorUid: ALICE_UID,
      authorName: 'Alice',
      text: 'Привіт спільното!',
      createdAt: serverTs(),
    })
  );

  await assertSucceeds(anon.collection('chatMessages').orderBy('createdAt', 'desc').limit(50).get());
  await assertFails(alice.doc('chatMessages/m1').update({ text: 'Edited' }));
  await assertFails(bob.doc('chatMessages/m1').delete());
  await assertSucceeds(alice.doc('chatMessages/m1').delete());

  await assertSucceeds(
    admin.doc('chatMessages/m_admin').set({
      id: 'm_admin',
      authorUid: ADMIN_UID,
      authorName: 'Андрій',
      isAdmin: true,
      text: 'Вітаю!',
      createdAt: serverTs(),
    })
  );
  await assertSucceeds(admin.doc('chatMessages/m_admin').delete());
});

test('siteFeedback: isolated reads, admin reply protection, owner readByUser sync', async () => {
  const alice = dbFor(verifiedUser(ALICE_UID, ALICE_EMAIL));
  const bob = dbFor(verifiedUser(BOB_UID, BOB_EMAIL));
  const admin = dbFor(bootstrapAdmin());

  // Regular user cannot spoof adminReply on create
  await assertFails(
    alice.doc('siteFeedback/fb_spoof').set({
      id: 'fb_spoof',
      authorUid: ALICE_UID,
      displayName: 'Alice',
      message: 'Feedback',
      readByAdmin: false,
      readByUser: true,
      adminReply: 'Fake reply',
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  await assertSucceeds(
    alice.doc('siteFeedback/fb1').set({
      id: 'fb1',
      authorUid: ALICE_UID,
      displayName: 'Alice',
      contact: 'alice@example.com',
      message: 'Чудовий сайт!',
      readByAdmin: false,
      readByUser: true,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  // Cross-user read & blanket list must fail
  await assertFails(bob.doc('siteFeedback/fb1').get());
  await assertFails(bob.collection('siteFeedback').get());
  await assertSucceeds(alice.collection('siteFeedback').where('authorUid', '==', ALICE_UID).get());
  await assertSucceeds(admin.collection('siteFeedback').orderBy('createdAt', 'desc').limit(50).get());

  // Admin replies & marks unread for user
  await assertSucceeds(
    admin.doc('siteFeedback/fb1').update({
      readByAdmin: true,
      readByUser: false,
      adminReply: 'Дякую!',
      adminReplyAt: '2026-11-28T10:00:00.000Z',
      adminReplyAuthorName: 'Андрій',
      updatedAt: serverTs(),
    })
  );

  // Owner cannot forge adminReply, can only mark readByUser: true
  await assertFails(
    alice.doc('siteFeedback/fb1').update({
      adminReply: 'Hijacked',
      updatedAt: serverTs(),
    })
  );
  await assertSucceeds(
    alice.doc('siteFeedback/fb1').update({
      readByUser: true,
      updatedAt: serverTs(),
    })
  );

  await assertFails(alice.doc('siteFeedback/fb1').delete());
  await assertSucceeds(admin.doc('siteFeedback/fb1').delete());
});

test('radioTracks & weeklyMusicSelections: authenticated reads, admin writes, deleteField text', async () => {
  const anon = dbFor(testEnv.unauthenticatedContext());
  const alice = dbFor(verifiedUser(ALICE_UID, ALICE_EMAIL));
  const admin = dbFor(bootstrapAdmin());

  await assertFails(
    alice.doc('radioTracks/tr1').set({
      id: 'tr1',
      title: 'Track',
      artist: 'Artist',
      soundcloudUrl: 'https://soundcloud.com/a/b',
      embedTargetUrl: 'https://soundcloud.com/a/b',
      artworkUrl: '',
      station: 'indie',
      order: 0,
      visibility: 'authenticated',
      createdByUid: ALICE_UID,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  await assertSucceeds(
    admin.doc('radioTracks/tr1').set({
      id: 'tr1',
      title: 'Midnight',
      artist: 'Artist',
      soundcloudUrl: 'https://soundcloud.com/artist/midnight',
      embedTargetUrl: 'https://soundcloud.com/artist/midnight',
      artworkUrl: '',
      station: 'indie',
      order: 0,
      visibility: 'authenticated',
      createdByUid: ADMIN_UID,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  await assertFails(anon.doc('radioTracks/tr1').get());
  await assertFails(anon.collection('radioTracks').where('visibility', '==', 'authenticated').get());
  await assertSucceeds(alice.collection('radioTracks').where('visibility', '==', 'authenticated').get());

  await assertSucceeds(
    admin.doc('radioTracks/tr1').update({
      order: 3,
      station: 'electronic',
      updatedAt: serverTs(),
    })
  );

  // weeklyMusicSelections
  await assertSucceeds(
    admin.doc('weeklyMusicSelections/wms1').set({
      id: 'wms1',
      weekKey: '2026-W48',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      periodLabel: '23–29 лист. 2026',
      text: 'Тепла добірка',
      photos: ['/uploads/cozy.webp'],
      tracks: [
        {
          id: 'sc1',
          title: 'Song',
          artist: 'Band',
          soundcloudUrl: 'https://soundcloud.com/band/song',
          embedTargetUrl: 'https://soundcloud.com/band/song',
        },
      ],
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  await assertSucceeds(anon.collection('weeklyMusicSelections').get());
  await assertSucceeds(
    admin.doc('weeklyMusicSelections/wms1').update({
      weekKey: '2026-W48',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      periodLabel: '23–29 лист. 2026',
      text: deleteVal(),
      photos: [],
      tracks: [],
      updatedAt: serverTs(),
    })
  );

  // URL poisoning in weeklyMusicSelections tracks must fail
  await assertFails(
    admin.doc('weeklyMusicSelections/wms_bad').set({
      id: 'wms_bad',
      weekKey: '2026-W48',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      periodLabel: '23–29 лист. 2026',
      photos: [],
      tracks: [
        {
          id: 'sc_bad',
          title: 'Bad',
          artist: 'Bad',
          soundcloudUrl: 'javascript:alert(1)',
          embedTargetUrl: 'https://soundcloud.com/band/song',
        },
      ],
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );
});

test('orders: closes paid order self-forgery; allows owner read and admin write', async () => {
  const alice = dbFor(verifiedUser(ALICE_UID, ALICE_EMAIL));
  const bob = dbFor(verifiedUser(BOB_UID, BOB_EMAIL));
  const admin = dbFor(bootstrapAdmin());

  const validOrderPayload = {
    id: 'ORD-001',
    orderCode: 'ORD-001',
    guestUid: ALICE_UID,
    buyerName: 'A***',
    buyerEmail: 'a***@example.com',
    totalUah: 350,
    payment: {
      status: 'paid',
      providerLabel: 'monobank Acquiring',
      method: 'monobank',
      transactionId: 'tx_123',
      paidAt: '2026-11-28T10:00:00.000Z',
    },
    items: [
      {
        productId: 'book_1',
        orderCode: 'ORD-001',
        title: 'Книга',
        type: 'ebook',
        purchasedAt: '2026-11-28T10:00:00.000Z',
      },
    ],
    createdAt: serverTs(),
    updatedAt: serverTs(),
  };

  // Dirty Dozen #1: Non-admin user cannot forge paid order directly in Firestore
  await assertFails(alice.doc('orders/ORD-001').set(validOrderPayload));

  await assertSucceeds(admin.doc('orders/ORD-001').set(validOrderPayload));
  await assertSucceeds(alice.doc('orders/ORD-001').get());
  await assertSucceeds(alice.collection('orders').where('guestUid', '==', ALICE_UID).get());
  await assertFails(bob.doc('orders/ORD-001').get());
  await assertFails(bob.collection('orders').get());
  await assertFails(alice.doc('orders/ORD-001').update({ totalUah: 1, updatedAt: serverTs() }));
});

test('users & publicProfiles: blocks stat/donor spoofing, immutable field bypass, and ghost fields', async () => {
  const alice = dbFor(verifiedUser(ALICE_UID, ALICE_EMAIL));
  const bob = dbFor(verifiedUser(BOB_UID, BOB_EMAIL));
  const admin = dbFor(bootstrapAdmin());

  // Dirty Dozen #2 & #3: Owner cannot inflate purchasesCount, totalTimeSeconds, or donorChatText
  await assertFails(
    alice.doc(`publicProfiles/${ALICE_UID}`).set({
      uid: ALICE_UID,
      displayName: 'Alice',
      purchasesCount: 25,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  await assertSucceeds(
    alice.doc(`publicProfiles/${ALICE_UID}`).set({
      uid: ALICE_UID,
      displayName: 'Alice',
      likedPoemIds: ['poem_1'],
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  await assertFails(
    alice.doc(`publicProfiles/${ALICE_UID}`).update({
      purchasesCount: 10,
      updatedAt: serverTs(),
    })
  );

  await assertFails(
    alice.doc(`publicProfiles/${ALICE_UID}`).update({
      donorChatText: 'Fake Top Donor',
      updatedAt: serverTs(),
    })
  );

  await assertSucceeds(
    admin.doc(`publicProfiles/${ALICE_UID}`).update({
      purchasesCount: 2,
      totalTimeSeconds: 3600,
      donorChatText: 'Меценат',
      updatedAt: serverTs(),
    })
  );

  // /users PII & Ghost field tests
  await assertSucceeds(
    alice.doc(`users/${ALICE_UID}`).set({
      uid: ALICE_UID,
      email: ALICE_EMAIL,
      displayName: 'Alice',
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  await assertFails(bob.doc(`users/${ALICE_UID}`).get());
  await assertFails(
    alice.doc(`users/${ALICE_UID}`).update({
      displayName: 'Alice New',
      isVerified: true,
      updatedAt: serverTs(),
    })
  );
  await assertFails(
    alice.doc(`users/${ALICE_UID}`).update({
      uid: BOB_UID,
      updatedAt: serverTs(),
    })
  );
  await assertSucceeds(
    alice.doc(`users/${ALICE_UID}`).update({
      displayName: 'Alice Updated',
      updatedAt: serverTs(),
    })
  );
});

test('prose, prosePrivate, mediaAssets, and secrets isolation', async () => {
  const alice = dbFor(verifiedUser(ALICE_UID, ALICE_EMAIL));
  const admin = dbFor(bootstrapAdmin());

  // Paid prose must never leak content/chapters in public /prose
  await assertFails(
    admin.doc('prose/pr_paid').set({
      id: 'pr_paid',
      title: 'Paid Novel',
      genre: 'Роман',
      pages: 10,
      publishedAt: '2026',
      slogan: '',
      excerpt: 'Preview',
      content: 'LEAKED FULL TEXT',
      chapters: [],
      tagIds: [],
      status: 'completed',
      accessMode: 'paid',
      requiresAuth: false,
      isPaid: true,
      priceUah: 100,
      moodboardUrls: [],
      order: 1,
      updatedAt: serverTs(),
    })
  );

  await assertSucceeds(
    admin.doc('prose/pr_paid').set({
      id: 'pr_paid',
      title: 'Paid Novel',
      genre: 'Роман',
      pages: 10,
      publishedAt: '2026',
      slogan: '',
      excerpt: 'Preview',
      content: '',
      chapters: [],
      tagIds: [],
      status: 'completed',
      accessMode: 'paid',
      requiresAuth: false,
      isPaid: true,
      priceUah: 100,
      moodboardUrls: [],
      order: 1,
      updatedAt: serverTs(),
    })
  );

  // prosePrivate: authorized readable by signed-in users, paid readable only by admin
  await assertSucceeds(
    admin.doc('prosePrivate/pr_auth').set({
      id: 'pr_auth',
      accessMode: 'authorized',
      content: 'Auth-only text',
      chapters: [],
      pdfStorageKey: '',
      pdfFileName: '',
      pdfFileSize: 0,
      updatedAt: serverTs(),
    })
  );
  await assertSucceeds(
    admin.doc('prosePrivate/pr_paid').set({
      id: 'pr_paid',
      accessMode: 'paid',
      content: 'Paid secret text',
      chapters: [],
      pdfStorageKey: '',
      pdfFileName: '',
      pdfFileSize: 0,
      updatedAt: serverTs(),
    })
  );

  await assertSucceeds(alice.doc('prosePrivate/pr_auth').get());
  await assertFails(alice.doc('prosePrivate/pr_paid').get());
  await assertFails(alice.collection('prosePrivate').get());
  await assertSucceeds(alice.collection('prosePrivate').where('accessMode', '==', 'authorized').get());
  await assertSucceeds(admin.doc('prosePrivate/pr_paid').get());

  // mediaAssets: admin-only + strict image MIME allowlist
  await assertFails(
    alice.doc('mediaAssets/img1').set({
      id: 'img1',
      filename: 'evil.svg',
      mimeType: 'image/svg+xml',
      dataBase64: 'PHN2Zz48L3N2Zz4=',
      updatedAt: serverTs(),
    })
  );
  await assertFails(
    admin.doc('mediaAssets/img_svg').set({
      id: 'img_svg',
      filename: 'evil.svg',
      mimeType: 'image/svg+xml',
      dataBase64: 'PHN2Zz48L3N2Zz4=',
      updatedAt: serverTs(),
    })
  );
  await assertSucceeds(
    admin.doc('mediaAssets/img_ok').set({
      id: 'img_ok',
      filename: 'cover.webp',
      mimeType: 'image/webp',
      dataBase64: 'UklGRg==',
      updatedAt: serverTs(),
    })
  );

  // Admin/Product secrets strictly isolated
  await assertSucceeds(
    admin.doc('adminSecrets/main').set({
      id: 'main',
      telegramBotToken: 'secret-token',
      updatedAt: serverTs(),
    })
  );
  await assertFails(alice.doc('adminSecrets/main').get());
  await assertFails(alice.doc('productSecrets/p1').get());
});

test('reviews, workVotes, poemLikes, and submission terminal state locks', async () => {
  const alice = dbFor(verifiedUser(ALICE_UID, ALICE_EMAIL));
  const bob = dbFor(verifiedUser(BOB_UID, BOB_EMAIL));
  const admin = dbFor(bootstrapAdmin());

  // Orphan review / like must fail without parent poem
  await assertFails(
    alice.doc('reviews/rev_orphan').set({
      id: 'rev_orphan',
      targetType: 'poem',
      targetId: 'missing_poem',
      authorUid: ALICE_UID,
      authorName: 'Alice',
      rating: 5,
      comment: 'Great',
      createdAt: serverTs(),
    })
  );

  await assertSucceeds(
    admin.doc('poems/poem_1').set({
      id: 'poem_1',
      title: 'Вірш',
      cycle: 'Цикл',
      year: 2026,
      excerpt: 'Уривок',
      content: 'Текст вірша',
      note: '',
      order: 0,
      updatedAt: serverTs(),
    })
  );

  await assertSucceeds(
    alice.doc('reviews/rev1').set({
      id: 'rev1',
      targetType: 'poem',
      targetId: 'poem_1',
      authorUid: ALICE_UID,
      authorName: 'Alice',
      rating: 4,
      comment: 'Гарно',
      createdAt: serverTs(),
    })
  );

  // Rating cannot be tampered after creation; comment update succeeds
  await assertFails(alice.doc('reviews/rev1').update({ rating: 1 }));
  await assertSucceeds(alice.doc('reviews/rev1').update({ comment: 'Дуже гарно' }));
  await assertFails(bob.doc('reviews/rev1').update({ comment: 'Hacked' }));

  // Valid poemLike & workVote
  await assertSucceeds(
    alice.doc(`poemLikes/poem_1__${ALICE_UID}`).set({
      id: `poem_1__${ALICE_UID}`,
      poemId: 'poem_1',
      userId: ALICE_UID,
      createdAt: serverTs(),
    })
  );
  await assertFails(alice.doc(`poemLikes/poem_1__${ALICE_UID}`).update({ poemId: 'poem_2' }));

  // Submissions: pending edit allowed, locked after approval
  await assertSucceeds(
    alice.doc('poemSubmissions/sub1').set({
      id: 'sub1',
      authorUid: ALICE_UID,
      authorName: 'Alice',
      title: 'Мій вірш',
      cycle: 'Спільнота',
      year: 2026,
      content: 'Рядки...',
      status: 'pending',
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  await assertSucceeds(
    alice.doc('poemSubmissions/sub1').update({
      title: 'Оновлена назва',
      updatedAt: serverTs(),
    })
  );

  await assertSucceeds(
    admin.doc('poemSubmissions/sub1').update({
      status: 'approved',
      moderationNote: 'Опубліковано',
      publishedPoemId: 'poem_comm_1',
      updatedAt: serverTs(),
    })
  );

  // Terminal state lock: owner cannot mutate after approval
  await assertFails(
    alice.doc('poemSubmissions/sub1').update({
      title: 'Підміна після публікації',
      updatedAt: serverTs(),
    })
  );
});
