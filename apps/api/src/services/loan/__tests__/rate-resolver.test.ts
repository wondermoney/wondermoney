import { describe, expect, it } from 'vitest';

import { resolveLoanRate } from '../rate-resolver';

describe('resolveLoanRate', () => {
  const history = [
    { annualInterestRateBps: 400, effectiveDate: new Date('2026-02-01T00:00:00Z') },
    { annualInterestRateBps: 600, effectiveDate: new Date('2026-04-01T00:00:00Z') },
  ];

  it('uses fallback before history and the new rate on its effective date', () => {
    expect(resolveLoanRate(history, new Date('2026-01-31T00:00:00Z'), 300)).toBe(300);
    expect(resolveLoanRate(history, new Date('2026-02-01T00:00:00Z'), 300)).toBe(400);
    expect(resolveLoanRate(history, new Date('2026-04-01T00:00:00Z'), 300)).toBe(600);
  });
});
