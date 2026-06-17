/**
 * Single shared-password auth (ADR 0003).
 *
 * Login verifies APP_PASSWORD and issues a signed session token (HMAC-SHA256
 * over an expiry timestamp, keyed by AUTH_SECRET). middleware.ts checks it on
 * every request. No user table, no email provider.
 *
 * Uses the Web Crypto API (globalThis.crypto.subtle) rather than node:crypto so
 * the same functions run in both the Edge middleware and Node route handlers.
 */

export const SESSION_COOKIE = 'ap_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('Missing required environment variable: AUTH_SECRET');
  return s;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return toHex(mac);
}

/** Constant-time string compare (no early return on length mismatch beyond padding). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True if the submitted password matches APP_PASSWORD. */
export function checkPassword(submitted: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error('Missing required environment variable: APP_PASSWORD');
  return safeEqual(submitted, expected);
}

/** Create a signed session token: "<expiryMs>.<hmac>". */
export async function createSessionToken(now: number = Date.now()): Promise<string> {
  const expiry = String(now + SESSION_TTL_MS);
  return `${expiry}.${await sign(expiry)}`;
}

/** Verify a session token's signature and expiry. */
export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const expiry = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!safeEqual(mac, await sign(expiry))) return false;
  const expiryMs = Number(expiry);
  return Number.isFinite(expiryMs) && expiryMs > Date.now();
}

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
