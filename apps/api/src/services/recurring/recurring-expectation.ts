import type { RecurringSeries } from '@entity/RecurringSeries';

import { RecurringAmountType, RecurringSeriesStatus } from './recurring-types';

/** A detected candidate this sure of itself counts as expected without being confirmed. */
const EXPECTED_CANDIDATE_CONFIDENCE = 90;

/**
 * Whether a recurring item counts as expected money out: confirmed, or a candidate detected with
 * high confidence. Dismissed, paused and ended items, and candidates still to review, do not. The
 * recurring summary totals and the budget forecast count the same items.
 */
export function isExpectedRecurring(series: Pick<RecurringSeries, 'confidenceScore' | 'status'>): boolean {
  return series.status === RecurringSeriesStatus.confirmed
    || (series.status === RecurringSeriesStatus.candidate && series.confidenceScore >= EXPECTED_CANDIDATE_CONFIDENCE);
}

/**
 * What one occurrence of a recurring item is expected to take, in the item's currency: its expected
 * amount, or for a variable one its highest (as the recurring summary totals it). Null when the item
 * records no amount.
 */
export function expectedOccurrenceAmount(series: Pick<RecurringSeries, 'amountType' | 'averageAmount' | 'expectedAmount' | 'expectedAmountMax'>): null | number {
  const amount = series.amountType === RecurringAmountType.variable
    ? (series.expectedAmountMax ?? series.expectedAmount ?? series.averageAmount)
    : (series.expectedAmount ?? series.averageAmount);
  return amount ?? null;
}
