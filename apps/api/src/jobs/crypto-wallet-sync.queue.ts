import type { Enqueue } from '@service/queue/enqueue';
import type { PgBossLike } from '@service/queue/pgboss-client';
import { QUEUE_REGISTRY } from '@service/queue/queues';

/**
 * Read crypto wallet balances from the operator's explorers and value the wallets
 * (`services/crypto-wallet/crypto-wallet-sync.service.ts`). Daily for every wallet, and for one
 * wallet as soon as it is created or its addresses or ticked tokens change.
 */
export const CRYPTO_WALLET_SYNC_QUEUE = 'crypto-wallet.sync';
/** Daily, after the night's exchange-rate and price refreshes. */
export const CRYPTO_WALLET_SYNC_CRON = '30 4 * * *';
const SCHEDULE_KEY = 'crypto-wallet-sync-daily';

/** No `manualAssetKey`: every wallet on the server (the daily run). */
export interface CryptoWalletSyncPayload {
  manualAssetKey?: number;
}

export const ensureCryptoWalletSyncQueue = (boss: Pick<PgBossLike, 'createQueue'>) => boss.createQueue(CRYPTO_WALLET_SYNC_QUEUE, {
  // The daily run asks the explorers one address at a time, spaced and with retries: an hour
  // covers thousands of addresses. Per-address failures are recorded, not thrown.
  expireInSeconds: 3600,
  heartbeatSeconds: 120,
  // One running and one waiting per wallet: a change made during a sync still gets its own.
  policy: 'stately',
  retryBackoff: true,
  retryDelay: 60,
  retryLimit: 2,
});

export function enqueueCryptoWalletSyncJob(payload: Required<CryptoWalletSyncPayload>, deps: { enqueue: Enqueue }): Promise<unknown> {
  return deps.enqueue.send(CRYPTO_WALLET_SYNC_QUEUE, payload, { singletonKey: `crypto-wallet.sync:${payload.manualAssetKey}` });
}

export const scheduleCryptoWalletSyncJob = (boss: Pick<PgBossLike, 'schedule'>) =>
  boss.schedule(CRYPTO_WALLET_SYNC_QUEUE, CRYPTO_WALLET_SYNC_CRON, {}, { key: SCHEDULE_KEY, singletonKey: SCHEDULE_KEY, tz: 'UTC' });

QUEUE_REGISTRY.set(CRYPTO_WALLET_SYNC_QUEUE, { ensure: ensureCryptoWalletSyncQueue, name: CRYPTO_WALLET_SYNC_QUEUE });
