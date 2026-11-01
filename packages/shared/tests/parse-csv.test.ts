import type { Options } from 'csv-parse';
import { describe, expect, it } from 'vitest';

import { parseCsv } from '../lib/csv';

function parseWith(csv: string, options: Options): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    parseCsv(csv, options, (error, records) => (error ? reject(error) : resolve(records as unknown[])));
  });
}

describe('parseCsv', () => {
  it('parses a semicolon bank export with a BOM into records keyed by header', async () => {
    const csv = '﻿Data;Descrição;Montante\n02-01-2026;"Café; pastelaria";-3,20\n';

    await expect(parseWith(csv, { bom: true, columns: true, delimiter: ';' })).resolves.toEqual([
      { Data: '02-01-2026', Descrição: 'Café; pastelaria', Montante: '-3,20' },
    ]);
  });

  it('tolerates ragged rows only when relax_column_count is set', async () => {
    const csv = 'a,b\n1\n';

    await expect(parseWith(csv, { columns: true })).rejects.toThrow();
    await expect(parseWith(csv, { columns: true, relax_column_count: true })).resolves.toEqual([{ a: '1' }]);
  });
});
