/**
 * "Monthly work-day summary" panel — ported from renderFairness().
 */
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const data = buildFairnessData(y, m, config, result, t);

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: ROSTER_TOKENS.line, background: ROSTER_TOKENS.surface }}>
      <h3 className="text-sm font-semibold mb-1">{t('dutyRoster.fairnessPanel.title')}</h3>
      <p className="text-xs mb-3" style={{ color: ROSTER_TOKENS.muted }}>
        {data.subtitle}
      </p>
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr style={{ color: ROSTER_TOKENS.muted }}>
            <th className="text-left font-medium py-1">{t('dutyRoster.fairnessPanel.guardColumn')}</th>
            <th className="text-left font-medium py-1">{t('dutyRoster.fairnessPanel.daysWorkedColumn')}</th>
            <th className="text-left font-medium py-1">{t('dutyRoster.fairnessPanel.normalDaysColumn')}</th>
            <th className="text-left font-medium py-1">{t('dutyRoster.fairnessPanel.restDaysColumn')}</th>
            <th className="text-left font-medium py-1">{t('dutyRoster.fairnessPanel.workedOnRestDayColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {!data.rows.length ? (
            <tr>
              <td colSpan={5} className="py-2 text-center" style={{ color: ROSTER_TOKENS.muted }}>
                {t('dutyRoster.fairnessPanel.emptyMessage')}
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
