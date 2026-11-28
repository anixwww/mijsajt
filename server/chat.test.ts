import test from 'node:test';
import assert from 'node:assert';
import { INITIAL_DATABASE, type GuestAccountRecord, type SiteDatabase } from './seedData.ts';
import {
  appendChatMessage,
  CHAT_EDIT_WINDOW_MS,
  createChatReport,
  editChatMessage,
  setChatSlowMode,
  setPinnedChatMessage,
  setUserChatMute,
  toggleChatReaction,
} from './chat.ts';

function createTestDb(): SiteDatabase {
  const db = structuredClone(INITIAL_DATABASE);
  db.poems = [
    {
      id: 'poem-test-1',
      title: 'Ніч над містом',
      cycle: 'Зоряний цикл',
      year: 2025,
      excerpt: 'Тиша...',
      content: 'Повний текст вірша',
    },
  ];
  db.prose = [
    {
      id: 'prose-test-1',
      title: 'Далекий берег',
      genre: 'Оповідання',
      pages: 12,
      publishedAt: '2025',
      slogan: 'Слоган',
      excerpt: 'Уривок',
      content: 'Текст прози',
    },
  ];
  db.radioTracks = [
    {
      id: 'track-test-1',
      title: 'Midnight Drift',
      artist: 'Lunar Echo',
      soundcloudUrl: 'https://soundcloud.com/test/midnight',
      station: 'electronic',
      addedAt: new Date().toISOString(),
    },
  ];
  return db;
}

function makeUser(uid: string, name: string, email = `${uid}@example.com`): GuestAccountRecord {
  return {
    uid,
    displayName: name,
    email,
    createdAt: new Date().toISOString(),
  };
}

test('Chat attachments validate poems, prose, and radio tracks while ignoring unknown IDs', () => {
  const db = createTestDb();
  const alice = makeUser('user_alice', 'Олена');
  db.guestAccounts.push(alice);

  const poemRes = appendChatMessage(db, alice, 'Раджу прочитати!', undefined, {
    attachment: { type: 'poem', id: 'poem-test-1', title: 'Підроблений заголовок' },
  });
  assert.strictEqual(poemRes.ok, true);
  if (poemRes.ok) {
    assert.deepStrictEqual(poemRes.message.attachment, {
      type: 'poem',
      id: 'poem-test-1',
      title: 'Ніч над містом',
      subtitle: 'Зоряний цикл',
    });
  }

  const invalidRes = appendChatMessage(db, alice, 'Тест неіснуючого вірша', undefined, {
    attachment: { type: 'poem', id: 'poem-missing', title: 'Неіснуючий' },
  });
  assert.strictEqual(invalidRes.ok, true);
  if (invalidRes.ok) {
    assert.strictEqual(invalidRes.message.attachment, undefined);
  }
});

test('Emoji reactions toggle cleanly and reject unsupported emojis', () => {
  const db = createTestDb();
  const alice = makeUser('user_alice', 'Олена');
  const bob = makeUser('user_bob', 'Максим');
  db.guestAccounts.push(alice, bob);

  const sent = appendChatMessage(db, alice, 'Привіт усім!');
  assert.strictEqual(sent.ok, true);
  if (!sent.ok) return;

  const r1 = toggleChatReaction(db, sent.message.id, '❤️', bob.uid);
  assert.strictEqual(r1.ok, true);
  if (r1.ok) {
    assert.deepStrictEqual(r1.reactions['❤️'], [bob.uid]);
  }

  const r2 = toggleChatReaction(db, sent.message.id, '❤️', bob.uid);
  assert.strictEqual(r2.ok, true);
  if (r2.ok) {
    assert.strictEqual(r2.reactions['❤️'], undefined);
  }

  const badEmoji = toggleChatReaction(db, sent.message.id, '💩', bob.uid);
  assert.strictEqual(badEmoji.ok, false);
  if (!badEmoji.ok) {
    assert.strictEqual(badEmoji.status, 400);
  }
});

test('Message editing enforces 5-minute window for readers and updates pinned text', () => {
  const db = createTestDb();
  const alice = makeUser('user_alice', 'Олена');
  const bob = makeUser('user_bob', 'Максим');
  db.guestAccounts.push(alice, bob);

  const sent = appendChatMessage(db, alice, 'Початковий текст');
  assert.strictEqual(sent.ok, true);
  if (!sent.ok) return;

  setPinnedChatMessage(db, { messageId: sent.message.id }, { displayName: 'Адмін' });

  const otherAttempt = editChatMessage(db, sent.message.id, 'Чужа правка', {
    uid: bob.uid,
    isAdmin: false,
  });
  assert.strictEqual(otherAttempt.ok, false);
  if (!otherAttempt.ok) assert.strictEqual(otherAttempt.status, 403);

  const validEdit = editChatMessage(db, sent.message.id, 'Оновлений текст', {
    uid: alice.uid,
    isAdmin: false,
  });
  assert.strictEqual(validEdit.ok, true);
  if (validEdit.ok) {
    assert.strictEqual(validEdit.message.text, 'Оновлений текст');
    assert.ok(validEdit.message.editedAt);
    assert.strictEqual(db.chatMeta?.pinnedMessage?.text, 'Оновлений текст');
  }

  // Simulate expired message (> 5 minutes old)
  const rawRecord = db.chatMessages.find((m) => m.id === sent.message.id)!;
  rawRecord.createdAt = new Date(Date.now() - CHAT_EDIT_WINDOW_MS - 10_000).toISOString();

  const expiredEdit = editChatMessage(db, sent.message.id, 'Пізня правка', {
    uid: alice.uid,
    isAdmin: false,
  });
  assert.strictEqual(expiredEdit.ok, false);
  if (!expiredEdit.ok) assert.strictEqual(expiredEdit.status, 403);

  const adminEdit = editChatMessage(db, sent.message.id, 'Адмінська правка', {
    uid: 'admin_1',
    isAdmin: true,
  });
  assert.strictEqual(adminEdit.ok, true);
});

test('Slow mode throttles consecutive messages for regular readers', () => {
  const db = createTestDb();
  const charlie = makeUser('user_charlie', 'Тарас');
  db.guestAccounts.push(charlie);

  const slowRes = setChatSlowMode(db, 30);
  assert.strictEqual(slowRes.ok, true);
  if (slowRes.ok) {
    assert.strictEqual(slowRes.chatMeta.slowModeSeconds, 30);
  }

  const first = appendChatMessage(db, charlie, 'Перше повідомлення');
  assert.strictEqual(first.ok, true);

  const second = appendChatMessage(db, charlie, 'Друге одразу');
  assert.strictEqual(second.ok, false);
  if (!second.ok) {
    assert.strictEqual(second.status, 429);
    assert.ok((second.retryAfterSec || 0) >= 1);
  }
});

test('User mute blocks messaging until unmuted and reports prevent self-reporting or duplicates', () => {
  const db = createTestDb();
  const dave = makeUser('user_dave', 'Дмитро');
  const eve = makeUser('user_eve', 'Єва');
  db.guestAccounts.push(dave, eve);

  const muteRes = setUserChatMute(
    db,
    { targetUid: dave.uid, durationMinutes: 15, displayName: dave.displayName },
    { uid: 'admin_uid', displayName: 'Адмін' }
  );
  assert.strictEqual(muteRes.ok, true);

  const blockedSend = appendChatMessage(db, dave, 'Чи можу писати?');
  assert.strictEqual(blockedSend.ok, false);
  if (!blockedSend.ok) assert.strictEqual(blockedSend.status, 403);

  const unmuteRes = setUserChatMute(
    db,
    { targetUid: dave.uid, unmute: true },
    { uid: 'admin_uid', displayName: 'Адмін' }
  );
  assert.strictEqual(unmuteRes.ok, true);

  const allowedSend = appendChatMessage(db, dave, 'Тепер можу писати');
  assert.strictEqual(allowedSend.ok, true);
  if (!allowedSend.ok) return;

  const selfReport = createChatReport(
    db,
    { messageId: allowedSend.message.id },
    { uid: dave.uid, displayName: dave.displayName }
  );
  assert.strictEqual(selfReport.ok, false);

  const report1 = createChatReport(
    db,
    { messageId: allowedSend.message.id, reason: 'Спам' },
    { uid: eve.uid, displayName: eve.displayName }
  );
  assert.strictEqual(report1.ok, true);
  if (report1.ok) assert.strictEqual(report1.alreadyReported, false);

  const report2 = createChatReport(
    db,
    { messageId: allowedSend.message.id },
    { uid: eve.uid, displayName: eve.displayName }
  );
  assert.strictEqual(report2.ok, true);
  if (report2.ok) assert.strictEqual(report2.alreadyReported, true);
  assert.strictEqual(db.chatReports?.length, 1);
});
