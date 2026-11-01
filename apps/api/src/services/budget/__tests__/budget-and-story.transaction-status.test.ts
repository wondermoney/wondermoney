import { describe, expect, it, vi } from 'vitest';

import { addCategory, addTransaction, ONE_OF_EACH_STATUS, seedHousehold, type StatusName } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';
import { RecurringSeriesStatus } from '@service/recurring/recurring-types';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { computeMonthlyRecurringChanges } from '../monthly-story-recurring-changes';
import { getBudgetSpending } from '../spending';
import { MikroOrmTenantAggregationRepository } from '../tenant-aggregation.repository';

const JULY = { end: new Date('2026-08-01T00:00:00Z'), start: new Date('2026-07-01T00:00:00Z') };
const MID_JULY = new Date('2026-07-15T12:00:00Z');

/*
 * EXPIRED rows are money that never moved. Budget spending, the monthly email aggregation and the
 * monthly story's recurring changes leave them out; PENDING keeps counting as committed spending,
 * and a row with no status (legacy) counts as before.
 */
describe('budget and monthly story aggregates and transaction status', () => {
  const db = useTestDatabase();

  it('leaves expired rows out of budget category spending', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addCategory(em, household, 'Groceries', await addCategory(em, household, 'Food'));
    for (const status of ONE_OF_EACH_STATUS) await addTransaction(em, household, { amount: -10, category: groceries, date: MID_JULY, status });
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name: 'Home', numAdults: 1, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    const template = em.create(BudgetTemplateCategory, { amountBudgeted: 100, budgetKey: budget, categoryKey: groceries, month: 7, year: 2026 }, { partial: true });
    await em.flush();

    const rows = await getBudgetSpending({ accountKeys: [household.account.accountKey], period: 'monthly', templateKeys: [template.budgetTemplateCategoryKey], tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });

    expect(rows.find((row) => row.child_category_name === 'Groceries')).toMatchObject({ category_amount: 30 });
  });

  it('leaves expired rows out of the monthly aggregation, keeping pending and status-less rows', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const kept: number[] = [];
    for (const status of ONE_OF_EACH_STATUS) {
      const transaction = await addTransaction(em, household, { amount: -10, date: MID_JULY, status });
      if (status !== 'EXPIRED') kept.push(transaction.transactionKey);
    }

    const rows = await new MikroOrmTenantAggregationRepository(db.em()).loadTransactions(household.appuser.appuserKey, household.tenant.tenantKey, JULY);

    expect(rows.map((row) => row.transactionKey).sort()).toEqual(kept.sort());
  });

  async function seedSeriesWithJulyOccurrenceOn(julyStatus: StatusName) {
    const em = db.em();
    const household = await seedHousehold(em);
    const series = em.create(RecurringSeries, { displayName: 'Gym', firstSeenAt: new Date('2026-01-10T00:00:00Z'), normalizedMerchantKey: 'gym', status: RecurringSeriesStatus.confirmed, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    const june = await addTransaction(em, household, { amount: -10, date: new Date('2026-06-10T00:00:00Z'), status: 'BOOKED' });
    const july = await addTransaction(em, household, { amount: -20, date: new Date('2026-07-10T00:00:00Z'), status: julyStatus });
    em.create(RecurringOccurrence, { amount: 10, occurrenceDate: june.transactionDate, recurringSeriesKey: series, transactionKey: june }, { partial: true });
    em.create(RecurringOccurrence, { amount: 20, occurrenceDate: july.transactionDate, recurringSeriesKey: series, transactionKey: july }, { partial: true });
    await em.flush();
    return household;
  }

  it('does not report a recurring price change from an expired occurrence', async () => {
    const household = await seedSeriesWithJulyOccurrenceOn('EXPIRED');

    await expect(computeMonthlyRecurringChanges(db.em(), household.tenant.tenantKey, JULY)).resolves.toEqual([]);
  });

  it('still reports a recurring price change from a pending occurrence', async () => {
    const household = await seedSeriesWithJulyOccurrenceOn('PENDING');

    await expect(computeMonthlyRecurringChanges(db.em(), household.tenant.tenantKey, JULY)).resolves.toEqual([expect.objectContaining({ kind: 'changed', newAmount: '20.00', previousAmount: '10.00' })]);
  });
});
