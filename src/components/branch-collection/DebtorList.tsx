import { useEffect, useState } from 'react';
import { subscribeInvoices } from '../../services/invoices';
import type { Invoice } from '../../types';

/** Days between the invoice's due date (invoiceDate + paymentTermsDays) and today — negative
 *  means not yet due. */
function daysOverdue(inv: Invoice): number {
  const due = new Date(`${inv.invoiceDate}T00:00:00`);
  due.setDate(due.getDate() + inv.paymentTermsDays);
  const diffMs = Date.now() - due.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function bucketLabel(overdue: number): string {
  if (overdue <= 0) return 'Not yet due';
  if (overdue <= 30) return '1–30 days';
  if (overdue <= 60) return '31–60 days';
  if (overdue <= 90) return '61–90 days';
  return '90+ days';
}

/** Aging report: every invoice not yet fully paid, sorted most-overdue first, with how much is
 *  still outstanding on each. Pulls from the same `invoices` collection InvoiceList reads — this
 *  is purely a different view over it, nothing here is a separate source of truth. */
export default function DebtorList() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  useEffect(() => subscribeInvoices(setInvoices), []);

  const outstanding = invoices
    .filter((inv) => inv.status !== 'paid')
    .map((inv) => ({ inv, overdue: daysOverdue(inv), balance: inv.total - inv.amountPaid }))
    .sort((a, b) => b.overdue - a.overdue);

  const totalOutstanding = outstanding.reduce((sum, o) => sum + o.balance, 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Debtor list ({outstanding.length})</h3>
        <p className="text-sm font-semibold text-slate-800">Total outstanding: RM {totalOutstanding.toFixed(2)}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
              <th className="py-2 pr-4 font-medium">Invoice</th>
              <th className="py-2 pr-4 font-medium">Client</th>
              <th className="py-2 pr-4 font-medium">Brand</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium text-right">Balance (RM)</th>
              <th className="py-2 font-medium text-right">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {outstanding.map(({ inv, overdue, balance }) => (
              <tr key={inv.id} className="border-b border-slate-50 last:border-0">
                <td className="py-2 pr-4">{inv.invoiceNo}</td>
                <td className="py-2 pr-4">{inv.clientName}</td>
                <td className="py-2 pr-4 text-slate-500">{inv.brandName}</td>
                <td className="py-2 pr-4 capitalize">{inv.status}</td>
                <td className="py-2 pr-4 text-right">{balance.toFixed(2)}</td>
                <td
                  className={`py-2 text-right font-medium ${
                    overdue > 30 ? 'text-rose-600' : overdue > 0 ? 'text-amber-600' : 'text-slate-400'
                  }`}
                >
                  {overdue > 0 ? `${overdue}d · ` : ''}
                  {bucketLabel(overdue)}
                </td>
              </tr>
            ))}
            {outstanding.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-xs text-slate-400">
                  No outstanding invoices — everything is paid up.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
