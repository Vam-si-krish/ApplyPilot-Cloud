'use client';

import { Target } from 'lucide-react';

/** Color the skill-match % by strength (ADR 0018): strong/partial/weak. */
function tone(score: number): string {
  if (score >= 70) return 'bg-emerald/10 border-emerald/25 text-emerald';
  if (score >= 40) return 'bg-amber-500/10 border-amber-500/25 text-amber-400';
  return 'bg-raised border-ink text-slate-muted';
}

/**
 * How many of the user's listed skills the job mentions (actor resumeKeywords).
 * A free, no-LLM signal — distinct from the AI fit score and the keyword pre-screen.
 */
export default function SkillMatchBadge({
  score,
  matched,
  className = '',
}: {
  score: number;
  matched?: string[] | null;
  className?: string;
}) {
  const list = (matched ?? []).slice(0, 8).join(', ');
  return (
    <span
      title={`Skill match — ${score}% of your skills appear in this job${list ? ` (matched: ${list})` : ''}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${tone(score)} ${className}`}
    >
      <Target size={10} /> {score}%
    </span>
  );
}
