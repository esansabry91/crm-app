import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { useWonTenders } from '../../hooks/useActiveProjects';
import { createMigratedInvoice, deriveInvoiceStatus, clampAmountPaid } from '../../services/invoices';
import { formatRM } from '../../utils/format';

const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

/** Same formatting InvoiceGenerator uses for its own billing-month description line — small
 *  enough to duplicate here rather than export/import across the two generators. */
function formatBillingMonth(monthValue: string): string {
  const [y, m] = monthValue.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return '';
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function currentMonthValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Best-effort guess at the running number to reserve in the brand+branch+client invoice
 *  counter, parsed from the tail of a manually-typed invoice number formatted like this app's own
 *  CODE/CODE/CODE/YEAR/NN scheme (e.g. "PZ/KV3/ABC/2024/07" -> 7). Returns null when the number
 *  doesn't end in a plain trailing number, so the field just starts blank and can be filled in by
 *  hand if it should still reserve something. */
function guessRunningNumber(invoiceNo: string): number | null {
  const m = invoiceNo.trim().match(/(\d{1,6})$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Records a historical invoice that was already issued to a client before this app existed —
 * tied to an Active Project (a Won tender) instead of a Duty Roster site, since a migrated
 * invoice's project may never have had one. Deliberately much lighter than InvoiceGenerator: no
 * headcount/days/rate line-item calculator (the amount is already known — just typed in), and the
 * invoice number is exactly what's typed in rather than auto-assigned, since it needs to match
 * what the client actually received on the original document. See createMigratedInvoice's doc
 * comment in services/invoices.ts for how this keeps the app's own auto-numbering from later
 * reusing a running number a migrated invoice's number already carries.
 */
export default function MigrateInvoiceForm() {
  const { profile } = useAuth();
  const { brands } = useBrands();
  const { branches } = useBranches();
  const { wonTenders } = useWonTenders(profile);

  const [tenderId, setTenderId] = useState('');
  const tender = wonTenders.find((t) => t.id === tenderId) || null;
  const matchedBranch = tender?.activeBranch ? branches.find((b) => b.name === tender.activeBranch) || null : null;

  const [brandId, setBrandId] = useState('');
  const brand = brands.find((b) => b.id === brandId) || null;
  const [branchIdOverride, setBranchIdOverride] = useState('');
  const effectiveBranch = branches.find((b) => b.id === branchIdOverride) || matchedBranch;

  const [clientName, setClientName] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientAlias, setClientAlias] = useState('');
  const [attnName, setAttnName] = useState('');
  const [contractRef, setContractRef] = useState('');

  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [billingMonthValue, setBillingMonthValue] = useState(currentMonthValue);
  const [quotationNo, setQuotationNo] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState(30);
  const [subTotal, setSubTotal] = useState(0);
  const [sstRate, setSstRate] = useState(0.08);
  const [amountPaid, setAmountPaid] = useState(0);
  const [paidDate, setPaidDate] = useState('');

  const [reserveRunningNumber, setReserveRunningNumber] = useState<number | null>(null);
  const [reserveTouched, setReserveTouched] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Selecting an Active Project best-effort prefills brand/client/contract-ref/branch, the same
  // way InvoiceGenerator prefills from a site's linked Won tender — these genuinely come from the
  // project, so they're set outright (not merged) whenever the project selection changes.
  useEffect(() => {
    if (!tender) return;
    setBrandId(tender.brandId || '');
    setClientName(tender.clientName || '');
    setClientAlias(tender.clientAlias || '');
    setClientAddress(tender.clientAddress || '');
    setContractRef(tender.tenderDocNumber || '');
    setBranchIdOverride('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId]);

  // Re-guess the running number to reserve whenever the typed invoice number changes, unless the
  // reservation field has already been hand-edited for this invoice.
  useEffect(() => {
    if (reserveTouched) return;
    setReserveRunningNumber(guessRunningNumber(invoiceNo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceNo]);

  const brandCode = (brand?.shortCode || brand?.name || '').trim();
  const branchCode = (effectiveBranch?.shortCode || effectiveBranch?.name || '').trim();
  const billingMonth = formatBillingMonth(billingMonthValue);
  const sstAmount = subTotal * sstRate;
  const total = subTotal + sstAmount;
  // Status is never picked independently of the amount paid — see deriveInvoiceStatus — and the
  // Amount paid field below can never be typed in above `total` in the first place.
  const status = deriveInvoiceStatus(amountPaid, total);

  // Re-clamp if editing the subtotal/SST rate after the fact shrinks the total below an
  // already-typed amountPaid — the onChange clamp alone only guards against typing past whatever
  // the total was at that moment.
  useEffect(() => {
    setAmountPaid((prev) => clampAmountPaid(prev, total));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const canSave = !!(profile && tender && brand && clientName.trim() && invoiceNo.trim() && subTotal > 0);

  async function handleSave() {
    if (!profile || !tender || !brand) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await createMigratedInvoice(
        {
          brandId: brand.id,
          brandName: brand.name,
          brandCode,
          branchId: effectiveBranch?.id || null,
          branchName: effectiveBranch?.name || '',
          branchCode,
          tenderId: tender.id,
          clientName: clientName.trim(),
          clientAddress: clientAddress.trim(),
          attnName: attnName.trim(),
          clientAlias: clientAlias.trim() || clientName.trim(),
          invoiceNo: invoiceNo.trim(),
          invoiceDate,
          billingMonth,
          billingMonthKey: billingMonthValue,
          contractRef: contractRef.trim(),
          quotationNo: quotationNo.trim(),
          paymentTermsDays,
          subTotal,
          sstRate,
          amountPaid,
          paidDate: paidDate || undefined,
          reserveRunningNumber,
        },
        { uid: profile.uid, name: profile.name, role: profile.role }
      );
      setSaveMessage({ text: `Historical invoice ${invoiceNo.trim()} saved — find it in the Invoices tab.`, isError: false });
      setInvoiceNo('');
      setSubTotal(0);
      setAmountPaid(0);
      setPaidDate('');
      setReserveTouched(false);
      setReserveRunningNumber(null);
    } catch (err) {
      setSaveMessage({ text: err instanceof Error ? err.message : 'Could not save invoice.', isError: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
        For a past invoice that was already issued outside this app — no Duty Roster site to link
        it to, but tied to an Active Project. Pick the project it belongs to, type in the amount
        and the invoice number exactly as originally issued, and set its current payment status.
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Project &amp; client</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Active Project</label>
            <select value={tenderId} onChange={(e) => setTenderId(e.target.value)} className="input w-full">
              <option value="">Select the project this invoice was billed under…</option>
              {wonTenders.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.clientName} {t.activeBranch ? `(${t.activeBranch})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Brand (issuing company)</label>
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="input w-full">
              <option value="">Select a brand…</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Branch</label>
            <select
              value={branchIdOverride || matchedBranch?.id || ''}
              onChange={(e) => setBranchIdOverride(e.target.value)}
              className="input w-full"
            >
              <option value="">Select a branch…</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {tender && !matchedBranch && (
              <p className="text-xs text-slate-400 mt-1">
                Couldn't auto-match a branch from this project — pick one.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Client name</label>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Attn.</label>
            <input value={attnName} onChange={(e) => setAttnName(e.target.value)} className="input w-full" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Client address</label>
            <textarea value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} className="input w-full" rows={2} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Invoice details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Invoice no. (as originally issued)</label>
            <input
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              className="input w-full"
              placeholder="e.g. PZ/KV3/ABC/2024/07"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Invoice date</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Billing month (for the description line)</label>
            <input type="month" value={billingMonthValue} onChange={(e) => setBillingMonthValue(e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Payment terms (days)</label>
            <input
              type="number"
              value={paymentTermsDays === 0 ? '' : paymentTermsDays}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const raw = e.target.value.replace(/^0+(?=\d)/, '');
                setPaymentTermsDays(raw === '' ? 0 : Number(raw) || 0);
              }}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Quotation no.</label>
            <input value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} className="input w-full" placeholder="-" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Contract / Letter of Award / PO No.</label>
            <input value={contractRef} onChange={(e) => setContractRef(e.target.value)} className="input w-full" />
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100">
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Reserve running number for this brand/branch/client
          </label>
          <input
            type="number"
            value={reserveRunningNumber ?? ''}
            onChange={(e) => {
              setReserveTouched(true);
              const raw = e.target.value;
              setReserveRunningNumber(raw === '' ? null : Number(raw) || null);
            }}
            className="input w-40"
            placeholder="Leave blank to skip"
          />
          <p className="text-xs text-slate-400 mt-1">
            Guessed from the invoice number above — bumps this brand/branch/client's own
            auto-numbering counter so the next NEW invoice generated for them never repeats a
            running number this one already used. Leave blank if this invoice's number doesn't
            follow that scheme, or if you're not sure.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Amount &amp; payment status</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Subtotal (RM)</label>
            <input
              type="number"
              value={subTotal === 0 ? '' : subTotal}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const raw = e.target.value.replace(/^0+(?=\d)/, '');
                setSubTotal(raw === '' ? 0 : Number(raw) || 0);
              }}
              className="input w-full"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">SST rate</label>
            <select value={sstRate} onChange={(e) => setSstRate(Number(e.target.value))} className="input w-full">
              <option value={0.08}>8%</option>
              <option value={0.06}>6%</option>
              <option value={0}>0% (exempt)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">SST amount</label>
            <div className="input w-full bg-slate-50 text-slate-600">{formatRM(sstAmount)}</div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Total</label>
            <div className="input w-full bg-slate-50 text-slate-800 font-semibold">{formatRM(total)}</div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Amount paid (RM)</label>
            <input
              type="number"
              value={amountPaid === 0 ? '' : amountPaid}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const raw = e.target.value.replace(/^0+(?=\d)/, '');
                const parsed = raw === '' ? 0 : Number(raw) || 0;
                setAmountPaid(clampAmountPaid(parsed, total));
              }}
              max={total}
              className="input w-full"
              placeholder="0.00"
            />
            <p className="text-xs text-slate-400 mt-1">Can't exceed the total ({formatRM(total)}).</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
            <div className="input w-full bg-slate-50 text-slate-700 font-medium">
              {status === 'unpaid' ? 'Unpaid' : status === 'partial' ? 'Partially Paid' : 'Paid'}
            </div>
          </div>
          {status !== 'unpaid' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Last paid date</label>
              <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="input w-full" />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          className="px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
        >
          {saving ? 'Saving…' : 'Save historical invoice'}
        </button>
        {saveMessage && (
          <p className={`text-sm ${saveMessage.isError ? 'text-rose-600' : 'text-emerald-600'}`}>{saveMessage.text}</p>
        )}
      </div>
    </div>
  );
}
