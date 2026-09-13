import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import GenerateInvoiceHost from '../components/branch-collection/GenerateInvoiceHost';
import InvoiceList from '../components/branch-collection/InvoiceList';
import DebtorList from '../components/branch-collection/DebtorList';
import RevenuePanel from '../components/branch-collection/RevenuePanel';

const ALL_TABS = ['Generate Invoice', 'Invoices', 'Debtor List', 'Revenue'] as const;
type Tab = (typeof ALL_TABS)[number];

export default function BranchCollectionPage() {
  const { profile } = useAuth();
  // Finance reaches this page (see hideFromFinance everywhere else in App.tsx) but only for
  // Invoices/Debtor List/Revenue — it can record payments there same as branchManager (see
  // isFinance() in firestore.rules), but never creates a new invoice, so Generate Invoice
  // stays out of reach entirely rather than just unused.
  const tabs = useMemo<readonly Tab[]>(
    () => (profile?.role === 'finance' ? ALL_TABS.filter((t) => t !== 'Generate Invoice') : ALL_TABS),
    [profile?.role]
  );
  const [tab, setTab] = useState<Tab>(profile?.role === 'finance' ? 'Invoices' : 'Generate Invoice');

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10 no-print">
        <h1 className="text-lg font-semibold text-slate-900">Branch Collection</h1>
        <p className="text-sm text-slate-500 mb-4">
          Generate client invoices from Duty Roster data and track what's outstanding.
        </p>
        <div className="flex gap-1">
          {tabs.map((t) => (
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
          <GenerateInvoiceHost />
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
