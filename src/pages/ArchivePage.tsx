import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenders } from '../hooks/useTenders';
import { useBranches, useBrands } from '../hooks/useBranches';
import { useUsers } from '../hooks/useUsers';
import { isTenderArchived } from '../services/tenders';
import TenderFormModal from '../components/tenders/TenderFormModal';
import StatCard from '../components/analytics/StatCard';
import { STAGE_COLORS } from '../utils/constants';
import { formatDate, formatRM } from '../utils/format';
import { VIZ } from '../utils/vizColors';
import type { Stage, Tender } from '../types';

const ARCHIVE_STAGES: Stage[] = ['Won', 'Lost', 'Disqualified Lead'];

/** The date a card in this list is sorted/shown by — whichever of closedDate/disqualifiedDate
 *  is the one that actually put it here (see isTenderArchived()'s doc comment). */
function archivedOn(t: Tender): string | undefined {
  return t.stage === 'Disqualified Lead' ? t.disqualifiedDate : t.closedDate;
}

export default function ArchivePage() {
  const { profile } = useAuth();
  const { tenders, loading } = useTenders(profile);
  const { brands } = useBrands();
  const { branches } = useBranches();
  const { users } = useUsers();

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | Stage>('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [editing, setEditing] = useState<Tender | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const staffOptions = useMemo(
    () => (profile?.role === 'admin' ? users.filter((u) => u.active !== false) : profile ? [profile] : []),
    [profile, users]
  );

  // Every Won/Lost/Disqualified Lead tender more than a year past its closed/disqualified date —
  // see isTenderArchived()'s doc comment in services/tenders.ts. Nothing here is ever deleted or
  // mutated; this is purely a different filter over the exact same tenders the Sales Funnel board
  // and Pipeline Analysis already see.
  const archived = useMemo(() => tenders.filter(isTenderArchived), [tenders]);

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
      <header className="px-6 py-5 border-b border-slate-200 bg-white flex items-center justify-between gap-4 flex-wrap sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Pipeline Archive</h1>
          <p className="text-sm text-slate-500">
            Won, Lost and Disqualified Lead tenders over a year old — kept for record, off the
            Sales Funnel board. Still fully counted in Pipeline Analysis.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client…"
            className="input w-full sm:w-48"
          />
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as 'all' | Stage)} className="input w-full sm:w-40">
            <option value="all">All stages</option>
            {ARCHIVE_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="input w-full sm:w-40">
            <option value="all">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {loading ? (
        <p className="px-6 py-8 text-sm text-slate-400">Loading archive…</p>
      ) : (
        <div className="px-6 py-6 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl">
            <StatCard label="Archived Value" value={formatRM(totalValue)} sub={`${filtered.length} tenders`} accent={VIZ.categorical.blue} />
            <StatCard label="Won" value={String(wonCount)} accent={VIZ.status.good} />
            <StatCard label="Lost" value={String(lostCount)} accent={VIZ.status.critical} />
            <StatCard label="Disqualified Lead" value={String(disqualifiedCount)} />
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">
              {archived.length === 0
                ? 'Nothing archived yet — Won, Lost and Disqualified Lead tenders move here automatically once they\'re over a year old.'
                : 'No archived tenders match these filters.'}
            </p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Brand</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Value</th>
                    <th className="px-4 py-3">Owner</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => {
                    const colors = STAGE_COLORS[t.stage];
                    const date = archivedOn(t);
                    return (
                      <tr key={t.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-3 font-medium text-slate-800">{t.clientName}</td>
                        <td className="px-4 py-3 text-slate-500">{t.brandName}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
                            {t.stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{t.department}</td>
                        <td className="px-4 py-3 text-slate-500">{date ? formatDate(date) : '-'}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800">{formatRM(t.tenderValue)}</td>
                        <td className="px-4 py-3 text-slate-500 truncate max-w-[10rem]">{t.ownerName}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              setEditing(t);
                              setModalOpen(true);
                            }}
                            className="text-xs font-medium text-blue-600 hover:text-blue-700"
                          >
                            View
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
