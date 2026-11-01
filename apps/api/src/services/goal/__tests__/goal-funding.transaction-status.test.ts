import { describe, expect, it, vi } from 'vitest';

import { addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { GoalActivityType } from '@entity/GoalActivity';
import { GoalTransactionFunding } from '@entity/GoalTransactionFunding';
import { Transaction } from '@entity/Transaction';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { GoalService } from '../goal.service';

/*
 * A goal pays for an expense by funding it. An EXPIRED transaction is a charge the bank retracted:
 * the money never left, so there is nothing to pay for. A funding made before the charge expired
 * is the user's own record and stays, flagged, so they can decide; reversing it still works.
 */
describe('goal funding and transaction status', () => {
  const db = useTestDatabase();
  const today = new Date('2026-10-01T12:00:00Z');

  async function seedGoalWithMoney(household: Household, assigned = 100) {
    const service = new GoalService(db.em());
    const context = { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey };
    const goal = await service.createGoal({ ...context, currencyKey: household.currency.currencyKey, name: 'Holiday', targetAmount: 1000 });
    await new GoalService(db.em()).assignMoneyToGoal({ ...context, amount: assigned, currencyKey: household.currency.currencyKey, goalKey: goal.goalKey });
    return { context, goalKey: goal.goalKey };
  }

  const available = async (household: Household, goalKey: number) => {
    const { summary } = await new GoalService(db.em()).getGoal({ appuserKey: household.appuser.appuserKey, goalKey, tenantKey: household.tenant.tenantKey });
    return summary.availableAmount;
  };

  it('refuses to fund an expired transaction and leaves the goal balance alone', async () => {
    const household = await seedHousehold(db.em());
    const { context, goalKey } = await seedGoalWithMoney(household);
    const retracted = await addTransaction(db.em(), household, { amount: -40, date: today, status: 'EXPIRED' });

    const attempt = new GoalService(db.em()).fundTransactionFromGoal({ ...context, amount: 40, goalKey, transactionKey: retracted.transactionKey });

    await expect(attempt).rejects.toMatchObject({ code: 'transaction_expired', status: 400 });
    await expect(db.em().count(GoalTransactionFunding, {})).resolves.toBe(0);
    await expect(available(household, goalKey)).resolves.toBe(100);
  });

  it.each(['BOOKED', 'PENDING', null] as const)('funds a %s transaction', async (status) => {
    const household = await seedHousehold(db.em());
    const { context, goalKey } = await seedGoalWithMoney(household);
    const charge = await addTransaction(db.em(), household, { amount: -40, date: today, status });

    await new GoalService(db.em()).fundTransactionFromGoal({ ...context, amount: 40, goalKey, transactionKey: charge.transactionKey });

    await expect(available(household, goalKey)).resolves.toBe(60);
  });

  async function fundThenExpire(household: Household) {
    const { context, goalKey } = await seedGoalWithMoney(household);
    const charge = await addTransaction(db.em(), household, { amount: -40, date: today, status: 'PENDING' });
    const funding = await new GoalService(db.em()).fundTransactionFromGoal({ ...context, amount: 40, goalKey, transactionKey: charge.transactionKey });
    const em = db.em();
    await em.nativeUpdate(Transaction, { transactionKey: charge.transactionKey }, { transactionStatusKey: household.statuses.EXPIRED });
    return { charge, context, fundingKey: funding.goalTransactionFundingKey, goalKey };
  }

  it('keeps a funding whose transaction expired afterwards, and reverses it on request', async () => {
    const household = await seedHousehold(db.em());
    const { context, fundingKey, goalKey } = await fundThenExpire(household);
    await expect(available(household, goalKey)).resolves.toBe(60);

    await new GoalService(db.em()).undoTransactionFunding({ ...context, goalKey, goalTransactionFundingKey: fundingKey });

    await expect(available(household, goalKey)).resolves.toBe(100);
    const funding = await db.em().findOneOrFail(GoalTransactionFunding, { goalTransactionFundingKey: fundingKey });
    expect(funding.reversedAt).toBeInstanceOf(Date);
  });

  it('flags the activity of a still-active funding whose transaction expired', async () => {
    const household = await seedHousehold(db.em());
    const { charge, context, goalKey } = await fundThenExpire(household);
    const booked = await addTransaction(db.em(), household, { amount: -10, date: today, status: 'BOOKED' });
    await new GoalService(db.em()).fundTransactionFromGoal({ ...context, amount: 10, goalKey, transactionKey: booked.transactionKey });

    const page = await new GoalService(db.em()).getGoalActivity({ ...context, goalKey, limit: 50, offset: 0 });

    // What the client receives: the entities as `res.json` serialises them.
    const { activities } = JSON.parse(JSON.stringify(page)) as { activities: { transactionExpired?: boolean; transactionKey?: number; type: GoalActivityType }[] };
    const spent = activities.filter((activity) => activity.type === GoalActivityType.SPENT_FROM_GOAL);
    const flagOf = (transactionKey: number) => spent.find((activity) => activity.transactionKey === transactionKey)?.transactionExpired;
    expect(flagOf(charge.transactionKey)).toBe(true);
    expect(flagOf(booked.transactionKey)).toBe(false);
    expect(activities.find((activity) => activity.type === GoalActivityType.ASSIGNED)?.transactionExpired).toBe(false);
  });

  it('stops flagging once the funding is reversed', async () => {
    const household = await seedHousehold(db.em());
    const { context, fundingKey, goalKey } = await fundThenExpire(household);
    await new GoalService(db.em()).undoTransactionFunding({ ...context, goalKey, goalTransactionFundingKey: fundingKey });

    const { activities } = await new GoalService(db.em()).getGoalActivity({ ...context, goalKey, limit: 50, offset: 0 });

    expect(activities.some((activity) => activity.transactionExpired)).toBe(false);
  });
});
