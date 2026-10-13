import { describe, expect, it, vi } from 'vitest';

import { mockEm } from '@app/__tests__/__helpers__/mock-em';
import { TransactionEnrichmentOutcome } from '@entity/TransactionEnrichment';

import { computeTransactionEnrichmentAcceptanceRate } from '../transaction-enrichment-acceptance.service';

function makeEm(findResult: unknown[]) {
  const find = vi.fn().mockResolvedValue(findResult);
  return { em: Object.assign(mockEm(), { find }), find };
}

describe('computeTransactionEnrichmentAcceptanceRate', () => {
  it('returns a null rate with a zero sample when there are no stamped outcomes yet', async () => {
    const { em } = makeEm([]);

    const result = await computeTransactionEnrichmentAcceptanceRate(em);

    expect(result).toEqual({ acceptanceRate: null, accepted: 0, overridden: 0, sampleSize: 0 });
  });

  it('computes the acceptance rate over the sampled outcomes', async () => {
    const { em } = makeEm([
      { outcome: TransactionEnrichmentOutcome.ACCEPTED },
      { outcome: TransactionEnrichmentOutcome.ACCEPTED },
      { outcome: TransactionEnrichmentOutcome.ACCEPTED },
      { outcome: TransactionEnrichmentOutcome.OVERRIDDEN },
    ]);

    const result = await computeTransactionEnrichmentAcceptanceRate(em);

    expect(result).toEqual({ acceptanceRate: 0.75, accepted: 3, overridden: 1, sampleSize: 4 });
  });

  it('queries only rows with a stamped outcome, most recent first, respecting the limit', async () => {
    const { em, find } = makeEm([]);

    await computeTransactionEnrichmentAcceptanceRate(em, { limit: 50 });

    expect(find).toHaveBeenCalledTimes(1);
    const [, where, options] = find.mock.calls[0] as [unknown, Record<string, unknown>, Record<string, unknown>];
    expect(where).toMatchObject({ outcome: { $ne: null } });
    expect(options).toMatchObject({ limit: 50, orderBy: { completedAt: 'desc' } });
  });

  it('defaults the sample limit to 200 when not specified', async () => {
    const { em, find } = makeEm([]);

    await computeTransactionEnrichmentAcceptanceRate(em);

    const [, , options] = find.mock.calls[0] as [unknown, Record<string, unknown>, Record<string, unknown>];
    expect(options).toMatchObject({ limit: 200 });
  });
});
