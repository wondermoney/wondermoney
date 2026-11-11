import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isOfxFile, ofxImportAdapter } from '../lib/import/ofx';

/*
 * The OFX/QFX reader: OFX 1.x SGML (unclosed aggregates), OFX 2.x XML, the header's encoding
 * (Windows-1252 here), FITIDs that are empty or repeated, a file with two accounts, and the
 * statements it skips with a warning.
 */
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'ofx', name));

const parse = (name: string) => ofxImportAdapter.parse(new Uint8Array(fixture(name)), {});

const rowsOf = (result: Awaited<ReturnType<typeof parse>>) =>
  result.rows.map((row) => ({
    amount: row.normalized?.amount,
    date: row.normalized?.date.slice(0, 10),
    description: row.normalized?.description,
    externalId: row.normalized?.externalId,
    merchant: row.normalized?.merchant,
    sourceAccountLabel: row.normalized?.sourceAccountLabel,
    trusted: row.normalized?.externalIdTrusted,
  }));

describe('OFX 1.x (SGML)', () => {
  it('reads every STMTTRN with the sign and date the file states', async () => {
    const result = await parse('statement-sgml.ofx');

    expect(result.sourceAccounts).toEqual([]);
    expect(rowsOf(result)).toEqual([
      { amount: -42.5, date: '2026-09-02', description: 'Groceries', externalId: 'fitid:202609020001', merchant: 'CONTINENTE MATOSINHOS', sourceAccountLabel: undefined, trusted: true },
      { amount: 1500, date: '2026-09-05', description: 'September salary', externalId: 'fitid:202609050002', merchant: 'SALARIO ACME LDA', sourceAccountLabel: undefined, trusted: true },
      { amount: -12.3, date: '2026-09-07', description: 'Pharmacy', externalId: 'fitid:202609070003', merchant: 'FARMACIA CENTRAL', sourceAccountLabel: undefined, trusted: true },
    ]);
  });

  it('takes the merchant from PAYEE/NAME when NAME is nested', async () => {
    const result = await parse('statement-sgml.ofx');

    expect(result.rows[2]?.normalized?.merchant).toBe('FARMACIA CENTRAL');
  });
});

describe('OFX 2.x (XML)', () => {
  it('reads the same rows from a closed-tag document', async () => {
    const result = await parse('statement-xml.ofx');

    expect(rowsOf(result)).toEqual([
      { amount: -7.8, date: '2026-09-03', description: 'Morning coffee', externalId: 'fitid:XML-0001', merchant: 'CAFE BOAVISTA', sourceAccountLabel: undefined, trusted: true },
      { amount: 25, date: '2026-09-11', description: 'Book refund', externalId: 'fitid:XML-0002', merchant: 'LIVRARIA LELLO', sourceAccountLabel: undefined, trusted: true },
    ]);
  });
});

describe('encodings', () => {
  it('keeps accented payee names intact in a Windows-1252 file', async () => {
    const result = await parse('statement-cp1252.ofx');

    expect(result.rows.map((row) => row.normalized?.merchant)).toEqual(['PADARIA SÃO JOÃO', 'MERCEARIA AÇÚCAR']);
    expect(result.rows[0]?.normalized?.description).toBe('Café e pastelaria');
    expect(result.rows[1]?.normalized?.description).toBe('Compra de açúcar');
  });
});

describe('FITIDs', () => {
  it('trusts a unique FITID and falls back to a date+amount fingerprint for empty or repeated ones', async () => {
    const result = await parse('statement-empty-fitids.ofx');
    const rows = result.rows.map((row) => row.normalized!);

    expect(rows.map((row) => row.externalIdTrusted)).toEqual([false, false, false, true]);
    expect(rows[3]?.externalId).toBe('fitid:UNIQUE-1');
    expect(rows.slice(0, 3).every((row) => row.externalId.startsWith('ofx-fp:'))).toBe(true);
    expect(new Set(rows.slice(0, 3).map((row) => row.externalId)).size).toBe(3);
  });

  it('gives the same fingerprints when the same file is read again', async () => {
    const first = await parse('statement-empty-fitids.ofx');
    const second = await parse('statement-empty-fitids.ofx');

    expect(second.rows.map((row) => row.normalized?.externalId)).toEqual(first.rows.map((row) => row.normalized?.externalId));
  });
});

describe('a file with several accounts', () => {
  it('names each STMTRS/CCSTMTRS block by its ACCTID and labels its rows', async () => {
    const result = await parse('statement-two-accounts.ofx');

    expect(result.sourceAccounts).toEqual([
      { currency: 'EUR', label: '111111111', rowCount: 2 },
      { currency: 'EUR', label: '222222222', rowCount: 1 },
    ]);
    expect(result.rows.map((row) => row.normalized?.sourceAccountLabel)).toEqual(['111111111', '111111111', '222222222']);
  });
});

describe('statements it does not import', () => {
  it('skips a balance-only statement with a warning', async () => {
    const result = await parse('statement-balance-only.ofx');

    expect(result.rows).toEqual([]);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'balance_only' }));
  });

  it('skips an investment statement with a warning', async () => {
    const result = await parse('statement-investment.ofx');

    expect(result.rows).toEqual([]);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'investment_statement_skipped' }));
  });
});

describe('isOfxFile', () => {
  it('recognises both header styles and refuses anything else', () => {
    expect(isOfxFile(new Uint8Array(fixture('statement-sgml.ofx')))).toBe(true);
    expect(isOfxFile(new Uint8Array(fixture('statement-xml.ofx')))).toBe(true);
    expect(isOfxFile(new Uint8Array(Buffer.from('date,amount\n2026-09-01,-1\n')))).toBe(false);
  });
});
