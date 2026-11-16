import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { demoPersona } from '@app/database/seeders/demo/demo-fixtures';
import { ReferenceDataSeeder } from '@app/database/seeders/ReferenceDataSeeder';
import { Account } from '@entity/Account';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { Budget } from '@entity/Budget';
import { BudgetTemplateIncome } from '@entity/BudgetTemplateIncome';
import { Category } from '@entity/Category';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { ExpenseGroup } from '@entity/ExpenseGroup';
import { ExpenseGroupExpense } from '@entity/ExpenseGroupExpense';
import { ExpenseGroupSettlement } from '@entity/ExpenseGroupSettlement';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { Goal } from '@entity/Goal';
import { GoalAccountLink } from '@entity/GoalAccountLink';
import { GoalActivity, GoalActivityType } from '@entity/GoalActivity';
import { Installment } from '@entity/Installment';
import { InstallmentPlan } from '@entity/InstallmentPlan';
import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { ManualAsset } from '@entity/ManualAsset';
import { ManualAssetValuation } from '@entity/ManualAssetValuation';
import { Portfolio } from '@entity/Portfolio';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';
import { Rule } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import { Tenant, TenantType } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionTag } from '@entity/TransactionTag';
import { TransactionType } from '@entity/TransactionType';
import { Watchlist } from '@entity/Watchlist';
import {
  type DemoAuthUserPort,
  DemoSeedRefusedError,
  seedDemoHousehold,
} from '@service/demo-data/demo-household-seed.service';

/*
 * The demo seeder on a database shaped like a demo instance's: reference data loaded, possibly
 * real users already there. It runs the real household upserts and the real daily refresh; only
 * the better-auth user is kept in memory, the way `ensureDemoAuthUser` keeps one per address.
 */

const AS_OF = new Date('2026-11-12T00:00:00.000Z');

async function demoCounts(em: EntityManager) {
  const appusers = await em.find(Appuser, { accountType: AppuserAccountType.DEMO });
  const tenants = await em.find(Tenant, { tenantType: TenantType.DEMO });
  const tenant = tenants[0];
  return {
    accounts: await em.count(Account, { tenantKey: tenant }),
    appusers: appusers.length,
    assets: await em.count(ManualAsset, { tenantKey: tenant }),
    budgets: await em.count(Budget, { tenantKey: tenant }),
    cards: await em.count(CreditCardDetail, { tenantKey: tenant }),
    categories: await em.count(AppuserTransactionCategory, { transactionKey: { tenantKey: tenant } }),
    goalActivities: await em.count(GoalActivity, { tenantKey: tenant }),
    goalLinks: await em.count(GoalAccountLink, { tenantKey: tenant }),
    goals: await em.count(Goal, { tenantKey: tenant }),
    groupExpenses: await em.count(ExpenseGroupExpense, { tenantKey: tenant }),
    groups: await em.count(ExpenseGroup, { tenantKey: tenant }),
    income: await em.count(BudgetTemplateIncome, { budgetKey: { tenantKey: tenant } }),
    installments: await em.count(Installment, { tenantKey: tenant }),
    links: await em.count(AppuserTenant, { tenantKey: tenant }),
    loans: await em.count(Loan, { tenantKey: tenant }),
    occurrences: await em.count(RecurringOccurrence, { recurringSeriesKey: { tenantKey: tenant } }),
    plans: await em.count(InstallmentPlan, { tenantKey: tenant }),
    portfolios: await em.count(Portfolio, { tenantKey: tenant }),
    portfolioTransactions: await em.count(FinancialTransaction, { portfolioKey: { tenantKey: tenant } }),
    recurring: await em.count(RecurringSeries, { tenantKey: tenant }),
    repayments: await em.count(LoanRepaymentLink, { tenantKey: tenant }),
    rules: await em.count(Rule, { tenantKey: tenant }),
    settlements: await em.count(ExpenseGroupSettlement, { tenantKey: tenant }),
    tagged: await em.count(TransactionTag, { tenantKey: tenant }),
    tags: await em.count(Tag, { tenantKey: tenant }),
    tenants: tenants.length,
    transactions: await em.count(Transaction, { tenantKey: tenant }),
    valuations: await em.count(ManualAssetValuation, { tenantKey: tenant }),
    watchlist: await em.count(Watchlist, { tenantKey: tenant }),
  };
}

function fakeAuth() {
  const users = new Map<string, string>();
  const port: DemoAuthUserPort = {
    ensureUser: ({ email }) => {
      const existing = users.get(email);
      if (existing) return Promise.resolve({ created: false, id: existing });
      const id = `auth-${users.size + 1}`;
      users.set(email, id);
      return Promise.resolve({ created: true, id });
    },
  };
  return { port, users };
}

async function loadReferenceData(em: EntityManager) {
  await new ReferenceDataSeeder().run(em, {});
  await em.flush();
}

describe('seeding the demo account and household', () => {
  const db = useTestDatabase();

  // Loading the reference data takes a while, so each test that needs it walks a whole story.
  it('creates the demo household beside real users, converges on a second run, moves forward on a later day and refuses a shared household', async () => {
    await loadReferenceData(db.em());
    const regular = await seedHousehold(db.em());
    const auth = fakeAuth();

    const first = await seedDemoHousehold({ asOfDate: AS_OF, auth: auth.port, em: db.em() });

    const afterFirst = await demoCounts(db.em());
    expect(afterFirst).toMatchObject({ accounts: 4, appusers: 2, budgets: 1, links: 2, loans: 2, tenants: 1 });
    expect(afterFirst.portfolios).toBeGreaterThan(0);
    expect(afterFirst.transactions).toBeGreaterThan(0);
    expect(afterFirst.portfolioTransactions).toBeGreaterThan(0);
    // The demo's feature pages have useful, linked examples.
    for (const feature of [
      'categories',
      'income',
      'goals',
      'goalLinks',
      'assets',
      'valuations',
      'recurring',
      'occurrences',
      'repayments',
      'watchlist',
      'goalActivities',
      'tags',
      'tagged',
      'rules',
      'groups',
      'groupExpenses',
      'settlements',
      'plans',
      'installments',
      'cards',
    ] as const) {
      expect(afterFirst[feature]).toBeGreaterThan(0);
    }
    const check = db.em();
    const demo = await check.findOneOrFail(Appuser, { appuserKey: first.appuserKey });
    expect(demo).toMatchObject({
      accountType: AppuserAccountType.DEMO,
      emailAddress: demoPersona.email,
      externalUserId: auth.users.get(demoPersona.email),
    });
    expect((await check.findOneOrFail(AppuserTenant, { appuserKey: demo })).role).toBe(HouseholdRole.OWNER);
    // The real household is untouched.
    expect((await check.findOneOrFail(Appuser, { appuserKey: regular.appuser.appuserKey })).accountType).toBe(
      AppuserAccountType.REGULAR,
    );
    expect(await check.count(Account, { tenantKey: regular.tenant })).toBe(1);
    expect(await check.count(AppuserTenant, { tenantKey: regular.tenant })).toBe(1);

    const goalLink = await check.findOneOrFail(
      GoalAccountLink,
      { tenantKey: { tenantKey: first.tenantKey } },
      { populate: ['accountKey'] },
    );
    expect(goalLink.accountKey.balance).toBeGreaterThan(0);
    expect(
      await check.count(Transaction, { installmentPlanKey: { $ne: null }, tenantKey: { tenantKey: first.tenantKey } }),
    ).toBe(3);
    const activities = await check.find(GoalActivity, { tenantKey: { tenantKey: first.tenantKey } });
    expect(
      activities.some((activity) => activity.type === GoalActivityType.ASSIGNED && Number(activity.amount) > 0),
    ).toBe(true);
    const salaries = await check.find(Transaction, {
      externalTransactionId: { $like: 'DEMO-BANK-TXN-SALARY-%' },
      tenantKey: { tenantKey: first.tenantKey },
    });
    expect(new Set(salaries.map((row) => row.transactionDate?.toISOString().slice(0, 7))).size).toBeGreaterThanOrEqual(
      4,
    );
    const accounts = await check.find(Account, { tenantKey: { tenantKey: first.tenantKey } });
    expect(accounts.every((account) => account.refreshedAt && account.refreshedAt <= AS_OF)).toBe(true);

    // Older demos had a withdrawal on the savings account. Repair it in place so
    // the globally unique transaction identity cannot collide with a new row.
    const legacyTransfer = await check.findOneOrFail(
      Transaction,
      {
        externalTransactionId: 'DEMO-BANK-TXN-SAVINGS-TRANSFER-00',
        tenantKey: { tenantKey: first.tenantKey },
      },
      { populate: ['accountKey'] },
    );
    const transferKey = legacyTransfer.transactionKey;
    expect(legacyTransfer.accountKey?.accountName).toBe('Emergency Fund');
    legacyTransfer.settlementAmount = -500;
    legacyTransfer.transactionTypeKey = await check.findOneOrFail(TransactionType, { name: 'TRANSFER_OUT' });
    const legacyCategory = await check.findOneOrFail(AppuserTransactionCategory, {
      appuserKey: demo,
      transactionKey: { externalTransactionId: 'DEMO-BANK-TXN-SALARY-00' },
    });
    const categoryKey = legacyCategory.appuserTransactionCategoryKey;
    const salaryCategoryKey = legacyCategory.categoryKey.categoryKey;
    legacyCategory.categoryKey = await check.findOneOrFail(Category, { isSystemCategory: true, name: 'GIFTS' });
    await check.flush();

    // Idempotent: the same account, household and rows.
    const second = await seedDemoHousehold({ asOfDate: AS_OF, auth: auth.port, em: db.em() });
    expect(second).toMatchObject({ appuserKey: first.appuserKey, authUserCreated: false, tenantKey: first.tenantKey });
    expect(first.authUserCreated).toBe(true);
    expect(await demoCounts(db.em())).toEqual(afterFirst);
    const repaired = await db
      .em()
      .findOneOrFail(Transaction, { transactionKey: transferKey }, { populate: ['transactionTypeKey'] });
    expect(repaired.settlementAmount).toBe(500);
    expect(repaired.transactionTypeKey?.name).toBe('TRANSFER_IN');
    const repairedCategory = await db
      .em()
      .findOneOrFail(AppuserTransactionCategory, { appuserTransactionCategoryKey: categoryKey });
    expect(repairedCategory.categoryKey.categoryKey).toBe(salaryCategoryKey);

    // A later day moves the demo transactions forward to it.
    const later = new Date('2026-11-20T00:00:00.000Z');
    await seedDemoHousehold({ asOfDate: later, auth: auth.port, em: db.em() });
    const newest = await db
      .em()
      .findOneOrFail(
        Transaction,
        { tenantKey: { tenantKey: first.tenantKey } },
        { orderBy: { transactionDate: 'desc' } },
      );
    expect(newest.transactionDate?.getTime()).toBe(later.getTime());

    const moved = db.em();
    const recurring = await moved.find(RecurringSeries, { tenantKey: { tenantKey: first.tenantKey } });
    expect(recurring.every((series) => series.nextExpectedAt && series.nextExpectedAt > later)).toBe(true);
    const repayment = await moved.findOneOrFail(
      LoanRepaymentLink,
      { tenantKey: { tenantKey: first.tenantKey } },
      { populate: ['transactionKey'] },
    );
    expect(repayment.paymentDate).toEqual(repayment.transactionKey.transactionDate);
    expect(repayment.totalPaymentAmount).toBe(
      repayment.principalAmount + repayment.interestAmount + repayment.feeAmount,
    );
    expect(await demoCounts(db.em())).toEqual(afterFirst);

    // Somebody else in the demo household: refused.
    const em = db.em();
    const demoHousehold = await em.findOneOrFail(Tenant, { tenantKey: first.tenantKey });
    em.create(
      AppuserTenant,
      {
        appuserKey: await em.findOneOrFail(Appuser, { appuserKey: regular.appuser.appuserKey }),
        recordActive: true,
        role: HouseholdRole.MEMBER,
        tenantKey: demoHousehold,
      },
      { partial: true },
    );
    await em.flush();
    await expect(seedDemoHousehold({ asOfDate: later, auth: auth.port, em: db.em() })).rejects.toBeInstanceOf(
      DemoSeedRefusedError,
    );
  }, 300_000);

  it('refuses to turn a real account with the demo address into the demo', async () => {
    await loadReferenceData(db.em());
    const em = db.em();
    const regular = await seedHousehold(em);
    regular.appuser.emailAddress = demoPersona.email;
    await em.flush();

    await expect(seedDemoHousehold({ asOfDate: AS_OF, auth: fakeAuth().port, em: db.em() })).rejects.toBeInstanceOf(
      DemoSeedRefusedError,
    );

    const check = db.em();
    expect((await check.findOneOrFail(Appuser, { appuserKey: regular.appuser.appuserKey })).accountType).toBe(
      AppuserAccountType.REGULAR,
    );
    expect(await check.count(Tenant, { tenantType: TenantType.DEMO })).toBe(0);
  }, 300_000);

  it('refuses a database without reference data', async () => {
    await expect(seedDemoHousehold({ asOfDate: AS_OF, auth: fakeAuth().port, em: db.em() })).rejects.toBeInstanceOf(
      DemoSeedRefusedError,
    );
  });
});
