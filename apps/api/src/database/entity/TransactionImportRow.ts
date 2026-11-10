import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import type { transactionImport } from '@wondermoney/shared';

import { Account } from './Account';
import { Base } from './BaseEntity';
import { Transaction } from './Transaction';
import { TransactionImportSession } from './TransactionImportSession';

export enum TransactionImportRowDecision {
  IMPORT = 'import',
  SKIP = 'skip',
}

export enum TransactionImportRowStatus {
  DUPLICATE = 'duplicate',
  FAILED = 'failed',
  IMPORTED = 'imported',
  INVALID = 'invalid',
  NEW = 'new',
  POSSIBLE_DUPLICATE = 'possible_duplicate',
  SKIPPED = 'skipped',
}

/**
 * One line of a staged import file: what it said, how it reads, where it goes, what matched it on
 * that account, and what the person decided. The commit flips it to `imported` in the same
 * database transaction that writes its `transaction`, so a resumed commit never writes it twice.
 * Read only through its session (`TransactionImportSession` is owner-scoped).
 */
@Entity({ tableName: 'transaction_import_row' })
@Index({ name: 'transaction_import_row_session_status_idx', properties: ['transactionImportSessionKey', 'status'] })
@Unique({ name: 'transaction_import_row_session_source_row_unique', properties: ['transactionImportSessionKey', 'sourceRow'] })
export class TransactionImportRow extends Base {
  @Enum({ items: () => TransactionImportRowDecision, nullable: true })
  decision?: null | TransactionImportRowDecision;

  /** Why the line could not be read or written. */
  @Property({ length: 500, nullable: true })
  error?: null | string;

  /** The transaction the commit wrote for this row. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Transaction, fieldName: 'imported_transaction_key', nullable: true })
  importedTransactionKey?: null | Rel<Transaction>;

  /** The transaction already on the target account that this row repeats. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Transaction, fieldName: 'matched_transaction_key', nullable: true })
  matchedTransactionKey?: null | Rel<Transaction>;

  @Property({ columnType: 'jsonb', nullable: true, type: 'json' })
  normalized?: null | transactionImport.NormalizedImportRow;

  @Property({ columnType: 'jsonb', type: 'json' })
  raw!: Record<string, unknown>;

  @Property()
  sourceRow!: number;

  @Enum(() => TransactionImportRowStatus)
  status!: TransactionImportRowStatus;

  @ManyToOne({ cascade: [], entity: () => Account, fieldName: 'target_account_key', nullable: true })
  targetAccountKey?: null | Rel<Account>;

  @PrimaryKey()
  transactionImportRowKey!: number;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => TransactionImportSession, fieldName: 'transaction_import_session_key' })
  transactionImportSessionKey!: Rel<TransactionImportSession>;
}
