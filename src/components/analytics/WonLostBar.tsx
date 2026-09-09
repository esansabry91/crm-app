import { VIZ } from '../../utils/vizColors';

export default function WonLostBar({ wonCount, lostCount }: { wonCount: number; lostCount: number }) {
  const total = wonCount + lostCount;
  const wonPct = total > 0 ? (wonCount / total) * 100 : 0;
  const lostPct = total > 0 ? (lostCount / total) * 100 : 0;

  return (
    <div>
      <div className="flex h-8 rounded-lg overflow-hidden bg-slate-100">
        {wonCount > 0 && (
          <div
            className="flex items-center justify-center text-xs font-medium text-white"
            style={{ width: `${wonPct}%`, backgroundColor: VIZ.status.good }}
          >
            {wonPct >= 12 && `${wonCount} Won`}
          </div>
        )}
        {wonCount > 0 && lostCount > 0 && <div className="w-0.5 bg-white" />}
        {lostCount > 0 && (
          <div
            className="flex items-center justify-center text-xs font-medium text-white"
            style={{ width: `${lostPct}%`, backgroundColor: VIZ.status.critical }}
          >
            {lostPct >= 12 && `${lostCount} Lost`}
          </div>
        )}
        {total === 0 && (
          <div className="w-full flex items-center justify-center text-xs text-slate-400">
            No closed tenders yet
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: VIZ.status.good }} />
          Won: {wonCount}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: VIZ.status.critical }} />
          Lost: {lostCount}
        </span>
      </div>
    </div>
  );
}
