import { describe, expect, it } from 'vitest';

import {
  clampDayToMonth,
  closeDateFor,
  dueDateAfter,
  isInStatement,
  statementForDate,
  statementsBetween,
  toCalendarDate,
  utcDayNumber,
} from '@service/account/credit-card-cycle';
import { currentStatement, summarizeStatement } from '@service/account/credit-card-statement.service';

const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);
const day = (value: Date | string) => toCalendarDate(typeof value === 'string' ? utc(value) : value);

/*
 * The cycle is pure calendar arithmetic, so it is tested directly: a wrong statement boundary
 * moves money to the wrong month, which is the one thing a card page must never do.
 */
describe('credit card statement cycle', () => {
  describe('clamping a close day to a short month', () => {
    it('closes on 28 February when the card closes on the 31st in a common year', () => {
      expect(clampDayToMonth(2026, 1, 31)).toBe(28);
      expect(day(closeDateFor(2026, 1, 31))).toBe('2026-02-28');
    });

    it('closes on 29 February in a leap year', () => {
      expect(clampDayToMonth(2028, 1, 31)).toBe(29);
      expect(day(closeDateFor(2028, 1, 31))).toBe('2028-02-29');
    });

    it('closes on the 30th of a 30-day month', () => {
      expect(day(closeDateFor(2026, 3, 31))).toBe('2026-04-30');
    });
  });

  describe('the statement a date belongs to', () => {
    const cycle = { paymentDueDay: 20, statementCloseDay: 31 };

    it('puts a 31st-closing card in February on a period that ends on the 28th', () => {
      const statement = statementForDate(cycle, utc('2026-02-15'));

      expect(day(statement.periodStart)).toBe('2026-02-01');
      expect(day(statement.periodEnd)).toBe('2026-02-28');
    });

    it('counts a transaction on the close day in the statement that closes that day', () => {
      const statement = statementForDate(cycle, utc('2026-01-31'));

      expect(day(statement.periodEnd)).toBe('2026-01-31');
      expect(day(statement.periodStart)).toBe('2026-01-01');
    });

    it('starts the next statement the day after the close', () => {
      const statement = statementForDate(cycle, utc('2026-02-01'));

      expect(day(statement.periodStart)).toBe('2026-02-01');
      expect(day(statement.periodEnd)).toBe('2026-02-28');
    });

    it('keeps a 1st-of-month transaction in the statement closing that month', () => {
      const statement = statementForDate(cycle, utc('2026-03-01'));

      expect(day(statement.periodStart)).toBe('2026-03-01');
      expect(day(statement.periodEnd)).toBe('2026-03-31');
    });

    it('rolls a date after December’s close into January of the next year', () => {
      const statement = statementForDate(cycle, utc('2026-12-31'));

      expect(day(statement.periodEnd)).toBe('2026-12-31');
      expect(day(statementForDate(cycle, utc('2027-01-01')).periodEnd)).toBe('2027-01-31');
    });
  });

  describe('the due date', () => {
    it('is in the same month when the due day follows the close day', () => {
      const statement = statementForDate({ paymentDueDay: 25, statementCloseDay: 5 }, utc('2026-01-03'));

      expect(day(statement.periodEnd)).toBe('2026-01-05');
      expect(day(statement.dueDate)).toBe('2026-01-25');
    });

    it('is in the next month when the due day precedes the close day', () => {
      const statement = statementForDate({ paymentDueDay: 10, statementCloseDay: 20 }, utc('2026-01-15'));

      expect(day(statement.periodEnd)).toBe('2026-01-20');
      expect(day(statement.dueDate)).toBe('2026-02-10');
    });

    it('clamps a 31st due day to the next month’s last day', () => {
      const statement = statementForDate({ paymentDueDay: 31, statementCloseDay: 20 }, utc('2026-01-25'));

      expect(day(statement.dueDate)).toBe('2026-02-28');
    });

    it('never lands on or before the close', () => {
      const due = dueDateAfter(utc('2026-01-31'), 31);

      expect(day(due)).toBe('2026-02-28');
    });
  });

  describe('a window of statements', () => {
    it('returns consecutive statements, oldest first, covering the window', () => {
      const statements = statementsBetween({ paymentDueDay: 10, statementCloseDay: 15 }, utc('2026-01-10'), utc('2026-03-10'));

      expect(statements.map((statement) => day(statement.periodEnd))).toEqual([
        '2026-01-15',
        '2026-02-15',
        '2026-03-15',
      ]);
    });

    it('includes the statement that started before the window', () => {
      // 20 January is after the 15th close, so the first statement starts on 16 January.
      const statements = statementsBetween({ paymentDueDay: 10, statementCloseDay: 15 }, utc('2026-01-20'), utc('2026-02-20'));

      expect(statements.map((statement) => day(statement.periodEnd))).toEqual(['2026-02-15', '2026-03-15']);
      const [first] = statements;
      expect(first && day(first.periodStart)).toBe('2026-01-16');
    });
  });
});

describe('statement totals', () => {
  const period = statementForDate({ paymentDueDay: 10, statementCloseDay: 31 }, utc('2026-01-15'));

  it('counts charges as a positive figure and payments against them', () => {
    const totals = summarizeStatement(
      [
        { amount: -120, transactionDate: utc('2026-01-03') },
        { amount: -80.5, transactionDate: utc('2026-01-31') },
        { amount: 200, transactionDate: utc('2026-01-20') },
        { amount: -999, transactionDate: utc('2026-02-01') },
      ],
      period,
    );

    expect(totals).toEqual({ balance: 0.5, charges: 200.5, payments: 200 });
  });

  it('moves a transaction to the statement its override names', () => {
    const rows = [{ amount: -100, statementDateOverride: utc('2026-02-10'), transactionDate: utc('2026-01-28') }];

    expect(summarizeStatement(rows, period)).toEqual({ balance: 0, charges: 0, payments: 0 });
    expect(summarizeStatement(rows, statementForDate({ paymentDueDay: 10, statementCloseDay: 31 }, utc('2026-02-10')))).toEqual({ balance: 100, charges: 100, payments: 0 });
  });

  it('reports the credit still available against the limit', () => {
    const statement = currentStatement(
      [{ amount: -300, transactionDate: utc('2026-01-10') }, { amount: 100, transactionDate: utc('2026-01-12') }],
      { paymentDueDay: 10, statementCloseDay: 31 },
      1000,
      utc('2026-01-15'),
    );

    expect(statement).toMatchObject({ availableCredit: 800, balance: 200, charges: 300, isCurrent: true, payments: 100 });
  });

  it('reports no available credit when no limit is set', () => {
    const statement = currentStatement([{ amount: -300, transactionDate: utc('2026-01-10') }], { paymentDueDay: 10, statementCloseDay: 31 }, null, utc('2026-01-15'));

    expect(statement.availableCredit).toBeNull();
    expect(statement.balance).toBe(300);
  });
});

describe('statement day helpers', () => {
  it('treats consecutive calendar days as consecutive day numbers', () => {
    expect(utcDayNumber(utc('2026-02-28')) + 1).toBe(utcDayNumber(utc('2026-03-01')));
  });

  it('includes both ends of the period', () => {
    const period = statementForDate({ paymentDueDay: 10, statementCloseDay: 15 }, utc('2026-01-10'));

    expect(isInStatement(period, utc('2026-01-01'))).toBe(true);
    expect(isInStatement(period, utc('2026-01-15'))).toBe(true);
    expect(isInStatement(period, utc('2026-01-16'))).toBe(false);
  });
});
