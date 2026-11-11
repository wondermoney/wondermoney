import type { FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';

import { buildRecurringSchedule, type RecurringScheduleEntry } from './recurring-schedule';
import { RecurringSeriesStatus } from './recurring-types';

/**
 * How far outside the requested range occurrences are read, so a payment a few days before or
 * after its expected date still settles that cycle. Wider than the schedule's ten-day window.
 */
const OCCURRENCE_MATCH_WINDOW_MS = 11 * 86_400_000;

export interface LoadRecurringScheduleInput {
  em?: EntityManager;
  from: Date;
  tenantKey: number;
  to: Date;
}

/**
 * The calendar entries of every confirmed recurring series in a household, for `[from, to]`.
 *
 * The caller arms the tenant filter on the request EM (`setTenantContext`), so the series query
 * also applies the per-account privacy carve-out: a series detected from a private account is
 * returned only to that account's owner. The occurrences are read through the series keys, so
 * they inherit the same scope.
 */
export async function loadRecurringSchedule(input: LoadRecurringScheduleInput): Promise<RecurringScheduleEntry[]> {
  const em = input.em ?? DI.em;
  const series = await em.find(
    RecurringSeries,
    tenantSeriesWhere(input.tenantKey, { status: RecurringSeriesStatus.confirmed }),
    { populate: ['currencyKey'] },
  );
  if (series.length === 0) return [];

  const occurrences = await em.find(
    RecurringOccurrence,
    {
      deletedAt: null,
      occurrenceDate: {
        $gte: new Date(input.from.getTime() - OCCURRENCE_MATCH_WINDOW_MS),
        $lte: new Date(input.to.getTime() + OCCURRENCE_MATCH_WINDOW_MS),
      },
      recurringSeriesKey: { $in: series },
    },
    { populate: ['currencyKey'] },
  );

  return buildRecurringSchedule(
    series.map((item) => ({
      amountType: item.amountType,
      averageAmount: item.averageAmount,
      cadence: item.cadence,
      currency: item.currencyKey?.code ?? null,
      displayName: item.displayName,
      expectedAmount: item.expectedAmount,
      expectedAmountMax: item.expectedAmountMax,
      nextExpectedAt: item.nextExpectedAt,
      recurringSeriesKey: item.recurringSeriesKey,
    })),
    occurrences.map((occurrence) => ({
      amount: occurrence.amount,
      currency: occurrence.currencyKey?.code ?? null,
      date: occurrence.occurrenceDate,
      matchStatus: occurrence.matchStatus,
      seriesKey: occurrence.recurringSeriesKey.recurringSeriesKey,
    })),
    { from: input.from, to: input.to },
  );
}

/**
 * A series query scoped to one household.
 *
 * `Object.assign` is deliberate: it keeps the tenant key a plain number (what the query needs)
 * while the intersection with `FilterQuery` satisfies the entity-relation type, the same shape
 * the recurring controller uses.
 */
function tenantSeriesWhere(tenantKey: number, filters: FilterQuery<RecurringSeries> = {}) {
  return Object.assign({ deletedAt: null, tenantKey }, filters);
}
