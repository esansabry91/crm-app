/**
 * Roster Sheet / Calendar color tokens — ported from the CSS custom properties in
 * public/duty-roster/index.html's <style> block (lines ~48-65, 137-178). This app has no
 * Tailwind `@theme` block (src/index.css just `@import`s Tailwind directly), so — matching the
 * existing convention in src/components/analytics/StatCard.tsx (an `accent` prop applied via
 * inline `style`) — these are plain hex constants applied via inline style/arbitrary-value
 * classes rather than named Tailwind utilities.
 */

export const SHIFT_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

/** One color pair per shift index, cycling every 4 — matches SHIFT_CLASSES or shift-a..d in the
 * original (only 4 distinct shift colors were ever defined; a 5th/6th concurrent shift reuses
 * shift-a/b's colors, same as the original's `% SHIFT_CLASSES.length`). */
export const SHIFT_COLORS: { bg: string; ink: string }[] = [
  { bg: "#DCEAFB", ink: "#1B3A5C" }, // shift-a
  { bg: "#E1F3E6", ink: "#1E4F2E" }, // shift-b
  { bg: "#FBF0D9", ink: "#5C4413" }, // shift-c
  { bg: "#F6E4FA", ink: "#5A2D63" }, // shift-d
];

export function shiftColorFor(shiftIdx: number): { bg: string; ink: string } {
  return SHIFT_COLORS[shiftIdx % SHIFT_COLORS.length];
}

export function shiftLetterFor(shiftIdx: number): string {
  return SHIFT_LETTERS[shiftIdx % SHIFT_LETTERS.length];
}

export const ROSTER_TOKENS = {
  surface: "#FFFFFF",
  surface2: "#EEF1EE",
  ink: "#1C2420",
  muted: "#5C665F",
  line: "#DCE3DE",
  accent: "#2F6F5E",
  accentInk: "#FFFFFF",
  accentSoft: "#DEEBE5",
  warn: "#9A6A15",
  warnSoft: "#F7ECD8",
  critical: "#B23A2C",
  criticalSoft: "#F8E4E1",
};

/** Abbreviation shown in a grid "OFF" cell for a leave reason — ported from renderRosterGrid()'s
 * leaveAbbrev(). */
export function leaveAbbrev(reason: string | undefined): string {
  if (reason === "Absent") return "ABS";
  if (reason && reason.toLowerCase().indexOf("medical") !== -1) return "MC";
  if (reason === "Unpaid Leave") return "UPL";
  if (reason === "Support (Other Site)") return "SUP";
  return "LV";
}
