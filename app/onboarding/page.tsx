'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, FileText, Loader2, RefreshCw, ShieldCheck, Upload } from 'lucide-react';

type Status = { username?: string; display_name?: string; onboarding_complete?: boolean };

export default function OnboardingPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ name?: string; target_role?: string; skills?: string[] } | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const response = await fetch('/api/onboarding', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load your workspace.');
      setStatus(body);
    } catch {
      setStatus(null);
      setStatusError('ApplyPilot cannot reach your workspace right now. Your saved profile and résumé have not been changed.');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (status?.onboarding_complete && !result) router.replace('/dashboard');
  }, [result, router, status?.onboarding_complete]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setLoading(true);
    setError('');
    const form = new FormData();
    form.set('resume', file);
    try {
      const response = await fetch('/api/onboarding', { method: 'POST', body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Onboarding failed');
      setResult(body.profile || {});
      setStatus((current) => ({ ...current, onboarding_complete: true }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  const complete = status?.onboarding_complete || result;
  return (
    <main className="min-h-screen bg-void px-4 py-12 text-slate-text">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-sky/30 bg-sky/10">
            <FileText className="text-sky" />
          </div>
          <h1 className="font-display text-3xl font-bold">Set up your private workspace</h1>
          <p className="mt-2 text-sm text-slate-muted">Signed in as {status?.display_name || status?.username || 'your account'}</p>
        </div>

        <section className="card space-y-5 p-6">
          {statusLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-muted">
              <Loader2 size={17} className="animate-spin text-sky" /> Loading your workspace…
            </div>
          ) : statusError ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-rose/25 bg-rose/10 p-4">
                <AlertCircle className="mt-0.5 shrink-0 text-rose" size={20} />
                <div>
                  <h2 className="font-semibold">Workspace temporarily unavailable</h2>
                  <p className="mt-1 text-sm text-slate-muted">{statusError}</p>
                  <p className="mt-2 text-xs text-slate-dim">Do not upload your résumé again. Retry after the server connection is restored.</p>
                </div>
              </div>
              <button onClick={() => void loadStatus()} className="btn-primary w-full py-3">
                <RefreshCw size={16} /> Retry connection
              </button>
            </div>
          ) : complete ? (
            <>
              <div className="flex items-start gap-3 rounded-xl border border-emerald/25 bg-emerald/10 p-4">
                <ShieldCheck className="mt-0.5 text-emerald" size={20} />
                <div><h2 className="font-semibold">Your workspace is ready</h2><p className="mt-1 text-sm text-slate-muted">Your résumé, profile, search roles, skills, and AI context are isolated to this account.</p></div>
              </div>
              {result && <p className="text-sm text-slate-muted">Loaded {result.name || 'your résumé'}{result.target_role ? ` · ${result.target_role}` : ''} · {result.skills?.length || 0} skills.</p>}
              <button onClick={() => router.push('/settings')} className="btn-primary w-full py-3">
                Add your Apify and AI keys <ArrowRight size={16} />
              </button>
              <button onClick={() => router.push('/dashboard')} className="w-full text-sm text-slate-muted hover:text-slate-text">Continue to dashboard</button>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div>
                <h2 className="font-semibold">Upload your résumé PDF</h2>
                <p className="mt-1 text-sm text-slate-muted">Your PDF is stored in your private file namespace. The server subscription is used once to faithfully structure it—no facts are invented. Work authorization is copied only when the PDF states it explicitly; review it later under Candidate Profile → Eligibility.</p>
              </div>
              <label className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-ink p-8 text-center hover:border-sky/50">
                <Upload className="mb-3 text-sky" />
                <span className="text-sm font-medium">{file?.name || 'Choose a text-based PDF'}</span>
                <span className="mt-1 text-xs text-slate-dim">Maximum 10 MB</span>
                <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              </label>
              {error && <p className="rounded-lg border border-rose/25 bg-rose/10 px-3 py-2 text-sm text-rose">{error}</p>}
              <button disabled={!file || loading} className="btn-primary w-full py-3 disabled:opacity-50">
                {loading ? <><Loader2 size={16} className="animate-spin" /> Reading and setting up…</> : <>Build my profile <ArrowRight size={16} /></>}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
