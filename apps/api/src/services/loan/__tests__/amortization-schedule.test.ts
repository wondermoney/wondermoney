import { describe, expect, it } from 'vitest';

import { buildAmortizationSchedule } from '@service/loan/amortization-schedule';
import { LoanAmortizationMethod } from '@service/loan/loan-types';
import { sumMoney } from '@utils/money';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const sum = (values: number[]) => sumMoney(values, 2);

function schedule(input: {
  annualInterestRateBps?: number;
  firstPaymentDate?: Date;
  method?: LoanAmortizationMethod;
  principal?: number;
  termMonths?: number;
}) {
  return buildAmortizationSchedule({
    annualInterestRateBps: input.annualInterestRateBps ?? 500,
    firstPaymentDate: input.firstPaymentDate ?? day('2026-01-15'),
    method: input.method ?? LoanAmortizationMethod.FRENCH,
    principal: input.principal ?? 100_000,
    termMonths: input.termMonths ?? 360,
  });
}

/*
 * Reference values were computed independently with exact decimal arithmetic
 * (Python `decimal`, 50 digits) before being pinned here. The French level
 * payment for 100,000 at 5% over 360 months is 536.821623... → 536.82, and the
 * SAC interest total is 75,207.73 when each row's interest is rounded to 2dp.
 */
describe('buildAmortizationSchedule', () => {
  describe('French (level payment)', () => {
    it('matches the reference schedule for 100,000 at 5% over 360 months', () => {
      const result = schedule({ method: LoanAmortizationMethod.FRENCH });

      expect(result.rows).toHaveLength(360);
      expect(result.rows[0]).toMatchObject({
        endingBalance: 99_879.85,
        interest: 416.67,
        number: 1,
        payment: 536.82,
        principal: 120.15,
      });
      expect(result.rows[358]).toMatchObject({
        endingBalance: 535.73,
        interest: 4.45,
        number: 359,
        payment: 536.82,
        principal: 532.37,
      });
      // The last row absorbs the rounding residue instead of leaving a cent behind.
      expect(result.rows[359]).toMatchObject({
        endingBalance: 0,
        interest: 2.23,
        number: 360,
        payment: 537.96,
        principal: 535.73,
      });
      expect(result.totalInterest).toBe(93_256.34);
      expect(result.totalPaid).toBe(193_256.34);
    });

    it('splits every payment into interest and principal that add up to it', () => {
      const result = schedule({ method: LoanAmortizationMethod.FRENCH });

      for (const row of result.rows) {
        expect(sum([row.interest, row.principal])).toBe(row.payment);
      }
    });
  });

  describe('constant principal (SAC)', () => {
    it('matches the reference schedule for 100,000 at 5% over 360 months', () => {
      const result = schedule({ method: LoanAmortizationMethod.CONSTANT_PRINCIPAL });

      expect(result.rows).toHaveLength(360);
      expect(result.rows[0]).toMatchObject({
        endingBalance: 99_722.22,
        interest: 416.67,
        number: 1,
        payment: 694.45,
        principal: 277.78,
      });
      expect(result.rows[358]).toMatchObject({
        endingBalance: 276.98,
        interest: 2.31,
        number: 359,
        payment: 280.09,
        principal: 277.78,
      });
      expect(result.rows[359]).toMatchObject({
        endingBalance: 0,
        interest: 1.15,
        number: 360,
        payment: 278.13,
        principal: 276.98,
      });
      expect(result.totalInterest).toBe(75_207.73);
      expect(result.totalPaid).toBe(175_207.73);
    });

    it('keeps the principal constant except for the final residue row', () => {
      const result = schedule({ method: LoanAmortizationMethod.CONSTANT_PRINCIPAL });

      for (const row of result.rows.slice(0, -1)) {
        expect(row.principal).toBe(277.78);
      }
      expect(result.rows.at(-1)?.principal).toBe(276.98);
    });
  });

  it.each([
    [LoanAmortizationMethod.FRENCH],
    [LoanAmortizationMethod.CONSTANT_PRINCIPAL],
  ])('sums the principal to the original principal exactly (%s)', (method) => {
    for (const input of [
      { annualInterestRateBps: 500, principal: 100_000, termMonths: 360 },
      { annualInterestRateBps: 0, principal: 1_000, termMonths: 3 },
      { annualInterestRateBps: 1_200, principal: 1_000, termMonths: 2 },
      { annualInterestRateBps: 387, principal: 12_345.67, termMonths: 84 },
    ]) {
      const result = schedule({ ...input, method });

      expect(sum(result.rows.map((row) => row.principal))).toBe(input.principal);
      expect(result.rows.at(-1)?.endingBalance).toBe(0);
    }
  });

  it.each([
    [LoanAmortizationMethod.FRENCH],
    [LoanAmortizationMethod.CONSTANT_PRINCIPAL],
  ])('handles a 0%% loan (%s)', (method) => {
    const result = schedule({ annualInterestRateBps: 0, method, principal: 1_000, termMonths: 3 });

    expect(result.rows.map((row) => row.payment)).toEqual([333.33, 333.33, 333.34]);
    expect(result.rows.map((row) => row.interest)).toEqual([0, 0, 0]);
    expect(result.totalInterest).toBe(0);
    expect(result.totalPaid).toBe(1_000);
  });

  it('handles a short term where the final payment is the whole remainder', () => {
    const french = schedule({ annualInterestRateBps: 1_200, method: LoanAmortizationMethod.FRENCH, principal: 1_000, termMonths: 2 });
    expect(french.rows).toMatchObject([
      { endingBalance: 502.49, interest: 10, payment: 507.51, principal: 497.51 },
      { endingBalance: 0, interest: 5.02, payment: 507.51, principal: 502.49 },
    ]);

    const sac = schedule({ annualInterestRateBps: 1_200, method: LoanAmortizationMethod.CONSTANT_PRINCIPAL, principal: 1_000, termMonths: 2 });
    expect(sac.rows).toMatchObject([
      { endingBalance: 500, interest: 10, payment: 510, principal: 500 },
      { endingBalance: 0, interest: 5, payment: 505, principal: 500 },
    ]);
  });

  it('handles a one-month term', () => {
    const result = schedule({ annualInterestRateBps: 1_200, method: LoanAmortizationMethod.FRENCH, principal: 1_000, termMonths: 1 });

    expect(result.rows).toEqual([
      expect.objectContaining({ endingBalance: 0, interest: 10, number: 1, payment: 1_010, principal: 1_000 }),
    ]);
  });

  it('advances dates by calendar month and clamps to the end of shorter months', () => {
    const result = schedule({ firstPaymentDate: day('2026-01-31'), method: LoanAmortizationMethod.FRENCH, principal: 1_000, termMonths: 4 });

    expect(result.rows.map((row) => row.date.toISOString().slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('keeps the day of month across a leap February', () => {
    const result = schedule({ firstPaymentDate: day('2028-01-31'), method: LoanAmortizationMethod.FRENCH, principal: 1_000, termMonths: 3 });

    expect(result.rows.map((row) => row.date.toISOString().slice(0, 10))).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('rejects a non-positive principal or term', () => {
    expect(() => schedule({ principal: 0 })).toThrow(RangeError);
    expect(() => schedule({ termMonths: 0 })).toThrow(RangeError);
  });
});
