import { type CreditCardCycle, statementForDate, type StatementPeriod, utcDayNumber } from '@service/account/credit-card-cycle';

import { splitInstallmentAmounts } from './installment-split';

/**
 * The schedule of an installment plan, as pure calendar arithmetic.
 *
 * - The amounts come from `splitInstallmentAmounts`: they sum to the total exactly, with the
 *   rounding on the last one.
 * - On a card with a statement cycle (`credit-card-cycle.ts`), the first installment is in the
 *   statement that contains the purchase and each next one in the statement after: one per
 *   statement, never two, never a gap. An installment is dated on the purchase's day of the month
 *   in its own month (clamped to a short month's end) and moved inside its statement when that day
 *   falls outside it.
 * - Without a cycle, the installments simply fall monthly on the purchase's day of the month.
 *
 * Every date is a UTC calendar day.
 */

const MS_PER_DAY = 86_400_000;

export interface InstallmentScheduleInput {
  cycle: CreditCardCycle | null;
  installmentCount: number;
  purchaseDate: Date;
  totalAmount: number;
}

export type InstallmentStatus = 'paid' | 'unmatched' | 'upcoming';

export interface ScheduledInstallment {
  amount: number;
  dueDate: Date | null;
  installmentNumber: number;
  scheduledDate: Date;
  statementDate: Date | null;
}

/** UTC midnight of the date's calendar day. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** `date` moved by whole months, keeping its day of the month and clamping it to a short month. */
export function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(date.getUTCDate(), lastDay)));
}

export function buildInstallmentSchedule(input: InstallmentScheduleInput): ScheduledInstallment[] {
  const purchase = startOfUtcDay(input.purchaseDate);
  const amounts = splitInstallmentAmounts(input.totalAmount, input.installmentCount);
  let statement = input.cycle ? statementForDate(input.cycle, purchase) : null;

  return amounts.map((amount, index) => {
    const monthly = addMonthsClamped(purchase, index);
    if (!input.cycle || !statement) {
      return { amount, dueDate: null, installmentNumber: index + 1, scheduledDate: monthly, statementDate: null };
    }
    const current = statement;
    // The day after a close is the first day of the next statement.
    statement = statementForDate(input.cycle, new Date(current.periodEnd.getTime() + MS_PER_DAY));
    return { amount, dueDate: current.dueDate, installmentNumber: index + 1, scheduledDate: clampInto(monthly, current), statementDate: current.periodEnd };
  });
}

function clampInto(date: Date, period: StatementPeriod): Date {
  const day = utcDayNumber(date);
  if (day < utcDayNumber(period.periodStart)) return period.periodStart;
  if (day > utcDayNumber(period.periodEnd)) return period.periodEnd;
  return date;
}

/**
 * Where one installment stands: `paid` once a posted transaction is linked to it, `upcoming` (a
 * projection) from its scheduled day on, and `unmatched` when its day has passed and no posted
 * transaction was linked.
 */
export function installmentStatus(row: { linked: boolean; scheduledDate: Date }, today: Date): InstallmentStatus {
  if (row.linked) return 'paid';
  return utcDayNumber(row.scheduledDate) >= utcDayNumber(today) ? 'upcoming' : 'unmatched';
}
