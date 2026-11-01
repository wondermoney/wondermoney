import { startOfMonth } from 'date-fns';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { addCategory, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { getCategorySpending } from '../transactions';

type Handler = (req: Request, res: Response, next: () => void) => Promise<unknown>;

async function categorySpending(household: Household) {
  let body: unknown;
  const res = { json: (payload: unknown) => { body = payload; return res; }, status: vi.fn(() => res) } as unknown as Response;
  const req = { body: {}, headers: {}, params: {}, query: {}, tenant: household.tenant, user: household.appuser } as unknown as Request;
  await (getCategorySpending as Handler)(req, res, () => undefined);
  return (body as { categorySpending: unknown[] }).categorySpending;
}

/*
 * Category spending groups expenses by top-level category and lists the subcategories under it.
 * A transaction can sit on the top-level category itself or on one of its children; either way
 * the parent's total is the sum of every expense under it.
 */
describe('category spending totals', () => {
  const db = useTestDatabase();
  const day = (offsetHours: number) => new Date(startOfMonth(new Date()).getTime() + offsetHours * 60 * 60 * 1000);

  it('sums every transaction on a top-level category', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const rent = await addCategory(em, household, 'Housing');
    await addTransaction(em, household, { amount: -500, category: rent, date: day(1), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -70, category: rent, date: day(2), status: 'BOOKED' });

    const rows = await categorySpending(household);

    expect(rows).toEqual([expect.objectContaining({ amount: 570, childCategories: [], name: 'Housing', numTransactions: 2 })]);
  });

  it('rolls child categories up into their parent', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const food = await addCategory(em, household, 'Food');
    const groceries = await addCategory(em, household, 'Groceries', food);
    const restaurants = await addCategory(em, household, 'Restaurants', food);
    await addTransaction(em, household, { amount: -20, category: groceries, date: day(1), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -30, category: groceries, date: day(2), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -15, category: restaurants, date: day(3), status: 'BOOKED' });

    const rows = await categorySpending(household);

    expect(rows).toEqual([
      expect.objectContaining({
        amount: 65,
        childCategories: expect.arrayContaining([
          expect.objectContaining({ amount: 50, name: 'Groceries', numTransactions: 2 }),
          expect.objectContaining({ amount: 15, name: 'Restaurants', numTransactions: 1 }),
        ]),
        name: 'Food',
        numTransactions: 3,
      }),
    ]);
  });

  it.each([
    ['the parent transaction comes first', ['parent', 'child'] as const],
    ['a child transaction comes first', ['child', 'parent'] as const],
  ])('adds a transaction on the parent to its children\'s total when %s', async (_label, order) => {
    const em = db.em();
    const household = await seedHousehold(em);
    const food = await addCategory(em, household, 'Food');
    const groceries = await addCategory(em, household, 'Groceries', food);
    for (const [index, target] of order.entries()) {
      await addTransaction(em, household, { amount: target === 'parent' ? -40 : -25, category: target === 'parent' ? food : groceries, date: day(index + 1), status: 'BOOKED' });
    }

    const rows = await categorySpending(household);

    expect(rows).toEqual([
      expect.objectContaining({
        amount: 65,
        childCategories: [expect.objectContaining({ amount: 25, name: 'Groceries', numTransactions: 1 })],
        name: 'Food',
        numTransactions: 2,
      }),
    ]);
  });

  it('ranks categories by their full total, so the limit keeps the biggest ones', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const housing = await addCategory(em, household, 'Housing');
    const travel = await addCategory(em, household, 'Travel');
    for (let index = 0; index < 3; index += 1) {
      await addTransaction(em, household, { amount: -100, category: housing, date: day(index + 1), status: 'BOOKED' });
    }
    await addTransaction(em, household, { amount: -150, category: travel, date: day(5), status: 'BOOKED' });

    const rows = await categorySpending(household);

    expect(rows.map((row) => (row as { amount: number; name: string }).name)).toEqual(['Housing', 'Travel']);
    expect(rows[0]).toEqual(expect.objectContaining({ amount: 300 }));
  });
});
