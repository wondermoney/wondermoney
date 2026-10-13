import { describe, expect, it, vi } from 'vitest';

import { handleFinancialEmailUser } from '../financial-emails.worker';

const job = { data: { appuserKey: 7, correlationId: 'correlation', scheduledFor: '2026-07-18T08:00:00.000Z' }, id: 'job' };

describe('financial email user job outcomes', () => {
  it('throws only retryable failures for pg-boss retry', async () => {
    const service = { process: vi.fn().mockResolvedValue({ result: 'retryable_failed' }) };
    await expect(handleFinancialEmailUser(job as unknown as Parameters<typeof handleFinancialEmailUser>[0], 'budget', service as unknown as Parameters<typeof handleFinancialEmailUser>[2])).rejects.toThrow('financial_email_retryable_failed');
  });

  it.each(['accepted', 'permanent_failed', 'unknown', 'dry_run', 'suppressed'])('returns normally for %s', async (result) => {
    const service = { process: vi.fn().mockResolvedValue({ result }) };
    await expect(handleFinancialEmailUser(job as unknown as Parameters<typeof handleFinancialEmailUser>[0], 'weekly', service as unknown as Parameters<typeof handleFinancialEmailUser>[2])).resolves.toEqual({ result });
  });
});
