import type { EntityManager } from '@mikro-orm/core';

import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus } from '@entity/Transaction';
import { big, convertMoney, roundDisplay } from '@utils/money';

export interface CurrencyPair {
  from: string;
  to: string;
}

/** A converted amount, with how it was converted. `amount` and `rate` are null when no rate exists. */
export interface FxConversion {
  amount: null | number;
  fxStatus: FxStatus;
  rate: null | number;
}

/** A stored rate found for a conversion. */
export interface ResolvedRate {
  rate: number;
  rateDate: Date;
  /** `ecb` for a stored feed rate; `same-currency` when nothing needs converting. */
  source: 'ecb' | 'same-currency';
  /** `provisional` when the rate is older than the staleness window. */
  status: FxStatus.EXACT | FxStatus.PROVISIONAL;
}

/** A rate older than this many days before the date it converts for is provisional. */
export const FX_STALE_AFTER_DAYS = 7;

/**
 * Convert `amount` from one currency to another at the rate for `date`, through
 * {@link resolveExchangeRate} and {@link convertMoney}. With no rate it stores nothing: the amount
 * is null and the status `missing`. It never falls back to the unconverted amount.
 */
export async function convertWithStatus(em: EntityManager, amount: number, from: Currency, to: Currency, date: Date): Promise<FxConversion> {
  const resolved = await resolveExchangeRate(em, from, to, date);
  if (!resolved) return { amount: null, fxStatus: FxStatus.MISSING, rate: null };
  return {
    amount: resolved.source === 'same-currency' ? amount : convertMoney(amount, resolved.rate),
    fxStatus: resolved.status,
    rate: resolved.source === 'same-currency' ? null : resolved.rate,
  };
}

/**
 * The one place a conversion rate is chosen: the latest stored rate on or before `date`, or null
 * when none is stored. It never returns 1 for two different currencies. A rate more than
 * `staleAfterDays` older than `date` is returned as `provisional`.
 */
export async function resolveExchangeRate(em: EntityManager, from: Currency, to: Currency, date: Date, options: { staleAfterDays?: number } = {}): Promise<null | ResolvedRate> {
  if (isSameCurrency(from, to)) return { rate: 1, rateDate: date, source: 'same-currency', status: FxStatus.EXACT };
  const row = await em.findOne(ExchangeRate, { date: { $lte: date }, fromCurrency: from, toCurrency: to }, { orderBy: { date: 'desc' } });
  if (!row) return null;
  const rateDate = new Date(row.date);
  const staleAfterMs = (options.staleAfterDays ?? FX_STALE_AFTER_DAYS) * 86_400_000;
  return {
    rate: row.rate,
    rateDate,
    source: 'ecb',
    status: date.getTime() - rateDate.getTime() > staleAfterMs ? FxStatus.PROVISIONAL : FxStatus.EXACT,
  };
}

function isSameCurrency(a: Currency, b: Currency): boolean {
  if (a.code && b.code) return a.code === b.code;
  return a.currencyKey === b.currencyKey;
}

/**
 * Convert a value at the latest rate published on or before `date` (ECB rates exist for business
 * days only, so a weekend or holiday takes the previous business day's). Returns the value itself
 * for the same currency, null when no such rate is stored.
 */
export async function convertAtLatestRate(em: EntityManager, value: number, fromCurrency: Currency, toCurrency: Currency, date: Date): Promise<null | number> {
  if (fromCurrency.currencyKey === toCurrency.currencyKey) return value;
  const exchangeRate = await em.findOne(ExchangeRate, { date: { $lte: date }, fromCurrency, toCurrency }, { orderBy: { date: 'desc' } });
  return exchangeRate ? roundDisplay(big(value).times(big(exchangeRate.rate))) : null;
}

/**
 * The stored rates for a few currency pairs over a window, loaded once so a report can convert
 * thousands of rows without a query per row.
 */
export interface RateTable {
  /**
   * The latest rate published on or before `date` for `from` → `to`, or null when none is stored.
   * The same currency is always 1. Never an implied rate for two different currencies.
   */
  rateOn(from: string, to: string, date: Date): null | number;
}

interface DatedRate {
  rate: number;
  time: number;
}

/**
 * Load every rate for `pairs` dated inside `window`, plus the last one before it (a transaction on
 * the window's first day takes the previous business day's rate).
 */
export async function loadRateTable(em: EntityManager, pairs: CurrencyPair[], window: { from: Date; to: Date }): Promise<RateTable> {
  const byPair = new Map<string, DatedRate[]>();
  const distinct = new Map<string, CurrencyPair>();
  for (const pair of pairs) if (pair.from !== pair.to) distinct.set(pairKey(pair.from, pair.to), pair);

  await Promise.all([...distinct.entries()].map(async ([key, pair]) => {
    const where = { fromCurrency: { code: pair.from }, toCurrency: { code: pair.to } };
    const [inWindow, before] = await Promise.all([
      em.find(ExchangeRate, { ...where, date: { $gte: window.from, $lte: window.to } }, { orderBy: { date: 'asc' } }),
      em.findOne(ExchangeRate, { ...where, date: { $lt: window.from } }, { orderBy: { date: 'desc' } }),
    ]);
    const rows = before ? [before, ...inWindow] : inWindow;
    byPair.set(key, rows.map((row) => ({ rate: row.rate, time: new Date(row.date).getTime() })));
  }));

  return {
    rateOn(from, to, date) {
      if (from === to) return 1;
      const rates = byPair.get(pairKey(from, to));
      if (!rates || rates.length === 0) return null;
      return latestOnOrBefore(rates, date.getTime())?.rate ?? null;
    },
  };
}

function latestOnOrBefore(rates: DatedRate[], time: number): DatedRate | undefined {
  let low = 0;
  let high = rates.length - 1;
  let found: DatedRate | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = rates[middle];
    if (!candidate) break;
    if (candidate.time <= time) {
      found = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function pairKey(from: string, to: string) {
  return `${from}>${to}`;
}
