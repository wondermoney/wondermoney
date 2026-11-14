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
import { Category } from '@entity/Category';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';

import { TransactionImportService } from '../transaction-import.service';

import { ynabFile, ynabStorage } from './ynab-import-helpers';

/*
 * YNAB register imports through the staged session: a YNAB export is told apart by its columns
 * even when uploaded as a statement, every one of its accounts is listed for mapping (to an account
 * the person has, or a new manual account), both sides of a transfer between two imported accounts
 * are written and linked by transfer matching, and its categories map to the household's by name
 * or by the person's choice, the rest staying uncategorised.
 */
describe('staged YNAB import', () => {
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

  async function staged(ctx: ReturnType<typeof setup>, content: string, format: 'statement' | 'ynab' = 'ynab') {
    const key = ctx.upload(household.account, content);
    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, fileName: 'My Budget as of 2026-02-04 - Register.csv', format, key });
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
      key: row.transactionKey,
      merchant: row.transactionMerchantKey?.name,
      type: row.transactionTypeKey?.name,
    }));
  }

  const accountNamed = (name: string) => db.em().findOneOrFail(Account, { accountName: name, tenantKey: household.tenant }, { filters: false, populate: ['currencyKey'] });

  /** Checking and Savings with a transfer between them, a card, three categories and an income row. */
  const budget = () =>
    ynabFile('web', [
      { account: 'Checking', category: ['Everyday Expenses', 'Groceries'], date: '01/15/2026', memo: 'Weekly shop', outflow: '$42.50', payee: 'Corner Grocer' },
      { account: 'Checking', category: ['Inflow', 'Ready to Assign'], date: '01/31/2026', inflow: '$1,500.00', payee: 'Example Employer' },
      { account: 'Checking', date: '02/03/2026', outflow: '$400.00', payee: 'Transfer : Savings' },
      { account: 'Checking', category: ['Bills', 'Electricity'], date: '01/25/2026', outflow: '$1,234.56', payee: 'City Power' },
      { account: 'Savings', category: ['Inflow', 'Ready to Assign'], date: '01/01/2026', inflow: '$2,000.00', payee: 'Starting Balance' },
      { account: 'Savings', date: '02/03/2026', inflow: '$400.00', payee: 'Transfer : Checking' },
      { account: 'Credit Card', category: ['Fun', 'Dining Out'], date: '01/20/2026', outflow: '$18.75', payee: 'Main Street Cafe' },
    ]);

  it('reads a YNAB export uploaded as a statement with the YNAB reader, and keeps the file name', async () => {
    const ctx = setup();

    const view = await staged(ctx, budget(), 'statement');

    expect(view.session.format).toBe('ynab');
    expect(view.session.fileName).toBe('My Budget as of 2026-02-04 - Register.csv');
    expect(view.session.counts).toMatchObject({ invalid: 0, new: 7 });
  });

  it('lists every YNAB account for mapping, suggesting the account of the same name', async () => {
    const ctx = setup();
    const checking = await addAccount(db.em(), household, { name: 'CHECKING' });

    const view = await staged(ctx, budget());

    expect(view.session.status).toBe('needs_mapping');
    expect(view.session.sourceAccounts).toEqual([
      { label: 'Checking', rowCount: 4, suggestedAccountId: checking.accountKey },
      { label: 'Savings', rowCount: 2 },
      { label: 'Credit Card', rowCount: 1 },
    ]);
    await expect(ctx.service().commit(ownerScope(), view.session.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('creates a manual account for each YNAB account the person asks, opening at the balance the file ends on', async () => {
    const ctx = setup();
    const view = await staged(ctx, budget());

    const mapped = await ctx.service().setAccountMapping(ownerScope(), view.session.id, { Checking: household.account.accountKey }, { create: ['Savings', 'Credit Card'] });

    expect(mapped.status).toBe('ready');
    const savings = await accountNamed('Savings');
    const card = await accountNamed('Credit Card');
    expect(mapped.accountMapping).toEqual({ 'Checking': household.account.accountKey, 'Credit Card': card.accountKey, 'Savings': savings.accountKey });
    for (const account of [savings, card]) {
      expect(account.accountOwnerAppuserKey?.appuserKey).toBe(household.appuser.appuserKey);
      expect(account.currencyKey.code).toBe('EUR');
      expect(account.enableBankingConnectionKey ?? null).toBeNull();
    }
    expect([savings.balance, card.balance].map(Number)).toEqual([2400, -18.75]);

    await commitAndRun(ctx, view.session.id);

    expect((await storedTransactions(card)).map((row) => ({ amount: row.amount, merchant: row.merchant, type: row.type }))).toEqual([{ amount: -18.75, merchant: 'Main Street Cafe', type: 'PAYMENT' }]);
    const reloaded = await db.em().findOneOrFail(Account, { accountKey: savings.accountKey }, { filters: false });
    expect(Number(reloaded.balance)).toBe(2400);
    expect(Number(reloaded.openingBalance)).toBe(0);
  });

  it('refuses to create an account for a label the file does not have, or one already mapped', async () => {
    const ctx = setup();
    const view = await staged(ctx, budget());

    await expect(ctx.service().setAccountMapping(ownerScope(), view.session.id, {}, { create: ['Brokerage'] })).rejects.toBeInstanceOf(BadRequestError);
    await expect(ctx.service().setAccountMapping(ownerScope(), view.session.id, { Savings: household.account.accountKey }, { create: ['Savings'] })).rejects.toBeInstanceOf(BadRequestError);
    expect(await db.em().count(Account, { tenantKey: household.tenant }, { filters: false })).toBe(1);
  });

  it('writes both sides of a transfer between two imported accounts, and transfer matching links them', async () => {
    const ctx = setup();
    const view = await staged(ctx, budget());
    await ctx.service().setAccountMapping(ownerScope(), view.session.id, { Checking: household.account.accountKey }, { create: ['Savings', 'Credit Card'] });

    await commitAndRun(ctx, view.session.id);

    const checking = await storedTransactions(household.account);
    const savings = await storedTransactions(await accountNamed('Savings'));
    const out = checking.find((row) => row.amount === -400)!;
    const into = savings.find((row) => row.amount === 400)!;
    expect({ counterpart: out.counterpart, type: out.type }).toEqual({ counterpart: into.key, type: 'TRANSFER_OUT' });
    expect({ counterpart: into.counterpart, type: into.type }).toEqual({ counterpart: out.key, type: 'TRANSFER_IN' });
  });

  it('maps categories by name, takes the person\'s choices, and leaves the rest and Ready to Assign uncategorised income', async () => {
    const ctx = setup();
    const groceries = await addCategory(db.em(), household, 'Groceries');
    const utilities = await addCategory(db.em(), household, 'Utilities');
    await addCategory(db.em(), household, 'Dining out');
    const view = await staged(ctx, budget());

    expect(view.session.sourceCategories).toEqual([
      { group: 'Everyday Expenses', label: 'Everyday Expenses: Groceries', name: 'Groceries', rowCount: 1, suggestedCategoryId: groceries.categoryKey },
      { group: 'Bills', label: 'Bills: Electricity', name: 'Electricity', rowCount: 1 },
      { group: 'Fun', label: 'Fun: Dining Out', name: 'Dining Out', rowCount: 1, suggestedCategoryId: expect.any(Number) },
    ]);

    // Electricity is the person's to choose; Dining Out they leave uncategorised although it matched.
    const mapped = await ctx.service().setCategoryMapping(ownerScope(), view.session.id, { 'Bills: Electricity': utilities.categoryKey, 'Fun: Dining Out': null });
    expect(mapped.categoryMapping).toEqual({ 'Bills: Electricity': utilities.categoryKey, 'Fun: Dining Out': null });
    await ctx.service().setAccountMapping(ownerScope(), view.session.id, { Checking: household.account.accountKey }, { create: ['Savings', 'Credit Card'] });
    await commitAndRun(ctx, view.session.id);

    expect((await storedTransactions(household.account)).map((row) => ({ amount: row.amount, category: row.category, type: row.type }))).toEqual([
      { amount: -42.5, category: 'Groceries', type: 'PAYMENT' },
      { amount: -1234.56, category: 'Utilities', type: 'PAYMENT' },
      { amount: 1500, category: null, type: 'DEPOSIT' },
      { amount: -400, category: null, type: 'TRANSFER_OUT' },
    ]);
    expect((await storedTransactions(await accountNamed('Credit Card'))).map((row) => row.category)).toEqual([null]);
  });

  it('suggests a system category by its stored name, accents and case aside', async () => {
    const ctx = setup();
    const parent = db.em().create(Category, { bgColor: '#000', isSystemCategory: true, name: 'HOUSING', textColor: '#fff' }, { partial: true });
    const rent = db.em().create(Category, { bgColor: '#000', isSystemCategory: true, name: 'RENT_MORTGAGE', parentCategory: parent, textColor: '#fff' }, { partial: true });
    await db.em().persist([parent, rent]).flush();
    const file = ynabFile('web', [{ account: 'Checking', category: ['Bills', 'Rént Mortgage'], date: '2026-01-02', outflow: '900.00', payee: 'Landlord' }]);

    const view = await staged(ctx, file);

    expect(view.session.sourceCategories[0]?.suggestedCategoryId).toBe(rent.categoryKey);
  });

  it('refuses a category of another household, and a label the file does not have', async () => {
    const ctx = setup();
    const neighbour = await seedHousehold(db.em());
    const theirs = await addCategory(db.em(), neighbour, 'Groceries');
    const view = await staged(ctx, budget());

    await expect(ctx.service().setCategoryMapping(ownerScope(), view.session.id, { 'Everyday Expenses: Groceries': theirs.categoryKey })).rejects.toBeInstanceOf(NotFoundError);
    await expect(ctx.service().setCategoryMapping(ownerScope(), view.session.id, { 'Taxes: Income Tax': null })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('is the starter\'s alone: their partner and another household cannot map its accounts or categories', async () => {
    const ctx = setup();
    const partner = await addPartner(db.em(), household);
    const neighbour = await seedHousehold(db.em());
    const view = await staged(ctx, budget());

    for (const scope of [{ appuserKey: partner.appuserKey, tenantKey: household.tenant.tenantKey }, { appuserKey: neighbour.appuser.appuserKey, tenantKey: neighbour.tenant.tenantKey }]) {
      await expect(ctx.service().setAccountMapping(scope, view.session.id, {}, { create: ['Savings'] })).rejects.toBeInstanceOf(NotFoundError);
      await expect(ctx.service().setCategoryMapping(scope, view.session.id, { 'Fun: Dining Out': null })).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await db.em().count(Account, { accountName: 'Savings' }, { filters: false })).toBe(0);
  });

  it('marks every row of a re-imported export as a duplicate', async () => {
    const ctx = setup();
    const savings = await addAccount(db.em(), household, { name: 'Savings' });
    const card = await addAccount(db.em(), household, { name: 'Credit Card' });
    const mapping = { 'Checking': household.account.accountKey, 'Credit Card': card.accountKey, 'Savings': savings.accountKey };

    const first = await staged(ctx, budget());
    await ctx.service().setAccountMapping(ownerScope(), first.session.id, mapping);
    await commitAndRun(ctx, first.session.id);

    const second = await staged(ctx, budget());
    await ctx.service().setAccountMapping(ownerScope(), second.session.id, mapping);
    const view = await ctx.service().get(ownerScope(), second.session.id, {});
    expect(view.session.counts).toMatchObject({ duplicate: 7, new: 0 });
  });

  it('imports a one-account export in one step into the account it was started on, with its categories', async () => {
    const ctx = setup();
    const groceries = await addCategory(db.em(), household, 'Groceries');
    const file = ynabFile('web', [
      { account: 'Checking', category: ['Everyday Expenses', 'Groceries'], date: '01/15/2026', outflow: '$42.50', payee: 'Corner Grocer' },
      { account: 'Checking', category: ['Inflow', 'Ready to Assign'], date: '01/31/2026', inflow: '$1,500.00', payee: 'Example Employer' },
    ]);
    const key = ctx.upload(household.account, file);

    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, autoCommit: true, format: 'ynab', key });
    await ctx.runLastJob();

    expect((await ctx.service().get(ownerScope(), created.id, {})).session.status).toBe('succeeded');
    expect((await storedTransactions(household.account)).map((row) => ({ amount: row.amount, category: row.category }))).toEqual([
      { amount: -42.5, category: groceries.name },
      { amount: 1500, category: null },
    ]);
  });

  it('asks for the date order of a YNAB 4 export whose dates are all ambiguous, and reads it again with the choice', async () => {
    const ctx = setup();
    const file = ynabFile('ynab4', [
      { account: 'Conta à ordem', category: ['Despesas diárias', 'Supermercado'], date: '01/02/2026', outflow: '10,00 €', payee: 'Mercearia' },
      { account: 'Conta à ordem', date: '03/04/2026', inflow: '1.200,00 €', payee: 'Entidade Patronal' },
    ]);

    const view = await staged(ctx, file);
    expect(view.session.warnings).toContainEqual(expect.objectContaining({ code: 'date_order_ambiguous' }));
    expect(view.rows.items.map((row) => [row.normalized?.date.slice(0, 10), row.normalized?.amount])).toEqual([['2026-02-01', -10], ['2026-04-03', 1200]]);

    await ctx.service().parse(ownerScope(), view.session.id, { options: { dateOrder: 'month-first' } });
    await ctx.runLastJob();

    const reread = await ctx.service().get(ownerScope(), view.session.id, {});
    expect(reread.session.warnings).toEqual([]);
    expect(reread.rows.items.map((row) => row.normalized?.date.slice(0, 10))).toEqual(['2026-01-02', '2026-03-04']);
  });
});
