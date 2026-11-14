import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addBudget, budgetRows } from '@app/__tests__/__helpers__/budget-fixtures';
import { addAccount, addCategory, addPartner, addShare, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Appuser } from '@entity/Appuser';
import { HouseholdRole } from '@entity/AppuserTenant';
import { Budget } from '@entity/Budget';
import budgetRoutes from '@route/budget';
import reportRoutes from '@route/reports';

/*
 * A personal budget is its owner's alone. Every other member of the household, the household's
 * owner and admins included, reads it as a budget that does not exist (404, absent from every list
 * and aggregate) and cannot change it. Its owner sees and edits it like any budget, and it counts
 * only the transactions its owner can see.
 */
describe('personal budgets', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/budget', budgetRoutes);
  const reports = tenantHttp('/v1/reports', reportRoutes);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const inThisMonth = () => new Date(Date.UTC(year, month - 1, 10, 12));

  async function personalBudgetOf(household: Household, owner: Appuser, name: string, amount = 100) {
    const em = db.em();
    const result = await addBudget(em, household, { lines: [{ amount, name: `${name} line`, year }], name });
    result.budget.appuserKey = owner;
    result.budget.ownerAppuserKey = owner;
    await em.flush();
    return result;
  }

  /** A household with an owner, an admin, a member who owns a personal budget, and another member. */
  async function household() {
    const em = db.em();
    const home = await seedHousehold(em);
    const admin = await addPartner(em, home, { role: HouseholdRole.ADMIN });
    const owner = await addPartner(em, home);
    const otherMember = await addPartner(em, home);
    const shared = await addBudget(em, home, { lines: [{ amount: 300, name: 'Shared groceries', year }], name: 'Shared' });
    const personal = await personalBudgetOf(home, owner, 'Mine');
    return { admin, home, otherMember, owner, personal, shared };
  }

  const stored = (budgetKey: number) => db.em().findOneOrFail(Budget, { budgetKey }, { filters: false });

  describe.each([
    ['the household owner', (setup: Awaited<ReturnType<typeof household>>) => setup.home.appuser],
    ['an admin', (setup: Awaited<ReturnType<typeof household>>) => setup.admin],
    ['another member', (setup: Awaited<ReturnType<typeof household>>) => setup.otherMember],
  ])('to %s', (_who, pick) => {
    it('is absent from the budget lists', async () => {
      const setup = await household();
      const as = http.as(pick(setup));

      const list = await as.get('/v1/budget');
      const full = await as.get('/v1/budget/full');

      expect(list.status).toBe(200);
      expect((list.body as { budgets: { budgetKey: number }[] }).budgets.map((budget) => budget.budgetKey)).toEqual([setup.shared.budget.budgetKey]);
      expect(full.status).toBe(200);
      expect((full.body as { budgets: { budgetKey: number }[] }).budgets.map((budget) => budget.budgetKey)).toEqual([setup.shared.budget.budgetKey]);
    });

    it('reads as missing on every budget endpoint and is left as it was', async () => {
      const setup = await household();
      const as = http.as(pick(setup));
      const key = setup.personal.budget.budgetKey;
      const category = setup.personal.categories[0]!;
      const [template] = await budgetRows(db.em(), key, { year });
      const rowsBefore = (await budgetRows(db.em(), key)).length;
      const anotherCategory = await addCategory(db.em(), setup.home, 'Another');

      const responses = {
        'DELETE /:budgetKey': await as.delete(`/v1/budget/${key}`),
        'DELETE /:budgetKey/:year/:month/:categoryKey': await as.delete(`/v1/budget/${key}/${year}/${month}/${category.categoryKey}`),
        'DELETE /:budgetKey/category/:categoryKey': await as.delete(`/v1/budget/${key}/category/${category.categoryKey}?deletePreviousMonths=true`),
        'GET /:budgetKey': await as.get(`/v1/budget/${key}`),
        'GET /:budgetKey/:year': await as.get(`/v1/budget/${key}/${year}`),
        'GET /:budgetKey/:year/:month': await as.get(`/v1/budget/${key}/${year}/${month}`),
        'GET /:budgetKey/:year/until/:month': await as.get(`/v1/budget/${key}/${year}/until/${month}`),
        'GET /:budgetKey/accounts': await as.get(`/v1/budget/${key}/accounts`),
        'GET /:budgetKey/forecast': await as.get(`/v1/budget/${key}/forecast?months=3`),
        'GET /:budgetKey/suggestions': await as.get(`/v1/budget/${key}/suggestions?month=${month}&year=${year}&months=3`),
        'PATCH /:budgetKey': await as.patch(`/v1/budget/${key}`).send({ name: 'Taken over', periodStartDay: 15, rolloverCarriesOverspend: false }),
        'PATCH /:budgetKey/:budgetTemplateCategoryKey': await as.patch(`/v1/budget/${key}/${template!.budgetTemplateCategoryKey}`).send({ accountKeys: [setup.home.account.accountKey] }),
        'PATCH /:budgetKey/:year/:month/:categoryKey': await as.patch(`/v1/budget/${key}/${year}/${month}/${category.categoryKey}`).send({ amount: 999 }),
        'PATCH /:budgetKey/accounts': await as.patch(`/v1/budget/${key}/accounts`).send({ accountKeys: [setup.home.account.accountKey] }),
        'POST /:budgetKey/category': await as.post(`/v1/budget/${key}/category`).send({ amountBudgeted: 10, categoryKey: anotherCategory.categoryKey }),
      };

      expect(Object.fromEntries(Object.entries(responses).map(([route, response]) => [route, response.status])))
        .toEqual(Object.fromEntries(Object.keys(responses).map((route) => [route, 404])));
      for (const response of Object.values(responses)) expect(JSON.stringify(response.body)).not.toContain('Mine');
      await expect(stored(key)).resolves.toMatchObject({ deletedAt: null, name: 'Mine', periodStartDay: 1, rolloverCarriesOverspend: true });
      const rowsAfter = await budgetRows(db.em(), key);
      expect(rowsAfter).toHaveLength(rowsBefore);
      expect(rowsAfter.every((row) => Number(row.amountBudgeted) === 100 && row.accounts.length === 0)).toBe(true);
    });

    it('is not the budget the budget-vs-actual report compares against', async () => {
      const em = db.em();
      const home = await seedHousehold(em);
      const admin = await addPartner(em, home, { role: HouseholdRole.ADMIN });
      const otherMember = await addPartner(em, home);
      const owner = await addPartner(em, home);
      // The personal budget is the household's first: it must not stand in for the shared one.
      await personalBudgetOf(home, owner, 'Mine', 50);
      const viewer = pick({ admin, home, otherMember } as Awaited<ReturnType<typeof household>>);

      const before = await reports.as(viewer).get('/v1/reports/budget-vs-actual');
      const csv = await reports.as(viewer).get('/v1/reports/budget-vs-actual.csv');

      expect(before.status).toBe(200);
      expect((before.body as { data: unknown[] }).data).toEqual([]);
      expect(csv.text).not.toContain('Mine line');

      await addBudget(em, home, { lines: [{ amount: 300, name: 'Shared groceries', year }], name: 'Shared' });
      const after = await reports.as(viewer).get('/v1/reports/budget-vs-actual');
      expect((after.body as { data: { budgeted: number; name: string }[] }).data.map((row) => row.name)).toEqual(['Shared groceries']);
    });
  });

  it('leaves the household budget the one its owner\'s budget-vs-actual report compares against', async () => {
    const em = db.em();
    const home = await seedHousehold(em);
    const owner = await addPartner(em, home);
    await personalBudgetOf(home, owner, 'Mine', 50);
    await addBudget(em, home, { lines: [{ amount: 300, name: 'Shared groceries', year }], name: 'Shared' });

    const response = await reports.as(owner).get('/v1/reports/budget-vs-actual');

    expect((response.body as { data: { name: string }[] }).data.map((row) => row.name)).toEqual(['Shared groceries']);
  });

  it('is listed, read and edited by its owner, labelled personal', async () => {
    const setup = await household();
    const as = http.as(setup.owner);
    const key = setup.personal.budget.budgetKey;

    const list = await as.get('/v1/budget');
    const full = await as.get('/v1/budget/full');
    const one = await as.get(`/v1/budget/${key}`);
    const monthView = await as.get(`/v1/budget/${key}/${year}/${month}`);

    const visibilities = (body: unknown) => Object.fromEntries((body as { budgets: { budgetKey: number; visibility: string }[] }).budgets.map((budget) => [budget.budgetKey, budget.visibility]));
    expect(visibilities(list.body)).toEqual({ [key]: 'personal', [setup.shared.budget.budgetKey]: 'household' });
    expect(visibilities(full.body)).toEqual({ [key]: 'personal', [setup.shared.budget.budgetKey]: 'household' });
    expect(one.body).toMatchObject({ budget: { budgetKey: key, name: 'Mine', visibility: 'personal' } });
    expect(monthView.body).toMatchObject({ budget: { budgetKey: key, visibility: 'personal' } });

    expect((await as.patch(`/v1/budget/${key}`).send({ name: 'Still mine' })).status).toBe(200);
    expect((await as.patch(`/v1/budget/${key}/${year}/${month}/${setup.personal.categories[0]!.categoryKey}`).send({ amount: 120, applyToFollowingMonths: false })).status).toBe(200);
    await expect(stored(key)).resolves.toMatchObject({ name: 'Still mine' });
    expect((await budgetRows(db.em(), key, { year })).find((row) => row.month === month)).toSatisfy((row) => Number((row as { amountBudgeted: unknown }).amountBudgeted) === 120);
    expect((await as.delete(`/v1/budget/${key}`)).status).toBe(200);
    await expect(stored(key)).resolves.toMatchObject({ deletedAt: expect.any(Date) });
  });

  it('is created by a member who asks for one, owned by them, and hidden from the household', async () => {
    const setup = await household();

    const created = await http.as(setup.otherMember).post('/v1/budget').send({ dependentsNum: 0, houseHoldSize: 1, visibility: 'personal' });
    const shared = await http.as(setup.otherMember).post('/v1/budget').send({ dependentsNum: 0, houseHoldSize: 2 });

    expect(created.status).toBe(201);
    const personalKey = (created.body as { budgetKey: number }).budgetKey;
    const sharedKey = (shared.body as { budgetKey: number }).budgetKey;
    await expect(stored(personalKey)).resolves.toMatchObject({ ownerAppuserKey: { appuserKey: setup.otherMember.appuserKey } });
    await expect(stored(sharedKey)).resolves.toMatchObject({ ownerAppuserKey: null });
    expect((await http.as(setup.otherMember).get(`/v1/budget/${personalKey}`)).body).toMatchObject({ budget: { visibility: 'personal' } });
    expect((await http.as(setup.home.appuser).get(`/v1/budget/${personalKey}`)).status).toBe(404);
    expect((await http.as(setup.home.appuser).get(`/v1/budget/${sharedKey}`)).body).toMatchObject({ budget: { visibility: 'household' } });
  });

  it('cannot be created by a viewer, nor can a household budget', async () => {
    const setup = await household();
    const viewer = await addPartner(db.em(), setup.home, { role: HouseholdRole.VIEWER });
    const before = await db.em().count(Budget, {}, { filters: false });

    const personal = await http.as(viewer).post('/v1/budget').send({ dependentsNum: 0, houseHoldSize: 1, visibility: 'personal' });
    const shared = await http.as(viewer).post('/v1/budget').send({ dependentsNum: 0, houseHoldSize: 1 });

    expect(personal.status).toBe(403);
    expect(shared.status).toBe(403);
    expect(await db.em().count(Budget, {}, { filters: false })).toBe(before);
    expect((await http.as(viewer).get(`/v1/budget/${setup.personal.budget.budgetKey}`)).status).toBe(404);
  });

  it('is invisible to another household too', async () => {
    const setup = await household();
    const neighbour = await seedHousehold(db.em());
    const key = setup.personal.budget.budgetKey;

    expect((await http.as(neighbour.appuser).get(`/v1/budget/${key}`)).status).toBe(404);
    expect((await http.as(neighbour.appuser).patch(`/v1/budget/${key}`).send({ name: 'Taken over' })).status).toBe(404);
    expect((await http.as(neighbour.appuser).get('/v1/budget')).body).toEqual({ budgets: [] });
    await expect(stored(key)).resolves.toMatchObject({ name: 'Mine' });
  });

  it('counts only the transactions its owner can see', async () => {
    const em = db.em();
    const home = await seedHousehold(em);
    const owner = await addPartner(em, home);
    const ownPrivate = await addAccount(em, home, { isPrivate: true, owner });
    const othersPrivate = await addAccount(em, home, { isPrivate: true });
    const groceries = await addCategory(em, home, 'Groceries', await addCategory(em, home, 'Food'));
    // Linked to all three, as a link made before the other member's account turned private would be.
    const { budget } = await addBudget(em, home, { lines: [{ accounts: [home.account, ownPrivate, othersPrivate], amount: 500, category: groceries, year }], name: 'Mine' });
    budget.appuserKey = owner;
    budget.ownerAppuserKey = owner;
    await em.flush();
    await addTransaction(em, home, { account: home.account, amount: -10, category: groceries, date: inThisMonth(), status: 'BOOKED' });
    await addTransaction(em, home, { account: ownPrivate, amount: -20, appuser: owner, category: groceries, date: inThisMonth(), status: 'BOOKED' });
    await addTransaction(em, home, { account: othersPrivate, amount: -400, category: groceries, date: inThisMonth(), status: 'BOOKED' });

    const response = await http.as(owner).get(`/v1/budget/${budget.budgetKey}/${year}/${month}`);

    expect(response.status).toBe(200);
    const categories = (response.body as { budget: { categories: { category_amount: number | string; child_category_name: null | string }[] } }).budget.categories;
    expect(Number(categories.find((category) => category.child_category_name === 'Groceries')?.category_amount)).toBe(30);
  });

  /**
   * The owner's personal budget over the household's shared account, the owner's own private
   * account, another member's private account shared with the owner, and another member's private
   * account not shared with them, with spending on each in this month.
   */
  async function personalBudgetOverEveryKindOfAccount() {
    const em = db.em();
    const home = await seedHousehold(em);
    const owner = await addPartner(em, home);
    const ownPrivate = await addAccount(em, home, { isPrivate: true, owner });
    const sharedWithOwner = await addAccount(em, home, { isPrivate: true });
    await addShare(em, home, sharedWithOwner, owner, 'read');
    const notShared = await addAccount(em, home, { isPrivate: true });
    const groceries = await addCategory(em, home, 'Groceries', await addCategory(em, home, 'Food'));
    const { budget } = await addBudget(em, home, { lines: [{ accounts: [home.account, ownPrivate, sharedWithOwner, notShared], amount: 500, category: groceries, year }], name: 'Mine' });
    budget.appuserKey = owner;
    budget.ownerAppuserKey = owner;
    await em.flush();
    await addTransaction(em, home, { account: home.account, amount: -10, category: groceries, date: inThisMonth(), status: 'BOOKED' });
    await addTransaction(em, home, { account: ownPrivate, amount: -5, appuser: owner, category: groceries, date: inThisMonth(), status: 'BOOKED' });
    await addTransaction(em, home, { account: sharedWithOwner, amount: -20, category: groceries, date: inThisMonth(), status: 'BOOKED' });
    await addTransaction(em, home, { account: notShared, amount: -400, category: groceries, date: inThisMonth(), status: 'BOOKED' });
    return { budget, home, owner };
  }

  interface FullBody { budgets: { budgetKey: number; categories: { category_amount: number | string; child_category_name: null | string }[] }[] }
  const groceriesSpent = (body: unknown, budgetKey: number) =>
    Number((body as FullBody).budgets.find((budget) => budget.budgetKey === budgetKey)?.categories.find((category) => category.child_category_name === 'Groceries')?.category_amount);

  it('counts a private account another member shared with its owner, and not one they did not share', async () => {
    const { budget, owner } = await personalBudgetOverEveryKindOfAccount();

    const response = await http.as(owner).get('/v1/budget/full');

    expect(groceriesSpent(response.body, budget.budgetKey)).toBe(35);
  });

  /*
   * The member filter narrows what each budget counts to one member's money; it never changes
   * which budgets are listed. A personal budget is listed for its owner only, so filtering it by
   * another member shows that member's money among what the owner can see, and nobody else ever
   * gets the budget, whoever the filter names.
   */
  it('is narrowed by the member filter like any budget, and stays its owner\'s alone', async () => {
    const { budget, home, owner } = await personalBudgetOverEveryKindOfAccount();

    const byOther = await http.as(owner).get(`/v1/budget/full?memberKeys=${home.appuser.appuserKey}`);
    const byOwner = await http.as(owner).get(`/v1/budget/full?memberKeys=${owner.appuserKey}`);
    const householdOwnerByMember = await http.as(home.appuser).get(`/v1/budget/full?memberKeys=${owner.appuserKey}`);

    expect(groceriesSpent(byOther.body, budget.budgetKey)).toBe(30);
    expect(groceriesSpent(byOwner.body, budget.budgetKey)).toBe(5);
    expect((householdOwnerByMember.body as FullBody).budgets.map((listed) => listed.budgetKey)).not.toContain(budget.budgetKey);
  });

  it('may link its owner\'s private account, which a household budget may not', async () => {
    const setup = await household();
    const ownPrivate = await addAccount(db.em(), setup.home, { isPrivate: true, owner: setup.owner });
    const othersPrivate = await addAccount(db.em(), setup.home, { isPrivate: true, owner: setup.home.appuser });
    const [sharedTemplate] = await budgetRows(db.em(), setup.shared.budget.budgetKey, { year });
    const as = http.as(setup.owner);

    expect((await as.patch(`/v1/budget/${setup.personal.budget.budgetKey}/accounts`).send({ accountKeys: [ownPrivate.accountKey, setup.home.account.accountKey] })).status).toBe(200);
    expect((await as.patch(`/v1/budget/${setup.personal.budget.budgetKey}/accounts`).send({ accountKeys: [othersPrivate.accountKey] })).status).toBe(400);
    expect((await as.patch(`/v1/budget/${setup.shared.budget.budgetKey}/accounts`).send({ accountKeys: [ownPrivate.accountKey] })).status).toBe(400);
    expect((await as.patch(`/v1/budget/${setup.shared.budget.budgetKey}/${sharedTemplate!.budgetTemplateCategoryKey}`).send({ accountKeys: [ownPrivate.accountKey] })).status).toBe(400);
    expect((await as.patch(`/v1/budget/${setup.shared.budget.budgetKey}/accounts`).send({ accountKeys: [setup.home.account.accountKey] })).status).toBe(200);

    const personalRows = await budgetRows(db.em(), setup.personal.budget.budgetKey);
    expect(personalRows.every((row) => row.accounts.getItems().map((account) => account.accountKey).sort((a, b) => a - b).join() === [ownPrivate.accountKey, setup.home.account.accountKey].sort((a, b) => a - b).join())).toBe(true);
    const sharedRows = await budgetRows(db.em(), setup.shared.budget.budgetKey);
    expect(sharedRows.every((row) => row.accounts.getItems().every((account) => account.accountKey === setup.home.account.accountKey))).toBe(true);
  });
});
