import { PassThrough, type Readable } from 'node:stream';

import * as Sentry from '@sentry/node';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 7).toString('base64');
});
vi.mock('@sentry/node', async (importOriginal) => ({ ...(await importOriginal<typeof import('@sentry/node')>()), captureException: vi.fn() }));

import { addAccount, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';

import { DataExportService, type StorageLike } from '../data-export.service';
import { openExportArchive } from '../export-archive-reader';

/*
 * Starting, tracking and downloading a person's full data export: one in progress at a time, a
 * few a day, visible only to the person who started it, and gone once its download window ends.
 */
describe('data export service', () => {
  useTestDatabase();

  const START = new Date('2026-11-08T10:00:00Z');
  const HOUR = 60 * 60 * 1000;

  function fakeStorage(enabled = true) {
    const objects = new Map<string, Buffer>();
    const deleteObject = vi.fn((bucket: string, key: string) => {
      objects.delete(`${bucket}/${key}`);
      return Promise.resolve();
    });
    const uploadStream = vi.fn(async (bucket: string, key: string, body: NodeJS.ReadableStream) => {
      const chunks: Buffer[] = [];
      for await (const chunk of body as Readable) chunks.push(chunk as Buffer);
      objects.set(`${bucket}/${key}`, Buffer.concat(chunks));
    });
    const storage: StorageLike = {
      deleteObject,
      generatePresignedDownloadUrl: vi.fn((bucket: string, key: string) => Promise.resolve(`https://files.example.test/${bucket}/${key}?signed`)),
      getFilesBucketName: () => 'files',
      isEnabled: () => enabled,
      uploadStream,
    };
    return { deleteObject, objects, storage, uploadStream };
  }

  function fakeQueue() {
    const sent: { at?: Date; data: unknown; queue: string }[] = [];
    const enqueue: Enqueue = {
      send: (queue, data) => {
        sent.push({ data, queue });
        return Promise.resolve(`job-${sent.length}`);
      },
      sendAfter: (queue, data, _options, at) => {
        sent.push({ at, data, queue });
        return Promise.resolve(`job-${sent.length}`);
      },
    };
    return { enqueue, sent };
  }

  function setup(options: { storage?: boolean } = {}) {
    let now = START;
    const { deleteObject, objects, storage, uploadStream } = fakeStorage(options.storage ?? true);
    const { enqueue, sent } = fakeQueue();
    const sendReadyEmail = vi.fn((_appuser: Appuser) => Promise.resolve());
    const service = () => new DataExportService(DI.em.fork(), { enqueue, now: () => now, sendReadyEmail, storage });
    return { advance: (ms: number) => { now = new Date(now.getTime() + ms); }, deleteObject, objects, sendReadyEmail, sent, service, uploadStream };
  }

  const scopeOf = (household: Household, member: Appuser = household.appuser) => ({ appuserKey: member.appuserKey, tenantKey: household.tenant.tenantKey });

  async function household() {
    const em = DI.em.fork();
    const owner = await seedHousehold(em);
    await addTransaction(em, owner, { amount: -12.5, date: new Date('2026-10-01T00:00:00Z'), status: 'BOOKED' });
    return owner;
  }

  /** Run the queued job the way the worker would. */
  async function runJob(ctx: ReturnType<typeof setup>, id: string) {
    const job = ctx.sent.find((entry) => entry.queue === 'user.data-export' && (entry.data as { correlationId: string }).correlationId === id);
    if (!job) throw new Error('no job queued');
    return ctx.service().runStoredExport(id, `job-${ctx.sent.indexOf(job) + 1}`);
  }

  describe('limits', () => {
    it('returns the export in progress instead of starting a second one', async () => {
      const owner = await household();
      const ctx = setup();

      const first = await ctx.service().start(scopeOf(owner));
      const second = await ctx.service().start(scopeOf(owner));

      expect(first).toEqual({ created: true, export: expect.objectContaining({ delivery: 'storage', status: 'queued' }) });
      expect(second).toEqual({ created: false, export: expect.objectContaining({ id: first.export.id }) });
      expect(ctx.sent.filter((entry) => entry.queue === 'user.data-export')).toHaveLength(1);
    });

    it('allows three exports a day and says when the next one is allowed', async () => {
      const owner = await household();
      const ctx = setup();
      for (let index = 0; index < 3; index += 1) {
        const { export: started } = await ctx.service().start(scopeOf(owner));
        await runJob(ctx, started.id);
        ctx.advance(HOUR);
      }

      await expect(ctx.service().start(scopeOf(owner))).rejects.toMatchObject({ retryAfter: 21 * 60 * 60, status: 429 });

      ctx.advance(21 * HOUR);
      await expect(ctx.service().start(scopeOf(owner))).resolves.toMatchObject({ created: true });
    });

    it("does not count the partner's exports against the person", async () => {
      const owner = await household();
      const partner = await addPartner(DI.em.fork(), owner);
      const ctx = setup();
      for (let index = 0; index < 3; index += 1) {
        const { export: started } = await ctx.service().start(scopeOf(owner));
        await runJob(ctx, started.id);
      }

      await expect(ctx.service().start(scopeOf(owner, partner))).resolves.toMatchObject({ created: true });
    });
  });

  describe('visibility', () => {
    it('is not found for anyone but the person who started it, the partner included', async () => {
      const owner = await household();
      const partner = await addPartner(DI.em.fork(), owner);
      const neighbour = await household();
      const ctx = setup();
      const { export: started } = await ctx.service().start(scopeOf(owner));

      await expect(ctx.service().get(owner.appuser.appuserKey, started.id)).resolves.toMatchObject({ id: started.id });
      for (const other of [partner, neighbour.appuser]) {
        await expect(ctx.service().get(other.appuserKey, started.id)).rejects.toMatchObject({ status: 404 });
        await expect(ctx.service().download(other.appuserKey, started.id, new PassThrough(), { onRedirect: vi.fn(), onStart: vi.fn() })).rejects.toMatchObject({ status: 404 });
      }
    });

    it("lists the person's exports of the last day, newest first, and nobody else's", async () => {
      const owner = await household();
      const partner = await addPartner(DI.em.fork(), owner);
      const ctx = setup();
      const { export: first } = await ctx.service().start(scopeOf(owner));
      await runJob(ctx, first.id);
      ctx.advance(HOUR);
      const { export: second } = await ctx.service().start(scopeOf(owner));
      await ctx.service().start(scopeOf(owner, partner));

      await expect(ctx.service().list(owner.appuser.appuserKey)).resolves.toEqual([expect.objectContaining({ id: second.id, status: 'queued' }), expect.objectContaining({ id: first.id, status: 'ready' })]);
      ctx.advance(24 * HOUR);
      await expect(ctx.service().list(owner.appuser.appuserKey)).resolves.toEqual([]);
    });

    it('is not found by the id of another kind of background operation', async () => {
      const owner = await household();
      const ctx = setup();
      const { default: backgroundOperationService } = await import('@service/operations/background-operation.service');
      await backgroundOperationService.createQueuedOperation({ appuserKey: owner.appuser.appuserKey, correlationId: 'account.csv-import:1', operationType: 'account.csv-import', resourceId: 'x', tenantKey: owner.tenant.tenantKey });

      await expect(ctx.service().get(owner.appuser.appuserKey, 'account.csv-import:1')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('with file storage', () => {
    it('stores the archive, emails the person and hands out a short-lived link', async () => {
      const owner = await household();
      const ctx = setup();
      const { export: started } = await ctx.service().start(scopeOf(owner));

      await expect(runJob(ctx, started.id)).resolves.toBe(true);

      const ready = await ctx.service().get(owner.appuser.appuserKey, started.id);
      expect(ready).toEqual(expect.objectContaining({ downloadUrl: expect.stringMatching(/^https:\/\/files\.example\.test\/files\/data-exports\//u), expiresAt: '2026-11-09T10:00:00.000Z', fileName: 'wondermoney-export-2026-11-08.zip', status: 'ready' }));
      const [stored] = [...ctx.objects.values()];
      const entries = unzipSync(new Uint8Array(stored!));
      expect(JSON.parse(strFromU8(entries['data/transactions.json']!))).toHaveLength(1);
      expect(ctx.sendReadyEmail).toHaveBeenCalledOnce();
    });

    it('deletes the archive after 24 hours', async () => {
      const owner = await household();
      const ctx = setup();
      const { export: started } = await ctx.service().start(scopeOf(owner));
      await runJob(ctx, started.id);

      const cleanup = ctx.sent.find((entry) => entry.queue === 'user.data-export.cleanup');
      expect(cleanup?.at).toEqual(new Date(START.getTime() + 24 * HOUR));
      await ctx.service().deleteStoredExport(started.id);
      await ctx.service().deleteStoredExport(started.id);

      expect(ctx.objects.size).toBe(0);
      expect(ctx.deleteObject).toHaveBeenCalledOnce();
      await expect(ctx.service().get(owner.appuser.appuserKey, started.id)).resolves.toMatchObject({ downloadUrl: null, status: 'expired' });
    });

    it('stops handing out links once 24 hours have passed, even before the file is deleted', async () => {
      const owner = await household();
      const ctx = setup();
      const { export: started } = await ctx.service().start(scopeOf(owner));
      await runJob(ctx, started.id);

      ctx.advance(24 * HOUR);

      await expect(ctx.service().get(owner.appuser.appuserKey, started.id)).resolves.toMatchObject({ downloadUrl: null, status: 'expired' });
    });

    it('records a failed export without retrying it, and lets the person start another', async () => {
      const owner = await household();
      const ctx = setup();
      ctx.uploadStream.mockRejectedValueOnce(new Error('store is down'));
      const { export: started } = await ctx.service().start(scopeOf(owner));

      await expect(runJob(ctx, started.id)).resolves.toBe(false);

      await expect(ctx.service().get(owner.appuser.appuserKey, started.id)).resolves.toMatchObject({ status: 'failed' });
      expect(ctx.sendReadyEmail).not.toHaveBeenCalled();
      await expect(ctx.service().start(scopeOf(owner))).resolves.toMatchObject({ created: true });
    });

    it('still finishes when the ready email cannot be sent', async () => {
      const owner = await household();
      const ctx = setup();
      ctx.sendReadyEmail.mockRejectedValueOnce(new Error('mail is down'));
      const { export: started } = await ctx.service().start(scopeOf(owner));

      await expect(runJob(ctx, started.id)).resolves.toBe(true);
      await expect(ctx.service().get(owner.appuser.appuserKey, started.id)).resolves.toMatchObject({ status: 'ready' });
    });
  });

  describe('without file storage', () => {
    it('streams the archive into the download once, and stores nothing', async () => {
      const owner = await household();
      const ctx = setup({ storage: false });
      const { export: started } = await ctx.service().start(scopeOf(owner));
      expect(started).toEqual(expect.objectContaining({ delivery: 'stream', downloadUrl: null, status: 'ready' }));
      expect(ctx.sent).toEqual([]);

      const output = new PassThrough();
      const chunks: Buffer[] = [];
      output.on('data', (chunk: Buffer) => chunks.push(chunk));
      const onStart = vi.fn();
      await ctx.service().download(owner.appuser.appuserKey, started.id, output, { onRedirect: vi.fn(), onStart });

      expect(onStart).toHaveBeenCalledWith('wondermoney-export-2026-11-08.zip');
      const entries = unzipSync(new Uint8Array(Buffer.concat(chunks)));
      expect(Object.keys(entries)).toContain('manifest.json');
      expect(ctx.uploadStream).not.toHaveBeenCalled();
      await expect(ctx.service().get(owner.appuser.appuserKey, started.id)).resolves.toMatchObject({ status: 'expired' });
      await expect(ctx.service().download(owner.appuser.appuserKey, started.id, new PassThrough(), { onRedirect: vi.fn(), onStart: vi.fn() })).rejects.toMatchObject({ status: 404 });
    });

    it('expires an export nobody downloaded after 30 minutes, and lets the person start another', async () => {
      const owner = await household();
      const ctx = setup({ storage: false });
      const { export: started } = await ctx.service().start(scopeOf(owner));

      ctx.advance(31 * 60 * 1000);

      await expect(ctx.service().get(owner.appuser.appuserKey, started.id)).resolves.toMatchObject({ status: 'expired' });
      const next = await ctx.service().start(scopeOf(owner));
      expect(next).toEqual({ created: true, export: expect.objectContaining({ status: 'ready' }) });
      expect(next.export.id).not.toBe(started.id);
      await expect(ctx.service().get(owner.appuser.appuserKey, started.id)).resolves.toMatchObject({ status: 'failed' });
    });

    it("streams only what the person can see, not the partner's private account", async () => {
      const em = DI.em.fork();
      const owner = await household();
      const partner = await addPartner(em, owner);
      const hidden = await addAccount(em, owner, { isPrivate: true, name: 'Owner private savings' });
      await addTransaction(em, owner, { account: hidden, amount: -99, date: new Date('2026-10-02T00:00:00Z'), status: 'BOOKED' });
      const ctx = setup({ storage: false });
      const { export: started } = await ctx.service().start(scopeOf(owner, partner));

      const output = new PassThrough();
      const chunks: Buffer[] = [];
      output.on('data', (chunk: Buffer) => chunks.push(chunk));
      await ctx.service().download(partner.appuserKey, started.id, output, { onRedirect: vi.fn(), onStart: vi.fn() });

      const entries = unzipSync(new Uint8Array(Buffer.concat(chunks)));
      expect(strFromU8(entries['data/accounts.json']!)).not.toContain('Owner private savings');
      expect(JSON.parse(strFromU8(entries['data/transactions.json']!))).toHaveLength(1);
    });
  });

  describe('with a password', () => {
    const PASSWORD = 'PASSWORD-MARKER correct horse battery';

    /** Everything a password could leak into: logs, error reports, job payloads, operation rows and stored secrets. */
    function watchForLeaks() {
      const logged = (['debug', 'error', 'fatal', 'info', 'trace', 'warn'] as const).map((level) => vi.spyOn(logger, level));
      const captured = vi.mocked(Sentry.captureException);
      captured.mockClear();
      return {
        async everything(ctx: ReturnType<typeof setup>): Promise<string> {
          const connection = DI.em.fork().getConnection();
          const operations = await connection.execute('select * from background_operation');
          const secrets = await connection.execute('select * from operation_secret');
          const calls = [...logged.flatMap((spy) => spy.mock.calls), ...captured.mock.calls];
          return JSON.stringify({ calls: calls.map((call) => call.map((arg) => (arg instanceof Error ? { message: arg.message, stack: arg.stack } : arg))), jobs: ctx.sent, operations, secrets });
        },
      };
    }

    const secrets = async () => DI.em.fork().getConnection().execute('select * from operation_secret');

    async function readStored(ctx: ReturnType<typeof setup>, password?: string) {
      const [stored] = [...ctx.objects.values()];
      const archive = await openExportArchive(new Uint8Array(stored!), password === undefined ? {} : { password });
      try {
        return { encrypted: archive.encrypted, transactions: JSON.parse(strFromU8(await archive.read('data/transactions.json'))) as unknown[] };
      } finally {
        await archive.close();
      }
    }

    it('stores an archive that opens only with the password', async () => {
      const owner = await household();
      const ctx = setup();
      const { export: started } = await ctx.service().start(scopeOf(owner), { password: PASSWORD });
      expect(started).toEqual(expect.objectContaining({ encrypted: true, status: 'queued' }));

      await expect(runJob(ctx, started.id)).resolves.toBe(true);

      await expect(readStored(ctx, PASSWORD)).resolves.toEqual({ encrypted: true, transactions: [expect.objectContaining({ settlementAmount: '-12.5' })] });
      await expect(readStored(ctx)).rejects.toMatchObject({ code: 'password_required' });
      await expect(readStored(ctx, 'a wrong password entirely')).rejects.toMatchObject({ code: 'password_incorrect' });
      await expect(ctx.service().get(owner.appuser.appuserKey, started.id)).resolves.toMatchObject({ encrypted: true, status: 'ready' });
    });

    it('keeps the password out of logs, error reports, the job and the operation, and forgets it once used', async () => {
      const owner = await household();
      const ctx = setup();
      const leaks = watchForLeaks();
      const { export: started } = await ctx.service().start(scopeOf(owner), { password: PASSWORD });
      expect(await secrets()).toHaveLength(1);

      await runJob(ctx, started.id);

      expect(await leaks.everything(ctx)).not.toContain('PASSWORD-MARKER');
      expect(await secrets()).toEqual([]);
    });

    it('keeps the password out of logs and error reports when the export fails, and forgets it', async () => {
      const owner = await household();
      const ctx = setup();
      const leaks = watchForLeaks();
      ctx.uploadStream.mockRejectedValueOnce(new Error('store is down'));
      const { export: started } = await ctx.service().start(scopeOf(owner), { password: PASSWORD });

      await expect(runJob(ctx, started.id)).resolves.toBe(false);

      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
      expect(await leaks.everything(ctx)).not.toContain('PASSWORD-MARKER');
      expect(await secrets()).toEqual([]);
    });

    it('fails rather than store an unprotected archive when the password is gone', async () => {
      const owner = await household();
      const ctx = setup();
      const { export: started } = await ctx.service().start(scopeOf(owner), { password: PASSWORD });
      await DI.em.fork().getConnection().execute('delete from operation_secret');

      await expect(runJob(ctx, started.id)).resolves.toBe(false);

      expect(ctx.uploadStream).not.toHaveBeenCalled();
      await expect(ctx.service().get(owner.appuser.appuserKey, started.id)).resolves.toMatchObject({ status: 'failed' });
    });

    it('streams an encrypted archive once, and forgets the password', async () => {
      const owner = await household();
      const ctx = setup({ storage: false });
      const leaks = watchForLeaks();
      const { export: started } = await ctx.service().start(scopeOf(owner), { password: PASSWORD });

      const output = new PassThrough();
      const chunks: Buffer[] = [];
      output.on('data', (chunk: Buffer) => chunks.push(chunk));
      await ctx.service().download(owner.appuser.appuserKey, started.id, output, { onRedirect: vi.fn(), onStart: vi.fn() });

      const archive = await openExportArchive(new Uint8Array(Buffer.concat(chunks)), { password: PASSWORD });
      expect(archive.encrypted).toBe(true);
      await archive.close();
      expect(await secrets()).toEqual([]);
      expect(await leaks.everything(ctx)).not.toContain('PASSWORD-MARKER');
    });

    it('returns the protected export in progress to a second request for one', async () => {
      const owner = await household();
      const ctx = setup();
      const first = await ctx.service().start(scopeOf(owner), { password: PASSWORD });

      const second = await ctx.service().start(scopeOf(owner), { password: PASSWORD });

      expect(second).toEqual({ created: false, export: expect.objectContaining({ encrypted: true, id: first.export.id }) });
      expect(await secrets()).toHaveLength(1);
    });

    it('refuses to start a protected export while an unprotected one is in progress, and the other way round', async () => {
      const owner = await household();
      const partner = await addPartner(DI.em.fork(), owner);
      const ctx = setup();
      await ctx.service().start(scopeOf(owner));
      await ctx.service().start(scopeOf(owner, partner), { password: PASSWORD });

      await expect(ctx.service().start(scopeOf(owner), { password: PASSWORD })).rejects.toMatchObject({ code: 'data_export_in_progress', status: 409 });
      await expect(ctx.service().start(scopeOf(owner, partner))).rejects.toMatchObject({ code: 'data_export_in_progress', status: 409 });
      expect(await secrets()).toHaveLength(1);
    });

    it('forgets the password of a streamed export nobody downloaded', async () => {
      const owner = await household();
      const ctx = setup({ storage: false });
      await ctx.service().start(scopeOf(owner), { password: PASSWORD });

      ctx.advance(31 * 60 * 1000);
      await ctx.service().start(scopeOf(owner));

      expect(await secrets()).toEqual([]);
    });

    it('marks an export without a password as unprotected', async () => {
      const owner = await household();
      const ctx = setup();

      await expect(ctx.service().start(scopeOf(owner))).resolves.toMatchObject({ export: expect.objectContaining({ encrypted: false }) });
      expect(await secrets()).toEqual([]);
    });
  });
});
