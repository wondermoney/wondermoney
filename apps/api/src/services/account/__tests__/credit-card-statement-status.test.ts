import { describe, expect, it } from 'vitest';

import { statementForDate, toCalendarDate } from '@service/account/credit-card-cycle';
import { allocateStatementPayments, paymentsSinceClose, statementStatus, summarizeStatement } from '@service/account/credit-card-statement.service';

const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);
const day = (value: Date | string) => toCalendarDate(typeof value === 'string' ? utc(value) : value);

/*
 * A statement's status decides whether a person is told to pay. Getting the boundary wrong either
 * nags about a paid card or stays silent while a payment is late, so the derivation is tested
 * directly, without a database or a controller.
 */
describe('credit card statement status', () => {
  // Closing on the 5th, due on the 25th: the statement closing 5 January is due 25 January.
  const cycle = { paymentDueDay: 25, statementCloseDay: 5 };
  const january = statementForDate(cycle, utc('2026-01-05'));

  const statusOn = (today: string, rows: { amount: number; date: string }[] = []) => {
    const mapped = rows.map((row) => ({ amount: row.amount, transactionDate: utc(row.date) }));
    const totals = summarizeStatement(mapped, january);
    return statementStatus({ dueDate: january.dueDate, paidSinceClose: paymentsSinceClose(mapped, january, utc(today)), periodEnd: january.periodEnd, today: utc(today), totals });
  };

  it('is open while the statement is still counting charges', () => {
    expect(day(january.periodEnd)).toBe('2026-01-05');
    expect(statusOn('2026-01-03')).toBe('open');
    // On the close day itself the statement has not closed yet.
    expect(statusOn('2026-01-05')).toBe('open');
  });

  it('is closed once the period ends and before the due date', () => {
    expect(statusOn('2026-01-06', [{ amount: -100, date: '2026-01-04' }])).toBe('closed');
  });

  it('is still closed on the due date, and overdue only the day after', () => {
    const charge = [{ amount: -100, date: '2026-01-04' }];

    expect(statusOn('2026-01-25', charge)).toBe('closed');
    expect(statusOn('2026-01-26', charge)).toBe('overdue');
  });

  it('is paid when the payments made since the close cover what the statement charged', () => {
    const rows = [
      { amount: -100, date: '2026-01-04' },
      // Paid after the close, so it does not belong to this statement's own `payments`.
      { amount: 100, date: '2026-01-10' },
    ];

    expect(statusOn('2026-01-12', rows)).toBe('paid');
    // Paid late is still paid: a settled statement never reads as overdue.
    expect(statusOn('2026-02-01', rows)).toBe('paid');
  });

  it('stays unpaid when the payment since the close is short', () => {
    const rows = [
      { amount: -100, date: '2026-01-04' },
      { amount: 60, date: '2026-01-10' },
    ];

    expect(statusOn('2026-01-12', rows)).toBe('closed');
    expect(statusOn('2026-01-26', rows)).toBe('overdue');
  });

  it('counts a payment on the close day in the statement, not as a payment since the close', () => {
    const rows = [
      { amount: -100, date: '2026-01-04' },
      { amount: 100, date: '2026-01-05' },
    ];

    // The statement's own balance is zero, so it is paid without any later payment.
    expect(statusOn('2026-01-12', rows)).toBe('paid');
    expect(paymentsSinceClose(rows.map((row) => ({ amount: row.amount, transactionDate: utc(row.date) })), january, utc('2026-01-12'))).toBe(0);
  });

  it('ignores a future-dated payment that has not been made yet', () => {
    const rows = [
      { amount: -100, date: '2026-01-04' },
      { amount: 100, date: '2026-02-20' },
    ];

    expect(statusOn('2026-01-26', rows)).toBe('overdue');
  });

  it('is paid when the statement charged nothing', () => {
    expect(statusOn('2026-01-12')).toBe('paid');
  });

  it('allocates one payment to the oldest unpaid statement instead of paying every historical statement', () => {
    const february = statementForDate(cycle, utc('2026-02-05'));
    const march = statementForDate(cycle, utc('2026-03-05'));
    const rows = [
      { amount: -100, transactionDate: utc('2026-01-04') },
      { amount: -100, transactionDate: utc('2026-02-04') },
      { amount: 100, transactionDate: utc('2026-02-10') },
    ];

    expect(allocateStatementPayments([january, february, march], rows, utc('2026-02-12'))).toEqual([100, 0, 0]);
  });

  it('moves a row to the statement its override names', () => {
    const rows = [
      { amount: -100, date: '2026-01-04' },
      { amount: 100, date: '2026-01-10' },
    ];
    const mapped = rows.map((row, index) => ({
      amount: row.amount,
      // The payment is moved into the next statement, so this one stays unpaid.
      statementDateOverride: index === 1 ? utc('2026-02-04') : undefined,
      transactionDate: utc(row.date),
    }));
    const totals = summarizeStatement(mapped, january);

    expect(statementStatus({ dueDate: january.dueDate, paidSinceClose: paymentsSinceClose(mapped, january, utc('2026-01-12')), periodEnd: january.periodEnd, today: utc('2026-01-12'), totals })).toBe('closed');
  });
});
