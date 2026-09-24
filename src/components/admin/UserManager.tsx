import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useUsers } from '../../hooks/useUsers';
import { useBranches } from '../../hooks/useBranches';
import { useAuth } from '../../contexts/AuthContext';
import { createStaffAccount, updateUserProfile, deactivateUser, deleteUserProfile } from '../../services/users';
import type { Role } from '../../types';

// Translation keys for the confirmation prompts below — matches what each <option> shows,
// independent of the raw value stored in Firestore.
const ROLE_LABEL_KEYS: Record<string, string> = {
  branchManager: 'admin.roles.branchManager',
  admin: 'admin.roles.hqAdmin',
  dutyStaff: 'admin.roles.operationStaff',
  operationAdmin: 'admin.roles.operationAdmin',
  payroll: 'admin.roles.payroll',
  developer: 'admin.roles.developer',
  finance: 'admin.roles.finance',
  hr: 'admin.roles.hr',
  ceo: 'admin.roles.ceo',
  director: 'admin.roles.director',
  tenderController: 'admin.roles.tenderController',
};
function roleLabel(t: TFunction, role: string): string {
  const key = ROLE_LABEL_KEYS[role];
  return key ? t(key) : role;
}

export default function UserManager() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { users } = useUsers(profile);
  const { branches } = useBranches();
  // A Branch Manager reaches this component too (see the /admin route's allowBranchManager prop
  // in App.tsx and AdminPage.tsx's Team-only tab restriction) — but only ever to manage their own
  // branch's Operation Staff accounts. firestore.rules' /users rules enforce the same scoping
  // server-side (isOwnBranchOperationStaff()), so this UI restriction is a convenience, not the
  // actual security boundary.
  const isBranchManagerRole = profile?.role === 'branchManager';
  const myDepartment = profile?.department || '';
  const departmentOptions = ['HQ', ...branches.map((b) => b.name)];

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(isBranchManagerRole ? 'dutyStaff' : 'branchManager');
  const [department, setDepartment] = useState(isBranchManagerRole ? myDepartment : 'HQ');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);

  // One-time cleanup for accounts created before the role was renamed from "staff" to
  // "branchManager" — their Firestore `role` field still literally says "staff". Functionally
  // harmless (every permission check in this app only ever tests for `role === 'admin'`, so a
  // legacy value here is still treated as the non-admin role everywhere), but the role dropdowns
  // below can't show it as selected since neither <option> has that value anymore. Cast through
  // `string` because the `Role` type no longer includes "staff" — the check is only for
  // whatever's actually still sitting in old documents.
  const legacyStaffUsers = users.filter((u) => (u.role as string) === 'staff');

  // A Branch Manager's /users query is already scoped to their branch's dutyStaff/operationAdmin
  // accounts (see useUsers) — this filter is a defensive/explicit narrowing that also drops the
  // branch manager's own profile row from the table, since they're not one of the Operation
  // Staff/Operation Admin accounts they're managing. Branch Managers still only ever CREATE
  // 'dutyStaff' accounts (see handleCreate below) — 'operationAdmin' is admin-assigned — but once
  // one exists in their branch, they can see and manage it here like any other Operation Staff.
  const visibleUsers = isBranchManagerRole
    ? users.filter((u) => (u.role === 'dutyStaff' || u.role === 'operationAdmin') && u.department === myDepartment)
    : users;

  const handleMigrateLegacyRoles = async () => {
    setMigrating(true);
    setMigrateMsg(null);
    try {
      for (const u of legacyStaffUsers) {
        await updateUserProfile(u.uid, { role: 'branchManager' });
      }
      setMigrateMsg(
        t('admin.userManager.migratedToRole', { count: legacyStaffUsers.length, role: roleLabel(t, 'branchManager') })
      );
    } catch (err) {
      setMigrateMsg(t('admin.userManager.migrateError'));
      console.error(err);
    } finally {
      setMigrating(false);
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!name.trim() || !email.trim()) {
      setError(t('admin.userManager.errorNameAndEmailRequired'));
      return;
    }
    // Branch managers can only ever create Operation Staff in their own branch — force these
    // regardless of component state, as a belt-and-suspenders match to the server-side
    // isOwnBranchOperationStaff() check in firestore.rules (which would reject anything else).
    const effectiveRole: Role = isBranchManagerRole ? 'dutyStaff' : role;
    const effectiveDepartment = isBranchManagerRole ? myDepartment : department;
    if (isBranchManagerRole && !effectiveDepartment) {
      setError(t('admin.userManager.errorNoBranchAssigned'));
      return;
    }
    setBusy(true);
    try {
      await createStaffAccount({
        name: name.trim(),
        email: email.trim(),
        role: effectiveRole,
        department: effectiveDepartment,
      });
      setSuccess(t('admin.userManager.accountCreated', { email: email.trim() }));
      setName('');
      setEmail('');
      setRole(isBranchManagerRole ? 'dutyStaff' : 'branchManager');
      setDepartment(isBranchManagerRole ? myDepartment : 'HQ');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      setError(
        code === 'auth/email-already-in-use'
          ? t('admin.userManager.errorEmailInUse')
          : t('admin.userManager.errorCouldNotCreate')
      );
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (uid: string, name: string) => {
    const confirmed = window.confirm(t('admin.userManager.confirmRemove', { name }));
    if (!confirmed) return;
    setRemovingUid(uid);
    try {
      await deleteUserProfile(uid);
    } finally {
      setRemovingUid(null);
    }
  };

  // Role and department both drive access control immediately (which tabs someone can reach,
  // which branch's data they can see/edit) — a stray click on the wrong dropdown option would
  // otherwise change that instantly with no way to notice before it's already live, so both
  // are confirmed first. If the admin cancels, nothing is called and the <select> — controlled
  // by the user's actual stored value — snaps back to what it was on the next render.
  const handleRoleChange = async (uid: string, name: string, currentRole: string, newRole: Role) => {
    if (newRole === currentRole) return;
    const confirmed = window.confirm(
      t('admin.userManager.confirmRoleChange', { name, from: roleLabel(t, currentRole), to: roleLabel(t, newRole) })
    );
    if (!confirmed) return;
    await updateUserProfile(uid, { role: newRole });
  };

  const handleDepartmentChange = async (uid: string, name: string, currentDepartment: string, newDepartment: string) => {
    if (newDepartment === currentDepartment) return;
    const confirmed = window.confirm(
      t('admin.userManager.confirmDepartmentChange', { name, from: currentDepartment, to: newDepartment })
    );
    if (!confirmed) return;
    await updateUserProfile(uid, { department: newDepartment });
  };

  return (
    <div className="space-y-6">
      {!isBranchManagerRole && legacyStaffUsers.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium text-amber-800">
              {t('admin.userManager.legacyRoleBanner', { count: legacyStaffUsers.length })}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {t('admin.userManager.legacyRoleBannerDetail')}
            </p>
            {migrateMsg && <p className="text-xs text-emerald-700 mt-1">{migrateMsg}</p>}
          </div>
          <button
            onClick={handleMigrateLegacyRoles}
            disabled={migrating}
            className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-60 shrink-0"
          >
            {migrating ? t('admin.userManager.migratingEllipsis') : t('admin.userManager.migrateButton', { count: legacyStaffUsers.length })}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800">{t('admin.userManager.addTeamMemberTitle')}</h3>
        <p className="text-xs text-slate-400 mt-0.5 mb-4">
          {t('admin.userManager.addTeamMemberDescription')}
        </p>
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin.userManager.fullNamePlaceholder')} className="input" />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('admin.userManager.emailPlaceholder')}
            type="email"
            className="input"
          />
          {isBranchManagerRole ? (
            <>
              <div className="input flex items-center bg-slate-50 text-slate-500">
                {t('admin.userManager.operationStaffFixed')}
              </div>
              <div className="input flex items-center bg-slate-50 text-slate-500">
                {t('admin.userManager.yourBranchFixed', { department: myDepartment || '—' })}
              </div>
            </>
          ) : (
            <>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="input">
                <option value="branchManager">{t('admin.userManager.roleOptionBranchManager')}</option>
                <option value="admin">{t('admin.userManager.roleOptionAdmin')}</option>
                <option value="ceo">{t('admin.userManager.roleOptionCeo')}</option>
                <option value="director">{t('admin.userManager.roleOptionDirector')}</option>
                <option value="tenderController">{t('admin.userManager.roleOptionTenderController')}</option>
                <option value="dutyStaff">{t('admin.userManager.roleOptionDutyStaff')}</option>
                <option value="operationAdmin">{t('admin.userManager.roleOptionOperationAdmin')}</option>
                <option value="payroll">{t('admin.userManager.roleOptionPayroll')}</option>
                <option value="hr">{t('admin.userManager.roleOptionHr')}</option>
                <option value="developer">{t('admin.userManager.roleOptionDeveloper')}</option>
                <option value="finance">{t('admin.userManager.roleOptionFinance')}</option>
              </select>
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className="input">
                {departmentOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </>
          )}
          {error && <p className="sm:col-span-2 text-sm text-rose-600">{error}</p>}
          {success && <p className="sm:col-span-2 text-sm text-emerald-600">{success}</p>}
          <button
            type="submit"
            disabled={busy}
            className="sm:col-span-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
          >
            {busy ? t('admin.userManager.creatingEllipsis') : t('admin.userManager.createAccountButton')}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">
          {isBranchManagerRole
            ? t('admin.userManager.yourBranchHeading', { count: visibleUsers.length })
            : t('admin.userManager.teamMembersHeading', { count: visibleUsers.length })}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-4 font-medium">{t('admin.userManager.colName')}</th>
                <th className="py-2 pr-4 font-medium">{t('admin.userManager.colEmail')}</th>
                <th className="py-2 pr-4 font-medium">{t('admin.userManager.colRole')}</th>
                <th className="py-2 pr-4 font-medium">{t('admin.userManager.colDepartment')}</th>
                <th className="py-2 pr-4 font-medium">{t('admin.userManager.colStatus')}</th>
                <th className="py-2 font-medium text-right">{t('admin.userManager.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((u) => (
                <tr key={u.uid} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-4 font-medium text-slate-800">{u.name}</td>
                  <td className="py-2 pr-4 text-slate-500">{u.email}</td>
                  <td className="py-2 pr-4">
                    {isBranchManagerRole ? (
                      <span className="text-xs text-slate-600">{roleLabel(t, u.role)}</span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.uid, u.name, u.role, e.target.value as Role)}
                        className="text-xs rounded border border-slate-200 px-1.5 py-1"
                      >
                        <option value="branchManager">{t('admin.roles.branchManager')}</option>
                        <option value="admin">{t('admin.roles.hqAdmin')}</option>
                        <option value="ceo">{t('admin.roles.ceo')}</option>
                        <option value="director">{t('admin.roles.director')}</option>
                        <option value="tenderController">{t('admin.roles.tenderController')}</option>
                        <option value="dutyStaff">{t('admin.roles.operationStaff')}</option>
                        <option value="operationAdmin">{t('admin.roles.operationAdmin')}</option>
                        <option value="payroll">{t('admin.roles.payroll')}</option>
                        <option value="hr">{t('admin.roles.hr')}</option>
                        <option value="developer">{t('admin.roles.developer')}</option>
                        <option value="finance">{t('admin.roles.finance')}</option>
                      </select>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {isBranchManagerRole ? (
                      <span className="text-xs text-slate-600">{u.department}</span>
                    ) : (
                      <select
                        value={u.department}
                        onChange={(e) => handleDepartmentChange(u.uid, u.name, u.department, e.target.value)}
                        className="text-xs rounded border border-slate-200 px-1.5 py-1"
                      >
                        {departmentOptions.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {u.active === false ? (
                      <span className="text-xs text-rose-500">{t('admin.userManager.statusDeactivated')}</span>
                    ) : (
                      <span className="text-xs text-emerald-600">{t('admin.userManager.statusActive')}</span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-3">
                      {u.active !== false && (
                        <button
                          onClick={() => deactivateUser(u.uid)}
                          className="text-xs text-slate-500 hover:text-amber-600"
                        >
                          {t('admin.userManager.deactivateAction')}
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(u.uid, u.name)}
                        disabled={removingUid === u.uid}
                        className="text-xs text-slate-500 hover:text-rose-600 disabled:opacity-50"
                      >
                        {removingUid === u.uid ? t('admin.userManager.removingEllipsis') : t('admin.userManager.removeAction')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-slate-100">
          <span className="font-medium text-slate-500">{t('admin.userManager.deactivateAction')}</span>{' '}
          {t('admin.userManager.footerNoteDeactivateRest')}{' '}
          <span className="font-medium text-slate-500">{t('admin.userManager.removeAction')}</span>{' '}
          {t('admin.userManager.footerNoteRemoveRest')}
        </p>
      </div>
    </div>
  );
}
