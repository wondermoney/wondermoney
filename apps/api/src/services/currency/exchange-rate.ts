import type { EntityManager } from '@mikro-orm/core';

import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { ExchangeRateOverride } from '@entity/ExchangeRateOverride';
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

export type RateSource = 'ecb' | 'override' | 'same-currency';

/** A stored rate found for a conversion. */
export interface ResolvedRate {
  rate: number;
  rateDate: Date;
  /**
   * `ecb` for a feed rate; `override` for one the household set itself (`ExchangeRateOverride`);
   * `same-currency` when nothing needs converting.
   */
  source: RateSource;
  /** `provisional` when the rate is older than the staleness window. */
  status: FxStatus.EXACT | FxStatus.PROVISIONAL;
}

/**
 * Whose rates a conversion may use: the feed's, plus the overrides of this one household. Always
 * explicit, never read from the request: workers run with no tenant filter, and an override of one
 * household must never convert another's money.
 */
export interface RateScope {
  /** Null only through {@link FEED_RATES_ONLY}. */
  tenantKey: null | number;
}

/**
 * Feed rates and no household's overrides. For portfolio valuations, which still convert through
 * the feed alone (the snapshot job reads `ExchangeRate` directly), so every portfolio figure agrees.
 */
export const FEED_RATES_ONLY: RateScope = Object.freeze({ tenantKey: null });

/** The scope for a household, given its key or a (possibly unloaded) `Tenant` reference. */
export function rateScope(tenant: number | { tenantKey: number }): RateScope {
  return { tenantKey: typeof tenant === 'number' ? tenant : tenant.tenantKey };
}

/** A rate older than this many days before the date it converts for is provisional. */
export const FX_STALE_AFTER_DAYS = 7;

/**
 * Convert `amount` from one currency to another at the rate for `date`, through
 * {@link resolveExchangeRate} and {@link convertMoney}. With no rate it stores nothing: the amount
 * is null and the status `missing`. It never falls back to the unconverted amount.
 */
export async function convertWithStatus(em: EntityManager, amount: number, from: Currency, to: Currency, date: Date, scope: RateScope): Promise<FxConversion> {
  return conversionAt(amount, await resolveExchangeRate(em, from, to, date, scope));
}

/** The conversion a resolved rate gives `amount`; `missing` with no rate. */
export function conversionAt(amount: number, resolved: null | ResolvedRate): FxConversion {
  if (!resolved) return { amount: null, fxStatus: FxStatus.MISSING, rate: null };
  return {
    amount: resolved.source === 'same-currency' ? amount : convertMoney(amount, resolved.rate),
    fxStatus: resolved.status,
    rate: resolved.source === 'same-currency' ? null : resolved.rate,
  };
}

/** A rate on the timeline: its value, where it came from and its day (ms since epoch). */
interface DatedRate {
  rate: number;
  source: 'ecb' | 'override';
  time: number;
}

/**
 * The one place a conversion rate is chosen. The feed's rates and the household's overrides form
 * one dated timeline per pair: the latest rate on or before `date` wins, and an override wins over
 * a feed rate of the same day. So an override corrects its own day and carries forward only until
 * the feed (or a later override) has a newer rate; for a pair the feed does not cover it carries
 * forward until the next override. Null when neither has a rate. It never returns 1 for two
 * different currencies. A rate more than `staleAfterDays` older than `date` is `provisional`.
 */
export async function resolveExchangeRate(em: EntityManager, from: Currency, to: Currency, date: Date, scope: RateScope & { staleAfterDays?: number }): Promise<null | ResolvedRate> {
  if (isSameCurrency(from, to)) return { rate: 1, rateDate: date, source: 'same-currency', status: FxStatus.EXACT };
  const { tenantKey } = scope;
  const [feed, override] = await Promise.all([
    em.findOne(ExchangeRate, { date: { $lte: date }, fromCurrency: from, toCurrency: to }, { orderBy: { date: 'desc' } }),
    tenantKey == null
      ? null
      : em.findOne(ExchangeRateOverride, { date: { $lte: date }, deletedAt: null, fromCurrency: from, tenantKey: { tenantKey }, toCurrency: to }, { filters: false, orderBy: { date: 'desc' } }),
  ]);
  const chosen = latestOf(feed && datedRate(feed, 'ecb'), override && datedRate(override, 'override'));
  return chosen ? toResolved(chosen, date, scope.staleAfterDays) : null;
}

function datedRate(row: { date: Date; rate: number }, source: DatedRate['source']): DatedRate {
  return { rate: row.rate, source, time: new Date(row.date).getTime() };
}

function isSameCurrency(a: Currency, b: Currency): boolean {
  if (a.code && b.code) return a.code === b.code;
  return a.currencyKey === b.currencyKey;
}

/** The later of two rates; on the same day the override. */
function latestOf(feed: DatedRate | null, override: DatedRate | null): DatedRate | null {
  if (!feed) return override;
  if (!override) return feed;
  return override.time >= feed.time ? override : feed;
}

function toResolved(rate: DatedRate, date: Date, staleAfterDays = FX_STALE_AFTER_DAYS): ResolvedRate {
  return {
    rate: rate.rate,
    rateDate: new Date(rate.time),
    source: rate.source,
    status: date.getTime() - rate.time > staleAfterDays * 86_400_000 ? FxStatus.PROVISIONAL : FxStatus.EXACT,
  };
}

/**
 * Convert a value at the rate {@link resolveExchangeRate} picks for `date` (feed rates exist for
 * business days only, so a weekend or holiday takes the previous business day's). Returns the
 * value itself for the same currency, null when no rate is stored.
 */
export async function convertAtLatestRate(em: EntityManager, value: number, fromCurrency: Currency, toCurrency: Currency, date: Date, scope: RateScope): Promise<null | number> {
  if (fromCurrency.currencyKey === toCurrency.currencyKey) return value;
  const resolved = await resolveExchangeRate(em, fromCurrency, toCurrency, date, scope);
  return resolved ? roundDisplay(big(value).times(big(resolved.rate))) : null;
}

/**
 * The stored rates for a few currency pairs over a window, the feed's and one household's
 * overrides, loaded once so a report can convert thousands of rows without a query per row. It
 * answers exactly as {@link resolveExchangeRate} would.
 */
export interface RateTable {
  /**
   * The rate for `from` → `to` on `date` (see {@link resolveExchangeRate}), or null when none is
   * stored. The same currency is always 1. Never an implied rate for two different currencies.
   */
  rateOn(from: string, to: string, date: Date): null | number;
}

/** A {@link RateTable} that also says, like the resolver, which rate it took and how fresh it is. */
export interface ResolvingRateTable extends RateTable {
  /** The rate with its date, source and status; `same-currency` within one currency. */
  resolve(from: string, to: string, date: Date): null | ResolvedRate;
}

/**
 * Load every rate for `pairs` dated inside `window`, plus the last one before it (a transaction on
 * the window's first day takes the previous business day's rate), from the feed and from the
 * household's live overrides.
 */
export async function loadRateTable(em: EntityManager, pairs: CurrencyPair[], window: { from: Date; to: Date }, scope: RateScope): Promise<ResolvingRateTable> {
  const byPair = new Map<string, DatedRate[]>();
  const distinct = new Map<string, CurrencyPair>();
  for (const pair of pairs) if (pair.from !== pair.to) distinct.set(pairKey(pair.from, pair.to), pair);

  await Promise.all([...distinct.entries()].map(async ([key, pair]) => {
    const where = { fromCurrency: { code: pair.from }, toCurrency: { code: pair.to } };
    const [inWindow, before, overrides] = await Promise.all([
      em.find(ExchangeRate, { ...where, date: { $gte: window.from, $lte: window.to } }, { orderBy: { date: 'asc' } }),
      em.findOne(ExchangeRate, { ...where, date: { $lt: window.from } }, { orderBy: { date: 'desc' } }),
      scope.tenantKey == null ? [] : loadOverrides(em, pair, window, scope.tenantKey),
    ]);
    // One timeline: an override replaces the feed rate of its own day.
    const byTime = new Map<number, DatedRate>();
    for (const row of before ? [before, ...inWindow] : inWindow) {
      const rate = datedRate(row, 'ecb');
      byTime.set(rate.time, rate);
    }
    for (const row of overrides) {
      const rate = datedRate(row, 'override');
      byTime.set(rate.time, rate);
    }
    byPair.set(key, [...byTime.values()].sort((a, b) => a.time - b.time));
  }));

  const resolve = (from: string, to: string, date: Date): null | ResolvedRate => {
    if (from === to) return { rate: 1, rateDate: date, source: 'same-currency', status: FxStatus.EXACT };
    const rates = byPair.get(pairKey(from, to));
    if (!rates || rates.length === 0) return null;
    const found = latestOnOrBefore(rates, date.getTime());
    return found ? toResolved(found, date) : null;
  };

  return {
    rateOn(from, to, date) {
      return resolve(from, to, date)?.rate ?? null;
    },
    resolve,
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

/** The household's live overrides for `pair` inside `window`, plus the last one before it. */
async function loadOverrides(em: EntityManager, pair: CurrencyPair, window: { from: Date; to: Date }, tenantKey: number): Promise<ExchangeRateOverride[]> {
  // Filters off: the explicit tenant below is the scope, request or worker alike.
  const where = { deletedAt: null, fromCurrency: { code: pair.from }, tenantKey: { tenantKey }, toCurrency: { code: pair.to } };
  const [inWindow, before] = await Promise.all([
    em.find(ExchangeRateOverride, { ...where, date: { $gte: window.from, $lte: window.to } }, { filters: false, orderBy: { date: 'asc' } }),
    em.findOne(ExchangeRateOverride, { ...where, date: { $lt: window.from } }, { filters: false, orderBy: { date: 'desc' } }),
  ]);
  return before ? [before, ...inWindow] : inWindow;
}

function pairKey(from: string, to: string) {
  return `${from}>${to}`;
}
