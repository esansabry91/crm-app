import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { useSitesForBilling, updateSiteBillingRates, updateSiteEquipmentRates } from '../../services/siteBilling';
import { getTenderSiteDetails } from '../../services/tenders';
import { useConfirmedMonthSummary } from '../../services/dutyRosterSummary';
import {
  createInvoice,
  computeLineAmount,
  computeManHourLineAmount,
  sumLineGroups,
  sumEquipmentRows,
  peekNextInvoiceNumber,
  deriveRateCategoriesFromGuardRate,
  INVOICE_HOURS_PER_SHIFT,
  ADDITIONAL_GUARD_CATEGORY,
  isAdditionalGuardCategory,
} from '../../services/invoices';
import InvoicePrintView from './InvoicePrintView';
import InvoiceSiteSection, { type InvoiceSiteSectionData } from './InvoiceSiteSection';
import type { InvoiceBillingMode, InvoiceEquipmentRow, InvoiceLineGroup, SiteBillingRate, SiteEquipmentRate, TenderEquipmentItem } from '../../types';

// Kept in English regardless of app language — this feeds the printed/PDF invoice's own billing-
// month line (see InvoicePrintView), a formal client-facing business document, not app UI. Same
// scope boundary as MigrateInvoiceForm's own identical helper.
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
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { brands } = useBrands();
  const { branches } = useBranches();
  const { sites } = useSitesForBilling(profile);

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
  // Whether this (primary) site's line items are billed headcount * days * a 12-hour shift, or
  // directly by man-hours — see InvoiceBillingMode's doc comment in types.ts. Each additional
  // site combined onto this invoice has its own, independent toggle inside its own
  // InvoiceSiteSection. Switching this recomputes every existing row's amount immediately (see
  // handleBillingModeChange below) rather than leaving stale amounts until each row is re-edited.
  const [billingMode, setBillingMode] = useState<InvoiceBillingMode>('headcount');
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
  // Whether the Guard Rate/equipment just derived came from THIS site's own siteDetails doc
  // (an additional linked site with its own saved rate — see TenderSiteDetails in types.ts) as
  // opposed to the tender's top-level fields (the primary site's own rate, or a fallback for an
  // additional site with no rate saved yet). Purely for the caption text below — the actual
  // derivation logic lives in the site-switch effect.
  const [rateSourceIsOwnSite, setRateSourceIsOwnSite] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  // When both guard hours and equipment are on this invoice, bill them as two separate invoices
  // (two invoice numbers) instead of one combined one — see handleSave below. Meaningless (and
  // hidden) whenever only one of the two is present, since there'd be nothing to split.
  const [splitInvoice, setSplitInvoice] = useState(false);

  // "Combine invoicing" — see InvoiceSiteBill's doc comment in types.ts. Extra sites (besides the
  // primary `site` selected above) billed together on this same invoice, one labeled section
  // each with its own subtotal. additionalSiteIds is the order they were added in; each site's
  // actual billing data streams in from its own InvoiceSiteSection via onChange, keyed by id, so
  // a section that hasn't reported in yet (or was just added) simply isn't folded into the totals
  // until it has. Mutually exclusive with splitInvoice below — see its own doc comment.
  const [additionalSiteIds, setAdditionalSiteIds] = useState<string[]>([]);
  const [additionalBillsById, setAdditionalBillsById] = useState<Record<string, InvoiceSiteSectionData>>({});

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
    setRateSourceIsOwnSite(false);
    setRatesSaved(false);
    // A combined-invoice site list built for the PREVIOUS primary site makes no sense once the
    // primary site itself changes — the "+ Add another site" picker only offers siblings of
    // whichever site is selected up top, so start fresh here the same way the rate/equipment
    // state above does.
    setAdditionalSiteIds([]);
    setAdditionalBillsById({});
    setEquipmentRateDraft(site?.equipmentRates || []);
    setEquipmentRatesSaved(false);
    if (site?.tenderId) {
      const tenderId = site.tenderId;
      const thisSiteId = site.id;
      // Independent reads, not Promise.all — a branch that manages this specific site but
      // doesn't own the parent tender (see ProjectDetailsModal.tsx's "Managing Branch" picker
      // and firestore.rules' canAssignSiteBranchViaTender()) can read this site's own
      // siteDetails doc without being able to read the parent tender doc at all. Promise.all
      // would reject the whole load — leaving brand/client/rate/equipment completely blank —
      // the instant the tender-doc half alone hit permission-denied, even though the siteDetails
      // half (denormalized with exactly the fields a delegated branch needs to invoice its own
      // site — see TenderSiteDetails' doc comment in types.ts) came back fine.
      const tenderPromise = getDoc(doc(db, 'tenders', tenderId)).catch(() => null);
      // This site's own tenders/{tenderId}/siteDetails/{siteId} doc, if it has one — see
      // TenderSiteDetails in types.ts. Only an ADDITIONAL linked site (never the primary one)
      // ever has one, and only once its Guard Rate/Equipment have actually been saved there.
      const siteDetailsPromise = getTenderSiteDetails(tenderId, thisSiteId).catch(() => null);
      Promise.all([tenderPromise, siteDetailsPromise]).then(([snap, siteDetails]) => {
        const tenderData = snap && snap.exists()
          ? (snap.data() as {
              brandId?: string;
              clientName?: string;
              clientAlias?: string;
              clientAddress?: string;
              tenderDocNumber?: string;
              guardRateMode?: 'same' | 'multiple';
              guardRate?: number;
              guardRatePositions?: { name: string; rate: number }[];
              additionalEquipment?: TenderEquipmentItem[];
            })
          : null;
        if (!tenderData && !siteDetails) return;
        const brandId = tenderData?.brandId || siteDetails?.brandId;
        const clientNameValue = tenderData?.clientName || siteDetails?.clientName;
        if (brandId) setBrandId(brandId);
        if (clientNameValue) setClientName(clientNameValue);
        setClientAlias(tenderData?.clientAlias || siteDetails?.clientAlias || '');
        setClientAddress(tenderData?.clientAddress || siteDetails?.clientAddress || '');
        setContractRef(tenderData?.tenderDocNumber || siteDetails?.tenderDocNumber || '');

        // Billing rate categories mirror this project's own Guard Rate (Active Projects >
        // Project Details) whenever one's been configured there, instead of being retyped a
        // second time here — see deriveRateCategoriesFromGuardRate's doc comment. For a
        // multi-site project, the tender's own top-level guardRateMode/guardRate/
        // guardRatePositions/additionalEquipment belong to its PRIMARY site only (see
        // TenderSiteDetails' doc comment in types.ts) — an ADDITIONAL site with its own saved
        // siteDetails doc uses THAT instead, so its invoice reflects its own rate rather than
        // silently inheriting the primary site's. Falls back to the tender's top-level fields
        // (same as before this distinction existed) for the primary site itself, or for an
        // additional site that hasn't had its own rate/equipment saved yet — and, when the
        // tender doc itself is unreadable, to whatever siteDetails alone has.
        const rateSource = siteDetails ?? tenderData;
        if (rateSource) {
          const derived = deriveRateCategoriesFromGuardRate(rateSource);
          if (derived) {
            setRateDraft(derived);
            setRatesFromGuardRate(true);
            setRateSourceIsOwnSite(!!siteDetails);
          }
        }
        setTenderEquipment((siteDetails ? siteDetails.additionalEquipment : tenderData?.additionalEquipment) || []);
      });
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
  // TenderEquipmentItem's doc comment), AND only through the month it was stopped in, inclusive
  // (see TenderEquipmentItem.stoppedDate's doc comment in types.ts — the stop month itself still
  // counts as billed, same convention stopTenderEquipmentItem() uses for its own value reversal)
  // — so switching Billing Month can itself flip which source is in effect, unlike Guard Rate
  // above which never depends on the month.
  useEffect(() => {
    const eligible = tenderEquipment.filter(
      (eq) =>
        eq.startDate.slice(0, 7) <= billingMonthValue &&
        (!eq.stoppedDate || eq.stoppedDate.slice(0, 7) >= billingMonthValue)
    );
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
                  manHours: 0,
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
  function handleCategoryChange(gi: number, ri: number, category: string) {
    const match = rateDraft.find((r) => r.category === category);
    updateRow(gi, ri, { category, rate: match ? match.hourlyRate : 0 });
  }

  /** Switches this site's billing mode AND immediately recomputes every already-typed row's
   *  amount under the new formula — without this, a row entered under one mode would keep
   *  showing its old (now-wrong) amount until it happened to be edited again. */
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

  /** Adds a new location group pre-filled with one row per category from the Duty Roster
   *  Summary Report's confirmed breakdown (confirmedSummary.categories — see
   *  computeCategoryBreakdown()'s doc comment in src/duty-roster/payrollMath.ts) — category,
   *  headcount and man-hours all pulled straight from what was actually confirmed, rate looked
   *  up from this site's own rate categories where the name matches. Purely a convenience
   *  starting point: every pulled value stays a normal editable cell afterward (same inputs,
   *  same updateRow), and this never touches any group/row already on screen — it only adds a
   *  new one, so pulling twice (or after manually editing) never clobbers anything; the location
   *  name is left blank for the user to fill in. No-op when there's nothing confirmed yet. */
  function handlePullFromConfirmed() {
    if (!confirmedSummary?.categories?.length) return;
    const rows = confirmedSummary.categories.map((c) => {
      const match = rateDraft.find((r) => r.category === c.category);
      const rate = match ? match.hourlyRate : 0;
      return {
        category: c.category,
        headcount: c.headcount,
        days: 0,
        manHours: c.manHours,
        rate,
        amount: computeManHourLineAmount(c.manHours, rate),
      };
    });
    setLineGroups((prev) => [...prev, { location: '', rows }]);
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

  // This site's own subtotal — kept separate from the combined `subTotal` below because the
  // Duty Roster discrepancy check further down compares THIS site's confirmed roster against
  // THIS site's own line items, never against other sites combined onto the same invoice (each
  // additional site reconciles against its own confirmed roster independently, inside its own
  // InvoiceSiteSection).
  const primarySubTotal = sumLineGroups(lineGroups) + sumEquipmentRows(equipmentRows);
  // Every additional site combined onto this invoice — see additionalSiteIds/additionalBillsById
  // above and InvoiceSiteSection's onChange. A site that was just added (or hasn't reported in
  // yet) simply isn't in here until it does.
  const additionalBills = additionalSiteIds
    .map((id) => additionalBillsById[id])
    .filter((b): b is InvoiceSiteSectionData => !!b);
  const additionalSubTotal = additionalBills.reduce((sum, b) => sum + b.subTotal, 0);
  const subTotal = primarySubTotal + additionalSubTotal;
  const sstAmount = subTotal * sstRate;
  const total = subTotal + sstAmount;

  // Man-hours implied by the line items so far — headcount * days * the same 12-hour shift
  // computeLineAmount() bills at — compared against the Duty Roster-confirmed total (if any) so
  // a branch manager can see whether what's been typed in actually reconciles with the roster
  // before generating the invoice. Purely a discrepancy check: neither figure overrides the
  // other, and the invoice itself only ever saves what's in lineGroups.
  const lineManHours = lineGroups.reduce(
    (sum, g) =>
      sum +
      g.rows.reduce(
        (s, r) => s + (billingMode === 'manhour' ? r.manHours || 0 : r.headcount * r.days * INVOICE_HOURS_PER_SHIFT),
        0
      ),
    0
  );
  const remainingManHours = confirmedSummary ? confirmedSummary.manHours - lineManHours : null;
  const remainingAmount = confirmedSummary ? confirmedSummary.amount - primarySubTotal : null;
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
  const headcountExceedsSite = billingMode === 'headcount' && siteGuardCount != null && totalHeadcount > siteGuardCount;

  // Every additional site that's been added must itself be ready to bill (has content, and no
  // blocking discrepancy/headcount issue of its own — see InvoiceSiteSection's own canSave) —
  // an added-but-empty site would otherwise print a labeled section with nothing in it.
  const additionalSitesValid = additionalSiteIds.every((id) => additionalBillsById[id]?.canSave === true);

  // Sites eligible to be combined onto this invoice via "+ Add another site" below — siblings of
  // the primary `site` sharing its tenderId (the same multi-site project) AND its branch,
  // excluding the primary site itself, archived sites, and ones already added. The branch match
  // matters now that a multi-site project's additional sites can be delegated to a DIFFERENT
  // branch than the project's own (see ProjectDetailsModal.tsx's "Managing Branch" picker and
  // firestore.rules' canAssignSiteBranchViaTender()) — without it, one combined invoice (one
  // invoice number, one branch-coded sequence — see services/invoices.ts) could end up billing
  // a site that isn't this branch's to invoice at all. Empty (and the picker hidden) whenever
  // the primary site has no linked tender or no other same-branch linked sites — same as before
  // this feature existed.
  const combinableSites = site
    ? sites.filter(
        (s) =>
          s.tenderId &&
          s.tenderId === site.tenderId &&
          s.id !== site.id &&
          s.branch === site.branch &&
          !s.archived &&
          !additionalSiteIds.includes(s.id)
      )
    : [];

  const canSave = !!(
    profile && brand && site && clientName.trim()
    && (lineGroups.length > 0 || equipmentRows.length > 0 || additionalSiteIds.length > 0)
    && (!hasDiscrepancy || discrepancyAcknowledged)
    && !headcountExceedsSite
    && additionalSitesValid
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
        billingMode,
        billingMonthKey: billingMonthValue,
        contractRef: contractRef.trim(),
        quotationNo: quotationNo.trim(),
        paymentTermsDays,
        sstRate,
        signatoryName: signatoryName.trim(),
        signatoryTitle: signatoryTitle.trim(),
      };

      // additionalSiteBills carries every combined site's own billing over to createInvoice() —
      // see InvoiceSiteBill's doc comment in types.ts. Only ever non-empty when additionalSiteIds
      // is, which itself gates splitInvoice off below (splitting by guard-hours/equipment doesn't
      // extend to "grouped by site" combined invoicing — see splitInvoice's own doc comment and
      // the checkbox's visibility condition further down).
      const additionalSiteBillsInput = additionalBills.map((b) => ({
        siteId: b.siteId,
        siteName: b.siteName,
        lineGroups: b.lineGroups,
        equipmentRows: b.equipmentRows,
        billingMode: b.billingMode,
      }));

      // Only actually splits when there's something on both sides to split — a lone guard-hours
      // or lone equipment invoice saves as one invoice regardless of the checkbox, same as
      // before this feature existed. Never splits when any additional site is combined onto this
      // invoice — those always save as one combined invoice, matching the "one invoice number,
      // one PDF" design.
      if (splitInvoice && additionalSiteIds.length === 0 && lineGroups.length > 0 && equipmentRows.length > 0) {
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
          text: t('branchCollection.invoiceGenerator.splitSaveSuccess', {
            guardNo: guardResult.invoiceNo,
            equipmentNo: equipmentResult.invoiceNo,
          }),
          isError: false,
        });
      } else {
        const result = await createInvoice(
          {
            ...shared,
            lineGroups,
            equipmentRows,
            additionalSiteBills: additionalSiteBillsInput,
            discrepancyAmount: remainingAmount,
            discrepancyAcknowledged,
          },
          actor
        );
        setSaveMessage({ text: t('branchCollection.invoiceGenerator.saveSuccess', { invoiceNo: result.invoiceNo }), isError: false });
      }
      setLineGroups([]);
      setEquipmentRows([]);
      setAdditionalSiteIds([]);
      setAdditionalBillsById({});
      setPreviewNonce((n) => n + 1);
    } catch (err) {
      setSaveMessage({ text: err instanceof Error ? err.message : t('branchCollection.migrateInvoiceForm.errorCouldNotSave'), isError: true });
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
            {t('branchCollection.invoiceGenerator.backToEditing')}
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
            {t('branchCollection.invoiceList.printSaveAsPdf')}
          </button>
        </div>
        {brand && (
          <InvoicePrintView
            data={{
              brand,
              invoiceNo: previewInvoiceNo || t('branchCollection.invoiceGenerator.assignedWhenSaved'),
              invoiceDate,
              clientName,
              clientAddress,
              attnName,
              quotationNo,
              contractRef,
              paymentTermsDays,
              billingMonth,
              siteName: site?.name || '',
              billingMode,
              lineGroups,
              equipmentRows,
              additionalSiteBills: additionalBills,
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
        <h3 className="text-sm font-semibold text-slate-800 mb-3">{t('branchCollection.migrateInvoiceForm.sectionInvoiceDetails')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.invoiceGenerator.dutyRosterSiteLabel')}</label>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="input w-full">
              <option value="">{t('branchCollection.invoiceGenerator.selectSitePlaceholder')}</option>
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
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.invoiceGenerator.brandIssuingCompanyLabel')}</label>
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="input w-full">
              <option value="">{t('branchCollection.migrateInvoiceForm.selectBrandPlaceholder')}</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.migrateInvoiceForm.clientNameLabel')}</label>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="input w-full" placeholder={t('branchCollection.invoiceGenerator.clientNameExamplePlaceholder')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.migrateInvoiceForm.attnLabel')}</label>
            <input value={attnName} onChange={(e) => setAttnName(e.target.value)} className="input w-full" placeholder={t('branchCollection.invoiceGenerator.attnExamplePlaceholder')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.migrateInvoiceForm.clientAddressLabel')}</label>
            <textarea value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} className="input w-full" rows={2} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.migrateInvoiceForm.invoiceNoLabel')}</label>
            <div className="input w-full bg-slate-50 text-slate-600 flex items-center justify-between gap-2">
              <span className="font-medium">{previewInvoiceNo || t('branchCollection.invoiceGenerator.selectSiteBrandClientFirst')}</span>
              {previewInvoiceNo && <span className="text-[11px] text-slate-400 whitespace-nowrap">{t('branchCollection.invoiceGenerator.autoGenerated')}</span>}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {t('branchCollection.invoiceGenerator.invoiceNoFormatHint')}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.migrateInvoiceForm.invoiceDateLabel')}</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.invoiceGenerator.billingMonthForDescriptionLabel')}</label>
            <input type="month" value={billingMonthValue} onChange={(e) => setBillingMonthValue(e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.migrateInvoiceForm.paymentTermsLabel')}</label>
            <input type="number" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(Number(e.target.value) || 0)} className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.migrateInvoiceForm.quotationNoLabel')}</label>
            <input value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} className="input w-full" placeholder="-" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.invoiceGenerator.contractRefFullLabel')}</label>
            <input value={contractRef} onChange={(e) => setContractRef(e.target.value)} className="input w-full" placeholder={t('branchCollection.invoiceGenerator.contractRefAutoFilledPlaceholder')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.migrateInvoiceForm.sstRateLabel')}</label>
            <select value={sstRate} onChange={(e) => setSstRate(Number(e.target.value))} className="input w-full">
              <option value={0.08}>8%</option>
              <option value={0.06}>6%</option>
              <option value={0}>{t('branchCollection.migrateInvoiceForm.sstExempt')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.invoiceGenerator.signatoryNameLabel')}</label>
            <input value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} className="input w-full" placeholder={t('branchCollection.invoiceGenerator.signatoryNameExamplePlaceholder')} />
            {site && !matchedBranch && (
              <p className="text-xs text-slate-400 mt-1">
                {t('branchCollection.invoiceGenerator.noSavedSignatory', {
                  branch: site.branch || t('branchCollection.invoiceGenerator.thisSitesBranchFallback'),
                })}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('branchCollection.invoiceGenerator.signatoryTitleLabel')}</label>
            <input value={signatoryTitle} onChange={(e) => setSignatoryTitle(e.target.value)} className="input w-full" placeholder={t('branchCollection.invoiceGenerator.signatoryTitleExamplePlaceholder')} />
          </div>
        </div>
      </div>

      {site && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{t('branchCollection.invoiceGenerator.billingRateCategoriesFor', { site: site.name })}</h3>
              <p className="text-xs text-slate-400 mt-0.5 mb-3">
                {ratesFromGuardRate
                  ? rateSourceIsOwnSite
                    ? t('branchCollection.invoiceSiteSection.rateSourceOwnSite')
                    : t('branchCollection.invoiceGenerator.rateSourceProjectOnly')
                  : t('branchCollection.invoiceGenerator.setOnceReusedEveryMonth')}
                {' '}{t('branchCollection.invoiceGenerator.additionalGuardCategoryNote')}
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
                  {t('branchCollection.invoiceGenerator.addCategory')}
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
                    {t('branchCollection.invoiceGenerator.addAdditionalGuardTemporary')}
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
                  <span className="text-slate-500">{t('branchCollection.invoiceSiteSection.perHour', { rate: r.hourlyRate.toFixed(2) })}</span>
                </div>
              ) : (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={r.category}
                    onChange={(e) =>
                      setRateDraft((prev) => prev.map((row, j) => (j === i ? { ...row, category: e.target.value } : row)))
                    }
                    placeholder={t('branchCollection.invoiceGenerator.categoryExamplePlaceholder')}
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
                  <span className="text-xs text-slate-400">{t('branchCollection.invoiceGenerator.perHourSuffix')}</span>
                  <button
                    onClick={() => setRateDraft((prev) => prev.filter((_, j) => j !== i))}
                    className="text-xs text-rose-500 hover:text-rose-700 shrink-0"
                  >
                    {t('branchCollection.common.remove')}
                  </button>
                </div>
              )
            )}
            {rateDraft.length === 0 && <p className="text-xs text-slate-400">{t('branchCollection.invoiceGenerator.noCategoriesYet')}</p>}
          </div>
          {!ratesFromGuardRate && (
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={handleSaveRates}
                disabled={ratesSaving}
                className="px-3 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
              >
                {ratesSaving ? t('branchCollection.common.savingEllipsis') : t('branchCollection.invoiceGenerator.saveCategoriesRates')}
              </button>
              {ratesSaved && <span className="text-xs text-emerald-600">{t('branchCollection.invoiceGenerator.savedConfirmation')}</span>}
            </div>
          )}
        </div>
      )}

      {site && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{t('branchCollection.invoiceGenerator.equipmentAddonRatesFor', { site: site.name })}</h3>
              <p className="text-xs text-slate-400 mt-0.5 mb-3">
                {equipmentFromTender
                  ? rateSourceIsOwnSite
                    ? t('branchCollection.invoiceGenerator.equipmentDeclaredOwnSite')
                    : t('branchCollection.invoiceGenerator.equipmentDeclaredProject')
                  : t('branchCollection.invoiceGenerator.recurringMonthlyItemsNote')}
              </p>
            </div>
            {!equipmentFromTender && (
              <button
                onClick={() => setEquipmentRateDraft((prev) => [...prev, { item: '', monthlyRate: 0, quantity: 0 }])}
                className="shrink-0 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded px-2.5 py-1 border border-blue-200"
              >
                {t('branchCollection.invoiceGenerator.addItem')}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {equipmentRateDraft.map((r, i) =>
              equipmentFromTender ? (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-slate-700">{r.item}</span>
                  <span className="text-slate-500">
                    {t('branchCollection.invoiceSiteSection.perMonthTimes', { rate: r.monthlyRate.toFixed(2), qty: r.quantity || 0 })}
                  </span>
                </div>
              ) : (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={r.item}
                    onChange={(e) =>
                      setEquipmentRateDraft((prev) => prev.map((row, j) => (j === i ? { ...row, item: e.target.value } : row)))
                    }
                    placeholder={t('branchCollection.invoiceGenerator.itemExamplePlaceholder')}
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
                  <span className="text-xs text-slate-400">{t('branchCollection.invoiceGenerator.perMonthSuffix')}</span>
                  <span className="text-xs text-slate-400 pl-2">{t('branchCollection.invoiceGenerator.qtyLabel')}</span>
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
                    title={t('branchCollection.invoiceGenerator.qtyTitleHint')}
                  />
                  <button
                    onClick={() => setEquipmentRateDraft((prev) => prev.filter((_, j) => j !== i))}
                    className="text-xs text-rose-500 hover:text-rose-700 shrink-0"
                  >
                    {t('branchCollection.common.remove')}
                  </button>
                </div>
              )
            )}
            {equipmentRateDraft.length === 0 && (
              <p className="text-xs text-slate-400">
                {equipmentFromTender ? t('branchCollection.invoiceGenerator.noEquipmentDeclaredYet') : t('branchCollection.invoiceGenerator.noEquipmentItemsYet')}
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
                {equipmentRatesSaving ? t('branchCollection.common.savingEllipsis') : t('branchCollection.invoiceGenerator.saveEquipmentRates')}
              </button>
              {equipmentRatesSaved && <span className="text-xs text-emerald-600">{t('branchCollection.invoiceGenerator.savedConfirmation')}</span>}
            </div>
          )}
        </div>
      )}

      {site && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-800">{t('branchCollection.invoiceGenerator.dutyRosterReconciliation')}</h3>
          {confirmedSummary ? (
            <>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">
                {t('branchCollection.invoiceGenerator.confirmedByFor', {
                  name: confirmedSummary.byName || t('branchCollection.invoiceGenerator.confirmedByFallbackSomeone'),
                  month: billingMonth || billingMonthValue,
                })}{' '}
                <span className="font-medium text-slate-700">
                  {t('branchCollection.invoiceGenerator.manHoursAndAmount', {
                    manHours: confirmedSummary.manHours.toFixed(1),
                    amount: confirmedSummary.amount.toFixed(2),
                  })}
                </span>
              </p>
              {!!confirmedSummary.additionalManHours && (
                <p className="text-xs text-slate-500 -mt-2 mb-3">
                  {t('branchCollection.invoiceGenerator.plusAdditionalManHours', { hours: confirmedSummary.additionalManHours.toFixed(1) })}
                </p>
              )}
              <div className={`rounded-lg px-3 py-2 text-sm ${hasDiscrepancy ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
                <p className="font-medium">
                  {t('branchCollection.invoiceSiteSection.remainingAfterLineItems', {
                    manHours: remainingManHours!.toFixed(1),
                    amount: remainingAmount!.toFixed(2),
                  })}
                </p>
                <p className="text-xs mt-0.5 opacity-80">
                  {hasDiscrepancy
                    ? t('branchCollection.invoiceGenerator.discrepancyExplanation')
                    : t('branchCollection.invoiceGenerator.matchesConfirmedRosterTotal')}
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
                    {t('branchCollection.invoiceGenerator.acknowledgeDiscrepancyGeneral')}
                  </span>
                </label>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-400 mt-0.5">
              {t('branchCollection.invoiceGenerator.notYetConfirmedGeneral', { month: billingMonth || billingMonthValue })}
            </p>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{t('branchCollection.contentEditor.lineItems')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {billingMode === 'manhour'
                ? t('branchCollection.invoiceGenerator.lineItemsDescManHour')
                : t('branchCollection.invoiceGenerator.lineItemsDescHeadcount')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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
            {billingMode === 'manhour' && !!confirmedSummary?.categories?.length && (
              <button
                onClick={handlePullFromConfirmed}
                className="text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded px-2.5 py-1 border border-emerald-200"
              >
                {t('branchCollection.invoiceSiteSection.pullFromConfirmedSummary')}
              </button>
            )}
            <button
              onClick={addLineGroup}
              className="text-xs font-medium text-blue-700 hover:bg-blue-50 rounded px-2.5 py-1 border border-blue-200"
            >
              {t('branchCollection.contentEditor.addLocation')}
            </button>
          </div>
        </div>

        {/* Hard cap, not a soft warning like the Duty Roster reconciliation above — a headcount
            that exceeds the site's Client Site Requirement is always a data-entry mistake, so
            there's no acknowledge-and-override here (see headcountExceedsSite's doc comment and
            canSave). Only shown once the site's requirement is known (see BillingSite.guardCount)
            — a site with no Client Site Requirement configured yet behaves exactly as before this
            feature existed. */}
        {billingMode === 'headcount' && siteGuardCount != null && (
          <div
            className={`rounded-lg px-3 py-2 text-sm mb-3 ${
              headcountExceedsSite ? 'bg-rose-50 text-rose-800' : 'bg-slate-50 text-slate-600'
            }`}
          >
            <p className="font-medium">
              {t('branchCollection.invoiceSiteSection.headcountRequired', { used: totalHeadcount, count: siteGuardCount })}
            </p>
            {headcountExceedsSite && (
              <p className="text-xs mt-0.5 opacity-90">
                {t('branchCollection.invoiceGenerator.headcountExceedsSiteDetail', { count: siteGuardCount })}
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
                placeholder={t('branchCollection.invoiceSiteSection.locationExamplePlaceholder')}
                className="input flex-1 font-medium"
              />
              <button onClick={() => removeLineGroup(gi)} className="text-xs text-rose-500 hover:text-rose-700 shrink-0">
                {t('branchCollection.contentEditor.removeLocation')}
              </button>
            </div>

            <table className="w-full text-sm mb-2">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="font-medium pb-1">{t('branchCollection.contentEditor.colCategory')}</th>
                  {billingMode === 'manhour' ? (
                    <>
                      <th className="font-medium pb-1 w-28">{t('branchCollection.contentEditor.colManHours')}</th>
                      <th className="font-medium pb-1 w-24">{t('branchCollection.contentEditor.colHeadcount')}</th>
                    </>
                  ) : (
                    <>
                      <th className="font-medium pb-1 w-24">{t('branchCollection.contentEditor.colHeadcount')}</th>
                      <th className="font-medium pb-1 w-24">{t('branchCollection.contentEditor.colDays')}</th>
                    </>
                  )}
                  <th className="font-medium pb-1 w-24">{t('branchCollection.contentEditor.colRate')}</th>
                  <th className="font-medium pb-1 w-28 text-right">{t('branchCollection.contentEditor.colAmount')}</th>
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
                        <option value="">{t('branchCollection.invoiceSiteSection.selectPlaceholder')}</option>
                        {rateDraft.map((r) => (
                          <option key={r.category} value={r.category}>
                            {r.category}
                          </option>
                        ))}
                      </select>
                    </td>
                    {billingMode === 'manhour' ? (
                      <>
                        <td className="pr-2 py-1">
                          <input
                            type="number"
                            step="0.5"
                            value={row.manHours === 0 || row.manHours == null ? '' : row.manHours}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/^0+(?=\d)/, '');
                              updateRow(gi, ri, { manHours: raw === '' ? 0 : Number(raw) || 0 });
                            }}
                            className="input w-full"
                          />
                        </td>
                        <td className="pr-2 py-1">
                          <input
                            type="number"
                            value={row.headcount === 0 ? '' : row.headcount}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/^0+(?=\d)/, '');
                              updateRow(gi, ri, { headcount: raw === '' ? 0 : Number(raw) || 0 });
                            }}
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
                      </>
                    )}
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
        {lineGroups.length === 0 && <p className="text-xs text-slate-400">{t('branchCollection.invoiceSiteSection.noLocationsAddedYet')}</p>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{t('branchCollection.contentEditor.equipmentAddons')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('branchCollection.invoiceGenerator.equipmentAddonsDesc')}
            </p>
          </div>
          <button
            onClick={addEquipmentRow}
            className="shrink-0 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded px-2.5 py-1 border border-blue-200"
          >
            {t('branchCollection.contentEditor.addEquipment')}
          </button>
        </div>
        {equipmentRows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="font-medium pb-1">{t('branchCollection.contentEditor.colItem')}</th>
                <th className="font-medium pb-1 w-24">{t('branchCollection.contentEditor.colQuantity')}</th>
                <th className="font-medium pb-1 w-28">{t('branchCollection.contentEditor.colRatePerMonth')}</th>
                <th className="font-medium pb-1 w-28 text-right">{t('branchCollection.contentEditor.colAmount')}</th>
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
                      <option value="">{t('branchCollection.invoiceSiteSection.selectPlaceholder')}</option>
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
                      {t('branchCollection.common.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {equipmentRows.length === 0 && <p className="text-xs text-slate-400">{t('branchCollection.invoiceSiteSection.noEquipmentAddedYet')}</p>}
      </div>

      {site && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-800">{t('branchCollection.invoiceGenerator.combineOtherSites')}</h3>
          <p className="text-xs text-slate-400 mt-0.5 mb-3">
            {t('branchCollection.invoiceGenerator.combineOtherSitesDesc', { site: site.name })}
          </p>
          {combinableSites.length > 0 ? (
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) setAdditionalSiteIds((prev) => [...prev, id]);
              }}
              className="input w-full"
            >
              <option value="">{t('branchCollection.invoiceGenerator.addASitePlaceholder')}</option>
              {combinableSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.branch ? `(${s.branch})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-slate-400">
              {site.tenderId
                ? t('branchCollection.invoiceGenerator.noOtherSitesToAdd')
                : t('branchCollection.invoiceGenerator.noLinkedProjectToCombine')}
            </p>
          )}
        </div>
      )}

      {additionalSiteIds.map((id) => {
        const additionalSite = sites.find((s) => s.id === id);
        if (!additionalSite) return null;
        return (
          <InvoiceSiteSection
            key={id}
            site={additionalSite}
            billingMonthValue={billingMonthValue}
            billingMonth={billingMonth}
            onChange={(data) => setAdditionalBillsById((prev) => ({ ...prev, [id]: data }))}
            onRemove={() => {
              setAdditionalSiteIds((prev) => prev.filter((x) => x !== id));
              setAdditionalBillsById((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
              });
            }}
          />
        );
      })}

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex justify-end">
          <table className="text-sm">
            <tbody>
              <tr>
                <td className="pr-6 text-slate-500">{t('branchCollection.contentEditor.subTotal')}</td>
                <td className="text-right w-32">RM {subTotal.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="pr-6 text-slate-500">{t('branchCollection.invoiceGenerator.sstAtPercent', { pct: Math.round(sstRate * 100) })}</td>
                <td className="text-right">RM {sstAmount.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="pr-6 font-semibold">{t('branchCollection.invoiceGenerator.totalInclusiveOfSst')}</td>
                <td className="text-right font-semibold">RM {total.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {lineGroups.length > 0 && equipmentRows.length > 0 && additionalSiteIds.length === 0 && (
          <label className="flex items-start gap-2 mt-3 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={splitInvoice}
              onChange={(e) => setSplitInvoice(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t('branchCollection.invoiceGenerator.splitInvoiceLabel')}
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
            {t('branchCollection.invoiceGenerator.previewButton')}
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-3.5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
          >
            {saving ? t('branchCollection.common.savingEllipsis') : t('branchCollection.invoiceGenerator.saveInvoiceButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
