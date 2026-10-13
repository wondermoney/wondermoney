import { describe, expect, it } from 'vitest';

import { decodeEnableBankingInstitutionId, encodeEnableBankingInstitutionId } from '../enable-banking-institution-id';

describe('enable-banking-institution-id', () => {
  it('round-trips a simple {country, name} pair', () => {
    const id = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Revolut' });

    expect(decodeEnableBankingInstitutionId(id)).toEqual({ country: 'PT', name: 'Revolut' });
  });

  it('is URL-safe (no +, /, or = characters)', () => {
    const id = encodeEnableBankingInstitutionId({ country: 'DE', name: 'Sparkasse Köln/Bonn + Co' });

    expect(id).not.toMatch(/[+/=]/);
  });

  it('round-trips a name that itself contains the "::" delimiter', () => {
    const id = encodeEnableBankingInstitutionId({ country: 'FR', name: 'Crédit::Mutuel' });

    expect(decodeEnableBankingInstitutionId(id)).toEqual({ country: 'FR', name: 'Crédit::Mutuel' });
  });

  it('produces distinct ids for the same name in different countries', () => {
    const pt = encodeEnableBankingInstitutionId({ country: 'PT', name: 'Revolut' });
    const es = encodeEnableBankingInstitutionId({ country: 'ES', name: 'Revolut' });

    expect(pt).not.toBe(es);
  });

  it('returns null for garbage input rather than throwing', () => {
    expect(decodeEnableBankingInstitutionId('not-a-real-id')).toBeNull();
    expect(decodeEnableBankingInstitutionId('')).toBeNull();
  });

  it('returns null for a well-formed base64url string missing the "::" separator', () => {
    const id = Buffer.from('PTRevolut', 'utf8').toString('base64url');

    expect(decodeEnableBankingInstitutionId(id)).toBeNull();
  });
});
