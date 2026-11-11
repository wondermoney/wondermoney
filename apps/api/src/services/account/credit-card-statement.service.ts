import type { EntityManager } from '@mikro-orm/postgresql';

import { Account } from '@entity/Account';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { Transaction } from '@entity/Transaction';
import { NotFoundError } from '@utils/errors';
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

/** The fields the totals need; a `Transaction` row satisfies it, as does a plain test fixture. */
export interface CreditCardStatement extends StatementTotals {
  /** Credit still available against the limit for this statement, or null when no limit is set. */
  availableCredit: null | number;
  dueDate: string;
  /** True for the statement that contains `today` (the one the card page leads with). */
  isCurrent: boolean;
  periodEnd: string;
  periodStart: string;
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

/** The statement a card is in today, with its totals and the credit still available. */
export function currentStatement(rows: readonly StatementTransaction[], cycle: CreditCardCycle, creditLimit: null | number | undefined, today: Date): CreditCardStatement {
  return toStatement(statementForDate(cycle, today), rows, creditLimit, today);
}

function toStatement(period: StatementPeriod, rows: readonly StatementTransaction[], creditLimit: null | number | undefined, today: Date): CreditCardStatement {
  const totals = summarizeStatement(rows, period);
  return {
    ...totals,
    availableCredit: creditLimit == null ? null : roundDisplay(creditLimit - totals.balance),
    dueDate: toCalendarDate(period.dueDate),
    isCurrent: isInStatement(period, today),
    periodEnd: toCalendarDate(period.periodEnd),
    periodStart: toCalendarDate(period.periodStart),
  };
}

/**
 * The card's statements overlapping `[from, to]`, oldest first, with the one containing today
 * flagged `isCurrent`. Rows are read once and grouped in memory: a card's statement window is a
 * few months, and one query is cheaper than one per statement.
 */
export async function getCreditCardStatements(em: EntityManager, input: CreditCardStatementsInput): Promise<CreditCardStatement[]> {
  const today = input.today ?? new Date();
  // A statement overlapping `from` can start almost a month before it, and an override can pull a
  // row into the window from either side, so the read is bounded by both date columns. The bounds
  // are whole UTC days: a row booked at 12:00 on the last day must still be read.
  const lowerBound = new Date((utcDayNumber(input.from) - 62) * 86_400_000);
  const upperBound = new Date((utcDayNumber(input.to) + 1) * 86_400_000 - 1);
  const rows = await em.find(
    Transaction,
    {
      $and: [
        { $or: [{ statementDateOverride: { $lte: upperBound } }, { transactionDate: { $lte: upperBound } }] },
        { $or: [{ statementDateOverride: { $gte: lowerBound } }, { transactionDate: { $gte: lowerBound } }] },
      ],
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
  return statementsBetween(input.cycle, input.from, input.to).map((period) => toStatement(period, mapped, input.creditLimit, today));
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
