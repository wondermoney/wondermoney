import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addBudget } from '@app/__tests__/__helpers__/budget-fixtures';
import { addCategory, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';

import { MikroOrmTenantAggregationRepository } from '../tenant-aggregation.repository';

/*
 * Budget emails and badges measure a month's spending against what it may spend. With rollover on,
 * that is the month's budget plus what last month left over, worked out from the budget's own
 * spending figures, as the app shows them to that member.
 */
describe('budget allocations for emails, with rollover', () => {
  const db = useTestDatabase();

  async function setup(rolloverEnabled: boolean) {
    const em = db.em();
    const household = await seedHousehold(em);
    const food = await addCategory(em, household, 'Food');
    const groceries = await addCategory(em, household, 'Groceries', food);
    food.appuserKey = household.appuser;
    groceries.appuserKey = household.appuser;
    await em.flush();
    await addBudget(em, household, { lines: [{ accounts: [household.account], amount: 100, category: groceries, months: [6, 7], rolloverEnabled, year: 2026 }] });
    await addTransaction(em, household, { amount: -70, category: groceries, date: new Date('2026-06-10T12:00:00Z'), status: 'BOOKED' });
    return household;
  }

  it('gives each allocation its budget plus last month\'s leftover', async () => {
    const household = await setup(true);

    const rows = await new MikroOrmTenantAggregationRepository(db.em()).loadBudgetAllocations(household.appuser.appuserKey, { month: 7, year: 2026 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountAvailable: '130', amountBudgeted: '100.0000' });
  });

  it('leaves the available amount out when rollover is off', async () => {
    const household = await setup(false);

    const rows = await new MikroOrmTenantAggregationRepository(db.em()).loadBudgetAllocations(household.appuser.appuserKey, { month: 7, year: 2026 });

    expect(rows[0]?.amountAvailable).toBeUndefined();
  });
});
