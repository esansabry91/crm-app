import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeInvoiceEditSubTotal } from './invoiceEditTotals.ts';

describe('computeInvoiceEditSubTotal', () => {
  it('adds each additional site subtotal onto the edited primary site', () => {
    const primarySubTotal = 1000 + 200;
    const subTotal = computeInvoiceEditSubTotal(primarySubTotal, [{ subTotal: 500 }, { subTotal: 300 }]);
    assert.equal(subTotal, 2000);
    const sstAmount = Math.round((subTotal * 0.08 + Number.EPSILON) * 100) / 100;
    assert.equal(sstAmount, 160);
    assert.equal(Math.round((subTotal + sstAmount + Number.EPSILON) * 100) / 100, 2160);
  });

  it('leaves a single-site invoice unchanged when there are no additional bills', () => {
    assert.equal(computeInvoiceEditSubTotal(1200, undefined), 1200);
    assert.equal(computeInvoiceEditSubTotal(1200, []), 1200);
  });

  it('does not let a missing additional subtotal wipe the primary site', () => {
    assert.equal(computeInvoiceEditSubTotal(1200, [{ subTotal: 400 }, {}]), 1600);
  });
});
