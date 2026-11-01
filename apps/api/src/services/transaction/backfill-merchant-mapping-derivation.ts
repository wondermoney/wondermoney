export interface DerivedMapping {
  appuserKey: number;
  categoryKey: number;
  transactionMerchantKey: number;
}

export interface UserCategorizationRow {
  appuserKey: number;
  categoryKey: number;
  key: number;
  transactionMerchantKey: number;
  updatedAt: Date | string;
}

/**
 * Backfill: reduce a user's categorization history to one mapping per (appuser, merchant),
 * choosing the most-recent categorization (latest `updatedAt`, ties broken by higher assignment key
 * for determinism). Callers must pass only `source='user'`, non-deleted rows with a resolved merchant.
 */
export function deriveMostRecentUserMapping(rows: UserCategorizationRow[]): DerivedMapping[] {
  const winners = new Map<string, { row: UserCategorizationRow; ts: number }>();
  for (const row of rows) {
    const pairKey = `${row.appuserKey}:${row.transactionMerchantKey}`;
    const ts = new Date(row.updatedAt).getTime();
    const current = winners.get(pairKey);
    if (!current || ts > current.ts || (ts === current.ts && row.key > current.row.key)) {
      winners.set(pairKey, { row, ts });
    }
  }
  return [...winners.values()].map(({ row }) => ({
    appuserKey: row.appuserKey,
    categoryKey: row.categoryKey,
    transactionMerchantKey: row.transactionMerchantKey,
  }));
}
