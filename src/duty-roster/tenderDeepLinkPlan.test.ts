import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseDeepLinkSite } from './tenderDeepLinkPlan';

const ownSite = { id: 'site-own', tenderId: 'tender-1' };
const otherProject = { id: 'site-other', tenderId: 'tender-2' };

describe('chooseDeepLinkSite', () => {
  it('does not treat an empty in-flight list as "this tender has no site"', () => {
    assert.deepEqual(
      chooseDeepLinkSite({
        sitesReady: false,
        sites: [],
        siteId: null,
        tenderId: 'tender-1',
      }),
      { action: 'wait' }
    );
  });

  it('selects the existing site once the reachable list has loaded, even if it was empty a moment ago', () => {
    assert.deepEqual(
      chooseDeepLinkSite({
        sitesReady: true,
        sites: [ownSite, otherProject],
        siteId: null,
        tenderId: 'tender-1',
      }),
      { action: 'select', siteId: 'site-own' }
    );
  });

  it('selects the earliest site when several share the tender (list is createdAt-ascending)', () => {
    assert.deepEqual(
      chooseDeepLinkSite({
        sitesReady: true,
        sites: [
          { id: 'primary', tenderId: 'tender-1' },
          { id: 'added-later', tenderId: 'tender-1' },
        ],
        siteId: null,
        tenderId: 'tender-1',
      }),
      { action: 'select', siteId: 'primary' }
    );
  });

  it('creates only after the list is ready and this tender is not on it', () => {
    assert.deepEqual(
      chooseDeepLinkSite({
        sitesReady: true,
        sites: [otherProject],
        siteId: null,
        tenderId: 'tender-1',
      }),
      { action: 'create' }
    );
  });

  it('prefers an explicit siteId and does not create when that site is not reachable yet', () => {
    assert.deepEqual(
      chooseDeepLinkSite({
        sitesReady: true,
        sites: [otherProject],
        siteId: 'site-delegated',
        tenderId: 'tender-1',
      }),
      { action: 'idle' }
    );
    assert.deepEqual(
      chooseDeepLinkSite({
        sitesReady: true,
        sites: [{ id: 'site-delegated', tenderId: 'tender-1' }],
        siteId: 'site-delegated',
        tenderId: 'tender-1',
      }),
      { action: 'select', siteId: 'site-delegated' }
    );
  });

  it('does nothing when there is no deep link', () => {
    assert.deepEqual(
      chooseDeepLinkSite({
        sitesReady: true,
        sites: [ownSite],
        siteId: null,
        tenderId: null,
      }),
      { action: 'idle' }
    );
  });
});
