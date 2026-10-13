import { describe, expect, it, vi } from 'vitest';

import {
  BANK_RECOVERY_QUEUE,
  enqueueBankRecoveryAfter,
  ensureBankRecoveryQueue,
  parseBankRecoveryPayload,
} from '../bank-recovery.queue';

type EnqueueDeps = Parameters<typeof enqueueBankRecoveryAfter>[1];
type EnsureQueueBoss = Parameters<typeof ensureBankRecoveryQueue>[0];

const payload = {
  deliveryKey: 7,
  incidentId: '1f8fab82-1cc1-427b-9f51-5b9fe416bd88',
  templateVersion: 'bank-recovery.v1',
};

describe('bank recovery queue', () => {
  it('bounds retries and retention so a failing recovery send cannot retry forever', async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    await ensureBankRecoveryQueue({ createQueue } as unknown as EnsureQueueBoss);
    // objectContaining, not an exact literal: the values below are the operational bound that
    // matters (a bounded, backed-off retry budget and a finite retention window). Additional
    // options — a dead-letter target, an expiry — are orthogonal and must not fail this test.
    expect(createQueue).toHaveBeenCalledWith(
      BANK_RECOVERY_QUEUE,
      expect.objectContaining({
        policy: 'exclusive', retentionSeconds: 1_209_600, retryBackoff: true, retryDelay: 60, retryLimit: 3,
      }),
    );
  });

  it('uses sendAfter official argument order, exact time, and incident singleton', async () => {
    const sendAfter = vi.fn().mockResolvedValue('job-1');
    const eligibleAfter = new Date('2026-07-17T12:00:00.065Z');
    await expect(enqueueBankRecoveryAfter(payload, { enqueue: { sendAfter } as unknown as EnqueueDeps['enqueue'] }, eligibleAfter)).resolves.toBe('job-1');
    expect(sendAfter).toHaveBeenCalledWith(BANK_RECOVERY_QUEUE, payload, {
      singletonKey: `${payload.incidentId}:${payload.templateVersion}`,
    }, eligibleAfter);
  });

  it('preserves a null singleton conflict as an idempotent result', async () => {
    const sendAfter = vi.fn().mockResolvedValue(null);
    await expect(enqueueBankRecoveryAfter(payload, { enqueue: { sendAfter } as unknown as EnqueueDeps['enqueue'] }, new Date(65))).resolves.toBeNull();
  });

  it.each([
    { ...payload, deliveryKey: 0 },
    { ...payload, deliveryKey: 1.5 },
    { ...payload, incidentId: 'not-a-uuid' },
    { ...payload, templateVersion: '' },
    { ...payload, templateVersion: 'unsafe version' },
    { ...payload, extra: true },
  ])('rejects malformed payload %#', (candidate) => {
    expect(() => parseBankRecoveryPayload(candidate)).toThrow();
  });
});
