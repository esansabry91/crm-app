import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { useSitesForBilling, updateSiteBillingRates, updateSiteEquipmentRates } from '../../services/siteBilling';
import { useConfirmedMonthSummary } from '../../services/dutyRosterSummary';
import {
  createInvoice,
  computeLineAmount,
  sumLineGroups,
  sumEquipmentRows,
  peekNextInvoiceNumber,
  INVOICE_HOURS_PER_SHIFT,
  ADDITIONAL_GUARD_CATEGORY,
  isAdditionalGuardCategory,
} from '../../services/invoices';
import InvoicePrintView from './InvoicePrintView';
import type { InvoiceEquipmentRow, InvoiceLineGroup, SiteBillingRate, SiteEquipmentRate, TenderEquipmentItem } from '../../types';

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

/** Derives this invoice's billing rate categories straight from the linked tender's own Guard
 *  Rate setup (Active Projects > Project Details — see Tender.guardRateMode's doc comment in
 *  types.ts), so the same rate never has to be typed once there and again here. 'multiple' mode
 *  maps each named position directly to a category of the same name/rate; 'same' mode has no
 *  position names to draw from, so it becomes a single "Security Guard" category at the flat
 *  rate. Returns null when the tender has no Guard Rate configured yet (undefined mode, or a
 *  'same' rate of 0) — callers fall back to the site's own saved billingRates in that case, so a
 *  project that hasn't set one up yet keeps working exactly as before. */
function deriveRateCategoriesFromGuardRate(t: {
  guardRateMode?: 'same' | 'multiple';
  guardRate?: number;
  guardRatePositions?: { name: string; rate: number }[];
}): SiteBillingRate[] | null {
  if (t.guardRateMode === 'multiple') {
    const positions = (t.guardRatePositions || []).filter((p) => p.name.trim());
    return positions.length > 0
      ? positions.map((p) => ({ category: p.name, hourlyRate: p.rate }))
      : null;
  }
  if (t.guardRateMode === 'same' && t.guardRate) {
    return [{ category: 'Security Guard', hourlyRate: t.guardRate }];
  }
  return null;
}

/**
 * The Branch Collection tab's invoice-building form. Deliberately semi-manual (see the Rate
 * source / Invoice line entry decisions this was built from): billing-rate categories mirror the
 * linked tender's own Guard Rate (Active Projects > Project Details — see
 * deriveRateCategoriesFromGuardRate above) once one's configured there, falling back to a manual,
 * saved-per-site list otherwise; headcount/days per category and each location's label are still
 * typed in fresh per invoice against the Duty Roster Summary Report (opened in another tab) —
 * nothing here reads guard attendance directly. Amount per row = headcount * days * a 12-hour
 * shift * rate, matching the sample invoices this was modeled on exactly.
 *
 * The invoice number, billing month, client address, contract/PO reference and authorised
 * signatory are all auto-filled from elsewhere (the site's linked Won tender in Active Projects,
 * the site's Branch record, and a running per-brand+branch+client counter) rather than typed in
 * fresh each time — see each field's own comment below for exactly where it's sourced from. Every
 * auto-filled field stays editable (Guard-Rate-sourced billing categories being the one
 * exception, precisely because there's a canonical place to correct those instead), in case the
 * source data isn't set up yet or this particular invoice needs a one-off correction.
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
  // Equipment/add-on rows (e-bikes, drones, etc.) — a separate flat list from lineGroups, see
  // InvoiceEquipmentRow's doc comment in types.ts.
  const [equipmentRows, setEquipmentRows] = useState<InvoiceEquipmentRow[]>([]);
  const [signatoryName, setSignatoryName] = useState('');
  const [signatoryTitle, setSignatoryTitle] = useState('');

  const [rateDraft, setRateDraft] = useState<SiteBillingRate[]>([]);
  const [ratesSaving, setRatesSaving] = useState(false);
  const [ratesSaved, setRatesSaved] = useState(false);
  // Same pattern as rateDraft/ratesSaving/ratesSaved above, for the equipment/add-on rate list.
  // equipmentRateDraft doubles as BOTH the manually-typed site-level fallback catalog AND the
  // read-only display of whatever the linked project's own Project Details has declared (mirrors
  // rateDraft/ratesFromGuardRate's exact pattern) — see the derivation effect below for how it's
  // populated from one source or the other depending on equipmentFromTender.
  const [equipmentRateDraft, setEquipmentRateDraft] = useState<SiteEquipmentRate[]>([]);
  const [equipmentRatesSaving, setEquipmentRatesSaving] = useState(false);
  const [equipmentRatesSaved, setEquipmentRatesSaved] = useState(false);
  // Every equipment item declared on the linked project's Project Details, unfiltered by month —
  // see TenderEquipmentItem's doc comment in types.ts. Re-filtered by billing month in the
  // derivation effect below (unlike Guard Rate, an item's eligibility depends on its own
  // startDate against whichever month is on screen, not just whether one's configured at all).
  const [tenderEquipment, setTenderEquipment] = useState<TenderEquipmentItem[]>([]);
  // Whether equipmentRateDraft currently reflects Project Details (read-only here, "+ Add item"/
  // "Save equipment rates" hidden — manage it there instead) rather than this site's own manual
  // fallback catalog. Same role as ratesFromGuardRate above, but re-evaluated per billing month.
  const [equipmentFromTender, setEquipmentFromTender] = useState(false);
  // Whether the categories currently shown came from the linked tender's Project Details > Guard
  // Rate (see deriveRateCategoriesFromGuardRate below) rather than this site's own manually-typed
  // billingRates — purely so the section below can tell the user where to actually go to change
  // them, instead of them editing here and wondering why it doesn't stick next time they switch
  // sites away and back.
  const [ratesFromGuardRate, setRatesFromGuardRate] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  // When both guard hours and equipment are on this invoice, bill them as two separate invoices
  // (two invoice numbers) instead of one combined one — see handleSave below. Meaningless (and
  // hidden) whenever only one of the two is present, since there'd be nothing to split.
  const [splitInvoice, setSplitInvoice] = useState(false);

  // The invoice number's BRAND/BRANCH segments — a saved short code/nickname when the brand or
  // branch has one set (Admin Settings > Branches & Brands), falling back to the full name
  // otherwise so numbering still works before anyone's filled those in.
  const brandCode = (brand?.shortCode || brand?.name || '').trim();
  const branchCode = (matchedBranch?.shortCode || matchedBranch?.name || site?.branch || '').trim();

  const [previewInvoiceNo, setPreviewInvoiceNo] = useState('');
  const [previewNonce, setPreviewNonce] = useState(0);

  const billingMonth = formatBillingMonth(billingMonthValue);

  // The branch manager/branch staff's confirmed Duty Roster total for this exact site+month —
  // see useConfirmedMonthSummary's doc comment. Reconciled below against the line items as
  // they're entered, purely as a discrepancy check; it never feeds into what actually gets
  // saved (lineGroups stay the source of truth for the invoice itself).
  const { confirmed: confirmedSummary } = useConfirmedMonthSummary(siteId || null, billingMonthValue);
  const [discrepancyAcknowledged, setDiscrepancyAcknowledged] = useState(false);

  // Reset the acknowledgment whenever the site or month changes — an acknowledgment made for
  // one site/month's discrepancy should never silently carry over to a different one.
  useEffect(() => {
    setDiscrepancyAcknowledged(false);
  }, [siteId, billingMonthValue]);

  // Switching sites: load that site's saved rate categories, and — if it's linked to a Won
  // tender — best-effort prefill the brand/client/contract-ref/client-alias/client-address from
  // that tender's Active Projects details so they're not retyped.
  useEffect(() => {
    setRateDraft(site?.billingRates || []);
    setRatesFromGuardRate(false);
    setRatesSaved(false);
    setEquipmentRateDraft(site?.equipmentRates || []);
    setEquipmentRatesSaved(false);
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
            guardRateMode?: 'same' | 'multiple';
            guardRate?: number;
            guardRatePositions?: { name: string; rate: number }[];
            additionalEquipment?: TenderEquipmentItem[];
          };
          if (t.brandId) setBrandId(t.brandId);
          if (t.clientName) setClientName(t.clientName);
          setClientAlias(t.clientAlias || '');
          setClientAddress(t.clientAddress || '');
          setContractRef(t.tenderDocNumber || '');

          // Billing rate categories mirror this project's own Guard Rate (Active Projects >
          // Project Details) whenever one's been configured there, instead of being retyped a
          // second time here — see deriveRateCategoriesFromGuardRate's doc comment. Falls back to
          // whatever's already saved on the site (the pre-existing manual-entry path) for a
          // project that hasn't set a Guard Rate yet.
          const derived = deriveRateCategoriesFromGuardRate(t);
          if (derived) {
            setRateDraft(derived);
            setRatesFromGuardRate(true);
          }
          setTenderEquipment(t.additionalEquipment || []);
        })
        .catch(() => {});
    } else {
      setClientAlias('');
      setContractRef('');
      setTenderEquipment([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // Re-derives equipmentRateDraft/equipmentFromTender whenever the linked project's declared
  // equipment, the billing month, or the site's own manual fallback catalog changes. An item only
  // counts once its startDate has actually arrived for the month on screen (see
  // TenderEquipmentItem's doc comment) — so switching Billing Month can itself flip which source
  // is in effect, unlike Guard Rate above which never depends on the month.
  useEffect(() => {
    const eligible = tenderEquipment.filter((eq) => eq.startDate.slice(0, 7) <= billingMonthValue);
    if (eligible.length > 0) {
      setEquipmentRateDraft(
        eligible.map((eq) => ({ item: eq.item, monthlyRate: eq.monthlyRate, quantity: eq.quantity }))
      );
      setEquipmentFromTender(true);
    } else {
      setEquipmentRateDraft(site?.equipmentRates || []);
      setEquipmentFromTender(false);
    }
    setEquipmentRatesSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderEquipment, billingMonthValue, site?.equipmentRates]);

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

  /** Same as handleSaveRates above, for the equipment/add-on rate list instead. */
  async function handleSaveEquipmentRates() {
    if (!site) return;
    setEquipmentRatesSaving(true);
    setEquipmentRatesSaved(false);
    try {
      const cleaned = equipmentRateDraft
        .map((r) => ({ item: r.item.trim(), monthlyRate: Number(r.monthlyRate) || 0, quantity: Number(r.quantity) || 0 }))
        .filter((r) => r.item);
      await updateSiteEquipmentRates(site.id, cleaned);
      setEquipmentRateDraft(cleaned);
      setEquipmentRatesSaved(true);
    } finally {
      setEquipmentRatesSaving(false);
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

  function addEquipmentRow() {
    const first = equipmentRateDraft[0];
    const quantity = first?.quantity || 0;
    const monthlyRate = first?.monthlyRate || 0;
    setEquipmentRows((prev) => [
      ...prev,
      { item: first?.item || '', quantity, monthlyRate, amount: quantity * monthlyRate },
    ]);
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
    const match = equipmentRateDraft.find((r) => r.item === item);
    updateEquipmentRow(i, { item, monthlyRate: match ? match.monthlyRate : 0, quantity: match?.quantity || 0 });
  }

  /** How much headcount is left to give this one row without pushing the invoice's total past
   *  this site's Client Site Requirement guard-post count (site.guardCount — see BillingSite's
   *  doc comment) — the site's capacity minus every OTHER row's headcount, never below 0. Returns
   *  null when the site has no known requirement (guardCount is null — see its doc comment), when
   *  there's no site at all (nothing to cap against yet, same as before this feature existed), or
   *  when this row is itself the Additional Guard (Temporary) category — that category is always
   *  exempt from this cap (see ADDITIONAL_GUARD_CATEGORY's doc comment), so it's never clamped. */
  function remainingHeadcountFor(gi: number, ri: number): number | null {
    if (!site || site.guardCount == null) return null;
    const row = lineGroups[gi]?.rows[ri];
    if (row && isAdditionalGuardCategory(row.category)) return null;
    const usedByOthers = lineGroups.reduce(
      (sum, g, i) =>
        sum +
        g.rows.reduce(
          (s, r, j) =>
            s + (i === gi && j === ri ? 0 : isAdditionalGuardCategory(r.category) ? 0 : r.headcount || 0),
          0
        ),
      0
    );
    return Math.max(0, site.guardCount - usedByOthers);
  }

  const subTotal = sumLineGroups(lineGroups) + sumEquipmentRows(equipmentRows);
  const sstAmount = subTotal * sstRate;
  const total = subTotal + sstAmount;

  // Man-hours implied by the line items so far — headcount * days * the same 12-hour shift
  // computeLineAmount() bills at — compared against the Duty Roster-confirmed total (if any) so
  // a branch manager can see whether what's been typed in actually reconciles with the roster
  // before generating the invoice. Purely a discrepancy check: neither figure overrides the
  // other, and the invoice itself only ever saves what's in lineGroups.
  const lineManHours = lineGroups.reduce(
    (sum, g) => sum + g.rows.reduce((s, r) => s + r.headcount * r.days * INVOICE_HOURS_PER_SHIFT, 0),
    0
  );
  const remainingManHours = confirmedSummary ? confirmedSummary.manHours - lineManHours : null;
  const remainingAmount = confirmedSummary ? confirmedSummary.amount - subTotal : null;
  const hasDiscrepancy =
    remainingAmount != null && remainingManHours != null
    && (Math.abs(remainingAmount) > 0.01 || Math.abs(remainingManHours) > 0.05);

  // Total headcount typed across every row of every location, capped against how many guard
  // posts the site's Client Site Requirement actually calls for (site.guardCount — see
  // BillingSite's doc comment in services/siteBilling.ts) so an invoice can never bill for more
  // guards than the client's contract covers at this site. Unlike the man-hours reconciliation
  // above, there's no acknowledge-and-override path for this one — a headcount above the
  // contracted post count is always wrong, not just a discrepancy worth double-checking, so
  // updateRow's headcount clamp (below) stops it from ever being typed in the first place; this
  // is a second guard rail on top of that, in case the requirement changes (Guards & Shifts gets
  // edited) after the line items were already entered.
  // Additional Guard (Temporary) rows are deliberately excluded from this sum — see
  // ADDITIONAL_GUARD_CATEGORY's doc comment: that category is for a post ABOVE the site's
  // contracted count, so it must never trip this cap.
  const totalHeadcount = lineGroups.reduce(
    (sum, g) =>
      sum + g.rows.reduce((s, r) => s + (isAdditionalGuardCategory(r.category) ? 0 : r.headcount || 0), 0),
    0
  );
  const siteGuardCount = site?.guardCount ?? null;
  const headcountExceedsSite = siteGuardCount != null && totalHeadcount > siteGuardCount;

  const canSave = !!(
    profile && brand && site && clientName.trim() && (lineGroups.length > 0 || equipmentRows.length > 0)
    && (!hasDiscrepancy || discrepancyAcknowledged)
    && !headcountExceedsSite
  );

  async function handleSave() {
    if (!profile || !brand || !site) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const actor = { uid: profile.uid, name: profile.name, role: profile.role };
      const shared = {
        brandId: brand.id,
        brandName: brand.name,
        brandCode,
        branchId: matchedBranch?.id || null,
        branchName: matchedBranch?.name || site.branch || '',
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
        billingMonthKey: billingMonthValue,
        contractRef: contractRef.trim(),
        quotationNo: quotationNo.trim(),
        paymentTermsDays,
        sstRate,
        signatoryName: signatoryName.trim(),
        signatoryTitle: signatoryTitle.trim(),
      };

      // Only actually splits when there's something on both sides to split — a lone guard-hours
      // or lone equipment invoice saves as one invoice regardless of the checkbox, same as
      // before this feature existed.
      if (splitInvoice && lineGroups.length > 0 && equipmentRows.length > 0) {
        const guardResult = await createInvoice(
          { ...shared, lineGroups, equipmentRows: [], discrepancyAmount: remainingAmount, discrepancyAcknowledged },
          actor
        );
        // The equipment-only invoice has nothing to reconcile against Duty Roster's confirmed
        // man-hours — that discrepancy check is specifically about guard hours — so it's never
        // flagged/acknowledged on this half.
        const equipmentResult = await createInvoice(
          { ...shared, lineGroups: [], equipmentRows, discrepancyAmount: null, discrepancyAcknowledged: false },
          actor
        );
        setSaveMessage({
          text: `Invoices ${guardResult.invoiceNo} (guard hours) and ${equipmentResult.invoiceNo} (equipment) saved — find them in the Invoices tab.`,
          isError: false,
        });
      } else {
        const result = await createInvoice(
          { ...shared, lineGroups, equipmentRows, discrepancyAmount: remainingAmount, discrepancyAcknowledged },
          actor
        );
        setSaveMessage({ text: `Invoice ${result.invoiceNo} saved — find it in the Invoices tab.`, isError: false });
      }
      setLineGroups([]);
      setEquipmentRows([]);
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
            onClick={() => {
              // Swap the tab title to just the invoice number for the duration of printing, so a
              // browser that prints "headers and footers" shows the invoice number rather than
              // this portal's page title. Callers who don't want the browser's header/footer at
              // all still need to turn that off in their print dialog's "More settings" — no CSS
              // can suppress it.
              const prevTitle = document.title;
              document.title = previewInvoiceNo ? `Invoice ${previewInvoiceNo}` : 'Invoice';
              window.print();
              document.title = prevTitle;
            }}
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
              equipmentRows,
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
                {ratesFromGuardRate
                  ? "Pulled from this project's Guard Rate (Active Projects > Project Details) — edit it there to change these."
                  : 'Set once, reused every month — each line row below picks from this list.'}
                {' '}The "Additional Guard (Temporary)" category is exempt from the guard-post
                cap below — use it for an extra post the client asked for beyond this site's
                normal Client Site Requirement, sourced via Duty Roster the same way a
                replacement is (rest-day guard, support guard, or a fresh temporary guard).
              </p>
            </div>
            {/* Guard Rate is the source of truth once it's configured (see
                deriveRateCategoriesFromGuardRate) — no manual add/remove/edit here in that case,
                so nothing typed here can silently drift from it. */}
            {!ratesFromGuardRate && (
              <div className="shrink-0 flex items-center gap-1.5">
                <button
                  onClick={() => setRateDraft((prev) => [...prev, { category: '', hourlyRate: 0 }])}
                  className="text-xs font-medium text-blue-700 hover:bg-blue-50 rounded px-2.5 py-1 border border-blue-200"
                >
                  + Add category
                </button>
                {/* A client sometimes needs an extra guard post beyond this site's contracted
                    Client Site Requirement count for a period — see ADDITIONAL_GUARD_CATEGORY's
                    doc comment in services/invoices.ts. This button adds that EXACT category name
                    (rather than the branch typing it by hand and risking a typo that would keep
                    it from being recognized as exempt below) — a no-op if it's already there. */}
                {!rateDraft.some((r) => isAdditionalGuardCategory(r.category)) && (
                  <button
                    onClick={() =>
                      setRateDraft((prev) => [...prev, { category: ADDITIONAL_GUARD_CATEGORY, hourlyRate: 0 }])
                    }
                    className="text-xs font-medium text-violet-700 hover:bg-violet-50 rounded px-2.5 py-1 border border-violet-200"
                  >
                    + Additional Guard (Temporary)
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            {rateDraft.map((r, i) =>
              ratesFromGuardRate ? (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-slate-700">{r.category}</span>
                  <span className="text-slate-500">RM {r.hourlyRate.toFixed(2)} / hour</span>
                </div>
              ) : (
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
                    value={r.hourlyRate === 0 ? '' : r.hourlyRate}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/^0+(?=\d)/, '');
                      setRateDraft((prev) =>
                        prev.map((row, j) => (j === i ? { ...row, hourlyRate: raw === '' ? 0 : Number(raw) || 0 } : row))
                      );
                    }}
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
              )
            )}
            {rateDraft.length === 0 && <p className="text-xs text-slate-400">No categories yet — add one above.</p>}
          </div>
          {!ratesFromGuardRate && (
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
          )}
        </div>
      )}

      {site && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Equipment / add-on rates for {site.name}</h3>
              <p className="text-xs text-slate-400 mt-0.5 mb-3">
                {equipmentFromTender
                  ? "Declared on this project's own Project Details (each with its own start date) — manage items there, not here. Shown below for the billing month selected above."
                  : 'Recurring monthly items — e-bikes, drones, patrol vehicles and similar — billed alongside guard headcount. Set once, reused every month, same as the guard rate categories above.'}
              </p>
            </div>
            {!equipmentFromTender && (
              <button
                onClick={() => setEquipmentRateDraft((prev) => [...prev, { item: '', monthlyRate: 0, quantity: 0 }])}
                className="shrink-0 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded px-2.5 py-1 border border-blue-200"
              >
                + Add item
              </button>
            )}
          </div>
          <div className="space-y-2">
            {equipmentRateDraft.map((r, i) =>
              equipmentFromTender ? (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-slate-700">{r.item}</span>
                  <span className="text-slate-500">
                    RM {r.monthlyRate.toFixed(2)} / month × {r.quantity || 0}
                  </span>
                </div>
              ) : (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={r.item}
                    onChange={(e) =>
                      setEquipmentRateDraft((prev) => prev.map((row, j) => (j === i ? { ...row, item: e.target.value } : row)))
                    }
                    placeholder="e.g. E-bike"
                    className="input flex-1"
                  />
                  <span className="text-xs text-slate-400">RM</span>
                  <input
                    type="number"
                    step="0.01"
                    value={r.monthlyRate === 0 ? '' : r.monthlyRate}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/^0+(?=\d)/, '');
                      setEquipmentRateDraft((prev) =>
                        prev.map((row, j) => (j === i ? { ...row, monthlyRate: raw === '' ? 0 : Number(raw) || 0 } : row))
                      );
                    }}
                    placeholder="0.00"
                    className="input w-28"
                  />
                  <span className="text-xs text-slate-400">/ month</span>
                  <span className="text-xs text-slate-400 pl-2">Qty</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={r.quantity ? r.quantity : ''}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/^0+(?=\d)/, '');
                      setEquipmentRateDraft((prev) =>
                        prev.map((row, j) => (j === i ? { ...row, quantity: raw === '' ? 0 : Number(raw) || 0 } : row))
                      );
                    }}
                    placeholder="0"
                    className="input w-16"
                    title="Usual monthly quantity — prefills the invoice row, still editable per month."
                  />
                  <button
                    onClick={() => setEquipmentRateDraft((prev) => prev.filter((_, j) => j !== i))}
                    className="text-xs text-rose-500 hover:text-rose-700 shrink-0"
                  >
                    Remove
                  </button>
                </div>
              )
            )}
            {equipmentRateDraft.length === 0 && (
              <p className="text-xs text-slate-400">
                {equipmentFromTender ? 'No equipment declared yet.' : 'No equipment items yet — add one above.'}
              </p>
            )}
          </div>
          {!equipmentFromTender && (
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={handleSaveEquipmentRates}
                disabled={equipmentRatesSaving}
                className="px-3 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
              >
                {equipmentRatesSaving ? 'Saving…' : 'Save equipment rates'}
              </button>
              {equipmentRatesSaved && <span className="text-xs text-emerald-600">Saved.</span>}
            </div>
          )}
        </div>
      )}

      {site && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-800">Duty Roster reconciliation</h3>
          {confirmedSummary ? (
            <>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">
                Confirmed by {confirmedSummary.byName || 'someone'} for {billingMonth || billingMonthValue}:{' '}
                <span className="font-medium text-slate-700">
                  {confirmedSummary.manHours.toFixed(1)} man-hours · RM {confirmedSummary.amount.toFixed(2)}
                </span>
              </p>
              {!!confirmedSummary.additionalManHours && (
                <p className="text-xs text-slate-500 -mt-2 mb-3">
                  Plus {confirmedSummary.additionalManHours.toFixed(1)} man-hours from Duty Roster's "Additional Guard (Temporary)" posts this month — not included above; bill it separately.
                </p>
              )}
              <div className={`rounded-lg px-3 py-2 text-sm ${hasDiscrepancy ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
                <p className="font-medium">
                  Remaining after line items: {remainingManHours!.toFixed(1)} man-hours · RM {remainingAmount!.toFixed(2)}
                </p>
                <p className="text-xs mt-0.5 opacity-80">
                  {hasDiscrepancy
                    ? "This should reach zero once every line item matches the confirmed roster. You can still generate the invoice with a discrepancy — just acknowledge it below."
                    : 'Line items match the confirmed roster total.'}
                </p>
              </div>
              {hasDiscrepancy && (
                <label className="flex items-start gap-2 mt-3 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={discrepancyAcknowledged}
                    onChange={(e) => setDiscrepancyAcknowledged(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I acknowledge this discrepancy between the confirmed Duty Roster total and the line items below, and want to generate the invoice anyway.
                  </span>
                </label>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-400 mt-0.5">
              Not yet confirmed on Duty Roster for {billingMonth || billingMonthValue} — the branch manager/branch staff can click "Confirm for
              invoicing" on that month's Summary Report. Invoicing can still proceed without one.
            </p>
          )}
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

        {/* Hard cap, not a soft warning like the Duty Roster reconciliation above — a headcount
            that exceeds the site's Client Site Requirement is always a data-entry mistake, so
            there's no acknowledge-and-override here (see headcountExceedsSite's doc comment and
            canSave). Only shown once the site's requirement is known (see BillingSite.guardCount)
            — a site with no Client Site Requirement configured yet behaves exactly as before this
            feature existed. */}
        {siteGuardCount != null && (
          <div
            className={`rounded-lg px-3 py-2 text-sm mb-3 ${
              headcountExceedsSite ? 'bg-rose-50 text-rose-800' : 'bg-slate-50 text-slate-600'
            }`}
          >
            <p className="font-medium">
              Headcount: {totalHeadcount} / {siteGuardCount} guard post{siteGuardCount === 1 ? '' : 's'} required at
              this site
            </p>
            {headcountExceedsSite && (
              <p className="text-xs mt-0.5 opacity-90">
                This site's Client Site Requirement (Duty Roster &gt; Guards &amp; Shifts) only calls for{' '}
                {siteGuardCount} guard post{siteGuardCount === 1 ? '' : 's'} — reduce the headcount below before this
                invoice can be saved.
              </p>
            )}
          </div>
        )}

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

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Equipment / add-ons</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Optional — e-bikes, drones and similar items billed this month, on their own or alongside
              the guard line items above. Leave empty for a guard-only invoice.
            </p>
          </div>
          <button
            onClick={addEquipmentRow}
            className="shrink-0 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded px-2.5 py-1 border border-blue-200"
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
                      {equipmentRateDraft.map((r) => (
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

        {lineGroups.length > 0 && equipmentRows.length > 0 && (
          <label className="flex items-start gap-2 mt-3 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={splitInvoice}
              onChange={(e) => setSplitInvoice(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Bill equipment on a separate invoice from guard hours — saves two invoices (two
              invoice numbers) instead of one combined invoice. Preview below still shows the
              combined figures either way.
            </span>
          </label>
        )}

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
