/**
 * GET /api/mail/stats — Application Tracker data (ADR 0014). Derives application
 * volume over time from the AI-classified "applied" confirmation emails, plus the
 * rest of the pipeline (shortlisted / assessment / action / rejection) for funnel
 * context. Returns raw "applied" events with timestamps so the client buckets by
 * the user's local day/week/month. Session-gated.
 */
import { NextResponse } from 'next/server';
import { getClassifiedMailForStats, getGmailConnection } from '@/lib/db';
import type { MailCategory } from '@/lib/types';
import type { AppliedEvent } from '@/lib/trackerStats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORIES: MailCategory[] = ['applied', 'shortlisted', 'action_needed', 'assessment', 'rejection', 'other'];

export async function GET() {
  try {
    const conn = await getGmailConnection();
    const rows = await getClassifiedMailForStats();

    const appliedRows = rows.filter((r) => r.category === 'applied');
    const applied: AppliedEvent[] = appliedRows.map((r) => ({
      received_at: r.received_at,
      company: r.from_name || (r.from_email ? r.from_email.split('@')[1] ?? null : null),
      subject: r.subject,
      summary: r.summary,
      apply_source: (r.apply_source as AppliedEvent['apply_source']) ?? null,
    }));

    const totals: Record<string, number> = {};
    for (const c of CATEGORIES) totals[c] = rows.filter((r) => r.category === c).length;

    // Easy Apply vs company/ATS portal split (ADR 0021).
    const applySources = {
      easy_apply: appliedRows.filter((r) => r.apply_source === 'easy_apply').length,
      company_portal: appliedRows.filter((r) => r.apply_source === 'company_portal').length,
      unknown: appliedRows.filter((r) => !r.apply_source).length,
    };

    return NextResponse.json({
      connected: !!conn.refresh_token,
      email: conn.email,
      applied,
      totals,
      applySources,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
