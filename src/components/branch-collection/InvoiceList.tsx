import { useEffect, useState } from 'react';
import { subscribeInvoices, updateInvoiceStatus } from '../../services/invoices';
import { useBrands } from '../../hooks/useBranches';
import { useAuth } from '../../contexts/AuthContext';
import InvoicePrintView from './InvoicePrintView';
import type { Invoice, InvoiceStatus } from '../../types';

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Partially Paid',
  paid: 'Paid',
};
const STATUS_COLOR: Record<InvoiceStatus, string> = {
  unpaid: 'bg-rose-50 text-rose-700',
  partial: 'bg-amber-50 text-amber-700',
  paid: 'bg-emerald-50 text-emerald-700',
};

function formatShortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
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
  const [status, setStatus] = useState<InvoiceStatus>(invoice.status);
  const [amountPaid, setAmountPaid] = useState(invoice.amountPaid);
  const [paidDate, setPaidDate] = useState(invoice.paidDate || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!profile) return;
    setBusy(true);
    try {
      await updateInvoiceStatus(
        invoice.id,
        { status, amountPaid, paidDate: paidDate || undefined, previousAmountPaid: invoice.amountPaid },
        { uid: profile.uid, name: profile.name }
      );
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-100 pt-3 mt-3 flex flex-wrap items-center gap-2">
      <select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus)} className="input">
        <option value="unpaid">Unpaid</option>
        <option value="partial">Partially Paid</option>
        <option value="paid">Paid</option>
      </select>
      <input
        type="number"
        value={amountPaid === 0 ? '' : amountPaid}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const raw = e.target.value.replace(/^0+(?=\d)/, '');
          setAmountPaid(raw === '' ? 0 : Number(raw) || 0);
        }}
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

/** Lists every generated invoice, lets you view/print one (reusing InvoicePrintView), and update
 *  its payment status. Invoices themselves are created from InvoiceGenerator — this component
 *  never creates one, only reads and updates status. */
export default function InvoiceList() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const { brands } = useBrands();
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => subscribeInvoices(setInvoices), []);

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
      <h3 className="text-sm font-semibold text-slate-800 mb-3">Invoices ({invoices.length})</h3>
      <div className="space-y-2">
        {invoices.map((inv) => (
          <div key={inv.id} className="border border-slate-100 rounded-lg p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {inv.invoiceNo} · {inv.clientName}
                </p>
                <p className="text-xs text-slate-400">
                  {inv.brandName} · {inv.siteName} · {inv.invoiceDate}
                </p>
                {inv.status !== 'unpaid' && lastPayment(inv) && (
                  <p className="text-xs text-emerald-600 mt-0.5">
                    Last paid: RM {lastPayment(inv)!.amount.toFixed(2)}
                    {lastPayment(inv)!.date && ` on ${formatShortDate(lastPayment(inv)!.date)}`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-medium px-2 py-1 rounded ${STATUS_COLOR[inv.status]}`}>
                  {STATUS_LABEL[inv.status]}
                </span>
                <span className="text-sm font-semibold">RM {inv.total.toFixed(2)}</span>
                <button onClick={() => setViewingId(inv.id)} className="text-xs font-medium text-blue-700 hover:underline">
                  View
                </button>
                <button
                  onClick={() => setEditingId(editingId === inv.id ? null : inv.id)}
                  className="text-xs font-medium text-slate-500 hover:underline"
                >
                  Status
                </button>
              </div>
            </div>
            {editingId === inv.id && <StatusEditor invoice={inv} onClose={() => setEditingId(null)} />}
          </div>
        ))}
        {invoices.length === 0 && <p className="text-xs text-slate-400">No invoices generated yet.</p>}
      </div>
    </div>
  );
}
