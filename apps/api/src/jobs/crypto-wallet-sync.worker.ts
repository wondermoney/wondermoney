import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job } from 'pg-boss';

import { DI } from '@app/database/di';
import type { CryptoWalletSyncPayload } from '@app/jobs/crypto-wallet-sync.queue';
import { enabledCryptoChains } from '@config/crypto-explorers';
import { syncAllCryptoWallets, syncCryptoWallet, type WalletSyncDeps } from '@service/crypto-wallet/crypto-wallet-sync.service';
import { chainReadersFromEnv } from '@service/crypto-wallet/explorers';
import { registryTokenPrices } from '@service/crypto-wallet/token-prices';
import logger from '@utils/logger';

/**
 * Work one `crypto-wallet.sync` job: one wallet (`manualAssetKey`) or, from the daily schedule,
 * all of them. With no explorer configured the feature is off and nothing is asked of anyone.
 * Per-address failures are recorded by the sync and do not fail the job; only a database error
 * does, which pg-boss retries.
 */
export const handleCryptoWalletSyncJob = async (job: Job<Partial<CryptoWalletSyncPayload>>, deps: Partial<WalletSyncDeps> & { em?: EntityManager } = {}): Promise<boolean> => {
  if (enabledCryptoChains().length === 0) return false;
  const em = deps.em ?? DI.em;
  // One set of readers per job: one throttle per explorer across every wallet of the run.
  const syncDeps: WalletSyncDeps = { now: deps.now, prices: deps.prices ?? registryTokenPrices(), readers: deps.readers ?? chainReadersFromEnv() };
  const { manualAssetKey } = job.data;
  if (typeof manualAssetKey === 'number') {
    const result = await syncCryptoWallet(em.fork(), manualAssetKey, syncDeps);
    logger.info({ jobId: job.id, manualAssetKey, result: result && { addresses: result.addresses, valued: result.value !== null } }, 'Crypto wallet synced');
    return result !== null;
  }
  const summary = await syncAllCryptoWallets(em, syncDeps);
  logger.info({ jobId: job.id, summary }, 'Crypto wallets synced');
  return true;
};
