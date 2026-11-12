import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
// Follow-up jobs after a commit; they have no bearing on the stored rows.
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, addCategory, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import { ConflictError, NotFoundError } from '@utils/errors';

import { TransactionImportService } from '../transaction-import.service';

import { actualBudget, actualFile } from './actual-import-helpers';
import { ynabStorage } from './ynab-import-helpers';

/*
 * Actual Budget imports through the staged session: an Actual export is told apart by its columns
 * even when uploaded as a statement, each of its accounts is mapped to an account the person has
 * or a new manual one, both sides of a transfer are written and linked by transfer matching, a
 * split is one transaction for its total with its parts in the notes, and its categories map to
 * the household's by name or by the person's choice.
 */
describe('staged Actual Budget import', () => {
  const db = useTestDatabase();
  let household: Household;

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    for (const name of ['DEPOSIT', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT']) em.create(TransactionType, { displayName: name, name }, { partial: true });
    await em.flush();
  });

  const ownerScope = () => ({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });

  function setup() {
    const ctx = ynabStorage();
    const service = () => new TransactionImportService(DI.em.fork(), { enqueue: ctx.enqueue, storage: ctx.storage });
    const runLastJob = () => {
      const job = ctx.sent.at(-1);
      if (!job) throw new Error('no job queued');
      return service().run(job.data.correlationId, `job-${ctx.sent.length}`, job.data.mode);
    };
    return { ...ctx, runLastJob, service };
  }

  async function staged(ctx: ReturnType<typeof setup>, content: string, format: 'actual' | 'statement' = 'actual') {
    const key = ctx.upload(household.account, content);
    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, fileName: 'transactions.csv', format, key });
    await ctx.runLastJob();
    return ctx.service().get(ownerScope(), created.id, { pageSize: 200 });
  }

  async function commitAndRun(ctx: ReturnType<typeof setup>, id: string) {
    await ctx.service().commit(ownerScope(), id);
    return ctx.runLastJob();
  }

  async function storedTransactions(account: Account) {
    const rows = await db.em().find(Transaction, { accountKey: account }, { filters: false, orderBy: { transactionDate: 'ASC', transactionKey: 'ASC' }, populate: ['transactionMerchantKey', 'transactionTypeKey'] });
    const categories = await db.em().find(AppuserTransactionCategory, { transactionKey: { transactionKey: { $in: rows.map((row) => row.transactionKey) } } }, { populate: ['categoryKey'] });
    const categoryOf = new Map(categories.map((assignment) => [assignment.transactionKey.transactionKey, assignment.categoryKey.name]));
    return rows.map((row) => ({
      amount: row.settlementAmount,
      category: categoryOf.get(row.transactionKey) ?? null,
      counterpart: row.transferCounterpartKey?.transactionKey ?? null,
      date: row.transactionDate?.toISOString().slice(0, 10),
      description: row.descriptionDirty,
      key: row.transactionKey,
      merchant: row.transactionMerchantKey?.name,
      notes: row.notes ?? null,
      type: row.transactionTypeKey?.name,
    }));
  }

  const accountNamed = (name: string) => db.em().findOneOrFail(Account, { accountName: name, tenantKey: household.tenant }, { filters: false, populate: ['currencyKey'] });

  it('reads an Actual export uploaded as a statement with the Actual reader, and lists both accounts for mapping', async () => {
    const ctx = setup();
    const savings = await addAccount(db.em(), household, { name: 'savings' });

    const view = await staged(ctx, actualBudget(), 'statement');

    expect(view.session.format).toBe('actual');
    expect(view.session.status).toBe('needs_mapping');
    expect(view.session.counts).toMatchObject({ invalid: 0, new: 7 });
    expect(view.session.sourceAccounts).toEqual([
      { label: 'Checking', rowCount: 5 },
      { label: 'Savings', rowCount: 2, suggestedAccountId: savings.accountKey },
    ]);
    await expect(ctx.service().commit(ownerScope(), view.session.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('imports two accounts, the transfer between them linked, and the split as one transaction with its parts in the notes', async () => {
    const ctx = setup();
    const view = await staged(ctx, actualBudget());

    const mapped = await ctx.service().setAccountMapping(ownerScope(), view.session.id, { Checking: household.account.accountKey }, { create: ['Savings'] });
    expect(mapped.status).toBe('ready');
    const savingsAccount = await accountNamed('Savings');
    expect(Number(savingsAccount.balance)).toBe(2400);

    await commitAndRun(ctx, view.session.id);

    expect((await ctx.service().get(ownerScope(), view.session.id, {})).session).toMatchObject({ counts: { failed: 0, imported: 7 }, status: 'succeeded' });
    const checking = await storedTransactions(household.account);
    const savings = await storedTransactions(savingsAccount);
    expect(checking.map(({ amount, date, description, merchant, notes, type }) => ({ amount, date, description, merchant, notes, type }))).toEqual([
      { amount: -42.5, date: '2026-01-15', description: 'Corner Grocer', merchant: 'Corner Grocer', notes: null, type: 'PAYMENT' },
      { amount: -62.5, date: '2026-01-20', description: 'Weekly shop', merchant: 'Corner Market', notes: 'Groceries -50.00; Household -12.50 (Batteries)', type: 'PAYMENT' },
      { amount: -1234.56, date: '2026-01-25', description: 'City Power', merchant: 'City Power', notes: null, type: 'PAYMENT' },
      { amount: 1500, date: '2026-01-31', description: 'January salary', merchant: 'Example Employer', notes: null, type: 'DEPOSIT' },
      { amount: -400, date: '2026-02-03', description: 'Monthly saving', merchant: 'Savings', notes: null, type: 'TRANSFER_OUT' },
    ]);
    expect(savings.map(({ amount, type }) => ({ amount, type }))).toEqual([{ amount: 2000, type: 'DEPOSIT' }, { amount: 400, type: 'TRANSFER_IN' }]);
    const out = checking.find((row) => row.amount === -400);
    const into = savings.find((row) => row.amount === 400);
    expect([out?.counterpart, into?.counterpart]).toEqual([into?.key, out?.key]);
    expect(out?.counterpart).toEqual(expect.any(Number));
  });

  it('maps categories by name, takes the person\'s choices, and leaves the rest uncategorised', async () => {
    const ctx = setup();
    const groceries = await addCategory(db.em(), household, 'groceries');
    const utilities = await addCategory(db.em(), household, 'Utilities');
    await addCategory(db.em(), household, 'Income');
    const view = await staged(ctx, actualBudget());

    expect(view.session.sourceCategories).toEqual([
      { label: 'Income', name: 'Income', rowCount: 1, suggestedCategoryId: expect.any(Number) },
      { label: 'Electricity', name: 'Electricity', rowCount: 1 },
      { label: 'Groceries', name: 'Groceries', rowCount: 1, suggestedCategoryId: groceries.categoryKey },
      { label: 'Starting Balances', name: 'Starting Balances', rowCount: 1 },
    ]);

    // Electricity is the person's to choose; Income they leave uncategorised although it matched.
    await ctx.service().setCategoryMapping(ownerScope(), view.session.id, { Electricity: utilities.categoryKey, Income: null });
    await ctx.service().setAccountMapping(ownerScope(), view.session.id, { Checking: household.account.accountKey }, { create: ['Savings'] });
    await commitAndRun(ctx, view.session.id);

    expect((await storedTransactions(household.account)).map(({ amount, category }) => ({ amount, category }))).toEqual([
      { amount: -42.5, category: 'groceries' },
      { amount: -62.5, category: null },
      { amount: -1234.56, category: 'Utilities' },
      { amount: 1500, category: null },
      { amount: -400, category: null },
    ]);
    expect((await storedTransactions(await accountNamed('Savings'))).map((row) => row.category)).toEqual([null, null]);
  });

  it('marks every row of a re-imported export as a duplicate', async () => {
    const ctx = setup();
    const first = await staged(ctx, actualBudget());
    await ctx.service().setAccountMapping(ownerScope(), first.session.id, { Checking: household.account.accountKey }, { create: ['Savings'] });
    await commitAndRun(ctx, first.session.id);
    const mapping = { Checking: household.account.accountKey, Savings: (await accountNamed('Savings')).accountKey };

    const second = await staged(ctx, actualBudget());
    const mapped = await ctx.service().setAccountMapping(ownerScope(), second.session.id, mapping);

    expect(mapped.counts).toMatchObject({ duplicate: 7, new: 0, possible_duplicate: 0 });
    expect(mapped.decisions).toEqual({ import: 0, skip: 7 });
  });

  it('is the starter\'s alone: their partner and another household cannot read, map or commit it', async () => {
    const ctx = setup();
    const partner = await addPartner(db.em(), household);
    const neighbour = await seedHousehold(db.em());
    const view = await staged(ctx, actualBudget());

    for (const scope of [{ appuserKey: partner.appuserKey, tenantKey: household.tenant.tenantKey }, { appuserKey: neighbour.appuser.appuserKey, tenantKey: neighbour.tenant.tenantKey }]) {
      await expect(ctx.service().get(scope, view.session.id, {})).rejects.toBeInstanceOf(NotFoundError);
      await expect(ctx.service().setAccountMapping(scope, view.session.id, {}, { create: ['Savings'] })).rejects.toBeInstanceOf(NotFoundError);
      await expect(ctx.service().setCategoryMapping(scope, view.session.id, { Income: null })).rejects.toBeInstanceOf(NotFoundError);
      await expect(ctx.service().commit(scope, view.session.id)).rejects.toBeInstanceOf(NotFoundError);
    }
    // Nor can the starter send a file account into another household's account.
    await expect(ctx.service().setAccountMapping(ownerScope(), view.session.id, { Checking: household.account.accountKey, Savings: neighbour.account.accountKey })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.em().count(Account, { accountName: 'Savings' }, { filters: false })).toBe(0);
  });

  it('imports a one-account export in one step into the account it was started on', async () => {
    const ctx = setup();
    const groceries = await addCategory(db.em(), household, 'Groceries');
    const file = actualFile([
      { account: 'Joint', amount: '-42.5', category: 'Groceries', date: '2026-01-15', payee: 'Corner Grocer' },
      { account: 'Joint', amount: '0', date: '2026-01-20', notes: '(SPLIT INTO 2) ', payee: 'Corner Market', splitAmount: '-30' },
      { account: 'Joint', amount: '-20', category: 'Groceries', date: '2026-01-20', notes: '(SPLIT 1 OF 2) ', payee: 'Corner Market' },
      { account: 'Joint', amount: '-10', category: 'Groceries', date: '2026-01-20', notes: '(SPLIT 2 OF 2) ', payee: 'Corner Market' },
    ]);
    const key = ctx.upload(household.account, file);

    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, autoCommit: true, format: 'actual', key });
    await ctx.runLastJob();

    expect((await ctx.service().get(ownerScope(), created.id, {})).session.status).toBe('succeeded');
    expect((await storedTransactions(household.account)).map(({ amount, category, notes }) => ({ amount, category, notes }))).toEqual([
      { amount: -42.5, category: groceries.name, notes: null },
      { amount: -30, category: groceries.name, notes: 'Groceries -20.00; Groceries -10.00' },
    ]);
  });
});
