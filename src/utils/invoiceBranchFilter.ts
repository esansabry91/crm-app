/**
 * Admin branch dropdowns store a Branch document id (`branches[].id`).
 *
 * Match an invoice when that id equals `invoice.branchId`. Migrated invoices often have
 * `branchName` and no `branchId`; those still match when the name equals the selected
 * branch's name (case- and whitespace-insensitive). A set `branchId` that doesn't equal
 * the filter never falls through to the name — same rule Revenue already used.
 * An empty filter matches every invoice.
 */
export function invoiceMatchesBranchFilter(
  invoice: { branchId?: string | null; branchName?: string | null },
  branchId: string,
  selectedBranchName: string | null | undefined,
): boolean {
  if (!branchId) return true;
  if (invoice.branchId === branchId) return true;
  return (
    !invoice.branchId &&
    !!invoice.branchName &&
    !!selectedBranchName &&
    invoice.branchName.trim().toLowerCase() === selectedBranchName.trim().toLowerCase()
  );
}
