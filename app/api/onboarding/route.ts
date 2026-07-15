import { NextResponse } from 'next/server';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { currentUserId } from '@/lib/userContext';
import { supabaseAdmin } from '@/lib/supabase';
import { makeWorkerClient } from '@/lib/llm';
import { parseResumeSetup } from '@/lib/resumeParse';
import { deriveOnboarding } from '@/lib/onboarding';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data, error } = await supabaseAdmin().from('app_users')
    .select('id, username, display_name, onboarding_complete').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const db = supabaseAdmin();
    const { data: account, error: accountError } = await db.from('app_users')
      .select('onboarding_complete').eq('id', userId).single();
    if (accountError) throw new Error(`Could not load account: ${accountError.message}`);
    if (account.onboarding_complete) {
      return NextResponse.json({ error: 'Onboarding is already complete for this account' }, { status: 409 });
    }
    const form = await req.formData();
    const file = form.get('resume');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Resume PDF is required' }, { status: 400 });
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Resume PDF must be between 1 byte and 10 MB' }, { status: 400 });
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF résumés are accepted' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = await pdf(buffer);
    const resumeText = extracted.text.trim();
    if (resumeText.length < 100) {
      return NextResponse.json(
        { error: 'The PDF contains too little selectable text. Export it as a text-based PDF and try again.' },
        { status: 422 },
      );
    }

    const workerUrl = process.env.RESUME_WORKER_URL || '';
    const workerSecret = process.env.RESUME_WORKER_SECRET || '';
    if (!workerUrl || !workerSecret) throw new Error('Onboarding AI worker is not configured');
    const provider = process.env.ONBOARDING_SUBSCRIPTION_PROVIDER || 'chatgpt_subscription';
    const model = process.env.ONBOARDING_SUBSCRIPTION_MODEL || 'gpt-5.4';
    const client = makeWorkerClient(workerUrl, workerSecret, model, provider, userId, 'onboarding');
    const parsed = await parseResumeSetup(resumeText, client);
    const doc = parsed.resume;
    const setup = deriveOnboarding(doc, parsed.workAuthorization);
    const resumePath = 'base/original.pdf';

    const { error: uploadError } = await db.storage.from('resumes').upload(resumePath, buffer, {
      contentType: 'application/pdf', upsert: true,
    });
    if (uploadError) throw new Error(`Could not store résumé PDF: ${uploadError.message}`);

    const { error: profileError } = await db.from('profile').update({
      base_resume: doc,
      resume_text: setup.resumeText,
      resume_pdf_path: resumePath,
      personal: setup.personal,
      experience: setup.experience,
      skills_boundary: setup.skillsBoundary,
      work_authorization: setup.workAuthorization,
      assistant_profile: setup.assistantProfile,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if (profileError) throw new Error(`Could not initialize profile: ${profileError.message}`);

    const settingsPatch: Record<string, unknown> = {
      skills: setup.settings.skills,
      keyword_options: setup.settings.keyword_options,
      location_options: setup.settings.location_options,
      auto_scrape_enabled: false,
      updated_at: new Date().toISOString(),
    };
    if (setup.settings.keywords.length) settingsPatch.keywords = setup.settings.keywords;
    if (setup.settings.locations.length) settingsPatch.locations = setup.settings.locations;
    const { error: settingsError } = await db.from('settings').update(settingsPatch).eq('id', 1);
    if (settingsError) throw new Error(`Could not initialize settings: ${settingsError.message}`);

    const { error: userError } = await db.from('app_users').update({
      onboarding_complete: true, updated_at: new Date().toISOString(),
    }).eq('id', userId);
    if (userError) throw new Error(`Could not finish onboarding: ${userError.message}`);

    return NextResponse.json({
      ok: true,
      profile: { name: doc.basics.name || '', target_role: setup.experience.target_role, skills: setup.settings.skills },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
