import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

import type { RecurringOccurrence } from '@entity/RecurringOccurrence';
import type { RecurringSeries } from '@entity/RecurringSeries';
import type { InstantRange } from '@service/budget/aggregation-periods';
import { RecurringSeriesStatus } from '@service/recurring/recurring-types';

import { computeMonthlyRecurringChanges } from '../monthly-story-recurring-changes';

const DEFAULT_TENANT_KEY = 11;
const SUBJECT_MONTH: InstantRange = { end: new Date('2026-08-01'), start: new Date('2026-07-01') };

let nextSeriesKey = 1;
let nextOccurrenceKey = 1;

function fakeEmWith({ occurrences, series }: { occurrences: RecurringOccurrence[]; series: RecurringSeries[] }): EntityManager {
  const find = vi.fn((entity: { name: string }, where: Record<string, unknown>) => {
    if (entity.name === 'RecurringOccurrence') {
      const filterSeries = where['recurringSeriesKey'] as RecurringSeries;
      return Promise.resolve(
        occurrences
          .filter((occurrence) => occurrence.recurringSeriesKey === filterSeries)
          .slice()
          .sort((a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime()),
      );
    }
    return Promise.resolve(
      series.filter((item) => item.tenantKey === where['tenantKey'] && item.status === where['status'] && item.deletedAt === where['deletedAt']),
    );
  });

  return { find } as unknown as EntityManager;
}

function occurrenceFixture(overrides: { amount?: null | number; occurrenceDate: Date; recurringSeriesKey: RecurringSeries }): RecurringOccurrence {
  return {
    amount: null,
    deletedAt: null,
    recurringOccurrenceKey: nextOccurrenceKey++,
    ...overrides,
  } as unknown as RecurringOccurrence;
}

function seriesFixture(overrides: Partial<RecurringSeries> = {}): RecurringSeries {
  return {
    deletedAt: null,
    displayName: 'Spotify',
    firstSeenAt: null,
    recurringSeriesKey: nextSeriesKey++,
    status: RecurringSeriesStatus.confirmed,
    tenantKey: DEFAULT_TENANT_KEY,
    ...overrides,
  } as RecurringSeries;
}

describe('computeMonthlyRecurringChanges', () => {
  it('flags a series first-occurring in the subject month as new', async () => {
    const series = seriesFixture({ firstSeenAt: new Date('2026-07-15') });
    const em = fakeEmWith({
      occurrences: [occurrenceFixture({ amount: 39.9, occurrenceDate: new Date('2026-07-15'), recurringSeriesKey: series })],
      series: [series],
    });

    const changes = await computeMonthlyRecurringChanges(em, DEFAULT_TENANT_KEY, SUBJECT_MONTH);

    expect(changes).toContainEqual(
      expect.objectContaining({ displayName: 'Spotify', kind: 'new', newAmount: '39.90', previousAmount: null, recurringSeriesKey: series.recurringSeriesKey }),
    );
  });

  it('does not flag a change when the move is under both the relative and absolute thresholds', async () => {
    const series = seriesFixture({ displayName: 'Small Subscription', firstSeenAt: new Date('2026-01-01') });
    const em = fakeEmWith({
      occurrences: [
        occurrenceFixture({ amount: 12.99, occurrenceDate: new Date('2026-06-15'), recurringSeriesKey: series }),
        occurrenceFixture({ amount: 13.05, occurrenceDate: new Date('2026-07-15'), recurringSeriesKey: series }),
      ],
      series: [series],
    });

    const changes = await computeMonthlyRecurringChanges(em, DEFAULT_TENANT_KEY, SUBJECT_MONTH);

    expect(changes).toEqual([]);
  });

  it('flags a change when the move exceeds both the relative and absolute thresholds', async () => {
    const series = seriesFixture({ displayName: 'Small Subscription', firstSeenAt: new Date('2026-01-01') });
    const em = fakeEmWith({
      occurrences: [
        occurrenceFixture({ amount: 12.99, occurrenceDate: new Date('2026-06-15'), recurringSeriesKey: series }),
        occurrenceFixture({ amount: 14.99, occurrenceDate: new Date('2026-07-15'), recurringSeriesKey: series }),
      ],
      series: [series],
    });

    const changes = await computeMonthlyRecurringChanges(em, DEFAULT_TENANT_KEY, SUBJECT_MONTH);

    expect(changes).toContainEqual(
      expect.objectContaining({ displayName: 'Small Subscription', kind: 'changed', newAmount: '14.99', previousAmount: '12.99', recurringSeriesKey: series.recurringSeriesKey }),
    );
  });

  it('ignores dismissed/ended/paused series', async () => {
    const dismissed = seriesFixture({ displayName: 'Dismissed', firstSeenAt: new Date('2026-01-01'), status: RecurringSeriesStatus.dismissed });
    const ended = seriesFixture({ displayName: 'Ended', firstSeenAt: new Date('2026-01-01'), status: RecurringSeriesStatus.ended });
    const paused = seriesFixture({ displayName: 'Paused', firstSeenAt: new Date('2026-01-01'), status: RecurringSeriesStatus.paused });
    const candidate = seriesFixture({ displayName: 'Candidate', firstSeenAt: new Date('2026-01-01'), status: RecurringSeriesStatus.candidate });

    // Seed each non-confirmed series with an amount change large enough to flag on its own,
    // so this test proves the status filter — not a lack of qualifying data — is what
    // keeps them out of the results.
    const em = fakeEmWith({
      occurrences: [dismissed, ended, paused, candidate].flatMap((series) => [
        occurrenceFixture({ amount: 10, occurrenceDate: new Date('2026-06-15'), recurringSeriesKey: series }),
        occurrenceFixture({ amount: 20, occurrenceDate: new Date('2026-07-15'), recurringSeriesKey: series }),
      ]),
      series: [dismissed, ended, paused, candidate],
    });

    const changes = await computeMonthlyRecurringChanges(em, DEFAULT_TENANT_KEY, SUBJECT_MONTH);

    expect(changes).toEqual([]);
  });

  describe('materiality threshold boundaries', () => {
    async function computeBoundaryChanges(previousAmount: number, currentAmount: number) {
      const series = seriesFixture({ displayName: 'Boundary Case', firstSeenAt: new Date('2026-01-01') });
      const em = fakeEmWith({
        occurrences: [
          occurrenceFixture({ amount: previousAmount, occurrenceDate: new Date('2026-06-15'), recurringSeriesKey: series }),
          occurrenceFixture({ amount: currentAmount, occurrenceDate: new Date('2026-07-15'), recurringSeriesKey: series }),
        ],
        series: [series],
      });
      return computeMonthlyRecurringChanges(em, DEFAULT_TENANT_KEY, SUBJECT_MONTH);
    }

    it.each([
      ['exactly 10% relative and exactly EUR 2 absolute', 20, 22],
      ['comfortably over both thresholds', 20, 30],
    ])('flags a change that is %s', async (_description, previousAmount, currentAmount) => {
      const changes = await computeBoundaryChanges(previousAmount, currentAmount);

      expect(changes).toEqual([expect.objectContaining({ kind: 'changed' })]);
    });

    it.each([
      ['just under 10% relative even though absolute clears EUR 2', 21, 23],
      ['just under EUR 2 absolute even though relative clears 10%', 15, 16.99],
      ['comfortably under both thresholds', 100, 101],
      ['identical amounts (zero delta)', 50, 50],
    ])('does not flag a change that is %s', async (_description, previousAmount, currentAmount) => {
      const changes = await computeBoundaryChanges(previousAmount, currentAmount);

      expect(changes).toEqual([]);
    });
  });
});
