import { describe, expect, it } from 'vitest';

import { budgetCrossingKey, budgetEnvelopeKey, monthlyEnvelopeKey, weeklyEnvelopeKey } from '../financial-email-delivery.service';

describe('financial email keys', () => {
  it('builds compact versioned keys within SentEmail limits', () => {
    const keys = [
      budgetEnvelopeKey('2026-07-18'),
      budgetCrossingKey({ budgetKey: 22, budgetTemplateCategoryKey: 33, month: 7, tenantKey: 11, threshold: 100, year: 2026 }),
      weeklyEnvelopeKey(2026, 3),
      monthlyEnvelopeKey(2026, 3),
    ];
    expect(keys).toEqual(['ba:d:20260718', 'ba:c:11:22:33:202607:100', 'wi:w:2026-W03', 'ms:m:202603']);
    expect(keys.every((key) => key.length <= 100)).toBe(true);
  });
});

describe('monthlyEnvelopeKey', () => {
  it('formats as ms:m:YYYYMM', () => {
    expect(monthlyEnvelopeKey(2026, 7)).toBe('ms:m:202607');
    expect(monthlyEnvelopeKey(2026, 12)).toBe('ms:m:202612');
  });
});
