/**
 * Shared constant for the "RBA/SMETA compliance mode" toggle on a site's Rest Rules.
 *
 * When a site turns this on, both the scheduling engine (schedulingEngine.ts) and the suggested-
 * headcount estimate (shiftStructure.ts's suggestedGuardCount()) treat no guard's *total* hours
 * in any single calendar week (Monday-Sunday, regular + OT combined) as allowed to exceed this
 * cap, and the scheduler will leave a slot unfilled (flagged as a conflict) rather than assign a
 * guard who would breach it — never silently over-schedule someone past the cap.
 *
 * Why one flat number covers three different rulebooks:
 *  - RBA Code of Conduct: workweek must not exceed 60h (regular + OT combined), except emergencies.
 *  - SMETA (via the ETI Base Code): regular hours capped at 48h/week, total (regular + OT) capped
 *    at 60h/week, overtime must be voluntary and paid at >=125% of the regular rate.
 *  - Malaysia's Employment Act 1955 (as amended, effective 1 Jan 2023): max 45h/week for all
 *    employees under the Act (shift or non-shift — shift workers may average this over a rolling
 *    3-week window, but a flat single-week cap is always at least as strict as that average), plus
 *    a monthly overtime ceiling of 104h and a mandatory rest day every 7 days.
 *
 * Malaysian local law is the strictest of the three on regular/weekly hours, so enforcing a flat
 * 45h/week ceiling on every guard automatically satisfies RBA's and SMETA's looser 60h combined
 * cap as well — a single number, deliberately conservative, instead of three separate thresholds
 * that would need reconciling against "whichever affords the greater protection" (the ETI Base
 * Code's own phrasing) on every roster.
 *
 * This does NOT (yet) enforce Malaysia's separate 104h/month overtime ceiling, SMETA's 125%
 * overtime-premium-pay requirement, or the true 3-week rolling average for shift workers — it is a
 * single, simpler, and strictly more conservative stand-in for all of them on the weekly axis.
 * The mandatory 1-day-off-in-7 requirement common to all three frameworks is already enforced
 * separately via each site's own `restRule.restDaysPerWeek` (see RestRulesPanel.tsx) — turning on
 * compliance mode does not lower that below 1 automatically, so set restDaysPerWeek to at least 1
 * alongside this toggle if the site doesn't already.
 */
export const COMPLIANCE_MAX_WEEKLY_HOURS = 45;
