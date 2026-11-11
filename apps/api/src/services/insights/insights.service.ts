import { formatInTimeZone } from 'date-fns-tz';

import { classifyTransactions, createDiagnostics } from '@service/budget/aggregation-classifier';
import { getLisbonBudgetPeriod } from '@service/budget/aggregation-periods';
import type { InstantRange, LisbonBudgetPeriod } from '@service/budget/aggregation-periods';
import type { TenantAggregationRepository, TransactionAggregationRow } from '@service/budget/aggregation-types';
import { MikroOrmTenantAggregationRepository } from '@service/budget/tenant-aggregation.repository';
import { partitionByEligibility } from '@service/budget/tenant-budget-eligibility';

import { INSIGHTS } from './insights.constants';
import { generateInsights } from './insights.generators';
import type { Insight } from './insights.types';

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

    const allocationRows = await this.repository.loadBudgetAllocations(input.appuserKey, period.month, period.year);
    const allocations = partitionByEligibility(allocationRows, { appuserKey: input.appuserKey, tenantKey: input.tenantKey });

    return {
      insights: generateInsights({
        budget: {
          allocations: allocations.rows,
          currentTransactions,
          daysElapsed: period.daysElapsed,
          daysInMonth: period.daysInMonth,
          month: period.month,
          year: period.year,
        },
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

  return { asOf, daysElapsed, daysInMonth, month: monthNumber, monthRange: period.monthRange, year };
}

function hasRows(rows: readonly TransactionAggregationRow[], range: InstantRange): boolean {
  return rows.some((row) => row.transactionDate !== null && inRange(row.transactionDate, range));
}

function inRange(date: Date, range: InstantRange): boolean {
  return date >= range.start && date < range.end;
}

function priorMonthPeriod(period: { month: number; year: number }, monthsBack: number): LisbonBudgetPeriod {
  const isoInstant = new Date(Date.UTC(period.year, period.month - 1 - monthsBack, 15, 12)).toISOString();
  return getLisbonBudgetPeriod(isoInstant);
}
