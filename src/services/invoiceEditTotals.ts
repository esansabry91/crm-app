/**
 * Pre-SST subtotal for a limited invoice edit. `primarySubTotal` is the edited primary site
 * (line groups + equipment). Each additional site's stored subTotal is added unchanged — the
 * same rollup createInvoice() uses. Those extra site bills are not part of the edit, but leaving
 * them out collapses a combined invoice to the primary site while additionalSiteBills stay on
 * the document.
 */
export function computeInvoiceEditSubTotal(
  primarySubTotal: number,
  additionalSiteBills: { subTotal?: number }[] | undefined
): number {
  const additionalSubTotal = (additionalSiteBills || []).reduce((sum, bill) => sum + (bill.subTotal || 0), 0);
  return primarySubTotal + additionalSubTotal;
}
