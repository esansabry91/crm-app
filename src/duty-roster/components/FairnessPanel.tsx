/**
 * "Monthly work-day summary" panel — ported from renderFairness().
 */
import type { GenerateMonthResult } from "../types";
import type { GenerateMonthConfig } from "../schedulingEngine";
import { buildFairnessData } from "../fairnessData";
import { ROSTER_TOKENS } from "../rosterColors";

export interface FairnessPanelProps {
  y: number;
  m: number;
  config: GenerateMonthConfig;
  result: GenerateMonthResult;
}

export default function FairnessPanel({ y, m, config, result }: FairnessPanelProps) {
  const data = buildFairnessData(y, m, config, result);

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: ROSTER_TOKENS.line, background: ROSTER_TOKENS.surface }}>
      <h3 className="text-sm font-semibold mb-1">Monthly work-day summary</h3>
      <p className="text-xs mb-3" style={{ color: ROSTER_TOKENS.muted }}>
        {data.subtitle}
      </p>
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr style={{ color: ROSTER_TOKENS.muted }}>
            <th className="text-left font-medium py-1">Guard</th>
            <th className="text-left font-medium py-1">Days worked</th>
            <th className="text-left font-medium py-1">Normal days</th>
            <th className="text-left font-medium py-1">Rest days</th>
            <th className="text-left font-medium py-1">Worked on rest day</th>
          </tr>
        </thead>
        <tbody>
          {!data.rows.length ? (
            <tr>
              <td colSpan={5} className="py-2 text-center" style={{ color: ROSTER_TOKENS.muted }}>
                Add guards to see the work-day summary.
              </td>
            </tr>
          ) : (
            data.rows.map((row) => (
              <tr key={row.guardId} style={{ borderTop: `1px solid ${ROSTER_TOKENS.line}` }}>
                <td className="py-1">{row.guardName}</td>
                <td className="py-1 font-mono">{row.worked}</td>
                <td className="py-1 font-mono">{row.normal}</td>
                <td className="py-1 font-mono">{row.restDays}</td>
                <td className="py-1 font-mono">{row.onRestDay ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
