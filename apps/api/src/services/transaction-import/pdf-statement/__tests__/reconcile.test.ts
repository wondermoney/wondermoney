import { describe, expect, it } from 'vitest';

import { reconcileStatement } from '../reconcile';

describe('reconcileStatement', () => {
  it('matches when the opening balance and the rows add up to the closing balance', () => {
    expect(reconcileStatement({ amounts: [-42.5, 1500, -12.35], closingBalance: 2445.15, currency: 'EUR', openingBalance: 1000 })).toEqual({
      closingBalance: 2445.15,
      currency: 'EUR',
      difference: 0,
      openingBalance: 1000,
      rowsTotal: 1445.15,
      status: 'matched',
    });
  });

  it('adds in cents, so binary fractions never fake a mismatch', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point.
    expect(reconcileStatement({ amounts: [0.1, 0.2], closingBalance: 0.3, currency: 'EUR', openingBalance: 0 }).status).toBe('matched');
    expect(reconcileStatement({ amounts: Array.from({ length: 1000 }, () => 0.01), closingBalance: 110, currency: 'EUR', openingBalance: 100 }).status).toBe('matched');
  });

  it('reports a difference of one cent as a mismatch, signed as what the rows are missing', () => {
    expect(reconcileStatement({ amounts: [-10], closingBalance: 89.99, currency: 'EUR', openingBalance: 100 })).toMatchObject({ difference: -0.01, rowsTotal: -10, status: 'mismatch' });
    // A row the model missed: 25.00 left the account that the rows do not show.
    expect(reconcileStatement({ amounts: [-10, 200], closingBalance: 265, currency: 'EUR', openingBalance: 100 })).toMatchObject({ difference: -25, status: 'mismatch' });
  });

  it('cannot check a statement that prints no opening or no closing balance', () => {
    expect(reconcileStatement({ amounts: [-10], closingBalance: null, currency: null, openingBalance: 100 })).toMatchObject({ difference: null, rowsTotal: -10, status: 'unavailable' });
    expect(reconcileStatement({ amounts: [-10], closingBalance: 90, currency: null, openingBalance: null })).toMatchObject({ difference: null, status: 'unavailable' });
  });

  it('handles negative balances, as on a credit card or an overdrawn account', () => {
    expect(reconcileStatement({ amounts: [-300.4, 100], closingBalance: -450.4, currency: 'EUR', openingBalance: -250 }).status).toBe('matched');
  });
});
