import { big, roundMoney } from '@utils/money';

/**
 * What a manually valued asset is worth on a date.
 *
 * The value is the latest valuation on or before that date. Valuations are whole days (UTC): one
 * recorded on a day counts for all of that day. With a growth rule the value compounds yearly
 * from that valuation (or from the rule's start date, when that is later) by days over 365, until
 * a newer valuation replaces it. An asset has no value before its first valuation, and none from
 * the day it was archived.
 */
export interface AssetGrowthRule {
  /** Percent a year; negative depreciates. */
  annualRatePercent: number;
  /** The value stays flat until this day. */
  startDate?: Date | null;
}

export interface AssetValuationPoint {
  date: Date;
  /** Breaks a tie between two valuations on one day: the higher key is the newer record. */
  key?: number;
  value: number;
}

export interface AssetValueSeriesPoint {
  date: string;
  value: number;
}

export interface ValuedAsset {
  archivedAt?: Date | null;
  growthRule?: AssetGrowthRule | null;
  valuations: AssetValuationPoint[];
}

const DAY_MS = 86_400_000;
const DAYS_IN_YEAR = 365;

/**
 * The points a value chart draws: each valuation, today (or the last day before the asset was
 * archived), and with a growth rule every month end in between, since the value moves there.
 */
export function buildValueSeries(asset: ValuedAsset, today: Date): AssetValueSeriesPoint[] {
  const lastDay = asset.archivedAt && utcDay(asset.archivedAt) <= utcDay(today) ? utcDay(asset.archivedAt) - DAY_MS : utcDay(today);
  const valuationDays = asset.valuations.map((valuation) => utcDay(valuation.date)).filter((time) => time <= lastDay);
  if (valuationDays.length === 0) return [];
  const firstDay = Math.min(...valuationDays);

  const days = new Set<number>([...valuationDays, lastDay]);
  if (asset.growthRule) {
    for (let monthEnd = endOfUtcMonth(firstDay); monthEnd < lastDay; monthEnd = endOfUtcMonth(monthEnd + DAY_MS)) days.add(monthEnd);
  }

  const series: AssetValueSeriesPoint[] = [];
  for (const time of [...days].sort((a, b) => a - b)) {
    const value = valueOn(asset, new Date(time));
    if (value != null) series.push({ date: new Date(time).toISOString().slice(0, 10), value });
  }
  return series;
}

/** The valuation in force on `date`: the latest one on or before it. */
export function latestValuationOn<T extends AssetValuationPoint>(valuations: T[], date: Date): T | undefined {
  const day = utcDay(date);
  let latest: T | undefined;
  for (const valuation of valuations) {
    const time = utcDay(valuation.date);
    if (time > day) continue;
    if (!latest) {
      latest = valuation;
      continue;
    }
    const latestTime = utcDay(latest.date);
    if (time > latestTime || (time === latestTime && (valuation.key ?? 0) > (latest.key ?? 0))) latest = valuation;
  }
  return latest;
}

/** The asset's value on `date` in its own currency, or null when it has none on that date. */
export function valueOn(asset: ValuedAsset, date: Date): null | number {
  const day = utcDay(date);
  if (asset.archivedAt && day >= utcDay(asset.archivedAt)) return null;
  const valuation = latestValuationOn(asset.valuations, date);
  if (!valuation) return null;
  if (!asset.growthRule) return roundMoney(valuation.value);

  const growsFrom = Math.max(utcDay(valuation.date), asset.growthRule.startDate ? utcDay(asset.growthRule.startDate) : -Infinity);
  const days = Math.round((day - growsFrom) / DAY_MS);
  if (days <= 0) return roundMoney(valuation.value);
  const factor = (1 + asset.growthRule.annualRatePercent / 100) ** (days / DAYS_IN_YEAR);
  return roundMoney(big(valuation.value).times(big(factor)));
}

function endOfUtcMonth(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
}

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
