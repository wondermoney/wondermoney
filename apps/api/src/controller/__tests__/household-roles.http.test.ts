import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  endAllAuthSessions: vi.fn(() => Promise.resolve()),
  sendRenderedEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => ({
  ...(await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession(),
  endAllAuthSessions: mocks.endAllAuthSessions,
}));
vi.mock('@service/email/email', () => ({ sendRenderedEmail: mocks.sendRenderedEmail }));

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Account } from '@entity/Account';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { HouseholdInvite, HouseholdInviteStatus } from '@entity/HouseholdInvite';
import { PushDevice, PushDevicePlatform } from '@entity/PushDevice';
import { Tenant } from '@entity/Tenant';
import householdRoutes from '@route/household';
import { provisionHomeTenant } from '@service/auth/auth-callback.service';
import { getInviteForValidation } from '@service/household/household-invite.service';
import { getRef } from '@utils/em-helpers';
import { ERROR_CODE } from '@utils/errors';

const { ADMIN, MEMBER, OWNER, VIEWER } = HouseholdRole;

/*
 * A household of an owner, an admin, a member and a viewer, driven through the real household
 * routes and the real authenticated-tenant stack. Each test asserts what one role may do to the
 * household and what is stored afterwards.
 */
describe('household roles', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/household', householdRoutes);

  let household: Household;
  let owner: Appuser;
  let admin: Appuser;
  let member: Appuser;
  let viewer: Appuser;
  const people = () => ({ admin, member, owner, viewer });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    household = await seedHousehold(db.em());
    owner = household.appuser;
    admin = await addPartner(db.em(), household, { role: ADMIN });
    member = await addPartner(db.em(), household, { role: MEMBER });
    viewer = await addPartner(db.em(), household, { role: VIEWER });
  });

  const activeMemberships = (tenantKey = household.tenant.tenantKey) =>
    db.em().find(AppuserTenant, { recordActive: true, tenantKey: { tenantKey } }, { orderBy: { appuserTenantKey: 'ASC' }, populate: ['appuserKey'] });
  const roleOf = async (person: Appuser) => (await activeMemberships()).find((m) => m.appuserKey.appuserKey === person.appuserKey)?.role;

  async function addInvite(role: HouseholdRole, email = `invitee${randomUUID()}@example.test`, tenant: Tenant = household.tenant) {
    const em = db.em();
    const invite = em.create(HouseholdInvite, {
      emailAddress: email, expiresAt: new Date(Date.now() + 86_400_000), inviterAppuserKey: getRef(em, Appuser, owner.appuserKey),
      role, status: HouseholdInviteStatus.PENDING, tenantKey: getRef(em, Tenant, tenant.tenantKey), token: randomUUID().replaceAll('-', ''),
    }, { partial: true });
    await em.flush();
    return invite;
  }

  describe('inviting', () => {
    it.each([
      ['owner', ADMIN],
      ['owner', MEMBER],
      ['owner', VIEWER],
      ['admin', MEMBER],
      ['admin', VIEWER],
    ] as const)('lets the %s invite as %s', async (actor, role) => {
      const response = await http.as(people()[actor]).post('/v1/household/invites').send({ email: 'new.person@example.test', role });

      expect(response.status).toBe(201);
      expect(response.body.invite).toMatchObject({ email: 'new.person@example.test', role, status: 'pending' });
      expect(response.body.invite).not.toHaveProperty('token');
      expect((await db.em().find(HouseholdInvite, { emailAddress: 'new.person@example.test' })).map((invite) => invite.role)).toEqual([role]);
      expect(mocks.sendRenderedEmail).toHaveBeenCalledOnce();
    });

    it.each([
      // A viewer is stopped before the household routes, like on every other write.
      ['admin', ADMIN, ERROR_CODE.HOUSEHOLD_ROLE_REQUIRED],
      ['member', MEMBER, ERROR_CODE.HOUSEHOLD_ROLE_REQUIRED],
      ['member', VIEWER, ERROR_CODE.HOUSEHOLD_ROLE_REQUIRED],
      ['viewer', VIEWER, ERROR_CODE.HOUSEHOLD_READ_ONLY],
    ] as const)('refuses the %s inviting as %s', async (actor, role, code) => {
      const response = await http.as(people()[actor]).post('/v1/household/invites').send({ email: 'new.person@example.test', role });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe(code);
      expect(await db.em().count(HouseholdInvite, {})).toBe(0);
      expect(mocks.sendRenderedEmail).not.toHaveBeenCalled();
    });

    it('invites as a member when a client sends no role', async () => {
      const response = await http.as(owner).post('/v1/household/invites').send({ email: 'old.client@example.test' });
      expect(response.status).toBe(201);
      expect(response.body.invite.role).toBe(MEMBER);
    });

    it('never grants ownership through an invite', async () => {
      const response = await http.as(owner).post('/v1/household/invites').send({ email: 'x@example.test', role: OWNER });
      expect(response.status).toBe(400);
    });

    it('invites a person who already has an account, but not someone already in the household', async () => {
      const outsider = (await seedHousehold(db.em())).appuser;
      expect((await http.as(owner).post('/v1/household/invites').send({ email: outsider.emailAddress })).status).toBe(201);

      const again = await http.as(owner).post('/v1/household/invites').send({ email: member.emailAddress });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe(ERROR_CODE.ALREADY_HOUSEHOLD_MEMBER);
    });

    it('never invites the demo account', async () => {
      const demo = (await seedHousehold(db.em())).appuser;
      await db.em().nativeUpdate(Appuser, { appuserKey: demo.appuserKey }, { accountType: AppuserAccountType.DEMO });

      expect((await http.as(owner).post('/v1/household/invites').send({ email: demo.emailAddress })).status).toBe(400);
      expect(await db.em().count(HouseholdInvite, {})).toBe(0);
    });

    it('stops at the configured cap, counting pending invites as seats', async () => {
      vi.stubEnv('HOUSEHOLD_MAX_MEMBERS', '5');
      expect((await http.as(owner).post('/v1/household/invites').send({ email: 'fifth@example.test' })).status).toBe(201);

      const full = await http.as(owner).post('/v1/household/invites').send({ email: 'sixth@example.test' });
      expect(full.status).toBe(409);
      expect(full.body.code).toBe(ERROR_CODE.HOUSEHOLD_FULL);
    });

    it('holds six people by default', async () => {
      await addInvite(MEMBER);
      expect((await http.as(owner).post('/v1/household/invites').send({ email: 'sixth@example.test' })).status).toBe(201);
      expect((await http.as(owner).post('/v1/household/invites').send({ email: 'seventh@example.test' })).body.code).toBe(ERROR_CODE.HOUSEHOLD_FULL);
    });

    it('lets an admin resend and revoke invites below admin, and only the owner those for an admin', async () => {
      const forMember = await addInvite(MEMBER);
      const forAdmin = await addInvite(ADMIN);

      expect((await http.as(admin).post(`/v1/household/invites/${forMember.householdInviteKey}/resend`)).status).toBe(200);
      expect((await http.as(admin).post(`/v1/household/invites/${forAdmin.householdInviteKey}/resend`)).body.code).toBe(ERROR_CODE.HOUSEHOLD_ROLE_REQUIRED);
      expect((await http.as(admin).delete(`/v1/household/invites/${forAdmin.householdInviteKey}`)).status).toBe(403);
      expect((await http.as(member).delete(`/v1/household/invites/${forMember.householdInviteKey}`)).status).toBe(403);
      expect((await http.as(admin).delete(`/v1/household/invites/${forMember.householdInviteKey}`)).status).toBe(200);
      expect((await http.as(owner).delete(`/v1/household/invites/${forAdmin.householdInviteKey}`)).status).toBe(200);

      const statuses = await db.em().find(HouseholdInvite, {}, { orderBy: { householdInviteKey: 'ASC' } });
      expect(statuses.map((invite) => invite.status)).toEqual([HouseholdInviteStatus.REVOKED, HouseholdInviteStatus.REVOKED]);
    });
  });

  describe('changing roles', () => {
    it.each([
      ['owner', 'member', ADMIN, 200],
      ['owner', 'admin', VIEWER, 200],
      ['admin', 'viewer', MEMBER, 200],
      ['admin', 'member', VIEWER, 200],
      ['admin', 'member', ADMIN, 403],
      ['admin', 'owner', MEMBER, 403],
      ['member', 'viewer', MEMBER, 403],
      ['viewer', 'member', VIEWER, 403],
    ] as const)('%s setting the %s to %s answers %i', async (actor, target, role, status) => {
      const before = await roleOf(people()[target]);
      const response = await http.as(people()[actor]).patch(`/v1/household/members/${people()[target].appuserKey}`).send({ role });

      expect(response.status).toBe(status);
      expect(await roleOf(people()[target])).toBe(status === 200 ? role : before);
      expect(response.body.member?.role).toBe(status === 200 ? role : undefined);
    });

    it('lets nobody change their own role', async () => {
      const response = await http.as(admin).patch(`/v1/household/members/${admin.appuserKey}`).send({ role: MEMBER });
      expect(response.status).toBe(403);
      expect(await roleOf(admin)).toBe(ADMIN);
    });

    it('never grants ownership by a role change', async () => {
      expect((await http.as(owner).patch(`/v1/household/members/${member.appuserKey}`).send({ role: OWNER })).status).toBe(400);
    });
  });

  describe('removing and leaving', () => {
    it.each([
      ['owner', 'admin', 200],
      ['owner', 'viewer', 200],
      ['admin', 'member', 200],
      ['admin', 'viewer', 200],
      ['admin', 'owner', 400],
      ['member', 'viewer', 403],
      ['viewer', 'member', 403],
    ] as const)('%s removing the %s answers %i', async (actor, target, status) => {
      const before = await roleOf(people()[target]);
      const response = await http.as(people()[actor]).delete(`/v1/household/members/${people()[target].appuserKey}`);

      expect(response.status).toBe(status);
      expect(await roleOf(people()[target])).toBe(status === 200 ? undefined : before);
    });

    it('keeps an admin from removing another admin', async () => {
      const secondAdmin = await addPartner(db.em(), household, { role: ADMIN });
      const response = await http.as(admin).delete(`/v1/household/members/${secondAdmin.appuserKey}`);
      expect(response.status).toBe(403);
      expect(await roleOf(secondAdmin)).toBe(ADMIN);
    });

    it.each(['admin', 'member', 'viewer'] as const)('lets the %s leave', async (who) => {
      expect((await http.as(people()[who]).delete(`/v1/household/members/${people()[who].appuserKey}`)).status).toBe(200);
      expect(await roleOf(people()[who])).toBeUndefined();
      // Leaving is the person's own act: their client signs out, the API ends nothing.
      expect(mocks.endAllAuthSessions).not.toHaveBeenCalled();
    });

    it('keeps the owner from leaving', async () => {
      expect((await http.as(owner).delete(`/v1/household/members/${owner.appuserKey}`)).status).toBe(400);
      expect(await roleOf(owner)).toBe(OWNER);
    });

    it('signs a removed person out everywhere and stops their phones getting notifications', async () => {
      const em = db.em();
      em.create(PushDevice, { appuserKey: getRef(em, Appuser, viewer.appuserKey), lastSeenAt: new Date(), platform: PushDevicePlatform.IOS, sessionId: 'session-viewer', token: 'ExponentPushToken[viewer-device]' }, { partial: true });
      em.create(PushDevice, { appuserKey: getRef(em, Appuser, member.appuserKey), lastSeenAt: new Date(), platform: PushDevicePlatform.IOS, sessionId: 'session-member', token: 'ExponentPushToken[member-device]' }, { partial: true });
      await em.flush();

      expect((await http.as(owner).delete(`/v1/household/members/${viewer.appuserKey}`)).status).toBe(200);

      expect(mocks.endAllAuthSessions).toHaveBeenCalledExactlyOnceWith(viewer.externalUserId);
      const devices = await db.em().find(PushDevice, {}, { populate: ['appuserKey'] });
      expect(devices.map((device) => device.appuserKey.appuserKey)).toEqual([member.appuserKey]);
    });

    it('answers a removed person with no household until they sign in again', async () => {
      await http.as(owner).delete(`/v1/household/members/${viewer.appuserKey}`);
      expect((await http.as(viewer).get('/v1/household')).status).toBe(400);
    });
  });

  describe('transferring ownership', () => {
    it('makes the member the owner and the old owner an admin, in one step', async () => {
      const response = await http.as(owner).post('/v1/household/transfer-ownership').send({ appuserKey: member.appuserKey });

      expect(response.status).toBe(200);
      const roles = (await activeMemberships()).map((m) => [m.appuserKey.appuserKey, m.role]);
      expect(roles).toEqual([[owner.appuserKey, ADMIN], [admin.appuserKey, ADMIN], [member.appuserKey, OWNER], [viewer.appuserKey, VIEWER]]);
      const tenant = await db.em().findOneOrFail(Tenant, { tenantKey: household.tenant.tenantKey }, { populate: ['ownerAppuserKey'] });
      expect(tenant.ownerAppuserKey.appuserKey).toBe(member.appuserKey);
      expect(response.body.members[0]).toMatchObject({ appuserKey: member.appuserKey, role: OWNER });
    });

    it('lets the new owner manage the household and the old owner no longer remove an admin', async () => {
      await http.as(owner).post('/v1/household/transfer-ownership').send({ appuserKey: member.appuserKey });

      expect((await http.as(owner).delete(`/v1/household/members/${admin.appuserKey}`)).status).toBe(403);
      expect((await http.as(member).delete(`/v1/household/members/${owner.appuserKey}`)).status).toBe(200);
    });

    it.each([
      ['admin', ERROR_CODE.HOUSEHOLD_OWNER_REQUIRED],
      ['member', ERROR_CODE.HOUSEHOLD_OWNER_REQUIRED],
      ['viewer', ERROR_CODE.HOUSEHOLD_READ_ONLY],
    ] as const)('refuses a transfer by the %s', async (who, code) => {
      const response = await http.as(people()[who]).post('/v1/household/transfer-ownership').send({ appuserKey: people()[who].appuserKey });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe(code);
      expect(await roleOf(owner)).toBe(OWNER);
    });

    it('refuses a transfer to someone outside the household', async () => {
      const outsider = (await seedHousehold(db.em())).appuser;
      expect((await http.as(owner).post('/v1/household/transfer-ownership').send({ appuserKey: outsider.appuserKey })).status).toBe(404);
      expect(await roleOf(owner)).toBe(OWNER);
    });
  });

  describe('GET /v1/household', () => {
    it('lists every member with their role, the owner first, for any role', async () => {
      await addInvite(VIEWER, 'pending@example.test');
      const response = await http.as(viewer).get('/v1/household');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        maxMembers: 6,
        pendingInvites: [{ email: 'pending@example.test', role: VIEWER }],
        viewerAppuserKey: viewer.appuserKey,
      });
      expect(response.body.members.map((m: { appuserKey: number; role: string }) => [m.appuserKey, m.role])).toEqual([
        [owner.appuserKey, OWNER], [admin.appuserKey, ADMIN], [member.appuserKey, MEMBER], [viewer.appuserKey, VIEWER],
      ]);
    });

    /**
     * What mobile builds from before roles parse (`household-contract.ts` at that release): every
     * member, and one optional pending invite. They must keep reading a larger household.
     */
    it('still answers in the shape older mobile builds read', async () => {
      await addInvite(MEMBER, 'first@example.test');
      await addInvite(VIEWER, 'second@example.test');
      const oldClientSchema = z.object({
        members: z.array(z.object({
          appuserKey: z.number().int().positive(),
          emailAddress: z.email(),
          firstName: z.string().nullable().optional(),
          role: z.string(),
        })),
        pendingInvite: z.object({ email: z.email(), expiresAt: z.iso.datetime(), householdInviteKey: z.number().int().positive() }).nullable(),
      });

      const body = oldClientSchema.parse((await http.as(owner).get('/v1/household')).body);

      expect(body.members).toHaveLength(4);
      expect(body.members.find((m) => m.role === 'owner')?.appuserKey).toBe(owner.appuserKey);
      expect(body.pendingInvite?.email).toBe('second@example.test');
    });

    it('answers a null pending invite when there is none', async () => {
      const response = await http.as(owner).get('/v1/household');
      expect(response.body.pendingInvite).toBeNull();
      expect(response.body.pendingInvites).toEqual([]);
    });
  });

  describe('the public invite preview', () => {
    it('names the household, the inviter and the role, and never the token', async () => {
      await db.em().nativeUpdate(Tenant, { tenantKey: household.tenant.tenantKey }, { name: 'The Silvas' });
      const invite = await addInvite(VIEWER, 'guest@example.test');

      const preview = await getInviteForValidation(db.em(), invite.token);

      expect(preview).toEqual({ email: 'guest@example.test', expiresAt: invite.expiresAt, householdName: 'The Silvas', inviterName: 'Owner', role: VIEWER });
    });

    it('refuses a used invite', async () => {
      const invite = await addInvite(MEMBER);
      await db.em().nativeUpdate(HouseholdInvite, { householdInviteKey: invite.householdInviteKey }, { status: HouseholdInviteStatus.ACCEPTED });
      await expect(getInviteForValidation(db.em(), invite.token)).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('joining as an existing user', () => {
    async function existingUser({ withData }: { withData: boolean }) {
      const own = await seedHousehold(db.em());
      if (!withData) await db.em().nativeDelete(Account, { tenantKey: own.tenant });
      return own;
    }

    it('moves a signed-in user from their empty household, with the invite role, once they confirm', async () => {
      const joiner = await existingUser({ withData: false });
      await addInvite(MEMBER, 'their-own-invitee@example.test', joiner.tenant);
      const invite = await addInvite(VIEWER, joiner.appuser.emailAddress);

      // Signing in with the token (the auth callback) joins nothing.
      await provisionHomeTenant(db.em(), await db.em().findOneOrFail(Appuser, { appuserKey: joiner.appuser.appuserKey }));
      expect((await http.as(joiner.appuser).get('/v1/household')).body.members).toHaveLength(1);

      const response = await http.as(joiner.appuser).post(`/v1/household/invites/${invite.token}/accept`);

      expect(response.status).toBe(200);
      const joined = (await activeMemberships()).find((m) => m.appuserKey.appuserKey === joiner.appuser.appuserKey);
      expect(joined?.role).toBe(VIEWER);
      expect(await activeMemberships(joiner.tenant.tenantKey)).toEqual([]);
      expect((await db.em().findOneOrFail(HouseholdInvite, { householdInviteKey: invite.householdInviteKey })).status).toBe(HouseholdInviteStatus.ACCEPTED);
      // The invites they had sent from the household they left no longer hold anyone's seat there.
      expect((await db.em().findOneOrFail(HouseholdInvite, { emailAddress: 'their-own-invitee@example.test' })).status).toBe(HouseholdInviteStatus.REVOKED);

      const view = await http.as(joiner.appuser).get('/v1/household');
      expect(view.body.members.map((m: { appuserKey: number }) => m.appuserKey)).toContain(owner.appuserKey);
    });

    it('stays in the joined household when they sign in again', async () => {
      const joiner = await existingUser({ withData: false });
      const invite = await addInvite(MEMBER, joiner.appuser.emailAddress);
      await http.as(joiner.appuser).post(`/v1/household/invites/${invite.token}/accept`);

      const home = await provisionHomeTenant(db.em(), await db.em().findOneOrFail(Appuser, { appuserKey: joiner.appuser.appuserKey }));

      expect(home.tenantKey).toBe(household.tenant.tenantKey);
      expect(await db.em().count(AppuserTenant, { appuserKey: { appuserKey: joiner.appuser.appuserKey }, recordActive: true })).toBe(1);
    });

    it('refuses, and moves nothing, when their household holds accounts or transactions', async () => {
      const joiner = await existingUser({ withData: true });
      const invite = await addInvite(MEMBER, joiner.appuser.emailAddress);

      const response = await http.as(joiner.appuser).post(`/v1/household/invites/${invite.token}/accept`);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ERROR_CODE.HOUSEHOLD_HAS_DATA);
      expect((await activeMemberships(joiner.tenant.tenantKey)).map((m) => m.appuserKey.appuserKey)).toEqual([joiner.appuser.appuserKey]);
      expect((await db.em().findOneOrFail(HouseholdInvite, { householdInviteKey: invite.householdInviteKey })).status).toBe(HouseholdInviteStatus.PENDING);
    });

    it('refuses the owner of a household that has other members', async () => {
      const joiner = await existingUser({ withData: false });
      await addPartner(db.em(), joiner);
      const invite = await addInvite(MEMBER, joiner.appuser.emailAddress);

      const response = await http.as(joiner.appuser).post(`/v1/household/invites/${invite.token}/accept`);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ERROR_CODE.HOUSEHOLD_HAS_MEMBERS);
    });

    it('refuses an invite sent to someone else', async () => {
      const joiner = await existingUser({ withData: false });
      const invite = await addInvite(MEMBER, 'someone-else@example.test');

      const response = await http.as(joiner.appuser).post(`/v1/household/invites/${invite.token}/accept`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ERROR_CODE.INVITE_EMAIL_MISMATCH);
      expect(await activeMemberships(joiner.tenant.tenantKey)).toHaveLength(1);
    });

    it('refuses when the household filled up since the invite was sent', async () => {
      vi.stubEnv('HOUSEHOLD_MAX_MEMBERS', '4');
      const joiner = await existingUser({ withData: false });
      const invite = await addInvite(MEMBER, joiner.appuser.emailAddress);

      const response = await http.as(joiner.appuser).post(`/v1/household/invites/${invite.token}/accept`);

      expect(response.body.code).toBe(ERROR_CODE.HOUSEHOLD_FULL);
      expect(await activeMemberships(joiner.tenant.tenantKey)).toHaveLength(1);
    });

    it('keeps the demo account where it is', async () => {
      const demo = await existingUser({ withData: false });
      await db.em().nativeUpdate(Appuser, { appuserKey: demo.appuser.appuserKey }, { accountType: AppuserAccountType.DEMO });
      const invite = await addInvite(MEMBER, demo.appuser.emailAddress);

      const response = await http.as(demo.appuser).post(`/v1/household/invites/${invite.token}/accept`);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ERROR_CODE.DEMO_READ_ONLY);
      expect(await activeMemberships(demo.tenant.tenantKey)).toHaveLength(1);
    });

    it('gives a person who leaves the joined household their own household back at the next sign-in', async () => {
      const joiner = await existingUser({ withData: false });
      const invite = await addInvite(MEMBER, joiner.appuser.emailAddress);
      await http.as(joiner.appuser).post(`/v1/household/invites/${invite.token}/accept`);
      await http.as(joiner.appuser).delete(`/v1/household/members/${joiner.appuser.appuserKey}`);

      const home = await provisionHomeTenant(db.em(), await db.em().findOneOrFail(Appuser, { appuserKey: joiner.appuser.appuserKey }));

      expect(home.tenantKey).toBe(joiner.tenant.tenantKey);
      expect((await activeMemberships(joiner.tenant.tenantKey)).map((m) => [m.appuserKey.appuserKey, m.role])).toEqual([[joiner.appuser.appuserKey, OWNER]]);
    });
  });
});
