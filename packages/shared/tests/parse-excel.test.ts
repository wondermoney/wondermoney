import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseExcel } from '../lib/csv';

/*
 * The fixtures were written with SheetJS 0.18.5, which read statements before
 * 0.20, and the expected rows are what 0.18.5 returned for them (in UTC, as the
 * API runs). They pin what the bank and broker importers receive, so a SheetJS
 * upgrade can't quietly change it.
 */
const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', 'spreadsheets', name));
const parse = (name: string) =>
  parseExcel(fixture(name)) as Promise<unknown[][]>;

// Binary spreadsheets: date serials come back as local dates, and only the
// first sheet is read.
const binaryStatement = () => [
  ['Extrato de conta', null, null, null, null, null],
  [null, null, null, null, null, null],
  ['Conta', '0000000000', null, null, null, null],
  [null, null, null, null, null, null],
  ['Data mov.', 'Data valor', 'Descrição', 'Montante', 'Saldo', 'Nota'],
  [
    new Date(2026, 8, 1),
    new Date(2026, 8, 1),
    'COMPRA CAFE & CIA',
    -2.4,
    1997.6,
    null,
  ],
  [
    new Date(2026, 8, 2),
    new Date(2026, 8, 3),
    'TRF SALARIO',
    1234.5,
    3232.1,
    '1.234,50',
  ],
  [
    new Date(2026, 8, 30, 18),
    new Date(2026, 8, 30),
    'ANUIDADE CARTAO',
    -0.01,
    3232.09,
    '',
  ],
  [null, null, 'Saldo final', null, 3232.09, null],
];

describe('parseExcel', () => {
  it.each(['statement.xlsx', 'statement.xls'])(
    'reads %s: dates, formatted numbers, empty cells, first sheet only',
    async (name) => {
      await expect(parse(name)).resolves.toEqual(binaryStatement());
    },
  );

  // Text cells are typed by SheetJS's guesses, quirks included: ambiguous dates
  // are month first, and "-2,40" is read as -240.
  it('reads an HTML-table "xls" the way 0.18 did', async () => {
    await expect(parse('statement-html.xls')).resolves.toEqual([
      ['Extrato de conta', null, null, null, null],
      ['Data mov.', 'Data valor', 'Descrição', 'Montante', 'Saldo'],
      [
        new Date(2026, 0, 9),
        new Date(2026, 0, 9),
        'COMPRA CAFE & CIA',
        -240,
        1.9976,
      ],
      ['13-09-2026', '13/09/2026', 'TRF SALARIO', 1.2345, 3.2321],
      [new Date('2026-09-30'), '30.09.2026', 'ANUIDADE CARTAO', -0.01, '#N/A'],
      [null, '12:30', 'TOTAL', null, 3.23209],
    ]);
  });

  it('reads delimited text the way 0.18 did', async () => {
    await expect(parse('statement.csv')).resolves.toEqual([
      // The bytes are read as Latin-1, as before.
      ['Data mov.', 'Data valor', 'DescriÃ§Ã£o', 'Montante', 'Saldo'],
      [
        new Date(2026, 0, 9),
        new Date(2026, 0, 9),
        'COMPRA CAFE; CIA',
        -240,
        1.9976,
      ],
      ['13-09-2026', new Date('2026-09-13'), 'TRF SALARIO', 1234.5, 3232.1],
      [null, null, null, null, null],
      ['30.09.2026', '2026-09-30T10:00:00Z', 'ANUIDADE CARTAO', -1, '#N/A'],
    ]);
  });

  describe('crafted workbooks', () => {
    afterEach(() => {
      delete (Object.prototype as Record<string, unknown>)['c'];
    });

    // CVE-2023-30533: SheetJS before 0.19.3 attached a comment anchored at
    // "__proto__" to Object.prototype, giving every object a `c` property.
    it('keeps a comment anchored at __proto__ off Object.prototype', async () => {
      await expect(parse('proto-comment.xlsx')).resolves.toEqual([
        ['Data', 'Montante'],
        [new Date(2026, 8, 1), 1],
      ]);

      expect(Object.prototype).not.toHaveProperty('c');
      expect(({} as Record<string, unknown>)['c']).toBeUndefined();
    });
  });
});
