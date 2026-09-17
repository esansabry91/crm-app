import type { MonthState } from "../types";
import { fmtLogTime } from "../rosterModel";

/** "Change log" panel (renderLog(), index.html lines 4749-4756) — most-recent-first. */
export interface LogPanelProps {
  ms: MonthState;
}

export default function LogPanel({ ms }: LogPanelProps) {
  const entries = [...ms.log].reverse();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Change log</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-400 mt-2">No changes logged yet.</p>
      ) : (
        <div className="flex flex-col gap-1 mt-3 max-h-96 overflow-y-auto">
          {entries.map((e, i) => (
            <div key={i} className="text-xs text-slate-600">
              <span className="font-mono text-slate-400 mr-2">{fmtLogTime(e.ts)}</span>
              {e.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
