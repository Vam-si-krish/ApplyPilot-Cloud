'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Lock } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
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
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        router.push('/dashboard');
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
    <div className="flex h-screen items-center justify-center bg-void">
      <form onSubmit={submit} className="w-80 bg-card border border-ink rounded-2xl p-7 animate-slide-up">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-md bg-sky-glow border border-sky/30 flex items-center justify-center">
            <Zap size={16} className="text-sky" />
          </div>
          <span className="font-display font-bold text-slate-text text-lg tracking-tight">ApplyPilot</span>
        </div>

        <label className="text-[11px] text-slate-muted uppercase tracking-wider font-medium">Password</label>
        <div className="relative mt-1.5 mb-1">
          <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-muted" />
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-raised border border-ink focus:border-sky/40 outline-none rounded-lg text-[14px] text-slate-text"
          />
        </div>

        {error && <p className="text-rose text-[12px] mt-2">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-4 w-full py-2.5 bg-sky/10 text-sky border border-sky/30 hover:bg-sky/20 disabled:opacity-40 rounded-lg text-[13px] font-medium transition-all"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
