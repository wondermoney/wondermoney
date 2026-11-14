import { marketData, type MarketDataRegistry } from '@service/market-data/registry';
import { FeatureDisabledError } from '@utils/errors';
import logger from '@utils/logger';

/**
 * Token prices for crypto wallets, in US dollars, from the market-data registry
 * (`services/market-data/registry.ts`) as `<SYMBOL>-USD.CC`: EODHD's crypto form, which the
 * CoinGecko adapter reads too. A token is priced by its symbol, so an airdropped token that
 * borrows a well-known symbol would be priced as that coin: that is why detected tokens count
 * only once the person ticks them.
 *
 * No price is `null`, never 0: the caller decides what an unpriced holding means.
 */
export interface TokenPrices {
  usd(symbol: string): Promise<null | number>;
}

const PRICEABLE_SYMBOL = /^[A-Z0-9]{1,15}$/u;

export function registryTokenPrices(registry: MarketDataRegistry = marketData()): TokenPrices {
  const cache = new Map<string, Promise<null | number>>();
  const lookup = async (symbol: string): Promise<null | number> => {
    try {
      const { value } = await registry.quote(`${symbol}-USD.CC`);
      const close = Number(value.close);
      return value.close !== null && Number.isFinite(close) && close > 0 ? close : null;
    } catch (error) {
      if (!(error instanceof FeatureDisabledError)) {
        logger.warn({ error: error instanceof Error ? { message: error.message, name: error.name } : String(error), symbol }, 'No price for a crypto wallet token');
      }
      return null;
    }
  };
  return {
    usd(symbol) {
      const key = symbol.trim().toUpperCase();
      if (!PRICEABLE_SYMBOL.test(key)) return Promise.resolve(null);
      let price = cache.get(key);
      if (!price) {
        price = lookup(key);
        cache.set(key, price);
      }
      return price;
    },
  };
}
