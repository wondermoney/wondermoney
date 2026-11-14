import type { EntityManager } from '@mikro-orm/core';

import { DI } from '@app/database/di';
import { demoPersona } from '@app/database/seeders/demo/demo-fixtures';
import { hasReferenceData } from '@app/database/seeders/ReferenceDataSeeder';
import { createSeedRandom } from '@app/database/utils/seed';
import { CURRENT_ONBOARDING_VERSION } from '@app/onboarding-version';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { Currency } from '@entity/Currency';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetPrice } from '@entity/FinancialAssetPrice';
import { Onboarding } from '@entity/Onboarding';
import { Tenant, TenantType } from '@entity/Tenant';
import { TenantStatus } from '@entity/TenantStatus';
import { ensureDemoAuthUser } from '@service/auth/better-auth';
import { demoPortfolioTransactionFixtures } from '@service/demo-data/demo-data-fixtures';
import { type DemoDataRefreshResult, DemoDataRefreshService } from '@service/demo-data/demo-data-refresh.service';
import { upsertDemoHouseholdCore } from '@service/demo-data/demo-household-core';

/**
 * Create or refresh the shared demo account and its household (`pnpm demo:seed`).
 *
 * For a demo instance's database, which `migrate` has already loaded with the reference data and
 * which may hold real users: this writes only the demo account and its household, and running it
 * again converges on the same state instead of adding a second copy.
 *
 * 1. The demo's better-auth user (the canonical demo address), put back in its demo state:
 *    no TOTP, no passkeys, no linked social login, no password if it is new.
 * 2. Its `Appuser` (account type `demo`) and the demo household it owns, with one membership.
 * 3. The household's accounts, budget, portfolios and loans (`upsertDemoHouseholdCore`).
 * 4. A price history for each demo stock that has none at all, so the demo portfolios have a
 *    value on a server without market data. A stock with any price, real or not, is left alone.
 * 5. Its transactions, dated up to `asOfDate`, through the same refresh the daily job runs.
 *
 * It refuses, changing nothing in the household, when the demo address belongs to an account that
 * is not a demo account, when the demo login is linked to another app user, or when the demo
 * household is shared with anyone: those need a person to look at them, not a seeder.
 */

export interface DemoAuthUserPort {
  ensureUser: (input: { email: string; name: string }) => Promise<{ created: boolean; id: string }>;
}

export const betterAuthDemoUserPort: DemoAuthUserPort = { ensureUser: (input) => ensureDemoAuthUser(input) };

export interface DemoSeedResult {
  appuserKey: number;
  authUserCreated: boolean;
  refresh: DemoDataRefreshResult;
  tenantKey: number;
}

export class DemoSeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoSeedRefusedError';
  }
}

export async function seedDemoHousehold(
  options: {
    asOfDate?: Date;
    auth?: DemoAuthUserPort;
    em?: EntityManager;
    refresh?: (em: EntityManager, asOfDate: Date) => Promise<DemoDataRefreshResult>;
  } = {},
): Promise<DemoSeedResult> {
  const em = options.em ?? DI.em;
  const auth = options.auth ?? betterAuthDemoUserPort;
  const asOfDate = options.asOfDate ?? new Date();
  const refresh = options.refresh ?? ((refreshEm, date) => new DemoDataRefreshService({ em: refreshEm }).refresh({ asOfDate: date }));

  if (!(await hasReferenceData(em))) {
    throw new DemoSeedRefusedError('The database has no reference data. Run the migrations first (`pnpm migrate:prd`).');
  }

  const name = `${demoPersona.firstName} ${demoPersona.lastName}`;
  const authUser = await auth.ensureUser({ email: demoPersona.email, name });

  const { appuser, tenant } = await em.transactional(async (tx) => {
    const appuser = await ensureDemoAppuser(tx, authUser.id, asOfDate);
    const tenant = await ensureDemoTenant(tx, appuser);
    await ensureSoleMembership(tx, appuser, tenant);
    await upsertDemoHouseholdCore(tx, appuser, tenant);
    await ensureDemoStockPrices(tx, asOfDate);
    await tx.flush();
    return { appuser, tenant };
  });

  const refreshResult = await refresh(em, asOfDate);

  return {
    appuserKey: appuser.appuserKey,
    authUserCreated: authUser.created,
    refresh: refreshResult,
    tenantKey: tenant.tenantKey,
  };
}

async function ensureDemoAppuser(em: EntityManager, externalUserId: string, now: Date): Promise<Appuser> {
  const byEmail = await em.findOne(Appuser, { emailAddress: demoPersona.email });
  if (byEmail && byEmail.accountType !== AppuserAccountType.DEMO) {
    throw new DemoSeedRefusedError(`${demoPersona.email} belongs to an account that is not the demo account; it was left alone.`);
  }
  const byLogin = await em.findOne(Appuser, { externalUserId });
  if (byLogin && byLogin !== byEmail) {
    throw new DemoSeedRefusedError('The demo login is linked to another app user; it was left alone.');
  }

  const profile = {
    accountType: AppuserAccountType.DEMO,
    deletedAt: null,
    emailAddress: demoPersona.email,
    externalUserId,
    firstName: demoPersona.firstName,
    lastName: demoPersona.lastName,
    // The demo account is read-only, so it could never complete onboarding itself.
    onboarding: await em.find(Onboarding, {}),
    onboardingCompletedVersion: CURRENT_ONBOARDING_VERSION,
    recordActive: true,
  };

  if (byEmail) {
    em.assign(byEmail, { ...profile, onboardingCompletedAt: byEmail.onboardingCompletedAt ?? now });
    return byEmail;
  }

  const currency = await em.findOneOrFail(Currency, { code: demoPersona.primaryCurrency });
  return em.create(Appuser, { ...profile, currencyKey: currency, emailAuthenticated: now, onboardingCompletedAt: now }, { partial: true });
}

async function ensureDemoTenant(em: EntityManager, appuser: Appuser): Promise<Tenant> {
  const tenants = await em.find(Tenant, { deletedAt: null, name: demoPersona.householdName, recordActive: true, tenantType: TenantType.DEMO });
  if (tenants.length > 1) throw new DemoSeedRefusedError(`Found ${tenants.length} demo households; expected one.`);
  const existing = tenants[0];
  if (existing) {
    if (existing.ownerAppuserKey.appuserKey !== appuser.appuserKey) {
      throw new DemoSeedRefusedError('The demo household is owned by another app user; it was left alone.');
    }
    return existing;
  }

  const activeStatus = await em.getRepository(TenantStatus).getActiveStatus();
  if (!activeStatus) throw new DemoSeedRefusedError("The 'active' tenant status is missing from the reference data.");
  return em.create(Tenant, {
    name: demoPersona.householdName,
    ownerAppuserKey: appuser,
    tenantType: TenantType.DEMO,
    tentantStatusKey: activeStatus,
  }, { partial: true });
}

async function ensureSoleMembership(em: EntityManager, appuser: Appuser, tenant: Tenant): Promise<void> {
  // A new demo user and household are not in the database yet; flush so the counts below see them.
  await em.flush();
  const link = await em.findOne(AppuserTenant, { appuserKey: appuser, deletedAt: null, recordActive: true, tenantKey: tenant });
  if (!link) {
    em.create(AppuserTenant, { appuserKey: appuser, recordActive: true, role: HouseholdRole.OWNER, tenantKey: tenant }, { partial: true });
    await em.flush();
  }

  const [memberships, members] = await Promise.all([
    em.count(AppuserTenant, { appuserKey: appuser, deletedAt: null, recordActive: true }),
    em.count(AppuserTenant, { deletedAt: null, recordActive: true, tenantKey: tenant }),
  ]);
  if (memberships !== 1 || members !== 1) {
    throw new DemoSeedRefusedError(
      `The demo household must hold the demo account alone (the demo account has ${memberships} memberships, the household ${members} members).`,
    );
  }
}

/** Days of price history a demo stock gets when it has none, ending on the seed day. */
const DEMO_PRICE_DAYS = 400;
/** Where each demo stock's made-up history starts, near its real price when the fixtures were written. */
const DEMO_BASE_PRICES: Record<string, number> = { AAPL: 120, CRM: 110, GOOGL: 80, INTC: 23, NVDA: 132, TXN: 170 };

async function ensureDemoStockPrices(em: EntityManager, asOfDate: Date): Promise<void> {
  const symbols = [...new Set(demoPortfolioTransactionFixtures.map((fixture) => fixture.symbol))].filter((symbol) => !symbol.startsWith('CURRENCY_'));
  const end = Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), asOfDate.getUTCDate());

  for (const symbol of symbols) {
    const asset = await em.findOne(FinancialAsset, { symbol });
    if (!asset || (await em.count(FinancialAssetPrice, { financialAssetKey: asset })) > 0) continue;

    // A seeded random walk with a slight upward drift, like the development seed's.
    const random = createSeedRandom(`demo-prices:${symbol}`);
    let price = DEMO_BASE_PRICES[symbol] ?? 100;
    for (let day = DEMO_PRICE_DAYS; day >= 0; day -= 1) {
      em.create(FinancialAssetPrice, {
        date: new Date(end - day * 86_400_000),
        financialAssetKey: asset,
        price: Math.round(price * 100) / 100,
        volume: 1_000_000 + Math.floor(random() * 49_000_000),
      }, { partial: true });
      price *= 1 + (random() - 0.48) * 0.03;
    }
  }
}
