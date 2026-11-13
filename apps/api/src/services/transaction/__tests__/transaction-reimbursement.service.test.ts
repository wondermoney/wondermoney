import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addMerchant, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import type { Category } from '@entity/Category';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionReimbursement } from '@entity/TransactionReimbursement';
import { getBudgetSpending } from '@service/budget/spending';
import { getCashflowReport } from '@service/reports/cashflow.service';
import { getSpendingByCategoryReport } from '@service/reports/spendingByCategory.service';
import { deleteTransactions } from '@service/transaction/transaction-deletion.service';
import { listTransactions } from '@service/transaction/transaction-list.service';
import { getTransactionReimbursements, linkReimbursement, suggestReimbursementCounterparts, unlinkReimbursement } from '@service/transaction/transaction-reimbursement.service';
import { reportFiltersSchema } from '@validators/reports';

/*
 * Linking a refund to the expense it offsets: the expense spends the linked amount less in its
 * category and the refund is that much less income, in every total, until the link goes (unlinked,
 * or either side deleted). Links never exceed either side, never cross households or currencies,
 * and never join a private transaction to one another member can see.
 */
describe('reimbursement links', () => {
  const db = useTestDatabase();
  const JULY_1 = new Date('2026-07-01T12:00:00Z');
  const JULY_10 = new Date('2026-07-10T12:00:00Z');
  const JULY_15 = new Date('2026-07-15T12:00:00Z');
  const SEPTEMBER_20 = new Date('2026-09-20T12:00:00Z');
  const RANGE = { fromDate: '2026-07-01T00:00:00Z', toDate: '2026-07-31T23:59:59Z' };

  const actorOf = (household: Household) => ({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });

  async function setup() {
    const em = db.em();
    const household = await seedHousehold(em);
    const shopping = await addCategory(em, household, 'Shopping');
    const groceries = await addCategory(em, household, 'Groceries', shopping);
    const homeware = await addCategory(em, household, 'Homeware', shopping);
    await addTransaction(em, household, { amount: 500, date: JULY_1, status: 'BOOKED' });
    return { groceries, homeware, household };
  }

  /** Category spending (the report), income and expenses (cash flow) and budget spending for July. */
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
    return { budget, byCategory, expenses: month?.expenses, income: month?.income };
  }

  async function code(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
      return undefined;
    } catch (error) {
      return `${(error as { status?: number }).status ?? '?'} ${(error as { code?: string }).code ?? ''}`.trim();
    }
  }

  describe('the effect on totals', () => {
    it('a 20 refund linked to a 50 expense makes category spending 30 and removes 20 from income', async () => {
      const { groceries, household } = await setup();
      const expense = await addTransaction(db.em(), household, { amount: -50, category: groceries, date: JULY_10, status: 'BOOKED' });
      const refund = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED' });
      expect(await totals(household, [groceries])).toEqual({ budget: { Groceries: 50 }, byCategory: { Groceries: 50 }, expenses: 50, income: 520 });

      await linkReimbursement(db.em(), actorOf(household), refund.transactionKey, { amount: 20, expenseTransactionKey: expense.transactionKey });

      expect(await totals(household, [groceries])).toEqual({ budget: { Groceries: 30 }, byCategory: { Groceries: 30 }, expenses: 30, income: 500 });
    });

    it('a full reimbursement leaves nothing spent and nothing earned', async () => {
      const { groceries, household } = await setup();
      const expense = await addTransaction(db.em(), household, { amount: -50, category: groceries, date: JULY_10, status: 'BOOKED' });
      const refund = await addTransaction(db.em(), household, { amount: 50, date: JULY_15, status: 'BOOKED' });

      await linkReimbursement(db.em(), actorOf(household), refund.transactionKey, { amount: 50, expenseTransactionKey: expense.transactionKey });

      expect(await totals(household, [groceries])).toEqual({ budget: { Groceries: 0 }, byCategory: { Groceries: 0 }, expenses: 0, income: 500 });
    });

    it('a partial reimbursement of a split expense comes off its lines pro rata', async () => {
      const { groceries, homeware, household } = await setup();
      const { setTransactionSplits } = await import('@service/transaction/transaction-split.service');
      const expense = await addTransaction(db.em(), household, { amount: -100, category: groceries, date: JULY_10, status: 'BOOKED' });
      await setTransactionSplits(db.em(), actorOf(household), expense.transactionKey, [{ amount: -60, categoryKey: groceries.categoryKey }, { amount: -40, categoryKey: homeware.categoryKey }]);
      const refund = await addTransaction(db.em(), household, { amount: 25, date: JULY_15, status: 'BOOKED' });

      await linkReimbursement(db.em(), actorOf(household), refund.transactionKey, { amount: 25, expenseTransactionKey: expense.transactionKey });

      expect(await totals(household, [groceries, homeware])).toEqual({ budget: { Groceries: 45, Homeware: 30 }, byCategory: { Groceries: 45, Homeware: 30 }, expenses: 75, income: 500 });
    });

    it('adds up several reimbursements on one expense, and one reimbursement over several expenses', async () => {
      const { groceries, homeware, household } = await setup();
      const actor = actorOf(household);
      const food = await addTransaction(db.em(), household, { amount: -50, category: groceries, date: JULY_10, status: 'BOOKED' });
      const lamp = await addTransaction(db.em(), household, { amount: -40, category: homeware, date: JULY_10, status: 'BOOKED' });
      const first = await addTransaction(db.em(), household, { amount: 10, date: JULY_15, status: 'BOOKED' });
      const second = await addTransaction(db.em(), household, { amount: 15, date: JULY_15, status: 'BOOKED' });
      const shared = await addTransaction(db.em(), household, { amount: 30, date: JULY_15, status: 'BOOKED' });

      await linkReimbursement(db.em(), actor, first.transactionKey, { amount: 10, expenseTransactionKey: food.transactionKey });
      await linkReimbursement(db.em(), actor, second.transactionKey, { amount: 15, expenseTransactionKey: food.transactionKey });
      await linkReimbursement(db.em(), actor, shared.transactionKey, { amount: 5, expenseTransactionKey: food.transactionKey });
      await linkReimbursement(db.em(), actor, shared.transactionKey, { amount: 25, expenseTransactionKey: lamp.transactionKey });

      expect(await totals(household, [groceries, homeware])).toEqual({ budget: { Groceries: 20, Homeware: 15 }, byCategory: { Groceries: 20, Homeware: 15 }, expenses: 35, income: 500 });
      expect(await getTransactionReimbursements(db.em(), actor, food.transactionKey)).toMatchObject({ linkedAmount: 30, remainingAmount: 20, role: 'expense' });
      expect(await getTransactionReimbursements(db.em(), actor, shared.transactionKey)).toMatchObject({ linkedAmount: 30, remainingAmount: 0, role: 'reimbursement' });
    });

    it('unlinking restores the original totals, and writes an audit entry on both sides', async () => {
      const { groceries, household } = await setup();
      const expense = await addTransaction(db.em(), household, { amount: -50, category: groceries, date: JULY_10, status: 'BOOKED' });
      const refund = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED' });
      const link = await linkReimbursement(db.em(), actorOf(household), refund.transactionKey, { amount: 20, expenseTransactionKey: expense.transactionKey });

      await unlinkReimbursement(db.em(), actorOf(household), expense.transactionKey, link.transactionReimbursementKey);

      expect(await totals(household, [groceries])).toEqual({ budget: { Groceries: 50 }, byCategory: { Groceries: 50 }, expenses: 50, income: 520 });
      const entries = await db.em().find(TransactionAuditLog, { source: { $in: ['transaction-reimbursement', 'transaction-reimbursement-remove'] } }, { filters: false });
      expect(entries.map((entry) => [entry.transactionKey.transactionKey, entry.source]).sort()).toEqual([
        [expense.transactionKey, 'transaction-reimbursement'],
        [expense.transactionKey, 'transaction-reimbursement-remove'],
        [refund.transactionKey, 'transaction-reimbursement'],
        [refund.transactionKey, 'transaction-reimbursement-remove'],
      ].sort());
      // Unlinked, the pair can be linked again.
      await expect(linkReimbursement(db.em(), actorOf(household), refund.transactionKey, { amount: 20, expenseTransactionKey: expense.transactionKey })).resolves.toMatchObject({ amount: 20 });
    });

    it.each(['expense', 'refund'] as const)('deleting the %s removes the link and the other side counts in full again', async (side) => {
      const { groceries, household } = await setup();
      const expense = await addTransaction(db.em(), household, { amount: -50, category: groceries, date: JULY_10, status: 'BOOKED' });
      const refund = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED' });
      await linkReimbursement(db.em(), actorOf(household), refund.transactionKey, { amount: 20, expenseTransactionKey: expense.transactionKey });

      const em = db.em();
      const doomed = await em.find(Transaction, { transactionKey: (side === 'expense' ? expense : refund).transactionKey }, { filters: false, populate: ['accountKey'] });
      await deleteTransactions(em, actorOf(household), doomed);

      expect(await totals(household, [groceries])).toEqual(side === 'expense'
        ? { budget: { Groceries: 0 }, byCategory: {}, expenses: 0, income: 520 }
        : { budget: { Groceries: 50 }, byCategory: { Groceries: 50 }, expenses: 50, income: 500 });
      expect(await db.em().count(TransactionReimbursement, { deletedAt: null }, { filters: false })).toBe(0);
    });

    it('stops counting a link once its sides are no longer seen by the same members', async () => {
      const { groceries, household } = await setup();
      const expense = await addTransaction(db.em(), household, { amount: -50, category: groceries, date: JULY_10, status: 'BOOKED' });
      const refund = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED' });
      await linkReimbursement(db.em(), actorOf(household), refund.transactionKey, { amount: 20, expenseTransactionKey: expense.transactionKey });
      const second = await addAccount(db.em(), household, { isPrivate: true, name: 'Private' });
      const em = db.em();
      const moved = await em.findOneOrFail(Transaction, { transactionKey: refund.transactionKey }, { filters: false });
      moved.accountKey = await em.findOneOrFail(Account, { accountKey: second.accountKey }, { filters: false });
      await em.flush();

      expect(await totals(household, [groceries])).toEqual({ budget: { Groceries: 50 }, byCategory: { Groceries: 50 }, expenses: 50, income: 520 });
    });
  });

  describe('what can be linked', () => {
    it('never more than is left on the expense or on the reimbursement', async () => {
      const { groceries, household } = await setup();
      const actor = actorOf(household);
      const expense = await addTransaction(db.em(), household, { amount: -50, category: groceries, date: JULY_10, status: 'BOOKED' });
      const small = await addTransaction(db.em(), household, { amount: -10, category: groceries, date: JULY_10, status: 'BOOKED' });
      const refund = await addTransaction(db.em(), household, { amount: 40, date: JULY_15, status: 'BOOKED' });
      const other = await addTransaction(db.em(), household, { amount: 30, date: JULY_15, status: 'BOOKED' });

      expect(await code(linkReimbursement(db.em(), actor, refund.transactionKey, { amount: 15, expenseTransactionKey: small.transactionKey }))).toBe('400 reimbursement_amount_exceeded');
      expect(await code(linkReimbursement(db.em(), actor, refund.transactionKey, { amount: 45, expenseTransactionKey: expense.transactionKey }))).toBe('400 reimbursement_amount_exceeded');
      await linkReimbursement(db.em(), actor, refund.transactionKey, { amount: 30, expenseTransactionKey: expense.transactionKey });
      // 10 left on the refund, 20 on the expense.
      expect(await code(linkReimbursement(db.em(), actor, refund.transactionKey, { amount: 10.01, expenseTransactionKey: small.transactionKey }))).toBe('400 reimbursement_amount_exceeded');
      expect(await code(linkReimbursement(db.em(), actor, other.transactionKey, { amount: 20.01, expenseTransactionKey: expense.transactionKey }))).toBe('400 reimbursement_amount_exceeded');
      await linkReimbursement(db.em(), actor, refund.transactionKey, { amount: 10, expenseTransactionKey: small.transactionKey });
      await linkReimbursement(db.em(), actor, other.transactionKey, { amount: 20, expenseTransactionKey: expense.transactionKey });

      // 10 of the second refund is linked to nothing: it is still income.
      expect(await totals(household)).toMatchObject({ byCategory: { Groceries: 0 }, income: 510 });
    });

    it('refuses an expense in another currency', async () => {
      const { groceries, household } = await setup();
      const dollars = await addAccount(db.em(), household, { currency: await currencyFor(db.em(), 'USD'), name: 'Dollars' });
      const expense = await addTransaction(db.em(), household, { account: dollars, amount: -50, category: groceries, currency: await currencyFor(db.em(), 'USD'), date: JULY_10, status: 'BOOKED' });
      const refund = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED' });

      expect(await code(linkReimbursement(db.em(), actorOf(household), refund.transactionKey, { amount: 20, expenseTransactionKey: expense.transactionKey }))).toBe('400 reimbursement_currency_mismatch');
    });

    it('refuses a transaction of another household', async () => {
      const { household } = await setup();
      const theirs = await seedHousehold(db.em());
      const expense = await addTransaction(db.em(), theirs, { amount: -50, date: JULY_10, status: 'BOOKED' });
      const refund = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED' });

      expect(await code(linkReimbursement(db.em(), actorOf(household), refund.transactionKey, { amount: 20, expenseTransactionKey: expense.transactionKey }))).toBe('404 not_found');
      expect(await code(linkReimbursement(db.em(), actorOf(theirs), refund.transactionKey, { amount: 20, expenseTransactionKey: expense.transactionKey }))).toBe('404 not_found');
    });

    it('never reaches or reveals a partner\'s private-account transaction', async () => {
      const { household } = await setup();
      const partner = await addPartner(db.em(), household);
      const privateAccount = await addAccount(db.em(), household, { isPrivate: true, name: 'Private' });
      const secret = await addTransaction(db.em(), household, { account: privateAccount, amount: -50, date: JULY_10, status: 'BOOKED' });
      const secretRefund = await addTransaction(db.em(), household, { account: privateAccount, amount: 20, date: JULY_15, status: 'BOOKED' });
      const shared = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED' });
      const partnerActor = { appuserKey: partner.appuserKey, tenantKey: household.tenant.tenantKey };

      expect(await code(linkReimbursement(db.em(), partnerActor, shared.transactionKey, { amount: 20, expenseTransactionKey: secret.transactionKey }))).toBe('404 not_found');
      expect(await code(getTransactionReimbursements(db.em(), partnerActor, secret.transactionKey))).toBe('404 not_found');
      // The owner may not join a private payment to a refund their partner sees.
      expect(await code(linkReimbursement(db.em(), actorOf(household), shared.transactionKey, { amount: 20, expenseTransactionKey: secret.transactionKey }))).toBe('400 reimbursement_visibility_mismatch');
      // Both on the owner's private account is fine, and stays out of the partner's sight.
      const link = await linkReimbursement(db.em(), actorOf(household), secretRefund.transactionKey, { amount: 20, expenseTransactionKey: secret.transactionKey });
      expect(await code(unlinkReimbursement(db.em(), partnerActor, secret.transactionKey, link.transactionReimbursementKey))).toBe('404 not_found');
      expect((await suggestReimbursementCounterparts(db.em(), partnerActor, shared.transactionKey, { limit: 10 })).map((row) => row.transactionKey)).not.toContain(secret.transactionKey);
    });

    it('refuses the wrong directions, transfers and a second link of the same pair', async () => {
      const { household } = await setup();
      const actor = actorOf(household);
      const expense = await addTransaction(db.em(), household, { amount: -50, date: JULY_10, status: 'BOOKED' });
      const otherExpense = await addTransaction(db.em(), household, { amount: -20, date: JULY_10, status: 'BOOKED' });
      const refund = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED' });
      const { TransactionType } = await import('@entity/TransactionType');
      const transferType = (await db.em().findOne(TransactionType, { name: 'TRANSFER_IN' })) ?? db.em().create(TransactionType, { displayName: 'Transfer in', name: 'TRANSFER_IN' }, { partial: true });
      await db.em().flush();
      const transferIn = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED', type: transferType });

      expect(await code(linkReimbursement(db.em(), actor, otherExpense.transactionKey, { amount: 10, expenseTransactionKey: expense.transactionKey }))).toBe('400 reimbursement_invalid');
      expect(await code(linkReimbursement(db.em(), actor, refund.transactionKey, { amount: 10, expenseTransactionKey: refund.transactionKey }))).toBe('400 reimbursement_invalid');
      expect(await code(linkReimbursement(db.em(), actor, transferIn.transactionKey, { amount: 10, expenseTransactionKey: expense.transactionKey }))).toBe('400 reimbursement_invalid');
      expect(await code(linkReimbursement(db.em(), actor, refund.transactionKey, { amount: 0.00001, expenseTransactionKey: expense.transactionKey }))).toBe('400 reimbursement_invalid');
      await linkReimbursement(db.em(), actor, refund.transactionKey, { amount: 10, expenseTransactionKey: expense.transactionKey });
      expect(await code(linkReimbursement(db.em(), actor, refund.transactionKey, { amount: 5, expenseTransactionKey: expense.transactionKey }))).toBe('409 reimbursement_link_exists');
    });
  });

  describe('suggestions', () => {
    it('offers the expenses of the 60 days before a refund, from its merchant or for at least its amount, in its currency', async () => {
      const { household } = await setup();
      const shop = await addMerchant(db.em(), household, 'Corner shop');
      const dollars = await addAccount(db.em(), household, { currency: await currencyFor(db.em(), 'USD'), name: 'Dollars' });
      const refund = await addTransaction(db.em(), household, { amount: 30, date: SEPTEMBER_20, merchant: shop, status: 'BOOKED' });
      const sameMerchantSmall = await addTransaction(db.em(), household, { amount: -10, date: new Date('2026-09-01T12:00:00Z'), merchant: shop, status: 'BOOKED' });
      const largeEnough = await addTransaction(db.em(), household, { amount: -40, date: new Date('2026-08-10T12:00:00Z'), status: 'BOOKED' });
      const tooSmall = await addTransaction(db.em(), household, { amount: -20, date: new Date('2026-09-10T12:00:00Z'), status: 'BOOKED' });
      const tooOld = await addTransaction(db.em(), household, { amount: -40, date: JULY_10, status: 'BOOKED' });
      const after = await addTransaction(db.em(), household, { amount: -40, date: new Date('2026-09-25T12:00:00Z'), status: 'BOOKED' });
      const inDollars = await addTransaction(db.em(), household, { account: dollars, amount: -40, currency: await currencyFor(db.em(), 'USD'), date: new Date('2026-09-10T12:00:00Z'), status: 'BOOKED' });

      const suggestions = await suggestReimbursementCounterparts(db.em(), actorOf(household), refund.transactionKey, { limit: 10 });

      expect(suggestions.map((row) => [row.transactionKey, row.reason])).toEqual([[sameMerchantSmall.transactionKey, 'merchant'], [largeEnough.transactionKey, 'amount']]);
      for (const left of [tooSmall, tooOld, after, inDollars]) expect(suggestions.map((row) => row.transactionKey)).not.toContain(left.transactionKey);
      const searched = await suggestReimbursementCounterparts(db.em(), actorOf(household), refund.transactionKey, { limit: 10, search: tooOld.description ?? '' });
      expect(searched.map((row) => [row.transactionKey, row.reason])).toEqual([[tooOld.transactionKey, 'search']]);
    });

    it('offers the incoming transactions of the 60 days after an expense, for no more than it, with something left to link', async () => {
      const { household } = await setup();
      const actor = actorOf(household);
      const expense = await addTransaction(db.em(), household, { amount: -50, date: JULY_10, status: 'BOOKED' });
      const refund = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED' });
      const tooLarge = await addTransaction(db.em(), household, { amount: 60, date: JULY_15, status: 'BOOKED' });
      const spent = await addTransaction(db.em(), household, { amount: 5, date: JULY_15, status: 'BOOKED' });
      const elsewhere = await addTransaction(db.em(), household, { amount: -5, date: JULY_10, status: 'BOOKED' });
      await linkReimbursement(db.em(), actor, spent.transactionKey, { amount: 5, expenseTransactionKey: elsewhere.transactionKey });

      const suggestions = await suggestReimbursementCounterparts(db.em(), actor, expense.transactionKey, { limit: 10 });

      expect(suggestions.map((row) => row.transactionKey)).toEqual([refund.transactionKey]);
      expect(suggestions[0]).toMatchObject({ remainingAmount: 20, settlementAmount: 20 });
      expect(tooLarge.transactionKey).toBeGreaterThan(0);
    });
  });

  it('shows the link on both rows of the transaction list', async () => {
    const { groceries, household } = await setup();
    const partner = await addPartner(db.em(), household);
    const expense = await addTransaction(db.em(), household, { amount: -50, category: groceries, date: JULY_10, status: 'BOOKED' });
    const refund = await addTransaction(db.em(), household, { amount: 20, date: JULY_15, status: 'BOOKED' });
    const link = await linkReimbursement(db.em(), actorOf(household), refund.transactionKey, { amount: 20, expenseTransactionKey: expense.transactionKey });

    for (const viewer of [household.appuser.appuserKey, partner.appuserKey]) {
      const page = await listTransactions({ filters: {}, limit: 50, scope: 'all-accounts', tenantKey: household.tenant.tenantKey, viewerAppuserKey: viewer });
      const rows = new Map(page.transactions.map((row) => [row.transactionKey, row as { reimbursements?: { amount: number; expense: { transactionKey: number }; reimbursement: { transactionKey: number }; transactionReimbursementKey: number }[] }]));
      for (const side of [expense, refund]) {
        expect(rows.get(side.transactionKey)?.reimbursements).toEqual([expect.objectContaining({ amount: 20, expense: expect.objectContaining({ transactionKey: expense.transactionKey }), reimbursement: expect.objectContaining({ transactionKey: refund.transactionKey }), transactionReimbursementKey: link.transactionReimbursementKey })]);
      }
    }
  });
});
