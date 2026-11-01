import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', () => ({ DI: { em: {} } }));

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';
import { DI } from '@app/app';
import type { Appuser } from '@entity/Appuser';

import service from '../portfolio-history-status.service';

const appuser = { appuserKey: 1 } as Appuser;

function setup({ buyRows = [], portfolio = { portfolioKey: 1 }, priceRows = [], snapshotRows = [{ earliest_snapshot_date: null, latest_snapshot_date: null }] }:
  { buyRows?: unknown[]; portfolio?: unknown; priceRows?: unknown[]; snapshotRows?: unknown[] }) {
  const findOne = vi.fn().mockResolvedValue(portfolio);
  const database = kyselyDouble(({ sql }) => {
    if (sql.includes('from "financial_transaction" as "ft"')) return buyRows;
    if (sql.includes('from "financial_asset_price"')) return priceRows;
    if (sql.includes('from "portfolio_snapshot"')) return snapshotRows;
    return [];
  });

  Object.assign(DI.em, { findOne, getKysely: vi.fn().mockReturnValue(database.db) });
  return { database, findOne };
}

describe('portfolio history status service', () => {
  it('returns ready when there are no BUY assets', async () => {
    setup({ buyRows: [] });

    const result = await service.getPortfolioHistoryStatus(appuser, 1);

    expect(result).toEqual({
      assetsPending: 0,
      assetsReady: 0,
      assetsTotal: 0,
      earliestRequiredDate: null,
      earliestSnapshotDate: null,
      latestSnapshotDate: null,
      status: 'ready',
    });
  });

  it('returns unavailable when pending assets have stale created_at', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-10T00:00:00Z'));
    try {
      setup({
        buyRows: [{ earliest_buy_date: new Date('2024-01-01'), financial_asset_key: 10, latest_created_at: new Date('2024-01-01T00:00:00Z') }],
        priceRows: [],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.status).toBe('unavailable');
      expect(result.assetsPending).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks processing when one BUY asset lacks price coverage but was recently created', async () => {
    setup({
      buyRows: [{ earliest_buy_date: new Date('2024-01-01'), financial_asset_key: 10, latest_created_at: new Date() }],
      priceRows: [{ date: new Date('2024-01-03'), financial_asset_key: 10 }],
    });

    const result = await service.getPortfolioHistoryStatus(appuser, 1);

    expect(result.assetsTotal).toBe(1);
    expect(result.assetsPending).toBe(1);
    expect(result.status).toBe('processing');
  });

  it('returns partial when price coverage is ready but snapshots are missing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T00:00:00Z'));
    try {
      const today = new Date('2024-01-02T00:00:00Z');
      setup({
        buyRows: [{ earliest_buy_date: today, financial_asset_key: 10 }],
        priceRows: [{ date: today, financial_asset_key: 10 }],
        snapshotRows: [],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result).toMatchObject({
        assetsPending: 0,
        assetsReady: 1,
        assetsTotal: 1,
        earliestSnapshotDate: null,
        latestSnapshotDate: null,
        status: 'partial',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats Mon-Fri prices as covered on Sunday when weekdays are complete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-07T00:00:00Z'));
    try {
      const monday = new Date('2024-01-01T00:00:00Z');
      setup({
        buyRows: [{ earliest_buy_date: monday, financial_asset_key: 10 }],
        priceRows: [
          { date: new Date('2024-01-01T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-02T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-03T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-04T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-05T00:00:00Z'), financial_asset_key: 10 },
        ],
        snapshotRows: [{ earliest_snapshot_date: monday, latest_snapshot_date: new Date('2024-01-05T00:00:00Z') }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.assetsReady).toBe(1);
      expect(result.status).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns ready when prices are complete and snapshots fully cover the range', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-05T00:00:00Z'));
    try {
      const monday = new Date('2024-01-01T00:00:00Z');
      setup({
        buyRows: [{ earliest_buy_date: monday, financial_asset_key: 10 }],
        priceRows: [
          { date: new Date('2024-01-01T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-02T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-03T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-04T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-05T00:00:00Z'), financial_asset_key: 10 },
        ],
        snapshotRows: [{ earliest_snapshot_date: new Date('2024-01-01T00:00:00Z'), latest_snapshot_date: new Date('2024-01-05T00:00:00Z') }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.assetsReady).toBe(1);
      expect(result.status).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts database date strings for price and snapshot coverage checks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-05T00:00:00Z'));
    try {
      setup({
        buyRows: [{ earliest_buy_date: '2024-01-01' as unknown as Date, financial_asset_key: 10 }],
        priceRows: [
          { date: '2024-01-01' as unknown as Date, financial_asset_key: 10 },
          { date: '2024-01-02' as unknown as Date, financial_asset_key: 10 },
          { date: '2024-01-03' as unknown as Date, financial_asset_key: 10 },
          { date: '2024-01-04' as unknown as Date, financial_asset_key: 10 },
          { date: '2024-01-05' as unknown as Date, financial_asset_key: 10 },
        ],
        snapshotRows: [{ earliest_snapshot_date: '2024-01-01' as unknown as Date, latest_snapshot_date: '2024-01-05' as unknown as Date }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.assetsReady).toBe(1);
      expect(result.status).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns ready and snapshot min/max dates when history and snapshots are sufficient', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T00:00:00Z'));
    try {
      const today = new Date('2024-01-02T00:00:00Z');
      setup({
        buyRows: [{ earliest_buy_date: today, financial_asset_key: 10 }],
        priceRows: [{ date: today, financial_asset_key: 10 }],
        snapshotRows: [{ earliest_snapshot_date: new Date('2024-01-01T00:00:00Z'), latest_snapshot_date: new Date('2024-01-02T00:00:00Z') }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result).toMatchObject({
        assetsPending: 0,
        assetsReady: 1,
        assetsTotal: 1,
        earliestSnapshotDate: new Date('2024-01-01T00:00:00Z'),
        latestSnapshotDate: new Date('2024-01-02T00:00:00Z'),
        status: 'ready',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns ready when price and snapshot coverage are complete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-05T00:00:00Z'));
    try {
      const requiredFrom = new Date('2024-01-01T00:00:00Z');
      setup({
        buyRows: [{ earliest_buy_date: requiredFrom, financial_asset_key: 10 }],
        priceRows: [
          { date: new Date('2024-01-01T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-02T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-03T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-04T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-05T00:00:00Z'), financial_asset_key: 10 },
        ],
        snapshotRows: [{ earliest_snapshot_date: requiredFrom, latest_snapshot_date: new Date('2024-01-05T00:00:00Z') }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.status).toBe('ready');
      expect(result.assetsReady).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows snapshot range to start older than required and still be ready', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-05T00:00:00Z'));
    try {
      const requiredFrom = new Date('2024-01-03T00:00:00Z');
      setup({
        buyRows: [{ earliest_buy_date: requiredFrom, financial_asset_key: 10 }],
        priceRows: [
          { date: new Date('2024-01-03T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-04T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-05T00:00:00Z'), financial_asset_key: 10 },
        ],
        snapshotRows: [{ earliest_snapshot_date: new Date('2024-01-01T00:00:00Z'), latest_snapshot_date: new Date('2024-01-05T00:00:00Z') }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.status).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows snapshot range to extend past expected Friday and still be ready', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-06T00:00:00Z'));
    try {
      const requiredFrom = new Date('2024-01-02T00:00:00Z');
      setup({
        buyRows: [{ earliest_buy_date: requiredFrom, financial_asset_key: 10 }],
        priceRows: [
          { date: new Date('2024-01-02T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-03T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-04T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-05T00:00:00Z'), financial_asset_key: 10 },
        ],
        snapshotRows: [{ earliest_snapshot_date: requiredFrom, latest_snapshot_date: new Date('2024-01-06T00:00:00Z') }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.status).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('tolerates a missing weekday holiday in price coverage', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-26T00:00:00Z'));
    try {
      const requiredFrom = new Date('2024-01-01T00:00:00Z');
      setup({
        buyRows: [{ earliest_buy_date: requiredFrom, financial_asset_key: 10 }],
        priceRows: [
          { date: new Date('2024-01-01T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-02T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-03T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-04T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-05T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-08T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-09T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-10T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-11T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-12T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-16T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-17T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-18T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-19T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-22T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-23T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-24T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-25T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-26T00:00:00Z'), financial_asset_key: 10 },
        ],
        snapshotRows: [{ earliest_snapshot_date: requiredFrom, latest_snapshot_date: new Date('2024-01-26T00:00:00Z') }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.assetsReady).toBe(1);
      expect(result.status).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a Saturday buy as covered by a Monday first price', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-08T00:00:00Z'));
    try {
      const saturday = new Date('2024-01-06T00:00:00Z');
      setup({
        buyRows: [{ earliest_buy_date: saturday, financial_asset_key: 10 }],
        priceRows: [
          { date: new Date('2024-01-08T00:00:00Z'), financial_asset_key: 10 },
        ],
        snapshotRows: [{ earliest_snapshot_date: saturday, latest_snapshot_date: new Date('2024-01-08T00:00:00Z') }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.assetsReady).toBe(1);
      expect(result.status).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks below-threshold coverage as processing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-04T00:00:00Z'));
    const requiredFrom = new Date('2024-01-01T00:00:00Z');
    try {
      setup({
        buyRows: [{ earliest_buy_date: requiredFrom, financial_asset_key: 10, latest_created_at: new Date('2024-01-04T00:00:00Z') }],
        priceRows: [
          { date: new Date('2024-01-01T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-03T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-04T00:00:00Z'), financial_asset_key: 10 },
        ],
        snapshotRows: [{ earliest_snapshot_date: requiredFrom, latest_snapshot_date: new Date('2024-01-04T00:00:00Z') }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.status).toBe('processing');
      expect(result.assetsPending).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks edge-outside-tolerance coverage as processing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-10T00:00:00Z'));
    const requiredFrom = new Date('2024-01-01T00:00:00Z');
    try {
      setup({
        buyRows: [{ earliest_buy_date: requiredFrom, financial_asset_key: 10, latest_created_at: new Date('2024-01-10T00:00:00Z') }],
        priceRows: [
          { date: new Date('2024-01-03T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-04T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-05T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-06T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-07T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-08T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-09T00:00:00Z'), financial_asset_key: 10 },
          { date: new Date('2024-01-10T00:00:00Z'), financial_asset_key: 10 },
        ],
        snapshotRows: [{ earliest_snapshot_date: requiredFrom, latest_snapshot_date: new Date('2024-01-10T00:00:00Z') }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.status).toBe('processing');
      expect(result.assetsReady).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts multiple assets correctly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T00:00:00Z'));
    try {
      const today = new Date('2024-01-02T00:00:00Z');
      setup({
        buyRows: [
          { earliest_buy_date: today, financial_asset_key: 10, latest_created_at: today },
          { earliest_buy_date: new Date('2024-01-01T00:00:00Z'), financial_asset_key: 11, latest_created_at: today },
        ],
        priceRows: [
          { date: today, financial_asset_key: 10 },
        ],
        snapshotRows: [{ earliest_snapshot_date: new Date('2024-01-01T00:00:00Z'), latest_snapshot_date: today }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.assetsTotal).toBe(2);
      expect(result.assetsReady).toBe(1);
      expect(result.assetsPending).toBe(1);
      expect(result.status).toBe('processing');
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the 10-year cap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-10T00:00:00Z'));
    try {
      setup({
        buyRows: [{ earliest_buy_date: new Date('2000-01-01T00:00:00Z'), financial_asset_key: 10 }],
        priceRows: [{ date: new Date('2014-01-10T00:00:00Z'), financial_asset_key: 10 }],
        snapshotRows: [{ earliest_snapshot_date: new Date('2014-01-10T00:00:00Z'), latest_snapshot_date: new Date('2014-01-10T00:00:00Z') }],
      });

      const result = await service.getPortfolioHistoryStatus(appuser, 1);

      expect(result.earliestRequiredDate).toEqual(new Date('2014-01-10T00:00:00Z'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('verifies the portfolio exists and is active (tenant filter scopes to household)', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    Object.assign(DI.em, { findOne, getKysely: vi.fn() });

    await expect(service.getPortfolioHistoryStatus(appuser, 1)).rejects.toThrow('Portfolio not found');
    expect(findOne).toHaveBeenCalledWith(expect.anything(), { deletedAt: undefined, portfolioKey: 1 });
  });
});
