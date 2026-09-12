import { type ReactNode, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminRole } from '../../types';
import clsx from 'clsx';

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition',
    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
  );

/**
 * The nav links + role gating + account footer, shared between the always-visible desktop
 * sidebar and the mobile slide-over drawer below — one copy so the two never drift apart.
 * `onNavigate` fires after a link is clicked, so the mobile drawer can close itself; the
 * desktop sidebar passes a no-op since it has nothing to close.
 */
function NavContent({ onNavigate }: { onNavigate: () => void }) {
  const { profile, logout } = useAuth();

  return (
    <>
      <div className="px-4 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-12 rounded-lg bg-blue-600 text-white flex items-center justify-center font-semibold text-xs">
            IPSB
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 leading-tight">Inter Prominent</p>
            <p className="text-xs text-slate-400 leading-tight">Customer Relationship Management Portal</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {profile?.role !== 'dutyStaff' && profile?.role !== 'payroll' && (
          <>
            <NavLink to="/pipeline" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🗂️</span> Pipeline
            </NavLink>
            <NavLink to="/analysis" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>📊</span> Pipeline Analysis
            </NavLink>
            <NavLink to="/active-projects" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🏗️</span> Active Projects
            </NavLink>
            <NavLink to="/duty-roster" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🗓️</span> Duty Roster
            </NavLink>
            <NavLink to="/guard-bank" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🛡️</span> Guard Bank
            </NavLink>
            <NavLink to="/past-projects" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>📦</span> Past Projects
            </NavLink>
            <NavLink to="/archive" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🗄️</span> Archive
            </NavLink>
            <NavLink to="/quotation-calculator" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🧮</span> Quotation Calculator
            </NavLink>
          </>
        )}
        {profile?.role === 'dutyStaff' && (
          <>
            <NavLink to="/duty-roster" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🗓️</span> Duty Roster
            </NavLink>
            <NavLink to="/guard-bank" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🛡️</span> Guard Bank
            </NavLink>
          </>
        )}
        {profile?.role === 'payroll' && (
          <NavLink to="/duty-roster" className={navItemClass} onClick={onNavigate}>
            <span aria-hidden>🗓️</span> Duty Roster
          </NavLink>
        )}
        {isAdminRole(profile?.role) && (
          <NavLink to="/admin" className={navItemClass} onClick={onNavigate}>
            <span aria-hidden>⚙️</span> Admin Settings
          </NavLink>
        )}
      </nav>

      <div className="px-4 py-4 border-t border-slate-100 shrink-0">
        <p className="text-sm font-medium text-slate-800 truncate">{profile?.name}</p>
        <p className="text-xs text-slate-400 truncate">
          {profile?.role === 'admin'
            ? 'HQ Admin'
            : profile?.role === 'developer'
              ? 'Developer'
              : profile?.role === 'dutyStaff'
                ? 'Staff'
                : profile?.role === 'payroll'
                  ? 'Payroll'
                  : 'Branch Manager'}{' '}
          ·{' '}
          {profile?.department}
        </p>
        <button
          onClick={() => logout()}
          className="mt-3 w-full text-xs font-medium text-slate-500 hover:text-rose-600 border border-slate-200 rounded-lg py-1.5 transition"
        >
          Sign out
        </button>
      </div>
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col lg:flex-row bg-slate-50">
      {/* Mobile top bar — the sidebar's identity strip below lg (this now covers landscape
          phones too, not just portrait, so the panel stays closeable/openable there as well);
          the sidebar itself is hidden entirely below lg in favor of the slide-over drawer opened
          from here. */}
      <header className="lg:hidden shrink-0 flex items-center gap-3 px-4 h-14 border-b border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="p-1.5 -ml-1.5 rounded-lg text-slate-600 hover:bg-slate-100"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="h-8 w-11 rounded-lg bg-blue-600 text-white flex items-center justify-center font-semibold text-[11px] shrink-0">
          IPSB
        </div>
        <p className="text-sm font-semibold text-slate-900 truncate">Inter Prominent CRM</p>
      </header>

      {/* Mobile slide-over drawer — same NavContent as the desktop sidebar, overlaid on top of
          the page instead of permanently taking up width. */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} aria-hidden />
          <aside className="relative w-72 max-w-[85vw] h-full bg-white flex flex-col shadow-xl">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute top-4 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="4" x2="20" y2="20" />
                <line x1="20" y1="4" x2="4" y2="20" />
              </svg>
            </button>
            <NavContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar — same content/behavior as before, just hidden below lg. */}
      <aside className="hidden lg:flex w-60 shrink-0 border-r border-slate-200 bg-white flex-col">
        <NavContent onNavigate={() => {}} />
      </aside>

      <main className="flex-1 min-w-0 min-h-0 overflow-x-hidden">{children}</main>
    </div>
  );
}
