import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addCategory, addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Category } from '@entity/Category';
import categoryRoutes from '@route/category';

/*
 * Every category says whether it counts as spending: on by default, off for money that only moves
 * to savings or investments. A household member can switch it on any category the household uses,
 * built-in ones included, for their household only, and never on another household's category.
 */
describe('a category\'s "counts as spending" flag', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/category', categoryRoutes);

  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const neighbour = await seedHousehold(em);
    const system = em.create(Category, { bgColor: '#000', countsAsSpending: false, isSystemCategory: true, name: 'INVESTMENTS_AND_SAVINGS', textColor: '#fff' }, { partial: true });
    await em.flush();
    return { neighbour, owner, partner, system };
  }

  const stored = async (categoryKey: number) => (await db.em().findOneOrFail(Category, { categoryKey }, { filters: false })).countsAsSpending;

  it('is on for a new category unless the request says otherwise', async () => {
    const { owner } = await households();

    const plain = await http.as(owner.appuser).post('/v1/category').send({ name: 'Groceries' });
    const pot = await http.as(owner.appuser).post('/v1/category').send({ countsAsSpending: false, name: 'Savings pot' });

    expect(plain.status).toBe(201);
    expect(plain.body.category.countsAsSpending).toBe(true);
    expect(pot.body.category.countsAsSpending).toBe(false);
    expect(await stored(pot.body.category.categoryKey as number)).toBe(false);
  });

  it('starts a child of a category that does not count as spending off too', async () => {
    const { owner, system } = await households();

    const response = await http.as(owner.appuser).post('/v1/category').send({ name: 'Broker', parentCategoryKey: String(system.categoryKey) });

    expect(response.status).toBe(201);
    expect(response.body.category.countsAsSpending).toBe(false);
  });

  it('is switched by either member of the household and listed with every category', async () => {
    const { owner, partner } = await households();
    const pot = await addCategory(db.em(), owner, 'Savings pot');

    const response = await http.as(partner).patch(`/v1/category/${pot.categoryKey}`).send({ countsAsSpending: false });

    expect(response.status).toBe(200);
    expect(await stored(pot.categoryKey)).toBe(false);
    const listed = await http.as(owner.appuser).get('/v1/category');
    const flags = Object.fromEntries((listed.body.categories as { countsAsSpending: boolean; name: string }[]).map((category) => [category.name, category.countsAsSpending]));
    expect(flags).toMatchObject({ INVESTMENTS_AND_SAVINGS: false, 'Savings pot': false });
  });

  it('is switched on a built-in category for the member\'s household only', async () => {
    const { neighbour, owner, partner, system } = await households();
    const listedFlags = async (appuser: typeof partner) => Object.fromEntries(((await http.as(appuser).get('/v1/category')).body.categories as { countsAsSpending: boolean; name: string }[]).map((category) => [category.name, category.countsAsSpending]));

    const response = await http.as(partner).patch(`/v1/category/${system.categoryKey}`).send({ countsAsSpending: true });

    expect(response.status).toBe(200);
    expect(response.body.category.countsAsSpending).toBe(true);
    expect(await listedFlags(owner.appuser)).toMatchObject({ INVESTMENTS_AND_SAVINGS: true });
    expect(await listedFlags(neighbour.appuser)).toMatchObject({ INVESTMENTS_AND_SAVINGS: false });
    // The global row keeps its default.
    expect(await stored(system.categoryKey)).toBe(false);
  });

  it('starts a child of a built-in category with the household\'s value for it', async () => {
    const { owner, system } = await households();
    await http.as(owner.appuser).patch(`/v1/category/${system.categoryKey}`).send({ countsAsSpending: true });

    const response = await http.as(owner.appuser).post('/v1/category').send({ name: 'Broker', parentCategoryKey: String(system.categoryKey) });

    expect(response.body.category.countsAsSpending).toBe(true);
  });

  it('cannot rename a built-in category, or switch another household\'s', async () => {
    const { neighbour, owner, system } = await households();
    const theirs = await addCategory(db.em(), neighbour, 'Theirs');

    expect((await http.as(owner.appuser).patch(`/v1/category/${system.categoryKey}`).send({ countsAsSpending: true, name: 'Mine' })).status).toBe(400);
    expect((await http.as(owner.appuser).patch(`/v1/category/${theirs.categoryKey}`).send({ countsAsSpending: false })).status).toBe(404);
    expect(await stored(theirs.categoryKey)).toBe(true);
    const listed = (await http.as(owner.appuser).get('/v1/category')).body.categories as { countsAsSpending: boolean; name: string }[];
    expect(listed.find((category) => category.name === 'INVESTMENTS_AND_SAVINGS')?.countsAsSpending).toBe(false);
  });

  it('leaves the flag alone on an edit that does not mention it', async () => {
    const { owner } = await households();
    const pot = await addCategory(db.em(), owner, 'Savings pot');
    await http.as(owner.appuser).patch(`/v1/category/${pot.categoryKey}`).send({ countsAsSpending: false });

    await http.as(owner.appuser).patch(`/v1/category/${pot.categoryKey}`).send({ name: 'Pot' });

    expect(await stored(pot.categoryKey)).toBe(false);
  });
});
