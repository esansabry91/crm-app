import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calendarDaysUntil, localMonthIso, localTodayIso } from './calendarDays.ts';

const afternoon = new Date(2026, 8, 25, 15, 30, 0);

describe('calendarDaysUntil', () => {
  it('returns 0 when the contract ends today', () => {
    assert.equal(calendarDaysUntil('2026-09-25', afternoon), 0);
  });

  it('returns -1 the day after the contract end date', () => {
    assert.equal(calendarDaysUntil('2026-09-24', afternoon), -1);
  });

  it('counts whole days forward, including the 30- and 60-day reminder windows', () => {
    assert.equal(calendarDaysUntil('2026-10-25', afternoon), 30);
    assert.equal(calendarDaysUntil('2026-11-24', afternoon), 60);
    assert.equal(calendarDaysUntil('2026-11-25', afternoon), 61);
  });

  it('returns null for a missing or impossible date', () => {
    assert.equal(calendarDaysUntil(undefined, afternoon), null);
    assert.equal(calendarDaysUntil('', afternoon), null);
    assert.equal(calendarDaysUntil('not-a-date', afternoon), null);
    assert.equal(calendarDaysUntil('2026-02-31', afternoon), null);
  });
});

describe('localTodayIso / localMonthIso', () => {
  it('uses the local calendar date, not the UTC one', () => {
    // 1 Jan 2027, 00:30 local. In Malaysia (UTC+8) toISOString() says 2026-12-31.
    const justAfterMidnight = new Date(2027, 0, 1, 0, 30, 0);
    assert.equal(localTodayIso(justAfterMidnight), '2027-01-01');
    assert.equal(localMonthIso(justAfterMidnight), '2027-01');
  });

  it('zero-pads month and day', () => {
    assert.equal(localTodayIso(new Date(2026, 8, 5, 12, 0, 0)), '2026-09-05');
  });
});
