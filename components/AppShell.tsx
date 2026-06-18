'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Briefcase, History, Bot, User, Settings as SettingsIcon, Zap, LogOut } from 'lucide-react';

// Ported from ApplyPilot-Lite/ui/src/components/Layout.tsx (ADR 0002). No
// LinkedIn/Pipeline tabs — Cloud fetches via Apify on a schedule, not manually.
const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/past', label: 'Past Jobs', icon: History },
  { to: '/assistant', label: 'Assistant', icon: Bot },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

interface Stats {
  total: number;
  scored: number;
  shortlisted: number;
  unscored: number;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch('/api/stats')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => active && d && setStats(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [pathname]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-void">
      <aside className="w-52 flex-shrink-0 flex flex-col border-r border-ink bg-base">
        <div className="px-5 pt-6 pb-5 border-b border-ink-subtle">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-sky-glow border border-sky/30 flex items-center justify-center">
              <Zap size={14} className="text-sky" />
            </div>
            <span className="font-display font-bold text-slate-text text-[15px] tracking-tight">ApplyPilot</span>
          </div>
          <p className="text-slate-muted text-[11px] mt-1 font-mono">cloud · v0.1.0</p>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon }) => {
            const isActive = pathname === to || pathname.startsWith(to + '/');
            return (
              <Link
                key={to}
                href={to}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-all ${
                  isActive
                    ? 'bg-sky-glow text-sky border border-sky/20'
                    : 'text-slate-muted hover:text-slate-text hover:bg-raised'
                }`}
              >
                <Icon size={15} />
                {label}
              </Link>
            );
          })}
        </nav>

        {stats && (
          <div className="px-4 py-4 border-t border-ink-subtle space-y-2">
            <Stat label="Discovered" value={stats.total} />
            <Stat label="Scored" value={stats.scored} color="text-sky" />
            <Stat label="Shortlisted" value={stats.shortlisted} color="text-emerald" />
            {stats.unscored > 0 && <Stat label="To score" value={stats.unscored} color="text-amber" />}
          </div>
        )}

        <button
          onClick={logout}
          className="m-3 flex items-center gap-2 px-3 py-2 rounded-md text-[12px] text-slate-muted hover:text-rose hover:bg-raised transition-all"
        >
          <LogOut size={14} /> Sign out
        </button>
      </aside>

      <main className="flex-1 overflow-y-auto bg-void animate-fade-in">{children}</main>
    </div>
  );
}

function Stat({ label, value, color = 'text-slate-text' }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-muted text-[11px]">{label}</span>
      <span className={`font-mono text-[12px] font-medium ${color}`}>{value}</span>
    </div>
  );
}
