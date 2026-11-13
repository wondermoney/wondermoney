import eodhd from '../eodhd.service';

import type { MarketDataProvider } from './types';

/**
 * EODHD, the default provider: every call goes to the same lazily built `@wondermoney/shared`
 * client as before the registry, with the same arguments, and its answer comes back untouched.
 * Without `EODHD_API_KEY` each call throws `feature_disabled`, which the registry reads as "not
 * set up here" and moves on.
 *
 * It covers every symbol: EODHD answers for an exchange it does not list with a 404, which the
 * registry treats like any other failure. A caret index symbol (`^GSPC`, the form benchmarks use)
 * becomes EODHD's `.INDX` suffix (`GSPC.INDX`).
 */
export function createEodhdProvider(): MarketDataProvider {
  return {
    capabilities: ['search', 'quote', 'dailyHistory', 'dividends', 'splits'],
    covers: () => true,
    dailyHistory: (symbol, range) => eodhd.getEndOfDayPrices(eodhdIndexSymbol(symbol), range),
    dividends: (symbol, range) => (range ? eodhd.getDividends(symbol, range) : eodhd.getDividends(symbol)),
    id: 'eodhd',
    isConfigured: () => Boolean(process.env['EODHD_API_KEY']?.trim()),
    label: 'EODHD',
    quote: (symbol) => eodhd.getQuote(symbol),
    search: (query) => eodhd.search(query),
    splits: (symbol, range) => (range ? eodhd.getSplits(symbol, range) : eodhd.getSplits(symbol)),
  };
}

function eodhdIndexSymbol(symbol: string): string {
  return symbol.startsWith('^') ? `${symbol.slice(1)}.INDX` : symbol;
}
