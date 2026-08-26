import test from 'node:test';
import assert from 'node:assert/strict';
import { readSessionId, sessionCookie, SessionStore } from '../src/auth/session-store.js';

test('server session expires and validates its CSRF token', () => {
  let now = 1_000;
  let randomCall = 0;
  const store = new SessionStore({
    ttlMs: 500,
    now: () => now,
    random: () => Buffer.alloc(32, ++randomCall)
  });
  const session = store.create({ actorId: 'user-1', memberId: 'member-1' });

  assert.equal(store.get(session.id).actorId, 'user-1');
  assert.equal(store.verifyCsrf(session, session.csrfToken), true);
  assert.equal(store.verifyCsrf(session, 'wrong'), false);
  now = 1_501;
  assert.equal(store.get(session.id), null);
});

test('session cookie is HttpOnly and uses Secure for Bitrix24 iframe mode', () => {
  const session = { id: 'session value', expiresAt: Date.now() + 60_000 };
  const cookie = sessionCookie(session, { secure: true });

  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=None/);
  assert.match(cookie, /Secure/);
  assert.equal(readSessionId(cookie), 'session value');
});
