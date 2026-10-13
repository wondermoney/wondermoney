import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectRecurringCandidatesForTenant: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@service/recurring/recurring-detection.service', () => ({
  detectRecurringCandidatesForTenant: mocks.detectRecurringCandidatesForTenant,
}));

vi.mock('@utils/logger', () => ({
  default: { warn: mocks.warn },
}));

import { triggerRecurringDetectionAfterTransactionIngestion } from '../post-transaction-ingestion-detection.service';

describe('post transaction ingestion detection service', () => {
  it('calls recurring detection for the tenant', async () => {
    mocks.detectRecurringCandidatesForTenant.mockResolvedValueOnce({ created: 0, skipped: 0, updated: 0 });

    await triggerRecurringDetectionAfterTransactionIngestion(123, 'manual-transaction');

    expect(mocks.detectRecurringCandidatesForTenant).toHaveBeenCalledWith(123);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('swallows recurring detection errors and logs warning', async () => {
    const error = new Error('boom');
    mocks.detectRecurringCandidatesForTenant.mockRejectedValueOnce(error);

    await expect(triggerRecurringDetectionAfterTransactionIngestion(456, 'transaction-import')).resolves.toBeUndefined();

    expect(mocks.warn).toHaveBeenCalledWith({ error, source: 'transaction-import', tenantKey: 456 }, 'Recurring detection failed after transaction ingestion');
  });
});
