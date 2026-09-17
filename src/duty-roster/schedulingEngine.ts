/**
 * Scheduling engine — ported verbatim (algorithm-for-algorithm) from
 * public/duty-roster/index.html lines ~1479-1667 (generateMonth). This is the single most
 * business-critical function in the whole console: it derives a full month's shift assignments
 * from config + overrides + leaves, including the auto-assignment fairness algorithm, rest-day
 * coverage fallback, conflict/flag detection, and Additional Guard (Temporary) billing entries.
 *
 * Porting note: the original reached into module-level globals for `guardById`/`activeGuardsOn`/
 * `guardName` (via `currentConfig()`); those are passed here explicitly as `config` (already a
 * generateMonth parameter in the original too) so the function stays a true pure function with
 * no hidden state — the doc comment on the original ("Pure function: derive a full month's
 * assignments from config + overrides + leaves") is now actually enforced by its signature.
 */
import type {
  ConflictEntry,
  DayAssignments,
  FlagEntry,
  GenerateMonthResult,
  MonthState,
  SiteConfig,
} from "./types";
import { RESERVED_FOR_TEMP } from "./types";
import { daysInMonth, dowMon, prevDateStr, shiftStartEnd, ymd } from "./dateUtils";
import { computeShiftDefsForDay, coverageDaysPerWeek, maxConsecutiveDaysFor, postsAt } from "./shiftStructure";
import { COMPLIANCE_MAX_WEEKLY_HOURS } from "./complianceRules";
import {
  activeGuardsOn,
  extraGuardEntriesFor,
  guardById,
  guardName,
  leaveEntriesFor,
  leaveNoun,
} from "./rosterModel";

export type GenerateMonthConfig = Pick<SiteConfig, "guards" | "site" | "restRule">;

export function generateMonth(
  y: number,
  m: number,
  config: GenerateMonthConfig,
  monthState: MonthState
): GenerateMonthResult {
  const nDays = daysInMonth(y, m);
  const cov = coverageDaysPerWeek(config.site);
  const maxConsecutiveDays = maxConsecutiveDaysFor(config);
  const minRestHours = Number(config.restRule.minRestHours) || 0;
  // "RBA/SMETA compliance mode" — see complianceRules.ts. When on, no guard's total hours in any
  // single Monday-Sunday week may exceed COMPLIANCE_MAX_WEEKLY_HOURS; unlike minRestHours/
  // maxConsecutiveDays (which the rest-day fallback below is allowed to override), this cap is
  // never bypassed — a shift that can't be filled without breaching it is left a conflict instead.
  const complianceMode = !!config.restRule.complianceMode;
  const totalShifts: Record<string, number> = {};
  const lastShiftEnd: Record<string, number> = {};
  const lastWorkDate: Record<string, string> = {};
  const streak: Record<string, number> = {};
  const extraGuardHours: Record<string, number> = {};
  // Hours worked so far in the current Monday-Sunday week, reset whenever a new week starts
  // (dm === 0). Only meaningful/enforced when complianceMode is on.
  let weeklyHours: Record<string, number> = {};
  config.guards.forEach((g) => {
    totalShifts[g.id] = 0;
  });
  const days: DayAssignments[] = [];
  const conflicts: ConflictEntry[] = [];
  const flags: FlagEntry[] = [];

  for (let d = 1; d <= nDays; d++) {
    const dateStr = ymd(y, m, d);
    const dm = dowMon(dateStr);
    if (dm === 0) weeklyHours = {}; // new Monday-Sunday week starts — reset every guard's tally
    const covered = dm < cov;
    const shiftDefs = computeShiftDefsForDay(config.site, dm); // recomputed per day (FULLH varies)
    const leaveEntriesToday = leaveEntriesFor(monthState, dateStr);
    const leaveList = leaveEntriesToday.map((e) => e.id);
    leaveEntriesToday.forEach((e) => {
      if (typeof e.supportShiftEndMs === "number") {
        lastShiftEnd[e.id] = Math.max(lastShiftEnd[e.id] || 0, e.supportShiftEndMs);
      }
    });
    const dayAssignments: (string | null)[][] = [];
    const workedToday = new Set<string>();

    shiftDefs.forEach((st) => {
      const posts = covered ? Math.max(0, Math.round(postsAt(config.site, dm, st.night))) : 0;
      const slots: (string | null)[] = [];

      for (let slot = 0; slot < posts; slot++) {
        const overrideKey = dateStr + "|" + st.id + "|" + slot;
        const overrideGuard = monthState.overrides[overrideKey];
        let chosen: string | null = null;

        if (overrideGuard === RESERVED_FOR_TEMP) {
          conflicts.push({ date: dateStr, shiftId: st.id, shiftLabel: st.label, slot });
        } else if (overrideGuard) {
          chosen = overrideGuard;
          const reasons: string[] = [];
          if (leaveList.includes(overrideGuard)) reasons.push("on leave");
          if (workedToday.has(overrideGuard)) reasons.push("already on another shift today");
          const g = guardById(config, monthState, overrideGuard);
          if (g && g.inactiveFrom && dateStr >= g.inactiveFrom) reasons.push("no longer active");
          if (lastWorkDate[overrideGuard] === prevDateStr(dateStr) && streak[overrideGuard] >= maxConsecutiveDays)
            reasons.push("exceeds max consecutive days");
          if (lastShiftEnd[overrideGuard] != null) {
            const { start } = shiftStartEnd(dateStr, st);
            const gapH = (start.getTime() - lastShiftEnd[overrideGuard]) / 3600000;
            if (gapH < minRestHours) reasons.push("less than " + minRestHours + "h rest");
          }
          if (complianceMode && (weeklyHours[overrideGuard] || 0) + st.hours > COMPLIANCE_MAX_WEEKLY_HOURS)
            reasons.push(`would exceed ${COMPLIANCE_MAX_WEEKLY_HOURS}h weekly cap (RBA/SMETA compliance)`);
          if (reasons.length)
            flags.push({ date: dateStr, shiftId: st.id, shiftLabel: st.label, slot, guardId: overrideGuard, reason: reasons.join(", ") });
        } else {
          const byFairness = (a: { id: string }, b: { id: string }) => {
            const diff = totalShifts[a.id] - totalShifts[b.id];
            if (diff !== 0) return diff;
            const ea = lastShiftEnd[a.id] || 0;
            const eb = lastShiftEnd[b.id] || 0;
            if (ea !== eb) return ea - eb;
            return a.id < b.id ? -1 : 1;
          };
          const exceedsComplianceCap = (guardId: string) =>
            complianceMode && (weeklyHours[guardId] || 0) + st.hours > COMPLIANCE_MAX_WEEKLY_HOURS;
          const rested = activeGuardsOn(config, dateStr).filter((g) => {
            if (leaveList.includes(g.id)) return false;
            if (workedToday.has(g.id)) return false;
            if (lastWorkDate[g.id] === prevDateStr(dateStr) && streak[g.id] >= maxConsecutiveDays) return false;
            if (lastShiftEnd[g.id] != null) {
              const { start } = shiftStartEnd(dateStr, st);
              const gapH = (start.getTime() - lastShiftEnd[g.id]) / 3600000;
              if (gapH < minRestHours) return false;
            }
            if (exceedsComplianceCap(g.id)) return false;
            return true;
          });
          if (rested.length) {
            rested.sort(byFairness);
            chosen = rested[0].id;
          } else {
            // Compliance mode's weekly-hours cap is deliberately NOT bypassed here, unlike
            // minRestHours/maxConsecutiveDays above — a shift that can only be filled by breaching
            // it is left a conflict (see the else-branch below) rather than auto-assigned anyway.
            const anyAvailable = activeGuardsOn(config, dateStr).filter(
              (g) => !leaveList.includes(g.id) && !workedToday.has(g.id) && !exceedsComplianceCap(g.id)
            );
            if (anyAvailable.length) {
              anyAvailable.sort(byFairness);
              chosen = anyAvailable[0].id;
              let reason: string;
              if (leaveEntriesToday.length === 1) {
                const lv = leaveEntriesToday[0];
                reason = `covering ${guardName(config, monthState, lv.id)}'s ${leaveNoun(lv.reason)} — normally a rest day`;
              } else if (leaveEntriesToday.length > 1) {
                const names = leaveEntriesToday.map((lv) => guardName(config, monthState, lv.id)).join(", ");
                reason = `covering during leave (${names}) — normally a rest day`;
              } else {
                reason = "no rested guard available — auto-assigned on rest day";
              }
              flags.push({
                date: dateStr,
                shiftId: st.id,
                shiftLabel: st.label,
                slot,
                guardId: chosen,
                reason,
                restDay: true,
                coveringLeave: leaveEntriesToday.length > 0,
              });
            } else {
              conflicts.push({ date: dateStr, shiftId: st.id, shiftLabel: st.label, slot });
            }
          }
        }

        if (chosen) {
          workedToday.add(chosen);
          totalShifts[chosen] = (totalShifts[chosen] || 0) + 1;
          weeklyHours[chosen] = (weeklyHours[chosen] || 0) + st.hours;
          const { end } = shiftStartEnd(dateStr, st);
          lastShiftEnd[chosen] = end.getTime();
        }
        slots.push(chosen);
      }

      // Additional Guard (Temporary) posts — appended AFTER all normal slots so slot index never collides
      if (covered) {
        extraGuardEntriesFor(monthState, dateStr, st.id).forEach((entry) => {
          const guardId = entry.guardId;
          if (!guardId) return;
          const slot = slots.length;
          const reasons = ["additional guard (temporary)"];
          if (leaveList.includes(guardId)) reasons.push("on leave");
          if (workedToday.has(guardId)) reasons.push("already on another shift today");
          const g = guardById(config, monthState, guardId);
          if (g && g.inactiveFrom && dateStr >= g.inactiveFrom) reasons.push("no longer active");
          if (lastWorkDate[guardId] === prevDateStr(dateStr) && streak[guardId] >= maxConsecutiveDays)
            reasons.push("exceeds max consecutive days");
          if (lastShiftEnd[guardId] != null) {
            const { start } = shiftStartEnd(dateStr, st);
            const gapH = (start.getTime() - lastShiftEnd[guardId]) / 3600000;
            if (gapH < minRestHours) reasons.push("less than " + minRestHours + "h rest");
          }
          if (complianceMode && (weeklyHours[guardId] || 0) + st.hours > COMPLIANCE_MAX_WEEKLY_HOURS)
            reasons.push(`would exceed ${COMPLIANCE_MAX_WEEKLY_HOURS}h weekly cap (RBA/SMETA compliance)`);
          flags.push({
            date: dateStr,
            shiftId: st.id,
            shiftLabel: st.label,
            slot,
            guardId,
            reason: reasons.join(", "),
            extraGuard: true,
          });
          workedToday.add(guardId);
          totalShifts[guardId] = (totalShifts[guardId] || 0) + 1;
          weeklyHours[guardId] = (weeklyHours[guardId] || 0) + st.hours;
          extraGuardHours[guardId] = (extraGuardHours[guardId] || 0) + st.hours;
          const { end } = shiftStartEnd(dateStr, st);
          lastShiftEnd[guardId] = end.getTime();
          slots.push(guardId);
        });
      }

      dayAssignments.push(slots);
    });

    // update streaks after day is fully processed
    config.guards.forEach((g) => {
      if (workedToday.has(g.id)) {
        streak[g.id] = lastWorkDate[g.id] === prevDateStr(dateStr) ? (streak[g.id] || 0) + 1 : 1;
        lastWorkDate[g.id] = dateStr;
      }
    });

    days.push({ dateStr, y, m, d, dm, covered, assignments: dayAssignments });
  }

  return { days, totalShifts, conflicts, flags, extraGuardHours };
}
