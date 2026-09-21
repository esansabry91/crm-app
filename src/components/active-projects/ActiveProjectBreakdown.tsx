import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Tender } from '../../types';
import { formatRM } from '../../utils/format';

interface BreakdownRow {
  key: string;
  count: number;
  value: number;
  guards: number;
}

function summarize(items: Tender[], keyOf: (tender: Tender) => string, unassignedLabel: string): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const item of items) {
    const key = keyOf(item) || unassignedLabel;
    const row = map.get(key) || { key, count: 0, value: 0, guards: 0 };
    row.count += 1;
    row.value += item.tenderValue || 0;
    row.guards += item.guardsDeployed || 0;
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => b.value - a.value);
}

function BreakdownTable({
  title,
  sub,
  firstColLabel,
  rows,
  t,
}: {
  title: string;
  sub: string;
  firstColLabel: string;
  rows: BreakdownRow[];
  t: TFunction;
}) {
  const totalCount = rows.reduce((sum, r) => sum + r.count, 0);
  const totalValue = rows.reduce((sum, r) => sum + r.value, 0);
  const totalGuards = rows.reduce((sum, r) => sum + r.guards, 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">{t('activeProjects.noActiveProjects')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2 font-medium">{firstColLabel}</th>
                <th className="px-4 py-2 font-medium text-right">{t('activeProjects.activeProjectsColumn')}</th>
                <th className="px-4 py-2 font-medium text-right">{t('activeProjects.guardsDeployed')}</th>
                <th className="px-4 py-2 font-medium text-right">{t('activeProjects.totalValueColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2 font-medium text-slate-800">{r.key}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{r.count}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{r.guards}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-800">
                    {formatRM(r.value)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-100 bg-slate-50/60">
                <td className="px-4 py-2 font-medium text-slate-500">{t('activeProjects.totalRow')}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-700">
                  {totalCount}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-700">
                  {totalGuards}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">
                  {formatRM(totalValue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Breaks down a set of active projects by brand — total count, guards deployed, and value per
 * brand. `items` is expected to already be scoped to whatever the caller wants shown: for staff
 * that's always their own branch; for admins it's either every branch or whichever one branch
 * they've picked in the page's branch filter, so this same table serves both the "by brand for my
 * branch" and the "by brand across branches / for a selected branch" requirements without needing
 * separate logic.
 */
export function BrandBreakdown({ items, scopeLabel }: { items: Tender[]; scopeLabel: string }) {
  const { t } = useTranslation();
  const unassignedLabel = t('activeProjects.unassigned');
  const rows = useMemo(() => summarize(items, (tender) => tender.brandName, unassignedLabel), [items, unassignedLabel]);
  return (
    <BreakdownTable
      title={t('activeProjects.byBrand')}
      sub={t('activeProjects.byBrandSub', { scope: scopeLabel })}
      firstColLabel={t('activeProjects.brandColumn')}
      rows={rows}
      t={t}
    />
  );
}

/**
 * Breaks down active projects by branch — count, guards deployed, and value per branch,
 * firm-wide. Admin/HQ only (branch-scoped staff only ever have one branch to show). Deliberately
 * computed from the FULL unfiltered project list rather than the page's branch-filtered `visible`
 * list, so it always gives the cross-branch overview regardless of which single branch is
 * currently selected in the row-level filter above the detail table.
 */
export function BranchBreakdown({ items }: { items: Tender[] }) {
  const { t } = useTranslation();
  const unassignedLabel = t('activeProjects.unassigned');
  const rows = useMemo(
    () => summarize(items, (tender) => tender.activeBranch || tender.department, unassignedLabel),
    [items, unassignedLabel]
  );
  return (
    <BreakdownTable
      title={t('activeProjects.byBranch')}
      sub={t('activeProjects.byBranchSub')}
      firstColLabel={t('activeProjects.branchColumn')}
      rows={rows}
      t={t}
    />
  );
}
