import { type EntityManager, LockMode } from '@mikro-orm/core';
import Big from 'big.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Account } from '@entity/Account';
import { Goal, GoalStatus, GoalType } from '@entity/Goal';
import { GoalAccountLink } from '@entity/GoalAccountLink';
import { GoalActivity } from '@entity/GoalActivity';
import { GoalActivityType } from '@entity/GoalActivity';
import { GoalTransactionFunding } from '@entity/GoalTransactionFunding';
import { Transaction } from '@entity/Transaction';
import { BadRequestError, NotFoundError } from '@utils/errors';

import { buildGoalSummary } from '../goal-summary.service';

const em = {
  create: vi.fn(),
  find: vi.fn(),
  findAndCount: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn(),
  getReference: vi.fn((Entity, id) => ({ [Entity.name === 'Goal' ? 'goalKey' : Entity.name === 'Appuser' ? 'appuserKey' : Entity.name === 'Tenant' ? 'tenantKey' : Entity.name === 'Transaction' ? 'transactionKey' : 'currencyKey']: id })),
  persist: vi.fn().mockReturnThis(),
  transactional: vi.fn((cb) => Promise.resolve(cb(emManager))),
};

const transactionalEm = {
  ...em,
  getReference: vi.fn((Entity, id) => ({ [Entity.name === 'Goal' ? 'goalKey' : Entity.name === 'Appuser' ? 'appuserKey' : Entity.name === 'Tenant' ? 'tenantKey' : Entity.name === 'Transaction' ? 'transactionKey' : 'currencyKey']: id })),
};

const makeReference = (Entity: { name: string }, id: number) => ({ [Entity.name === 'Goal' ? 'goalKey' : Entity.name === 'Appuser' ? 'appuserKey' : Entity.name === 'Tenant' ? 'tenantKey' : Entity.name === 'Transaction' ? 'transactionKey' : 'currencyKey']: id });

// The mock doubles expose `vi.fn()` methods the tests configure; the service only needs the
// EntityManager surface, so expose the same objects through that type at the boundary.
const emManager = em as unknown as EntityManager;
const transactionalEmManager = transactionalEm as unknown as EntityManager;

vi.mock('@app/app', () => ({ DI: { em } }));

describe('GoalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    em.getReference.mockImplementation(makeReference);
    transactionalEm.getReference.mockClear();
    transactionalEm.getReference.mockImplementation(makeReference);
    em.transactional.mockImplementation((cb) => Promise.resolve(cb(transactionalEmManager)));
  });

  it('creates a goal and goal-created activity', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.create.mockImplementation((Entity: typeof Goal | typeof GoalActivity, data: Record<string, unknown>) => {
      if (Entity === Goal) return Object.assign(new Goal(), data);
      return Object.assign(new GoalActivity(), data);
    });
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    const result = await service.createGoal({
      appuserKey: 11,
      currencyKey: 33,
      description: 'Trip',
      monthlyContributionTarget: 25,
      name: 'Trip',
      targetAmount: 1000,
      targetDate: new Date('2024-12-31T00:00:00.000Z'),
      tenantKey: 22,
    });

    expect(em.persist.mock.calls[0]?.[0][0].constructor.name).toBe('Goal');
    expect(em.persist.mock.calls[0]?.[0][1].type).toBe(GoalActivityType.GOAL_CREATED);
    expect(em.flush).toHaveBeenCalled();
    expect(result.name).toBe('Trip');
    expect(result.description).toBe('Trip');
    expect(result.monthlyContributionTarget).toBe(25);
  });

  it('creates a debt paydown goal with debt fields persisted', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.flush.mockResolvedValue(undefined);

    const result = await service.createGoal({
      annualInterestRateBps: 1999,
      appuserKey: 11,
      currencyKey: 33,
      currentBalance: 12000,
      extraPayment: 100,
      minimumPayment: 250,
      name: 'Pay off Visa',
      targetAmount: 12000,
      tenantKey: 22,
      type: GoalType.DEBT_PAYDOWN,
    });

    expect(result.type).toBe('debt_paydown');
    expect(result.currentBalance).toBe(12000);
    expect(result.annualInterestRateBps).toBe(1999);
    expect(result.minimumPayment).toBe(250);
    expect(result.extraPayment).toBe(100);
  });

  it('defaults priority to 0 when creating a goal without priority', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.flush.mockResolvedValue(undefined);

    const result = await service.createGoal({
      appuserKey: 11,
      currencyKey: 33,
      name: 'Trip',
      targetAmount: 1000,
      tenantKey: 22,
    });

    expect(result.priority).toBe(0);
  });

  it('persists priority on create when provided', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.flush.mockResolvedValue(undefined);

    const result = await service.createGoal({
      appuserKey: 11,
      currencyKey: 33,
      name: 'Trip',
      priority: 2,
      targetAmount: 1000,
      tenantKey: 22,
    });

    expect(result.priority).toBe(2);
  });

  it('updates priority when provided and leaves it untouched when omitted', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, name: 'Trip', priority: 2, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    await service.updateGoal({ appuserKey: 11, goalKey: 1, priority: 1, tenantKey: 22 });
    expect(goal.priority).toBe(1);

    await service.updateGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 });
    expect(goal.priority).toBe(1);
  });

  it('compares avalanche and snowball across active debt goals', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.find.mockImplementation((Entity) => {
      if (Entity === Goal) {
        return [
          { annualInterestRateBps: 2500, currentBalance: 1000, extraPayment: 100, goalKey: 1, minimumPayment: 50, name: 'Visa' },
          { annualInterestRateBps: 800, currentBalance: 500, extraPayment: 0, goalKey: 2, minimumPayment: 50, name: 'Car' },
        ];
      }
      return [];
    });

    const result = await service.getDebtStrategy({ appuserKey: 11, tenantKey: 22 });

    expect(em.find.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ status: GoalStatus.ACTIVE, type: 'debt_paydown' }));
    expect(result.debts).toHaveLength(2);
    expect(result.extraBudget).toBe(100);
    expect(result.avalanche?.order[0]).toBe(1); // highest rate first
    expect(result.snowball?.order[0]).toBe(2); // lowest balance first
    expect(result.avalanche?.totalInterest).toBeLessThanOrEqual(result.snowball?.totalInterest ?? Infinity);
  });

  it('returns an empty debt strategy when there are no eligible debt goals', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.find.mockImplementation(() => []);

    const result = await service.getDebtStrategy({ appuserKey: 11, tenantKey: 22 });

    expect(result).toEqual({ avalanche: null, debts: [], extraBudget: 0, snowball: null });
  });

  it('lists non-deleted, non-archived goals by default', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.find.mockImplementation((Entity) => {
      if (Entity === Goal) return [{ accountLinks: { getItems: () => [] }, currencyKey: { code: 'EUR' }, goalKey: 1 }];
      if (Entity === GoalActivity) return [];
      return [];
    });

    await service.listGoals({ appuserKey: 11, tenantKey: 22 });

    expect(em.find.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ deletedAt: undefined, status: { $ne: GoalStatus.ARCHIVED } }));
  });

  it('serializes goals for list responses with currency codes', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.find.mockImplementation((Entity) => {
      if (Entity === Goal) return [{ currencyKey: { code: 'EUR' }, goalKey: 1, name: 'Trip', status: GoalStatus.ACTIVE, targetAmount: 100 }];
      if (Entity === GoalActivity) return [];
      return [];
    });

    const result = await service.listGoals({ appuserKey: 11, tenantKey: 22 });

    expect(result[0]).toMatchObject({ currencyCode: 'EUR', goalKey: 1, name: 'Trip', summary: { availableAmount: 0 } });
  });

  it('excludes deleted account links from serialized goal context', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), {
      accountLinks: { getItems: () => [{ accountKey: { accountKey: 9, accountName: 'Main Checking' }, deletedAt: new Date(), goalAccountLinkKey: 77 }, { accountKey: { accountKey: 10, accountName: 'Savings' }, goalAccountLinkKey: 78 }] },
      currencyKey: { code: 'EUR' },
      goalKey: 1,
      name: 'Trip',
      status: GoalStatus.ACTIVE,
      targetAmount: 1000,
    });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([]);

    const result = await service.getGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 });

    expect(result.goal.accountLinks).toEqual([{ accountKey: { accountKey: 10, accountName: 'Savings' }, goalAccountLinkKey: 78 }]);
  });

  it('lists archived goals when includeArchived is true without a status filter', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.find.mockResolvedValue([]);

    await service.listGoals({ appuserKey: 11, includeArchived: true, tenantKey: 22 });

    expect(em.find.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ deletedAt: undefined }));
  });

  it('returns a goal summary from activities', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, name: 'Trip', status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([
      { amount: 500, occurredAt: new Date('2024-01-05T00:00:00.000Z'), type: GoalActivityType.ASSIGNED },
      { amount: 100, occurredAt: new Date('2024-01-06T00:00:00.000Z'), type: GoalActivityType.SPENT_FROM_GOAL },
    ]);

    const result = await service.getGoal({ appuserKey: 11, goalKey: 1, now: new Date('2024-01-31T00:00:00.000Z'), tenantKey: 22 });

    expect(result.goal).toMatchObject({ currencyCode: undefined, goalKey: 1, name: 'Trip' });
    expect(result.summary).toEqual(buildGoalSummary({
      assignedThisMonth: 500,
      availableAmount: 400,
      monthlyContributionTarget: null,
      now: new Date('2024-01-31T00:00:00.000Z'),
      paused: false,
      spentAmount: 100,
      targetAmount: 1000,
      targetDate: undefined,
    }));
  });

  it('passes manual monthly targets into summary calculations', () => {
    const summary = buildGoalSummary({
      assignedThisMonth: 10,
      availableAmount: 200,
      monthlyContributionTarget: 75,
      now: new Date('2024-01-31T00:00:00.000Z'),
      paused: false,
      spentAmount: 0,
      targetAmount: 1000,
      targetDate: new Date('2024-12-31T00:00:00.000Z'),
    });

    expect(summary.requiredMonthlyContribution).toBe(75);
    expect(summary.monthlyShortfall).toBe(65);
  });

  it('serializes goal detail with account links and currency code', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { accountLinks: { getItems: () => [{ accountKey: { accountKey: 9, accountName: 'Main Checking' }, goalAccountLinkKey: 77 }] }, currencyKey: { code: 'EUR' }, description: '6 months of expenses', goalKey: 1, name: 'Trip', status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([]);

    const result = await service.getGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 });

    expect(result.goal).toMatchObject({ accountLinks: [{ accountKey: { accountKey: 9, accountName: 'Main Checking' }, goalAccountLinkKey: 77 }], currencyCode: 'EUR', goalKey: 1 });
    // RAD-379: description must be present in the serialized GET response.
    expect(result.goal.description).toBe('6 months of expenses');
  });

  it('serializes a null description when a goal has none (RAD-379)', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { code: 'EUR' }, goalKey: 1, name: 'Trip', status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([]);

    const result = await service.getGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 });

    expect(result.goal).toHaveProperty('description', null);
  });

  it('counts assignedThisMonth from current-month ASSIGNED and MOVED_IN only', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([
      { amount: 25, occurredAt: new Date('2024-01-10T00:00:00.000Z'), type: GoalActivityType.ASSIGNED },
      { amount: 50, occurredAt: new Date('2024-01-11T00:00:00.000Z'), type: GoalActivityType.MOVED_IN },
      { amount: 75, occurredAt: new Date('2023-12-31T23:59:59.000Z'), type: GoalActivityType.ASSIGNED },
      { amount: 80, occurredAt: new Date('2024-01-12T00:00:00.000Z'), type: GoalActivityType.SPENT_FROM_GOAL },
    ]);

    const result = await service.getGoal({ appuserKey: 11, goalKey: 1, now: new Date('2024-01-31T00:00:00.000Z'), tenantKey: 22 });

    expect(result.summary.assignedThisMonth).toBe(75);
  });

  it('counts spentAmount historically across months and fundedHistorically reflects all-time spend', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, name: 'Trip', status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([
      { amount: 25, occurredAt: new Date('2023-12-31T23:59:59.000Z'), type: GoalActivityType.SPENT_FROM_GOAL },
      { amount: 75, occurredAt: new Date('2024-01-10T00:00:00.000Z'), type: GoalActivityType.ASSIGNED },
    ]);

    const result = await service.getGoal({ appuserKey: 11, goalKey: 1, now: new Date('2024-01-31T00:00:00.000Z'), tenantKey: 22 });

    expect(result.summary.spentAmount).toBe(25);
    expect(result.summary.availableAmount).toBe(50);
    expect(result.summary.fundedHistorically).toBe(75);
  });

  it('derives balance from all goal money activity types', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, name: 'Trip', status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([
      { amount: 100, occurredAt: new Date('2024-01-05T00:00:00.000Z'), type: GoalActivityType.MOVED_IN },
      { amount: 25, occurredAt: new Date('2024-01-06T00:00:00.000Z'), type: GoalActivityType.MANUAL_ADJUSTMENT },
      { amount: 30, occurredAt: new Date('2024-01-07T00:00:00.000Z'), type: GoalActivityType.TRANSACTION_FUNDING_REVERSED },
      { amount: 40, occurredAt: new Date('2024-01-08T00:00:00.000Z'), type: GoalActivityType.MOVED_OUT },
      { amount: 10, occurredAt: new Date('2024-01-09T00:00:00.000Z'), type: GoalActivityType.SPENT_FROM_GOAL },
    ]);

    const result = await service.getGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 });

    expect(result.summary.availableAmount).toBe(105);
  });

  it('allows archiving with fractional cancellation using big.js arithmetic', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE }));
    em.find.mockResolvedValue([
      { amount: 0.1, type: GoalActivityType.ASSIGNED },
      { amount: 0.2, type: GoalActivityType.MOVED_IN },
      { amount: 0.3, type: GoalActivityType.MOVED_OUT },
    ]);

    await expect(service.archiveGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 })).resolves.toBeDefined();
    expect(new Big(0.1).plus(0.2).minus(0.3).abs().lt(1e-12)).toBe(true);
    expect(em.transactional).toHaveBeenCalled();
    expect(em.findOne.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }));
  });

  it('assigns money to a goal and increases available balance', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockImplementation((Entity) => (Entity === Account ? [{ appuserCurrencyBalance: 500 }] : []));
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    const result = await service.assignMoneyToGoal({ amount: 125.5, appuserKey: 11, currencyKey: 33, goalKey: 1, note: 'auto save', tenantKey: 22 });

    expect(result.summary.availableAmount).toBe(125.5);
    expect(em.persist.mock.calls[0]?.[0][1].type).toBe(GoalActivityType.ASSIGNED);
    expect(em.persist.mock.calls[0]?.[0][1].amount).toBe(125.5);
    expect(em.transactional).toHaveBeenCalled();
    expect(em.findOne.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }));
  });

  it('computes available-to-assign as account balances minus already-assigned money across all goals', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.find.mockImplementation((Entity) => {
      if (Entity === Account) return [{ appuserCurrencyBalance: 300 }, { appuserCurrencyBalance: 200 }];
      if (Entity === GoalActivity) return [{ amount: 150, type: GoalActivityType.ASSIGNED }];
      return [];
    });

    const result = await service.getAvailableToAssign({ appuserKey: 11, tenantKey: 22 });

    expect(result).toBe(350);
    expect(em.find.mock.calls.find(([Entity]) => Entity === Account)?.[1]).toEqual(
      expect.objectContaining({ closed: false, deletedAt: undefined }),
    );
  });

  it('floors available-to-assign at zero when already-assigned exceeds account balances', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.find.mockImplementation((Entity) => {
      if (Entity === Account) return [{ appuserCurrencyBalance: 100 }];
      if (Entity === GoalActivity) return [{ amount: 150, type: GoalActivityType.ASSIGNED }];
      return [];
    });

    const result = await service.getAvailableToAssign({ appuserKey: 11, tenantKey: 22 });

    expect(result).toBe(0);
  });

  it('falls back to account.balance when appuserCurrencyBalance is unset', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.find.mockImplementation((Entity) => {
      if (Entity === Account) return [{ balance: 80 }];
      return [];
    });

    const result = await service.getAvailableToAssign({ appuserKey: 11, tenantKey: 22 });

    expect(result).toBe(80);
  });

  it('rejects assigning more than the available-to-assign ceiling', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockImplementation((Entity) => {
      if (Entity === Account) return [{ appuserCurrencyBalance: 50 }];
      return [];
    });

    await expect(service.assignMoneyToGoal({ amount: 100, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('allows assigning exactly up to the available-to-assign ceiling', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockImplementation((Entity) => (Entity === Account ? [{ appuserCurrencyBalance: 100 }] : []));
    em.flush.mockResolvedValue(undefined);

    const result = await service.assignMoneyToGoal({ amount: 100, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 });

    expect(result.summary.availableAmount).toBe(100);
  });

  it('nets already-assigned money across other goals when computing the ceiling', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockImplementation((Entity) => {
      if (Entity === Account) return [{ appuserCurrencyBalance: 100 }];
      if (Entity === GoalActivity) return [{ amount: 60, type: GoalActivityType.ASSIGNED }];
      return [];
    });

    await expect(service.assignMoneyToGoal({ amount: 41, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects non-positive assign amounts', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 }));
    await expect(service.assignMoneyToGoal({ amount: 0, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects assign amounts that normalize to zero', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 }));
    await expect(service.assignMoneyToGoal({ amount: 0.00004, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('moves money out of a goal and decreases available balance', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([{ amount: 200, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }]);
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    const result = await service.moveMoneyOutOfGoal({ amount: 50, appuserKey: 11, currencyKey: 33, goalKey: 1, note: 'spent', tenantKey: 22 });

    expect(result.summary.availableAmount).toBe(150);
    expect(em.persist.mock.calls[0]?.[0][1].type).toBe(GoalActivityType.MOVED_OUT);
    expect(em.persist.mock.calls[0]?.[0][1].amount).toBe(50);
    expect(em.transactional).toHaveBeenCalled();
    expect(em.findOne.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ lockMode: expect.anything() }));
  });

  it('rejects non-positive move-out amounts', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE }));
    await expect(service.moveMoneyOutOfGoal({ amount: -1, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects move-out amounts that normalize to zero', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE }));
    await expect(service.moveMoneyOutOfGoal({ amount: 0.00004, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects moving out more than available', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ACTIVE }));
    em.find.mockResolvedValue([{ amount: 10, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }]);

    await expect(service.moveMoneyOutOfGoal({ amount: 15, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('keeps balance non-negative with fixed-scale comparison', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([{ amount: 0.3, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }]);

    await expect(service.moveMoneyOutOfGoal({ amount: 0.3001, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects raw overdraw before rounding amount down', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ACTIVE });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([{ amount: 0.3, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }]);

    await expect(service.moveMoneyOutOfGoal({ amount: 0.30004, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('funds a full transaction expense from goal balance', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    const transaction = Object.assign(new Transaction(), { appuserSettlementAmount: -50, settlementAmount: -50, transactionKey: 7 });
    em.findOne.mockImplementation((Entity) => (Entity === Goal ? goal : transaction));
    em.find.mockImplementation((Entity) => {
      if (Entity === GoalTransactionFunding) return [];
      if (Entity === GoalActivity) return [{ amount: 100, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }];
      return [];
    });
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    const result = await service.fundTransactionFromGoal({ amount: 50, appuserKey: 11, goalKey: 1, tenantKey: 22, transactionKey: 7 });

    expect(result.amount).toBe(50);
    expect(em.persist.mock.calls[0]?.[0][0].constructor.name).toBe('GoalTransactionFunding');
    expect(em.persist.mock.calls[0]?.[0][1].type).toBe(GoalActivityType.SPENT_FROM_GOAL);
    expect(em.persist.mock.calls[0]?.[0][1].transactionKey).toBe(transaction);
    expect(em.transactional).toHaveBeenCalled();
    const transactionLookup = em.findOne.mock.calls.find(([Entity]) => Entity === Transaction);
    expect(transactionLookup?.[2]).toEqual(expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }));
  });

  it('funds a transaction partially and enforces remaining amount', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    const transaction = Object.assign(new Transaction(), { appuserSettlementAmount: -50, settlementAmount: -50, transactionKey: 7 });
    em.findOne.mockImplementation((Entity) => (Entity === Goal ? goal : transaction));
    em.find.mockImplementation((Entity) => {
      if (Entity === GoalTransactionFunding) return [{ amount: 20, reversedAt: undefined }];
      if (Entity === GoalActivity) return [{ amount: 100, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }];
      return [];
    });
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    await expect(service.fundTransactionFromGoal({ amount: 30, appuserKey: 11, goalKey: 1, tenantKey: 22, transactionKey: 7 })).resolves.toBeDefined();
    await expect(service.fundTransactionFromGoal({ amount: 31, appuserKey: 11, goalKey: 1, tenantKey: 22, transactionKey: 7 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects funding above goal available balance', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    const transaction = Object.assign(new Transaction(), { appuserSettlementAmount: -50, settlementAmount: -50, transactionKey: 7 });
    em.findOne.mockImplementation((Entity) => (Entity === Goal ? goal : transaction));
    em.find.mockImplementation((Entity) => {
      if (Entity === GoalTransactionFunding) return [];
      if (Entity === GoalActivity) return [{ amount: 10, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }];
      return [];
    });

    await expect(service.fundTransactionFromGoal({ amount: 11, appuserKey: 11, goalKey: 1, tenantKey: 22, transactionKey: 7 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects raw amount above transaction remaining amount before normalization', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    const transaction = Object.assign(new Transaction(), { appuserSettlementAmount: -50, settlementAmount: -50, transactionKey: 7 });
    em.findOne.mockImplementation((Entity) => (Entity === Goal ? goal : transaction));
    em.find.mockImplementation((Entity) => {
      if (Entity === GoalTransactionFunding) return [];
      if (Entity === GoalActivity) return [{ amount: 100, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }];
      return [];
    });

    await expect(service.fundTransactionFromGoal({ amount: 50.00004, appuserKey: 11, goalKey: 1, tenantKey: 22, transactionKey: 7 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects raw amount above goal available balance before normalization', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    const transaction = Object.assign(new Transaction(), { appuserSettlementAmount: -50, settlementAmount: -50, transactionKey: 7 });
    em.findOne.mockImplementation((Entity) => (Entity === Goal ? goal : transaction));
    em.find.mockImplementation((Entity) => {
      if (Entity === GoalTransactionFunding) return [];
      if (Entity === GoalActivity) return [{ amount: 50, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }];
      return [];
    });

    await expect(service.fundTransactionFromGoal({ amount: 50.00004, appuserKey: 11, goalKey: 1, tenantKey: 22, transactionKey: 7 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects funding above transaction remaining amount', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    const transaction = Object.assign(new Transaction(), { appuserSettlementAmount: -50, settlementAmount: -50, transactionKey: 7 });
    em.findOne.mockImplementation((Entity) => (Entity === Goal ? goal : transaction));
    em.find.mockImplementation((Entity) => {
      if (Entity === GoalTransactionFunding) return [{ amount: 40, reversedAt: undefined }];
      if (Entity === GoalActivity) return [{ amount: 100, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }];
      return [];
    });

    await expect(service.fundTransactionFromGoal({ amount: 11, appuserKey: 11, goalKey: 1, tenantKey: 22, transactionKey: 7 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('counts unreversed fundings from other goals toward transaction remaining amount', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    const otherGoal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 2, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    const transaction = Object.assign(new Transaction(), { appuserSettlementAmount: -50, settlementAmount: -50, transactionKey: 7 });
    em.findOne.mockImplementation((Entity, where) => {
      if (Entity === Goal && where.goalKey === 1) return goal;
      if (Entity === Goal && where.goalKey === 2) return otherGoal;
      if (Entity === Transaction) return transaction;
      return null;
    });
    em.find.mockImplementation((Entity) => {
      if (Entity === GoalTransactionFunding) return [{ amount: 20, goalKey: otherGoal, reversedAt: undefined }];
      if (Entity === GoalActivity) return [{ amount: 100, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }];
      return [];
    });

    await expect(service.fundTransactionFromGoal({ amount: 31, appuserKey: 11, goalKey: 1, tenantKey: 22, transactionKey: 7 })).rejects.toBeInstanceOf(BadRequestError);
    await expect(service.fundTransactionFromGoal({ amount: 30, appuserKey: 11, goalKey: 1, tenantKey: 22, transactionKey: 7 })).resolves.toBeDefined();
  });

  it('rejects income transactions', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    const transaction = Object.assign(new Transaction(), { appuserSettlementAmount: 50, settlementAmount: 50, transactionKey: 7 });
    em.findOne.mockImplementation((Entity) => (Entity === Goal ? goal : transaction));

    await expect(service.fundTransactionFromGoal({ amount: 10, appuserKey: 11, goalKey: 1, tenantKey: 22, transactionKey: 7 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('undoes transaction funding and restores goal balance via activity', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    const transaction = Object.assign(new Transaction(), { appuserSettlementAmount: -50, settlementAmount: -50, transactionKey: 7 });
    const funding = Object.assign(new GoalTransactionFunding(), { amount: 50, goalKey: goal, goalTransactionFundingKey: 9, reversedAt: undefined, transactionKey: transaction });
    em.findOne.mockImplementation((Entity) => {
      if (Entity === Goal) return goal;
      if (Entity === Transaction) return transaction;
      if (Entity === GoalTransactionFunding) return funding;
      return null;
    });
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    const result = await service.undoTransactionFunding({ appuserKey: 11, goalKey: 1, goalTransactionFundingKey: 9, tenantKey: 22 });

    expect(result.reversedAt).toBeInstanceOf(Date);
    expect(em.persist.mock.calls[0]?.[0][1].type).toBe(GoalActivityType.TRANSACTION_FUNDING_REVERSED);
    expect(em.persist.mock.calls[0]?.[0][1].transactionKey).toBe(transaction);
    expect(em.transactional).toHaveBeenCalled();
    const fundingLookup = em.findOne.mock.calls.find(([Entity]) => Entity === GoalTransactionFunding);
    expect(fundingLookup?.[2]).toEqual(expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }));
  });

  it('rejects undoing funding on archived goals', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ARCHIVED }));

    await expect(service.undoTransactionFunding({ appuserKey: 11, goalKey: 1, goalTransactionFundingKey: 9, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects undoing funding on completed goals', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.COMPLETED }));

    await expect(service.undoTransactionFunding({ appuserKey: 11, goalKey: 1, goalTransactionFundingKey: 9, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('nets undone spend out of summary spentAmount and restores availableAmount', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([
      { amount: 100, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED },
      { amount: 50, occurredAt: new Date('2024-01-02T00:00:00.000Z'), type: GoalActivityType.SPENT_FROM_GOAL },
      { amount: 50, occurredAt: new Date('2024-01-03T00:00:00.000Z'), type: GoalActivityType.TRANSACTION_FUNDING_REVERSED },
    ]);

    const result = await service.getGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 });

    expect(result.summary.availableAmount).toBe(100);
    expect(result.summary.spentAmount).toBe(0);
    expect(result.summary.fundedHistorically).toBe(100);
  });

  it('keeps category fields unchanged during transaction funding', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    const transaction = Object.assign(new Transaction(), { appuserSettlementAmount: -50, appuserTransactionCategories: { getItems: () => [{ categoryKey: { categoryKey: 99 } }] }, settlementAmount: -50, transactionKey: 7 });
    em.findOne.mockImplementation((Entity) => (Entity === Goal ? goal : transaction));
    em.find.mockImplementation((Entity) => {
      if (Entity === GoalTransactionFunding) return [];
      if (Entity === GoalActivity) return [{ amount: 100, occurredAt: new Date('2024-01-01T00:00:00.000Z'), type: GoalActivityType.ASSIGNED }];
      return [];
    });
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    await service.fundTransactionFromGoal({ amount: 10, appuserKey: 11, goalKey: 1, tenantKey: 22, transactionKey: 7 });

    const categories = (transaction as Transaction & { appuserTransactionCategories: { getItems: () => { categoryKey: { categoryKey: number } }[] } }).appuserTransactionCategories.getItems();
    expect(categories[0]?.categoryKey.categoryKey).toBe(99);
  });

  it('does not persist source metadata when assigning money', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 }));
    em.find.mockImplementation((Entity) => (Entity === Account ? [{ appuserCurrencyBalance: 500 }] : []));
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    await service.assignMoneyToGoal({ amount: 10, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 });

    expect(em.persist.mock.calls[0]?.[0][1].sourceKey).toBeUndefined();
    expect(em.persist.mock.calls[0]?.[0][1].sourceType).toBeUndefined();
  });

  it('rejects mismatched activity currency', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { currencyKey: { currencyKey: 33 }, goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([]);
    await expect(service.assignMoneyToGoal({ amount: 10, appuserKey: 11, currencyKey: 99, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects mutating archived goals', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ARCHIVED }));
    await expect(service.assignMoneyToGoal({ amount: 1, appuserKey: 11, currencyKey: 33, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects mutating completed goals', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.COMPLETED }));
    await expect(service.updateGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('updates goal fields and creates goal-updated activity', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, name: 'Trip', status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    await service.updateGoal({ appuserKey: 11, description: 'Updated', goalKey: 1, monthlyContributionTarget: 40, name: 'New Trip', targetAmount: 2000, targetDate: new Date('2024-12-31T00:00:00.000Z'), tenantKey: 22 });

    expect(goal.name).toBe('New Trip');
    expect(goal.targetAmount).toBe(2000);
    expect(goal.description).toBe('Updated');
    expect(goal.monthlyContributionTarget).toBe(40);
    expect(em.persist.mock.calls[0]?.[0][1].type).toBe(GoalActivityType.GOAL_UPDATED);
    expect(em.persist).toHaveBeenCalled();
    expect(em.flush).toHaveBeenCalled();
  });

  it('applies currencyKey when provided during update', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    await service.updateGoal({ appuserKey: 11, currencyKey: 44, goalKey: 1, tenantKey: 22 });

    expect(goal.currencyKey).toEqual({ currencyKey: 44 });
  });

  it('rejects archiving when balance is non-zero', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { goalKey: 1 }));
    em.find.mockResolvedValue([{ amount: 1, type: GoalActivityType.ASSIGNED }]);

    await expect(service.archiveGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('archives goal when balance is zero and returns paginated activities', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ACTIVE });
    em.findOne.mockResolvedValue(goal);
    em.find.mockResolvedValue([]);
    em.findAndCount.mockResolvedValue([[], 0]);
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    const archived = await service.archiveGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 });
    expect(archived.status).toBe(GoalStatus.ARCHIVED);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(em.persist.mock.calls[0]?.[0][1].type).toBe(GoalActivityType.ARCHIVED);

    const activity = await service.getGoalActivity({ appuserKey: 11, goalKey: 1, limit: 10, offset: 0, tenantKey: 22 });
    expect(activity.total).toBe(0);
  });

  it('restores an archived goal back to active', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { archivedAt: new Date(), goalKey: 1, status: GoalStatus.ARCHIVED, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.flush.mockResolvedValue(undefined);

    const restored = await service.restoreGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 });

    expect(restored).toBe(goal);
    expect(restored.status).toBe(GoalStatus.ACTIVE);
    expect(restored.archivedAt).toBeUndefined();
    expect(em.persist).toHaveBeenCalledWith(goal);
    expect(em.flush).toHaveBeenCalled();
    expect(em.transactional).toHaveBeenCalled();
    expect(em.findOne.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }));
  });

  it('rejects restoring a goal that does not exist', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(null);

    await expect(service.restoreGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(NotFoundError);
    expect(em.persist).not.toHaveBeenCalled();
    expect(em.flush).not.toHaveBeenCalled();
  });

  it('rejects restoring a goal that is already active', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockResolvedValue(Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ACTIVE, targetAmount: 1000 }));

    await expect(service.restoreGoal({ appuserKey: 11, goalKey: 1, tenantKey: 22 })).rejects.toBeInstanceOf(BadRequestError);
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('validates ownership before returning goal activities and scopes by goal, appuser, and tenant', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, name: 'Trip', status: GoalStatus.ACTIVE, targetAmount: 1000 });
    em.findOne.mockResolvedValue(goal);
    em.findAndCount.mockResolvedValue([[], 0]);

    await service.getGoalActivity({ appuserKey: 11, goalKey: 1, limit: 10, offset: 0, tenantKey: 22 });

    expect(em.findOne.mock.calls[0]?.[0]).toBe(Goal);
    expect(em.findOne.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ deletedAt: undefined, goalKey: 1 }));
    expect(em.findAndCount.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ deletedAt: undefined }));
  });

  it('links and unlinks goal accounts with tenant/appuser validation', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    const goal = Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ACTIVE });
    const account = { accountKey: 9 };
    const link = Object.assign(new GoalAccountLink(), { goalAccountLinkKey: 3 });
    em.findOne.mockImplementation((Entity) => {
      if (Entity === Goal) return goal;
      if (Entity === GoalAccountLink) return link;
      if (Entity === Account) return account;
      return null;
    });
    em.flush.mockResolvedValue(undefined);
    em.flush.mockResolvedValue(undefined);

    const created = await service.linkGoalAccount({ accountKey: 9, appuserKey: 11, goalKey: 1, tenantKey: 22 });
    expect(created).toBeDefined();
    expect(em.persist).toHaveBeenCalled();

    const unlinked = await service.unlinkGoalAccount({ accountKey: 9, appuserKey: 11, goalKey: 1, tenantKey: 22 });
    expect(unlinked.deletedAt).toBeInstanceOf(Date);
  });

  it('rejects unlinking a goal account when the account does not belong to the user', async () => {
    const { GoalService } = await import('../goal.service');
    const service = new GoalService(emManager);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === Goal) return Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ACTIVE });
      return null;
    });

    await expect(service.unlinkGoalAccount({ accountKey: 9, appuserKey: 11, goalKey: 1, tenantKey: 22 })).rejects.toBeDefined();
  });

  describe('goal metadata mutations acquire a pessimistic write lock', () => {
    it('links a goal account inside a locked transaction', async () => {
      const { GoalService } = await import('../goal.service');
      const service = new GoalService(emManager);
      const goal = Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ACTIVE });
      const account = { accountKey: 9 };
      em.findOne.mockImplementation((Entity) => (Entity === Goal ? goal : Entity === Account ? account : null));

      await service.linkGoalAccount({ accountKey: 9, appuserKey: 11, goalKey: 1, tenantKey: 22 });

      expect(em.transactional).toHaveBeenCalled();
      expect(em.findOne.mock.calls[0]?.[0]).toBe(Goal);
      expect(em.findOne.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }));
      expect(em.persist).toHaveBeenCalled();
    });

    it('unlinks a goal account inside a locked transaction', async () => {
      const { GoalService } = await import('../goal.service');
      const service = new GoalService(emManager);
      const goal = Object.assign(new Goal(), { goalKey: 1, status: GoalStatus.ACTIVE });
      const account = { accountKey: 9 };
      const link = Object.assign(new GoalAccountLink(), { goalAccountLinkKey: 5 });
      em.findOne.mockImplementation((Entity) => (Entity === Goal ? goal : Entity === Account ? account : Entity === GoalAccountLink ? link : null));

      const result = await service.unlinkGoalAccount({ accountKey: 9, appuserKey: 11, goalKey: 1, tenantKey: 22 });

      expect(result.deletedAt).toBeInstanceOf(Date);
      expect(em.transactional).toHaveBeenCalled();
      expect(em.findOne.mock.calls[0]?.[0]).toBe(Goal);
      expect(em.findOne.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }));
    });

    it('updates goal fields inside a locked transaction', async () => {
      const { GoalService } = await import('../goal.service');
      const service = new GoalService(emManager);
      const goal = Object.assign(new Goal(), { goalKey: 1, name: 'Trip', status: GoalStatus.ACTIVE });
      em.findOne.mockResolvedValue(goal);

      const updated = await service.updateGoal({ appuserKey: 11, goalKey: 1, name: 'Changed', tenantKey: 22 });

      expect(updated.name).toBe('Changed');
      expect(em.transactional).toHaveBeenCalled();
      expect(em.findOne.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }));
      expect(em.persist.mock.calls[0]?.[0][1].type).toBe(GoalActivityType.GOAL_UPDATED);
    });
  });
});
