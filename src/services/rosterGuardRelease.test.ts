import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { markRosterGuardsInactive } from './rosterGuardRelease.ts';

describe('markRosterGuardsInactive', () => {
  it('marks every still-active roster guard inactive and keeps the rest of the record', () => {
    const { guards, changed } = markRosterGuardsInactive([
      { id: 'g1', name: 'Ali', employeeId: 'E1', active: true, inactiveFrom: null },
      { id: 'g2', name: 'Bo', employeeId: 'E2' },
    ]);
    assert.equal(changed, true);
    assert.deepEqual(guards, [
      { id: 'g1', name: 'Ali', employeeId: 'E1', active: false, inactiveFrom: null },
      { id: 'g2', name: 'Bo', employeeId: 'E2', active: false },
    ]);
  });

  it('leaves an already-inactive roster unchanged', () => {
    const roster = [{ id: 'g1', name: 'Ali', active: false as const }];
    const { guards, changed } = markRosterGuardsInactive(roster);
    assert.equal(changed, false);
    assert.equal(guards[0], roster[0]);
  });

  it('does not invent a roster when the site has no guards array', () => {
    assert.deepEqual(markRosterGuardsInactive(undefined), { guards: [], changed: false });
    assert.deepEqual(markRosterGuardsInactive(null), { guards: [], changed: false });
  });
});
