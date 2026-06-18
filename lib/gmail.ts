/**
 * Gmail OAuth + read helpers (ADR 0012). Zero SDK — plain fetch against Google's
 * OAuth2 and Gmail REST endpoints. The user's OAuth app credentials come from the
 * Settings UI (stored in gmail_connection); this module never reads env for them.
 *
 * Scope is read-only — we never send mail, only classify what arrives.
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

/** The OAuth redirect path; combine with appBaseUrl() to get the full URI to register in Google. */
export const GMAIL_REDIRECT_PATH = '/api/gmail/callback';

const OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Build the Google consent URL. access_type=offline + prompt=consent forces a refresh_token. */
export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${OAUTH_AUTH}?${p.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const resp = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Google token error: ${data.error || resp.status} ${data.error_description || ''}`.trim());
  return data as TokenResponse;
}

/** Exchange an authorization code for tokens (returns refresh_token + access_token). */
export function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<TokenResponse> {
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
}

/** Get a fresh access token from a stored refresh token. */
export async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const t = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  return t.access_token;
}

/** The connected account's email address. */
export async function getProfileEmail(accessToken: string): Promise<string | null> {
  const resp = await fetch(`${GMAIL_API}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) return null;
  const data = await resp.json();
  return (data.emailAddress as string) ?? null;
}

/** List message ids matching a Gmail search query (e.g. 'newer_than:2d'). */
export async function listMessageIds(accessToken: string, query: string, maxResults = 40): Promise<string[]> {
  const p = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const resp = await fetch(`${GMAIL_API}/messages?${p.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) throw new Error(`Gmail list error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return ((data.messages || []) as { id: string }[]).map((m) => m.id);
}

export interface FetchedMessage {
  id: string;
  threadId: string;
  receivedAt: string | null;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  snippet: string;
}

function header(headers: { name: string; value: string }[], name: string): string {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

/** Parse 'Name <email@x.com>' into name + email. */
function parseFrom(from: string): { name: string | null; email: string | null } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  const e = from.trim().toLowerCase();
  return { name: null, email: e || null };
}

/** Fetch one message's metadata + snippet (no body download). */
export async function getMessage(accessToken: string, id: string): Promise<FetchedMessage> {
  const p = new URLSearchParams({ format: 'metadata' });
  for (const h of ['From', 'Subject', 'Date']) p.append('metadataHeaders', h);
  const resp = await fetch(`${GMAIL_API}/messages/${id}?${p.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) throw new Error(`Gmail get error: ${resp.status}`);
  const data = await resp.json();
  const headers = (data.payload?.headers || []) as { name: string; value: string }[];
  const from = parseFrom(header(headers, 'From'));
  const internal = data.internalDate ? new Date(Number(data.internalDate)).toISOString() : null;
  return {
    id: data.id,
    threadId: data.threadId,
    receivedAt: internal,
    fromEmail: from.email,
    fromName: from.name,
    subject: header(headers, 'Subject') || null,
    snippet: (data.snippet as string) || '',
  };
}
