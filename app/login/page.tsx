'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Lock, ArrowRight, User } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (r.ok) {
        router.push('/onboarding');
        router.refresh();
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d.error || 'Login failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-void px-4 overflow-hidden">
      {/* Hero aurora, stronger than the app-wide ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-20%] h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-sky/10 blur-[140px]" />
        <div className="absolute right-[10%] bottom-[-15%] h-[360px] w-[520px] rounded-full bg-iris/10 blur-[140px]" />
      </div>

      <div className="relative w-full max-w-sm animate-slide-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-sky/30 bg-gradient-to-br from-sky/25 via-sky/10 to-iris/25 shadow-glow-sky">
            <Zap size={26} className="text-sky" fill="currentColor" fillOpacity={0.35} />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-text">
            Apply<span className="text-gradient">Pilot</span>
          </h1>
          <p className="mt-1.5 text-[13px] text-slate-muted">
            Your job pipeline ran overnight. Sign in to review it.
          </p>
        </div>

        <form onSubmit={submit} className="card p-6">
          <label className="label" htmlFor="username">
            Username
          </label>
          <div className="relative mb-4">
            <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-dim" />
            <input
              id="username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              className="input py-2.5 pl-10 text-[14px]"
            />
          </div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <div className="relative">
            <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-dim" />
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input py-2.5 pl-10 text-[14px]"
            />
          </div>

          {error && (
            <p className="mt-3 rounded-lg border border-rose/25 bg-rose/10 px-3 py-2 text-[12px] text-rose animate-fade-in">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary group mt-5 w-full py-2.5 text-[14px]"
          >
            {loading ? 'Signing in…' : 'Sign in'}
            {!loading && <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />}
          </button>
        </form>

        <p className="mt-6 text-center font-mono text-[10px] tracking-wide text-slate-dim">
          fetch → score → shortlist · every morning
        </p>
      </div>
    </div>
  );
}
