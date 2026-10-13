import { DI } from '@app/database/di';
import { FinancialAsset } from '@entity/FinancialAsset';

import assetPriceService from './asset-price.service';

export interface AssetPriceRefreshOptions {
  assetPriceService?: typeof assetPriceService;
  clock?: () => number;
  concurrency?: number;
  em?: typeof DI.em;
  failuresCap?: number;
  maxAssetsPerRun?: number;
  recentPriceDays?: number;
  timeBudgetMs?: number;
}

export interface AssetPriceRefreshResult {
  failed: number;
  failures: { assetKey: number; reason: string; symbol: string }[];
  refreshed: number;
  remaining: number;
  skipped: number;
  totalAssets: number;
}

// Defaults keep a single run comfortably inside pg-boss's job expiration window so it can
// never be killed mid-flight (which is what previously spawned the recovery re-dispatch storm).
const DEFAULTS = {
  concurrency: 8,
  failuresCap: 50,
  maxAssetsPerRun: 5000,
  recentPriceDays: 1,
  timeBudgetMs: 10 * 60 * 1000,
};

class AssetPriceRefreshService {
  async refreshAllActiveAssets(options: AssetPriceRefreshOptions = {}): Promise<AssetPriceRefreshResult> {
    const em = options.em ?? DI.em;
    const priceService = options.assetPriceService ?? assetPriceService;
    const concurrency = options.concurrency ?? DEFAULTS.concurrency;
    const maxAssetsPerRun = options.maxAssetsPerRun ?? DEFAULTS.maxAssetsPerRun;
    const timeBudgetMs = options.timeBudgetMs ?? DEFAULTS.timeBudgetMs;
    const recentPriceDays = options.recentPriceDays ?? DEFAULTS.recentPriceDays;
    const failuresCap = options.failuresCap ?? DEFAULTS.failuresCap;
    const clock = options.clock ?? (() => Date.now());

    const assets = await em.find(FinancialAsset, { deletedAt: undefined, isActivelyTrading: true });
    // Skip assets that already have a fresh price so steady-state runs only fetch what changed,
    // keeping the EODHD call count (and DB write load) proportional to staleness, not catalog size.
    const recentlyPricedKeys = await priceService.getRecentlyPricedAssetKeys(recentPriceDays);
    const stale = assets.filter((asset) => !recentlyPricedKeys.has(asset.financialAssetKey));

    const result: AssetPriceRefreshResult = {
      failed: 0,
      failures: [],
      refreshed: 0,
      remaining: stale.length,
      skipped: assets.length - stale.length,
      totalAssets: assets.length,
    };

    const batch = stale.slice(0, maxAssetsPerRun);
    const deadline = clock() + timeBudgetMs;
    let cursor = 0;
    let processed = 0;

    const runWorker = async () => {
      while (cursor < batch.length && clock() < deadline) {
        const asset = batch[cursor++]!;
        processed += 1;
        try {
          const saved = await priceService.fetchAndSaveAssetPrice(asset);
          if (saved) result.refreshed += 1;
          else result.skipped += 1; // no usable price from provider — not an error
        } catch (error) {
          result.failed += 1;
          if (result.failures.length < failuresCap) {
            result.failures.push({ assetKey: asset.financialAssetKey, reason: error instanceof Error ? error.message : 'asset price refresh failed', symbol: asset.symbol });
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, runWorker));

    result.remaining = stale.length - processed;
    return result;
  }
}

export default new AssetPriceRefreshService();
