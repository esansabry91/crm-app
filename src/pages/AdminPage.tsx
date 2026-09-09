import { useState } from 'react';
import clsx from 'clsx';
import BranchBrandManager from '../components/admin/BranchBrandManager';
import UserManager from '../components/admin/UserManager';
import DepartmentRepairTool from '../components/admin/DepartmentRepairTool';

const TABS = ['Team', 'Branches & Brands', 'Data Repair'] as const;

export default function AdminPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Team');

  return (
    <div className="h-screen overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-slate-900">Admin Settings</h1>
        <p className="text-sm text-slate-500 mb-4">Manage your team, branches and brands.</p>
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
        {tab === 'Team' ? (
          <UserManager />
        ) : tab === 'Branches & Brands' ? (
          <BranchBrandManager />
        ) : (
          <DepartmentRepairTool />
        )}
      </div>
    </div>
  );
}
