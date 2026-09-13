import { useState } from 'react';
import clsx from 'clsx';
import InvoiceGenerator from '../components/branch-collection/InvoiceGenerator';
import InvoiceList from '../components/branch-collection/InvoiceList';
import DebtorList from '../components/branch-collection/DebtorList';
import RevenuePanel from '../components/branch-collection/RevenuePanel';

const TABS = ['Generate Invoice', 'Invoices', 'Debtor List', 'Revenue'] as const;

export default function BranchCollectionPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Generate Invoice');

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10 no-print">
        <h1 className="text-lg font-semibold text-slate-900">Branch Collection</h1>
        <p className="text-sm text-slate-500 mb-4">
          Generate client invoices from Duty Roster data and track what's outstanding.
        </p>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-lg transition',
                tab === t ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      <div className="px-6 py-6 max-w-5xl">
        {tab === 'Generate Invoice' ? (
          <InvoiceGenerator />
        ) : tab === 'Invoices' ? (
          <InvoiceList />
        ) : tab === 'Debtor List' ? (
          <DebtorList />
        ) : (
          <RevenuePanel />
        )}
      </div>
    </div>
  );
}
