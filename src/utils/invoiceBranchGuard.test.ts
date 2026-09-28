import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  branchNameIsPersistable,
  isSelectableInvoiceSite,
  resolvePersistedBranchName,
} from './invoiceBranchGuard.ts';

const dept = 'Penang';

describe('isSelectableInvoiceSite', () => {
  it('keeps unassigned and other-branch sites for admin and finance', () => {
    for (const role of ['admin', 'finance', 'developer', 'ceo'] as const) {
      assert.equal(
        isSelectableInvoiceSite({ role, department: 'HQ', siteBranch: null, archived: false }),
        true
      );
      assert.equal(
        isSelectableInvoiceSite({ role, department: 'HQ', siteBranch: 'Johor', archived: false }),
        true
      );
    }
  });

  it('hides archived sites for every role', () => {
    assert.equal(
      isSelectableInvoiceSite({ role: 'admin', department: 'HQ', siteBranch: 'Penang', archived: true }),
      false
    );
    assert.equal(
      isSelectableInvoiceSite({ role: 'branchManager', department: dept, siteBranch: dept, archived: true }),
      false
    );
  });

  for (const role of ['branchManager', 'operationAdmin'] as const) {
    it(`limits ${role} to their own non-archived branch`, () => {
      assert.equal(
        isSelectableInvoiceSite({ role, department: dept, siteBranch: dept, archived: false }),
        true
      );
      assert.equal(
        isSelectableInvoiceSite({ role, department: dept, siteBranch: null, archived: false }),
        false
      );
      assert.equal(
        isSelectableInvoiceSite({ role, department: dept, siteBranch: '', archived: false }),
        false
      );
      assert.equal(
        isSelectableInvoiceSite({ role, department: dept, siteBranch: 'Johor', archived: false }),
        false
      );
      assert.equal(
        isSelectableInvoiceSite({ role, department: '', siteBranch: '', archived: false }),
        false
      );
    });
  }
});

describe('resolvePersistedBranchName', () => {
  it('keeps admin generate fallback to site.branch, including empty', () => {
    assert.equal(
      resolvePersistedBranchName({
        role: 'admin',
        department: 'HQ',
        matchedBranchName: null,
        sourceBranch: null,
        useSourceBranchFallback: true,
      }),
      ''
    );
    assert.equal(
      resolvePersistedBranchName({
        role: 'finance',
        department: 'HQ',
        matchedBranchName: null,
        sourceBranch: 'Johor',
        useSourceBranchFallback: true,
      }),
      'Johor'
    );
    assert.equal(
      resolvePersistedBranchName({
        role: 'admin',
        department: 'HQ',
        matchedBranchName: 'Penang',
        sourceBranch: null,
        useSourceBranchFallback: true,
      }),
      'Penang'
    );
  });

  it('keeps admin migrate from inventing a branch name', () => {
    assert.equal(
      resolvePersistedBranchName({
        role: 'admin',
        department: 'HQ',
        matchedBranchName: null,
        sourceBranch: 'Penang',
        useSourceBranchFallback: false,
      }),
      ''
    );
    assert.equal(
      resolvePersistedBranchName({
        role: 'director',
        department: 'HQ',
        matchedBranchName: 'Penang',
        sourceBranch: 'Penang',
        useSourceBranchFallback: false,
      }),
      'Penang'
    );
  });

  for (const role of ['branchManager', 'operationAdmin'] as const) {
    it(`gives ${role} their department for an own-branch source and nothing for an unassigned one`, () => {
      assert.equal(
        resolvePersistedBranchName({
          role,
          department: dept,
          matchedBranchName: null,
          sourceBranch: null,
          useSourceBranchFallback: true,
        }),
        ''
      );
      assert.equal(
        resolvePersistedBranchName({
          role,
          department: dept,
          matchedBranchName: null,
          sourceBranch: dept,
          useSourceBranchFallback: true,
        }),
        dept
      );
      assert.equal(
        resolvePersistedBranchName({
          role,
          department: dept,
          matchedBranchName: 'Penang Branch',
          sourceBranch: dept,
          useSourceBranchFallback: true,
        }),
        'Penang Branch'
      );
      assert.equal(
        resolvePersistedBranchName({
          role,
          department: dept,
          matchedBranchName: null,
          sourceBranch: dept,
          useSourceBranchFallback: false,
        }),
        dept
      );
      assert.equal(
        resolvePersistedBranchName({
          role,
          department: dept,
          matchedBranchName: null,
          sourceBranch: 'Johor',
          useSourceBranchFallback: false,
        }),
        ''
      );
      assert.equal(
        resolvePersistedBranchName({
          role,
          department: dept,
          matchedBranchName: null,
          sourceBranch: '',
          useSourceBranchFallback: false,
        }),
        ''
      );
    });
  }
});

describe('branchNameIsPersistable', () => {
  it('allows an empty branch name for unscoped roles only', () => {
    assert.equal(branchNameIsPersistable('admin', ''), true);
    assert.equal(branchNameIsPersistable('finance', ''), true);
    assert.equal(branchNameIsPersistable('branchManager', ''), false);
    assert.equal(branchNameIsPersistable('branchManager', '   '), false);
    assert.equal(branchNameIsPersistable('operationAdmin', ''), false);
    assert.equal(branchNameIsPersistable('operationAdmin', 'Penang'), true);
    assert.equal(branchNameIsPersistable('branchManager', 'Penang'), true);
  });
});
