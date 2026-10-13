import * as Sentry from '@sentry/node';
import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import {
  parseTransactionEnrichmentGptPayload,
  TRANSACTION_ENRICHMENT_GPT_DLQ,
} from '@app/jobs/transaction-enrichment.queue';
import { TransactionEnrichment, TransactionEnrichmentStatus } from '@entity/TransactionEnrichment';
import logger from '@utils/logger';

/**
 * Consumer for the transaction-enrichment dead-letter queue.
 *
 * === Why a DLQ needs a consumer ===
 *
 * A dead-letter queue with no consumer is not a safety net, it is a silent drain.
 * pg-boss copies the exhausted job's payload into the DLQ and considers its work
 * done; the row then sits until `retentionSeconds` deletes it. Nothing polls it,
 * nothing alerts on it, and the only externally visible symptom is
 * `TransactionEnrichment` rows parked in a non-terminal status that no query ever
 * looks at.
 *
 * This consumer closes both halves of that: it moves the enrichment row to the
 * terminal `DLQ` status (so the pipeline's own accounting is honest), and it
 * raises a Sentry event fingerprinted on the queue so a burst of dead-lettered
 * jobs is one loud issue rather than ten thousand quiet rows.
 *
 * The handler never throws for a payload it cannot use — a job that dead-letters
 * *again* out of the DLQ would be genuinely unrecoverable noise.
 */

interface TransactionEnrichmentDlqDependencies {
  logger?: Pick<Logger, 'error' | 'info' | 'warn'>;
  now?: () => Date;
}

/** Statuses that already record a final outcome; a DLQ arrival must not overwrite them. */
const TERMINAL_STATUSES: readonly TransactionEnrichmentStatus[] = [
  TransactionEnrichmentStatus.COMPLETED,
  TransactionEnrichmentStatus.DLQ,
  TransactionEnrichmentStatus.SHADOW,
  TransactionEnrichmentStatus.SKIPPED,
];

const alert = (job: Job<unknown>, transactionEnrichmentKey: number | undefined): void => {
  try {
    Sentry.captureMessage('Transaction enrichment job dead-lettered', {
      extra: { queue: TRANSACTION_ENRICHMENT_GPT_DLQ, transactionEnrichmentKey },
      fingerprint: ['pgboss-dead-letter', TRANSACTION_ENRICHMENT_GPT_DLQ],
      level: 'error',
      tags: { jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_DLQ },
    });
  } catch {
    // Telemetry must never take the consumer down with it.
  }
};

/** pg-boss job handler: marks the enrichment row dead-lettered and raises one aggregated alert. */
export async function handleTransactionEnrichmentDlqJob(
  job: Job<unknown>,
  dependencies: TransactionEnrichmentDlqDependencies = {},
): Promise<boolean> {
  const log = dependencies.logger ?? logger;
  const now = dependencies.now ?? (() => new Date());

  let transactionEnrichmentKey: number | undefined;
  try {
    transactionEnrichmentKey = parseTransactionEnrichmentGptPayload(job.data).transactionEnrichmentKey;
  } catch {
    log.warn({ jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_DLQ }, 'Dead-lettered enrichment job payload is unreadable');
  }

  alert(job, transactionEnrichmentKey);

  if (transactionEnrichmentKey === undefined) return false;

  try {
    const enrichment = await DI.em.findOne(TransactionEnrichment, { transactionEnrichmentKey });
    if (!enrichment) {
      log.warn({ jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_DLQ, transactionEnrichmentKey }, 'Dead-lettered enrichment row not found');
      return false;
    }
    if (TERMINAL_STATUSES.includes(enrichment.status)) return true;

    enrichment.status = TransactionEnrichmentStatus.DLQ;
    enrichment.lastAttemptAt = now();
    await DI.em.flush();
    log.error({ jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_DLQ, transactionEnrichmentKey }, 'Transaction enrichment dead-lettered');
    return true;
  } catch (error) {
    // Consume rather than rethrow: a DLQ job that fails its own handler has
    // nowhere left to go, and the Sentry alert above already fired.
    log.error({ error, jobId: job.id, queue: TRANSACTION_ENRICHMENT_GPT_DLQ }, 'Failed to record dead-lettered enrichment');
    return false;
  }
}
