import * as Sentry from '@sentry/node';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 7).toString('base64');
});
vi.mock('@sentry/node', async (importOriginal) => ({ ...(await importOriginal<typeof import('@sentry/node')>()), captureException: vi.fn() }));

import { addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { allRowCounts, emptyHousehold, exportBytes, householdRowCounts, richHousehold, type Scope, scopeOf } from '@app/__tests__/__helpers__/restore-fixtures';
import { DI } from '@app/database/di';
import backgroundOperationRecoveryService from '@service/operations/background-operation-recovery.service';
import type { Enqueue } from '@service/queue/enqueue';
import type { RecoveryTransport } from '@service/queue/recovery-transport';
import logger from '@utils/logger';

import { type DataRestoreDeps, DataRestoreService, type RestoreStorage } from '../data-restore.service';

/*
 * A person restoring their export: start, upload, validate (a dry run), commit. Only the owner of
 * an empty household can, only into that household, and only their own restore is theirs to see.
 * A protected export needs its password, which is never stored in clear or logged.
 */
describe('data restore service', () => {
  const db = useTestDatabase();

  const START = new Date('2026-11-09T10:00:00Z');
  const MINUTE = 60 * 1000;
  const PASSWORD = 'a long enough backup password';

  function setup(extra: Pick<DataRestoreDeps, 'heartbeatMs' | 'restore'> = {}) {
    let now = START;
    const objects = new Map<string, Buffer>();
    const storage: RestoreStorage = {
      deleteObject: vi.fn((_bucket: string, key: string) => {
        objects.delete(key);
        return Promise.resolve();
      }),
      generatePresignedUploadUrl: vi.fn((bucket: string, key: string) => Promise.resolve(`https://files.example.test/${bucket}/${key}?signed`)),
      getFilesBucketName: () => 'files',
      getObjectBuffer: (_bucket: string, key: string) => {
        const object = objects.get(key);
        return object ? Promise.resolve(object) : Promise.reject(new Error('NoSuchKey'));
      },
      getObjectSize: (_bucket: string, key: string) => (objects.has(key) ? Promise.resolve(objects.get(key)!.length) : Promise.reject(new Error('NotFound'))),
      isEnabled: () => true,
    };
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
    const service = () => new DataRestoreService(DI.em.fork(), { enqueue, now: () => now, storage, ...extra });
    const upload = (key: string, bytes: Uint8Array) => objects.set(key.split('/files/')[1]!.split('?')[0]!, Buffer.from(bytes));
    /** Run the last job queued for `id`, as the worker would. */
    const runJob = (id: string) => {
      const index = sent.findLastIndex((entry) => entry.queue === 'user.data-restore' && (entry.data as { correlationId: string }).correlationId === id);
      if (index < 0) throw new Error('no job queued');
      const { mode } = sent[index]!.data as { mode: 'commit' | 'validate' };
      return service().run(id, `job-${index + 1}`, mode);
    };
    return { advance: (ms: number) => { now = new Date(now.getTime() + ms); }, objects, runJob, sent, service, storage, upload };
  }

  /** Start a restore of `bytes` and upload them. */
  async function started(ctx: ReturnType<typeof setup>, scope: Scope, bytes: Uint8Array) {
    const restore = await ctx.service().start(scope, { size: bytes.length });
    ctx.upload(restore.upload!.url, bytes);
    return restore;
  }

  async function source(password?: string) {
    const { owner } = await richHousehold(db.em());
    return exportBytes(db.em(), scopeOf(owner), password ? { password } : {});
  }

  describe('the whole flow', () => {
    it('validates, restores, then deletes the file and queues balance and snapshot rebuilds', async () => {
      const bytes = await source();
      const target = await emptyHousehold(db.em());
      const ctx = setup();

      const restore = await started(ctx, scopeOf(target), bytes);
      expect(restore).toEqual(expect.objectContaining({ status: 'awaiting_upload', upload: expect.objectContaining({ method: 'PUT', url: expect.stringContaining('data-restores/') }) }));

      await expect(ctx.service().validate(scopeOf(target), restore.id, {})).resolves.toMatchObject({ status: 'validating' });
      await expect(ctx.runJob(restore.id)).resolves.toBe(true);
      const ready = await ctx.service().get(target.appuser.appuserKey, restore.id);
      expect(ready).toEqual(expect.objectContaining({ encrypted: false, export: expect.objectContaining({ exportedAt: '2026-11-08T10:00:00.000Z' }), status: 'ready' }));
      expect(ready.summary!.counts).toEqual(expect.objectContaining({ accounts: 3, transactions: 6 }));
      // The dry run wrote nothing.
      expect(Object.values(await householdRowCounts(db.em(), target.tenant.tenantKey)).every((count) => count === 0)).toBe(true);

      await expect(ctx.service().commit(scopeOf(target), restore.id)).resolves.toMatchObject({ status: 'restoring' });
      await expect(ctx.runJob(restore.id)).resolves.toBe(true);

      await expect(ctx.service().get(target.appuser.appuserKey, restore.id)).resolves.toMatchObject({ status: 'restored', summary: expect.objectContaining({ counts: expect.objectContaining({ transactions: 6 }) }) });
      expect((await householdRowCounts(db.em(), target.tenant.tenantKey))['transaction']).toBe(6);
      expect(ctx.objects.size).toBe(0);
      expect(ctx.sent.map((entry) => entry.queue)).toEqual(expect.arrayContaining(['fx.reconvert', 'portfolio.snapshot.manual', 'user.data-restore.cleanup']));
    });

    it('treats a second commit as the first, and runs the restore once', async () => {
      const bytes = await source();
      const target = await emptyHousehold(db.em());
      const ctx = setup();
      const restore = await started(ctx, scopeOf(target), bytes);
      await ctx.service().validate(scopeOf(target), restore.id, {});
      await ctx.runJob(restore.id);

      await ctx.service().commit(scopeOf(target), restore.id);
      await expect(ctx.service().commit(scopeOf(target), restore.id)).resolves.toMatchObject({ status: 'restoring' });
      await ctx.runJob(restore.id);
      await expect(ctx.runJob(restore.id)).resolves.toBe(false);

      expect(ctx.sent.filter((entry) => entry.queue === 'user.data-restore' && (entry.data as { mode: string }).mode === 'commit')).toHaveLength(1);
      expect((await householdRowCounts(db.em(), target.tenant.tenantKey))['transaction']).toBe(6);
    });
  });

  describe('a password-protected export', () => {
    it('asks for the password, refuses a wrong one, and restores with the right one', async () => {
      const bytes = await source(PASSWORD);
      const target = await emptyHousehold(db.em());
      const ctx = setup();
      const restore = await started(ctx, scopeOf(target), bytes);

      await ctx.service().validate(scopeOf(target), restore.id, {});
      await ctx.runJob(restore.id);
      await expect(ctx.service().get(target.appuser.appuserKey, restore.id)).resolves.toMatchObject({ error: { code: 'password_required' }, status: 'invalid' });

      await ctx.service().validate(scopeOf(target), restore.id, { password: 'not the right password' });
      await ctx.runJob(restore.id);
      await expect(ctx.service().get(target.appuser.appuserKey, restore.id)).resolves.toMatchObject({ error: { code: 'password_incorrect' }, status: 'invalid' });

      await ctx.service().validate(scopeOf(target), restore.id, { password: PASSWORD });
      await ctx.runJob(restore.id);
      await expect(ctx.service().get(target.appuser.appuserKey, restore.id)).resolves.toMatchObject({ encrypted: true, status: 'ready' });

      await ctx.service().commit(scopeOf(target), restore.id);
      await ctx.runJob(restore.id);
      await expect(ctx.service().get(target.appuser.appuserKey, restore.id)).resolves.toMatchObject({ status: 'restored' });
      // The password was used up by the restore.
      await expect(db.em().getConnection().execute('select * from operation_secret')).resolves.toEqual([]);
    });

    it('keeps the password out of the operation, the job payloads, the logs and error reports', async () => {
      const bytes = await source(PASSWORD);
      const target = await emptyHousehold(db.em());
      const ctx = setup();
      const logged: unknown[] = [];
      for (const level of ['debug', 'error', 'info', 'warn'] as const) vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => { logged.push(args); }));
      const restore = await started(ctx, scopeOf(target), bytes);

      await ctx.service().validate(scopeOf(target), restore.id, { password: PASSWORD });
      await ctx.runJob(restore.id);
      await ctx.service().commit(scopeOf(target), restore.id);
      // A failure on the way, to bring the error paths in.
      ctx.objects.clear();
      await ctx.runJob(restore.id);

      const operations = await db.em().getConnection().execute('select * from background_operation');
      const secrets = await db.em().getConnection().execute('select * from operation_secret');
      for (const haystack of [operations, secrets, ctx.sent, logged, vi.mocked(Sentry.captureException).mock.calls]) {
        expect(JSON.stringify(haystack)).not.toContain(PASSWORD);
      }
      vi.restoreAllMocks();
    });
  });

  describe('a bad file', () => {
    it('reports a tampered export as invalid, and will not restore it', async () => {
      const entries = unzipSync(await source());
      entries['data/accounts.json'] = strToU8('[]\n');
      const target = await emptyHousehold(db.em());
      const ctx = setup();
      const restore = await started(ctx, scopeOf(target), zipSync(entries));

      await ctx.service().validate(scopeOf(target), restore.id, {});
      await ctx.runJob(restore.id);

      await expect(ctx.service().get(target.appuser.appuserKey, restore.id)).resolves.toMatchObject({ error: { code: 'corrupt', file: 'data/accounts.json' }, status: 'invalid' });
      await expect(ctx.service().commit(scopeOf(target), restore.id)).rejects.toMatchObject({ code: 'data_restore_not_ready', status: 409 });
      expect(Object.values(await householdRowCounts(db.em(), target.tenant.tenantKey)).every((count) => count === 0)).toBe(true);
    });

    it('will not validate before the file is uploaded, and refuses a file over the limit', async () => {
      const target = await emptyHousehold(db.em());
      const ctx = setup();
      const restore = await ctx.service().start(scopeOf(target), { size: 100 });

      await expect(ctx.service().validate(scopeOf(target), restore.id, {})).rejects.toMatchObject({ code: 'data_restore_not_uploaded', status: 409 });
      await expect(ctx.service().start(scopeOf(target), { size: 1024 * 1024 * 1024 })).rejects.toMatchObject({ code: 'data_restore_too_large', status: 400 });
      // An upload bigger than announced is caught before it is read.
      ctx.upload(restore.upload!.url, new Uint8Array(65 * 1024 * 1024));
      await expect(ctx.service().validate(scopeOf(target), restore.id, {})).resolves.toMatchObject({ error: { code: 'upload_too_large' }, status: 'invalid' });
    });
  });

  describe('the household', () => {
    it('refuses to start in a household that has data', async () => {
      const owner = await seedHousehold(db.em());
      const ctx = setup();

      await expect(ctx.service().start(scopeOf(owner), { size: 100 })).rejects.toMatchObject({ code: 'household_not_empty', status: 409 });
      await expect(ctx.service().overview(scopeOf(owner))).resolves.toMatchObject({ availability: { eligible: false, reason: 'household_not_empty' } });
    });

    it('fails a restore whose household gained data after validation, writing nothing', async () => {
      const bytes = await source();
      const target = await emptyHousehold(db.em());
      const ctx = setup();
      const restore = await started(ctx, scopeOf(target), bytes);
      await ctx.service().validate(scopeOf(target), restore.id, {});
      await ctx.runJob(restore.id);
      await ctx.service().commit(scopeOf(target), restore.id);
      await db.em().getConnection().execute('insert into loan (created_at, updated_at, currency_key, name, opening_balance_date, opening_principal_balance, owner_appuser_key, payment_frequency, rate_type, status, tenant_key, type) select now(), now(), currency_key, ?, ?, 1, appuser_key, ?, ?, ?, ?, ? from appuser where appuser_key = ?', ['Added meanwhile', '2026-01-01', 'MONTHLY', 'FIXED', 'ACTIVE', target.tenant.tenantKey, 'OTHER', target.appuser.appuserKey]);
      const before = await allRowCounts(db.em());

      await expect(ctx.runJob(restore.id)).resolves.toBe(false);

      await expect(ctx.service().get(target.appuser.appuserKey, restore.id)).resolves.toMatchObject({ error: { code: 'household_not_empty' }, status: 'failed' });
      expect(await allRowCounts(db.em())).toEqual(before);
    });

    it("lets only the household's owner restore", async () => {
      const em = db.em();
      const target = await emptyHousehold(em);
      const partner = await addPartner(em, { appuser: target.appuser, currency: await currencyFor(em, 'EUR'), tenant: target.tenant } as Household);
      const ctx = setup();

      await expect(ctx.service().start({ appuserKey: partner.appuserKey, tenantKey: target.tenant.tenantKey }, { size: 100 })).rejects.toMatchObject({ code: 'household_owner_required', status: 403 });
    });

    it('does not write into a household its owner no longer belongs to', async () => {
      const bytes = await source();
      const target = await emptyHousehold(db.em());
      const ctx = setup();
      const restore = await started(ctx, scopeOf(target), bytes);
      await ctx.service().validate(scopeOf(target), restore.id, {});
      await ctx.runJob(restore.id);
      await ctx.service().commit(scopeOf(target), restore.id);
      await db.em().getConnection().execute('update appuser_tenant set record_active = false where appuser_key = ?', [target.appuser.appuserKey]);

      await expect(ctx.runJob(restore.id)).resolves.toBe(false);

      await expect(ctx.service().get(target.appuser.appuserKey, restore.id)).resolves.toMatchObject({ error: { code: 'owner_required' }, status: 'failed' });
      expect(Object.values(await householdRowCounts(db.em(), target.tenant.tenantKey)).every((count) => count === 0)).toBe(true);
    });

    it("is not found for anyone else, and never touches another household's rows", async () => {
      const bytes = await source();
      const target = await emptyHousehold(db.em());
      const stranger = await emptyHousehold(db.em());
      const ctx = setup();
      const restore = await started(ctx, scopeOf(target), bytes);

      for (const call of [
        () => ctx.service().get(stranger.appuser.appuserKey, restore.id),
        () => ctx.service().validate(scopeOf(stranger), restore.id, {}),
        () => ctx.service().commit(scopeOf(stranger), restore.id),
      ]) await expect(call()).rejects.toMatchObject({ status: 404 });

      await ctx.service().validate(scopeOf(target), restore.id, {});
      await ctx.runJob(restore.id);
      await ctx.service().commit(scopeOf(target), restore.id);
      await ctx.runJob(restore.id);
      expect(Object.values(await householdRowCounts(db.em(), stranger.tenant.tenantKey)).every((count) => count === 0)).toBe(true);
    });
  });

  describe('limits and windows', () => {
    it('replaces an attempt waiting for the person, and refuses a new one while a file is being checked', async () => {
      const target = await emptyHousehold(db.em());
      const ctx = setup();
      const bytes = await source();
      const first = await started(ctx, scopeOf(target), bytes);

      const second = await started(ctx, scopeOf(target), bytes);
      expect(second.id).not.toBe(first.id);
      await expect(ctx.service().get(target.appuser.appuserKey, first.id)).resolves.toMatchObject({ status: 'expired' });

      await ctx.service().validate(scopeOf(target), second.id, {});
      await expect(ctx.service().start(scopeOf(target), { size: 100 })).rejects.toMatchObject({ code: 'data_restore_in_progress', status: 409 });
    });

    it('allows ten restores a day', async () => {
      const target = await emptyHousehold(db.em());
      const ctx = setup();
      for (let index = 0; index < 10; index += 1) await ctx.service().start(scopeOf(target), { size: 100 });

      await expect(ctx.service().start(scopeOf(target), { size: 100 })).rejects.toMatchObject({ status: 429 });
    });

    it('keeps a restore that runs past the recovery window running, and ends it restored', async () => {
      const { asset, owner } = await richHousehold(db.em());
      const bytes = await exportBytes(db.em(), scopeOf(owner));
      // The export's asset is missing here, so the restore asks market data for it: the stand-in
      // below is where the commit spends three quarters of an hour.
      await db.em().getConnection().execute('update financial_asset set deleted_at = now() where financial_asset_key = ?', [asset.financialAssetKey]);
      const target = await emptyHousehold(db.em());
      const operation = () => db.em().getConnection().execute<{ last_heartbeat_at: Date | null; status: string }[]>('select status, last_heartbeat_at from background_operation where correlation_id = ?', [restoreId]);
      // pg-boss still holds the job as active: the worker is alive and busy.
      const boss = { createQueue: () => Promise.resolve(), findJobs: () => Promise.resolve([{ state: 'active' }]), send: () => Promise.resolve(null) } as unknown as RecoveryTransport;
      let restoreId = '';
      let calls = 0;
      let duringCommit: undefined | { recovery: { needsAction: number }; status: string; view: string };
      const ctx = setup({
        heartbeatMs: 5,
        restore: {
          resolveAsset: async () => {
            calls += 1;
            if (calls === 2) {
              // The restore was claimed a while ago, and time passes while it works.
              await db.em().getConnection().execute('update background_operation set last_heartbeat_at = ?, started_at = ? where correlation_id = ?', [START, START, restoreId]);
              ctx.advance(45 * MINUTE);
              const deadline = Date.now() + 2000;
              while (Date.now() < deadline) {
                const [row] = await operation();
                if (row?.last_heartbeat_at && new Date(row.last_heartbeat_at).getTime() >= START.getTime() + 45 * MINUTE) break;
                await new Promise((resolve) => setTimeout(resolve, 5));
              }
              const recovery = await backgroundOperationRecoveryService.recoverOnce({ boss, logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }, now: new Date(START.getTime() + 45 * MINUTE) });
              const [row] = await operation();
              duringCommit = { recovery, status: row!.status, view: (await ctx.service().get(target.appuser.appuserKey, restoreId)).status };
            }
            return asset.financialAssetKey;
          },
        },
      });
      const restore = await started(ctx, scopeOf(target), bytes);
      restoreId = restore.id;
      await ctx.service().validate(scopeOf(target), restore.id, {});
      await ctx.runJob(restore.id);
      await ctx.service().commit(scopeOf(target), restore.id);

      await expect(ctx.runJob(restore.id)).resolves.toBe(true);

      expect(duringCommit).toEqual({ recovery: expect.objectContaining({ needsAction: 0 }), status: 'running', view: 'restoring' });
      await expect(ctx.service().get(target.appuser.appuserKey, restore.id)).resolves.toMatchObject({ status: 'restored' });
      expect((await householdRowCounts(db.em(), target.tenant.tenantKey))['financial_transaction']).toBe(2);
    });

    it('expires an attempt left waiting for half an hour', async () => {
      const bytes = await source();
      const target = await emptyHousehold(db.em());
      const ctx = setup();
      const restore = await started(ctx, scopeOf(target), bytes);
      await ctx.service().validate(scopeOf(target), restore.id, {});
      await ctx.runJob(restore.id);

      ctx.advance(31 * MINUTE);

      await expect(ctx.service().get(target.appuser.appuserKey, restore.id)).resolves.toMatchObject({ status: 'expired' });
      await expect(ctx.service().commit(scopeOf(target), restore.id)).rejects.toMatchObject({ status: 409 });
    });
  });
});
