import type { SiteConfig, MonthState, GenerateMonthResult, TenderRateConfig } from "../types";
import type { RosterSession } from "../rosterModel";
import { buildSummaryReportData, invoiceSummaryConfirmControls } from "../summaryReportData";
import { computeSummaryTotals } from "../payrollMath";

/**
 * Summary Report tab — Panel 1, "Summary report — home site view for invoice reference"
 * (index.html lines 699-728, renderSummaryReport()/renderInvoiceSummaryConfirmControls()).
 * Pure presentational: turns config/ms/result/rateConfig into the 15-column table plus the
 * Confirm/Unconfirm-for-invoicing controls. All Firestore-facing behavior (the actual persist +
 * the confirm/unconfirm click handlers) lives in the parent SummaryReportTab, matching every
 * other panel in this port (LeavePanel/SwapPanel/etc. all stay agnostic of persistence).
 */
export interface SummaryReportPanelProps {
  y: number;
  m: number;
  config: SiteConfig;
  ms: MonthState;
  result: GenerateMonthResult;
  rateConfig: TenderRateConfig | null;
  session: RosterSession;
  onConfirm: () => void;
  onUnconfirm: () => void;
}

const TH = ["Employee ID", "Guard", "Man-hours", "Normal worked days", "Worked rest days", "Worked public holidays", "Normal OT (hrs)", "Rest-day OT (hrs)", "Public holiday OT (hrs)", "MC", "Absent", "Leave", "Unpaid leave", "Rate (RM/manhour)", "Amount (RM)"];

export default function SummaryReportPanel({ y, m, config, ms, result, rateConfig, session, onConfirm, onUnconfirm }: SummaryReportPanelProps) {
  const data = buildSummaryReportData(y, m, config, ms, result, rateConfig);
  const totals = computeSummaryTotals(y, m, config, ms, result, rateConfig);
  const controls = invoiceSummaryConfirmControls(ms, session, totals);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">Summary report - home site view for invoice reference</h2>
      <p className="text-xs text-slate-500 mt-1">{data.subText}</p>

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200">
              {TH.map((h) => (
                <th key={h} className="text-left font-medium text-slate-500 py-1.5 pr-3 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!data.hasAnyRows && (
              <tr>
                <td colSpan={15} className="py-3 text-center text-slate-400">
                  Add guards to see the summary report.
                </td>
              </tr>
            )}
            {data.items.map((item) => {
              if (item.type === "divider") {
                return (
                  <tr key={item.id} className="bg-slate-50">
                    <td colSpan={15} className="font-semibold text-slate-700 pt-3 pb-1.5 px-1">
                      {item.label}
                    </td>
                  </tr>
                );
              }
              if (item.type === "guard") {
                const r = item.row;
                return (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="font-mono text-xs py-1.5 pr-3">{r.employeeId}</td>
                    <td className="py-1.5 pr-3">
                      {r.name} {r.nameSuffix && <span className="text-slate-400 text-xs">{r.nameSuffix}</span>}
                    </td>
                    <td className="font-mono py-1.5 pr-3">{r.manHours}</td>
                    <td className="font-mono py-1.5 pr-3">{r.normalDays}</td>
                    <td className="font-mono py-1.5 pr-3">{r.restDaysWorked}</td>
                    <td className="font-mono py-1.5 pr-3">{r.holidayDaysWorked}</td>
                    <td className="font-mono py-1.5 pr-3">{r.normalOTHours}</td>
                    <td className="font-mono py-1.5 pr-3">{r.restOTHours}</td>
                    <td className="font-mono py-1.5 pr-3">{r.holidayOTHours}</td>
                    <td className="font-mono py-1.5 pr-3">{r.mc}</td>
                    <td className="font-mono py-1.5 pr-3">{r.absent}</td>
                    <td className="font-mono py-1.5 pr-3">{r.leave}</td>
                    <td className="font-mono py-1.5 pr-3">{r.unpaidLeave}</td>
                    <td className="font-mono py-1.5 pr-3">{r.rate}</td>
                    <td className={"font-mono py-1.5 pr-3" + (r.amountLiteral ? " text-slate-400" : "")}>{r.amount}</td>
                  </tr>
                );
              }
              if (item.type === "additionalSubtotal") {
                return (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3"></td>
                    <td className="py-1.5 pr-3 font-semibold">Subtotal — Additional Guard (Temporary)</td>
                    <td className="font-mono py-1.5 pr-3 font-semibold">{item.manHours}</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="py-1.5 pr-3"></td>
                    <td className="font-mono py-1.5 pr-3 text-slate-400">see Branch Collection</td>
                  </tr>
                );
              }
              if (item.type === "rateSubtotal") {
                return (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3"></td>
                    <td className="py-1.5 pr-3">{item.label}</td>
                    <td className="font-mono py-1.5 pr-3">{item.manHours}</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">—</td>
                    <td className="font-mono py-1.5 pr-3">{item.rate}</td>
                    <td className="font-mono py-1.5 pr-3 font-semibold">{item.amount}</td>
                  </tr>
                );
              }
              // item.type === "total"
              const r = item.row;
              return (
                <tr key="total" className="border-t-2 border-slate-400">
                  <td className="py-1.5 pr-3"></td>
                  <td className="py-1.5 pr-3 font-semibold">{r.name}</td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.manHours}</td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.normalDays}</td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.restDaysWorked}</td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.holidayDaysWorked}</td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.normalOTHours}</td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.restOTHours}</td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.holidayOTHours}</td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.mc}</td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.absent}</td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.leave}</td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.unpaidLeave}</td>
                  <td className="py-1.5 pr-3"></td>
                  <td className="font-mono py-1.5 pr-3 font-semibold">{r.amount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {controls.showConfirm && (
        <button
          type="button"
          onClick={onConfirm}
          disabled={controls.confirmDisabled}
          className="mt-3 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
        >
          Confirm for invoicing
        </button>
      )}
      {controls.showUnconfirm && (
        <button type="button" onClick={onUnconfirm} className="mt-3 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
          Unconfirm
        </button>
      )}
      {controls.statusVisible && <p className="text-xs text-slate-500 mt-2">{controls.statusText}</p>}
    </div>
  );
}
