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

export type BalanceSheetType = "accounts" | "portfolios" | "loans" | "other";

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
  "loans",
  "other",
];

function rowType(key: string): BalanceSheetType {
  const prefix = key.split(":", 1)[0];
  return (GROUP_ORDER as string[]).includes(prefix)
    ? (prefix as BalanceSheetType)
    : "other";
}

function groupRows(rows: BalanceSheetRow[]): BalanceSheetGroup[] {
  return GROUP_ORDER.flatMap((type) => {
    const members = rows.filter((row) => rowType(row.key) === type);
    if (members.length === 0) return [];
    return [
      {
        type,
        rows: members,
        total: totalOf(members),
      },
    ];
  });
}

/**
 * Net worth as two sides: what is owned and what is owed, grouped by kind,
 * and each side's total. A negative account balance
 * is debt, so it moves to the owed side (as `useNetWorth` already flags it).
 */
export function balanceSheet(netWorth: NetWorth): BalanceSheet {
  const rows = netWorth.rows ?? [];
  const owned = rows
    .filter((row) => !row.isLiability)
    .map(({ key, recordId, label, amount, countedInAccountId }) => ({
      key,
      recordId,
      label,
      amount,
      ...(countedInAccountId === undefined ? {} : { countedInAccountId }),
    }));
  const owed = rows
    .filter((row) => row.isLiability)
    .map(({ key, recordId, label, amount }) => ({
      key,
      recordId,
      label,
      amount: Math.abs(amount),
    }));

  const ownTotal = totalOf(owned);
  const oweTotal = totalOf(owed);

  return {
    own: groupRows(owned),
    owe: groupRows(owed),
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

export interface CashflowBar extends AccountCashflow {
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
export function cashflowScale(points: AccountCashflow[]): CashflowScale {
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
