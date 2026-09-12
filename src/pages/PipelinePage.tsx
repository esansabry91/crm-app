import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenders } from '../hooks/useTenders';
import { useBranches, useBrands } from '../hooks/useBranches';
import { useUsers } from '../hooks/useUsers';
import KanbanBoard from '../components/kanban/KanbanBoard';
import HeaderCollapseToggle from '../components/layout/HeaderCollapseToggle';
import TenderFormModal from '../components/tenders/TenderFormModal';
import SubmissionDateModal from '../components/tenders/SubmissionDateModal';
import { disqualifyTender, isTenderArchived, moveTenderStage, requalifyTender } from '../services/tenders';
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
  // A tender awaiting its required submission date before the drag-to-Submitted move actually
  // commits (see the onDropStage handler below and SubmissionDateModal.tsx).
  const [pendingSubmission, setPendingSubmission] = useState<Tender | null>(null);
  const [headerExpanded, setHeaderExpanded] = useState(true);

  const staffOptions = useMemo(
    () => (profile?.role === 'admin' ? users.filter((u) => u.active !== false) : profile ? [profile] : []),
    [profile, users]
  );

  const filtered = useMemo(() => {
    return tenders.filter((t) => {
      // Won/Lost/Disqualified Lead tenders over a year old move to the Archive page instead of
      // sitting on the board forever — see isTenderArchived()'s doc comment in services/tenders.ts.
      if (isTenderArchived(t)) return false;
      if (brandFilter !== 'all' && t.brandId !== brandFilter) return false;
      if (search.trim() && !t.clientName.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [tenders, brandFilter, search]);

  const totalValue = filtered.reduce((s, t) => s + (t.tenderValue || 0), 0);

  const handleDisqualify = async (tender: Tender) => {
    const confirmed = window.confirm(
      `Disqualify "${tender.clientName}"? It will move straight to Disqualified Lead — this can only be undone by using its "Re-qualify" button.`
    );
    if (!confirmed) return;
    if (!profile) return;
    try {
      await disqualifyTender(tender, { uid: profile.uid, name: profile.name, role: profile.role });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not disqualify this lead.');
    }
  };

  const handleRequalify = async (tender: Tender) => {
    const confirmed = window.confirm(
      `Re-qualify "${tender.clientName}"? It will move back to New Lead and re-enter the pipeline from the top.`
    );
    if (!confirmed) return;
    if (!profile) return;
    try {
      await requalifyTender(tender, { uid: profile.uid, name: profile.name, role: profile.role });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not re-qualify this lead.');
    }
  };

  if (!profile) return null;

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-5 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-900">Sales Funnel Pipeline</h1>
          <HeaderCollapseToggle expanded={headerExpanded} onToggle={() => setHeaderExpanded((v) => !v)} />
        </div>
        {headerExpanded && (
          <div className="flex items-center justify-between gap-4 flex-wrap mt-2">
            <p className="text-sm text-slate-500">
              {filtered.length} tender{filtered.length === 1 ? '' : 's'} · {formatRM(totalValue)} total value
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search client…"
                className="input w-full sm:w-48"
              />
              <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="input w-full sm:w-40">
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
          </div>
        )}
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
            onDisqualify={handleDisqualify}
            onRequalify={handleRequalify}
            onDropStage={(tender, newStage) => {
              // Submission date is required exactly once, the moment a tender first reaches
              // Submitted — hold off on the actual stage move until SubmissionDateModal confirms
              // one. A tender that already has a submittedDate (e.g. moving back into Submitted
              // after a regression) skips straight through, same as any other stage move.
              if (newStage === 'Submitted' && !tender.submittedDate) {
                setPendingSubmission(tender);
                return;
              }
              moveTenderStage(tender, newStage, { uid: profile.uid, name: profile.name, role: profile.role });
            }}
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

      <SubmissionDateModal
        open={!!pendingSubmission}
        tender={pendingSubmission}
        onCancel={() => setPendingSubmission(null)}
        onConfirm={(submittedDate) => {
          if (pendingSubmission) {
            moveTenderStage(
              pendingSubmission,
              'Submitted',
              { uid: profile.uid, name: profile.name, role: profile.role },
              undefined,
              submittedDate
            );
          }
          setPendingSubmission(null);
        }}
      />
    </div>
  );
}
