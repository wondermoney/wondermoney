import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addPartner, addShare, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { AccountShare } from '@entity/AccountShare';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import accountRoutes from '@route/account';
import { ERROR_CODE } from '@utils/errors';

/*
 * Who may change who sees an account: its owner, or the household owner, among the members who
 * see it. A viewer never does. The shares are what the accounts list then shows each member.
 */
describe('account shares', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);

  async function household() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const member = await addPartner(em, owner);
    const other = await addPartner(em, owner);
    const viewer = await addPartner(em, owner, { role: HouseholdRole.VIEWER });
    // The member's own private account, and one of theirs shared with the household.
    const memberPrivate = await addAccount(em, owner, { isPrivate: true, name: 'Member private', owner: member });
    const memberShared = await addAccount(em, owner, { name: 'Member shared', owner: member });
    return { member, memberPrivate, memberShared, other, owner, viewer };
  }

  const listed = async (as: Parameters<typeof http.as>[0]) => {
    const response = await http.as(as).get('/v1/account');
    return Object.fromEntries((response.body.accounts as { accountName: string; myAccess: string }[]).map((account) => [account.accountName, account.myAccess]));
  };

  it('lets the account owner share a private account, and each member then sees it at their level', async () => {
    const { member, memberPrivate, other, owner, viewer } = await household();

    const response = await http.as(member).put(`/v1/account/${memberPrivate.accountKey}/shares`).send({
      isPrivate: true,
      shares: [{ access: 'write', appuserKey: other.appuserKey }, { access: 'write', appuserKey: viewer.appuserKey }],
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ canManage: true, isPrivate: true });
    expect(Object.fromEntries((response.body.members as { access: string; appuserKey: number }[]).map((row) => [row.appuserKey, row.access]))).toEqual({
      [member.appuserKey]: 'owner',
      [other.appuserKey]: 'write',
      [owner.appuser.appuserKey]: 'hidden',
      [viewer.appuserKey]: 'read',
    });
    expect((await listed(other))['Member private']).toBe('write');
    expect((await listed(viewer))['Member private']).toBe('read');
    expect((await listed(owner.appuser))['Member private']).toBeUndefined();
    expect((await listed(member))['Member private']).toBe('owner');
  });

  it('refuses a member who only sees the account', async () => {
    const { memberShared, other } = await household();

    const read = await http.as(other).get(`/v1/account/${memberShared.accountKey}/shares`);
    expect(read.body).toMatchObject({ canManage: false, isPrivate: false });

    const response = await http.as(other).put(`/v1/account/${memberShared.accountKey}/shares`).send({ isPrivate: true, shares: [] });
    expect({ code: response.body.code, status: response.status }).toEqual({ code: ERROR_CODE.ACCOUNT_SHARE_MANAGER_REQUIRED, status: 403 });
  });

  it('lets the household owner change an account they see, and hides one they do not', async () => {
    const { memberPrivate, memberShared, other, owner } = await household();

    const changed = await http.as(owner.appuser).put(`/v1/account/${memberShared.accountKey}/shares`).send({ isPrivate: true, shares: [{ access: 'read', appuserKey: other.appuserKey }] });
    expect(changed.status).toBe(200);
    expect((await listed(owner.appuser))['Member shared']).toBeUndefined();
    expect((await listed(other))['Member shared']).toBe('read');

    expect((await http.as(owner.appuser).get(`/v1/account/${memberPrivate.accountKey}/shares`)).status).toBe(404);
    expect((await http.as(owner.appuser).put(`/v1/account/${memberPrivate.accountKey}/shares`).send({ isPrivate: false, shares: [] })).status).toBe(404);
  });

  it('refuses a viewer, even on their own account', async () => {
    const { owner, viewer } = await household();
    const own = await addAccount(db.em(), owner, { isPrivate: true, owner: viewer });

    const response = await http.as(viewer).put(`/v1/account/${own.accountKey}/shares`).send({ isPrivate: false, shares: [] });
    expect(response.status).toBe(403);
  });

  it.each([
    ['the account owner', (keys: { member: number; outsider: number }) => [{ access: 'read', appuserKey: keys.member }]],
    ['someone outside the household', (keys: { member: number; outsider: number }) => [{ access: 'read', appuserKey: keys.outsider }]],
  ])('refuses a share for %s', async (_name, shares) => {
    const { member, memberPrivate } = await household();
    const outsider = (await seedHousehold(db.em())).appuser;

    const response = await http.as(member).put(`/v1/account/${memberPrivate.accountKey}/shares`).send({ isPrivate: true, shares: shares({ member: member.appuserKey, outsider: outsider.appuserKey }) });
    expect({ code: response.body.code, status: response.status }).toEqual({ code: ERROR_CODE.ACCOUNT_SHARE_INVALID, status: 400 });
  });

  it('refuses shares on an account shared with the household', async () => {
    const { member, memberPrivate, other } = await household();

    const response = await http.as(member).put(`/v1/account/${memberPrivate.accountKey}/shares`).send({ isPrivate: false, shares: [{ access: 'read', appuserKey: other.appuserKey }] });
    expect(response.status).toBe(400);
  });

  it('drops the shares when the account is shared with the household again', async () => {
    const { member, memberPrivate, other, owner } = await household();
    await addShare(db.em(), owner, memberPrivate, other, 'read');

    expect((await http.as(member).put(`/v1/account/${memberPrivate.accountKey}/shares`).send({ isPrivate: false, shares: [] })).status).toBe(200);
    await expect(db.em().count(AccountShare, {}, { filters: false })).resolves.toBe(0);
    expect((await listed(owner.appuser))['Member private']).toBe('write');
  });

  it('keeps a removed member\'s shares: the members they shared with keep access, nobody else gains it', async () => {
    const { member, memberPrivate, other, owner } = await household();
    await addShare(db.em(), owner, memberPrivate, other, 'write');
    await db.em().nativeUpdate(AppuserTenant, { appuserKey: { appuserKey: member.appuserKey } }, { deletedAt: new Date(), recordActive: false });

    expect((await listed(other))['Member private']).toBe('write');
    expect((await listed(owner.appuser))['Member private']).toBeUndefined();
  });
});
