import { useEffect, useState } from "react";
import type { Guard, SiteConfig, MonthState, GenerateMonthResult } from "../types";
import type { GenerateMonthConfig } from "../schedulingEngine";
import { buildSupportSlotOptions, buildSupportGuardRows, applyAssignSupportGuard, applyRemoveSupportGuard } from "../supportGuardPanelData";
import { removeTempOrSupportGuardConfirmMessage } from "../tempGuardPanelData";
import { otherBranchSites, computeFreeGuardsAt, syncHomeSiteSupportLeave, type SitePickerOption } from "../supportGuardCrossSite";
import { computeShiftDefsForDay } from "../shiftStructure";
import { dowMon, shiftStartEnd } from "../dateUtils";
import ConfirmModal from "./modals/ConfirmModal";

/**
 * "Assign a support guard" panel (renderSupportGuardPanel(), index.html lines 4328-4408;
 * #assignSupportBtn line 5346). The whole panel is gated by `canAssignSupport` — the caller
 * should not even mount this when that's false (matches the original's `hidden =
 * !canAssignSupportGuard()`, which renders nothing further either way).
 */
export interface SupportGuardPanelProps {
  config: SiteConfig;
  ms: MonthState;
  result: GenerateMonthResult;
  allSites: Pick<SiteConfig, "id" | "name" | "branch" | "archived">[];
  /** Site-configs cache keyed by site id, for the origin site's own guard list + shift structure
   * (the original reads `state.configsCache[originId]`, kept live elsewhere in the app — out
   * of this panel's scope to fetch). Only origin sites the guard picker actually needs are looked
   * up; a missing entry just yields an empty guard list for that site. */
  siteConfigsCache: Record<string, GenerateMonthConfig>;
  onSave: (ms: MonthState, toast: string) => void;
}

export default function SupportGuardPanel({ config, ms, result, allSites, siteConfigsCache, onSave }: SupportGuardPanelProps) {
  const [slotKey, setSlotKey] = useState("");
  const [originSiteId, setOriginSiteId] = useState("");
  const [originGuardId, setOriginGuardId] = useState("");
  const [freeGuards, setFreeGuards] = useState<Guard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ supportId: string; name: string } | null>(null);

  const slotOptions = buildSupportSlotOptions(result.conflicts);
  const sites: SitePickerOption[] = otherBranchSites(allSites, config.id, config.branch);
  const rows = buildSupportGuardRows(config, ms);

  useEffect(() => {
    setOriginGuardId("");
    setFreeGuards(null);
    if (!slotKey || !originSiteId) return;
    const originConfig = siteConfigsCache[originSiteId];
    if (!originConfig) return;
    const [date, shiftId] = slotKey.split("|");
    const defs = computeShiftDefsForDay(config.site, dowMon(date));
    const sd = defs.find((s) => s.id === shiftId);
    const supportWindow = sd ? (() => {
      const { start, end } = shiftStartEnd(date, sd);
      return { startMs: start.getTime(), endMs: end.getTime() };
    })() : null;

    let cancelled = false;
    setLoading(true);
    computeFreeGuardsAt(originConfig, originSiteId, date, date.slice(0, 7), supportWindow)
      .then((guards) => {
        if (!cancelled) setFreeGuards(guards);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slotKey, originSiteId, siteConfigsCache, config.site]);

  function handleAssign() {
    if (!slotKey) return setError("Pick an unfilled slot first.");
    if (!originSiteId) return setError("Pick which site he's coming from.");
    if (!originGuardId) return setError("Pick which guard is covering this shift.");
    const originSite = sites.find((s) => s.id === originSiteId);
    const originGuard = (freeGuards || []).find((g) => g.id === originGuardId);
    if (!originSite || !originGuard) return setError("Couldn't find that guard — try again.");
    setError(null);

    const outcome = applyAssignSupportGuard(config, ms, slotKey, originSiteId, originSite.name, originGuardId, originGuard.name, originGuard.employeeId);
    setSlotKey("");
    setOriginSiteId("");
    setOriginGuardId("");
    onSave(outcome.ms, outcome.toast);

    const [date, shiftId] = slotKey.split("|");
    const defs = computeShiftDefsForDay(config.site, dowMon(date));
    const sd = defs.find((s) => s.id === shiftId);
    if (sd) {
      const { end } = shiftStartEnd(date, sd);
      // Fire-and-forget, matching the original (not awaited — doesn't block the UI).
      void syncHomeSiteSupportLeave(originSiteId, originGuardId, date, true, end.getTime(), config.id, config.name);
    }
  }

  function handleConfirmRemove() {
    if (!removeTarget) return;
    const outcome = applyRemoveSupportGuard(ms, removeTarget.supportId);
    setRemoveTarget(null);
    if (!outcome) return;
    onSave(outcome.ms, outcome.toast);
    if (outcome.leaveDateStr) void syncHomeSiteSupportLeave(outcome.homeSiteId, outcome.homeGuardId, outcome.leaveDateStr, false);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Assign a support guard</h3>

      {slotOptions.length === 0 || sites.length === 0 ? (
        <p className="text-xs text-slate-400 mt-2">
          {sites.length === 0 ? "No other sites in this branch to borrow a guard from." : "No unfilled slots this month."}
        </p>
      ) : (
        <div className="flex flex-col gap-2 mt-3">
          <select className="input" value={slotKey} onChange={(e) => setSlotKey(e.target.value)}>
            <option value="">Select an unfilled slot…</option>
            {slotOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select className="input" value={originSiteId} onChange={(e) => setOriginSiteId(e.target.value)}>
            <option value="">Coming from…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select className="input" value={originGuardId} onChange={(e) => setOriginGuardId(e.target.value)} disabled={loading || !freeGuards}>
            <option value="">{loading ? "Checking availability…" : (freeGuards?.length ?? 0) === 0 && freeGuards ? "No guards free that day (or would end up under-rested)" : "Select a guard…"}</option>
            {(freeGuards || []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} {g.employeeId ? `(${g.employeeId})` : ""}
              </option>
            ))}
          </select>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            type="button"
            onClick={handleAssign}
            className="self-end px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Assign
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <table className="w-full text-sm mt-4 border-collapse">
          <tbody>
            {rows.map((r) => (
              <tr key={r.supportId} className="border-t border-slate-100">
                <td className="py-1.5 font-mono text-xs whitespace-nowrap">{r.date}</td>
                <td className="py-1.5">{r.shiftSlotLabel}</td>
                <td className="py-1.5">{r.name}</td>
                <td className="py-1.5 text-xs text-slate-500">{r.fromSite}</td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => setRemoveTarget({ supportId: r.supportId, name: r.name })}
                    className="text-xs font-medium text-rose-600 hover:text-rose-700"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmModal
        open={!!removeTarget}
        title="Remove support guard"
        message={removeTarget ? removeTempOrSupportGuardConfirmMessage(removeTarget.name) : ""}
        okLabel="Remove"
        danger
        onConfirm={handleConfirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
