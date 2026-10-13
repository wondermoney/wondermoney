import type { EntityManager } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportedLanguages } from '@entity/Appuser';
import type { LifecycleDelivery } from '@entity/LifecycleDelivery';
import {
  claimPendingDelivery,
  LIFECYCLE_MAX_PROVIDER_ATTEMPTS,
  LifecycleProviderError,
  markSent,
  reconcileStaleClaims,
  releaseClaim,
  resolveProviderFailure,
} from '@service/lifecycle/lifecycle-delivery.service';
import { LifecycleDeliveryStatus } from '@service/lifecycle/lifecycle-types';

const delivery = (overrides: Partial<LifecycleDelivery> = {}): LifecycleDelivery => ({
  lifecycleDeliveryKey: 1,
  providerAttemptCount: 0,
  status: LifecycleDeliveryStatus.PENDING,
  ...overrides,
} as LifecycleDelivery);

/** `em.transactional` forks in MikroORM v6; the fake mirrors that shape closely enough. */
const fakeEm = (row: LifecycleDelivery | null, extra: { find?: ReturnType<typeof vi.fn> } = {}) => {
  const flush = vi.fn().mockResolvedValue(undefined);
  const findOne = vi.fn().mockResolvedValue(row);
  const inner = { find: extra.find ?? vi.fn().mockResolvedValue([]), findOne, flush };
  return {
    em: {
      ...inner,
      transactional: (fn: (tx: unknown) => Promise<unknown>) => fn(inner),
    } as unknown as EntityManager,
    findOne,
    flush,
  };
};

describe('lifecycle delivery claims', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('claims a pending delivery, consuming exactly one provider attempt', async () => {
    const row = delivery();
    const { em, findOne } = fakeEm(row);

    const claim = await claimPendingDelivery(em, 1, 'job-1');

    expect(claim).not.toBeNull();
    expect(row.status).toBe(LifecycleDeliveryStatus.CLAIMED);
    expect(row.providerAttemptCount).toBe(1);
    // The claim columns exist on the entity and were never written by any code path
    // before this — the state machine was copied from trial_lifecycle_delivery and left
    // inert, which is what made a double-send possible.
    expect(row.claimToken).toBeTypeOf('string');
    expect(row.claimJobId).toBe('job-1');
    expect(row.claimExpiresAt).toBeInstanceOf(Date);
    // A pessimistic write lock, not an optimistic read.
    expect(findOne).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ lockMode: expect.anything() }));
  });

  it('refuses to claim a delivery that is no longer pending', async () => {
    const row = delivery({ status: LifecycleDeliveryStatus.SENT });
    const { em } = fakeEm(row);
    await expect(claimPendingDelivery(em, 1, 'job-1')).resolves.toBeNull();
  });

  it('refuses to claim once the attempt budget is spent', async () => {
    const row = delivery({ providerAttemptCount: LIFECYCLE_MAX_PROVIDER_ATTEMPTS });
    const { em } = fakeEm(row);
    await expect(claimPendingDelivery(em, 1, 'job-1')).resolves.toBeNull();
  });

  it('refuses to claim a delivery that does not exist', async () => {
    const { em } = fakeEm(null);
    await expect(claimPendingDelivery(em, 404, 'job-1')).resolves.toBeNull();
  });

  it('clears every claim column when releasing, so the status CHECK constraint holds', async () => {
    const row = delivery();
    const { em } = fakeEm(row);
    await claimPendingDelivery(em, 1, 'job-1');

    releaseClaim(row, 'provider_rate_limited');

    // The table's CHECK requires a PENDING row to have all of these null.
    expect(row.status).toBe(LifecycleDeliveryStatus.PENDING);
    expect(row.claimToken).toBeUndefined();
    expect(row.claimJobId).toBeUndefined();
    expect(row.claimedAt).toBeUndefined();
    expect(row.claimExpiresAt).toBeUndefined();
    expect(row.completedAt).toBeUndefined();
    expect(row.sentAt).toBeUndefined();
    // The attempt stays spent.
    expect(row.providerAttemptCount).toBe(1);
  });

  describe('resolveProviderFailure', () => {
    it('releases and retries when nothing reached the provider', () => {
      const row = delivery({ providerAttemptCount: 1, status: LifecycleDeliveryStatus.CLAIMED });
      expect(resolveProviderFailure(row, new LifecycleProviderError('local', 'render_failed'))).toEqual({ shouldRetry: true });
      expect(row.status).toBe(LifecycleDeliveryStatus.PENDING);
    });

    it('fails terminally rather than parking a row with no attempts left', () => {
      const row = delivery({ providerAttemptCount: LIFECYCLE_MAX_PROVIDER_ATTEMPTS, status: LifecycleDeliveryStatus.CLAIMED });
      expect(resolveProviderFailure(row, new LifecycleProviderError('local', 'render_failed'))).toEqual({ shouldRetry: false });
      expect(row.status).toBe(LifecycleDeliveryStatus.FAILED);
    });

    it('fails terminally on an explicit provider rejection', () => {
      const row = delivery({ providerAttemptCount: 1, status: LifecycleDeliveryStatus.CLAIMED });
      expect(resolveProviderFailure(row, new LifecycleProviderError('rejected', 'invalid_recipient'))).toEqual({ shouldRetry: false });
      expect(row.status).toBe(LifecycleDeliveryStatus.FAILED);
      expect(row.outcomeCode).toBe('invalid_recipient');
    });

    it('sends an ambiguous outcome to reconciliation and never retries it', () => {
      // "Maybe delivered" plus "retry" is the double-send this mechanism exists to prevent.
      const row = delivery({ providerAttemptCount: 1, status: LifecycleDeliveryStatus.CLAIMED });
      expect(resolveProviderFailure(row, new LifecycleProviderError('unknown', 'provider_timeout'))).toEqual({ shouldRetry: false });
      expect(row.status).toBe(LifecycleDeliveryStatus.NEEDS_RECONCILIATION);
    });

    it('treats an unclassified error as ambiguous, not as safe to retry', () => {
      const row = delivery({ providerAttemptCount: 1, status: LifecycleDeliveryStatus.CLAIMED });
      expect(resolveProviderFailure(row, new Error('who knows'))).toEqual({ shouldRetry: false });
      expect(row.status).toBe(LifecycleDeliveryStatus.NEEDS_RECONCILIATION);
    });
  });

  it('marks a claimed delivery sent without reopening it to another claim', async () => {
    const row = delivery();
    const { em } = fakeEm(row);
    await claimPendingDelivery(em, 1, 'job-1');

    markSent(row, 'msg-1', SupportedLanguages.EN);
    expect(row.status).toBe(LifecycleDeliveryStatus.SENT);

    await expect(claimPendingDelivery(em, 1, 'job-2')).resolves.toBeNull();
  });

  it('resolves expired claims to reconciliation rather than back to pending', async () => {
    // A lease that expired without an outcome is a worker that died mid-send. Returning
    // it to PENDING would let the next sweep send a second copy.
    const stale = [delivery({ status: LifecycleDeliveryStatus.CLAIMED }), delivery({ lifecycleDeliveryKey: 2, status: LifecycleDeliveryStatus.CLAIMED })];
    const { em, flush } = fakeEm(null, { find: vi.fn().mockResolvedValue(stale) });

    await expect(reconcileStaleClaims(em, new Date())).resolves.toBe(2);
    expect(stale.every((row) => row.status === LifecycleDeliveryStatus.NEEDS_RECONCILIATION)).toBe(true);
    expect(stale[0]?.outcomeCode).toBe('stale_claim');
    expect(flush).toHaveBeenCalledOnce();
  });
});
