/**
 * Guards & Shifts tab — the "Guard roster" table and its Dismiss/Reactivate/Back-to-Guard-Pool
 * actions. Ported from renderGuardsTable() (lines 3613-3663) and the three action handlers it
 * wires up. Guard Bank sync side effects (syncGuardBankOnDismiss/OnReactivate/OnReturnToPool)
 * are already ported in guardBankSync.ts — the caller (a hook/component) fires those separately
 * after applying the state change here, same as the legacy code calls them right after
 * persistConfig().
 */
import type { TFunction } from "i18next";
import type { Guard, SiteConfig, MonthState } from "./types";
import { deepClone } from "./rosterModel";
import { appendLog } from "./lockMachine";
import type { ConfigActionOutcome } from "./siteSetupData";

export interface GuardRow {
  guard: Guard;
  statusLabel: string;
  statusClass: "inactive" | "active";
}

/** buildGuardRows() — table rows in the config's own array order (no sort), matching the
 * original. Status pill: "Inactive" if `active === false`; else `Active until ${inactiveFrom}`
 * if that field is set (a legacy/future field observed nowhere written in this scope —
 * ported as a display rule anyway, faithfully); else plain "Active". */
export function buildGuardRows(config: Pick<SiteConfig, "guards">, t: TFunction): GuardRow[] {
  return config.guards.map((guard) => {
    const inactive = guard.active === false;
    const statusLabel = inactive
      ? t("dutyRoster.guardDetails.inactive")
      : guard.inactiveFrom
      ? t("dutyRoster.guardsTable.activeUntil", { date: guard.inactiveFrom })
      : t("dutyRoster.guardDetails.active");
    return { guard, statusLabel, statusClass: inactive ? "inactive" : "active" };
  });
}

/** Reactivate toggle when the guard is currently inactive — fires immediately, no confirm
 * modal (matches the original). Caller should follow up with syncGuardBankOnReactivate(guard). */
export function applyReactivateGuard(config: SiteConfig, ms: MonthState, guardId: string, t: TFunction): ConfigActionOutcome | null {
  const nextConfig = deepClone(config);
  const g = nextConfig.guards.find((x) => x.id === guardId);
  if (!g) return null;
  g.active = true;
  g.inactiveFrom = null;
  nextConfig.isSample = false;
  const nextMs = appendLog(ms, `Reactivated guard ${g.name}.`);
  return { config: nextConfig, ms: nextMs, toast: t("dutyRoster.guardsTable.toastReactivated", { name: g.name }) };
}

/** Dismiss — called after openDismissGuardModal()'s onConfirm(reason). Caller should follow
 * up with syncGuardBankOnDismiss(guard, reason). No "has shifts this month" block — the
 * legacy code has none; dismissal is unconditional once a reason is picked. */
export function applyDismissGuard(config: SiteConfig, ms: MonthState, guardId: string, reason: string, t: TFunction): ConfigActionOutcome | null {
  const nextConfig = deepClone(config);
  const g = nextConfig.guards.find((x) => x.id === guardId);
  if (!g) return null;
  g.active = false;
  nextConfig.isSample = false;
  const nextMs = appendLog(ms, `Dismissed guard ${g.name} (${reason}).`);
  return { config: nextConfig, ms: nextMs, toast: t("dutyRoster.guardsTable.toastDismissed", { name: g.name }) };
}

/** "Back to Guard Pool" confirm message (openConfirmModal, verbatim incl. the source's own "--"
 * double-hyphen, not an em-dash). */
export function backToGuardPoolConfirmMessage(guardName: string, t: TFunction): string {
  return t("dutyRoster.guardsTable.confirmBackToPool", { name: guardName });
}

/** Back to Guard Pool — unlike Dismiss, this actually removes the guard from `guards[]`
 * entirely. Caller should follow up with syncGuardBankOnReturnToPool(guard) using the REMOVED
 * guard object (returned here) since it's no longer in the new config. */
export function applyReturnGuardToPool(
  config: SiteConfig,
  ms: MonthState,
  guardId: string,
  t: TFunction
): (ConfigActionOutcome & { removedGuard: Guard }) | null {
  const guard = config.guards.find((x) => x.id === guardId);
  if (!guard) return null;
  const nextConfig = deepClone(config);
  nextConfig.guards = nextConfig.guards.filter((x) => x.id !== guardId);
  nextConfig.isSample = false;
  const nextMs = appendLog(ms, `Sent guard ${guard.name} back to Guard Pool.`);
  return { config: nextConfig, ms: nextMs, toast: t("dutyRoster.guardsTable.toastBackToPool", { name: guard.name }), removedGuard: guard };
}
