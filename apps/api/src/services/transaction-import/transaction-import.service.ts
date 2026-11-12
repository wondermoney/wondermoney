import { randomUUID } from 'node:crypto';

import { DriverException, LockMode, type RequiredEntityData } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import * as Sentry from '@sentry/node';
import { transactionImport } from '@wondermoney/shared';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { enqueueTransactionImportJob, type TransactionImportJobMode } from '@app/jobs/transaction-import.queue';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory, Source as CategorySource } from '@entity/AppuserTransactionCategory';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { Category } from '@entity/Category';
import { Currency } from '@entity/Currency';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionImportRow, TransactionImportRowDecision, TransactionImportRowStatus } from '@entity/TransactionImportRow';
import { TransactionImportSession, TransactionImportSessionStatus } from '@entity/TransactionImportSession';
import { TransactionType } from '@entity/TransactionType';
import { resolveAccountCsvImportFormat } from '@service/account/account-csv-import-format';
import type { StatementMapping } from '@service/account/account-statement-mapping.schema';
import { buildStatementTransaction, followUpStatementImport, settleStatementImport, type StatementWriteContext, statementWriteContext } from '@service/account/account-statement-transaction';
import { getLimitedCsvObjectBuffer, validateCsvObjectKey } from '@service/account/csv-upload-boundary.service';
import { convertWithStatus, rateScope } from '@service/currency/exchange-rate';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { Enqueue } from '@service/queue/enqueue';
import s3Service from '@service/storage/s3';
import { markUserCategorized } from '@service/transaction/categorization-confidence';
import { findAssignableCategory } from '@service/transaction/household-category';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { findImportedTransactionIds } from '@service/transaction/transaction-dedup.service';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';
import { getFullName } from '@utils/misc';

import { importFileName } from './import-file-name';
import { findLikelyDuplicateCandidates } from './likely-duplicate-candidates';
import { type LikelyDuplicateRow, matchLikelyDuplicates } from './likely-duplicate-match';
import { statementImportAdapter, StatementUnreadableError, toStatementLine } from './statement-import-adapter';

/**
 * Staged, resumable transaction imports (wondermoney/wondermoney#58), one `TransactionImportSession`
 * per file:
 *
 *   create   on an account the person owns: with a file already uploaded for that account (the
 *            import dialog's upload), parsing starts at once; without, the response carries a link
 *            to upload it to, and `parse` starts it.
 *   parse    a worker job reads the file with its format's adapter, stores every line as a
 *            `TransactionImportRow` in batches, and classifies each against its target account:
 *            `new`, `duplicate` (the same id is already there, or earlier in the file),
 *            `possible_duplicate` (no id matched, but a transaction there has the same amount
 *            within a few days: `likely-duplicate-match.ts`) or `invalid`. New rows default to
 *            import, duplicates and possible duplicates to skip (in a one-step import, which no one
 *            reviews, possible duplicates import; duplicates are still skipped). A file with several accounts waits in
 *            `needs_mapping` until each has an account.
 *   review   the person pages through the rows by status and includes or skips them, by row or
 *            in bulk (`decide`), and maps the file's accounts (`setAccountMapping`, which can also
 *            create a manual account for one) and, for a file with categories (YNAB), its
 *            categories (`setCategoryMapping`; a category left out takes the one its name
 *            matched, or none).
 *   commit   a worker job writes the rows decided `import` in chunks of {@link CHUNK_SIZE}. Each
 *            chunk is one database transaction, under a lock on the session, that writes its
 *            transactions and flips its rows to `imported`, so a job that stops part way resumes
 *            where it stopped and never writes a row twice. A row whose file category maps to a
 *            category is written with it, as the person's choice. After the last chunk it settles the
 *            accounts once (balance chain, rules, learned categories) and sets the outcome; then
 *            transfer matching, recurring detection and enrichment follow.
 *
 * Only `commit` writes transactions. A session is its starter's alone: queries carry the person
 * and the household (and the entity's owner filter does too), so another household, and the
 * person's own partner, get not found. Target accounts are accounts the person owns.
 *
 * An uncommitted session expires after {@link SESSION_TTL_MS}. A daily sweep, in every household
 * (`transaction-import-sweep.ts`), deletes expired sessions with their rows and uploaded files, and
 * seven days after a commit deletes the committed session's rows and file, keeping its summary
 * (the file's name, status, dates, row counts) for the person's history.
 */
export const TRANSACTION_IMPORT_OPERATION = 'transaction-import';
const CHUNK_SIZE = 500;
const ROW_BATCH_SIZE = 500;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
/** A running job whose operation has not been marked alive for this long has stopped. */
const RUNNING_JOB_SILENCE_MS = 5 * 60 * 1000;
/** A queued job no worker has picked up for this long will not be. */
const QUEUED_JOB_SILENCE_MS = 15 * 60 * 1000;

const { ROW_STATUS, SESSION_STATUS } = { ROW_STATUS: TransactionImportRowStatus, SESSION_STATUS: TransactionImportSessionStatus };
/** Rows a commit writes when they are decided `import`. */
const WRITABLE_ROW_STATUSES = [ROW_STATUS.NEW, ROW_STATUS.DUPLICATE, ROW_STATUS.POSSIBLE_DUPLICATE];
/** Sessions waiting for the person, which expire. */
const OPEN_SESSION_STATUSES = [SESSION_STATUS.WAITING_FOR_UPLOAD, SESSION_STATUS.NEEDS_MAPPING, SESSION_STATUS.READY, SESSION_STATUS.FAILED];

export interface TransactionImportCreateInput {
  accountId: number;
  /** Commit with the default decisions as soon as the file is read: the one-step import. */
  autoCommit?: boolean;
  /** The name the file had on the person's device; cleaned and capped before it is kept. */
  fileName?: string;
  format: transactionImport.ImportFormat;
  /** A file already uploaded for this account; absent, the response carries an upload link. */
  key?: string;
  options?: TransactionImportOptions;
}

export interface TransactionImportDeps {
  /** The readers by format; the statement reader by default. */
  adapters?: Partial<Record<transactionImport.ImportFormat, transactionImport.ImportAdapter<never>>>;
  /** Rows per commit chunk ({@link CHUNK_SIZE} by default). */
  chunkSize?: number;
  enqueue?: Enqueue;
  now?: () => Date;
  /** Called before each commit chunk, with its index from 0 (a seam for tests that stop a commit part way). */
  onChunk?: (index: number) => Promise<void> | void;
  storage?: TransactionImportStorage;
}

/** The reader options a session keeps and hands to its adapter, beyond the account's currency. */
export interface TransactionImportOptions {
  /** How a QIF or YNAB date whose day and month are both 12 or less reads. */
  dateOrder?: transactionImport.DateOrder;
  mapping?: StatementMapping;
}

export interface TransactionImportRowQuery {
  page?: number;
  pageSize?: number;
  status?: transactionImport.ImportRowStatus;
}

export interface TransactionImportRowView {
  decision: null | transactionImport.ImportDecision;
  error: null | string;
  id: number;
  /** Why the row is a duplicate or a possible one; null for any other row. */
  matchReason: null | transactionImport.ImportMatchReason;
  /** The transaction on the target account the row repeats, or likely repeats. */
  matchedTransaction: null | { amount: null | number; date: null | string; description: null | string; id: number };
  normalized: null | Pick<transactionImport.NormalizedImportRow, 'amount' | 'categoryLabel' | 'currency' | 'date' | 'description' | 'merchant' | 'sourceAccountLabel' | 'transferAccountLabel'>;
  raw: Record<string, unknown>;
  sourceRow: number;
  status: transactionImport.ImportRowStatus;
  targetAccountId: null | number;
}

export interface TransactionImportScope {
  appuserKey: number;
  tenantKey: number;
}

export interface TransactionImportSessionView {
  accountId: null | number;
  accountMapping: Record<string, number>;
  /** Whether a commit can start now. */
  canCommit: boolean;
  /** Whether a parse or commit whose job stopped can be started again (it resumes). */
  canRetry: boolean;
  /** Source category label → category id, or null for uncategorised: the person's choices so far. */
  categoryMapping: Record<string, null | number>;
  /** When the commit finished; null before it has (and on sessions committed before it was recorded). */
  committedAt: null | string;
  correlationId: null | string;
  counts: transactionImport.ImportRowCounts;
  createdAt: string;
  /** Rows that will import and rows that will be skipped, among those not yet committed. */
  decisions: Record<transactionImport.ImportDecision, number>;
  /** Set once the sweep has deleted a committed session's rows and file: `counts` is then the summary kept, and there are no rows to list. */
  detailsDeletedAt: null | string;
  errorCode: null | string;
  expiresAt: string;
  /** The name the file had on the person's device; null on sessions started before it was kept. */
  fileName: null | string;
  format: transactionImport.ImportFormat;
  id: string;
  sourceAccounts: transactionImport.ImportSourceAccount[];
  /** The file's categories, for the category-mapping step; empty for a format that maps none. */
  sourceCategories: transactionImport.ImportSourceCategory[];
  status: transactionImport.ImportSessionStatus;
  /** Where to PUT the file, while it is awaited. */
  upload: null | { key: string; url: string };
  warnings: transactionImport.ImportWarning[];
}

export interface TransactionImportStorage {
  getAccountCsvBucketName(): string;
  getObjectBuffer(bucket: string, key: string): Promise<Buffer>;
  getObjectSize(bucket: string, key: string): Promise<number | undefined>;
  /** A link to PUT a file for `accountKey` to, and the key it lands at. */
  presignAccountUpload(accountKey: number): Promise<{ key: string; presignedUrl: string }>;
}

export interface TransactionImportView {
  rows: { items: TransactionImportRowView[]; page: number; pageSize: number; total: number };
  session: TransactionImportSessionView;
}

/** What a commit did, in the shape the one-step import reported on its operation. */
interface CommitTotals {
  failed: number;
  imported: number;
  skipped: number;
  totalRows: number;
}

/** The key of a relation, whether it is loaded, a reference, or the bare key. */
const keyOf = (ref: unknown, field: string): null | number => {
  if (ref === null || ref === undefined) return null;
  if (typeof ref === 'number') return ref;
  const value = (ref as Record<string, unknown>)[field];
  return typeof value === 'number' ? value : null;
};

/** References to rows by key, for relations. */
const accountRef = (em: EntityManager, accountKey: number) => em.getReference(Account, { accountKey } as unknown as Account);
const appuserRef = (em: EntityManager, appuserKey: number) => em.getReference(Appuser, { appuserKey } as unknown as Appuser);
const tenantRef = (em: EntityManager, tenantKey: number) => em.getReference(Tenant, { tenantKey } as unknown as Tenant);
const transactionRef = (em: EntityManager, transactionKey: number) => em.getReference(Transaction, { transactionKey } as unknown as Transaction);
const bySession = (key: number) => ({ transactionImportSessionKey: key });

/** The shared vocabulary as the entities' enums (the same strings). */
const ROW_STATUS_OF: Readonly<Record<transactionImport.ImportRowStatus, TransactionImportRowStatus>> = {
  duplicate: TransactionImportRowStatus.DUPLICATE,
  failed: TransactionImportRowStatus.FAILED,
  imported: TransactionImportRowStatus.IMPORTED,
  invalid: TransactionImportRowStatus.INVALID,
  new: TransactionImportRowStatus.NEW,
  possible_duplicate: TransactionImportRowStatus.POSSIBLE_DUPLICATE,
  skipped: TransactionImportRowStatus.SKIPPED,
};
const DECISION_OF: Readonly<Record<transactionImport.ImportDecision, TransactionImportRowDecision>> = { import: TransactionImportRowDecision.IMPORT, skip: TransactionImportRowDecision.SKIP };
const OUTCOME_OF: Readonly<Record<ReturnType<typeof transactionImport.commitOutcome>, TransactionImportSessionStatus>> = { failed: TransactionImportSessionStatus.FAILED, partial: TransactionImportSessionStatus.PARTIAL, succeeded: TransactionImportSessionStatus.SUCCEEDED };
const decisionOf = (decision: null | transactionImport.ImportDecision) => (decision === null ? null : DECISION_OF[decision]);

const defaultStorage: TransactionImportStorage = {
  getAccountCsvBucketName: () => s3Service.getAccountCsvBucketName(),
  getObjectBuffer: (bucket, key) => s3Service.getObjectBuffer(bucket, key),
  getObjectSize: (bucket, key) => s3Service.getObjectSize(bucket, key),
  presignAccountUpload: (accountKey) => s3Service.generatePresignedUrlForAccountCsv(accountKey, 'import'),
};

export class TransactionImportService {
  private get adapters(): Partial<Record<transactionImport.ImportFormat, transactionImport.ImportAdapter<never>>> {
    return this.deps.adapters ?? { camt053: transactionImport.camt053ImportAdapter, 'generic-csv': transactionImport.genericCsvImportAdapter, ofx: transactionImport.ofxImportAdapter, qif: transactionImport.qifImportAdapter, statement: statementImportAdapter, ynab: transactionImport.ynabImportAdapter };
  }

  private get now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private get storage(): TransactionImportStorage {
    return this.deps.storage ?? defaultStorage;
  }

  constructor(private readonly em: EntityManager, private readonly deps: TransactionImportDeps = {}) {}

  // --- the person's side ---

  async create(scope: TransactionImportScope, input: TransactionImportCreateInput): Promise<TransactionImportSessionView> {
    if (!this.adapters[input.format]) throw new BadRequestError('Unsupported import format');
    const account = await this.writableAccount(scope, input.accountId);
    let upload: null | { key: string; url: string } = null;
    let key = input.key;
    if (key !== undefined) {
      if (!validateCsvObjectKey({ key, maxLength: 170, prefix: `account-${account.accountKey}-` })) throw new BadRequestError('Invalid file key');
    } else {
      const presigned = await this.storage.presignAccountUpload(account.accountKey);
      key = presigned.key;
      upload = { key, url: presigned.presignedUrl };
    }
    const institution = account.accountFinancialInstitutionKey?.name;
    const format = resolveAccountCsvImportFormat(institution);
    const session = this.em.create(TransactionImportSession, {
      accountKey: account,
      appuserKey: appuserRef(this.em, scope.appuserKey),
      autoCommit: input.autoCommit ?? false,
      expiresAt: new Date(this.now.getTime() + SESSION_TTL_MS),
      fileName: importFileName(input.fileName),
      format: input.format,
      options: { ...(input.format === 'statement' && format.format === 'bank' ? { bankName: format.bankName } : {}), ...input.options },
      publicId: randomUUID(),
      s3Bucket: this.storage.getAccountCsvBucketName(),
      s3Key: key,
      status: input.key === undefined ? SESSION_STATUS.WAITING_FOR_UPLOAD : SESSION_STATUS.PARSING,
      tenantKey: tenantRef(this.em, scope.tenantKey),
    }, { partial: true });
    await this.em.flush();
    if (session.status === SESSION_STATUS.PARSING) await this.startJob(session, 'parse');
    return { ...(await this.sessionView(session)), upload };
  }

  async get(scope: TransactionImportScope, id: string, query: TransactionImportRowQuery): Promise<TransactionImportView> {
    const session = await this.find(scope, id);
    const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const page = Math.max(query.page ?? 1, 1);
    const where = { transactionImportSessionKey: bySession(session.transactionImportSessionKey), ...(query.status ? { status: ROW_STATUS_OF[query.status] } : {}) };
    // A matched transaction the person hid is still the one the row repeats: show it.
    const [rows, total] = await this.em.findAndCount(TransactionImportRow, where, { filters: { [HIDDEN_FILTER]: false }, limit: pageSize, offset: (page - 1) * pageSize, orderBy: { sourceRow: 'asc' }, populate: ['matchedTransactionKey'] });
    return { rows: { items: rows.map((row) => rowView(row)), page, pageSize, total }, session: await this.sessionView(session) };
  }

  /** Include or skip rows: the ones listed, or every row of a status. Rows that cannot import are left alone. */
  async decide(scope: TransactionImportScope, id: string, input: { decision: transactionImport.ImportDecision; rowIds?: number[]; status?: transactionImport.ImportRowStatus }): Promise<TransactionImportSessionView> {
    const session = await this.find(scope, id);
    this.assertReviewable(session);
    if ((input.rowIds === undefined) === (input.status === undefined)) throw new BadRequestError('Choose rows by id or by status');
    const statuses = WRITABLE_ROW_STATUSES.filter((status) => input.status === undefined || status === ROW_STATUS_OF[input.status]);
    await this.em.nativeUpdate(
      TransactionImportRow,
      { status: { $in: statuses }, transactionImportSessionKey: bySession(session.transactionImportSessionKey), ...(input.rowIds ? { transactionImportRowKey: { $in: input.rowIds } } : {}) },
      { decision: DECISION_OF[input.decision], updatedAt: this.now },
    );
    return this.sessionView(session);
  }

  /**
   * Choose the account each of the file's accounts imports into; duplicates are then checked on it.
   * `create` lists accounts of the file to import into a new manual account each, named after
   * it, in the currency of the account the import was started on, opening at the balance the file
   * ends on for it.
   */
  async setAccountMapping(scope: TransactionImportScope, id: string, mapping: Record<string, number>, options: { create?: string[] } = {}): Promise<TransactionImportSessionView> {
    const session = await this.find(scope, id);
    this.assertReviewable(session);
    const labels = new Set((session.sourceAccounts ?? []).map((source) => source.label));
    const create = [...new Set(options.create ?? [])];
    const unknown = [...Object.keys(mapping), ...create].filter((label) => !labels.has(label));
    if (unknown.length > 0) throw new BadRequestError('The file has no such account');
    if (create.some((label) => mapping[label] !== undefined)) throw new BadRequestError('Choose an account or a new one, not both');
    for (const accountId of new Set(Object.values(mapping))) await this.writableAccount(scope, accountId);
    const created = create.length > 0 ? await this.createManualAccounts(scope, session, create) : {};
    session.accountMapping = { ...(session.accountMapping ?? {}), ...mapping, ...created };
    const rows = await this.em.find(TransactionImportRow, { status: { $in: WRITABLE_ROW_STATUSES }, transactionImportSessionKey: bySession(session.transactionImportSessionKey) }, { orderBy: { sourceRow: 'asc' } });
    for (const row of rows) {
      const label = row.normalized?.sourceAccountLabel;
      if (label !== undefined && session.accountMapping[label] !== undefined) row.targetAccountKey = accountRef(this.em, session.accountMapping[label]);
    }
    await this.classifyStored(scope, session, rows);
    session.status = transactionImport.isMappingComplete(session.sourceAccounts ?? [], session.accountMapping) ? SESSION_STATUS.READY : SESSION_STATUS.NEEDS_MAPPING;
    await this.em.flush();
    return this.sessionView(session);
  }

  /**
   * Choose the category each of the file's categories imports as, or null to leave its rows
   * uncategorised. A category the mapping does not name keeps its suggestion.
   */
  async setCategoryMapping(scope: TransactionImportScope, id: string, mapping: Record<string, null | number>): Promise<TransactionImportSessionView> {
    const session = await this.find(scope, id);
    this.assertReviewable(session);
    const labels = new Set((session.sourceCategories ?? []).map((source) => source.label));
    if (Object.keys(mapping).some((label) => !labels.has(label))) throw new BadRequestError('The file has no such category');
    for (const categoryKey of new Set(Object.values(mapping))) {
      if (categoryKey !== null && !(await findAssignableCategory(this.em, scope.tenantKey, categoryKey))) throw new NotFoundError('Category not found');
    }
    session.categoryMapping = { ...(session.categoryMapping ?? {}), ...mapping };
    await this.em.flush();
    return this.sessionView(session);
  }

  /** Read (or read again, with corrected options) the uploaded file. */
  async parse(scope: TransactionImportScope, id: string, input: { options?: TransactionImportOptions }): Promise<TransactionImportSessionView> {
    const session = await this.find(scope, id);
    const view = await this.sessionView(session);
    const restartable = view.status === 'parsing' && view.canRetry;
    if (!restartable && !['failed', 'needs_mapping', 'ready', 'waiting_for_upload'].includes(view.status)) throw new ConflictError('This import cannot be read again now');
    if (view.status === 'waiting_for_upload' && (await this.storage.getObjectSize(session.s3Bucket, session.s3Key).catch(() => undefined)) === undefined) throw new ConflictError('The file has not been uploaded');
    if (input.options) session.options = { ...(session.options ?? {}), ...input.options };
    session.status = SESSION_STATUS.PARSING;
    session.errorCode = undefined;
    await this.em.flush();
    await this.startJob(session, 'parse');
    return this.sessionView(session);
  }

  /** Write the rows decided `import` (in the worker). Asked again after its job stopped, it resumes. */
  async commit(scope: TransactionImportScope, id: string): Promise<TransactionImportSessionView> {
    const session = await this.find(scope, id);
    const view = await this.sessionView(session);
    if (view.status === 'importing' && view.canRetry) {
      await this.startJob(session, 'commit');
      return this.sessionView(session);
    }
    if (view.status === 'needs_mapping') throw new ConflictError('Choose an account for each account in the file first');
    if (!view.canCommit) throw new ConflictError('This import cannot be committed now');
    session.status = SESSION_STATUS.IMPORTING;
    await this.em.flush();
    await this.startJob(session, 'commit');
    return this.sessionView(session);
  }

  /** Close a session that is waiting for the person; its rows are deleted. */
  async cancel(scope: TransactionImportScope, id: string): Promise<TransactionImportSessionView> {
    const session = await this.find(scope, id);
    if (session.status === SESSION_STATUS.CANCELLED) return this.sessionView(session);
    const view = await this.sessionView(session);
    if (!['expired', 'failed', 'needs_mapping', 'ready', 'waiting_for_upload'].includes(view.status) && !(view.status === 'parsing' && view.canRetry)) throw new ConflictError('This import cannot be cancelled now');
    session.status = SESSION_STATUS.CANCELLED;
    await this.em.nativeDelete(TransactionImportRow, { transactionImportSessionKey: bySession(session.transactionImportSessionKey) });
    await this.em.flush();
    return this.sessionView(session);
  }

  // --- the worker's side ---

  /**
   * The job: parse a file, or commit a session (a one-step session commits as soon as it is
   * parsed). Returns false when the operation was not this job's to run. A file that cannot be
   * read ends the session as `failed`. Any other error is rethrown, leaving the operation
   * running: pg-boss hands the job back (same id) and it resumes where it stopped.
   */
  async run(correlationId: string, queueJobId: string, mode: TransactionImportJobMode): Promise<boolean> {
    const session = await this.em.findOne(TransactionImportSession, { correlationId }, { filters: false, refresh: true });
    if (!session) return false;
    if (!(await backgroundOperationService.claimJobStartOrResume(correlationId, queueJobId))) return false;
    try {
      if (mode === 'parse' && session.status === SESSION_STATUS.PARSING) await this.parseFile(session);
      const committing = session.status === SESSION_STATUS.IMPORTING || (mode === 'parse' && session.autoCommit && session.status === SESSION_STATUS.READY);
      if (!committing) {
        await backgroundOperationService.finishJob(correlationId, queueJobId, {
          errorCode: session.status === SESSION_STATUS.FAILED ? `${TRANSACTION_IMPORT_OPERATION}:${session.errorCode ?? 'failed'}` : undefined,
          stage: `${TRANSACTION_IMPORT_OPERATION}:${session.status}`,
          status: session.status === SESSION_STATUS.FAILED ? BackgroundOperationStatus.FAILED : BackgroundOperationStatus.SUCCEEDED,
        });
        return session.status !== SESSION_STATUS.FAILED;
      }
      if (session.status !== SESSION_STATUS.IMPORTING) {
        session.status = SESSION_STATUS.IMPORTING;
        await this.em.flush();
      }
      const totals = await this.commitRows(session, correlationId, queueJobId);
      if (!totals) return false;
      await backgroundOperationService.heartbeatJob(correlationId, queueJobId, { progress: { ...totals }, stage: `${TRANSACTION_IMPORT_OPERATION}:${session.status}` });
      await backgroundOperationService.finishJob(correlationId, queueJobId, { stage: `${TRANSACTION_IMPORT_OPERATION}:${session.status}`, status: operationStatusOf(session, totals) });
      return true;
    } catch (error) {
      logger.error({ correlationId, error, mode }, 'Transaction import job failed');
      Sentry.captureException(error, { tags: { job: TRANSACTION_IMPORT_OPERATION } });
      throw error;
    }
  }

  // --- parse ---

  private async parseFile(session: TransactionImportSession): Promise<void> {
    const account = await this.em.findOneOrFail(Account, { accountKey: keyOf(session.accountKey, 'accountKey')! }, { filters: false, populate: ['currencyKey'] });
    let result: transactionImport.ImportParseResult;
    try {
      const buffer = await getLimitedCsvObjectBuffer({ bucket: session.s3Bucket, key: session.s3Key }, { getObjectBuffer: (bucket, key) => this.storage.getObjectBuffer(bucket, key), getObjectSize: (bucket, key) => this.storage.getObjectSize(bucket, key) });
      // The file decides too: an OFX/QFX upload read as a statement is still OFX, a CAMT.053
      // export is still CAMT.053, and the older WonderMoney CSV template (whose columns no bank
      // export has) is read by its own adapter.
      const bytes = new Uint8Array(buffer);
      if (session.format === 'statement' && transactionImport.isOfxFile(bytes)) session.format = 'ofx';
      else if (session.format === 'statement' && transactionImport.isGenericCsvTemplate(bytes)) session.format = 'generic-csv';
      else if (session.format === 'statement' && transactionImport.isQifFile(bytes)) session.format = 'qif';
      else if (session.format === 'statement' && transactionImport.isCamt053File(bytes)) session.format = 'camt053';
      else if (session.format === 'statement' && transactionImport.isYnabFile(bytes)) session.format = 'ynab';
      // A `.xml` upload can be either XML format; the content decides.
      else if (session.format === 'camt053' && transactionImport.isOfxFile(bytes)) session.format = 'ofx';
      const adapter = this.adapters[session.format];
      if (!adapter) throw new StatementUnreadableError('unreadable');
      const options = { accountCurrency: account.currencyKey.code, ...(session.format === 'generic-csv' ? await this.genericCsvOptions() : {}), ...(session.options ?? {}) };
      result = await (adapter as transactionImport.ImportAdapter<typeof options>).parse(bytes, options);
    } catch (error) {
      session.status = SESSION_STATUS.FAILED;
      session.errorCode = error instanceof StatementUnreadableError || error instanceof transactionImport.QifUnreadableError || error instanceof transactionImport.Camt053UnreadableError || error instanceof transactionImport.YnabUnreadableError ? error.code : 'unreadable';
      await this.em.flush();
      return;
    }

    // Read again from the start: whatever an earlier read stored goes.
    await this.em.nativeDelete(TransactionImportRow, { transactionImportSessionKey: bySession(session.transactionImportSessionKey) });
    await this.suggestSourceAccounts(keyOf(session.appuserKey, 'appuserKey'), keyOf(session.tenantKey, 'tenantKey'), result.sourceAccounts);
    const sourceCategories = result.sourceCategories ?? [];
    await this.suggestSourceCategories(keyOf(session.tenantKey, 'tenantKey'), sourceCategories);
    const mapping = Object.fromEntries(Object.entries(session.accountMapping ?? {}).filter(([label]) => result.sourceAccounts.some((source) => source.label === label)));
    // The one-step import has no mapping step: a file that names only one account (a YNAB export
    // of one account) goes to the account it was started on, as a file that names none does.
    const [onlySource, ...others] = result.sourceAccounts;
    if (session.autoCommit && onlySource && others.length === 0) mapping[onlySource.label] ??= account.accountKey;
    const targetOf = (row: transactionImport.ParsedImportRow): null | number => {
      if (result.sourceAccounts.length === 0) return account.accountKey;
      const label = row.normalized?.sourceAccountLabel;
      return label === undefined ? null : (mapping[label] ?? null);
    };
    // A session always has both; were one missing, the likely-duplicate lookup would find nothing.
    const scope = { appuserKey: keyOf(session.appuserKey, 'appuserKey') ?? 0, tenantKey: keyOf(session.tenantKey, 'tenantKey') ?? 0 };
    const classified = await this.classify(scope, result.rows.map((row) => ({ normalized: row.error === undefined ? row.normalized : undefined, sourceRow: row.sourceRow, target: targetOf(row) })));
    const now = this.now;
    for (let start = 0; start < result.rows.length; start += ROW_BATCH_SIZE) {
      const batch = result.rows.slice(start, start + ROW_BATCH_SIZE).map((row) => {
        const outcome = classified.get(row.sourceRow)!;
        return {
          createdAt: now,
          decision: decisionOf(defaultDecision(session, outcome.status, outcome.matched !== null)),
          error: row.error?.slice(0, 500) ?? null,
          matchedTransactionKey: outcome.matched,
          normalized: row.error === undefined ? (row.normalized ?? null) : null,
          raw: row.raw,
          sourceRow: row.sourceRow,
          status: ROW_STATUS_OF[outcome.status],
          targetAccountKey: targetOf(row),
          transactionImportSessionKey: session.transactionImportSessionKey,
          updatedAt: now,
        };
      });
      if (batch.length > 0) await this.em.insertMany(TransactionImportRow, batch as unknown as RequiredEntityData<TransactionImportRow>[]);
    }
    session.accountMapping = mapping;
    session.sourceAccounts = result.sourceAccounts;
    session.sourceCategories = result.sourceCategories === undefined ? undefined : sourceCategories;
    session.categoryMapping = Object.fromEntries(Object.entries(session.categoryMapping ?? {}).filter(([label]) => sourceCategories.some((source) => source.label === label)));
    session.warnings = result.warnings;
    session.status = transactionImport.isMappingComplete(result.sourceAccounts, mapping) ? SESSION_STATUS.READY : SESSION_STATUS.NEEDS_MAPPING;
    await this.em.flush();
  }

  /**
   * The generic CSV template names its transaction types and currencies by number. The adapter is
   * pure, so the session resolves them here, once per read, and hands it the names and codes.
   */
  private async genericCsvOptions(): Promise<{ currencies: Record<string, string>; transactionTypes: Record<string, string> }> {
    const [types, currencies] = await Promise.all([
      this.em.find(TransactionType, {}, { fields: ['transactionTypeKey', 'name'] }),
      this.em.find(Currency, {}, { fields: ['currencyKey', 'code'] }),
    ]);
    return {
      currencies: Object.fromEntries(currencies.map((currency) => [String(currency.currencyKey), currency.code])),
      transactionTypes: Object.fromEntries(types.map((type) => [String(type.transactionTypeKey), type.name])),
    };
  }

  /**
   * The account the file's own identifier points at, for the mapping step. A CAMT.053 statement is
   * labelled by its IBAN, so an account of the person's whose `accountNumber` holds that IBAN is
   * suggested; a file that labels its accounts by name (YNAB, QIF) suggests the one account of
   * theirs with that name, case and accents aside. The person still confirms the mapping. The
   * adapter is pure, so the session matches the labels against its accounts here.
   */
  private async suggestSourceAccounts(appuserId: null | number, tenantId: null | number, sourceAccounts: transactionImport.ImportSourceAccount[]): Promise<void> {
    if (appuserId === null || tenantId === null || sourceAccounts.length === 0) return;
    const accounts = await this.em.find(Account, { accountOwnerAppuserKey: { appuserKey: appuserId }, deletedAt: null, tenantKey: { tenantKey: tenantId } }, { fields: ['accountKey', 'accountName', 'accountNumber'] });
    const byIban = new Map<string, number>();
    for (const account of accounts) {
      const iban = transactionImport.normalizeIban(account.accountNumber);
      if (iban !== undefined && !byIban.has(iban)) byIban.set(iban, account.accountKey);
    }
    const byName = accounts.map((account) => ({ id: account.accountKey, names: account.accountName ? [account.accountName] : [] }));
    for (const source of sourceAccounts) {
      const iban = transactionImport.normalizeIban(source.label);
      const accountKey = iban === undefined ? transactionImport.matchByName(source.label, byName) : byIban.get(iban);
      if (accountKey !== undefined) source.suggestedAccountId = accountKey;
    }
  }

  /**
   * The household category each of the file's categories names, for the category-mapping step: its
   * own name (or full label) read as a category's name, case and accents aside, when exactly one
   * category matches. A system category is matched by its stored name (`RENT_MORTGAGE` reads as
   * "rent mortgage"); the web review also matches the names the person's language shows.
   */
  private async suggestSourceCategories(tenantId: null | number, sourceCategories: transactionImport.ImportSourceCategory[]): Promise<void> {
    if (tenantId === null || sourceCategories.length === 0) return;
    const categories = await this.em.find(Category, { $or: [{ isSystemCategory: false, tenantKey: { tenantKey: tenantId } }, { isSystemCategory: true, tenantKey: null }], deletedAt: null }, { fields: ['categoryKey', 'name'], filters: false });
    const candidates = categories.map((category) => ({ id: category.categoryKey, names: [category.name] }));
    for (const source of sourceCategories) {
      const categoryKey = transactionImport.suggestCategory(source, candidates);
      if (categoryKey !== undefined) source.suggestedCategoryId = categoryKey;
    }
  }

  /** A manual account of the person's for each label, named after it, opening at the balance the file ends on for it. */
  private async createManualAccounts(scope: TransactionImportScope, session: TransactionImportSession, labels: string[]): Promise<Record<string, number>> {
    const started = await this.em.findOneOrFail(Account, { accountKey: keyOf(session.accountKey, 'accountKey')! }, { populate: ['currencyKey'] });
    const owner = await this.em.findOneOrFail(Appuser, { appuserKey: scope.appuserKey }, { populate: ['currencyKey'] });
    const rows = await this.em.find(TransactionImportRow, { normalized: { $ne: null }, transactionImportSessionKey: bySession(session.transactionImportSessionKey) }, { fields: ['normalized'] });
    const balances = new Map<string, number>();
    for (const row of rows) {
      const label = row.normalized?.sourceAccountLabel;
      const amount = row.normalized?.amount;
      if (label !== undefined && amount !== undefined && labels.includes(label)) balances.set(label, (balances.get(label) ?? 0) + amount);
    }
    const now = this.now;
    const created: Record<string, number> = {};
    for (const label of labels) {
      const balance = Math.round((balances.get(label) ?? 0) * 100) / 100;
      const account = new Account();
      account.accountName = label.slice(0, 255);
      account.accountOwnerAppuserKey = owner;
      account.balance = balance;
      account.currencyKey = started.currencyKey;
      account.holderName = getFullName(owner.firstName, owner.lastName);
      account.tenantKey = tenantRef(this.em, scope.tenantKey);
      // Its rows are not written yet: the commit back-derives them from this balance, so the
      // account opens at zero before the file's first row, as the file's own account did.
      account.openingBalance = 0;
      account.openingBalanceDate = now;
      const converted = await convertWithStatus(this.em, balance, started.currencyKey, owner.currencyKey, now, rateScope(scope.tenantKey));
      account.appuserCurrencyBalance = converted.amount;
      account.fxStatus = converted.fxStatus;
      this.em.persist(account);
      await this.em.flush();
      created[label] = account.accountKey;
    }
    return created;
  }

  /**
   * Each row's status against its target account: `invalid` when it does not read, `duplicate`
   * when its id is on the account already or earlier in the file, `possible_duplicate` when no id
   * matched but the account holds a transaction it likely repeats (with that transaction, or with
   * none when several could be it), else `new` (also while its account is not chosen yet). A
   * transaction an id matched is not a candidate for another row's likely match.
   */
  private async classify(scope: TransactionImportScope, rows: { normalized?: null | transactionImport.NormalizedImportRow; sourceRow: number; target: null | number }[]): Promise<Map<number, { matched: null | number; status: transactionImport.ImportRowStatus }>> {
    const existing = new Map<number, Map<string, number>>();
    const byAccount = new Map<number, string[]>();
    for (const row of rows) if (row.normalized && row.target !== null && row.normalized.externalId) byAccount.set(row.target, [...(byAccount.get(row.target) ?? []), row.normalized.externalId]);
    for (const [accountKey, ids] of byAccount) {
      const found = new Map<string, number>();
      for (let start = 0; start < ids.length; start += ROW_BATCH_SIZE) {
        for (const [id, key] of await findImportedTransactionIds(this.em, accountKey, ids.slice(start, start + ROW_BATCH_SIZE))) found.set(id, key);
      }
      existing.set(accountKey, found);
    }
    const seen = new Map<number, Set<string>>();
    const outcome = new Map<number, { matched: null | number; status: transactionImport.ImportRowStatus }>();
    /** Rows no id matched, by target account: they may still repeat a transaction there. */
    const unmatched = new Map<number, { normalized: transactionImport.NormalizedImportRow; sourceRow: number }[]>();
    const claimed = new Map<number, Set<number>>();
    for (const row of [...rows].sort((a, b) => a.sourceRow - b.sourceRow)) {
      const normalized = row.normalized;
      if (!normalized) {
        outcome.set(row.sourceRow, { matched: null, status: 'invalid' });
        continue;
      }
      if (row.target === null) {
        outcome.set(row.sourceRow, { matched: null, status: 'new' });
        continue;
      }
      const externalId = normalized.externalId;
      const matched = externalId ? (existing.get(row.target)?.get(externalId) ?? null) : null;
      const seenHere = seen.get(row.target) ?? new Set<string>();
      seen.set(row.target, seenHere);
      const repeated = Boolean(externalId) && seenHere.has(externalId);
      if (externalId) seenHere.add(externalId);
      if (matched !== null) claimed.set(row.target, (claimed.get(row.target) ?? new Set()).add(matched));
      outcome.set(row.sourceRow, { matched, status: matched !== null || repeated ? 'duplicate' : 'new' });
      if (matched === null && !repeated) unmatched.set(row.target, [...(unmatched.get(row.target) ?? []), { normalized, sourceRow: row.sourceRow }]);
    }
    for (const [accountKey, accountRows] of unmatched) {
      const candidates = await findLikelyDuplicateCandidates(this.em, scope, accountKey, accountRows.map(({ normalized }) => normalized));
      if (candidates.length === 0) continue;
      const currency = await this.accountCurrency(accountKey);
      const likelyRows = accountRows.map(({ normalized, sourceRow }): LikelyDuplicateRow => ({ amount: normalized.amount, currency: normalized.currency ?? currency, date: normalized.date, name: normalized.merchant ?? normalized.description, sourceRow }));
      const likely = matchLikelyDuplicates(likelyRows, candidates, { claimed: claimed.get(accountKey) });
      for (const [sourceRow, match] of likely) {
        if (match.status === 'match') outcome.set(sourceRow, { matched: match.transactionKey, status: 'possible_duplicate' });
        else if (match.status === 'ambiguous') outcome.set(sourceRow, { matched: null, status: 'possible_duplicate' });
      }
    }
    return outcome;
  }

  /** The currency code of an account. */
  private async accountCurrency(accountKey: number): Promise<string> {
    const account = await this.em.findOneOrFail(Account, { accountKey }, { filters: false, populate: ['currencyKey'] });
    return account.currencyKey.code;
  }

  /** {@link classify} for stored rows (after a mapping change), resetting decisions to the defaults. */
  private async classifyStored(scope: TransactionImportScope, session: TransactionImportSession, rows: TransactionImportRow[]): Promise<void> {
    const outcome = await this.classify(scope, rows.map((row) => ({ normalized: row.normalized, sourceRow: row.sourceRow, target: keyOf(row.targetAccountKey, 'accountKey') })));
    for (const row of rows) {
      const next = outcome.get(row.sourceRow)!;
      row.status = ROW_STATUS_OF[next.status];
      row.matchedTransactionKey = next.matched === null ? null : transactionRef(this.em, next.matched);
      row.decision = decisionOf(defaultDecision(session, next.status, next.matched !== null));
    }
  }

  // --- commit ---

  /**
   * Write every row decided `import`, chunk by chunk, then settle the accounts once. Returns null
   * when another job has taken the session over.
   */
  private async commitRows(session: TransactionImportSession, correlationId: string, queueJobId: string): Promise<CommitTotals | null> {
    const sessionKey = session.transactionImportSessionKey;
    const chunkSize = this.deps.chunkSize ?? CHUNK_SIZE;
    for (let index = 0; ; index++) {
      await this.deps.onChunk?.(index);
      const outcome = await this.writeChunk(sessionKey, correlationId, chunkSize).catch(async (error: unknown) => {
        // A row the database refuses (a constraint) fails alone: the chunk is written again row by row.
        if (!(error instanceof DriverException)) throw error;
        logger.warn({ correlationId, error }, 'Transaction import chunk refused; writing it row by row');
        return this.writeChunkRowByRow(sessionKey, correlationId, chunkSize);
      });
      if (outcome === 'taken') return null;
      if (outcome === 'done') break;
      if (!(await backgroundOperationService.heartbeatJob(correlationId, queueJobId, { stage: `${TRANSACTION_IMPORT_OPERATION}:importing` }))) return null;
    }
    const settled = await this.settle(sessionKey, correlationId);
    if (!settled) return null;
    await this.em.refresh(session);
    for (const { account, dates } of settled.accounts) {
      await followUpStatementImport(this.em.fork(), account, dates, { enqueue: this.deps.enqueue }).catch((error: unknown) => { logger.warn({ correlationId, error }, 'Transaction import follow-up failed'); });
    }
    return settled.totals;
  }

  /** One chunk in one database transaction, under a lock on the session. */
  private async writeChunk(sessionKey: number, correlationId: string, chunkSize: number): Promise<'done' | 'more' | 'taken'> {
    return this.em.fork().transactional(async (tx) => {
      const locked = await tx.findOne(TransactionImportSession, { transactionImportSessionKey: sessionKey }, { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE });
      if (locked?.status !== SESSION_STATUS.IMPORTING || locked.correlationId !== correlationId) return 'taken';
      const rows = await tx.find(TransactionImportRow, { decision: TransactionImportRowDecision.IMPORT, status: { $in: WRITABLE_ROW_STATUSES }, transactionImportSessionKey: bySession(sessionKey) }, { limit: chunkSize, orderBy: { sourceRow: 'asc' } });
      if (rows.length === 0) return 'done';
      await this.writeRows(tx, rows, await this.categoriesFor(tx, locked));
      await tx.flush();
      return 'more';
    });
  }

  private async writeChunkRowByRow(sessionKey: number, correlationId: string, chunkSize: number): Promise<'done' | 'more' | 'taken'> {
    const rows = await this.em.fork().find(TransactionImportRow, { decision: TransactionImportRowDecision.IMPORT, status: { $in: WRITABLE_ROW_STATUSES }, transactionImportSessionKey: bySession(sessionKey) }, { limit: chunkSize, orderBy: { sourceRow: 'asc' } });
    for (const { transactionImportRowKey } of rows) {
      const result = await this.em.fork().transactional(async (tx) => {
        const locked = await tx.findOne(TransactionImportSession, { transactionImportSessionKey: sessionKey }, { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE });
        if (locked?.status !== SESSION_STATUS.IMPORTING || locked.correlationId !== correlationId) return 'taken' as const;
        const row = await tx.findOne(TransactionImportRow, { status: { $in: WRITABLE_ROW_STATUSES }, transactionImportRowKey });
        if (row) await this.writeRows(tx, [row], await this.categoriesFor(tx, locked));
        return 'ok' as const;
      }).catch(async (error: unknown) => {
        if (!(error instanceof DriverException)) throw error;
        await this.em.fork().nativeUpdate(TransactionImportRow, { transactionImportRowKey }, { error: error.message.slice(0, 500), status: ROW_STATUS.FAILED, updatedAt: this.now });
        return 'ok' as const;
      });
      if (result === 'taken') return 'taken';
    }
    return rows.length === 0 ? 'done' : 'more';
  }

  /**
   * Write `rows` as transactions and flip them to `imported` (or `failed`, with the reason) in the
   * caller's transaction. A new or possible-duplicate row whose id has reached its account since
   * the review (a bank sync in between) is skipped as the duplicate it now is; one the person
   * chose to import although it repeats a stored id keeps that id as its fingerprint only. A
   * possible duplicate the person chose to import is written as a new row: no id matched it.
   */
  private async writeRows(tx: EntityManager, rows: TransactionImportRow[], categories: ReadonlyMap<string, Category> = new Map()): Promise<void> {
    const contexts = new Map<number, StatementWriteContext>();
    const byAccount = new Map<number, TransactionImportRow[]>();
    for (const row of rows) {
      const accountKey = keyOf(row.targetAccountKey, 'accountKey');
      if (accountKey === null || !row.normalized) {
        row.status = ROW_STATUS.FAILED;
        row.error = 'No account to import into';
        continue;
      }
      byAccount.set(accountKey, [...(byAccount.get(accountKey) ?? []), row]);
    }
    for (const [accountKey, accountRows] of byAccount) {
      let context = contexts.get(accountKey);
      if (!context) {
        // A fresh context per chunk: a merchant created in a chunk that rolled back does not exist.
        const account = await tx.findOneOrFail(Account, { accountKey }, { filters: false, populate: ['accountOwnerAppuserKey.currencyKey', 'currencyKey', 'tenantKey'] });
        context = await statementWriteContext(tx, account);
        contexts.set(accountKey, context);
      }
      const unmatched = (row: TransactionImportRow) => row.status === ROW_STATUS.NEW || row.status === ROW_STATUS.POSSIBLE_DUPLICATE;
      const stored = await findImportedTransactionIds(tx, accountKey, accountRows.filter(unmatched).map((row) => row.normalized!.externalId));
      for (const row of accountRows) {
        const normalized = row.normalized!;
        const arrived = unmatched(row) ? stored.get(normalized.externalId) : undefined;
        if (arrived !== undefined) {
          row.status = ROW_STATUS.SKIPPED;
          row.matchedTransactionKey = transactionRef(tx, arrived);
          continue;
        }
        try {
          const trustedId = unmatched(row) && normalized.externalIdTrusted !== false;
          const transaction = await buildStatementTransaction(tx, context, toStatementLine(normalized, row.sourceRow, context.account.currencyKey.code), { trustedId, trustedType: normalized.typeIsUserSet === true });
          tx.persist(transaction);
          const category = normalized.categoryLabel === undefined ? undefined : categories.get(normalized.categoryLabel);
          if (category) categorizeAsChosen(tx, transaction, category);
          row.importedTransactionKey = transaction;
          row.status = ROW_STATUS.IMPORTED;
          row.error = null;
        } catch (error) {
          if (error instanceof DriverException) throw error;
          row.status = ROW_STATUS.FAILED;
          row.error = (error instanceof Error ? error.message : 'import failed').slice(0, 500);
        }
      }
    }
  }

  /**
   * After the last chunk, in one transaction: each account's balance chain, rules and learned
   * categories over the rows this session wrote, the undecided-to-import rows marked `skipped`,
   * and the session's outcome. Null when another job has taken the session over.
   */
  private async settle(sessionKey: number, correlationId: string): Promise<null | { accounts: { account: Account; dates: Date[] }[]; totals: CommitTotals }> {
    return this.em.fork().transactional(async (tx) => {
      const locked = await tx.findOne(TransactionImportSession, { transactionImportSessionKey: sessionKey }, { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE });
      if (locked?.status !== SESSION_STATUS.IMPORTING || locked.correlationId !== correlationId) return null;
      const importedRows = await tx.find(TransactionImportRow, { status: ROW_STATUS.IMPORTED, transactionImportSessionKey: bySession(sessionKey) }, { fields: ['importedTransactionKey', 'normalized', 'targetAccountKey'] });
      const importedKeys = new Set(importedRows.flatMap((row) => (keyOf(row.importedTransactionKey, 'transactionKey') === null ? [] : [keyOf(row.importedTransactionKey, 'transactionKey')!])));
      const accountKeys = [...new Set(importedRows.flatMap((row) => (keyOf(row.targetAccountKey, 'accountKey') === null ? [] : [keyOf(row.targetAccountKey, 'accountKey')!])))];
      const accounts: { account: Account; dates: Date[] }[] = [];
      for (const accountKey of accountKeys) {
        const account = await tx.findOneOrFail(Account, { accountKey }, { filters: false, populate: ['accountOwnerAppuserKey.currencyKey', 'currencyKey', 'tenantKey'] });
        const all = await tx.find(Transaction, { accountKey: { accountKey }, deletedAt: null });
        const imported = all.filter((transaction) => importedKeys.has(transaction.transactionKey));
        const existing = all.filter((transaction) => !importedKeys.has(transaction.transactionKey));
        await settleStatementImport(tx, account, existing, imported);
        await this.recordFileSetTypes(tx, account, importedRows.filter((row) => keyOf(row.targetAccountKey, 'accountKey') === accountKey));
        accounts.push({ account, dates: imported.flatMap((transaction) => (transaction.transactionDate ? [transaction.transactionDate] : [])) });
      }
      await tx.nativeUpdate(TransactionImportRow, { status: { $in: WRITABLE_ROW_STATUSES }, transactionImportSessionKey: bySession(sessionKey) }, { status: ROW_STATUS.SKIPPED, updatedAt: this.now });
      const counts = await this.countRows(tx, sessionKey);
      const totals: CommitTotals = { failed: counts.statuses.failed + counts.statuses.invalid, imported: counts.statuses.imported, skipped: counts.statuses.skipped, totalRows: Object.values(counts.statuses).reduce((sum, count) => sum + count, 0) };
      locked.status = OUTCOME_OF[transactionImport.commitOutcome({ failed: counts.statuses.failed, imported: counts.statuses.imported })];
      locked.committedAt = this.now;
      await tx.flush();
      return { accounts, totals };
    });
  }

  // --- internals ---

  /**
   * The category each of the session's file categories imports as: the person's choice, else the
   * suggestion, and only while it is still one the household may assign. A label mapped to null,
   * or with neither, imports uncategorised.
   */
  private assertReviewable(session: TransactionImportSession): void {
    if (this.isExpired(session) || (session.status !== SESSION_STATUS.READY && session.status !== SESSION_STATUS.NEEDS_MAPPING)) throw new ConflictError('This import is not waiting for review');
  }

  private async categoriesFor(tx: EntityManager, session: TransactionImportSession): Promise<Map<string, Category>> {
    const chosen = new Map<string, number>();
    for (const source of session.sourceCategories ?? []) {
      const mapped = session.categoryMapping?.[source.label];
      const categoryKey = mapped === undefined ? source.suggestedCategoryId : mapped;
      if (categoryKey !== undefined && categoryKey !== null) chosen.set(source.label, categoryKey);
    }
    if (chosen.size === 0) return new Map();
    const tenantKey = keyOf(session.tenantKey, 'tenantKey');
    const found = await tx.find(Category, { $or: [{ isSystemCategory: false, tenantKey: { tenantKey: tenantKey ?? 0 } }, { isSystemCategory: true, tenantKey: null }], categoryKey: { $in: [...new Set(chosen.values())] }, deletedAt: null }, { filters: false });
    const byKey = new Map(found.map((category) => [category.categoryKey, category]));
    const result = new Map<string, Category>();
    for (const [label, categoryKey] of chosen) {
      const category = byKey.get(categoryKey);
      if (category) result.set(label, category);
    }
    return result;
  }

  /**
   * A row the file typed itself (the generic CSV template's `transactionTypeKey`) keeps that type
   * through later transfer matching, as a type the person chose: the matcher reads a USER audit
   * entry that changed `transactionTypeKey` and never re-types such a row. A statement's type is a
   * guess from the description, so it is not recorded and the matcher may still pair it.
   */
  private async recordFileSetTypes(tx: EntityManager, account: Account, rows: Pick<TransactionImportRow, 'importedTransactionKey' | 'normalized'>[]): Promise<void> {
    const ownerKey = keyOf(account.accountOwnerAppuserKey, 'appuserKey');
    const tenantKey = keyOf(account.tenantKey, 'tenantKey');
    if (ownerKey === null || tenantKey === null) return;
    for (const row of rows) {
      const typeName = row.normalized?.typeIsUserSet === true ? row.normalized.typeHint : undefined;
      const transactionKey = keyOf(row.importedTransactionKey, 'transactionKey');
      if (!typeName || transactionKey === null) continue;
      await TransactionAuditService.log(tx, {
        accountKey: account.accountKey,
        actorAppuserKey: ownerKey,
        actorType: TransactionAuditActorType.USER,
        appuserKey: ownerKey,
        changes: { transactionTypeKey: { from: null, to: typeName } },
        eventType: TransactionAuditEventType.CREATED,
        source: 'transaction-import',
        tenantKey,
        transactionKey,
      }, { flush: false });
    }
  }

  /** Rows by status and, among those not committed yet, by decision. Scoped by the session's key alone: only an owner-checked session reaches it. */
  private async countRows(em: EntityManager, sessionKey: number): Promise<{ decisions: Record<transactionImport.ImportDecision, number>; statuses: transactionImport.ImportRowCounts }> {
    const grouped = await em.getConnection().execute<{ count: number | string; decision: null | string; status: transactionImport.ImportRowStatus }[]>(
      'select status, decision, count(*) as count from transaction_import_row where transaction_import_session_key = ? group by status, decision',
      [sessionKey],
      'all',
      em.getTransactionContext(),
    );
    const statuses = transactionImport.countRows([]);
    const decisions: Record<transactionImport.ImportDecision, number> = { import: 0, skip: 0 };
    for (const row of grouped) {
      const count = Number(row.count);
      statuses[row.status] += count;
      if (WRITABLE_ROW_STATUSES.includes(ROW_STATUS_OF[row.status]) && (row.decision === 'import' || row.decision === 'skip')) decisions[row.decision] += count;
    }
    return { decisions, statuses };
  }

  /** The person's session with this public id, in this household; anything else is not found. */
  private async find(scope: TransactionImportScope, id: string): Promise<TransactionImportSession> {
    const session = /^[0-9a-f-]{36}$/i.test(id) ? await this.em.findOne(TransactionImportSession, { appuserKey: { appuserKey: scope.appuserKey }, deletedAt: null, publicId: id, tenantKey: { tenantKey: scope.tenantKey } }, { refresh: true }) : null;
    if (!session) throw new NotFoundError('Import not found');
    return session;
  }

  private isExpired(session: TransactionImportSession): boolean {
    return OPEN_SESSION_STATUSES.includes(session.status) && session.expiresAt.getTime() <= this.now.getTime();
  }

  /** Whether the job last started for the session may still be working on it. */
  private async jobIsLive(session: TransactionImportSession): Promise<boolean> {
    if (!session.correlationId) return false;
    const operation = await this.em.findOne(BackgroundOperation, { correlationId: session.correlationId, deletedAt: null }, { filters: false, refresh: true });
    if (!operation) return false;
    const now = this.now.getTime();
    if (operation.status === BackgroundOperationStatus.RUNNING) return now - (operation.lastHeartbeatAt ?? operation.startedAt ?? operation.createdAt).getTime() < RUNNING_JOB_SILENCE_MS;
    if (operation.status === BackgroundOperationStatus.QUEUED) return now - (operation.queuedAt ?? operation.createdAt).getTime() < QUEUED_JOB_SILENCE_MS;
    return false;
  }

  private async sessionView(session: TransactionImportSession): Promise<TransactionImportSessionView> {
    const status: transactionImport.ImportSessionStatus = this.isExpired(session) ? 'expired' : session.status;
    // A cleared session's rows are gone: its counts are the summary the sweep kept.
    const { decisions, statuses } = session.detailsDeletedAt
      ? { decisions: { import: 0, skip: 0 }, statuses: { ...transactionImport.countRows([]), ...session.rowCounts } }
      : await this.countRows(this.em, session.transactionImportSessionKey);
    const working = status === 'parsing' || status === 'importing';
    const canRetry = working && !(await this.jobIsLive(session));
    const mappingComplete = transactionImport.isMappingComplete(session.sourceAccounts ?? [], session.accountMapping ?? {});
    return {
      accountId: keyOf(session.accountKey, 'accountKey'),
      accountMapping: session.accountMapping ?? {},
      canCommit: status === 'ready' && mappingComplete,
      canRetry,
      categoryMapping: session.categoryMapping ?? {},
      committedAt: session.committedAt?.toISOString() ?? null,
      correlationId: session.correlationId ?? null,
      counts: statuses,
      createdAt: session.createdAt.toISOString(),
      decisions,
      detailsDeletedAt: session.detailsDeletedAt?.toISOString() ?? null,
      errorCode: session.errorCode ?? null,
      expiresAt: session.expiresAt.toISOString(),
      fileName: session.fileName ?? null,
      format: session.format,
      id: session.publicId,
      sourceAccounts: session.sourceAccounts ?? [],
      sourceCategories: session.sourceCategories ?? [],
      status,
      upload: null,
      warnings: session.warnings ?? [],
    };
  }

  /** Queue a parse or commit job for the session under a new operation, which becomes the session's. */
  private async startJob(session: TransactionImportSession, mode: TransactionImportJobMode): Promise<void> {
    const correlationId = `${TRANSACTION_IMPORT_OPERATION}:${mode}:${session.publicId}:${randomUUID()}`;
    await backgroundOperationService.createQueuedOperation(
      { appuserKey: keyOf(session.appuserKey, 'appuserKey'), correlationId, operationType: TRANSACTION_IMPORT_OPERATION, resourceId: `transaction-import-session:${session.publicId}`, retryable: false, tenantKey: keyOf(session.tenantKey, 'tenantKey') },
      this.em,
    );
    session.correlationId = correlationId;
    await this.em.flush();
    try {
      if (!this.deps.enqueue) throw new Error('No queue to send the import job to');
      const jobId = await enqueueTransactionImportJob({ correlationId, mode }, { enqueue: this.deps.enqueue });
      if (!jobId) throw new Error('The import queue returned no job id');
      await backgroundOperationService.attachQueueJob(correlationId, String(jobId));
    } catch (error) {
      await backgroundOperationService.markFailed(correlationId, `${TRANSACTION_IMPORT_OPERATION}:enqueue-failed`);
      throw error;
    }
  }

  /** An account the person owns in this household, open for imports. */
  private async writableAccount(scope: TransactionImportScope, accountId: number): Promise<Account> {
    const account = await this.em.findOne(Account, { accountKey: accountId, accountOwnerAppuserKey: { appuserKey: scope.appuserKey }, deletedAt: null, tenantKey: { tenantKey: scope.tenantKey } }, { populate: ['accountFinancialInstitutionKey', 'currencyKey'] });
    if (!account) throw new NotFoundError('Account not found');
    return account;
  }
}

/** How the commit reads on its operation: the session's outcome, or for a one-step import the outcome it always reported. */
function operationStatusOf(session: TransactionImportSession, totals: CommitTotals): BackgroundOperationStatus {
  if (session.autoCommit && totals.failed > 0) return totals.imported > 0 || totals.skipped > 0 ? BackgroundOperationStatus.PARTIAL : BackgroundOperationStatus.FAILED;
  switch (session.status) {
    case SESSION_STATUS.FAILED:
      return BackgroundOperationStatus.FAILED;
    case SESSION_STATUS.PARTIAL:
      return BackgroundOperationStatus.PARTIAL;
    default:
      return BackgroundOperationStatus.SUCCEEDED;
  }
}

/** The reasons that come from the likely-duplicate match alone: rows that would otherwise be `new`. */
const LIKELY_MATCH_REASONS: ReadonlySet<transactionImport.ImportMatchReason> = new Set<transactionImport.ImportMatchReason>(['ambiguous', 'likely']);

/**
 * What a row imports as unless the person says otherwise. A one-step import commits without a
 * review, so a row flagged only by the likely-duplicate match, which no one has looked at and
 * which would otherwise be new, imports there, as it did before that match existed. Every other
 * duplicate (its id on the account, or a repeat of an earlier row of the file) keeps its default
 * and is skipped.
 */
function defaultDecision(session: TransactionImportSession, status: transactionImport.ImportRowStatus, matched: boolean): null | transactionImport.ImportDecision {
  const reason = transactionImport.matchReason(status, matched);
  return session.autoCommit && reason !== null && LIKELY_MATCH_REASONS.has(reason) ? 'import' : transactionImport.defaultDecision(status);
}

function rowView(row: TransactionImportRow): TransactionImportRowView {
  const matched = row.matchedTransactionKey;
  const loaded = typeof matched?.transactionDate !== 'undefined' ? matched : null;
  const normalized = row.normalized;
  return {
    decision: (row.decision ?? null),
    error: row.error ?? null,
    id: row.transactionImportRowKey,
    matchedTransaction: matched ? { amount: loaded?.settlementAmount ?? null, date: loaded?.transactionDate?.toISOString() ?? null, description: loaded?.description ?? loaded?.descriptionDirty ?? null, id: matched.transactionKey } : null,
    matchReason: transactionImport.matchReason(row.status, matched !== null && matched !== undefined),
    normalized: normalized ? { amount: normalized.amount, categoryLabel: normalized.categoryLabel, currency: normalized.currency, date: normalized.date, description: normalized.description, merchant: normalized.merchant, sourceAccountLabel: normalized.sourceAccountLabel, transferAccountLabel: normalized.transferAccountLabel } : null,
    raw: row.raw,
    sourceRow: row.sourceRow,
    status: row.status,
    targetAccountId: keyOf(row.targetAccountKey, 'accountKey'),
  };
}

/**
 * A row the file put in a category the person mapped: the category is theirs, as if they had set
 * it (high confidence, so neither learned categorization nor enrichment replaces it; a household
 * rule still may, as for any new row).
 */
function categorizeAsChosen(tx: EntityManager, transaction: Transaction, category: Category): void {
  if (!transaction.appuserKey) return;
  const assignment = new AppuserTransactionCategory();
  assignment.appuserKey = transaction.appuserKey;
  assignment.categoryKey = category;
  assignment.source = CategorySource.USER;
  assignment.transactionKey = transaction;
  tx.persist(assignment);
  markUserCategorized(transaction);
}
