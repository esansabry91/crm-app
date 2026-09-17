import { useEffect, useState } from "react";
import type { SiteConfig, MonthState } from "../types";
import { applySaveRestRules, maxConsecutiveDaysFor } from "../siteSetupData";

/**
 * "Rest rules" panel (renderRestInputs() + #saveRestBtn, index.html lines 3784-3795, 5141-5148).
 * Field edits mark the section dirty on every keystroke in the original (renderSetupGate() re-run
 * live) but don't persist until Save — mirrored here with local draft state, persisted only
 * on submit.
 */
export interface RestRulesPanelProps {
  config: SiteConfig;
  ms: MonthState;
  onSave: (next: { config: SiteConfig; ms: MonthState }, toast: string) => void;
}

export default function RestRulesPanel({ config, ms, onSave }: RestRulesPanelProps) {
  const [restDaysPerWeek, setRestDaysPerWeek] = useState(config.restRule.restDaysPerWeek);
  const [minRestHours, setMinRestHours] = useState(config.restRule.minRestHours);

  useEffect(() => {
    setRestDaysPerWeek(config.restRule.restDaysPerWeek);
    setMinRestHours(config.restRule.minRestHours);
  }, [config.restRule.restDaysPerWeek, config.restRule.minRestHours]);

  function handleSave() {
    const outcome = applySaveRestRules(config, ms, restDaysPerWeek, minRestHours);
    onSave({ config: outcome.config, ms: outcome.ms }, outcome.toast);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Rest rules</h3>

      <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">Rest days / week</label>
      <input
        type="number"
        min={0}
        max={6}
        className="input"
        value={restDaysPerWeek}
        onChange={(e) => setRestDaysPerWeek(Number(e.target.value))}
      />

      <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">Min rest hours between shifts</label>
      <input type="number" min={0} className="input" value={minRestHours} onChange={(e) => setMinRestHours(Number(e.target.value))} />

      <p className="text-xs text-slate-500 mt-2">
        = up to {maxConsecutiveDaysFor({ restRule: { restDaysPerWeek } })} consecutive working days before a rest day is due.
      </p>

      <div className="flex justify-end mt-4">
        <button type="button" onClick={handleSave} className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
          Save Rest Rules
        </button>
      </div>
    </div>
  );
}
