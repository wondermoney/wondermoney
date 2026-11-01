import { startOfMonth } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/assistant/assistant-audit.service', () => ({ AssistantAuditService: { log: vi.fn() } }));

import { addAccount, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Category } from '@entity/Category';
import { TransactionAuditActorType } from '@entity/TransactionAuditLog';
import { TransactionType } from '@entity/TransactionType';
import { AssistantToolsService } from '@service/assistant/assistant-tools.service';
import { MikroOrmTenantAggregationRepository } from '@service/budget/tenant-aggregation.repository';
import { TenantFinancialAggregationService } from '@service/budget/tenant-financial-aggregation.service';
import { reconcileTransfers } from '@service/transaction/transfer-matching.service';
import { reportFiltersSchema } from '@validators/reports';

import { getCashflowReport } from '../cashflow.service';
import type { ReportServiceInput } from '../report-filters';
import { getSankeyReport } from '../sankey.service';

/*
 * At the layer that adds the money up: a salary synced into a bank account is income in every
 * report, and money moved between two of the household's own accounts is neither income nor
 * spending. Rows are stored the way bank sync stores them (DEPOSIT in, PAYMENT out, provider id set)
 * and then go through transfer matching, as they do after each sync.
 */
describe('a synced salary is income; an own-account transfer is not', () => {
  const db = useTestDatabase();
  let sequence = 0;

  async function seed(dates: { month: (offsetDays: number) => Date }) {
    const em = db.em();
    const household = await seedHousehold(em);
    const typeNamed = async (name: string) => (await em.findOne(TransactionType, { name })) ?? em.create(TransactionType, { displayName: name, name }, { partial: true });
    const deposit = await typeNamed('DEPOSIT');
    const payment = await typeNamed('PAYMENT');
    await typeNamed('TRANSFER_IN');
    await typeNamed('TRANSFER_OUT');
    await em.flush();
    const savings = await addAccount(em, household, { name: 'Savings' });
    // Owned by the user, as the monthly story only counts categories the user owns (or system ones).
    const category = (name: string, parentCategory?: Category) => em.create(Category, { appuserKey: household.appuser, bgColor: '#000', name, parentCategory, tenantKey: household.tenant, textColor: '#fff' }, { partial: true });
    const categories = { groceries: category('Groceries', category('Food')), salary: category('Salary', category('Income')), savings: category('Savings', category('Transfers')) };
    await em.flush();
    const synced = (input: { account?: typeof savings; amount: number; category: Category; offsetDays: number }) => addTransaction(em, household, {
      account: input.account,
      amount: input.amount,
      category: input.category,
      date: dates.month(input.offsetDays),
      enableBankingTransactionId: `eb-${++sequence}`,
      status: 'BOOKED',
      type: input.amount >= 0 ? deposit : payment,
    });
    await synced({ amount: 2000, category: categories.salary, offsetDays: 0 });
    await synced({ amount: -500, category: categories.savings, offsetDays: 2 });
    await synced({ account: savings, amount: 500, category: categories.savings, offsetDays: 3 });
    await synced({ amount: -40, category: categories.groceries, offsetDays: 4 });
    await reconcileTransfers(db.em(), { actorType: TransactionAuditActorType.SYNC, apply: true, source: 'test', tenantKey: household.tenant.tenantKey });
    return { categories, household };
  }

  const inJuly = { month: (offsetDays: number) => new Date(Date.UTC(2026, 6, 1 + offsetDays, 12)) };
  const JULY = { fromDate: '2026-07-01T00:00:00Z', toDate: '2026-07-31T23:59:59Z' };
  // The default filters, as web and mobile send them: transfers excluded.
  const reportInput = (household: Household): ReportServiceInput => ({ filters: reportFiltersSchema.parse(JULY), tenant: household.tenant, user: household.appuser });

  it('cash flow: income is the salary, expenses the groceries', async () => {
    const { household } = await seed(inJuly);

    expect(await getCashflowReport(reportInput(household))).toEqual([expect.objectContaining({ expenses: 40, income: 2000, net: 1960 })]);
  });

  it('Sankey: the salary is the only income node, groceries the only expense', async () => {
    const { household } = await seed(inJuly);

    const { nodes } = await getSankeyReport(reportInput(household));

    expect(nodes.filter((node) => node.kind === 'income').map((node) => [node.label, node.value])).toEqual([['Salary', 2000]]);
    expect(nodes.filter((node) => node.kind === 'expense').map((node) => [node.label, node.value])).toEqual([['Groceries', 40]]);
  });

  it('monthly money story: income, its baseline and the savings rate count the salary and leave the transfer out', async () => {
    const em = db.em();
    const { categories, household } = await seed(inJuly);
    // Three baseline months (April to June) of the same salary and groceries, and no transfer.
    for (const month of [3, 4, 5]) {
      const date = (offsetDays: number) => new Date(Date.UTC(2026, month, 1 + offsetDays, 12));
      await addTransaction(em, household, { amount: 2000, category: categories.salary, date: date(0), enableBankingTransactionId: `eb-base-in-${month}`, status: 'BOOKED', type: await em.findOneOrFail(TransactionType, { name: 'DEPOSIT' }) });
      await addTransaction(em, household, { amount: -40, category: categories.groceries, date: date(4), enableBankingTransactionId: `eb-base-out-${month}`, status: 'BOOKED', type: await em.findOneOrFail(TransactionType, { name: 'PAYMENT' }) });
    }

    const service = new TenantFinancialAggregationService(new MikroOrmTenantAggregationRepository(db.em()));
    const result = await service.aggregateMonthlyStory({ appuserKey: household.appuser.appuserKey, scheduledFor: '2026-08-01T09:00:00Z', tenantKey: household.tenant.tenantKey });

    expect(result).toMatchObject({ facts: { incomeBaseline: '2000', incomeSubject: '2000', savingsRateBaseline: '98.00', savingsRateSubject: '98.00', spendingSubject: '40' }, status: 'ok' });
  });

  it('assistant cash-flow summary: inflow is the salary, outflow the groceries', async () => {
    // All rows on the same day of this month: the assistant reads the current month.
    const { household } = await seed({ month: () => new Date(startOfMonth(new Date()).getTime() + 12 * 60 * 60 * 1000) });
    const tools = AssistantToolsService.createTools({ appuserKey: household.appuser.appuserKey, consentVersion: 1, conversationId: 'c-1', currency: 'EUR', tenantKey: household.tenant.tenantKey }) as unknown as Record<string, { execute: (input: { period: 'current_month' }, options: unknown) => Promise<{ data: Record<string, unknown> }> }>;

    const result = await tools['get_cashflow_summary']?.execute({ period: 'current_month' }, {});

    expect(result?.data).toMatchObject({ inflow: 2000, net: 1960, outflow: 40 });
  });
});
