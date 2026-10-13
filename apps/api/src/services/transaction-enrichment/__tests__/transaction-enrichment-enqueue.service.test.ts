import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/database/di', () => ({ DI: { em: {} } }));

import { Tenant } from '@entity/Tenant';
import { CategorizationConfidence } from '@entity/Transaction';
import { TransactionEnrichmentStatus } from '@entity/TransactionEnrichment';

import { enqueueTransactionEnrichmentForTenant } from '../transaction-enrichment-enqueue.service';

type EnqueueDeps = NonNullable<Parameters<typeof enqueueTransactionEnrichmentForTenant>[2]>;
type EnqueueEm = EnqueueDeps['em'];
type EnqueueLogger = EnqueueDeps['logger'];
type EnqueuePort = EnqueueDeps['enqueue'];

const shadowConfig = {
  dailyTenantBudget: 50,
  enabled: true,
  expirationSeconds: 300,
  mode: 'shadow' as const,
  modelVersion: 'DeepSeek-V4-Flash',
  promptVersion: 'transaction-enrichment-v1',
  retentionSeconds: 1209600,
  retryDelaySeconds: 60,
  retryLimit: 3,
  writeConfidenceThreshold: 0.7,
};

const offConfig = { ...shadowConfig, enabled: false, mode: 'off' as const };

/**
 * RAD-580: `enrichedRows` is shaped the way MikroORM actually returns it.
 *
 * This helper used to type it as `{ transaction_key: number }` and the tests passed it snake_case
 * rows, matching what the service read. Both were wrong the same way, so the suite stayed green
 * while the production pipeline was dead: `qb.execute()` maps to *entity property* names, so the
 * rows come back as `transactionKey` regardless of the column name given to `select()`.
 *
 * Verified against the real database rather than assumed — a query builder mocked to agree with
 * the code it is testing proves nothing about either.
 */
function makeEm(candidates: unknown[], enrichedRows: Record<string, unknown>[] = []) {
  const find = vi.fn().mockResolvedValue(candidates);
  const qb = { execute: vi.fn().mockResolvedValue(enrichedRows), select: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis() };
  const createQueryBuilder = vi.fn().mockReturnValue(qb);
  const pendingPersist: { transactionEnrichmentKey?: number }[] = [];
  const flush = vi.fn().mockImplementation(() => {
    for (const row of pendingPersist) row.transactionEnrichmentKey ??= Math.floor(Math.random() * 1_000_000) + 1;
    pendingPersist.length = 0;
    return Promise.resolve(undefined);
  });
  const persist = vi.fn().mockImplementation((row: { transactionEnrichmentKey?: number }) => {
    pendingPersist.push(row);
    return { flush };
  });
  return { createQueryBuilder, em: { createQueryBuilder, find, flush, getReference: (_entity: unknown, tenantKey: number) => Object.assign(new Tenant(), { tenantKey }), persist } as unknown as EnqueueEm, find, flush, persist, qb };
}

describe('enqueueTransactionEnrichmentForTenant', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is a cheap no-op when disabled/off (no DB query)', async () => {
    const { em, find } = makeEm([]);
    const enqueue = { send: vi.fn(), sendAfter: vi.fn() };

    await enqueueTransactionEnrichmentForTenant(7, 'account-initial-sync', { config: offConfig, em, enqueue });

    expect(find).not.toHaveBeenCalled();
    expect(enqueue.send).not.toHaveBeenCalled();
  });

  it('creates a PENDING row and enqueues a job per eligible candidate', async () => {
    const candidates = [
      { transactionKey: 101 },
      { transactionKey: 102 },
    ];
    const { em, persist } = makeEm(candidates);
    const enqueue = { send: vi.fn().mockResolvedValue('job-id'), sendAfter: vi.fn() };
    await enqueueTransactionEnrichmentForTenant(7, 'account-initial-sync', { config: shadowConfig, em, enqueue });

    expect(persist).toHaveBeenCalledTimes(2);
    const firstRow = persist.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstRow['status']).toBe(TransactionEnrichmentStatus.PENDING);
    expect(firstRow['transactionKey']).toBe(candidates[0]);
    expect(firstRow['tenantKey']).toMatchObject({ tenantKey: 7 });
    expect(firstRow['modelVersion']).toBe('DeepSeek-V4-Flash');
    expect(firstRow['promptVersion']).toBe('transaction-enrichment-v1');
    expect(firstRow['idempotencyKey']).toEqual(expect.any(String));
    expect(enqueue.send).toHaveBeenCalledTimes(2);
    expect(enqueue.send).toHaveBeenCalledWith('transaction.enrichment.gpt', expect.objectContaining({ modelVersion: 'DeepSeek-V4-Flash', promptVersion: 'transaction-enrichment-v1' }), expect.objectContaining({ singletonKey: expect.any(String) }));
  });

  it('excludes already-enriched transactions via a $nin key array and orders deterministically', async () => {
    // Two transactions already have enrichment rows → their keys must be excluded from candidates.
    // `transactionKey`, not `transaction_key`: see `makeEm`.
    const { createQueryBuilder, em, find, qb } = makeEm([], [{ transactionKey: 900 }, { transactionKey: 901 }]);
    const enqueue = { send: vi.fn(), sendAfter: vi.fn() };

    await enqueueTransactionEnrichmentForTenant(7, 'account-initial-sync', { config: shadowConfig, em, enqueue });

    // The enriched transaction keys are fetched (executed), not embedded as a raw QueryBuilder.
    expect(createQueryBuilder).toHaveBeenCalledWith(expect.anything(), 'te');
    expect(qb.select).toHaveBeenCalledWith('transaction_key');
    expect(qb.where).toHaveBeenCalledWith({ tenantKey: 7 });
    expect(qb.execute).toHaveBeenCalled();

    const where = find.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(where).toMatchObject({
      categorizationConfidence: { $in: [CategorizationConfidence.NONE, CategorizationConfidence.LOW] },
      deletedAt: undefined,
      tenantKey: 7,
    });
    expect(where['transactionMerchantKey']).toEqual({ $ne: null });
    expect(where['transactionKey']).toEqual({ $nin: [900, 901] });

    const options = find.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options['orderBy']).toEqual({ transactionKey: 'ASC' });
  });

  /**
   * RAD-580 — the bug that killed the pipeline for three days, as a test.
   *
   * When the enriched-key rows do not yield numbers, the old code built
   * `$nin: [undefined, undefined, …]`. That is `NOT IN (NULL, NULL, …)` in SQL, which is UNKNOWN
   * for every row, so the candidate query matched nothing and the producer returned silently.
   * Measured on production: 200 candidates without the exclusion, 0 with it.
   *
   * The rule this pins down is the direction of failure. An exclusion list we cannot read must
   * degrade to *no exclusion* — costing a redundant, idempotency-keyed enqueue — and never to an
   * exclusion that matches everything, which switches the feature off in silence.
   */
  it('skips the exclusion rather than poisoning the query when enriched keys are unreadable', async () => {
    const { em, find } = makeEm([{ transactionKey: 1 }], [{ unexpected_shape: 900 }, { unexpected_shape: 901 }]);
    const enqueue = { send: vi.fn(), sendAfter: vi.fn() };
    const warn = vi.fn();

    await enqueueTransactionEnrichmentForTenant(7, 'account-initial-sync', {
      config: shadowConfig,
      em,
      enqueue,
      logger: { info: vi.fn(), warn } as unknown as EnqueueLogger,
    });

    const where = find.mock.calls[0]?.[1] as Record<string, unknown>;
    // No `$nin` at all — not `$nin: [undefined, undefined]`.
    expect(where['transactionKey']).toBeUndefined();
    // And it says so, because a silently-skipped exclusion is how this went unnoticed.
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ enrichedRows: 2, tenantKey: 7 }),
      expect.stringContaining('non-numeric'),
    );
  });

  it('omits the $nin exclusion entirely when the tenant has no enrichment rows yet', async () => {
    const { em, find } = makeEm([{ transactionKey: 1 }], []);

    await enqueueTransactionEnrichmentForTenant(7, 'account-initial-sync', { config: shadowConfig, em, enqueue: { send: vi.fn().mockResolvedValue('id') } as unknown as EnqueuePort });

    const where = find.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(where['transactionKey']).toBeUndefined();
  });

  it('never throws to the caller when config env is malformed (fail-open) and warns', async () => {
    vi.stubEnv('TRANSACTION_ENRICHMENT_GPT_DAILY_TENANT_BUDGET', 'not-a-number');
    const { em, find } = makeEm([{ transactionKey: 1 }]);
    const enqueue = { send: vi.fn(), sendAfter: vi.fn() };
    const logger = { warn: vi.fn() };

    // No deps.config -> real buildTransactionEnrichmentConfig runs and throws on the bad env var.
    await expect(
      enqueueTransactionEnrichmentForTenant(7, 'account-initial-sync', { em, enqueue, logger: logger as unknown as EnqueueLogger }),
    ).resolves.toBeUndefined();
    expect(find).not.toHaveBeenCalled();
    expect(enqueue.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('never throws to the caller on a DB error (fail-open) and logs only the message', async () => {
    const find = vi.fn().mockRejectedValue(new Error('db down: SELECT * secret params'));
    const qb = { execute: vi.fn().mockResolvedValue([]), select: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis() };
    const createQueryBuilder = vi.fn().mockReturnValue(qb);
    const logger = { warn: vi.fn() };

    await expect(
      enqueueTransactionEnrichmentForTenant(7, 'account-initial-sync', {
        config: shadowConfig,
        em: { createQueryBuilder, find } as unknown as EnqueueEm,
        enqueue: { send: vi.fn(), sendAfter: vi.fn() } as unknown as EnqueuePort,
        logger: logger as unknown as EnqueueLogger,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
    const logged = JSON.stringify(logger.warn.mock.calls);
    expect(logged).toContain('db down');
    // The full error object (which for a MikroORM error can embed SQL/params) must not be logged.
    expect(logged).not.toMatch(/"error":\s*\{/);
  });
});
