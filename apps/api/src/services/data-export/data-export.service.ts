import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';

import type { EntityManager } from '@mikro-orm/postgresql';
import * as Sentry from '@sentry/node';

import { enqueueDataExportCleanupJob, enqueueDataExportJob } from '@app/jobs/data-export.queue';
import { Appuser } from '@entity/Appuser';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { sendDataExportReadyEmail } from '@service/email/email';
import backgroundOperationService from '@service/operations/background-operation.service';
import { OperationSecretService } from '@service/operations/operation-secret.service';
import portfolioHoldingsService from '@service/portfolio/portfolio-holdings.service';
import type { Enqueue } from '@service/queue/enqueue';
import s3Service from '@service/storage/s3';
import { ConflictError, ERROR_CODE, NotFoundError, TooManyRequestsError } from '@utils/errors';
import logger from '@utils/logger';

import { exportFileName } from './export-format';
import { type ExportScope, type HoldingRow, type HouseholdExportDeps, writeHouseholdExport } from './household-export';

/**
 * Full data exports (`export-format.ts`), one per request, tracked by a `BackgroundOperation`.
 *
 * Two deliveries, chosen by whether the server has file storage:
 *
 * - `storage`: a pg-boss job writes the zip to a temporary file, uploads it, emails the person and
 *   schedules its deletion 24 hours later. The status endpoint hands out a 15-minute download link.
 * - `stream`: without storage (a self-hosted server with no S3), nothing is stored. The export is
 *   built while it downloads, straight into the HTTP response, once.
 *
 * Limits: one export in progress per person (starting another returns it), and at most
 * {@link DAILY_EXPORT_LIMIT} started in any 24 hours.
 *
 * Password protection (wondermoney/wondermoney#66): with a password the archive is encrypted as
 * it is written (`export-archive.ts`), in either delivery, so no unencrypted copy is stored or sent.
 * The password reaches the process that writes the archive as a one-time `OperationSecret`,
 * encrypted at rest and deleted when read or when its window ends; it is never in the job
 * payload, the operation's progress (which records only `encrypted: true`), a log line or an
 * error report.
 */
const DATA_EXPORT_OPERATION = 'user.data-export';
const DAILY_EXPORT_LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a stored archive stays downloadable before it is deleted. */
const STORED_EXPORT_TTL_MS = DAY_MS;
/** How long a streamed export waits to be downloaded; background-operation recovery closes it after 30 minutes. */
const STREAM_DOWNLOAD_WINDOW_MS = 30 * 60 * 1000;
const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;
/** How long a stored export may stay queued or running before it counts as abandoned (the job expires after an hour). */
const STORED_JOB_WINDOW_MS = 2 * 60 * 60 * 1000;
/** Advisory-lock namespace that serialises a person's export starts (any constant int4). */
const START_LOCK_NAMESPACE = 650_065;

export type DataExportDelivery = 'storage' | 'stream';
export interface DataExportDeps {
  enqueue?: Enqueue;
  now?: () => Date;
  sendReadyEmail?: (appuser: Appuser) => Promise<unknown>;
  storage?: StorageLike;
}

export type DataExportStatus = 'expired' | 'failed' | 'queued' | 'ready' | 'running';

export interface DataExportView {
  createdAt: string;
  delivery: DataExportDelivery;
  /** Whether the archive is password protected. */
  encrypted: boolean;
  /** A short-lived link to the stored archive (`storage`, when ready). */
  downloadUrl: null | string;
  /** When the export can no longer be downloaded. */
  expiresAt: null | string;
  fileName: string;
  finishedAt: null | string;
  id: string;
  status: DataExportStatus;
}

export interface StorageLike {
  deleteObject(bucket: string, key: string): Promise<void>;
  generatePresignedDownloadUrl(bucket: string, key: string, fileName: string, expiresInSeconds: number): Promise<string>;
  getFilesBucketName(): string;
  isEnabled(): boolean;
  uploadStream(bucket: string, key: string, body: NodeJS.ReadableStream, contentLength: number, contentType: string): Promise<void>;
}

interface ExportProgress {
  bucket?: string;
  bytes?: number;
  deletedAt?: string;
  delivery: DataExportDelivery;
  encrypted?: boolean;
  expiresAt?: string;
  fileName?: string;
  key?: string;
}

const progressOf = (operation: BackgroundOperation): ExportProgress => (operation.progress ?? { delivery: 'stream' }) as unknown as ExportProgress;
const keyOf = (ref: unknown): null | number => {
  if (ref === null || ref === undefined) return null;
  if (typeof ref === 'number') return ref;
  const value = (ref as { appuserKey?: number; tenantKey?: number }).appuserKey ?? (ref as { tenantKey?: number }).tenantKey;
  return value ?? null;
};

export class DataExportService {
  private get now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private get secrets(): OperationSecretService {
    return new OperationSecretService(this.em, { now: () => this.now });
  }

  private get storage(): StorageLike {
    return this.deps.storage ?? s3Service;
  }

  constructor(private readonly em: EntityManager, private readonly deps: DataExportDeps = {}) {}

  /**
   * Start an export for `scope`, or return the one already in progress. Throws
   * `TooManyRequestsError` (with the seconds until a slot frees up) past the daily limit, and
   * `ConflictError` when the export in progress is not protected the way this one asks to be.
   * With `password`, the archive is encrypted with it (see the class comment).
   */
  async start(scope: ExportScope, options: { password?: string } = {}): Promise<{ created: boolean; export: DataExportView }> {
    const delivery: DataExportDelivery = this.storage.isEnabled() ? 'storage' : 'stream';
    const encrypted = options.password !== undefined;
    const now = this.now;
    const { correlationId, created } = await this.em.transactional(async (tx) => {
      const secrets = new OperationSecretService(tx, { now: () => now });
      const connection = tx.getConnection();
      // Serialise concurrent starts for this person so two clicks cannot pass the checks together.
      await connection.execute('select pg_advisory_xact_lock(?, ?)', [START_LOCK_NAMESPACE, scope.appuserKey], 'all', tx.getTransactionContext());
      const recent = await connection.execute<{ correlation_id: string; created_at: Date | string; delivery: null | string; encrypted: null | string; status: string }[]>(
        `select correlation_id, created_at, status, progress->>'delivery' as delivery, progress->>'encrypted' as encrypted from background_operation
         where operation_type = ? and appuser_key = ? and deleted_at is null and created_at > ?
         order by created_at asc`,
        [DATA_EXPORT_OPERATION, scope.appuserKey, new Date(now.getTime() - DAY_MS)],
        'all',
        tx.getTransactionContext(),
      );
      const inProgress: string[] = [BackgroundOperationStatus.QUEUED, BackgroundOperationStatus.RUNNING];
      // An export left in progress past its window (a streamed one nobody downloaded, a job that
      // never ran) is closed here rather than blocking the person until recovery gets to it.
      const window = (row: { delivery: null | string }) => (row.delivery === 'storage' ? STORED_JOB_WINDOW_MS : STREAM_DOWNLOAD_WINDOW_MS);
      const isLive = (row: (typeof recent)[number]) => now.getTime() - new Date(row.created_at).getTime() < window(row);
      const abandoned = recent.filter((row) => inProgress.includes(row.status) && !isLive(row)).map((row) => row.correlation_id);
      if (abandoned.length > 0) {
        await connection.execute(
          `update background_operation set status = 'stale', error_code = 'user.data-export:abandoned', finished_at = now(), updated_at = now()
           where correlation_id in (?) and status in ('queued', 'running')`,
          [abandoned],
          'all',
          tx.getTransactionContext(),
        );
        await secrets.discard(abandoned);
      }
      const active = recent.find((row) => inProgress.includes(row.status) && isLive(row));
      if (active) {
        // Handing back an unprotected export to someone who asked for a password (or the reverse)
        // would be a surprise; a second request of the same kind is a double click.
        if ((active.encrypted === 'true') !== encrypted) throw new ConflictError('Another data export is in progress', ERROR_CODE.DATA_EXPORT_IN_PROGRESS);
        return { correlationId: active.correlation_id, created: false };
      }
      if (recent.length >= DAILY_EXPORT_LIMIT) {
        const oldest = new Date(recent[0]!.created_at).getTime();
        const retryAfter = Math.max(1, Math.ceil((oldest + DAY_MS - now.getTime()) / 1000));
        throw new TooManyRequestsError(`At most ${DAILY_EXPORT_LIMIT} data exports a day`, retryAfter);
      }
      const correlationId = `${DATA_EXPORT_OPERATION}:${randomUUID()}`;
      const fresh = await backgroundOperationService.createQueuedOperation(
        { appuserKey: scope.appuserKey, correlationId, operationType: DATA_EXPORT_OPERATION, resourceId: `user:${scope.appuserKey}`, retryable: false, tenantKey: scope.tenantKey },
        tx,
      );
      fresh.progress = { delivery, encrypted, fileName: exportFileName(now) } satisfies ExportProgress;
      // The limits and download windows count from here, on the service's clock.
      fresh.createdAt = now;
      await tx.flush();
      if (options.password !== undefined) {
        const window = delivery === 'storage' ? STORED_JOB_WINDOW_MS : STREAM_DOWNLOAD_WINDOW_MS;
        await secrets.put(correlationId, options.password, new Date(now.getTime() + window));
      }
      return { correlationId, created: true };
    });
    const operation = await this.load(correlationId);
    if (!operation) throw new NotFoundError('Export not found');

    if (created && delivery === 'storage') await this.enqueue(operation.correlationId);
    return { created, export: await this.view((await this.load(correlationId)) ?? operation) };
  }

  /** The person's export with this id; another person's (even their partner's) is not found. */
  async get(appuserKey: number, id: string): Promise<DataExportView> {
    return this.view(await this.find(appuserKey, id));
  }

  /** The person's exports of the last 24 hours, newest first: what Settings shows on load. */
  async list(appuserKey: number): Promise<DataExportView[]> {
    const operations = await this.em.find(
      BackgroundOperation,
      { appuserKey: { appuserKey }, createdAt: { $gt: new Date(this.now.getTime() - DAY_MS) }, deletedAt: null, operationType: DATA_EXPORT_OPERATION },
      { orderBy: { backgroundOperationKey: 'desc' }, refresh: true },
    );
    return Promise.all(operations.map((operation) => this.view(operation)));
  }

  /**
   * Download an export. A stored one redirects to its short-lived link; a streamed one is built
   * into `output` (once), after `onStart` has had a chance to set the response headers.
   */
  async download(appuserKey: number, id: string, output: Writable, handlers: { onRedirect: (url: string) => void; onStart: (fileName: string) => void }, exportDeps: HouseholdExportDeps = {}): Promise<void> {
    const operation = await this.find(appuserKey, id);
    const view = await this.view(operation);
    if (view.status !== 'ready') throw new NotFoundError('Export not available');
    if (view.delivery === 'storage') {
      handlers.onRedirect(view.downloadUrl!);
      return;
    }
    if (!(await this.claimStreamDownload(operation.correlationId))) throw new NotFoundError('Export not available');
    const password = await this.passwordFor(operation);
    if (password === null) {
      await backgroundOperationService.finish(operation.correlationId, { errorCode: 'user.data-export:password-expired', stage: 'user.data-export:failed', status: BackgroundOperationStatus.FAILED });
      throw new NotFoundError('Export not available');
    }
    handlers.onStart(view.fileName);
    try {
      await writeHouseholdExport(this.em, this.scopeOf(operation), output, { holdings: defaultHoldings(this.em), now: this.deps.now, ...exportDeps }, password === undefined ? {} : { password });
      await backgroundOperationService.finish(operation.correlationId, { stage: 'user.data-export:streamed', status: BackgroundOperationStatus.SUCCEEDED });
    } catch (error) {
      await backgroundOperationService.finish(operation.correlationId, { errorCode: 'user.data-export:stream-failed', stage: 'user.data-export:failed', status: BackgroundOperationStatus.FAILED });
      throw error;
    }
  }

  /**
   * The job: build the archive into a temporary file, upload it, then tell the person. Returns
   * false when the operation was not this job's to run (already claimed or finished).
   */
  async runStoredExport(correlationId: string, queueJobId: string): Promise<boolean> {
    const bg = backgroundOperationService;
    if (!(await bg.claimJobStart(correlationId, queueJobId))) return false;
    const path = join(tmpdir(), `wondermoney-export-${randomUUID()}.zip`);
    try {
      const operation = await this.load(correlationId);
      if (!operation) throw new Error('Export operation vanished');
      const scope = this.scopeOf(operation);
      const progress = progressOf(operation);
      const fileName = progress.fileName ?? exportFileName(this.now);
      const password = await this.passwordFor(operation);
      // Never fall back to an unprotected archive.
      if (password === null) throw new Error('The export password expired before the export ran');

      // With a password the file is encrypted as it is written: no unencrypted copy touches the disk.
      await writeHouseholdExport(this.em, scope, createWriteStream(path), { holdings: defaultHoldings(this.em), now: this.deps.now }, password === undefined ? {} : { password });
      await bg.heartbeatJob(correlationId, queueJobId, { stage: 'user.data-export:written' });

      const bucket = this.storage.getFilesBucketName();
      const key = `data-exports/${scope.appuserKey}/${randomUUID()}.zip`;
      const { size } = await stat(path);
      await this.storage.uploadStream(bucket, key, createReadStream(path), size, 'application/zip');
      const expiresAt = new Date(this.now.getTime() + STORED_EXPORT_TTL_MS);
      const stored: ExportProgress = { bucket, bytes: size, delivery: 'storage', encrypted: password !== undefined, expiresAt: expiresAt.toISOString(), fileName, key };
      await bg.heartbeatJob(correlationId, queueJobId, { progress: stored as unknown as Record<string, unknown>, stage: 'user.data-export:stored' });
      if (this.deps.enqueue) await enqueueDataExportCleanupJob({ correlationId }, expiresAt, { enqueue: this.deps.enqueue });
      if (!(await bg.finishJob(correlationId, queueJobId, { stage: 'user.data-export:complete', status: BackgroundOperationStatus.SUCCEEDED }))) throw new Error('Export job could not finish');
      await this.notify(scope.appuserKey);
      return true;
    } catch (error) {
      // Recorded as a terminal failure the person sees and can start again from; not retried.
      await bg.finishJob(correlationId, queueJobId, { errorCode: 'user.data-export:failed', stage: 'user.data-export:failed', status: BackgroundOperationStatus.FAILED });
      logger.error({ correlationId, error }, 'Data export failed');
      Sentry.captureException(error, { tags: { job: 'user.data-export' } });
      return false;
    } finally {
      await unlink(path).catch(() => undefined);
      // Already gone once read; this covers a job that failed before reading it.
      await this.secrets.discard([correlationId]).catch(() => undefined);
    }
  }

  /** Delete a stored archive (the cleanup job, 24 hours on). Safe to run twice. */
  async deleteStoredExport(correlationId: string): Promise<void> {
    const operation = await this.load(correlationId);
    if (!operation) return;
    const progress = progressOf(operation);
    if (progress.delivery !== 'storage' || !progress.bucket || !progress.key || progress.deletedAt) return;
    await this.storage.deleteObject(progress.bucket, progress.key);
    operation.progress = { ...progress, deletedAt: this.now.toISOString() };
    await this.em.flush();
  }

  private async claimStreamDownload(correlationId: string): Promise<boolean> {
    const rows = await this.em.getConnection().execute(
      `update background_operation set status = 'running', started_at = now(), last_heartbeat_at = now(), attempt_count = attempt_count + 1, updated_at = now()
       where correlation_id = ? and status = 'queued' and deleted_at is null returning background_operation_key`,
      [correlationId],
    );
    return Array.isArray(rows) ? rows.length > 0 : Boolean(rows);
  }

  private async enqueue(correlationId: string): Promise<void> {
    try {
      if (!this.deps.enqueue) throw new Error('No queue to send the export job to');
      const jobId = await enqueueDataExportJob({ correlationId }, { enqueue: this.deps.enqueue });
      if (!jobId) throw new Error('The export queue returned no job id');
      await backgroundOperationService.attachQueueJob(correlationId, String(jobId));
    } catch (error) {
      await backgroundOperationService.markFailed(correlationId, 'user.data-export:enqueue-failed');
      await this.secrets.discard([correlationId]);
      throw error;
    }
  }

  private async find(appuserKey: number, id: string): Promise<BackgroundOperation> {
    const operation = await this.load(id);
    if (operation?.operationType !== DATA_EXPORT_OPERATION || keyOf(operation.appuserKey) !== appuserKey) throw new NotFoundError('Export not found');
    return operation;
  }

  /**
   * The export's password, taken (so deleted) from its one-time secret: undefined for an
   * unprotected export, null when a protected one's secret is gone or expired.
   */
  private async passwordFor(operation: BackgroundOperation): Promise<null | string | undefined> {
    if (!progressOf(operation).encrypted) return undefined;
    return this.secrets.take(operation.correlationId);
  }

  /** The operation as stored now: raw-SQL state transitions bypass the identity map. */
  private load(correlationId: string): Promise<BackgroundOperation | null> {
    return this.em.findOne(BackgroundOperation, { correlationId, deletedAt: null }, { refresh: true });
  }

  private async notify(appuserKey: number): Promise<void> {
    try {
      const appuser = await this.em.findOneOrFail(Appuser, { appuserKey }, { filters: false });
      await (this.deps.sendReadyEmail ?? defaultSendReadyEmail)(appuser);
    } catch (error) {
      // The export is done and downloadable from Settings; a lost email must not fail it.
      logger.warn({ appuserKey, error }, 'Data export ready email failed');
    }
  }

  private scopeOf(operation: BackgroundOperation): ExportScope {
    const appuserKey = keyOf(operation.appuserKey);
    const tenantKey = keyOf(operation.tenantKey);
    if (appuserKey === null || tenantKey === null) throw new Error('Export operation has no owner');
    return { appuserKey, tenantKey };
  }

  private async view(operation: BackgroundOperation): Promise<DataExportView> {
    const progress = progressOf(operation);
    const createdAt = operation.createdAt;
    const now = this.now.getTime();
    let status: DataExportStatus;
    let expiresAt: Date | null = null;
    let downloadUrl: null | string = null;

    if (progress.delivery === 'stream') {
      expiresAt = new Date(createdAt.getTime() + STREAM_DOWNLOAD_WINDOW_MS);
      if (operation.status === BackgroundOperationStatus.QUEUED) status = now < expiresAt.getTime() ? 'ready' : 'expired';
      else if (operation.status === BackgroundOperationStatus.RUNNING) status = 'running';
      // A streamed export downloads once; afterwards it is spent.
      else if (operation.status === BackgroundOperationStatus.SUCCEEDED) status = 'expired';
      else status = 'failed';
    } else {
      expiresAt = progress.expiresAt ? new Date(progress.expiresAt) : null;
      if (operation.status === BackgroundOperationStatus.QUEUED) status = 'queued';
      else if (operation.status === BackgroundOperationStatus.RUNNING) status = 'running';
      else if (operation.status === BackgroundOperationStatus.SUCCEEDED) {
        status = progress.deletedAt || !expiresAt || now >= expiresAt.getTime() || !progress.bucket || !progress.key ? 'expired' : 'ready';
        if (status === 'ready') downloadUrl = await this.storage.generatePresignedDownloadUrl(progress.bucket!, progress.key!, progress.fileName ?? exportFileName(createdAt), DOWNLOAD_URL_TTL_SECONDS);
      } else status = 'failed';
    }

    return {
      createdAt: createdAt.toISOString(),
      delivery: progress.delivery,
      downloadUrl,
      encrypted: progress.encrypted === true,
      expiresAt: expiresAt?.toISOString() ?? null,
      fileName: progress.fileName ?? exportFileName(createdAt),
      finishedAt: operation.finishedAt ? new Date(operation.finishedAt).toISOString() : null,
      id: operation.correlationId,
      status,
    };
  }
}

const defaultSendReadyEmail = (appuser: Appuser) =>
  sendDataExportReadyEmail({ appuserKey: appuser.appuserKey, emailAddress: appuser.emailAddress, ...(appuser.firstName ? { firstName: appuser.firstName } : {}), language: appuser.language });

/** Holdings as the portfolio page shows them; a portfolio that cannot be valued is left out of the spreadsheet. */
function defaultHoldings(em: EntityManager): NonNullable<HouseholdExportDeps['holdings']> {
  let appuser: Appuser | undefined;
  return async ({ appuserKey, portfolioKey, tenantKey }): Promise<HoldingRow[]> => {
    try {
      appuser ??= await em.findOneOrFail(Appuser, { appuserKey }, { filters: false, populate: ['currencyKey'] });
      return (await portfolioHoldingsService.getPortfolioHoldings(appuser, portfolioKey, tenantKey)).filter((holding) => !holding.isInvalid);
    } catch (error) {
      logger.warn({ error, portfolioKey }, 'Data export left a portfolio out of holdings.csv');
      return [];
    }
  };
}
