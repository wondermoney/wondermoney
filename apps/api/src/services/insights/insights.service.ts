import { formatInTimeZone } from 'date-fns-tz';

import { classifyTransactions, createDiagnostics } from '@service/budget/aggregation-classifier';
import { getLisbonBudgetPeriod } from '@service/budget/aggregation-periods';
import type { InstantRange, LisbonBudgetPeriod } from '@service/budget/aggregation-periods';
import type { BudgetAllocationRow, TenantAggregationRepository, TransactionAggregationRow } from '@service/budget/aggregation-types';
import { MikroOrmTenantAggregationRepository } from '@service/budget/tenant-aggregation.repository';
import { partitionByEligibility } from '@service/budget/tenant-budget-eligibility';

import { INSIGHTS } from './insights.constants';
import { generateInsights } from './insights.generators';
import type { BudgetPaceInput, Insight } from './insights.types';

const LISBON_TIME_ZONE = 'Europe/Lisbon';

export interface InsightsInput {
  appuserKey: number;
  /** The viewer's base currency, which every spend figure is in. */
  currency: string;
  /** `YYYY-MM`; defaults to the current month. */
  month?: string;
  /** Injectable clock, so a test can fix "today". */
  now?: Date;
  tenantKey: number;
}

export interface InsightsResult {
  insights: Insight[];
}

interface ResolvedInsightsPeriod {
  asOf: Date;
  daysElapsed: number;
  daysInMonth: number;
  /** The month is the one `now` is in. */
  isCurrent: boolean;
  month: number;
  monthRange: InstantRange;
  year: number;
}

/**
 * Deterministic home insights: a category spending faster than its own normal, and a budget on
 * course to overrun. No model is involved; the client renders the copy from `type` and `facts`.
 *
 * The rows come through the same aggregation repository the weekly and monthly emails use, so the
 * 3-month baseline, the transfer and investment exclusions and the base-currency amounts are the
 * same arithmetic. Nothing is persisted: the same month and data always produce the same list.
 */
export class InsightsService {
  constructor(
    private readonly repository: TenantAggregationRepository = new MikroOrmTenantAggregationRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getInsights(input: InsightsInput): Promise<InsightsResult> {
    const period = resolveInsightsPeriod(input.month, input.now ?? this.clock());
    if (period.daysElapsed < INSIGHTS.MIN_DAYS_ELAPSED) return { insights: [] };
    if (!(await this.repository.hasActiveMembership(input.appuserKey, input.tenantKey))) return { insights: [] };

    const baselinePeriods = [1, 2, 3].map((monthsBack) => priorMonthPeriod(period, monthsBack));
    const oldestBaseline = baselinePeriods[baselinePeriods.length - 1] ?? period;
    const rows = await this.repository.loadTransactions(input.appuserKey, input.tenantKey, {
      end: period.asOf,
      start: oldestBaseline.monthRange.start,
    });
    const diagnostics = createDiagnostics();
    const transactions = classifyTransactions(rows, input.appuserKey, input.tenantKey, diagnostics);

    const currentTransactions = transactions.filter(
      (transaction) => inRange(transaction.transactionDate, period.monthRange) && transaction.transactionDate < period.asOf,
    );
    const baselineMonths = baselinePeriods.map((baseline) => ({
      month: baseline.month,
      transactions: transactions.filter((transaction) => inRange(transaction.transactionDate, baseline.monthRange)),
      year: baseline.year,
    }));
    const baselineComplete =
      baselinePeriods.length === INSIGHTS.SPENDING_VS_NORMAL.BASELINE_MONTHS &&
      baselinePeriods.every((baseline) => hasRows(rows, baseline.monthRange));

    // Budget pace reads each budget's own month: the one today is in for the current month (which
    // a start day after the 1st can move on), else the budget month named like the one asked for.
    const allocationRows = await this.repository.loadBudgetAllocations(
      input.appuserKey,
      period.isCurrent ? { day: lisbonDay(period.asOf) } : { month: period.month, year: period.year },
    );
    const allocations = partitionByEligibility(allocationRows, { appuserKey: input.appuserKey, tenantKey: input.tenantKey });
    const spentSoFar = transactions.filter((transaction) => transaction.transactionDate < period.asOf);

    return {
      insights: generateInsights({
        budgets: budgetPaceInputs(allocations.rows, spentSoFar, period.asOf),
        spending: {
          baselineComplete,
          baselineMonths,
          currency: input.currency,
          currentTransactions,
          daysElapsed: period.daysElapsed,
          fromDate: period.monthRange.start.toISOString(),
          month: period.month,
          toDate: period.asOf.toISOString(),
          year: period.year,
        },
      }),
    };
  }
}

/**
 * The month the insight is about, and how much of it has elapsed. A past month is complete; the
 * current month is read up to `now`; a future month has nothing to say yet.
 */
export function resolveInsightsPeriod(month: string | undefined, now: Date): ResolvedInsightsPeriod {
  const current = getLisbonBudgetPeriod(now.toISOString());
  const [year, monthNumber] = month
    ? (month.split('-').map(Number) as [number, number])
    : ([current.year, current.month] as [number, number]);

  const period = getLisbonBudgetPeriod(`${String(year).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}-15T12:00:00Z`);
  const monthEnd = period.monthRange.end;
  const asOf = now < period.monthRange.start ? period.monthRange.start : now < monthEnd ? now : monthEnd;
  const daysInMonth = Math.round((monthEnd.getTime() - period.monthRange.start.getTime()) / 86_400_000);
  const daysElapsed = asOf >= monthEnd ? daysInMonth : Number(formatInTimeZone(asOf, LISBON_TIME_ZONE, 'd'));

  return { asOf, daysElapsed, daysInMonth, isCurrent: year === current.year && monthNumber === current.month, month: monthNumber, monthRange: period.monthRange, year };
}

/**
 * One budget-pace input per budget: its rows, and how many days of its budget month (the days its
 * start day gives it) have passed by `asOf`'s Lisbon day. Spending is the transactions on those days.
 */
function budgetPaceInputs(allocations: readonly BudgetAllocationRow[], transactions: BudgetPaceInput['currentTransactions'], asOf: Date): BudgetPaceInput[] {
  const byBudget = new Map<number, BudgetAllocationRow[]>();
  for (const allocation of allocations) byBudget.set(allocation.budgetKey, [...(byBudget.get(allocation.budgetKey) ?? []), allocation]);
  return [...byBudget.values()].map((rows) => {
    const { month, period, year } = rows[0]!;
    const daysInMonth = Math.round((period.end.getTime() - period.start.getTime()) / 86_400_000);
    const today = lisbonDay(asOf);
    const daysElapsed = today >= period.end ? daysInMonth : today < period.start ? 0 : Math.floor((today.getTime() - period.start.getTime()) / 86_400_000) + 1;
    return { allocations: rows, currentTransactions: transactions, daysElapsed, daysInMonth, month, year };
  });
}

function hasRows(rows: readonly TransactionAggregationRow[], range: InstantRange): boolean {
  return rows.some((row) => row.transactionDate !== null && inRange(row.transactionDate, range));
}

function inRange(date: Date, range: InstantRange): boolean {
  return date >= range.start && date < range.end;
}

/** UTC midnight of the Lisbon calendar day `instant` is on: the day budget months are looked up by. */
function lisbonDay(instant: Date): Date {
  return new Date(`${formatInTimeZone(instant, LISBON_TIME_ZONE, 'yyyy-MM-dd')}T00:00:00.000Z`);
}

function priorMonthPeriod(period: { month: number; year: number }, monthsBack: number): LisbonBudgetPeriod {
  const isoInstant = new Date(Date.UTC(period.year, period.month - 1 - monthsBack, 15, 12)).toISOString();
  return getLisbonBudgetPeriod(isoInstant);
}
