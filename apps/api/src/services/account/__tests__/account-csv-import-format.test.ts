import { csv } from '@wondermoney/shared';
import { describe, expect, it } from 'vitest';

import { resolveAccountCsvImportFormat } from '@service/account/account-csv-import-format';

function parserFor(name: string) {
  const resolved = resolveAccountCsvImportFormat(name);
  if (resolved.format !== 'bank') throw new Error(`${name} resolved to the generic format`);
  return csv.getBankParser(resolved.bankName);
}

describe('resolveAccountCsvImportFormat', () => {
  it.each(['Millennium BCP', 'bcp', 'BANCO BPI', 'ActivoBank', 'Banco ActivoBank', 'Bankinter', 'Caixa Economica Montepio Geral'])('reads a statement export for the supported bank %s', (name) => {
    expect(resolveAccountCsvImportFormat(name)).toMatchObject({ format: 'bank' });
    expect(() => parserFor(name)).not.toThrow();
  });

  // The institution list has both "Activo Bank" and "Banco ActivoBank", and a manual account
  // can be created on either; both are the ActivoBank statement export.
  it.each(['Activo Bank', 'Banco Activo Bank', 'ACTIVO BANK'])('reads the ActivoBank statement export for an account on "%s"', (name) => {
    expect(parserFor(name)).toBe(parserFor('Banco ActivoBank'));
  });

  it.each([
    ['an unsupported institution', '1822direkt'],
    ['no institution', undefined],
    ['a null institution name', null],
    ['an empty institution name', ''],
    ['a whitespace-only institution name', '   '],
  ])('falls back to the generic CSV format for %s', (_kind, name) => {
    expect(resolveAccountCsvImportFormat(name)).toEqual({ format: 'generic' });
  });
});
