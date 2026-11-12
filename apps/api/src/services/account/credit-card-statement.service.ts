import { QueryOrder } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { Account } from '@entity/Account';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { Transaction } from '@entity/Transaction';
import { BadRequestError, NotFoundError } from '@utils/errors';
import { roundDisplay } from '@utils/money';

import { type CreditCardCycle, isInStatement, statementForDate, type StatementPeriod, statementsBetween, toCalendarDate, utcDayNumber } from './credit-card-cycle';

/**
 * Statement totals for a credit card.
 *
 * The cycle (`credit-card-cycle.ts`) decides which statement a transaction belongs to; this module
 * turns that into the figures a card page shows: what the statement charges, what has been paid
 * back, what is left, and how much of the limit is still free.
 *
 * **Direction, not type.** A charge is a negative amount on the card; a payment (or a refund) is a
 * positive one. Reading the sign rather than the transaction type keeps a bank transfer payment, a
 * manual repayment and a provider refund counted the same way, and never counts a row twice.
 *
 * **Override.** A row with `statementDateOverride` is counted in the statement that contains that
 * date instead of the one its transaction date falls in — the escape hatch for a bank whose
 * statement disagrees with its own transaction feed.
 */

/**
 * Where a statement stands today.
 *
 * - `open` — the statement is still counting charges; its period has not closed.
 * - `closed` — closed and still unpaid, but not yet past its due date.
 * - `paid` — payments made since the close cover what the statement charged.
 * - `overdue` — closed, unpaid, and past its due date.
 */
export type StatementStatus = 'closed' | 'open' | 'overdue' | 'paid';

/** The fields the totals need; a `Transaction` row satisfies it, as does a plain test fixture. */
export interface CreditCardStatement extends StatementTotals {
  /** Credit still available against the limit for this statement, or null when no limit is set. */
  availableCredit: null | number;
  dueDate: string;
  /** True for the statement that contains `today` (the one the card page leads with). */
  isCurrent: boolean;
  periodEnd: string;
  periodStart: string;
  status: StatementStatus;
}

export interface CreditCardStatementsInput {
  accountKey: number;
  creditLimit: null | number | undefined;
  cycle: CreditCardCycle;
  from: Date;
  to: Date;
  today?: Date;
}

export interface StatementTotals {
  /** What the statement charged, as a positive figure. */
  charges: number;
  /** Payments and refunds counted against it, as a positive figure. */
  payments: number;
  /** `charges - payments`: what the statement still owes. */
  balance: number;
}

export interface StatementTransaction {
  /** The amount in the account's currency, signed: negative is a charge. */
  amount: null | number | undefined;
  /** Moves the row to another statement; null means the transaction date decides. */
  statementDateOverride?: Date | null;
  transactionDate?: Date | null;
}

/** The statement a row is counted in: its override when set, otherwise its transaction date. */
function statementDateOf(row: StatementTransaction): Date | null {
  return row.statementDateOverride ?? row.transactionDate ?? null;
}

/** Charges, payments and balance for one statement, from the rows that belong to it. */
export function summarizeStatement(rows: readonly StatementTransaction[], period: StatementPeriod): StatementTotals {
  let charges = 0;
  let payments = 0;
  for (const row of rows) {
    const date = statementDateOf(row);
    if (!date || !isInStatement(period, date)) continue;
    const amount = row.amount ?? 0;
    if (amount < 0) charges += -amount;
    else payments += amount;
  }
  return { balance: roundDisplay(charges - payments), charges: roundDisplay(charges), payments: roundDisplay(payments) };
}

/**
 * Payments counted against a statement after its close, as a positive figure. A payment dated on
 * the close day belongs to the statement closing that day and is already in its `payments`; only
 * later rows pay the closed statement down. Rows dated after `today` are ignored: a future-dated
 * payment has not been made yet.
 */
export function paymentsSinceClose(rows: readonly StatementTransaction[], period: StatementPeriod, today: Date): number {
  const closeDay = utcDayNumber(period.periodEnd);
  const todayDay = utcDayNumber(today);
  let paid = 0;
  for (const row of rows) {
    const date = statementDateOf(row);
    if (!date) continue;
    const day = utcDayNumber(date);
    if (day <= closeDay || day > todayDay) continue;
    const amount = row.amount ?? 0;
    if (amount > 0) paid += amount;
  }
  return roundDisplay(paid);
}

/** Allocate each post-close credit once, against the oldest outstanding statement first. */
export function allocateStatementPayments(periods: readonly StatementPeriod[], rows: readonly StatementTransaction[], today: Date): number[] {
  const balances = periods.map((period) => summarizeStatement(rows, period).charges);
  const allocated = periods.map(() => 0);
  const todayDay = utcDayNumber(today);
  const payments = rows.flatMap((row) => {
    const date = statementDateOf(row);
    const amount = row.amount ?? 0;
    return date && amount > 0 && utcDayNumber(date) <= todayDay ? [{ amount, date }] : [];
  }).sort((a, b) => utcDayNumber(a.date) - utcDayNumber(b.date));

  for (const payment of payments) {
    let remaining = payment.amount;
    const paymentDay = utcDayNumber(payment.date);
    for (let index = 0; index < periods.length && remaining > 0; index += 1) {
      const period = periods[index];
      const balance = balances[index] ?? 0;
      if (!period || balance <= 0) continue;
      const startDay = utcDayNumber(period.periodStart);
      if (paymentDay < startDay) continue;
      const applied = Math.min(remaining, balance);
      balances[index] = roundDisplay(balance - applied);
      allocated[index] = roundDisplay((allocated[index] ?? 0) + applied);
      remaining = roundDisplay(remaining - applied);
    }
  }
  return allocated;
}

/**
 * A statement's status. The due date is the boundary: on the due day itself the statement is
 * still `closed`, and only the next day makes it `overdue`. A statement is `paid` when the
 * payments made since its close cover what it charged, so a card paid off after the close never
 * reads as overdue.
 */
export function statementStatus(input: {
  dueDate: Date;
  paidSinceClose: number;
  periodEnd: Date;
  today: Date;
  totals: StatementTotals;
}): StatementStatus {
  const todayDay = utcDayNumber(input.today);
  if (todayDay <= utcDayNumber(input.periodEnd)) return 'open';
  const outstanding = roundDisplay(input.totals.balance - input.paidSinceClose);
  if (outstanding <= 0) return 'paid';
  return todayDay > utcDayNumber(input.dueDate) ? 'overdue' : 'closed';
}

/** The earliest day any row is counted in, or undefined for a card with no rows. */
function earliestStatementDate(rows: readonly StatementTransaction[]): Date | undefined {
  return rows.map(statementDateOf).filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime())[0];
}

/** The statement a card is in today, with its totals and the credit still available. */
export function currentStatement(rows: readonly StatementTransaction[], cycle: CreditCardCycle, creditLimit: null | number | undefined, today: Date): CreditCardStatement {
  const period = statementForDate(cycle, today);
  const earliest = earliestStatementDate(rows);
  const periods = statementsBetween(cycle, earliest && earliest.getTime() < period.periodStart.getTime() ? earliest : period.periodStart, today);
  const allocated = allocateStatementPayments(periods, rows, today);
  const index = periods.findIndex((candidate) => utcDayNumber(candidate.periodEnd) === utcDayNumber(period.periodEnd));
  return toStatement(period, rows, creditLimit, today, allocated[index] ?? 0);
}

/** `allocated`: what `allocateStatementPayments` put against this statement. */
function toStatement(period: StatementPeriod, rows: readonly StatementTransaction[], creditLimit: null | number | undefined, today: Date, allocated: number): CreditCardStatement {
  const totals = summarizeStatement(rows, period);
  const balance = roundDisplay(Math.max(0, totals.charges - allocated));
  const statusTotals = { ...totals, balance: totals.charges };
  return {
    ...totals,
    availableCredit: creditLimit == null ? null : roundDisplay(creditLimit - balance),
    balance,
    dueDate: toCalendarDate(period.dueDate),
    isCurrent: isInStatement(period, today),
    periodEnd: toCalendarDate(period.periodEnd),
    periodStart: toCalendarDate(period.periodStart),
    status: statementStatus({ dueDate: period.dueDate, paidSinceClose: allocated, periodEnd: period.periodEnd, today, totals: statusTotals }),
  };
}

/** The last instant of a date's UTC calendar day, so a row booked at 12:00 on it is still read. */
function endOfUtcDay(date: Date): Date {
  return new Date((utcDayNumber(date) + 1) * 86_400_000 - 1);
}

/**
 * The card's statements overlapping `[from, to]`, oldest first, with the one containing today
 * flagged `isCurrent`. Rows are read once and grouped in memory: a card's statement window is a
 * few months, and one query is cheaper than one per statement.
 *
 * Paying a statement depends on the whole history (each payment goes to the oldest statement still
 * owing), so the read has no lower bound, and it runs through today even when `to` is earlier: a
 * January statement paid in February must read as paid however the window is drawn.
 */
export async function getCreditCardStatements(em: EntityManager, input: CreditCardStatementsInput): Promise<CreditCardStatement[]> {
  const today = input.today ?? new Date();
  const upperBound = endOfUtcDay(input.to.getTime() > today.getTime() ? input.to : today);
  const rows = await em.find(
    Transaction,
    {
      $or: [{ statementDateOverride: { $lte: toCalendarDate(upperBound) } }, { transactionDate: { $lte: upperBound } }],
      accountKey: { accountKey: input.accountKey },
      deletedAt: undefined,
    },
    { fields: ['settlementAmount', 'statementDateOverride', 'transactionDate'] },
  );
  const mapped: StatementTransaction[] = rows.map((row) => ({
    amount: row.settlementAmount,
    statementDateOverride: row.statementDateOverride,
    transactionDate: row.transactionDate,
  }));
  const earliest = earliestStatementDate(mapped);
  const periods = statementsBetween(input.cycle, earliest && earliest.getTime() < input.from.getTime() ? earliest : input.from, input.to);
  const allocated = allocateStatementPayments(periods, mapped, today);
  return periods
    .map((period, index) => ({ index, period }))
    .filter(({ period }) => utcDayNumber(period.periodEnd) >= utcDayNumber(input.from) && utcDayNumber(period.periodStart) <= utcDayNumber(input.to))
    .map(({ index, period }) => toStatement(period, mapped, input.creditLimit, today, allocated[index] ?? 0));
}

/** The wire shape of a card's settings, shared by the PUT response and the account DTO. */
export function mapCreditCardDetail(detail: CreditCardDetail) {
  return {
    creditLimit: detail.creditLimit ?? null,
    minimumPaymentPercent: detail.minimumPaymentPercent ?? null,
    paymentDueDay: detail.paymentDueDay,
    statementCloseDay: detail.statementCloseDay,
  };
}

/** The account, scoped to the caller's tenant, or a 404 — another household's id is invisible. */
export async function findTenantCardAccount(em: EntityManager, accountKey: number, tenantKey: number): Promise<Account> {
  const account = await em.findOne(Account, { accountKey, deletedAt: undefined, tenantKey: { tenantKey } });
  if (!account) throw new NotFoundError(`Account not found: ${accountKey}`);
  return account;
}

/** One row of a statement's transaction list, signed: negative is a charge. */
export interface CreditCardStatementDetail extends CreditCardStatement {
  transactions: StatementDetailTransaction[];
}

export interface CreditCardStatementDetailInput {
  accountKey: number;
  creditLimit: null | number | undefined;
  cycle: CreditCardCycle;
  /** The statement's close day as `YYYY-MM-DD`; the period end is what names a statement. */
  statementDate: string;
  today?: Date;
}

export interface StatementDetailTransaction {
  amount: null | number;
  description: null | string;
  merchantName: null | string;
  /** The calendar day the row is counted in, `YYYY-MM-DD`. */
  transactionDate: null | string;
  transactionKey: number;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * One statement and the transactions it counts, for the statement detail view. The statement is
 * named by its close day (`periodEnd`), which is unique per card; a date that is not a close day
 * for this card's cycle is a 400 rather than a silently different statement. Its figures come from
 * `getCreditCardStatements`, so the detail always agrees with the list.
 */
export async function getCreditCardStatementDetail(em: EntityManager, input: CreditCardStatementDetailInput): Promise<CreditCardStatementDetail> {
  const today = input.today ?? new Date();
  if (!CALENDAR_DATE.test(input.statementDate)) throw new BadRequestError(`Invalid statement date: ${input.statementDate}`);
  const named = new Date(`${input.statementDate}T00:00:00.000Z`);
  if (!Number.isFinite(named.getTime())) throw new BadRequestError(`Invalid statement date: ${input.statementDate}`);
  const period = statementForDate(input.cycle, named);
  if (toCalendarDate(period.periodEnd) !== input.statementDate) {
    throw new BadRequestError(`Not a statement close day for this card: ${input.statementDate}`);
  }

  const [statement] = await getCreditCardStatements(em, {
    accountKey: input.accountKey,
    creditLimit: input.creditLimit,
    cycle: input.cycle,
    from: period.periodEnd,
    to: period.periodEnd,
    today,
  });
  if (!statement) throw new NotFoundError(`Statement not found: ${input.statementDate}`);

  // The rows the statement counts: an override names the statement outright, otherwise the
  // transaction date does. The override is a calendar-day column, compared as calendar days; the
  // transaction date is an instant, bounded by whole UTC days.
  const start = period.periodStart;
  const end = endOfUtcDay(period.periodEnd);
  const rows = await em.find(
    Transaction,
    {
      $or: [
        { statementDateOverride: { $gte: toCalendarDate(start), $lte: input.statementDate } },
        { statementDateOverride: null, transactionDate: { $gte: start, $lte: end } },
      ],
      accountKey: { accountKey: input.accountKey },
      deletedAt: undefined,
    },
    {
      fields: ['description', 'settlementAmount', 'statementDateOverride', 'transactionDate', 'transactionKey', 'transactionMerchantKey.name'],
      orderBy: { transactionDate: QueryOrder.DESC, transactionKey: QueryOrder.DESC },
    },
  );
  const transactions = rows.map((row) => ({
    amount: row.settlementAmount ?? null,
    description: row.description ?? null,
    merchantName: row.transactionMerchantKey?.name ?? null,
    transactionDate: row.transactionDate ? toCalendarDate(row.transactionDate) : null,
    transactionKey: row.transactionKey,
  }));

  return { ...statement, transactions };
}
