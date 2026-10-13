import { describe, expect, it } from 'vitest';

import { computeAvailableBalance } from '../account-available-balance.service';

describe('computeAvailableBalance', () => {
  it('equals the current balance when there are no pending transactions', () => {
    expect(computeAvailableBalance(1000, [])).toBe(1000);
  });

  it('subtracts pending outflows (already signed negative) from the current balance', () => {
    // €1000 current, a €50 pending card payment (stored as -50) => €950 available
    expect(computeAvailableBalance(1000, [-50])).toBe(950);
  });

  it('adds pending inflows and nets multiple pendings', () => {
    expect(computeAvailableBalance(1000, [-50, -20, 200])).toBe(1130);
  });

  it('treats a null/undefined current balance as zero', () => {
    expect(computeAvailableBalance(null, [-50])).toBe(-50);
    expect(computeAvailableBalance(undefined, [])).toBe(0);
  });

  it('ignores null/undefined pending amounts', () => {
    expect(computeAvailableBalance(100, [undefined, -10, null])).toBe(90);
  });
});
