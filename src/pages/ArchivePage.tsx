import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useTenders } from '../hooks/useTenders';
import { useBranches, useBrands } from '../hooks/useBranches';
import { useUsers } from '../hooks/useUsers';
import { isTenderArchived } from '../services/tenders';
import TenderFormModal from '../components/tenders/TenderFormModal';
import StatCard from '../components/analytics/StatCard';
import { STAGE_COLORS } from '../utils/constants';
import { formatDate, formatRM } from '../utils/format';
import HeaderCollapseToggle from '../components/layout/HeaderCollapseToggle';
import { VIZ } from '../utils/vizColors';
import { labelToKey } from '../i18n';
import type { Stage, Tender } from '../types';
import { isAdminRole } from '../types';

const ARCHIVE_STAGES: Stage[] = ['Won', 'Lost', 'Disqualified Lead'];

/** The date a card in this list is sorted/shown by — whichever of closedDate/disqualifiedDate
 *  is the one that actually put it here (see isTenderArchived()'s doc comment). */
function archivedOn(t: Tender): string | undefined {
  return t.stage === 'Disqualified Lead' ? t.disqualifiedDate : t.closedDate;
}

export default function ArchivePage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { tenders, loading } = useTenders(profile);
  const { brands } = useBrands();
  const { branches } = useBranches();
  const { users } = useUsers();

  const [search, setSearch] = useState('');
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const [stageFilter, setStageFilter] = useState<'all' | Stage>('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [editing, setEditing] = useState<Tender | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const staffOptions = useMemo(
    () => (isAdminRole(profile?.role) ? users.filter((u) => u.active !== false) : profile ? [profile] : []),
    [profile, users]
  );

  // Every Won/Lost/Disqualified Lead tender more than a year past its closed/disqualified date —
  // see isTenderArchived()'s doc comment in services/tenders.ts. Nothing here is ever deleted or
  // mutated; this is purely a different filter over the exact same tenders the Sales Funnel board
  // and Pipeline Analysis already see.
  //
  // Deliberately wrapped in an arrow function rather than passed bare (`tenders.filter(isTenderArchived)`)
  // — Array.prototype.filter calls its callback as (element, index, array), so passing the function
  // directly lets the array INDEX silently flow into isTenderArchived's optional `asOf` parameter in
  // place of its `Date.now()` default. asOf then ends up as a tiny number (0, 1, 2, ...) being compared
  // against real millisecond timestamps, so the "over a year old" check can never be true and this
  // always returned an empty array — every archived tender was invisible on this page, with no error,
  // regardless of how old it actually was. Wrapping it so isTenderArchived is always called with
  // exactly one argument is what fixes that.
  const archived = useMemo(() => tenders.filter((t) => isTenderArchived(t)), [tenders]);

  const filtered = useMemo(() => {
    return archived.filter((t) => {
      if (stageFilter !== 'all' && t.stage !== stageFilter) return false;
      if (brandFilter !== 'all' && t.brandId !== brandFilter) return false;
      if (search.trim() && !t.clientName.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [archived, stageFilter, brandFilter, search]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (archivedOn(b) || '').localeCompare(archivedOn(a) || '')),
    [filtered]
  );

  const totalValue = filtered.reduce((sum, t) => sum + (t.tenderValue || 0), 0);
  const wonCount = filtered.filter((t) => t.stage === 'Won').length;
  const lostCount = filtered.filter((t) => t.stage === 'Lost').length;
  const disqualifiedCount = filtered.filter((t) => t.stage === 'Disqualified Lead').length;

  if (!profile) return null;

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-900">{t('archive.title')}</h1>
          <HeaderCollapseToggle expanded={headerExpanded} onToggle={() => setHeaderExpanded((v) => !v)} />
        </div>
        {headerExpanded && (
          <div className="flex items-center justify-between gap-4 flex-wrap mt-2">
            <p className="text-sm text-slate-500">
              {t('archive.subtitle')}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('archive.searchClientPlaceholder')}
                className="input w-full sm:w-48"
              />
              <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as 'all' | Stage)} className="input w-full sm:w-40">
                <option value="all">{t('archive.allStages')}</option>
                {ARCHIVE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(`pipeline.stages.${labelToKey(s)}`)}
                  </option>
                ))}
              </select>
              <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="input w-full sm:w-40">
                <option value="all">{t('archive.allBrands')}</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </header>

      {loading ? (
        <p className="px-6 py-8 text-sm text-slate-400">{t('archive.loadingEllipsis')}</p>
      ) : (
        <div className="px-6 py-6 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl">
            <StatCard label={t('archive.archivedValue')} value={formatRM(totalValue)} sub={t('archive.tendersCount', { count: filtered.length })} accent={VIZ.categorical.blue} />
            <StatCard label={t(`pipeline.stages.${labelToKey('Won')}`)} value={String(wonCount)} accent={VIZ.status.good} />
            <StatCard label={t(`pipeline.stages.${labelToKey('Lost')}`)} value={String(lostCount)} accent={VIZ.status.critical} />
            <StatCard label={t(`pipeline.stages.${labelToKey('Disqualified Lead')}`)} value={String(disqualifiedCount)} />
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">
              {archived.length === 0
                ? t('archive.nothingArchivedYet')
                : t('archive.noArchivedMatchFilters')}
            </p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                    <th className="px-4 py-3">{t('archive.colClient')}</th>
                    <th className="px-4 py-3">{t('archive.colBrand')}</th>
                    <th className="px-4 py-3">{t('archive.colStage')}</th>
                    <th className="px-4 py-3">{t('archive.colDepartment')}</th>
                    <th className="px-4 py-3">{t('archive.colDate')}</th>
                    <th className="px-4 py-3 text-right">{t('archive.colValue')}</th>
                    <th className="px-4 py-3">{t('archive.colOwner')}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => {
                    const colors = STAGE_COLORS[item.stage];
                    const date = archivedOn(item);
                    return (
                      <tr key={item.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-3 font-medium text-slate-800">{item.clientName}</td>
                        <td className="px-4 py-3 text-slate-500">{item.brandName}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
                            {t(`pipeline.stages.${labelToKey(item.stage)}`)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{item.department}</td>
                        <td className="px-4 py-3 text-slate-500">{date ? formatDate(date) : '-'}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800">{formatRM(item.tenderValue)}</td>
                        <td className="px-4 py-3 text-slate-500 truncate max-w-[10rem]">{item.ownerName}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              setEditing(item);
                              setModalOpen(true);
                            }}
                            className="text-xs font-medium text-blue-600 hover:text-blue-700"
                          >
                            {t('archive.view')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <TenderFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        profile={profile}
        brands={brands}
        branches={branches}
        staffOptions={staffOptions}
        editing={editing}
      />
    </div>
  );
}
