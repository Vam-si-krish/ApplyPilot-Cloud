'use client';

import { useEffect, useState } from 'react';
import { Save, CheckCircle, AlertCircle } from 'lucide-react';
import type { Profile } from '@/lib/types';
import BaseResumeEditor from '@/components/BaseResumeEditor';

type Tab = 'resume' | 'eligibility' | 'answers' | 'prompts' | 'personal' | 'skills';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Form = any;

export default function ProfilePage() {
  const [tab, setTab] = useState<Tab>('resume');
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load once; sync remote → local via effect (never setState during render —
  // that loops when the fetched value equals current state; the bug the brief flagged).
  useEffect(() => {
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : {}))
      .then((p: Partial<Profile>) => setForm(structuredClone(p ?? {})))
      .catch(() => setForm({}));
  }, []);

  function set(path: string, value: unknown) {
    const parts = path.split('.');
    const clone = structuredClone(form ?? {});
    let cur = clone;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    setForm(clone);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Could not save candidate profile (${response.status})`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <div className="p-4 sm:p-6 lg:p-7">
        <div className="h-8 w-40 bg-raised rounded animate-pulse mb-6" />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 bg-card border border-ink rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'resume', label: 'Résumé' },
    { id: 'eligibility', label: 'Eligibility' },
    { id: 'answers', label: 'Application Answers' },
    { id: 'prompts', label: 'AI Guidance' },
    { id: 'personal', label: 'Personal' },
    { id: 'skills', label: 'Skills' },
  ];

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8 animate-slide-up">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title text-2xl">Candidate Profile</h1>
          <p className="page-sub">
            The one place to manage the résumé and candidate facts used by scoring, tailoring, cover letters, and ApplyBuddy.
          </p>
        </div>
        {saved && (
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald/25 bg-emerald/10 px-3 py-1.5 text-[13px] text-emerald animate-fade-in">
            <CheckCircle size={14} /> Saved
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1 mb-5 border-b border-ink">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative px-4 py-2 text-[13px] font-medium -mb-px transition-all ${
              tab === t.id ? 'text-sky' : 'text-slate-muted hover:text-slate-text'
            }`}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-sky to-iris" />}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose/30 bg-rose/10 px-3.5 py-3 text-[12px] text-rose">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="animate-slide-up">
        {tab === 'resume' && <BaseResumeEditor />}

        {tab === 'personal' && (
          <div className="space-y-4">
            <div className="card p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full Name" value={form.personal?.full_name} onChange={(v) => set('personal.full_name', v)} />
              <Field label="Email" value={form.personal?.email} onChange={(v) => set('personal.email', v)} />
              <Field label="Phone" value={form.personal?.phone} onChange={(v) => set('personal.phone', v)} />
              <Field label="City" value={form.personal?.city} onChange={(v) => set('personal.city', v)} />
              <Field label="LinkedIn URL" value={form.personal?.linkedin_url} onChange={(v) => set('personal.linkedin_url', v)} />
              <Field label="GitHub URL" value={form.personal?.github_url} onChange={(v) => set('personal.github_url', v)} />
            </div>
            <div className="card p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Years of Experience" value={form.experience?.years_of_experience_total} onChange={(v) => set('experience.years_of_experience_total', v)} />
              <Field label="Target Role" value={form.experience?.target_role} onChange={(v) => set('experience.target_role', v)} />
              <Field label="Education Level" value={form.experience?.education_level} onChange={(v) => set('experience.education_level', v)} />
            </div>
            <div className="card p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Min Salary ($)" value={form.compensation?.salary_range_min} onChange={(v) => set('compensation.salary_range_min', v)} />
              <Field label="Max Salary ($)" value={form.compensation?.salary_range_max} onChange={(v) => set('compensation.salary_range_max', v)} />
            </div>
            <SaveBtn onClick={save} loading={saving} />
          </div>
        )}

        {tab === 'eligibility' && (
          <div className="space-y-4">
            <p className="text-[12px] text-slate-muted">
              These factual answers drive eligibility scoring and ApplyBuddy. Blank means unknown. Avoidance switches are your preferences, even when you are technically eligible.
            </p>
            <div className="card p-5 space-y-4">
              <TriState
                label="Legally authorized to work in US"
                value={form.work_authorization?.legally_authorized_to_work}
                onChange={(v) => set('work_authorization.legally_authorized_to_work', v)}
              />
              <TriState
                label="Requires visa sponsorship now or in the future"
                value={form.work_authorization?.require_sponsorship}
                onChange={(v) => set('work_authorization.require_sponsorship', v)}
              />
              <Field
                label="Work Permit Type (leave blank if none)"
                value={form.work_authorization?.work_permit_type}
                onChange={(v) => set('work_authorization.work_permit_type', v)}
              />
              <Field
                label="Citizenship / Residency (optional)"
                value={form.work_authorization?.citizenship_or_residency}
                onChange={(v) => set('work_authorization.citizenship_or_residency', v)}
              />
              <Field
                label="Security Clearance (optional)"
                value={form.work_authorization?.security_clearance}
                onChange={(v) => set('work_authorization.security_clearance', v)}
              />
              <TriState
                label="Willing / able to obtain a security clearance"
                value={form.work_authorization?.willing_to_obtain_clearance}
                onChange={(v) => set('work_authorization.willing_to_obtain_clearance', v)}
              />
              <div className="border-t border-ink pt-4 space-y-3">
                <CheckBox
                  label="Avoid every job that requires a security clearance"
                  checked={!!form.candidate_preferences?.avoid_security_clearance_jobs}
                  onChange={(v) => set('candidate_preferences.avoid_security_clearance_jobs', v)}
                />
                <CheckBox
                  label="Avoid citizenship, Green Card, or US-Person-restricted jobs"
                  checked={!!form.candidate_preferences?.avoid_citizenship_restricted_jobs}
                  onChange={(v) => set('candidate_preferences.avoid_citizenship_restricted_jobs', v)}
                />
              </div>
            </div>
            <SaveBtn onClick={save} loading={saving} />
          </div>
        )}

        {tab === 'answers' && (
          <div className="space-y-4">
            <p className="text-[12px] text-slate-muted">
              ApplyBuddy uses these stable answers for application forms, recruiter messages, and interview-screen questions. It still asks when a required fact is missing.
            </p>
            <div className="card p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TriState
                label="Willing to relocate"
                value={form.candidate_preferences?.application_answers?.willing_to_relocate}
                onChange={(v) => set('candidate_preferences.application_answers.willing_to_relocate', v)}
              />
              <Field
                label="Preferred work arrangement"
                value={form.candidate_preferences?.application_answers?.preferred_work_arrangement}
                onChange={(v) => set('candidate_preferences.application_answers.preferred_work_arrangement', v)}
                placeholder="Remote, hybrid, onsite, or flexible"
              />
              <Field
                label="Available start"
                value={form.candidate_preferences?.application_answers?.available_start}
                onChange={(v) => set('candidate_preferences.application_answers.available_start', v)}
                placeholder="Immediately, two weeks, a date…"
              />
              <Field
                label="Employment types accepted"
                value={form.candidate_preferences?.application_answers?.employment_types}
                onChange={(v) => set('candidate_preferences.application_answers.employment_types', v)}
                placeholder="Full-time, W2 contract, C2C…"
              />
              <Field
                label="Salary expectation"
                value={form.candidate_preferences?.application_answers?.salary_expectation}
                onChange={(v) => set('candidate_preferences.application_answers.salary_expectation', v)}
                placeholder="Range or preferred answer"
              />
            </div>
            <TextArea
              label="Other recurring application / interview facts"
              value={form.candidate_preferences?.application_answers?.additional_facts}
              onChange={(v) => set('candidate_preferences.application_answers.additional_facts', v)}
              placeholder="Certifications, travel availability, preferred name, portfolio context, or other truthful answers you want ApplyBuddy to know."
              rows={7}
            />
            <SaveBtn onClick={save} loading={saving} />
          </div>
        )}

        {tab === 'prompts' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-sky/20 bg-sky/5 px-4 py-3 text-[12px] text-slate-muted">
              Choose the trade-offs that fit your search, then add optional guidance in your own words. Safe controls are validated before saving; they cannot disable truthfulness, eligibility checks, score formatting, verified-fact protection, or résumé-length limits.
            </div>
            <div className="card p-5 space-y-4">
              <div>
                <h2 className="text-[14px] font-semibold text-slate-text">Résumé tailoring controls</h2>
                <p className="mt-1 text-[11px] text-slate-muted">These choices apply to every new tailored résumé. Existing generated files do not change until regenerated.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SelectField
                  label="Missing skills"
                  value={form.candidate_preferences?.skill_addition_mode ?? 'learnable'}
                  onChange={(v) => set('candidate_preferences.skill_addition_mode', v)}
                  help="Controls whether tailoring may add skills not already listed in your Base résumé."
                  options={[
                    ['evidenced_only', 'Base résumé skills only'],
                    ['adjacent_only', 'Closely adjacent skills'],
                    ['learnable', 'Adjacent or quickly learnable'],
                  ]}
                />
                <SelectField
                  label="Quick-learning window"
                  value={String(form.candidate_preferences?.skill_learning_horizon_days ?? 15)}
                  onChange={(v) => set('candidate_preferences.skill_learning_horizon_days', Number(v))}
                  help="Used only when quickly learnable skills are allowed. It never permits unrelated or implausible skills."
                  disabled={(form.candidate_preferences?.skill_addition_mode ?? 'learnable') !== 'learnable'}
                  options={[
                    ['7', '7 days'],
                    ['15', '15 days (default)'],
                    ['30', '30 days'],
                    ['60', '60 days'],
                  ]}
                />
                <SelectField
                  label="Job-title alignment"
                  value={form.candidate_preferences?.title_alignment ?? 'honest_reframe'}
                  onChange={(v) => set('candidate_preferences.title_alignment', v)}
                  help="Honest reframing can align the discipline, such as Software Engineer to Frontend Engineer, but never invents a promotion."
                  options={[
                    ['preserve', 'Keep every Base résumé title'],
                    ['honest_reframe', 'Honestly align discipline (default)'],
                  ]}
                />
                <SelectField
                  label="Supporting detail"
                  value={form.candidate_preferences?.evidence_standard ?? 'plausible_with_review'}
                  onChange={(v) => set('candidate_preferences.evidence_standard', v)}
                  help="Strict mode rephrases only stated facts. Review mode may draft plausible detail and must disclose material additions for your approval."
                  options={[
                    ['base_only', 'Only facts already stated'],
                    ['plausible_with_review', 'Plausible detail, show for review (default)'],
                  ]}
                />
              </div>
              <div className="border-t border-ink pt-4">
                <CheckBox
                  label="Use each job's listed location on its newly tailored résumé"
                  checked={!!form.candidate_preferences?.use_job_location_on_tailored_resume}
                  onChange={(v) => set('candidate_preferences.use_job_location_on_tailored_resume', v)}
                />
                <p className="mt-1.5 pl-6 text-[11px] text-slate-muted">
                  Off by default. When enabled, only the generated copy changes; your Base résumé and saved home location stay untouched.
                </p>
              </div>
            </div>
            <div className="card p-5 space-y-4">
              <div>
                <h2 className="text-[14px] font-semibold text-slate-text">Job scoring controls</h2>
                <p className="mt-1 text-[11px] text-slate-muted">These choices affect new scores only. Hard eligibility blockers and missing core skills still follow the protected rubric.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SelectField
                  label="Experience shortfall tolerance"
                  value={String(form.candidate_preferences?.experience_shortfall_tolerance_years ?? 3)}
                  onChange={(v) => set('candidate_preferences.experience_shortfall_tolerance_years', Number(v))}
                  help="A required-years gap up to this size is treated as a small soft gap, never proof that you have those years."
                  options={[0, 1, 2, 3, 4, 5].map((n) => [String(n), `${n} year${n === 1 ? '' : 's'}${n === 3 ? ' (default)' : ''}`])}
                />
                <SelectField
                  label="Overqualification"
                  value={form.candidate_preferences?.overqualification_treatment ?? 'ignore'}
                  onChange={(v) => set('candidate_preferences.overqualification_treatment', v)}
                  help="A penalty is limited to a genuine seniority collision and can never create a hard rejection."
                  options={[
                    ['ignore', 'Do not penalize (default)'],
                    ['note', 'Mention it, keep score'],
                    ['small_penalty', 'Allow a small penalty'],
                  ]}
                />
                <SelectField
                  label="Contract and temporary roles"
                  value={form.candidate_preferences?.contract_role_treatment ?? 'neutral'}
                  onChange={(v) => set('candidate_preferences.contract_role_treatment', v)}
                  help="Avoid marks contract, C2C, 1099, temporary, and staffing-placement roles as score 1 by your explicit preference."
                  options={[
                    ['neutral', 'Score normally (default)'],
                    ['note', 'Flag it, keep fit score'],
                    ['avoid', 'Avoid these roles (score 1)'],
                  ]}
                />
              </div>
            </div>
            <TextArea
              label="Global scoring guidance"
              value={form.candidate_preferences?.scoring_instructions}
              onChange={(v) => set('candidate_preferences.scoring_instructions', v)}
              placeholder="Example: Prefer product companies and hands-on platform roles. Treat contract roles as acceptable, but note onsite requirements."
              rows={8}
            />
            <TextArea
              label="Global résumé-tailoring guidance"
              value={form.candidate_preferences?.tailoring_instructions}
              onChange={(v) => set('candidate_preferences.tailoring_instructions', v)}
              placeholder="Example: Lead with platform and API work, keep the summary direct, and avoid adding adjacent skills unless already demonstrated."
              rows={8}
            />
            <p className="text-[11px] text-slate-muted">Job-specific tailoring instructions in Tailor &amp; Apply are added after this global guidance.</p>
            <SaveBtn onClick={save} loading={saving} />
          </div>
        )}

        {tab === 'skills' && (
          <div className="space-y-4">
            <TagField label="Programming Languages" tags={form.skills_boundary?.programming_languages ?? []} onChange={(v) => set('skills_boundary.programming_languages', v)} />
            <TagField label="Frameworks" tags={form.skills_boundary?.frameworks ?? []} onChange={(v) => set('skills_boundary.frameworks', v)} />
            <TagField label="Tools" tags={form.skills_boundary?.tools ?? []} onChange={(v) => set('skills_boundary.tools', v)} />
            <SaveBtn onClick={save} loading={saving} />
          </div>
        )}

      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder = '' }: { label: string; value: unknown; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input" />
    </div>
  );
}

function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-[13px] text-slate-text">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-sky" />
      <span>{label}</span>
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder, rows }: { label: string; value: unknown; onChange: (v: string) => void; placeholder: string; rows: number }) {
  return (
    <div className="card p-5">
      <p className="label">{label}</p>
      <textarea
        value={(value as string) ?? ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={4000}
        className="input resize-y leading-relaxed"
      />
      <p className="mt-1 text-right font-mono text-[10px] text-slate-dim">{String(value ?? '').length}/4000</p>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  help,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help: string;
  options: string[][];
  disabled?: boolean;
}) {
  return (
    <label className={disabled ? 'opacity-50' : ''}>
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
      <span className="mt-1.5 block text-[11px] leading-relaxed text-slate-muted">{help}</span>
    </label>
  );
}

function TriState({ label, value, onChange }: { label: string; value: unknown; onChange: (v: boolean | null) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select
        className="input"
        value={value === true ? 'yes' : value === false ? 'no' : 'unknown'}
        onChange={(event) => onChange(event.target.value === 'yes' ? true : event.target.value === 'no' ? false : null)}
      >
        <option value="unknown">Not specified</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function TagField({ label, tags, onChange }: { label: string; tags: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');
  function add() {
    const v = input.trim();
    if (v && !tags.includes(v)) {
      onChange([...tags, v]);
      setInput('');
    }
  }
  return (
    <div className="card p-5">
      <p className="label mb-3">{label}</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1.5 px-2.5 py-1 bg-sky/10 border border-sky/20 text-sky text-[12px] rounded-lg">
            {t}
            <button onClick={() => onChange(tags.filter((x) => x !== t))} className="text-sky/50 hover:text-rose transition-colors leading-none">
              ×
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-[12px] text-slate-dim italic">No tags yet — add your first below.</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add tag…"
          className="input flex-1 py-1.5"
        />
        <button onClick={add} className="btn-primary px-3 py-1.5 text-[12px]">
          Add
        </button>
      </div>
    </div>
  );
}

function SaveBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} className="btn-primary px-5 py-2.5">
      <Save size={14} /> {loading ? 'Saving…' : 'Save Changes'}
    </button>
  );
}
