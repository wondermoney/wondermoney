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
import { Budget } from '@entity/Budget';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { Loan } from '@entity/Loan';
import { Portfolio } from '@entity/Portfolio';
import { Tenant, TenantType } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { type DemoAuthUserPort, DemoSeedRefusedError, seedDemoHousehold } from '@service/demo-data/demo-household-seed.service';

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
    budgets: await em.count(Budget, { tenantKey: tenant }),
    links: await em.count(AppuserTenant, { tenantKey: tenant }),
    loans: await em.count(Loan, { tenantKey: tenant }),
    portfolios: await em.count(Portfolio, { tenantKey: tenant }),
    portfolioTransactions: await em.count(FinancialTransaction, { portfolioKey: { tenantKey: tenant } }),
    tenants: tenants.length,
    transactions: await em.count(Transaction, { tenantKey: tenant }),
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
    expect(afterFirst).toMatchObject({ accounts: 3, appusers: 1, budgets: 1, links: 1, loans: 2, tenants: 1 });
    expect(afterFirst.portfolios).toBeGreaterThan(0);
    expect(afterFirst.transactions).toBeGreaterThan(0);
    expect(afterFirst.portfolioTransactions).toBeGreaterThan(0);
    const check = db.em();
    const demo = await check.findOneOrFail(Appuser, { appuserKey: first.appuserKey });
    expect(demo).toMatchObject({ accountType: AppuserAccountType.DEMO, emailAddress: demoPersona.email, externalUserId: auth.users.get(demoPersona.email) });
    expect((await check.findOneOrFail(AppuserTenant, { appuserKey: demo })).role).toBe(HouseholdRole.OWNER);
    // The real household is untouched.
    expect((await check.findOneOrFail(Appuser, { appuserKey: regular.appuser.appuserKey })).accountType).toBe(AppuserAccountType.REGULAR);
    expect(await check.count(Account, { tenantKey: regular.tenant })).toBe(1);
    expect(await check.count(AppuserTenant, { tenantKey: regular.tenant })).toBe(1);

    // Idempotent: the same account, household and rows.
    const second = await seedDemoHousehold({ asOfDate: AS_OF, auth: auth.port, em: db.em() });
    expect(second).toMatchObject({ appuserKey: first.appuserKey, authUserCreated: false, tenantKey: first.tenantKey });
    expect(first.authUserCreated).toBe(true);
    expect(await demoCounts(db.em())).toEqual(afterFirst);

    // A later day moves the demo transactions forward to it.
    const later = new Date('2026-11-20T00:00:00.000Z');
    await seedDemoHousehold({ asOfDate: later, auth: auth.port, em: db.em() });
    const newest = await db.em().findOneOrFail(Transaction, { tenantKey: { tenantKey: first.tenantKey } }, { orderBy: { transactionDate: 'desc' } });
    expect(newest.transactionDate?.getTime()).toBe(later.getTime());

    // Somebody else in the demo household: refused.
    const em = db.em();
    const demoHousehold = await em.findOneOrFail(Tenant, { tenantKey: first.tenantKey });
    em.create(AppuserTenant, { appuserKey: await em.findOneOrFail(Appuser, { appuserKey: regular.appuser.appuserKey }), recordActive: true, role: HouseholdRole.MEMBER, tenantKey: demoHousehold }, { partial: true });
    await em.flush();
    await expect(seedDemoHousehold({ asOfDate: later, auth: auth.port, em: db.em() })).rejects.toBeInstanceOf(DemoSeedRefusedError);
  }, 300_000);

  it('refuses to turn a real account with the demo address into the demo', async () => {
    await loadReferenceData(db.em());
    const em = db.em();
    const regular = await seedHousehold(em);
    regular.appuser.emailAddress = demoPersona.email;
    await em.flush();

    await expect(seedDemoHousehold({ asOfDate: AS_OF, auth: fakeAuth().port, em: db.em() })).rejects.toBeInstanceOf(DemoSeedRefusedError);

    const check = db.em();
    expect((await check.findOneOrFail(Appuser, { appuserKey: regular.appuser.appuserKey })).accountType).toBe(AppuserAccountType.REGULAR);
    expect(await check.count(Tenant, { tenantType: TenantType.DEMO })).toBe(0);
  }, 300_000);

  it('refuses a database without reference data', async () => {
    await expect(seedDemoHousehold({ asOfDate: AS_OF, auth: fakeAuth().port, em: db.em() })).rejects.toBeInstanceOf(DemoSeedRefusedError);
  });
});
