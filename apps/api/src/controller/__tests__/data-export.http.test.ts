import { strFromU8, unzipSync } from 'fflate';
import type { Response } from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 7).toString('base64');
});
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import userRoutes from '@route/user';
import { openExportArchive } from '@service/data-export/export-archive-reader';
import logger from '@utils/logger';

/*
 * The export endpoints on a server without file storage: the zip is built into the download
 * response. Only the person who started an export can see or download it, and a fourth export in
 * a day is refused with a Retry-After.
 */
describe('/v1/user/me/exports', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/user', userRoutes);

  const binary = (res: Response, callback: (error: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => { callback(null, Buffer.concat(chunks)); });
  };

  it('starts an export, reports it ready and downloads it as a zip', async () => {
    const owner = await seedHousehold(db.em());

    const started = await http.as(owner.appuser).post('/v1/user/me/exports');
    expect(started.status).toBe(202);
    expect(started.body.export).toEqual(expect.objectContaining({ delivery: 'stream', status: 'ready' }));
    const id = started.body.export.id as string;

    const again = await http.as(owner.appuser).post('/v1/user/me/exports');
    expect(again.status).toBe(200);
    expect(again.body.export.id).toBe(id);

    const download = await http.as(owner.appuser).get(`/v1/user/me/exports/${encodeURIComponent(id)}/download`).buffer(true).parse(binary);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('application/zip');
    expect(download.headers['content-disposition']).toMatch(/^attachment; filename="wondermoney-export-\d{4}-\d{2}-\d{2}\.zip"$/u);
    const entries = unzipSync(new Uint8Array(download.body as Buffer));
    expect(JSON.parse(strFromU8(entries['manifest.json']!))).toEqual(expect.objectContaining({ format: 'wondermoney-export', formatVersion: '1.0' }));
  });

  it("hides one member's export from the other", async () => {
    const owner = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), owner);
    const started = await http.as(owner.appuser).post('/v1/user/me/exports');
    const id = encodeURIComponent(started.body.export.id as string);

    expect((await http.as(partner).get(`/v1/user/me/exports/${id}`)).status).toBe(404);
    expect((await http.as(partner).get(`/v1/user/me/exports/${id}/download`)).status).toBe(404);
  });

  it('refuses a fourth export in a day with a Retry-After', async () => {
    const owner = await seedHousehold(db.em());
    for (let index = 0; index < 3; index += 1) {
      const started = await http.as(owner.appuser).post('/v1/user/me/exports');
      expect(started.status).toBe(202);
      const download = await http.as(owner.appuser).get(`/v1/user/me/exports/${encodeURIComponent(started.body.export.id as string)}/download`).buffer(true).parse(binary);
      expect(download.status).toBe(200);
    }

    const refused = await http.as(owner.appuser).post('/v1/user/me/exports');

    expect(refused.status).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  describe('with a password', () => {
    const PASSWORD = 'PASSWORD-MARKER battery staple';

    it('downloads an archive that opens only with the password', async () => {
      const owner = await seedHousehold(db.em());

      const started = await http.as(owner.appuser).post('/v1/user/me/exports').send({ password: PASSWORD });
      expect(started.status).toBe(202);
      expect(started.body.export).toEqual(expect.objectContaining({ encrypted: true, status: 'ready' }));
      const download = await http.as(owner.appuser).get(`/v1/user/me/exports/${encodeURIComponent(started.body.export.id as string)}/download`).buffer(true).parse(binary);

      expect(download.status).toBe(200);
      await expect(openExportArchive(new Uint8Array(download.body as Buffer))).rejects.toMatchObject({ code: 'password_required' });
      const archive = await openExportArchive(new Uint8Array(download.body as Buffer), { password: PASSWORD });
      expect(JSON.parse(strFromU8(await archive.read('manifest.json')))).toEqual(expect.objectContaining({ format: 'wondermoney-export' }));
      await archive.close();
    });

    it('refuses a password shorter than 16 characters, counting accented letters once, without logging it', async () => {
      const owner = await seedHousehold(db.em());
      const logged = (['error', 'info', 'warn'] as const).map((level) => vi.spyOn(logger, level));

      for (const password of ['PASSWORD-MARKER', 'PASSWORD-MARKEé', '', 123456789012345]) {
        const refused = await http.as(owner.appuser).post('/v1/user/me/exports').send({ password });
        expect(refused.status).toBe(400);
        expect(JSON.stringify(refused.body)).not.toContain('PASSWORD-M');
      }

      expect(JSON.stringify(logged.flatMap((spy) => spy.mock.calls))).not.toContain('PASSWORD-M');
      expect((await http.as(owner.appuser).get('/v1/user/me/exports')).body.exports).toEqual([]);
    });

    it('starts an unprotected export when no password is sent', async () => {
      const owner = await seedHousehold(db.em());

      const started = await http.as(owner.appuser).post('/v1/user/me/exports').send({});

      expect(started.status).toBe(202);
      expect(started.body.export).toEqual(expect.objectContaining({ encrypted: false }));
    });
  });
});
