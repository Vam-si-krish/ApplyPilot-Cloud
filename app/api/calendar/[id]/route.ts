import { NextResponse } from 'next/server';
import { setCalendarEventCompleted } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: { completed?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof body.completed !== 'boolean') return NextResponse.json({ error: 'completed must be boolean' }, { status: 400 });
  try {
    const event = await setCalendarEventCompleted(params.id, body.completed);
    return event
      ? NextResponse.json({ ok: true, event })
      : NextResponse.json({ error: 'calendar event not found' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
