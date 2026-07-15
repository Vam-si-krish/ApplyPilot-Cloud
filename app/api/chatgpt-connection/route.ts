import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/userContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function workerConfig() {
  const url = (process.env.RESUME_WORKER_URL || '').replace(/\/$/, '');
  const secret = process.env.RESUME_WORKER_SECRET || '';
  if (!url || !secret) throw new Error('The trusted résumé worker is not configured');
  return { url, secret };
}

async function workerRequest(userId: string, path: string, init: RequestInit = {}) {
  const worker = workerConfig();
  const response = await fetch(`${worker.url}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${worker.secret}`,
      'x-jobpilot-user-id': userId,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(25_000),
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Worker error (${response.status})`);
  return data;
}

function authenticatedUser() {
  const userId = currentUserId();
  if (!userId) throw new Error('unauthorized');
  return userId;
}

export async function GET() {
  try {
    return NextResponse.json(await workerRequest(authenticatedUser(), '/chatgpt-connection/status'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === 'unauthorized' ? 401 : 500 });
  }
}

export async function POST() {
  try {
    return NextResponse.json(await workerRequest(authenticatedUser(), '/chatgpt-connection/start', { method: 'POST', body: '{}' }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === 'unauthorized' ? 401 : 500 });
  }
}

export async function DELETE() {
  try {
    return NextResponse.json(await workerRequest(authenticatedUser(), '/chatgpt-connection', { method: 'DELETE' }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === 'unauthorized' ? 401 : 500 });
  }
}
