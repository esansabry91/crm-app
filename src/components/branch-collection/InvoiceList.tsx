import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  subscribeInvoices,
  updateInvoiceStatus,
  deriveInvoiceStatus,
  clampAmountPaid,
  voidInvoice,
  updateInvoiceContent,
  computeLineAmount,
  computeManHourLineAmount,
  sumLineGroups,
  sumEquipmentRows,
  roundMoney,
  type InvoiceEditInput,
} from '../../services/invoices';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { useAuth } from '../../contexts/AuthContext';
import InvoicePrintView from './InvoicePrintView';
import StatCard from '../analytics/StatCard';
import { isAdminRole } from '../../types';
import type { Invoice, InvoiceBillingMode, InvoiceEquipmentRow, InvoiceLineGroup, InvoiceStatus } from '../../types';

// InvoiceStatus itself ('unpaid'/'partial'/'paid'/'void') stays the stored/data-model value —
// only the on-screen label is translated, via statusLabel()/branchCollection.status.*.
function statusLabel(status: InvoiceStatus, t: TFunction): string {
  return t(`branchCollection.status.${status}`);
}
const STATUS_COLOR: Record<InvoiceStatus, string> = {
  unpaid: 'bg-rose-50 text-rose-700',
  partial: 'bg-amber-50 text-amber-700',
  paid: 'bg-emerald-50 text-emerald-700',
  void: 'bg-slate-200 text-slate-600',
};
const STATUS_ACCENT: Record<InvoiceStatus, string> = {
  unpaid: '#be123c',
  partial: '#b45309',
  paid: '#047857',
  void: '#475569',
};

/** Admin/Developer or a Branch Manager — the same set that can create an invoice in the first
 *  place (see the /invoices create rule in firestore.rules) — is who's trusted to void one or
 *  make a limited content edit. Finance can still record payments (the Status action below)
 *  but never these two, both client-side here and enforced server-side via
 *  financeUpdateOnlyTouches() in firestore.rules. */
function canManageInvoices(role: string | undefined | null): boolean {
  return isAdminRole(role) || role === 'branchManager';
}

function formatShortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatShortDateFromTs(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The most recent payment recorded against this invoice, for the "Last paid" line — reads
 *  paymentLog when present (see InvoicePayment's doc comment in types.ts), and falls back to the
 *  plain amountPaid/paidDate fields for invoices saved before that log existed. */
function lastPayment(inv: Invoice): { amount: number; date: string } | null {
  if (inv.paymentLog && inv.paymentLog.length > 0) {
    const entry = inv.paymentLog[inv.paymentLog.length - 1];
    return { amount: entry.amount, date: entry.date };
  }
  if (inv.amountPaid > 0) {
    return { amount: inv.amountPaid, date: inv.paidDate || '' };
  }
  return null;
}

/**
 * Records ONE new installment against an invoice, rather than exposing the invoice's running
 * `amountPaid` total for direct editing. That older design pre-filled the amount field with the
 * current cumulative total and left it up to the person to remember to type the NEW cumulative
 * figure — on a second or later payment they'd naturally type just the amount being paid *right
 * now* instead, silently overwriting (rather than adding to) what was already recorded and
 * corrupting the balance. Here the field is always "how much is being paid now" (defaults empty,
 * capped at the remaining balance), the new cumulative total is computed for the caller, and
 * every past installment is listed above it (from `paymentLog` — see InvoicePayment's doc
 * comment in types.ts) so the running total is always visibly the sum of real, individual lines
 * rather than a figure that has to be trusted blind.
 */
function StatusEditor({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const balance = roundMoney(Math.max(0, invoice.total - invoice.amountPaid));
  const [addAmount, setAddAmount] = useState(0);
  const [paidDate, setPaidDate] = useState(invoice.paidDate || '');
  const [busy, setBusy] = useState(false);

  const clampedAdd = Math.max(0, Math.min(addAmount, balance));
  // The invoice's new running total — never typed in directly, always derived as
  // "what was already paid" + "this installment" so the two can never drift apart.
  const newAmountPaid = clampAmountPaid(invoice.amountPaid + clampedAdd, invoice.total);
  const previewStatus = deriveInvoiceStatus(newAmountPaid, invoice.total);
  // Legacy invoices recorded before paymentLog existed have no individual lines to show —
  // fall back to one synthetic line from the plain amountPaid/paidDate fields (same fallback
  // lastPayment() above uses) so the history never looks empty when money has, in fact, been paid.
  const history: { amount: number; date: string; recordedByName?: string }[] | null =
    invoice.paymentLog && invoice.paymentLog.length > 0
      ? invoice.paymentLog
      : invoice.amountPaid > 0
        ? [{ amount: invoice.amountPaid, date: invoice.paidDate || '', recordedByName: undefined }]
        : null;

  async function save() {
    if (!profile || clampedAdd <= 0) return;
    setBusy(true);
    try {
      await updateInvoiceStatus(
        invoice.id,
        { amountPaid: newAmountPaid, total: invoice.total, paidDate: paidDate || undefined, previousAmountPaid: invoice.amountPaid },
        { uid: profile.uid, name: profile.name }
      );
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-100 pt-3 mt-3">
      {history && (
        <div className="mb-2.5 space-y-0.5">
          <p className="text-xs font-medium text-slate-500">{t('branchCollection.statusEditor.paymentHistory')}</p>
          {history.map((p, i) => (
            <p key={i} className="text-xs text-slate-500">
              {t('branchCollection.statusEditor.paymentAmount', { amount: p.amount.toFixed(2) })}
              {p.date && ' ' + t('branchCollection.statusEditor.onDate', { date: formatShortDate(p.date) })}
              {p.recordedByName && ' — ' + t('branchCollection.statusEditor.recordedBy', { name: p.recordedByName })}
            </p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-2.5 py-1.5 text-xs font-medium rounded-lg ${STATUS_COLOR[previewStatus]}`}>
          {statusLabel(previewStatus, t)}
        </span>
        {balance <= 0 ? (
          <span className="text-xs text-slate-400">{t('branchCollection.statusEditor.fullyPaid')}</span>
        ) : (
          <div>
            <label className="text-xs text-slate-500 block">
              {t('branchCollection.statusEditor.addPaymentLabel', { balance: balance.toFixed(2) })}
            </label>
            <input
              type="number"
              value={addAmount === 0 ? '' : addAmount}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const raw = e.target.value.replace(/^0+(?=\d)/, '');
                const parsed = raw === '' ? 0 : Number(raw) || 0;
                setAddAmount(Math.max(0, Math.min(parsed, balance)));
              }}
              max={balance}
              className="input w-32"
              placeholder="0.00"
            />
          </div>
        )}
        <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="input" />
        {balance > 0 && (
          <button
            onClick={save}
            disabled={busy || clampedAdd <= 0}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
          >
            {busy ? t('branchCollection.common.savingEllipsis') : t('branchCollection.statusEditor.addPayment')}
          </button>
        )}
        <button onClick={onClose} className="text-xs text-slate-500 hover:underline">
          {t('branchCollection.common.cancel')}
        </button>
      </div>
      {clampedAdd > 0 && (
        <p className="text-xs text-slate-400 mt-1">
          {t('branchCollection.statusEditor.newBalanceAfter', { balance: (balance - clampedAdd).toFixed(2) })}
        </p>
      )}
    </div>
  );
}

/** Cancels a wrongly-generated invoice — see voidInvoice()'s doc comment in services/invoices.ts.
 *  Requires a reason so the audit trail (shown on the row afterwards, and on the printed invoice
 *  itself — see InvoicePrintView's void banner) always says why. */
function VoidPrompt({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirmVoid() {
    if (!profile) return;
    if (!reason.trim()) {
      setError(t('branchCollection.voidPrompt.errorReasonRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await voidInvoice(invoice.id, reason, { uid: profile.uid, name: profile.name });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('branchCollection.voidPrompt.errorFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-rose-100 pt-3 mt-3">
      <p className="text-xs font-medium text-rose-700 mb-1.5">
        {t('branchCollection.voidPrompt.warning', { invoiceNo: invoice.invoiceNo })}
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('branchCollection.voidPrompt.reasonPlaceholder')}
        rows={2}
        className="input w-full text-sm"
      />
      {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={confirmVoid}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg"
        >
          {busy ? t('branchCollection.voidPrompt.voidingEllipsis') : t('branchCollection.voidPrompt.confirmVoid')}
        </button>
        <button onClick={onClose} className="text-xs text-slate-500 hover:underline">
          {t('branchCollection.common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** Limited correction of an already-saved invoice's content — client details, references, dates
 *  and the line items themselves (see InvoiceEditInput's doc comment in services/invoices.ts for
 *  exactly what's excluded and why: invoiceNo, brand/site/tender linkage, and billing month all
 *  stay fixed). Only ever shown for a still-'unpaid' invoice — see the Edit button's gating below
 *  — so there's never a recorded payment whose amount this could retroactively invalidate. */
function ContentEditor({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const [clientName, setClientName] = useState(invoice.clientName);
  const [clientAddress, setClientAddress] = useState(invoice.clientAddress || '');
  const [attnName, setAttnName] = useState(invoice.attnName || '');
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate);
  const [contractRef, setContractRef] = useState(invoice.contractRef || '');
  const [quotationNo, setQuotationNo] = useState(invoice.quotationNo || '');
  const [paymentTermsDays, setPaymentTermsDays] = useState(invoice.paymentTermsDays);
  const [sstRate, setSstRate] = useState(invoice.sstRate);
  const [lineGroups, setLineGroups] = useState<InvoiceLineGroup[]>(() =>
    invoice.lineGroups.map((g) => ({ location: g.location, rows: g.rows.map((r) => ({ ...r })) }))
  );
  // This invoice's primary-site billing mode — see InvoiceBillingMode's doc comment in
  // types.ts. Loaded from the saved invoice; absent there means it predates this feature and is
  // treated as 'headcount', the original behavior.
  const [billingMode, setBillingMode] = useState<InvoiceBillingMode>(invoice.billingMode || 'headcount');
  // Equipment/add-on rows (e-bikes, drones, etc.) — see InvoiceEquipmentRow's doc comment in
  // types.ts. Absent on an invoice saved before this feature existed.
  const [equipmentRows, setEquipmentRows] = useState<InvoiceEquipmentRow[]>(() =>
    (invoice.equipmentRows || []).map((r) => ({ ...r }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function addLineGroup() {
    setLineGroups((prev) => [...prev, { location: '', rows: [] }]);
  }
  function removeLineGroup(gi: number) {
    setLineGroups((prev) => prev.filter((_, i) => i !== gi));
  }
  function updateLineGroup(gi: number, location: string) {
    setLineGroups((prev) => prev.map((g, i) => (i === gi ? { ...g, location } : g)));
  }
  function addRow(gi: number) {
    setLineGroups((prev) =>
      prev.map((g, i) =>
        i === gi ? { ...g, rows: [...g.rows, { category: '', headcount: 0, days: 0, manHours: 0, rate: 0, amount: 0 }] } : g
      )
    );
  }
  function removeRow(gi: number, ri: number) {
    setLineGroups((prev) => prev.map((g, i) => (i === gi ? { ...g, rows: g.rows.filter((_, j) => j !== ri) } : g)));
  }
  function updateRow(gi: number, ri: number, patch: Partial<{ category: string; headcount: number; days: number; manHours: number; rate: number }>) {
    setLineGroups((prev) =>
      prev.map((g, i) => {
        if (i !== gi) return g;
        return {
          ...g,
          rows: g.rows.map((r, j) => {
            if (j !== ri) return r;
            const next = { ...r, ...patch };
            next.amount =
              billingMode === 'manhour'
                ? computeManHourLineAmount(next.manHours || 0, next.rate)
                : computeLineAmount(next.headcount, next.days, next.rate);
            return next;
          }),
        };
      })
    );
  }

  /** Switches this invoice's billing mode AND immediately recomputes every row's amount under
   *  the new formula — same as InvoiceGenerator/InvoiceSiteSection's own handleBillingModeChange. */
  function handleBillingModeChange(mode: InvoiceBillingMode) {
    setBillingMode(mode);
    setLineGroups((prev) =>
      prev.map((g) => ({
        ...g,
        rows: g.rows.map((r) => ({
          ...r,
          amount:
            mode === 'manhour'
              ? computeManHourLineAmount(r.manHours || 0, r.rate)
              : computeLineAmount(r.headcount, r.days, r.rate),
        })),
      }))
    );
  }

  function addEquipmentRow() {
    setEquipmentRows((prev) => [...prev, { item: '', quantity: 0, monthlyRate: 0, amount: 0 }]);
  }
  function removeEquipmentRow(i: number) {
    setEquipmentRows((prev) => prev.filter((_, j) => j !== i));
  }
  function updateEquipmentRow(i: number, patch: Partial<{ item: string; quantity: number; monthlyRate: number }>) {
    setEquipmentRows((prev) =>
      prev.map((row, j) => {
        if (j !== i) return row;
        const next = { ...row, ...patch };
        next.amount = (next.quantity || 0) * (next.monthlyRate || 0);
        return next;
      })
    );
  }

  const subTotal = roundMoney(sumLineGroups(lineGroups) + sumEquipmentRows(equipmentRows));
  const sstAmount = roundMoney(subTotal * sstRate);
  const total = roundMoney(subTotal + sstAmount);
  const canSave =
    !!clientName.trim() && !!invoiceDate
    && (lineGroups.length > 0 || equipmentRows.length > 0)
    && lineGroups.every((g) => g.location.trim());

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const input: InvoiceEditInput = {
        clientName,
        clientAddress,
        attnName,
        invoiceDate,
        contractRef,
        quotationNo,
        paymentTermsDays,
        sstRate,
        billingMode,
        lineGroups,
        equipmentRows,
      };
      await updateInvoiceContent(invoice.id, input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('branchCollection.contentEditor.errorFailedSave'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-slate-200 pt-3 mt-3 space-y-3">
      <p className="text-xs text-slate-500">{t('branchCollection.contentEditor.correctingNotice', { invoiceNo: invoice.invoiceNo })}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder={t('branchCollection.contentEditor.clientNamePlaceholder')} className="input" />
        <input value={attnName} onChange={(e) => setAttnName(e.target.value)} placeholder={t('branchCollection.contentEditor.attnPlaceholder')} className="input" />
        <input
          value={clientAddress}
          onChange={(e) => setClientAddress(e.target.value)}
          placeholder={t('branchCollection.contentEditor.clientAddressPlaceholder')}
          className="input sm:col-span-2"
        />
        <div>
          <label className="text-xs text-slate-500">{t('branchCollection.contentEditor.invoiceDateLabel')}</label>
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input w-full" />
        </div>
        <div>
          <label className="text-xs text-slate-500">{t('branchCollection.contentEditor.contractRefLabel')}</label>
          <input value={contractRef} onChange={(e) => setContractRef(e.target.value)} placeholder={t('branchCollection.contentEditor.contractRefPlaceholder')} className="input w-full" />
        </div>
        <input value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} placeholder={t('branchCollection.contentEditor.quotationNoPlaceholder')} className="input" />
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-500 whitespace-nowrap">{t('branchCollection.contentEditor.paymentTermsLabel')}</label>
          <input
            type="number"
            value={paymentTermsDays === 0 ? '' : paymentTermsDays}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setPaymentTermsDays(Number(e.target.value) || 0)}
            className="input w-20"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-500 whitespace-nowrap">{t('branchCollection.contentEditor.sstRateLabel')}</label>
          <input
            type="number"
            step="0.01"
            value={sstRate}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setSstRate(Number(e.target.value) || 0)}
            className="input w-20"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-slate-600">{t('branchCollection.contentEditor.lineItems')}</p>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-slate-200 p-0.5">
              <button
                type="button"
                onClick={() => handleBillingModeChange('headcount')}
                className={`text-xs font-medium rounded px-2 py-1 ${
                  billingMode === 'headcount' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {t('branchCollection.contentEditor.headcountAndDays')}
              </button>
              <button
                type="button"
                onClick={() => handleBillingModeChange('manhour')}
                className={`text-xs font-medium rounded px-2 py-1 ${
                  billingMode === 'manhour' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {t('branchCollection.contentEditor.manHour')}
              </button>
            </div>
            <button onClick={addLineGroup} className="text-xs font-medium text-blue-700 hover:underline">
              {t('branchCollection.contentEditor.addLocation')}
            </button>
          </div>
        </div>
        {lineGroups.map((group, gi) => (
          <div key={gi} className="border border-slate-200 rounded-lg p-2.5 mb-2">
            <div className="flex items-center gap-2 mb-1.5">
              <input
                value={group.location}
                onChange={(e) => updateLineGroup(gi, e.target.value)}
                placeholder={t('branchCollection.contentEditor.locationPlaceholder')}
                className="input flex-1 font-medium"
              />
              <button onClick={() => removeLineGroup(gi)} className="text-xs text-rose-500 hover:text-rose-700 shrink-0">
                {t('branchCollection.contentEditor.removeLocation')}
              </button>
            </div>
            <table className="w-full text-sm mb-1.5">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="font-medium pb-1">{t('branchCollection.contentEditor.colCategory')}</th>
                  {billingMode === 'manhour' ? (
                    <>
                      <th className="font-medium pb-1 w-24">{t('branchCollection.contentEditor.colManHours')}</th>
                      <th className="font-medium pb-1 w-20">{t('branchCollection.contentEditor.colHeadcount')}</th>
                    </>
                  ) : (
                    <>
                      <th className="font-medium pb-1 w-20">{t('branchCollection.contentEditor.colHeadcount')}</th>
                      <th className="font-medium pb-1 w-20">{t('branchCollection.contentEditor.colDays')}</th>
                    </>
                  )}
                  <th className="font-medium pb-1 w-24">{t('branchCollection.contentEditor.colRate')}</th>
                  <th className="font-medium pb-1 w-24 text-right">{t('branchCollection.contentEditor.colAmount')}</th>
                  <th className="w-14" />
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row, ri) => (
                  <tr key={ri}>
                    <td className="pr-2 py-1">
                      <input
                        value={row.category}
                        onChange={(e) => updateRow(gi, ri, { category: e.target.value })}
                        className="input w-full"
                      />
                    </td>
                    {billingMode === 'manhour' ? (
                      <>
                        <td className="pr-2 py-1">
                          <input
                            type="number"
                            step="0.5"
                            value={row.manHours === 0 || row.manHours == null ? '' : row.manHours}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateRow(gi, ri, { manHours: Number(e.target.value) || 0 })}
                            className="input w-full"
                          />
                        </td>
                        <td className="pr-2 py-1">
                          <input
                            type="number"
                            value={row.headcount === 0 ? '' : row.headcount}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateRow(gi, ri, { headcount: Number(e.target.value) || 0 })}
                            className="input w-full"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="pr-2 py-1">
                          <input
                            type="number"
                            value={row.headcount === 0 ? '' : row.headcount}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateRow(gi, ri, { headcount: Number(e.target.value) || 0 })}
                            className="input w-full"
                          />
                        </td>
                        <td className="pr-2 py-1">
                          <input
                            type="number"
                            step="0.5"
                            value={row.days === 0 ? '' : row.days}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateRow(gi, ri, { days: Number(e.target.value) || 0 })}
                            className="input w-full"
                          />
                        </td>
                      </>
                    )}
                    <td className="pr-2 py-1">
                      <input
                        type="number"
                        step="0.01"
                        value={row.rate === 0 ? '' : row.rate}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => updateRow(gi, ri, { rate: Number(e.target.value) || 0 })}
                        className="input w-full"
                      />
                    </td>
                    <td className="text-right py-1 pr-2">{row.amount.toFixed(2)}</td>
                    <td className="py-1">
                      <button onClick={() => removeRow(gi, ri)} className="text-xs text-rose-500 hover:text-rose-700">
                        {t('branchCollection.common.remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => addRow(gi)} className="text-xs font-medium text-blue-700 hover:underline">
              {t('branchCollection.contentEditor.addRow')}
            </button>
          </div>
        ))}
        {lineGroups.length === 0 && <p className="text-xs text-slate-400">{t('branchCollection.contentEditor.noLocations')}</p>}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-slate-600">{t('branchCollection.contentEditor.equipmentAddons')}</p>
          <button onClick={addEquipmentRow} className="text-xs font-medium text-blue-700 hover:underline">
            {t('branchCollection.contentEditor.addEquipment')}
          </button>
        </div>
        {equipmentRows.length > 0 && (
          <table className="w-full text-sm mb-1.5">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="font-medium pb-1">{t('branchCollection.contentEditor.colItem')}</th>
                <th className="font-medium pb-1 w-20">{t('branchCollection.contentEditor.colQuantity')}</th>
                <th className="font-medium pb-1 w-24">{t('branchCollection.contentEditor.colRatePerMonth')}</th>
                <th className="font-medium pb-1 w-24 text-right">{t('branchCollection.contentEditor.colAmount')}</th>
                <th className="w-14" />
              </tr>
            </thead>
            <tbody>
              {equipmentRows.map((row, i) => (
                <tr key={i}>
                  <td className="pr-2 py-1">
                    <input
                      value={row.item}
                      onChange={(e) => updateEquipmentRow(i, { item: e.target.value })}
                      className="input w-full"
                    />
                  </td>
                  <td className="pr-2 py-1">
                    <input
                      type="number"
                      value={row.quantity === 0 ? '' : row.quantity}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => updateEquipmentRow(i, { quantity: Number(e.target.value) || 0 })}
                      className="input w-full"
                    />
                  </td>
                  <td className="pr-2 py-1">
                    <input
                      type="number"
                      step="0.01"
                      value={row.monthlyRate === 0 ? '' : row.monthlyRate}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => updateEquipmentRow(i, { monthlyRate: Number(e.target.value) || 0 })}
                      className="input w-full"
                    />
                  </td>
                  <td className="text-right py-1 pr-2">{row.amount.toFixed(2)}</td>
                  <td className="py-1">
                    <button onClick={() => removeEquipmentRow(i)} className="text-xs text-rose-500 hover:text-rose-700">
                      {t('branchCollection.common.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {equipmentRows.length === 0 && <p className="text-xs text-slate-400">{t('branchCollection.contentEditor.noEquipment')}</p>}
      </div>

      <div className="flex justify-end text-sm">
        <table>
          <tbody>
            <tr>
              <td className="pr-3 text-slate-500">{t('branchCollection.contentEditor.subTotal')}</td>
              <td className="text-right font-medium">RM {subTotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td className="pr-3 text-slate-500">{t('branchCollection.contentEditor.sst')}</td>
              <td className="text-right font-medium">RM {sstAmount.toFixed(2)}</td>
            </tr>
            <tr>
              <td className="pr-3 text-slate-600 font-semibold">{t('branchCollection.contentEditor.total')}</td>
              <td className="text-right font-semibold">RM {total.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving || !canSave}
          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
        >
          {saving ? t('branchCollection.common.savingEllipsis') : t('branchCollection.contentEditor.saveChanges')}
        </button>
        <button onClick={onClose} className="text-xs text-slate-500 hover:underline">
          {t('branchCollection.common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** Lists every generated invoice, lets you view/print one (reusing InvoicePrintView), update its
 *  payment status, and — for Admin/Developer/Branch Manager only — void a wrongly-generated one
 *  or make a limited content correction (see canManageInvoices above). Invoices themselves are
 *  created from InvoiceGenerator — this component never creates one. */
export default function InvoiceList() {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const { brands } = useBrands();
  const { branches } = useBranches();
  const { profile } = useAuth();
  const canFilterByBranch = isAdminRole(profile?.role);
  const canManage = canManageInvoices(profile?.role);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<{ id: string; panel: 'status' | 'void' | 'edit' } | null>(null);
  const [brandFilter, setBrandFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>('');

  useEffect(() => subscribeInvoices(setInvoices), []);

  function togglePanel(id: string, panel: 'status' | 'void' | 'edit') {
    setActiveRow((prev) => (prev && prev.id === id && prev.panel === panel ? null : { id, panel }));
  }

  const effectiveBranchFilter = canFilterByBranch ? branchFilter : '';

  // Brand/branch-scoped, but NOT status-scoped — this is what the stat tiles' counts are built
  // from, since the tiles are what pick the status filter in the first place (a status-scoped
  // base would make every tile but the selected one read 0).
  const scoped = useMemo(
    () =>
      invoices
        .filter((inv) => !brandFilter || inv.brandId === brandFilter)
        .filter((inv) => !effectiveBranchFilter || inv.branchId === effectiveBranchFilter),
    [invoices, brandFilter, effectiveBranchFilter]
  );

  const filteredInvoices = useMemo(
    () => scoped.filter((inv) => !statusFilter || inv.status === statusFilter),
    [scoped, statusFilter]
  );

  const statusCounts = useMemo(
    () => ({
      unpaid: scoped.filter((inv) => inv.status === 'unpaid').length,
      partial: scoped.filter((inv) => inv.status === 'partial').length,
      paid: scoped.filter((inv) => inv.status === 'paid').length,
      void: scoped.filter((inv) => inv.status === 'void').length,
    }),
    [scoped]
  );

  const viewing = invoices.find((i) => i.id === viewingId) || null;

  if (viewing) {
    const brand = brands.find((b) => b.id === viewing.brandId);
    return (
      <div>
        <div className="no-print flex items-center gap-3 mb-4">
          <button
            onClick={() => setViewingId(null)}
            className="px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200"
          >
            {t('branchCollection.invoiceList.backToList')}
          </button>
          <button
            onClick={() => {
              // Swap the tab title to just the invoice number for the duration of printing, so a
              // browser that prints "headers and footers" shows the invoice number rather than
              // this portal's page title. Turning the browser's header/footer off entirely still
              // needs the "More settings" toggle in that browser's own print dialog.
              const prevTitle = document.title;
              document.title = `Invoice ${viewing.invoiceNo}`;
              window.print();
              document.title = prevTitle;
            }}
            className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            {t('branchCollection.invoiceList.printSaveAsPdf')}
          </button>
        </div>
        {brand ? (
          <InvoicePrintView data={{ ...viewing, brand }} />
        ) : (
          <p className="text-sm text-rose-600">{t('branchCollection.invoiceList.errorNoBrand')}</p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{t('branchCollection.invoiceList.title', { count: filteredInvoices.length })}</h3>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="input text-sm">
          <option value="">{t('branchCollection.invoiceList.allBrands')}</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {canFilterByBranch && (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input text-sm">
            <option value="">{t('branchCollection.invoiceList.allBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {statusFilter && (
          <span className="text-xs font-medium text-slate-600 bg-slate-100 rounded px-2 py-1">
            {t('branchCollection.invoiceList.statusChip', { status: statusLabel(statusFilter, t) })}
          </span>
        )}
        {(brandFilter || effectiveBranchFilter || statusFilter) && (
          <button
            onClick={() => {
              setBrandFilter('');
              setBranchFilter('');
              setStatusFilter('');
            }}
            className="text-xs text-slate-500 hover:underline"
          >
            {t('branchCollection.invoiceList.clearFilters')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard
          label={statusLabel('unpaid', t)}
          value={String(statusCounts.unpaid)}
          accent={STATUS_ACCENT.unpaid}
          action={{ label: t('branchCollection.invoiceList.goToList'), onClick: () => setStatusFilter('unpaid') }}
        />
        <StatCard
          label={statusLabel('partial', t)}
          value={String(statusCounts.partial)}
          accent={STATUS_ACCENT.partial}
          action={{ label: t('branchCollection.invoiceList.goToList'), onClick: () => setStatusFilter('partial') }}
        />
        <StatCard
          label={statusLabel('paid', t)}
          value={String(statusCounts.paid)}
          accent={STATUS_ACCENT.paid}
          action={{ label: t('branchCollection.invoiceList.goToList'), onClick: () => setStatusFilter('paid') }}
        />
        <StatCard
          label={statusLabel('void', t)}
          value={String(statusCounts.void)}
          accent={STATUS_ACCENT.void}
          action={{ label: t('branchCollection.invoiceList.goToList'), onClick: () => setStatusFilter('void') }}
        />
      </div>

      <div className="space-y-2">
        {filteredInvoices.map((inv) => (
          <div key={inv.id} className={`border border-slate-100 rounded-lg p-3 ${inv.status === 'void' ? 'opacity-70' : ''}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5 flex-wrap">
                  {inv.invoiceNo} · {inv.clientName}
                  {inv.isMigrated && (
                    <span className="text-[10px] font-medium text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                      {t('branchCollection.invoiceList.migrated')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400">
                  {[inv.brandName, inv.siteName || null, inv.invoiceDate].filter(Boolean).join(' · ')}
                </p>
                {inv.status === 'void' ? (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t('branchCollection.invoiceList.voided')}
                    {inv.voidedByName ? ' ' + t('branchCollection.invoiceList.byName', { name: inv.voidedByName }) : ''}
                    {formatShortDateFromTs(inv.voidedAt) ? ' ' + t('branchCollection.statusEditor.onDate', { date: formatShortDateFromTs(inv.voidedAt) }) : ''}
                    {inv.voidReason ? ` — ${inv.voidReason}` : ''}
                  </p>
                ) : (
                  inv.status !== 'unpaid' &&
                  lastPayment(inv) && (
                    <p className="text-xs text-emerald-600 mt-0.5">
                      {t('branchCollection.invoiceList.lastPaid', { amount: lastPayment(inv)!.amount.toFixed(2) })}
                      {lastPayment(inv)!.date && ' ' + t('branchCollection.statusEditor.onDate', { date: formatShortDate(lastPayment(inv)!.date) })}
                      {' · '}
                      <span className={inv.total - inv.amountPaid > 0 ? 'text-amber-600' : 'text-slate-400'}>
                        {t('branchCollection.invoiceList.balance', { amount: (inv.total - inv.amountPaid).toFixed(2) })}
                      </span>
                    </p>
                  )
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-xs font-medium px-2 py-1 rounded ${STATUS_COLOR[inv.status]}`}>
                  {statusLabel(inv.status, t)}
                </span>
                <span className="text-sm font-semibold">RM {inv.total.toFixed(2)}</span>
                <button onClick={() => setViewingId(inv.id)} className="text-xs font-medium text-blue-700 hover:underline">
                  {t('branchCollection.invoiceList.view')}
                </button>
                {inv.status !== 'void' && (
                  <button
                    onClick={() => togglePanel(inv.id, 'status')}
                    className="text-xs font-medium text-slate-500 hover:underline"
                  >
                    {t('branchCollection.invoiceList.statusButton')}
                  </button>
                )}
                {canManage && inv.status === 'unpaid' && (
                  <button
                    onClick={() => togglePanel(inv.id, 'edit')}
                    className="text-xs font-medium text-slate-500 hover:underline"
                  >
                    {t('branchCollection.invoiceList.editButton')}
                  </button>
                )}
                {canManage && inv.status !== 'void' && (
                  <button
                    onClick={() => togglePanel(inv.id, 'void')}
                    className="text-xs font-medium text-rose-500 hover:underline"
                  >
                    {t('branchCollection.invoiceList.voidButton')}
                  </button>
                )}
              </div>
            </div>
            {activeRow?.id === inv.id && activeRow.panel === 'status' && (
              <StatusEditor invoice={inv} onClose={() => setActiveRow(null)} />
            )}
            {activeRow?.id === inv.id && activeRow.panel === 'void' && (
              <VoidPrompt invoice={inv} onClose={() => setActiveRow(null)} />
            )}
            {activeRow?.id === inv.id && activeRow.panel === 'edit' && (
              <ContentEditor invoice={inv} onClose={() => setActiveRow(null)} />
            )}
          </div>
        ))}
        {filteredInvoices.length === 0 && (
          <p className="text-xs text-slate-400">
            {invoices.length === 0 ? t('branchCollection.invoiceList.noneGenerated') : t('branchCollection.invoiceList.noneMatchFilters')}
          </p>
        )}
      </div>
    </div>
  );
}
