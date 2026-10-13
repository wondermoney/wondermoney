import { describe, expect, it, vi } from 'vitest';

import {
  enqueueTransactionEnrichmentGptJob,
  ensureTransactionEnrichmentGptQueue,
  parseTransactionEnrichmentGptPayload,
  TRANSACTION_ENRICHMENT_GPT_DLQ,
  TRANSACTION_ENRICHMENT_GPT_OPERATION_TYPE,
  TRANSACTION_ENRICHMENT_GPT_QUEUE,
} from '@app/jobs/transaction-enrichment.queue';

type EnqueueDeps = Parameters<typeof enqueueTransactionEnrichmentGptJob>[1];
type EnsureBoss = Parameters<typeof ensureTransactionEnrichmentGptQueue>[0];

vi.mock('@app/jobs/transaction-enrichment.config', () => ({
  buildTransactionEnrichmentConfig: () => ({
    enabled: false,
    expirationSeconds: 300,
    mode: 'off',
    modelVersion: 'DeepSeek-V4-Flash',
    promptVersion: 'transaction-enrichment-v1',
    retentionSeconds: 1209600,
    retryDelaySeconds: 60,
    retryLimit: 3,
  }),
}));

describe('transaction enrichment queue', () => {
  interface MockBoss {
    queued: [string, Record<string, unknown>, Record<string, unknown>][];
    send: (queue: string, data: Record<string, unknown>, options?: { singletonKey?: string }) => Promise<unknown>;
  }

  it('exposes queue constants', () => {
    expect(TRANSACTION_ENRICHMENT_GPT_QUEUE).toBe('transaction.enrichment.gpt');
    expect(TRANSACTION_ENRICHMENT_GPT_DLQ).toBe('transaction.enrichment.gpt.dlq');
    expect(TRANSACTION_ENRICHMENT_GPT_OPERATION_TYPE).toBe('transaction.enrichment.gpt');
  });

  it('sends a minimal reconstructed payload', async () => {
    const boss = {
      queued: [] as [string, Record<string, unknown>, Record<string, unknown>][],
      send(this: { queued: [string, Record<string, unknown>, Record<string, unknown>][] }, queue: string, data: Record<string, unknown>, options?: { singletonKey?: string }) {
        this.queued.push([queue, data, options ?? {}]);
        return Promise.resolve(undefined);
      },
    } as unknown as MockBoss;

    await enqueueTransactionEnrichmentGptJob({
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      modelVersion: 'DeepSeek-V4-Flash',
      promptVersion: 'transaction-enrichment-v1',
      transactionEnrichmentKey: 99,
    }, { enqueue: { send: boss.send.bind(boss), sendAfter: vi.fn() } as unknown as EnqueueDeps['enqueue'] });

    expect(boss.queued).toEqual([[TRANSACTION_ENRICHMENT_GPT_QUEUE, {
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      modelVersion: 'DeepSeek-V4-Flash',
      promptVersion: 'transaction-enrichment-v1',
      transactionEnrichmentKey: 99,
    }, { singletonKey: 'idem-1' }]]);
  });

  it('drops extra fields from the payload', async () => {
    const boss = {
      queued: [] as [string, Record<string, unknown>, Record<string, unknown>][],
      send(this: { queued: [string, Record<string, unknown>, Record<string, unknown>][] }, queue: string, data: Record<string, unknown>, options?: { singletonKey?: string }) {
        this.queued.push([queue, data, options ?? {}]);
        return Promise.resolve(undefined);
      },
    } as unknown as MockBoss;

    await enqueueTransactionEnrichmentGptJob({
      correlationId: 'corr-2',
      idempotencyKey: 'idem-2',
      modelVersion: 'DeepSeek-V4-Flash',
      promptVersion: 'transaction-enrichment-v1',
      transactionEnrichmentKey: 88,
    }, { enqueue: { send: boss.send.bind(boss), sendAfter: vi.fn() } as unknown as EnqueueDeps['enqueue'] });

    expect(boss.queued[0]?.[1]).toEqual({
      correlationId: 'corr-2',
      idempotencyKey: 'idem-2',
      modelVersion: 'DeepSeek-V4-Flash',
      promptVersion: 'transaction-enrichment-v1',
      transactionEnrichmentKey: 88,
    });
  });

  it('creates main and DLQ queues', async () => {
    const boss = { createQueue: vi.fn().mockResolvedValue(undefined) };
    await ensureTransactionEnrichmentGptQueue(boss as unknown as EnsureBoss);
    expect(boss.createQueue.mock.calls).toEqual([
      [TRANSACTION_ENRICHMENT_GPT_DLQ],
      [TRANSACTION_ENRICHMENT_GPT_QUEUE, {
        deadLetter: TRANSACTION_ENRICHMENT_GPT_DLQ,
        expireInSeconds: 300,
        policy: 'singleton',
        retentionSeconds: 1209600,
        retryBackoff: true,
        retryDelay: 60,
        retryLimit: 3,
      }],
    ]);
  });

  it('requires an enqueue dependency', async () => {
    await expect(enqueueTransactionEnrichmentGptJob({ correlationId: 'x', idempotencyKey: 'y', modelVersion: 'm', promptVersion: 'p', transactionEnrichmentKey: 1 }, { enqueue: undefined as unknown as EnqueueDeps['enqueue'] })).rejects.toThrow();
  });

  describe('parseTransactionEnrichmentGptPayload', () => {
    it('accepts a well-formed payload and drops unknown fields', () => {
      const parsed = parseTransactionEnrichmentGptPayload({
        correlationId: 'corr-1',
        extra: 'ignored',
        idempotencyKey: 'idem-1',
        modelVersion: 'DeepSeek-V4-Flash',
        promptVersion: 'transaction-enrichment-v1',
        transactionEnrichmentKey: 42,
      });
      expect(parsed).toEqual({
        correlationId: 'corr-1',
        idempotencyKey: 'idem-1',
        modelVersion: 'DeepSeek-V4-Flash',
        promptVersion: 'transaction-enrichment-v1',
        transactionEnrichmentKey: 42,
      });
    });

    it('rejects a payload missing the transaction enrichment key', () => {
      expect(() => parseTransactionEnrichmentGptPayload({
        correlationId: 'corr-1',
        idempotencyKey: 'idem-1',
        modelVersion: 'DeepSeek-V4-Flash',
        promptVersion: 'transaction-enrichment-v1',
      })).toThrow();
    });

    it('rejects a non-positive or non-integer enrichment key', () => {
      expect(() => parseTransactionEnrichmentGptPayload({
        correlationId: 'corr-1',
        idempotencyKey: 'idem-1',
        modelVersion: 'DeepSeek-V4-Flash',
        promptVersion: 'transaction-enrichment-v1',
        transactionEnrichmentKey: 0,
      })).toThrow();
      expect(() => parseTransactionEnrichmentGptPayload({
        correlationId: 'corr-1',
        idempotencyKey: 'idem-1',
        modelVersion: 'DeepSeek-V4-Flash',
        promptVersion: 'transaction-enrichment-v1',
        transactionEnrichmentKey: 1.5,
      })).toThrow();
    });

    it('rejects non-object input', () => {
      expect(() => parseTransactionEnrichmentGptPayload(null)).toThrow();
      expect(() => parseTransactionEnrichmentGptPayload('nope')).toThrow();
    });
  });
});
