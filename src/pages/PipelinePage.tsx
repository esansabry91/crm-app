import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenders } from '../hooks/useTenders';
import { useBranches, useBrands } from '../hooks/useBranches';
import { useUsers } from '../hooks/useUsers';
import KanbanBoard from '../components/kanban/KanbanBoard';
import HeaderCollapseToggle from '../components/layout/HeaderCollapseToggle';
import StatCard from '../components/analytics/StatCard';
import TenderFormModal from '../components/tenders/TenderFormModal';
import SubmissionDateModal from '../components/tenders/SubmissionDateModal';
import { disqualifyTender, isTenderArchived, moveTenderStage, requalifyTender } from '../services/tenders';
import type { Tender } from '../types';
import { CLOSED_STAGES, isAdminRole } from '../types';
import { formatRM } from '../utils/format';

/** Days from today (local midnight) until an ISO yyyy-mm-dd date — negative once it's past. Used
 *  by both reminder tiles below to find dates "within 30 days", including already-overdue ones
 *  (an overdue reminder is more urgent, not less, so it's never silently dropped). */
function daysUntil(isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`).getTime();
  const startOfToday = new Date(new Date().toDateString()).getTime();
  return Math.round((target - startOfToday) / 86400000);
}
const REMINDER_WINDOW_DAYS = 30;

export default function PipelinePage() {
  const { profile } = useAuth();
  const { tenders, loading } = useTenders(profile);
  const { brands } = useBrands();
  const { branches } = useBranches();
  const { users } = useUsers();

  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  // Admin/Developer only — a Branch Manager/staff account already only ever sees its own
  // tenders here (see useTenders' own-uid scoping), so a branch filter would have nothing to
  // narrow for them. Filters on Tender.department (the branch name, or "HQ" — see its doc
  // comment in types.ts) rather than a branchId, since that's the plain string tenders are
  // actually stored with, same as TenderFormModal's own department select.
  const canFilterByBranch = isAdminRole(profile?.role);
  const [branchFilter, setBranchFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tender | null>(null);
  // A tender awaiting its required submission date before the drag-to-Submitted move actually
  // commits (see the onDropStage handler below and SubmissionDateModal.tsx).
  const [pendingSubmission, setPendingSubmission] = useState<Tender | null>(null);
  const [headerExpanded, setHeaderExpanded] = useState(true);
  // Which reminder tile's "Go to list" was clicked, if any — narrows the board down to just the
  // matching cards (still in their real columns) rather than opening a separate list view, since
  // Pipeline has no flat list UI of its own. 'none' shows everything, same as before these tiles
  // existed.
  const [reminderFilter, setReminderFilter] = useState<'none' | 'contractEnding' | 'submissionExpiring'>('none');

  const staffOptions = useMemo(
    () => (isAdminRole(profile?.role) ? users.filter((u) => u.active !== false) : profile ? [profile] : []),
    [profile, users]
  );

  // A non-admin never gets to apply a branch filter — if one was somehow left selected (e.g.
  // the account's role changed mid-session) it stops taking effect rather than silently hiding
  // tenders, same pattern as Branch Collection's canFilterByBranch usages.
  const effectiveBranchFilter = canFilterByBranch ? branchFilter : 'all';

  // Brand/branch/search-scoped set the two reminder tiles' counts are computed from, BEFORE the
  // reminder filter itself narrows things further for the board below — so the tiles' numbers
  // stay meaningful (e.g. "within this branch") rather than collapsing to whatever's currently
  // showing once a reminder filter is already active.
  const baseFiltered = useMemo(() => {
    return tenders.filter((t) => {
      // Won/Lost/Disqualified Lead tenders over a year old move to the Archive page instead of
      // sitting on the board forever — see isTenderArchived()'s doc comment in services/tenders.ts.
      if (isTenderArchived(t)) return false;
      if (brandFilter !== 'all' && t.brandId !== brandFilter) return false;
      if (effectiveBranchFilter !== 'all' && t.department !== effectiveBranchFilter) return false;
      if (search.trim() && !t.clientName.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [tenders, brandFilter, effectiveBranchFilter, search]);

  // Only an open (not yet Won/Lost/Disqualified) tender's reminder is still actionable — once a
  // tender is closed out one way or another, whether its current contract or submission is
  // "ending soon" no longer matters.
  const openFiltered = useMemo(
    () => baseFiltered.filter((t) => !CLOSED_STAGES.includes(t.stage)),
    [baseFiltered]
  );
  const contractEndingSoon = useMemo(
    () =>
      openFiltered.filter(
        (t) => !!t.currentContractEndDate && daysUntil(t.currentContractEndDate) <= REMINDER_WINDOW_DAYS
      ),
    [openFiltered]
  );
  const submissionExpiringSoon = useMemo(
    () =>
      openFiltered.filter(
        (t) => !!t.submissionExpiryDate && daysUntil(t.submissionExpiryDate) <= REMINDER_WINDOW_DAYS
      ),
    [openFiltered]
  );

  const filtered = useMemo(() => {
    if (reminderFilter === 'none') return baseFiltered;
    const ids = new Set((reminderFilter === 'contractEnding' ? contractEndingSoon : submissionExpiringSoon).map((t) => t.id));
    return baseFiltered.filter((t) => ids.has(t.id));
  }, [baseFiltered, reminderFilter, contractEndingSoon, submissionExpiringSoon]);

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
              {canFilterByBranch && (
                <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input w-full sm:w-40">
                  <option value="all">All branches</option>
                  <option value="HQ">HQ</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
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
        {headerExpanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 max-w-xl">
            <StatCard
              label="Contract ending soon"
              value={String(contractEndingSoon.length)}
              sub={`Qualified leads' current contract ends within ${REMINDER_WINDOW_DAYS} days`}
              accent="#b45309"
              action={{
                label: 'Go to list',
                onClick: () => setReminderFilter('contractEnding'),
                disabled: contractEndingSoon.length === 0,
              }}
            />
            <StatCard
              label="Submission expiring soon"
              value={String(submissionExpiringSoon.length)}
              sub={`Submission expiry within ${REMINDER_WINDOW_DAYS} days`}
              accent="#be123c"
              action={{
                label: 'Go to list',
                onClick: () => setReminderFilter('submissionExpiring'),
                disabled: submissionExpiringSoon.length === 0,
              }}
            />
          </div>
        )}
      </header>

      {reminderFilter !== 'none' && (
        <div className="px-6 pt-3 -mb-1">
          <div className="flex items-center justify-between gap-3 bg-amber-50 text-amber-800 text-sm rounded-lg px-3 py-2">
            <span>
              Showing only tenders matching{' '}
              <span className="font-medium">
                {reminderFilter === 'contractEnding' ? 'Contract ending soon' : 'Submission expiring soon'}
              </span>{' '}
              ({filtered.length})
            </span>
            <button onClick={() => setReminderFilter('none')} className="font-medium underline underline-offset-2 shrink-0">
              Clear filter
            </button>
          </div>
        </div>
      )}

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
        onConfirm={(submittedDate, submissionExpiryDate) => {
          if (pendingSubmission) {
            moveTenderStage(
              pendingSubmission,
              'Submitted',
              { uid: profile.uid, name: profile.name, role: profile.role },
              undefined,
              submittedDate,
              submissionExpiryDate
            );
          }
          setPendingSubmission(null);
        }}
      />
    </div>
  );
}
