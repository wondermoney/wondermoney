import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { getAccountsCashflow } from '@controller/account/cashflow';
import { getCategorySpending } from '@controller/account/transactions';
import type { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import type { Category } from '@entity/Category';
import { Transaction } from '@entity/Transaction';
import { getBudgetSpending } from '@service/budget/spending';
import { type MemberFilter, parseMemberFilter, SHARED_MEMBER } from '@service/household/member-attribution';
import { NetWorthService } from '@service/net-worth/net-worth.service';
import { getBudgetVsActualReport } from '@service/reports/budgetVsActual.service';
import { getCashflowReport } from '@service/reports/cashflow.service';
import { getMonthComparisonReport } from '@service/reports/monthComparison.service';
import { getSankeyReport } from '@service/reports/sankey.service';
import { getSpendingByCategoryReport } from '@service/reports/spendingByCategory.service';
import { SpendingVsNormalReportService } from '@service/reports/spendingVsNormal.service';
import { listTransactions } from '@service/transaction/transaction-list.service';
import type { TransactionFilterInput } from '@service/transaction/transaction-total.service';
import { roundDisplay } from '@utils/money';
import { reportFiltersSchema } from '@validators/reports';

/*
 * The member filter, in every aggregate. One household:
 *
 * - the owner (the viewer unless a test says otherwise), a partner, a third member (Kid), and a
 *   former member who left but whose account stayed;
 * - the owner's current account: 100 of the owner's spending, 40 the partner spent ("Spent by"),
 *   30 marked Shared, and 2000 of income;
 * - the owner's private account: 5;
 * - the partner's shared account: 20, and 7 the owner spent;
 * - the partner's private account: 50, which only the partner ever sees;
 * - a joint account (the owner's): 60 Shared, and 9 Kid spent;
 * - the former member's account: 11, Shared now that they have left;
 * - another household's 1000, which never counts.
 *
 * So, for the owner: owner 112, partner 60, Kid 9, Shared 101, household 282. Each split adds up
 * to the household total, and filtering by the partner never brings in the partner's private 50.
 */
describe('the member filter, in every total', () => {
  const db = useTestDatabase();
  const TIME_ZONE = 'UTC';
  const JULY = { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-31T23:59:59.999Z' };
  const day = (date: number) => new Date(Date.UTC(2026, 6, date, 12));

  interface Scenario {
    accounts: Record<'formerMembers' | 'joint' | 'ownerChecking' | 'ownerPrivate' | 'partnerPrivate' | 'partnerShared', Account>;
    groceries: Category;
    household: Household;
    kid: Appuser;
    owner: Appuser;
    partner: Appuser;
    templateKeys: number[];
  }

  let scenario: Scenario;

  async function attribute(transaction: Transaction, values: Pick<Transaction, 'attributedAppuserKey' | 'attributedToShared'>) {
    const em = db.em();
    const stored = await em.findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false });
    Object.assign(stored, values);
    await em.flush();
  }

  async function seed(): Promise<Scenario> {
    const em = db.em();
    const household = await seedHousehold(em);
    const owner = household.appuser;
    const partner = await addPartner(em, household);
    const kid = await addPartner(em, household);
    const former = await addPartner(em, household);
    const food = await addCategory(em, household, 'Food');
    const groceries = await addCategory(em, household, 'Groceries', food);
    // The household's categories, made by the owner (the aggregation behind spending vs normal reads them so).
    food.appuserKey = owner;
    groceries.appuserKey = owner;

    const ownerChecking = household.account;
    ownerChecking.balance = 1000;
    ownerChecking.appuserCurrencyBalance = 1000;
    const ownerPrivate = await addAccount(em, household, { appuserCurrencyBalance: 300, balance: 300, isPrivate: true, name: 'Owner savings' });
    const partnerShared = await addAccount(em, household, { appuserCurrencyBalance: 200, balance: 200, name: 'Partner checking', owner: partner });
    const partnerPrivate = await addAccount(em, household, { appuserCurrencyBalance: 5000, balance: 5000, isPrivate: true, name: 'Partner private', owner: partner });
    const joint = await addAccount(em, household, { appuserCurrencyBalance: 400, balance: 400, name: 'Joint' });
    joint.isJoint = true;
    const formerMembers = await addAccount(em, household, { appuserCurrencyBalance: 70, balance: 70, name: 'Former member', owner: former });
    await em.flush();

    const add = (input: Omit<Parameters<typeof addTransaction>[2], 'date' | 'status'>) => addTransaction(em, household, { category: groceries, date: day(10), status: 'BOOKED', ...input });
    await add({ amount: 2000, category: undefined });
    await add({ amount: -100 });
    await attribute(await add({ amount: -40 }), { attributedAppuserKey: partner, attributedToShared: false });
    await attribute(await add({ amount: -30 }), { attributedAppuserKey: null, attributedToShared: true });
    await add({ account: ownerPrivate, amount: -5 });
    await add({ account: partnerShared, amount: -20, appuser: partner });
    await attribute(await add({ account: partnerShared, amount: -7, appuser: partner }), { attributedAppuserKey: owner, attributedToShared: false });
    await add({ account: partnerPrivate, amount: -50, appuser: partner });
    await add({ account: joint, amount: -60 });
    await attribute(await add({ account: joint, amount: -9 }), { attributedAppuserKey: kid, attributedToShared: false });
    await add({ account: formerMembers, amount: -11, appuser: former });

    // The former member leaves; their account and its rows stay in the household.
    const membership = await em.findOneOrFail(AppuserTenant, { appuserKey: former, tenantKey: household.tenant });
    membership.recordActive = false;
    await em.flush();

    const other = await seedHousehold(em);
    await addTransaction(em, other, { amount: -1000, date: day(10), status: 'BOOKED' });

    const budget = em.create(Budget, { appuserKey: owner, currencyKey: household.currency, name: 'Home', numAdults: 2, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    const template = em.create(BudgetTemplateCategory, { amountBudgeted: 500, budgetKey: budget, categoryKey: groceries, month: 7, year: 2026 }, { partial: true });
    await em.flush();

    return {
      accounts: { formerMembers, joint, ownerChecking, ownerPrivate, partnerPrivate, partnerShared },
      groceries,
      household,
      kid,
      owner,
      partner,
      templateKeys: [template.budgetTemplateCategoryKey],
    };
  }

  beforeEach(async () => {
    scenario = await seed();
  });

  /** Each active member's key, and Shared: the parts the household total splits into. */
  const parts = () => [String(scenario.owner.appuserKey), String(scenario.partner.appuserKey), String(scenario.kid.appuserKey), SHARED_MEMBER];
  const sum = (values: number[]) => roundDisplay(values.reduce((total, value) => total + value, 0));
  const memberKeysOf = (value: string | undefined): Record<string, string[]> => (value === undefined ? {} : { memberKeys: [value] });

  const reportInput = (memberKey?: string, viewer: Appuser = scenario.owner) => ({
    filters: reportFiltersSchema.parse({ ...JULY, timezone: TIME_ZONE, ...memberKeysOf(memberKey) }),
    tenant: scenario.household.tenant,
    user: viewer,
  });

  async function listed(memberKey?: string, viewer: Appuser = scenario.owner, extra: TransactionFilterInput = {}) {
    const members: MemberFilter | undefined = parseMemberFilter(memberKey === undefined ? undefined : [memberKey]);
    const page = await listTransactions({
      filters: { excludeNonSpending: true, excludeTransfers: true, fromDate: new Date(JULY.fromDate), members, statuses: ['BOOKED'], timeZone: TIME_ZONE, toDate: new Date(JULY.toDate), ...extra },
      limit: 500,
      scope: 'all-accounts',
      tenantKey: scenario.household.tenant.tenantKey,
      viewerAppuserKey: viewer.appuserKey,
    });
    return { moneyOut: roundDisplay(page.moneyOut ?? Number.NaN), rows: page.transactions };
  }

  async function callHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>, query: Record<string, string | string[]>): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    const res = { json: (payload: Record<string, unknown>) => { body = payload; return res; }, status: () => res } as unknown as Response;
    await handler({ body: {}, headers: {}, params: {}, query, tenant: scenario.household.tenant, user: scenario.owner } as unknown as Request, res, () => undefined);
    return body;
  }

  describe('the transaction list', () => {
    it('lists each member\'s rows, and the parts add up to the household', async () => {
      const totals = await Promise.all(parts().map(async (part) => (await listed(part)).moneyOut));

      expect(totals).toEqual([112, 60, 9, 101]);
      expect(sum(totals)).toBe((await listed()).moneyOut);
      expect((await listed()).moneyOut).toBe(282);
    });

    it('never shows another member\'s private account, filtered by that member or not', async () => {
      const partners = await listed(String(scenario.partner.appuserKey));

      expect(partners.rows.map((row) => row.settlementAmount)).not.toContain(-50);
      expect(partners.rows.map((row) => row.accountKey?.accountKey)).not.toContain(scenario.accounts.partnerPrivate.accountKey);
    });

    it('shows the partner their own private account when they filter by themselves', async () => {
      const own = await listed(String(scenario.partner.appuserKey), scenario.partner);
      const owners = await listed(String(scenario.owner.appuserKey), scenario.partner);

      expect(own.moneyOut).toBe(110);
      // The owner's private 5 stays the owner's.
      expect(owners.moneyOut).toBe(107);
    });

    it('carries each row\'s attribution by key and name', async () => {
      const { rows } = await listed();
      const byAmount = new Map(rows.map((row) => [row.settlementAmount, row.attribution]));

      expect(byAmount.get(-40)).toEqual({ appuserKey: scenario.partner.appuserKey, displayName: 'Partner', overridden: true });
      expect(byAmount.get(-100)).toEqual({ appuserKey: scenario.owner.appuserKey, displayName: 'Owner', overridden: false });
      expect(byAmount.get(-60)).toEqual({ appuserKey: null, displayName: null, overridden: false });
      expect(byAmount.get(-30)).toEqual({ appuserKey: null, displayName: null, overridden: true });
    });

    it('matches nothing for a member of another household', async () => {
      const other = await seedHousehold(db.em());

      expect((await listed(String(other.appuser.appuserKey))).rows).toEqual([]);
    });
  });

  describe('reports', () => {
    it('spending by category splits the household total between the members and Shared', async () => {
      const total = async (part?: string) => sum((await getSpendingByCategoryReport(reportInput(part))).data.map((row) => row.totalAmount));

      const totals = await Promise.all(parts().map(total));
      expect(totals).toEqual([112, 60, 9, 101]);
      expect(sum(totals)).toBe(await total());
    });

    it('cash flow puts the income with its member and splits the expenses the same way', async () => {
      const month = async (part?: string) => (await getCashflowReport(reportInput(part))).data[0] ?? { expenses: 0, income: 0 };

      const months = await Promise.all(parts().map(month));
      expect(months.map((row) => [row.income, row.expenses])).toEqual([[2000, 112], [0, 60], [0, 9], [0, 101]]);
      expect(sum(months.map((row) => row.expenses))).toBe((await month()).expenses);
    });

    it('the Sankey diagram\'s expense flows add up the same way', async () => {
      const expenses = async (part?: string) => sum((await getSankeyReport(reportInput(part))).data.nodes.filter((node) => node.kind === 'expense').map((node) => node.value ?? 0));

      const totals = await Promise.all(parts().map(expenses));
      expect(totals).toEqual([112, 60, 9, 101]);
      expect(sum(totals)).toBe(await expenses());
    });

    it('budget vs actual measures each member\'s spending against the budget', async () => {
      const actual = async (part?: string) => sum((await getBudgetVsActualReport(reportInput(part))).data.map((row) => row.actual));

      const totals = await Promise.all(parts().map(actual));
      expect(totals).toEqual([112, 60, 9, 101]);
      expect(sum(totals)).toBe(await actual());
    });

    it('month comparison compares one member\'s months', async () => {
      const report = await getMonthComparisonReport(reportInput(String(scenario.partner.appuserKey)), { base: '2026-07', compare: '2026-06' });

      expect(report.data.base.expenses).toBe(60);
      expect(report.data.categories.map((row) => row.base)).toEqual([60]);
    });

    it('spending vs normal reads the viewer\'s own accounts by who spent the money', async () => {
      // The report reads the viewer's own accounts: the current account, the private one and the
      // joint one. Owner 100 + 5, partner 40, Kid 9, Shared 30 + 60.
      const service = new SpendingVsNormalReportService(undefined, () => new Date('2026-07-20T12:00:00Z'));
      const food = async (part?: string) => (await service.getReport(reportInput(part), '2026-07')).data.rows.find((row) => row.parentKey === null)?.total ?? 0;

      const totals = await Promise.all(parts().map(food));
      expect(totals).toEqual([105, 40, 9, 90]);
      expect(sum(totals)).toBe(await food());
    });

    it('never counts the partner\'s private account when the owner filters by the partner', async () => {
      const report = await getSpendingByCategoryReport(reportInput(String(scenario.partner.appuserKey)));

      expect(sum(report.data.map((row) => row.totalAmount))).toBe(60);
    });
  });

  describe('the dashboard', () => {
    it('cash flow for one member is that member\'s part of the month', async () => {
      const july = async (part?: string) => {
        const body = await callHandler(getAccountsCashflow, { fromDate: JULY.fromDate, timezone: TIME_ZONE, ...memberKeysOf(part) });
        return (body['cashflow'] as { date: string; expenses: number }[]).find((month) => month.date.startsWith('2026-07'))?.expenses ?? 0;
      };

      const totals = await Promise.all(parts().map(july));
      expect(totals).toEqual([112, 60, 9, 101]);
      expect(sum(totals)).toBe(await july());
    });

    it('category spending for one member is that member\'s part', async () => {
      const spent = async (part?: string) => {
        const body = await callHandler(getCategorySpending, { fromDate: JULY.fromDate, timezone: TIME_ZONE, toDate: JULY.toDate, ...memberKeysOf(part) });
        return sum((body['categorySpending'] as { amount: number }[]).map((row) => row.amount));
      };

      const totals = await Promise.all(parts().map(spent));
      expect(totals).toEqual([112, 60, 9, 101]);
      expect(sum(totals)).toBe(await spent());
    });
  });

  it('budget spending splits the category\'s spending between the members and Shared', async () => {
    const accounts = Object.values(scenario.accounts);
    const spent = async (part?: string) => {
      const { categories } = await getBudgetSpending({
        accountKeys: accounts.map((account) => account.accountKey),
        currency: { code: 'EUR', currencyKey: scenario.household.currency.currencyKey },
        members: parseMemberFilter(part === undefined ? undefined : [part]),
        period: 'monthly',
        periodStartDay: 1,
        templateKeys: scenario.templateKeys,
        tenantKey: scenario.household.tenant.tenantKey,
        viewerAppuserKey: scenario.owner.appuserKey,
      });
      // A member with no spending has no row.
      return Number(categories.find((row) => row.child_category_name === 'Groceries')?.category_amount) || 0;
    };

    const totals = await Promise.all(parts().map(spent));
    expect(totals).toEqual([112, 60, 9, 101]);
    expect(sum(totals)).toBe(await spent());
  });

  describe('net worth', () => {
    // Net worth reads accounts through the tenant filter, armed for the viewer as a request arms it.
    const netWorth = (part?: string, viewer: Appuser = scenario.owner) => {
      DI.em = db.em();
      setTenantContext(DI.em, { appuserKey: viewer.appuserKey, tenantKey: scenario.household.tenant.tenantKey });
      return new NetWorthService().getNetWorth(viewer, { members: parseMemberFilter(part === undefined ? undefined : [part]) });
    };

    it('counts the accounts a member owns; a joint account, and a former member\'s, are Shared', async () => {
      const totals = await Promise.all(parts().map(async (part) => (await netWorth(part)).totalNetWorth));

      // Owner 1000 + 300 private; partner 200 (their private 5000 is not the owner's to see); Kid none;
      // Shared: the joint 400 and the former member's 70.
      expect(totals).toEqual([1300, 200, 0, 470]);
      expect(sum(totals)).toBe((await netWorth()).totalNetWorth);
    });

    it('lists only the member\'s accounts, never another member\'s private one', async () => {
      const partners = await netWorth(String(scenario.partner.appuserKey));

      expect(partners.rows.map((row) => row.id)).toEqual([scenario.accounts.partnerShared.accountKey]);
    });

    it('gives the partner their own private account in their own net worth', async () => {
      expect((await netWorth(String(scenario.partner.appuserKey), scenario.partner)).totalNetWorth).toBe(5200);
    });
  });
});
