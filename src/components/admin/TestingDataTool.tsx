import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTenders } from '../../hooks/useTenders';
import { useGuards, useBufferGuards } from '../../hooks/useGuards';
import { setTestingModeEnabled, subscribeTestingModeEnabled } from '../../services/settings';

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
 * Testing Mode (top toggle): while on, every NEW tender, Guard Bank guard, buffer guard, and
 * Duty Roster site gets automatically stamped isTestData: true at creation — see
 * createTender()/registerGuard()/registerBufferGuard() (src/services) and createSite()/
 * syncGuardBankOnAdd() and friends (public/duty-roster/index.html). No naming convention or
 * per-record checkbox to remember: as long as this is on, nothing created anywhere in the app
 * can slip through untagged. Turn it OFF the moment real, genuine data starts coming in.
 *
 * Below the toggle: every CURRENT record not yet flagged, so records made before this feature
 * existed (or made with Testing Mode accidentally left off) can still be tagged by hand, one
 * time, before go-live.
 */
export default function TestingDataTool() {
  const { profile } = useAuth();
  const { tenders } = useTenders(profile);
  const { guards } = useGuards();
  const { bufferGuards } = useBufferGuards();
  const { sites } = useRawSites();

  const [modeEnabled, setModeEnabled] = useState(false);
  const [modeLoading, setModeLoading] = useState(true);
  const [modeBusy, setModeBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeTestingModeEnabled((v) => {
      setModeEnabled(v);
      setModeLoading(false);
    });
    return unsub;
  }, []);

  const untaggedTenders = useMemo(() => tenders.filter((t) => !t.isTestData), [tenders]);
  const untaggedGuards = useMemo(() => guards.filter((g) => !g.isTestData), [guards]);
  const untaggedBuffer = useMemo(() => bufferGuards.filter((b) => !b.isTestData), [bufferGuards]);
  const untaggedSites = useMemo(() => sites.filter((s) => !s.isTestData), [sites]);

  const taggedCount =
    tenders.filter((t) => t.isTestData).length +
    guards.filter((g) => g.isTestData).length +
    bufferGuards.filter((b) => b.isTestData).length +
    sites.filter((s) => s.isTestData).length;

  async function handleToggleMode() {
    if (!profile) return;
    setModeBusy(true);
    try {
      await setTestingModeEnabled(!modeEnabled, { name: profile.name });
    } finally {
      setModeBusy(false);
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
              While on, every new tender, Guard Bank guard, buffer guard, and Duty Roster site
              created anywhere in the app — CRM or Duty Roster — is automatically tagged as test
              data, with nothing to remember. Turn this OFF the moment you're done testing and
              real data starts coming in.
            </p>
          </div>
          <button
            onClick={handleToggleMode}
            disabled={modeLoading || modeBusy}
            className={
              modeEnabled
                ? 'shrink-0 px-3.5 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 rounded-lg'
                : 'shrink-0 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 rounded-lg border border-slate-200'
            }
          >
            {modeLoading ? 'Loading…' : modeEnabled ? 'Testing Mode: ON' : 'Testing Mode: OFF'}
          </button>
        </div>
        {!modeLoading && (
          <p className="text-xs mt-3" style={{ color: modeEnabled ? '#b45309' : '#64748b' }}>
            {modeEnabled
              ? 'Currently ON — new records are being tagged as test data.'
              : 'Currently OFF — new records are treated as real data.'}
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800">Currently tagged as test data</h3>
        <p className="text-xs text-slate-400 mt-0.5 mb-1">
          {taggedCount} record{taggedCount === 1 ? '' : 's'} across tenders, sites, guards and
          buffer guards. Run <code className="font-mono">node scripts/purge-test-data.mjs
          --test-data</code> from a terminal (signed in as an admin) when you're ready to
          permanently delete all of them — see that script's own instructions for details.
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
