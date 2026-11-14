import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { listInstanceAdminEmails, setInstanceAdminByEmail, syncInstanceAdmin } from '@service/auth/instance-admin.service';
import { recordSignup } from '@service/auth/signup-record.service';

describe('the instance-admin flag from the identity provider', () => {
  const db = useTestDatabase();

  const accountTypeOf = async (externalUserId: string) =>
    (await db.em().findOneOrFail(Appuser, { externalUserId })).accountType;

  it('grants and revokes admin on the app user with that identity', async () => {
    const { appuser } = await seedHousehold(db.em());

    await syncInstanceAdmin(db.em(), appuser.externalUserId, true);
    expect(await accountTypeOf(appuser.externalUserId)).toBe(AppuserAccountType.ADMIN);

    await syncInstanceAdmin(db.em(), appuser.externalUserId, false);
    expect(await accountTypeOf(appuser.externalUserId)).toBe(AppuserAccountType.REGULAR);
  });

  it('leaves everyone else alone', async () => {
    const { appuser } = await seedHousehold(db.em());
    const { appuser: other } = await seedHousehold(db.em());

    await syncInstanceAdmin(db.em(), appuser.externalUserId, true);
    expect(await accountTypeOf(other.externalUserId)).toBe(AppuserAccountType.REGULAR);
  });

  it('never turns the demo account into an admin or a regular account', async () => {
    const { appuser } = await seedHousehold(db.em());
    await db.em().nativeUpdate(Appuser, { appuserKey: appuser.appuserKey }, { accountType: AppuserAccountType.DEMO });

    await syncInstanceAdmin(db.em(), appuser.externalUserId, true);
    expect(await accountTypeOf(appuser.externalUserId)).toBe(AppuserAccountType.DEMO);
  });

  it('does nothing before the app user exists', async () => {
    await expect(syncInstanceAdmin(db.em(), randomUUID(), true)).resolves.toBeUndefined();
  });

  it('creates the app user as an admin when the first sign-in came from an admin group', async () => {
    await seedHousehold(db.em());
    const externalUserId = randomUUID();

    await recordSignup({ admin: true, email: 'grace@example.com', externalUserId, method: 'oidc' });
    expect(await accountTypeOf(externalUserId)).toBe(AppuserAccountType.ADMIN);

    const regular = randomUUID();
    await recordSignup({ email: 'alan@example.com', externalUserId: regular, method: 'oidc' });
    expect(await accountTypeOf(regular)).toBe(AppuserAccountType.REGULAR);
  });
});

describe('making someone an instance admin by hand', () => {
  const db = useTestDatabase();

  const accountTypeOf = async (appuserKey: number) =>
    (await db.em().findOneOrFail(Appuser, { appuserKey })).accountType;

  it('grants admin to the app user with that email, whatever its case, and revokes it again', async () => {
    const { appuser } = await seedHousehold(db.em());

    expect(await setInstanceAdminByEmail(db.em(), `  ${appuser.emailAddress.toUpperCase()} `, true)).toBe('updated');
    expect(await accountTypeOf(appuser.appuserKey)).toBe(AppuserAccountType.ADMIN);
    expect(await listInstanceAdminEmails(db.em())).toEqual([appuser.emailAddress]);

    expect(await setInstanceAdminByEmail(db.em(), appuser.emailAddress, true)).toBe('unchanged');

    expect(await setInstanceAdminByEmail(db.em(), appuser.emailAddress, false)).toBe('updated');
    expect(await accountTypeOf(appuser.appuserKey)).toBe(AppuserAccountType.REGULAR);
    expect(await listInstanceAdminEmails(db.em())).toEqual([]);
  });

  it('reports an unknown email and changes nobody', async () => {
    const { appuser } = await seedHousehold(db.em());

    expect(await setInstanceAdminByEmail(db.em(), 'nobody@example.test', true)).toBe('not_found');
    expect(await accountTypeOf(appuser.appuserKey)).toBe(AppuserAccountType.REGULAR);
  });

  it('never makes the demo account an admin', async () => {
    const { appuser } = await seedHousehold(db.em());
    await db.em().nativeUpdate(Appuser, { appuserKey: appuser.appuserKey }, { accountType: AppuserAccountType.DEMO });

    expect(await setInstanceAdminByEmail(db.em(), appuser.emailAddress, true)).toBe('demo');
    expect(await accountTypeOf(appuser.appuserKey)).toBe(AppuserAccountType.DEMO);
  });
});
