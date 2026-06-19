'use client';

import { useEffect, useState } from 'react';
import { Star, CheckCircle2, ExternalLink, Archive, Trash2, ChevronDown, ChevronRight, HelpCircle, Target } from 'lucide-react';
import ScoreBadge from '@/components/ScoreBadge';
import CompanyTierBadge from '@/components/CompanyTierBadge';

/**
 * A collapsible key that decodes the icons, colours, and badges used in job rows
 * so a first-time user isn't guessing. Defaults open; remembers when dismissed.
 */
export default function JobsLegend() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    setOpen(localStorage.getItem('jobsLegendCollapsed') !== '1');
  }, []);
  function toggle() {
    setOpen((o) => {
      localStorage.setItem('jobsLegendCollapsed', o ? '1' : '0');
      return !o;
    });
  }

  return (
    <div className="bg-card border border-ink rounded-xl mb-4 overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-raised transition-colors">
        <HelpCircle size={14} className="text-sky" />
        <span className="text-[12px] font-medium text-slate-text">What the icons &amp; colours mean</span>
        <span className="ml-auto text-slate-muted">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5 border-t border-ink-subtle">
          <Item>
            <ScoreBadge score={9} />
            <Text title="Fit score (1–10)">AI match to your résumé. Green ≥8 strong · amber 6–7 decent · red &lt;6 weak · “–” not scored yet.</Text>
          </Item>
          <Item>
            <span className="text-[11px] text-slate-muted whitespace-nowrap">35% match</span>
            <Text title="Pre-screen %">Quick résumé keyword overlap, used to skip clearly-irrelevant jobs before AI scoring.</Text>
          </Item>
          <Item>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border bg-emerald/10 border-emerald/25 text-emerald whitespace-nowrap">
              <Target size={10} /> 67%
            </span>
            <Text title="Skill match">How many of your listed skills the job mentions (Settings → Skills). Filter by it, incl. “No skill match”.</Text>
          </Item>
          <Item>
            <div className="flex gap-1">
              <CompanyTierBadge tier="good" />
              <CompanyTierBadge tier="low" />
            </div>
            <Text title="Company rating (AI)">Employer quality: Good · Medium · Low (likely time-waster) · Unknown. Hover a badge for why.</Text>
          </Item>
          <Item>
            <CheckCircle2 size={15} className="text-emerald" />
            <Text title="Applied">You marked this job as applied.</Text>
          </Item>
          <Item>
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/10 border border-violet-500/25 text-violet-300 rounded">Opened</span>
            <Text title="Opened">You clicked the apply link (row tinted violet) but haven&apos;t marked it applied — your place-marker.</Text>
          </Item>
          <Item>
            <Star size={15} className="text-emerald" fill="currentColor" />
            <Text title="Shortlisted">Starred — click the star on any row to shortlist it.</Text>
          </Item>
          <Item>
            <div className="flex gap-1">
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-emerald/10 border border-emerald/25 text-emerald rounded">Easy Apply</span>
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 border border-amber-500/25 text-amber-400 rounded">External</span>
            </div>
            <Text title="Apply type">Easy Apply = one-click on LinkedIn · External = apply on the company / another site.</Text>
          </Item>
          <Item>
            <span className="text-[11px] text-slate-muted">Filtered</span>
            <Text title="Status: Filtered">Pre-screened out before AI scoring (low keyword match). “Archived” = hidden/skipped.</Text>
          </Item>
          <Item>
            <div className="flex items-center gap-2 text-slate-muted">
              <ExternalLink size={15} />
              <Archive size={15} />
              <Trash2 size={15} />
            </div>
            <Text title="Row actions">Open posting · Archive (hide) · Delete permanently.</Text>
          </Item>
        </div>
      )}
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return <div className="flex items-start gap-2.5 pt-2">{children}</div>;
}

function Text({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-slate-muted leading-snug">
      <span className="text-slate-text font-medium">{title}:</span> {children}
    </p>
  );
}
