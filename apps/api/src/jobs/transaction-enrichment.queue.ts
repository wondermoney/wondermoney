import { z } from 'zod';

import type { Enqueue } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';

import { buildTransactionEnrichmentConfig } from './transaction-enrichment.config';

interface PgBossLike {
  createQueue: (queue: string, options?: PgBossQueueOptions) => Promise<unknown>;
  send: (queue: string, data: Record<string, unknown>, options?: PgBossSendOptions) => Promise<unknown>;
}

interface PgBossQueueOptions {
  deadLetter?: string;
  expireInSeconds?: number;
  policy?: 'short' | 'singleton';
  retentionSeconds?: number;
  retryBackoff?: boolean;
  retryDelay?: number;
  retryLimit?: number;
}

interface PgBossSendOptions {
  singletonKey?: string;
}

export const TRANSACTION_ENRICHMENT_GPT_QUEUE = 'transaction.enrichment.gpt';
export const TRANSACTION_ENRICHMENT_GPT_DLQ = 'transaction.enrichment.gpt.dlq';
export const TRANSACTION_ENRICHMENT_GPT_OPERATION_TYPE = 'transaction.enrichment.gpt';

export interface TransactionEnrichmentGptJobPayload {
  correlationId: string;
  idempotencyKey: string;
  modelVersion: string;
  promptVersion: string;
  transactionEnrichmentKey: number;
}

const transactionEnrichmentGptPayloadSchema = z.object({
  correlationId: z.string().min(1).max(255),
  idempotencyKey: z.string().min(1).max(255),
  modelVersion: z.string().min(1).max(255),
  promptVersion: z.string().min(1).max(255),
  transactionEnrichmentKey: z.number().int().positive(),
}).strip();

export function parseTransactionEnrichmentGptPayload(payload: unknown): TransactionEnrichmentGptJobPayload {
  return transactionEnrichmentGptPayloadSchema.parse(payload);
}

export const ensureTransactionEnrichmentGptQueue = async (boss: Pick<PgBossLike, 'createQueue'>) => {
  const config = buildTransactionEnrichmentConfig();
  await boss.createQueue(TRANSACTION_ENRICHMENT_GPT_DLQ);
  return boss.createQueue(TRANSACTION_ENRICHMENT_GPT_QUEUE, {
    deadLetter: TRANSACTION_ENRICHMENT_GPT_DLQ,
    expireInSeconds: config.expirationSeconds,
    policy: 'singleton',
    retentionSeconds: config.retentionSeconds,
    retryBackoff: true,
    retryDelay: config.retryDelaySeconds,
    retryLimit: config.retryLimit,
  });
};

export const enqueueTransactionEnrichmentGptJob = async (
  job: TransactionEnrichmentGptJobPayload,
  deps: { enqueue: Enqueue },
) => {
  return deps.enqueue.send(
    TRANSACTION_ENRICHMENT_GPT_QUEUE,
    {
      correlationId: job.correlationId,
      idempotencyKey: job.idempotencyKey,
      modelVersion: job.modelVersion,
      promptVersion: job.promptVersion,
      transactionEnrichmentKey: job.transactionEnrichmentKey,
    },
    {
      singletonKey: job.idempotencyKey,
    },
  );
};

QUEUE_REGISTRY.set(TRANSACTION_ENRICHMENT_GPT_QUEUE, { ensure: (boss) => ensureTransactionEnrichmentGptQueue(boss as unknown as Pick<PgBossLike, 'createQueue'>), name: TRANSACTION_ENRICHMENT_GPT_QUEUE });
