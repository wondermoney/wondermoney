import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import type { Logger } from 'pino';

import { TransactionEnrichment, TransactionEnrichmentOutcome, TransactionEnrichmentStatus } from '@entity/TransactionEnrichment';
import logger from '@utils/logger';

interface StampTransactionEnrichmentOutcomeDeps {
  logger?: Pick<Logger, 'warn'>;
}

/**
 * Close the loop on an AI enrichment suggestion: when a user sets a transaction's
 * category — whether accepting an applied `write`-mode suggestion, correcting one, or categorizing a
 * transaction that only got a `shadow` suggestion — stamp whether it matched the model's
 * `categorySuggestionKey`. Feeds the acceptance-rate metric. Stamps at most once per enrichment row
 * (only un-stamped SHADOW/COMPLETED rows with a suggestion are matched). Best-effort: a failure here
 * must never break the caller's category edit.
 */
export async function stampTransactionEnrichmentOutcome(
  em: EntityManager,
  transactionKey: number,
  categoryKey: number,
  deps: StampTransactionEnrichmentOutcomeDeps = {},
): Promise<void> {
  const log = deps.logger ?? logger;
  try {
    const enrichment = await em.findOne(
      TransactionEnrichment,
      {
        categorySuggestionKey: { $ne: null },
        outcome: null,
        status: { $in: [TransactionEnrichmentStatus.SHADOW, TransactionEnrichmentStatus.COMPLETED] },
        transactionKey,
      } as FilterQuery<TransactionEnrichment>,
      { orderBy: { completedAt: 'desc' } },
    );
    if (!enrichment) return;

    const suggestedCategoryKey = (enrichment.categorySuggestionKey as unknown as undefined | { categoryKey?: number })?.categoryKey;
    enrichment.outcome = suggestedCategoryKey === categoryKey ? TransactionEnrichmentOutcome.ACCEPTED : TransactionEnrichmentOutcome.OVERRIDDEN;
    await em.flush();
  } catch (error) {
    log.warn(
      { errorMessage: error instanceof Error ? error.message : 'unknown', transactionKey },
      'Transaction enrichment outcome stamping failed',
    );
  }
}
