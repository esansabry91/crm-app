import type { Guard } from "../types";
import { buildGuardRows } from "../guardsTabData";
import { computeSetupGate } from "../siteSetupData";
import type { SiteConfig } from "../types";

/**
 * "Guard roster" panel (renderGuardsTable(), index.html lines 3613-3663) — the left column
 * of the Guards & Shifts tab. Actions (View/Dismiss-Reactivate/Back to Guard Pool) are lifted to
 * the parent tab component since Dismiss and Back-to-Pool both open a confirm modal owned there.
 */
export interface GuardsTableProps {
  config: Pick<SiteConfig, "guards" | "setupSaved">;
  onAddGuard: () => void;
  onView: (guard: Guard) => void;
  onToggleActive: (guard: Guard) => void;
  onReturnToPool: (guard: Guard) => void;
}

export default function GuardsTable({ config, onAddGuard, onView, onToggleActive, onReturnToPool }: GuardsTableProps) {
  const rows = buildGuardRows(config);
  const gate = computeSetupGate(config);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Guard roster</h3>
        <button
          type="button"
          disabled={gate.locked}
          onClick={onAddGuard}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
        >
          + Add guard
        </button>
      </div>
      {gate.locked && <p className="text-xs mt-1.5" style={{ color: "#9A6A15" }}>{gate.noteText}</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 mt-4">No guards yet — add your first one above.</p>
      ) : (
        <table className="w-full text-sm mt-3 border-collapse">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="font-medium py-1.5">Name</th>
              <th className="font-medium py-1.5">Employee ID</th>
              <th className="font-medium py-1.5">Status</th>
              <th className="font-medium py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ guard, statusLabel, statusClass }) => (
              <tr key={guard.id} className="border-t border-slate-100">
                <td className="py-1.5">{guard.name}</td>
                <td className="py-1.5 font-mono text-xs">{guard.employeeId || "—"}</td>
                <td className="py-1.5">
                  <span
                    className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                    style={
                      statusClass === "inactive"
                        ? { background: "#FDE2E2", color: "#9C2B2B" }
                        : { background: "#DEEBE5", color: "#2F6F5E" }
                    }
                  >
                    {statusLabel}
                  </span>
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <button type="button" onClick={() => onView(guard)} className="text-xs font-medium text-blue-600 hover:text-blue-700 mr-3">
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleActive(guard)}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 mr-3"
                  >
                    {guard.active === false ? "Reactivate" : "Dismiss"}
                  </button>
                  <button type="button" onClick={() => onReturnToPool(guard)} className="text-xs font-medium text-slate-500 hover:text-slate-700">
                    Back to Guard Pool
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
