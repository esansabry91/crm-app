import { useMemo, useState } from 'react';
import clsx from 'clsx';
import StatCard from '../components/analytics/StatCard';
import RegisterGuardModal from '../components/guard-bank/RegisterGuardModal';
import AssignGuardModal from '../components/guard-bank/AssignGuardModal';
import { useAuth } from '../contexts/AuthContext';
import { useGuards, useBufferGuards, useSitesForPicker } from '../hooks/useGuards';
import {
  backfillGuardsFromDutyRoster,
  computeGuardTurnover,
  guardsWithPermitExpiringSoon,
  updateBufferGuardContact,
} from '../services/guards';
import { formatDate, formatDateTime, formatRM } from '../utils/format';
import { VIZ } from '../utils/vizColors';
import type { BufferGuard, Guard } from '../types';

const TABS = ['Guard Pool', 'Deployed Guards', 'Dismissed Guards', 'Buffer Guards'] as const;
type Tab = (typeof TABS)[number];

function CategoryPill({ category }: { category: Guard['category'] }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold',
        category === 'nepal' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'
      )}
    >
      {category === 'nepal' ? 'Nepal' : 'Local'}
    </span>
  );
}

function isPermitSoon(g: Guard): boolean {
  if (g.category !== 'nepal' || !g.permitExpiryDate) return false;
  return guardsWithPermitExpiringSoon([g]).length > 0;
}

export default function GuardBankPage() {
  const { profile } = useAuth();
  const { guards, loading: guardsLoading } = useGuards();
  const { bufferGuards, loading: bufferLoading } = useBufferGuards();
  const { sites } = useSitesForPicker();

  const [tab, setTab] = useState<Tab>('Guard Pool');
  const [toast, setToast] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [assignGuard, setAssignGuard] = useState<Guard | null>(null);
  const [editingBufferId, setEditingBufferId] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [backfilling, setBackfilling] = useState(false);

  const poolGuards = useMemo(() => guards.filter((g) => g.status === 'pool'), [guards]);
  const deployedGuards = useMemo(() => guards.filter((g) => g.status === 'deployed'), [guards]);
  const dismissedGuards = useMemo(
    () => guards.filter((g) => g.status === 'dismissed').sort((a, b) => (b.dismissedAt || 0) - (a.dismissedAt || 0)),
    [guards]
  );
  const permitSoon = useMemo(() => guardsWithPermitExpiringSoon(guards), [guards]);
  const turnover = useMemo(() => computeGuardTurnover(guards), [guards]);

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
        `Synced ${result.guardsScanned} guard(s) across ${result.sitesScanned} site(s): ` +
          `${result.created} added, ${result.updated} updated` +
          (result.skippedNoEmployeeId ? `, ${result.skippedNoEmployeeId} skipped (no Employee ID)` : '') +
          '.'
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not sync from Duty Roster.');
    } finally {
      setBackfilling(false);
    }
  }

  async function saveBufferContact(id: string) {
    try {
      await updateBufferGuardContact(id, { phoneNumber: editPhone.trim() });
      flash('Updated contact number.');
    } catch {
      flash('Could not save that contact number.');
    } finally {
      setEditingBufferId(null);
    }
  }

  const loading = guardsLoading || bufferLoading;

  return (
    <div className="h-screen overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Guard Bank</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Every registered guard across all branches — unassigned, deployed, dismissed and buffer.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {profile?.role === 'admin' && (
              <button
                onClick={runDutyRosterSync}
                disabled={backfilling}
                title="Reconcile Guard Bank against every site's live roster in Duty Roster — safe to use anytime, not just once"
                className="px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 rounded-lg border border-slate-200 inline-flex items-center gap-1.5"
              >
                <span aria-hidden className={backfilling ? 'animate-spin' : ''}>↻</span>
                {backfilling ? 'Syncing…' : 'Refresh from Duty Roster'}
              </button>
            )}
            {tab === 'Guard Pool' && (
              <button
                onClick={() => setRegisterOpen(true)}
                className="px-3.5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                + Register guard
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
          <StatCard label="Unassigned guards" value={String(poolGuards.length)} sub="Guard Pool" />
          <StatCard
            label="Permit expiring ≤ 2 months"
            value={String(permitSoon.length)}
            sub="Nepal category"
            accent={permitSoon.length > 0 ? VIZ.status.warning : undefined}
          />
          <StatCard label="Dismissed guards" value={String(dismissedGuards.length)} />
          <StatCard label="Buffer guards" value={String(bufferGuards.length)} />
          <StatCard
            label="Turnover rate (12mo)"
            value={`${turnover.rate.toFixed(1)}%`}
            sub={`${turnover.dismissedLast12mo} dismissed / avg ${turnover.avgHeadcount.toFixed(1)} active`}
          />
        </div>

        <div className="flex gap-1 mt-4 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-lg transition whitespace-nowrap',
                tab === t ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'
              )}
            >
              {t}
              {t === 'Guard Pool' && poolGuards.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-400">{poolGuards.length}</span>
              )}
              {t === 'Deployed Guards' && deployedGuards.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-400">{deployedGuards.length}</span>
              )}
              {t === 'Dismissed Guards' && dismissedGuards.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-400">{dismissedGuards.length}</span>
              )}
              {t === 'Buffer Guards' && bufferGuards.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-400">{bufferGuards.length}</span>
              )}
            </button>
          ))}
        </div>
      </header>

      {toast && (
        <div className="mx-6 mt-4 px-3.5 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm">{toast}</div>
      )}

      <div className="px-6 py-6">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : tab === 'Guard Pool' ? (
          poolGuards.length === 0 ? (
            <p className="text-sm text-slate-400">
              No unassigned guards. New batches get registered here first, via "+ Register guard" above, or
              automatically whenever Duty Roster adds a guard whose Employee ID isn't in Guard Bank yet.
            </p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Employee ID</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Location</th>
                    <th className="px-4 py-2.5">Registered</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {poolGuards.map((g) => (
                    <tr key={g.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{g.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{g.employeeId}</td>
                      <td className="px-4 py-2.5">
                        <CategoryPill category={g.category} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{[g.city, g.state].filter(Boolean).join(', ') || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-400">{formatDate(new Date(g.createdAt).toISOString())}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => setAssignGuard(g)}
                          className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-md"
                        >
                          Assign to site
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'Deployed Guards' ? (
          deployedGuards.length === 0 ? (
            <p className="text-sm text-slate-400">No guards currently deployed.</p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Employee ID</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Site</th>
                    <th className="px-4 py-2.5">Branch</th>
                    <th className="px-4 py-2.5">Permit expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {deployedGuards.map((g) => (
                    <tr key={g.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{g.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{g.employeeId}</td>
                      <td className="px-4 py-2.5">
                        <CategoryPill category={g.category} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{g.siteName || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{g.branch || 'Unassigned'}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'Dismissed Guards' ? (
          dismissedGuards.length === 0 ? (
            <p className="text-sm text-slate-400">No dismissed guards.</p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Employee ID</th>
                    <th className="px-4 py-2.5">Last site</th>
                    <th className="px-4 py-2.5">Reason</th>
                    <th className="px-4 py-2.5">Dismissed</th>
                  </tr>
                </thead>
                <tbody>
                  {dismissedGuards.map((g) => (
                    <tr key={g.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{g.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{g.employeeId}</td>
                      <td className="px-4 py-2.5 text-slate-500">{g.siteName || '-'}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{ backgroundColor: `${VIZ.status.critical}1a`, color: VIZ.status.critical }}
                        >
                          {g.dismissalReason || 'Unspecified'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{g.dismissedAt ? formatDateTime(g.dismissedAt) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : bufferGuards.length === 0 ? (
          <p className="text-sm text-slate-400">
            No buffer guards yet — they're recorded automatically whenever Duty Roster assigns a temporary
            guard to cover a shift.
          </p>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Rate</th>
                  <th className="px-4 py-2.5">Phone</th>
                  <th className="px-4 py-2.5">Location</th>
                  <th className="px-4 py-2.5">Last site</th>
                  <th className="px-4 py-2.5">Last used at</th>
                  <th className="px-4 py-2.5">Times used</th>
                </tr>
              </thead>
              <tbody>
                {bufferGuards
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
                              Save
                            </button>
                            <button
                              onClick={() => setEditingBufferId(null)}
                              className="text-xs text-slate-400 hover:underline"
                            >
                              Cancel
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
                            {bg.phoneNumber || <span className="text-slate-300">Add phone</span>}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{[bg.city, bg.state].filter(Boolean).join(', ') || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{bg.lastSiteName || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-400">{formatDateTime(bg.lastUsedAt)}</td>
                      <td className="px-4 py-2.5 text-slate-500 tabular-nums">{bg.timesUsed}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RegisterGuardModal open={registerOpen} onClose={() => setRegisterOpen(false)} onRegistered={flash} />
      <AssignGuardModal
        open={!!assignGuard}
        guard={assignGuard}
        sites={sites}
        onClose={() => setAssignGuard(null)}
        onAssigned={flash}
      />
    </div>
  );
}
