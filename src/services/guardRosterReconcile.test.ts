import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcileGuardBankFromRoster, type GuardRosterSighting } from './guardRosterReconcile.ts';

function sighting(overrides: Partial<GuardRosterSighting> & Pick<GuardRosterSighting, 'siteId'>): GuardRosterSighting {
  return {
    active: true,
    siteName: overrides.siteId,
    branch: 'Penang',
    brandId: null,
    brandName: null,
    name: 'Ali',
    category: 'local',
    age: null,
    state: null,
    city: null,
    passportNumber: null,
    permitExpiryDate: null,
    mykadNumber: null,
    phoneNumber: null,
    ...overrides,
  };
}

describe('reconcileGuardBankFromRoster', () => {
  it('keeps a guard deployed when another site still has them inactive', () => {
    const closed = sighting({ siteId: 'site-old', siteName: 'Old site', active: false });
    const current = sighting({ siteId: 'site-new', siteName: 'New site', active: true, branch: 'Johor' });

    for (const order of [
      [closed, current],
      [current, closed],
    ]) {
      const result = reconcileGuardBankFromRoster(order, {
        status: 'deployed',
        siteId: 'site-new',
      });
      assert.equal(result?.status, 'deployed');
      assert.equal(result?.siteId, 'site-new');
      assert.equal(result?.siteName, 'New site');
      assert.equal(result?.branch, 'Johor');
      assert.equal(result?.dismissalReason, null);
      assert.equal(result?.dismissedAt, null);
    }
  });

  it('does not let a closed site dismiss someone who has no Guard Bank record yet', () => {
    const result = reconcileGuardBankFromRoster(
      [
        sighting({ siteId: 'site-old', active: false }),
        sighting({ siteId: 'site-new', siteName: 'New site', active: true }),
      ],
      null
    );
    assert.equal(result?.status, 'deployed');
    assert.equal(result?.siteId, 'site-new');
  });

  it('keeps an existing dismissal date, reason, and archive flag', () => {
    const result = reconcileGuardBankFromRoster([sighting({ siteId: 'site-a', active: false, name: 'Ali Updated' })], {
      status: 'dismissed',
      siteId: 'site-a',
      dismissalReason: 'Resigned',
      dismissedAt: 1_700_000_000_000,
      archivedAt: 1_700_000_100_000,
    });
    assert.equal(result?.status, 'dismissed');
    assert.equal(result?.name, 'Ali Updated');
    assert.equal(result?.dismissalReason, 'Resigned');
    assert.equal(result?.dismissedAt, 1_700_000_000_000);
    assert.equal(result?.archivedAt, 1_700_000_100_000);
  });

  it('leaves a released pool guard in the pool', () => {
    const result = reconcileGuardBankFromRoster([sighting({ siteId: 'site-old', active: false, branch: 'Penang' })], {
      status: 'pool',
      siteId: null,
    });
    assert.equal(result?.status, 'pool');
    assert.equal(result?.siteId, null);
    assert.equal(result?.siteName, null);
    assert.equal(result?.branch, null);
    assert.equal(result?.dismissalReason, null);
    assert.equal(result?.dismissedAt, null);
  });

  it('still creates a dismissed record with no date when the only roster copy is inactive', () => {
    const result = reconcileGuardBankFromRoster([sighting({ siteId: 'site-old', active: false })], null);
    assert.equal(result?.status, 'dismissed');
    assert.equal(result?.siteId, 'site-old');
    assert.equal(result?.dismissalReason, null);
    assert.equal(result?.dismissedAt, null);
  });
});
