import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addBudget } from '@app/__tests__/__helpers__/budget-fixtures';
import { addCategory, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';

import { MikroOrmTenantAggregationRepository } from '../tenant-aggregation.repository';
import { TenantFinancialAggregationService } from '../tenant-financial-aggregation.service';

/*
 * Budget alerts, the budget-left email and the weekly badge read the same budget month as the
 * budget page: with a start day of 25, from 25 November on the current month is December, and only
 * what was spent from that day counts.
 */
describe('budget alerts with a month start day', () => {
  const db = useTestDatabase();
  const at = (day: string) => new Date(`${day}T00:00:00.000Z`);

  async function setup(periodStartDay: number) {
    const em = db.em();
    const household = await seedHousehold(em);
    const food = await addCategory(em, household, 'Food');
    const groceries = await addCategory(em, household, 'Groceries', food);
    food.appuserKey = household.appuser;
    groceries.appuserKey = household.appuser;
    await em.flush();
    const { budget } = await addBudget(em, household, { lines: [{ accounts: [household.account], amount: 100, category: groceries, months: [11, 12], rolloverEnabled: true, year: 2026 }], periodStartDay });
    const spend = (amount: number, day: string) => addTransaction(em, household, { amount, category: groceries, date: at(day), status: 'BOOKED' });
    const service = new TenantFinancialAggregationService(new MikroOrmTenantAggregationRepository(em));
    return { budget, household, service, spend };
  }

  it('alerts on the budget month the day is in, over that month\'s days, with what last month carried', async () => {
    const { household, service, spend } = await setup(25);
    // November (25 October to 24 November) spends 60 of 100: December may spend 140.
    await spend(-60, '2026-11-24');
    await spend(-120, '2026-11-25');

    const result = await service.aggregateBudgetThresholds({ appuserKey: household.appuser.appuserKey, scheduledFor: '2026-11-26T09:00:00Z', tenantKey: household.tenant.tenantKey });

    expect(result.status).toBe('ok');
    expect(result.facts).toEqual([expect.objectContaining({ amountBudgeted: '140', amountSpent: '120', month: 12, state: 'near', year: 2026 })]);
  });

  it('reads the month before the start day as the month it is named for', async () => {
    const { household, service, spend } = await setup(25);
    await spend(-90, '2026-11-24');
    await spend(-500, '2026-11-25');

    const result = await service.aggregateBudgetRemaining({ appuserKey: household.appuser.appuserKey, scheduledFor: '2026-11-24T09:00:00Z', tenantKey: household.tenant.tenantKey });

    expect(result).toMatchObject({ facts: { remaining: '10', spent: '90', totalBudgeted: '100' }, status: 'ok' });
  });

  it('with start day 1 alerts on the calendar month', async () => {
    const { household, service, spend } = await setup(1);
    await spend(-30, '2026-10-31');
    await spend(-90, '2026-11-01');

    const result = await service.aggregateBudgetThresholds({ appuserKey: household.appuser.appuserKey, scheduledFor: '2026-11-26T09:00:00Z', tenantKey: household.tenant.tenantKey });

    expect(result.facts).toEqual([expect.objectContaining({ amountBudgeted: '100', amountSpent: '90', month: 11, year: 2026 })]);
  });
});
