import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { useSitesForBilling, updateSiteBillingRates } from '../../services/siteBilling';
import { createInvoice, computeLineAmount, sumLineGroups, peekNextInvoiceNumber } from '../../services/invoices';
import InvoicePrintView from './InvoicePrintView';
import type { InvoiceLineGroup, SiteBillingRate } from '../../types';

const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

/** Turns a `<input type="month">` value ("2026-08") into the prose form used on the invoice's
 *  description line ("AUGUST 2026"). Empty/invalid input returns ''. */
function formatBillingMonth(monthValue: string): string {
  const [y, m] = monthValue.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return '';
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function currentMonthValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The Branch Collection tab's invoice-building form. Deliberately semi-manual (see the Rate
 * source / Invoice line entry decisions this was built from): a site's billing-rate categories
 * are configured once and reused, but headcount/days per category and each location's label are
 * typed in fresh per invoice against the Duty Roster Summary Report (opened in another tab) —
 * nothing here reads guard attendance directly. Amount per row = headcount * days * a 12-hour
 * shift * rate, matching the sample invoices this was modeled on exactly.
 *
 * The invoice number, billing month, client address, contract/PO reference and authorised
 * signatory are all auto-filled from elsewhere (the site's linked Won tender in Active Projects,
 * the site's Branch record, and a running per-brand+branch+client counter) rather than typed in
 * fresh each time — see each field's own comment below for exactly where it's sourced from. Every
 * auto-filled field stays editable, in case the source data isn't set up yet or this particular
 * invoice needs a one-off correction.
 */
export default function InvoiceGenerator() {
  const { profile } = useAuth();
  const { brands } = useBrands();
  const { branches } = useBranches();
  const { sites } = useSitesForBilling();

  const [siteId, setSiteId] = useState('');
  const site = sites.find((s) => s.id === siteId) || null;
  // The Branch record matching this site's `branch` field (a plain name string set from the
  // Duty Roster side) — used to auto-fill who signs the invoice and the BRANCH segment of the
  // invoice number. See Branch's doc comment in types.ts for why signatory/shortCode live on
  // Branch, not Brand.
  const matchedBranch = site?.branch ? branches.find((b) => b.name === site.branch) || null : null;

  const [brandId, setBrandId] = useState('');
  const brand = brands.find((b) => b.id === brandId) || null;

  const [clientName, setClientName] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientAlias, setClientAlias] = useState('');
  const [attnName, setAttnName] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [billingMonthValue, setBillingMonthValue] = useState(currentMonthValue);
  const [contractRef, setContractRef] = useState('');
  const [quotationNo, setQuotationNo] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState(30);
  const [sstRate, setSstRate] = useState(0.08);
  const [lineGroups, setLineGroups] = useState<InvoiceLineGroup[]>([]);
  const [signatoryName, setSignatoryName] = useState('');
  const [signatoryTitle, setSignatoryTitle] = useState('');

  const [rateDraft, setRateDraft] = useState<SiteBillingRate[]>([]);
  const [ratesSaving, setRatesSaving] = useState(false);
  const [ratesSaved, setRatesSaved] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // The invoice number's BRAND/BRANCH segments — a saved short code/nickname when the brand or
  // branch has one set (Admin Settings > Branches & Brands), falling back to the full name
  // otherwise so numbering still works before anyone's filled those in.
  const brandCode = (brand?.shortCode || brand?.name || '').trim();
  const branchCode = (matchedBranch?.shortCode || matchedBranch?.name || site?.branch || '').trim();

  const [previewInvoiceNo, setPreviewInvoiceNo] = useState('');
  const [previewNonce, setPreviewNonce] = useState(0);

  const billingMonth = formatBillingMonth(billingMonthValue);

  // Switching sites: load that site's saved rate categories, and — if it's linked to a Won
  // tender — best-effort prefill the brand/client/contract-ref/client-alias/client-address from
  // that tender's Active Projects details so they're not retyped.
  useEffect(() => {
    setRateDraft(site?.billingRates || []);
    setRatesSaved(false);
    if (site?.tenderId) {
      getDoc(doc(db, 'tenders', site.tenderId))
        .then((snap) => {
          if (!snap.exists()) return;
          const t = snap.data() as {
            brandId?: string;
            clientName?: string;
            clientAlias?: string;
            clientAddress?: string;
            tenderDocNumber?: string;
          };
          if (t.brandId) setBrandId(t.brandId);
          if (t.clientName) setClientName(t.clientName);
          setClientAlias(t.clientAlias || '');
          setClientAddress(t.clientAddress || '');
          setContractRef(t.tenderDocNumber || '');
        })
        .catch(() => {});
    } else {
      setClientAlias('');
      setContractRef('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // Auto-fill the signatory from the site's branch whenever the site (or the branches list)
  // changes — still a plain editable field afterward, same "manual entry, auto-filled" pattern
  // as the rate categories below, in case a site's branch has no matching Branch record yet.
  useEffect(() => {
    setSignatoryName(matchedBranch?.signatoryName || '');
    setSignatoryTitle(matchedBranch?.signatoryTitle || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, matchedBranch?.signatoryName, matchedBranch?.signatoryTitle]);

  // Live preview of the NEXT invoice number for this exact brand+branch+client combination —
  // read-only (see peekNextInvoiceNumber's doc comment); the number actually assigned to a saved
  // invoice is only finalized inside createInvoice()'s transaction. previewNonce is bumped after
  // a successful save so this re-peeks and shows what the *next* invoice would be.
  useEffect(() => {
    const alias = clientAlias.trim() || clientName.trim();
    if (!brandCode || !branchCode || !alias) {
      setPreviewInvoiceNo('');
      return;
    }
    let cancelled = false;
    const year = new Date(`${invoiceDate}T00:00:00`).getFullYear() || new Date().getFullYear();
    peekNextInvoiceNumber(brandCode, branchCode, alias, year)
      .then((no) => {
        if (!cancelled) setPreviewInvoiceNo(no);
      })
      .catch(() => {
        if (!cancelled) setPreviewInvoiceNo('');
      });
    return () => {
      cancelled = true;
    };
  }, [brandCode, branchCode, clientAlias, clientName, invoiceDate, previewNonce]);

  async function handleSaveRates() {
    if (!site) return;
    setRatesSaving(true);
    setRatesSaved(false);
    try {
      const cleaned = rateDraft
        .map((r) => ({ category: r.category.trim(), hourlyRate: Number(r.hourlyRate) || 0 }))
        .filter((r) => r.category);
      await updateSiteBillingRates(site.id, cleaned);
      setRateDraft(cleaned);
      setRatesSaved(true);
    } finally {
      setRatesSaving(false);
    }
  }

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
    const firstRate = rateDraft[0];
    setLineGroups((prev) =>
      prev.map((g, i) =>
        i === gi
          ? {
              ...g,
              rows: [
                ...g.rows,
                {
                  category: firstRate?.category || '',
                  headcount: 0,
                  days: 0,
                  rate: firstRate?.hourlyRate || 0,
                  amount: 0,
                },
              ],
            }
          : g
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
  function handleCategoryChange(gi: number, ri: number, category: string) {
    const match = rateDraft.find((r) => r.category === category);
    updateRow(gi, ri, { category, rate: match ? match.hourlyRate : 0 });
  }

  const subTotal = sumLineGroups(lineGroups);
  const sstAmount = subTotal * sstRate;
  const total = subTotal + sstAmount;

  const canSave = !!(profile && brand && site && clientName.trim() && lineGroups.length > 0);

  async function handleSave() {
    if (!profile || !brand || !site) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const result = await createInvoice(
        {
          brandId: brand.id,
          brandName: brand.name,
          brandCode,
          siteId: site.id,
          siteName: site.name,
          tenderId: site.tenderId,
          clientName: clientName.trim(),
          clientAddress: clientAddress.trim(),
          attnName: attnName.trim(),
          branchCode,
          clientAlias: clientAlias.trim() || clientName.trim(),
          invoiceDate,
          billingMonth,
          contractRef: contractRef.trim(),
          quotationNo: quotationNo.trim(),
          paymentTermsDays,
          lineGroups,
          sstRate,
          signatoryName: signatoryName.trim(),
          signatoryTitle: signatoryTitle.trim(),
        },
        { uid: profile.uid, name: profile.name, role: profile.role }
      );
      setSaveMessage({ text: `Invoice ${result.invoiceNo} saved — find it in the Invoices tab.`, isError: false });
      setLineGroups([]);
      setPreviewNonce((n) => n + 1);
    } catch (err) {
      setSaveMessage({ text: err instanceof Error ? err.message : 'Could not save invoice.', isError: true });
    } finally {
      setSaving(false);
    }
  }

  if (showPreview) {
    return (
      <div>
        <div className="no-print flex items-center gap-3 mb-4">
          <button
            onClick={() => setShowPreview(false)}
            className="px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200"
          >
            ← Back to editing
          </button>
          <button
            onClick={() => window.print()}
            className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Print / Save as PDF
          </button>
        </div>
        {brand && (
          <InvoicePrintView
            data={{
              brand,
              invoiceNo: previewInvoiceNo || '(assigned when saved)',
              invoiceDate,
              clientName,
              clientAddress,
              attnName,
              quotationNo,
              contractRef,
              paymentTermsDays,
              billingMonth,
              lineGroups,
              subTotal,
              sstRate,
              sstAmount,
              total,
              signatoryName,
              signatoryTitle,
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Invoice details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Duty Roster site</label>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="input w-full">
              <option value="">Select a site…</option>
              {sites
                .filter((s) => !s.archived)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.branch ? `(${s.branch})` : ''}
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
            <label className="block text-xs font-medium text-slate-500 mb-1">Client name</label>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="input w-full" placeholder="e.g. Malaysia Digital Economy Corporation Sdn Bhd" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Client alias / short code <span className="text-slate-400 font-normal">(for the invoice number)</span>
            </label>
            <input value={clientAlias} onChange={(e) => setClientAlias(e.target.value)} className="input w-full" placeholder="e.g. MDEC" />
            {site?.tenderId && !clientAlias && (
              <p className="text-xs text-slate-400 mt-1">
                Not set on this project yet — add one in Active Projects &gt; Project Details, or type it in here.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Attn.</label>
            <input value={attnName} onChange={(e) => setAttnName(e.target.value)} className="input w-full" placeholder="e.g. En. Farul Izzat bin Kamarudin" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Client address</label>
            <textarea value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} className="input w-full" rows={2} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Invoice no.</label>
            <div className="input w-full bg-slate-50 text-slate-600 flex items-center justify-between gap-2">
              <span className="font-medium">{previewInvoiceNo || 'Select a site, brand and client first'}</span>
              {previewInvoiceNo && <span className="text-[11px] text-slate-400 whitespace-nowrap">Auto-generated</span>}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Format: BRAND/BRANCH/CLIENT/YEAR/RUNNING NO. — finalized when you save (shown here is a preview).
            </p>
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
            <input type="number" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(Number(e.target.value) || 0)} className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Quotation no.</label>
            <input value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} className="input w-full" placeholder="-" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Contract / Letter of Award / PO No.</label>
            <input value={contractRef} onChange={(e) => setContractRef(e.target.value)} className="input w-full" placeholder="Auto-filled from the project's Tender Document No." />
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
            <label className="block text-xs font-medium text-slate-500 mb-1">Authorised signatory name</label>
            <input value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} className="input w-full" placeholder="e.g. MASITA ARBI" />
            {site && !matchedBranch && (
              <p className="text-xs text-slate-400 mt-1">
                No saved signatory for "{site.branch || 'this site\'s branch'}" yet — set one in Admin Settings &gt; Branches &amp; Brands, or type it in here just for this invoice.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Signatory title</label>
            <input value={signatoryTitle} onChange={(e) => setSignatoryTitle(e.target.value)} className="input w-full" placeholder="e.g. Branch Manager" />
          </div>
        </div>
      </div>

      {site && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Billing rate categories for {site.name}</h3>
              <p className="text-xs text-slate-400 mt-0.5 mb-3">
                Set once, reused every month — each line row below picks from this list.
              </p>
            </div>
            <button
              onClick={() => setRateDraft((prev) => [...prev, { category: '', hourlyRate: 0 }])}
              className="shrink-0 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded px-2.5 py-1 border border-blue-200"
            >
              + Add category
            </button>
          </div>
          <div className="space-y-2">
            {rateDraft.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={r.category}
                  onChange={(e) =>
                    setRateDraft((prev) => prev.map((row, j) => (j === i ? { ...row, category: e.target.value } : row)))
                  }
                  placeholder="e.g. Security Officer"
                  className="input flex-1"
                />
                <span className="text-xs text-slate-400">RM</span>
                <input
                  type="number"
                  step="0.01"
                  value={r.hourlyRate}
                  onChange={(e) =>
                    setRateDraft((prev) =>
                      prev.map((row, j) => (j === i ? { ...row, hourlyRate: Number(e.target.value) || 0 } : row))
                    )
                  }
                  placeholder="0.00"
                  className="input w-28"
                />
                <span className="text-xs text-slate-400">/ hour</span>
                <button
                  onClick={() => setRateDraft((prev) => prev.filter((_, j) => j !== i))}
                  className="text-xs text-rose-500 hover:text-rose-700 shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}
            {rateDraft.length === 0 && <p className="text-xs text-slate-400">No categories yet — add one above.</p>}
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={handleSaveRates}
              disabled={ratesSaving}
              className="px-3 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
            >
              {ratesSaving ? 'Saving…' : 'Save categories & rates'}
            </button>
            {ratesSaved && <span className="text-xs text-emerald-600">Saved.</span>}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Line items</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Add a location group per post/building, then a row per guard category — check the
              Summary Report (Duty Roster) for actual headcount and days worked.
            </p>
          </div>
          <button
            onClick={addLineGroup}
            className="shrink-0 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded px-2.5 py-1 border border-blue-200"
          >
            + Add location
          </button>
        </div>

        {lineGroups.map((group, gi) => (
          <div key={gi} className="border border-slate-200 rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 mb-2">
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

            <table className="w-full text-sm mb-2">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="font-medium pb-1">Category</th>
                  <th className="font-medium pb-1 w-24">Headcount</th>
                  <th className="font-medium pb-1 w-24">Days</th>
                  <th className="font-medium pb-1 w-24">Rate</th>
                  <th className="font-medium pb-1 w-28 text-right">Amount</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row, ri) => (
                  <tr key={ri}>
                    <td className="pr-2 py-1">
                      <select
                        value={row.category}
                        onChange={(e) => handleCategoryChange(gi, ri, e.target.value)}
                        className="input w-full"
                      >
                        <option value="">Select…</option>
                        {rateDraft.map((r) => (
                          <option key={r.category} value={r.category}>
                            {r.category}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="pr-2 py-1">
                      <input
                        type="number"
                        value={row.headcount}
                        onChange={(e) => updateRow(gi, ri, { headcount: Number(e.target.value) || 0 })}
                        className="input w-full"
                      />
                    </td>
                    <td className="pr-2 py-1">
                      <input
                        type="number"
                        step="0.5"
                        value={row.days}
                        onChange={(e) => updateRow(gi, ri, { days: Number(e.target.value) || 0 })}
                        className="input w-full"
                      />
                    </td>
                    <td className="pr-2 py-1">
                      <input
                        type="number"
                        step="0.01"
                        value={row.rate}
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
        {lineGroups.length === 0 && <p className="text-xs text-slate-400">No locations added yet.</p>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex justify-end">
          <table className="text-sm">
            <tbody>
              <tr>
                <td className="pr-6 text-slate-500">Sub Total</td>
                <td className="text-right w-32">RM {subTotal.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="pr-6 text-slate-500">SST @{Math.round(sstRate * 100)}%</td>
                <td className="text-right">RM {sstAmount.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="pr-6 font-semibold">Total (Inclusive of SST)</td>
                <td className="text-right font-semibold">RM {total.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {saveMessage && (
          <p className={`text-xs mt-3 ${saveMessage.isError ? 'text-rose-600' : 'text-emerald-600'}`}>{saveMessage.text}</p>
        )}

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => setShowPreview(true)}
            disabled={!brand}
            className="px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 rounded-lg border border-slate-200"
          >
            Preview
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-3.5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
          >
            {saving ? 'Saving…' : 'Save invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
