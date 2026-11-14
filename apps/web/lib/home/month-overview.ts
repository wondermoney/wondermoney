import type { AccountCashflow } from "@/lib/api/account/useAccountsCashflow";
import type { LoanListItem } from "@/lib/api/loan/types";
import type { NetWorth } from "@/lib/api/net-worth/useNetWorth";
import type { BudgetRow } from "@/lib/budget/rows";
import {
  calculatePlannedAndSpentValue,
  getMonthlyAvailableValue,
} from "@/lib/utils/budget";

/**
 * The arithmetic behind the home screen: how net worth has moved, what is
 * left in each budget this month and what is over plan, and the scales the
 * screen draws its bars on. Pure functions over the same rows and responses
 * the budget, net-worth, cash-flow and loan screens read, so the figures agree.
 */

/** Half a cent: spending this close to the plan is on plan, not over it. */
const OVER_PLAN_TOLERANCE = 0.005;

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export interface MonthSummary {
  planned: number;
  spent: number;
  /**
   * Available (plan plus what rollover carried in) minus spent; negative once
   * the month is overspent.
   */
  left: number;
  isOverspent: boolean;
}

/**
 * The month's plan and spending, through the budget screen's own totals
 * (`calculatePlannedAndSpentValue`), so "left to spend" here is the budget
 * screen's "remaining" to the cent.
 */
export function monthSummary(rows: BudgetRow[]): MonthSummary {
  const { totalPlanned, totalAvailable, totalSpent } =
    calculatePlannedAndSpentValue(rows);
  const left = totalAvailable - totalSpent;

  return {
    planned: totalPlanned,
    spent: totalSpent,
    left,
    isOverspent: left < -OVER_PLAN_TOLERANCE,
  };
}

export interface MonthPosition {
  day: number;
  daysInMonth: number;
  /** Days after today; today itself counts as gone. */
  daysLeft: number;
  /** 0..1, the end of today within the month. */
  fraction: number;
}

export function monthPosition(today: Date): MonthPosition {
  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();
  const day = today.getDate();

  return {
    day,
    daysInMonth,
    daysLeft: daysInMonth - day,
    fraction: day / daysInMonth,
  };
}

export interface MeasureGeometry {
  /** Where the plan ends, as a percentage of the scale. */
  plan: number;
  /** Spending within the plan. */
  fill: number;
  /** Spending past the plan, drawn from `plan` onwards. */
  over: number;
}

/**
 * One amount against its plan on a scale shared by its neighbours, so a
 * €58 plan and a €548 plan read at their true sizes. Everything is clipped
 * to the scale; a refund (negative spending) draws nothing.
 */
export function measureGeometry(
  spent: number,
  planned: number,
  scaleMax: number,
): MeasureGeometry {
  if (!(scaleMax > 0)) return { plan: 0, fill: 0, over: 0 };

  const safeSpent = Math.max(0, spent);
  const safePlanned = Math.max(0, planned);
  const plan = clampPercent((safePlanned / scaleMax) * 100);
  const fill = clampPercent(
    (Math.min(safeSpent, safePlanned) / scaleMax) * 100,
  );
  const overAmount = Math.max(0, safeSpent - safePlanned);
  const over = Math.min(
    100 - plan,
    clampPercent((overAmount / scaleMax) * 100),
  );

  return { plan, fill, over };
}

export interface OverPlanLine {
  key: number;
  /** The raw category name, for `getCategoryDisplayName`. */
  name: string;
  /** The parent's raw name when the line is a subcategory. */
  parentName: string | null;
  spent: number;
  planned: number;
  over: number;
}

const isOver = (spent: number | undefined, planned: number) =>
  (spent ?? 0) - planned > OVER_PLAN_TOLERANCE;

/**
 * The most specific lines that spent past their plan, worst first: a
 * subcategory over its own plan names itself (with its parent), and a parent
 * is listed only when it is over and none of its subcategories is, which is
 * spending booked to the parent directly.
 */
export function overPlanLines(rows: BudgetRow[]): OverPlanLine[] {
  const lines: OverPlanLine[] = [];

  for (const row of rows) {
    // A subcategory's plan arrives as entered (a yearly €600 is 600); its
    // month is the budget screen's own spread of it, so compare against that,
    // plus whatever rollover carried in (the row's available amount).
    const overChildren = row.subRows
      .map((child) => ({ child, planned: getMonthlyAvailableValue(child) }))
      .filter(({ child, planned }) => isOver(child.spent, planned));

    for (const { child, planned } of overChildren) {
      lines.push({
        key: child.key,
        name: child.name,
        parentName: row.name,
        spent: child.spent,
        planned,
        over: child.spent - planned,
      });
    }

    const rowAvailable = row.budgeted + (row.rolledOver ?? 0);
    if (overChildren.length === 0 && isOver(row.spent, rowAvailable)) {
      lines.push({
        key: row.key,
        name: row.name,
        parentName: null,
        spent: row.spent,
        planned: rowAvailable,
        over: row.spent - rowAvailable,
      });
    }
  }

  return lines.sort((a, b) => b.over - a.over);
}

export type BalanceSheetType =
  "accounts" | "portfolios" | "manualAssets" | "loans" | "other";

export interface BalanceSheetRow {
  key: string;
  recordId?: number;
  label: string;
  amount: number;
  /**
   * A portfolio already inside this account's balance: listed for the breakdown, left out of
   * every total so the money counts once.
   */
  countedInAccountId?: number;
  /** One member's figure: their share of a split account, in percent, when not all of it. */
  sharePercent?: number;
}

const counted = (row: BalanceSheetRow) => row.countedInAccountId === undefined;
const totalOf = (rows: BalanceSheetRow[]) =>
  rows.filter(counted).reduce((sum, row) => sum + row.amount, 0);

export interface BalanceSheetGroup {
  type: BalanceSheetType;
  rows: BalanceSheetRow[];
  total: number;
}

export interface BalanceSheet {
  own: BalanceSheetGroup[];
  owe: BalanceSheetGroup[];
  ownTotal: number;
  /** Positive: what is owed, not a negative balance. */
  oweTotal: number;
}

const GROUP_ORDER: BalanceSheetType[] = [
  "accounts",
  "portfolios",
  "manualAssets",
  "loans",
  "other",
];

function rowType(key: string): BalanceSheetType {
  const prefix = key.split(":", 1)[0];
  return (GROUP_ORDER as string[]).includes(prefix)
    ? (prefix as BalanceSheetType)
    : "other";
}

function groupRows(
  rows: BalanceSheetRow[],
  accountOrder: number[],
): BalanceSheetGroup[] {
  return GROUP_ORDER.flatMap((type) => {
    const members = rows.filter((row) => rowType(row.key) === type);
    if (members.length === 0) return [];
    return [
      {
        type,
        rows: type === "accounts" ? inAccountOrder(members, accountOrder) : members,
        total: totalOf(members),
      },
    ];
  });
}

/**
 * The accounts group in the member's own account order (`GET /v1/account`). An account the
 * order does not name keeps its place after the named ones, so the sheet never drops a row.
 */
function inAccountOrder(
  rows: BalanceSheetRow[],
  accountOrder: number[],
): BalanceSheetRow[] {
  if (accountOrder.length === 0) return rows;
  const place = new Map(accountOrder.map((accountKey, index) => [accountKey, index]));
  return [...rows].sort(
    (a, b) =>
      (place.get(a.recordId ?? -1) ?? Number.MAX_SAFE_INTEGER) -
      (place.get(b.recordId ?? -1) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * Net worth as two sides: what is owned and what is owed, grouped by kind,
 * and each side's total. A negative account balance
 * is debt, so it moves to the owed side (as `useNetWorth` already flags it).
 * `accountOrder` is the member's account list, so the accounts group reads in
 * the same order as the accounts page.
 */
export function balanceSheet(
  netWorth: NetWorth,
  accountOrder: number[] = [],
): BalanceSheet {
  const rows = netWorth.rows ?? [];
  const owned = rows
    .filter((row) => !row.isLiability)
    .map(({ key, recordId, label, amount, countedInAccountId, sharePercent }) => ({
      key,
      recordId,
      label,
      amount,
      ...(countedInAccountId === undefined ? {} : { countedInAccountId }),
      ...(sharePercent === undefined ? {} : { sharePercent }),
    }));
  const owed = rows
    .filter((row) => row.isLiability)
    .map(({ key, recordId, label, amount, sharePercent }) => ({
      key,
      recordId,
      label,
      amount: Math.abs(amount),
      ...(sharePercent === undefined ? {} : { sharePercent }),
    }));

  const ownTotal = totalOf(owned);
  const oweTotal = totalOf(owed);

  return {
    own: groupRows(owned, accountOrder),
    owe: groupRows(owed, accountOrder),
    ownTotal,
    oweTotal,
  };
}

export interface NetWorthChange {
  /** Net worth now less net worth at the close of `since`. */
  delta: number;
  /** The first day of the month the change is measured from, as the API dates it. */
  since: string;
}

export interface NetWorthChanges {
  lastMonth: NetWorthChange | null;
  /** From the oldest month in the history, when that is older than last month. */
  overHistory: NetWorthChange | null;
}

const utcMonthKey = (iso: string) => iso.slice(0, 7);

/**
 * How far net worth has moved since the close of last month and since the
 * close of the oldest month in the history. `points` are the history report's
 * month-closing points, each dated the first of its month (a floating date,
 * read as written); `current` is today's net worth, so the change ends on the
 * same figure the screen headlines.
 */
export function netWorthChanges(
  points: Array<{ date: string; netWorth: number }>,
  current: number,
  today: Date,
): NetWorthChanges {
  const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const change = (point: { date: string; netWorth: number }) => ({
    delta: current - point.netWorth,
    since: point.date,
  });

  const lastMonth = sorted.find(
    (point) => utcMonthKey(point.date) === lastMonthKey,
  );
  const oldest = sorted[0];

  return {
    lastMonth: lastMonth ? change(lastMonth) : null,
    overHistory:
      oldest && utcMonthKey(oldest.date) < lastMonthKey ? change(oldest) : null,
  };
}

export interface MonthTotals {
  income: number;
  expenses: number;
  savingsRate: number | null;
}

export interface MonthComparisonRange {
  /** First day of the previous month, local. */
  from: Date;
  /** End of the comparison day, local. */
  to: Date;
  /** The previous month's first day, for the label. */
  month: Date;
  /** True when the range ends on the same day of the month, not the month's end. */
  samePoint: boolean;
}

/**
 * The period to compare this month against. While the month is still running,
 * a full previous month would compare a part with a whole, so the range ends
 * on the same day of the previous month (clamped to its length). On the last
 * day it is the whole previous month.
 */
export function monthComparisonRange(today: Date): MonthComparisonRange {
  const month = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const daysInPreviousMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    0,
  ).getDate();
  const daysInCurrentMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();
  const samePoint = today.getDate() < daysInCurrentMonth;
  const day = samePoint
    ? Math.min(today.getDate(), daysInPreviousMonth)
    : daysInPreviousMonth;

  return {
    from: month,
    month,
    samePoint,
    to: new Date(
      today.getFullYear(),
      today.getMonth() - 1,
      day,
      23,
      59,
      59,
      999,
    ),
  };
}

export interface SavingsSummary {
  income: number;
  spending: number;
  savingsRate: number | null;
  /** The same figures for the comparison period; null when it has no data. */
  comparison: (MonthTotals & { month: Date; samePoint: boolean }) | null;
  incomeDelta: number | null;
  spendingDelta: number | null;
  /** Percentage points, e.g. 3 for +3 pts. */
  savingsRateDelta: number | null;
}

/**
 * This month's income, spending and savings rate beside the comparison
 * period's. A figure the comparison period has no data for has no delta, not
 * a zero one.
 */
export function savingsSummary(
  current: MonthTotals | undefined,
  previous: MonthTotals | undefined,
  range: MonthComparisonRange,
): SavingsSummary | null {
  if (
    !current ||
    typeof current.income !== "number" ||
    typeof current.expenses !== "number"
  ) {
    return null;
  }

  const currentRate =
    typeof current.savingsRate === "number" ? current.savingsRate : null;
  const previousRate =
    previous && typeof previous.savingsRate === "number"
      ? previous.savingsRate
      : null;

  return {
    income: current.income,
    spending: current.expenses,
    savingsRate: currentRate,
    comparison: previous
      ? { ...previous, month: range.month, samePoint: range.samePoint }
      : null,
    incomeDelta: previous ? current.income - previous.income : null,
    spendingDelta: previous ? current.expenses - previous.expenses : null,
    savingsRateDelta:
      previous && currentRate !== null && previousRate !== null
        ? (currentRate - previousRate) * 100
        : null,
  };
}

export interface CashflowBar {
  date: string;
  amount: number;
  /** Percentage of the track, measured from the zero line. */
  width: number;
}

export interface CashflowScale {
  /** Where zero sits, as a percentage from the left. */
  zero: number;
  bars: CashflowBar[];
}

/**
 * Monthly net cash flow as bars diverging from one zero line: outflows to the
 * left, inflows to the right, both on the same scale. Oldest month first.
 */
export function cashflowScale(
  points: Array<Pick<AccountCashflow, "date" | "amount">>,
): CashflowScale {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const mostOut = Math.max(0, ...sorted.map((point) => -point.amount));
  const mostIn = Math.max(0, ...sorted.map((point) => point.amount));
  const span = mostOut + mostIn;

  return {
    zero: span > 0 ? (mostOut / span) * 100 : 0,
    bars: sorted.map((point) => ({
      ...point,
      width: span > 0 ? (Math.abs(point.amount) / span) * 100 : 0,
    })),
  };
}

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Active loans with a payment due today or later, soonest first. */
export function upcomingLoanPayments(
  loans: LoanListItem[],
  today: Date,
): LoanListItem[] {
  const todayKey = localDateKey(today);

  return loans
    .filter(
      (loan) =>
        loan.status === "ACTIVE" &&
        typeof loan.nextPaymentDate === "string" &&
        loan.nextPaymentDate.slice(0, 10) >= todayKey,
    )
    .sort((a, b) =>
      (a.nextPaymentDate ?? "").localeCompare(b.nextPaymentDate ?? ""),
    );
}

/**
 * A month's name in the reader's locale. Plain `Intl`, like
 * `formatShortDateForLocale`, rather than next-intl's formatter, which wants a
 * configured time zone this app does not set.
 */
export function formatMonthName(
  date: Date,
  locale: string,
  options: { withYear?: boolean; short?: boolean; utc?: boolean } = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    month: options.short ? "short" : "long",
    ...(options.withYear ? { year: "numeric" } : {}),
    ...(options.utc ? { timeZone: "UTC" } : {}),
  }).format(date);
}
