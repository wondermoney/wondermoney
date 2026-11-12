/**
 * `MARKET_DATA_PROVIDERS`: the market-data providers this server asks, in order. Pure, so the
 * boot-time configuration check (`configuration.ts`) and the registry
 * (`services/market-data/registry.ts`) read the variable the same way.
 *
 * Unset or empty means EODHD alone, which is how every install ran before the registry existed.
 * The free providers (Stooq, CoinGecko) run only when an operator lists them: their terms of use
 * are the operator's to accept.
 */
export const MARKET_DATA_PROVIDER_IDS = ['eodhd', 'stooq', 'coingecko'] as const;

export type MarketDataProviderId = (typeof MARKET_DATA_PROVIDER_IDS)[number];

export const DEFAULT_MARKET_DATA_PROVIDERS: readonly MarketDataProviderId[] = ['eodhd'];

export type MarketDataProvidersParse =
  | { error: string; ok: false }
  | { ids: readonly MarketDataProviderId[]; ok: true };

export const isMarketDataProviderId = (value: unknown): value is MarketDataProviderId => typeof value === 'string' && (MARKET_DATA_PROVIDER_IDS as readonly string[]).includes(value);

/** A comma-separated, ordered list of provider ids, each at most once. */
export function parseMarketDataProviders(raw: string | undefined): MarketDataProvidersParse {
  const items = (raw ?? '').split(',').map((item) => item.trim().toLowerCase()).filter((item) => item !== '');
  if (items.length === 0) return { ids: DEFAULT_MARKET_DATA_PROVIDERS, ok: true };
  const unknown = items.filter((item) => !isMarketDataProviderId(item));
  if (unknown.length > 0) {
    return { error: `MARKET_DATA_PROVIDERS names unknown providers (${unknown.join(', ')}); use a comma-separated list of ${MARKET_DATA_PROVIDER_IDS.join(', ')}`, ok: false };
  }
  const repeated = items.filter((item, index) => items.indexOf(item) !== index);
  if (repeated.length > 0) {
    return { error: `MARKET_DATA_PROVIDERS lists ${[...new Set(repeated)].join(', ')} more than once`, ok: false };
  }
  return { ids: items as MarketDataProviderId[], ok: true };
}
