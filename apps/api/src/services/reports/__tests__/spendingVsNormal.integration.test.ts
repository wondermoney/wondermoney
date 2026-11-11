import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/assistant/assistant-audit.service', () => ({ AssistantAuditService: { log: vi.fn() } }));

import { addAccount, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Category } from '@entity/Category';
import { InsightsService } from '@service/insights/insights.service';
import { reportFiltersSchema } from '@validators/reports';

import { round2 } from '../csv';
import type { ReportServiceInput } from '../report-filters';
import { SpendingVsNormalReportService } from '../spendingVsNormal.service';

/*
 * At the layer that adds the money up: the report's top-level rows are the same figures the home
 * insight carries for the same month, because both run #108's comparison. A refund nets against
 * its category, a transfer is not spending, and a category with no baseline is neutral.
 */
describe('spending vs normal agrees with the insight it explains', () => {
  const db = useTestDatabase();
  let sequence = 0;
  const NOW = new Date('2026-11-10T18:00:00Z');
  const TIME_ZONE = 'Europe/Lisbon';

  async function seed() {
    const em = db.em();
    const household = await seedHousehold(em);
    const category = (name: string, parentCategory?: Category) =>
      em.create(Category, { appuserKey: household.appuser, bgColor: '#000', name, parentCategory, tenantKey: household.tenant, textColor: '#fff' }, { partial: true });
    const categories = {
      coffee: category('Coffee', category('Treats')),
      food: category('Food'),
      groceries: category('Groceries'),
      rent: category('Rent', category('Home')),
      restaurants: category('Restaurants'),
    };
    categories.groceries.parentCategory = categories.food;
    categories.restaurants.parentCategory = categories.food;
    await em.flush();

    const book = (input: { amount: number; category: Category; date: string }) =>
      addTransaction(em, household, {
        amount: input.amount,
        category: input.category,
        date: new Date(input.date),
        enableBankingTransactionId: `eb-${++sequence}`,
        status: 'BOOKED',
      });

    // Three full baseline months, then November: groceries run hot, rent is steady, coffee's
    // baseline is too small to carry a percentage, and restaurants are new this month.
    for (const month of ['08', '09', '10']) {
      await book({ amount: -100, category: categories.groceries, date: `2026-${month}-05T12:00:00Z` });
      await book({ amount: -300, category: categories.rent, date: `2026-${month}-05T12:00:00Z` });
      await book({ amount: -10, category: categories.coffee, date: `2026-${month}-05T12:00:00Z` });
    }
    await book({ amount: -150, category: categories.groceries, date: '2026-11-05T12:00:00Z' });
    await book({ amount: -50, category: categories.restaurants, date: '2026-11-06T12:00:00Z' });
    await book({ amount: -300, category: categories.rent, date: '2026-11-02T12:00:00Z' });
    await book({ amount: -30, category: categories.coffee, date: '2026-11-03T12:00:00Z' });
    return { household };
  }

  const input = (household: Household): ReportServiceInput => ({
    filters: reportFiltersSchema.parse({ timezone: TIME_ZONE }),
    tenant: household.tenant,
    user: household.appuser,
  });

  it("reports the insight's current and baseline amounts for the same month", async () => {
    const { household } = await seed();

    const report = (await new SpendingVsNormalReportService(undefined, () => NOW).getReport(input(household), '2026-11')).data;
    const { insights } = await new InsightsService(undefined, () => NOW).getInsights({
      appuserKey: household.appuser.appuserKey,
      currency: 'EUR',
      month: '2026-11',
      now: NOW,
      tenantKey: household.tenant.tenantKey,
    });
    const spending = insights.filter((insight) => insight.type === 'spending_vs_normal');

    expect(spending.length).toBeGreaterThan(0);
    for (const insight of spending) {
      const row = report.rows.find((candidate) => candidate.parentKey === null && candidate.categoryKey === String(insight.facts.categoryKey));
      expect(row).toBeDefined();
      // The report rounds money to the cent, like every report endpoint; the insight keeps the
      // stored amount's four decimals.
      expect(row?.total).toBe(round2(Number(insight.facts.currentAmount)));
      expect(row?.normal).toBe(round2(Number(insight.facts.baselineAmount)));
    }
  });

  it('breaks a top-level category into its subcategories, neutral where there is no baseline', async () => {
    const { household } = await seed();

    const { data } = await new SpendingVsNormalReportService(undefined, () => NOW).getReport(input(household), '2026-11');
    const food = data.rows.find((row) => row.name === 'Food' && row.parentKey === null);
    const groceries = data.rows.find((row) => row.name === 'Groceries');
    const restaurants = data.rows.find((row) => row.name === 'Restaurants');

    expect(food).toMatchObject({ normal: 100, ratio: 2, total: 200 });
    expect(groceries).toMatchObject({ normal: 100, parentKey: food?.categoryKey, ratio: 1.5, total: 150 });
    // New this month: a spend tile with no baseline, shown neutral rather than "above normal".
    expect(restaurants).toMatchObject({ normal: null, parentKey: food?.categoryKey, ratio: null, total: 50 });
  });

  it('never counts another household’s spending', async () => {
    const { household } = await seed();
    const other = await seedHousehold(db.em());
    const otherCategory = db.em().create(Category, { appuserKey: other.appuser, bgColor: '#000', name: 'Other household', tenantKey: other.tenant, textColor: '#fff' }, { partial: true });
    await db.em().flush();
    await addTransaction(db.em(), other, {
      amount: -900,
      category: otherCategory,
      date: new Date('2026-11-04T12:00:00Z'),
      enableBankingTransactionId: `eb-${++sequence}`,
      status: 'BOOKED',
    });

    const { data } = await new SpendingVsNormalReportService(undefined, () => NOW).getReport(input(household), '2026-11');

    expect(data.rows.map((row) => row.name)).not.toContain('Other household');
    expect(data.rows.find((row) => row.name === 'Food' && row.parentKey === null)?.total).toBe(200);
  });

  it('never counts another member’s account in the viewer’s rows', async () => {
    const { household } = await seed();
    const partner = await addPartner(db.em(), household);
    const partnerAccount = await addAccount(db.em(), household, { name: 'Partner account', owner: partner });
    const food = db.em().create(Category, { appuserKey: household.appuser, bgColor: '#000', name: 'Food', tenantKey: household.tenant, textColor: '#fff' }, { partial: true });
    await db.em().flush();
    const groceries = db.em().create(Category, { appuserKey: household.appuser, bgColor: '#000', name: 'Groceries', parentCategory: food, tenantKey: household.tenant, textColor: '#fff' }, { partial: true });
    await db.em().flush();
    await addTransaction(db.em(), household, {
      account: partnerAccount,
      amount: -700,
      appuser: partner,
      category: groceries,
      date: new Date('2026-11-04T12:00:00Z'),
      enableBankingTransactionId: `eb-${++sequence}`,
      status: 'BOOKED',
    });

    const { data } = await new SpendingVsNormalReportService(undefined, () => NOW).getReport(input(household), '2026-11');

    // The viewer's own accounts only, exactly as the home insight reads them.
    expect(data.rows.find((row) => row.name === 'Food' && row.parentKey === null)?.total).toBe(200);
  });
});
