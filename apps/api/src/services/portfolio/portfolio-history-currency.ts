import type { CurrencyPair, RateTable } from '@service/currency/exchange-rate';
import { Money } from '@utils/money';

/** One portfolio's value on one day, in the currency it was stored in (null when that is unknown). */
export interface PortfolioSnapshotValue {
  currencyCode: null | string;
  /** `yyyy-MM-dd`. */
  date: string;
  value: number;
}

export interface ViewerCurrencyHistory {
  dataPoints: { date: string; value: number }[];
  /** Days that left out at least one snapshot because it could not be converted, in date order. */
  incompleteDates: string[];
}

/**
 * The daily portfolio history in the viewer's currency. A snapshot is stored in its owner's
 * currency, and household members can keep different ones, so each snapshot is converted at the
 * rate in force at the end of its day before the day is totalled. A snapshot with no rate is left
 * out and its day flagged, never added at face value; a day with nothing left has no point.
 */
export function historyInViewerCurrency(snapshots: PortfolioSnapshotValue[], viewerCurrency: string, rates: RateTable): ViewerCurrencyHistory {
  const byDate = new Map<string, { complete: boolean; values: Money[] }>();
  for (const snapshot of snapshots) {
    const day = byDate.get(snapshot.date) ?? { complete: true, values: [] };
    byDate.set(snapshot.date, day);
    const converted = convertAtCloseOf(snapshot, viewerCurrency, rates);
    if (converted) day.values.push(converted);
    else day.complete = false;
  }

  const dataPoints: ViewerCurrencyHistory['dataPoints'] = [];
  const incompleteDates: string[] = [];
  for (const [date, day] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!day.complete) incompleteDates.push(date);
    if (day.values.length > 0) dataPoints.push({ date, value: Money.toNumber(Money.sum(day.values, viewerCurrency)) });
  }
  return { dataPoints, incompleteDates };
}

/** The pairs {@link historyInViewerCurrency} converts through, for `loadRateTable`. */
export function historyRatePairs(snapshots: PortfolioSnapshotValue[], viewerCurrency: string): CurrencyPair[] {
  const currencies = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshot.currencyCode && snapshot.currencyCode !== viewerCurrency) currencies.add(snapshot.currencyCode);
  }
  return [...currencies].map((from) => ({ from, to: viewerCurrency }));
}

/** The fields of a stored snapshot that say what it was worth and in which currency. */
export interface StoredPortfolioSnapshot {
  appuserCurrencyKey?: null | { code?: null | string };
  appuserCurrencyTotalValue?: null | number;
  currencyKey?: null | { code?: null | string };
  snapshotDate: Date | string;
  totalValue?: null | number;
}

/**
 * A stored snapshot's value and the currency it is in: the owner-currency value in the currency
 * recorded with it (the owner's when none was recorded), else the portfolio-currency value. Null
 * currency when the snapshot holds no value at all. The SQL in `loadHistoryInViewerCurrency` reads
 * snapshots the same way.
 */
export function storedSnapshotValue(snapshot: StoredPortfolioSnapshot, ownerCurrency: null | string | undefined): PortfolioSnapshotValue {
  const date = typeof snapshot.snapshotDate === 'string' ? snapshot.snapshotDate.slice(0, 10) : snapshot.snapshotDate.toISOString().slice(0, 10);
  if (snapshot.appuserCurrencyTotalValue != null) {
    return { currencyCode: snapshot.appuserCurrencyKey?.code ?? ownerCurrency ?? null, date, value: snapshot.appuserCurrencyTotalValue };
  }
  if (snapshot.totalValue != null) return { currencyCode: snapshot.currencyKey?.code ?? null, date, value: snapshot.totalValue };
  return { currencyCode: null, date, value: 0 };
}

/**
 * One snapshot in the viewer's currency, at the rate in force at the end of its day; null when it
 * cannot be converted (no currency, or no rate), never its value at face value.
 */
export function snapshotInViewerCurrency(snapshot: PortfolioSnapshotValue, viewerCurrency: string, rates: RateTable): null | number {
  const converted = convertAtCloseOf(snapshot, viewerCurrency, rates);
  return converted ? Money.toNumber(converted) : null;
}

function convertAtCloseOf(snapshot: PortfolioSnapshotValue, viewerCurrency: string, rates: RateTable): Money | null {
  if (!snapshot.currencyCode) return null;
  const closeOfDay = new Date(`${snapshot.date}T23:59:59.999Z`);
  const rate = rates.rateOn(snapshot.currencyCode, viewerCurrency, closeOfDay);
  if (rate == null) return null;
  return Money.convert(Money.of(snapshot.value, snapshot.currencyCode), { rate, to: viewerCurrency });
}
