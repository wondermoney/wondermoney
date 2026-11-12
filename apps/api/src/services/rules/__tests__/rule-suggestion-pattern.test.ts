import { describe, expect, it } from 'vitest';

import { cleanDescriptionPrefix, descriptionPrefixCandidates } from '../rule-suggestion-pattern';

/*
 * The description prefix a suggested rule matches on: the words that name the payee, with
 * references and numbers stripped and a bank's "COMPRA 1192" header skipped. It is normalized
 * the way the rules engine compares text, so a rule on it matches the descriptions it came from.
 */
describe('cleanDescriptionPrefix', () => {
  it.each([
    ['an MB WAY transfer keeps its prefix and drops the phone number and payee', 'TRF MB WAY 912345678 JOAO SILVA', { key: 'trf mb way', operator: 'starts_with', value: 'TRF MB WAY' }],
    ['an MB WAY transfer to a named payee is capped at three words', 'TRF. MB WAY PARA JOANA 1234567890', { key: 'trf. mb way', operator: 'starts_with', value: 'TRF. MB WAY' }],
    ['a card purchase header and its card number are skipped', 'COMPRA 1192 CONTINENTE SANTA MARINH CONTACTLESS', { key: 'continente santa marinh', operator: 'contains', value: 'CONTINENTE SANTA MARINH' }],
    ['a store number after the name ends the prefix', 'LIDL 1234 LISBOA', { key: 'lidl', operator: 'starts_with', value: 'LIDL' }],
    ['a leading reference is skipped', '20261104 NETFLIX.COM', { key: 'netflix.com', operator: 'contains', value: 'NETFLIX.COM' }],
    ['a reference marker ends the prefix', 'DD EDP COMERCIAL REF 556677', { key: 'dd edp comercial', operator: 'starts_with', value: 'DD EDP COMERCIAL' }],
    ['a date and an amount end the prefix', 'Uber Trip 2026-11-01 12,40', { key: 'uber trip', operator: 'starts_with', value: 'Uber Trip' }],
    ['case, accents and repeated spaces are normalized in the key', '  Café   Central  Lda', { key: 'cafe central lda', operator: 'starts_with', value: 'Café Central Lda' }],
    ['an IBAN after a header is skipped like a card number', 'SEPA PT50000201231234567890154 RENDA', { key: 'renda', operator: 'contains', value: 'RENDA' }],
    ['a description of references only has no prefix', '1234 5678 / 99', null],
    ['a header with only references after it has no prefix', 'COMPRA 1192', null],
    ['generic words alone are not a prefix', 'TRF. MB 912345678', null],
    ['too few letters is not a prefix', 'XY 123', null],
    ['an empty description has no prefix', '', null],
    ['a missing description has no prefix', null, null],
  ])('%s', (_name, description, expected) => {
    expect(cleanDescriptionPrefix(description)).toEqual(expected);
  });
});

describe('descriptionPrefixCandidates', () => {
  it('offers every useful prefix, longest first, and leaves out the generic-only ones', () => {
    expect(descriptionPrefixCandidates('TRF MB WAY PARA JOANA').map((candidate) => candidate.key)).toEqual(['trf mb way']);
    expect(descriptionPrefixCandidates('Pingo Doce Porto').map((candidate) => candidate.key)).toEqual(['pingo doce porto', 'pingo doce', 'pingo']);
  });

  it('gives descriptions that start alike the same shorter prefix, whatever follows or precedes it', () => {
    const keys = (description: string) => descriptionPrefixCandidates(description).map((candidate) => candidate.key);
    expect(keys('Pingo Doce')).toContain('pingo doce');
    expect(keys('Pingo Doce Porto')).toContain('pingo doce');
    expect(descriptionPrefixCandidates('COMPRA 4589 Pingo Doce Gaia')).toContainEqual({ key: 'pingo doce', operator: 'contains', value: 'Pingo Doce' });
    expect(keys('TRF SEPA JOAO')).not.toContain('trf mb way');
  });
});
