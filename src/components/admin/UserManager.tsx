import { useState, type FormEvent } from 'react';
import { useUsers } from '../../hooks/useUsers';
import { useBranches } from '../../hooks/useBranches';
import { createStaffAccount, updateUserProfile, deactivateUser, deleteUserProfile } from '../../services/users';
import type { Role } from '../../types';

export default function UserManager() {
  const { users } = useUsers();
  const { branches } = useBranches();
  const departmentOptions = ['HQ', ...branches.map((b) => b.name)];

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('branchManager');
  const [department, setDepartment] = useState('HQ');
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

  const handleMigrateLegacyRoles = async () => {
    setMigrating(true);
    setMigrateMsg(null);
    try {
      for (const u of legacyStaffUsers) {
        await updateUserProfile(u.uid, { role: 'branchManager' });
      }
      setMigrateMsg(
        `Updated ${legacyStaffUsers.length} account${legacyStaffUsers.length === 1 ? '' : 's'} to the "branchManager" role.`
      );
    } catch (err) {
      setMigrateMsg(
        'Something went wrong partway through — check the Role column below and re-run if any account still looks off.'
      );
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
      setError('Fill in a name and email.');
      return;
    }
    setBusy(true);
    try {
      await createStaffAccount({ name: name.trim(), email: email.trim(), role, department });
      setSuccess(`Account created — an email has been sent to ${email.trim()} with a link to set their password.`);
      setName('');
      setEmail('');
      setRole('branchManager');
      setDepartment('HQ');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      setError(
        code === 'auth/email-already-in-use'
          ? 'That email is already registered.'
          : 'Could not create the account. Please check the details and try again.'
      );
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (uid: string, name: string) => {
    const confirmed = window.confirm(
      `Remove ${name} from the team? They will lose all access to the CRM immediately and disappear from staff/owner lists. This does not delete their sign-in credentials — see the note below the table if you need those fully revoked too.`
    );
    if (!confirmed) return;
    setRemovingUid(uid);
    try {
      await deleteUserProfile(uid);
    } finally {
      setRemovingUid(null);
    }
  };

  return (
    <div className="space-y-6">
      {legacyStaffUsers.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium text-amber-800">
              {legacyStaffUsers.length} account{legacyStaffUsers.length === 1 ? '' : 's'} still stored with the old
              "staff" role value.
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              One-time cleanup — updates their role field to "branchManager" to match the new label. Nothing breaks
              if you skip this; it just keeps the dropdowns below showing the right selection.
            </p>
            {migrateMsg && <p className="text-xs text-emerald-700 mt-1">{migrateMsg}</p>}
          </div>
          <button
            onClick={handleMigrateLegacyRoles}
            disabled={migrating}
            className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-60 shrink-0"
          >
            {migrating ? 'Migrating…' : `Migrate ${legacyStaffUsers.length} account${legacyStaffUsers.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800">Add Team Member</h3>
        <p className="text-xs text-slate-400 mt-0.5 mb-4">
          Creates their sign-in account and CRM profile, then emails them a link to set their own password —
          nothing to share manually.
        </p>
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="input" />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            className="input"
          />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="input">
            <option value="branchManager">Branch Manager — sees only their own tenders</option>
            <option value="admin">HQ Admin — sees everything</option>
            <option value="dutyStaff">Staff — Duty Roster only, nothing else</option>
            <option value="payroll">Payroll — Duty Roster only, view &amp; export only, all branches</option>
          </select>
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className="input">
            {departmentOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {error && <p className="sm:col-span-2 text-sm text-rose-600">{error}</p>}
          {success && <p className="sm:col-span-2 text-sm text-emerald-600">{success}</p>}
          <button
            type="submit"
            disabled={busy}
            className="sm:col-span-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create Account'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Team Members ({users.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Department</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.uid} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-4 font-medium text-slate-800">{u.name}</td>
                  <td className="py-2 pr-4 text-slate-500">{u.email}</td>
                  <td className="py-2 pr-4">
                    <select
                      value={u.role}
                      onChange={(e) => updateUserProfile(u.uid, { role: e.target.value as Role })}
                      className="text-xs rounded border border-slate-200 px-1.5 py-1"
                    >
                      <option value="branchManager">Branch Manager</option>
                      <option value="admin">HQ Admin</option>
                      <option value="dutyStaff">Staff</option>
                      <option value="payroll">Payroll</option>
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      value={u.department}
                      onChange={(e) => updateUserProfile(u.uid, { department: e.target.value })}
                      className="text-xs rounded border border-slate-200 px-1.5 py-1"
                    >
                      {departmentOptions.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    {u.active === false ? (
                      <span className="text-xs text-rose-500">Deactivated</span>
                    ) : (
                      <span className="text-xs text-emerald-600">Active</span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-3">
                      {u.active !== false && (
                        <button
                          onClick={() => deactivateUser(u.uid)}
                          className="text-xs text-slate-500 hover:text-amber-600"
                        >
                          Deactivate
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(u.uid, u.name)}
                        disabled={removingUid === u.uid}
                        className="text-xs text-slate-500 hover:text-rose-600 disabled:opacity-50"
                      >
                        {removingUid === u.uid ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-slate-100">
          <span className="font-medium text-slate-500">Deactivate</span> blocks CRM access instantly but keeps their
          record (useful if they're just on leave). <span className="font-medium text-slate-500">Remove</span> deletes
          their CRM profile entirely — they'll vanish from staff/owner lists, though their past tenders stay put with
          their name attached. Neither one deletes their actual email/password sign-in — this app runs on Firebase's
          free plan without the extra setup needed to do that automatically, so to fully revoke a former staff
          member's login, delete their account manually in Firebase Console → Authentication → Users.
        </p>
      </div>
    </div>
  );
}
