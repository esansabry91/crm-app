import QuotationCalculator from '../quotation-calculator/QuotationCalculator';

/**
 * Quotation Calculator route. This used to wrap public/quotation-calculator/index.html — a
 * separate, self-contained vanilla-JS app — in an <iframe>, the same way DutyRosterPage.tsx once
 * wrapped the Duty Roster console before that was ported to React. It's now a real part of this
 * CRM's React tree instead; see src/quotation-calculator/QuotationCalculator.tsx and its sibling
 * modules for the port, and their doc comments for how each piece maps back to the original.
 *
 * Routing already restricts this page to admin + branchManager + developer + ceo/director/
 * tenderController (see the /quotation-calculator route in App.tsx, and isAdminRole() in
 * src/types.ts for why the latter three count as admin-equivalent everywhere); firestore.rules'
 * /quotations block is the real enforcement layer for the saved-quotations data.
 */
export default function QuotationCalculatorPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-5">
        <QuotationCalculator />
      </div>
    </div>
  );
}
