import { useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useUsers } from '../../hooks/useUsers';
import { useTenders } from '../../hooks/useTenders';
import { useBranches } from '../../hooks/useBranches';
import { updateUserProfile } from '../../services/users';
import { setActiveBranch, updateTender } from '../../services/tenders';

function FixRow({
  label,
  sub,
  badValue,
  options,
  onFix,
}: {
  label: string;
  sub?: string;
  badValue: string;
  options: string[];
  onFix: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(options[0] || '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const handleFix = async () => {
    setBusy(true);
    try {
      await onFix(value);
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
        <p className="text-sm text-emerald-600">
          ✓ {label} fixed — now "{value}"
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{label}</p>
        {sub && <p className="text-xs text-slate-400 truncate">{sub}</p>}
        <p className="text-xs text-rose-500 mt-0.5">
          Currently: <span className="font-mono">"{badValue}"</span> — not a real department
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="text-xs rounded border border-slate-200 px-1.5 py-1"
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <button
          onClick={handleFix}
          disabled={busy}
          className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-2.5 py-1 disabled:opacity-60"
        >
          {busy ? 'Fixing…' : 'Fix'}
        </button>
      </div>
    </div>
  );
}

/**
 * Finds and fixes "orphaned" department values — text stored on a user's profile, a tender's
 * sales-attribution `department`, or a Won tender's operational `activeBranch` that doesn't
 * match any real department (HQ or a branch currently in the Branches & Brands list). These
 * happen when a department was typed freehand (e.g. before this list was locked down) or a
 * branch was later renamed/removed while records still reference the old name. Left alone, they
 * show up as confusing extra "branches" in Pipeline Analysis and Active Projects.
 */
export default function DepartmentRepairTool() {
  const { profile } = useAuth();
  const { users } = useUsers();
  const { tenders } = useTenders(profile);
  const { branches } = useBranches();

  const validDepartments = useMemo(() => ['HQ', ...branches.map((b) => b.name)], [branches]);
  const validSet = useMemo(() => new Set(validDepartments), [validDepartments]);
  // Active Projects are operational — HQ doesn't run any, so it's not offered as a fix target here.
  const activeBranchOptions = useMemo(() => validDepartments.filter((d) => d !== 'HQ'), [validDepartments]);

  const orphanUsers = useMemo(
    () => users.filter((u) => u.department && !validSet.has(u.department)),
    [users, validSet]
  );
  const orphanTenderDepts = useMemo(
    () => tenders.filter((t) => t.department && !validSet.has(t.department)),
    [tenders, validSet]
  );
  const orphanActiveBranches = useMemo(
    () => tenders.filter((t) => t.stage === 'Won' && t.activeBranch && !validSet.has(t.activeBranch)),
    [tenders, validSet]
  );

  const totalIssues = orphanUsers.length + orphanTenderDepts.length + orphanActiveBranches.length;

  if (!profile) return null;
  const actor = { uid: profile.uid, name: profile.name };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800">Data Repair</h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Finds team members or tenders whose department doesn't match a real branch or "HQ" —
          usually left over from a typo or a renamed branch. Left unfixed, these show up as
          confusing duplicate bars in Pipeline Analysis and Active Projects.
        </p>
      </div>

      {totalIssues === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-emerald-600">
            ✓ No department issues found — everything lines up with your Branches list.
          </p>
        </div>
      ) : (
        <>
          {orphanUsers.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-sm font-semibold text-slate-800 mb-1">
                Team Member Profiles ({orphanUsers.length})
              </h4>
              <p className="text-xs text-slate-400 mb-3">
                Their department doesn't match any real branch — new tenders they own will keep
                inheriting the bad value until this is fixed.
              </p>
              {orphanUsers.map((u) => (
                <FixRow
                  key={u.uid}
                  label={u.name}
                  sub={u.email}
                  badValue={u.department}
                  options={validDepartments}
                  onFix={(value) => updateUserProfile(u.uid, { department: value })}
                />
              ))}
            </div>
          )}

          {orphanTenderDepts.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-sm font-semibold text-slate-800 mb-1">
                Tender Departments ({orphanTenderDepts.length})
              </h4>
              <p className="text-xs text-slate-400 mb-3">
                Sales-attribution department stored directly on the tender (affects the Branch
                Race chart).
              </p>
              {orphanTenderDepts.map((t) => (
                <FixRow
                  key={t.id}
                  label={t.clientName}
                  sub={`Owner: ${t.ownerName} · ${t.stage}`}
                  badValue={t.department}
                  options={validDepartments}
                  onFix={(value) => updateTender(t.id, { department: value }, actor, t)}
                />
              ))}
            </div>
          )}

          {orphanActiveBranches.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-sm font-semibold text-slate-800 mb-1">
                Active Project Branches ({orphanActiveBranches.length})
              </h4>
              <p className="text-xs text-slate-400 mb-3">
                Operational branch assigned once a tender is Won (affects Active Projects and its
                race chart).
              </p>
              {orphanActiveBranches.map((t) => (
                <FixRow
                  key={t.id}
                  label={t.clientName}
                  sub={`Owner: ${t.ownerName} · Won`}
                  badValue={t.activeBranch || ''}
                  options={activeBranchOptions}
                  onFix={(value) => setActiveBranch(t.id, value)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
