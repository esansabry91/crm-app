/**
 * Summary Report tab — the plain "Summary report" panel (home-site invoice reference). Ported
 * from public/duty-roster/index.html's renderSummaryReport() (lines 3183-3431),
 * renderInvoiceSummaryConfirmControls() (lines 3156-3182), and the #confirmInvoiceSummaryBtn /
 * #unconfirmInvoiceSummaryBtn click handlers (lines ~5518-5559). All the underlying math is
 * already ported (payrollMath.ts's computeGuardSummary()/computeSummaryTotals()) — this module
 * is purely the row-building/section-ordering/confirm-flow layer on top of it.
 *
 * Deliberate simplification vs. the original (flagged, not silent): the original accumulated
 * its own separate `totals.manHours`/`totals.amount` inline while building rows, THEN called
 * computeSummaryTotals() a second time (with identical inputs) just to get `hasAnyGuards` for
 * the confirm button's click handler — two numerically-identical computations of the same
 * figures. Verified against the live source that both are exactly the same formula (same
 * `normalManHours()` closure, same guard/temp/support id sets), so this port calls
 * computeSummaryTotals() once and reuses it for BOTH the on-screen confirm controls and the
 * confirm-click validation, instead of re-deriving `manHours`/`amount`/`hasAnyGuards` a second
 * time inline. The row/column data below (which needs the full per-guard breakdown, not just
 * the totals) still comes from computeGuardSummary() directly, same as the original.
 */
import type { SiteConfig, MonthState, GenerateMonthResult, TenderRateConfig, ConfirmedMonthSummary } from "./types";
import type { RosterSession } from "./rosterModel";
import { monthTempGuards, monthSupportGuards, activeSupportIds, guardName, nowIso, monthInvoiceConfirmed, canConfirmInvoiceSummary } from "./rosterModel";
import { computeGuardSummary, normalHoursLabel, formatConfirmedAt, type SummaryTotals } from "./payrollMath";
import { guardRate, supportGuardRate } from "./rateResolution";
import { configHolidays } from "./holidays";
import { monthLabel } from "./dateUtils";
import { DASH, fmtHours, fmtCount, fmtRM } from "./reportFormat";

// ---------------------------------------------------------------------------
// Row building (renderSummaryReport, lines 3183-3431)
// ---------------------------------------------------------------------------

export interface SummaryDataRow {
  employeeId: string;
  name: string;
  /** Small muted suffix after the name, e.g. "(Temp)" or "(Support — Site B)". */
  nameSuffix?: string;
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
  rate: string;
  amount: string;
  /** True for the Additional Guard subtotal's literal "see Branch Collection" amount cell —
   * rendered as muted text, never as a bold/plain currency figure. */
  amountLiteral?: boolean;
}

export type SummaryReportItem =
  | { type: "divider"; id: string; label: string }
  /** A plain per-guard/temp/support/additional-guard row — no cell is bold. */
  | { type: "guard"; id: string; row: SummaryDataRow }
  /** "Subtotal — Additional Guard (Temporary)" — name + man-hours bold, amount is the muted
   * literal "see Branch Collection" text (never a number), rate blank. */
  | { type: "additionalSubtotal"; id: string; manHours: string }
  /** "Subtotal — RM{rate}/hr" (only shown for a 'multiple'-mode project with 2+ distinct rates
   * this month) — only the Amount cell is bold. */
  | { type: "rateSubtotal"; id: string; label: string; manHours: string; rate: string; amount: string }
  /** "Total — all guards" — every numeric cell bold, Rate cell blank (not a dash). */
  | { type: "total"; row: SummaryDataRow };

export interface SummaryReportData {
  items: SummaryReportItem[];
  /** False only when there are no guards/temp/support/additional-guard entries at all — the
   * caller should render the single-row empty state ("Add guards to see the summary report.")
   * instead of `items` in that case (matches the original's own ternary). */
  hasAnyRows: boolean;
  subText: string;
}

const BLANK10 = {
  normalDays: DASH, restDaysWorked: DASH, holidayDaysWorked: DASH,
  normalOTHours: DASH, restOTHours: DASH, holidayOTHours: DASH,
  mc: DASH, absent: DASH, leave: DASH, unpaidLeave: DASH,
};

export function buildSummaryReportData(
  y: number,
  m: number,
  config: SiteConfig,
  ms: MonthState,
  result: GenerateMonthResult,
  rateConfig: TenderRateConfig | null
): SummaryReportData {
  const summary = computeGuardSummary(y, m, config, ms, result);
  const guards = config.guards.filter((g) => g.active !== false || (result.totalShifts[g.id] || 0) > 0);
  const tempGuardsMap = monthTempGuards(ms);
  const tempIds = Object.keys(tempGuardsMap);
  const supportGuardsMap = monthSupportGuards(ms);
  const supportIds = activeSupportIds(ms);
  const extraGuardHours = result.extraGuardHours || {};
  // Iterates extraGuardHours' own keys directly (not guards/tempIds/supportIds filtered) — a
  // guard covering an Additional Guard post can be ANY of permanent/temp/support, resolved
  // generically via guardName() below, matching the original exactly.
  const additionalGuardIds = Object.keys(extraGuardHours).filter((id) => extraGuardHours[id] > 0);
  const anyGuardsAtAll = !!(guards.length || tempIds.length || supportIds.length || additionalGuardIds.length);

  const normalManHours = (id: string) => Math.max(0, (summary[id]?.manHours || 0) - (extraGuardHours[id] || 0));

  // Totals row accumulator — the day-count breakdown columns (normalDays..unpaidLeave) only
  // ever accumulate from PERMANENT guard rows (verified against the live source: the temp/
  // support loops below only add to totals.manHours/totals.amount, never the breakdown fields —
  // their own rows show dashes for those columns precisely because they were never counted
  // there either). manHours/amount DO include temp+support (they're billed) but never
  // Additional Guard hours (billed separately in Branch Collection).
  const totals = {
    manHours: 0, normalDays: 0, restDaysWorked: 0, holidayDaysWorked: 0,
    normalOTHours: 0, restOTHours: 0, holidayOTHours: 0,
    mc: 0, absent: 0, leave: 0, unpaidLeave: 0, amount: 0,
  };
  let anyMissingRate = false;

  // rate (as a "RM.CC" string key, bucketing floating-point-equal rates together — matches the
  // original, not a bug to fix silently) -> accumulated manHours/amount at that rate.
  const rateGroups: Record<string, { rate: number; manHours: number; amount: number }> = {};
  function addToRateGroup(rate: number | null, hours: number) {
    if (rate == null) return;
    const key = rate.toFixed(2);
    if (!rateGroups[key]) rateGroups[key] = { rate, manHours: 0, amount: 0 };
    rateGroups[key].manHours += hours || 0;
    rateGroups[key].amount += rate * (hours || 0);
  }

  const items: SummaryReportItem[] = [];

  guards.forEach((g) => {
    const s = summary[g.id];
    const hrs = normalManHours(g.id);
    totals.manHours += hrs;
    totals.normalDays += s?.normalDays || 0;
    totals.restDaysWorked += s?.restDaysWorked || 0;
    totals.holidayDaysWorked += s?.holidayDaysWorked || 0;
    totals.normalOTHours += s?.normalOTHours || 0;
    totals.restOTHours += s?.restOTHours || 0;
    totals.holidayOTHours += s?.holidayOTHours || 0;
    totals.mc += s?.mc || 0;
    totals.absent += s?.absent || 0;
    totals.leave += s?.leave || 0;
    totals.unpaidLeave += s?.unpaidLeave || 0;
    const rate = guardRate(rateConfig, g);
    const amount = rate != null ? rate * hrs : null;
    if (rate == null) anyMissingRate = true;
    addToRateGroup(rate, hrs);
    totals.amount += amount || 0;
    items.push({
      type: "guard",
      id: g.id,
      row: {
        employeeId: g.employeeId || DASH,
        name: g.name,
        manHours: fmtHours(hrs),
        normalDays: fmtCount(s?.normalDays),
        restDaysWorked: fmtCount(s?.restDaysWorked),
        holidayDaysWorked: fmtCount(s?.holidayDaysWorked),
        normalOTHours: fmtHours(s?.normalOTHours),
        restOTHours: fmtHours(s?.restOTHours),
        holidayOTHours: fmtHours(s?.holidayOTHours),
        mc: fmtCount(s?.mc),
        absent: fmtCount(s?.absent),
        leave: fmtCount(s?.leave),
        unpaidLeave: fmtCount(s?.unpaidLeave),
        rate: rate != null ? fmtRM(rate) : DASH,
        amount: amount != null ? fmtRM(amount) : DASH,
      },
    });
  });

  // Temp/support guards bill like each other (supportGuardRate() — the flat 'same'-mode rate,
  // or the lowest 'multiple'-mode position rate — never a temp guard's own display-only
  // `rate` field) and feed the grand total, but get no per-day breakdown (10 dash cells).
  if (tempIds.length) {
    items.push({ type: "divider", id: "div-temp", label: "Temporary guards this month" });
    tempIds.forEach((id) => {
      const hrs = normalManHours(id);
      totals.manHours += hrs;
      const rate = supportGuardRate(rateConfig);
      const amount = rate != null ? rate * hrs : null;
      if (rate == null) anyMissingRate = true;
      addToRateGroup(rate, hrs);
      totals.amount += amount || 0;
      items.push({
        type: "guard",
        id: `temp-${id}`,
        row: {
          employeeId: DASH,
          name: tempGuardsMap[id]?.name || "(unknown)",
          nameSuffix: "(Temp)",
          manHours: fmtHours(hrs),
          ...BLANK10,
          rate: rate != null ? fmtRM(rate) : DASH,
          amount: amount != null ? fmtRM(amount) : DASH,
        },
      });
    });
  }

  if (supportIds.length) {
    items.push({ type: "divider", id: "div-support", label: "Support guards this month" });
    supportIds.forEach((id) => {
      const entry = supportGuardsMap[id];
      const hrs = normalManHours(id);
      totals.manHours += hrs;
      const rate = supportGuardRate(rateConfig);
      const amount = rate != null ? rate * hrs : null;
      if (rate == null) anyMissingRate = true;
      addToRateGroup(rate, hrs);
      totals.amount += amount || 0;
      items.push({
        type: "guard",
        id: `support-${id}`,
        row: {
          employeeId: entry?.employeeId || DASH,
          name: entry?.name || "(unknown)",
          nameSuffix: `(Support — ${entry?.homeSiteName || "?"})`,
          manHours: fmtHours(hrs),
          ...BLANK10,
          rate: rate != null ? fmtRM(rate) : DASH,
          amount: amount != null ? fmtRM(amount) : DASH,
        },
      });
    });
  }

  // Additional Guard (Temporary) posts — NOT folded into the grand total below; "Total — all
  // guards" keeps meaning exactly the normal Client Site Requirement billing.
  if (additionalGuardIds.length) {
    items.push({ type: "divider", id: "div-additional", label: "Additional Guard (Temporary) posts this month" });
    additionalGuardIds.forEach((id) => {
      items.push({
        type: "guard",
        id: `additional-${id}`,
        row: {
          employeeId: DASH,
          name: guardName(config, ms, id),
          manHours: fmtHours(extraGuardHours[id]),
          ...BLANK10,
          rate: DASH,
          amount: "see Branch Collection",
          amountLiteral: true,
        },
      });
    });
    const additionalTotal = additionalGuardIds.reduce((s, id) => s + (extraGuardHours[id] || 0), 0);
    items.push({ type: "additionalSubtotal", id: "additional-subtotal", manHours: fmtHours(additionalTotal) });
  }

  // Only a 'multiple'-mode project can have more than one rate in play; only shown when 2+
  // distinct rates actually appear this month — a 'same'-mode project (or a 'multiple'-mode one
  // where every guard happens to share a rate) would just repeat the grand total.
  const rateGroupKeys = Object.keys(rateGroups).sort((ka, kb) => rateGroups[ka].rate - rateGroups[kb].rate);
  if (rateConfig && rateConfig.guardRateMode === "multiple" && rateGroupKeys.length > 1) {
    items.push({ type: "divider", id: "div-rate", label: "Subtotal by rate" });
    rateGroupKeys.forEach((key) => {
      const grp = rateGroups[key];
      items.push({
        type: "rateSubtotal",
        id: `rate-${key}`,
        label: `Subtotal — RM${fmtRM(grp.rate)}/hr`,
        manHours: fmtHours(grp.manHours),
        rate: fmtRM(grp.rate),
        amount: fmtRM(grp.amount),
      });
    });
  }

  if (anyGuardsAtAll) {
    items.push({
      type: "total",
      row: {
        employeeId: "",
        name: "Total — all guards",
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
        rate: "",
        amount: fmtRM(totals.amount),
      },
    });
  }

  const holidayCount = configHolidays(config).filter((d) => d.slice(0, 7) === ms.month).length;
  const subText =
    `${monthLabel(y, m)} — normal-day overtime starts after ${normalHoursLabel(config)}h/shift. ` +
    (holidayCount
      ? `${holidayCount} public holiday${holidayCount === 1 ? "" : "s"} marked this month. `
      : `No public holidays marked this month — add them in Guards & Shifts if this month has any. `) +
    (anyGuardsAtAll && anyMissingRate
      ? `Some guards have no billing rate resolved — set one up in this project's Project Details, and give each guard a matching Position if it bills by position; their Amount is excluded from the total until then.`
      : ``);

  return { items, hasAnyRows: anyGuardsAtAll, subText };
}

// ---------------------------------------------------------------------------
// Confirm controls (renderInvoiceSummaryConfirmControls, lines 3156-3182)
// ---------------------------------------------------------------------------

export interface InvoiceConfirmControlsView {
  showConfirm: boolean;
  /** Independent of `showConfirm` — the button can be simultaneously visible (not yet
   * confirmed, session can confirm) AND disabled (no guards yet this month). */
  confirmDisabled: boolean;
  showUnconfirm: boolean;
  statusVisible: boolean;
  statusText: string;
}

export function invoiceSummaryConfirmControls(
  ms: MonthState,
  session: RosterSession,
  liveTotals: Pick<SummaryTotals, "hasAnyGuards">
): InvoiceConfirmControlsView {
  const confirmed = monthInvoiceConfirmed(ms);
  const canConfirm = canConfirmInvoiceSummary(session);

  let statusVisible = false;
  let statusText = "";
  if (confirmed) {
    statusVisible = true;
    statusText =
      `Confirmed by ${confirmed.byName || "someone"} on ${formatConfirmedAt(confirmed.at)} — ` +
      `RM${(confirmed.amount || 0).toFixed(2)} / ${(confirmed.manHours || 0).toFixed(1)} man-hours. ` +
      `This is what Branch Collection's invoice generator uses for this site and month.` +
      (confirmed.additionalManHours
        ? ` Plus ${confirmed.additionalManHours.toFixed(1)} man-hours from Additional Guard (Temporary) posts, billed separately in Branch Collection.`
        : "");
  } else if (canConfirm && liveTotals.hasAnyGuards) {
    statusVisible = true;
    statusText = `Not yet confirmed — click "Confirm for invoicing" once this month's figures are final so Branch Collection can use them.`;
  }

  return {
    showConfirm: canConfirm && !confirmed,
    confirmDisabled: !liveTotals.hasAnyGuards,
    showUnconfirm: canConfirm && !!confirmed,
    statusVisible,
    statusText,
  };
}

// ---------------------------------------------------------------------------
// Confirm/Unconfirm invoicing (the #confirmInvoiceSummaryBtn / #unconfirmInvoiceSummaryBtn
// click handlers, lines ~5518-5559)
// ---------------------------------------------------------------------------

export interface ConfirmInvoiceOutcome {
  ms: MonthState;
  toast: string;
  /** Persist with `{ suppressConfirmRevoke: true }` — this write sets invoiceConfirmed itself
   * and must not immediately revoke what it just set (same pattern as lockMachine.ts's
   * LockActionOutcome). */
  suppressConfirmRevoke: true;
}

/** Caller must first check `canConfirmInvoiceSummary(session)` (silent no-op if false, matching
 * the original) and that a `result` actually exists ("Nothing to confirm yet." toast, defensive
 * — should be unreachable in practice since a result is always available once the page has
 * rendered). Both of those are UI-layer early-returns in the original, not part of this pure
 * applier.
 *
 * `categories` — computeCategoryBreakdown()'s own output (payrollMath.ts), computed by the
 * caller from the same y/m/config/ms/result/rateConfig this click already has in scope — is
 * snapshotted alongside the totals purely for Branch Collection's man-hour billing mode to
 * auto-pull from later; nothing here reads it back. Optional/omittable (defaults to []) so a
 * caller that hasn't been updated to compute it yet still confirms the totals exactly as before. */
export function applyConfirmInvoiceSummary(
  ms: MonthState,
  totals: SummaryTotals,
  actorUid: string | null,
  actorName: string | null,
  categories: ConfirmedMonthSummary["categories"] = []
): ConfirmInvoiceOutcome | { error: string } {
  if (!totals.hasAnyGuards) return { error: "Add guards to this site before confirming." };
  const invoiceConfirmed: ConfirmedMonthSummary = {
    byUid: actorUid,
    byName: actorName || "Branch staff",
    at: nowIso(),
    manHours: totals.manHours,
    amount: totals.amount,
    additionalManHours: totals.additionalManHours,
    categories,
  };
  return {
    ms: { ...ms, invoiceConfirmed },
    toast: "Summary confirmed — pushed to Branch Collection for invoicing.",
    suppressConfirmRevoke: true,
  };
}

export const UNCONFIRM_INVOICE_MODAL = {
  title: "Unconfirm invoicing summary",
  message: "Branch Collection's invoice generator won't show a confirmed total for this site/month until you confirm it again.",
  okLabel: "Unconfirm",
} as const;

export function applyUnconfirmInvoiceSummary(ms: MonthState): ConfirmInvoiceOutcome {
  return { ms: { ...ms, invoiceConfirmed: null }, toast: "Invoicing summary unconfirmed.", suppressConfirmRevoke: true };
}
