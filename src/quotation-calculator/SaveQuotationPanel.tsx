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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      setSaveMsg({ kind: 'warn', text: t('quotationCalculator.saveQuotationPanel.errorCannotSave') });
      return;
    }
    const name = clientName.trim();
    if (!name) {
      setSaveMsg({ kind: 'warn', text: t('quotationCalculator.saveQuotationPanel.errorClientNameRequired') });
      return;
    }
    const existing = currentQuoteId ? savedQuotes.find((r) => r.id === currentQuoteId) : null;
    let isUpdate = false;
    if (existing) {
      isUpdate = window.confirm(
        t('quotationCalculator.saveQuotationPanel.confirmOverwrite', { client: existing.clientName, savedAt: fmtDateTime(existing.savedAt) })
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
      createdByName: profile?.name || t('quotationCalculator.saveQuotationPanel.unknown'),
      isTestData,
    };
    if (syncMode === 'live') {
      try {
        await setDoc(doc(db, COLLECTION, id), body);
        setCurrentQuoteId(id);
        setSaveMsg({
          kind: 'ok',
          text: isUpdate
            ? t('quotationCalculator.saveQuotationPanel.updatedSyncedFlash', { name, savedAt: fmtDateTime(body.savedAt) })
            : t('quotationCalculator.saveQuotationPanel.savedSyncedFlash', { name, savedAt: fmtDateTime(body.savedAt) }),
        });
      } catch (err) {
        setSaveMsg({ kind: 'warn', text: t('quotationCalculator.saveQuotationPanel.errorCouldNotSaveShared', { code: (err as { code?: string }).code || 'error' }) });
      }
    } else {
      const rec: Quotation = { id, ...body };
      const next = isUpdate ? savedQuotes.map((r) => (r.id === currentQuoteId ? rec : r)) : [...savedQuotes, rec];
      setSavedQuotes(next);
      setCurrentQuoteId(id);
      const ok = saveLocalQuotes(next);
      setSaveMsg(
        ok
          ? {
              kind: 'ok',
              text: isUpdate
                ? t('quotationCalculator.saveQuotationPanel.updatedLocalFlash', { name, savedAt: fmtDateTime(body.savedAt) })
                : t('quotationCalculator.saveQuotationPanel.savedLocalFlash', { name, savedAt: fmtDateTime(body.savedAt) }),
            }
          : { kind: 'warn', text: t('quotationCalculator.saveQuotationPanel.errorLocalStorageFailed') }
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
    setSaveMsg({ kind: 'ok', text: t('quotationCalculator.saveQuotationPanel.loadedFlash', { client: rec.clientName, savedAt: fmtDateTime(rec.savedAt) }) });
  }

  async function handleDelete(id: string) {
    const rec = savedQuotes.find((r) => r.id === id);
    if (!rec) return;
    if (!window.confirm(t('quotationCalculator.saveQuotationPanel.confirmDelete', { client: rec.clientName, savedAt: fmtDateTime(rec.savedAt) }))) return;
    if (syncMode === 'live') {
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        if (currentQuoteId === id) setCurrentQuoteId(null);
      } catch (err) {
        setSaveMsg({ kind: 'warn', text: t('quotationCalculator.saveQuotationPanel.errorCouldNotDeleteShared', { code: (err as { code?: string }).code || 'error' }) });
      }
    } else {
      const next = savedQuotes.filter((r) => r.id !== id);
      setSavedQuotes(next);
      saveLocalQuotes(next);
      if (currentQuoteId === id) setCurrentQuoteId(null);
    }
  }

  function handleNewQuotation() {
    if (!window.confirm(t('quotationCalculator.saveQuotationPanel.confirmNewQuotation')))
      return;
    setCurrentQuoteId(null);
    setClientName('');
    setSite('');
    setNotes('');
    calc.newQuotation();
    setSaveMsg({ kind: 'ok', text: t('quotationCalculator.saveQuotationPanel.startedNewFlash') });
  }

  function handleExport() {
    if (!savedQuotes.length) {
      setSaveMsg({ kind: 'warn', text: t('quotationCalculator.saveQuotationPanel.errorNoQuotationsToExport') });
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
    setSaveMsg({ kind: 'ok', text: t('quotationCalculator.saveQuotationPanel.exportedFlash', { count: savedQuotes.length }) });
  }

  async function handleImport(file: File) {
    if (!canUse) {
      setSaveMsg({ kind: 'warn', text: t('quotationCalculator.saveQuotationPanel.errorCannotImport') });
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const incoming: Quotation[] | null = Array.isArray(data) ? data : Array.isArray(data?.quotes) ? data.quotes : null;
      if (!incoming) throw new Error(t('quotationCalculator.saveQuotationPanel.errorNotABackupFile'));
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
              createdByName: profile?.name || t('quotationCalculator.saveQuotationPanel.unknown'),
              isTestData,
            })
          )
        );
        setSaveMsg({ kind: 'ok', text: t('quotationCalculator.saveQuotationPanel.importedSharedFlash', { count: toAdd.length }) });
      } else {
        const next = [...savedQuotes, ...toAdd];
        setSavedQuotes(next);
        saveLocalQuotes(next);
        setSaveMsg({ kind: 'ok', text: t('quotationCalculator.saveQuotationPanel.importedLocalFlash', { count: toAdd.length }) });
      }
    } catch (e) {
      setSaveMsg({ kind: 'warn', text: t('quotationCalculator.saveQuotationPanel.errorCouldNotReadBackup', { message: e instanceof Error ? e.message : String(e) }) });
    }
  }

  const syncText =
    syncMode === 'live'
      ? t('quotationCalculator.saveQuotationPanel.syncLive')
      : syncMode === 'denied'
        ? t('quotationCalculator.saveQuotationPanel.syncDenied')
        : syncMode === 'checking'
          ? t('quotationCalculator.saveQuotationPanel.syncChecking')
          : t('quotationCalculator.saveQuotationPanel.syncLocal');
  const syncDotClass =
    syncMode === 'live' ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,163,127,0.16)]' : syncMode === 'denied' ? 'bg-rose-500' : syncMode === 'checking' ? 'bg-slate-400' : 'bg-amber-500';

  return (
    <Card title={t('quotationCalculator.saveQuotationPanel.title')} id="saveCard">
      <Row label={t('quotationCalculator.saveQuotationPanel.syncStatus')}>
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <span className={`w-2 h-2 rounded-full ${syncDotClass}`} />
          {syncText}
        </span>
      </Row>
      <Row label={t('quotationCalculator.saveQuotationPanel.signedInAs')}>
        <span className="text-[12.5px] font-semibold text-slate-700">
          {profile ? `${profile.name || profile.email}${profile.department ? ` (${profile.department})` : ''}` : '—'}
        </span>
      </Row>
      <Row label={t('quotationCalculator.saveQuotationPanel.clientName')}>
        <TextField value={clientName} onChange={setClientName} width="w-56" placeholder={t('quotationCalculator.saveQuotationPanel.clientNamePlaceholder')} />
      </Row>
      <Row label={t('quotationCalculator.saveQuotationPanel.siteProject')}>
        <TextField value={site} onChange={setSite} width="w-56" placeholder={t('quotationCalculator.saveQuotationPanel.siteProjectPlaceholder')} />
      </Row>
      <Row label={t('quotationCalculator.saveQuotationPanel.notesOptional')}>
        <TextField value={notes} onChange={setNotes} width="w-56" placeholder={t('quotationCalculator.saveQuotationPanel.notesPlaceholder')} />
      </Row>
      <Row label={t('quotationCalculator.saveQuotationPanel.branch')}>
        {isPrivileged ? (
          <SelectField
            value={selectedBranch}
            onChange={setSelectedBranch}
            options={[{ value: '', label: t('quotationCalculator.saveQuotationPanel.unassignedAdminHqOnly') }, ...branchOptions.map((b) => ({ value: b.name, label: b.name }))]}
            width="w-44"
          />
        ) : (
          <span className="text-[13px] text-slate-500">{profile?.department || t('quotationCalculator.saveQuotationPanel.unassigned')}</span>
        )}
      </Row>
      <Row label={t('quotationCalculator.saveQuotationPanel.currentlyEditing')}>
        <span className="text-[13px] font-semibold text-blue-700 text-right">
          {editingRecord ? t('quotationCalculator.saveQuotationPanel.loadedLabel', { client: editingRecord.clientName, savedAt: fmtDateTime(editingRecord.savedAt) }) : t('quotationCalculator.saveQuotationPanel.newUnsaved')}
        </span>
      </Row>

      <div className="flex gap-2 flex-wrap mt-3">
        <Btn variant="primary" onClick={handleSave}>
          {t('quotationCalculator.saveQuotationPanel.saveQuotation')}
        </Btn>
        <Btn onClick={handleNewQuotation}>{t('quotationCalculator.saveQuotationPanel.newQuotation')}</Btn>
        <Btn onClick={handleExport}>{t('quotationCalculator.saveQuotationPanel.exportBackup')}</Btn>
        <label className="rounded-lg font-medium border text-[12.5px] px-3 py-1.5 text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer">
          {t('quotationCalculator.saveQuotationPanel.importBackup')}
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
        {t('quotationCalculator.saveQuotationPanel.note')}
      </Note>

      <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">{t('quotationCalculator.saveQuotationPanel.savedQuotationsLog')}</div>
      <Row label={t('quotationCalculator.saveQuotationPanel.searchByClientOrSite')}>
        <TextField value={logSearch} onChange={setLogSearch} width="w-56" placeholder={t('quotationCalculator.saveQuotationPanel.typeToFilter')} />
      </Row>

      {savedQuotes.length === 0 ? (
        <Note>{t('quotationCalculator.saveQuotationPanel.noQuotationsSavedYet')}</Note>
      ) : logSearch.trim() && filteredSorted.length === 0 ? (
        <Note>{t('quotationCalculator.saveQuotationPanel.noQuotationsMatch', { term: logSearch.trim() })}</Note>
      ) : (
        <Note>{logSearch.trim() ? t('quotationCalculator.saveQuotationPanel.showingFiltered', { shown: filteredSorted.length, total: savedQuotes.length, term: logSearch.trim() }) : t('quotationCalculator.saveQuotationPanel.showingAll', { total: savedQuotes.length })}</Note>
      )}

      {filteredSorted.length > 0 && (
        <div className="overflow-auto max-h-[340px] rounded-lg border border-slate-200 mt-2">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide sticky top-0">
                <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">{t('quotationCalculator.saveQuotationPanel.colDateTimeSaved')}</th>
                <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">{t('quotationCalculator.saveQuotationPanel.colClient')}</th>
                <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">{t('quotationCalculator.saveQuotationPanel.colSiteNotes')}</th>
                <th className="text-right font-semibold py-1.5 px-2 whitespace-nowrap">{t('quotationCalculator.saveQuotationPanel.colRate')}</th>
                <th className="text-right font-semibold py-1.5 px-2 whitespace-nowrap">{t('quotationCalculator.saveQuotationPanel.colGuards')}</th>
                <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">{t('quotationCalculator.saveQuotationPanel.colBranch')}</th>
                <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">{t('quotationCalculator.saveQuotationPanel.colCreatedBy')}</th>
                <th className="text-center font-semibold py-1.5 px-2 whitespace-nowrap">{t('quotationCalculator.saveQuotationPanel.colActions')}</th>
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
                          {t('quotationCalculator.saveQuotationPanel.load')}
                        </Btn>
                        <Btn small variant="danger" onClick={() => handleDelete(rec.id)}>
                          {t('quotationCalculator.saveQuotationPanel.delete')}
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
