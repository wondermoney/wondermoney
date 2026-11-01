import { describe, expect, it, vi } from 'vitest';

import { addMerchant, addTransaction, seedHousehold, type StatusName } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { detectRecurringCandidatesForTenant } from '../recurring-detection.service';

/*
 * A retracted (EXPIRED) charge is not an occurrence of anything: the money never moved. A pending
 * charge is, since its booking replaces it in place.
 */
describe('recurring detection and transaction status', () => {
  const db = useTestDatabase();

  async function seedMonthlyCharges(statuses: (null | StatusName)[]) {
    const em = db.em();
    const household = await seedHousehold(em);
    const merchant = await addMerchant(em, household, 'Spotify');
    const keys: Record<string, number> = {};
    for (const [index, status] of statuses.entries()) {
      const transaction = await addTransaction(em, household, { amount: -10.99, date: new Date(Date.UTC(2026, index, 5, 12)), merchant, status });
      keys[status ?? 'none'] = transaction.transactionKey;
    }
    return { household, keys };
  }

  it('does not find a series that only exists because of an expired charge', async () => {
    const { household } = await seedMonthlyCharges(['BOOKED', 'BOOKED', 'EXPIRED']);

    await detectRecurringCandidatesForTenant(household.tenant.tenantKey, { referenceDate: new Date('2026-03-20T00:00:00Z') });

    await expect(db.em().count(RecurringSeries, {})).resolves.toBe(0);
  });

  it('builds a series from booked, pending and status-less charges without the expired one', async () => {
    const { household, keys } = await seedMonthlyCharges(['BOOKED', 'PENDING', null, 'EXPIRED']);

    await detectRecurringCandidatesForTenant(household.tenant.tenantKey, { referenceDate: new Date('2026-04-20T00:00:00Z') });

    const em = db.em();
    const [series] = await em.find(RecurringSeries, {});
    expect(series).toMatchObject({ lastSeenAt: new Date(Date.UTC(2026, 2, 5, 12)), occurrenceCount: 3 });
    const occurrences = await em.find(RecurringOccurrence, {}, { orderBy: { occurrenceDate: 'asc' } });
    expect(occurrences.map((occurrence) => occurrence.transactionKey?.transactionKey)).toEqual([keys['BOOKED'], keys['PENDING'], keys['none']]);
  });
});
