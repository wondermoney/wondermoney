import { describe, expect, it, vi } from 'vitest';

import { addMerchant, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { detectRecurringCandidatesForTenant } from '../recurring-detection.service';

/*
 * Detection can run twice at once for one household: the post-sync trigger and the scheduled
 * job. Each run reads the existing series and creates the missing ones, so without a lock that
 * holds for the whole run both see "no series yet" and each creates one. Two sessions contending
 * need a real server; PGlite is a single backend (see `pg-test-db.ts`).
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('recurring detection under concurrent runs', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });

  it('creates one series when several runs for the same account overlap', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const merchant = await addMerchant(em, household, 'Spotify');
    for (let month = 0; month < 4; month += 1) {
      await addTransaction(em, household, { amount: -10.99, date: new Date(Date.UTC(2026, month, 5, 12)), merchant, status: 'BOOKED' });
    }
    const options = { referenceDate: new Date('2026-04-20T00:00:00Z') };

    const runs = await Promise.all(Array.from({ length: 4 }, () => detectRecurringCandidatesForTenant(household.tenant.tenantKey, options)));

    const check = db.em();
    await expect(check.count(RecurringSeries, {})).resolves.toBe(1);
    await expect(check.count(RecurringOccurrence, {})).resolves.toBe(4);
    expect(runs.reduce((sum, run) => sum + run.created, 0)).toBe(1);
  });
});
