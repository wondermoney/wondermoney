import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, addCategory, addPartner, addTransaction, currencyFor, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { ExchangeRate } from '@entity/ExchangeRate';
import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { FxStatus, Transaction } from '@entity/Transaction';
import { TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionSplit } from '@entity/TransactionSplit';
import accountRoutes from '@route/account';
import loanRoutes from '@route/loan';
import { reconvertFx } from '@service/currency/fx-reconvert.service';
import { LoanAllocationSource, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';

/*
 * A split shares one transaction's amount out over several categories. The lines always add up to
 * the transaction exactly; only members who can see the transaction can read or change its lines;
 * every change is in the transaction's history; and when the amount changes later the lines follow
 * it and the transaction goes back to the review inbox.
 */
describe('split transactions', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const accounts = tenantHttp('/v1/account', accountRoutes);
  const loans = tenantHttp('/v1/loan', loanRoutes);

  interface SplitDto { amount: number; appuserAmount: null | number; category: null | { categoryKey: number; name: string }; notes: null | string; position: number }
  interface Row { appuserTransactionCategories: { categoryKey: number; name: string }[]; reviewed: boolean; splits: SplitDto[]; transactionKey: number }
  interface Line { amount: number | string; categoryId: null | number; notes?: string }

  const putSplits = (user: Appuser, transactionKey: number, lines: Line[]) => accounts.as(user).put(`/v1/account/transaction/${transactionKey}/splits`).send(lines);
  const removeSplits = (user: Appuser, transactionKey: number) => accounts.as(user).delete(`/v1/account/transaction/${transactionKey}/splits`);

  async function listed(user: Appuser, query = ''): Promise<{ rows: Row[]; total: number }> {
    const response = await accounts.as(user).get(`/v1/account/transaction${query}`);
    expect(response.status).toBe(200);
    return { rows: (response.body.transactions as Row[]).filter((row) => row.transactionKey > 0), total: response.body.total as number };
  }

  async function rowOf(user: Appuser, transactionKey: number): Promise<Row | undefined> {
    return (await listed(user)).rows.find((row) => row.transactionKey === transactionKey);
  }

  const storedLines = (transactionKey: number) => db.em().find(TransactionSplit, { transactionKey: { transactionKey } }, { filters: false, orderBy: { transactionSplitKey: 'asc' } });

  /** Owner and partner share a household; the owner also has a private account. A neighbour lives next door. */
  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const privateAccount = await addAccount(em, owner, { isPrivate: true });
    const shopping = await addCategory(em, owner, 'Shopping');
    const groceries = await addCategory(em, owner, 'Groceries', shopping);
    const homeware = await addCategory(em, owner, 'Homeware', shopping);
    const charge = await addTransaction(em, owner, { amount: -100, category: groceries, date: new Date('2026-07-10T12:00:00Z'), status: 'BOOKED' });
    const secret = await addTransaction(em, owner, { account: privateAccount, amount: -80, category: groceries, date: new Date('2026-07-11T12:00:00Z'), status: 'BOOKED' });
    const neighbour = await seedHousehold(em);
    const theirCategory = await addCategory(em, neighbour, 'Theirs');
    return { charge, groceries, homeware, neighbour, owner, partner, secret, theirCategory };
  }

  describe('setting the lines', () => {
    it('splits a transaction into lines that sum to its amount and lists them on the row', async () => {
      const { charge, groceries, homeware, owner } = await households();

      const response = await putSplits(owner.appuser, charge.transactionKey, [
        { amount: -60, categoryId: groceries.categoryKey, notes: 'Food' },
        { amount: '-40', categoryId: homeware.categoryKey },
      ]);

      expect(response.status).toBe(200);
      expect(response.body.transaction.splits).toEqual([
        expect.objectContaining({ amount: -60, appuserAmount: -60, category: expect.objectContaining({ categoryKey: groceries.categoryKey }), notes: 'Food', position: 0 }),
        expect.objectContaining({ amount: -40, appuserAmount: -40, category: expect.objectContaining({ categoryKey: homeware.categoryKey }), notes: null, position: 1 }),
      ]);
      const row = await rowOf(owner.appuser, charge.transactionKey);
      expect(row?.splits.map((line) => [line.category?.name, line.amount, line.appuserAmount])).toEqual([['Groceries', -60, -60], ['Homeware', -40, -40]]);
    });

    it('keeps the largest line\'s category as the transaction\'s single category', async () => {
      const { charge, groceries, homeware, owner } = await households();

      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -30, categoryId: groceries.categoryKey }, { amount: -70, categoryId: homeware.categoryKey }]);

      const row = await rowOf(owner.appuser, charge.transactionKey);
      expect(row?.appuserTransactionCategories.map((category) => category.categoryKey)).toEqual([homeware.categoryKey]);
    });

    it('allows an uncategorized line', async () => {
      const { charge, groceries, owner } = await households();

      const response = await putSplits(owner.appuser, charge.transactionKey, [{ amount: -75, categoryId: groceries.categoryKey }, { amount: -25, categoryId: null }]);

      expect(response.status).toBe(200);
      expect((response.body.transaction.splits as SplitDto[]).map((line) => line.category)).toEqual([expect.objectContaining({ categoryKey: groceries.categoryKey }), null]);
    });

    it('replaces every line on a second call', async () => {
      const { charge, groceries, homeware, owner } = await households();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);

      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -10, categoryId: groceries.categoryKey }, { amount: -20, categoryId: homeware.categoryKey }, { amount: -70, categoryId: null }]);

      const row = await rowOf(owner.appuser, charge.transactionKey);
      expect(row?.splits.map((line) => line.amount)).toEqual([-10, -20, -70]);
      // The replaced lines are kept, soft-deleted.
      const stored = await storedLines(charge.transactionKey);
      expect(stored.filter((line) => line.deletedAt)).toHaveLength(2);
    });

    it('rejects lines that do not sum to the amount', async () => {
      const { charge, groceries, homeware, owner } = await households();

      const response = await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -39.99, categoryId: homeware.categoryKey }]);

      expect(response.status).toBe(400);
      expect(await storedLines(charge.transactionKey)).toEqual([]);
    });

    it('rejects a line with the other sign, even when the total matches', async () => {
      const { charge, groceries, homeware, owner } = await households();

      const response = await putSplits(owner.appuser, charge.transactionKey, [{ amount: -120, categoryId: groceries.categoryKey }, { amount: 20, categoryId: homeware.categoryKey }]);

      expect(response.status).toBe(400);
      expect(await storedLines(charge.transactionKey)).toEqual([]);
    });

    it('rejects a zero line', async () => {
      const { charge, groceries, homeware, owner } = await households();

      const response = await putSplits(owner.appuser, charge.transactionKey, [{ amount: -100, categoryId: groceries.categoryKey }, { amount: 0, categoryId: homeware.categoryKey }]);

      expect(response.status).toBe(400);
    });

    it('rejects a single line', async () => {
      const { charge, groceries, owner } = await households();

      const response = await putSplits(owner.appuser, charge.transactionKey, [{ amount: -100, categoryId: groceries.categoryKey }]);

      expect(response.status).toBe(400);
    });

    it('rejects an amount finer than the amount columns hold', async () => {
      const { charge, groceries, homeware, owner } = await households();

      const response = await putSplits(owner.appuser, charge.transactionKey, [{ amount: -33.33333, categoryId: groceries.categoryKey }, { amount: -66.66667, categoryId: homeware.categoryKey }]);

      expect(response.status).toBe(400);
    });

    it('checks the lines against an edited amount', async () => {
      const { charge, groceries, homeware, owner } = await households();
      expect((await accounts.as(owner.appuser).patch(`/v1/account/transaction/${charge.transactionKey}`).send({ updatedAmount: -80 })).status).toBe(200);

      const againstBank = await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);
      const againstEdit = await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -20, categoryId: homeware.categoryKey }]);

      expect(againstBank.status).toBe(400);
      expect(againstEdit.status).toBe(200);
    });

    it('rejects a category the household cannot assign', async () => {
      const { charge, groceries, owner, theirCategory } = await households();

      const response = await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: theirCategory.categoryKey }]);

      expect(response.status).toBe(404);
      expect(await storedLines(charge.transactionKey)).toEqual([]);
    });

    it('refuses to split a loan repayment, which already splits principal from interest', async () => {
      const { charge, groceries, homeware, owner } = await households();
      const em = db.em();
      const loan = em.create(Loan, { currencyKey: owner.currency, name: 'Car', openingBalanceDate: new Date('2026-01-01'), openingPrincipalBalance: 5000, ownerAppuserKey: owner.appuser, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, status: LoanStatus.ACTIVE, tenantKey: owner.tenant, type: LoanType.AUTO_LOAN }, { partial: true });
      em.create(LoanRepaymentLink, { allocationSource: LoanAllocationSource.MANUAL, feeAmount: 0, interestAmount: 10, linkedByAppuserKey: owner.appuser, loanKey: loan, paymentDate: new Date('2026-07-10'), principalAmount: 90, tenantKey: owner.tenant, totalPaymentAmount: 100, transactionKey: charge }, { partial: true });
      await em.flush();

      const response = await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);

      expect(response.status).toBe(409);
      expect(await storedLines(charge.transactionKey)).toEqual([]);
    });

    it('refuses to link a split transaction as a loan repayment', async () => {
      const { charge, groceries, homeware, owner } = await households();
      const em = db.em();
      const loan = em.create(Loan, { currencyKey: owner.currency, name: 'Car', openingBalanceDate: new Date('2026-01-01'), openingPrincipalBalance: 5000, ownerAppuserKey: owner.appuser, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, status: LoanStatus.ACTIVE, tenantKey: owner.tenant, type: LoanType.AUTO_LOAN }, { partial: true });
      await em.flush();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);

      const response = await loans.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/repayments/link?transactionKey=${charge.transactionKey}`).send({ feeAmount: 0, interestAmount: 10, principalAmount: 90, totalPaymentAmount: 100 });

      expect(response.status).toBe(409);
      expect(await db.em().count(LoanRepaymentLink, {}, { filters: false })).toBe(0);
    });
  });

  describe('who can split', () => {
    it('does not let another household read or change a transaction\'s lines', async () => {
      const { charge, groceries, homeware, neighbour, owner, theirCategory } = await households();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);

      const replace = await putSplits(neighbour.appuser, charge.transactionKey, [{ amount: -50, categoryId: theirCategory.categoryKey }, { amount: -50, categoryId: null }]);
      const remove = await removeSplits(neighbour.appuser, charge.transactionKey);

      expect(replace.status).toBe(404);
      expect(remove.status).toBe(404);
      expect((await storedLines(charge.transactionKey)).filter((line) => !line.deletedAt).map((line) => line.amount)).toEqual([-60, -40]);
    });

    it('lets the partner split a transaction on a shared account', async () => {
      const { charge, groceries, homeware, partner } = await households();

      const response = await putSplits(partner, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);

      expect(response.status).toBe(200);
    });

    it('does not let the partner split or unsplit a transaction on the owner\'s private account', async () => {
      const { groceries, homeware, owner, partner, secret } = await households();
      await putSplits(owner.appuser, secret.transactionKey, [{ amount: -50, categoryId: groceries.categoryKey }, { amount: -30, categoryId: homeware.categoryKey }]);

      const replace = await putSplits(partner, secret.transactionKey, [{ amount: -40, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);
      const remove = await removeSplits(partner, secret.transactionKey);

      expect(replace.status).toBe(404);
      expect(remove.status).toBe(404);
      expect((await storedLines(secret.transactionKey)).filter((line) => !line.deletedAt).map((line) => line.amount)).toEqual([-50, -30]);
    });

    it('never shows the partner the lines of the owner\'s private transactions', async () => {
      const { groceries, homeware, owner, partner, secret } = await households();
      await putSplits(owner.appuser, secret.transactionKey, [{ amount: -50, categoryId: groceries.categoryKey }, { amount: -30, categoryId: homeware.categoryKey }]);

      const asPartner = db.em();
      setTenantContext(asPartner, { appuserKey: partner.appuserKey, tenantKey: owner.tenant.tenantKey });
      const asOwner = db.em();
      setTenantContext(asOwner, { appuserKey: owner.appuser.appuserKey, tenantKey: owner.tenant.tenantKey });

      expect(await asPartner.count(TransactionSplit, {})).toBe(0);
      expect(await asOwner.count(TransactionSplit, {})).toBe(2);
    });
  });

  describe('removing a split', () => {
    it('restores a single category, the largest line\'s', async () => {
      const { charge, groceries, homeware, owner } = await households();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -35, categoryId: groceries.categoryKey }, { amount: -65, categoryId: homeware.categoryKey }]);

      const response = await removeSplits(owner.appuser, charge.transactionKey);

      expect(response.status).toBe(200);
      expect(response.body.transaction.splits).toEqual([]);
      const row = await rowOf(owner.appuser, charge.transactionKey);
      expect(row?.splits).toEqual([]);
      expect(row?.appuserTransactionCategories.map((category) => category.categoryKey)).toEqual([homeware.categoryKey]);
    });

    it('leaves the transaction uncategorized when the largest line was', async () => {
      const { charge, groceries, owner } = await households();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -35, categoryId: groceries.categoryKey }, { amount: -65, categoryId: null }]);

      await removeSplits(owner.appuser, charge.transactionKey);

      expect(await db.em().count(AppuserTransactionCategory, { transactionKey: { transactionKey: charge.transactionKey } }, { filters: false })).toBe(0);
    });

    it('drops the split when the user gives the whole transaction one category', async () => {
      const { charge, groceries, homeware, owner } = await households();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);

      const response = await accounts.as(owner.appuser).patch(`/v1/account/transaction/${charge.transactionKey}`).send({ categoryKey: String(homeware.categoryKey) });

      expect(response.status).toBe(200);
      const row = await rowOf(owner.appuser, charge.transactionKey);
      expect(row?.splits).toEqual([]);
      expect(row?.appuserTransactionCategories.map((category) => category.categoryKey)).toEqual([homeware.categoryKey]);
    });
  });

  describe('the transaction list', () => {
    it('matches a category filter on any line, counting the transaction once', async () => {
      const { charge, groceries, homeware, owner } = await households();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);

      const byMinorLine = await listed(owner.appuser, `?categoryKeys=${homeware.categoryKey}`);
      const byBoth = await listed(owner.appuser, `?categoryKeys=${groceries.categoryKey},${homeware.categoryKey}`);

      expect(byMinorLine.rows.map((row) => row.transactionKey)).toEqual([charge.transactionKey]);
      expect(byMinorLine.total).toBe(1);
      expect(byBoth.rows.filter((row) => row.transactionKey === charge.transactionKey)).toHaveLength(1);
    });

    it('does not match "uncategorized" for a split whose lines are all categorized, but does when a line is not', async () => {
      const { charge, groceries, homeware, owner } = await households();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);
      const categorized = await listed(owner.appuser, '?categoryKeys=__uncategorized__');

      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: null }]);
      const partly = await listed(owner.appuser, '?categoryKeys=__uncategorized__');

      expect(categorized.rows.map((row) => row.transactionKey)).not.toContain(charge.transactionKey);
      expect(partly.rows.map((row) => row.transactionKey)).toContain(charge.transactionKey);
    });
  });

  describe('history', () => {
    it('records creating, changing and removing a split', async () => {
      const { charge, groceries, homeware, owner } = await households();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -50, categoryId: groceries.categoryKey }, { amount: -50, categoryId: homeware.categoryKey }]);
      await removeSplits(owner.appuser, charge.transactionKey);

      const history = await accounts.as(owner.appuser).get(`/v1/account/transaction/${charge.transactionKey}/history`);

      const splitChanges = (history.body.history as { changes?: { splits?: { from: unknown[]; to: unknown[] } }; eventType: string }[])
        .filter((entry) => entry.changes?.splits)
        .reverse()
        .map((entry) => ({ eventType: entry.eventType, from: entry.changes!.splits!.from.length, to: entry.changes!.splits!.to.length }));
      expect(splitChanges).toEqual([
        { eventType: TransactionAuditEventType.USER_EDIT, from: 0, to: 2 },
        { eventType: TransactionAuditEventType.USER_EDIT, from: 2, to: 2 },
        { eventType: TransactionAuditEventType.USER_EDIT, from: 2, to: 0 },
      ]);
    });

    it('writes nothing when the same lines are sent again', async () => {
      const { charge, groceries, homeware, owner } = await households();
      const lines = [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }];
      await putSplits(owner.appuser, charge.transactionKey, lines);

      await putSplits(owner.appuser, charge.transactionKey, lines);

      const history = await accounts.as(owner.appuser).get(`/v1/account/transaction/${charge.transactionKey}/history`);
      expect((history.body.history as { changes?: { splits?: unknown } }[]).filter((entry) => entry.changes?.splits)).toHaveLength(1);
      expect((await storedLines(charge.transactionKey)).filter((line) => line.deletedAt)).toEqual([]);
    });
  });

  describe('when the amount changes', () => {
    it('rescales the lines pro rata, marks the transaction unreviewed and counts the amount once in the balance', async () => {
      const { charge, groceries, homeware, owner } = await households();
      const em = db.em();
      await em.nativeUpdate(Transaction, { transactionKey: charge.transactionKey }, { appuserCurrencyBalance: 900, balance: 900, reviewed: true });
      await em.nativeUpdate(Account, { accountKey: owner.account.accountKey }, { appuserCurrencyBalance: 900, balance: 900 });
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);

      const response = await accounts.as(owner.appuser).patch(`/v1/account/transaction/${charge.transactionKey}`).send({ updatedAmount: -50 });

      expect(response.status).toBe(200);
      const row = await rowOf(owner.appuser, charge.transactionKey);
      expect(row?.splits.map((line) => line.amount)).toEqual([-30, -20]);
      expect(row?.reviewed).toBe(false);
      const account = await db.em().findOneOrFail(Account, { accountKey: owner.account.accountKey }, { filters: false });
      const stored = await db.em().findOneOrFail(Transaction, { transactionKey: charge.transactionKey }, { filters: false });
      expect([account.balance, stored.balance]).toEqual([950, 950]);
    });

    it('rounds a rescaled line to cents, the largest line taking the remainder', async () => {
      const { charge, groceries, homeware, owner } = await households();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -33.33, categoryId: groceries.categoryKey }, { amount: -66.67, categoryId: homeware.categoryKey }]);

      await accounts.as(owner.appuser).patch(`/v1/account/transaction/${charge.transactionKey}`).send({ updatedAmount: -90.01 });

      const row = await rowOf(owner.appuser, charge.transactionKey);
      expect(row?.splits.map((line) => line.amount)).toEqual([-30, -60.01]);
    });

    it('rescales the lines of a hidden transaction too', async () => {
      const { charge, groceries, homeware, owner } = await households();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);
      await db.em().nativeUpdate(Transaction, { transactionKey: charge.transactionKey }, { hidden: true });

      await accounts.as(owner.appuser).patch(`/v1/account/transaction/${charge.transactionKey}`).send({ updatedAmount: -50 });

      expect((await storedLines(charge.transactionKey)).filter((line) => !line.deletedAt).map((line) => line.amount)).toEqual([-30, -20]);
      const hiddenRow = (await listed(owner.appuser, '?includeHidden=true')).rows.find((row) => row.transactionKey === charge.transactionKey);
      expect(hiddenRow?.splits.map((line) => line.amount)).toEqual([-30, -20]);
    });

    it('keeps a split whose amount did not change, and the review state with it', async () => {
      const { charge, groceries, homeware, owner } = await households();
      await db.em().nativeUpdate(Transaction, { transactionKey: charge.transactionKey }, { reviewed: true });
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);

      await accounts.as(owner.appuser).patch(`/v1/account/transaction/${charge.transactionKey}`).send({ updatedAmount: -100 });

      const row = await rowOf(owner.appuser, charge.transactionKey);
      expect(row?.splits.map((line) => line.amount)).toEqual([-60, -40]);
      expect(row?.reviewed).toBe(true);
    });

    it('removes the split when the amount drops to zero, keeping the largest line\'s category', async () => {
      const { charge, groceries, homeware, owner } = await households();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -60, categoryId: groceries.categoryKey }, { amount: -40, categoryId: homeware.categoryKey }]);

      await accounts.as(owner.appuser).patch(`/v1/account/transaction/${charge.transactionKey}`).send({ updatedAmount: 0 });

      const row = await rowOf(owner.appuser, charge.transactionKey);
      expect(row?.splits).toEqual([]);
      expect(row?.reviewed).toBe(false);
      expect(row?.appuserTransactionCategories.map((category) => category.categoryKey)).toEqual([groceries.categoryKey]);
    });
  });

  describe('in another currency', () => {
    async function dollarCharge() {
      const setup = await households();
      const em = db.em();
      const usd = await currencyFor(em, 'USD');
      const dollars = await addAccount(em, setup.owner, { currency: usd, name: 'Dollars' });
      const charge = await addTransaction(em, setup.owner, { account: dollars, amount: -50, date: new Date('2026-07-12T12:00:00Z'), status: 'BOOKED' });
      charge.settlementCurrencyKey = usd;
      charge.originalCurrencyKey = usd;
      charge.appuserSettlementAmount = null;
      charge.fxStatus = FxStatus.MISSING;
      await em.flush();
      return { ...setup, dollarCharge: charge, dollars, usd };
    }

    it('gives the lines no converted amount while the transaction has none', async () => {
      const { dollarCharge: charge, groceries, homeware, owner } = await dollarCharge();

      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -20, categoryId: groceries.categoryKey }, { amount: -30, categoryId: homeware.categoryKey }]);

      const row = await rowOf(owner.appuser, charge.transactionKey);
      expect(row?.splits.map((line) => line.appuserAmount)).toEqual([null, null]);
    });

    it('shares out the re-converted amount once a rate arrives, summing to it exactly', async () => {
      const { dollarCharge: charge, groceries, homeware, owner, usd } = await dollarCharge();
      await putSplits(owner.appuser, charge.transactionKey, [{ amount: -20, categoryId: groceries.categoryKey }, { amount: -30, categoryId: homeware.categoryKey }]);
      const em = db.em();
      em.create(ExchangeRate, { date: new Date('2026-07-12T00:00:00Z'), fromCurrency: usd, rate: 0.913578, toCurrency: owner.currency }, { partial: true });
      await em.flush();

      await reconvertFx(db.em(), { now: new Date('2026-07-12T13:00:00Z') });

      const stored = await db.em().findOneOrFail(Transaction, { transactionKey: charge.transactionKey }, { filters: false });
      expect(stored.appuserSettlementAmount).toBe(-45.6789);
      const row = await rowOf(owner.appuser, charge.transactionKey);
      expect(row?.splits.map((line) => line.appuserAmount)).toEqual([-18.2716, -27.4073]);
      expect(row?.splits.map((line) => line.amount)).toEqual([-20, -30]);
    });
  });
});
