import { describe, expect, it } from 'vitest';

import { buildTransactionEnrichmentIdempotencyKey } from '@service/transaction-enrichment/idempotency';

describe('transaction enrichment idempotency', () => {
  it('is deterministic for the same inputs', () => {
    const first = buildTransactionEnrichmentIdempotencyKey(1, null, 'transaction-enrichment-v1', 'DeepSeek-V4-Flash');
    const second = buildTransactionEnrichmentIdempotencyKey(1, null, 'transaction-enrichment-v1', 'DeepSeek-V4-Flash');
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it('changes when structural inputs change and ignores PII-like data', () => {
    expect(buildTransactionEnrichmentIdempotencyKey(1, 2, 'transaction-enrichment-v1', 'DeepSeek-V4-Flash')).not.toBe(
      buildTransactionEnrichmentIdempotencyKey(2, 2, 'transaction-enrichment-v1', 'DeepSeek-V4-Flash'),
    );
    expect(buildTransactionEnrichmentIdempotencyKey(1, null, 'transaction-enrichment-v1', 'DeepSeek-V4-Flash')).not.toContain('salary');
  });
});
