/**
 * Wraps the standalone Quotation Calculator (public/quotation-calculator/index.html) in an
 * <iframe>, the same way DutyRosterPage.tsx wraps the Duty Roster console — a separate,
 * self-contained vanilla-JS app (its own Firestore reads/writes, its own rendering) rather than
 * a page ported into React. It shares this CRM's Firebase project and picks up the same
 * signed-in user automatically; see the comment block at the top of index.html for how.
 *
 * Routing already restricts this page to admin + branchManager + developer (see the
 * /quotation-calculator route in App.tsx, and isAdminRole() in src/types.ts for why developer
 * counts as admin-equivalent everywhere); index.html itself re-checks the signed-in user's role
 * before showing the calculator, and firestore.rules is the actual enforcement layer for the
 * saved-quotations data (isAdmin() there already covers developer — see its own doc comment).
 */
export default function QuotationCalculatorPage() {
  return (
    <div className="h-full">
      <iframe
        src="/quotation-calculator/index.html"
        title="Quotation Calculator"
        className="w-full h-full border-0 block"
      />
    </div>
  );
}
