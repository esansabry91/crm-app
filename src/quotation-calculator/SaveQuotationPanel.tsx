/**
 * Client details + Save/Load/Export/Import panel — index.html's "Quotation Details & Save" card
 * plus its Firestore sync layer (initSync/startLiveSync/saveQuotation/loadQuotation/
 * deleteQuotation/exportAllQuotes/importQuotesFile). The auth rehydration dance the vanilla
 * console needed (initSync() waiting on firebase.auth().onAuthStateChanged, then reading
 * /users/{uid} itself) is gone here — this page is a real route behind ProtectedRoute, so
 * useAuth() already has the signed-in profile by the time this renders, and the access check
 * (admin/branchManager/developer/ceo/director/tenderController) already happened at the route
 * level (see QuotationCalculatorPage.tsx / App.tsx), so there's no separate "access restricted"
 * state to reproduce here.
 *
 * Branch scoping mirrors firestore.rules' /quotations block exactly: a privileged caller (admin
 * or department "HQ") reaches every quotation; a Branch Manager's query is filtered server-side
 * to their own branch. See useActiveProjects.ts's seesAllBranches for the same isPrivileged
 * convention used elsewhere in this CRM.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useBranches } from '../hooks/useBranches';
import { isAdminRole } from '../types';
import { shouldStampTestData } from '../services/settings';
import type { QuotationCalculator } from './useQuotationCalculator';
import type { Quotation } from './types';
import { Btn, Card, Note, Ok, Row, SelectField, TextField, Warn } from './ui';
import { fmt, fmtDateTime } from './format';

const STORAGE_KEY = 'gdSecurityQuotes_v1';
const COLLECTION = 'quotations';

function loadLocalQuotes(): Quotation[] {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveLocalQuotes(arr: Quotation[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    return true;
  } catch {
    return false;
  }
}

export interface SaveQuotationPanelProps {
  calc: QuotationCalculator;
  clientName: string;
  setClientName: (v: string) => void;
  site: string;
  setSite: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  currentQuoteId: string | null;
  setCurrentQuoteId: (v: string | null) => void;
}

export default function SaveQuotationPanel({
  calc,
  clientName,
  setClientName,
  site,
  setSite,
  notes,
  setNotes,
  currentQuoteId,
  setCurrentQuoteId,
}: SaveQuotationPanelProps) {
  const { profile } = useAuth();
  const { branches } = useBranches();
  const isPrivileged = isAdminRole(profile?.role) || profile?.department === 'HQ';
  const canUse = isAdminRole(profile?.role) || profile?.role === 'branchManager';

  const [savedQuotes, setSavedQuotes] = useState<Quotation[]>([]);
  const [syncMode, setSyncMode] = useState<'checking' | 'live' | 'denied' | 'local'>('checking');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  useEffect(() => {
    setSyncMode('checking');
    const col = collection(db, COLLECTION);
    const q = isPrivileged ? query(col) : query(col, where('branch', '==', profile?.department || null));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSavedQuotes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Quotation, 'id'>) })));
        setSyncMode('live');
      },
      (err) => {
        if ((err as { code?: string }).code === 'permission-denied') {
          setSyncMode('denied');
        } else {
          setSyncMode('local');
        }
        setSavedQuotes(loadLocalQuotes());
      }
    );
    return unsub;
  }, [isPrivileged, profile?.department]);

  const branchOptions = useMemo(() => branches.filter((b) => b.name !== 'HQ'), [branches]);

  const editingRecord = currentQuoteId ? savedQuotes.find((r) => r.id === currentQuoteId) || null : null;

  const filteredSorted = useMemo(() => {
    const term = logSearch.trim().toLowerCase();
    const all = [...savedQuotes].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    if (!term) return all;
    return all.filter((rec) => `${rec.clientName || ''} ${rec.site || ''} ${rec.notes || ''}`.toLowerCase().includes(term));
  }, [savedQuotes, logSearch]);

  async function handleSave() {
    if (!canUse) {
      setSaveMsg({ kind: 'warn', text: 'Your account cannot save quotations.' });
      return;
    }
    const name = clientName.trim();
    if (!name) {
      setSaveMsg({ kind: 'warn', text: 'Please enter a Client Name before saving.' });
      return;
    }
    const existing = currentQuoteId ? savedQuotes.find((r) => r.id === currentQuoteId) : null;
    let isUpdate = false;
    if (existing) {
      isUpdate = window.confirm(
        `A quotation for "${existing.clientName}" saved ${fmtDateTime(existing.savedAt)} is currently loaded.\n\nOK = overwrite that saved record with the current figures\nCancel = save this as a brand new record`
      );
    }
    const id = isUpdate && currentQuoteId ? currentQuoteId : `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const branch = isPrivileged ? selectedBranch || null : profile?.department || null;
    const isTestData = await shouldStampTestData(profile?.role);
    const body: Omit<Quotation, 'id'> = {
      clientName: name,
      site: site.trim(),
      notes: notes.trim(),
      savedAt: new Date().toISOString(),
      quotedRate: calc.result.quote,
      guardsUsed: calc.result.guards,
      state: calc.collectState(),
      branch,
      createdByUid: profile?.uid || null,
      createdByName: profile?.name || 'Unknown',
      isTestData,
    };
    if (syncMode === 'live') {
      try {
        await setDoc(doc(db, COLLECTION, id), body);
        setCurrentQuoteId(id);
        setSaveMsg({ kind: 'ok', text: `${isUpdate ? 'Updated' : 'Saved'} quotation for "${name}" at ${fmtDateTime(body.savedAt)} — synced to your team.` });
      } catch (err) {
        setSaveMsg({ kind: 'warn', text: `Could not save to the shared team store (${(err as { code?: string }).code || 'error'}). Nothing was saved - try again.` });
      }
    } else {
      const rec: Quotation = { id, ...body };
      const next = isUpdate ? savedQuotes.map((r) => (r.id === currentQuoteId ? rec : r)) : [...savedQuotes, rec];
      setSavedQuotes(next);
      setCurrentQuoteId(id);
      const ok = saveLocalQuotes(next);
      setSaveMsg(
        ok
          ? { kind: 'ok', text: `${isUpdate ? 'Updated' : 'Saved'} quotation for "${name}" at ${fmtDateTime(body.savedAt)} (saved to this browser only).` }
          : { kind: 'warn', text: 'This browser could not store the save (storage may be full, disabled, or this is a private-browsing window). Use Export Backup to keep this quotation as a file.' }
      );
    }
  }

  function handleLoad(id: string) {
    const rec = savedQuotes.find((r) => r.id === id);
    if (!rec) return;
    setClientName(rec.clientName || '');
    setSite(rec.site || '');
    setNotes(rec.notes || '');
    calc.applyState(rec.state);
    setCurrentQuoteId(rec.id);
    setSaveMsg({ kind: 'ok', text: `Loaded quotation for "${rec.clientName}" saved ${fmtDateTime(rec.savedAt)}.` });
  }

  async function handleDelete(id: string) {
    const rec = savedQuotes.find((r) => r.id === id);
    if (!rec) return;
    if (!window.confirm(`Delete the saved quotation for "${rec.clientName}" (saved ${fmtDateTime(rec.savedAt)})? This cannot be undone.`)) return;
    if (syncMode === 'live') {
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        if (currentQuoteId === id) setCurrentQuoteId(null);
      } catch (err) {
        setSaveMsg({ kind: 'warn', text: `Could not delete from the shared team store (${(err as { code?: string }).code || 'error'}).` });
      }
    } else {
      const next = savedQuotes.filter((r) => r.id !== id);
      setSavedQuotes(next);
      saveLocalQuotes(next);
      if (currentQuoteId === id) setCurrentQuoteId(null);
    }
  }

  function handleNewQuotation() {
    if (!window.confirm('Start a new blank quotation? Client Name, Site and Notes will be cleared and all figures reset to the calculator defaults. This does not delete anything already saved.'))
      return;
    setCurrentQuoteId(null);
    setClientName('');
    setSite('');
    setNotes('');
    calc.newQuotation();
    setSaveMsg({ kind: 'ok', text: 'Started a new blank quotation.' });
  }

  function handleExport() {
    if (!savedQuotes.length) {
      setSaveMsg({ kind: 'warn', text: 'No saved quotations to export yet.' });
      return;
    }
    const payload = { exportedAt: new Date().toISOString(), source: 'Guard Quotation Calculator', quotes: savedQuotes };
    const text = JSON.stringify(payload, null, 2);
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quotation-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaveMsg({ kind: 'ok', text: `Exported ${savedQuotes.length} saved quotation(s) to a backup file.` });
  }

  async function handleImport(file: File) {
    if (!canUse) {
      setSaveMsg({ kind: 'warn', text: 'Your account cannot import quotations.' });
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const incoming: Quotation[] | null = Array.isArray(data) ? data : Array.isArray(data?.quotes) ? data.quotes : null;
      if (!incoming) throw new Error('File does not contain a recognised quotations backup.');
      const existingIds = new Set(savedQuotes.map((r) => r.id));
      const toAdd: Quotation[] = [];
      incoming.forEach((q, j) => {
        if (!q || !q.state) return;
        let id = q.id;
        if (!id || existingIds.has(id)) id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${j}`;
        existingIds.add(id);
        toAdd.push({
          id,
          clientName: q.clientName || '(no name)',
          site: q.site || '',
          notes: q.notes || '',
          savedAt: q.savedAt || new Date().toISOString(),
          quotedRate: q.quotedRate,
          guardsUsed: q.guardsUsed,
          state: q.state,
          branch: null,
          createdByUid: null,
          createdByName: '',
        });
      });
      if (syncMode === 'live') {
        const importBranch = isPrivileged ? selectedBranch || null : profile?.department || null;
        const isTestData = await shouldStampTestData(profile?.role);
        await Promise.all(
          toAdd.map((rec) =>
            setDoc(doc(db, COLLECTION, rec.id), {
              clientName: rec.clientName,
              site: rec.site,
              notes: rec.notes,
              savedAt: rec.savedAt,
              quotedRate: rec.quotedRate,
              guardsUsed: rec.guardsUsed,
              state: rec.state,
              branch: importBranch,
              createdByUid: profile?.uid || null,
              createdByName: profile?.name || 'Unknown',
              isTestData,
            })
          )
        );
        setSaveMsg({ kind: 'ok', text: `Imported ${toAdd.length} quotation(s) into the shared team store.` });
      } else {
        const next = [...savedQuotes, ...toAdd];
        setSavedQuotes(next);
        saveLocalQuotes(next);
        setSaveMsg({ kind: 'ok', text: `Imported ${toAdd.length} quotation(s) (saved to this browser only).` });
      }
    } catch (e) {
      setSaveMsg({ kind: 'warn', text: `Could not read that backup file: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const syncDotClass =
    syncMode === 'live' ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,163,127,0.16)]' : syncMode === 'denied' ? 'bg-rose-500' : syncMode === 'checking' ? 'bg-slate-400' : 'bg-amber-500';
  const syncText =
    syncMode === 'live'
      ? 'Live — synced with your team'
      : syncMode === 'denied'
        ? 'Signed in — no access to saved quotations'
        : syncMode === 'checking'
          ? 'Checking sync…'
          : 'Not connected — local storage only';

  return (
    <Card title="Quotation Details &amp; Save" id="saveCard">
      <Row label="Sync status">
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <span className={`w-2 h-2 rounded-full ${syncDotClass}`} />
          {syncText}
        </span>
      </Row>
      <Row label="Signed in as">
        <span className="text-[12.5px] font-semibold text-slate-700">
          {profile ? `${profile.name || profile.email}${profile.department ? ` (${profile.department})` : ''}` : '—'}
        </span>
      </Row>
      <Row label="Client Name">
        <TextField value={clientName} onChange={setClientName} width="w-56" placeholder="e.g. ABC Sdn Bhd" />
      </Row>
      <Row label="Site / Project (optional)">
        <TextField value={site} onChange={setSite} width="w-56" placeholder="e.g. Menara ABC, KL" />
      </Row>
      <Row label="Notes (optional)">
        <TextField value={notes} onChange={setNotes} width="w-56" placeholder="e.g. Revision 2 - added night posts" />
      </Row>
      <Row label="Branch">
        {isPrivileged ? (
          <SelectField
            value={selectedBranch}
            onChange={setSelectedBranch}
            options={[{ value: '', label: 'Unassigned (Admin/HQ only)' }, ...branchOptions.map((b) => ({ value: b.name, label: b.name }))]}
            width="w-44"
          />
        ) : (
          <span className="text-[13px] text-slate-500">{profile?.department || 'Unassigned'}</span>
        )}
      </Row>
      <Row label="Currently editing">
        <span className="text-[13px] font-semibold text-blue-700 text-right">
          {editingRecord ? `Loaded: ${editingRecord.clientName} (saved ${fmtDateTime(editingRecord.savedAt)})` : 'New, unsaved quotation'}
        </span>
      </Row>

      <div className="flex gap-2 flex-wrap mt-3">
        <Btn variant="primary" onClick={handleSave}>
          Save Quotation
        </Btn>
        <Btn onClick={handleNewQuotation}>New Quotation</Btn>
        <Btn onClick={handleExport}>Export Backup (.json)</Btn>
        <label className="rounded-lg font-medium border text-[12.5px] px-3 py-1.5 text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer">
          Import Backup (.json)
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {saveMsg && (saveMsg.kind === 'ok' ? <Ok>{saveMsg.text}</Ok> : <Warn>{saveMsg.text}</Warn>)}

      <Note>
        Save stores every figure on this page - all inputs, guard posts, grades, misc items and fees - together with the Client Name, the date and time saved, who saved it and which branch it
        belongs to. This syncs automatically with your CRM team, the same way Duty Roster does - once Sync status reads Live, every save, load and delete is shared instantly with everyone who can
        see this branch. Admin and HQ see every saved quotation from every branch; a Branch Manager sees and saves only their own branch&apos;s. If sync is briefly unavailable, saves stay local to
        this browser - use Export Backup to keep a portable copy, and Import Backup to bring a backup file back in.
      </Note>

      <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">Saved Quotations Log</div>
      <Row label="Search by client or site/project">
        <TextField value={logSearch} onChange={setLogSearch} width="w-56" placeholder="Type to filter..." />
      </Row>

      {savedQuotes.length === 0 ? (
        <Note>No quotations saved yet in this browser.</Note>
      ) : logSearch.trim() && filteredSorted.length === 0 ? (
        <Note>No saved quotations match &quot;{logSearch.trim()}&quot;.</Note>
      ) : (
        <Note>{logSearch.trim() ? `Showing ${filteredSorted.length} of ${savedQuotes.length} saved quotation(s) matching "${logSearch.trim()}".` : `Showing all ${savedQuotes.length} saved quotation(s).`}</Note>
      )}

      {filteredSorted.length > 0 && (
        <div className="overflow-auto max-h-[340px] rounded-lg border border-slate-200 mt-2">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide sticky top-0">
                <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">Date &amp; time saved</th>
                <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">Client</th>
                <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">Site / Notes</th>
                <th className="text-right font-semibold py-1.5 px-2 whitespace-nowrap">Rate (RM/hr)</th>
                <th className="text-right font-semibold py-1.5 px-2 whitespace-nowrap">Guards</th>
                <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">Branch</th>
                <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">Created by</th>
                <th className="text-center font-semibold py-1.5 px-2 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((rec) => {
                const siteNotes = [rec.site, rec.notes].filter(Boolean).join(' - ');
                return (
                  <tr key={rec.id} className={'border-t border-slate-100 ' + (rec.id === currentQuoteId ? 'bg-emerald-50' : '')}>
                    <td className="py-1.5 px-2 whitespace-nowrap">{fmtDateTime(rec.savedAt)}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{rec.clientName || '-'}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{siteNotes || '-'}</td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">{fmt(rec.quotedRate, 2)}</td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">{fmt(rec.guardsUsed, 0)}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{rec.branch || '—'}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{rec.createdByName || '—'}</td>
                    <td className="py-1.5 px-2">
                      <div className="flex gap-1 justify-center">
                        <Btn small onClick={() => handleLoad(rec.id)}>
                          Load
                        </Btn>
                        <Btn small variant="danger" onClick={() => handleDelete(rec.id)}>
                          Delete
                        </Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
