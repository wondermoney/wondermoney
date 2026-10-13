import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

import { TransactionEnrichmentStatus } from '@entity/TransactionEnrichment';

import { stampTransactionEnrichmentOutcome } from '../transaction-enrichment-outcome.service';

type OutcomeDeps = NonNullable<Parameters<typeof stampTransactionEnrichmentOutcome>[3]>;

function enrichmentRow(overrides: Record<string, unknown> = {}) {
  return {
    categorySuggestionKey: { categoryKey: 12 },
    outcome: undefined,
    status: TransactionEnrichmentStatus.SHADOW,
    ...overrides,
  };
}

function makeEm(findOneResult: unknown) {
  const findOne = vi.fn().mockResolvedValue(findOneResult);
  const flush = vi.fn().mockResolvedValue(undefined);
  return { em: { findOne, flush } as unknown as EntityManager, findOne, flush };
}

describe('stampTransactionEnrichmentOutcome', () => {
  it('stamps ACCEPTED when the chosen category matches the suggestion', async () => {
    const row = enrichmentRow();
    const { em, flush } = makeEm(row);

    await stampTransactionEnrichmentOutcome(em, 900, 12);

    expect((row as { outcome?: string }).outcome).toBe('accepted');
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('stamps OVERRIDDEN when the chosen category differs from the suggestion', async () => {
    const row = enrichmentRow();
    const { em, flush } = makeEm(row);

    await stampTransactionEnrichmentOutcome(em, 900, 99);

    expect((row as { outcome?: string }).outcome).toBe('overridden');
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when there is no matching enrichment row', async () => {
    const { em, flush } = makeEm(null);

    await stampTransactionEnrichmentOutcome(em, 900, 12);

    expect(flush).not.toHaveBeenCalled();
  });

  it('only looks at SHADOW/COMPLETED rows with a suggestion and no outcome yet', async () => {
    const { em, findOne } = makeEm(null);

    await stampTransactionEnrichmentOutcome(em, 900, 12);

    expect(findOne).toHaveBeenCalledTimes(1);
    const [, where] = findOne.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(where).toMatchObject({
      categorySuggestionKey: { $ne: null },
      outcome: null,
      transactionKey: 900,
    });
    expect(where['status']).toMatchObject({ $in: [TransactionEnrichmentStatus.SHADOW, TransactionEnrichmentStatus.COMPLETED] });
  });

  it('swallows and logs when the lookup throws — never breaks the caller\'s category edit', async () => {
    const findOne = vi.fn().mockRejectedValue(new Error('db down'));
    const em = { findOne } as unknown as EntityManager;
    const logger = { warn: vi.fn() };

    await expect(stampTransactionEnrichmentOutcome(em, 900, 12, { logger: logger as unknown as OutcomeDeps['logger'] })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not restamp a row that already has an outcome (query excludes it)', async () => {
    const { em, findOne } = makeEm(null);

    await stampTransactionEnrichmentOutcome(em, 900, 12);

    const [, where] = findOne.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(where['outcome']).toBeNull();
  });
});
