import { EntityManager, LockMode } from '@mikro-orm/core';
import Big from 'big.js';

import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { Goal, GoalStatus, GoalType } from '@entity/Goal';
import { GoalAccountLink } from '@entity/GoalAccountLink';
import { GoalActivity, GoalActivityType } from '@entity/GoalActivity';
import { GoalTransactionFunding } from '@entity/GoalTransactionFunding';
import { Loan } from '@entity/Loan';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { getEffectiveAppuserAmount } from '@utils/account-amounts';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, NotFoundError } from '@utils/errors';

import { compareStrategies } from './debt-projection.service';
import { buildGoalSummary } from './goal-summary.service';

export interface ActivityPageInput extends GoalContext { goalKey: number; limit: number; offset: number }

export interface ArchiveGoalInput extends GoalContext { goalKey: number }
export interface AssignMoneyToGoalInput extends GoalContext { amount: number; currencyKey: number; goalKey: number; note?: string }
export interface CreateGoalInput extends DebtGoalFields, GoalContext { currencyKey: number; description?: null | string; monthlyContributionTarget?: null | number; name: string; priority?: number; targetAmount: number; targetDate?: Date | null }
export interface DebtGoalFields {
  annualInterestRateBps?: null | number;
  currentBalance?: null | number;
  extraPayment?: null | number;
  loanKey?: null | number;
  minimumPayment?: null | number;
  type?: GoalType;
}
export interface FundTransactionFromGoalInput extends GoalContext { amount: number; goalKey: number; transactionKey: number }
export interface GetGoalInput extends GoalContext { goalKey: number; now?: Date }
export interface GoalContext { appuserKey: number; tenantKey: number }
export interface LinkGoalAccountInput extends GoalContext { accountKey: number; goalKey: number }
export interface ListGoalsInput extends GoalContext { includeArchived?: boolean }
export interface MoveMoneyOutOfGoalInput extends GoalContext { amount: number; currencyKey: number; goalKey: number; note?: string }
export interface RestoreGoalInput extends GoalContext { goalKey: number }
export interface UndoTransactionFundingInput extends GoalContext { goalKey: number; goalTransactionFundingKey: number }
export interface UpdateGoalInput extends DebtGoalFields, GoalContext { currencyKey?: number; description?: null | string; goalKey: number; monthlyContributionTarget?: null | number; name?: string; priority?: number; targetAmount?: number; targetDate?: Date | null }

export class GoalService {
  constructor(private readonly em: EntityManager) {}

  async archiveGoal(input: ArchiveGoalInput): Promise<Goal> {
    return this.em.transactional(async (em) => {
      const goal = await this.findGoal(input.goalKey, input, ['currencyKey'], em, LockMode.PESSIMISTIC_WRITE);
      const activities = await em.find(GoalActivity, { deletedAt: undefined, goalKey: goal, tenantKey: getRef(em, Tenant, input.tenantKey) });
      if (!this.getBalance(activities).eq(0)) throw new BadRequestError('Goal must have zero balance before archiving');
      goal.status = GoalStatus.ARCHIVED;
      goal.archivedAt = new Date();
      const activity = new GoalActivity();
      activity.appuserKey = getRef(em, Appuser, input.appuserKey);
      activity.goalKey = goal;
      activity.tenantKey = getRef(em, Tenant, input.tenantKey);
      activity.type = GoalActivityType.ARCHIVED;
      em.persist([goal, activity]);
      await em.flush();
      return goal;
    });
  }

  async assignMoneyToGoal(input: AssignMoneyToGoalInput) {
    return this.em.transactional(async (em) => {
      const goal = await this.findGoal(input.goalKey, input, ['currencyKey'], em, LockMode.PESSIMISTIC_WRITE);
      this.assertGoalIsMutable(goal);
      const existing = await this.getGoalActivities(goal, input, em);
      const amount = this.normalizeAndValidateAmount(input.amount);
      const activity = this.buildGoalActivity(em, goal, input, GoalActivityType.ASSIGNED, amount);
      const availableToAssign = await this.getAvailableToAssign(input, em);
      if (new Big(input.amount).gt(availableToAssign)) throw new BadRequestError('Assigned amount cannot exceed money available to assign');
      em.persist([goal, activity]);
      await em.flush();
      return { goal, summary: this.buildSummary(goal, [...existing, activity], new Date()) };
    });
  }

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const goal = new Goal();
    goal.appuserKey = getRef(this.em, Appuser, input.appuserKey);
    goal.currencyKey = getRef(this.em, Currency, input.currencyKey);
    goal.description = input.description ?? undefined;
    goal.name = input.name;
    goal.priority = input.priority ?? 0;
    goal.monthlyContributionTarget = input.monthlyContributionTarget ?? undefined;
    goal.status = GoalStatus.ACTIVE;
    goal.targetAmount = input.targetAmount;
    goal.targetDate = input.targetDate ?? undefined;
    goal.tenantKey = getRef(this.em, Tenant, input.tenantKey);
    goal.type = input.type ?? GoalType.SAVE_UP;
    if (goal.type === GoalType.DEBT_PAYDOWN) {
      goal.currentBalance = input.currentBalance ?? undefined;
      goal.annualInterestRateBps = input.annualInterestRateBps ?? undefined;
      goal.minimumPayment = input.minimumPayment ?? undefined;
      goal.extraPayment = input.extraPayment ?? undefined;
      goal.loanKey = await this.resolveLoan(input.loanKey, input);
    }

    const activity = new GoalActivity();
    activity.appuserKey = getRef(this.em, Appuser, input.appuserKey);
    activity.goalKey = goal;
    activity.tenantKey = getRef(this.em, Tenant, input.tenantKey);
    activity.type = GoalActivityType.GOAL_CREATED;
    this.em.persist([goal, activity]);
    await this.em.flush();
    return goal;
  }

  async fundTransactionFromGoal(input: FundTransactionFromGoalInput) {
    return this.em.transactional(async (em) => {
      const goal = await this.findGoal(input.goalKey, input, ['currencyKey'], em, LockMode.PESSIMISTIC_WRITE);
      this.assertGoalIsMutable(goal);
      const transaction = await this.findTransaction(input.transactionKey, input, em, LockMode.PESSIMISTIC_WRITE);
      const transactionAmount = new Big(getEffectiveAppuserAmount(transaction));
      if (transactionAmount.gte(0)) throw new BadRequestError('Transaction must be an expense');

      const [fundings, goalActivities] = await Promise.all([this.getTransactionFundings(transaction, input, em), this.getGoalActivities(goal, input, em)]);
      const rawAmount = new Big(input.amount);
      if (rawAmount.lte(0)) throw new BadRequestError('Amount must be greater than zero');
      const remainingTransactionAmount = transactionAmount.abs().minus(this.getFundedTransactionAmount(fundings));
      if (rawAmount.gt(remainingTransactionAmount)) throw new BadRequestError('Funding amount cannot exceed transaction remaining amount');
      if (rawAmount.gt(this.getBalance(goalActivities))) throw new BadRequestError('Funding amount cannot exceed goal available balance');

      const amount = this.normalizeAndValidateAmount(input.amount);
      const funding = new GoalTransactionFunding();
      funding.amount = amount;
      funding.currencyKey = goal.currencyKey;
      funding.goalKey = goal;
      funding.transactionKey = transaction;
      funding.tenantKey = getRef(em, Tenant, input.tenantKey);
      const activity = new GoalActivity();
      activity.amount = amount;
      activity.appuserKey = getRef(em, Appuser, input.appuserKey);
      activity.createdByAppuserKey = getRef(em, Appuser, input.appuserKey);
      activity.currencyKey = goal.currencyKey;
      activity.goalKey = goal;
      activity.tenantKey = getRef(em, Tenant, input.tenantKey);
      activity.transactionKey = transaction;
      activity.type = GoalActivityType.SPENT_FROM_GOAL;
      em.persist([funding, activity]);
      await em.flush();
      return funding;
    });
  }

  /**
   * Total real money the user can still assign to goals: the sum of their active account
   * balances minus what's already assigned across ALL of their goals (a pooled "ready to
   * assign" figure, not per-goal or per-linked-account — goal-account links are cosmetic
   * only and don't reserve balance).
   */
  async getAvailableToAssign(input: GoalContext, em: EntityManager = this.em): Promise<number> {
    const accounts = await em.find(Account, {
      closed: false,
      deletedAt: undefined,
      tenantKey: getRef(em, Tenant, input.tenantKey),
    });
    const totalAccountBalance = accounts.reduce((sum, account) => sum.plus(account.appuserCurrencyBalance ?? account.balance ?? 0), new Big(0));

    const activities = await em.find(GoalActivity, {
      deletedAt: undefined,
      tenantKey: getRef(em, Tenant, input.tenantKey),
    });
    const totalAssigned = this.getBalance(activities);

    const available = totalAccountBalance.minus(totalAssigned);
    return available.lt(0) ? 0 : available.toNumber();
  }

  async getGoal(input: GetGoalInput) {
    const goal = await this.findGoal(input.goalKey, input, ['accountLinks', 'accountLinks.accountKey', 'currencyKey']);
    const activities = await this.em.find(GoalActivity, { deletedAt: undefined, goalKey: goal, tenantKey: getRef(this.em, Tenant, input.tenantKey) }, { orderBy: { occurredAt: 'desc' } });
    return { goal: this.serializeGoal(goal), summary: this.buildSummary(goal, activities, input.now ?? new Date()) };
  }

  /**
   * Cross-goal debt payoff strategy comparison: avalanche (highest rate first) vs snowball
   * (lowest balance first) across the user's active debt-paydown goals, sharing a pooled
   * extra budget (the sum of each debt goal's extra payment).
   */
  async getDebtStrategy(input: GoalContext) {
    // RAD-392: goals sort by priority ascending (0=low first); flip to 'desc' if high-priority-first was the intent.
    const goals = await this.em.find(Goal, {
      deletedAt: undefined,
      status: GoalStatus.ACTIVE,
      tenantKey: getRef(this.em, Tenant, input.tenantKey),
      type: GoalType.DEBT_PAYDOWN,
    }, { orderBy: { priority: 'desc' } });

    const debts = goals
      .filter((goal) => (goal.currentBalance ?? 0) > 0 && (goal.minimumPayment ?? 0) > 0)
      .map((goal) => ({
        annualInterestRateBps: goal.annualInterestRateBps ?? 0,
        balance: goal.currentBalance ?? 0,
        id: goal.goalKey,
        minimumPayment: goal.minimumPayment ?? 0,
        name: goal.name,
      }));
    const extraBudget = goals.reduce((sum, goal) => sum + (goal.extraPayment ?? 0), 0);

    if (debts.length === 0) return { avalanche: null, debts: [], extraBudget: 0, snowball: null };

    const { avalanche, snowball } = compareStrategies({
      debts: debts.map((debt) => ({ annualInterestRateBps: debt.annualInterestRateBps, balance: debt.balance, id: debt.id, minimumPayment: debt.minimumPayment })),
      extraBudget,
    });
    return { avalanche, debts, extraBudget, snowball };
  }

  async getGoalActivity(input: ActivityPageInput) {
    const goal = await this.findGoal(input.goalKey, input, ['currencyKey']);
    const [activities, total] = await this.em.findAndCount(
      GoalActivity,
      { deletedAt: undefined, goalKey: goal, tenantKey: getRef(this.em, Tenant, input.tenantKey) },
      { limit: input.limit, offset: input.offset, orderBy: { occurredAt: 'desc' } },
    );
    return { activities, limit: input.limit, offset: input.offset, total };
  }

  async linkGoalAccount(input: LinkGoalAccountInput) {
    return this.em.transactional(async (em) => {
      const goal = await this.findGoal(input.goalKey, input, ['currencyKey'], em, LockMode.PESSIMISTIC_WRITE);
      this.assertGoalIsMutable(goal);
      const account = await em.findOne(Account, { accountKey: input.accountKey, deletedAt: undefined, tenantKey: getRef(em, Tenant, input.tenantKey) });
      if (!account) throw new NotFoundError('Account not found');
      const link = new GoalAccountLink();
      link.accountKey = account;
      link.goalKey = goal;
      link.tenantKey = getRef(em, Tenant, input.tenantKey);
      em.persist(link);
      await em.flush();
      return link;
    });
  }

  async listGoals(input: ListGoalsInput) {
    const where = {
      deletedAt: undefined,
      tenantKey: getRef(this.em, Tenant, input.tenantKey),
    };
    // RAD-392: goals sort by priority descending (2=high first) so high-priority goals surface first.
    const goals = !input.includeArchived
      ? await this.em.find(Goal, { ...where, status: { $ne: GoalStatus.ARCHIVED } }, { orderBy: { priority: 'desc' }, populate: ['accountLinks', 'accountLinks.accountKey', 'currencyKey'] })
      : await this.em.find(Goal, where, { orderBy: { priority: 'desc' }, populate: ['accountLinks', 'accountLinks.accountKey', 'currencyKey'] });
    const activitiesByGoal = await Promise.all(goals.map(async (goal) => this.getGoalActivities(goal, input)));
    return goals.map((goal, index) => ({ ...this.serializeGoal(goal), summary: this.buildSummary(goal, activitiesByGoal[index] ?? [], new Date()) }));
  }

  async moveMoneyOutOfGoal(input: MoveMoneyOutOfGoalInput) {
    return this.em.transactional(async (em) => {
      const goal = await this.findGoal(input.goalKey, input, ['currencyKey'], em, LockMode.PESSIMISTIC_WRITE);
      this.assertGoalIsMutable(goal);
      const existing = await this.getGoalActivities(goal, input, em);
      const amount = this.normalizeAndValidateAmount(input.amount);
      const balance = this.getBalance(existing);
      const rawAmount = new Big(input.amount);
      if (balance.lt(rawAmount)) throw new BadRequestError('Goal balance cannot go negative');
      const activity = this.buildGoalActivity(em, goal, input, GoalActivityType.MOVED_OUT, amount);
      em.persist([goal, activity]);
      await em.flush();
      return { goal, summary: this.buildSummary(goal, [...existing, activity], new Date()) };
    });
  }

  async restoreGoal(input: RestoreGoalInput): Promise<Goal> {
    return this.em.transactional(async (em) => {
      const goal = await this.findGoal(input.goalKey, input, ['currencyKey'], em, LockMode.PESSIMISTIC_WRITE);
      if (goal.status !== GoalStatus.ARCHIVED) throw new BadRequestError('Goal is not archived');
      goal.status = GoalStatus.ACTIVE;
      goal.archivedAt = undefined;
      em.persist(goal);
      await em.flush();
      return goal;
    });
  }

  async undoTransactionFunding(input: UndoTransactionFundingInput) {
    return this.em.transactional(async (em) => {
      const goal = await this.findGoal(input.goalKey, input, [], em, LockMode.PESSIMISTIC_WRITE);
      this.assertGoalIsMutable(goal);
      const funding = await em.findOne(GoalTransactionFunding, { deletedAt: undefined, goalKey: goal, goalTransactionFundingKey: input.goalTransactionFundingKey, tenantKey: getRef(em, Tenant, input.tenantKey) }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!funding) throw new NotFoundError('Goal transaction funding not found');
      if (funding.reversedAt) throw new BadRequestError('Goal transaction funding already reversed');
      funding.reversedAt = new Date();
      const activity = new GoalActivity();
      activity.amount = funding.amount;
      activity.appuserKey = getRef(em, Appuser, input.appuserKey);
      activity.createdByAppuserKey = getRef(em, Appuser, input.appuserKey);
      activity.currencyKey = funding.currencyKey;
      activity.goalKey = funding.goalKey;
      activity.tenantKey = getRef(em, Tenant, input.tenantKey);
      activity.transactionKey = funding.transactionKey;
      activity.type = GoalActivityType.TRANSACTION_FUNDING_REVERSED;
      em.persist([funding, activity]);
      await em.flush();
      return funding;
    });
  }

  async unlinkGoalAccount(input: LinkGoalAccountInput) {
    return this.em.transactional(async (em) => {
      const goal = await this.findGoal(input.goalKey, input, [], em, LockMode.PESSIMISTIC_WRITE);
      this.assertGoalIsMutable(goal);
      const account = await em.findOne(Account, { accountKey: input.accountKey, deletedAt: undefined, tenantKey: getRef(em, Tenant, input.tenantKey) });
      if (!account) throw new NotFoundError('Account not found');
      const link = await em.findOne(GoalAccountLink, { accountKey: account, deletedAt: undefined, goalKey: goal, tenantKey: getRef(em, Tenant, input.tenantKey) });
      if (!link) throw new NotFoundError('Goal account link not found');
      link.deletedAt = new Date();
      em.persist(link);
      await em.flush();
      return link;
    });
  }

  async updateGoal(input: UpdateGoalInput): Promise<Goal> {
    return this.em.transactional(async (em) => {
      const goal = await this.findGoal(input.goalKey, input, [], em, LockMode.PESSIMISTIC_WRITE);
      this.assertGoalIsMutable(goal);
      if (input.name !== undefined) goal.name = input.name;
      if (input.priority !== undefined) goal.priority = input.priority;
      if (input.targetAmount !== undefined) goal.targetAmount = input.targetAmount;
      if (input.description !== undefined) goal.description = input.description ?? undefined;
      if (input.monthlyContributionTarget !== undefined) goal.monthlyContributionTarget = input.monthlyContributionTarget ?? undefined;
      if (input.currencyKey !== undefined) goal.currencyKey = getRef(em, Currency, input.currencyKey);
      if (input.targetDate !== undefined) goal.targetDate = input.targetDate ?? undefined;
      if (input.currentBalance !== undefined) goal.currentBalance = input.currentBalance ?? undefined;
      if (input.annualInterestRateBps !== undefined) goal.annualInterestRateBps = input.annualInterestRateBps ?? undefined;
      if (input.minimumPayment !== undefined) goal.minimumPayment = input.minimumPayment ?? undefined;
      if (input.extraPayment !== undefined) goal.extraPayment = input.extraPayment ?? undefined;
      if (input.loanKey !== undefined) goal.loanKey = await this.resolveLoan(input.loanKey, input, em);
      const activity = new GoalActivity();
      activity.appuserKey = getRef(em, Appuser, input.appuserKey);
      activity.goalKey = goal;
      activity.tenantKey = getRef(em, Tenant, input.tenantKey);
      activity.type = GoalActivityType.GOAL_UPDATED;
      em.persist([goal, activity]);
      await em.flush();
      return goal;
    });
  }

  private activityDelta(activity: GoalActivity): Big {
    const amount = new Big(activity.amount ?? 0);
    if ([GoalActivityType.ASSIGNED, GoalActivityType.MANUAL_ADJUSTMENT, GoalActivityType.MOVED_IN, GoalActivityType.TRANSACTION_FUNDING_REVERSED].includes(activity.type)) return amount;
    if ([GoalActivityType.MOVED_OUT, GoalActivityType.SPENT_FROM_GOAL].includes(activity.type)) return amount.times(-1);
    return new Big(0);
  }

  private assertGoalIsMutable(goal: Goal) {
    if ([GoalStatus.ARCHIVED, GoalStatus.COMPLETED].includes(goal.status)) throw new BadRequestError('Goal cannot be modified');
  }

  private assertMatchingCurrency(goal: Goal, currencyKey: number) {
    const goalCurrencyKey = goal.currencyKey.currencyKey;
    if (goalCurrencyKey !== currencyKey) throw new BadRequestError('Currency must match goal currency');
  }

  private buildGoalActivity(em: EntityManager, goal: Goal, input: { appuserKey: number; currencyKey: number; note?: string; tenantKey: number; }, type: GoalActivityType, amount: number) {
    this.assertMatchingCurrency(goal, input.currencyKey);
    const activity = new GoalActivity();
    activity.amount = this.normalizeAmount(amount);
    activity.appuserKey = getRef(em, Appuser, input.appuserKey);
    activity.createdByAppuserKey = getRef(em, Appuser, input.appuserKey);
    activity.currencyKey = getRef(em, Currency, input.currencyKey);
    activity.goalKey = goal;
    activity.note = input.note;
    activity.tenantKey = getRef(em, Tenant, input.tenantKey);
    activity.type = type;
    return activity;
  }

  private buildSummary(goal: Goal, activities: GoalActivity[], now: Date) {
    const assignedThisMonth = this.sumActivities(activities, [GoalActivityType.ASSIGNED, GoalActivityType.MOVED_IN], now);
    const spentAmount = this.sumNetSpentActivities(activities);
    const availableAmount = this.getBalance(activities).toNumber();
    const isDebt = goal.type === GoalType.DEBT_PAYDOWN;
    return buildGoalSummary({
      assignedThisMonth,
      availableAmount,
      debt: isDebt
        ? { annualInterestRateBps: goal.annualInterestRateBps ?? null, currentBalance: goal.currentBalance ?? null, extraPayment: goal.extraPayment ?? null, minimumPayment: goal.minimumPayment ?? null }
        : undefined,
      isDebt,
      monthlyContributionTarget: goal.monthlyContributionTarget ?? null,
      now,
      paused: goal.status === GoalStatus.PAUSED,
      spentAmount,
      targetAmount: goal.targetAmount,
      targetDate: goal.targetDate ?? null,
    });
  }

  private async findGoal(goalKey: number, input: GoalContext, populate: string[] = [], em: EntityManager = this.em, lockMode?: LockMode): Promise<Goal> {
    const goal = await em.findOne(Goal, { deletedAt: undefined, goalKey, tenantKey: getRef(em, Tenant, input.tenantKey) }, { lockMode, populate: Array.from(new Set(['currencyKey', ...populate])) as ('currencyKey' | keyof Goal)[] });
    if (!goal) throw new NotFoundError('Goal not found');
    return goal;
  }

  private async findTransaction(transactionKey: number, input: GoalContext, em: EntityManager = this.em, lockMode?: LockMode): Promise<Transaction> {
    const transaction = await em.findOne(Transaction, { deletedAt: undefined, tenantKey: getRef(em, Tenant, input.tenantKey), transactionKey }, { lockMode });
    if (!transaction) throw new NotFoundError('Transaction not found');
    return transaction;
  }

  private getBalance(activities: GoalActivity[]): Big {
    return activities.reduce((sum, activity) => sum.plus(this.activityDelta(activity)), new Big(0));
  }

  private getFundedTransactionAmount(fundings: GoalTransactionFunding[]): Big {
    return fundings.filter((funding) => !funding.reversedAt).reduce((sum, funding) => sum.plus(funding.amount), new Big(0));
  }

  private async getGoalActivities(goal: Goal, input: GoalContext, em: EntityManager = this.em): Promise<GoalActivity[]> {
    return em.find(GoalActivity, { deletedAt: undefined, goalKey: goal, tenantKey: getRef(em, Tenant, input.tenantKey) }, { orderBy: { occurredAt: 'desc' } });
  }

  private async getTransactionFundings(transaction: Transaction, input: GoalContext, em: EntityManager = this.em): Promise<GoalTransactionFunding[]> {
    return em.find(GoalTransactionFunding, {
      deletedAt: undefined,
      tenantKey: getRef(em, Tenant, input.tenantKey),
      transactionKey: transaction,
    });
  }

  private normalizeAmount(amount: number): number {
    return Number(new Big(amount).round(4).toFixed(4));
  }

  private normalizeAndValidateAmount(amount: number): number {
    if (new Big(amount).lte(0)) throw new BadRequestError('Amount must be greater than zero');
    const normalized = this.normalizeAmount(amount);
    if (new Big(normalized).lte(0)) throw new BadRequestError('Amount must be greater than zero');
    return normalized;
  }

  private async resolveLoan(loanKey: null | number | undefined, input: GoalContext, em: EntityManager = this.em): Promise<Loan | undefined> {
    if (loanKey == null) return undefined;
    const facility = await em.findOne(Loan, {
      deletedAt: undefined,
      loanKey,
      ownerAppuserKey: getRef(em, Appuser, input.appuserKey),
      tenantKey: getRef(em, Tenant, input.tenantKey),
    });
    if (!facility) throw new NotFoundError('Loan facility not found');
    return facility;
  }

  private serializeGoal(goal: Goal) {
    interface SerializedGoalShape {
      accountLinks?: { getItems?: () => GoalAccountLink[] };
      currencyKey?: { code?: string };
    }
    const serializedGoal = goal as unknown as SerializedGoalShape;
    const accountLinks = serializedGoal.accountLinks?.getItems?.().filter((link) => !link.deletedAt) ?? [];
    return {
      accountLinks: accountLinks.map((link) => ({ accountKey: { accountKey: link.accountKey.accountKey, accountName: link.accountKey.accountName }, goalAccountLinkKey: link.goalAccountLinkKey })),
      annualInterestRateBps: goal.annualInterestRateBps ?? null,
      currencyCode: serializedGoal.currencyKey?.code,
      currentBalance: goal.currentBalance ?? null,
      description: goal.description ?? null,
      extraPayment: goal.extraPayment ?? null,
      goalKey: goal.goalKey,
      loanKey: goal.loanKey ? goal.loanKey.loanKey : null,
      minimumPayment: goal.minimumPayment ?? null,
      monthlyContributionTarget: goal.monthlyContributionTarget,
      name: goal.name,
      priority: goal.priority,
      status: goal.status,
      targetAmount: goal.targetAmount,
      targetDate: goal.targetDate ?? null,
      type: goal.type,
    };
  }

  private sumActivities(activities: GoalActivity[], types: GoalActivityType[], now: Date): number {
    return activities
      .filter((activity) => types.includes(activity.type) && activity.occurredAt.getFullYear() === now.getFullYear() && activity.occurredAt.getMonth() === now.getMonth())
      .reduce((sum, activity) => sum + (activity.amount ?? 0), 0);
  }

  private sumActivitiesAllTime(activities: GoalActivity[], types: GoalActivityType[]): number {
    return activities.filter((activity) => types.includes(activity.type)).reduce((sum, activity) => sum + (activity.amount ?? 0), 0);
  }

  private sumNetSpentActivities(activities: GoalActivity[]): number {
    const spentAmount = this.sumActivitiesAllTime(activities, [GoalActivityType.SPENT_FROM_GOAL]);
    const reversedAmount = this.sumActivitiesAllTime(activities, [GoalActivityType.TRANSACTION_FUNDING_REVERSED]);
    return Math.max(spentAmount - reversedAmount, 0);
  }
}
