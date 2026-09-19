/**
 * Duty Roster — composed native-React page shell (Task #22). Replaces the standalone
 * public/duty-roster/index.html console, previously embedded via an <iframe> in
 * src/pages/DutyRosterPage.tsx (see that file's old doc comment, and dutyRosterBridge.ts/
 * useDutyRosterPending.ts, both removed by this same task — their job is now
 * src/contexts/RosterPendingContext.tsx, consumed directly since this page lives in the same
 * React tree as AppLayout now).
 *
 * Owns every piece of state the four tabs share: the signed-in viewer (role derivation), the
 * reachable site list + picker filters, which site/month is current, the tender deep-link
 * bootstrap, the roster lock/draft machinery, the lifted combined-hours cache (see
 * useCombinedHoursCache.ts's own doc comment), the page-level toast, and the "leaving this page
 * with an unlocked roster" guard reported up to AppLayout.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useBranches } from "../hooks/useBranches";
import { useReportRosterPending } from "../contexts/RosterPendingContext";
import { deriveRosterViewer } from "./rosterViewer";
import { useSiteList, pickInitialSiteId } from "./hooks/useSiteList";
import { parseDeepLinkParams, useTenderDeepLink } from "./tenderDeepLink";
import { buildSitePickerView, type SitePickerFilters } from "./siteListData";
import SitePickerBar from "./components/SitePickerBar";
import { useSiteConfig } from "./hooks/useSiteConfig";
import { useTenderRate } from "./hooks/useTenderRate";
import { useRosterLock } from "./hooks/useRosterLock";
import { useUnlockGuard } from "./hooks/useUnlockGuard";
import { useCombinedHoursCache } from "./hooks/useCombinedHoursCache";
import RosterUnlockedWarningModal from "./components/modals/RosterUnlockedWarningModal";
import RosterTab from "./components/RosterTab";
import GuardsShiftsTab from "./components/GuardsShiftsTab";
import AdjustmentsTab from "./components/AdjustmentsTab";
import SummaryReportTab from "./components/SummaryReportTab";
import { generateMonth } from "./schedulingEngine";
import { todayYM, monthKey as monthKeyOf, monthLabel, addMonths } from "./dateUtils";
import { appendLog } from "./lockMachine";

const LAST_SITE_KEY = "dutyRosterLastSite";

function getStoredLastSite(): string | null {
  try {
    return localStorage.getItem(LAST_SITE_KEY);
  } catch {
    return null;
  }
}

function setStoredLastSite(id: string): void {
  try {
    localStorage.setItem(LAST_SITE_KEY, id);
  } catch {
    // Best-effort only — same convention as every other localStorage write in the CRM shell
    // (see AppLayout.tsx's own sidebar-collapsed persistence).
  }
}

type TabId = "roster" | "setup" | "adjust" | "report";
// Labels are looked up via t('dutyRoster.tabs.<id>') at render time, since this array is
// module-scope (outside any component) and can't call the translation hook itself.
const TABS: { id: TabId }[] = [{ id: "roster" }, { id: "setup" }, { id: "adjust" }, { id: "report" }];

export default function DutyRosterApp() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { branches } = useBranches();
  const [searchParams] = useSearchParams();

  const viewer = useMemo(
    () => deriveRosterViewer(profile ? { uid: profile.uid, name: profile.name, role: profile.role, department: profile.department } : null),
    [profile]
  );

  const { sites, configsCache, loading: sitesLoading } = useSiteList(viewer);

  const [currentSiteId, setCurrentSiteIdState] = useState<string | null>(null);
  function selectSite(id: string) {
    setCurrentSiteIdState(id);
    setStoredLastSite(id);
  }
  // Auto-select once the site list resolves, or whenever the current selection falls out of it
  // (e.g. a filter/archive change elsewhere) — mirrors recombineSitesAndRender()'s own fallback.
  useEffect(() => {
    if (currentSiteId && sites.some((s) => s.id === currentSiteId)) return;
    const next = pickInitialSiteId(sites, getStoredLastSite());
    if (next && next !== currentSiteId) setCurrentSiteIdState(next);
  }, [sites, currentSiteId]);

  const [pendingCreationLog, setPendingCreationLog] = useState<{ siteId: string; text: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 3500);
  }

  const deepLinkParams = useMemo(() => parseDeepLinkParams(searchParams), [searchParams]);
  useTenderDeepLink(deepLinkParams, sites, viewer, currentSiteId, {
    onSwitchSite: selectSite,
    onSiteCreated: (result) => {
      selectSite(result.id);
      setPendingCreationLog({ siteId: result.id, text: result.logText });
    },
    onToast: showToast,
  });

  const [ym, setYm] = useState(todayYM);
  const mKey = monthKeyOf(ym.y, ym.m);

  const { config, loading: configLoading, persist: persistConfig } = useSiteConfig(currentSiteId);
  const rateConfig = useTenderRate(currentSiteId, config?.tenderId);
  const rosterLock = useRosterLock(currentSiteId, mKey, viewer, ym.y, ym.m, config);
  const { ms, displayMs, persist: persistMonth, locked, canManage, pendingCount, navigationBlocked, lock, unlock, discard, dragSwap } = rosterLock;

  // Flushes createSite()'s own log line once the brand-new site's month doc has actually loaded
  // (it doesn't exist the instant the site itself is created) — see this file's own doc comment
  // on why this can't happen synchronously the way the original's module-singleton version did.
  useEffect(() => {
    if (!pendingCreationLog || !ms || currentSiteId !== pendingCreationLog.siteId) return;
    persistMonth(appendLog(ms, pendingCreationLog.text));
    setPendingCreationLog(null);
  }, [pendingCreationLog, ms, currentSiteId, persistMonth]);

  const combinedCache = useCombinedHoursCache();
  // See useCombinedHoursCache.ts's own doc comment: invalidate on every local OR remote change
  // to the current site's own config/month state, covering the original's first three
  // invalidateCombinedHoursCache() call sites in one place.
  useEffect(() => {
    combinedCache.invalidateAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, ms]);

  const unlockGuard = useUnlockGuard({ onPersist: persistMonth, onToast: showToast });
  // Reports this page's own pending/resolvers up to AppLayout for the sidebar-nav/Sign-out guard
  // — see RosterPendingContext.tsx's own doc comment. AppLayout's resolvers just need `ms`/
  // `viewer` closed over at report time; lock()/discard() already no-op safely if called when
  // nothing's actually pending any more.
  useReportRosterPending(
    navigationBlocked,
    navigationBlocked
      ? {
          lock: () => lock(),
          discard: () => discard(),
        }
      : null
  );

  const [activeTab, setActiveTab] = useState<TabId>("roster");
  function goToTab(next: TabId) {
    if (next === activeTab) return;
    if (!ms) {
      setActiveTab(next);
      return;
    }
    unlockGuard.guard(ms, viewer, () => setActiveTab(next));
  }
  function handleSelectSite(id: string) {
    if (id === currentSiteId) return;
    if (!ms) {
      selectSite(id);
      return;
    }
    unlockGuard.guard(ms, viewer, () => selectSite(id));
  }

  const [filters, setFilters] = useState<SitePickerFilters>({ branchFilterValue: "", clientFilterValue: "", showArchivedSites: false });

  const result = useMemo(() => (config && ms ? generateMonth(ym.y, ym.m, config, ms) : null), [config, ms, ym.y, ym.m]);
  const displayResult = useMemo(
    () => (config && displayMs ? generateMonth(ym.y, ym.m, config, displayMs) : null),
    [config, displayMs, ym.y, ym.m]
  );

  if (!sitesLoading && !sites.length) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <DutyRosterHeader viewer={viewer} sites={sites} branches={branches} currentSiteId={currentSiteId} />
        <div className="text-center py-16 text-slate-500">
          <p className="text-[15px] font-semibold text-slate-700 mb-1">{t('dutyRoster.app.noClientSites')}</p>
          <p className="text-sm">{t('dutyRoster.app.noClientSitesHint')}</p>
        </div>
      </div>
    );
  }

  // A single narrowed bundle (rather than a separate `loading` boolean) so TS can narrow every
  // field to non-null within the ready branch below instead of re-asserting each one.
  const ready =
    !sitesLoading && !configLoading && config && ms && result && displayMs && displayResult
      ? { config, ms, result, displayMs, displayResult }
      : null;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 flex flex-col gap-4">
      <DutyRosterHeader viewer={viewer} sites={sites} branches={branches} currentSiteId={currentSiteId} />

      <SitePickerBar
        viewer={viewer}
        allSites={sites}
        branches={branches}
        currentSiteId={currentSiteId}
        filters={filters}
        onFiltersChange={setFilters}
        onSelectSite={handleSelectSite}
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => goToTab(tab.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t(`dutyRoster.tabs.${tab.id}`)}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-2">
          <button type="button" onClick={() => setYm((cur) => addMonths(cur.y, cur.m, -1))} className="text-sm text-slate-500 hover:text-slate-800 px-1.5" aria-label={t('dutyRoster.app.previousMonth')}>
            ←
          </button>
          <span className="text-sm font-medium text-slate-700 min-w-[8ch] text-center">{monthLabel(ym.y, ym.m)}</span>
          <button type="button" onClick={() => setYm((cur) => addMonths(cur.y, cur.m, 1))} className="text-sm text-slate-500 hover:text-slate-800 px-1.5" aria-label={t('dutyRoster.app.nextMonth')}>
            →
          </button>
        </div>
      </div>

      {!ready ? (
        <p className="text-sm text-slate-500 py-8 text-center">{t('dutyRoster.app.loadingEllipsis')}</p>
      ) : (
        <>
          {activeTab === "roster" && (
            <RosterTab
              y={ym.y}
              m={ym.m}
              config={ready.config}
              ms={ready.ms}
              result={ready.result}
              displayMs={ready.displayMs}
              displayResult={ready.displayResult}
              siteName={ready.config.name}
              monthKey={mKey}
              locked={locked}
              canManage={canManage}
              canEdit={viewer.canEdit}
              pendingCount={pendingCount}
              onLock={lock}
              onUnlock={unlock}
              onDiscard={discard}
              onDragSwap={dragSwap}
              onPersistMonth={persistMonth}
            />
          )}
          {activeTab === "setup" && (
            <fieldset disabled={!viewer.canEdit} className="contents border-0 p-0 m-0 min-w-0">
              <GuardsShiftsTab config={ready.config} ms={ready.ms} rateConfig={rateConfig} onPersistConfig={persistConfig} onPersistMonth={persistMonth} onToast={showToast} />
            </fieldset>
          )}
          {activeTab === "adjust" && (
            <fieldset disabled={!viewer.canEdit} className="contents border-0 p-0 m-0 min-w-0">
              <AdjustmentsTab
                config={ready.config}
                ms={ready.ms}
                result={ready.result}
                currentMonthKey={mKey}
                session={viewer}
                allSites={sites}
                siteConfigsCache={configsCache}
                onPersistMonth={persistMonth}
                onToast={showToast}
              />
            </fieldset>
          )}
          {activeTab === "report" && (
            <SummaryReportTab
              config={ready.config}
              ms={ready.ms}
              result={ready.result}
              currentMonthKey={mKey}
              session={viewer}
              rateConfig={rateConfig}
              allSites={sites}
              siteConfigsCache={configsCache}
              combinedCache={combinedCache}
              actorUid={viewer.myUid}
              actorName={viewer.myName || viewer.myDepartment}
              onPersistMonth={persistMonth}
              onToast={showToast}
            />
          )}
        </>
      )}

      {toast && <div className="fixed bottom-4 right-4 px-3.5 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm shadow-lg border border-emerald-100 z-40">{toast}</div>}

      <RosterUnlockedWarningModal
        open={unlockGuard.modalOpen}
        pendingCount={unlockGuard.pendingCount}
        onStay={unlockGuard.stay}
        onDiscard={unlockGuard.discard}
        onLock={unlockGuard.lock}
      />
    </div>
  );
}

function DutyRosterHeader({
  viewer,
  sites,
  branches,
  currentSiteId,
}: {
  viewer: ReturnType<typeof deriveRosterViewer>;
  sites: Parameters<typeof buildSitePickerView>[1];
  branches: Parameters<typeof buildSitePickerView>[2];
  currentSiteId: string | null;
}) {
  const { t } = useTranslation();
  const view = buildSitePickerView(viewer, sites, branches, currentSiteId, { branchFilterValue: "", clientFilterValue: "", showArchivedSites: false }, t);
  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">{t('dutyRoster.app.title')}</h1>
      <p className="text-xs text-slate-500 mt-0.5">{view.brandSubtitle}</p>
    </div>
  );
}
