import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SiteConfig, MonthState, ShiftPattern } from "../types";
import {
  PATTERN_FIELD_GROUPS,
  FULLH_FIELD_LABELS,
  applySaveSiteRequirement,
  siteSummary,
  type SiteRequirementFormValues,
} from "../siteSetupData";
import { FULLH_CATEGORIES } from "../shiftStructure";
import AlertModal from "./modals/AlertModal";

type FullHKey = (typeof FULLH_CATEGORIES)[number]["key"];
type FullHDraft = Record<FullHKey, number[]>;

function fullHDraftFromSite(site: SiteConfig["site"]): FullHDraft {
  const out = {} as FullHDraft;
  (Object.keys(FULLH_FIELD_LABELS) as FullHKey[]).forEach((key) => {
    const v = site[key];
    out[key] = Array.isArray(v) && v.length ? [...v] : [12];
  });
  return out;
}

/**
 * "Client site requirement" panel — renderSiteRequirement()/renderSitePostsFields()/
 * renderFullHFields() + #saveSiteBtn (index.html lines 3712-3783, 5077-5140). The FULLH branch
 * (per-day-varying custom shift posts) is the most involved bit of UI in either tab.
 */
export interface SiteRequirementPanelProps {
  config: SiteConfig;
  ms: MonthState;
  onSave: (next: { config: SiteConfig; ms: MonthState }, toast: string) => void;
}

export default function SiteRequirementPanel({ config, ms, onSave }: SiteRequirementPanelProps) {
  const { t } = useTranslation();
  const site = config.site;
  const [pattern, setPattern] = useState<ShiftPattern>(site.pattern);
  const [posts, setPosts] = useState<Partial<Record<string, number>>>({});
  const [fullH, setFullH] = useState<FullHDraft>(() => fullHDraftFromSite(site));
  const [nightStart, setNightStart] = useState(site.nightStart);
  const [hoursDay, setHoursDay] = useState(site.hoursDay);
  const [daysWeek, setDaysWeek] = useState(site.daysWeek);
  const [shiftHrs, setShiftHrs] = useState(site.shiftHrs);
  const [rosterStart, setRosterStart] = useState(site.rosterStart);
  const [normalHoursPerDay, setNormalHoursPerDay] = useState(site.normalHoursPerDay);
  const [cantRemoveAlert, setCantRemoveAlert] = useState(false);

  // Re-sync the whole draft whenever the underlying config actually changes out from under us
  // (another tab/user saved) — not on every keystroke, since this is a Save-gated form.
  useEffect(() => {
    setPattern(site.pattern);
    const p: Partial<Record<string, number>> = {};
    (PATTERN_FIELD_GROUPS[site.pattern as Exclude<ShiftPattern, "FULLH">] || []).forEach((f) => {
      p[f.key] = (site as unknown as Record<string, number>)[f.key];
    });
    setPosts(p);
    setFullH(fullHDraftFromSite(site));
    setNightStart(site.nightStart);
    setHoursDay(site.hoursDay);
    setDaysWeek(site.daysWeek);
    setShiftHrs(site.shiftHrs);
    setRosterStart(site.rosterStart);
    setNormalHoursPerDay(site.normalHoursPerDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.updatedAt]);

  function handlePatternChange(next: ShiftPattern) {
    setPattern(next);
    if (next !== "FULLH") {
      const p: Partial<Record<string, number>> = {};
      (PATTERN_FIELD_GROUPS[next as Exclude<ShiftPattern, "FULLH">] || []).forEach((f) => {
        p[f.key] = (site as unknown as Record<string, number>)[f.key] ?? 0;
      });
      setPosts(p);
    }
  }

  function addFullHRow(key: FullHKey) {
    setFullH((prev) => {
      const rows = prev[key];
      const lastVal = rows.length ? rows[rows.length - 1] : 12;
      return { ...prev, [key]: [...rows, lastVal] };
    });
  }

  function removeFullHRow(key: FullHKey, idx: number) {
    setFullH((prev) => {
      if (prev[key].length <= 1) {
        setCantRemoveAlert(true);
        return prev;
      }
      return { ...prev, [key]: prev[key].filter((_, i) => i !== idx) };
    });
  }

  function handleSave() {
    const form: SiteRequirementFormValues = {
      pattern,
      posts: pattern !== "FULLH" ? (posts as SiteRequirementFormValues["posts"]) : undefined,
      fullH: pattern === "FULLH" ? { nightStart, ...fullH } : undefined,
      hoursDay,
      daysWeek,
      shiftHrs,
      rosterStart,
      normalHoursPerDay,
    };
    const outcome = applySaveSiteRequirement(config, ms, form, t);
    onSave({ config: outcome.config, ms: outcome.ms }, outcome.toast);
  }

  const summary = siteSummary({ site: { ...site, pattern }, restRule: config.restRule }, t);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('dutyRoster.siteRequirementPanel.title')}</h3>

      <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">{t('dutyRoster.siteRequirementPanel.shiftPattern')}</label>
      <select className="input" value={pattern} onChange={(e) => handlePatternChange(e.target.value as ShiftPattern)}>
        <option value="U">{t('dutyRoster.siteRequirementPanel.patternUniform')}</option>
        <option value="DN">{t('dutyRoster.siteRequirementPanel.patternDayNight')}</option>
        <option value="WW">{t('dutyRoster.siteRequirementPanel.patternWeekdayWeekend')}</option>
        <option value="FULL">{t('dutyRoster.siteRequirementPanel.patternFull')}</option>
        <option value="FULLH">{t('dutyRoster.siteRequirementPanel.patternFullh')}</option>
      </select>

      {pattern === "FULLH" ? (
        <div className="mt-3 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">{t('dutyRoster.siteRequirementPanel.nightShiftStartHour')}</label>
            <input
              type="number"
              min={0}
              max={23}
              className="input w-28"
              value={nightStart}
              onChange={(e) => setNightStart(Number(e.target.value))}
            />
          </div>
          {FULLH_CATEGORIES.map(({ key }) => (
            <div key={key}>
              <label className="text-xs font-medium text-slate-600 block mb-1">{t(`dutyRoster.siteSetup.fullhFieldLabels.${key}`)}</label>
              <div className="flex flex-col gap-1.5">
                {fullH[key].map((hours, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      className="input w-24"
                      value={hours}
                      onChange={(e) =>
                        setFullH((prev) => ({
                          ...prev,
                          [key]: prev[key].map((v, idx) => (idx === i ? Number(e.target.value) : v)),
                        }))
                      }
                    />
                    <span className="text-xs text-slate-500">{t('dutyRoster.siteRequirementPanel.hoursUnit')}</span>
                    <button type="button" onClick={() => removeFullHRow(key, i)} className="text-slate-400 hover:text-rose-600 text-sm">
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addFullHRow(key)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 self-start"
                >
                  {t('dutyRoster.siteRequirementPanel.addPost')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {(PATTERN_FIELD_GROUPS[pattern as Exclude<ShiftPattern, "FULLH">] || []).map((f) => (
            <div key={f.key}>
              <label className="text-xs font-medium text-slate-600 block mb-1">{t(`dutyRoster.siteSetup.patternFieldLabels.${f.key}`)}</label>
              <input
                type="number"
                min={0}
                className="input w-28"
                value={posts[f.key] ?? 0}
                onChange={(e) => setPosts((p) => ({ ...p, [f.key]: Number(e.target.value) }))}
              />
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">{t('dutyRoster.siteRequirementPanel.coverageHoursDay')}</label>
          <input type="number" min={0} className="input" value={hoursDay} onChange={(e) => setHoursDay(Number(e.target.value))} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">{t('dutyRoster.siteRequirementPanel.coverageDaysWeek')}</label>
          <input type="number" min={0} max={7} className="input" value={daysWeek} onChange={(e) => setDaysWeek(Number(e.target.value))} />
        </div>
        {pattern !== "FULLH" && (
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">{t('dutyRoster.siteRequirementPanel.hoursPerShift')}</label>
            <input type="number" min={0} className="input" value={shiftHrs} onChange={(e) => setShiftHrs(Number(e.target.value))} />
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">{t('dutyRoster.siteRequirementPanel.rosterStartHour')}</label>
          <input
            type="number"
            min={0}
            max={23}
            className="input"
            value={rosterStart}
            onChange={(e) => setRosterStart(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">{t('dutyRoster.siteRequirementPanel.normalHoursDay')}</label>
          <input
            type="number"
            min={0}
            className="input"
            value={normalHoursPerDay}
            onChange={(e) => setNormalHoursPerDay(Number(e.target.value))}
          />
        </div>
      </div>

      <p className="text-xs text-slate-600 mt-3">
        {summary.before}
        <strong>{summary.suggested}</strong>
        {summary.after}
      </p>
      {summary.complianceNote && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
          {summary.complianceNote}
        </p>
      )}

      <div className="flex justify-end mt-4">
        <button type="button" onClick={handleSave} className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
          {t('dutyRoster.siteRequirementPanel.saveSiteRequirement')}
        </button>
      </div>

      <AlertModal
        open={cantRemoveAlert}
        title={t('dutyRoster.siteRequirementPanel.cantRemoveTitle')}
        message={t('dutyRoster.siteRequirementPanel.cantRemoveMessage')}
        onClose={() => setCantRemoveAlert(false)}
      />
    </div>
  );
}
