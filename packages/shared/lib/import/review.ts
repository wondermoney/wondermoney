import { IMPORT_ROW_STATUSES, type ImportDecision, type ImportMatchReason, type ImportRowCounts, type ImportRowStatus, type ImportSourceAccount } from './types';

/**
 * What a staged row imports as unless the person says otherwise: a new row imports, a duplicate
 * or a near match is skipped, an unreadable row has no decision (it can never import).
 */
export function defaultDecision(status: ImportRowStatus): ImportDecision | null {
  switch (status) {
    case 'new':
      return 'import';
    case 'duplicate':
    case 'possible_duplicate':
      return 'skip';
    default:
      return null;
  }
}

/** Why a row is a duplicate or a possible one, from its status and whether a transaction is matched; null for any other row. */
export function matchReason(status: ImportRowStatus, matched: boolean): ImportMatchReason | null {
  if (status === 'duplicate') return matched ? 'same_id' : 'earlier_in_file';
  if (status === 'possible_duplicate') return matched ? 'likely' : 'ambiguous';
  return null;
}

/** Whether the person may include or skip a row: any row that reads and has not been committed. */
export function canDecide(status: ImportRowStatus): boolean {
  return status === 'new' || status === 'duplicate' || status === 'possible_duplicate';
}

/** Rows by status, every status present. */
export function countRows(statuses: Iterable<ImportRowStatus>): ImportRowCounts {
  const counts = Object.fromEntries(IMPORT_ROW_STATUSES.map((status) => [status, 0])) as ImportRowCounts;
  for (const status of statuses) counts[status] += 1;
  return counts;
}

/** The labels of the file's accounts that no account is chosen for yet. */
export function unmappedSourceAccounts(sourceAccounts: readonly ImportSourceAccount[], mapping: Readonly<Record<string, number | null | undefined>>): string[] {
  return sourceAccounts.filter((source) => mapping[source.label] == null).map((source) => source.label);
}

/** Whether every account in the file has a target. A single-account file (no source accounts) always has. */
export function isMappingComplete(sourceAccounts: readonly ImportSourceAccount[], mapping: Readonly<Record<string, number | null | undefined>>): boolean {
  return unmappedSourceAccounts(sourceAccounts, mapping).length === 0;
}

/**
 * How a finished commit reads: failed when every row it tried failed, partial when some imported
 * and some failed, succeeded otherwise (a commit with every row skipped did what was asked).
 */
export function commitOutcome(counts: { failed: number; imported: number }): 'failed' | 'partial' | 'succeeded' {
  if (counts.failed === 0) return 'succeeded';
  return counts.imported > 0 ? 'partial' : 'failed';
}
