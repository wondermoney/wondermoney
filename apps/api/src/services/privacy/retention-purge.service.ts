import type { EntityManager } from '@mikro-orm/postgresql';
import type { Logger } from 'pino';

import { CREDIT_CARD_STATEMENT_WINDOW_DAYS } from '@service/account/credit-card-due-reminder.service';
import { loadConnectionHealth } from '@service/bank-sync-alerts/bank-sync-alert-health.repository';
import { decideBankSyncAlert } from '@service/bank-sync-alerts/bank-sync-alert-policy';

import { eraseDeletedAccounts } from './deleted-account-erasure';
import { retentionCutoff } from './retention-period';
import { defaultRetentionStorage, type RetentionStorage } from './retention-storage';
import { storageKeyFromUrl } from './row-erasure';

/**
 * The daily retention purge (`jobs/privacy-retention.queue.ts`): deletes, in every household, the
 * personal data the privacy policy promises to keep for 30 days (`PERSONAL_DATA_RETENTION_DAYS`)
 * once it has served its purpose. Each kind is its own step; one that fails is logged and retried
 * the next day without holding the others back.
 *
 * | Step | Deleted | 30 days after |
 * |---|---|---|
 * | `deletedAccounts` | a dissolved household's records, the anonymised account record | the account deletion |
 * | `enableBankingKeys` | a retired Enable Banking key | it was removed, or its account deleted |
 * | `assistantAuditLog` | assistant and MCP audit log rows | they were written |
 * | `sentEmails` | sent email records | the last send attempt |
 * | `pushClaims` | push notification dedupe rows | they were written |
 * | `bankSyncAlerts` | bank sync alert deliveries | the delivery last changed |
 * | `creditCardReminders` | payment-due reminder deliveries | the delivery last changed |
 * | `analyticsEvents` | our copy of a service event | it was delivered to PostHog |
 * | `receiptScans` | a receipt image sent for reading, with its file | it was read |
 * | `portfolioImports` | an imported portfolio file, its rows and its file | the import last changed |
 *
 * A few records outlive the period only while deleting them would undo what they are for (a
 * dedupe whose message could otherwise go again, a key a live bank connection signs with, a file
 * that became an attachment); each step says which and what is kept.
 */

export interface BatchedDelete {
  deleted: number;
  /** Whether the step stopped at its per-run limit with rows left. */
  more: boolean;
}

export interface FileBackedDelete extends BatchedDelete {
  /** Files that could not be removed: their rows stay, for the next run. */
  fileErrors: number;
  files: number;
}

export interface RetentionPurgeInput {
  /** Rows per delete statement. */
  batchSize?: number;
  em: EntityManager;
  logger?: Pick<Logger, 'info' | 'warn'>;
  /** Batches per step and run; what is left waits for the next run. */
  maxBatches?: number;
  now: Date;
  storage?: RetentionStorage;
}

export interface RetentionPurgeResult {
  failed: string[];
  steps: Record<string, unknown>;
}

const DEFAULT_BATCH_SIZE = 1_000;
const DEFAULT_MAX_BATCHES = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Limits {
  batchSize: number;
  maxBatches: number;
}

const placeholders = (values: readonly unknown[]) => values.map(() => '?').join(', ');
const affected = (result: unknown) => {
  const value = result as { affectedRows?: number; rowCount?: number };
  return value.affectedRows ?? value.rowCount ?? 0;
};

/** Runs every step, each on its own; the names of the steps that failed come back in `failed`. */
export async function runRetentionPurge(input: RetentionPurgeInput): Promise<RetentionPurgeResult> {
  const limits = { batchSize: input.batchSize ?? DEFAULT_BATCH_SIZE, maxBatches: input.maxBatches ?? DEFAULT_MAX_BATCHES };
  const storage = input.storage ?? defaultRetentionStorage;
  const { em, now } = input;
  const steps: [string, () => Promise<unknown>][] = [
    ['deletedAccounts', () => eraseDeletedAccounts({ em, logger: input.logger, now, storage })],
    ['enableBankingKeys', () => purgeRetiredEnableBankingKeys(em, now, limits)],
    ['assistantAuditLog', () => purgeAssistantAuditLog(em, now, limits)],
    ['sentEmails', () => purgeSentEmails(em, now, limits)],
    ['pushClaims', () => purgePushNotificationClaims(em, now, limits)],
    ['bankSyncAlerts', () => purgeBankSyncAlertDeliveries(em, now)],
    ['creditCardReminders', () => purgeCreditCardReminderDeliveries(em, now, limits)],
    ['analyticsEvents', () => purgeDeliveredAnalyticsEvents(em, now, limits)],
    ['receiptScans', () => purgeReceiptScans(em, now, storage, limits)],
    ['portfolioImports', () => purgePortfolioImports(em, now, storage, limits)],
  ];
  const result: RetentionPurgeResult = { failed: [], steps: {} };
  for (const [name, step] of steps) {
    try {
      result.steps[name] = await step();
    } catch (error) {
      result.failed.push(name);
      // The message alone: an error from a row-level query can quote the row.
      input.logger?.warn({ error: error instanceof Error ? error.message : String(error), step: name }, 'Retention purge step failed');
    }
  }
  return result;
}

/**
 * Deletes, a batch at a time, the rows of `table` matching `where` (on alias `t`), oldest key
 * first. Every condition here is on the row alone, so the batches need no transaction.
 */
async function deleteInBatches(em: EntityManager, table: string, key: string, where: string, params: unknown[], limits: Limits): Promise<BatchedDelete> {
  const connection = em.getConnection();
  let deleted = 0;
  for (let batch = 0; batch < limits.maxBatches; batch += 1) {
    const result = await connection.execute(
      `delete from ${table} where ${key} in (select t.${key} from ${table} t where ${where} order by t.${key} limit ?)`,
      [...params, limits.batchSize],
      'run',
    );
    const count = affected(result);
    deleted += count;
    if (count < limits.batchSize) return { deleted, more: false };
  }
  const left = await connection.execute<unknown[]>(`select 1 from ${table} t where ${where} limit 1`, params);
  return { deleted, more: left.length > 0 };
}

/** The assistant's and the MCP server's tool-call log: 30 days after each row was written. */
export function purgeAssistantAuditLog(em: EntityManager, now: Date, limits: Limits = defaultLimits()): Promise<BatchedDelete> {
  return deleteInBatches(em, 'assistant_audit_log', 'assistant_audit_log_key', 't.created_at < ?', [retentionCutoff(now)], limits);
}

/**
 * Our copy of a service event, 30 days after PostHog acknowledged it. (An event never delivered
 * goes 30 days after it was written, in `analytics-outbox.worker.ts`, every minute.)
 */
export function purgeDeliveredAnalyticsEvents(em: EntityManager, now: Date, limits: Limits = defaultLimits()): Promise<BatchedDelete> {
  return deleteInBatches(em, 'analytics_outbox', 'analytics_outbox_key', 't.sent_at < ?', [retentionCutoff(now)], limits);
}

/**
 * A budget alert's crossing key (`ba:c:<tenant>:<budget>:<category>:<yyyymm>:<threshold>`,
 * `financial-email-delivery.service.ts`) names the month the threshold was crossed in. The alert
 * sweep reads the current month only, so the key is the dedupe until that month is over: an alert
 * sent on the 1st would otherwise go again on the 31st. Kept until a day after the month ends (the
 * sweep runs in Lisbon time), then deleted with the rest.
 */
const crossingMonthOver = (column: string) => `coalesce(
  to_date(substring(t.${column} from '^ba:c:\\d+:\\d+:\\d+:(\\d{6}):\\d+$'), 'YYYYMM') + interval '1 month 1 day' <= ?,
  true)`;

/**
 * Sent email records (`sent_email`), 30 days after the last attempt. They are the dedupe of the
 * budget, weekly and monthly emails, each keyed to its day, week or month, which is over by then,
 * except a budget crossing still in its month (see {@link crossingMonthOver}). That row keeps only
 * the user key, its key, its status and its times.
 */
export function purgeSentEmails(em: EntityManager, now: Date, limits: Limits = defaultLimits()): Promise<BatchedDelete> {
  return deleteInBatches(em, 'sent_email', 'sent_email_key', `t.updated_at < ? and ${crossingMonthOver('email_type')}`, [retentionCutoff(now), now], limits);
}

/** The push side of the same dedupe (`push_notification_claim`): the same rule as {@link purgeSentEmails}. */
export function purgePushNotificationClaims(em: EntityManager, now: Date, limits: Limits = defaultLimits()): Promise<BatchedDelete> {
  return deleteInBatches(em, 'push_notification_claim', 'push_notification_claim_key', `t.created_at < ? and ${crossingMonthOver('dedupe_key')}`, [retentionCutoff(now), now], limits);
}

/**
 * Payment-due reminder deliveries, 30 days after the delivery last changed, once their statement
 * has left the window the reminder sweep reads (it closed over 40 days ago): until then the row is
 * what stops the reminder going twice. The row holds the card's account key, the statement's
 * close day and the outcome, never an address.
 */
export interface BankSyncAlertPurge {
  deleted: number;
  /** Older deliveries kept because their alert still applies; their provider message id is cleared. */
  kept: number;
}

export function purgeCreditCardReminderDeliveries(em: EntityManager, now: Date, limits: Limits = defaultLimits()): Promise<BatchedDelete> {
  const outOfWindow = new Date(now.getTime() - (CREDIT_CARD_STATEMENT_WINDOW_DAYS + 1) * DAY_MS).toISOString().slice(0, 10);
  return deleteInBatches(em, 'credit_card_due_reminder_delivery', 'credit_card_due_reminder_delivery_key', 't.updated_at < ? and t.period_end < ?::date', [retentionCutoff(now), outOfWindow], limits);
}

/**
 * Bank sync alert deliveries, 30 days after the delivery last changed. A delivery is the dedupe of
 * its alert (connection, event, episode), and some alerts last longer than that: a revoked consent
 * alerts until the consent's end date, a failing sync for as long as the streak lasts. A delivery
 * whose alert the policy still raises today is kept, holding the user key, the connection key, the
 * event, the episode, the channel and the status, and nothing that names the message.
 */
export async function purgeBankSyncAlertDeliveries(em: EntityManager, now: Date): Promise<BankSyncAlertPurge> {
  const connection = em.getConnection();
  const old = await connection.execute<{ connection: number; episode: string; event: string; key: number }[]>(
    `select bank_sync_alert_delivery_key as key, enable_banking_connection_key as connection, event, episode_key as episode
       from bank_sync_alert_delivery where updated_at < ? order by bank_sync_alert_delivery_key`,
    [retentionCutoff(now)],
  );
  if (old.length === 0) return { deleted: 0, kept: 0 };

  const live = new Set<string>();
  for (const health of await loadConnectionHealth(em, { scope: 'all' })) {
    const decision = decideBankSyncAlert(health, now);
    if (decision) live.add(`${health.enableBankingConnectionKey}|${decision.event}|${decision.episodeKey}`);
  }
  const keep = old.filter((row) => live.has(`${row.connection}|${row.event}|${row.episode}`)).map((row) => row.key);
  const drop = old.filter((row) => !live.has(`${row.connection}|${row.event}|${row.episode}`)).map((row) => row.key);
  let deleted = 0;
  for (const chunk of chunks(drop)) {
    deleted += affected(await connection.execute(`delete from bank_sync_alert_delivery where bank_sync_alert_delivery_key in (${placeholders(chunk)})`, chunk, 'run'));
  }
  for (const chunk of chunks(keep)) {
    await connection.execute(`update bank_sync_alert_delivery set provider_message_id = null where provider_message_id is not null and bank_sync_alert_delivery_key in (${placeholders(chunk)})`, chunk, 'run');
  }
  return { deleted, kept: keep.length };
}

/**
 * Retired Enable Banking keys (encrypted), 30 days after they were removed (`deleted_at`) or their
 * owner's account was deleted. A key a live bank connection was made with is kept while that
 * connection is: Enable Banking ties the connection's session to the application the key signs
 * for, so deleting it would stop the connection syncing. The connections already ended that still
 * point at it lose the reference. A pending key lapses after 7 days on its own
 * (`purgeLapsedPendingCredentials`).
 */
export async function purgeRetiredEnableBankingKeys(em: EntityManager, now: Date, limits: Limits = defaultLimits()): Promise<BatchedDelete> {
  let deleted = 0;
  for (let batch = 0; batch < limits.maxBatches; batch += 1) {
    const count = await em.fork().transactional(async (tx) => {
      const connection = tx.getConnection();
      const context = tx.getTransactionContext();
      const keys = (await connection.execute<{ key: number }[]>(
        `select c.enable_banking_credential_key as key
           from enable_banking_credential c join appuser a on a.appuser_key = c.appuser_key
          where c.status <> 'pending' and coalesce(c.deleted_at, a.deleted_at) < ?
            and not exists (select 1 from enable_banking_connection x
                             where x.enable_banking_credential_key = c.enable_banking_credential_key and x.deleted_at is null)
          order by c.enable_banking_credential_key
          limit ? for update of c skip locked`,
        [retentionCutoff(now), limits.batchSize],
        'all',
        context,
      )).map((row) => row.key);
      if (keys.length === 0) return 0;
      await connection.execute(
        `update enable_banking_connection set enable_banking_credential_key = null
          where deleted_at is not null and enable_banking_credential_key in (${placeholders(keys)})`,
        keys,
        'run',
        context,
      );
      return affected(await connection.execute(`delete from enable_banking_credential where enable_banking_credential_key in (${placeholders(keys)})`, keys, 'run', context));
    });
    deleted += count;
    if (count < limits.batchSize) return { deleted, more: false };
  }
  return { deleted, more: true };
}

/**
 * Receipt and invoice images sent for automatic reading (`transaction_ocr_import`), with the file,
 * 30 days after they were read. A receipt the person confirmed became its transaction's first
 * attachment, which is the same stored file: while that attachment exists the file stays, as the
 * attachment, and goes when the person removes it.
 */
export async function purgeReceiptScans(em: EntityManager, now: Date, storage: RetentionStorage, limits: Limits = defaultLimits()): Promise<FileBackedDelete> {
  const result: FileBackedDelete = { deleted: 0, fileErrors: 0, files: 0, more: false };
  for (let batch = 0; batch < limits.maxBatches; batch += 1) {
    const outcome = await em.fork().transactional(async (tx) => {
      const connection = tx.getConnection();
      const context = tx.getTransactionContext();
      const rows = await connection.execute<{ file_key: null | string; file_url: null | string; key: number }[]>(
        `select transaction_ocrimport_key as key, file_key, file_url from transaction_ocr_import
          where created_at < ? order by transaction_ocrimport_key limit ? for update skip locked`,
        [retentionCutoff(now), limits.batchSize],
        'all',
        context,
      );
      const keep = new Set<number>();
      let files = 0;
      for (const row of rows) {
        const key = row.file_key ?? (row.file_url ? storageKeyFromUrl(row.file_url) : null);
        if (!key) continue;
        const attached = await connection.execute<unknown[]>('select 1 from transaction_attachment where storage_key = ? and deleted_at is null limit 1', [key], 'all', context);
        if (attached.length > 0) continue;
        const removed = await removeFile(storage, null, key);
        if (removed === 'failed') keep.add(row.key);
        if (removed === 'removed') files += 1;
      }
      const gone = rows.map((row) => row.key).filter((key) => !keep.has(key));
      const deleted = gone.length === 0 ? 0 : affected(await connection.execute(`delete from transaction_ocr_import where transaction_ocrimport_key in (${placeholders(gone)})`, gone, 'run', context));
      return { deleted, fileErrors: keep.size, files, scanned: rows.length };
    });
    result.deleted += outcome.deleted;
    result.fileErrors += outcome.fileErrors;
    result.files += outcome.files;
    // A batch of files that could not go would come back first every time: stop for today.
    if (outcome.scanned < limits.batchSize || outcome.deleted === 0) return result;
  }
  return { ...result, more: true };
}

/**
 * Portfolio file imports (`portfolio_import_session`, with its rows, asset groups and candidates,
 * which go with it), and the uploaded file, 30 days after the import last changed: when it
 * finished, failed, was cancelled or was left. A file another import still uses stays with it.
 */
export async function purgePortfolioImports(em: EntityManager, now: Date, storage: RetentionStorage, limits: Limits = defaultLimits()): Promise<FileBackedDelete> {
  const result: FileBackedDelete = { deleted: 0, fileErrors: 0, files: 0, more: false };
  for (let batch = 0; batch < limits.maxBatches; batch += 1) {
    const outcome = await em.fork().transactional(async (tx) => {
      const connection = tx.getConnection();
      const context = tx.getTransactionContext();
      const sessions = await connection.execute<{ bucket: string; key: number; s3_key: string }[]>(
        `select portfolio_import_session_key as key, s3_bucket as bucket, s3_key from portfolio_import_session
          where updated_at < ? order by portfolio_import_session_key limit ? for update skip locked`,
        [retentionCutoff(now), limits.batchSize],
        'all',
        context,
      );
      if (sessions.length === 0) return { deleted: 0, fileErrors: 0, files: 0, scanned: 0 };
      const keys = sessions.map((session) => session.key);
      const stillUsed = await connection.execute<{ s3_bucket: string; s3_key: string }[]>(
        `select distinct s3_bucket, s3_key from portfolio_import_session
          where portfolio_import_session_key not in (${placeholders(keys)})
            and (s3_bucket, s3_key) in (${sessions.map(() => '(?, ?)').join(', ')})`,
        [...keys, ...sessions.flatMap((session) => [session.bucket, session.s3_key])],
        'all',
        context,
      );
      const used = new Set(stillUsed.map((file) => `${file.s3_bucket}\u0000${file.s3_key}`));
      const failedFiles = new Set<string>();
      let files = 0;
      for (const [id, session] of new Map(sessions.map((session) => [`${session.bucket}\u0000${session.s3_key}`, session]))) {
        if (used.has(id) || !session.s3_key) continue;
        const removed = await removeFile(storage, session.bucket, session.s3_key);
        if (removed === 'failed') failedFiles.add(id);
        if (removed === 'removed') files += 1;
      }
      const gone = sessions.filter((session) => !failedFiles.has(`${session.bucket}\u0000${session.s3_key}`)).map((session) => session.key);
      const deleted = gone.length === 0 ? 0 : affected(await connection.execute(`delete from portfolio_import_session where portfolio_import_session_key in (${placeholders(gone)})`, gone, 'run', context));
      return { deleted, fileErrors: sessions.length - gone.length, files, scanned: sessions.length };
    });
    result.deleted += outcome.deleted;
    result.fileErrors += outcome.fileErrors;
    result.files += outcome.files;
    if (outcome.scanned < limits.batchSize || outcome.deleted === 0) return result;
  }
  return { ...result, more: true };
}

/**
 * Removes one stored file: `removed`, or `failed` when the store refused, and the row that names
 * it is kept for the next run. A server without file storage has no file it could remove
 * (`none`): the row goes on its own.
 */
function chunks<T>(values: T[], size = DEFAULT_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function defaultLimits(): Limits {
  return { batchSize: DEFAULT_BATCH_SIZE, maxBatches: DEFAULT_MAX_BATCHES };
}

async function removeFile(storage: RetentionStorage, bucket: null | string, key: string): Promise<'failed' | 'none' | 'removed'> {
  if (!storage.isEnabled()) return 'none';
  try {
    await storage.deleteObject(bucket ?? storage.filesBucket(), key);
    return 'removed';
  } catch {
    return 'failed';
  }
}
