/**
 * Roster tab's "Export to Excel" — ported from public/duty-roster/index.html's
 * guardsExportRows()/rosterGridExportRows()/applyRosterSheetStyling()/tempGuardExportRows()/
 * supportGuardExportRows()/exportCurrentMonthToExcel() (lines ~2444-2843).
 *
 * Uses xlsx-js-style (added as a real npm dependency here) rather than plain SheetJS/xlsx — same
 * API (XLSX.utils.aoa_to_sheet, XLSX.writeFile, etc., a drop-in replacement) but additionally
 * lets a cell carry a `.s` style object, needed to recolor the sheet to match the on-screen
 * grid. The original loaded it from a CDN <script> tag (public/duty-roster/index.html is a
 * standalone static page); this port uses the npm package instead, the idiomatic choice for a
 * bundled React app.
 *
 * Deliberately excludes summaryReportExportRows() — per the original's own comment, the Roster
 * tab's Export to Excel workbook never included a Summary Report sheet; that function is kept in
 * the legacy file only because its logic is referenced elsewhere, and this app's eventual
 * Summary Report tab (Task #20) has its own separate "Export to Excel (TimeAttendance format)"
 * button backed by a different function (timeAttendanceExportRows()) — out of scope here.
 */
import * as XLSX from "xlsx-js-style";
import type { Guard, GenerateMonthResult, MonthState } from "./types";
import type { GenerateMonthConfig } from "./schedulingEngine";
import { coveringGuardNameFor, monthSupportGuards, monthTempGuards, leaveEntriesFor } from "./rosterModel";
import { computeShiftDefsForDay } from "./shiftStructure";
import { dowMon, isWeekend, monthLabel, weekdayShort } from "./dateUtils";
import { SHIFT_LETTERS, leaveAbbrev } from "./rosterColors";

export function guardsExportRows(config: Pick<GenerateMonthConfig, "guards">): (string | number)[][] {
  const rows: (string | number)[][] = [["Name", "Employee ID", "Active"]];
  config.guards.forEach((g: Guard) => {
    rows.push([g.name, g.employeeId || "", g.active === false ? "No" : "Yes"]);
  });
  return rows;
}

type RosterCellMeta = { kind: "off" } | { kind: "leave"; covered: boolean } | { kind: "shift"; letter: string; flagged: boolean };

export interface RosterGridExport {
  rows: (string | number)[][];
  meta: RosterCellMeta[][];
  weekendCols: boolean[];
}

/** Mirrors renderRosterGrid()'s own dayMaps (rosterGridData.ts's buildGridData()), so the
 * exported file can never drift from what's displayed on screen. */
export function rosterGridExportRows(_y: number, _m: number, config: GenerateMonthConfig, ms: MonthState, result: GenerateMonthResult): RosterGridExport {
  const site = config.site;
  const nDays = result.days.length;

  const dayMaps = result.days.map((day) => {
    const map = new Map<string, { stIdx: number; slot: number; flagged: boolean }>();
    const shiftDefs = computeShiftDefsForDay(site, day.dm);
    day.assignments.forEach((slots, stIdx) => {
      slots.forEach((guardId, slotIdx) => {
        if (!guardId) return;
        const sd = shiftDefs[stIdx];
        const flag = result.flags.find((f) => f.date === day.dateStr && f.shiftId === (sd ? sd.id : "shift" + stIdx) && f.slot === slotIdx && f.restDay);
        map.set(guardId, { stIdx, slot: slotIdx, flagged: !!flag });
      });
    });
    return map;
  });
  const dayLeaveMaps = result.days.map((day) => {
    const map = new Map<string, ReturnType<typeof leaveEntriesFor>[number]>();
    leaveEntriesFor(ms, day.dateStr).forEach((e) => map.set(e.id, e));
    return map;
  });

  const guards = config.guards.filter((g) => g.active !== false || (result.totalShifts[g.id] || 0) > 0);
  const weekendCols = result.days.map((day) => isWeekend(day.y, day.m, day.d));

  const header: (string | number)[] = ["Guard"]
    .concat(result.days.map((day) => `${day.d} ${weekdayShort(day.y, day.m, day.d)}`))
    .concat(["Shifts", "Rest days"]);
  const rows: (string | number)[][] = [header];
  const meta: RosterCellMeta[][] = [];

  guards.forEach((g) => {
    const row: (string | number)[] = [g.name];
    const metaRow: RosterCellMeta[] = [];
    dayMaps.forEach((map, dayIdx) => {
      const a = map.get(g.id);
      if (!a) {
        const leaveEntry = dayLeaveMaps[dayIdx].get(g.id);
        if (!leaveEntry) {
          row.push("OFF");
          metaRow.push({ kind: "off" });
          return;
        }
        const covering = coveringGuardNameFor(config, ms, leaveEntry);
        row.push(leaveAbbrev(leaveEntry.reason || "Leave") + (covering ? ` (covered by ${covering})` : ""));
        metaRow.push({ kind: "leave", covered: !!covering });
      } else {
        row.push(`${SHIFT_LETTERS[a.stIdx % SHIFT_LETTERS.length]} P${a.slot + 1}`);
        metaRow.push({ kind: "shift", letter: SHIFT_LETTERS[a.stIdx % SHIFT_LETTERS.length], flagged: a.flagged });
      }
    });
    const worked = result.totalShifts[g.id] || 0;
    row.push(worked, nDays - worked);
    rows.push(row);
    meta.push(metaRow);
  });
  return { rows, meta, weekendCols };
}

/** Recolors and resizes the "Roster" sheet's worksheet object in place so the exported file
 * reads like the on-screen roster grid, instead of a flat black-and-white sheet. Colors are the
 * same hex values as rosterColors.ts's ROSTER_TOKENS/SHIFT_COLORS, copied here rather than
 * imported because a worksheet cell's `.s` needs a literal hex string with no leading `#`, not a
 * CSS-ready value — kept as its own literal table so a color change to the on-screen UI doesn't
 * silently change the exported file's colors without a deliberate matching edit here too. Should
 * be called in a try/catch by the caller — an export must never fail just because styling did. */
export function applyRosterSheetStyling(ws: XLSX.WorkSheet, meta: RosterCellMeta[][], weekendCols: boolean[]): void {
  const GREY_LINE = "DCE3DE"; // --line
  const SURFACE_2 = "EEF1EE"; // --surface-2 (header row / totals columns)
  const SURFACE = "FFFFFF"; // --surface (Guard column)
  const MUTED = "5C665F"; // --muted (OFF text)
  const ACCENT = "2F6F5E"; // --accent (weekend header text / "covered" ring)
  const ACCENT_SOFT = "DEEBE5"; // --accent-soft (weekend header fill)
  const WARN = "9A6A15"; // --warn (leave text / rest-day-flag ring)
  const WARN_SOFT = "F7ECD8"; // --warn-soft (leave fill)
  const SHIFT_FILL: Record<string, string> = { A: "DCEAFB", B: "E1F3E6", C: "FBF0D9", D: "F6E4FA" };
  const SHIFT_INK: Record<string, string> = { A: "1B3A5C", B: "1E4F2E", C: "5C4413", D: "5A2D63" };

  const thinBorder = (color: string) => {
    const side = { style: "thin", color: { rgb: color } };
    return { top: side, bottom: side, left: side, right: side };
  };
  const ringBorder = (color: string) => {
    const side = { style: "medium", color: { rgb: color } };
    return { top: side, bottom: side, left: side, right: side };
  };

  const nGuardRows = meta.length;
  const nDays = weekendCols.length; // columns: 0=Guard, 1..nDays=days, nDays+1=Shifts, nDays+2=Rest days

  ws["!cols"] = [{ wch: 16 }].concat(Array.from({ length: nDays }, () => ({ wch: 7 }))).concat([{ wch: 9 }, { wch: 11 }]);

  const setCell = (r: number, cIdx: number, style: Record<string, unknown>) => {
    const ref = XLSX.utils.encode_cell({ r, c: cIdx });
    const cell = ws[ref];
    if (cell) cell.s = Object.assign({}, cell.s, style);
  };

  // Header row (r=0).
  setCell(0, 0, { font: { bold: true }, fill: { fgColor: { rgb: SURFACE } }, border: thinBorder(GREY_LINE) });
  for (let d = 0; d < nDays; d++) {
    const wknd = weekendCols[d];
    setCell(0, d + 1, {
      font: { bold: true, color: { rgb: wknd ? ACCENT : MUTED } },
      fill: { fgColor: { rgb: wknd ? ACCENT_SOFT : SURFACE_2 } },
      alignment: { horizontal: "center" },
      border: thinBorder(GREY_LINE),
    });
  }
  setCell(0, nDays + 1, { font: { bold: true }, fill: { fgColor: { rgb: SURFACE_2 } }, border: thinBorder(GREY_LINE) });
  setCell(0, nDays + 2, { font: { bold: true }, fill: { fgColor: { rgb: SURFACE_2 } }, border: thinBorder(GREY_LINE) });

  // Data rows (r=1..nGuardRows).
  for (let g = 0; g < nGuardRows; g++) {
    const r = g + 1;
    setCell(r, 0, { font: { bold: true }, fill: { fgColor: { rgb: SURFACE } }, border: thinBorder(GREY_LINE) });
    const metaRow = meta[g];
    for (let d = 0; d < nDays; d++) {
      const cellMeta: RosterCellMeta = metaRow[d] || { kind: "off" };
      const base = { alignment: { horizontal: "center" }, border: thinBorder(GREY_LINE) };
      if (cellMeta.kind === "shift") {
        const fill = SHIFT_FILL[cellMeta.letter] || SHIFT_FILL.A;
        const ink = SHIFT_INK[cellMeta.letter] || SHIFT_INK.A;
        setCell(
          r,
          d + 1,
          Object.assign(base, {
            fill: { fgColor: { rgb: fill } },
            font: { color: { rgb: ink } },
            border: cellMeta.flagged ? ringBorder(WARN) : thinBorder(GREY_LINE),
          })
        );
      } else if (cellMeta.kind === "leave") {
        setCell(
          r,
          d + 1,
          Object.assign(base, {
            fill: { fgColor: { rgb: WARN_SOFT } },
            font: { bold: true, color: { rgb: WARN } },
            border: cellMeta.covered ? ringBorder(ACCENT) : thinBorder(GREY_LINE),
          })
        );
      } else {
        setCell(r, d + 1, Object.assign(base, { font: { color: { rgb: MUTED } } }));
      }
    }
    setCell(r, nDays + 1, { font: { bold: true }, fill: { fgColor: { rgb: SURFACE_2 } }, alignment: { horizontal: "center" }, border: thinBorder(GREY_LINE) });
    setCell(r, nDays + 2, { font: { bold: true }, fill: { fgColor: { rgb: SURFACE_2 } }, alignment: { horizontal: "center" }, border: thinBorder(GREY_LINE) });
  }
}

function shiftLabelForKey(config: GenerateMonthConfig, date: string, shiftId: string): string {
  const defs = computeShiftDefsForDay(config.site, dowMon(date));
  const st = defs.find((s) => s.id === shiftId);
  return st ? st.label : shiftId;
}

export function tempGuardExportRows(config: GenerateMonthConfig, ms: MonthState): (string | number)[][] {
  const tg = monthTempGuards(ms);
  const header: (string | number)[] = ["Date", "Shift", "Slot", "Name", "Rate (RM)"];
  const rows = Object.keys(tg)
    .map((tempId) => {
      const key = Object.keys(ms.overrides).find((k) => ms.overrides[k] === tempId);
      if (!key) return null;
      const [date, shiftId, slot] = key.split("|");
      return [date, shiftLabelForKey(config, date, shiftId), Number(slot) + 1, tg[tempId].name, Number(tg[tempId].rate) || 0] as (string | number)[];
    })
    .filter((r): r is (string | number)[] => r !== null)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const total = rows.reduce((sum, r) => sum + (r[4] as number), 0);
  return rows.length ? [header, ...rows, ["", "", "", "Total", total]] : [header];
}

/** Ported from supportGuardExportRows() (the original reads currentConfig() globally to resolve
 * shiftLabelForKey(); this takes config explicitly instead). */
export function supportGuardExportRows(config: GenerateMonthConfig, ms: MonthState): (string | number)[][] {
  const sg = monthSupportGuards(ms);
  const header: (string | number)[] = ["Date", "Shift", "Slot", "Employee ID", "Name", "From site"];
  const rows = Object.keys(sg)
    .map((supportId) => {
      const key = Object.keys(ms.overrides).find((k) => ms.overrides[k] === supportId);
      if (!key) return null;
      const [date, shiftId, slot] = key.split("|");
      const entry = sg[supportId] || ({} as (typeof sg)[string]);
      return [date, shiftLabelForKey(config, date, shiftId), Number(slot) + 1, entry.employeeId || "", entry.name || "", entry.homeSiteName || ""] as (
        | string
        | number
      )[];
    })
    .filter((r): r is (string | number)[] => r !== null)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows.length ? [header, ...rows] : [header];
}

/** exportCurrentMonthToExcel() — builds and downloads the workbook. `siteName` should already be
 * the display name (the original sanitizes it: strips anything but word chars/hyphens/spaces,
 * trims, collapses spaces to underscores — done here too). Returns the log text the caller
 * should append via appendLog()/persist(), matching the original's own addLog() call. */
export function exportCurrentMonthToExcel(
  y: number,
  m: number,
  config: GenerateMonthConfig,
  ms: MonthState,
  result: GenerateMonthResult,
  siteName: string | null,
  monthKey: string
): { logText: string } {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(guardsExportRows(config)), "Guards");
  const sheetName = monthLabel(y, m).slice(0, 31);
  const rosterExport = rosterGridExportRows(y, m, config, ms, result);
  const rosterWs = XLSX.utils.aoa_to_sheet(rosterExport.rows);
  try {
    applyRosterSheetStyling(rosterWs, rosterExport.meta, rosterExport.weekendCols);
  } catch (err) {
    // Best-effort: an export should never fail just because coloring did.
    // eslint-disable-next-line no-console
    console.error("Roster sheet styling failed — exporting without colors.", err);
  }
  XLSX.utils.book_append_sheet(wb, rosterWs, sheetName);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tempGuardExportRows(config, ms)), "Temp Guards");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(supportGuardExportRows(config, ms)), "Support Guards");

  const safeSiteName = (siteName || "Site").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_");
  XLSX.writeFile(wb, `${safeSiteName || "Site"}_${monthKey}_roster.xlsx`);

  return { logText: `Exported ${monthLabel(y, m)} roster to Excel.` };
}
