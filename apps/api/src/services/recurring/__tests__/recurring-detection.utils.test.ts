import { describe, expect, it } from 'vitest';

import {
  classifyAmountType,
  detectCadence,
  normalizeRecurringMerchant,
  scoreRecurringCandidate,
} from '../recurring-detection.utils';
import { RecurringAmountType, RecurringCadence } from '../recurring-types';

describe('recurring detection utils', () => {
  it('normalizes recurring merchant names', () => {
    expect(normalizeRecurringMerchant('SPOTIFY P123456 LONDON')).toBe('spotify london');
    expect(normalizeRecurringMerchant('Netflix.com 12345')).toBe('netflix com');
    expect(normalizeRecurringMerchant('EDP COMERCIAL 2026-04-21')).toBe('edp comercial');
    expect(normalizeRecurringMerchant('ÁGUAS DE LISBOA 123')).toBe('aguas de lisboa');
    expect(normalizeRecurringMerchant('Farmácia Central')).toBe('farmacia central');
    expect(normalizeRecurringMerchant('')).toBe('');
    expect(normalizeRecurringMerchant(undefined)).toBe('');
  });

  it('detects monthly cadence with drift', () => {
    expect(
      detectCadence([
        new Date('2026-01-12'),
        new Date('2026-02-11'),
        new Date('2026-03-13'),
        new Date('2026-04-12'),
      ]),
    ).toEqual({ cadence: RecurringCadence.monthly, confidence: 95 });
  });

  it('returns null for irregular cadence', () => {
    expect(detectCadence([new Date('2026-01-01'), new Date('2026-01-19'), new Date('2026-03-04')])).toBeNull();
  });

  it('supports cadence tolerance windows', () => {
    expect(detectCadence([new Date('2026-01-01'), new Date('2026-01-08')])).toEqual({ cadence: RecurringCadence.weekly, confidence: 95 });
    expect(detectCadence([new Date('2026-01-01'), new Date('2026-01-14')])).toEqual({ cadence: RecurringCadence.biweekly, confidence: 95 });
    expect(detectCadence([new Date('2026-01-01'), new Date('2026-01-31')])).toEqual({ cadence: RecurringCadence.monthly, confidence: 95 });
    expect(detectCadence([new Date('2026-01-01'), new Date('2026-04-01')])).toEqual({ cadence: RecurringCadence.quarterly, confidence: 95 });
    expect(detectCadence([new Date('2026-01-01'), new Date('2027-01-01')])).toEqual({ cadence: RecurringCadence.yearly, confidence: 95 });
  });

  it('classifies stable and volatile amounts', () => {
    expect(classifyAmountType([10.99, 10.99, 10.99, 10.99])).toBe(RecurringAmountType.fixed);
    expect(classifyAmountType([-10, -10, -10])).toBe(RecurringAmountType.fixed);
    expect(classifyAmountType([54.2, 72.1, 91.8, 66.3])).toBe(RecurringAmountType.variable);
  });

  it('scores recurring candidates', () => {
    expect(
      scoreRecurringCandidate({
        amountType: RecurringAmountType.fixed,
        hasKnownCadence: true,
        hasMerchantKey: true,
        hasRecurringFriendlyCategory: true,
        occurrenceCount: 4,
        seenRecently: true,
      }),
    ).toBe(100);

    expect(
      scoreRecurringCandidate({
        amountType: RecurringAmountType.variable,
        hasKnownCadence: false,
        hasMerchantKey: true,
        hasRecurringFriendlyCategory: false,
        occurrenceCount: 2,
        seenRecently: true,
      }),
    ).toBe(25);

    expect(
      scoreRecurringCandidate({
        amountType: RecurringAmountType.variable,
        hasKnownCadence: false,
        hasMerchantKey: false,
        hasRecurringFriendlyCategory: false,
        occurrenceCount: 1,
        seenRecently: false,
        userDismissedSimilar: true,
      }),
    ).toBe(0);

    expect(
      scoreRecurringCandidate({
        amountType: RecurringAmountType.fixed,
        hasKnownCadence: true,
        hasMerchantKey: true,
        hasRecurringFriendlyCategory: true,
        occurrenceCount: 4,
        seenRecently: true,
        userConfirmedSimilar: true,
      }),
    ).toBe(100);
  });
});
