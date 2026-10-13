import crypto from 'node:crypto';

import type { FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import {
  buildTransactionEnrichmentConfig,
  type TransactionEnrichmentConfig,
} from '@app/jobs/transaction-enrichment.config';
import {
  enqueueTransactionEnrichmentGptJob,
} from '@app/jobs/transaction-enrichment.queue';
import { Tenant } from '@entity/Tenant';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';
import { TransactionEnrichment, TransactionEnrichmentStatus } from '@entity/TransactionEnrichment';
import type { Enqueue } from '@service/queue/enqueue';
import { getRef } from '@utils/em-helpers';
import logger from '@utils/logger';

import { isUncategorisableByDescription } from './enrichment-eligibility';
import { buildTransactionEnrichmentIdempotencyKey } from './idempotency';

/**
 * Upper bound on how many candidate transactions a single ingestion event will enqueue for
 * enrichment. Keeps volume predictable per sync/import; anything above this is picked up by the
 * next ingestion.
 */
const CANDIDATE_BATCH_LIMIT = 200;

interface EnqueueTransactionEnrichmentDeps {
  config?: TransactionEnrichmentConfig;
  em?: EntityManager;
  enqueue?: Enqueue;
  logger?: Pick<Logger, 'info' | 'warn'>;
}

type EnrichmentSource = 'account-initial-sync' | 'manual-transaction' | 'transaction-import';

/**
 * Best-effort producer for the DeepSeek transaction-enrichment pipeline (RAD-414).
 *
 * Called after transaction ingestion (bank sync / CSV import) to enqueue eligible transactions for
 * async, post-sync, non-critical enrichment. Strictly fail-open: it never throws to the caller and
 * never blocks or slows the ingestion path. Dormant by default — when the kill switch is off or the
 * mode is `off`, it returns immediately without touching the database.
 */
export async function enqueueTransactionEnrichmentForTenant(
  tenantKey: number,
  source: EnrichmentSource,
  deps: EnqueueTransactionEnrichmentDeps = {},
): Promise<void> {
  const log = deps.logger ?? logger;

  try {
    // Build config INSIDE the try so a malformed TRANSACTION_ENRICHMENT_GPT_* env var can never
    // throw out of this producer into the ingestion path — fail-open even when misconfigured.
    const config = deps.config ?? buildTransactionEnrichmentConfig();

    // Kill switch + mode gate BEFORE any work: no boss, no DB query.
    if (!config.enabled || config.mode === 'off') return;

    const em = deps.em ?? DI.em;
    const enqueue = deps.enqueue;
    if (!enqueue) throw new Error('Transaction enrichment requires an enqueue dependency when enabled');

    // Exclude transactions that already have an enrichment row. Shadow mode never changes
    // categorizationConfidence, so enriched rows stay in the NONE/LOW pool forever; without this
    // exclusion (plus a deterministic ORDER BY) a tenant with >LIMIT low-confidence txns would keep
    // re-fetching the same enriched page and the tail would never be reached (RAD-414 H2). We fetch
    // the already-enriched transaction keys as a bounded array and pass them to `$nin` — a
    // QueryBuilder object can't be embedded directly into `em.find`'s where (it stringifies to
    // '[object Object]' and produces invalid SQL).
    const enrichedRows = await em
      .createQueryBuilder(TransactionEnrichment, 'te')
      .select('transaction_key')
      .where({ tenantKey })
      .execute<{ transactionKey: number }[]>();

    // RAD-580: `execute()` maps rows to *entity property* names, so these come back as
    // `transactionKey` even though `select()` was given the column name. This read
    // `row.transaction_key` and got `undefined` for every row — which still had `length > 0`, so
    // the `$nin` below was applied as `transaction_key NOT IN (NULL, NULL, …)`. That is UNKNOWN for
    // every row in SQL, so the candidate query matched nothing and the producer returned silently.
    //
    // A tenant was fine until it acquired its first enrichment row and permanently starved after.
    // Measured on production 2026-08-22: 200 candidates without the exclusion, 0 with the broken
    // one, 200 with this fix.
    //
    // The `filter` is the durable half. If this shape ever changes again, an empty exclusion list
    // costs a redundant enqueue — idempotency-keyed, so harmless — instead of switching the feature
    // off. Fail toward doing the work, not toward silence.
    const enrichedTransactionKeys = enrichedRows
      .map((row) => row.transactionKey)
      .filter((key): key is number => typeof key === 'number');

    if (enrichedRows.length > 0 && enrichedTransactionKeys.length === 0) {
      log.warn(
        { enrichedRows: enrichedRows.length, tenantKey },
        'Transaction enrichment: every already-enriched key read as non-numeric; exclusion skipped',
      );
    }

    const selected = await em.find(
      Transaction,
      {
        categorizationConfidence: { $in: [CategorizationConfidence.NONE, CategorizationConfidence.LOW] },
        deletedAt: undefined,
        tenantKey,
        transactionMerchantKey: { $ne: null },
        ...(enrichedTransactionKeys.length > 0 ? { transactionKey: { $nin: enrichedTransactionKeys } } : {}),
      } as FilterQuery<Transaction>,
      { limit: CANDIDATE_BATCH_LIMIT, orderBy: { transactionKey: 'ASC' } },
    );
    // RAD-584: drop withdrawals and transfers before the model ever sees them.
    // A bank branch name resolves to a merchant, so `LEV ATM 3170 BPI Braga`
    // satisfies the transactionMerchantKey filter above and looks like an
    // ordinary card purchase to the query — which is how the model came to
    // categorise cash withdrawals as FUEL.
    const candidates = selected.filter((transaction) => !isUncategorisableByDescription(transaction));
    const skippedUncategorisable = selected.length - candidates.length;
    // RAD-580: say so. Both early returns above and this one used to be silent, which made a
    // pipeline that had stopped producing indistinguishable from one with nothing to do — the
    // reason nobody noticed for three days. `enqueued: 0` in the logs is the signal; its absence
    // now means the producer never ran, which is a different and equally useful fact.
    log.info(
      {
        candidates: candidates.length,
        enriched: enrichedTransactionKeys.length,
        skippedUncategorisable,
        source,
        tenantKey,
      },
      'Transaction enrichment candidates selected',
    );
    if (candidates.length === 0) return;

    for (const transaction of candidates) {
      const idempotencyKey = buildTransactionEnrichmentIdempotencyKey(
        transaction.transactionKey,
        tenantKey,
        config.promptVersion,
        config.modelVersion,
      );
      const enrichment = new TransactionEnrichment();
      enrichment.transactionKey = transaction;
      enrichment.tenantKey = getRef(em, Tenant, tenantKey);
      enrichment.idempotencyKey = idempotencyKey;
      enrichment.inputHash = '';
      enrichment.modelVersion = config.modelVersion;
      enrichment.promptVersion = config.promptVersion;
      enrichment.status = TransactionEnrichmentStatus.PENDING;
      await em.persist(enrichment).flush();

      await enqueueTransactionEnrichmentGptJob(
        {
          correlationId: crypto.randomUUID(),
          idempotencyKey,
          modelVersion: config.modelVersion,
          promptVersion: config.promptVersion,
          transactionEnrichmentKey: enrichment.transactionEnrichmentKey,
        },
        { enqueue },
      );
    }
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : 'unknown', source, tenantKey },
      'Transaction enrichment enqueue failed',
    );
  } finally { /* fail-open producer never owns the queue lifecycle */ }
}
