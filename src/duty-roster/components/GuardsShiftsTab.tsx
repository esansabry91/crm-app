import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Guard, SiteConfig, MonthState, TenderRateConfig } from "../types";
import { ratePositionNames } from "../rateResolution";
import {
  syncGuardBankOnAdd,
  syncGuardBankOnDismiss,
  syncGuardBankOnReactivate,
  syncGuardBankOnReturnToPool,
  type SiteMeta,
} from "../guardBankSync";
import { applyReactivateGuard, applyDismissGuard, applyReturnGuardToPool, backToGuardPoolConfirmMessage } from "../guardsTabData";
import { addGuardLogText } from "../addGuardData";
import { appendLog } from "../lockMachine";
import { deepClone } from "../rosterModel";
import GuardsTable from "./GuardsTable";
import SiteRequirementPanel from "./SiteRequirementPanel";
import RestRulesPanel from "./RestRulesPanel";
import HolidaysPanel from "./HolidaysPanel";
import AddGuardModal from "./modals/AddGuardModal";
import DutyRosterGuardDetailsModal from "./modals/GuardDetailsModal";
import DismissGuardModal from "./modals/DismissGuardModal";
import ConfirmModal from "./modals/ConfirmModal";

/**
 * "Guards & Shifts" tab — composes the Guard roster table (left column) and the Client Site
 * Requirement / Rest rules / Public holidays panels (right column), matching the original's
 * `.grid2` layout (index.html lines 391-483). Owns the 3 guard-action modals (Add/View/Dismiss)
 * and the "Back to Guard Pool" confirm, since those are guard-roster concerns specific to this
 * tab rather than the generic panels above.
 *
 * `config`/`ms` are expected to come from the page-level useSiteConfig()/useMonthState() hooks
 * (Task #22 wires the shared subscription across every tab) — this component only knows how
 * to turn a user action into the next `{config, ms}` pair via the pure appliers in
 * siteSetupData.ts/guardsTabData.ts/addGuardData.ts, and hands that off to the caller's
 * persist callbacks so it stays agnostic of Firestore itself, same as RosterGrid/RosterCalendar.
 */
export interface GuardsShiftsTabProps {
  config: SiteConfig;
  ms: MonthState;
  rateConfig: TenderRateConfig | null;
  onPersistConfig: (config: SiteConfig) => void;
  onPersistMonth: (ms: MonthState) => void;
  onToast: (message: string) => void;
}

export default function GuardsShiftsTab({ config, ms, rateConfig, onPersistConfig, onPersistMonth, onToast }: GuardsShiftsTabProps) {
  const { t } = useTranslation();
  const [addOpen, setAddOpen] = useState(false);
  const [viewGuard, setViewGuard] = useState<Guard | null>(null);
  const [dismissGuard, setDismissGuard] = useState<Guard | null>(null);
  const [returnTarget, setReturnTarget] = useState<Guard | null>(null);

  const siteMeta: SiteMeta = { id: config.id, name: config.name, branch: config.branch, tenderId: config.tenderId };
  const isTestData = !!config.isTestData;

  function save(next: { config: SiteConfig; ms: MonthState }, toast: string) {
    onPersistConfig(next.config);
    onPersistMonth(next.ms);
    onToast(toast);
  }

  function handleAddGuardSubmit(guard: Guard) {
    const nextConfig = deepClone(config);
    nextConfig.guards.push(guard);
    nextConfig.isSample = false;
    const nextMs = appendLog(ms, addGuardLogText(guard));
    setAddOpen(false);
    // Matches the original: both persistConfig() AND persistMonth() fire on Add (the latter just
    // flushes the appended log line into the month doc) — save() below does both via
    // onPersistConfig+onPersistMonth.
    save({ config: nextConfig, ms: nextMs }, t('dutyRoster.guardsShiftsTab.toastAdded', { name: guard.name }));
    syncGuardBankOnAdd(guard, siteMeta, isTestData);
  }

  function handleToggleActive(guard: Guard) {
    if (guard.active === false) {
      const outcome = applyReactivateGuard(config, ms, guard.id, t);
      if (!outcome) return;
      save({ config: outcome.config, ms: outcome.ms }, outcome.toast);
      const reactivated = outcome.config.guards.find((g) => g.id === guard.id);
      if (reactivated) syncGuardBankOnReactivate(reactivated, siteMeta);
    } else {
      setDismissGuard(guard);
    }
  }

  function handleConfirmDismiss(reason: string) {
    if (!dismissGuard) return;
    const outcome = applyDismissGuard(config, ms, dismissGuard.id, reason, t);
    setDismissGuard(null);
    if (!outcome) return;
    save({ config: outcome.config, ms: outcome.ms }, outcome.toast);
    const dismissed = outcome.config.guards.find((g) => g.id === dismissGuard.id);
    if (dismissed) syncGuardBankOnDismiss(dismissed, reason, siteMeta, isTestData);
  }

  function handleConfirmReturnToPool() {
    if (!returnTarget) return;
    const outcome = applyReturnGuardToPool(config, ms, returnTarget.id, t);
    setReturnTarget(null);
    if (!outcome) return;
    save({ config: outcome.config, ms: outcome.ms }, outcome.toast);
    syncGuardBankOnReturnToPool(outcome.removedGuard, isTestData);
  }

  const positionNames = ratePositionNames(rateConfig);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <GuardsTable
        config={config}
        onAddGuard={() => setAddOpen(true)}
        onView={setViewGuard}
        onToggleActive={handleToggleActive}
        onReturnToPool={setReturnTarget}
      />

      <div className="flex flex-col gap-4">
        <SiteRequirementPanel config={config} ms={ms} onSave={save} />
        <RestRulesPanel config={config} ms={ms} onSave={save} />
        <HolidaysPanel config={config} ms={ms} onSave={save} />
      </div>

      <AddGuardModal open={addOpen} positionNames={positionNames} onClose={() => setAddOpen(false)} onSubmit={handleAddGuardSubmit} />
      <DutyRosterGuardDetailsModal guard={viewGuard} rateConfig={rateConfig} onClose={() => setViewGuard(null)} />
      <DismissGuardModal guard={dismissGuard} onConfirm={handleConfirmDismiss} onCancel={() => setDismissGuard(null)} />
      <ConfirmModal
        open={!!returnTarget}
        title={t('dutyRoster.guardsTable.backToGuardPoolButton')}
        message={returnTarget ? backToGuardPoolConfirmMessage(returnTarget.name, t) : ""}
        okLabel={t('dutyRoster.guardsTable.backToGuardPoolButton')}
        onConfirm={handleConfirmReturnToPool}
        onCancel={() => setReturnTarget(null)}
      />
    </div>
  );
}
