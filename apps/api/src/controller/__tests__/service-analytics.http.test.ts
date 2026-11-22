import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 7).toString('base64');
});
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Appuser } from '@entity/Appuser';
import { HouseholdRole } from '@entity/AppuserTenant';
import userRoutes from '@route/user';

/*
 * `/v1/user/me/service-analytics` is the person's own objection to service analytics: self-scoped
 * like every `/me` route, and a viewer may change it, since it is theirs and not the household's.
 */
describe('/v1/user/me/service-analytics', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/user', userRoutes);

  afterEach(() => vi.unstubAllEnvs());

  it('is on until the person objects, and records when they did', async () => {
    vi.stubEnv('ANALYTICS_OUTBOX_MODE', 'live');
    const owner = await seedHousehold(db.em());

    expect((await http.as(owner.appuser).get('/v1/user/me/service-analytics')).body).toEqual({ available: true, enabled: true });

    const objected = await http.as(owner.appuser).put('/v1/user/me/service-analytics').send({ enabled: false });
    expect(objected.status).toBe(200);
    expect(objected.body).toEqual({ available: true, enabled: false });
    const stored = await db.em().fork().findOneOrFail(Appuser, { appuserKey: owner.appuser.appuserKey });
    expect(stored.analyticsObjectedAt).toBeInstanceOf(Date);

    const allowed = await http.as(owner.appuser).put('/v1/user/me/service-analytics').send({ enabled: true });
    expect(allowed.body).toEqual({ available: true, enabled: true });
    expect((await db.em().fork().findOneOrFail(Appuser, { appuserKey: owner.appuser.appuserKey })).analyticsObjectedAt).toBeNull();
  });

  it('says when this server records no service analytics at all', async () => {
    const owner = await seedHousehold(db.em());

    expect((await http.as(owner.appuser).get('/v1/user/me/service-analytics')).body).toEqual({ available: false, enabled: true });
  });

  it("changes only the caller's own choice, and a viewer may make it", async () => {
    const owner = await seedHousehold(db.em());
    const viewer = await addPartner(db.em(), owner, { role: HouseholdRole.VIEWER });

    const response = await http.as(viewer).put('/v1/user/me/service-analytics').send({ enabled: false });

    expect(response.status).toBe(200);
    expect((await db.em().fork().findOneOrFail(Appuser, { appuserKey: viewer.appuserKey })).analyticsObjectedAt).toBeInstanceOf(Date);
    expect((await db.em().fork().findOneOrFail(Appuser, { appuserKey: owner.appuser.appuserKey })).analyticsObjectedAt).toBeNull();
  });

  it('refuses anything but a boolean', async () => {
    const owner = await seedHousehold(db.em());

    expect((await http.as(owner.appuser).put('/v1/user/me/service-analytics').send({ enabled: 'no' })).status).toBe(400);
    expect((await http.as(owner.appuser).put('/v1/user/me/service-analytics').send({})).status).toBe(400);
  });
});
