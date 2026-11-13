import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 7).toString('base64');
});
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { PushDevice, PushDevicePlatform } from '@entity/PushDevice';
import userRoutes from '@route/user';
import { createApiToken } from '@service/api-token/api-token.service';
import type { Enqueue } from '@service/queue/enqueue';

const OWNER_TOKEN = 'ExponentPushToken[owner-phone-0001]';
const path = (token: string) => `/v1/user/me/push-devices/${encodeURIComponent(token)}`;

/*
 * A push token is a way to put text on someone's lock screen. Each person manages only their own
 * phones, only from a signed-in session, and nothing is registered or sent unless the operator
 * turned push on.
 */
describe('/v1/user/me/push-*', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const sent: { payload: unknown; queue: string }[] = [];
  const enqueue = {
    send: (queue: string, payload: unknown) => { sent.push({ payload, queue }); return Promise.resolve('job-id'); },
    sendAfter: () => Promise.resolve('job-id'),
  } as unknown as Enqueue;
  const http = tenantHttp('/v1/user', userRoutes, { enqueue });

  afterEach(() => {
    vi.unstubAllEnvs();
    sent.length = 0;
  });

  const devices = () => db.em().find(PushDevice, {}, { orderBy: { pushDeviceKey: 'asc' }, populate: ['appuserKey'] });

  it('registers a phone for the signed-in person, and only that person can remove it', async () => {
    vi.stubEnv('PUSH_ENABLED', 'true');
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);

    const registered = await http.as(household.appuser).post('/v1/user/me/push-devices').send({ appVersion: '1.2.0', platform: 'ios', token: OWNER_TOKEN });
    expect(registered.status).toBe(204);
    expect((await devices()).map((device) => [device.token, device.appuserKey.appuserKey, device.sessionId])).toEqual([
      [OWNER_TOKEN, household.appuser.appuserKey, `session-${household.appuser.externalUserId}`],
    ]);

    // The partner cannot remove the owner's phone, and the answer does not say whether it exists.
    expect((await http.as(partner).delete(path(OWNER_TOKEN))).status).toBe(204);
    await expect(devices()).resolves.toHaveLength(1);

    expect((await http.as(household.appuser).delete(path(OWNER_TOKEN))).status).toBe(204);
    await expect(devices()).resolves.toHaveLength(0);
  });

  it('moves a token to whoever signs in on that phone next', async () => {
    vi.stubEnv('PUSH_ENABLED', 'true');
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);

    await http.as(household.appuser).post('/v1/user/me/push-devices').send({ platform: 'android', token: OWNER_TOKEN });
    await http.as(partner).post('/v1/user/me/push-devices').send({ platform: 'android', token: OWNER_TOKEN });

    expect((await devices()).map((device) => device.appuserKey.appuserKey)).toEqual([partner.appuserKey]);
  });

  it('rejects something that is not an Expo push token', async () => {
    vi.stubEnv('PUSH_ENABLED', 'true');
    const household = await seedHousehold(db.em());

    const response = await http.as(household.appuser).post('/v1/user/me/push-devices').send({ platform: 'ios', token: 'https://example.test/steal' });

    expect(response.status).toBe(400);
    await expect(devices()).resolves.toHaveLength(0);
  });

  it('refuses the read-only demo account', async () => {
    vi.stubEnv('PUSH_ENABLED', 'true');
    const household = await seedHousehold(db.em());
    await db.em().nativeUpdate(Appuser, { appuserKey: household.appuser.appuserKey }, { accountType: AppuserAccountType.DEMO });

    const response = await http.as(household.appuser).post('/v1/user/me/push-devices').send({ platform: 'ios', token: OWNER_TOKEN });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('demo_read_only');
    await expect(devices()).resolves.toHaveLength(0);
  });

  it('refuses a personal API token, whatever its scopes', async () => {
    vi.stubEnv('PUSH_ENABLED', 'true');
    const household = await seedHousehold(db.em());
    const { token } = await createApiToken({ appuser: household.appuser, expiresInDays: 30, name: 'Script', scopes: ['read', 'write'], tenant: household.tenant }, db.em());

    const registered = await http.asToken(token).post('/v1/user/me/push-devices').send({ platform: 'ios', token: OWNER_TOKEN });
    const tested = await http.asToken(token).post('/v1/user/me/push-test');

    expect(registered.status).toBe(403);
    expect(tested.status).toBe(403);
    await expect(devices()).resolves.toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('with push off, registers nothing, enables nothing and sends nothing, but still lets a phone clean up', async () => {
    vi.stubEnv('PUSH_ENABLED', '');
    const household = await seedHousehold(db.em());
    const em = db.em();
    em.create(PushDevice, { appuserKey: household.appuser, platform: PushDevicePlatform.IOS, sessionId: 'session-1', token: OWNER_TOKEN }, { partial: true });
    await em.flush();

    const registered = await http.as(household.appuser).post('/v1/user/me/push-devices').send({ platform: 'ios', token: 'ExponentPushToken[second-phone-01]' });
    const enabled = await http.as(household.appuser).patch('/v1/user/me/push-preferences').send({ budgetAlerts: true });
    const tested = await http.as(household.appuser).post('/v1/user/me/push-test');
    const disabled = await http.as(household.appuser).patch('/v1/user/me/push-preferences').send({ budgetAlerts: false });
    const removed = await http.as(household.appuser).delete(path(OWNER_TOKEN));

    expect([registered.status, enabled.status, tested.status]).toEqual([501, 501, 501]);
    expect(registered.body.code).toBe('feature_disabled');
    expect(disabled.status).toBe(200);
    expect(removed.status).toBe(204);
    await expect(devices()).resolves.toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('keeps every push category off until the person turns it on, and leaves the email switches alone', async () => {
    vi.stubEnv('PUSH_ENABLED', 'true');
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);

    expect((await http.as(household.appuser).get('/v1/user/me/push-preferences')).body).toEqual({ bankSyncAlerts: false, budgetAlerts: false, creditCardDueReminders: false });

    const patched = await http.as(household.appuser).patch('/v1/user/me/push-preferences').send({ budgetAlerts: true });
    expect(patched.status).toBe(200);
    expect(patched.body).toEqual({ bankSyncAlerts: false, budgetAlerts: true, creditCardDueReminders: false });

    const email = await http.as(household.appuser).get('/v1/user/me/email-notification-preferences');
    expect(email.body).toMatchObject({ bankSyncAlerts: { storedEnabled: true }, budgetAlerts: { storedEnabled: true }, creditCardDueReminders: { storedEnabled: true } });
    expect((await http.as(partner).get('/v1/user/me/push-preferences')).body.budgetAlerts).toBe(false);
  });

  it('sends a test notification only to someone with a registered phone', async () => {
    vi.stubEnv('PUSH_ENABLED', 'true');
    const household = await seedHousehold(db.em());

    const without = await http.as(household.appuser).post('/v1/user/me/push-test');
    expect(without.status).toBe(409);
    expect(sent).toHaveLength(0);

    await http.as(household.appuser).post('/v1/user/me/push-devices').send({ platform: 'ios', token: OWNER_TOKEN });
    const queued = await http.as(household.appuser).post('/v1/user/me/push-test');

    expect(queued.status).toBe(202);
    expect(sent).toEqual([{ payload: { appuserKey: household.appuser.appuserKey, notification: { kind: 'test' }, type: 'send' }, queue: 'push-send' }]);
  });

  it('needs a session', async () => {
    const response = await request(http.app).post('/v1/user/me/push-devices').send({ platform: 'ios', token: OWNER_TOKEN });
    expect(response.status).toBe(401);
  });
});
