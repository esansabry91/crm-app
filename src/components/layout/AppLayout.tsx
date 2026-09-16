import { type ReactNode, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminRole } from '../../types';
import clsx from 'clsx';

const SIDEBAR_COLLAPSED_KEY = 'ipsb-desktop-sidebar-collapsed';

/** Remembers the desktop sidebar's collapsed/open state across reloads — a per-browser
 *  convenience only, so a read/write failure (private browsing, blocked storage) just falls
 *  back to "open" rather than breaking anything. */
function getStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition',
    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
  );

const SECTION_COLLAPSED_KEY_PREFIX = 'ipsb-desktop-sidebar-section-collapsed:';

/** Mirrors getStoredSidebarCollapsed() above, but per-section — a per-browser convenience only,
 *  so a read/write failure (private browsing, blocked storage) just falls back to "open" rather
 *  than breaking anything. */
function getStoredSectionCollapsed(title: string): boolean {
  try {
    return localStorage.getItem(SECTION_COLLAPSED_KEY_PREFIX + title) === '1';
  } catch {
    return false;
  }
}

/**
 * A colored, click-to-collapse group header above a run of nav links — purely visual/
 * organizational grouping (see NavContent's own sections below), not its own route or
 * permission boundary. Gives each section a shaded background so the segmentation reads at a
 * glance, and lets a user tuck away sections they don't use — each section's open/closed choice
 * is remembered per-browser via localStorage, keyed by its title, so e.g. collapsing "History"
 * stays collapsed across reloads. `first:mt-0` so the very first section in a role's menu
 * doesn't carry the same top gap every later one does.
 */
function NavSection({ title, children }: { title: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => getStoredSectionCollapsed(title));

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SECTION_COLLAPSED_KEY_PREFIX + title, next ? '1' : '0');
      } catch {
        // Best-effort only — the collapsed state still works for this session either way.
      }
      return next;
    });
  };

  return (
    <div className="mt-3 first:mt-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 transition-colors"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={clsx('shrink-0 text-slate-400 transition-transform', collapsed ? '-rotate-90' : 'rotate-0')}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {!collapsed && <div className="pt-1 space-y-1">{children}</div>}
    </div>
  );
}

/**
 * The nav links + role gating + account footer, shared between the always-visible desktop
 * sidebar and the mobile slide-over drawer below — one copy so the two never drift apart.
 * `onNavigate` fires after a link is clicked, so the mobile drawer can close itself; the
 * desktop sidebar passes a no-op since it has nothing to close.
 */
function NavContent({ onNavigate, onCollapse }: { onNavigate: () => void; onCollapse?: () => void }) {
  const { profile, logout } = useAuth();

  return (
    <>
      <div className="px-4 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <img
            src="/logo-icon.png"
            alt="Inter Prominent"
            className="h-9 w-9 rounded-lg object-contain border border-slate-200 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-400 leading-tight">Customer Relationship Management Portal</p>
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="shrink-0 p-1.5 -mr-1.5 rounded-lg text-blue-600 bg-blue-50 hover:bg-blue-100 hover:text-blue-700"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {profile?.role !== 'dutyStaff' &&
          profile?.role !== 'payroll' &&
          profile?.role !== 'finance' &&
          profile?.role !== 'hr' && (
          <>
            <NavSection title="Performance Dashboard">
              <NavLink to="/pipeline" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🗂️</span> Pipeline
              </NavLink>
              <NavLink to="/analysis" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>📊</span> Pipeline Analysis
              </NavLink>
            </NavSection>

            <NavSection title="Branch Operation">
              <NavLink to="/active-projects" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🏗️</span> Active Projects
              </NavLink>
              <NavLink to="/duty-roster" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🗓️</span> Duty Roster
              </NavLink>
            </NavSection>

            {/* "Branch Collection" is now the SECTION title, not the tab itself — see
                BranchCollectionPage.tsx's own header, renamed to match. */}
            <NavSection title="Branch Collection">
              <NavLink to="/branch-collection" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🧾</span> Invoices &amp; Revenue
              </NavLink>
            </NavSection>

            <NavSection title="Human Resource">
              <NavLink to="/guard-bank" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🛡️</span> Guard Bank
              </NavLink>
            </NavSection>

            <NavSection title="History">
              <NavLink to="/past-projects" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>📦</span> Past Projects
              </NavLink>
              <NavLink to="/archive" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🗄️</span> Archive
              </NavLink>
            </NavSection>

            <NavSection title="Tools">
              <NavLink to="/quotation-calculator" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🧮</span> Quotation Calculator
              </NavLink>
            </NavSection>
          </>
        )}
        {profile?.role === 'dutyStaff' && (
          <>
            <NavSection title="Branch Operation">
              <NavLink to="/duty-roster" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🗓️</span> Duty Roster
              </NavLink>
            </NavSection>
            <NavSection title="Human Resource">
              <NavLink to="/guard-bank" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🛡️</span> Guard Bank
              </NavLink>
            </NavSection>
          </>
        )}
        {profile?.role === 'payroll' && (
          <NavSection title="Branch Operation">
            <NavLink to="/duty-roster" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🗓️</span> Duty Roster
            </NavLink>
          </NavSection>
        )}
        {/* HR is Payroll's Duty Roster reach PLUS full Guard Bank access — see the Role doc
            comment in types.ts and isHr()/isPayrollLike() in firestore.rules. */}
        {profile?.role === 'hr' && (
          <>
            <NavSection title="Branch Operation">
              <NavLink to="/duty-roster" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🗓️</span> Duty Roster
              </NavLink>
            </NavSection>
            <NavSection title="Human Resource">
              <NavLink to="/guard-bank" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🛡️</span> Guard Bank
              </NavLink>
            </NavSection>
          </>
        )}
        {profile?.role === 'finance' && (
          <NavSection title="Branch Collection">
            <NavLink to="/branch-collection" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🧾</span> Invoices &amp; Revenue
            </NavLink>
          </NavSection>
        )}
        {/* Admin Settings gets no section title of its own, matching before this restructure —
            now also reachable by a Branch Manager (see the /admin route's allowBranchManager
            prop in App.tsx), scoped there to just the Team tab. Wrapped in the same mt-3
            first:mt-0 spacing NavSection's own wrapper div uses, now that <nav> no longer applies
            space-y-1 uniformly (each NavSection controls its own internal link spacing instead). */}
        {(isAdminRole(profile?.role) || profile?.role === 'branchManager') && (
          <div className="mt-3 first:mt-0">
            <NavLink to="/admin" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>⚙️</span> Admin Settings
            </NavLink>
          </div>
        )}
      </nav>

      <div className="px-4 py-4 border-t border-slate-100 shrink-0">
        <p className="text-sm font-medium text-slate-800 truncate">{profile?.name}</p>
        <p className="text-xs text-slate-400 truncate">
          {profile?.role === 'admin'
            ? 'HQ Admin'
            : profile?.role === 'developer'
              ? 'Developer'
              : profile?.role === 'ceo'
                ? 'CEO'
                : profile?.role === 'director'
                  ? 'Director'
                  : profile?.role === 'tenderController'
                    ? 'Tender Controller'
                    : profile?.role === 'dutyStaff'
                      ? 'Operation Staff'
                      : profile?.role === 'payroll'
                        ? 'Payroll'
                        : profile?.role === 'hr'
                          ? 'HR'
                          : profile?.role === 'finance'
                            ? 'Finance'
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
  const [desktopCollapsed, setDesktopCollapsed] = useState(getStoredSidebarCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, desktopCollapsed ? '1' : '0');
    } catch {
      // Best-effort only — the collapsed state still works for this session either way.
    }
  }, [desktopCollapsed]);

  return (
    <div className="h-screen flex flex-col lg:flex-row bg-slate-50">
      {/* Mobile top bar — the sidebar's identity strip below lg (this now covers landscape
          phones too, not just portrait, so the panel stays closeable/openable there as well);
          the sidebar itself is hidden entirely below lg in favor of the slide-over drawer opened
          from here. */}
      <header className="lg:hidden shrink-0 flex items-center gap-3 px-4 h-14 border-b border-slate-200 bg-white no-print">
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
        <img
          src="/logo-icon.png"
          alt="Inter Prominent"
          className="h-8 w-8 rounded-lg object-contain border border-slate-200 shrink-0"
        />
        <p className="text-sm font-semibold text-slate-900 truncate">Inter Prominent CRM</p>
      </header>

      {/* Mobile slide-over drawer — same NavContent as the desktop sidebar, overlaid on top of
          the page instead of permanently taking up width. */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex no-print">
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

      {/* Desktop sidebar — same content/behavior as before, just hidden below lg. Collapsible:
          when closed it takes up no width at all (freeing the full window for wide tables like
          Invoices/Debtor List), and a small floating tab on the left edge reopens it. The
          open/closed choice is remembered per-browser via localStorage. */}
      {!desktopCollapsed && (
        <aside className="hidden lg:flex w-60 shrink-0 border-r border-slate-200 bg-white flex-col no-print">
          <NavContent onNavigate={() => {}} onCollapse={() => setDesktopCollapsed(true)} />
        </aside>
      )}
      {desktopCollapsed && (
        <button
          type="button"
          onClick={() => setDesktopCollapsed(false)}
          aria-label="Open menu"
          title="Open menu"
          className="hidden lg:flex fixed top-1/2 left-0 -translate-y-1/2 z-40 items-center justify-center w-6 h-16 rounded-r-lg bg-blue-50 border border-l-0 border-blue-200 text-blue-600 hover:bg-blue-100 hover:text-blue-700 shadow-md no-print"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      <main className="flex-1 min-w-0 min-h-0 overflow-x-hidden">{children}</main>
    </div>
  );
}
