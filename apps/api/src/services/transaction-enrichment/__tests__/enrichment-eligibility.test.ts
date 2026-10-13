import { describe, expect, it } from 'vitest';

import { isUncategorisableByDescription } from '../enrichment-eligibility';

/**
 * Every string below is a real production description from the RAD-444
 * evaluation sample. The excluded ones are transactions the model had already
 * been asked about and answered wrongly with high confidence.
 */
describe('isUncategorisableByDescription', () => {
  it.each([
    ['LEV ATM 3170 BPI   BRAGA         Lg Barao S Mar', 'ATM withdrawal at BPI Braga → the model said FUEL'],
    ['ATM withdrawal at BCP, Aveiro.', 'English-normalised form of the same row'],
    ['LEVANT Ecomarche    6316486/16   Ecomarche   R Chaes', 'cash withdrawal at a supermarket'],
    ['Levantamento Pingo Doce Tagides Park', 'Portuguese withdrawal wording'],
    ['TRF MB WAY P  MONICA PINTO', 'MB Way to a person → the model said CAFE_RESTAURANTS_BARS'],
    ['Transfer via MB Way to Monica Pinto', 'normalised MB Way form'],
    ['TRF SEPA+ INST 89 P/ PT50003502160003244920038 ISA CATIA FER', 'SEPA transfer to an IBAN'],
    ['Transferência Imediata para Ordepio Franc', 'immediate transfer, accented'],
    ['Transferencia Imediata para Ordepio Franc', 'immediate transfer, unaccented'],
    ['ORDEM PERMANENTE SEPA+ Transferencia Mensal PARA Hugo Tome', 'standing order'],
    ['Trsf.p/Ferias', 'self-transfer to a savings pot → the model said TRAVEL'],
    ['TRF.IMED.   P/ T212-E04212208', 'transfer to a brokerage'],
  ])('excludes %s (%s)', (description) => {
    expect(isUncategorisableByDescription({ description })).toBe(true);
  });

  it.each([
    ['Mercadona', 'a plain merchant name'],
    ['COMPRA 2868 IKEA BRAGA CAIXAS ECO B CONTACTLESS', 'a card purchase'],
    ['Lidl Agradece', 'grocery'],
    ['Petrogal S A', 'fuel'],
    ['Netflix.com', 'a subscription'],
    ['PAG BXVAL- 0502 VIAVERDE', 'a toll payment — categorisable, just categorised wrongly today'],
    ['DD Generali Tranq 49200931040    PT19108811', 'a direct debit names its creditor'],
    ['Purchase at Stradivarius Braga Contactless', 'retail'],
  ])('keeps %s (%s)', (description) => {
    expect(isUncategorisableByDescription({ description })).toBe(false);
  });

  it('checks the raw bank description too, since normalisation can drop the marker', () => {
    expect(
      isUncategorisableByDescription({
        description: 'Shop Serra Nova Lj 57 58',
        descriptionDirty: 'LEV 8442573.89 Shop Serra Nova, Lj 57-58',
      }),
    ).toBe(true);
  });

  it('treats a missing description as categorisable rather than throwing', () => {
    expect(isUncategorisableByDescription({})).toBe(false);
    expect(isUncategorisableByDescription({ description: null, descriptionDirty: null })).toBe(false);
    expect(isUncategorisableByDescription({ description: '   ' })).toBe(false);
  });
});
