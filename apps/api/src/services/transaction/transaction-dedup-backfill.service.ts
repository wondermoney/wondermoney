/**
 * Duplicate-transaction detection for the Phase 3 backfill (RAD-346).
 *
 * Before a real UNIQUE constraint can be placed on `(account_key, internal_transaction_id)
 * WHERE deleted_at IS NULL`, any pre-existing duplicate rows must be resolved — a duplicate in
 * prod makes `CREATE UNIQUE INDEX` fail. This module isolates the *detection* logic (pure, tested)
 * from the risky remediation: soft-deleting a duplicate booked row corrupts every later running
 * balance unless balance propagation is re-run, so the destructive apply belongs to a supervised
 * maintenance-window step, not an auto-deployed migration.
 */

export interface DedupRow {
  accountKey: number;
  internalTransactionId: null | string;
  transactionKey: number;
}

export interface DuplicateGroup {
  accountKey: number;
  /** All non-survivor keys, ascending — candidates for soft-delete + balance recompute. */
  duplicateKeys: number[];
  internalTransactionId: string;
  /** The row we keep: the earliest (lowest transactionKey), which owns the running balance chain. */
  survivorKey: number;
}

/**
 * Groups rows that share an `(accountKey, internalTransactionId)` identity on the same account.
 * Rows without a fingerprint are ignored (they cannot collide). Groups of one are not returned.
 */
export function groupDuplicateTransactions(rows: DedupRow[]): DuplicateGroup[] {
  const byIdentity = new Map<string, number[]>();
  for (const row of rows) {
    if (row.internalTransactionId === null) continue;
    const identity = `${row.accountKey}::${row.internalTransactionId}`;
    const keys = byIdentity.get(identity) ?? [];
    keys.push(row.transactionKey);
    byIdentity.set(identity, keys);
  }

  const groups: DuplicateGroup[] = [];
  for (const [identity, keys] of byIdentity) {
    if (keys.length < 2) continue;
    const sorted = [...keys].sort((a, b) => a - b);
    const [survivorKey, ...duplicateKeys] = sorted as [number, ...number[]];
    const separatorIndex = identity.indexOf('::');
    groups.push({
      accountKey: Number(identity.slice(0, separatorIndex)),
      duplicateKeys,
      internalTransactionId: identity.slice(separatorIndex + 2),
      survivorKey,
    });
  }
  return groups;
}
