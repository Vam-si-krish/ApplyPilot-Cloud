/**
 * POST /api/assistant — the ApplyBuddy chat (ADR 0011). Multi-turn: answers job
 * application questions / recruiter emails as the applicant, grounded in the Cloud
 * profile, and revises on follow-up ("make it shorter / more polite").
 *
 * Session-gated (middleware). Runs on the active LLM key/provider via the API-key
 * vault — a SEPARATE call path from fit scoring (frozen SCORE_PROMPT untouched).
 */
import { NextResponse } from 'next/server';
import { getProfile, getSettings } from '@/lib/db';
import { buildScoringClient } from '@/lib/scoreRunner';
import { getClient } from '@/lib/llm';
import { buildAssistantSystem, sanitizeTurns } from '@/lib/assistant';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const turns = sanitizeTurns(body.messages);
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'expected a non-empty conversation ending in a user message' }, { status: 400 });
  }

  const profile = await getProfile();
  const settings = await getSettings();

  // Active vault key for the configured provider; fall back to the env-detected client.
  let client;
  try {
    client = (await buildScoringClient(settings)) ?? getClient();
  } catch {
    return NextResponse.json(
      { error: 'No LLM provider configured. Add a key in Settings → API Keys.' },
      { status: 400 },
    );
  }

  try {
    const reply = await client.chat([buildAssistantSystem(profile), ...turns], { temperature: 0.5, maxTokens: 1200 });
    return NextResponse.json({ reply: reply.trim() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
