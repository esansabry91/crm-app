export default function StatCard({
  label,
  value,
  sub,
  accent,
  action,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  /** Optional small link/button rendered under the tile, e.g. to jump to a filtered list. */
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3.5">
      <p className="text-xs font-medium text-slate-500 leading-4 min-h-[2rem]">{label}</p>
      <p
        className="text-2xl font-semibold mt-1 tabular-nums"
        style={{ color: accent || '#0b0b0b' }}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      {action && (
        <button
          onClick={action.onClick}
          disabled={action.disabled}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-300 disabled:cursor-not-allowed mt-1.5 underline underline-offset-2"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
