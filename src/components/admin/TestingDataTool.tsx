import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTenders } from '../../hooks/useTenders';
import { useGuards, useBufferGuards } from '../../hooks/useGuards';
import { getTestDataCounts, resetTestData } from '../../services/testDataReset';
import { labelToKey } from '../../i18n';

const GUARD_STATUS_KEYS: Record<string, string> = {
  pool: 'admin.testingDataTool.guardStatusPool',
  deployed: 'admin.testingDataTool.guardStatusDeployed',
  dismissed: 'admin.testingDataTool.guardStatusDismissed',
};
function guardStatusLabel(t: TFunction, status: string): string {
  const key = GUARD_STATUS_KEYS[status];
  return key ? t(key) : status;
}

/** Minimal shape read straight off a Duty Roster `sites/{id}` doc — there's no shared Site type
 *  in types.ts (that collection is owned by public/duty-roster/index.html's own data model), so
 *  this stays local to the one place the CRM needs to look at it: this cleanup tool. */
interface RawSite {
  id: string;
  name: string;
  branch: string | null;
  archived: boolean;
  /** undefined = never reviewed by this tool yet (see the "not yet sorted" sections below) —
   *  kept tri-state on purpose, so don't coerce with !!. */
  isTestData: boolean | undefined;
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
              isTestData: typeof data.isTestData === 'boolean' ? data.isTestData : undefined,
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
  const { t } = useTranslation();
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
        {busy ? t('admin.testingDataTool.savingEllipsis') : flagged ? t('admin.testingDataTool.unmarkTestData') : t('admin.testingDataTool.markAsTestData')}
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
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { tenders } = useTenders(profile);
  const { guards } = useGuards();
  const { bufferGuards } = useBufferGuards();
  const { sites } = useRawSites();

  const untaggedTenders = useMemo(() => tenders.filter((tender) => tender.isTestData === undefined), [tenders]);
  const untaggedGuards = useMemo(() => guards.filter((g) => g.isTestData === undefined), [guards]);
  const untaggedBuffer = useMemo(() => bufferGuards.filter((b) => b.isTestData === undefined), [bufferGuards]);
  const untaggedSites = useMemo(() => sites.filter((s) => s.isTestData === undefined), [sites]);

  // A site created via "+ Add Site" before createTenderSite()'s own isTestData bug was fixed
  // (see its doc comment in services/tenders.ts) got hardcoded isTestData: false at creation —
  // never `undefined` — so it never shows up in untaggedSites above and "Delete all test data"
  // can never reach it either. This is the only way back to fixing one of those: search by name
  // (deliberately NOT a full site listing by default — most sites here are real production data
  // and shouldn't be one accidental click away from getting tagged as test data) and flip its
  // tag directly.
  const [siteLookupQuery, setSiteLookupQuery] = useState('');
  const siteLookupMatches = useMemo(() => {
    const needle = siteLookupQuery.trim().toLowerCase();
    if (!needle) return [];
    return sites.filter((s) => s.name.toLowerCase().includes(needle)).slice(0, 25);
  }, [sites, siteLookupQuery]);

  // Deliberately excludes invoices and tasks from this live on-page count — same reasoning
  // as the code comment on the "Currently tagged as test data" card below: both still get
  // fully deleted by the button, this indicator just isn't wired up to every collection.
  const taggedCount =
    tenders.filter((t) => t.isTestData).length +
    guards.filter((g) => g.isTestData).length +
    bufferGuards.filter((b) => b.isTestData).length +
    sites.filter((s) => s.isTestData).length;

  const [confirmBusyKey, setConfirmBusyKey] = useState<string | null>(null);

  /**
   * Bulk-confirms every record in one "not yet sorted" list as genuine (isTestData: false) in
   * one shot, instead of clicking "Mark as test data" past each of them one at a time. Once
   * written, each record has an explicit isTestData value and permanently drops out of its
   * "not yet sorted" list — see the untagged-list filters (isTestData === undefined) above.
   */
  async function confirmAllReal(key: string, ids: string[], writeOne: (id: string) => Promise<void>) {
    setConfirmBusyKey(key);
    try {
      await Promise.all(ids.map(writeOne));
    } finally {
      setConfirmBusyKey(null);
    }
  }

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
      let counts: Awaited<ReturnType<typeof getTestDataCounts>>;
      try {
        counts = await getTestDataCounts();
      } catch (err) {
        // Tag which phase failed before it reaches the shared catch below — this read happens
        // before either confirmation dialog, so a denial here means the button's counts (and the
        // confirm dialog listing them) never even had a chance to appear.
        const e = err instanceof Error ? err : new Error(String(err));
        e.message = `[reading current counts] ${e.message}`;
        throw e;
      }
      const total =
        counts.tenders + counts.sites + counts.guards + counts.bufferGuards + counts.invoices + counts.tasks;
      if (total === 0) {
        setResetMessage({ text: t('admin.testingDataTool.nothingToDelete'), isError: false });
        return;
      }
      const confirmed = window.confirm(
        t('admin.testingDataTool.confirmDeleteAll', {
          tenders: counts.tenders,
          sites: counts.sites,
          guards: counts.guards,
          bufferGuards: counts.bufferGuards,
          invoices: counts.invoices,
          tasks: counts.tasks,
        })
      );
      if (!confirmed) return;
      const typed = window.prompt(t('admin.testingDataTool.typeDeletePrompt'));
      if (typed !== 'DELETE') {
        setResetMessage({ text: t('admin.testingDataTool.cancelledNothingDeleted'), isError: false });
        return;
      }
      const result = await resetTestData();
      setResetMessage({
        text: t('admin.testingDataTool.deleteResultSummary', {
          tenders: result.tenders,
          history: result.history,
          sites: result.sites,
          months: result.months,
          guards: result.guards,
          bufferGuards: result.bufferGuards,
          invoices: result.invoices,
          tasks: result.tasks,
        }) + (result.guardsReleased > 0 ? ` ${t('admin.testingDataTool.guardsReleasedNote', { count: result.guardsReleased })}` : ''),
        isError: false,
      });
    } catch (err) {
      // Logged with full detail (including Firestore's error `code`, e.g. "permission-denied")
      // so a denial can be diagnosed from the browser console without guessing — the on-page
      // text below is deliberately terser than what Firestore actually reports.
      console.error('Delete all test data failed:', err);
      const code = (err as { code?: string } | null)?.code;
      const baseMessage = err instanceof Error ? err.message : t('admin.testingDataTool.errorCouldNotDelete');
      setResetMessage({
        text: code ? `${baseMessage} (code: ${code})` : baseMessage,
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
            <h3 className="text-sm font-semibold text-slate-800">{t('admin.testingDataTool.testingModeTitle')}</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              {t('admin.testingDataTool.testingModeDescription')}
            </p>
          </div>
          <span className="shrink-0 px-3.5 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg">
            {t('admin.testingDataTool.testingModeOn')}
          </span>
        </div>
        <p className="text-xs mt-3" style={{ color: '#b45309' }}>
          {t('admin.testingDataTool.testingModeAlwaysOnNote')}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{t('admin.testingDataTool.currentlyTaggedTitle')}</h3>
            <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
              {t('admin.testingDataTool.currentlyTaggedDescription', { count: taggedCount })}
            </p>
          </div>
          <button
            onClick={handleResetClick}
            disabled={resetBusy}
            className="shrink-0 px-3.5 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg"
          >
            {resetBusy ? t('admin.testingDataTool.deletingEllipsis') : t('admin.testingDataTool.deleteAllTestData')}
          </button>
        </div>
        {resetMessage && (
          <p
            className={`text-xs mt-3 whitespace-pre-line ${resetMessage.isError ? 'text-rose-600' : 'text-emerald-600'}`}
          >
            {resetMessage.text}
          </p>
        )}
        <p className="text-xs text-slate-400 mt-3">
          {t('admin.testingDataTool.terminalAlternativePrefix')}{' '}
          <code className="font-mono">node scripts/purge-test-data.mjs --test-data</code>{t('admin.testingDataTool.terminalAlternativeSuffix')}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="text-sm font-semibold text-slate-800">{t('admin.testingDataTool.lookupSiteTitle')}</h4>
        <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
          {t('admin.testingDataTool.lookupSiteDescription')}
        </p>
        <input
          type="text"
          value={siteLookupQuery}
          onChange={(e) => setSiteLookupQuery(e.target.value)}
          placeholder={t('admin.testingDataTool.lookupSitePlaceholder')}
          className="mt-3 w-full max-w-sm rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
        />
        {siteLookupQuery.trim() !== '' && (
          siteLookupMatches.length === 0 ? (
            <p className="text-xs text-slate-400 mt-3">{t('admin.testingDataTool.noSitesMatch', { query: siteLookupQuery.trim() })}</p>
          ) : (
            <div className="mt-2">
              {siteLookupMatches.map((s) => (
                <TestDataRow
                  key={s.id}
                  label={s.name}
                  sub={t('admin.testingDataTool.siteLookupSub', {
                    branch: s.branch || t('admin.testingDataTool.unassignedBranch'),
                    tag:
                      s.isTestData === undefined
                        ? t('admin.testingDataTool.tagNotYetSorted')
                        : s.isTestData
                          ? t('admin.testingDataTool.tagTestData')
                          : t('admin.testingDataTool.tagRealData'),
                  })}
                  flagged={!!s.isTestData}
                  onToggle={(next) => updateDoc(doc(db, 'sites', s.id), { isTestData: next, updatedAt: new Date().toISOString() })}
                />
              ))}
            </div>
          )
        )}
      </div>

      {untaggedTenders.length === 0 && untaggedSites.length === 0 && untaggedGuards.length === 0 && untaggedBuffer.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-emerald-600">
            {t('admin.testingDataTool.nothingLeftToSort')}
          </p>
        </div>
      ) : (
        <>
          {untaggedTenders.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h4 className="text-sm font-semibold text-slate-800">
                  {t('admin.testingDataTool.tendersNotSortedHeading', { count: untaggedTenders.length })}
                </h4>
                <button
                  onClick={() =>
                    confirmAllReal(
                      'tenders',
                      untaggedTenders.map((tender) => tender.id),
                      (id) => updateDoc(doc(db, 'tenders', id), { isTestData: false, updatedAt: Date.now() })
                    )
                  }
                  disabled={confirmBusyKey === 'tenders'}
                  className="shrink-0 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 rounded px-2.5 py-1 border border-emerald-200"
                >
                  {confirmBusyKey === 'tenders' ? t('admin.testingDataTool.confirmingEllipsis') : t('admin.testingDataTool.confirmAllAsRealData')}
                </button>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                {t('admin.testingDataTool.tendersNotSortedDescription')}
              </p>
              {untaggedTenders.map((tender) => (
                <TestDataRow
                  key={tender.id}
                  label={tender.clientName}
                  sub={t('admin.testingDataTool.tenderSub', {
                    stage: t(`pipeline.stages.${labelToKey(tender.stage)}`),
                    department: tender.department,
                    owner: tender.ownerName,
                  })}
                  flagged={false}
                  onToggle={(next) => updateDoc(doc(db, 'tenders', tender.id), { isTestData: next, updatedAt: Date.now() })}
                />
              ))}
            </div>
          )}

          {untaggedSites.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h4 className="text-sm font-semibold text-slate-800">
                  {t('admin.testingDataTool.sitesNotSortedHeading', { count: untaggedSites.length })}
                </h4>
                <button
                  onClick={() =>
                    confirmAllReal(
                      'sites',
                      untaggedSites.map((s) => s.id),
                      (id) => updateDoc(doc(db, 'sites', id), { isTestData: false, updatedAt: new Date().toISOString() })
                    )
                  }
                  disabled={confirmBusyKey === 'sites'}
                  className="shrink-0 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 rounded px-2.5 py-1 border border-emerald-200"
                >
                  {confirmBusyKey === 'sites' ? t('admin.testingDataTool.confirmingEllipsis') : t('admin.testingDataTool.confirmAllAsRealData')}
                </button>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                {t('admin.testingDataTool.sitesNotSortedDescription')}
              </p>
              {untaggedSites.map((s) => (
                <TestDataRow
                  key={s.id}
                  label={s.name}
                  sub={`${s.branch || t('admin.testingDataTool.unassignedBranch')}${s.archived ? ` · ${t('admin.testingDataTool.archivedSuffix')}` : ''}`}
                  flagged={false}
                  onToggle={(next) => updateDoc(doc(db, 'sites', s.id), { isTestData: next, updatedAt: new Date().toISOString() })}
                />
              ))}
            </div>
          )}

          {untaggedGuards.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h4 className="text-sm font-semibold text-slate-800">
                  {t('admin.testingDataTool.guardsNotSortedHeading', { count: untaggedGuards.length })}
                </h4>
                <button
                  onClick={() =>
                    confirmAllReal(
                      'guards',
                      untaggedGuards.map((g) => g.id),
                      (id) => updateDoc(doc(db, 'guards', id), { isTestData: false, updatedAt: Date.now() })
                    )
                  }
                  disabled={confirmBusyKey === 'guards'}
                  className="shrink-0 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 rounded px-2.5 py-1 border border-emerald-200"
                >
                  {confirmBusyKey === 'guards' ? t('admin.testingDataTool.confirmingEllipsis') : t('admin.testingDataTool.confirmAllAsRealData')}
                </button>
              </div>
              {untaggedGuards.map((g) => (
                <TestDataRow
                  key={g.id}
                  label={g.name}
                  sub={`${g.employeeId || t('admin.testingDataTool.noEmployeeId')} · ${guardStatusLabel(t, g.status)}`}
                  flagged={false}
                  onToggle={(next) => updateDoc(doc(db, 'guards', g.id), { isTestData: next, updatedAt: Date.now() })}
                />
              ))}
            </div>
          )}

          {untaggedBuffer.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h4 className="text-sm font-semibold text-slate-800">
                  {t('admin.testingDataTool.bufferGuardsNotSortedHeading', { count: untaggedBuffer.length })}
                </h4>
                <button
                  onClick={() =>
                    confirmAllReal(
                      'bufferGuards',
                      untaggedBuffer.map((b) => b.id),
                      (id) => updateDoc(doc(db, 'bufferGuards', id), { isTestData: false })
                    )
                  }
                  disabled={confirmBusyKey === 'bufferGuards'}
                  className="shrink-0 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 rounded px-2.5 py-1 border border-emerald-200"
                >
                  {confirmBusyKey === 'bufferGuards' ? t('admin.testingDataTool.confirmingEllipsis') : t('admin.testingDataTool.confirmAllAsRealData')}
                </button>
              </div>
              {untaggedBuffer.map((b) => (
                <TestDataRow
                  key={b.id}
                  label={b.name}
                  sub={b.lastSiteName ? t('admin.testingDataTool.lastAtSite', { site: b.lastSiteName }) : t('admin.testingDataTool.neverAssigned')}
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
