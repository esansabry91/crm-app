/**
 * Branch Manager and Operation Admin can create an invoice, but they can only list and read
 * it when `branchName` equals their department (subscribeInvoices + firestore.rules /invoices).
 * Saving `branchName: ''` — an unassigned Duty Roster site, or a migrated project with no
 * matching Branch record — or saving another branch's name, succeeds, then the invoice never
 * appears. Admin-tier and Finance reads are unscoped, so their previous save behavior stays
 * as it was.
 */

export function isBranchScopedInvoiceRole(role: string | null | undefined): boolean {
  return role === 'branchManager' || role === 'operationAdmin';
}

/** Generate Invoice site picker. Archived sites stay hidden for every role. BM/OA only see
 *  sites already tagged with their department — unassigned sites (`branch == null`) are what
 *  used to persist an empty branchName. */
export function isSelectableInvoiceSite(opts: {
  role: string | null | undefined;
  department: string | null | undefined;
  siteBranch: string | null | undefined;
  archived: boolean;
}): boolean {
  if (opts.archived) return false;
  if (!isBranchScopedInvoiceRole(opts.role)) return true;
  return !!opts.department && opts.siteBranch === opts.department;
}

/**
 * The `branchName` that will be written.
 *
 * `useSourceBranchFallback` is true for Generate Invoice, which already fell back to
 * `site.branch`. It is false for Migrate Invoice, which previously wrote only the matched
 * Branch record's name (or ''). For BM/OA, a source whose branch is exactly their department
 * is still persisted when no Branch record matched, so an own-branch invoice is not dropped.
 *
 * A matched Branch whose name is not `department` — Migrate's branch override, or a Branch
 * doc titled differently from the department — comes back as ''. subscribeInvoices and
 * firestore.rules only return `branchName == department`, so writing that other name
 * succeeds and then hides the invoice. Admin/Finance still take the matched name, then the
 * source fallback, including ''.
 */
export function resolvePersistedBranchName(opts: {
  role: string | null | undefined;
  department: string | null | undefined;
  matchedBranchName: string | null | undefined;
  sourceBranch: string | null | undefined;
  useSourceBranchFallback: boolean;
}): string {
  const scoped = isBranchScopedInvoiceRole(opts.role);
  if (opts.matchedBranchName) {
    if (scoped && opts.matchedBranchName !== opts.department) return '';
    return opts.matchedBranchName;
  }
  if (opts.useSourceBranchFallback && opts.sourceBranch) {
    if (scoped && opts.sourceBranch !== opts.department) return '';
    return opts.sourceBranch;
  }
  if (scoped && opts.department && opts.sourceBranch === opts.department) {
    return opts.department;
  }
  return '';
}

/**
 * Admin/Finance may still persist an empty branchName. BM/OA may persist only their own
 * department: an empty name, or any other branch's name, saves an invoice the list query
 * and rules will not return. `department` is required for those two roles; omitting it
 * refuses the save.
 */
export function branchNameIsPersistable(
  role: string | null | undefined,
  branchName: string,
  department?: string | null,
): boolean {
  if (!isBranchScopedInvoiceRole(role)) return true;
  return !!department && branchName === department;
}
