import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTenders } from '../../hooks/useTenders';
import { useGuards, useBufferGuards } from '../../hooks/useGuards';
import { getTestDataCounts, resetTestData } from '../../services/testDataReset';

/** Minimal shape read straight off a Duty Roster `sites/{id}` doc — there's no shared Site type
 *  in types.ts (that collection is owned by public/duty-roster/index.html's own data model), so
 *  this stays local to the one place the CRM needs to look at it: this cleanup tool. */
interface RawSite {
  id: string;
  name: string;
  branch: string | null;
  archived: boolean;
  isTestData: boolean;
  createdAt: string;
}

function useRawSites() {
  const [sites, setSites] = useState<RawSite[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'sites'),
      (snap) => {
        setSites(
          snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              name: (data.name as string) || 'Untitled site',
              branch: (data.branch as string) ?? null,
              archived: !!data.archived,
              isTestData: !!data.isTestData,
              createdAt: (data.createdAt as string) || '',
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);
  return { sites, loading };
}

function TestDataRow({
  label,
  sub,
  flagged,
  onToggle,
}: {
  label: string;
  sub?: string;
  flagged: boolean;
  onToggle: (next: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const handleClick = async () => {
    setBusy(true);
    try {
      await onToggle(!flagged);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{label}</p>
        {sub && <p className="text-xs text-slate-400 truncate">{sub}</p>}
      </div>
      <button
        onClick={handleClick}
        disabled={busy}
        className={
          flagged
            ? 'text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-60 rounded px-2.5 py-1 border border-slate-200 shrink-0'
            : 'text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 rounded px-2.5 py-1 shrink-0'
        }
      >
        {busy ? 'Saving…' : flagged ? 'Unmark test data' : 'Mark as test data'}
      </button>
    </div>
  );
}

/**
 * Prepares for a clean split between demo/testing content and real production data before this
 * app goes live — see scripts/purge-test-data.mjs's --test-data mode, which is what actually
 * deletes everything flagged here (this tool only tags; the destructive step stays in that
 * script, run from a terminal with a real admin sign-in, same as its --all/--uid modes).
 *
 * This whole page is itself restricted to the 'developer' role (see AdminPage.tsx) — every NEW
 * tender, Guard Bank guard, buffer guard, and Duty Roster site a developer account creates gets
 * automatically stamped isTestData: true at creation, unconditionally — see shouldStampTestData()
 * in src/services/settings.ts, createTender()/registerGuard()/registerBufferGuard() (src/services)
 * and createSite()/syncGuardBankOnAdd() and friends (public/duty-roster/index.html). "Testing
 * Mode" below is therefore always ON for whoever can see this page — it's a fixed status
 * indicator, not a switch; there's nothing to remember to turn on or off any more, and it never
 * affects what a real staff/admin account creates.
 *
 * Below that: every CURRENT record not yet flagged, so records made before this feature existed
 * can still be tagged by hand, one time, before go-live.
 */
export default function TestingDataTool() {
  const { profile } = useAuth();
  const { tenders } = useTenders(profile);
  const { guards } = useGuards();
  const { bufferGuards } = useBufferGuards();
  const { sites } = useRawSites();

  const untaggedTenders = useMemo(() => tenders.filter((t) => !t.isTestData), [tenders]);
  const untaggedGuards = useMemo(() => guards.filter((g) => !g.isTestData), [guards]);
  const untaggedBuffer = useMemo(() => bufferGuards.filter((b) => !b.isTestData), [bufferGuards]);
  const untaggedSites = useMemo(() => sites.filter((s) => !s.isTestData), [sites]);

  const taggedCount =
    tenders.filter((t) => t.isTestData).length +
    guards.filter((g) => g.isTestData).length +
    bufferGuards.filter((b) => b.isTestData).length +
    sites.filter((s) => s.isTestData).length;

  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<{ text: string; isError: boolean } | null>(null);

  /**
   * Two confirmations before anything is deleted: the first states exactly what's about to go
   * (fresh counts, not the page's possibly-stale live data), the second requires typing DELETE —
   * same phrase scripts/purge-test-data.mjs's --test-data mode already requires from its
   * terminal, so both paths to this action feel consistent. Nothing outside collections already
   * tagged isTestData is ever touched.
   */
  async function handleResetClick() {
    setResetMessage(null);
    setResetBusy(true);
    try {
      const counts = await getTestDataCounts();
      const total = counts.tenders + counts.sites + counts.guards + counts.bufferGuards;
      if (total === 0) {
        setResetMessage({ text: 'Nothing is currently tagged as test data — nothing to delete.', isError: false });
        return;
      }
      const confirmed = window.confirm(
        `Permanently delete all test data?\n\n` +
          `- ${counts.tenders} tender(s), plus their history logs\n` +
          `- ${counts.sites} Duty Roster site(s), plus their schedule data\n` +
          `- ${counts.guards} Guard Bank guard(s)\n` +
          `- ${counts.bufferGuards} buffer guard(s)\n\n` +
          `Any real guard still deployed at a test site will be released back to the Guard Pool first. This cannot be undone.`
      );
      if (!confirmed) return;
      const typed = window.prompt('Type DELETE (all caps) to confirm, or Cancel to back out:');
      if (typed !== 'DELETE') {
        setResetMessage({ text: 'Cancelled — nothing was deleted.', isError: false });
        return;
      }
      const result = await resetTestData();
      setResetMessage({
        text:
          `Deleted ${result.tenders} tender(s), ${result.history} history entrie(s), ${result.sites} site(s), ` +
          `${result.months} schedule record(s), ${result.guards} guard(s), and ${result.bufferGuards} buffer guard(s).` +
          (result.guardsReleased > 0 ? ` Released ${result.guardsReleased} real guard(s) back to the Guard Pool.` : ''),
        isError: false,
      });
    } catch (err) {
      setResetMessage({
        text: err instanceof Error ? err.message : 'Could not delete test data.',
        isError: true,
      });
    } finally {
      setResetBusy(false);
    }
  }

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Testing Mode</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              You're signed in as a Developer account, so this is always ON for you: every
              tender, Guard Bank guard, buffer guard, and Duty Roster site you create anywhere in
              the app — CRM or Duty Roster — is automatically tagged as test data. This is now
              purely a status indicator (nothing to turn on or off) — a real staff/admin
              account's data is never affected by it.
            </p>
          </div>
          <span className="shrink-0 px-3.5 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg">
            Testing Mode: ON
          </span>
        </div>
        <p className="text-xs mt-3" style={{ color: '#b45309' }}>
          Always ON for this account — every record you create here is tagged as test data.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Currently tagged as test data</h3>
            <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
              {taggedCount} record{taggedCount === 1 ? '' : 's'} across tenders, sites, guards and
              buffer guards. Deleting is permanent — each tender's history log and each site's
              schedule data goes with it, and any real guard still deployed at a test site is
              released back to the Guard Pool first.
            </p>
          </div>
          <button
            onClick={handleResetClick}
            disabled={resetBusy}
            className="shrink-0 px-3.5 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg"
          >
            {resetBusy ? 'Deleting…' : 'Delete all test data'}
          </button>
        </div>
        {resetMessage && (
          <p className={`text-xs mt-3 ${resetMessage.isError ? 'text-rose-600' : 'text-emerald-600'}`}>
            {resetMessage.text}
          </p>
        )}
        <p className="text-xs text-slate-400 mt-3">
          The same cleanup is also available from a terminal via{' '}
          <code className="font-mono">node scripts/purge-test-data.mjs --test-data</code>, if
          you'd rather run it that way.
        </p>
      </div>

      {untaggedTenders.length === 0 && untaggedSites.length === 0 && untaggedGuards.length === 0 && untaggedBuffer.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-emerald-600">
            ✓ Every current record is already tagged one way or the other — nothing left to sort.
          </p>
        </div>
      ) : (
        <>
          {untaggedTenders.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-sm font-semibold text-slate-800 mb-1">
                Tenders not yet sorted ({untaggedTenders.length})
              </h4>
              <p className="text-xs text-slate-400 mb-3">
                Made before Testing Mode existed (or while it was off) — mark the ones that were
                only for testing.
              </p>
              {untaggedTenders.map((t) => (
                <TestDataRow
                  key={t.id}
                  label={t.clientName}
                  sub={`${t.stage} · ${t.department} · Owner: ${t.ownerName}`}
                  flagged={false}
                  onToggle={(next) => updateDoc(doc(db, 'tenders', t.id), { isTestData: next, updatedAt: Date.now() })}
                />
              ))}
            </div>
          )}

          {untaggedSites.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-sm font-semibold text-slate-800 mb-1">
                Duty Roster sites not yet sorted ({untaggedSites.length})
              </h4>
              <p className="text-xs text-slate-400 mb-3">
                Includes archived sites — sort those too if they were only ever test/demo sites.
              </p>
              {untaggedSites.map((s) => (
                <TestDataRow
                  key={s.id}
                  label={s.name}
                  sub={`${s.branch || 'Unassigned branch'}${s.archived ? ' · Archived' : ''}`}
                  flagged={false}
                  onToggle={(next) => updateDoc(doc(db, 'sites', s.id), { isTestData: next, updatedAt: new Date().toISOString() })}
                />
              ))}
            </div>
          )}

          {untaggedGuards.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-sm font-semibold text-slate-800 mb-1">
                Guard Bank guards not yet sorted ({untaggedGuards.length})
              </h4>
              {untaggedGuards.map((g) => (
                <TestDataRow
                  key={g.id}
                  label={g.name}
                  sub={`${g.employeeId || 'No employee ID'} · ${g.status}`}
                  flagged={false}
                  onToggle={(next) => updateDoc(doc(db, 'guards', g.id), { isTestData: next, updatedAt: Date.now() })}
                />
              ))}
            </div>
          )}

          {untaggedBuffer.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-sm font-semibold text-slate-800 mb-1">
                Buffer guards not yet sorted ({untaggedBuffer.length})
              </h4>
              {untaggedBuffer.map((b) => (
                <TestDataRow
                  key={b.id}
                  label={b.name}
                  sub={b.lastSiteName ? `Last at ${b.lastSiteName}` : 'Never assigned'}
                  flagged={false}
                  onToggle={(next) => updateDoc(doc(db, 'bufferGuards', b.id), { isTestData: next })}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
