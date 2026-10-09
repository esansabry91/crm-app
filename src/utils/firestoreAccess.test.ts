import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Role, UserProfile } from '../types';
import {
  isLinkedSiteVisibleInBranchList,
  recordedReassignmentSiteIds,
  siteFollowsProjectBranch,
  sitesListPlan,
  usersListPlan,
} from './firestoreAccess';

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

describe('recordedReassignmentSiteIds', () => {
  it('treats a missing field as unknown (legacy request)', () => {
    assert.equal(recordedReassignmentSiteIds(undefined), null);
    assert.equal(recordedReassignmentSiteIds(null), null);
    assert.equal(recordedReassignmentSiteIds({}), null);
  });

  it('keeps an empty list as recorded — the project had no following sites', () => {
    assert.deepEqual(recordedReassignmentSiteIds({ siteIds: [] }), []);
    assert.deepEqual(recordedReassignmentSiteIds({ siteIds: ['site-a', 'site-b'] }), ['site-a', 'site-b']);
  });
});

describe('siteFollowsProjectBranch', () => {
  it('moves a site that is still on the outgoing branch', () => {
    assert.equal(siteFollowsProjectBranch('Penang Branch', 'Penang Branch'), true);
    assert.equal(siteFollowsProjectBranch('Kelantan Branch', 'Penang Branch'), false);
  });

  it('treats a missing branch as unassigned', () => {
    assert.equal(siteFollowsProjectBranch(undefined, null), true);
    assert.equal(siteFollowsProjectBranch(null, 'Penang Branch'), false);
  });

  it('sweeps unassigned sites only on a first assignment', () => {
    assert.equal(siteFollowsProjectBranch(null, 'Penang Branch', false), false);
    assert.equal(siteFollowsProjectBranch(null, 'Penang Branch', true), true);
    assert.equal(siteFollowsProjectBranch('Kelantan Branch', 'Penang Branch', true), false);
  });
});

describe('isLinkedSiteVisibleInBranchList', () => {
  const tenderId = 'tender-1';

  it('keeps this tender\'s own-branch and unassigned sites', () => {
    assert.equal(
      isLinkedSiteVisibleInBranchList({ tenderId, branch: 'Penang Branch' }, tenderId, 'Penang Branch'),
      true
    );
    assert.equal(isLinkedSiteVisibleInBranchList({ tenderId, branch: null }, tenderId, 'Penang Branch'), true);
  });

  it('drops other tenders and sites delegated to another branch', () => {
    assert.equal(
      isLinkedSiteVisibleInBranchList({ tenderId: 'other', branch: 'Penang Branch' }, tenderId, 'Penang Branch'),
      false
    );
    assert.equal(
      isLinkedSiteVisibleInBranchList({ tenderId, branch: 'Kelantan Branch' }, tenderId, 'Penang Branch'),
      false
    );
  });
});
