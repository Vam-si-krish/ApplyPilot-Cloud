import { NextResponse } from 'next/server';
import { createManualMailTask, getSettings } from '@/lib/db';
import { classifyEmail } from '@/lib/mailClassify';
import { buildScoringClient } from '@/lib/scoreRunner';
import { getClient } from '@/lib/llm';
import { isSavableExternalClassification, parseExternalIntakeInput } from '@/lib/externalMessageIntake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const input = parseExternalIntakeInput(body);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  try {
    const settings = await getSettings();
    const timezone = input.timezone || settings.timezone || 'UTC';
    const client = (await buildScoringClient(settings)) ?? getClient();
    const result = await classifyEmail({
      from: 'Pasted external message',
      subject: 'External job-search message',
      snippet: input.content.slice(0, 3000),
      body: input.content,
      receivedAt: new Date().toISOString(),
      timezone,
    }, client);

    const isDatedEvent = result.calendar_action === 'active'
      && Boolean(result.calendar_event_kind)
      && Boolean(result.calendar_start_at || result.calendar_end_at);
    if (!isSavableExternalClassification(result)) {
      return NextResponse.json({
        error: 'I could not find a confirmed interview, dated assessment, or recruiter outreach in that message. Nothing was saved.',
      }, { status: 422 });
    }

    const item = await createManualMailTask({
      category: result.category as 'recruiter' | 'shortlisted' | 'action_needed' | 'assessment',
      summary: result.summary || 'External job-search message',
      company_name: result.company_name,
      role_title: result.role_title,
      calendar_event_kind: isDatedEvent ? result.calendar_event_kind : null,
      calendar_start_at: isDatedEvent ? result.calendar_start_at : null,
      calendar_end_at: isDatedEvent ? result.calendar_end_at : null,
    });
    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
