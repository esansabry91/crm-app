import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import clsx from 'clsx';

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition',
    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
  );

export default function AppLayout({ children }: { children: ReactNode }) {
  const { profile, logout } = useAuth();

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="px-4 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-12 rounded-lg bg-blue-600 text-white flex items-center justify-center font-semibold text-xs">
              IPSB
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 leading-tight">Inter Prominent</p>
              <p className="text-xs text-slate-400 leading-tight">Tender Pipeline CRM</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavLink to="/pipeline" className={navItemClass}>
            <span aria-hidden>🗂️</span> Pipeline
          </NavLink>
          <NavLink to="/analysis" className={navItemClass}>
            <span aria-hidden>📊</span> Performance Analysis
          </NavLink>
          <NavLink to="/active-projects" className={navItemClass}>
            <span aria-hidden>🏗️</span> Active Projects
          </NavLink>
          <NavLink to="/past-projects" className={navItemClass}>
            <span aria-hidden>📦</span> Past Projects
          </NavLink>
          {profile?.role === 'admin' && (
            <NavLink to="/admin" className={navItemClass}>
              <span aria-hidden>⚙️</span> Admin Settings
            </NavLink>
          )}
        </nav>

        <div className="px-4 py-4 border-t border-slate-100">
          <p className="text-sm font-medium text-slate-800 truncate">{profile?.name}</p>
          <p className="text-xs text-slate-400 truncate">
            {profile?.role === 'admin' ? 'HQ Admin' : 'Branch Manager'} · {profile?.department}
          </p>
          <button
            onClick={() => logout()}
            className="mt-3 w-full text-xs font-medium text-slate-500 hover:text-rose-600 border border-slate-200 rounded-lg py-1.5 transition"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}
