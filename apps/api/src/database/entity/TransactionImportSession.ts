import { Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Filter, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import type { transactionImport } from '@wondermoney/shared';

import { ownerScopedCond, TENANT_FILTER } from '../filters/tenant-filter';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';
import { TransactionImportRow } from './TransactionImportRow';

export enum TransactionImportSessionStatus {
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  FAILED = 'failed',
  IMPORTING = 'importing',
  NEEDS_MAPPING = 'needs_mapping',
  PARSING = 'parsing',
  PARTIAL = 'partial',
  READY = 'ready',
  SUCCEEDED = 'succeeded',
  WAITING_FOR_UPLOAD = 'waiting_for_upload',
}

/**
 * One staged import of a transaction file (`services/transaction-import/`): the uploaded file, how
 * to read it, which WonderMoney account each of its source accounts goes to, and its rows
 * (`TransactionImportRow`). Nothing reaches `transaction` until it is committed. Seven days after a
 * commit the daily sweep deletes its rows and file and keeps only a summary: the file's name, the
 * status, the dates and the row counts (`rowCounts`, `detailsDeletedAt`).
 *
 * Owner-scoped: only the member who started it sees it, not their partner (the filter, and an
 * explicit `appuserKey` in every query the service builds). Its rows carry no tenant of their own
 * and are only ever read through their session.
 */
@Entity({ tableName: 'transaction_import_session' })
@Filter({ args: false, cond: ownerScopedCond, default: true, name: TENANT_FILTER })
@Index({ name: 'transaction_import_session_owner_created_idx', properties: ['tenantKey', 'appuserKey', 'createdAt'] })
@Index({ name: 'transaction_import_session_status_expires_idx', properties: ['status', 'expiresAt'] })
@Index({ name: 'transaction_import_session_correlation_id_idx', properties: ['correlationId'] })
@Unique({ name: 'transaction_import_session_public_id_unique', properties: ['publicId'] })
export class TransactionImportSession extends Base {
  /** Source account label → `accountKey`, for files holding several accounts. */
  @Property({ columnType: 'jsonb', nullable: true, type: 'json' })
  accountMapping?: Record<string, number>;

  /** The account the import was started on; every row goes there unless the file names its accounts. */
  @ManyToOne({ cascade: [], entity: () => Account, fieldName: 'account_key', nullable: true })
  accountKey?: Rel<Account>;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  /** Commit as soon as the file is read, with the default decisions (the one-step import). */
  @Property({ default: false })
  autoCommit = false;

  /** When the commit finished (the outcome was set). Unset on sessions committed before it was recorded. */
  @Property({ columnType: 'timestamptz', nullable: true })
  committedAt?: Date;

  /** The background operation of the job working on the session now, or last. */
  @Property({ length: 255, nullable: true })
  correlationId?: string;

  /** When the sweep deleted the committed session's rows and file; only the summary is left. */
  @Property({ columnType: 'timestamptz', nullable: true })
  detailsDeletedAt?: Date;

  /** Why parsing or the commit stopped, as a short code. */
  @Property({ length: 100, nullable: true })
  errorCode?: string;

  /** An uncommitted session stops being usable then. */
  @Property({ columnType: 'timestamptz' })
  expiresAt!: Date;

  /**
   * The name the file had on the person's device, cleaned and capped (`import-file-name.ts`); the
   * sweep keeps it with the summary. Unset on sessions started before it was kept, and from clients
   * that do not send it.
   */
  @Property({ length: 255, nullable: true })
  fileName?: string;

  @Property({ length: 30, type: 'string' })
  format!: transactionImport.ImportFormat;

  /** How to read the file (a statement's columns, its bank, a date order). */
  @Property({ columnType: 'jsonb', nullable: true, type: 'json' })
  options?: Record<string, unknown>;

  @Property({ length: 36 })
  publicId!: string;

  @OneToMany({ cascade: [], entity: () => TransactionImportRow, mappedBy: 'transactionImportSessionKey' })
  rows = new Collection<TransactionImportRow>(this);

  /** The rows by status, kept when the sweep deletes the rows themselves. */
  @Property({ columnType: 'jsonb', nullable: true, type: 'json' })
  rowCounts?: transactionImport.ImportRowCounts;

  @Property({ fieldName: 's3_bucket', length: 255 })
  s3Bucket!: string;

  @Property({ fieldName: 's3_key', length: 1024 })
  s3Key!: string;

  /** The file's accounts, for the mapping step; empty for a one-account file. */
  @Property({ columnType: 'jsonb', nullable: true, type: 'json' })
  sourceAccounts?: transactionImport.ImportSourceAccount[];

  @Enum(() => TransactionImportSessionStatus)
  status: TransactionImportSessionStatus = TransactionImportSessionStatus.WAITING_FOR_UPLOAD;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @PrimaryKey()
  transactionImportSessionKey!: number;

  @Property({ columnType: 'jsonb', nullable: true, type: 'json' })
  warnings?: transactionImport.ImportWarning[];
}
