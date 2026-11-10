import { describe, expect, it } from 'vitest';

import { addBudget, budgetRows } from '@app/__tests__/__helpers__/budget-fixtures';
import { addAccount, addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { Recurrency } from '@utils/budget';

import { ensureBudgetYear } from '../budget-year.service';

/*
 * A budget has one row per category per month. A new year starts as a copy of the December
 * before it, so a budget made in one year still opens in January of the next.
 */
describe('extending a budget into a new year', () => {
  const db = useTestDatabase();

  it('copies each December row into all twelve months of the next year with its amount, recurrency, rollover setting and accounts', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const savings = await addAccount(em, household, { name: 'Savings' });
    const { budget, categories } = await addBudget(em, household, {
      lines: [
        { accounts: [household.account, savings], amount: 450, months: [12], name: 'Groceries', recurrency: Recurrency.QUARTERLY, rolloverEnabled: true, year: 2026 },
        { accounts: [household.account], amount: 80, months: [11, 12], name: 'Transport', recurrency: Recurrency.MONTHLY, year: 2026 },
      ],
    });
    // November differs from December: the copy must come from December.
    const november = (await budgetRows(db.em(), budget.budgetKey, { year: 2026 })).find((row) => row.month === 11)!;
    november.amountBudgeted = 999;
    await em.flush();

    const created = await ensureBudgetYear(db.em(), { budgetKey: budget.budgetKey, tenantKey: household.tenant.tenantKey, year: 2027 });

    const rows = await budgetRows(db.em(), budget.budgetKey, { year: 2027 });
    expect(created).toBe(24);
    expect(rows).toHaveLength(24);
    const [groceries, transport] = categories;
    const groceryRows = rows.filter((row) => row.categoryKey.categoryKey === groceries!.categoryKey);
    const transportRows = rows.filter((row) => row.categoryKey.categoryKey === transport!.categoryKey);
    expect(groceryRows.map((row) => row.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const row of groceryRows) {
      expect(row).toMatchObject({ amountBudgeted: 450, recurrency: Recurrency.QUARTERLY, rolloverEnabled: true, year: 2027 });
      expect(row.accounts.getItems().map((account) => account.accountKey).sort()).toEqual([household.account.accountKey, savings.accountKey].sort());
    }
    for (const row of transportRows) {
      expect(row).toMatchObject({ amountBudgeted: 80, recurrency: Recurrency.MONTHLY, rolloverEnabled: false, year: 2027 });
      expect(row.accounts.getItems().map((account) => account.accountKey)).toEqual([household.account.accountKey]);
    }
  });

  it('keeps a link to a partner\'s private account when the other member opens the new year', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const partnerPrivate = await addAccount(em, household, { isPrivate: true, owner: partner });
    const { budget } = await addBudget(em, household, { lines: [{ accounts: [household.account, partnerPrivate], amount: 100, name: 'Groceries', year: 2026 }] });

    const ownerRequest = db.em();
    setTenantContext(ownerRequest, { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });
    await ensureBudgetYear(ownerRequest, { budgetKey: budget.budgetKey, tenantKey: household.tenant.tenantKey, year: 2027 });

    const rows = await budgetRows(db.em(), budget.budgetKey, { year: 2027 });
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.accounts.getItems().map((account) => account.accountKey).sort()).toEqual([household.account.accountKey, partnerPrivate.accountKey].sort());
    }
  });

  it('creates no duplicates when it runs again', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { budget } = await addBudget(em, household, { lines: [{ amount: 100, name: 'Groceries', year: 2026 }, { amount: 50, name: 'Transport', year: 2026 }] });
    const target = { budgetKey: budget.budgetKey, tenantKey: household.tenant.tenantKey, year: 2027 };

    await ensureBudgetYear(db.em(), target);
    const second = await ensureBudgetYear(db.em(), target);

    expect(second).toBe(0);
    expect(await budgetRows(db.em(), budget.budgetKey, { year: 2027 })).toHaveLength(24);
  });

  it('creates no duplicates when two extensions of the same year run at once', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { budget } = await addBudget(em, household, { lines: [{ amount: 100, name: 'Groceries', year: 2026 }] });
    const target = { budgetKey: budget.budgetKey, tenantKey: household.tenant.tenantKey, year: 2027 };

    const results = await Promise.all([ensureBudgetYear(db.em(), target), ensureBudgetYear(db.em(), target)]);

    expect(results.reduce((sum, created) => sum + created, 0)).toBe(12);
    expect(await budgetRows(db.em(), budget.budgetKey, { year: 2027 })).toHaveLength(12);
  });

  it('leaves a year alone once it has rows, so a month removed from it is not brought back', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { budget } = await addBudget(em, household, { lines: [{ amount: 100, name: 'Groceries', year: 2026 }, { amount: 60, months: [1, 2], name: 'Gifts', year: 2027 }] });

    const created = await ensureBudgetYear(db.em(), { budgetKey: budget.budgetKey, tenantKey: household.tenant.tenantKey, year: 2027 });

    expect(created).toBe(0);
    expect(await budgetRows(db.em(), budget.budgetKey, { year: 2027 })).toHaveLength(2);
  });

  it('creates nothing when the year before has no December', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { budget } = await addBudget(em, household, { lines: [{ amount: 100, months: [1, 2, 3], name: 'Groceries', year: 2026 }] });

    const created = await ensureBudgetYear(db.em(), { budgetKey: budget.budgetKey, tenantKey: household.tenant.tenantKey, year: 2027 });

    expect(created).toBe(0);
    expect(await budgetRows(db.em(), budget.budgetKey, { year: 2027 })).toHaveLength(0);
  });

  it('does not extend another household\'s budget', async () => {
    const em = db.em();
    const ours = await seedHousehold(em);
    const theirs = await seedHousehold(em);
    const { budget: theirBudget } = await addBudget(em, theirs, { lines: [{ amount: 100, name: 'Groceries', year: 2026 }] });

    // Named with our tenant, and run on an EM whose tenant filter is armed for us, as a request is.
    const scoped = db.em();
    setTenantContext(scoped, { appuserKey: ours.appuser.appuserKey, tenantKey: ours.tenant.tenantKey });
    const viaRequest = await ensureBudgetYear(scoped, { budgetKey: theirBudget.budgetKey, tenantKey: ours.tenant.tenantKey, year: 2027 });
    // Named with our tenant on an unfiltered EM, as the worker runs.
    const viaWorker = await ensureBudgetYear(db.em(), { budgetKey: theirBudget.budgetKey, tenantKey: ours.tenant.tenantKey, year: 2027 });

    expect(viaRequest).toBe(0);
    expect(viaWorker).toBe(0);
    expect(await budgetRows(db.em(), theirBudget.budgetKey, { year: 2027 })).toHaveLength(0);
  });

  it('does not extend a deleted budget', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { budget } = await addBudget(em, household, { deleted: true, lines: [{ amount: 100, name: 'Groceries', year: 2026 }] });

    const created = await ensureBudgetYear(db.em(), { budgetKey: budget.budgetKey, tenantKey: household.tenant.tenantKey, year: 2027 });

    expect(created).toBe(0);
    expect(await budgetRows(db.em(), budget.budgetKey, { year: 2027 })).toHaveLength(0);
  });
});
