import { describe, expect, it } from 'vitest';

import { parseInstallmentMarker } from '../installment-description';

describe('reading an installment marker from a bank description', () => {
  it.each([
    { description: 'PARC 03/12', expected: { explicit: true, installmentCount: 12, installmentNumber: 3, stem: '' } },
    { description: 'LOJAS AMERICANAS PARC 03/12', expected: { explicit: true, installmentCount: 12, installmentNumber: 3, stem: 'LOJAS AMERICANAS' } },
    { description: 'Lojas Americanas - Parc. 3/12', expected: { explicit: true, installmentCount: 12, installmentNumber: 3, stem: 'Lojas Americanas' } },
    { description: 'MAGALU PARCELA 10/10', expected: { explicit: true, installmentCount: 10, installmentNumber: 10, stem: 'MAGALU' } },
    { description: 'Worten Prestacao 2/6', expected: { explicit: true, installmentCount: 6, installmentNumber: 2, stem: 'Worten' } },
    { description: 'FNAC PRESTAÇÃO 1 DE 4', expected: { explicit: true, installmentCount: 4, installmentNumber: 1, stem: 'FNAC' } },
    { description: 'El Corte Ingles cuota 5/18', expected: { explicit: true, installmentCount: 18, installmentNumber: 5, stem: 'El Corte Ingles' } },
    { description: 'APPLE STORE (3/12)', expected: { explicit: false, installmentCount: 12, installmentNumber: 3, stem: 'APPLE STORE' } },
    { description: 'AMAZON 3/12', expected: { explicit: false, installmentCount: 12, installmentNumber: 3, stem: 'AMAZON' } },
    { description: '3/12', expected: { explicit: false, installmentCount: 12, installmentNumber: 3, stem: '' } },
    { description: 'NETSHOES 01/03 SAO PAULO', expected: { explicit: false, installmentCount: 3, installmentNumber: 1, stem: 'NETSHOES SAO PAULO' } },
  ])('reads "$description"', ({ description, expected }) => {
    expect(parseInstallmentMarker(description)).toEqual(expected);
  });

  it.each([
    'SUPERMERCADO CONTINENTE',
    // Calendar dates, not installments.
    'COMPRA 15/03',
    'TRF 03/12/2026',
    'PAGAMENTO 2026/03',
    '12/03/26 PINGO DOCE',
    // Out of range: the number is past the count, or there is nothing to split.
    'PARC 13/12',
    'PARC 0/12',
    'PARC 1/1',
    'PARC 3/999',
    'IVA 23/100',
    '',
  ])('finds no installment in "%s"', (description) => {
    expect(parseInstallmentMarker(description)).toBeNull();
  });

  it('reads nothing from a missing description', () => {
    expect(parseInstallmentMarker(null)).toBeNull();
    expect(parseInstallmentMarker(undefined)).toBeNull();
  });
});
