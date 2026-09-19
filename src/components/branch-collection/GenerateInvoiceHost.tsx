import { useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import InvoiceGenerator from './InvoiceGenerator';
import MigrateInvoiceForm from './MigrateInvoiceForm';

type Mode = 'new' | 'migrate';

/**
 * The "Generate Invoice" tab's own small mode switch — the normal Duty Roster-driven generator
 * (InvoiceGenerator) versus a lighter form for migrating a historical invoice that has no Duty
 * Roster site but is tied to an Active Project (MigrateInvoiceForm). Kept as a separate host
 * rather than folding the toggle into InvoiceGenerator itself, since the two flows share almost
 * nothing beyond both producing an Invoice doc.
 */
export default function GenerateInvoiceHost() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('new');

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        <button
          onClick={() => setMode('new')}
          className={clsx(
            'px-3 py-1.5 text-sm font-medium rounded-lg transition',
            mode === 'new' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'
          )}
        >
          {t('branchCollection.generateInvoiceHost.newInvoice')}
        </button>
        <button
          onClick={() => setMode('migrate')}
          className={clsx(
            'px-3 py-1.5 text-sm font-medium rounded-lg transition',
            mode === 'migrate' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'
          )}
        >
          {t('branchCollection.generateInvoiceHost.addHistoricalInvoice')}
        </button>
      </div>
      {mode === 'new' ? <InvoiceGenerator /> : <MigrateInvoiceForm />}
    </div>
  );
}
