/**
 * Single shared-password auth (ADR 0003).
 *
 * Login verifies APP_PASSWORD and issues a signed session token (HMAC-SHA256
 * over an expiry timestamp, keyed by AUTH_SECRET). middleware.ts checks it on
 * every request. No user table, no email provider.
 */
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'ap_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('Missing required environment variable: AUTH_SECRET');
  return s;
}

function sign(value: string): string {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

/** Constant-time string compare. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** True if the submitted password matches APP_PASSWORD. */
export function checkPassword(submitted: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error('Missing required environment variable: APP_PASSWORD');
  return safeEqual(submitted, expected);
}

/** Create a signed session token: "<expiryMs>.<hmac>". */
export function createSessionToken(now: number = Date.now()): string {
  const expiry = String(now + SESSION_TTL_MS);
  return `${expiry}.${sign(expiry)}`;
}

/** Verify a session token's signature and expiry. */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const expiry = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!safeEqual(mac, sign(expiry))) return false;
  const expiryMs = Number(expiry);
  return Number.isFinite(expiryMs) && expiryMs > Date.now();
}

export { SESSION_TTL_MS };

/**
 * Authorize a server-to-server call (cron, score-batch self-retrigger).
 * Accepts `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`.
 */
export function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ') && safeEqual(auth.slice(7), expected)) return true;
  const url = new URL(req.url);
  const q = url.searchParams.get('secret');
  return q ? safeEqual(q, expected) : false;
}
