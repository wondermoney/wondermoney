import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';
import * as Sentry from '@sentry/node';

import { type DataRestoreMode, enqueueDataRestoreCleanupJob, enqueueDataRestoreJob } from '@app/jobs/data-restore.queue';
import { enqueueFxReconvertJob } from '@app/jobs/fx-reconvert.queue';
import { enqueuePortfolioSnapshotManualJob } from '@app/jobs/portfolio-snapshot.queue';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import backgroundOperationService from '@service/operations/background-operation.service';
import { OperationSecretService } from '@service/operations/operation-secret.service';
import type { Enqueue } from '@service/queue/enqueue';
import s3Service from '@service/storage/s3';
import { BadRequestError, ConflictError, ERROR_CODE, FeatureDisabledError, ForbiddenError, NotFoundError, TooManyRequestsError } from '@utils/errors';
import logger from '@utils/logger';

import { isHouseholdEmpty, type RestoreDeps, restoreHousehold, type RestoreSummary, type RestoreTarget } from './household-restore';
import { RESTORE_LIMITS } from './restore-format';
import { readRestoreArchive, RestoreError, type RestoreErrorCode, type RestoreErrorDetail } from './restore-reader';

/**
 * Restoring a WonderMoney export (`data-export/export-format.ts`) into the person's own, empty
 * household (wondermoney/wondermoney#67), as one `BackgroundOperation` per attempt:
 *
 *   start      `POST /v1/user/me/restores` with the file's size: a 15-minute link to PUT the zip
 *              to file storage, signed for exactly that size.
 *   validate   `POST /:id/validate` (with the password of a protected export): a worker job reads
 *              and checks the whole file, then runs the restore and rolls it back (a dry run), and
 *              records what it would write and any warnings. A wrong password or a bad file comes
 *              back as `invalid`, and validate can be asked again (with another password).
 *   commit     `POST /:id/commit`, once validated: a worker job runs the same restore for real, in
 *              one database transaction, then queues balance re-conversion and portfolio
 *              snapshot rebuilds. The uploaded file is deleted once it ends either way.
 *
 * Who and where: only the household's owner, only into their own household, and only while it holds
 * no accounts, portfolios, budgets, goals, loans or manual assets (checked at every step, and again under a lock
 * inside the restore's transaction).
 *
 * Limits: one restore at a time per person (starting another replaces one that is waiting, and is
 * refused while one is being checked or run), at most {@link DAILY_RESTORE_LIMIT} started in 24 hours, files up to {@link RESTORE_LIMITS}. An attempt
 * left waiting (for its upload, or for commit) more than {@link SESSION_WINDOW_MS} expires.
 *
 * The password travels once, in the validate request, and is kept for the commit as an
 * `OperationSecret`: encrypted at rest, gone when the restore ends or its window closes, and never
 * in a job payload, the operation's progress, a log line or an error report.
 */
export const DATA_RESTORE_OPERATION = 'user.data-restore';
const DAILY_RESTORE_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long an attempt may wait for its upload or its commit; background-operation recovery closes it after 30 minutes too. */
const SESSION_WINDOW_MS = 30 * 60 * 1000;
/** How long a validate or commit job may take before it counts as abandoned (the job expires after an hour). */
const JOB_WINDOW_MS = 2 * 60 * 60 * 1000;
/**
 * How often a running check or restore marks its operation alive. Background-operation recovery
 * takes a running operation whose last heartbeat is more than 30 minutes old for abandoned, and a
 * large restore can spend longer than that in its one database transaction.
 */
const HEARTBEAT_MS = 60 * 1000;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** How long the password is kept between validate and commit. */
const PASSWORD_TTL_MS = 60 * 60 * 1000;
/** Advisory-lock namespace that serialises a person's restore starts (any constant int4). */
const START_LOCK_NAMESPACE = 650_066;
const ZIP = 'application/zip';

export interface DataRestoreAvailability {
  /** Whether this person can start a restore now, and if not, why. */
  eligible: boolean;
  reason: 'file_storage_disabled' | 'household_not_empty' | 'owner_required' | null;
}

export interface DataRestoreDeps {
  enqueue?: Enqueue;
  /** How often a running job marks its operation alive ({@link HEARTBEAT_MS} by default). */
  heartbeatMs?: number;
  now?: () => Date;
  restore?: RestoreDeps;
  storage?: RestoreStorage;
}

export interface DataRestoreError extends RestoreErrorDetail {
  code: 'internal' | 'owner_required' | 'upload_too_large' | RestoreErrorCode;
}

/** The person may no longer restore into the household the restore was started for. */
export type DataRestoreStatus = 'awaiting_upload' | 'expired' | 'failed' | 'invalid' | 'ready' | 'restored' | 'restoring' | 'validating';

export interface DataRestoreView {
  createdAt: string;
  /** Whether the uploaded file is password protected, once validation has opened it. */
  encrypted: boolean | null;
  error: DataRestoreError | null;
  /** When an attempt that is waiting (to be uploaded or committed) stops being usable. */
  expiresAt: null | string;
  /** The export the file holds, once validated. */
  export: null | { appVersion: string; exportedAt: string };
  finishedAt: null | string;
  id: string;
  status: DataRestoreStatus;
  /** What the restore writes (or wrote) and what to know about it, once validated. */
  summary: null | RestoreSummary;
  /** Where to PUT the file, while it is awaited. */
  upload: null | { headers: Record<string, string>; maxBytes: number; method: 'PUT'; url: string };
}

export interface RestoreStorage {
  deleteObject(bucket: string, key: string): Promise<void>;
  generatePresignedUploadUrl(bucket: string, key: string, options: { contentLength: number; contentType: string; expiresInSeconds: number }): Promise<string>;
  getFilesBucketName(): string;
  getObjectBuffer(bucket: string, key: string): Promise<Buffer>;
  getObjectSize(bucket: string, key: string): Promise<number | undefined>;
  isEnabled(): boolean;
}

type Phase = 'commit' | 'invalid' | 'ready' | 'upload' | 'validate';

interface RestoreProgress {
  appVersion?: string;
  bucket: string;
  deletedAt?: string;
  encrypted?: boolean;
  error?: DataRestoreError;
  exportedAt?: string;
  key: string;
  phase: Phase;
  size: number;
  summary?: RestoreSummary;
}

class RestoreRefused extends Error {
  constructor(readonly code: 'owner_required') {
    super('The person is no longer the owner of this household');
  }
}

const progressOf = (operation: BackgroundOperation) => operation.progress as unknown as RestoreProgress;
const keyOf = (ref: unknown): null | number => {
  if (ref === null || ref === undefined) return null;
  if (typeof ref === 'number') return ref;
  const value = (ref as { appuserKey?: number }).appuserKey ?? (ref as { tenantKey?: number }).tenantKey;
  return value ?? null;
};

export class DataRestoreService {
  private get now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private get secrets(): OperationSecretService {
    return new OperationSecretService(this.em, { now: () => this.now });
  }

  private get storage(): RestoreStorage {
    return this.deps.storage ?? s3Service;
  }

  constructor(private readonly em: EntityManager, private readonly deps: DataRestoreDeps = {}) {}

  /** Whether `scope` can restore, and the person's restores of the last 24 hours, newest first. */
  async overview(scope: RestoreTarget): Promise<{ availability: DataRestoreAvailability; restores: DataRestoreView[] }> {
    const availability = await this.availability(scope);
    const operations = await this.em.find(
      BackgroundOperation,
      { appuserKey: { appuserKey: scope.appuserKey }, createdAt: { $gt: new Date(this.now.getTime() - DAY_MS) }, deletedAt: null, operationType: DATA_RESTORE_OPERATION },
      { orderBy: { backgroundOperationKey: 'desc' }, refresh: true },
    );
    return { availability, restores: await Promise.all(operations.map((operation) => this.view(operation))) };
  }

  /**
   * Start a restore of a file of `size` bytes, replacing an attempt still waiting for the person.
   * Throws when this person cannot restore now (see {@link availability}), while another restore
   * is being checked or run, past the daily limit, or for a file over the size limit.
   */
  async start(scope: RestoreTarget, input: { size: number }): Promise<DataRestoreView> {
    if (!this.storage.isEnabled()) throw new FeatureDisabledError('File storage');
    if (input.size > RESTORE_LIMITS.maxArchiveBytes) throw new BadRequestError(`The file is larger than ${RESTORE_LIMITS.maxArchiveBytes} bytes`, ERROR_CODE.DATA_RESTORE_TOO_LARGE);
    await this.assertCanRestore(scope);
    const now = this.now;
    let superseded: string[] = [];
    const correlationId = await this.em.transactional(async (tx) => {
      const connection = tx.getConnection();
      await connection.execute('select pg_advisory_xact_lock(?, ?)', [START_LOCK_NAMESPACE, scope.appuserKey], 'all', tx.getTransactionContext());
      const recent = await connection.execute<{ correlation_id: string; created_at: Date | string; phase: null | string; queued_at: Date | null | string; status: BackgroundOperationStatus }[]>(
        `select correlation_id, created_at, queued_at, status, progress->>'phase' as phase from background_operation
         where operation_type = ? and appuser_key = ? and deleted_at is null and created_at > ? order by created_at asc`,
        [DATA_RESTORE_OPERATION, scope.appuserKey, new Date(now.getTime() - DAY_MS)],
        'all',
        tx.getTransactionContext(),
      );
      const open = recent.filter((row) => (row.status === BackgroundOperationStatus.QUEUED || row.status === BackgroundOperationStatus.RUNNING) && !this.isPast(row.status, row.phase as Phase, row.queued_at ?? row.created_at));
      // A file being checked or restored is not interrupted; one waiting for the person is replaced
      // by the new attempt (another file, or the same one again).
      if (open.some((row) => row.status === BackgroundOperationStatus.RUNNING || row.phase === 'validate' || row.phase === 'commit')) {
        throw new ConflictError('A restore is in progress', ERROR_CODE.DATA_RESTORE_IN_PROGRESS);
      }
      if (recent.length >= DAILY_RESTORE_LIMIT) {
        const retryAfter = Math.max(1, Math.ceil((new Date(recent[0]!.created_at).getTime() + DAY_MS - now.getTime()) / 1000));
        throw new TooManyRequestsError(`At most ${DAILY_RESTORE_LIMIT} restores a day`, retryAfter);
      }
      superseded = open.map((row) => row.correlation_id);
      if (superseded.length > 0) {
        await connection.execute(
          `update background_operation set status = 'stale', error_code = ?, finished_at = now(), updated_at = now() where correlation_id in (?) and status = 'queued'`,
          [`${DATA_RESTORE_OPERATION}:superseded`, superseded],
          'all',
          tx.getTransactionContext(),
        );
        await new OperationSecretService(tx, { now: () => now }).discard(superseded);
      }
      const correlationId = `${DATA_RESTORE_OPERATION}:${randomUUID()}`;
      const operation = await backgroundOperationService.createQueuedOperation(
        { appuserKey: scope.appuserKey, correlationId, operationType: DATA_RESTORE_OPERATION, resourceId: `tenant:${scope.tenantKey}`, retryable: false, tenantKey: scope.tenantKey },
        tx,
      );
      const progress: RestoreProgress = { bucket: this.storage.getFilesBucketName(), key: `data-restores/${scope.appuserKey}/${randomUUID()}.zip`, phase: 'upload', size: input.size };
      operation.progress = progress as unknown as Record<string, unknown>;
      operation.createdAt = now;
      operation.queuedAt = now;
      await tx.flush();
      return correlationId;
    });
    for (const old of superseded) await this.deleteUpload(old).catch((error: unknown) => { logger.warn({ correlationId: old, error }, 'Replaced restore file could not be deleted'); });
    const operation = await this.load(correlationId);
    if (!operation) throw new NotFoundError('Restore not found');
    if (this.deps.enqueue) {
      // Whatever happens next, the uploaded file is gone a day from now.
      await enqueueDataRestoreCleanupJob({ correlationId }, new Date(now.getTime() + DAY_MS), { enqueue: this.deps.enqueue }).catch((error: unknown) => { logger.warn({ correlationId, error }, 'Restore cleanup could not be scheduled'); });
    }
    return this.view(operation, { withUpload: true });
  }

  /** The person's restore with this id; anyone else's is not found. */
  async get(appuserKey: number, id: string): Promise<DataRestoreView> {
    return this.view(await this.find(appuserKey, id), { withUpload: true });
  }

  /** Check the uploaded file (a dry run, in the worker). `password` opens a protected export. */
  async validate(scope: RestoreTarget, id: string, input: { password?: string }): Promise<DataRestoreView> {
    const operation = await this.find(scope.appuserKey, id, scope.tenantKey);
    const view = await this.view(operation);
    if (view.status === 'validating') return view;
    if (!['awaiting_upload', 'invalid', 'ready'].includes(view.status)) throw new ConflictError('This restore cannot be validated now', ERROR_CODE.DATA_RESTORE_NOT_READY);
    await this.assertCanRestore(scope);
    const progress = progressOf(operation);
    const size = await this.storage.getObjectSize(progress.bucket, progress.key).catch(() => undefined);
    if (size === undefined) throw new ConflictError('The file has not been uploaded', ERROR_CODE.DATA_RESTORE_NOT_UPLOADED);
    if (size > RESTORE_LIMITS.maxArchiveBytes) {
      await this.setPhase(operation.correlationId, { ...progress, error: { code: 'upload_too_large' }, phase: 'invalid' });
      return this.view((await this.load(operation.correlationId))!);
    }

    await this.em.transactional(async (tx) => {
      const secrets = new OperationSecretService(tx, { now: () => this.now });
      await secrets.discard([operation.correlationId]);
      if (input.password !== undefined) await secrets.put(operation.correlationId, input.password, new Date(this.now.getTime() + PASSWORD_TTL_MS));
    });
    const { error: _error, summary: _summary, ...rest } = progress;
    await this.setPhase(operation.correlationId, { ...rest, phase: 'validate', size });
    await this.enqueue(operation.correlationId, 'validate');
    return this.view((await this.load(operation.correlationId))!);
  }

  /** Run a validated restore for real (in the worker). Asking twice returns the restore in progress. */
  async commit(scope: RestoreTarget, id: string): Promise<DataRestoreView> {
    const operation = await this.find(scope.appuserKey, id, scope.tenantKey);
    const view = await this.view(operation);
    if (view.status === 'restoring' || view.status === 'restored') return view;
    if (view.status !== 'ready') throw new ConflictError('Validate the file before restoring it', ERROR_CODE.DATA_RESTORE_NOT_READY);
    await this.assertCanRestore(scope);
    await this.setPhase(operation.correlationId, { ...progressOf(operation), phase: 'commit' });
    await this.enqueue(operation.correlationId, 'commit');
    return this.view((await this.load(operation.correlationId))!);
  }

  /**
   * The job: validate (a dry run) or commit. Returns false when the operation was not this job's
   * to run. A problem with the file comes back to the person as `invalid` (validate) or `failed`
   * (commit); it is never retried.
   */
  async run(correlationId: string, queueJobId: string, mode: DataRestoreMode): Promise<boolean> {
    const operation = await this.load(correlationId);
    if (!operation || progressOf(operation).phase !== mode) return false;
    if (!(await backgroundOperationService.claimJobStart(correlationId, queueJobId))) return false;
    const progress = progressOf(operation);
    const target = this.targetOf(operation);
    const stopHeartbeat = this.heartbeat(correlationId, queueJobId);
    try {
      // The household is the one the restore was started in; its owner must still be its owner.
      if ((await this.availability(target)).reason === 'owner_required') throw new RestoreRefused('owner_required');
      const password = mode === 'validate' ? await this.secrets.read(correlationId) : await this.secrets.take(correlationId);
      const bytes = await this.storage.getObjectBuffer(progress.bucket, progress.key);
      const parsed = await readRestoreArchive(new Uint8Array(bytes), password ? { password } : {});
      const outcome = await restoreHousehold(this.em.fork(), target, parsed, { deps: this.deps.restore ?? {}, dryRun: mode === 'validate' });
      const done: RestoreProgress = { ...progress, appVersion: parsed.manifest.appVersion, encrypted: parsed.encrypted, exportedAt: parsed.manifest.exportedAt, phase: mode === 'validate' ? 'ready' : 'commit', summary: outcome.summary };
      if (mode === 'validate') {
        await this.requeue(correlationId, queueJobId, done);
        return true;
      }
      await backgroundOperationService.heartbeatJob(correlationId, queueJobId, { progress: done as unknown as Record<string, unknown> });
      await backgroundOperationService.finishJob(correlationId, queueJobId, { stage: `${DATA_RESTORE_OPERATION}:restored`, status: BackgroundOperationStatus.SUCCEEDED });
      await this.afterRestore(correlationId, outcome);
      return true;
    } catch (error) {
      const known = error instanceof RestoreError || error instanceof RestoreRefused;
      const failure: DataRestoreError = error instanceof RestoreError ? { code: error.code, ...error.detail } : error instanceof RestoreRefused ? { code: error.code } : { code: 'internal' };
      if (!known) {
        logger.error({ correlationId, error, mode }, 'Restore failed');
        Sentry.captureException(error, { tags: { job: DATA_RESTORE_OPERATION } });
      }
      if (mode === 'validate' && known) {
        if (failure.code === 'password_incorrect') await this.secrets.discard([correlationId]);
        await this.requeue(correlationId, queueJobId, { ...progress, error: failure, phase: 'invalid' });
        return false;
      }
      await backgroundOperationService.heartbeatJob(correlationId, queueJobId, { progress: { ...progress, error: failure } });
      await backgroundOperationService.finishJob(correlationId, queueJobId, { errorCode: `${DATA_RESTORE_OPERATION}:${failure.code}`, stage: `${DATA_RESTORE_OPERATION}:failed`, status: BackgroundOperationStatus.FAILED });
      await this.secrets.discard([correlationId]).catch(() => undefined);
      await this.deleteUpload(correlationId);
      return false;
    } finally {
      stopHeartbeat();
    }
  }

  /** Delete the uploaded file (once the restore ends, and a day after it started). Safe to run twice. */
  async deleteUpload(correlationId: string): Promise<void> {
    const operation = await this.load(correlationId);
    if (!operation) return;
    const progress = progressOf(operation);
    if (progress.deletedAt) return;
    await this.storage.deleteObject(progress.bucket, progress.key);
    await this.em.getConnection().execute(
      `update background_operation set progress = jsonb_set(progress, '{deletedAt}', to_jsonb(?::text)), updated_at = now() where correlation_id = ?`,
      [this.now.toISOString(), correlationId],
    );
  }

  // --- internals ---

  private async afterRestore(correlationId: string, outcome: Awaited<ReturnType<typeof restoreHousehold>>): Promise<void> {
    await this.deleteUpload(correlationId).catch((error: unknown) => { logger.warn({ correlationId, error }, 'Restored file could not be deleted'); });
    const enqueue = this.deps.enqueue;
    if (!enqueue) return;
    try {
      if (outcome.hasForeignCurrencyAccounts) await enqueueFxReconvertJob({ correlationId: `fx.reconvert:${correlationId}` }, { enqueue });
      for (const portfolioId of outcome.portfolioKeys) {
        const snapshot = `portfolio.snapshot:${correlationId}:${portfolioId}`;
        await enqueuePortfolioSnapshotManualJob({ correlationId: snapshot, portfolioId }, { enqueue, singletonKey: snapshot });
      }
    } catch (error) {
      // The restore is done; balances and snapshots also catch up on their own schedules.
      logger.warn({ correlationId, error }, 'Restore follow-up jobs could not be queued');
    }
  }

  private async assertCanRestore(scope: RestoreTarget): Promise<void> {
    const { reason } = await this.availability(scope);
    if (reason === 'file_storage_disabled') throw new FeatureDisabledError('File storage');
    if (reason === 'owner_required') throw new ForbiddenError('Only the household owner can restore', ERROR_CODE.HOUSEHOLD_OWNER_REQUIRED);
    if (reason === 'household_not_empty') throw new ConflictError('The household already has data', ERROR_CODE.HOUSEHOLD_NOT_EMPTY);
  }

  private async availability(scope: RestoreTarget): Promise<DataRestoreAvailability> {
    if (!this.storage.isEnabled()) return { eligible: false, reason: 'file_storage_disabled' };
    const [membership] = await this.em.getConnection().execute<{ role: string }[]>(
      'select role from appuser_tenant where appuser_key = ? and tenant_key = ? and record_active and deleted_at is null',
      [scope.appuserKey, scope.tenantKey],
    );
    if (membership?.role !== 'owner') return { eligible: false, reason: 'owner_required' };
    if (!(await isHouseholdEmpty(this.em, scope.tenantKey))) return { eligible: false, reason: 'household_not_empty' };
    return { eligible: true, reason: null };
  }

  private async enqueue(correlationId: string, mode: DataRestoreMode): Promise<void> {
    try {
      if (!this.deps.enqueue) throw new Error('No queue to send the restore job to');
      const jobId = await enqueueDataRestoreJob({ correlationId, mode }, { enqueue: this.deps.enqueue });
      if (!jobId) throw new Error('The restore queue returned no job id');
      await backgroundOperationService.attachQueueJob(correlationId, String(jobId));
    } catch (error) {
      await backgroundOperationService.markFailed(correlationId, `${DATA_RESTORE_OPERATION}:enqueue-failed`);
      await this.secrets.discard([correlationId]);
      throw error;
    }
  }

  /**
   * Mark the operation alive every {@link HEARTBEAT_MS} while this job runs it, from its own
   * connection (the restore's transaction holds another), so recovery leaves a long restore
   * alone. Returns the function that stops it.
   */
  private heartbeat(correlationId: string, queueJobId: string): () => void {
    const timer = setInterval(() => {
      this.em.fork().getConnection().execute(
        `update background_operation set last_heartbeat_at = ?, updated_at = now()
         where correlation_id = ? and queue_job_id = ? and status = 'running' and deleted_at is null`,
        [this.now, correlationId, queueJobId],
      ).catch((error: unknown) => { logger.warn({ correlationId, error }, 'Restore heartbeat failed'); });
    }, this.deps.heartbeatMs ?? HEARTBEAT_MS);
    timer.unref();
    return () => { clearInterval(timer); };
  }

  /** The person's restore with this id (started in `tenantKey`, when given); anything else is not found. */
  private async find(appuserKey: number, id: string, tenantKey?: number): Promise<BackgroundOperation> {
    const operation = await this.load(id);
    if (operation?.operationType !== DATA_RESTORE_OPERATION || keyOf(operation.appuserKey) !== appuserKey) throw new NotFoundError('Restore not found');
    if (tenantKey !== undefined && keyOf(operation.tenantKey) !== tenantKey) throw new NotFoundError('Restore not found');
    return operation;
  }

  /** Whether an attempt in `phase` that last moved at `since` is past its window. */
  private isPast(status: BackgroundOperationStatus, phase: Phase, since: Date | string): boolean {
    const waiting = status === BackgroundOperationStatus.QUEUED && (phase === 'upload' || phase === 'invalid' || phase === 'ready');
    return this.now.getTime() - new Date(since).getTime() >= (waiting ? SESSION_WINDOW_MS : JOB_WINDOW_MS);
  }

  /** The operation as stored now: raw-SQL state transitions bypass the identity map. */
  private load(correlationId: string): Promise<BackgroundOperation | null> {
    return this.em.findOne(BackgroundOperation, { correlationId, deletedAt: null }, { refresh: true });
  }

  /** Back to waiting for the person (after a validation), off the job that ran. */
  private async requeue(correlationId: string, queueJobId: string, progress: RestoreProgress): Promise<void> {
    await this.em.getConnection().execute(
      `update background_operation set status = 'queued', queue_job_id = null, queued_at = ?, progress = ?, stage = ?, last_heartbeat_at = now(), updated_at = now()
       where correlation_id = ? and queue_job_id = ? and status = 'running' and deleted_at is null`,
      [this.now, JSON.stringify(progress), `${DATA_RESTORE_OPERATION}:${progress.phase}`, correlationId, queueJobId],
    );
  }

  /** Move a waiting attempt to `progress.phase`, restarting its window. */
  private async setPhase(correlationId: string, progress: RestoreProgress): Promise<void> {
    await this.em.getConnection().execute(
      `update background_operation set progress = ?, stage = ?, queued_at = ?, queue_job_id = null, updated_at = now()
       where correlation_id = ? and status = 'queued' and deleted_at is null`,
      [JSON.stringify(progress), `${DATA_RESTORE_OPERATION}:${progress.phase}`, this.now, correlationId],
    );
  }

  private targetOf(operation: BackgroundOperation): RestoreTarget {
    const appuserKey = keyOf(operation.appuserKey);
    const tenantKey = keyOf(operation.tenantKey);
    if (appuserKey === null || tenantKey === null) throw new Error('Restore operation has no owner');
    return { appuserKey, tenantKey };
  }

  private async view(operation: BackgroundOperation, options: { withUpload?: boolean } = {}): Promise<DataRestoreView> {
    const progress = progressOf(operation);
    const since = operation.queuedAt ?? operation.createdAt;
    let status: DataRestoreStatus;
    switch (operation.status) {
      case BackgroundOperationStatus.FAILED:
        status = 'failed';
        break;
      case BackgroundOperationStatus.QUEUED:
      case BackgroundOperationStatus.RUNNING: {
        const byPhase: Record<Phase, DataRestoreStatus> = { commit: 'restoring', invalid: 'invalid', ready: 'ready', upload: 'awaiting_upload', validate: 'validating' };
        status = this.isPast(operation.status, progress.phase, since) ? 'expired' : byPhase[progress.phase];
        break;
      }
      case BackgroundOperationStatus.SUCCEEDED:
        status = 'restored';
        break;
      default:
        status = 'expired';
    }
    const waiting = status === 'awaiting_upload' || status === 'invalid' || status === 'ready';
    const upload = options.withUpload && status === 'awaiting_upload'
      ? {
          headers: { 'Content-Type': ZIP },
          maxBytes: RESTORE_LIMITS.maxArchiveBytes,
          method: 'PUT' as const,
          url: await this.storage.generatePresignedUploadUrl(progress.bucket, progress.key, { contentLength: progress.size, contentType: ZIP, expiresInSeconds: UPLOAD_URL_TTL_SECONDS }),
        }
      : null;
    return {
      createdAt: operation.createdAt.toISOString(),
      encrypted: progress.encrypted ?? null,
      error: status === 'invalid' || status === 'failed' ? (progress.error ?? { code: 'internal' }) : null,
      expiresAt: waiting ? new Date(new Date(since).getTime() + SESSION_WINDOW_MS).toISOString() : null,
      export: progress.exportedAt && progress.appVersion ? { appVersion: progress.appVersion, exportedAt: progress.exportedAt } : null,
      finishedAt: operation.finishedAt ? new Date(operation.finishedAt).toISOString() : null,
      id: operation.correlationId,
      status,
      summary: status === 'ready' || status === 'restoring' || status === 'restored' ? (progress.summary ?? null) : null,
      upload,
    };
  }
}
