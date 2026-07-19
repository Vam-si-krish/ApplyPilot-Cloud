/** Fixed-account auth for Phase 2A (ADR 0073). Web-Crypto only: also runs in middleware. */

export const SESSION_COOKIE = 'ap_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface FixedUser {
  id: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface AppSession {
  userId: string;
  username: string;
  expiresAt: number;
}

export const FIXED_USER_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '578fcb56-5900-4d0d-be20-6b6c191554b7',
] as const;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error('Missing required environment variable: AUTH_SECRET');
  return value;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function configuredUsers(): FixedUser[] {
  const raw = process.env.APP_USERS_JSON;
  if (!raw) throw new Error('Missing required environment variable: APP_USERS_JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('APP_USERS_JSON must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length < 3 || parsed.length > FIXED_USER_IDS.length) {
    throw new Error('APP_USERS_JSON must contain the three baseline accounts and may include Rishab');
  }
  const users = parsed.map((entry): FixedUser => {
    const row = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const id = typeof row.id === 'string' ? row.id.toLowerCase() : '';
    const username = typeof row.username === 'string' ? row.username.trim().toLowerCase() : '';
    const password = typeof row.password === 'string' ? row.password : '';
    const displayName = typeof row.displayName === 'string' ? row.displayName.trim() : undefined;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
      throw new Error('Every fixed account needs a valid UUIDv4 id');
    }
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
      throw new Error('Every fixed account needs a 3–32 character username');
    }
    if (password.length < 10) throw new Error('Every fixed account password must be at least 10 characters');
    return { id, username, password, displayName };
  });
  if (new Set(users.map((user) => user.id)).size !== users.length
    || new Set(users.map((user) => user.username)).size !== users.length) {
    throw new Error('Fixed account ids and usernames must be unique');
  }
  if (users.some((user) => !(FIXED_USER_IDS as readonly string[]).includes(user.id))) {
    throw new Error('Fixed account ids must match the provisioned account migrations');
  }
  if ((FIXED_USER_IDS as readonly string[]).slice(0, 3).some((id) => !users.some((user) => user.id === id))) {
    throw new Error('APP_USERS_JSON must retain all three baseline accounts');
  }
  return users;
}

export function authenticateUser(username: string, password: string): FixedUser | null {
  const normalized = username.trim().toLowerCase();
  const user = configuredUsers().find((candidate) => safeEqual(candidate.username, normalized));
  return user && safeEqual(user.password, password) ? user : null;
}

export async function createSessionToken(user: Pick<FixedUser, 'id' | 'username'>, now = Date.now()): Promise<string> {
  const payload = encode(JSON.stringify({ userId: user.id, username: user.username, expiresAt: now + SESSION_TTL_MS }));
  return `${payload}.${await sign(payload)}`;
}

export async function readSessionToken(token: string | undefined | null): Promise<AppSession | null> {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!safeEqual(mac, await sign(payload))) return null;
  try {
    const value = JSON.parse(decode(payload)) as Partial<AppSession>;
    if (typeof value.userId !== 'string' || typeof value.username !== 'string'
      || typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now()) return null;
    const configured = configuredUsers().find((user) => user.id === value.userId && user.username === value.username);
    return configured ? value as AppSession : null;
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  return (await readSessionToken(token)) !== null;
}

export function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ') && safeEqual(auth.slice(7), expected)) return true;
  const query = new URL(req.url).searchParams.get('secret');
  return query ? safeEqual(query, expected) : false;
}
