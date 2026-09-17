/**
 * Summary Report tab — "Export to Excel (TimeAttendance format)" button, on the Combined Hours
 * panel. Ported from timeAttendanceExportRows() (lines 2767-2809) and
 * exportTimeAttendanceToExcel() (lines 2857-2879). A separate single-sheet workbook from the
 * Roster tab's own "Export to Excel" (rosterExcelExport.ts) — this one goes straight into the
 * external payroll system's "TimeAttendance" importer, not a roster record. Follows the same
 * xlsx-js-style aoa_to_sheet/book_new/writeFile wiring convention already established there.
 *
 * Every guard's row uses his COMBINED totals (home-site numbers plus support-elsewhere hours
 * folded in, via combinedGuardBreakdown() — already ported), not the plain per-site Summary
 * Report numbers. Only this site's own PERMANENT guards get a row — a support guard's combined
 * total is exported once, from his own home site, never duplicated at a site he supported.
 */
import * as XLSX from "xlsx-js-style";
import type { MonthState, GenerateMonthResult, IncomingSupportMap } from "./types";
import type { GenerateMonthConfig } from "./schedulingEngine";
import { computeGuardSummary, combinedGuardBreakdown, NORMAL_WORK_DAYS } from "./payrollMath";
import { monthLabel } from "./dateUtils";

export function timeAttendanceExportRows(
  y: number,
  m: number,
  config: GenerateMonthConfig,
  monthState: MonthState,
  result: GenerateMonthResult,
  combinedMap: IncomingSupportMap
): (string | number)[][] {
  const homeSummary = computeGuardSummary(y, m, config, monthState, result);
  const guards = config.guards.filter((g) => g.active !== false || (result.totalShifts[g.id] || 0) > 0);
  const n = (v: number | undefined) => v || 0;

  const descRow: (string | number)[] = [
    "", "",
    "The official work day of the month exclude Rest Day &  Holiday",
    "The total number of day an employee has worked in Working Day",
    "The total number of day an employee has absent",
    "The total number of day an employee has taken leaves (exclude unpaid leaves)",
    "The total number of day an employee has taken unpaid leaves",
    "The total number of day an employee has worked in Rest Day",
    "The total number of day an employee has worked in Holiday",
    "The total number of overtime hour an employee has worked in Working Day",
    "The total number of overtime hour an employee has worked in Rest Day",
    "The total number of overtime hour an employee has worked in Holiday",
    "The total number of Lateness count",
    "The total number of Lateness hour",
    "The total number of Early Out count",
    "The total number of Early Out hour",
  ];
  const typeRow: (string | number)[] = [
    "NvarChar(20)", "",
    "Decimal(9, 1)", "Decimal(9, 1)", "Decimal(9, 1)", "Decimal(9, 1)", "Decimal(9, 1)",
    "Decimal(9, 1)", "Decimal(9, 1)", "Decimal(9, 5)", "Decimal(9, 5)", "Decimal(9, 5)",
    "Integer", "Decimal(9, 2)", "Integer", "Decimal(9, 2)",
  ];
  const headerRow: (string | number)[] = [
    "Employee Code", "Name", "Working Days", "Worked Days", "Absent Days",
    "Leave Days", "Unpaid Leave Days", "Worked Rest Days", "Worked Holidays",
    "OT For Worked Days", "OT For Rest Days", "OT For Holidays",
    "Lateness Count", "Lateness Time", "Early Out Count", "Early Out Time",
  ];

  const rows: (string | number)[][] = guards.map((g) => {
    const s = combinedGuardBreakdown(config, homeSummary[g.id], combinedMap[g.id]);
    return [
      g.employeeId || "", g.name,
      NORMAL_WORK_DAYS, // column C — a literal constant (26) for every row, not derived per-guard
      n(s.normalDays), n(s.absent), n(s.leave), n(s.unpaidLeave),
      n(s.restDaysWorked), n(s.holidayDaysWorked),
      n(s.normalOTHours), n(s.restOTHours), n(s.holidayOTHours),
      "", "", "", "", // Lateness/Early Out — not tracked by this tool, always blank
    ];
  });

  return [descRow, typeRow, headerRow, ...rows];
}

/** Column widths matching format_for_apps.xlsx (Excel "characters" units) — indices 11, 14, 15
 * (zero-based) are left at the default width, matching the template. */
const TIME_ATTENDANCE_COL_WIDTHS: (number | undefined)[] = [
  13.5, 39.33, 12.16, 12, 10.16, 15.5, 15, 14.5, 14, 16.33, 14.16, undefined, 12.5, 9.16, undefined, undefined,
];

/** Builds and downloads the workbook. Returns the log text the caller should append via
 * appendLog()/persist(), matching the original's own addLog() call — deliberately no success
 * toast, same as the Roster tab's own "Export to Excel" (exportCurrentMonthToExcel()). */
export function exportTimeAttendanceToExcel(
  y: number,
  m: number,
  config: GenerateMonthConfig,
  ms: MonthState,
  result: GenerateMonthResult,
  combinedMap: IncomingSupportMap,
  siteName: string | null,
  monthKey: string
): { logText: string } {
  const wb = XLSX.utils.book_new();
  const taSheet = XLSX.utils.aoa_to_sheet(timeAttendanceExportRows(y, m, config, ms, result, combinedMap));
  taSheet["!cols"] = TIME_ATTENDANCE_COL_WIDTHS.map((wch) => (wch == null ? {} : { wch }));
  XLSX.utils.book_append_sheet(wb, taSheet, "TimeAttendance");

  const safeSiteName = (siteName || "Site").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_");
  XLSX.writeFile(wb, `${safeSiteName || "Site"}_${monthKey}_TimeAttendance.xlsx`);

  return { logText: `Exported ${monthLabel(y, m)} TimeAttendance file.` };
}
