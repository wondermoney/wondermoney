import { QueryOrder } from '@mikro-orm/core';

import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import { loadRateTable, type RateTable } from '@service/currency/exchange-rate';
import { big, Money, roundDisplay, sumMoney } from '@utils/money';

import { historyRatePairs, snapshotInViewerCurrency, storedSnapshotValue } from './portfolio-history-currency';
import type { InvestmentCashFlow } from './portfolio-metrics.utils';

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
  const rates = await loadRateTable(DI.em, foreign.map((flow) => ({ from: flow.currencyCode ?? '', to: viewerCurrency })), window);
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
  const rates = await loadRateTable(DI.em, historyRatePairs([stored], viewerCurrency), { from: day, to: startOfNextUtcDay(day) });
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
