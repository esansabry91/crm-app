/**
 * Roster Sheet stat tiles — ported from renderRosterStats(), reusing this app's existing
 * StatCard component (src/components/analytics/StatCard.tsx) rather than hand-rolled tile
 * markup, matching how every other page in this app renders a stat-tile row.
 */
import type { GenerateMonthResult } from "../types";
import type { GenerateMonthConfig } from "../schedulingEngine";
import { computeRosterStatTiles } from "../statsMath";
import { ROSTER_TOKENS } from "../rosterColors";
import StatCard from "../../components/analytics/StatCard";

export interface RosterStatsProps {
  config: GenerateMonthConfig;
  result: GenerateMonthResult;
}

export default function RosterStats({ config, result }: RosterStatsProps) {
  const tiles = computeRosterStatTiles(config, result);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <StatCard label="Active guards" value={String(tiles.activeGuards)} />
      <StatCard label="Shift slots this month" value={String(tiles.shiftSlotsThisMonth)} />
      <StatCard
        label="Unfilled slots"
        value={String(tiles.unfilledSlots)}
        accent={tiles.unfilledIsCritical ? ROSTER_TOKENS.critical : ROSTER_TOKENS.accent}
      />
      <StatCard
        label="Auto-assigned on rest day"
        value={String(tiles.autoAssignedOnRestDay)}
        accent={tiles.autoAssignedIsWarn ? ROSTER_TOKENS.warn : ROSTER_TOKENS.accent}
      />
      <StatCard label="Fairness spread" value={String(tiles.fairnessSpread)} />
    </div>
  );
}
