import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Guard, SiteConfig, MonthState } from "../types";
import type { GenerateMonthConfig } from "../schedulingEngine";
import {
  additionalGuardShiftOptions,
  additionalGuardSupportGuardOptions,
  buildAdditionalGuardRows,
  removeAdditionalGuardConfirmMessage,
  applyRemoveAdditionalGuard,
  validateAdditionalGuardDates,
  applyAssignAdditionalGuard,
  dateRange,
  type AdditionalGuardSourceMode,
  type AdditionalGuardSourceChoice,
} from "../additionalGuardData";
import { activeGuardOptions } from "../leaveData";
import { formatMykadInput, formatPhoneInput } from "../guardValidation";
import type { TempGuardIdentityFormValues } from "../tempGuardPanelData";
import { otherBranchSites, syncHomeSiteSupportLeave, type SitePickerOption } from "../supportGuardCrossSite";
import { syncBufferGuardOnAssign, type SiteMeta } from "../guardBankSync";
import ConfirmModal from "./modals/ConfirmModal";

const EMPTY_TEMP_FORM: TempGuardIdentityFormValues = {
  name: "",
  rateRaw: "",
  mykadNumber: "",
  ageRaw: "",
  phoneNumber: "",
  state: "",
  city: "",
};

/**
 * "Assign an additional guard" panel (renderAdditionalGuardPanel(), index.html lines 4417-4489;
 * fillAdditionalGuardSupportSelect() lines 4494-4503; removeAdditionalGuardEntry() lines
 * 4508-4527; #assignAdditionalGuardBtn handler). The most field-heavy panel in either tab — a
 * date-RANGE assignment billed separately as "Additional Guard (Temporary)".
 */
export interface AdditionalGuardPanelProps {
  config: SiteConfig;
  ms: MonthState;
  currentMonthKey: string;
  canAssignSupport: boolean;
  allSites: Pick<SiteConfig, "id" | "name" | "branch" | "archived">[];
  siteConfigsCache: Record<string, GenerateMonthConfig>;
  siteMeta: SiteMeta;
  isTestData: boolean;
  onSave: (ms: MonthState, toast: string) => void;
}

export default function AdditionalGuardPanel({
  config,
  ms,
  currentMonthKey,
  canAssignSupport,
  allSites,
  siteConfigsCache,
  siteMeta,
  isTestData,
  onSave,
}: AdditionalGuardPanelProps) {
  const { t } = useTranslation();
  const [shiftId, setShiftId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [mode, setMode] = useState<AdditionalGuardSourceMode | "">("");
  const [restdayGuardId, setRestdayGuardId] = useState("");
  const [tempForm, setTempForm] = useState<TempGuardIdentityFormValues>(EMPTY_TEMP_FORM);
  const [originSiteId, setOriginSiteId] = useState("");
  const [originGuardId, setOriginGuardId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

  const shiftOptions = additionalGuardShiftOptions(config.site);
  const rows = buildAdditionalGuardRows(config, ms, shiftOptions, t);
  const restdayGuards = activeGuardOptions(config);
  const supportSites: SitePickerOption[] = canAssignSupport ? otherBranchSites(allSites, config.id, config.branch) : [];
  const originGuards: Guard[] = originSiteId ? additionalGuardSupportGuardOptions(siteConfigsCache[originSiteId] || { guards: [] }) : [];

  const [y, m] = currentMonthKey.split("-").map(Number);
  const minDate = `${currentMonthKey}-01`;
  const maxDate = `${currentMonthKey}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

  useEffect(() => {
    setOriginGuardId("");
  }, [originSiteId]);

  function setTemp<K extends keyof TempGuardIdentityFormValues>(key: K, value: TempGuardIdentityFormValues[K]) {
    setTempForm((f) => ({ ...f, [key]: value }));
  }

  function resetForm() {
    setShiftId("");
    setStartDate("");
    setEndDate("");
    setMode("");
    setRestdayGuardId("");
    setTempForm(EMPTY_TEMP_FORM);
    setOriginSiteId("");
    setOriginGuardId("");
    setError(null);
  }

  const hasInput = !!(shiftId || startDate || endDate || mode);

  function handleCancel() {
    resetForm();
  }

  function handleAssign() {
    const dateError = validateAdditionalGuardDates({ shiftId, startDate, endDate }, currentMonthKey, t);
    if (dateError) return setError(dateError.error);
    if (!mode) return setError(t("dutyRoster.additionalGuardPanel.errorChooseSource"));
    if (mode === "support" && !canAssignSupport) return; // silent, matches the original

    let choice: AdditionalGuardSourceChoice;
    if (mode === "restday") {
      choice = { mode: "restday", guardId: restdayGuardId };
    } else if (mode === "temp") {
      choice = { mode: "temp", form: tempForm };
    } else {
      const originSite = supportSites.find((s) => s.id === originSiteId);
      const originGuard = originGuards.find((g) => g.id === originGuardId);
      if (!originSiteId) return setError(t("dutyRoster.common.errorPickOriginSiteBorrow"));
      if (!originGuardId) return setError(t("dutyRoster.common.errorPickCoveringGuard"));
      if (!originSite || !originGuard) return setError(t("dutyRoster.common.errorCouldntFindGuard"));
      choice = {
        mode: "support",
        originSiteId,
        originSiteName: originSite.name,
        originGuardId,
        originGuardName: originGuard.name,
        originGuardEmployeeId: originGuard.employeeId,
      };
    }

    const outcome = applyAssignAdditionalGuard(config, ms, { shiftId, startDate, endDate }, choice, t);
    if ("error" in outcome) return setError(outcome.error);
    resetForm();
    onSave(outcome.ms, outcome.toast);

    if (outcome.tempRecord) syncBufferGuardOnAssign(outcome.tempRecord, siteMeta, isTestData);
    if (outcome.supportSync) {
      outcome.supportSync.datesNeedingSync.forEach(({ date, shiftEndMs }) => {
        void syncHomeSiteSupportLeave(outcome.supportSync!.homeSiteId, outcome.supportSync!.homeGuardId, date, true, shiftEndMs, config.id, config.name);
      });
    }
  }

  function handleConfirmRemove() {
    if (!removeTarget) return;
    const outcome = applyRemoveAdditionalGuard(config, ms, removeTarget.id, t);
    setRemoveTarget(null);
    if (!outcome) return;
    onSave(outcome.ms, outcome.toast);
    if (outcome.supportCleanup) {
      const { homeSiteId, homeGuardId, startDate: s, endDate: e } = outcome.supportCleanup;
      dateRange(s, e).forEach((date) => void syncHomeSiteSupportLeave(homeSiteId, homeGuardId, date, false));
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('dutyRoster.additionalGuardPanel.title')}</h3>

      <div className="flex flex-col gap-2 mt-3">
        <select className="input" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
          <option value="">{t('dutyRoster.additionalGuardPanel.selectShiftEllipsis')}</option>
          {shiftOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className="input" min={minDate} max={maxDate} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input type="date" className="input" min={minDate} max={maxDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <select className="input" value={mode} onChange={(e) => setMode(e.target.value as AdditionalGuardSourceMode)}>
          <option value="">{t('dutyRoster.additionalGuardPanel.howSourcedEllipsis')}</option>
          <option value="restday">{t('dutyRoster.common.optionCurrentGuardRestDay')}</option>
          <option value="temp">{t('dutyRoster.common.optionTemporaryGuard')}</option>
          {canAssignSupport && <option value="support">{t('dutyRoster.common.optionSupportBorrow')}</option>}
        </select>

        {mode === "restday" && (
          <select className="input" value={restdayGuardId} onChange={(e) => setRestdayGuardId(e.target.value)}>
            <option value="">{t('dutyRoster.common.selectGuardEllipsis')}</option>
            {restdayGuards.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}

        {mode === "temp" && (
          <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-2">
            <input type="text" className="input" placeholder={t('dutyRoster.common.namePlaceholder')} value={tempForm.name} onChange={(e) => setTemp("name", e.target.value)} />
            <input
              type="number"
              min={0}
              step="0.01"
              className="input"
              placeholder={t('dutyRoster.common.ratePlaceholder')}
              value={tempForm.rateRaw}
              onChange={(e) => setTemp("rateRaw", e.target.value)}
            />
            <input
              type="text"
              className="input"
              placeholder={t('dutyRoster.guardDetails.mykadNumber')}
              maxLength={14}
              value={tempForm.mykadNumber}
              onChange={(e) => setTemp("mykadNumber", formatMykadInput(e.target.value))}
            />
            <input type="number" min={16} className="input" placeholder={t('dutyRoster.guardDetails.age')} value={tempForm.ageRaw} onChange={(e) => setTemp("ageRaw", e.target.value)} />
            <input
              type="text"
              className="input"
              placeholder={t('dutyRoster.guardDetails.phoneNumber')}
              value={tempForm.phoneNumber}
              onChange={(e) => setTemp("phoneNumber", formatPhoneInput(e.target.value))}
            />
            <input type="text" className="input" placeholder={t('projectDetails.state')} value={tempForm.state} onChange={(e) => setTemp("state", e.target.value)} />
            <input type="text" className="input" placeholder={t('projectDetails.city')} value={tempForm.city} onChange={(e) => setTemp("city", e.target.value)} />
          </div>
        )}

        {mode === "support" && (
          <div className="flex flex-col gap-2">
            <select className="input" value={originSiteId} onChange={(e) => setOriginSiteId(e.target.value)}>
              <option value="">{t('dutyRoster.common.comingFromEllipsis')}</option>
              {supportSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className="input" value={originGuardId} onChange={(e) => setOriginGuardId(e.target.value)}>
              <option value="">{t('dutyRoster.common.selectGuardEllipsis')}</option>
              {originGuards.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} {g.employeeId ? `(${g.employeeId})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="self-end flex items-center gap-2">
          {hasInput && (
            <button type="button" onClick={handleCancel} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
              {t('dutyRoster.common.cancel')}
            </button>
          )}
          <button type="button" onClick={handleAssign} className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
            {t('dutyRoster.common.assign')}
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <table className="w-full text-sm mt-4 border-collapse">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1.5 font-mono text-xs whitespace-nowrap">{r.dateLabel}</td>
                <td className="py-1.5">{r.shiftLabel}</td>
                <td className="py-1.5 text-xs text-slate-500">{r.sourceLabel}</td>
                <td className="py-1.5">{r.name}</td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => setRemoveTarget({ id: r.id, name: r.name })}
                    className="text-xs font-medium text-rose-600 hover:text-rose-700"
                  >
                    {t('dutyRoster.common.remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmModal
        open={!!removeTarget}
        title={t('dutyRoster.additionalGuardPanel.removeAdditionalGuardTitle')}
        message={removeTarget ? removeAdditionalGuardConfirmMessage(removeTarget.name, t) : ""}
        okLabel={t('dutyRoster.common.remove')}
        danger
        onConfirm={handleConfirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
