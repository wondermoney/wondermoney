import { describe, expect, it } from 'vitest';

import { buildInstallmentSchedule, installmentStatus } from '../installment-schedule';

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const days = (rows: { scheduledDate: Date }[]) => rows.map((row) => row.scheduledDate.toISOString().slice(0, 10));
const closes = (rows: { statementDate: Date | null }[]) => rows.map((row) => row.statementDate?.toISOString().slice(0, 10) ?? null);

describe('an installment plan’s schedule', () => {
  it('puts one installment in each statement from the purchase’s own, with its due date', () => {
    const rows = buildInstallmentSchedule({ cycle: { paymentDueDay: 10, statementCloseDay: 5 }, installmentCount: 3, purchaseDate: utc('2026-01-20'), totalAmount: 100 });

    expect(rows.map((row) => row.installmentNumber)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(days(rows)).toEqual(['2026-01-20', '2026-02-20', '2026-03-20']);
    // Closing on the 5th: a purchase on 20 January is in the statement closing 5 February.
    expect(closes(rows)).toEqual(['2026-02-05', '2026-03-05', '2026-04-05']);
    expect(rows.map((row) => row.dueDate?.toISOString().slice(0, 10))).toEqual(['2026-02-10', '2026-03-10', '2026-04-10']);
  });

  it('never puts two installments in one statement when a short month clamps the day', () => {
    // 29 January is after a close on the 28th; 2027 has no 29 February.
    const rows = buildInstallmentSchedule({ cycle: { paymentDueDay: 10, statementCloseDay: 28 }, installmentCount: 4, purchaseDate: utc('2027-01-29'), totalAmount: 400 });

    expect(closes(rows)).toEqual(['2027-02-28', '2027-03-28', '2027-04-28', '2027-05-28']);
    for (const row of rows) {
      expect(row.scheduledDate.getTime()).toBeLessThanOrEqual(row.statementDate?.getTime() ?? 0);
    }
    expect(days(rows)).toEqual(['2027-01-29', '2027-03-01', '2027-03-29', '2027-04-29']);
  });

  it('keeps a month-end purchase on each month’s last day', () => {
    const rows = buildInstallmentSchedule({ cycle: null, installmentCount: 4, purchaseDate: utc('2026-01-31'), totalAmount: 120 });

    expect(days(rows)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(closes(rows)).toEqual([null, null, null, null]);
  });

  it('reads an installment as paid, upcoming from today on, and unmatched before today', () => {
    const today = utc('2026-03-10');

    expect(installmentStatus({ linked: true, scheduledDate: utc('2026-04-01') }, today)).toBe('paid');
    expect(installmentStatus({ linked: false, scheduledDate: utc('2026-03-10') }, today)).toBe('upcoming');
    expect(installmentStatus({ linked: false, scheduledDate: utc('2026-03-09') }, today)).toBe('unmatched');
  });
});
