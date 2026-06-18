/**
 * GET /api/mail — the Inbox data (ADR 0012): classified messages (optionally
 * filtered by category) plus a per-day history of counts per category. Session-gated.
 */
import { NextResponse } from 'next/server';
import { listMail, getGmailConnection } from '@/lib/db';
import type { MailCategory, MailMessage } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORIES: MailCategory[] = ['applied', 'shortlisted', 'action_needed', 'assessment', 'rejection', 'other'];

export async function GET(req: Request) {
  const category = new URL(req.url).searchParams.get('category');
  try {
    const conn = await getGmailConnection();
    // Pull a broad window once; derive both the (filtered) list and the daily history.
    const all = await listMail(null, 500);
    const messages = category ? all.filter((m) => m.category === category) : all;

    // Counts cover classified mail only; pending (category null) is reported separately.
    const pending = all.filter((m) => m.status === 'pending').length;

    // Per-day counts per category (by received date).
    const byDay = new Map<string, Record<string, number>>();
    for (const m of all) {
      if (!m.received_at || !m.category) continue;
      const day = new Date(m.received_at).toISOString().slice(0, 10);
      const row = byDay.get(day) ?? { total: 0 };
      row[m.category] = (row[m.category] ?? 0) + 1;
      row.total = (row.total ?? 0) + 1;
      byDay.set(day, row);
    }
    const daily = Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, counts]) => ({ date, counts }));

    const totals: Record<string, number> = {};
    for (const c of CATEGORIES) totals[c] = all.filter((m) => m.category === c).length;

    return NextResponse.json({
      connected: !!conn.refresh_token,
      email: conn.email,
      last_synced_at: conn.last_synced_at,
      messages: messages.slice(0, 200) as MailMessage[],
      daily,
      totals,
      pending,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
