/** Daily snapshots before any history-based metric (e.g. max drawdown) is shown. */
export const MIN_METRICS_HISTORY_SNAPSHOTS = 30;

/**
 * Days held before a return is annualised. Compounding a sub-year return up to a
 * year extrapolates it (35 days at +39.7% "annualises" to ~3,000%), so — as GIPS
 * requires — periods under a year are never annualised; the cumulative
 * `totalReturn` is the honest figure until then.
 */
export const MIN_ANNUALIZED_RETURN_DAYS = 365;

/**
 * Daily snapshots before volatility is annualised. Snapshots are one per calendar day, so 90 of
 * them hold about 63 trading days of real price moves; weekend and holiday returns are zero and
 * add no information. Below a quarter the sample standard deviation is too noisy to annualise:
 * its relative standard error is ~1/sqrt(2n) over the trading days, about 15% at one month versus
 * 9% at three.
 */
export const MIN_VOLATILITY_HISTORY_SNAPSHOTS = 90;

/**
 * Calendar days in a year, for annualising calendar-day figures. Snapshots carry the last price
 * forward over weekends and holidays rather than skipping them, so a year of daily returns is 365
 * of them (with the non-trading ones flat), not 252.
 */
const CALENDAR_DAYS_PER_YEAR = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Money moving between the investor and their portfolios, in the user's currency and from the
 * investor's side: a buy (with its fee) is money put in, so negative; a sale (net of its fee) or a
 * dividend is money taken out, so positive.
 */
export interface InvestmentCashFlow {
  amount: number;
  /** The currency `amount` is in: that of the member who recorded it, or the settlement currency. */
  currencyCode?: null | string;
  date: Date;
  kind: 'BUY' | 'DIVIDEND' | 'SELL';
}

/** One day's aggregate portfolio value; `day` is its `YYYY-MM-DD` calendar date. */
export interface PortfolioValueSnapshot {
  day: string;
  totalValue: number;
}

/**
 * The investor's annual yield: the money-weighted return (XIRR) of every buy, sale and dividend,
 * with what is held now as a final inflow. Unlike compounding the cost-basis return from the first
 * buy, it weights each contribution by how long it was invested, so money added late does not dilute
 * the rate. Null until the flows span a year (see MIN_ANNUALIZED_RETURN_DAYS), when nothing ever came
 * back to the investor, or when no rate solves the flows.
 */
export function calculateMoneyWeightedAnnualYield(
  cashFlows: InvestmentCashFlow[],
  currentValue: number,
  asOf: Date,
): null | number {
  const flows = cashFlows.map(({ amount, date }) => ({ amount, time: date.getTime() }));
  if (currentValue > 0) flows.push({ amount: currentValue, time: asOf.getTime() });
  if (flows.length === 0) return null;

  const firstTime = Math.min(...flows.map((flow) => flow.time));
  const lastTime = Math.max(...flows.map((flow) => flow.time));
  if ((lastTime - firstTime) / DAY_MS < MIN_ANNUALIZED_RETURN_DAYS) return null;

  const rate = solveXirr(flows.map((flow) => ({ amount: flow.amount, years: (flow.time - firstTime) / DAY_MS / CALENDAR_DAYS_PER_YEAR })));
  return rate === null ? null : rate * 100;
}

export function calculateTotalReturn(currentValue: number, costBasis: number): number {
  if (costBasis === 0) {
    return 0;
  }
  return ((currentValue - costBasis) / costBasis) * 100;
}

/**
 * The annual rate r at which the flows' present value is zero: sum(amount / (1 + r)^years) = 0.
 * Newton's method from 10%, as spreadsheets do, falling back to bisection when it leaves (-100%, inf)
 * or stalls. Null without both an outflow and an inflow, since then no rate solves it.
 */
export function solveXirr(flows: { amount: number; years: number }[]): null | number {
  if (!flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return null;

  const presentValue = (rate: number) => flows.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + rate, flow.years), 0);
  const scale = flows.reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const tolerance = 1e-10;

  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const value = presentValue(rate);
    if (Math.abs(value) < tolerance * scale) return rate;
    const slope = flows.reduce((sum, flow) => sum - (flow.years * flow.amount) / Math.pow(1 + rate, flow.years + 1), 0);
    const next = rate - value / slope;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < tolerance) return next;
    rate = next;
  }

  // Bisection between just above -100% and a rate high enough that the sign flips.
  let low = -1 + 1e-9;
  let high = 1;
  let lowValue = presentValue(low);
  while (Math.sign(presentValue(high)) === Math.sign(lowValue) && high < 1e6) high *= 2;
  if (Math.sign(presentValue(high)) === Math.sign(lowValue)) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (low + high) / 2;
    const midValue = presentValue(mid);
    if (Math.abs(midValue) < tolerance * scale || high - low < tolerance) return mid;
    if (Math.sign(midValue) === Math.sign(lowValue)) {
      low = mid;
      lowValue = midValue;
    } else {
      high = mid;
    }
  }
  return null;
}

/**
 * Annualised volatility (%) of the portfolio's flow-adjusted daily returns (see
 * flowAdjustedDailyReturns). Returns are per calendar day, so they are annualised by sqrt(365).
 */
export function calculateVolatility(snapshots: PortfolioValueSnapshot[], cashFlows: InvestmentCashFlow[] = []): null | number {
  if (snapshots.length < MIN_VOLATILITY_HISTORY_SNAPSHOTS) {
    return null;
  }

  const dailyReturns = flowAdjustedDailyReturns(snapshots, cashFlows);
  if (dailyReturns.length === 0) {
    return null;
  }

  const avgReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;

  return Math.sqrt(variance) * Math.sqrt(CALENDAR_DAYS_PER_YEAR) * 100;
}

/**
 * Maximum drawdown (%): the largest peak-to-trough fall of a flow-neutral index that starts at 100
 * and moves by each flow-adjusted daily return (see flowAdjustedDailyReturns). Measured on the value
 * itself, a sale looked like a loss and a buy partway down hid part of the fall.
 */
export function calculateMaxDrawdown(snapshots: PortfolioValueSnapshot[], cashFlows: InvestmentCashFlow[] = []): null | number {
  if (snapshots.length < MIN_METRICS_HISTORY_SNAPSHOTS) return null;

  let index = 100;
  let peak = index;
  let maxDrawdown = 0;
  for (const dailyReturn of flowAdjustedDailyReturns(snapshots, cashFlows)) {
    index *= 1 + dailyReturn;
    if (index > peak) peak = index;
    const drawdown = ((peak - index) / peak) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown;
}

/**
 * The portfolio's daily returns from the market's moves only: a day's buys are taken out of its
 * closing value and its sales added back, so a contribution is not a gain and a sale not a loss.
 * Only consecutive days are compared; a return across a missing snapshot would span several days,
 * and one from a day worth nothing is undefined.
 */
export function determineRiskLevel(volatility: null | number): 'High' | 'Low' | 'Medium' | null {
  if (volatility === null) {
    return null;
  }
  if (volatility < 15) {
    return 'Low';
  } else if (volatility < 25) {
    return 'Medium';
  } else {
    return 'High';
  }
}

function flowAdjustedDailyReturns(snapshots: PortfolioValueSnapshot[], cashFlows: InvestmentCashFlow[]): number[] {
  // Net money the investor put in on each day: buys in, sales out. Dividends are paid out of the
  // portfolio's value rather than into it, so they are not a contribution to its snapshots.
  const contributionsByDay = new Map<string, number>();
  for (const flow of cashFlows) {
    if (flow.kind === 'DIVIDEND') continue;
    const day = flow.date.toISOString().slice(0, 10);
    contributionsByDay.set(day, (contributionsByDay.get(day) ?? 0) - flow.amount);
  }

  const dailyReturns: number[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const previous = snapshots[i - 1]!;
    const current = snapshots[i]!;
    if (Date.parse(current.day) - Date.parse(previous.day) !== DAY_MS) continue;
    if (previous.totalValue > 0) {
      const contribution = contributionsByDay.get(current.day) ?? 0;
      dailyReturns.push((current.totalValue - contribution) / previous.totalValue - 1);
    }
  }
  return dailyReturns;
}
