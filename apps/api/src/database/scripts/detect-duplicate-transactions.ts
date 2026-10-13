/**
 * RAD-346 Phase 3 — read-only duplicate-transaction report.
 *
 * Reports pre-existing `(account_key, internal_transaction_id)` duplicates among non-deleted
 * transactions, so the team can size the cleanup BEFORE attempting the partial-unique index
 * (design open question #9). Strictly read-only — it never writes. The destructive remediation
 * (soft-delete duplicates + re-run balance propagation) is a separate, supervised
 * maintenance-window step because it touches running balances.
 *
 * Usage: cross-env NODE_ENV=<env> NODE_OPTIONS='--import=tsx' node src/database/scripts/detect-duplicate-transactions.ts
 */
import { MikroORM } from '@mikro-orm/core';

import { Transaction } from '@entity/Transaction';
import logger from '@utils/logger';

import config from '../../mikro-orm.config';
import { groupDuplicateTransactions } from '../../services/transaction/transaction-dedup-backfill.service';

async function main() {
  const orm = await MikroORM.init(config);
  const em = orm.em.fork();

  try {
    const rows = await em.find(
      Transaction,
      { deletedAt: undefined },
      { fields: ['transactionKey', 'accountKey', 'internalTransactionId'] },
    );

    const dedupRows = rows.map((row) => ({
      accountKey: row.accountKey?.accountKey ?? 0,
      internalTransactionId: row.internalTransactionId ?? null,
      transactionKey: row.transactionKey,
    }));

    const groups = groupDuplicateTransactions(dedupRows);
    const duplicateRowCount = groups.reduce((sum, group) => sum + group.duplicateKeys.length, 0);
    const affectedAccounts = new Set(groups.map((group) => group.accountKey)).size;

    logger.info(
      {
        affectedAccounts,
        duplicateGroups: groups.length,
        duplicateRowsToRemove: duplicateRowCount,
        scannedTransactions: rows.length,
      },
      'RAD-346 duplicate-transaction report',
    );

    // A compact per-group breakdown (survivor kept, dupes to remediate) for the sign-off review.
    for (const group of groups) {
      logger.info(
        { accountKey: group.accountKey, duplicateKeys: group.duplicateKeys, internalTransactionId: group.internalTransactionId, survivorKey: group.survivorKey },
        'duplicate group',
      );
    }

    if (groups.length === 0) {
      logger.info('No duplicates found — the partial-unique index on (account_key, internal_transaction_id) can be applied safely.');
    } else {
      logger.warn('Duplicates present — remediate (soft-delete + balance recompute) in a maintenance window BEFORE applying the unique index.');
    }
  } finally {
    await orm.close(true);
  }
}

main().catch((error: unknown) => {
  logger.error({ error }, 'detect-duplicate-transactions failed');
  process.exitCode = 1;
});
