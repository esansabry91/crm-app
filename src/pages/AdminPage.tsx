import { useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import BranchBrandManager from '../components/admin/BranchBrandManager';
import UserManager from '../components/admin/UserManager';
import DepartmentRepairTool from '../components/admin/DepartmentRepairTool';
import TestingDataTool from '../components/admin/TestingDataTool';

const ALL_TABS = ['Team', 'Branches & Brands', 'Data Repair', 'Testing Data'] as const;
type Tab = (typeof ALL_TABS)[number];

const TAB_LABEL_KEYS: Record<Tab, string> = {
  'Team': 'admin.tabs.team',
  'Branches & Brands': 'admin.tabs.branchesAndBrands',
  'Data Repair': 'admin.tabs.dataRepair',
  'Testing Data': 'admin.tabs.testingData',
};

export default function AdminPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  // Testing Data is deliberately restricted to the 'developer' role only — not even a real HQ
  // Admin account gets it (see isDeveloper() in firestore.rules, which backs this up server-side
  // for the Testing Mode toggle itself). Keeping the toggle and the "Delete all test data" tool
  // out of reach for every other role is what stops production data from ever being touched by
  // it, deliberately or by accident.
  const isDeveloper = profile?.role === 'developer';
  // A Branch Manager reaches Admin Settings now too (see the /admin route's allowBranchManager
  // prop in App.tsx), but only ever for the Team tab — adding/managing their own branch's
  // Operation Staff (see UserManager.tsx and firestore.rules' /users rules for the matching
  // server-side scoping). Branches & Brands, Data Repair, and Testing Data stay admin-only.
  const isBranchManagerRole = profile?.role === 'branchManager';
  const TABS: Tab[] = isBranchManagerRole
    ? ['Team']
    : isDeveloper
      ? [...ALL_TABS]
      : ALL_TABS.filter((tabOption) => tabOption !== 'Testing Data');

  const [tab, setTab] = useState<Tab>('Team');

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-slate-900">{t('admin.title')}</h1>
        <p className="text-sm text-slate-500 mb-4">
          {isBranchManagerRole ? t('admin.subtitleBranchManager') : t('admin.subtitleDefault')}
        </p>
        <div className="flex gap-1">
          {TABS.map((tabOption) => (
            <button
              key={tabOption}
              onClick={() => setTab(tabOption)}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-lg transition',
                tab === tabOption ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'
              )}
            >
              {t(TAB_LABEL_KEYS[tabOption])}
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
