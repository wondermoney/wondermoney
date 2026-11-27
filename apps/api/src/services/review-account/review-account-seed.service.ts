import { randomUUID } from 'node:crypto';

import type { EntityManager as CoreEntityManager } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';

import { DI } from '@app/database/di';
import { demoCompanion } from '@app/database/seeders/demo/demo-fixtures';
import { hasReferenceData } from '@app/database/seeders/ReferenceDataSeeder';
import { CURRENT_ONBOARDING_VERSION } from '@app/onboarding-version';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { Currency } from '@entity/Currency';
import { Onboarding } from '@entity/Onboarding';
import { Tenant, TenantType } from '@entity/Tenant';
import { TenantStatus } from '@entity/TenantStatus';
import { betterAuthReviewUserPort } from '@service/auth/better-auth';
import { isDemoAccountEmail } from '@service/auth/demo-session';
import { isInstanceSetUp } from '@service/auth/instance-admin.service';
import type { DemoRefreshIdentityResolution } from '@service/demo-data/demo-data-refresh-identity';
import { type DemoDataRefreshResult, DemoDataRefreshService } from '@service/demo-data/demo-data-refresh.service';
import { upsertDemoHouseholdCore } from '@service/demo-data/demo-household-core';
import { ensureDemoStockPrices } from '@service/demo-data/demo-household-seed.service';
import { generateReviewPassword, type ReviewAuthUserPort } from '@service/review-account/review-auth-user';

/**
 * Create or refresh the store-review account (`pnpm review:seed`): an ordinary account that app
 * store and AI-directory reviewers sign in to with an email and a password, in a household of its
 * own holding the demo's sample data (accounts, a few months of categorized transactions, a budget,
 * a goal, recurring payments, loans and portfolios), dated up to `asOfDate`.
 *
 * It is not the demo account: a regular account in a regular household, so the demo's two-hour
 * session cap, its read-only guards and the demo jobs leave it alone. The demo's non-login example
 * member stays in the demo household.
 *
 * 1. The `Appuser` (the given address) and the household it owns alone, named
 *    `reviewPersona.householdName`. That name, a regular account and a household with no other
 *    member are how a rerun knows the account as the review account.
 * 2. The household's core objects, price histories for demo stocks with none, then its
 *    transactions and linked examples through the demo's refresh.
 * 3. The better-auth user, last, so a run that fails before it leaves no way in: a verified address
 *    and a password. A new user gets a generated one, returned once in the result; an existing one
 *    keeps its own unless `resetPassword`, which also locks the previous holder out. Two-factor is
 *    off on a new user; a rerun leaves it as it is unless `resetPassword` or `disableTwoFactor`,
 *    since a reviewer can receive no code and OAuth consent asks for one while it is on.
 *
 * It refuses, changing nothing, when the address belongs to anybody else: an account that is not
 * the review account, or a better-auth login that is not the review account's. It refuses on a
 * server that is not set up yet, so the review account never becomes its first account and admin.
 */

export const reviewPersona = {
  firstName: 'App',
  householdName: 'App review household',
  lastName: 'Reviewer',
  primaryCurrency: 'EUR',
} as const;

export interface ReviewSeedResult {
  appuserKey: number;
  authUserCreated: boolean;
  /** The password set by this run (a new account, or `resetPassword`); absent when it was kept. */
  password?: string;
  refresh: DemoDataRefreshResult;
  tenantKey: number;
  /** Whether this run turned two-factor sign-in off (it was on). */
  twoFactorDisabled: boolean;
}

export class ReviewSeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewSeedRefusedError';
  }
}

/** The address as better-auth stores it, or a refusal when it is not one the review account may use. */
export function reviewAccountEmail(input: null | string | undefined): string {
  const email = (input ?? '').trim().toLowerCase();
  if (!email) throw new ReviewSeedRefusedError('The review account needs an email address.');
  if (!z.email().safeParse(email).success) throw new ReviewSeedRefusedError(`Not an email address: ${email}`);
  if (isDemoAccountEmail(email) || email === demoCompanion.email) {
    throw new ReviewSeedRefusedError('The review account cannot use the demo account\'s address.');
  }
  return email;
}

export async function seedReviewAccount(options: {
  asOfDate?: Date;
  auth?: ReviewAuthUserPort;
  disableTwoFactor?: boolean;
  em?: EntityManager;
  email: string;
  generatePassword?: () => string;
  resetPassword?: boolean;
}): Promise<ReviewSeedResult> {
  const email = reviewAccountEmail(options.email);
  const em = options.em ?? DI.em;
  const auth = options.auth ?? betterAuthReviewUserPort;
  const asOfDate = options.asOfDate ?? new Date();
  const generatePassword = options.generatePassword ?? generateReviewPassword;

  if (!(await hasReferenceData(em))) {
    throw new ReviewSeedRefusedError('The database has no reference data. Run the migrations first (`pnpm migrate:prd`).');
  }
  // The first account on a new server is its admin and closes its setup page. The review account
  // must not be that account: set the server up first.
  if (!(await isInstanceSetUp(em.fork()))) {
    throw new ReviewSeedRefusedError(
      'This server is not set up yet: create its first account (its admin) before the review account.',
    );
  }

  const existing = await findReviewAccount(em.fork(), email);
  const authByEmail = await auth.findUserByEmail(email);
  const externalUserId = existing?.externalUserId ?? randomUUID();
  if (authByEmail && authByEmail.id !== externalUserId) {
    throw new ReviewSeedRefusedError(`${email} already signs in to an account that is not the review account; it was left alone.`);
  }
  const authUser = authByEmail ?? (existing ? await auth.findUserById(externalUserId) : null);
  if (authUser && authUser.email.toLowerCase() !== email) {
    throw new ReviewSeedRefusedError('The review account\'s login has another address now; it was left alone.');
  }

  const { appuserKey, tenantKey } = await em.transactional(async (tx) => {
    const appuser = await ensureReviewAppuser(tx, email, externalUserId, asOfDate);
    const tenant = await ensureReviewTenant(tx, appuser);
    await ensureReviewMembership(tx, appuser, tenant);
    await upsertDemoHouseholdCore(tx, appuser, tenant);
    await ensureDemoStockPrices(tx, asOfDate);
    await tx.flush();
    return { appuserKey: appuser.appuserKey, tenantKey: tenant.tenantKey };
  });

  const refresh = await new DemoDataRefreshService({
    em,
    // Unique across the database, so the demo's sample portfolio rows and these never collide.
    portfolioInternalIdPrefix: `REVIEW-${tenantKey}-PORTFOLIO-INTERNAL-`,
    resolveIdentity: (refreshEm) => resolveReviewIdentity(refreshEm, appuserKey, tenantKey),
    withCompanion: false,
  }).refresh({ asOfDate });

  const password = !authUser || options.resetPassword || !authUser.hasPassword ? generatePassword() : undefined;
  const { created, twoFactorDisabled } = await auth.ensureUser({
    disableTwoFactor: options.resetPassword === true || options.disableTwoFactor === true,
    email,
    id: externalUserId,
    name: `${reviewPersona.firstName} ${reviewPersona.lastName}`,
    password,
  });

  return { appuserKey, authUserCreated: created, refresh, tenantKey, twoFactorDisabled, ...(password ? { password } : {}) };
}

async function ensureReviewAppuser(em: EntityManager, email: string, externalUserId: string, now: Date): Promise<Appuser> {
  const profile = {
    accountType: AppuserAccountType.REGULAR,
    emailAddress: email,
    externalUserId,
    firstName: reviewPersona.firstName,
    lastName: reviewPersona.lastName,
    // A reviewer lands on the filled app, not on the first-run steps.
    onboarding: await em.find(Onboarding, {}),
    onboardingCompletedVersion: CURRENT_ONBOARDING_VERSION,
  };
  const existing = await em.findOne(Appuser, { emailAddress: email }, { filters: false });
  if (existing) {
    em.assign(existing, { ...profile, onboardingCompletedAt: existing.onboardingCompletedAt ?? now });
    return existing;
  }
  const currency = await em.findOneOrFail(Currency, { code: reviewPersona.primaryCurrency });
  return em.create(
    Appuser,
    {
      ...profile,
      currencyKey: currency,
      emailAuthenticated: now,
      marketingOptOut: now,
      onboardingCompletedAt: now,
      recordActive: true,
    },
    { partial: true },
  );
}

async function ensureReviewMembership(em: EntityManager, appuser: Appuser, tenant: Tenant): Promise<void> {
  await em.flush();
  const link = await em.findOne(
    AppuserTenant,
    { appuserKey: appuser, deletedAt: null, recordActive: true, tenantKey: tenant },
    { filters: false },
  );
  if (link) return;
  em.create(
    AppuserTenant,
    { appuserKey: appuser, recordActive: true, role: HouseholdRole.OWNER, tenantKey: tenant },
    { partial: true },
  );
  await em.flush();
}

async function ensureReviewTenant(em: EntityManager, appuser: Appuser): Promise<Tenant> {
  // A new account is not in the database yet; flush so the lookup below can match on it.
  await em.flush();
  const existing = await em.findOne(
    Tenant,
    { deletedAt: null, name: reviewPersona.householdName, ownerAppuserKey: appuser, tenantType: TenantType.REGULAR },
    { filters: false },
  );
  if (existing) return existing;

  const activeStatus = await em.getRepository(TenantStatus).getActiveStatus();
  if (!activeStatus) throw new ReviewSeedRefusedError("The 'active' tenant status is missing from the reference data.");
  return em.create(
    Tenant,
    {
      name: reviewPersona.householdName,
      ownerAppuserKey: appuser,
      tenantType: TenantType.REGULAR,
      tentantStatusKey: activeStatus,
    },
    { partial: true },
  );
}

/**
 * The review account with this address, or null when there is none. Refuses when the address
 * belongs to any other account, so a mistyped address never puts sample data in a real household.
 */
async function findReviewAccount(em: EntityManager, email: string): Promise<Appuser | null> {
  const appuser = await em.findOne(Appuser, { emailAddress: email }, { filters: false });
  if (!appuser) return null;
  const refuse = () =>
    new ReviewSeedRefusedError(`${email} belongs to an account that is not the review account; it was left alone.`);
  if (appuser.accountType !== AppuserAccountType.REGULAR || !appuser.recordActive || appuser.deletedAt) throw refuse();

  const [tenants, memberships] = await Promise.all([
    em.find(Tenant, { deletedAt: null, ownerAppuserKey: appuser, recordActive: true }, { filters: false }),
    em.find(AppuserTenant, { appuserKey: appuser, deletedAt: null, recordActive: true }, { filters: false }),
  ]);
  const tenant = tenants[0];
  if (
    tenants.length !== 1 ||
    tenant?.name !== reviewPersona.householdName ||
    tenant.tenantType !== TenantType.REGULAR ||
    memberships.length !== 1 ||
    memberships[0]?.tenantKey.tenantKey !== tenant.tenantKey
  ) {
    throw refuse();
  }
  const members = await em.count(
    AppuserTenant,
    { deletedAt: null, recordActive: true, tenantKey: tenant },
    { filters: false },
  );
  if (members !== 1) {
    throw new ReviewSeedRefusedError(`The review household has ${members} members; it may hold only the review account.`);
  }
  return appuser;
}

async function resolveReviewIdentity(
  em: CoreEntityManager,
  appuserKey: number,
  tenantKey: number,
): Promise<DemoRefreshIdentityResolution> {
  const appuser = await em.findOneOrFail(Appuser, { appuserKey }, { filters: false });
  const tenant = await em.findOneOrFail(Tenant, { tenantKey }, { filters: false });
  const appuserTenant = await em.findOneOrFail(
    AppuserTenant,
    { appuserKey: appuser, deletedAt: null, recordActive: true, tenantKey: tenant },
    { filters: false },
  );
  return { appuser, appuserTenant, status: 'found', tenant };
}
