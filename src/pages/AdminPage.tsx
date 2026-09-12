import { useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import BranchBrandManager from '../components/admin/BranchBrandManager';
import UserManager from '../components/admin/UserManager';
import DepartmentRepairTool from '../components/admin/DepartmentRepairTool';
import TestingDataTool from '../components/admin/TestingDataTool';

const ALL_TABS = ['Team', 'Branches & Brands', 'Data Repair', 'Testing Data'] as const;
type Tab = (typeof ALL_TABS)[number];

export default function AdminPage() {
  const { profile } = useAuth();
  // Testing Data is deliberately restricted to the 'developer' role only — not even a real HQ
  // Admin account gets it (see isDeveloper() in firestore.rules, which backs this up server-side
  // for the Testing Mode toggle itself). Keeping the toggle and the "Delete all test data" tool
  // out of reach for every other role is what stops production data from ever being touched by
  // it, deliberately or by accident.
  const isDeveloper = profile?.role === 'developer';
  const TABS = isDeveloper ? ALL_TABS : ALL_TABS.filter((t) => t !== 'Testing Data');

  const [tab, setTab] = useState<Tab>('Team');

  return (
    <div className="h-full overflow-y-auto">
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
        ) : tab === 'Data Repair' ? (
          <DepartmentRepairTool />
        ) : tab === 'Testing Data' && isDeveloper ? (
          <TestingDataTool />
        ) : null}
      </div>
    </div>
  );
}
