import type { EntityManager, FilterQuery, FindOptions } from '@mikro-orm/postgresql';

import { TransactionEnrichment, TransactionEnrichmentOutcome } from '@entity/TransactionEnrichment';

const DEFAULT_SAMPLE_LIMIT = 200;

export interface TransactionEnrichmentAcceptanceRate {
  acceptanceRate: null | number;
  accepted: number;
  overridden: number;
  sampleSize: number;
}

/**
 * Acceptance rate over the most recently closed-loop-stamped enrichment suggestions. Samples the most recent
 * `limit` rows with a stamped `outcome` — both SHADOW (would-have-suggested) and COMPLETED
 * (applied write-mode) rows carry an outcome once a user categorizes the transaction. `null` rate
 * means no outcomes have been stamped yet, distinct from a real 0% rate.
 */
export async function computeTransactionEnrichmentAcceptanceRate(
  em: EntityManager,
  options: { limit?: number } = {},
): Promise<TransactionEnrichmentAcceptanceRate> {
  const limit = options.limit ?? DEFAULT_SAMPLE_LIMIT;

  const where: FilterQuery<TransactionEnrichment> = { outcome: { $ne: null } };
  const findOptions: FindOptions<TransactionEnrichment> = { limit, orderBy: { completedAt: 'desc' } };
  const rows = await em.find(TransactionEnrichment, where, findOptions);

  const accepted = rows.filter((row) => row.outcome === TransactionEnrichmentOutcome.ACCEPTED).length;
  const overridden = rows.filter((row) => row.outcome === TransactionEnrichmentOutcome.OVERRIDDEN).length;
  const sampleSize = rows.length;

  return {
    acceptanceRate: sampleSize === 0 ? null : accepted / sampleSize,
    accepted,
    overridden,
    sampleSize,
  };
}
