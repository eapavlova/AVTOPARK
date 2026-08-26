import { randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'autopark_session';

export class SessionStore {
  constructor({ ttlMs = 8 * 60 * 60 * 1000, now = () => Date.now(), random = randomBytes } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.random = random;
    this.sessions = new Map();
  }

  create({ actorId, memberId }) {
    const id = this.random(32).toString('base64url');
    const session = {
      id,
      actorId,
      memberId,
      csrfToken: this.random(32).toString('base64url'),
      expiresAt: this.now() + this.ttlMs
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id) {
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  verifyCsrf(session, candidate) {
    if (!session || typeof candidate !== 'string') return false;
    const expected = Buffer.from(session.csrfToken);
    const actual = Buffer.from(candidate);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

export function readSessionId(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    if (name !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCookie(session, { secure = true } = {}) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(session.id)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.floor((session.expiresAt - Date.now()) / 1000)}`,
    secure ? 'SameSite=None' : 'SameSite=Lax'
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}
