export default function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className="text-2xl font-semibold mt-1 tabular-nums"
        style={{ color: accent || '#0b0b0b' }}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}
