import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import GenerateInvoiceHost from '../components/branch-collection/GenerateInvoiceHost';
import InvoiceList from '../components/branch-collection/InvoiceList';
import DebtorList from '../components/branch-collection/DebtorList';
import RevenuePanel from '../components/branch-collection/RevenuePanel';

const ALL_TABS = ['Generate Invoice', 'Invoices', 'Debtor List', 'Revenue'] as const;
type Tab = (typeof ALL_TABS)[number];

// Tab ids stay the fixed English literals above (internal state/switch values) — only the
// on-screen label is translated, matching the same convention used for TaskPriority/TabId
// elsewhere in this app.
const TAB_LABEL_KEYS: Record<Tab, string> = {
  'Generate Invoice': 'branchCollection.tabs.generateInvoice',
  Invoices: 'branchCollection.tabs.invoices',
  'Debtor List': 'branchCollection.tabs.debtorList',
  Revenue: 'branchCollection.tabs.revenue',
};

export default function BranchCollectionPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  // Finance reaches this page (see hideFromFinance everywhere else in App.tsx) but only for
  // Invoices/Debtor List/Revenue — it can record payments there same as branchManager (see
  // isFinance() in firestore.rules), but never creates a new invoice, so Generate Invoice
  // stays out of reach entirely rather than just unused.
  const tabs = useMemo<readonly Tab[]>(
    () => (profile?.role === 'finance' ? ALL_TABS.filter((tabId) => tabId !== 'Generate Invoice') : ALL_TABS),
    [profile?.role]
  );
  const [tab, setTab] = useState<Tab>(profile?.role === 'finance' ? 'Invoices' : 'Generate Invoice');

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10 no-print">
        <h1 className="text-lg font-semibold text-slate-900">{t('nav.links.invoicesRevenue')}</h1>
        <p className="text-sm text-slate-500 mb-4">{t('branchCollection.pageSubtitle')}</p>
        <div className="flex gap-1">
          {tabs.map((tabId) => (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-lg transition',
                tab === tabId ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'
              )}
            >
              {t(TAB_LABEL_KEYS[tabId])}
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
