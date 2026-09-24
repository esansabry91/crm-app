import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminRole } from '../../types';
import { RosterPendingProvider, useRosterPendingConsumer } from '../../contexts/RosterPendingContext';
import { setLanguage, type AppLanguage } from '../../i18n';
import { updateOwnLanguage } from '../../services/users';
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

/** Maps a Role to its nav.roles.* translation key — mirrors the ternary chain the account footer
 *  below used to hardcode inline, one-to-one (same fallback too: anything not explicitly listed,
 *  which today is just 'branchManager', reads as "Branch Manager"). */
function roleLabelKey(role: string | undefined): string {
  switch (role) {
    case 'admin':
    case 'developer':
    case 'ceo':
    case 'director':
    case 'tenderController':
    case 'dutyStaff':
    case 'operationAdmin':
    case 'payroll':
    case 'hr':
    case 'finance':
      return role;
    default:
      return 'branchManager';
  }
}

/**
 * EN/BM language switch — visible to every signed-in user (any role, not just admins), since
 * this is a personal display preference, not a permission. Writes through setLanguage() (i18n's
 * own module — updates the active language immediately plus the per-browser localStorage
 * fallback) AND, when signed in, updateOwnLanguage() (services/users.ts — persists to this
 * user's OWN /users/{uid} doc, the one field firestore.rules lets a non-admin write on
 * themselves) so the choice follows them to their next sign-in on any device. The Firestore
 * write is fire-and-forget: a failure there (offline, etc.) shouldn't block the language from
 * changing right now, and AuthContext re-applies profile.language on every future profile load
 * regardless, so a dropped write just means the local fallback is what's remembered.
 */
function LanguageToggle({ uid, className }: { uid: string | undefined; className?: string }) {
  const { t, i18n } = useTranslation();
  const current = i18n.language === 'ms' ? 'ms' : 'en';

  function choose(lang: AppLanguage) {
    if (lang === current) return;
    setLanguage(lang);
    if (uid) void updateOwnLanguage(uid, lang);
  }

  return (
    <div className={clsx('inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium', className)} role="group" aria-label={t('common.language')}>
      {(['en', 'ms'] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => choose(lang)}
          className={clsx(
            'px-2 py-1 rounded-md transition',
            current === lang ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          )}
        >
          {lang === 'en' ? 'EN' : 'BM'}
        </button>
      ))}
    </div>
  );
}

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
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-md border-l-[3px] border-[#00a3da] bg-[#e6f6fc] hover:bg-[#cceefa] transition-colors"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#283278]">{title}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={clsx('shrink-0 text-[#283278] transition-transform', collapsed ? '-rotate-90' : 'rotate-0')}
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
function NavContent({
  onNavigate,
  onCollapse,
  pending,
  guardAction,
}: {
  onNavigate: () => void;
  onCollapse?: () => void;
  /** Whether the Duty Roster page currently has an unlocked roster with pending drag changes
   *  — see contexts/RosterPendingContext.tsx. */
  pending: boolean;
  /** Runs `action` immediately when nothing's pending; otherwise opens AppLayout's own warning
   *  modal (Stay here / Discard changes / Lock roster) and defers `action` until it resolves. */
  guardAction: (action: () => void) => void;
}) {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

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
            <p className="text-xs text-slate-400 leading-tight">{t('nav.portalSubtitle')}</p>
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label={t('common.collapseSidebar')}
              title={t('common.collapseSidebar')}
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

      {/* onClickCapture (not onClick) so this runs BEFORE each NavLink's own onClick
          (onNavigate below, which closes the mobile drawer) — when there's something pending,
          e.stopPropagation() stops that onClick from ever firing too, so the drawer stays open
          behind the warning modal instead of closing out from under it. Delegated once here
          rather than wrapping every individual NavLink (including the differently-gated
          Admin Settings link below, and each role's own subset of links above) with the same
          guard — every <a> in this <nav>, across every role block, goes through this one
          handler. */}
      <nav
        className="flex-1 px-3 py-4 overflow-y-auto"
        onClickCapture={(e) => {
          if (!pending) return;
          const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
          if (!anchor) return;
          const href = anchor.getAttribute('href');
          if (!href) return;
          e.preventDefault();
          e.stopPropagation();
          guardAction(() => {
            navigate(href);
            onNavigate();
          });
        }}
      >
        {profile?.role !== 'dutyStaff' &&
          profile?.role !== 'operationAdmin' &&
          profile?.role !== 'payroll' &&
          profile?.role !== 'finance' &&
          profile?.role !== 'hr' && (
          <>
            <NavSection title={t('nav.sections.clientAcquisition')}>
              <NavLink to="/pipeline" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🗂️</span> {t('nav.links.pipeline')}
              </NavLink>
              <NavLink to="/analysis" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>📊</span> {t('nav.links.pipelineAnalysis')}
              </NavLink>
            </NavSection>

            <NavSection title={t('nav.sections.branchOperation')}>
              <NavLink to="/active-projects" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🏗️</span> {t('nav.links.activeProjects')}
              </NavLink>
              <NavLink to="/duty-roster" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🗓️</span> {t('nav.links.dutyRoster')}
              </NavLink>
              <NavLink to="/task-board" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>📋</span> {t('nav.links.taskBoard')}
              </NavLink>
            </NavSection>

            {/* "Branch Collection" is now the SECTION title, not the tab itself — see
                BranchCollectionPage.tsx's own header, renamed to match. */}
            <NavSection title={t('nav.sections.branchCollection')}>
              <NavLink to="/branch-collection" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🧾</span> {t('nav.links.invoicesRevenue')}
              </NavLink>
            </NavSection>

            <NavSection title={t('nav.sections.humanResource')}>
              <NavLink to="/guard-bank" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🛡️</span> {t('nav.links.guardBank')}
              </NavLink>
            </NavSection>

            <NavSection title={t('nav.sections.history')}>
              <NavLink to="/past-projects" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>📦</span> {t('nav.links.pastProjects')}
              </NavLink>
              <NavLink to="/archive" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🗄️</span> {t('nav.links.archive')}
              </NavLink>
            </NavSection>

            <NavSection title={t('nav.sections.tools')}>
              <NavLink to="/quotation-calculator" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🧮</span> {t('nav.links.quotationCalculator')}
              </NavLink>
            </NavSection>
          </>
        )}
        {(profile?.role === 'dutyStaff' || profile?.role === 'operationAdmin') && (
          <>
            <NavSection title={t('nav.sections.branchOperation')}>
              <NavLink to="/duty-roster" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🗓️</span> {t('nav.links.dutyRoster')}
              </NavLink>
              <NavLink to="/task-board" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>📋</span> {t('nav.links.taskBoard')}
              </NavLink>
            </NavSection>
            <NavSection title={t('nav.sections.humanResource')}>
              <NavLink to="/guard-bank" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🛡️</span> {t('nav.links.guardBank')}
              </NavLink>
            </NavSection>
          </>
        )}
        {profile?.role === 'payroll' && (
          <NavSection title={t('nav.sections.branchOperation')}>
            <NavLink to="/duty-roster" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🗓️</span> {t('nav.links.dutyRoster')}
            </NavLink>
          </NavSection>
        )}
        {/* HR is Payroll's Duty Roster reach PLUS full Guard Bank access — see the Role doc
            comment in types.ts and isHr()/isPayrollLike() in firestore.rules. */}
        {profile?.role === 'hr' && (
          <>
            <NavSection title={t('nav.sections.branchOperation')}>
              <NavLink to="/duty-roster" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🗓️</span> {t('nav.links.dutyRoster')}
              </NavLink>
            </NavSection>
            <NavSection title={t('nav.sections.humanResource')}>
              <NavLink to="/guard-bank" className={navItemClass} onClick={onNavigate}>
                <span aria-hidden>🛡️</span> {t('nav.links.guardBank')}
              </NavLink>
            </NavSection>
          </>
        )}
        {profile?.role === 'finance' && (
          <NavSection title={t('nav.sections.branchCollection')}>
            <NavLink to="/branch-collection" className={navItemClass} onClick={onNavigate}>
              <span aria-hidden>🧾</span> {t('nav.links.invoicesRevenue')}
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
              <span aria-hidden>⚙️</span> {t('nav.links.adminSettings')}
            </NavLink>
          </div>
        )}
      </nav>

      <div className="px-4 py-4 border-t border-slate-100 shrink-0">
        <p className="text-sm font-medium text-slate-800 truncate">{profile?.name}</p>
        <p className="text-xs text-slate-400 truncate">
          {t(`nav.roles.${roleLabelKey(profile?.role)}`)} ·{' '}
          {profile?.department}
        </p>
        <LanguageToggle uid={profile?.uid} className="mt-3 w-full justify-center" />
        <button
          onClick={() => guardAction(() => logout())}
          className="mt-2 w-full text-xs font-medium text-slate-500 hover:text-rose-600 border border-slate-200 rounded-lg py-1.5 transition"
        >
          {t('common.signOut')}
        </button>
      </div>
    </>
  );
}

/**
 * Mirrors the Duty Roster console's own in-page warning (see index.html's
 * openRosterUnlockedWarningModal()) for the CRM shell's own navigation — sidebar links and Sign
 * out — that live outside the iframe and can't be reached by that page's own modal. Same three
 * choices, same outcome either way (re-locked), just triggered from here instead.
 */
function DutyRosterLeaveWarningModal({
  resolving,
  onStay,
  onDiscard,
  onLock,
}: {
  resolving: 'lock' | 'discard' | null;
  onStay: () => void;
  onDiscard: () => void;
  onLock: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
        <h2 className="text-base font-semibold text-slate-900">{t('nav.leaveWarning.title')}</h2>
        <p className="text-sm text-slate-500 mt-1.5">{t('nav.leaveWarning.body')}</p>
        <div className="flex flex-wrap justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onStay}
            disabled={!!resolving}
            className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 disabled:opacity-60"
          >
            {t('nav.leaveWarning.stay')}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={!!resolving}
            className="px-4 py-1.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg"
          >
            {resolving === 'discard' ? t('nav.leaveWarning.discarding') : t('nav.leaveWarning.discard')}
          </button>
          <button
            type="button"
            onClick={onLock}
            disabled={!!resolving}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
          >
            {resolving === 'lock' ? t('nav.leaveWarning.locking') : t('nav.leaveWarning.lock')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppLayoutInner({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(getStoredSidebarCollapsed);
  const { pending, resolvers } = useRosterPendingConsumer();
  const { profile } = useAuth();
  const { t } = useTranslation();
  // The nav/logout action waiting on the warning modal below. Unlike the old iframe/postMessage
  // bridge, resolving is now a direct, synchronous call into the same React tree (see
  // RosterPendingContext.tsx's own doc comment) — no cross-frame race to wait out, so there's no
  // "resolving" busy state or timeout fallback needed any more; the parked action just runs
  // immediately after the resolver fires.
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, desktopCollapsed ? '1' : '0');
    } catch {
      // Best-effort only — the collapsed state still works for this session either way.
    }
  }, [desktopCollapsed]);

  // Runs `action` immediately when the Duty Roster page has nothing pending; otherwise parks it
  // and opens the warning modal (see DutyRosterLeaveWarningModal below) — passed down to
  // NavContent as guardAction, and used directly by the Sign out button.
  function guardAction(action: () => void) {
    if (!pending) {
      action();
      return;
    }
    setPendingAction(() => action);
  }

  function resolveAndProceed(action: 'lock' | 'discard') {
    resolvers?.[action]();
    const proceed = pendingAction;
    setPendingAction(null);
    proceed?.();
  }

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
          aria-label={t('common.openMenu')}
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
        <p className="text-sm font-semibold text-slate-900 truncate flex-1">{t('nav.appName')}</p>
        <LanguageToggle uid={profile?.uid} />
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
              aria-label={t('common.closeMenu')}
              className="absolute top-4 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="4" x2="20" y2="20" />
                <line x1="20" y1="4" x2="4" y2="20" />
              </svg>
            </button>
            <NavContent onNavigate={() => setDrawerOpen(false)} pending={pending} guardAction={guardAction} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar — same content/behavior as before, just hidden below lg. Collapsible:
          when closed it takes up no width at all (freeing the full window for wide tables like
          Invoices/Debtor List), and a small floating tab on the left edge reopens it. The
          open/closed choice is remembered per-browser via localStorage. */}
      {!desktopCollapsed && (
        <aside className="hidden lg:flex w-60 shrink-0 border-r border-slate-200 bg-white flex-col no-print">
          <NavContent
            onNavigate={() => {}}
            onCollapse={() => setDesktopCollapsed(true)}
            pending={pending}
            guardAction={guardAction}
          />
        </aside>
      )}
      {desktopCollapsed && (
        <button
          type="button"
          onClick={() => setDesktopCollapsed(false)}
          aria-label={t('common.openMenu')}
          title={t('common.openMenu')}
          className="hidden lg:flex fixed top-1/2 left-0 -translate-y-1/2 z-40 items-center justify-center w-6 h-16 rounded-r-lg bg-blue-50 border border-l-0 border-blue-200 text-blue-600 hover:bg-blue-100 hover:text-blue-700 shadow-md no-print"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      <main className="flex-1 min-w-0 min-h-0 overflow-x-hidden">{children}</main>

      {pendingAction && (
        <DutyRosterLeaveWarningModal
          resolving={null}
          onStay={() => setPendingAction(null)}
          onDiscard={() => resolveAndProceed('discard')}
          onLock={() => resolveAndProceed('lock')}
        />
      )}
    </div>
  );
}

/** Provides the RosterPendingContext AppLayoutInner (above) and the Duty Roster page's own
 * composed shell (Task #22) both need — see RosterPendingContext.tsx's own doc comment for why
 * this replaced the old iframe/postMessage bridge. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RosterPendingProvider>
      <AppLayoutInner>{children}</AppLayoutInner>
    </RosterPendingProvider>
  );
}
