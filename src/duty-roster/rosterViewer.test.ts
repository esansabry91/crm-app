import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveRosterViewer } from './rosterViewer.ts';

const base = { uid: 'user-1', name: 'Aina', department: 'Penang' };

describe('deriveRosterViewer', () => {
  it('gives HR Manager the same view-only every-branch reach as HR', () => {
    const hr = deriveRosterViewer({ ...base, role: 'hr' });
    const hrManager = deriveRosterViewer({ ...base, role: 'hrManager' });

    assert.equal(hr.isHr, true);
    assert.equal(hr.isPayrollLike, true);
    assert.equal(hr.canEdit, false);
    assert.equal(hr.isPrivileged, false);

    assert.equal(hrManager.isHr, true);
    assert.equal(hrManager.isPayrollLike, true);
    assert.equal(hrManager.canEdit, false);
    assert.equal(hrManager.isPrivileged, false);
    assert.equal(hrManager.myRole, 'hrManager');
    assert.equal(hrManager.myDepartment, 'Penang');
  });

  it('still lets a Branch Manager edit, scoped to their own branch', () => {
    const manager = deriveRosterViewer({ ...base, role: 'branchManager' });
    assert.equal(manager.isHr, false);
    assert.equal(manager.isPayrollLike, false);
    assert.equal(manager.canEdit, true);
    assert.equal(manager.isPrivileged, false);
  });

  it('keeps payroll view-only', () => {
    const payroll = deriveRosterViewer({ ...base, role: 'payroll' });
    assert.equal(payroll.isPayroll, true);
    assert.equal(payroll.isHr, false);
    assert.equal(payroll.isPayrollLike, true);
    assert.equal(payroll.canEdit, false);
  });
});
