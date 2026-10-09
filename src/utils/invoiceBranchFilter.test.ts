import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invoiceMatchesBranchFilter } from './invoiceBranchFilter.ts';

const penangId = 'branch-penang';

describe('invoiceMatchesBranchFilter', () => {
  it('matches every invoice when no branch is selected', () => {
    assert.equal(invoiceMatchesBranchFilter({ branchId: null, branchName: '' }, '', undefined), true);
    assert.equal(invoiceMatchesBranchFilter({ branchId: 'other', branchName: 'Johor' }, '', 'Penang'), true);
  });

  it('matches on branchId even when the stored name differs', () => {
    assert.equal(
      invoiceMatchesBranchFilter({ branchId: penangId, branchName: 'Johor' }, penangId, 'Penang'),
      true
    );
  });

  it('does not fall through to the name when a different branchId is set', () => {
    assert.equal(
      invoiceMatchesBranchFilter({ branchId: 'branch-johor', branchName: 'Penang' }, penangId, 'Penang'),
      false
    );
  });

  it('keeps a name-only invoice when branchName matches the selected branch', () => {
    assert.equal(
      invoiceMatchesBranchFilter({ branchId: null, branchName: '  Penang ' }, penangId, 'penang'),
      true
    );
    assert.equal(
      invoiceMatchesBranchFilter({ branchId: undefined, branchName: 'Penang' }, penangId, 'Penang'),
      true
    );
    assert.equal(
      invoiceMatchesBranchFilter({ branchName: 'Penang' }, penangId, 'Penang'),
      true
    );
  });

  it('drops a name-only invoice when the name does not match or the branch name is unknown', () => {
    assert.equal(
      invoiceMatchesBranchFilter({ branchId: null, branchName: 'Johor' }, penangId, 'Penang'),
      false
    );
    assert.equal(
      invoiceMatchesBranchFilter({ branchId: null, branchName: '' }, penangId, 'Penang'),
      false
    );
    assert.equal(
      invoiceMatchesBranchFilter({ branchId: null, branchName: 'Penang' }, penangId, undefined),
      false
    );
    assert.equal(
      invoiceMatchesBranchFilter({ branchId: '', branchName: 'Penang' }, penangId, ''),
      false
    );
  });
});
