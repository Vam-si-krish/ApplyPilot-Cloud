const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_LENGTH = 12;

export const AI_AGENT_PAIRING_TTL_MS = 10 * 60 * 1000;

function authSecret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error('Missing required environment variable: AUTH_SECRET');
  return value;
}

export function normalizeAiAgentPairingCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toUpperCase().replace(/[\s-]/g, '');
  if (normalized.length !== PAIRING_LENGTH) return null;
  for (const character of normalized) {
    if (!PAIRING_ALPHABET.includes(character)) return null;
  }
  return normalized;
}

export function createAiAgentPairingCode(): string {
  const random = crypto.getRandomValues(new Uint8Array(PAIRING_LENGTH));
  const normalized = Array.from(random, (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]).join('');
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized;
}

export async function hashAiAgentPairingCode(value: unknown): Promise<string | null> {
  const normalized = normalizeAiAgentPairingCode(value);
  if (!normalized) return null;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(authSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`applypilot-ai-pairing:${normalized}`));
  return Buffer.from(mac).toString('hex');
}
