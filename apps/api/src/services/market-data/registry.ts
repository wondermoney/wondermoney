import { DEFAULT_MARKET_DATA_PROVIDERS, type MarketDataProviderId, parseMarketDataProviders } from '@config/market-data-providers';
import { FeatureDisabledError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

import { createCoinGeckoProvider } from './providers/coingecko.provider';
import { createEodhdProvider } from './providers/eodhd.provider';
import { createStooqProvider } from './providers/stooq.provider';
import type { DailyBar, DateRange, DividendEvent, MarketDataCapability, MarketDataProvider, MarketQuote, SecurityMatch, SplitEvent } from './providers/types';
import { MARKET_DATA_CAPABILITIES } from './providers/types';

/**
 * The market-data registry: one place every price, search and corporate-action lookup goes
 * through, over the providers `MARKET_DATA_PROVIDERS` lists, in its order (EODHD alone by default).
 *
 * Each call goes to the first provider that has the capability and covers the symbol. When that
 * provider fails or has nothing for the symbol, the next one is asked, and so on down the list.
 * The answer says which provider gave it, so a stored price can record its source.
 *
 * - A provider that is not set up here (EODHD without a key) is skipped silently.
 * - A failure that another provider covered is logged once, as a warning. When every provider
 *   fails, the first failure is thrown for the caller to map (`handleMarketDataError`), and the
 *   others are logged.
 * - When providers answered but none had anything, the first (empty) answer is returned.
 * - No provider with the capability: `feature_disabled`. None covering the symbol: not found.
 *
 * Adding a provider: implement `MarketDataProvider` in `providers/`, add its id to
 * `config/market-data-providers.ts` and its factory below, and document it in
 * `self-hosting/configure.mdx` (en, pt and es).
 */
export const MARKET_DATA_PROVIDER_FACTORIES: Readonly<Record<MarketDataProviderId, () => MarketDataProvider>> = {
  coingecko: () => createCoinGeckoProvider(),
  eodhd: () => createEodhdProvider(),
  stooq: () => createStooqProvider(),
};

export interface MarketDataAnswer<T> {
  provider: MarketDataProviderId;
  value: T;
}

export interface MarketDataProviderStatus {
  capabilities: MarketDataCapability[];
  /** Set up on this server (EODHD has its key). */
  configured: boolean;
  id: MarketDataProviderId;
  label: string;
}

export interface MarketDataRegistry {
  dailyHistory(symbol: string, range: DateRange): Promise<MarketDataAnswer<DailyBar[]>>;
  dividends(symbol: string, range?: DateRange): Promise<MarketDataAnswer<DividendEvent[]>>;
  /** Whether a provider here, set up, can be asked for it. */
  has(capability: MarketDataCapability): boolean;
  readonly providers: readonly MarketDataProvider[];
  quote(symbol: string): Promise<MarketDataAnswer<MarketQuote>>;
  search(query: string): Promise<MarketDataAnswer<SecurityMatch[]>>;
  splits(symbol: string, range?: DateRange): Promise<MarketDataAnswer<SplitEvent[]>>;
}

const CAPABILITY_FEATURE: Record<MarketDataCapability, string> = {
  dailyHistory: 'Market data price history',
  dividends: 'Market data dividends',
  quote: 'Market data prices',
  search: 'Market data search',
  splits: 'Market data splits',
};

/** A list answer, read defensively: anything but an array is an empty one. */
const asList = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const isEmptyList = (value: readonly unknown[]) => value.length === 0;
const hasNoPrice = (quote: MarketQuote | undefined) => {
  const close: unknown = quote?.close;
  return close === null || close === undefined || !Number.isFinite(Number(close));
};

/** Build a registry over `ids`, in order. Only the listed providers are ever constructed. */
export function createMarketDataRegistry(ids: readonly MarketDataProviderId[], factories: Readonly<Record<MarketDataProviderId, () => MarketDataProvider>> = MARKET_DATA_PROVIDER_FACTORIES): MarketDataRegistry {
  const providers = ids.map((id) => factories[id]());

  async function ask<T>(capability: MarketDataCapability, symbol: null | string, call: (provider: MarketDataProvider) => Promise<T>, isEmpty: (value: T) => boolean): Promise<MarketDataAnswer<T>> {
    const capable = providers.filter((provider) => provider.capabilities.includes(capability) && provider[capability] !== undefined);
    if (capable.length === 0) throw new FeatureDisabledError(CAPABILITY_FEATURE[capability]);
    const covering = symbol === null ? capable : capable.filter((provider) => provider.covers(symbol));
    if (covering.length === 0) throw new NotFoundError('No market-data provider on this server covers this symbol');

    const failures: { error: unknown; provider: MarketDataProviderId }[] = [];
    let empty: MarketDataAnswer<T> | undefined;
    let disabled: FeatureDisabledError | undefined;
    const logFallThrough = (covered: typeof failures) => {
      for (const { error, provider } of covered) {
        logger.warn({ capability, error: describe(error), provider, symbol }, 'Market-data provider could not answer; asked the next one');
      }
    };

    for (const provider of covering) {
      try {
        const value = await call(provider);
        if (!isEmpty(value)) {
          logFallThrough(failures);
          return { provider: provider.id, value };
        }
        empty ??= { provider: provider.id, value };
      } catch (error) {
        if (error instanceof FeatureDisabledError) {
          disabled ??= error;
          continue;
        }
        failures.push({ error, provider: provider.id });
      }
    }
    const [first, ...others] = failures;
    if (first) {
      logFallThrough(others);
      throw first.error;
    }
    if (empty) return empty;
    throw disabled ?? new FeatureDisabledError(CAPABILITY_FEATURE[capability]);
  }

  // `ask` only calls a provider that has the method; the optional calls just satisfy the types.
  return {
    dailyHistory: (symbol, range) => ask('dailyHistory', symbol, async (provider) => asList<DailyBar>(await provider.dailyHistory?.(symbol, range)), isEmptyList),
    dividends: (symbol, range) => ask('dividends', symbol, async (provider) => asList<DividendEvent>(await provider.dividends?.(symbol, range)), isEmptyList),
    has: (capability) => providers.some((provider) => provider.capabilities.includes(capability) && provider.isConfigured()),
    providers,
    quote: (symbol) => ask('quote', symbol, async (provider) => await provider.quote?.(symbol), hasNoPrice) as Promise<MarketDataAnswer<MarketQuote>>,
    search: (query) => ask('search', null, async (provider) => asList<SecurityMatch>(await provider.search?.(query)), isEmptyList),
    splits: (symbol, range) => ask('splits', symbol, async (provider) => asList<SplitEvent>(await provider.splits?.(symbol, range)), isEmptyList),
  };
}

let current: undefined | { raw: string | undefined; registry: MarketDataRegistry };

/**
 * This server's registry, from `MARKET_DATA_PROVIDERS` (validated at boot by `configuration.ts`;
 * a value that somehow slips past falls back to the default rather than breaking market data).
 */
export function marketData(): MarketDataRegistry {
  const raw = process.env['MARKET_DATA_PROVIDERS'];
  if (current && current.raw === raw) return current.registry;
  const parsed = parseMarketDataProviders(raw);
  const registry = createMarketDataRegistry(parsed.ok ? parsed.ids : DEFAULT_MARKET_DATA_PROVIDERS);
  current = { raw, registry };
  return registry;
}

/**
 * Whether this server can price anything: some listed provider is set up. Without one, the
 * Financial Markets module and live portfolio pricing are off and the scheduled price jobs skip.
 */
export function isMarketDataEnabled(): boolean {
  return marketData().providers.some((provider) => provider.isConfigured());
}

/** The listed providers, in order, for the health and admin surfaces. */
export function marketDataProviderStatus(): MarketDataProviderStatus[] {
  return marketData().providers.map((provider) => ({
    capabilities: [...provider.capabilities],
    configured: provider.isConfigured(),
    id: provider.id,
    label: provider.label,
  }));
}

/** What `GET /v1/instance` reports: the set-up providers and what they can be asked together. */
export function marketDataFeatures(): { marketDataCapabilities: MarketDataCapability[]; marketDataProviders: MarketDataProviderId[] } {
  const registry = marketData();
  return {
    marketDataCapabilities: MARKET_DATA_CAPABILITIES.filter((capability) => registry.has(capability)),
    marketDataProviders: registry.providers.filter((provider) => provider.isConfigured()).map((provider) => provider.id),
  };
}

/** A provider's display name, for the places that show where a price came from. */
export function marketDataProviderLabel(id: MarketDataProviderId): string {
  return { coingecko: 'CoinGecko', eodhd: 'EODHD', stooq: 'Stooq' }[id];
}

function describe(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const { code, status } = error as Error & { code?: unknown; status?: unknown };
  return { code, message: error.message, name: error.name, status };
}
