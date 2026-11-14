import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addPartner, addShare, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import type { Category } from '@entity/Category';
import { getBudgetSpending } from '@service/budget/spending';
import { addExpenseGroupMember, createExpenseGroup, deleteExpenseGroup, deleteGroupSettlement, getExpenseGroup, getGroupBalances, getGroupExpense, listExpenseGroups, listGroupExpenses, listGroupSettlements, recordGroupSettlement, removeExpenseGroupMember, shareGroupExpense, suggestSettlementTransactions, unshareGroupExpense } from '@service/expense-group/expense-group.service';
import { getCashflowReport } from '@service/reports/cashflow.service';
import { getSpendingByCategoryReport } from '@service/reports/spendingByCategory.service';
import { linkReimbursement } from '@service/transaction/transaction-reimbursement.service';
import { removeTransactionSplits, setTransactionSplits } from '@service/transaction/transaction-split.service';
import { getTransactionTotals } from '@service/transaction/transaction-totals';
import { applyUserCategorization } from '@service/transaction/user-categorization.service';
import { reportFiltersSchema } from '@validators/reports';

/*
 * Expense groups on top of split transactions: each person's share is a split line, the household
 * counts only its own people's shares, settlements move balances and (when linked) take the money
 * back out of income, and nothing is counted twice with reimbursements. Groups never cross
 * households, and an expense on a private account stays its owner's.
 */
describe('expense groups', () => {
  const db = useTestDatabase();
  const JULY_1 = new Date('2026-07-01T12:00:00Z');
  const JULY_10 = new Date('2026-07-10T12:00:00Z');
  const JULY_15 = new Date('2026-07-15T12:00:00Z');
  const RANGE = { fromDate: '2026-07-01T00:00:00Z', toDate: '2026-07-31T23:59:59Z' };

  const actorOf = (household: Household) => ({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });

  async function setup() {
    const em = db.em();
    const household = await seedHousehold(em);
    const food = await addCategory(em, household, 'Food');
    const restaurants = await addCategory(em, household, 'Restaurants', food);
    const travel = await addCategory(em, household, 'Travel', food);
    await addTransaction(em, household, { amount: 500, date: JULY_1, status: 'BOOKED' });
    const group = await createExpenseGroup(db.em(), actorOf(household), { currencyCode: 'EUR', members: [{ email: 'alice@example.test', name: 'Alice' }, { name: 'Bob' }], name: 'Lisbon trip' });
    const [you, alice, bob] = group.members;
    return { alice: alice!, bob: bob!, group, household, restaurants, travel, you: you! };
  }

  /** Category spending (the report), income and expenses (cash flow), budget spending and the SQL total for July. */
  async function totals(household: Household, budgeted: Category[] = []) {
    const input = { filters: reportFiltersSchema.parse(RANGE), tenant: household.tenant, user: household.appuser };
    const byCategory = Object.fromEntries((await getSpendingByCategoryReport(input)).data.map((row) => [row.name, row.totalAmount]));
    const [month] = (await getCashflowReport(input)).data;
    let budget: Record<string, number> = {};
    if (budgeted.length > 0) {
      const em = db.em();
      const created = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name: `Budget ${Math.random()}`, numAdults: 1, numDependents: 0, tenantKey: household.tenant }, { partial: true });
      const templates = budgeted.map((category) => em.create(BudgetTemplateCategory, { amountBudgeted: 100, budgetKey: created, categoryKey: category, month: 7, year: 2026 }, { partial: true }));
      await em.flush();
      const accounts = await db.em().find(Account, { tenantKey: household.tenant }, { filters: false });
      const { categories } = await getBudgetSpending({ accountKeys: accounts.map((account) => account.accountKey), currency: { code: 'EUR', currencyKey: household.currency.currencyKey }, period: 'monthly', periodStartDay: 1, templateKeys: templates.map((template) => template.budgetTemplateCategoryKey), tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
      budget = Object.fromEntries(categories.filter((row) => row.child_category_name).map((row) => [row.child_category_name, row.category_amount]));
    }
    const sql = await getTransactionTotals(db.em(), {
      currency: { code: 'EUR', currencyKey: household.currency.currencyKey },
      lines: { spendingOnly: true },
      rows: { params: [household.tenant.tenantKey], sql: 't.tenant_key = ? and t.deleted_at is null' },
      tenantKey: household.tenant.tenantKey,
    });
    const total = sql.months.get('')!;
    return { budget, byCategory, expenses: month?.expenses, income: month?.income, sqlIn: total.moneyIn, sqlOut: total.moneyOut };
  }

  async function code(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
      return undefined;
    } catch (error) {
      return `${(error as { status?: number }).status ?? '?'} ${(error as { code?: string }).code ?? ''}`.trim();
    }
  }

  const balanceOf = async (household: Household, groupKey: number, currency = 'EUR') => {
    const { currencies } = await getGroupBalances(db.em(), actorOf(household), groupKey);
    const entry = currencies.find((row) => row.currencyCode === currency);
    return Object.fromEntries((entry?.members ?? []).map((member) => [member.memberKey, member.balance]));
  };

  describe('groups and members', () => {
    it('creates a group with people who have no account, the creator first and marked as you', async () => {
      const { group, household } = await setup();
      expect(group.members.map((member) => ({ household: member.isHouseholdMember, name: member.name, you: member.isYou }))).toEqual([
        { household: true, name: expect.any(String), you: true },
        { household: false, name: 'Alice', you: false },
        { household: false, name: 'Bob', you: false },
      ]);
      expect((await listExpenseGroups(db.em(), actorOf(household))).map((row) => row.name)).toEqual(['Lisbon trip']);
    });

    it('links a household member, refuses someone of another household, and refuses removing someone with shares', async () => {
      const { alice, group, household } = await setup();
      const partner = await addPartner(db.em(), household);
      const stranger = await seedHousehold(db.em());
      const added = await addExpenseGroupMember(db.em(), actorOf(household), group.expenseGroupKey, { appuserKey: partner.appuserKey, name: '' });
      expect(added).toMatchObject({ isHouseholdMember: true, isYou: false });
      expect(await code(addExpenseGroupMember(db.em(), actorOf(household), group.expenseGroupKey, { appuserKey: stranger.appuser.appuserKey, name: 'X' }))).toBe('400 expense_group_member_invalid');
      expect(await code(addExpenseGroupMember(db.em(), actorOf(household), group.expenseGroupKey, { appuserKey: partner.appuserKey, name: 'Again' }))).toBe('400 expense_group_member_invalid');

      const dinner = await addTransaction(db.em(), household, { amount: -60, date: JULY_10, status: 'BOOKED' });
      await shareGroupExpense(db.em(), actorOf(household), group.expenseGroupKey, { method: 'equal', paidByMemberKey: group.members[0]!.expenseGroupMemberKey, shares: [{ memberKey: alice.expenseGroupMemberKey }, { memberKey: added.expenseGroupMemberKey }], transactionKey: dinner.transactionKey });
      expect(await code(removeExpenseGroupMember(db.em(), actorOf(household), group.expenseGroupKey, alice.expenseGroupMemberKey))).toBe('409 expense_group_member_in_use');
      expect(await code(deleteExpenseGroup(db.em(), actorOf(household), group.expenseGroupKey))).toBe('409 expense_group_not_empty');
    });

    it('deletes an empty group', async () => {
      const { bob, group, household } = await setup();
      await removeExpenseGroupMember(db.em(), actorOf(household), group.expenseGroupKey, bob.expenseGroupMemberKey);
      expect((await getExpenseGroup(db.em(), actorOf(household), group.expenseGroupKey)).members).toHaveLength(2);
      await deleteExpenseGroup(db.em(), actorOf(household), group.expenseGroupKey);
      expect(await listExpenseGroups(db.em(), actorOf(household))).toEqual([]);
    });
  });

  describe('sharing and the household totals', () => {
    it('a 60 dinner shared three ways counts 20 in every total, and the others owe the payer', async () => {
      const { alice, bob, group, household, restaurants, you } = await setup();
      const dinner = await addTransaction(db.em(), household, { amount: -60, category: restaurants, date: JULY_10, status: 'BOOKED' });
      expect(await totals(household, [restaurants])).toEqual({ budget: { Restaurants: 60 }, byCategory: { Restaurants: 60 }, expenses: 60, income: 500, sqlIn: 500, sqlOut: 60 });

      const shared = await shareGroupExpense(db.em(), actorOf(household), group.expenseGroupKey, {
        method: 'equal',
        paidByMemberKey: you.expenseGroupMemberKey,
        shares: [{ memberKey: you.expenseGroupMemberKey }, { memberKey: alice.expenseGroupMemberKey }, { memberKey: bob.expenseGroupMemberKey }],
        transactionKey: dinner.transactionKey,
      });

      expect(shared.shares.map((share) => share.amount)).toEqual([-20, -20, -20]);
      expect(shared.categoryKey).toBe(restaurants.categoryKey);
      expect(await totals(household, [restaurants])).toEqual({ budget: { Restaurants: 20 }, byCategory: { Restaurants: 20 }, expenses: 20, income: 500, sqlIn: 500, sqlOut: 20 });
      expect(await balanceOf(household, group.expenseGroupKey)).toEqual({ [alice.expenseGroupMemberKey]: -20, [bob.expenseGroupMemberKey]: -20, [you.expenseGroupMemberKey]: 40 });
      expect((await getExpenseGroup(db.em(), actorOf(household), group.expenseGroupKey)).yourBalances).toEqual([{ amount: 40, currencyCode: 'EUR' }]);
    });

    it('counts every household member\'s share once: a member\'s spending equals the sum of their shares', async () => {
      const { alice, group, household, restaurants, travel, you } = await setup();
      const partner = await addPartner(db.em(), household);
      const partnerMember = await addExpenseGroupMember(db.em(), actorOf(household), group.expenseGroupKey, { appuserKey: partner.appuserKey, name: 'Partner' });
      const hotel = await addTransaction(db.em(), household, { amount: -300, category: travel, date: JULY_10, status: 'BOOKED' });
      const dinner = await addTransaction(db.em(), household, { amount: -90, category: restaurants, date: JULY_10, status: 'BOOKED' });

      await shareGroupExpense(db.em(), actorOf(household), group.expenseGroupKey, { method: 'amounts', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ amount: 120, memberKey: you.expenseGroupMemberKey }, { amount: 100, memberKey: partnerMember.expenseGroupMemberKey }, { amount: 80, memberKey: alice.expenseGroupMemberKey }], transactionKey: hotel.transactionKey });
      await shareGroupExpense(db.em(), actorOf(household), group.expenseGroupKey, { method: 'percentages', paidByMemberKey: partnerMember.expenseGroupMemberKey, shares: [{ memberKey: you.expenseGroupMemberKey, percentage: 50 }, { memberKey: alice.expenseGroupMemberKey, percentage: 50 }], transactionKey: dinner.transactionKey });

      // The household's spending is its members' shares: 120 + 100 at the hotel, 45 at dinner.
      expect(await totals(household, [restaurants, travel])).toEqual({ budget: { Restaurants: 45, Travel: 220 }, byCategory: { Restaurants: 45, Travel: 220 }, expenses: 265, income: 500, sqlIn: 500, sqlOut: 265 });
      const expenses = await listGroupExpenses(db.em(), actorOf(household), group.expenseGroupKey);
      const householdShares = expenses.flatMap((expense) => expense.shares).filter((share) => share.expenseGroupMemberKey !== alice.expenseGroupMemberKey);
      expect(householdShares.reduce((sum, share) => sum - share.amount, 0)).toBe(265);
    });

    it('keeps the transaction\'s one "Spent by": the member filter keeps it whole, at the household\'s shares', async () => {
      const { alice, group, household, restaurants, you } = await setup();
      const partner = await addPartner(db.em(), household);
      const partnerMember = await addExpenseGroupMember(db.em(), actorOf(household), group.expenseGroupKey, { appuserKey: partner.appuserKey, name: 'Partner' });
      const dinner = await addTransaction(db.em(), household, { amount: -90, category: restaurants, date: JULY_10, status: 'BOOKED' });
      await shareGroupExpense(db.em(), actorOf(household), group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ memberKey: you.expenseGroupMemberKey }, { memberKey: partnerMember.expenseGroupMemberKey }, { memberKey: alice.expenseGroupMemberKey }], transactionKey: dinner.transactionKey });
      const byMember = async (memberKeys: string[]) => {
        const input = { filters: reportFiltersSchema.parse({ ...RANGE, memberKeys }), tenant: household.tenant, user: household.appuser };
        return Object.fromEntries((await getSpendingByCategoryReport(input)).data.map((row) => [row.name, row.totalAmount]));
      };

      // The dinner is the payer's (its account's owner): both household shares count under them, none under the partner.
      expect(await byMember([String(household.appuser.appuserKey)])).toEqual({ Restaurants: 60 });
      expect((await byMember([String(partner.appuserKey)]))['Restaurants'] ?? 0).toBe(0);
    });

    it('an expense shared only by others counts nothing for the household', async () => {
      const { alice, bob, group, household, restaurants, you } = await setup();
      const gift = await addTransaction(db.em(), household, { amount: -40, category: restaurants, date: JULY_10, status: 'BOOKED' });
      await shareGroupExpense(db.em(), actorOf(household), group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ memberKey: alice.expenseGroupMemberKey }, { memberKey: bob.expenseGroupMemberKey }], transactionKey: gift.transactionKey });
      const after = await totals(household, [restaurants]);
      expect(after).toMatchObject({ budget: { Restaurants: 0 }, income: 500, sqlOut: 0 });
      expect(after.expenses ?? 0).toBe(0);
      expect(after.byCategory['Restaurants'] ?? 0).toBe(0);
    });

    it('re-sharing replaces the shares, and unsharing restores the whole amount in one category', async () => {
      const { alice, group, household, restaurants, you } = await setup();
      const dinner = await addTransaction(db.em(), household, { amount: -60, category: restaurants, date: JULY_10, status: 'BOOKED' });
      const actor = actorOf(household);
      await shareGroupExpense(db.em(), actor, group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ memberKey: you.expenseGroupMemberKey }, { memberKey: alice.expenseGroupMemberKey }], transactionKey: dinner.transactionKey });
      await shareGroupExpense(db.em(), actor, group.expenseGroupKey, { method: 'amounts', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ amount: 45, memberKey: you.expenseGroupMemberKey }, { amount: 15, memberKey: alice.expenseGroupMemberKey }], transactionKey: dinner.transactionKey });
      expect((await getGroupExpense(db.em(), actor, group.expenseGroupKey, dinner.transactionKey)).splitMethod).toBe('amounts');
      expect((await totals(household)).byCategory).toEqual({ Restaurants: 45 });

      await unshareGroupExpense(db.em(), actor, group.expenseGroupKey, dinner.transactionKey);
      expect((await totals(household)).byCategory).toEqual({ Restaurants: 60 });
      expect(await listGroupExpenses(db.em(), actor, group.expenseGroupKey)).toEqual([]);
      expect(await balanceOf(household, group.expenseGroupKey)).toEqual({});
    });

    it('keeps the group\'s split away from plain split edits, and moves every share on a category change', async () => {
      const { alice, group, household, restaurants, travel, you } = await setup();
      const dinner = await addTransaction(db.em(), household, { amount: -60, category: restaurants, date: JULY_10, status: 'BOOKED' });
      const actor = actorOf(household);
      await shareGroupExpense(db.em(), actor, group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ memberKey: you.expenseGroupMemberKey }, { memberKey: alice.expenseGroupMemberKey }], transactionKey: dinner.transactionKey });

      expect(await code(setTransactionSplits(db.em(), actor, dinner.transactionKey, [{ amount: -30, categoryKey: restaurants.categoryKey }, { amount: -30, categoryKey: travel.categoryKey }]))).toBe('409 transaction_in_expense_group');
      expect(await code(removeTransactionSplits(db.em(), actor, dinner.transactionKey))).toBe('409 transaction_in_expense_group');

      const em = db.em();
      const { Transaction } = await import('@entity/Transaction');
      const loaded = await em.findOneOrFail(Transaction, { transactionKey: dinner.transactionKey }, { filters: false, populate: ['appuserTransactionCategories.categoryKey', 'transactionMerchantKey'] });
      await applyUserCategorization(em, { actor: household.appuser, category: travel, transactions: [loaded] });
      expect((await totals(household)).byCategory).toEqual({ Travel: 30 });
      expect((await getGroupExpense(db.em(), actor, group.expenseGroupKey, dinner.transactionKey)).categoryKey).toBe(travel.categoryKey);
    });

    it('follows a later amount change: shares rescale, and a split that cannot be kept leaves the group', async () => {
      const { alice, group, household, restaurants, you } = await setup();
      const { Transaction } = await import('@entity/Transaction');
      const { TransactionAuditActorType } = await import('@entity/TransactionAuditLog');
      const { reconcileSplitsWithAmount } = await import('@service/transaction/transaction-split.service');
      const dinner = await addTransaction(db.em(), household, { amount: -60, category: restaurants, date: JULY_10, status: 'BOOKED' });
      await shareGroupExpense(db.em(), actorOf(household), group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ memberKey: you.expenseGroupMemberKey }, { memberKey: alice.expenseGroupMemberKey }], transactionKey: dinner.transactionKey });
      const change = async (amount: number) => {
        const em = db.em();
        const row = await em.findOneOrFail(Transaction, { transactionKey: dinner.transactionKey }, { filters: false });
        row.settlementAmount = amount;
        row.appuserSettlementAmount = amount;
        await em.flush();
        return reconcileSplitsWithAmount(em, row, { actorType: TransactionAuditActorType.SYNC, source: 'test' });
      };

      expect(await change(-70)).toBe('rescaled');
      expect(await balanceOf(household, group.expenseGroupKey)).toMatchObject({ [alice.expenseGroupMemberKey]: -35, [you.expenseGroupMemberKey]: 35 });
      expect((await totals(household)).byCategory).toEqual({ Restaurants: 35 });

      expect(await change(10)).toBe('removed');
      expect(await listGroupExpenses(db.em(), actorOf(household), group.expenseGroupKey)).toEqual([]);
      expect(await balanceOf(household, group.expenseGroupKey)).toEqual({});
    });

    it('keeps balances per currency', async () => {
      const { alice, group, household, you } = await setup();
      const usd = await currencyFor(db.em(), 'USD');
      const dollars = await addAccount(db.em(), household, { currency: usd, name: 'Dollars' });
      const taxi = await addTransaction(db.em(), household, { account: dollars, amount: -30, currency: usd, date: JULY_10, status: 'BOOKED' });
      await shareGroupExpense(db.em(), actorOf(household), group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ memberKey: you.expenseGroupMemberKey }, { memberKey: alice.expenseGroupMemberKey }], transactionKey: taxi.transactionKey });
      expect(await balanceOf(household, group.expenseGroupKey, 'USD')).toMatchObject({ [alice.expenseGroupMemberKey]: -15, [you.expenseGroupMemberKey]: 15 });
      expect(await balanceOf(household, group.expenseGroupKey, 'EUR')).toEqual({});
    });
  });

  describe('settlements', () => {
    async function sharedDinner() {
      const context = await setup();
      const { alice, bob, group, household, restaurants, you } = context;
      const dinner = await addTransaction(db.em(), household, { amount: -60, category: restaurants, date: JULY_10, status: 'BOOKED' });
      await shareGroupExpense(db.em(), actorOf(household), group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ memberKey: you.expenseGroupMemberKey }, { memberKey: alice.expenseGroupMemberKey }, { memberKey: bob.expenseGroupMemberKey }], transactionKey: dinner.transactionKey });
      return { ...context, dinner };
    }

    it('a settlement reduces the balances, and removing it restores them', async () => {
      const { alice, bob, group, household, you } = await sharedDinner();
      const settlement = await recordGroupSettlement(db.em(), actorOf(household), group.expenseGroupKey, { amount: 20, fromMemberKey: alice.expenseGroupMemberKey, settledOn: '2026-07-12', toMemberKey: you.expenseGroupMemberKey });
      expect(await balanceOf(household, group.expenseGroupKey)).toEqual({ [alice.expenseGroupMemberKey]: 0, [bob.expenseGroupMemberKey]: -20, [you.expenseGroupMemberKey]: 20 });
      const { currencies } = await getGroupBalances(db.em(), actorOf(household), group.expenseGroupKey);
      expect(currencies[0]!.payments).toEqual([{ amount: 20, fromMemberKey: bob.expenseGroupMemberKey, toMemberKey: you.expenseGroupMemberKey }]);

      await deleteGroupSettlement(db.em(), actorOf(household), group.expenseGroupKey, settlement.expenseGroupSettlementKey);
      expect(await balanceOf(household, group.expenseGroupKey)).toEqual({ [alice.expenseGroupMemberKey]: -20, [bob.expenseGroupMemberKey]: -20, [you.expenseGroupMemberKey]: 40 });
    });

    it('a friend paying back into the account is not income once linked', async () => {
      const { alice, group, household, restaurants, you } = await sharedDinner();
      const payback = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED' });
      expect(await totals(household, [restaurants])).toMatchObject({ expenses: 20, income: 520, sqlIn: 520 });
      expect((await suggestSettlementTransactions(db.em(), actorOf(household), group.expenseGroupKey, { fromMemberKey: alice.expenseGroupMemberKey, limit: 10, search: payback.description ?? '', toMemberKey: you.expenseGroupMemberKey })).map((row) => row.transactionKey)).toContain(payback.transactionKey);

      await recordGroupSettlement(db.em(), actorOf(household), group.expenseGroupKey, { amount: 20, fromMemberKey: alice.expenseGroupMemberKey, settledOn: '2026-07-15', toMemberKey: you.expenseGroupMemberKey, transactionKey: payback.transactionKey });

      expect(await totals(household, [restaurants])).toEqual({ budget: { Restaurants: 20 }, byCategory: { Restaurants: 20 }, expenses: 20, income: 500, sqlIn: 500, sqlOut: 20 });
      const [listed] = await listGroupSettlements(db.em(), actorOf(household), group.expenseGroupKey);
      expect(listed).toMatchObject({ amount: 20, isLinked: true, transaction: { transactionKey: payback.transactionKey } });
    });

    it('refuses a link the wrong way, in another currency, over the amount, or between two outsiders', async () => {
      const { alice, bob, group, household, you } = await sharedDinner();
      const actor = actorOf(household);
      const payback = await addTransaction(db.em(), household, { amount: 15, date: JULY_15, status: 'BOOKED' });
      const outgoing = await addTransaction(db.em(), household, { amount: -15, date: JULY_15, status: 'BOOKED' });
      const usd = await currencyFor(db.em(), 'USD');
      const dollars = await addAccount(db.em(), household, { currency: usd });
      const dollarPayback = await addTransaction(db.em(), household, { account: dollars, amount: 20, currency: usd, date: JULY_15, status: 'BOOKED' });
      const base = { fromMemberKey: alice.expenseGroupMemberKey, settledOn: '2026-07-15', toMemberKey: you.expenseGroupMemberKey };

      expect(await code(recordGroupSettlement(db.em(), actor, group.expenseGroupKey, { ...base, amount: 15, transactionKey: outgoing.transactionKey }))).toBe('400 expense_group_settlement_invalid');
      expect(await code(recordGroupSettlement(db.em(), actor, group.expenseGroupKey, { ...base, amount: 20, transactionKey: dollarPayback.transactionKey }))).toBe('400 expense_group_currency_mismatch');
      expect(await code(recordGroupSettlement(db.em(), actor, group.expenseGroupKey, { ...base, amount: 20, transactionKey: payback.transactionKey }))).toBe('400 expense_group_amount_exceeded');
      expect(await code(recordGroupSettlement(db.em(), actor, group.expenseGroupKey, { amount: 5, fromMemberKey: alice.expenseGroupMemberKey, settledOn: '2026-07-15', toMemberKey: bob.expenseGroupMemberKey, transactionKey: payback.transactionKey }))).toBe('400 expense_group_settlement_invalid');
      expect(await code(recordGroupSettlement(db.em(), actor, group.expenseGroupKey, { ...base, amount: 5, toMemberKey: alice.expenseGroupMemberKey }))).toBe('400 expense_group_settlement_invalid');
    });
  });

  describe('reimbursements', () => {
    it('never counts a shared expense or a settlement again as a reimbursement, and the other way round', async () => {
      const { alice, group, household, restaurants, you } = await setup();
      const actor = actorOf(household);
      const dinner = await addTransaction(db.em(), household, { amount: -60, category: restaurants, date: JULY_10, status: 'BOOKED' });
      await shareGroupExpense(db.em(), actor, group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ memberKey: you.expenseGroupMemberKey }, { memberKey: alice.expenseGroupMemberKey }], transactionKey: dinner.transactionKey });
      const payback = await addTransaction(db.em(), household, { amount: 30, date: JULY_15, status: 'BOOKED' });

      // The friend's money cannot reimburse the shared dinner: their share is already off the totals.
      expect(await code(linkReimbursement(db.em(), actor, payback.transactionKey, { amount: 30, expenseTransactionKey: dinner.transactionKey }))).toBe('409 transaction_in_expense_group');

      // A settlement's transaction cannot be a reimbursement either.
      await recordGroupSettlement(db.em(), actor, group.expenseGroupKey, { amount: 30, fromMemberKey: alice.expenseGroupMemberKey, settledOn: '2026-07-15', toMemberKey: you.expenseGroupMemberKey, transactionKey: payback.transactionKey });
      const other = await addTransaction(db.em(), household, { amount: -30, category: restaurants, date: JULY_10, status: 'BOOKED' });
      expect(await code(linkReimbursement(db.em(), actor, payback.transactionKey, { amount: 10, expenseTransactionKey: other.transactionKey }))).toBe('409 transaction_in_expense_group');
      expect(await totals(household, [restaurants])).toMatchObject({ byCategory: { Restaurants: 60 }, expenses: 60, income: 500 });

      // And a reimbursed expense or a refund linked as a reimbursement cannot be shared or settle.
      const refunded = await addTransaction(db.em(), household, { amount: -50, category: restaurants, date: JULY_10, status: 'BOOKED' });
      const refund = await addTransaction(db.em(), household, { amount: 10, date: JULY_15, status: 'BOOKED' });
      await linkReimbursement(db.em(), actor, refund.transactionKey, { amount: 10, expenseTransactionKey: refunded.transactionKey });
      expect(await code(shareGroupExpense(db.em(), actor, group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ memberKey: alice.expenseGroupMemberKey }], transactionKey: refunded.transactionKey }))).toBe('409 expense_group_transaction_conflict');
      expect(await code(recordGroupSettlement(db.em(), actor, group.expenseGroupKey, { amount: 10, fromMemberKey: alice.expenseGroupMemberKey, settledOn: '2026-07-15', toMemberKey: you.expenseGroupMemberKey, transactionKey: refund.transactionKey }))).toBe('409 expense_group_transaction_conflict');
      expect(await code(shareGroupExpense(db.em(), actor, group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ memberKey: alice.expenseGroupMemberKey }], transactionKey: payback.transactionKey }))).toBe('409 expense_group_transaction_conflict');
    });
  });

  describe('tenancy and privacy', () => {
    it('lets a member who may only view an account see its shared expense, but not change it', async () => {
      const { alice, group, household, you } = await setup();
      const partner = await addPartner(db.em(), household);
      const partnerActor = { appuserKey: partner.appuserKey, tenantKey: household.tenant.tenantKey };
      const privateAccount = await addAccount(db.em(), household, { isPrivate: true, name: 'Private' });
      await addShare(db.em(), household, privateAccount, partner, 'read');
      const dinner = await addTransaction(db.em(), household, { account: privateAccount, amount: -60, date: JULY_10, status: 'BOOKED' });
      const payback = await addTransaction(db.em(), household, { account: privateAccount, amount: 30, date: JULY_15, status: 'BOOKED' });
      const shares = [{ memberKey: you.expenseGroupMemberKey }, { memberKey: alice.expenseGroupMemberKey }];

      expect(await code(shareGroupExpense(db.em(), partnerActor, group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares, transactionKey: dinner.transactionKey }))).toBe('403 account_read_only');
      await shareGroupExpense(db.em(), actorOf(household), group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares, transactionKey: dinner.transactionKey });
      // Shared with them, so it is in what they see.
      expect((await listGroupExpenses(db.em(), partnerActor, group.expenseGroupKey)).map((row) => row.transaction.transactionKey)).toEqual([dinner.transactionKey]);
      expect(await code(unshareGroupExpense(db.em(), partnerActor, group.expenseGroupKey, dinner.transactionKey))).toBe('403 account_read_only');
      expect(await code(recordGroupSettlement(db.em(), partnerActor, group.expenseGroupKey, { amount: 30, fromMemberKey: alice.expenseGroupMemberKey, settledOn: '2026-07-15', toMemberKey: you.expenseGroupMemberKey, transactionKey: payback.transactionKey }))).toBe('403 account_read_only');
      const settlement = await recordGroupSettlement(db.em(), actorOf(household), group.expenseGroupKey, { amount: 30, fromMemberKey: alice.expenseGroupMemberKey, settledOn: '2026-07-15', toMemberKey: you.expenseGroupMemberKey, transactionKey: payback.transactionKey });
      expect((await listGroupSettlements(db.em(), partnerActor, group.expenseGroupKey))[0]).toMatchObject({ transaction: { transactionKey: payback.transactionKey } });
      expect(await code(deleteGroupSettlement(db.em(), partnerActor, group.expenseGroupKey, settlement.expenseGroupSettlementKey))).toBe('403 account_read_only');
    });

    it('never reaches another household\'s group or transaction', async () => {
      const { alice, group, household, you } = await setup();
      const theirs = await seedHousehold(db.em());
      const theirTransaction = await addTransaction(db.em(), theirs, { amount: -40, date: JULY_10, status: 'BOOKED' });

      expect(await code(getExpenseGroup(db.em(), actorOf(theirs), group.expenseGroupKey))).toBe('404 not_found');
      expect(await code(getGroupBalances(db.em(), actorOf(theirs), group.expenseGroupKey))).toBe('404 not_found');
      expect(await code(recordGroupSettlement(db.em(), actorOf(theirs), group.expenseGroupKey, { amount: 5, fromMemberKey: alice.expenseGroupMemberKey, settledOn: '2026-07-15', toMemberKey: you.expenseGroupMemberKey }))).toBe('404 not_found');
      expect(await listExpenseGroups(db.em(), actorOf(theirs))).toEqual([]);
      expect(await code(shareGroupExpense(db.em(), actorOf(household), group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares: [{ memberKey: alice.expenseGroupMemberKey }], transactionKey: theirTransaction.transactionKey }))).toBe('404 not_found');
    });

    it('keeps an expense on a private account out of the partner\'s sight and balances', async () => {
      const { alice, group, household, you } = await setup();
      const partner = await addPartner(db.em(), household);
      const partnerActor = { appuserKey: partner.appuserKey, tenantKey: household.tenant.tenantKey };
      const privateAccount = await addAccount(db.em(), household, { isPrivate: true, name: 'Private' });
      const secret = await addTransaction(db.em(), household, { account: privateAccount, amount: -80, date: JULY_10, status: 'BOOKED' });
      const shared = await addTransaction(db.em(), household, { amount: -20, date: JULY_10, status: 'BOOKED' });
      const actor = actorOf(household);
      const shares = [{ memberKey: you.expenseGroupMemberKey }, { memberKey: alice.expenseGroupMemberKey }];
      await shareGroupExpense(db.em(), actor, group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares, transactionKey: secret.transactionKey });
      await shareGroupExpense(db.em(), actor, group.expenseGroupKey, { method: 'equal', paidByMemberKey: you.expenseGroupMemberKey, shares, transactionKey: shared.transactionKey });

      expect((await listGroupExpenses(db.em(), partnerActor, group.expenseGroupKey)).map((row) => row.transaction.transactionKey)).toEqual([shared.transactionKey]);
      expect(await balanceOf({ ...household, appuser: partner }, group.expenseGroupKey)).toMatchObject({ [alice.expenseGroupMemberKey]: -10, [you.expenseGroupMemberKey]: 10 });
      expect(await balanceOf(household, group.expenseGroupKey)).toMatchObject({ [alice.expenseGroupMemberKey]: -50, [you.expenseGroupMemberKey]: 50 });
      expect(await code(unshareGroupExpense(db.em(), partnerActor, group.expenseGroupKey, secret.transactionKey))).toBe('404 not_found');
      expect(await code(getGroupExpense(db.em(), partnerActor, group.expenseGroupKey, secret.transactionKey))).toBe('404 not_found');

      // A settlement linked to the private account shows no transaction to the partner, who cannot remove it.
      const secretPayback = await addTransaction(db.em(), household, { account: privateAccount, amount: 40, date: JULY_15, status: 'BOOKED' });
      const settlement = await recordGroupSettlement(db.em(), actor, group.expenseGroupKey, { amount: 40, fromMemberKey: alice.expenseGroupMemberKey, settledOn: '2026-07-15', toMemberKey: you.expenseGroupMemberKey, transactionKey: secretPayback.transactionKey });
      expect((await listGroupSettlements(db.em(), partnerActor, group.expenseGroupKey))[0]).toMatchObject({ isLinked: true, transaction: null });
      expect(await code(deleteGroupSettlement(db.em(), partnerActor, group.expenseGroupKey, settlement.expenseGroupSettlementKey))).toBe('404 not_found');
    });
  });
});
