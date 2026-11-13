import { describe, expect, it, vi } from 'vitest';

import { CRYPTO_WALLET_SYNC_QUEUE, scheduleCryptoWalletSyncJob } from '@app/jobs/crypto-wallet-sync.queue';

/** pg-boss asserts queue names and schedule keys against this at runtime (attorney.assertObjectName). */
const PG_BOSS_NAME = /^[\w.\-/]+$/;

describe('crypto wallet sync schedule', () => {
  it('uses a queue name and schedule keys pg-boss accepts, so the worker can start', async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    await scheduleCryptoWalletSyncJob({ schedule });

    expect(schedule).toHaveBeenCalledOnce();
    const [queue, , , options] = schedule.mock.calls[0] as [string, string, unknown, { key: string; singletonKey: string }];
    expect(queue).toBe(CRYPTO_WALLET_SYNC_QUEUE);
    for (const name of [queue, options.key, options.singletonKey]) expect(name).toMatch(PG_BOSS_NAME);
  });
});
