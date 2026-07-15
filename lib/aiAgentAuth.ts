import { safeEqual } from './auth';
import { supabaseAdmin } from './supabase';

export const AI_AGENT_TOKEN_PREFIX = 'apai1_';
export const AI_AGENT_RUN_TTL_MS = 2 * 60 * 60 * 1000;

export interface AiAgentClaims {
  version: 1;
  purpose: 'ai-apply-run';
  runId: string;
  userId: string;
  expiresAt: number;
}

export interface AiAgentIdentity {
  runId: string;
  userId: string;
  expiresAt: number;
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error('Missing required environment variable: AUTH_SECRET');
  return value;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`applypilot-ai-agent:${value}`));
  return Buffer.from(mac).toString('base64url');
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function createAiAgentToken(
  runId: string,
  userId: string,
  expiresAt: number,
): Promise<string> {
  const claims: AiAgentClaims = { version: 1, purpose: 'ai-apply-run', runId, userId, expiresAt };
  const payload = encode(JSON.stringify(claims));
  return `${AI_AGENT_TOKEN_PREFIX}${payload}.${await sign(payload)}`;
}

export async function readAiAgentToken(
  token: string | null | undefined,
  now = Date.now(),
): Promise<AiAgentClaims | null> {
  if (!token?.startsWith(AI_AGENT_TOKEN_PREFIX)) return null;
  const signed = token.slice(AI_AGENT_TOKEN_PREFIX.length);
  const dot = signed.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = signed.slice(0, dot);
  const receivedMac = signed.slice(dot + 1);
  if (!safeEqual(receivedMac, await sign(payload))) return null;
  try {
    const claims = JSON.parse(decode(payload)) as Partial<AiAgentClaims>;
    if (claims.version !== 1 || claims.purpose !== 'ai-apply-run'
      || !isUuid(claims.runId) || !isUuid(claims.userId)
      || typeof claims.expiresAt !== 'number' || claims.expiresAt <= now) return null;
    return claims as AiAgentClaims;
  } catch {
    return null;
  }
}

export async function authenticateAiAgentRequest(req: Request): Promise<AiAgentIdentity | null> {
  const authorization = req.headers.get('authorization') || '';
  const claims = await readAiAgentToken(authorization.startsWith('Bearer ') ? authorization.slice(7) : null);
  if (!claims) return null;

  const db = supabaseAdmin(claims.userId);
  const { data, error } = await db
    .from('ai_agent_runs')
    .select('id, user_id, expires_at, revoked_at')
    .eq('id', claims.runId)
    .maybeSingle();
  if (error || !data || data.user_id !== claims.userId || data.revoked_at
    || new Date(data.expires_at).getTime() <= Date.now()) return null;

  void db.from('ai_agent_runs').update({ last_used_at: new Date().toISOString() }).eq('id', claims.runId);
  return { runId: claims.runId, userId: claims.userId, expiresAt: claims.expiresAt };
}
