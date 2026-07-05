/** Score chip. Color reads by quality: ≥7 strong (green), 5–6 moderate (amber), <5 weak (red). */
export default function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <div className="w-8 h-8 rounded-[10px] bg-raised/60 border border-ink flex items-center justify-center text-slate-dim text-[11px] font-mono">
        –
      </div>
    );
  }
  const color =
    score >= 7
      ? 'text-emerald border-emerald/40 bg-gradient-to-br from-emerald/20 to-emerald/5 shadow-[0_0_14px_-2px_rgba(52,211,153,0.35)]'
      : score >= 5
        ? 'text-amber border-amber/30 bg-gradient-to-br from-amber/15 to-amber/5'
        : 'text-rose border-rose/30 bg-gradient-to-br from-rose/15 to-rose/5';
  return (
    <div className={`w-8 h-8 rounded-[10px] border flex items-center justify-center text-[12px] font-mono font-semibold ${color}`}>
      {score}
    </div>
  );
}
