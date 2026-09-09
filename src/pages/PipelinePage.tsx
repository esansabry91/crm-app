import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenders } from '../hooks/useTenders';
import { useBranches, useBrands } from '../hooks/useBranches';
import { useUsers } from '../hooks/useUsers';
import KanbanBoard from '../components/kanban/KanbanBoard';
import TenderFormModal from '../components/tenders/TenderFormModal';
import { moveTenderStage } from '../services/tenders';
import type { Tender } from '../types';
import { formatRM } from '../utils/format';

export default function PipelinePage() {
  const { profile } = useAuth();
  const { tenders, loading } = useTenders(profile);
  const { brands } = useBrands();
  const { branches } = useBranches();
  const { users } = useUsers();

  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tender | null>(null);

  const staffOptions = useMemo(
    () => (profile?.role === 'admin' ? users.filter((u) => u.active !== false) : profile ? [profile] : []),
    [profile, users]
  );

  const filtered = useMemo(() => {
    return tenders.filter((t) => {
      if (brandFilter !== 'all' && t.brandId !== brandFilter) return false;
      if (search.trim() && !t.clientName.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [tenders, brandFilter, search]);

  const totalValue = filtered.reduce((s, t) => s + (t.tenderValue || 0), 0);

  if (!profile) return null;

  return (
    <div className="h-screen flex flex-col">
      <header className="px-6 py-5 border-b border-slate-200 bg-white flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Sales Funnel Pipeline</h1>
          <p className="text-sm text-slate-500">
            {filtered.length} tender{filtered.length === 1 ? '' : 's'} · {formatRM(totalValue)} total value
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client…"
            className="input w-48"
          />
          <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="input w-40">
            <option value="all">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            + Register Tender
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 px-6 py-4">
        {loading ? (
          <p className="text-sm text-slate-400">Loading pipeline…</p>
        ) : (
          <KanbanBoard
            tenders={filtered}
            canDrag
            onCardClick={(t) => {
              setEditing(t);
              setModalOpen(true);
            }}
            onDropStage={(tender, newStage) =>
              moveTenderStage(tender, newStage, { uid: profile.uid, name: profile.name })
            }
          />
        )}
      </div>

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
