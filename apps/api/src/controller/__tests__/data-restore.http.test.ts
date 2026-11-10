import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 7).toString('base64');
});
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
const storage = vi.hoisted(() => ({ enabled: true }));
vi.mock('@service/storage/s3', () => ({
  default: {
    deleteObject: () => Promise.resolve(),
    generatePresignedUploadUrl: (bucket: string, key: string) => Promise.resolve(`https://files.example.test/${bucket}/${key}?signed`),
    getFilesBucketName: () => 'files',
    getObjectBuffer: () => Promise.reject(new Error('NoSuchKey')),
    getObjectSize: () => Promise.reject(new Error('NotFound')),
    isEnabled: () => storage.enabled,
  },
}));

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { emptyHousehold } from '@app/__tests__/__helpers__/restore-fixtures';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import userRoutes from '@route/user';

/*
 * The restore endpoints: who may start one, what the request must say, and that a restore is
 * visible only to the person who started it.
 */
describe('/v1/user/me/restores', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/user', userRoutes);

  it('starts a restore in an empty household and hands back where to upload the file', async () => {
    storage.enabled = true;
    const { appuser } = await emptyHousehold(db.em());

    const overview = await http.as(appuser).get('/v1/user/me/restores');
    expect(overview.body).toEqual({ availability: { eligible: true, reason: null }, restores: [] });

    const started = await http.as(appuser).post('/v1/user/me/restores').send({ size: 2048 });
    expect(started.status).toBe(201);
    expect(started.body.restore).toEqual(expect.objectContaining({ status: 'awaiting_upload', upload: expect.objectContaining({ headers: { 'Content-Type': 'application/zip' }, method: 'PUT' }) }));

    const id = encodeURIComponent(started.body.restore.id as string);
    expect((await http.as(appuser).get(`/v1/user/me/restores/${id}`)).body.restore).toEqual(expect.objectContaining({ status: 'awaiting_upload' }));
    const early = await http.as(appuser).post(`/v1/user/me/restores/${id}/validate`).send({});
    expect(early.status).toBe(409);
    expect(early.body).toEqual(expect.objectContaining({ code: 'data_restore_not_uploaded' }));
  });

  it('needs the file size, within the limit', async () => {
    storage.enabled = true;
    const { appuser } = await emptyHousehold(db.em());

    expect((await http.as(appuser).post('/v1/user/me/restores').send({})).status).toBe(400);
    expect((await http.as(appuser).post('/v1/user/me/restores').send({ size: 10 * 1024 * 1024 * 1024 })).status).toBe(400);
  });

  it('refuses a household with data, and a partner, with a code to show', async () => {
    storage.enabled = true;
    const owner = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), owner);

    const busy = await http.as(owner.appuser).post('/v1/user/me/restores').send({ size: 2048 });
    expect(busy.status).toBe(409);
    expect(busy.body).toEqual(expect.objectContaining({ code: 'household_not_empty' }));
    expect((await http.as(partner).get('/v1/user/me/restores')).body.availability).toEqual({ eligible: false, reason: 'owner_required' });
  });

  it("hides one person's restore from everyone else", async () => {
    storage.enabled = true;
    const { appuser } = await emptyHousehold(db.em());
    const other = await emptyHousehold(db.em());
    const started = await http.as(appuser).post('/v1/user/me/restores').send({ size: 2048 });
    const id = encodeURIComponent(started.body.restore.id as string);

    expect((await http.as(other.appuser).get(`/v1/user/me/restores/${id}`)).status).toBe(404);
    expect((await http.as(other.appuser).post(`/v1/user/me/restores/${id}/validate`).send({})).status).toBe(404);
    expect((await http.as(other.appuser).post(`/v1/user/me/restores/${id}/commit`)).status).toBe(404);
  });

  it('never echoes a password it refuses', async () => {
    storage.enabled = true;
    const { appuser } = await emptyHousehold(db.em());
    const started = await http.as(appuser).post('/v1/user/me/restores').send({ size: 2048 });
    const password = `secret-${'x'.repeat(2000)}`;

    const refused = await http.as(appuser).post(`/v1/user/me/restores/${encodeURIComponent(started.body.restore.id as string)}/validate`).send({ password });

    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).not.toContain('secret-');
  });

  it('says restore is unavailable on a server without file storage', async () => {
    storage.enabled = false;
    const { appuser } = await emptyHousehold(db.em());

    expect((await http.as(appuser).get('/v1/user/me/restores')).body.availability).toEqual({ eligible: false, reason: 'file_storage_disabled' });
    const started = await http.as(appuser).post('/v1/user/me/restores').send({ size: 2048 });
    expect(started.status).toBe(501);
    expect(started.body).toEqual(expect.objectContaining({ code: 'feature_disabled' }));
  });
});
