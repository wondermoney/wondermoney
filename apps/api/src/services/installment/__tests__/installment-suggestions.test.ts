import { describe, expect, it } from 'vitest';

import { buildInstallmentSuggestions, type SuggestionTransaction } from '../installment-suggestions';

const utc = (day: string) => new Date(`${day}T12:00:00.000Z`);
let key = 0;
const row = (description: string, amount: number, day: string, accountKey = 1): SuggestionTransaction => ({ accountKey, amount, description, transactionDate: utc(day), transactionKey: ++key });

describe('installment plan suggestions', () => {
  it('groups the posted installments of one purchase and proposes its plan', () => {
    const suggestions = buildInstallmentSuggestions([
      row('LOJAS X PARC 01/03', -33.33, '2026-01-12'),
      row('LOJAS X PARC 02/03', -33.33, '2026-02-12'),
      row('SUPERMERCADO', -50, '2026-02-13'),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      accountKey: 1,
      description: 'LOJAS X',
      installmentAmount: 33.33,
      installmentCount: 3,
      purchaseDate: '2026-01-12',
      totalAmount: 99.99,
    });
    expect(suggestions[0]?.transactions.map((transaction) => transaction.installmentNumber)).toEqual([1, 2]);
  });

  it('takes the last installment’s own amount into the total', () => {
    const [suggestion] = buildInstallmentSuggestions([row('Loja PARC 2/3', -33.33, '2026-02-01'), row('Loja PARC 3/3', -33.34, '2026-03-01')]);

    expect(suggestion).toMatchObject({ installmentAmount: 33.33, purchaseDate: '2026-01-01', totalAmount: 100 });
  });

  it('reads a bank that dates every installment on the purchase day', () => {
    const [suggestion] = buildInstallmentSuggestions([row('NUBANK LOJA 3/10', -20, '2026-01-05'), row('NUBANK LOJA 4/10', -20, '2026-01-05')]);

    expect(suggestion).toMatchObject({ installmentCount: 10, purchaseDate: '2026-01-05', totalAmount: 200 });
  });

  it('keeps two identical purchases apart', () => {
    const suggestions = buildInstallmentSuggestions([
      row('SHOP PARC 1/2', -10, '2026-01-10'),
      row('SHOP PARC 1/2', -10, '2026-01-20'),
      row('SHOP PARC 2/2', -10, '2026-02-10'),
    ]);

    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((suggestion) => suggestion.transactions.length).sort()).toEqual([1, 2]);
  });

  it('keeps purchases on different accounts and of different amounts apart', () => {
    const suggestions = buildInstallmentSuggestions([
      row('SHOP PARC 1/4', -10, '2026-01-10', 1),
      row('SHOP PARC 2/4', -10, '2026-02-10', 2),
      row('SHOP PARC 3/4', -55, '2026-03-10', 1),
    ]);

    expect(suggestions).toHaveLength(3);
  });

  it('wants two matching rows before trusting a bare n/N, which may be a date', () => {
    expect(buildInstallmentSuggestions([row('TRF 03/12', -50, '2026-12-03')])).toEqual([]);
    expect(buildInstallmentSuggestions([row('TRF 03/12', -50, '2026-12-03'), row('TRF 05/12', -80, '2026-12-05')])).toEqual([]);
    expect(buildInstallmentSuggestions([row('APPLE 1/12', -83.33, '2026-01-03'), row('APPLE 2/12', -83.33, '2026-02-03')])).toHaveLength(1);
  });

  it('ignores refunds and rows without a marker', () => {
    expect(buildInstallmentSuggestions([row('LOJA PARC 1/3', 33.33, '2026-01-10'), row('LOJA', -10, '2026-01-10')])).toEqual([]);
  });
});
