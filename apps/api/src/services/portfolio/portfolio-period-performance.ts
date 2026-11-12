import { QueryOrder } from '@mikro-orm/core';
import { format } from 'date-fns';
import { sql } from 'kysely';

import { DI } from '@app/database/di';
import { anyOf, sqlQuery, toDate } from '@app/database/sql';
import type { Appuser } from '@entity/Appuser';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import { FEED_RATES_ONLY, loadRateTable, type RateTable } from '@service/currency/exchange-rate';
import { big, Money, roundDisplay, sumMoney } from '@utils/money';

import { historyRatePairs, type PortfolioSnapshotValue, snapshotInViewerCurrency, storedSnapshotValue } from './portfolio-history-currency';
import { type InvestmentCashFlow, MIN_ANNUALIZED_RETURN_DAYS, solveXirr } from './portfolio-metrics.utils';

export interface MeasurePortfolioPeriodInput {
  end: PeriodEnd;
  /** In the viewer's currency ({@link loadCashFlowsInViewerCurrency}). */
  flows: PeriodCashFlow[];
  fromDate: Date;
  startSnapshot: null | SnapshotPoint;
}

/**
 * A buy, sale or dividend in the viewer's currency. `amount` is null when it cannot be: no rate
 * converts the currency it was recorded in, or that currency is unknown.
 */
export interface PeriodCashFlow {
  amount: null | number;
  date: Date;
  kind: InvestmentCashFlow['kind'];
}

export type PeriodEnd =
  | (SnapshotPoint & { kind: 'snapshot' })
  | { kind: 'live'; value: number }
  | { kind: 'unknown'; toDate: Date };

/**
 * How a portfolio did over a period, net of the money put in or taken out. The portfolio
 * performance report and the dashboards' period return both read it, so they agree.
 *
 * - `startValue`: the start snapshot's value. 0 when there is no snapshot and nothing was traded
 *   before the period (the portfolio did not exist yet); null when it held something but there is
 *   no snapshot to say what it was worth, or the snapshot has no rate into the viewer's currency.
 * - `endValue`: the live value, or the end snapshot's value for a period that has ended. Null when
 *   a past period has no snapshot but the portfolio held something.
 * - `netContributions`: buys (with fees) minus sales (net of fees) between the two values. A
 *   portfolio's cash is an asset, so deposits and withdrawals are buys and sales of it. Null when
 *   one of those trades has no amount in the viewer's currency.
 * - `dividends`: paid between the two values; null when one has no amount in the viewer's currency.
 * - `change`: what the market did, `endValue - startValue - netContributions`.
 * - `changePercent`: `change` as a % of `startValue + netContributions`, when that is positive.
 */
export interface PortfolioPeriodMeasure {
  change: null | number;
  changePercent: null | number;
  dividends: null | number;
  endValue: null | number;
  netContributions: null | number;
  startValue: null | number;
  /** Whether anything was traded or paid out inside the period. */
  hadActivity: boolean;
}

/**
 * A snapshot's UTC calendar day (`YYYY-MM-DD`) and value in the viewer's currency: it holds every
 * trade up to the end of that day. A null value is a snapshot that could not be converted into the
 * viewer's currency; the period it bounds cannot be measured.
 */
export interface SnapshotPoint {
  day: string;
  value: null | number;
}

const isTrade = (flow: PeriodCashFlow) => flow.kind === 'BUY' || flow.kind === 'SELL';

export function utcDay(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/**
 * Each flow in the viewer's currency, at the latest rate on or before its own date. A flow with no
 * rate, or no recorded currency, has no amount: it is never read at face value.
 */
export function cashFlowsInViewerCurrency(flows: InvestmentCashFlow[], viewerCurrency: string, rates: RateTable): PeriodCashFlow[] {
  return flows.map((flow) => {
    const { currencyCode, date, kind } = flow;
    if (!currencyCode) return { amount: null, date, kind };
    if (currencyCode === viewerCurrency) return { amount: flow.amount, date, kind };
    const rate = rates.rateOn(currencyCode, viewerCurrency, date);
    return { amount: rate == null ? null : Money.toNumber(Money.convert(Money.of(flow.amount, currencyCode), { rate, to: viewerCurrency })), date, kind };
  });
}

/**
 * The flows {@link measurePortfolioPeriod} needs, in the viewer's currency. Only flows on or after
 * `since` are converted (the period's start, or its start snapshot's day when that is earlier): an
 * earlier flow is already in the start value, its date is all the measure reads, and it is
 * returned with no amount.
 */
export async function loadCashFlowsInViewerCurrency(flows: InvestmentCashFlow[], viewerCurrency: string, since: Date): Promise<PeriodCashFlow[]> {
  const needed = flows.filter((flow) => flow.date.getTime() >= since.getTime());
  const foreign = needed.filter((flow) => flow.currencyCode && flow.currencyCode !== viewerCurrency);
  const times = foreign.map((flow) => flow.date.getTime());
  const window = times.length === 0 ? { from: since, to: since } : { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) };
  const rates = await loadRateTable(DI.em, foreign.map((flow) => ({ from: flow.currencyCode ?? '', to: viewerCurrency })), window, FEED_RATES_ONLY);
  const converted = cashFlowsInViewerCurrency(needed, viewerCurrency, rates);
  const earlier = flows.filter((flow) => flow.date.getTime() < since.getTime()).map((flow) => ({ amount: null, date: flow.date, kind: flow.kind }));
  return [...earlier, ...converted];
}

/** The viewer's currency code, loading the currency when the request's user carries only its key. */
export async function resolveViewerCurrency(appuser: Appuser): Promise<string> {
  if (!appuser.currencyKey.code) await DI.em.populate(appuser, ['currencyKey']);
  const code = appuser.currencyKey.code;
  if (!code) throw new Error('Appuser currency relation did not resolve to a currency code');
  return code;
}

/** The earliest moment a period's flows count from: its start, or the start snapshot's day if earlier. */
export function periodFlowsSince(fromDate: Date, startSnapshot: null | SnapshotPoint): Date {
  if (!startSnapshot) return fromDate;
  const snapshotDay = new Date(`${startSnapshot.day}T00:00:00.000Z`);
  return snapshotDay.getTime() < fromDate.getTime() ? snapshotDay : fromDate;
}

function changeOf(startValue: null | number, netContributions: null | number, endValue: null | number) {
  if (startValue == null || endValue == null || netContributions == null) return { change: null, changePercent: null };
  const invested = big(startValue).plus(netContributions);
  const change = roundDisplay(big(endValue).minus(invested));
  const changePercent = invested.gt(0) ? roundDisplay(big(change).div(invested).times(100)) : null;
  return { change, changePercent };
}

function startOfNextUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

/** The sum of `flows`' amounts, or null when any of them has none. */
function sumKnown(flows: PeriodCashFlow[]): null | number {
  if (flows.some((flow) => flow.amount == null)) return null;
  return sumMoney(flows.map((flow) => flow.amount ?? 0));
}

/**
 * The latest snapshot of a portfolio on or before `date`'s UTC day, as a point in the viewer's
 * currency. The snapshot is stored in its owner's currency, which a household member viewing it
 * may not share, so it is converted at the rate in force at the end of its day; with no rate its
 * value is null, never the owner-currency figure.
 */
export async function findSnapshotPointOnOrBefore(portfolioKey: number, date: Date, viewerCurrency: string): Promise<null | SnapshotPoint> {
  const snapshot = await DI.em.findOne(
    PortfolioSnapshot,
    { deletedAt: undefined, portfolioKey: { portfolioKey }, snapshotDate: { $lt: startOfNextUtcDay(date) } },
    { orderBy: { snapshotDate: QueryOrder.DESC }, populate: ['appuserCurrencyKey', 'currencyKey', 'portfolioKey.portfolioOwnerAppuserKey.currencyKey'] },
  );
  if (!snapshot) return null;

  const stored = storedSnapshotValue(snapshot, snapshot.portfolioKey.portfolioOwnerAppuserKey.currencyKey.code);
  const day = new Date(`${stored.date}T00:00:00.000Z`);
  const rates = await loadRateTable(DI.em, historyRatePairs([stored], viewerCurrency), { from: day, to: startOfNextUtcDay(day) }, FEED_RATES_ONLY);
  return { day: stored.date, value: snapshotInViewerCurrency(stored, viewerCurrency, rates) };
}

export function measurePortfolioPeriod({ end, flows, fromDate, startSnapshot }: MeasurePortfolioPeriodInput): PortfolioPeriodMeasure {
  // The start value already holds every trade up to the end of its snapshot day.
  let startValue: null | number;
  let afterStart: (flow: PeriodCashFlow) => boolean;
  if (startSnapshot) {
    startValue = startSnapshot.value;
    afterStart = (flow) => utcDay(flow.date) > startSnapshot.day;
  } else {
    const heldSomething = flows.some((flow) => isTrade(flow) && flow.date.getTime() < fromDate.getTime());
    startValue = heldSomething ? null : 0;
    afterStart = (flow) => flow.date.getTime() >= fromDate.getTime();
  }

  // The end value holds every trade up to its moment: now when live, else its snapshot day.
  let endValue: null | number;
  let beforeEnd: (flow: PeriodCashFlow) => boolean;
  if (end.kind === 'live') {
    endValue = end.value;
    beforeEnd = () => true;
  } else if (end.kind === 'snapshot') {
    endValue = end.value;
    beforeEnd = (flow) => utcDay(flow.date) <= end.day;
  } else {
    const heldSomething = flows.some((flow) => isTrade(flow) && flow.date.getTime() <= end.toDate.getTime());
    endValue = heldSomething ? null : 0;
    beforeEnd = (flow) => flow.date.getTime() <= end.toDate.getTime();
  }

  const periodFlows = flows.filter((flow) => afterStart(flow) && beforeEnd(flow));
  // A buy is money in (negative from the investor's side), a sale money out.
  const trades = sumKnown(periodFlows.filter(isTrade));
  const netContributions = trades == null ? null : roundDisplay(big(trades).times(-1));
  const paidOut = sumKnown(periodFlows.filter((flow) => flow.kind === 'DIVIDEND'));
  const dividends = paidOut == null ? null : roundDisplay(paidOut);

  return {
    ...changeOf(startValue, netContributions, endValue),
    dividends,
    endValue: endValue == null ? null : roundDisplay(endValue),
    hadActivity: periodFlows.length > 0,
    netContributions,
    startValue: startValue == null ? null : roundDisplay(startValue),
  };
}

/** Several portfolios as one: add the parts up, then take the percentage. Unknown if any part is. */
export function combinePeriodMeasures(measures: PortfolioPeriodMeasure[]): Pick<PortfolioPeriodMeasure, 'change' | 'changePercent'> {
  if (measures.some((measure) => measure.startValue == null || measure.endValue == null || measure.netContributions == null)) {
    return { change: null, changePercent: null };
  }
  return changeOf(
    sumMoney(measures.map((measure) => measure.startValue ?? 0)),
    sumMoney(measures.map((measure) => measure.netContributions ?? 0)),
    sumMoney(measures.map((measure) => measure.endValue ?? 0)),
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Spreadsheet XIRR's year: a flow's time is its days after the first date over 365. */
const XIRR_DAYS_PER_YEAR = 365;

export interface MoneyWeightedReturn {
  /** Whether `value` is a yearly rate: only for a span of a year or more. */
  annualized: boolean;
  /** The rate (%), yearly when `annualized`, otherwise over the span itself; null when unknown. */
  value: null | number;
}

/** The cumulative time-weighted return (%) at the close of `date`. */
export interface ReturnIndexPoint {
  date: string;
  value: number;
}

/** One portfolio's values and flows, for {@link combineReturnSeries} and {@link periodReturnsOf}. */
export interface ReturnSeries {
  /** In the viewer's currency, from the investor's side (see {@link InvestmentCashFlow}). */
  flows: PeriodCashFlow[];
  /**
   * In day order. The first opens the span: it already holds every trade of its day, so only later
   * flows count. A day with no snapshot is left out.
   */
  snapshots: SnapshotPoint[];
}

export interface TimeWeightedReturn {
  /** 0 at the first snapshot, then the cumulative return at each later one it could measure. */
  index: ReturnIndexPoint[];
  /**
   * Days between the first and the last snapshot with no value: no snapshot, or one with no rate
   * into the viewer's currency. Their value was carried over from the day before.
   */
  missingDates: string[];
  /** The return (%) over the whole span; null when the start, the end or a flow has no value. */
  value: null | number;
}

/**
 * Both returns over a period, rounded for display.
 *
 * - `timeWeighted`: how the investments did, whatever was put in or taken out and when.
 * - `moneyWeighted`: how the investor did, a contribution weighted by how long it was invested
 *   (XIRR), yearly when `moneyWeightedAnnualized`, otherwise over the period itself.
 * - `missingSnapshotDates`: days in the period without a value, carried over from the day before.
 */
export interface PeriodReturns {
  missingSnapshotDates: string[];
  moneyWeighted: null | number;
  moneyWeightedAnnualized: boolean;
  timeWeighted: null | number;
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
}

/**
 * Money put into the portfolio on each day in (`after`, `through`]: the negative of the investor's
 * flows, so a buy is money in and a sale money out. A dividend is paid to the investor rather than
 * kept in the portfolio's value, so it is money out too, and counts as return. Null for a day with
 * a flow that has no amount.
 */
function inflowsByDay(flows: PeriodCashFlow[], after: string, through: string): Map<string, null | number> {
  const byDay = new Map<string, null | number>();
  for (const flow of flows) {
    const day = utcDay(flow.date);
    if (day <= after || day > through) continue;
    const sum = byDay.has(day) ? byDay.get(day) : 0;
    byDay.set(day, sum == null || flow.amount == null ? null : sum - flow.amount);
  }
  return byDay;
}

/**
 * The time-weighted return of a portfolio's daily values: each day's return is
 * `(V_t - inflow_t) / V_(t-1) - 1`, with the day's trades at its close, and the days are chained.
 * Money put in or taken out therefore moves the value without moving the return.
 *
 * A day with no snapshot is never read as zero: the last value is carried over it, its flows
 * count at the next snapshot (the two days are measured as one), and it is reported in
 * `missingDates`. Days next to a value of zero are not reported: the snapshot job writes nothing
 * for a portfolio that holds nothing, before its first buy or after its last sale. On a day that
 * starts from nothing, the day's return is its close over the money put in.
 */
export function calculateTimeWeightedReturn(snapshots: SnapshotPoint[], flows: PeriodCashFlow[]): TimeWeightedReturn {
  const [start, ...later] = snapshots;
  if (start?.value == null) return { index: [], missingDates: [], value: null };
  const inflows = inflowsByDay(flows, start.day, snapshots.at(-1)?.day ?? start.day);

  const index: ReturnIndexPoint[] = [{ date: start.day, value: 0 }];
  const missingDates: string[] = [];
  let growth = 1;
  let held = start.value;
  let day = start.day;
  let pending: null | number = 0;
  let unseen: string[] = [];
  for (const snapshot of later) {
    if (snapshot.day <= day) continue;
    while (day < snapshot.day) {
      day = addDays(day, 1);
      const inflow = inflows.has(day) ? inflows.get(day) : 0;
      pending = pending == null || inflow == null ? null : pending + inflow;
      if (day !== snapshot.day || snapshot.value == null) unseen.push(day);
    }
    if (snapshot.value == null) continue;
    if (pending == null) return { index, missingDates, value: null };

    let dayReturn = 0;
    if (held > 0) dayReturn = (snapshot.value - pending) / held - 1;
    else if (pending > 0) dayReturn = snapshot.value / pending - 1;
    growth *= 1 + dayReturn;
    if (held > 0 && snapshot.value > 0) missingDates.push(...unseen);
    unseen = [];
    held = snapshot.value;
    pending = 0;
    index.push({ date: snapshot.day, value: (growth - 1) * 100 });
  }

  const ended = later.length === 0 || later.at(-1)?.value != null;
  return ended ? { index, missingDates, value: (growth - 1) * 100 } : { index, missingDates: [...missingDates, ...unseen], value: null };
}

/**
 * The money-weighted return (XIRR) over a span: the start value is put in at the start, each flow
 * after the start day and up to the end day moves money as it did (a dividend is money back), and
 * the end value comes back at the end. Annualised only for a span of a year or more (see
 * MIN_ANNUALIZED_RETURN_DAYS); a shorter one gives the rate over the span itself, since compounding
 * it up to a year would extrapolate it. Null when the start, the end or a flow has no value, or no
 * rate solves the flows.
 */
export function calculatePeriodMoneyWeightedReturn(start: SnapshotPoint, end: SnapshotPoint, flows: PeriodCashFlow[]): MoneyWeightedReturn {
  const days = daysBetween(start.day, end.day);
  const annualized = days >= MIN_ANNUALIZED_RETURN_DAYS;
  const unknown = { annualized, value: null };
  if (start.value == null || end.value == null || days <= 0) return unknown;

  const inSpan = flows.filter((flow) => utcDay(flow.date) > start.day && utcDay(flow.date) <= end.day);
  if (inSpan.some((flow) => flow.amount == null)) return unknown;
  const years = (day: string) => daysBetween(start.day, day) / XIRR_DAYS_PER_YEAR;
  const cashFlows = [
    { amount: -start.value, years: 0 },
    ...inSpan.map((flow) => ({ amount: flow.amount ?? 0, years: years(utcDay(flow.date)) })),
    { amount: end.value, years: years(end.day) },
  ].filter((flow) => flow.amount !== 0);

  const rate = solveXirr(cashFlows);
  if (rate == null) return unknown;
  return { annualized, value: (annualized ? rate : Math.pow(1 + rate, days / XIRR_DAYS_PER_YEAR) - 1) * 100 };
}

/**
 * One portfolio's value on each day, for {@link combineReturnSeries}, called in day order: its
 * snapshot's value; 0 before its first snapshot, while it holds nothing, and from a sale after its
 * last snapshot when nothing is held after it; the start snapshot's value carried up to the
 * household's `startDay`; otherwise undefined (a missing snapshot).
 */
function dailyValue(series: ReturnSeries, startDay: string): (day: string) => number | undefined {
  const known = series.snapshots.filter((snapshot): snapshot is { day: string; value: number } => snapshot.value != null);
  const firstDay = series.snapshots[0]?.day;
  const saleDays = series.flows.filter((flow) => flow.kind === 'SELL').map((flow) => utcDay(flow.date));
  let cursor = -1;
  return (day) => {
    if (firstDay === undefined || day < firstDay) return 0;
    while (cursor + 1 < known.length && (known[cursor + 1]?.day ?? '') <= day) cursor++;
    const previous = known[cursor];
    if (!previous) return undefined;
    if (previous.day === day || day <= startDay || previous.value === 0) return previous.value;
    const next = known[cursor + 1];
    const soldOut = (!next || next.value === 0) && saleDays.some((saleDay) => saleDay > previous.day && saleDay <= day);
    return soldOut ? 0 : undefined;
  };
}

/**
 * Several portfolios as one, for a household return measured the same way as a single
 * portfolio's. A day is the sum of every portfolio's value (see `dailyValue`), and is left out
 * when one of them has no snapshot that day, so the household carries it as missing.
 *
 * `startDay` opens the span. A portfolio whose first snapshot is older (its latest before the
 * period) is carried up to it, and its trades since that snapshot count on the next day; one whose
 * first snapshot is later was worth nothing before, so its trades from `startDay` on are flows.
 */
export function combineReturnSeries(series: ReturnSeries[], startDay: string): ReturnSeries {
  const lastDay = series.reduce((last, entry) => {
    const day = entry.snapshots.at(-1)?.day;
    return day && day > last ? day : last;
  }, startDay);
  const values = series.map((entry) => dailyValue(entry, startDay));

  const snapshots: SnapshotPoint[] = [];
  for (let day = startDay; day <= lastDay; day = addDays(day, 1)) {
    const dayValues = values.map((valueOn) => valueOn(day));
    if (dayValues.every((value) => value !== undefined)) snapshots.push({ day, value: sumMoney(dayValues) });
  }

  const firstStep = new Date(`${addDays(startDay, 1)}T00:00:00.000Z`);
  const flows = series.flatMap((entry) => {
    const firstDay = entry.snapshots[0]?.day ?? startDay;
    const countsAfter = firstDay < startDay ? firstDay : startDay;
    return entry.flows
      .filter((flow) => utcDay(flow.date) > countsAfter)
      .map((flow) => (utcDay(flow.date) <= startDay ? { ...flow, date: firstStep } : flow));
  });
  return { flows, snapshots };
}

/**
 * The time- and money-weighted returns of one or more portfolios over a period. Each series opens
 * at the period's start (its latest snapshot before it, or 0 for a portfolio that held nothing)
 * and closes at its end; the household opens at the latest of those starts. Unknown when a
 * portfolio's start or end has no value.
 */
export function periodReturnsOf(series: ReturnSeries[]): PeriodReturns {
  const unknown: PeriodReturns = { missingSnapshotDates: [], moneyWeighted: null, moneyWeightedAnnualized: false, timeWeighted: null };
  const startDays = series.map((entry) => entry.snapshots[0]?.day);
  if (series.length === 0 || startDays.some((day) => day === undefined)) return unknown;
  const startDay = startDays.reduce<string>((latest, day = '') => (day > latest ? day : latest), '');
  const endDay = series.reduce((latest, entry) => {
    const day = entry.snapshots.at(-1)?.day ?? '';
    return day > latest ? day : latest;
  }, startDay);

  const combined = combineReturnSeries(series, startDay);
  const start = combined.snapshots[0];
  const end = combined.snapshots.at(-1);
  if (start?.day !== startDay || end?.day !== endDay) return unknown;

  const timeWeighted = calculateTimeWeightedReturn(combined.snapshots, combined.flows);
  const moneyWeighted = calculatePeriodMoneyWeightedReturn(start, end, combined.flows);
  return {
    missingSnapshotDates: timeWeighted.missingDates,
    moneyWeighted: moneyWeighted.value == null ? null : roundDisplay(moneyWeighted.value),
    moneyWeightedAnnualized: moneyWeighted.annualized,
    timeWeighted: timeWeighted.value == null ? null : roundDisplay(timeWeighted.value),
  };
}

/**
 * One portfolio's {@link ReturnSeries} over a period, bounded as {@link measurePortfolioPeriod}
 * bounds it: from the start snapshot (or 0 on the day before `fromDate` when nothing was held, or
 * no value when something was but no snapshot says what), through `snapshots` after it, to the end
 * (the live value today, the end snapshot, or nothing).
 */
export function periodReturnSeries({ end, flows, fromDate, now = new Date(), snapshots, startSnapshot }: MeasurePortfolioPeriodInput & { now?: Date; snapshots: SnapshotPoint[] }): ReturnSeries {
  const heldBefore = (date: Date) => flows.some((flow) => isTrade(flow) && flow.date.getTime() < date.getTime());
  const start: SnapshotPoint = startSnapshot ?? { day: addDays(utcDay(fromDate), -1), value: heldBefore(fromDate) ? null : 0 };

  let last: SnapshotPoint;
  if (end.kind === 'live') last = { day: utcDay(now), value: end.value };
  else if (end.kind === 'snapshot') last = { day: end.day, value: end.value };
  else last = { day: utcDay(end.toDate), value: heldBefore(new Date(end.toDate.getTime() + 1)) ? null : 0 };
  if (last.day <= start.day) return { flows, snapshots: [start] };

  const between = snapshots.filter((snapshot) => snapshot.day > start.day && snapshot.day < last.day);
  return { flows, snapshots: [start, ...between, last] };
}

/**
 * Every snapshot of `portfolioKeys` on or after `from`, in the currency each was stored in, oldest
 * first. Raw SQL bypasses MikroORM's tenant filter, so `tenantKey` scopes it explicitly.
 */
export async function loadPortfolioSnapshotValues(portfolioKeys: number[], from: Date, tenantKey?: number): Promise<(PortfolioSnapshotValue & { portfolioKey: number })[]> {
  if (portfolioKeys.length === 0) return [];
  const rows = await sqlQuery(DI.em)
    .selectFrom('portfolio_snapshot as ps')
    .innerJoin('portfolio as p', 'ps.portfolio_key', 'p.portfolio_key')
    .leftJoin('currency as appuser_c', 'ps.appuser_currency_key', 'appuser_c.currency_key')
    .leftJoin('appuser as owner', 'p.portfolio_owner_appuser_key', 'owner.appuser_key')
    .leftJoin('currency as owner_c', 'owner.currency_key', 'owner_c.currency_key')
    .leftJoin('currency as snapshot_c', 'ps.currency_key', 'snapshot_c.currency_key')
    .select([
      'ps.portfolio_key',
      'ps.snapshot_date',
      sql<null | string>`COALESCE(ps.appuser_currency_total_value, ps.total_value)`.as('value'),
      // A value stored before the owner-currency key was recorded is in the owner's currency.
      sql<null | string>`CASE WHEN ps.appuser_currency_total_value IS NOT NULL THEN COALESCE(appuser_c.code, owner_c.code) ELSE snapshot_c.code END`.as('currency_code'),
    ])
    .where(anyOf('ps.portfolio_key', portfolioKeys))
    .where('ps.snapshot_date', '>=', from)
    .where('ps.deleted_at', 'is', null)
    .where('p.deleted_at', 'is', null)
    .$if(tenantKey != null, (query) => query.where('p.tenant_key', '=', tenantKey))
    .orderBy('ps.snapshot_date', 'asc')
    .execute() as { currency_code: null | string; portfolio_key: number; snapshot_date: Date | string; value: null | number | string }[];

  return rows.map((row) => ({
    currencyCode: row.value == null ? null : row.currency_code,
    date: format(toDate(row.snapshot_date), 'yyyy-MM-dd'),
    portfolioKey: row.portfolio_key,
    value: row.value == null ? 0 : Number(row.value),
  }));
}

/**
 * Each portfolio's snapshots as {@link SnapshotPoint}s in the viewer's currency, at the rate in
 * force at the end of each day; a snapshot with no rate has no value, never its stored figure.
 */
export async function snapshotSeriesInViewerCurrency(snapshots: (PortfolioSnapshotValue & { portfolioKey: number })[], viewerCurrency: string, window: { from: Date; to: Date }): Promise<Map<number, SnapshotPoint[]>> {
  const rates = await loadRateTable(DI.em, historyRatePairs(snapshots, viewerCurrency), window, FEED_RATES_ONLY);
  const byPortfolio = new Map<number, SnapshotPoint[]>();
  for (const snapshot of snapshots) {
    const points = byPortfolio.get(snapshot.portfolioKey) ?? [];
    byPortfolio.set(snapshot.portfolioKey, points);
    points.push({ day: snapshot.date, value: snapshotInViewerCurrency(snapshot, viewerCurrency, rates) });
  }
  return byPortfolio;
}
