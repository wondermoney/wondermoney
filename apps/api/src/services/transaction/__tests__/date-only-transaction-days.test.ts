import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addBudget, budgetRows } from '@app/__tests__/__helpers__/budget-fixtures';
import { addCategory, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { getAccountsCashflow } from '@controller/account/cashflow';
import { getAccountsMetrics } from '@controller/account/metrics';
import { getAccountTransactions, getCategorySpending, getTransactions } from '@controller/account/transactions';
import { getBudgetSpending } from '@service/budget/spending';
import { getCashflowReport } from '@service/reports/cashflow.service';
import { reportFiltersSchema } from '@validators/reports';

type Handler = (req: Request, res: Response, next: () => void) => Promise<unknown>;

async function call(handler: Handler, household: Household, request: { params?: Record<string, string>; query?: Record<string, string> } = {}) {
  let body: unknown;
  const res = { json: (payload: unknown) => { body = payload; return res; }, sendStatus: vi.fn(), status: vi.fn(() => res) } as unknown as Response;
  const req = { body: {}, headers: {}, params: request.params ?? {}, query: request.query ?? {}, tenant: household.tenant, user: household.appuser } as unknown as Request;
  await handler(req, res, () => undefined);
  return body as Record<string, unknown>;
}

/*
 * A bank booking carries a date and no time: it is stored at UTC midnight of that date. A viewer
 * picks whole days on their own calendar, and the client sends the first and last instant of those
 * days with the viewer's time zone. A booking on a picked day counts, whatever the viewer's offset;
 * a row with a real time keeps its exact instant.
 *
 * Every viewer picks 10 to 12 June 2026. Each row's amount is a distinct power of ten, so a sum
 * names exactly which rows were counted.
 */
interface Viewer {
  from: string;
  /** A timed row inside the picked days, near an edge where the UTC day differs. */
  timedInside: string;
  /** A timed row just outside the picked days. */
  timedOutside: string;
  /** Whether {@link timedOutside} falls before the first day (so a start-only range leaves it out). */
  timedOutsideIsBefore: boolean;
  timeZone: string;
  to: string;
}

const VIEWERS: Record<string, Viewer> = {
  'New York': {
    from: '2026-06-10T04:00:00.000Z',
    // 12 June 23:30 in New York.
    timedInside: '2026-06-13T03:30:00.000Z',
    // 9 June 22:00 in New York: on 10 June in UTC, but not on a picked day for this viewer.
    timedOutside: '2026-06-10T02:00:00.000Z',
    timedOutsideIsBefore: true,
    timeZone: 'America/New_York',
    to: '2026-06-13T03:59:59.999Z',
  },
  Tokyo: {
    from: '2026-06-09T15:00:00.000Z',
    // 10 June 00:30 in Tokyo.
    timedInside: '2026-06-09T15:30:00.000Z',
    // 13 June 00:30 in Tokyo.
    timedOutside: '2026-06-12T15:30:00.000Z',
    timedOutsideIsBefore: false,
    timeZone: 'Asia/Tokyo',
    to: '2026-06-12T14:59:59.999Z',
  },
};

const AMOUNTS = { after: 1000, before: 1, firstDay: 10, lastDay: 100, timedInside: 10_000, timedOutside: 100_000 } as const;
const IN_RANGE = AMOUNTS.firstDay + AMOUNTS.lastDay + AMOUNTS.timedInside;

describe.each(Object.entries(VIEWERS))('date-only bank rows for a viewer in %s', (_name, viewer) => {
  const db = useTestDatabase();
  const range = { fromDate: viewer.from, timezone: viewer.timeZone, toDate: viewer.to };

  async function seed() {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addCategory(em, household, 'Groceries', await addCategory(em, household, 'Food'));
    const row = (amount: number, date: string) => addTransaction(em, household, { amount: -amount, category: groceries, date: new Date(date), status: 'BOOKED' });
    await row(AMOUNTS.before, '2026-06-09T00:00:00.000Z');
    await row(AMOUNTS.firstDay, '2026-06-10T00:00:00.000Z');
    await row(AMOUNTS.lastDay, '2026-06-12T00:00:00.000Z');
    await row(AMOUNTS.after, '2026-06-13T00:00:00.000Z');
    await row(AMOUNTS.timedInside, viewer.timedInside);
    await row(AMOUNTS.timedOutside, viewer.timedOutside);
    return { groceries, household };
  }

  const listedTotal = (body: Record<string, unknown>) => (body['transactions'] as { appuserSettlementAmount: number }[]).reduce((sum, row) => sum - row.appuserSettlementAmount, 0);

  it('lists bookings on the first and last day, not the day before or after, and counts the same rows', async () => {
    const { household } = await seed();

    const body = await call(getTransactions as Handler, household, { query: range });

    expect(listedTotal(body)).toBe(IN_RANGE);
    expect(body['total']).toBe(3);
  });

  it('applies the same days to one account\'s list', async () => {
    const { household } = await seed();

    const body = await call(getAccountTransactions as Handler, household, { params: { accountId: String(household.account.accountKey) }, query: range });

    expect(listedTotal(body)).toBe(IN_RANGE);
    expect(body['total']).toBe(3);
  });

  it('applies the same days to category spending', async () => {
    const { household } = await seed();

    const body = await call(getCategorySpending as Handler, household, { query: range });

    expect(body['categorySpending']).toEqual([expect.objectContaining({ amount: IN_RANGE, numTransactions: 3 })]);
  });

  it('applies the same days to money in and out', async () => {
    const { household } = await seed();

    const body = await call(getAccountsMetrics as Handler, household, { query: range });

    expect(body['metrics']).toEqual([expect.objectContaining({ outflowCurrentPeriod: IN_RANGE, transactionCountCurrentPeriod: 3 })]);
  });

  it('starts the monthly cash flow on the first day', async () => {
    const { household } = await seed();

    const body = await call(getAccountsCashflow as Handler, household, { query: { fromDate: viewer.from, timezone: viewer.timeZone } });

    const fromFirstDay = IN_RANGE + AMOUNTS.after + (viewer.timedOutsideIsBefore ? 0 : AMOUNTS.timedOutside);
    expect(body['cashflow']).toEqual([expect.objectContaining({ amount: -fromFirstDay })]);
  });

  it('applies the same days to the reports', async () => {
    const { household } = await seed();

    const { data } = await getCashflowReport({ filters: reportFiltersSchema.parse(range), tenant: household.tenant, user: household.appuser });

    expect(data).toEqual([expect.objectContaining({ expenses: IN_RANGE, month: '2026-06-01T00:00:00.000Z' })]);
  });
});

describe('a date-only bank row in the reports\' months', () => {
  const db = useTestDatabase();

  it('groups a booking on the 1st into its own month for a viewer west of UTC', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await addTransaction(em, household, { amount: -25, date: new Date('2026-07-01T00:00:00.000Z'), status: 'BOOKED' });

    const { data } = await getCashflowReport({
      filters: reportFiltersSchema.parse({ fromDate: '2026-07-01T04:00:00.000Z', timezone: 'America/New_York', toDate: '2026-08-01T03:59:59.999Z' }),
      tenant: household.tenant,
      user: household.appuser,
    });

    expect(data).toEqual([expect.objectContaining({ expenses: 25, month: '2026-07-01T00:00:00.000Z' })]);
  });
});

/*
 * Budgets and the accounts cash flow group by month in SQL. A booking on the 1st is in that month
 * even when the database session runs in a time zone west of UTC.
 */
describe('a date-only bank row\'s month in SQL', () => {
  const db = useTestDatabase();

  async function inSessionTimeZone<T>(timeZone: string, run: () => Promise<T>): Promise<T> {
    const connection = db.em().getConnection();
    await connection.execute(`set time zone '${timeZone}'`);
    try {
      return await run();
    } finally {
      await connection.execute(`set time zone 'UTC'`);
    }
  }

  it('counts a booking on the 1st in that month\'s budget', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addCategory(em, household, 'Groceries', await addCategory(em, household, 'Food'));
    const { budget } = await addBudget(em, household, { lines: [{ amount: 100, category: groceries, months: [7], year: 2026 }] });
    await addTransaction(em, household, { amount: -25, category: groceries, date: new Date('2026-07-01T00:00:00.000Z'), status: 'BOOKED' });
    const templateKeys = (await budgetRows(em, budget.budgetKey)).map((row) => row.budgetTemplateCategoryKey);

    const { categories } = await inSessionTimeZone('America/New_York', () => getBudgetSpending({ accountKeys: [household.account.accountKey], currency: household.currency, period: 'monthly', periodStartDay: 1, templateKeys, tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey }));

    expect(categories.find((row) => row.child_category_name === 'Groceries')?.category_amount).toBe(25);
  });

  it('puts a booking on the 1st in that month of the accounts cash flow', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await addTransaction(em, household, { amount: -25, date: new Date('2026-07-01T00:00:00.000Z'), status: 'BOOKED' });

    const body = await inSessionTimeZone('America/New_York', () => call(getAccountsCashflow as Handler, household));

    expect(body['cashflow']).toEqual([{ amount: -25, date: '2026-07-01T00:00:00.000Z', expenses: 25, income: 0, savingsRate: null }]);
  });
});

