import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { getTenderSiteDetails } from '../../services/tenders';
import { useConfirmedMonthSummary } from '../../services/dutyRosterSummary';
import {
  computeLineAmount,
  sumLineGroups,
  sumEquipmentRows,
  deriveRateCategoriesFromGuardRate,
  INVOICE_HOURS_PER_SHIFT,
  isAdditionalGuardCategory,
} from '../../services/invoices';
import type { BillingSite } from '../../services/siteBilling';
import type {
  InvoiceEquipmentRow,
  InvoiceLineGroup,
  SiteBillingRate,
  SiteEquipmentRate,
  TenderEquipmentItem,
} from '../../types';

export interface InvoiceSiteSectionData {
  siteId: string;
  siteName: string;
  lineGroups: InvoiceLineGroup[];
  equipmentRows: InvoiceEquipmentRow[];
  subTotal: number;
  canSave: boolean;
}

interface InvoiceSiteSectionProps {
  site: BillingSite;
  billingMonthValue: string;
  billingMonth: string;
  onChange: (data: InvoiceSiteSectionData) => void;
  onRemove: () => void;
}

/**
 * One ADDITIONAL site's billing section within a combined invoice — see the "combine invoicing"
 * design (Invoice.additionalSiteBills / InvoiceSiteBill in types.ts): a single invoice can bill
 * several sites of the same multi-site tender together, laid out "grouped by site" (one invoice
 * number, one PDF, each site its own labeled section with its own subtotal, rolling up into one
 * grand total on the parent InvoiceGenerator).
 *
 * Deliberately narrower than the primary site's own editor in InvoiceGenerator.tsx: this site's
 * billing-rate categories and equipment catalog are shown READ-ONLY here, auto-derived exactly
 * the way InvoiceGenerator derives them for its primary site (this site's own siteDetails doc
 * when it has one, else the tender's top-level Guard Rate/equipment, else this site's own saved
 * Duty Roster billingRates/equipmentRates) — catalog management stays in Project Details or a
 * standalone single-site invoice, not re-typed per combined invoice. What IS fully editable here
 * is the actual billing for this month: which locations/categories/headcount/days to bill, and
 * which equipment rows — mirroring InvoiceGenerator's own line-item editor row for row so the two
 * behave identically to someone filling them out.
 *
 * Reports its billing data up to the parent via onChange whenever it changes; the parent folds it
 * into the combined invoice's overall totals, live preview, and createInvoice() call. Purely
 * local state otherwise — nothing here writes to Firestore itself (not even a "Save categories"
 * button, unlike the primary site's editor) until the parent's own Save/Generate saves the whole
 * invoice.
 */
export default function InvoiceSiteSection({ site, billingMonthValue, billingMonth, onChange, onRemove }: InvoiceSiteSectionProps) {
  const [rateCatalog, setRateCatalog] = useState<SiteBillingRate[]>(site.billingRates || []);
  const [rateSourceIsOwnSite, setRateSourceIsOwnSite] = useState(false);
  const [equipmentCatalog, setEquipmentCatalog] = useState<SiteEquipmentRate[]>(site.equipmentRates || []);
  const [tenderEquipment, setTenderEquipment] = useState<TenderEquipmentItem[]>([]);

  const [lineGroups, setLineGroups] = useState<InvoiceLineGroup[]>([]);
  const [equipmentRows, setEquipmentRows] = useState<InvoiceEquipmentRow[]>([]);
  const [discrepancyAcknowledged, setDiscrepancyAcknowledged] = useState(false);

  const { confirmed: confirmedSummary } = useConfirmedMonthSummary(site.id, billingMonthValue);

  // Load this site's own rate/equipment catalog — same derivation InvoiceGenerator's site-switch
  // effect uses for its primary site, scoped to this one additional site.
  useEffect(() => {
    setDiscrepancyAcknowledged(false);
    setRateCatalog(site.billingRates || []);
    setRateSourceIsOwnSite(false);
    if (!site.tenderId) {
      setTenderEquipment([]);
      return;
    }
    const tenderId = site.tenderId;
    let cancelled = false;
    Promise.all([getDoc(doc(db, 'tenders', tenderId)), getTenderSiteDetails(tenderId, site.id)])
      .then(([snap, siteDetails]) => {
        if (cancelled || !snap.exists()) return;
        const t = snap.data() as {
          guardRateMode?: 'same' | 'multiple';
          guardRate?: number;
          guardRatePositions?: { name: string; rate: number }[];
          additionalEquipment?: TenderEquipmentItem[];
        };
        const rateSource = siteDetails ?? t;
        const derived = deriveRateCategoriesFromGuardRate(rateSource);
        if (derived) {
          setRateCatalog(derived);
          setRateSourceIsOwnSite(!!siteDetails);
        }
        setTenderEquipment((siteDetails ? siteDetails.additionalEquipment : t.additionalEquipment) || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, site.tenderId]);

  // Re-derive the equipment catalog for whichever billing month is on screen — same eligibility
  // window (startDate arrived, stoppedDate not yet passed) InvoiceGenerator's own effect uses.
  useEffect(() => {
    const eligible = tenderEquipment.filter(
      (eq) => eq.startDate.slice(0, 7) <= billingMonthValue && (!eq.stoppedDate || eq.stoppedDate.slice(0, 7) >= billingMonthValue)
    );
    setEquipmentCatalog(
      eligible.length > 0
        ? eligible.map((eq) => ({ item: eq.item, monthlyRate: eq.monthlyRate, quantity: eq.quantity }))
        : site.equipmentRates || []
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderEquipment, billingMonthValue, site.equipmentRates]);

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
    const firstRate = rateCatalog[0];
    setLineGroups((prev) =>
      prev.map((g, i) =>
        i === gi
          ? {
              ...g,
              rows: [
                ...g.rows,
                { category: firstRate?.category || '', headcount: 0, days: 0, rate: firstRate?.hourlyRate || 0, amount: 0 },
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
    const match = rateCatalog.find((r) => r.category === category);
    updateRow(gi, ri, { category, rate: match ? match.hourlyRate : 0 });
  }

  function addEquipmentRow() {
    const first = equipmentCatalog[0];
    const quantity = first?.quantity || 0;
    const monthlyRate = first?.monthlyRate || 0;
    setEquipmentRows((prev) => [...prev, { item: first?.item || '', quantity, monthlyRate, amount: quantity * monthlyRate }]);
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
  function handleEquipmentItemChange(i: number, item: string) {
    const match = equipmentCatalog.find((r) => r.item === item);
    updateEquipmentRow(i, { item, monthlyRate: match ? match.monthlyRate : 0, quantity: match?.quantity || 0 });
  }

  /** Same cap InvoiceGenerator's own remainingHeadcountFor enforces for its primary site — see
   *  its doc comment there. Scoped to this site's own guardCount/lineGroups only, since each
   *  additional site's headcount is capped against its OWN Client Site Requirement, independent
   *  of every other site on this same combined invoice. */
  function remainingHeadcountFor(gi: number, ri: number): number | null {
    if (site.guardCount == null) return null;
    const row = lineGroups[gi]?.rows[ri];
    if (row && isAdditionalGuardCategory(row.category)) return null;
    const usedByOthers = lineGroups.reduce(
      (sum, g, i) =>
        sum +
        g.rows.reduce(
          (s, r, j) => s + (i === gi && j === ri ? 0 : isAdditionalGuardCategory(r.category) ? 0 : r.headcount || 0),
          0
        ),
      0
    );
    return Math.max(0, site.guardCount - usedByOthers);
  }

  const subTotal = sumLineGroups(lineGroups) + sumEquipmentRows(equipmentRows);

  const lineManHours = lineGroups.reduce(
    (sum, g) => sum + g.rows.reduce((s, r) => s + r.headcount * r.days * INVOICE_HOURS_PER_SHIFT, 0),
    0
  );
  const remainingManHours = confirmedSummary ? confirmedSummary.manHours - lineManHours : null;
  const remainingAmount = confirmedSummary ? confirmedSummary.amount - subTotal : null;
  const hasDiscrepancy =
    remainingAmount != null && remainingManHours != null
    && (Math.abs(remainingAmount) > 0.01 || Math.abs(remainingManHours) > 0.05);

  const totalHeadcount = lineGroups.reduce(
    (sum, g) => sum + g.rows.reduce((s, r) => s + (isAdditionalGuardCategory(r.category) ? 0 : r.headcount || 0), 0),
    0
  );
  const siteGuardCount = site.guardCount ?? null;
  const headcountExceedsSite = siteGuardCount != null && totalHeadcount > siteGuardCount;

  const canSave =
    (lineGroups.length > 0 || equipmentRows.length > 0)
    && (!hasDiscrepancy || discrepancyAcknowledged)
    && !headcountExceedsSite;

  // Report this site's billing data up to InvoiceGenerator whenever anything relevant changes —
  // it folds this into the combined invoice's totals/preview/save the same way it already does
  // for its own primary-site state. onChange is intentionally left out of the deps below (it's a
  // fresh function identity from the parent every render) so this only re-fires when this site's
  // OWN data actually changes, never as a side effect of the parent re-rendering.
  useEffect(() => {
    onChange({ siteId: site.id, siteName: site.name, lineGroups, equipmentRows, subTotal, canSave });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, site.name, lineGroups, equipmentRows, subTotal, canSave]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{site.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">Additional site combined onto this invoice.</p>
        </div>
        <button
          onClick={onRemove}
          className="shrink-0 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded px-2.5 py-1 border border-rose-200"
        >
          Remove site
        </button>
      </div>

      <div>
        <p className="text-xs font-medium text-slate-500 mb-1">Billing rate categories</p>
        <p className="text-xs text-slate-400 mb-2">
          {rateSourceIsOwnSite
            ? "Pulled from this site's own Guard Rate (Active Projects > Project Details > this site's card) — edit it there to change these."
            : "Pulled from this project's Guard Rate, or this site's own saved Duty Roster rates if not — edit those there to change these."}
        </p>
        <div className="space-y-1">
          {rateCatalog.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1 text-slate-700">{r.category}</span>
              <span className="text-slate-500">RM {r.hourlyRate.toFixed(2)} / hour</span>
            </div>
          ))}
          {rateCatalog.length === 0 && (
            <p className="text-xs text-slate-400">No rate categories set for this site yet.</p>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-slate-500 mb-1">Equipment / add-on rates</p>
        <div className="space-y-1">
          {equipmentCatalog.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1 text-slate-700">{r.item}</span>
              <span className="text-slate-500">
                RM {r.monthlyRate.toFixed(2)} / month × {r.quantity || 0}
              </span>
            </div>
          ))}
          {equipmentCatalog.length === 0 && (
            <p className="text-xs text-slate-400">No equipment declared for this site.</p>
          )}
        </div>
      </div>

      {confirmedSummary ? (
        <div className={`rounded-lg px-3 py-2 text-sm ${hasDiscrepancy ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
          <p className="font-medium">
            Confirmed: {confirmedSummary.manHours.toFixed(1)} man-hours · RM {confirmedSummary.amount.toFixed(2)} for{' '}
            {billingMonth || billingMonthValue}
          </p>
          <p className="text-xs mt-0.5 opacity-80">
            Remaining after line items: {remainingManHours!.toFixed(1)} man-hours · RM {remainingAmount!.toFixed(2)}
            {hasDiscrepancy ? ' — acknowledge below to include this site anyway.' : ' — matches the confirmed roster.'}
          </p>
          {hasDiscrepancy && (
            <label className="flex items-start gap-2 mt-2 text-xs">
              <input
                type="checkbox"
                checked={discrepancyAcknowledged}
                onChange={(e) => setDiscrepancyAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span>I acknowledge this discrepancy for {site.name} and want to include it anyway.</span>
            </label>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          Not yet confirmed on Duty Roster for {billingMonth || billingMonthValue} for this site. Invoicing can still
          proceed without one.
        </p>
      )}

      {siteGuardCount != null && (
        <div className={`rounded-lg px-3 py-2 text-sm ${headcountExceedsSite ? 'bg-rose-50 text-rose-800' : 'bg-slate-50 text-slate-600'}`}>
          <p className="font-medium">
            Headcount: {totalHeadcount} / {siteGuardCount} guard post{siteGuardCount === 1 ? '' : 's'} required at this
            site
          </p>
          {headcountExceedsSite && (
            <p className="text-xs mt-0.5 opacity-90">Reduce the headcount below before this invoice can be saved.</p>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-slate-500">Line items</p>
          <button
            onClick={addLineGroup}
            className="text-xs font-medium text-blue-700 hover:bg-blue-50 rounded px-2.5 py-1 border border-blue-200"
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
                        {rateCatalog.map((r) => (
                          <option key={r.category} value={r.category}>
                            {r.category}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="pr-2 py-1">
                      <input
                        type="number"
                        value={row.headcount === 0 ? '' : row.headcount}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/^0+(?=\d)/, '');
                          let parsed = raw === '' ? 0 : Number(raw) || 0;
                          const remaining = remainingHeadcountFor(gi, ri);
                          if (remaining != null) parsed = Math.min(parsed, remaining);
                          updateRow(gi, ri, { headcount: parsed });
                        }}
                        max={remainingHeadcountFor(gi, ri) ?? undefined}
                        className="input w-full"
                      />
                    </td>
                    <td className="pr-2 py-1">
                      <input
                        type="number"
                        step="0.5"
                        value={row.days === 0 ? '' : row.days}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/^0+(?=\d)/, '');
                          updateRow(gi, ri, { days: raw === '' ? 0 : Number(raw) || 0 });
                        }}
                        className="input w-full"
                      />
                    </td>
                    <td className="pr-2 py-1">
                      <input
                        type="number"
                        step="0.01"
                        value={row.rate === 0 ? '' : row.rate}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/^0+(?=\d)/, '');
                          updateRow(gi, ri, { rate: raw === '' ? 0 : Number(raw) || 0 });
                        }}
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

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-slate-500">Equipment / add-ons</p>
          <button
            onClick={addEquipmentRow}
            className="text-xs font-medium text-blue-700 hover:bg-blue-50 rounded px-2.5 py-1 border border-blue-200"
          >
            + Add equipment
          </button>
        </div>
        {equipmentRows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="font-medium pb-1">Item</th>
                <th className="font-medium pb-1 w-24">Quantity</th>
                <th className="font-medium pb-1 w-28">Rate / month</th>
                <th className="font-medium pb-1 w-28 text-right">Amount</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {equipmentRows.map((row, i) => (
                <tr key={i}>
                  <td className="pr-2 py-1">
                    <select
                      value={row.item}
                      onChange={(e) => handleEquipmentItemChange(i, e.target.value)}
                      className="input w-full"
                    >
                      <option value="">Select…</option>
                      {equipmentCatalog.map((r) => (
                        <option key={r.item} value={r.item}>
                          {r.item}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="pr-2 py-1">
                    <input
                      type="number"
                      value={row.quantity === 0 ? '' : row.quantity}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/^0+(?=\d)/, '');
                        updateEquipmentRow(i, { quantity: raw === '' ? 0 : Number(raw) || 0 });
                      }}
                      className="input w-full"
                    />
                  </td>
                  <td className="pr-2 py-1">
                    <input
                      type="number"
                      step="0.01"
                      value={row.monthlyRate === 0 ? '' : row.monthlyRate}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/^0+(?=\d)/, '');
                        updateEquipmentRow(i, { monthlyRate: raw === '' ? 0 : Number(raw) || 0 });
                      }}
                      className="input w-full"
                    />
                  </td>
                  <td className="text-right py-1 pr-2">{row.amount.toFixed(2)}</td>
                  <td className="py-1">
                    <button onClick={() => removeEquipmentRow(i)} className="text-xs text-rose-500 hover:text-rose-700">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {equipmentRows.length === 0 && <p className="text-xs text-slate-400">No equipment added yet.</p>}
      </div>

      <div className="flex justify-end border-t border-slate-100 pt-3">
        <p className="text-sm font-semibold text-slate-700">
          Subtotal for {site.name}: RM {subTotal.toFixed(2)}
        </p>
      </div>
    </div>
  );
}
