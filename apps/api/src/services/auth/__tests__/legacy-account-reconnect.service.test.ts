import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Appuser } from '@entity/Appuser';

import { reconnectLegacyAppuser } from '../legacy-account-reconnect.service';

/*
 * Accounts from before the move to better-auth point at a login that no longer exists. Someone
 * who proves they own the account's email gets that account back on their new login; nobody gets
 * an account that still has a working login of its own.
 */
describe('reconnecting an account from before better-auth', () => {
  const db = useTestDatabase();
  const noLogins = { authUserExists: async () => false };

  async function legacyAccount() {
    const household = await seedHousehold(db.em());
    return household.appuser;
  }

  async function storedExternalId(appuserKey: number) {
    const appuser = await db.em().findOneOrFail(Appuser, { appuserKey }, { filters: false });
    return appuser.externalUserId;
  }

  it('gives the account to a new login with a verified email', async () => {
    const appuser = await legacyAccount();
    const newLogin = randomUUID();

    const result = await reconnectLegacyAppuser(db.em(), { appuser, emailVerified: true, externalUserId: newLogin }, noLogins);

    expect(result).toBe('reconnected');
    expect(await storedExternalId(appuser.appuserKey)).toBe(newLogin);
  });

  it('keeps the account when the new login has not verified the email', async () => {
    const appuser = await legacyAccount();
    const before = appuser.externalUserId;

    const result = await reconnectLegacyAppuser(db.em(), { appuser, emailVerified: false, externalUserId: randomUUID() }, noLogins);

    expect(result).toBe('email-unverified');
    expect(await storedExternalId(appuser.appuserKey)).toBe(before);
  });

  it('never takes an account that still has its own login, verified email or not', async () => {
    const appuser = await legacyAccount();
    const before = appuser.externalUserId;
    const hasLogin = { authUserExists: async (id: string) => id === before };

    const result = await reconnectLegacyAppuser(db.em(), { appuser, emailVerified: true, externalUserId: randomUUID() }, hasLogin);

    expect(result).toBe('has-login');
    expect(await storedExternalId(appuser.appuserKey)).toBe(before);
  });

  it('lets only the first of two logins claim the same account', async () => {
    const appuser = await legacyAccount();
    const first = randomUUID();

    await reconnectLegacyAppuser(db.em(), { appuser, emailVerified: true, externalUserId: first }, noLogins);
    // The second login read the account before the first claimed it.
    const second = await reconnectLegacyAppuser(db.em(), { appuser, emailVerified: true, externalUserId: randomUUID() }, noLogins);

    expect(second).toBe('has-login');
    expect(await storedExternalId(appuser.appuserKey)).toBe(first);
  });
});
