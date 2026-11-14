/**
 * Small, synthetic provider responses in each provider's wire format, written by hand to the
 * shape of the documented endpoints (no recorded market data). The numbers are made up.
 */

/** `GET stooq.com/q/d/l/?s=wmtest.us&i=d&d1=…&d2=…`, oldest first. */
export const STOOQ_DAILY_CSV = [
  'Date,Open,High,Low,Close,Volume',
  '2026-03-02,100.5,102,99.75,101.25,120000',
  '2026-03-03,101.25,103.5,100,103,98000',
  '2026-03-04,103,103.25,101,102,87500',
  '',
].join('\r\n');

/** An index has no volume column. */
export const STOOQ_INDEX_CSV = [
  'Date,Open,High,Low,Close',
  '2026-03-03,5000,5050,4990,5040.5',
  '2026-03-04,5040.5,5060,5010,5020',
].join('\n');

/** Stooq's answer for a symbol it does not have. */
export const STOOQ_NO_DATA = 'No data';

/** Stooq's answer once the daily request budget is spent. */
export const STOOQ_LIMIT_REACHED = 'Exceeded the daily hits limit';

/** `GET api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur&include_24hr_change=true&…`. */
export const COINGECKO_SIMPLE_PRICE = {
  bitcoin: {
    eur: 50_000,
    eur_24h_change: 25,
    eur_24h_vol: 1_250_000,
    last_updated_at: 1_772_582_400,
  },
};

/**
 * `GET api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=…&to=…`.
 * Prices are `[unix ms, price]`; two points fall on 2026-03-03, one on 2026-03-04.
 */
export const COINGECKO_MARKET_CHART = {
  market_caps: [[1_772_496_000_000, 1], [1_772_539_200_000, 1], [1_772_582_400_000, 1]],
  prices: [
    [1_772_496_000_000, 40_000],
    [1_772_539_200_000, 41_000],
    [1_772_582_400_000, 42_000.5],
  ],
  total_volumes: [
    [1_772_496_000_000, 900],
    [1_772_539_200_000, 950],
    [1_772_582_400_000, 1000],
  ],
};

/** `GET api.coingecko.com/api/v3/search?query=wmcoin`; lower `market_cap_rank` is bigger. */
export const COINGECKO_SEARCH = {
  categories: [],
  coins: [
    { api_symbol: 'wm-coin-small', id: 'wm-coin-small', large: '', market_cap_rank: 900, name: 'Small WM Coin', symbol: 'WMC', thumb: '' },
    { api_symbol: 'wm-coin', id: 'wm-coin', large: '', market_cap_rank: 120, name: 'WM Coin', symbol: 'wmc', thumb: '' },
    { api_symbol: 'wm-other', id: 'wm-other', large: '', market_cap_rank: null, name: 'WM Other', symbol: 'WMO', thumb: '' },
  ],
  exchanges: [],
  icos: [],
  nfts: [],
};
