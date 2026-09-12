import { useMemo, useState } from 'react';
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

  const handleReopen = (t: Tender) => {
    const confirmed = window.confirm(
      `Reopen "${t.clientName}"?\n\nIt will move back into Active Projects.`
    );
    if (!confirmed) return;
    reopenProject(t.id);
  };

  if (!profile) return null;

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-900">Past Projects</h1>
          <HeaderCollapseToggle expanded={headerExpanded} onToggle={() => setHeaderExpanded((v) => !v)} />
        </div>
        {headerExpanded && (
          <div className="flex items-center justify-between gap-4 flex-wrap mt-2">
            <p className="text-sm text-slate-500">
              {seesAllBranches
                ? 'Ended contract tenders that have been closed out, across every branch'
                : `Ended contract tenders closed out for ${profile.department}`}
            </p>
            {seesAllBranches && (
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input w-full sm:w-44">
                <option value="all">All branches</option>
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
        <p className="px-6 py-8 text-sm text-slate-400">Loading past projects…</p>
      ) : (
        <div className="px-6 py-6 space-y-6 max-w-6xl">
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <StatCard
              label="Past Project Value"
              value={formatRM(totalValue)}
              sub={`${visible.length} closed out`}
              accent={VIZ.status.good}
            />
            <StatCard label="Closed Out" value={String(visible.length)} sub="no longer active" />
          </div>

          <p className="text-xs text-slate-400 max-w-2xl">
            These stay counted as Won revenue in Pipeline Analysis — closing out only moves a
            project out of the Active Projects view.
          </p>

          {sorted.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No past projects yet.</p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Brand</th>
                    {seesAllBranches && <th className="px-4 py-3">Branch</th>}
                    <th className="px-4 py-3">Contract Start</th>
                    <th className="px-4 py-3">Contract End</th>
                    <th className="px-4 py-3">Closed Out</th>
                    <th className="px-4 py-3 text-right">Value</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => {
                    const hasDetails = t.location || t.contactPerson || t.guardsDeployed != null || t.tenderDocNumber;
                    return (
                      <tr key={t.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{t.clientName}</p>
                          {(t.location || t.guardsDeployed != null) && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {t.location && <>📍 {t.location}</>}
                              {t.location && t.guardsDeployed != null && ' · '}
                              {t.guardsDeployed != null && (
                                <>
                                  {t.guardsDeployed} guard{t.guardsDeployed === 1 ? '' : 's'}
                                </>
                              )}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{t.brandName}</td>
                        {seesAllBranches && (
                          <td className="px-4 py-3 text-slate-500">{t.activeBranch || 'Unassigned'}</td>
                        )}
                        <td className="px-4 py-3 text-slate-500">{formatDate(t.contractStart)}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(t.contractEnd)}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {t.closedOutAt ? formatDateTime(t.closedOutAt) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800">
                          {formatRM(t.tenderValue)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={() => setDetailsTender(t)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              {hasDetails ? 'View' : '+ Add'}
                            </button>
                            <span className="text-slate-300">·</span>
                            <button
                              onClick={() => handleReopen(t)}
                              className="text-xs font-medium text-slate-500 hover:text-emerald-600"
                            >
                              Reopen
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
      />
    </div>
  );
}
