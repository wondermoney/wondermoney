import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/email/email', () => ({ sendRenderedEmail: vi.fn(() => Promise.resolve()) }));

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { Currency } from '@entity/Currency';
import { HouseholdInvite, HouseholdInviteStatus } from '@entity/HouseholdInvite';
import { Tenant } from '@entity/Tenant';
import { getRef } from '@utils/em-helpers';
import { ERROR_CODE } from '@utils/errors';

import { consumeInvite, createHouseholdInvite } from '../household-invite.service';

/*
 * The seat cap under contention. A household one seat short of `HOUSEHOLD_MAX_MEMBERS` holds two
 * pending invites (an operator lowered the cap after they were sent), and both people accept at the
 * same moment; or two managers invite at once for the last seat. Each count-then-insert runs under
 * the household's row lock, so exactly one wins. Contention needs a real server: PGlite is a single
 * backend (see `pg-test-db.ts`).
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('the household seat cap under concurrent requests', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });

  afterEach(() => vi.unstubAllEnvs());

  async function invite(household: Household, email: string): Promise<number> {
    const em = db.em();
    const created = em.create(HouseholdInvite, {
      emailAddress: email, expiresAt: new Date(Date.now() + 86_400_000), inviterAppuserKey: getRef(em, Appuser, household.appuser.appuserKey),
      role: HouseholdRole.MEMBER, status: HouseholdInviteStatus.PENDING, tenantKey: getRef(em, Tenant, household.tenant.tenantKey), token: randomUUID(),
    }, { partial: true });
    await em.flush();
    return created.householdInviteKey;
  }

  async function newUser(household: Household, email: string): Promise<number> {
    const em = db.em();
    const user = em.create(Appuser, { currencyKey: getRef(em, Currency, household.currency.currencyKey), emailAddress: email, externalUserId: randomUUID(), firstName: 'New' }, { partial: true });
    await em.flush();
    return user.appuserKey;
  }

  /** One request's worth of state: its own EM, its own copy of the invite and the new user. */
  async function accept(inviteKey: number, appuserKey: number) {
    const em: EntityManager = db.em();
    const loaded = await em.findOneOrFail(HouseholdInvite, { householdInviteKey: inviteKey }, { populate: ['tenantKey'] });
    const user = await em.findOneOrFail(Appuser, { appuserKey });
    return consumeInvite(em, loaded, user);
  }

  const activeMembers = (household: Household) => db.em().count(AppuserTenant, { recordActive: true, tenantKey: { tenantKey: household.tenant.tenantKey } });

  it('lets exactly one of two accepts take the last seat', async () => {
    vi.stubEnv('HOUSEHOLD_MAX_MEMBERS', '3');
    const household = await seedHousehold(db.em());
    await addPartner(db.em(), household);
    const invites = [await invite(household, 'first@example.test'), await invite(household, 'second@example.test')];
    const users = [await newUser(household, 'first@example.test'), await newUser(household, 'second@example.test')];

    const results = await Promise.allSettled(invites.map((key, index) => accept(key, users[index] ?? 0)));

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [refused] = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(refused?.reason).toMatchObject({ code: ERROR_CODE.HOUSEHOLD_FULL, status: 409 });
    expect(await activeMembers(household)).toBe(3);
  });

  it('never seats more people than the cap, however many accept at once', async () => {
    vi.stubEnv('HOUSEHOLD_MAX_MEMBERS', '4');
    const household = await seedHousehold(db.em());
    const emails = Array.from({ length: 6 }, (_, index) => `person${index}@example.test`);
    const invites = await Promise.all(emails.map((email) => invite(household, email)));
    const users = await Promise.all(emails.map((email) => newUser(household, email)));

    const results = await Promise.allSettled(invites.map((key, index) => accept(key, users[index] ?? 0)));

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(await activeMembers(household)).toBe(4);
  });

  it('lets one of two clicks on the same invite join', async () => {
    const household = await seedHousehold(db.em());
    const key = await invite(household, 'twice@example.test');
    const user = await newUser(household, 'twice@example.test');

    const results = await Promise.allSettled([accept(key, user), accept(key, user)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await activeMembers(household)).toBe(2);
  });

  it('gives the last seat to only one of two invites sent at once', async () => {
    vi.stubEnv('HOUSEHOLD_MAX_MEMBERS', '3');
    const household = await seedHousehold(db.em());
    await addPartner(db.em(), household);

    const send = async (email: string) => {
      const em = db.em();
      const owner = await em.findOneOrFail(Appuser, { appuserKey: household.appuser.appuserKey });
      const tenant = await em.findOneOrFail(Tenant, { tenantKey: household.tenant.tenantKey });
      return createHouseholdInvite(em, owner, HouseholdRole.OWNER, tenant, email);
    };
    const results = await Promise.allSettled([send('a@example.test'), send('b@example.test'), send('c@example.test')]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.em().count(HouseholdInvite, { status: HouseholdInviteStatus.PENDING, tenantKey: { tenantKey: household.tenant.tenantKey } })).toBe(1);
  });
});
