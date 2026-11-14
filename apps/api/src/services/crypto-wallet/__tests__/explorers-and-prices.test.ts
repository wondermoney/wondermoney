import { describe, expect, it } from 'vitest';

import type { MarketDataProvider, MarketQuote } from '@service/market-data/providers/types';
import { createMarketDataRegistry } from '@service/market-data/registry';
import { FeatureDisabledError } from '@utils/errors';

import { createEthereumReader, createExplorerHttp, ExplorerError } from '../explorers';
import { registryTokenPrices } from '../token-prices';

import { blockscoutAddress, ETH, fakeExplorerFetch } from './__fixtures__/wallet-fixtures';

const quote = (close: null | number): MarketQuote => ({ change: null, change_p: null, close, code: '', high: null, low: null, open: null, previousClose: null, timestamp: null, volume: null });

describe('explorer requests', () => {
  it('spaces requests to one explorer at least the minimum interval apart', async () => {
    let clock = 0;
    const waits: number[] = [];
    const explorer = fakeExplorerFetch({});
    const http = createExplorerHttp({ fetch: explorer.fetch, minIntervalMs: 250, now: () => clock, sleep: (ms) => {
      waits.push(ms);
      clock += ms;
      return Promise.resolve();
    } });

    await http.getJson('https://blockscout.example.org/a');
    clock += 100;
    await http.getJson('https://blockscout.example.org/b');
    clock += 400;
    await http.getJson('https://blockscout.example.org/c');

    expect(waits).toEqual([150]);
  });

  it('does not retry an answer the explorer refused or could not describe', async () => {
    const explorer = fakeExplorerFetch({ 'https://blockscout.example.org/bad': { status: 400 } });
    const http = createExplorerHttp({ fetch: explorer.fetch, minIntervalMs: 0, sleep: () => Promise.resolve() });

    await expect(http.getJson('https://blockscout.example.org/bad')).rejects.toMatchObject({ code: 'rejected' });
    expect(explorer.calls).toHaveLength(1);
  });

  it('calls an unreadable token list an invalid answer, and an unknown address empty', async () => {
    const base = 'https://blockscout.example.org';
    const path = `${base}/api/v2/addresses/${ETH.checksummed}`;
    const unknown = fakeExplorerFetch({});
    const reader = createEthereumReader(base, createExplorerHttp({ fetch: unknown.fetch, minIntervalMs: 0 }));
    expect(await reader.read({ address: ETH.checksummed, kind: 'address' })).toEqual([expect.objectContaining({ rawBalance: '0', symbol: 'ETH' })]);

    const broken = fakeExplorerFetch({ [`${path}/token-balances`]: { body: { items: 'nope' } }, [path]: { body: blockscoutAddress(ETH.checksummed, '1') } });
    const brokenReader = createEthereumReader(base, createExplorerHttp({ fetch: broken.fetch, minIntervalMs: 0 }));
    await expect(brokenReader.read({ address: ETH.checksummed, kind: 'address' })).rejects.toBeInstanceOf(ExplorerError);
  });
});

describe('token prices from the market-data registry', () => {
  const provider = (answer: (symbol: string) => Promise<MarketQuote>): MarketDataProvider => ({
    capabilities: ['quote'],
    covers: () => true,
    id: 'coingecko',
    isConfigured: () => true,
    label: 'Test',
    quote: answer,
  });

  it('asks for the USD pair of a symbol and caches it for the run', async () => {
    const asked: string[] = [];
    const registry = createMarketDataRegistry(['coingecko'], { coingecko: () => provider((symbol) => {
      asked.push(symbol);
      return Promise.resolve(quote(symbol === 'ETH-USD.CC' ? 3000 : null));
    }), eodhd: () => provider(() => Promise.reject(new Error('unused'))), stooq: () => provider(() => Promise.reject(new Error('unused'))) });
    const prices = registryTokenPrices(registry);

    expect(await prices.usd('eth')).toBe(3000);
    expect(await prices.usd('ETH')).toBe(3000);
    expect(await prices.usd('FREE')).toBeNull();
    expect(asked).toEqual(['ETH-USD.CC', 'FREE-USD.CC']);
  });

  it('has no price, never zero, when the provider fails, is not set up, or the symbol is not one', async () => {
    const failing = createMarketDataRegistry(['coingecko'], { coingecko: () => provider(() => Promise.reject(new Error('HTTP 500'))), eodhd: () => provider(() => Promise.reject(new Error('unused'))), stooq: () => provider(() => Promise.reject(new Error('unused'))) });
    const disabled = createMarketDataRegistry(['coingecko'], { coingecko: () => provider(() => Promise.reject(new FeatureDisabledError('Prices'))), eodhd: () => provider(() => Promise.reject(new Error('unused'))), stooq: () => provider(() => Promise.reject(new Error('unused'))) });

    expect(await registryTokenPrices(failing).usd('BTC')).toBeNull();
    expect(await registryTokenPrices(disabled).usd('BTC')).toBeNull();
    expect(await registryTokenPrices(failing).usd('FREE-ETH.example')).toBeNull();
  });
});
