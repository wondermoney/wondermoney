import { describe, expect, it } from 'vitest';

import { groupDuplicateTransactions } from '../transaction-dedup-backfill.service';

describe('groupDuplicateTransactions', () => {
  it('returns no groups for an empty input', () => {
    expect(groupDuplicateTransactions([])).toEqual([]);
  });

  it('returns no groups when every (account, fingerprint) pair is unique', () => {
    const groups = groupDuplicateTransactions([
      { accountKey: 1, internalTransactionId: 'a', transactionKey: 10 },
      { accountKey: 1, internalTransactionId: 'b', transactionKey: 11 },
      { accountKey: 2, internalTransactionId: 'a', transactionKey: 12 },
    ]);
    expect(groups).toEqual([]);
  });

  it('groups duplicates within an account and keeps the earliest (lowest key) as survivor', () => {
    const groups = groupDuplicateTransactions([
      { accountKey: 1, internalTransactionId: 'dup', transactionKey: 30 },
      { accountKey: 1, internalTransactionId: 'dup', transactionKey: 12 },
      { accountKey: 1, internalTransactionId: 'dup', transactionKey: 21 },
    ]);
    expect(groups).toEqual([
      { accountKey: 1, duplicateKeys: [21, 30], internalTransactionId: 'dup', survivorKey: 12 },
    ]);
  });

  it('does not merge identical fingerprints across different accounts', () => {
    const groups = groupDuplicateTransactions([
      { accountKey: 1, internalTransactionId: 'same', transactionKey: 1 },
      { accountKey: 2, internalTransactionId: 'same', transactionKey: 2 },
    ]);
    expect(groups).toEqual([]);
  });

  it('ignores rows without a fingerprint (null internalTransactionId cannot collide)', () => {
    const groups = groupDuplicateTransactions([
      { accountKey: 1, internalTransactionId: null, transactionKey: 1 },
      { accountKey: 1, internalTransactionId: null, transactionKey: 2 },
    ]);
    expect(groups).toEqual([]);
  });
});
