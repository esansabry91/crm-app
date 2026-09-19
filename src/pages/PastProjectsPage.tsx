import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { usePastProjects } from '../hooks/useActiveProjects';
import { useBranches } from '../hooks/useBranches';
import { reopenProject } from '../services/tenders';
import { formatDate, formatDateTime, formatRM } from '../utils/format';
import HeaderCollapseToggle from '../components/layout/HeaderCollapseToggle';
import StatCard from '../components/analytics/StatCard';
import ProjectDetailsModal from '../components/active-projects/ProjectDetailsModal';
import { VIZ } from '../utils/vizColors';
import type { Tender } from '../types';

export default function PastProjectsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { projects, loading, seesAllBranches } = usePastProjects(profile);
  const { branches } = useBranches();
  const [branchFilter, setBranchFilter] = useState('all');
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const [detailsTender, setDetailsTender] = useState<Tender | null>(null);

  const branchNames = useMemo(() => branches.map((b) => b.name), [branches]);

  const visible = useMemo(() => {
    if (!seesAllBranches || branchFilter === 'all') return projects;
    return projects.filter((t) => (t.activeBranch || t.department) === branchFilter);
  }, [projects, seesAllBranches, branchFilter]);

  const sorted = useMemo(
    () => [...visible].sort((a, b) => (b.closedOutAt || 0) - (a.closedOutAt || 0)),
    [visible]
  );

  const totalValue = visible.reduce((sum, t) => sum + (t.tenderValue || 0), 0);

  const handleReopen = (tender: Tender) => {
    const confirmed = window.confirm(t('pastProjects.confirmReopen', { client: tender.clientName }));
    if (!confirmed) return;
    reopenProject(tender.id);
  };

  if (!profile) return null;

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-900">{t('pastProjects.title')}</h1>
          <HeaderCollapseToggle expanded={headerExpanded} onToggle={() => setHeaderExpanded((v) => !v)} />
        </div>
        {headerExpanded && (
          <div className="flex items-center justify-between gap-4 flex-wrap mt-2">
            <p className="text-sm text-slate-500">
              {seesAllBranches
                ? t('pastProjects.subtitleAllBranches')
                : t('pastProjects.subtitleDepartment', { department: profile.department })}
            </p>
            {seesAllBranches && (
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input w-full sm:w-44">
                <option value="all">{t('pastProjects.allBranches')}</option>
                {branchNames.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </header>

      {loading ? (
        <p className="px-6 py-8 text-sm text-slate-400">{t('pastProjects.loadingEllipsis')}</p>
      ) : (
        <div className="px-6 py-6 space-y-6 max-w-6xl">
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <StatCard
              label={t('pastProjects.pastProjectValue')}
              value={formatRM(totalValue)}
              sub={t('pastProjects.closedOutCount', { count: visible.length })}
              accent={VIZ.status.good}
            />
            <StatCard label={t('pastProjects.closedOut')} value={String(visible.length)} sub={t('pastProjects.noLongerActive')} />
          </div>

          <p className="text-xs text-slate-400 max-w-2xl">
            {t('pastProjects.wonRevenueNote')}
          </p>

          {sorted.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">{t('pastProjects.noPastProjectsYet')}</p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                    <th className="px-4 py-3">{t('pastProjects.colClient')}</th>
                    <th className="px-4 py-3">{t('pastProjects.colBrand')}</th>
                    {seesAllBranches && <th className="px-4 py-3">{t('pastProjects.colBranch')}</th>}
                    <th className="px-4 py-3">{t('pastProjects.colContractStart')}</th>
                    <th className="px-4 py-3">{t('pastProjects.colContractEnd')}</th>
                    <th className="px-4 py-3">{t('pastProjects.colClosedOut')}</th>
                    <th className="px-4 py-3 text-right">{t('pastProjects.colValue')}</th>
                    <th className="px-4 py-3">{t('pastProjects.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => {
                    const hasDetails = item.location || item.contactPerson || item.guardsDeployed != null || item.tenderDocNumber || item.scopeOfWork;
                    return (
                      <tr key={item.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{item.clientName}</p>
                          {(item.location || item.guardsDeployed != null) && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {item.location && <>📍 {item.location}</>}
                              {item.location && item.guardsDeployed != null && ' · '}
                              {item.guardsDeployed != null && (
                                <>{t('pastProjects.guardsDeployedCount', { count: item.guardsDeployed })}</>
                              )}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{item.brandName}</td>
                        {seesAllBranches && (
                          <td className="px-4 py-3 text-slate-500">{item.activeBranch || t('pastProjects.unassignedBranch')}</td>
                        )}
                        <td className="px-4 py-3 text-slate-500">{formatDate(item.contractStart)}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(item.contractEnd)}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {item.closedOutAt ? formatDateTime(item.closedOutAt) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800">
                          {formatRM(item.tenderValue)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={() => setDetailsTender(item)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              {hasDetails ? t('pastProjects.view') : t('pastProjects.addDetails')}
                            </button>
                            <span className="text-slate-300">·</span>
                            <button
                              onClick={() => handleReopen(item)}
                              className="text-xs font-medium text-slate-500 hover:text-emerald-600"
                            >
                              {t('pastProjects.reopen')}
                            </button>
                          </div>
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

      <ProjectDetailsModal
        open={detailsTender !== null}
        tender={detailsTender}
        onClose={() => setDetailsTender(null)}
        actor={{ uid: profile.uid, name: profile.name, role: profile.role }}
      />
    </div>
  );
}
