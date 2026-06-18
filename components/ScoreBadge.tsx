/** Score chip. Color reads by quality: ≥7 strong (green), 5–6 moderate (amber), <5 weak (red). */
export default function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <div className="w-8 h-8 rounded-lg bg-raised border border-ink flex items-center justify-center text-slate-muted text-[11px] font-mono">
        –
      </div>
    );
  }
  const color =
    score >= 7
      ? 'text-emerald border-emerald/30 bg-emerald/10'
      : score >= 5
        ? 'text-amber border-amber/30 bg-amber/10'
        : 'text-rose border-rose/30 bg-rose/10';
  return (
    <div className={`w-8 h-8 rounded-lg border flex items-center justify-center text-[11px] font-mono font-semibold ${color}`}>
      {score}
    </div>
  );
}
