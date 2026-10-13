import { describe, expect, it, vi } from 'vitest';

vi.mock('../asset-price.service', () => ({ default: { fetchAndSaveAssetPrice: vi.fn(), getRecentlyPricedAssetKeys: vi.fn() } }));

import assetPriceRefreshService from '@service/portfolio/asset-price-refresh.service';
import type assetPriceService from '@service/portfolio/asset-price.service';

type RefreshEm = NonNullable<NonNullable<Parameters<typeof assetPriceRefreshService.refreshAllActiveAssets>[0]>['em']>;

const asset = (financialAssetKey: number, symbol: string) => ({ financialAssetKey, isActivelyTrading: true, symbol });
const priceServiceStub = (overrides: { fetchAndSaveAssetPrice?: unknown; recentKeys?: Set<number> } = {}) => ({
  fetchAndSaveAssetPrice: overrides.fetchAndSaveAssetPrice ?? vi.fn().mockResolvedValue({ saved: true }),
  getRecentlyPricedAssetKeys: vi.fn().mockResolvedValue(overrides.recentKeys ?? new Set<number>()),
});

describe('asset price refresh service', () => {
  it('refreshes only stale assets and skips recently-priced ones', async () => {
    const em = { find: vi.fn().mockResolvedValue([asset(1, 'AAA'), asset(2, 'BBB'), asset(3, 'CCC')]) };
    const priceService = priceServiceStub({ recentKeys: new Set([2]) });

    const result = await assetPriceRefreshService.refreshAllActiveAssets({ assetPriceService: priceService as unknown as typeof assetPriceService, em: em as unknown as RefreshEm });

    expect(priceService.fetchAndSaveAssetPrice).toHaveBeenCalledTimes(2); // BBB skipped as recent
    expect(result).toEqual({ failed: 0, failures: [], refreshed: 2, remaining: 0, skipped: 1, totalAssets: 3 });
  });

  it('counts a null price result as skipped, not failed', async () => {
    const em = { find: vi.fn().mockResolvedValue([asset(1, 'AAA'), asset(2, 'BBB')]) };
    const priceService = priceServiceStub({ fetchAndSaveAssetPrice: vi.fn().mockResolvedValueOnce({ saved: true }).mockResolvedValueOnce(null) });

    const result = await assetPriceRefreshService.refreshAllActiveAssets({ assetPriceService: priceService as unknown as typeof assetPriceService, concurrency: 1, em: em as unknown as RefreshEm });

    expect(result.refreshed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('records failures without aborting the rest', async () => {
    const em = { find: vi.fn().mockResolvedValue([asset(1, 'AAA'), asset(2, 'BBB'), asset(3, 'CCC')]) };
    const priceService = priceServiceStub({
      fetchAndSaveAssetPrice: vi.fn().mockResolvedValueOnce({ saved: true }).mockRejectedValueOnce(new Error('provider down')).mockResolvedValueOnce({ saved: true }),
    });

    const result = await assetPriceRefreshService.refreshAllActiveAssets({ assetPriceService: priceService as unknown as typeof assetPriceService, concurrency: 1, em: em as unknown as RefreshEm });

    expect(result.refreshed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([{ assetKey: 2, reason: 'provider down', symbol: 'BBB' }]);
    expect(priceService.fetchAndSaveAssetPrice).toHaveBeenCalledTimes(3);
  });

  it('counts every failure but caps the stored failures array', async () => {
    const em = { find: vi.fn().mockResolvedValue([asset(1, 'AAA'), asset(2, 'BBB'), asset(3, 'CCC')]) };
    const priceService = priceServiceStub({ fetchAndSaveAssetPrice: vi.fn().mockRejectedValue(new Error('down')) });

    const result = await assetPriceRefreshService.refreshAllActiveAssets({ assetPriceService: priceService as unknown as typeof assetPriceService, concurrency: 1, em: em as unknown as RefreshEm, failuresCap: 2 });

    expect(result.failed).toBe(3);
    expect(result.failures).toHaveLength(2);
  });

  it('caps work per run and reports the remaining stale assets', async () => {
    const em = { find: vi.fn().mockResolvedValue([asset(1, 'AAA'), asset(2, 'BBB'), asset(3, 'CCC')]) };
    const priceService = priceServiceStub();

    const result = await assetPriceRefreshService.refreshAllActiveAssets({ assetPriceService: priceService as unknown as typeof assetPriceService, concurrency: 1, em: em as unknown as RefreshEm, maxAssetsPerRun: 1 });

    expect(priceService.fetchAndSaveAssetPrice).toHaveBeenCalledTimes(1);
    expect(result.refreshed).toBe(1);
    expect(result.remaining).toBe(2);
  });

  it('stops when the time budget is exhausted and reports remaining', async () => {
    const em = { find: vi.fn().mockResolvedValue([asset(1, 'AAA'), asset(2, 'BBB')]) };
    const priceService = priceServiceStub();

    const result = await assetPriceRefreshService.refreshAllActiveAssets({ assetPriceService: priceService as unknown as typeof assetPriceService, clock: () => 1000, em: em as unknown as RefreshEm, timeBudgetMs: 0 });

    expect(priceService.fetchAndSaveAssetPrice).not.toHaveBeenCalled();
    expect(result.refreshed).toBe(0);
    expect(result.remaining).toBe(2);
  });
});
