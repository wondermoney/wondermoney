import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import Big from 'big.js';

import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';
import type { InstantRange } from '@service/budget/aggregation-periods';
import type { MonthlyStoryRecurringChange } from '@service/budget/aggregation-types';
import { RecurringSeriesStatus } from '@service/recurring/recurring-types';

// A change is only worth surfacing to the user if it clears both thresholds: a purely
// relative move (e.g. EUR 0.50 -> EUR 1.00) can be 100% but still noise, and a purely
// absolute move on a large fixed cost (e.g. rent EUR 1000 -> EUR 1030) is only 3%. Requiring
// both keeps FX-rounding drift on tiny subscriptions from being flagged as a "change" while
// still catching genuinely material price hikes. This mirrors the 10% convention
// `classifyAmountType` already uses elsewhere in the recurring domain.
const RELATIVE_CHANGE_THRESHOLD = new Big(0.1);
const ABSOLUTE_CHANGE_THRESHOLD_EUR = new Big(2);

function isWithinRange(instant: Date, range: InstantRange): boolean {
  return instant >= range.start && instant < range.end;
}

function toMoneyString(amount: Big): string {
  return amount.toFixed(2);
}

/**
 * Detects new recurring subscriptions/bills and materially-changed amounts for a tenant's
 * confirmed recurring series within the subject month.
 *
 * A series is reported as `'new'` when its first-ever occurrence (`RecurringSeries.firstSeenAt`)
 * falls inside the subject month. Otherwise it is reported as `'changed'` when the most recent
 * occurrence within the subject month differs from the most recent occurrence before the subject
 * month by at least 10% relative AND at least EUR 2 absolute (both conditions must hold).
 * Series that are `candidate`, `dismissed`, `ended`, or `paused` are never considered — only
 * `confirmed` series are eligible, since those are the ones the user has actually acknowledged.
 */
export async function computeMonthlyRecurringChanges(
  em: EntityManager,
  tenantKey: number,
  monthRange: InstantRange,
): Promise<MonthlyStoryRecurringChange[]> {
  const series = await em.find(RecurringSeries, {
    deletedAt: null,
    status: RecurringSeriesStatus.confirmed,
    tenantKey,
  } as FilterQuery<RecurringSeries>);
  if (series.length === 0) return [];

  const changes: MonthlyStoryRecurringChange[] = [];
  for (const item of series) {
    const occurrences = await em.find(
      RecurringOccurrence,
      { deletedAt: null, recurringSeriesKey: item } as FilterQuery<RecurringOccurrence>,
      { orderBy: { occurrenceDate: 'asc' } },
    );

    const withinMonth = occurrences.filter((occurrence) => occurrence.amount != null && isWithinRange(occurrence.occurrenceDate, monthRange));
    const latestInMonth = withinMonth.at(-1);
    if (!latestInMonth?.amount) continue;

    const current = new Big(latestInMonth.amount);
    const isNew = item.firstSeenAt != null && isWithinRange(item.firstSeenAt, monthRange);
    if (isNew) {
      changes.push({
        displayName: item.displayName,
        kind: 'new',
        newAmount: toMoneyString(current),
        previousAmount: null,
        recurringSeriesKey: item.recurringSeriesKey,
      });
      continue;
    }

    const priorOccurrence = [...occurrences].reverse().find((occurrence) => occurrence.amount != null && occurrence.occurrenceDate < monthRange.start);
    if (!priorOccurrence?.amount) continue;

    const previous = new Big(priorOccurrence.amount);
    const absoluteDelta = current.minus(previous).abs();
    const relativeDelta = previous.gt(0) ? absoluteDelta.div(previous) : new Big(0);
    if (relativeDelta.gte(RELATIVE_CHANGE_THRESHOLD) && absoluteDelta.gte(ABSOLUTE_CHANGE_THRESHOLD_EUR)) {
      changes.push({
        displayName: item.displayName,
        kind: 'changed',
        newAmount: toMoneyString(current),
        previousAmount: toMoneyString(previous),
        recurringSeriesKey: item.recurringSeriesKey,
      });
    }
  }

  return changes;
}
