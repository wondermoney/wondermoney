/**
 * The contract every transaction-file importer implements, and the vocabulary of a staged import
 * session (wondermoney/wondermoney#58).
 *
 * An import is staged: a format adapter reads the uploaded file into rows, the rows are stored
 * against a session, classified (new, duplicate, invalid) and reviewed, and only a commit writes
 * transactions. Adapters are pure: bytes and options in, rows out. They never touch storage or the
 * database, so OFX, QIF, CAMT.053, YNAB and Actual readers plug in beside the statement reader
 * without changing the session, the review or the commit.
 */

/** The file formats a session can read. Each one is an {@link ImportAdapter}. */
export const IMPORT_FORMATS = ['statement', 'ofx', 'qif', 'generic-csv', 'camt053', 'ynab'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/**
 * A row's place in the review and the commit:
 * - `new`: nothing on the target account matches it; imports by default.
 * - `duplicate`: the same transaction is already on the target account, or earlier in the file;
 *   skipped by default.
 * - `possible_duplicate`: a near match (fuzzy detection); skipped by default, the person decides.
 * - `invalid`: the file's line could not be read; never imports.
 * - `skipped`, `imported`, `failed`: what the commit did with it.
 */
export const IMPORT_ROW_STATUSES = ['new', 'duplicate', 'possible_duplicate', 'invalid', 'skipped', 'imported', 'failed'] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const IMPORT_DECISIONS = ['import', 'skip'] as const;
export type ImportDecision = (typeof IMPORT_DECISIONS)[number];

/**
 * - `waiting_for_upload`: created; the file is not uploaded yet.
 * - `parsing`: the file is being read into rows.
 * - `needs_mapping`: the file holds several source accounts and not all are mapped to an account.
 * - `ready`: rows are classified and await the person's decisions and commit.
 * - `importing`: the commit is writing transactions (resumable).
 * - `succeeded`, `partial`, `failed`: how the commit (or, for `failed`, the parse) ended.
 * - `cancelled`, `expired`: closed without a commit.
 */
export const IMPORT_SESSION_STATUSES = ['waiting_for_upload', 'parsing', 'needs_mapping', 'ready', 'importing', 'succeeded', 'partial', 'failed', 'cancelled', 'expired'] as const;
export type ImportSessionStatus = (typeof IMPORT_SESSION_STATUSES)[number];

/** One transaction as the file states it, whatever the format. */
export interface NormalizedImportRow {
  /** Signed: negative is money leaving the account. */
  amount: number;
  /**
   * The category the source app gave it (`Group: Category` for a YNAB export). A file whose
   * categories the session maps lists them in {@link ImportParseResult.sourceCategories}.
   */
  categoryLabel?: string;
  /** ISO 4217; absent means the target account's currency. */
  currency?: string;
  /** An ISO 8601 timestamp. */
  date: string;
  description: string;
  /**
   * The source's own id for the transaction (an OFX FITID, a bank parser's fingerprint, a
   * statement reference). Stable across exports of the same line, so a re-import finds it.
   */
  externalId: string;
  /**
   * Whether `externalId` is the source's own id, or a fingerprint derived from the row. A
   * fingerprint still matches a re-import, but is never stored as a provider's unique id: a
   * collision must not skip a distinct transaction. Absent means trusted (the existing formats).
   */
  externalIdTrusted?: boolean;
  merchant?: string;
  /** The amount in the currency it was charged in, when that differs (a card payment abroad). */
  originalAmount?: number;
  originalCurrency?: string;
  /** Which account in the file the row belongs to, when the file holds several. */
  sourceAccountLabel?: string;
  /**
   * The other account a transfer names (a QIF `L[Account]` category), for the review to show and
   * for a later step to match. The transfer itself is stated through {@link typeHint}.
   */
  transferAccountLabel?: string;
  /** A type the source suggests (`PAYMENT`, `CARD_PAYMENT`); the sign still decides direction. */
  typeHint?: string;
  /**
   * The file states the type itself, rather than a reader guessing it from the description: the
   * generic CSV template's `transactionTypeKey` column. The commit records it as a type the person
   * chose, so transfer matching never re-types the row.
   */
  typeIsUserSet?: boolean;
}

/** One line of the file: what it said, and how it reads (or why it does not). */
export interface ParsedImportRow {
  /** Why the line could not be read; the row is then `invalid`. */
  error?: string;
  normalized?: NormalizedImportRow;
  /** The line as the file had it, for the review. A few short fields. */
  raw: Record<string, unknown>;
  /** The line's number in the file, 1-based, as the person would find it. */
  sourceRow: number;
}

/** An account the file holds rows for, for the account-mapping step. */
export interface ImportSourceAccount {
  currency?: string;
  label: string;
  rowCount: number;
  /**
   * The account the file's own identifier points at, when the session can tell: a CAMT.053
   * statement is labelled by its IBAN, so an account whose `accountNumber` holds that IBAN is
   * suggested. The person still confirms the mapping.
   */
  suggestedAccountId?: number;
}

/**
 * A category the file uses, for the category-mapping step: the person picks a WonderMoney category
 * for it, or leaves its rows uncategorised.
 */
export interface ImportSourceCategory {
  /** The group the source app files it under (YNAB's category group), when it has one. */
  group?: string;
  /** The rows' {@link NormalizedImportRow.categoryLabel}. */
  label: string;
  /** The category's own name, without its group. */
  name: string;
  rowCount: number;
  /** A category of the household whose name matches, when the session found exactly one. */
  suggestedCategoryId?: number;
}

export interface ImportWarning {
  code: string;
  detail?: string;
  sourceRow?: number;
}

export interface ImportParseResult {
  rows: ParsedImportRow[];
  /** Empty when the file is for one account only (the one the import was started on). */
  sourceAccounts: ImportSourceAccount[];
  /** The categories to map, for a format whose categories the session maps (YNAB). Absent otherwise. */
  sourceCategories?: ImportSourceCategory[];
  warnings: ImportWarning[];
}

/** A file format reader. Pure: it reads bytes and never touches storage or the database. */
export interface ImportAdapter<Options = Record<string, unknown>> {
  format: ImportFormat;
  parse(input: Uint8Array, options: Options): Promise<ImportParseResult>;
}

/** Row counts by status, as a session summary reports them. */
export type ImportRowCounts = Record<ImportRowStatus, number>;
