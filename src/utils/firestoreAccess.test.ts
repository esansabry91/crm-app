import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Role, UserProfile } from '../types';
import { sitesListPlan, usersListPlan } from './firestoreAccess';

function profile(role: Role, department = 'Penang Branch'): UserProfile {
  return {
    uid: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    role,
    department,
    active: true,
    createdAt: 1,
  };
}

describe('usersListPlan', () => {
  it('returns none without a signed-in profile', () => {
    assert.deepEqual(usersListPlan(null), { mode: 'none' });
    assert.deepEqual(usersListPlan(undefined), { mode: 'none' });
  });

  for (const role of ['admin', 'developer', 'ceo', 'director', 'tenderController'] as const) {
    it(`lets ${role} list the whole users collection (isAdmin() is unconditional)`, () => {
      assert.deepEqual(usersListPlan(profile(role, 'HQ')), { mode: 'all' });
    });
  }

  it('scopes a Branch Manager to dutyStaff in their own department', () => {
    assert.deepEqual(usersListPlan(profile('branchManager')), {
      mode: 'branchDutyStaff',
      department: 'Penang Branch',
    });
  });

  it('does not issue a users LIST for Operation Staff (they can only GET their own uid)', () => {
    assert.deepEqual(usersListPlan(profile('dutyStaff')), { mode: 'none' });
  });

  it('does not issue a users LIST for payroll / hr / finance', () => {
    assert.deepEqual(usersListPlan(profile('payroll')), { mode: 'none' });
    assert.deepEqual(usersListPlan(profile('hr')), { mode: 'none' });
    assert.deepEqual(usersListPlan(profile('finance')), { mode: 'none' });
  });

  it('does not issue a users LIST for a Branch Manager with no department yet', () => {
    assert.deepEqual(usersListPlan(profile('branchManager', '')), { mode: 'none' });
  });
});

describe('sitesListPlan', () => {
  it('returns none without a signed-in profile', () => {
    assert.deepEqual(sitesListPlan(null), { mode: 'none' });
  });

  for (const role of ['admin', 'developer', 'ceo', 'director', 'tenderController'] as const) {
    it(`lets ${role} list every site`, () => {
      assert.deepEqual(sitesListPlan(profile(role, 'HQ')), { mode: 'all' });
    });
  }

  it('lets an HQ-department account list every site even if the role is not admin-tier', () => {
    assert.deepEqual(sitesListPlan(profile('branchManager', 'HQ')), { mode: 'all' });
  });

  it('lets payroll and HR list every site (isPayrollLike() is unconditional)', () => {
    assert.deepEqual(sitesListPlan(profile('payroll', 'Penang Branch')), { mode: 'all' });
    assert.deepEqual(sitesListPlan(profile('hr', 'Penang Branch')), { mode: 'all' });
  });

  it('scopes a Branch Manager to their branch plus unassigned sites', () => {
    assert.deepEqual(sitesListPlan(profile('branchManager')), {
      mode: 'branchAndUnassigned',
      department: 'Penang Branch',
    });
  });

  it('scopes Operation Staff the same way Duty Roster already does', () => {
    assert.deepEqual(sitesListPlan(profile('dutyStaff')), {
      mode: 'branchAndUnassigned',
      department: 'Penang Branch',
    });
  });
});
