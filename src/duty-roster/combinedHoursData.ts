/**
 * Summary Report tab — the "Combined hours (incl. support elsewhere)" panel, a SEPARATE report
 * from the plain Summary Report above (see summaryReportData.ts). Ported from
 * public/duty-roster/index.html's renderCombinedReport() (lines 3432-3501),
 * renderCombinedConfirmControls() (lines 3518-3550), and the #confirmCombinedBtn/
 * #unconfirmCombinedBtn click handlers (lines ~5484-5514).
 *
 * Shows only this site's OWN permanent guards (never temp/support guards borrowed in — a
 * borrowed-in guard's combined total belongs on HIS OWN home site's panel, not here), each
 * topped up via combinedGuardBreakdown() (already ported) with whatever he picked up as a
 * support guard at other branch sites this month. No Rate/Amount columns (13, not 15) — this is
 * a payroll hours feed, not a billing sheet. Gated behind an explicit "Refresh combined hours"
 * click (a cross-site read, computeIncomingSupportDates() in combinedHoursCrossSite.ts) rather
 * than being always-live.
 */
import type { TFunction } from "i18next";
import type { SiteConfig, MonthState, GenerateMonthResult, ConfirmedSummary, IncomingSupportMap } from "./types";
import type { RosterSession } from "./rosterModel";
import { monthConfirmed, canConfirmCombinedHours, nowIso } from "./rosterModel";
import { computeGuardSummary, combinedGuardBreakdown, addGuardBreakdown, emptyGuardBreakdown, formatConfirmedAt } from "./payrollMath";
import { DASH, fmtHours, fmtCount } from "./reportFormat";

export interface CombinedDataRow {
  employeeId: string;
  name: string;
  manHours: string;
  normalDays: string;
  restDaysWorked: string;
  holidayDaysWorked: string;
  normalOTHours: string;
  restOTHours: string;
  holidayOTHours: string;
  mc: string;
  absent: string;
  leave: string;
  unpaidLeave: string;
}

export type CombinedReportState =
  | { kind: "waitingForConfirm" } // Payroll/HR, nothing confirmed by the branch manager yet
  | { kind: "clickRefresh" } // everyone else, never refreshed this session
  | { kind: "noGuards" }
  | { kind: "rows"; rows: { id: string; row: CombinedDataRow }[]; total: CombinedDataRow };

export interface CombinedReportData {
  state: CombinedReportState;
  /** #exportTimeAttendanceBtn.disabled — recomputed on every render, independent of `state`'s
   * own kind (also true, redundantly, whenever state isn't "rows"). */
  exportDisabled: boolean;
}

/** Which `incoming` map (if any) this viewer should see. Payroll/HR NEVER see a live "Refresh
 * combined hours" result — only the FROZEN `ms.confirmedIncoming` snapshot taken the moment a
 * Branch Manager last confirmed (or nothing, if never confirmed). Every other role always sees
 * their own live refreshed figure, confirmed or not, so they can sanity-check a number either
 * side of confirming without it silently changing under them.
 *
 * `isPayrollLike` in the original is `state.isPayroll || state.isHr`, and `state.canEdit` is
 * assigned exactly `!state.isPayrollLike` and nothing else (verified against the live source —
 * no other role sets canEdit false) — so `!session.canEdit` is a faithful stand-in for
 * `isPayrollLike` here; RosterSession has no separate field for it. */
export function resolveCombinedIncoming(ms: MonthState, session: RosterSession, liveIncoming: IncomingSupportMap | null): IncomingSupportMap | null {
  const isPayrollLike = !session.canEdit;
  return isPayrollLike ? (monthConfirmed(ms) ? ms.confirmedIncoming : null) : liveIncoming;
}

export function buildCombinedReportData(
  y: number,
  m: number,
  config: SiteConfig,
  ms: MonthState,
  result: GenerateMonthResult,
  session: RosterSession,
  liveIncoming: IncomingSupportMap | null,
  t: TFunction
): CombinedReportData {
  const isPayrollLike = !session.canEdit;
  const incoming = resolveCombinedIncoming(ms, session, liveIncoming);
  const exportDisabled = !incoming;

  if (!incoming) return { state: isPayrollLike ? { kind: "waitingForConfirm" } : { kind: "clickRefresh" }, exportDisabled };

  const guards = config.guards.filter((g) => g.active !== false || (result.totalShifts[g.id] || 0) > 0);
  if (!guards.length) return { state: { kind: "noGuards" }, exportDisabled };

  const summary = computeGuardSummary(y, m, config, ms, result);
  const totals = emptyGuardBreakdown();
  const rows = guards.map((g) => {
    const combined = combinedGuardBreakdown(config, summary[g.id], incoming[g.id]);
    addGuardBreakdown(totals, combined);
    return {
      id: g.id,
      row: {
        employeeId: g.employeeId || DASH,
        name: g.name,
        manHours: fmtHours(combined.manHours),
        normalDays: fmtCount(combined.normalDays),
        restDaysWorked: fmtCount(combined.restDaysWorked),
        holidayDaysWorked: fmtCount(combined.holidayDaysWorked),
        normalOTHours: fmtHours(combined.normalOTHours),
        restOTHours: fmtHours(combined.restOTHours),
        holidayOTHours: fmtHours(combined.holidayOTHours),
        mc: fmtCount(combined.mc),
        absent: fmtCount(combined.absent),
        leave: fmtCount(combined.leave),
        unpaidLeave: fmtCount(combined.unpaidLeave),
      },
    };
  });

  const total: CombinedDataRow = {
    employeeId: "",
    name: t("dutyRoster.common.totalAllGuards"),
    manHours: fmtHours(totals.manHours),
    normalDays: fmtCount(totals.normalDays),
    restDaysWorked: fmtCount(totals.restDaysWorked),
    holidayDaysWorked: fmtCount(totals.holidayDaysWorked),
    normalOTHours: fmtHours(totals.normalOTHours),
    restOTHours: fmtHours(totals.restOTHours),
    holidayOTHours: fmtHours(totals.holidayOTHours),
    mc: fmtCount(totals.mc),
    absent: fmtCount(totals.absent),
    leave: fmtCount(totals.leave),
    unpaidLeave: fmtCount(totals.unpaidLeave),
  };

  return { state: { kind: "rows", rows, total }, exportDisabled };
}

// ---------------------------------------------------------------------------
// Confirm controls (renderCombinedConfirmControls, lines 3518-3550)
// ---------------------------------------------------------------------------

export interface CombinedConfirmControlsView {
  showConfirm: boolean;
  confirmDisabled: boolean;
  showUnconfirm: boolean;
  /** #combinedHoursNote — the static explanatory paragraph — hidden entirely for Payroll/HR. */
  noteHidden: boolean;
  statusVisible: boolean;
  statusText: string;
}

/** `liveIncoming` here is deliberately the LIVE (not role-adjusted) cache value, even for
 * Payroll — the confirm button's enabled state always depends on whether THIS viewer has
 * personally refreshed it (though Payroll can never click Confirm anyway per
 * canConfirmCombinedHours(), so the distinction is moot in practice — preserved for fidelity). */
export function combinedConfirmControls(ms: MonthState, session: RosterSession, liveIncoming: IncomingSupportMap | null, t: TFunction): CombinedConfirmControlsView {
  const isPayrollLike = !session.canEdit;
  const confirmed = monthConfirmed(ms);
  const canConfirm = canConfirmCombinedHours(session);

  let statusVisible = false;
  let statusText = "";
  if (confirmed) {
    statusVisible = true;
    const name = confirmed.byName || t("dutyRoster.common.someoneFallback");
    const date = formatConfirmedAt(confirmed.at);
    statusText = isPayrollLike
      ? t("dutyRoster.combinedHoursPanel.statusConfirmedPlain", { name, date })
      : t("dutyRoster.combinedHoursPanel.statusConfirmedCanExport", { name, date });
  } else if (isPayrollLike) {
    statusVisible = true;
    statusText = t("dutyRoster.combinedHoursPanel.statusWaitingForBranchManager");
  }

  return {
    showConfirm: !isPayrollLike && canConfirm && !confirmed,
    confirmDisabled: !liveIncoming,
    showUnconfirm: !isPayrollLike && canConfirm && !!confirmed,
    noteHidden: isPayrollLike,
    statusVisible,
    statusText,
  };
}

// ---------------------------------------------------------------------------
// Confirm/Unconfirm combined hours (#confirmCombinedBtn/#unconfirmCombinedBtn, lines ~5484-5514)
// ---------------------------------------------------------------------------

export interface ConfirmCombinedOutcome {
  ms: MonthState;
  toast: string;
  suppressConfirmRevoke: true;
}

/** Shared with exportTimeAttendanceToExcel()'s own guard — click a Refresh first. */
export function getNeedRefreshToast(t: TFunction): string {
  return t("dutyRoster.combinedHoursPanel.needRefreshToast");
}

/** Caller must first check `canConfirmCombinedHours(session)` (silent no-op if false) and that
 * `incoming` (the current session's cached "Refresh combined hours" result) is non-null —
 * surfaced as its own toast (getNeedRefreshToast()) rather than swallowed here. */
export function applyConfirmCombinedHours(ms: MonthState, incoming: IncomingSupportMap, actorUid: string | null, actorName: string | null, t: TFunction): ConfirmCombinedOutcome {
  const confirmed: ConfirmedSummary = { byUid: actorUid, byName: actorName || t("dutyRoster.combinedHoursPanel.fallbackBranchManager"), at: nowIso() };
  return {
    ms: { ...ms, confirmed, confirmedIncoming: incoming },
    toast: t("dutyRoster.combinedHoursPanel.toastConfirmed"),
    suppressConfirmRevoke: true,
  };
}

export function getUnconfirmCombinedModal(t: TFunction) {
  return {
    title: t("dutyRoster.combinedHoursPanel.unconfirmModalTitle"),
    message: t("dutyRoster.combinedHoursPanel.unconfirmModalMessage"),
    okLabel: t("dutyRoster.common.unconfirm"),
  } as const;
}

export function applyUnconfirmCombinedHours(ms: MonthState, t: TFunction): ConfirmCombinedOutcome {
  return { ms: { ...ms, confirmed: null, confirmedIncoming: null }, toast: t("dutyRoster.combinedHoursPanel.toastUnconfirmed"), suppressConfirmRevoke: true };
}
