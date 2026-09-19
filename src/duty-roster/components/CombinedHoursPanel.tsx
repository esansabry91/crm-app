import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { IncomingSupportMap } from "../types";
import type { SiteConfig, MonthState, GenerateMonthResult } from "../types";
import type { RosterSession } from "../rosterModel";
import { buildCombinedReportData, combinedConfirmControls } from "../combinedHoursData";

/**
 * Summary Report tab — Panel 2, "Combined hours (incl. support elsewhere) - for payroll
 * process" (index.html lines 729-752, renderCombinedReport()/renderCombinedConfirmControls()).
 * Pure presentational, same split as SummaryReportPanel — the parent SummaryReportTab owns the
 * "Refresh combined hours" cross-site fetch, the Confirm/Unconfirm writes, and the TimeAttendance
 * export click.
 */
export interface CombinedHoursPanelProps {
  y: number;
  m: number;
  config: SiteConfig;
  ms: MonthState;
  result: GenerateMonthResult;
  session: RosterSession;
  liveIncoming: IncomingSupportMap | null;
  refreshing: boolean;
  onRefresh: () => void;
  onExport: () => void;
  onConfirm: () => void;
  onUnconfirm: () => void;
}

function tableHeaders(t: TFunction): string[] {
  return [
    t('dutyRoster.payrollColumns.employeeId'),
    t('dutyRoster.payrollColumns.guard'),
    t('dutyRoster.payrollColumns.manHours'),
    t('dutyRoster.payrollColumns.normalWorkedDays'),
    t('dutyRoster.payrollColumns.workedRestDays'),
    t('dutyRoster.payrollColumns.workedPublicHolidays'),
    t('dutyRoster.payrollColumns.normalOTHours'),
    t('dutyRoster.payrollColumns.restOTHours'),
    t('dutyRoster.payrollColumns.holidayOTHours'),
    t('dutyRoster.payrollColumns.mc'),
    t('dutyRoster.payrollColumns.absent'),
    t('dutyRoster.payrollColumns.leave'),
    t('dutyRoster.payrollColumns.unpaidLeave'),
  ];
}

export default function CombinedHoursPanel({ y, m, config, ms, result, session, liveIncoming, refreshing, onRefresh, onExport, onConfirm, onUnconfirm }: CombinedHoursPanelProps) {
  const { t } = useTranslation();
  const data = buildCombinedReportData(y, m, config, ms, result, session, liveIncoming, t);
  const controls = combinedConfirmControls(ms, session, liveIncoming, t);
  const TH = tableHeaders(t);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">{t('dutyRoster.combinedHoursPanel.panelTitle')}</h2>
      <p className="text-xs text-slate-500 mt-1">{t('dutyRoster.combinedHoursPanel.panelSubtitle')}</p>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          type="button"
          onClick={onExport}
          disabled={data.exportDisabled}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
        >
          {t('dutyRoster.combinedHoursPanel.exportButton')}
        </button>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 disabled:opacity-60">
          {refreshing ? t('dutyRoster.combinedHoursPanel.refreshingEllipsis') : t('dutyRoster.combinedHoursPanel.refreshButton')}
        </button>
        {controls.showConfirm && (
          <button
            type="button"
            onClick={onConfirm}
            disabled={controls.confirmDisabled}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
          >
            {t('dutyRoster.common.confirm')}
          </button>
        )}
        {controls.showUnconfirm && (
          <button type="button" onClick={onUnconfirm} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
            {t('dutyRoster.common.unconfirm')}
          </button>
        )}
      </div>

      {controls.statusVisible && <p className="text-xs text-slate-500 mt-2">{controls.statusText}</p>}
      {!controls.noteHidden && (
        <p className="text-xs text-slate-400 mt-2">
          {t('dutyRoster.combinedHoursPanel.explanatoryNote', { refreshLabel: t('dutyRoster.combinedHoursPanel.refreshButton') })}
        </p>
      )}

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
            {data.state.kind === "waitingForConfirm" && (
              <tr>
                <td colSpan={13} className="py-3 text-center text-slate-400">
                  {t('dutyRoster.combinedHoursPanel.stateWaitingForConfirm')}
                </td>
              </tr>
            )}
            {data.state.kind === "clickRefresh" && (
              <tr>
                <td colSpan={13} className="py-3 text-center text-slate-400">
                  {t('dutyRoster.combinedHoursPanel.stateClickRefresh', { refreshLabel: t('dutyRoster.combinedHoursPanel.refreshButton') })}
                </td>
              </tr>
            )}
            {data.state.kind === "noGuards" && (
              <tr>
                <td colSpan={13} className="py-3 text-center text-slate-400">
                  {t('dutyRoster.combinedHoursPanel.stateNoGuards')}
                </td>
              </tr>
            )}
            {data.state.kind === "rows" &&
              data.state.rows.map(({ id, row: r }) => (
                <tr key={id} className="border-t border-slate-100">
                  <td className="font-mono text-xs py-1.5 pr-3">{r.employeeId}</td>
                  <td className="py-1.5 pr-3">{r.name}</td>
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
                </tr>
              ))}
            {data.state.kind === "rows" && (
              <tr className="border-t-2 border-slate-400">
                <td className="py-1.5 pr-3"></td>
                <td className="py-1.5 pr-3 font-semibold">{data.state.total.name}</td>
                <td className="font-mono py-1.5 pr-3 font-semibold">{data.state.total.manHours}</td>
                <td className="font-mono py-1.5 pr-3 font-semibold">{data.state.total.normalDays}</td>
                <td className="font-mono py-1.5 pr-3 font-semibold">{data.state.total.restDaysWorked}</td>
                <td className="font-mono py-1.5 pr-3 font-semibold">{data.state.total.holidayDaysWorked}</td>
                <td className="font-mono py-1.5 pr-3 font-semibold">{data.state.total.normalOTHours}</td>
                <td className="font-mono py-1.5 pr-3 font-semibold">{data.state.total.restOTHours}</td>
                <td className="font-mono py-1.5 pr-3 font-semibold">{data.state.total.holidayOTHours}</td>
                <td className="font-mono py-1.5 pr-3 font-semibold">{data.state.total.mc}</td>
                <td className="font-mono py-1.5 pr-3 font-semibold">{data.state.total.absent}</td>
                <td className="font-mono py-1.5 pr-3 font-semibold">{data.state.total.leave}</td>
                <td className="font-mono py-1.5 pr-3 font-semibold">{data.state.total.unpaidLeave}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
