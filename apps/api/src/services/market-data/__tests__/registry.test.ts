import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketDataProviderId } from '@config/market-data-providers';
import { FeatureDisabledError, NotFoundError } from '@utils/errors';

const warn = vi.hoisted(() => vi.fn());
const factories = vi.hoisted(() => ({ coingecko: vi.fn(), stooq: vi.fn() }));
const eodhdClient = vi.hoisted(() => ({ getQuote: vi.fn(), search: vi.fn() }));

vi.mock('@utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn } }));
vi.mock('@service/market-data/eodhd.service', () => ({ default: eodhdClient }));
vi.mock('../providers/stooq.provider', () => ({ createStooqProvider: factories.stooq }));
vi.mock('../providers/coingecko.provider', () => ({ createCoinGeckoProvider: factories.coingecko }));

import { MarketDataProviderError } from '../errors';
import type { MarketDataProvider, MarketQuote } from '../providers/types';
import { createMarketDataRegistry, isMarketDataEnabled, marketData, marketDataFeatures } from '../registry';

const quote = (close: null | number): MarketQuote => ({ change: null, change_p: null, close, code: 'X', high: null, low: null, open: null, previousClose: null, timestamp: 1_700_000_000, volume: null });

function fake(id: MarketDataProviderId, overrides: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return {
    capabilities: ['search', 'quote', 'dailyHistory', 'dividends', 'splits'],
    covers: () => true,
    id,
    isConfigured: () => true,
    label: id,
    ...overrides,
  };
}

function registryOf(...providers: MarketDataProvider[]) {
  const byId = Object.fromEntries(providers.map((provider) => [provider.id, () => provider])) as Record<MarketDataProviderId, () => MarketDataProvider>;
  return createMarketDataRegistry(providers.map((provider) => provider.id), byId);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the registry falls through its ordered list', () => {
  it('answers from the first provider and says which one it was', async () => {
    const second = vi.fn();
    const registry = registryOf(fake('eodhd', { quote: () => Promise.resolve(quote(10)) }), fake('stooq', { quote: second }));

    await expect(registry.quote('AAPL')).resolves.toEqual({ provider: 'eodhd', value: quote(10) });
    expect(second).not.toHaveBeenCalled();
  });

  it('asks the next provider when one fails, and logs that failure once', async () => {
    const failure = new MarketDataProviderError('stooq', 'server_error', 'HTTP 503', 503);
    const registry = registryOf(fake('stooq', { quote: () => Promise.reject(failure) }), fake('coingecko', { quote: () => Promise.resolve(quote(12)) }));

    await expect(registry.quote('AAPL')).resolves.toEqual({ provider: 'coingecko', value: quote(12) });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ capability: 'quote', provider: 'stooq', symbol: 'AAPL' });
  });

  it('asks the next provider when one has nothing for the symbol', async () => {
    const registry = registryOf(
      fake('eodhd', { dailyHistory: () => Promise.resolve([]), quote: () => Promise.resolve(quote(null)) }),
      fake('stooq', { dailyHistory: () => Promise.resolve([{ adjusted_close: 5, close: 5, date: '2026-01-02', high: null, low: null, open: null, volume: null }]), quote: () => Promise.resolve(quote(7)) }),
    );

    await expect(registry.quote('VOD.LSE')).resolves.toMatchObject({ provider: 'stooq', value: { close: 7 } });
    await expect(registry.dailyHistory('VOD.LSE', { from: '2026-01-01' })).resolves.toMatchObject({ provider: 'stooq', value: [{ close: 5 }] });
    expect(warn).not.toHaveBeenCalled();
  });

  it('throws the first failure when every provider fails, and logs only the others', async () => {
    const first = new MarketDataProviderError('stooq', 'rate_limit', 'HTTP 429', 429, 30);
    const second = new MarketDataProviderError('coingecko', 'timeout', 'Request timed out');
    const registry = registryOf(fake('stooq', { quote: () => Promise.reject(first) }), fake('coingecko', { quote: () => Promise.reject(second) }));

    await expect(registry.quote('BTC-USD')).rejects.toBe(first);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ provider: 'coingecko' });
  });

  it('returns the first empty answer when nobody has anything', async () => {
    const registry = registryOf(fake('eodhd', { search: () => Promise.resolve([]) }), fake('coingecko', { search: () => Promise.resolve([]) }));

    await expect(registry.search('nothing')).resolves.toEqual({ provider: 'eodhd', value: [] });
  });

  it('skips a provider that is not set up here without logging it', async () => {
    const registry = registryOf(fake('eodhd', { quote: () => Promise.reject(new FeatureDisabledError('Market data')) }), fake('stooq', { quote: () => Promise.resolve(quote(3)) }));

    await expect(registry.quote('AAPL')).resolves.toMatchObject({ provider: 'stooq' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports the feature as off when the only provider is not set up', async () => {
    const registry = registryOf(fake('eodhd', { quote: () => Promise.reject(new FeatureDisabledError('Market data')) }));

    await expect(registry.quote('AAPL')).rejects.toBeInstanceOf(FeatureDisabledError);
  });
});

describe('capability gaps', () => {
  const stooqLike = (calls: string[]) => fake('stooq', {
    capabilities: ['quote', 'dailyHistory'],
    covers: (symbol) => !symbol.includes('-USD'),
    quote: (symbol) => {
      calls.push(`stooq:${symbol}`);
      return Promise.resolve(quote(1));
    },
  });

  it('passes over a provider without the capability', async () => {
    const calls: string[] = [];
    const registry = registryOf(stooqLike(calls), fake('coingecko', { search: () => Promise.resolve([{ Code: 'BTC-USD', Country: '', Currency: 'USD', Exchange: 'CC', ISIN: '', Name: 'Bitcoin', Type: 'Crypto' }]) }));

    await expect(registry.search('bitcoin')).resolves.toMatchObject({ provider: 'coingecko' });
    expect(calls).toEqual([]);
  });

  it('passes over a provider that does not cover the symbol', async () => {
    const calls: string[] = [];
    const registry = registryOf(stooqLike(calls), fake('coingecko', { quote: () => Promise.resolve(quote(60_000)) }));

    await expect(registry.quote('BTC-USD')).resolves.toMatchObject({ provider: 'coingecko' });
    expect(calls).toEqual([]);
  });

  it('reports a capability no listed provider has as a disabled feature', async () => {
    const registry = registryOf(stooqLike([]));

    expect(registry.has('dividends')).toBe(false);
    expect(registry.has('quote')).toBe(true);
    await expect(registry.dividends('AAPL')).rejects.toMatchObject({ code: 'feature_disabled', status: 501 });
    await expect(registry.search('apple')).rejects.toBeInstanceOf(FeatureDisabledError);
  });

  it('reports a symbol no listed provider covers as not found', async () => {
    const registry = registryOf(stooqLike([]));

    await expect(registry.quote('BTC-USD')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('does not count a provider that is not set up towards a capability', () => {
    const registry = registryOf(fake('eodhd', { isConfigured: () => false }));

    expect(registry.has('search')).toBe(false);
  });
});

describe('the server registry, from MARKET_DATA_PROVIDERS', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses EODHD alone by default and never builds the free providers', async () => {
    vi.stubEnv('MARKET_DATA_PROVIDERS', undefined);
    vi.stubEnv('EODHD_API_KEY', 'key');
    eodhdClient.getQuote.mockResolvedValue({ ...quote(150), code: 'AAPL' });

    const registry = marketData();

    expect(registry.providers.map((provider) => provider.id)).toEqual(['eodhd']);
    await expect(registry.quote('AAPL')).resolves.toMatchObject({ provider: 'eodhd', value: { close: 150 } });
    expect(eodhdClient.getQuote).toHaveBeenCalledWith('AAPL');
    expect(isMarketDataEnabled()).toBe(true);
    expect(marketDataFeatures()).toEqual({ marketDataCapabilities: ['search', 'quote', 'dailyHistory', 'dividends', 'splits'], marketDataProviders: ['eodhd'] });
    expect(factories.stooq).not.toHaveBeenCalled();
    expect(factories.coingecko).not.toHaveBeenCalled();
  });

  it('has no market data without an EODHD key when only EODHD is listed', () => {
    vi.stubEnv('MARKET_DATA_PROVIDERS', 'eodhd');
    vi.stubEnv('EODHD_API_KEY', '');

    expect(isMarketDataEnabled()).toBe(false);
    expect(marketDataFeatures()).toEqual({ marketDataCapabilities: [], marketDataProviders: [] });
  });

  it('builds the listed providers in the listed order', () => {
    factories.stooq.mockReturnValue(fake('stooq', { capabilities: ['quote', 'dailyHistory'] }));
    factories.coingecko.mockReturnValue(fake('coingecko', { capabilities: ['search', 'quote', 'dailyHistory'] }));
    vi.stubEnv('MARKET_DATA_PROVIDERS', 'stooq,eodhd,coingecko');
    vi.stubEnv('EODHD_API_KEY', '');

    expect(marketData().providers.map((provider) => provider.id)).toEqual(['stooq', 'eodhd', 'coingecko']);
    expect(isMarketDataEnabled()).toBe(true);
    expect(marketDataFeatures()).toEqual({ marketDataCapabilities: ['search', 'quote', 'dailyHistory'], marketDataProviders: ['stooq', 'coingecko'] });
  });
});
