import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addOwnership, addPartner, addShare, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { AccountOwnership } from '@entity/AccountOwnership';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import accountRoutes from '@route/account';
import netWorthRoutes from '@route/net-worth';
import { ERROR_CODE } from '@utils/errors';

/*
 * Who may change who owns what share of an account: its owner, or the household owner, among the
 * accounts they see. A viewer never. The shares name active members who can see the account and add
 * up to 100%; per-member net worth then follows them.
 */
describe('account ownership shares', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);
  const netWorth = tenantHttp('/v1/net-worth', netWorthRoutes);

  async function household() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const member = await addPartner(em, owner);
    const other = await addPartner(em, owner);
    const viewer = await addPartner(em, owner, { role: HouseholdRole.VIEWER });
    const memberShared = await addAccount(em, owner, { appuserCurrencyBalance: 1000, balance: 1000, name: 'Member shared', owner: member });
    const memberPrivate = await addAccount(em, owner, { appuserCurrencyBalance: 500, balance: 500, isPrivate: true, name: 'Member private', owner: member });
    return { member, memberPrivate, memberShared, other, owner, viewer };
  }

  const stored = async () => Object.fromEntries((await db.em().find(AccountOwnership, {}, { filters: false })).map((row) => [row.appuserKey.appuserKey, row.basisPoints]));
  const failure = (response: { body: { code?: string }; status: number }) => ({ code: response.body.code, status: response.status });

  it('lets the account owner split it, and each member\'s net worth then takes their share', async () => {
    const { member, memberShared, other } = await household();

    const response = await http.as(member).put(`/v1/account/${memberShared.accountKey}/ownership`).send([{ appuserKey: member.appuserKey, percent: 60 }, { appuserKey: other.appuserKey, percent: 40 }]);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ canManage: true, formerMembersPercent: 0, isSplit: true });
    expect(Object.fromEntries((response.body.members as { appuserKey: number; percent: number }[]).map((row) => [row.appuserKey, row.percent]))).toMatchObject({ [member.appuserKey]: 60, [other.appuserKey]: 40 });
    expect(await stored()).toEqual({ [member.appuserKey]: 6000, [other.appuserKey]: 4000 });
    const others = await netWorth.as(other).get(`/v1/net-worth?member=${other.appuserKey}`);
    expect(others.body.totalNetWorth).toBe(400);
  });

  it('takes two decimals and clears the shares with an empty list', async () => {
    const { member, memberShared, other } = await household();
    const send = (body: object) => http.as(member).put(`/v1/account/${memberShared.accountKey}/ownership`).send(body);

    expect((await send([{ appuserKey: member.appuserKey, percent: 66.67 }, { appuserKey: other.appuserKey, percent: 33.33 }])).status).toBe(200);
    expect(await stored()).toEqual({ [member.appuserKey]: 6667, [other.appuserKey]: 3333 });

    const cleared = await send([]);
    expect(cleared.body).toMatchObject({ isSplit: false });
    expect(await stored()).toEqual({});
  });

  it.each([
    ['shares that add up to less than 100%', (keys: Keys) => [{ appuserKey: keys.member, percent: 60 }, { appuserKey: keys.other, percent: 30 }]],
    ['shares that add up to more than 100%', (keys: Keys) => [{ appuserKey: keys.member, percent: 60 }, { appuserKey: keys.other, percent: 40.01 }]],
    ['a share with more than two decimals', (keys: Keys) => [{ appuserKey: keys.member, percent: 33.333 }, { appuserKey: keys.other, percent: 66.667 }]],
    ['the same member twice', (keys: Keys) => [{ appuserKey: keys.member, percent: 50 }, { appuserKey: keys.member, percent: 50 }]],
    ['someone outside the household', (keys: Keys) => [{ appuserKey: keys.member, percent: 50 }, { appuserKey: keys.outsider, percent: 50 }]],
    ['a member who has left', (keys: Keys) => [{ appuserKey: keys.member, percent: 50 }, { appuserKey: keys.left, percent: 50 }]],
  ])('refuses %s and changes nothing', async (_name, shares) => {
    const { member, memberShared, other, owner } = await household();
    await addOwnership(db.em(), owner, memberShared, [[member, 10_000]]);
    const outsider = (await seedHousehold(db.em())).appuser;
    const left = await addPartner(db.em(), owner);
    await db.em().nativeUpdate(AppuserTenant, { appuserKey: left }, { recordActive: false });

    const response = await http.as(member).put(`/v1/account/${memberShared.accountKey}/ownership`).send(shares({ left: left.appuserKey, member: member.appuserKey, other: other.appuserKey, outsider: outsider.appuserKey }));

    expect(failure(response)).toEqual({ code: ERROR_CODE.ACCOUNT_OWNERSHIP_INVALID, status: 400 });
    expect(await stored()).toEqual({ [member.appuserKey]: 10_000 });
  });

  it('refuses a share for a member who cannot see the account, and lists only those who can', async () => {
    const { member, memberPrivate, other, owner } = await household();

    const refused = await http.as(member).put(`/v1/account/${memberPrivate.accountKey}/ownership`).send([{ appuserKey: member.appuserKey, percent: 50 }, { appuserKey: owner.appuser.appuserKey, percent: 50 }]);
    expect(failure(refused)).toEqual({ code: ERROR_CODE.ACCOUNT_OWNERSHIP_INVALID, status: 400 });

    await addShare(db.em(), owner, memberPrivate, other, 'read');
    const read = await http.as(member).get(`/v1/account/${memberPrivate.accountKey}/ownership`);
    expect((read.body.members as { appuserKey: number }[]).map((row) => row.appuserKey).sort()).toEqual([member.appuserKey, other.appuserKey].sort());
    expect((await http.as(member).put(`/v1/account/${memberPrivate.accountKey}/ownership`).send([{ appuserKey: member.appuserKey, percent: 50 }, { appuserKey: other.appuserKey, percent: 50 }])).status).toBe(200);
  });

  it('refuses a member who is neither the account owner nor the household owner', async () => {
    const { memberShared, other } = await household();

    const read = await http.as(other).get(`/v1/account/${memberShared.accountKey}/ownership`);
    expect(read.body).toMatchObject({ canManage: false, isSplit: false });

    const response = await http.as(other).put(`/v1/account/${memberShared.accountKey}/ownership`).send([{ appuserKey: other.appuserKey, percent: 100 }]);
    expect(failure(response)).toEqual({ code: ERROR_CODE.ACCOUNT_OWNERSHIP_MANAGER_REQUIRED, status: 403 });
    expect(await stored()).toEqual({});
  });

  it('lets the household owner split an account they see, and answers 404 for one they do not', async () => {
    const { member, memberPrivate, memberShared, owner } = await household();

    const changed = await http.as(owner.appuser).put(`/v1/account/${memberShared.accountKey}/ownership`).send([{ appuserKey: owner.appuser.appuserKey, percent: 50 }, { appuserKey: member.appuserKey, percent: 50 }]);
    expect(changed.status).toBe(200);

    expect((await http.as(owner.appuser).get(`/v1/account/${memberPrivate.accountKey}/ownership`)).status).toBe(404);
    expect((await http.as(owner.appuser).put(`/v1/account/${memberPrivate.accountKey}/ownership`).send([])).status).toBe(404);
  });

  it('refuses a viewer, even on their own account', async () => {
    const { owner, viewer } = await household();
    const own = await addAccount(db.em(), owner, { owner: viewer });

    const response = await http.as(viewer).put(`/v1/account/${own.accountKey}/ownership`).send([{ appuserKey: viewer.appuserKey, percent: 100 }]);
    expect(response.status).toBe(403);
    expect(await stored()).toEqual({});
  });

  it('reports a former member\'s share as Shared, and keeps it until the shares are replaced', async () => {
    const { member, memberShared, other, owner } = await household();
    await addOwnership(db.em(), owner, memberShared, [[member, 7000], [other, 3000]]);
    await db.em().nativeUpdate(AppuserTenant, { appuserKey: other }, { deletedAt: new Date(), recordActive: false });

    const read = await http.as(member).get(`/v1/account/${memberShared.accountKey}/ownership`);
    expect(read.body).toMatchObject({ formerMembersPercent: 30, isSplit: true });
    expect((read.body.members as { appuserKey: number }[]).map((row) => row.appuserKey)).not.toContain(other.appuserKey);
    expect((await netWorth.as(member).get('/v1/net-worth?member=shared')).body.totalNetWorth).toBe(300);
    expect(await stored()).toEqual({ [member.appuserKey]: 7000, [other.appuserKey]: 3000 });
  });
});

interface Keys {
  left: number;
  member: number;
  other: number;
  outsider: number;
}
