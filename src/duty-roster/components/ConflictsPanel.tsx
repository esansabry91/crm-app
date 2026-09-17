/**
 * "Unfilled & flagged shifts" panel — ported from renderConflicts().
 */
import type { MonthState, GenerateMonthResult } from "../types";
import type { GenerateMonthConfig } from "../schedulingEngine";
import { buildConflictItems } from "../conflictsData";
import { ROSTER_TOKENS } from "../rosterColors";

export interface ConflictsPanelProps {
  config: GenerateMonthConfig;
  ms: MonthState;
  result: GenerateMonthResult;
}

export default function ConflictsPanel({ config, ms, result }: ConflictsPanelProps) {
  const items = buildConflictItems(config, ms, result);

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: ROSTER_TOKENS.line, background: ROSTER_TOKENS.surface }}>
      <h3 className="text-sm font-semibold mb-2">Unfilled &amp; flagged shifts</h3>
      {items.length ? (
        <div className="flex flex-col gap-1.5">
          {items.map((item, i) => (
            <div key={i} className="text-xs rounded px-2 py-1.5" style={{ background: ROSTER_TOKENS.surface2 }}>
              {item.before}
              <strong>{item.shiftLabel}</strong>
              {item.after}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs" style={{ color: ROSTER_TOKENS.muted }}>
          No conflicts — the roster is fully staffed and rule-compliant.
        </p>
      )}
    </div>
  );
}
