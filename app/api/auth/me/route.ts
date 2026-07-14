import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const username = headers().get('x-jobpilot-username');
  const userId = headers().get('x-jobpilot-user-id');
  if (!username || !userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ id: userId, username });
}
