/**
 * Shrinks the value's font size as it gets longer, so a big RM figure ("RM 6,846,569") sizes down
 * to fit a narrow tile instead of wrapping mid-number ("RM 6,846" / ",569") — which reads as
 * broken data, not a big number. Short values (plain counts like "12") stay at full size. Tuned
 * against this component's own px-4 tile width, not any one page's grid.
 */
function valueSizeClass(value: string): string {
  if (value.length <= 6) return 'text-2xl';
  if (value.length <= 9) return 'text-xl';
  if (value.length <= 13) return 'text-lg';
  if (value.length <= 17) return 'text-base';
  return 'text-sm';
}

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
        className={`${valueSizeClass(value)} font-semibold mt-1 tabular-nums leading-tight`}
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
