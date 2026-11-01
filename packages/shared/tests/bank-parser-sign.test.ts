import { describe, expect, it } from 'vitest';

import { generateInternalTransactionId } from '../lib/entities/transactions/generate-internal-id';
import { getBankParser } from '../lib/csv';

/*
 * Every supported bank export puts the direction in a single signed amount column (BCP adds a
 * Débito/Crédito column that agrees with it). The parsers must hand that sign through untouched:
 * the import stores it as the direction, and the dedup id is built from it.
 */
const date = new Date(2026, 8, 1);
const filler = (rows: number) => Array.from({ length: rows }, () => [null]);

const layouts: { bank: string; sheet: (amount: number, text: string) => unknown[][] }[] = [
  { bank: 'activobank', sheet: (amount) => [...filler(8), [date, date, 'SALARIO ACME', amount, 0]] },
  { bank: 'bankinter', sheet: (amount) => [...filler(8), ['01-09-2026', date, 'SALARIO ACME', '-', amount, 'EUR', 0, '-', '-'], ...filler(2)] },
  { bank: 'bcp', sheet: (amount) => [...filler(13), [date, date, 'SALARIO ACME', amount, amount < 0 ? 'Débito' : 'Crédito', 0], ...filler(1)] },
  { bank: 'bpi', sheet: (amount) => [...filler(13), ['01-09-2026', '', 'SALARIO ACME', amount, 0], ...filler(3)] },
  { bank: 'montepio', sheet: (_amount, text) => [...filler(9), [date, date, 'SALARIO ACME', text, '0,00']] },
];

describe('bank statement parsers keep the file sign', () => {
  it.each(layouts.flatMap(({ bank, sheet }) => [
    { amount: 1234.5, bank, sheet: sheet(1234.5, '1.234,50') },
    { amount: -42.5, bank, sheet: sheet(-42.5, '-42,50') },
  ]))('$bank: $amount', ({ amount, bank, sheet }) => {
    const [row] = getBankParser(bank)(sheet as never);

    expect(row?.settlementAmount.toNumber()).toBe(amount);
    expect(row?.internalTransactionId).toBe(generateInternalTransactionId(date, amount));
  });
});
