'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Briefcase, History, Bot, Mail, TrendingUp, User, Settings as SettingsIcon, FileText, Zap, LogOut, Menu, X } from 'lucide-react';

// Ported from ApplyPilot-Lite/ui/src/components/Layout.tsx (ADR 0002). No
// LinkedIn/Pipeline tabs — Cloud fetches via Apify on a schedule, not manually.
const navGroups: { title: string; items: { to: string; label: string; icon: typeof Briefcase }[] }[] = [
  {
    title: 'Pipeline',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/jobs', label: 'Jobs', icon: Briefcase },
      { to: '/applications', label: 'Tailor & Apply', icon: FileText },
      { to: '/past', label: 'Past Jobs', icon: History },
    ],
  },
  {
    title: 'Follow-up',
    items: [
      { to: '/inbox', label: 'Inbox', icon: Mail },
      { to: '/tracker', label: 'Tracker', icon: TrendingUp },
      { to: '/assistant', label: 'Assistant', icon: Bot },
    ],
  },
  {
    title: 'Setup',
    items: [
      { to: '/profile', label: 'Profile', icon: User },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];

interface Stats {
  total: number;
  scored: number;
  shortlisted: number;
  unscored: number;
  applied: number;
}

function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const box = size === 'md' ? 'w-8 h-8 rounded-[10px]' : 'w-6 h-6 rounded-lg';
  const icon = size === 'md' ? 15 : 12;
  return (
    <div className={`${box} bg-gradient-to-br from-sky/25 via-sky/10 to-iris/25 border border-sky/30 flex items-center justify-center shadow-glow-sky`}>
      <Zap size={icon} className="text-sky" fill="currentColor" fillOpacity={0.35} />
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false); // mobile nav drawer

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

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-void">
      {/* Backdrop behind the mobile drawer */}
      {drawerOpen && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setDrawerOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col border-r border-ink-subtle bg-base/95 backdrop-blur transform transition-transform duration-200 lg:static lg:w-56 lg:translate-x-0 lg:z-auto ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 pt-5 pb-4 flex items-start justify-between">
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <BrandMark />
            <div>
              <span className="font-display font-bold text-slate-text text-[15px] tracking-tight group-hover:text-sky transition-colors">
                ApplyPilot
              </span>
              <p className="text-slate-dim text-[10px] font-mono leading-tight">cloud · v0.1.0</p>
            </div>
          </Link>
          <button onClick={() => setDrawerOpen(false)} className="lg:hidden text-slate-muted hover:text-slate-text -mr-1 mt-1" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 pb-3 px-3 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.title} className="mt-4 first:mt-1">
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-dim">{group.title}</p>
              <div className="space-y-0.5">
                {group.items.map(({ to, label, icon: Icon }) => {
                  const isActive = pathname === to || pathname.startsWith(to + '/');
                  return (
                    <Link
                      key={to}
                      href={to}
                      onClick={() => setDrawerOpen(false)}
                      className={`relative flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] font-medium transition-all ${
                        isActive
                          ? 'bg-gradient-to-r from-sky/15 to-sky/5 text-sky'
                          : 'text-slate-muted hover:text-slate-text hover:bg-raised/70'
                      }`}
                    >
                      {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-gradient-to-b from-sky to-iris" />}
                      <Icon size={15} strokeWidth={isActive ? 2.2 : 1.8} />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {stats && (
          <div className="mx-3 mb-2 rounded-xl border border-ink-subtle bg-card/80 px-3.5 py-3">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-dim">Pipeline</span>
              <span className="font-mono text-[10px] text-slate-muted">
                {stats.scored}<span className="text-slate-dim">/{stats.total} scored</span>
              </span>
            </div>
            <div className="h-1 rounded-full bg-ink-subtle overflow-hidden mb-2.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky to-iris transition-all duration-700"
                style={{ width: `${stats.total ? Math.round((stats.scored / stats.total) * 100) : 0}%` }}
              />
            </div>
            <div className="space-y-1.5">
              <Stat label="Discovered" value={stats.total} />
              <Stat label="Shortlisted" value={stats.shortlisted} color="text-sky" />
              <Stat label="Applied" value={stats.applied} color="text-emerald" />
              {stats.unscored > 0 && <Stat label="To score" value={stats.unscored} color="text-amber" pulse />}
            </div>
          </div>
        )}

        <button
          onClick={logout}
          className="mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-slate-muted hover:text-rose hover:bg-rose/10 transition-all"
        >
          <LogOut size={14} /> Sign out
        </button>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar with hamburger */}
        <header className="lg:hidden flex items-center gap-3 h-14 px-4 border-b border-ink-subtle bg-base/90 backdrop-blur shrink-0">
          <button onClick={() => setDrawerOpen(true)} className="text-slate-text hover:text-sky" aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <BrandMark size="sm" />
            <span className="font-display font-bold text-slate-text text-[14px] tracking-tight">ApplyPilot</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-void animate-fade-in">{children}</main>
      </div>
    </div>
  );
}

function Stat({ label, value, color = 'text-slate-text', pulse = false }: { label: string; value: number; color?: string; pulse?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-muted text-[11px]">{label}</span>
      <span className={`font-mono text-[12px] font-medium ${color} ${pulse ? 'animate-pulse-slow' : ''}`}>{value}</span>
    </div>
  );
}
