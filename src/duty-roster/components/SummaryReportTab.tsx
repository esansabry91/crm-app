import { useState } from "react";
import type { SiteConfig, MonthState, GenerateMonthResult, TenderRateConfig } from "../types";
import type { GenerateMonthConfig } from "../schedulingEngine";
import type { RosterSession } from "../rosterModel";
import { canConfirmInvoiceSummary, canConfirmCombinedHours } from "../rosterModel";
import { appendLog } from "../lockMachine";
import { computeSummaryTotals } from "../payrollMath";
import { applyConfirmInvoiceSummary, applyUnconfirmInvoiceSummary, UNCONFIRM_INVOICE_MODAL } from "../summaryReportData";
import { applyConfirmCombinedHours, applyUnconfirmCombinedHours, UNCONFIRM_COMBINED_MODAL, NEED_REFRESH_TOAST } from "../combinedHoursData";
import { computeIncomingSupportDates } from "../combinedHoursCrossSite";
import { exportTimeAttendanceToExcel } from "../timeAttendanceExport";
import { useCombinedHoursCache } from "../hooks/useCombinedHoursCache";
import SummaryReportPanel from "./SummaryReportPanel";
import CombinedHoursPanel from "./CombinedHoursPanel";
import ConfirmModal from "./modals/ConfirmModal";

/**
 * "Summary Report" tab — composes both panels from index.html's `#view-report` (lines 692-752):
 * the plain per-site Summary Report (invoice reference) and the separate Combined Hours panel
 * (payroll feed, incl. support-elsewhere hours). This component owns everything Firestore-
 * facing that the two presentational panels need: the "Refresh combined hours" cross-site fetch
 * and its session cache, the Confirm/Unconfirm writes for both panels, and the TimeAttendance
 * Excel export — the panels themselves only turn state into markup, matching the split already
 * used for AdjustmentsTab/GuardsShiftsTab.
 *
 * The month-nav buttons this tab's original HTML shell duplicates (#prevMonthReport/
 * #nextMonthReport, mirroring #prevMonth/#nextMonth) aren't rendered here — like every other
 * tab in this port, month navigation is page-level state (Task #22 composes the shared
 * useSiteConfig()/useMonthState() subscription and its month nav across every tab).
 *
 * `actorUid`/`actorName` stand in for `state.myUid`/`state.myName || state.myDepartment` — this
 * port has no signed-in-user/session hook built yet (out of scope for Task #20), so the caller
 * passes through whatever it already knows; Task #22 should wire these from the real auth/
 * profile hook.
 */
export interface SummaryReportTabProps {
  config: SiteConfig;
  ms: MonthState;
  result: GenerateMonthResult;
  currentMonthKey: string;
  session: RosterSession;
  rateConfig: TenderRateConfig | null;
  allSites: Pick<SiteConfig, "id" | "name" | "branch" | "archived">[];
  siteConfigsCache: Record<string, GenerateMonthConfig>;
  actorUid: string | null;
  actorName: string | null;
  onPersistMonth: (ms: MonthState, opts?: { suppressConfirmRevoke?: boolean }) => void;
  onToast: (message: string) => void;
}

export default function SummaryReportTab({
  config,
  ms,
  result,
  currentMonthKey,
  session,
  rateConfig,
  allSites,
  siteConfigsCache,
  actorUid,
  actorName,
  onPersistMonth,
  onToast,
}: SummaryReportTabProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [unconfirmInvoiceOpen, setUnconfirmInvoiceOpen] = useState(false);
  const [unconfirmCombinedOpen, setUnconfirmCombinedOpen] = useState(false);
  const combinedCache = useCombinedHoursCache();

  const [y, m] = currentMonthKey.split("-").map(Number);
  const liveIncoming = combinedCache.get(config.id, currentMonthKey);

  function handleConfirmInvoice() {
    if (!canConfirmInvoiceSummary(session)) return;
    const totals = computeSummaryTotals(y, m, config, ms, result, rateConfig);
    const outcome = applyConfirmInvoiceSummary(ms, totals, actorUid, actorName);
    if ("error" in outcome) {
      onToast(outcome.error);
      return;
    }
    onPersistMonth(outcome.ms, { suppressConfirmRevoke: outcome.suppressConfirmRevoke });
    onToast(outcome.toast);
  }

  function handleUnconfirmInvoice() {
    if (!canConfirmInvoiceSummary(session)) return;
    setUnconfirmInvoiceOpen(true);
  }

  function handleConfirmUnconfirmInvoice() {
    setUnconfirmInvoiceOpen(false);
    const outcome = applyUnconfirmInvoiceSummary(ms);
    onPersistMonth(outcome.ms, { suppressConfirmRevoke: outcome.suppressConfirmRevoke });
    onToast(outcome.toast);
  }

  // Cross-site read, deliberately kept to an explicit click rather than firing on every render
  // — see computeIncomingSupportDates()'s own doc comment for why.
  async function handleRefresh() {
    setRefreshing(true);
    try {
      const map = await computeIncomingSupportDates(config.id, currentMonthKey, allSites, siteConfigsCache);
      combinedCache.set(config.id, currentMonthKey, map);
      onToast("Combined hours refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  function handleConfirmCombined() {
    if (!canConfirmCombinedHours(session)) return;
    if (!liveIncoming) {
      onToast(NEED_REFRESH_TOAST);
      return;
    }
    const outcome = applyConfirmCombinedHours(ms, liveIncoming, actorUid, actorName);
    onPersistMonth(outcome.ms, { suppressConfirmRevoke: outcome.suppressConfirmRevoke });
    onToast(outcome.toast);
  }

  function handleUnconfirmCombined() {
    if (!canConfirmCombinedHours(session)) return;
    setUnconfirmCombinedOpen(true);
  }

  function handleConfirmUnconfirmCombined() {
    setUnconfirmCombinedOpen(false);
    const outcome = applyUnconfirmCombinedHours(ms);
    onPersistMonth(outcome.ms, { suppressConfirmRevoke: outcome.suppressConfirmRevoke });
    onToast(outcome.toast);
  }

  function handleExport() {
    if (!liveIncoming) {
      onToast(NEED_REFRESH_TOAST);
      return;
    }
    const { logText } = exportTimeAttendanceToExcel(y, m, config, ms, result, liveIncoming, config.name, currentMonthKey);
    // No success toast — matches the original (only the Roster tab's own Export does the same:
    // a logged line, no toast). Persisted immediately (rather than left as an in-memory-only
    // mutation the way the legacy shared-singleton's addLog() did) since this port has no
    // guaranteed "next save" to piggyback the log entry on — see appendLog()'s own callers
    // elsewhere in this port (e.g. RosterCalendar.tsx) for the same pattern.
    onPersistMonth(appendLog(ms, logText));
  }

  return (
    <div className="flex flex-col gap-4">
      <SummaryReportPanel
        y={y}
        m={m}
        config={config}
        ms={ms}
        result={result}
        rateConfig={rateConfig}
        session={session}
        onConfirm={handleConfirmInvoice}
        onUnconfirm={handleUnconfirmInvoice}
      />
      <CombinedHoursPanel
        y={y}
        m={m}
        config={config}
        ms={ms}
        result={result}
        session={session}
        liveIncoming={liveIncoming}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onExport={handleExport}
        onConfirm={handleConfirmCombined}
        onUnconfirm={handleUnconfirmCombined}
      />

      <ConfirmModal
        open={unconfirmInvoiceOpen}
        title={UNCONFIRM_INVOICE_MODAL.title}
        message={UNCONFIRM_INVOICE_MODAL.message}
        okLabel={UNCONFIRM_INVOICE_MODAL.okLabel}
        danger
        onConfirm={handleConfirmUnconfirmInvoice}
        onCancel={() => setUnconfirmInvoiceOpen(false)}
      />
      <ConfirmModal
        open={unconfirmCombinedOpen}
        title={UNCONFIRM_COMBINED_MODAL.title}
        message={UNCONFIRM_COMBINED_MODAL.message}
        okLabel={UNCONFIRM_COMBINED_MODAL.okLabel}
        danger
        onConfirm={handleConfirmUnconfirmCombined}
        onCancel={() => setUnconfirmCombinedOpen(false)}
      />
    </div>
  );
}
