import { describe, expect, it } from 'vitest';

import type { StatementMapping } from '@service/account/account-statement-mapping.schema';
import { applyStatementMapping, findHeaderRow, inferFormats, isMappingComplete, parseStatementAmount, parseStatementDate, readStatementGrid, suggestColumnsByName } from '@service/account/account-statement-reader';

async function readAndSuggest(text: string, encoding: BufferEncoding = 'utf8') {
  const grid = await readStatementGrid(Buffer.from(text, encoding));
  const headerRowIndex = findHeaderRow(grid);
  const columns = suggestColumnsByName(grid, headerRowIndex);
  if (!isMappingComplete(columns)) throw new Error(`incomplete mapping: ${JSON.stringify(columns)}`);
  const mapping: StatementMapping = { columns, headerRowIndex, invertAmounts: false, ...inferFormats(grid, headerRowIndex, columns) };
  return { grid, mapping, result: applyStatementMapping(grid, mapping) };
}

const summarize = (rows: { amount: number; date: Date; description: string }[]) => rows.map((row) => [row.date.toISOString().slice(0, 10), row.description, row.amount]);

describe('reading a bank statement export', () => {
  it('reads a semicolon export in Windows-1252 with a preamble and a footer', async () => {
    const text = [
      'Consultar saldos e movimentos à ordem',
      'Conta;PT50 0000 0000 0000',
      '',
      'Data mov.;Data valor;Descrição;Débito;Crédito;Saldo contabilístico',
      '02-01-2026;02-01-2026;COMPRA 1234 PINGO DOCE LISBOA;12,40;;1.987,60',
      '03-01-2026;03-01-2026;TRF DE ACME LDA;;2.150,00;4.137,60',
      '15-01-2026;15-01-2026;COMPRA 1234 PINGO DOCE LISBOA;12,40;;4.125,20',
      '',
      'Saldo final;;;;;4.125,20',
    ].join('\r\n');

    const { mapping, result } = await readAndSuggest(text, 'latin1');

    expect(mapping).toMatchObject({ dateFormat: 'DMY', decimalSeparator: ',', headerRowIndex: 3 });
    expect(summarize(result.rows)).toEqual([
      ['2026-01-02', 'COMPRA 1234 PINGO DOCE LISBOA', -12.4],
      ['2026-01-03', 'TRF DE ACME LDA', 2150],
      ['2026-01-15', 'COMPRA 1234 PINGO DOCE LISBOA', -12.4],
    ]);
    expect(result.invalid).toEqual([]);
  });

  it('reads a comma export with a signed amount, month-first dates and a currency column', async () => {
    const text = 'Date,Description,Amount,Currency,Balance\n01/31/2026,"Coffee, Inc.",-4.50,USD,"1,095.50"\n02/01/2026,Payroll,"2,000.00",USD,"3,095.50"\n';

    const { mapping, result } = await readAndSuggest(text);

    expect(mapping).toMatchObject({ dateFormat: 'MDY', decimalSeparator: '.' });
    expect(result.rows.map((row) => [row.date.toISOString().slice(0, 10), row.amount, row.currency])).toEqual([['2026-01-31', -4.5, 'USD'], ['2026-02-01', 2000, 'USD']]);
  });

  it('signs an unsigned amount from a debit/credit marker column', async () => {
    const text = 'Fecha;Concepto;Importe;D/H\n05/01/2026;Mercadona;23,10;D\n06/01/2026;Nomina;1500,00;C\n07/01/2026;Bizum;10,00;D\n08/01/2026;Recibo luz;40,00;D\n';

    const { result } = await readAndSuggest(text);

    expect(result.rows.map((row) => row.amount)).toEqual([-23.1, 1500, -10, -40]);
  });

  it('reports a row with a date but no readable amount, between transactions', async () => {
    const text = 'Date;Description;Amount\n2026-01-01;A;-1,00\n2026-01-02;B;n/a\n2026-01-03;C;-3,00\n';

    const { result } = await readAndSuggest(text);

    expect(result.rows).toHaveLength(2);
    expect(result.invalid).toEqual([{ reason: 'Unreadable amount', row: 3 }]);
  });

  it('gives the same line the same id on every import, and repeated lines different ones', async () => {
    const text = 'Data;Descrição;Montante\n01-02-2026;CAFE;-1,20\n01-02-2026;CAFE;-1,20\n';

    const first = await readAndSuggest(text);
    const second = await readAndSuggest(text);

    const ids = first.result.rows.map((row) => row.internalTransactionId);
    expect(new Set(ids).size).toBe(2);
    expect(second.result.rows.map((row) => row.internalTransactionId)).toEqual(ids);
  });

  it('reads amounts with the currency code written against the number', async () => {
    const { result } = await readAndSuggest('Concepto\tFecha\tImporte\tSaldo\nBIZUM ENVIADO\t03/09/2026\t-15,00EUR\t2.000,00EUR\nTRANSF RECIBIDA\t04/09/2026\t100,00EUR\t2.100,00EUR\n');

    expect(result.rows.map((row) => row.amount)).toEqual([-15, 100]);
  });

  it('does not take a payment reference that repeats month to month as the line id', async () => {
    const text = 'Booking Date,Partner Name,Payment Reference,Amount (EUR)\n2026-09-02,ACME GmbH,Salary,3200.00\n2026-10-02,ACME GmbH,Salary,3200.00\n';

    const { result } = await readAndSuggest(text);

    expect(result.rows.every((row) => row.internalTransactionId.startsWith('stmt:'))).toBe(true);
    expect(new Set(result.rows.map((row) => row.internalTransactionId)).size).toBe(2);
  });

  it('finds unnamed columns by their values when there is one column of numbers', async () => {
    const { result } = await readAndSuggest('x;y;z\n2026-09-01;Café;-1,20\n2026-09-02;Renda;-700,00\n');

    expect(summarize(result.rows)).toEqual([['2026-09-01', 'Café', -1.2], ['2026-09-02', 'Renda', -700]]);
  });

  it.each([
    ['in date order', 'x;y;z;w\n2026-09-01;Padaria;996,80;-3,20\n2026-09-02;Ginásio;961,80;-35,00\n2026-09-03;Reembolso;981,80;20,00\n'],
    ['newest first', 'x;y;z;w\n2026-09-03;Reembolso;981,80;20,00\n2026-09-02;Ginásio;961,80;-35,00\n2026-09-01;Padaria;996,80;-3,20\n'],
  ])('tells the amount from the running balance by how the balance moves, %s', async (_order, text) => {
    const { mapping, result } = await readAndSuggest(text);

    expect(mapping.columns).toMatchObject({ amount: 3, balance: 2 });
    expect(result.rows.map((row) => row.amount).sort()).toEqual([-3.2, -35, 20].sort());
  });

  it('flips the sign when the statement writes spending as positive', async () => {
    const grid = await readStatementGrid(Buffer.from('Date,Description,Amount\n2026-03-01,Card purchase,25.00\n2026-03-02,Payment received,-100.00\n'));
    const mapping: StatementMapping = { columns: { amount: 2, date: 0, description: 1 }, dateFormat: 'YMD', decimalSeparator: '.', headerRowIndex: 0, invertAmounts: true };

    expect(applyStatementMapping(grid, mapping).rows.map((row) => row.amount)).toEqual([-25, 100]);
  });
});

describe('statement values', () => {
  it.each([
    ['1.234,56', ',', 1234.56],
    ['-1.234,56', ',', -1234.56],
    ['1 234,56 €', ',', 1234.56],
    ['12,50-', ',', -12.5],
    ['(12.50)', '.', -12.5],
    ['$1,234.56', '.', 1234.56],
    ['+3.00', '.', 3],
    ['EUR -7,99', ',', -7.99],
  ] as const)('reads %s with %s as the decimal separator', (value, separator, expected) => {
    expect(parseStatementAmount(value, separator)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3,4x', '--'])('rejects %j as an amount', (value) => {
    expect(parseStatementAmount(value, ',')).toBeUndefined();
  });

  it.each([
    ['31/01/2026', 'DMY', '2026-01-31'],
    ['01/31/2026', 'MDY', '2026-01-31'],
    ['2026-01-31', 'DMY', '2026-01-31'],
    ['2026-01-31 14:02:11', 'DMY', '2026-01-31'],
    ['31.01.26', 'DMY', '2026-01-31'],
    ['20260131', 'DMY', '2026-01-31'],
  ] as const)('reads %s as %s', (value, format, expected) => {
    expect(parseStatementDate(value, format)?.toISOString().slice(0, 10)).toBe(expected);
  });

  it('rejects a day that does not exist', () => {
    expect(parseStatementDate('31/02/2026', 'DMY')).toBeUndefined();
  });
});
