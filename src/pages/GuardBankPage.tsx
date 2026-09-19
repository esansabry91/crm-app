import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import clsx from 'clsx';
import StatCard from '../components/analytics/StatCard';
import RegisterGuardModal from '../components/guard-bank/RegisterGuardModal';
import RegisterBufferGuardModal from '../components/guard-bank/RegisterBufferGuardModal';
import AssignGuardModal from '../components/guard-bank/AssignGuardModal';
import GuardDetailsModal from '../components/guard-bank/GuardDetailsModal';
import BufferGuardDetailsModal from '../components/guard-bank/BufferGuardDetailsModal';
import { useAuth } from '../contexts/AuthContext';
import { useBranches } from '../hooks/useBranches';
import { useGuards, useBufferGuards, useSitesForPicker } from '../hooks/useGuards';
import {
  archiveDismissedGuard,
  backfillGuardsFromDutyRoster,
  computeGuardTurnover,
  guardsWithPermitExpiringSoon,
  removeBufferGuard,
  removeGuard,
  updateBufferGuardContact,
} from '../services/guards';
import { formatDate, formatDateTime, formatRM } from '../utils/format';
import HeaderCollapseToggle from '../components/layout/HeaderCollapseToggle';
import { VIZ } from '../utils/vizColors';
import type { BufferGuard, Guard } from '../types';
import { isAdminRole } from '../types';

// Tab itself stays the fixed English literal (internal state) — only the displayed label is
// translated, via TAB_LABEL_KEYS.
const TABS = ['Guard Pool', 'Deployed Guards', 'Dismissed Guards', 'Buffer Guards'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL_KEYS: Record<Tab, string> = {
  'Guard Pool': 'guardBank.tabs.guardPool',
  'Deployed Guards': 'guardBank.tabs.deployedGuards',
  'Dismissed Guards': 'guardBank.tabs.dismissedGuards',
  'Buffer Guards': 'guardBank.tabs.bufferGuards',
};

const ALL = '__all__';
const UNASSIGNED_BRANCH = '__unassigned__';
type CategoryFilter = 'all' | 'local' | 'nepal';
const CATEGORY_OPTIONS: { value: CategoryFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'guardBank.categoryAll' },
  { value: 'local', labelKey: 'guardBank.categoryLocal' },
  { value: 'nepal', labelKey: 'guardBank.categoryNepal' },
];

function CategoryPill({ category, t }: { category: Guard['category']; t: TFunction }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold',
        category === 'nepal' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'
      )}
    >
      {category === 'nepal' ? t('guardBank.categoryNepal') : t('guardBank.categoryLocal')}
    </span>
  );
}

function isPermitSoon(g: Guard): boolean {
  if (g.category !== 'nepal' || !g.permitExpiryDate) return false;
  return guardsWithPermitExpiringSoon([g]).length > 0;
}

export default function GuardBankPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { guards, loading: guardsLoading } = useGuards();
  const { bufferGuards, loading: bufferLoading } = useBufferGuards();
  const { sites } = useSitesForPicker();
  const { branches } = useBranches();

  const [tab, setTab] = useState<Tab>('Guard Pool');
  const [toast, setToast] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const [registerBufferOpen, setRegisterBufferOpen] = useState(false);
  const [assignGuard, setAssignGuard] = useState<Guard | null>(null);
  const [viewGuardId, setViewGuardId] = useState<string | null>(null);
  const [viewBuffer, setViewBuffer] = useState<BufferGuard | null>(null);
  const [editingBufferId, setEditingBufferId] = useState<string | null>(null);
  const [removingBufferId, setRemovingBufferId] = useState<string | null>(null);
  const [removingGuardId, setRemovingGuardId] = useState<string | null>(null);
  const [archivingGuardId, setArchivingGuardId] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [backfilling, setBackfilling] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [stateFilter, setStateFilter] = useState(ALL);
  const [cityFilter, setCityFilter] = useState(ALL);
  const [brandFilter, setBrandFilter] = useState(ALL);
  const [permitOnly, setPermitOnly] = useState(false);

  const poolGuards = useMemo(() => guards.filter((g) => g.status === 'pool'), [guards]);
  const deployedGuards = useMemo(() => guards.filter((g) => g.status === 'deployed'), [guards]);
  // Excludes archived dismissals (see archiveDismissedGuard() in services/guards.ts) — the
  // record itself is kept (computeGuardTurnover() below still reads it off the full `guards`
  // array), only this list/tab/stat-tile stops showing it once an admin archives it.
  const dismissedGuards = useMemo(
    () =>
      guards
        .filter((g) => g.status === 'dismissed' && !g.archivedAt)
        .sort((a, b) => (b.dismissedAt || 0) - (a.dismissedAt || 0)),
    [guards]
  );
  const viewGuard = useMemo(() => (viewGuardId ? guards.find((g) => g.id === viewGuardId) ?? null : null), [viewGuardId, guards]);
  const permitSoon = useMemo(() => guardsWithPermitExpiringSoon(guards), [guards]);
  const turnover = useMemo(() => computeGuardTurnover(guards), [guards]);

  // Category/brand only exist on `guards` (Buffer Guards has neither), so the Buffer Guards tab
  // only ever honors the branch/state/city filters below — see the disabled Category/Brand
  // controls in the filter bar when that tab is active.
  const stateOptions = useMemo(() => {
    const set = new Set<string>();
    guards.forEach((g) => g.state && set.add(g.state));
    bufferGuards.forEach((bg) => bg.state && set.add(bg.state));
    return Array.from(set).sort();
  }, [guards, bufferGuards]);
  const cityOptions = useMemo(() => {
    const set = new Set<string>();
    guards.forEach((g) => g.city && set.add(g.city));
    bufferGuards.forEach((bg) => bg.city && set.add(bg.city));
    return Array.from(set).sort();
  }, [guards, bufferGuards]);
  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    guards.forEach((g) => g.brandName && set.add(g.brandName));
    return Array.from(set).sort();
  }, [guards]);

  const branchMatches = (branch: string | null | undefined) => {
    if (branchFilter === ALL) return true;
    if (branchFilter === UNASSIGNED_BRANCH) return !branch;
    return branch === branchFilter;
  };
  const guardMatchesFilters = (g: Guard) =>
    (categoryFilter === 'all' || g.category === categoryFilter) &&
    branchMatches(g.branch) &&
    (stateFilter === ALL || g.state === stateFilter) &&
    (cityFilter === ALL || g.city === cityFilter) &&
    (brandFilter === ALL || g.brandName === brandFilter) &&
    (!permitOnly || isPermitSoon(g));
  const bufferMatchesFilters = (bg: BufferGuard) =>
    branchMatches(bg.lastBranch) && (stateFilter === ALL || bg.state === stateFilter) && (cityFilter === ALL || bg.city === cityFilter);

  const filteredPool = useMemo(() => poolGuards.filter(guardMatchesFilters), [poolGuards, categoryFilter, branchFilter, stateFilter, cityFilter, brandFilter, permitOnly]);
  const filteredDeployed = useMemo(() => deployedGuards.filter(guardMatchesFilters), [deployedGuards, categoryFilter, branchFilter, stateFilter, cityFilter, brandFilter, permitOnly]);
  const filteredDismissed = useMemo(() => dismissedGuards.filter(guardMatchesFilters), [dismissedGuards, categoryFilter, branchFilter, stateFilter, cityFilter, brandFilter, permitOnly]);
  const filteredBuffer = useMemo(() => bufferGuards.filter(bufferMatchesFilters), [bufferGuards, branchFilter, stateFilter, cityFilter]);

  const filtersActive =
    categoryFilter !== 'all' ||
    branchFilter !== ALL ||
    stateFilter !== ALL ||
    cityFilter !== ALL ||
    brandFilter !== ALL ||
    permitOnly;
  function clearFilters() {
    setCategoryFilter('all');
    setBranchFilter(ALL);
    setStateFilter(ALL);
    setCityFilter(ALL);
    setBrandFilter(ALL);
    setPermitOnly(false);
  }

  // "Go to list" on the Permit expiring tile: jump straight to the guards it's counting.
  // guardsWithPermitExpiringSoon() only ever returns nepal-category guards with status
  // 'pool' or 'deployed' (dismissed guards are excluded there), so land on whichever of
  // those two tabs actually has matches, preferring Deployed since that's where a permit
  // renewal is usually most urgent to action.
  function goToPermitExpiringList() {
    setCategoryFilter('nepal');
    setBranchFilter(ALL);
    setStateFilter(ALL);
    setCityFilter(ALL);
    setBrandFilter(ALL);
    setPermitOnly(true);
    const hasDeployed = permitSoon.some((g) => g.status === 'deployed');
    const hasPool = permitSoon.some((g) => g.status === 'pool');
    setTab(hasDeployed ? 'Deployed Guards' : hasPool ? 'Guard Pool' : 'Deployed Guards');
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 3500);
  }

  // A standing safety net, not a one-off migration step: Duty Roster's live per-action sync
  // (add/dismiss/reactivate/temp-guard) is what keeps Guard Bank current moment-to-moment, but
  // every one of those syncs is best-effort and swallows its own errors (see the doc comment
  // above syncGuardBankOnAdd() etc. in index.html) — a dropped network call there would silently
  // drift Guard Bank out of sync with nothing to flag it. This button re-scans every site's
  // roster and reconciles it against Guard Bank by Employee ID, so it's safe to click anytime,
  // not just once. Admin-only since it needs to read every site across every branch to
  // reconcile the whole firm in one pass. See backfillGuardsFromDutyRoster()'s doc comment in
  // services/guards.ts for what it does and doesn't know about guards it's seeing for the first
  // time (no real historical join/dismissal dates to recover).
  async function runDutyRosterSync() {
    setBackfilling(true);
    try {
      const result = await backfillGuardsFromDutyRoster();
      flash(
        t('guardBank.syncResultBase', {
          guardsScanned: result.guardsScanned,
          sitesScanned: result.sitesScanned,
          created: result.created,
          updated: result.updated,
        }) +
          (result.skippedNoEmployeeId ? t('guardBank.syncResultSkipped', { count: result.skippedNoEmployeeId }) : '') +
          '.'
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : t('guardBank.errorCouldNotSync'));
    } finally {
      setBackfilling(false);
    }
  }

  async function saveBufferContact(id: string) {
    try {
      await updateBufferGuardContact(id, { phoneNumber: editPhone.trim() });
      flash(t('guardBank.updatedContactNumber'));
    } catch {
      flash(t('guardBank.errorCouldNotSaveContact'));
    } finally {
      setEditingBufferId(null);
    }
  }

  async function removeBuffer(bg: BufferGuard) {
    if (!window.confirm(t('guardBank.confirmRemoveBuffer', { name: bg.name }))) return;
    setRemovingBufferId(bg.id);
    try {
      await removeBufferGuard(bg.id);
      flash(t('guardBank.removedBufferFlash', { name: bg.name }));
    } catch (err) {
      flash(err instanceof Error ? err.message : t('guardBank.errorCouldNotRemoveBuffer'));
    } finally {
      setRemovingBufferId(null);
    }
  }

  /** Guard Pool only — see removeGuard()'s own doc comment for why Deployed/Dismissed don't offer this. */
  async function removeFromPool(g: Guard) {
    if (!window.confirm(t('guardBank.confirmRemoveFromPool', { name: g.name }))) return;
    setRemovingGuardId(g.id);
    try {
      await removeGuard(g.id);
      flash(t('guardBank.removedFromPoolFlash', { name: g.name }));
    } catch (err) {
      flash(err instanceof Error ? err.message : t('guardBank.errorCouldNotRemoveGuard'));
    } finally {
      setRemovingGuardId(null);
    }
  }

  async function archiveDismissed(g: Guard) {
    if (!window.confirm(t('guardBank.confirmArchiveDismissed', { name: g.name }))) return;
    setArchivingGuardId(g.id);
    try {
      await archiveDismissedGuard(g.id);
      flash(t('guardBank.archivedFlash', { name: g.name }));
    } catch (err) {
      flash(err instanceof Error ? err.message : t('guardBank.errorCouldNotArchive'));
    } finally {
      setArchivingGuardId(null);
    }
  }

  const loading = guardsLoading || bufferLoading;

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 bg-white sticky top-0 z-10">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-900">{t('nav.links.guardBank')}</h1>
              <HeaderCollapseToggle expanded={headerExpanded} onToggle={() => setHeaderExpanded((v) => !v)} />
            </div>
            {headerExpanded && (
              <p className="text-sm text-slate-500 mt-0.5">
                {t('guardBank.pageSubtitle')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isAdminRole(profile?.role) && (
              <button
                onClick={runDutyRosterSync}
                disabled={backfilling}
                title={t('guardBank.refreshFromDutyRosterTitle')}
                className="px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 rounded-lg border border-slate-200 inline-flex items-center gap-1.5"
              >
                <span aria-hidden className={backfilling ? 'animate-spin' : ''}>↻</span>
                {backfilling ? t('guardBank.syncingEllipsis') : t('guardBank.refreshFromDutyRoster')}
              </button>
            )}
            {tab === 'Guard Pool' && (
              <button
                onClick={() => setRegisterOpen(true)}
                className="px-3.5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                {t('guardBank.registerGuardButton')}
              </button>
            )}
            {tab === 'Buffer Guards' && (
              <button
                onClick={() => setRegisterBufferOpen(true)}
                className="px-3.5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                {t('guardBank.registerBufferGuardButton')}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Stat grid, tabs and filters scroll normally (not sticky, unlike the title bar above) —
          on a short landscape-phone viewport this whole block plus the title bar can otherwise
          exceed the entire visible height, permanently hiding the guard list below it. */}
      <div className="px-6 pb-4 bg-white border-b border-slate-200">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
          <StatCard
            label={t('guardBank.statTotalPermanentHired')}
            value={String(poolGuards.length + deployedGuards.length)}
            sub={t('guardBank.statUnassignedPlusDeployed')}
            accent={VIZ.status.good}
          />
          <StatCard label={t('guardBank.statUnassignedGuards')} value={String(poolGuards.length)} sub={t('guardBank.tabs.guardPool')} />
          <StatCard label={t('guardBank.statDismissedGuards')} value={String(dismissedGuards.length)} accent={VIZ.status.critical} />
          <StatCard label={t('guardBank.statBufferGuards')} value={String(bufferGuards.length)} />
          <StatCard
            label={t('guardBank.statPermitExpiring')}
            value={String(permitSoon.length)}
            sub={t('guardBank.statNepalCategory')}
            accent={permitSoon.length > 0 ? VIZ.status.warning : undefined}
            action={{
              label: t('guardBank.goToList'),
              onClick: goToPermitExpiringList,
              disabled: permitSoon.length === 0,
            }}
          />
          <StatCard
            label={t('guardBank.statTurnoverRate')}
            value={`${turnover.rate.toFixed(1)}%`}
            sub={t('guardBank.turnoverSub', { dismissed: turnover.dismissedLast12mo, avg: turnover.avgHeadcount.toFixed(1) })}
          />
        </div>

        <div className="flex gap-1 mt-4 overflow-x-auto">
          {TABS.map((tabName) => (
            <button
              key={tabName}
              onClick={() => setTab(tabName)}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-lg transition whitespace-nowrap',
                tab === tabName ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'
              )}
            >
              {t(TAB_LABEL_KEYS[tabName])}
              {tabName === 'Guard Pool' && poolGuards.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-400">{poolGuards.length}</span>
              )}
              {tabName === 'Deployed Guards' && deployedGuards.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-400">{deployedGuards.length}</span>
              )}
              {tabName === 'Dismissed Guards' && dismissedGuards.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-400">{dismissedGuards.length}</span>
              )}
              {tabName === 'Buffer Guards' && bufferGuards.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-400">{bufferGuards.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                disabled={tab === 'Buffer Guards'}
                onClick={() => setCategoryFilter(opt.value)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed',
                  categoryFilter === opt.value && tab !== 'Buffer Guards'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-500 hover:bg-slate-50'
                )}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>

          <select
            className="text-xs rounded-lg border border-slate-200 px-2 py-1.5 text-slate-600 bg-white"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <option value={ALL}>{t('guardBank.allBranches')}</option>
            <option value={UNASSIGNED_BRANCH}>{t('guardBank.unassignedBranch')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>

          <select
            className="text-xs rounded-lg border border-slate-200 px-2 py-1.5 text-slate-600 bg-white"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value={ALL}>{t('guardBank.allStates')}</option>
            {stateOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            className="text-xs rounded-lg border border-slate-200 px-2 py-1.5 text-slate-600 bg-white"
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
          >
            <option value={ALL}>{t('guardBank.allCities')}</option>
            {cityOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            disabled={tab === 'Buffer Guards'}
            className="text-xs rounded-lg border border-slate-200 px-2 py-1.5 text-slate-600 bg-white disabled:opacity-40 disabled:cursor-not-allowed"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
          >
            <option value={ALL}>{t('guardBank.allBrands')}</option>
            {brandOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          {filtersActive && (
            <button onClick={clearFilters} className="text-xs font-medium text-slate-400 hover:text-slate-600 underline">
              {t('guardBank.clearFilters')}
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className="mx-6 mt-4 px-3.5 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm">{toast}</div>
      )}

      <div className="px-6 py-6">
        {loading ? (
          <p className="text-sm text-slate-400">{t('guardBank.loadingEllipsis')}</p>
        ) : tab === 'Guard Pool' ? (
          filteredPool.length === 0 ? (
            <p className="text-sm text-slate-400">
              {poolGuards.length === 0
                ? t('guardBank.noUnassignedGuardsEmpty')
                : t('guardBank.noUnassignedGuardsFiltered')}
            </p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-2.5">{t('guardBank.colName')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colEmployeeId')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colCategory')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colLocation')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colPermitExpiry')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colRegistered')}</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filteredPool.map((g) => (
                    <tr key={g.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{g.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{g.employeeId}</td>
                      <td className="px-4 py-2.5">
                        <CategoryPill category={g.category} t={t} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{[g.city, g.state].filter(Boolean).join(', ') || '-'}</td>
                      <td className="px-4 py-2.5">
                        {g.category === 'nepal' && g.permitExpiryDate ? (
                          <span
                            className={clsx('text-xs', isPermitSoon(g) ? 'font-semibold' : 'text-slate-500')}
                            style={isPermitSoon(g) ? { color: VIZ.status.warning } : undefined}
                          >
                            {formatDate(g.permitExpiryDate)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{formatDate(new Date(g.createdAt).toISOString())}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => setViewGuardId(g.id)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-md"
                        >
                          {t('guardBank.view')}
                        </button>
                        <button
                          onClick={() => setAssignGuard(g)}
                          className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-md"
                        >
                          {t('guardBank.assignToSite')}
                        </button>
                        {isAdminRole(profile?.role) && (
                          <button
                            onClick={() => removeFromPool(g)}
                            disabled={removingGuardId === g.id}
                            className="px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60 rounded-md"
                          >
                            {removingGuardId === g.id ? t('guardBank.removingEllipsis') : t('guardBank.remove')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'Deployed Guards' ? (
          filteredDeployed.length === 0 ? (
            <p className="text-sm text-slate-400">
              {deployedGuards.length === 0 ? t('guardBank.noDeployedGuards') : t('guardBank.noDeployedGuardsFiltered')}
            </p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-2.5">{t('guardBank.colName')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colEmployeeId')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colCategory')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colSite')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colBranch')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colBrand')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colPermitExpiry')}</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filteredDeployed.map((g) => (
                    <tr key={g.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{g.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{g.employeeId}</td>
                      <td className="px-4 py-2.5">
                        <CategoryPill category={g.category} t={t} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{g.siteName || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{g.branch || t('guardBank.unassignedBranch')}</td>
                      <td className="px-4 py-2.5 text-slate-500">{g.brandName || '-'}</td>
                      <td className="px-4 py-2.5">
                        {g.category === 'nepal' && g.permitExpiryDate ? (
                          <span
                            className={clsx(
                              'text-xs',
                              isPermitSoon(g) ? 'font-semibold' : 'text-slate-500'
                            )}
                            style={isPermitSoon(g) ? { color: VIZ.status.warning } : undefined}
                          >
                            {formatDate(g.permitExpiryDate)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => setViewGuardId(g.id)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-md"
                        >
                          {t('guardBank.view')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'Dismissed Guards' ? (
          filteredDismissed.length === 0 ? (
            <p className="text-sm text-slate-400">
              {dismissedGuards.length === 0 ? t('guardBank.noDismissedGuards') : t('guardBank.noDismissedGuardsFiltered')}
            </p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-2.5">{t('guardBank.colName')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colEmployeeId')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colLastSite')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colBrand')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colReason')}</th>
                    <th className="px-4 py-2.5">{t('guardBank.colDismissed')}</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filteredDismissed.map((g) => (
                    <tr key={g.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{g.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{g.employeeId}</td>
                      <td className="px-4 py-2.5 text-slate-500">{g.siteName || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{g.brandName || '-'}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{ backgroundColor: `${VIZ.status.critical}1a`, color: VIZ.status.critical }}
                        >
                          {g.dismissalReason || t('guardBank.unspecified')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{g.dismissedAt ? formatDateTime(g.dismissedAt) : '-'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => setViewGuardId(g.id)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-md"
                        >
                          {t('guardBank.view')}
                        </button>
                        {isAdminRole(profile?.role) && (
                          <button
                            onClick={() => archiveDismissed(g)}
                            disabled={archivingGuardId === g.id}
                            className="px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60 rounded-md"
                          >
                            {archivingGuardId === g.id ? t('guardBank.archivingEllipsis') : t('guardBank.archive')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filteredBuffer.length === 0 ? (
          <p className="text-sm text-slate-400">
            {bufferGuards.length === 0
              ? t('guardBank.noBufferGuardsEmpty')
              : t('guardBank.noBufferGuardsFiltered')}
          </p>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                  <th className="px-4 py-2.5">{t('guardBank.colName')}</th>
                  <th className="px-4 py-2.5">{t('guardBank.colRate')}</th>
                  <th className="px-4 py-2.5">{t('guardBank.colPhone')}</th>
                  <th className="px-4 py-2.5">{t('guardBank.colLocation')}</th>
                  <th className="px-4 py-2.5">{t('guardBank.colLastSite')}</th>
                  <th className="px-4 py-2.5">{t('guardBank.colLastUsedAt')}</th>
                  <th className="px-4 py-2.5">{t('guardBank.colTimesUsed')}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filteredBuffer
                  .slice()
                  .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
                  .map((bg: BufferGuard) => (
                    <tr key={bg.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{bg.name}</td>
                      <td className="px-4 py-2.5 text-slate-500">{formatRM(bg.rate || 0)}</td>
                      <td className="px-4 py-2.5">
                        {editingBufferId === bg.id ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              className="input py-1 text-xs w-32"
                              value={editPhone}
                              onChange={(e) => setEditPhone(e.target.value)}
                              autoFocus
                            />
                            <button
                              onClick={() => saveBufferContact(bg.id)}
                              className="text-xs font-medium text-blue-600 hover:underline"
                            >
                              {t('guardBank.save')}
                            </button>
                            <button
                              onClick={() => setEditingBufferId(null)}
                              className="text-xs text-slate-400 hover:underline"
                            >
                              {t('guardBank.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingBufferId(bg.id);
                              setEditPhone(bg.phoneNumber || '');
                            }}
                            className="text-slate-600 hover:text-blue-600"
                          >
                            {bg.phoneNumber || <span className="text-slate-300">{t('guardBank.addPhone')}</span>}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{[bg.city, bg.state].filter(Boolean).join(', ') || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{bg.lastSiteName || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-400">{formatDateTime(bg.lastUsedAt)}</td>
                      <td className="px-4 py-2.5 text-slate-500 tabular-nums">{bg.timesUsed}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => setViewBuffer(bg)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-md"
                        >
                          {t('guardBank.view')}
                        </button>
                        {isAdminRole(profile?.role) && (
                          <button
                            onClick={() => removeBuffer(bg)}
                            disabled={removingBufferId === bg.id}
                            className="px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60 rounded-md"
                          >
                            {removingBufferId === bg.id ? t('guardBank.removingEllipsis') : t('guardBank.remove')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RegisterGuardModal open={registerOpen} onClose={() => setRegisterOpen(false)} onRegistered={flash} />
      <RegisterBufferGuardModal
        open={registerBufferOpen}
        onClose={() => setRegisterBufferOpen(false)}
        onRegistered={flash}
      />
      <AssignGuardModal
        open={!!assignGuard}
        guard={assignGuard}
        sites={sites}
        onClose={() => setAssignGuard(null)}
        onAssigned={flash}
      />
      <GuardDetailsModal guard={viewGuard} onClose={() => setViewGuardId(null)} onUpdated={flash} />
      <BufferGuardDetailsModal bufferGuard={viewBuffer} onClose={() => setViewBuffer(null)} />
    </div>
  );
}
