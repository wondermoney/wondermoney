import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 7).toString('base64');
});
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Appuser } from '@entity/Appuser';
import userRoutes from '@route/user';

/*
 * `/v1/user/me/preferences` is self-scoped: the handler reads the appuser from the
 * session, never from a path parameter, so one household member can never read or
 * change the other's document.
 */
describe('/v1/user/me/preferences', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/user', userRoutes);

  it('defaults preview features off and persists a patch', async () => {
    const owner = await seedHousehold(db.em());

    const initial = await http.as(owner.appuser).get('/v1/user/me/preferences');
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ previewFeatures: false });

    const patched = await http.as(owner.appuser).patch('/v1/user/me/preferences').send({ previewFeatures: true });
    expect(patched.status).toBe(200);
    expect(patched.body).toEqual({ previewFeatures: true });

    const stored = await db.em().findOne(Appuser, { appuserKey: owner.appuser.appuserKey });
    expect(stored?.preferences).toEqual({ previewFeatures: true });
    expect((await http.as(owner.appuser).get('/v1/user/me/preferences')).body).toEqual({ previewFeatures: true });
  });

  it('rejects an invalid value without changing the stored document', async () => {
    const owner = await seedHousehold(db.em());

    const rejected = await http.as(owner.appuser).patch('/v1/user/me/preferences').send({ previewFeatures: 'yes' });

    expect(rejected.status).toBe(400);
    expect((await http.as(owner.appuser).get('/v1/user/me/preferences')).body).toEqual({ previewFeatures: false });
  });

  it('drops unknown keys instead of storing them', async () => {
    const owner = await seedHousehold(db.em());

    const patched = await http.as(owner.appuser).patch('/v1/user/me/preferences').send({ futureToggle: 'on', previewFeatures: true });

    expect(patched.status).toBe(200);
    expect(patched.body).toEqual({ previewFeatures: true });
    const stored = await db.em().findOne(Appuser, { appuserKey: owner.appuser.appuserKey });
    expect(stored?.preferences).toEqual({ previewFeatures: true });
  });

  it('refuses a patch with no known preference', async () => {
    const owner = await seedHousehold(db.em());

    const rejected = await http.as(owner.appuser).patch('/v1/user/me/preferences').send({ futureToggle: true });

    expect(rejected.status).toBe(400);
  });

  it('keeps each household member on their own preferences', async () => {
    const owner = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), owner);

    await http.as(partner).patch('/v1/user/me/preferences').send({ previewFeatures: true });

    expect((await http.as(owner.appuser).get('/v1/user/me/preferences')).body).toEqual({ previewFeatures: false });
    expect((await http.as(partner).get('/v1/user/me/preferences')).body).toEqual({ previewFeatures: true });

    await http.as(owner.appuser).patch('/v1/user/me/preferences').send({ previewFeatures: false });
    expect((await http.as(partner).get('/v1/user/me/preferences')).body).toEqual({ previewFeatures: true });
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await request(http.app).get('/v1/user/me/preferences');

    expect(response.status).toBe(401);
  });
});
