import { useEffect, useMemo, useState } from 'react';
import {
  subscribeInvoices,
  updateInvoiceStatus,
  deriveInvoiceStatus,
  clampAmountPaid,
  voidInvoice,
  updateInvoiceContent,
  computeLineAmount,
  sumLineGroups,
  roundMoney,
  type InvoiceEditInput,
} from '../../services/invoices';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { useAuth } from '../../contexts/AuthContext';
import InvoicePrintView from './InvoicePrintView';
import StatCard from '../analytics/StatCard';
import { isAdminRole } from '../../types';
import type { Invoice, InvoiceLineGroup, InvoiceStatus } from '../../types';

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Partially Paid',
  paid: 'Paid',
  void: 'Void',
};
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

function StatusEditor({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { profile } = useAuth();
  const [amountPaid, setAmountPaid] = useState(invoice.amountPaid);
  const [paidDate, setPaidDate] = useState(invoice.paidDate || '');
  const [busy, setBusy] = useState(false);

  // Status is never picked independently of the amount — it's always derived from amountPaid vs
  // the invoice's total (see deriveInvoiceStatus), and a payment can never be typed in above the
  // total in the first place (see the onChange below, which clamps as you type), so the two can
  // never end up disagreeing with each other the way a manually-picked status used to allow.
  const previewStatus = deriveInvoiceStatus(amountPaid, invoice.total);

  async function save() {
    if (!profile) return;
    setBusy(true);
    try {
      await updateInvoiceStatus(
        invoice.id,
        { amountPaid, total: invoice.total, paidDate: paidDate || undefined, previousAmountPaid: invoice.amountPaid },
        { uid: profile.uid, name: profile.name }
      );
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-100 pt-3 mt-3 flex flex-wrap items-center gap-2">
      <span className={`px-2.5 py-1.5 text-xs font-medium rounded-lg ${STATUS_COLOR[previewStatus]}`}>
        {STATUS_LABEL[previewStatus]}
      </span>
      <input
        type="number"
        value={amountPaid === 0 ? '' : amountPaid}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const raw = e.target.value.replace(/^0+(?=\d)/, '');
          const parsed = raw === '' ? 0 : Number(raw) || 0;
          setAmountPaid(clampAmountPaid(parsed, invoice.total));
        }}
        max={invoice.total}
        className="input w-32"
        placeholder="Amount paid (RM)"
      />
      <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="input" />
      <button onClick={save} disabled={busy} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg">
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button onClick={onClose} className="text-xs text-slate-500 hover:underline">
        Cancel
      </button>
    </div>
  );
}

/** Cancels a wrongly-generated invoice — see voidInvoice()'s doc comment in services/invoices.ts.
 *  Requires a reason so the audit trail (shown on the row afterwards, and on the printed invoice
 *  itself — see InvoicePrintView's void banner) always says why. */
function VoidPrompt({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { profile } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirmVoid() {
    if (!profile) return;
    if (!reason.trim()) {
      setError('A reason is required so there’s a record of why this invoice was cancelled.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await voidInvoice(invoice.id, reason, { uid: profile.uid, name: profile.name });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to void invoice.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-rose-100 pt-3 mt-3">
      <p className="text-xs font-medium text-rose-700 mb-1.5">
        Void invoice {invoice.invoiceNo} — this cancels it permanently (the invoice number stays
        spent) but keeps it on record. This cannot be undone.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (e.g. wrong client billed, duplicate invoice, incorrect amount)…"
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
          {busy ? 'Voiding…' : 'Confirm void'}
        </button>
        <button onClick={onClose} className="text-xs text-slate-500 hover:underline">
          Cancel
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
        i === gi ? { ...g, rows: [...g.rows, { category: '', headcount: 0, days: 0, rate: 0, amount: 0 }] } : g
      )
    );
  }
  function removeRow(gi: number, ri: number) {
    setLineGroups((prev) => prev.map((g, i) => (i === gi ? { ...g, rows: g.rows.filter((_, j) => j !== ri) } : g)));
  }
  function updateRow(gi: number, ri: number, patch: Partial<{ category: string; headcount: number; days: number; rate: number }>) {
    setLineGroups((prev) =>
      prev.map((g, i) => {
        if (i !== gi) return g;
        return {
          ...g,
          rows: g.rows.map((r, j) => {
            if (j !== ri) return r;
            const next = { ...r, ...patch };
            next.amount = computeLineAmount(next.headcount, next.days, next.rate);
            return next;
          }),
        };
      })
    );
  }

  const subTotal = roundMoney(sumLineGroups(lineGroups));
  const sstAmount = roundMoney(subTotal * sstRate);
  const total = roundMoney(subTotal + sstAmount);
  const canSave = !!clientName.trim() && !!invoiceDate && lineGroups.length > 0 && lineGroups.every((g) => g.location.trim());

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
        lineGroups,
      };
      await updateInvoiceContent(invoice.id, input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-slate-200 pt-3 mt-3 space-y-3">
      <p className="text-xs text-slate-500">
        Correcting invoice {invoice.invoiceNo}. The invoice number and billing month stay fixed —
        void it instead if it needs to be numbered or billed differently.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name" className="input" />
        <input value={attnName} onChange={(e) => setAttnName(e.target.value)} placeholder="Attn" className="input" />
        <input
          value={clientAddress}
          onChange={(e) => setClientAddress(e.target.value)}
          placeholder="Client address"
          className="input sm:col-span-2"
        />
        <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input" />
        <input value={contractRef} onChange={(e) => setContractRef(e.target.value)} placeholder="Contract ref" className="input" />
        <input value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} placeholder="Quotation no." className="input" />
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-500 whitespace-nowrap">Payment terms (days)</label>
          <input
            type="number"
            value={paymentTermsDays === 0 ? '' : paymentTermsDays}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setPaymentTermsDays(Number(e.target.value) || 0)}
            className="input w-20"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-500 whitespace-nowrap">SST rate</label>
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
          <p className="text-xs font-medium text-slate-600">Line items</p>
          <button onClick={addLineGroup} className="text-xs font-medium text-blue-700 hover:underline">
            + Add location
          </button>
        </div>
        {lineGroups.map((group, gi) => (
          <div key={gi} className="border border-slate-200 rounded-lg p-2.5 mb-2">
            <div className="flex items-center gap-2 mb-1.5">
              <input
                value={group.location}
                onChange={(e) => updateLineGroup(gi, e.target.value)}
                placeholder="e.g. MDEC HQ"
                className="input flex-1 font-medium"
              />
              <button onClick={() => removeLineGroup(gi)} className="text-xs text-rose-500 hover:text-rose-700 shrink-0">
                Remove location
              </button>
            </div>
            <table className="w-full text-sm mb-1.5">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="font-medium pb-1">Category</th>
                  <th className="font-medium pb-1 w-20">Headcount</th>
                  <th className="font-medium pb-1 w-20">Days</th>
                  <th className="font-medium pb-1 w-24">Rate</th>
                  <th className="font-medium pb-1 w-24 text-right">Amount</th>
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
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => addRow(gi)} className="text-xs font-medium text-blue-700 hover:underline">
              + Add row
            </button>
          </div>
        ))}
        {lineGroups.length === 0 && <p className="text-xs text-slate-400">No locations — add at least one.</p>}
      </div>

      <div className="flex justify-end text-sm">
        <table>
          <tbody>
            <tr>
              <td className="pr-3 text-slate-500">Sub total</td>
              <td className="text-right font-medium">RM {subTotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td className="pr-3 text-slate-500">SST</td>
              <td className="text-right font-medium">RM {sstAmount.toFixed(2)}</td>
            </tr>
            <tr>
              <td className="pr-3 text-slate-600 font-semibold">Total</td>
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
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onClose} className="text-xs text-slate-500 hover:underline">
          Cancel
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
            ← Back to list
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
            Print / Save as PDF
          </button>
        </div>
        {brand ? (
          <InvoicePrintView data={{ ...viewing, brand }} />
        ) : (
          <p className="text-sm text-rose-600">This invoice's brand no longer exists — can't render its letterhead.</p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Invoices ({filteredInvoices.length})</h3>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="input text-sm">
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {canFilterByBranch && (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input text-sm">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {statusFilter && (
          <span className="text-xs font-medium text-slate-600 bg-slate-100 rounded px-2 py-1">
            Status: {STATUS_LABEL[statusFilter]}
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
            Clear filters
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Unpaid"
          value={String(statusCounts.unpaid)}
          accent={STATUS_ACCENT.unpaid}
          action={{ label: 'Go to list', onClick: () => setStatusFilter('unpaid') }}
        />
        <StatCard
          label="Partially Paid"
          value={String(statusCounts.partial)}
          accent={STATUS_ACCENT.partial}
          action={{ label: 'Go to list', onClick: () => setStatusFilter('partial') }}
        />
        <StatCard
          label="Paid"
          value={String(statusCounts.paid)}
          accent={STATUS_ACCENT.paid}
          action={{ label: 'Go to list', onClick: () => setStatusFilter('paid') }}
        />
        <StatCard
          label="Void"
          value={String(statusCounts.void)}
          accent={STATUS_ACCENT.void}
          action={{ label: 'Go to list', onClick: () => setStatusFilter('void') }}
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
                      Migrated
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400">
                  {[inv.brandName, inv.siteName || null, inv.invoiceDate].filter(Boolean).join(' · ')}
                </p>
                {inv.status === 'void' ? (
                  <p className="text-xs text-slate-500 mt-0.5">
                    Voided{inv.voidedByName ? ` by ${inv.voidedByName}` : ''}
                    {formatShortDateFromTs(inv.voidedAt) ? ` on ${formatShortDateFromTs(inv.voidedAt)}` : ''}
                    {inv.voidReason ? ` — ${inv.voidReason}` : ''}
                  </p>
                ) : (
                  inv.status !== 'unpaid' &&
                  lastPayment(inv) && (
                    <p className="text-xs text-emerald-600 mt-0.5">
                      Last paid: RM {lastPayment(inv)!.amount.toFixed(2)}
                      {lastPayment(inv)!.date && ` on ${formatShortDate(lastPayment(inv)!.date)}`}
                      {' · '}
                      <span className={inv.total - inv.amountPaid > 0 ? 'text-amber-600' : 'text-slate-400'}>
                        Balance: RM {(inv.total - inv.amountPaid).toFixed(2)}
                      </span>
                    </p>
                  )
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-xs font-medium px-2 py-1 rounded ${STATUS_COLOR[inv.status]}`}>
                  {STATUS_LABEL[inv.status]}
                </span>
                <span className="text-sm font-semibold">RM {inv.total.toFixed(2)}</span>
                <button onClick={() => setViewingId(inv.id)} className="text-xs font-medium text-blue-700 hover:underline">
                  View
                </button>
                {inv.status !== 'void' && (
                  <button
                    onClick={() => togglePanel(inv.id, 'status')}
                    className="text-xs font-medium text-slate-500 hover:underline"
                  >
                    Status
                  </button>
                )}
                {canManage && inv.status === 'unpaid' && (
                  <button
                    onClick={() => togglePanel(inv.id, 'edit')}
                    className="text-xs font-medium text-slate-500 hover:underline"
                  >
                    Edit
                  </button>
                )}
                {canManage && inv.status !== 'void' && (
                  <button
                    onClick={() => togglePanel(inv.id, 'void')}
                    className="text-xs font-medium text-rose-500 hover:underline"
                  >
                    Void
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
            {invoices.length === 0 ? 'No invoices generated yet.' : 'No invoices match these filters.'}
          </p>
        )}
      </div>
    </div>
  );
}
