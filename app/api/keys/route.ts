/**
 * GET/POST /api/keys — the API-key vault (ADR 0006). Gated by the password
 * session in middleware.ts, same as /api/settings.
 *
 * GET returns masked previews only (the raw secret never leaves the server after
 * it's saved). POST stores a new key for a provider.
 */
import { NextResponse } from 'next/server';
import { listApiKeys, createApiKey, isApiKeyProvider } from '@/lib/credentials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await listApiKeys());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { provider?: unknown; label?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!isApiKeyProvider(body.provider)) {
    return NextResponse.json({ error: 'invalid provider' }, { status: 400 });
  }
  const value = typeof body.value === 'string' ? body.value.trim() : '';
  if (!value) {
    return NextResponse.json({ error: 'key value required' }, { status: 400 });
  }
  const label = typeof body.label === 'string' ? body.label : '';

  try {
    const created = await createApiKey(body.provider, label, value);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
