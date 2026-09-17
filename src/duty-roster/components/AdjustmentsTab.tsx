import type { SiteConfig, MonthState, GenerateMonthResult } from "../types";
import type { GenerateMonthConfig } from "../schedulingEngine";
import type { RosterSession } from "../rosterModel";
import { canAssignSupportGuard } from "../rosterModel";
import type { SiteMeta } from "../guardBankSync";
import LeavePanel from "./LeavePanel";
import AdditionalGuardPanel from "./AdditionalGuardPanel";
import TempGuardPanel from "./TempGuardPanel";
import SupportGuardPanel from "./SupportGuardPanel";
import SwapPanel from "./SwapPanel";
import LogPanel from "./LogPanel";

/**
 * "Adjustments" tab — composes every panel from index.html's `#view-adjust` (lines 484-691):
 * left column is "In-Roster" (Mark a guard on leave, Assign an additional guard) then
 * "Replacement" (Assign a temporary guard, Assign a support guard); right column is Swap two
 * shifts + the Change log. Matches GuardsShiftsTab.tsx's composition pattern — this component
 * only turns user actions into the next MonthState via the pure appliers in leaveData.ts/
 * swapData.ts/tempGuardPanelData.ts/supportGuardPanelData.ts/additionalGuardData.ts, and hands
 * that off to the caller's persist callback, staying agnostic of Firestore itself.
 */
export interface AdjustmentsTabProps {
  config: SiteConfig;
  ms: MonthState;
  result: GenerateMonthResult;
  currentMonthKey: string;
  session: RosterSession;
  allSites: Pick<SiteConfig, "id" | "name" | "branch" | "archived">[];
  siteConfigsCache: Record<string, GenerateMonthConfig>;
  onPersistMonth: (ms: MonthState) => void;
  onToast: (message: string) => void;
}

export default function AdjustmentsTab({
  config,
  ms,
  result,
  currentMonthKey,
  session,
  allSites,
  siteConfigsCache,
  onPersistMonth,
  onToast,
}: AdjustmentsTabProps) {
  const canAssignSupport = canAssignSupportGuard(session);
  const siteMeta: SiteMeta = { id: config.id, name: config.name, branch: config.branch, tenderId: config.tenderId };
  const isTestData = !!config.isTestData;

  function save(nextMs: MonthState, toast?: string) {
    onPersistMonth(nextMs);
    if (toast) onToast(toast);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">In-Roster</p>
        <LeavePanel
          config={config}
          ms={ms}
          result={result}
          canAssignSupport={canAssignSupport}
          allSites={allSites}
          siteConfigsCache={siteConfigsCache}
          onSave={save}
        />
        <AdditionalGuardPanel
          config={config}
          ms={ms}
          currentMonthKey={currentMonthKey}
          canAssignSupport={canAssignSupport}
          allSites={allSites}
          siteConfigsCache={siteConfigsCache}
          siteMeta={siteMeta}
          isTestData={isTestData}
          onSave={save}
        />

        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-2">Replacement</p>
        <TempGuardPanel config={config} ms={ms} result={result} siteMeta={siteMeta} isTestData={isTestData} onSave={save} />
        {canAssignSupport && (
          <SupportGuardPanel config={config} ms={ms} result={result} allSites={allSites} siteConfigsCache={siteConfigsCache} onSave={save} />
        )}
      </div>

      <div className="flex flex-col gap-4">
        <SwapPanel config={config} ms={ms} result={result} currentMonthKey={currentMonthKey} onSave={save} />
        <LogPanel ms={ms} />
      </div>
    </div>
  );
}
