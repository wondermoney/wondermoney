import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Camt053UnreadableError, camt053ImportAdapter, isCamt053File } from '../lib/import/camt053';

/*
 * The CAMT.053 reader: a Portuguese bank's camt.053.001.02 export, a German bank's
 * camt.053.001.08 export with the party choice and batch bookings, a file with two statements,
 * a file whose entries are still pending, a file whose account has no IBAN, and a file with a
 * document type declaration.
 */
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'camt053', name));

const parse = (name: string) => camt053ImportAdapter.parse(new Uint8Array(fixture(name)), {});

const rowsOf = (result: Awaited<ReturnType<typeof parse>>) =>
  result.rows.map((row) => ({
    amount: row.normalized?.amount,
    currency: row.normalized?.currency,
    date: row.normalized?.date.slice(0, 10),
    description: row.normalized?.description,
    externalId: row.normalized?.externalId,
    merchant: row.normalized?.merchant,
    sourceAccountLabel: row.normalized?.sourceAccountLabel,
    trusted: row.normalized?.externalIdTrusted,
  }));

describe('a Portuguese bank statement', () => {
  it('reads every entry with the sign CdtDbtInd states', async () => {
    const result = await parse('bank-pt.camt053.xml');

    expect(rowsOf(result)).toEqual([
      { amount: -42.5, currency: 'EUR', date: '2026-01-15', description: 'COMPRA 4321 CONTINENTE', externalId: 'camt:BCP-0001', merchant: 'CONTINENTE MATOSINHOS', sourceAccountLabel: undefined, trusted: true },
      { amount: 1500, currency: 'EUR', date: '2026-01-31', description: 'SALARIO JANEIRO', externalId: 'camt:BCP-0002', merchant: 'ACME LDA', sourceAccountLabel: undefined, trusted: true },
      { amount: -12.3, currency: 'EUR', date: '2026-02-03', description: 'FARMACIA CENTRAL LISBOA', externalId: 'camt:2026020300003', merchant: 'FARMACIA CENTRAL', sourceAccountLabel: undefined, trusted: true },
      { amount: -3.1, currency: 'EUR', date: '2026-02-05', description: 'PADARIA', externalId: 'camt053-fp:2026-02-05|-3.10|0', merchant: 'PADARIA DO BAIRRO', sourceAccountLabel: undefined, trusted: false },
    ]);
  });

  it('takes the date from BookgDt, falling back to ValDt', async () => {
    const result = await parse('bank-pt.camt053.xml');

    // The third entry has no BookgDt: its ValDt is the date.
    expect(result.rows[2]?.normalized?.date.slice(0, 10)).toBe('2026-02-03');
    expect(result.rows[2]?.raw).toMatchObject({ date: '2026-02-03' });
  });

  it('reads a single-statement file as one account, with no mapping to ask for', async () => {
    const result = await parse('bank-pt.camt053.xml');

    expect(result.sourceAccounts).toEqual([]);
    expect(result.rows.every((row) => row.normalized?.sourceAccountLabel === undefined)).toBe(true);
  });

  it('keeps the entry fields for the review', async () => {
    const result = await parse('bank-pt.camt053.xml');

    expect(result.rows[0]?.raw).toMatchObject({ acctSvcrRef: 'BCP-0001', amount: '42.50', creditDebit: 'DBIT', currency: 'EUR', date: '2026-01-15', ntryRef: '2026011500001' });
  });
});

describe('a German bank statement', () => {
  it('reads the party choice and a booked status written as a code', async () => {
    const result = await parse('bank-de.camt053.xml');

    expect(rowsOf(result).map((row) => ({ amount: row.amount, date: row.date, merchant: row.merchant }))).toEqual([
      { amount: -60, date: '2026-03-02', merchant: 'STADTWERKE MUENCHEN' },
      { amount: -40, date: '2026-03-02', merchant: 'STADTWERKE MUENCHEN' },
      { amount: -50, date: '2026-03-04', merchant: 'KIOSK AM MARKT' },
      { amount: 2500, date: '2026-03-31', merchant: 'MUSTER GMBH' },
    ]);
  });

  it('splits a batch booking into its details when the amounts add up', async () => {
    const result = await parse('bank-de.camt053.xml');
    const batch = result.rows.slice(0, 2);

    expect(batch.map((row) => ({ amount: row.normalized?.amount, description: row.normalized?.description, externalId: row.normalized?.externalId }))).toEqual([
      { amount: -60, description: 'ABSCHLAG STROM', externalId: 'camt:DE-BATCH-1-1' },
      { amount: -40, description: 'ABSCHLAG WASSER', externalId: 'camt:DE-BATCH-1-2' },
    ]);
    // Each detail is its own line in the file, so the review can point at it.
    expect(batch[0]?.sourceRow).not.toBe(batch[1]?.sourceRow);
    expect(batch.every((row) => row.sourceRow > 0)).toBe(true);
  });

  it('keeps a batch entry as one row when its details do not add up to it', async () => {
    const result = await parse('bank-de.camt053.xml');
    const entry = result.rows[2];

    expect(entry?.normalized).toMatchObject({ amount: -50, description: 'ZEITSCHRIFT', externalId: 'camt:DE-BATCH-2' });
    expect(result.rows).toHaveLength(4);
  });
});

describe('a file with several statements', () => {
  it('labels each statement by its IBAN and lists it as a source account', async () => {
    const result = await parse('two-statements.camt053.xml');

    expect(result.sourceAccounts).toEqual([
      { currency: 'EUR', label: 'PT50000201231234567890154', rowCount: 2 },
      { currency: 'EUR', label: 'PT50003300009998887776655', rowCount: 1 },
    ]);
    expect(result.rows.map((row) => row.normalized?.sourceAccountLabel)).toEqual(['PT50000201231234567890154', 'PT50000201231234567890154', 'PT50003300009998887776655']);
  });

  it('labels a statement with no IBAN by the account id the bank writes instead', async () => {
    const result = await parse('other-id.camt053.xml');

    expect(result.rows[0]?.normalized?.sourceAccountLabel).toBeUndefined();
    expect(result.rows[0]?.normalized?.merchant).toBe('LIVRARIA');
  });
});

describe('entries the file has not booked', () => {
  it('skips an entry whose status is not BOOK, with a warning', async () => {
    const result = await parse('pending.camt053.xml');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.normalized?.merchant).toBe('CAFE');
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'entry_not_booked', detail: 'PDNG' }));
  });
});

describe('the external id', () => {
  it('falls back from AcctSvcrRef to NtryRef to a date+amount fingerprint', async () => {
    const result = await parse('bank-pt.camt053.xml');

    expect(result.rows.map((row) => row.normalized?.externalId)).toEqual(['camt:BCP-0001', 'camt:BCP-0002', 'camt:2026020300003', 'camt053-fp:2026-02-05|-3.10|0']);
    expect(result.rows.map((row) => row.normalized?.externalIdTrusted)).toEqual([true, true, true, false]);
  });

  it('does not trust a reference the file repeats', async () => {
    const file = readFileSync(join(__dirname, 'fixtures', 'camt053', 'bank-pt.camt053.xml'), 'utf8')
      .replace('<AcctSvcrRef>BCP-0002</AcctSvcrRef>', '<AcctSvcrRef>BCP-0001</AcctSvcrRef>')
      .replace('<AcctSvcrRef>BCP-0002</AcctSvcrRef>', '<AcctSvcrRef>BCP-0001</AcctSvcrRef>');

    const result = await camt053ImportAdapter.parse(new Uint8Array(Buffer.from(file)), {});

    expect(result.rows[0]?.normalized).toMatchObject({ externalId: 'camt053-fp:2026-01-15|-42.50|0', externalIdTrusted: false });
    expect(result.rows[1]?.normalized).toMatchObject({ externalId: 'camt053-fp:2026-01-31|1500.00|0', externalIdTrusted: false });
  });
});

describe('a file with a document type declaration', () => {
  it('refuses it before parsing, so no entity is resolved', async () => {
    await expect(parse('doctype.camt053.xml')).rejects.toBeInstanceOf(Camt053UnreadableError);
    await expect(parse('doctype.camt053.xml')).rejects.toMatchObject({ code: 'doctype' });
  });
});

describe('isCamt053File', () => {
  it('recognises a CAMT.053 document and refuses anything else', () => {
    expect(isCamt053File(new Uint8Array(fixture('bank-pt.camt053.xml')))).toBe(true);
    expect(isCamt053File(new Uint8Array(fixture('bank-de.camt053.xml')))).toBe(true);
    expect(isCamt053File(new Uint8Array(Buffer.from('date,amount\n2026-09-01,-1\n')))).toBe(false);
    expect(isCamt053File(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'ofx', 'statement-xml.ofx'))))).toBe(false);
  });

  it('refuses a CAMT.052 intraday report and a CAMT.054 notification', () => {
    const intraday = '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08"><BkToCstmrAcctRpt><Rpt><Id>1</Id></Rpt></BkToCstmrAcctRpt></Document>';
    const notification = '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfctn><Ntfctn><Id>1</Id></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>';

    expect(isCamt053File(new Uint8Array(Buffer.from(intraday)))).toBe(false);
    expect(isCamt053File(new Uint8Array(Buffer.from(notification)))).toBe(false);
  });

  it('reads a file that starts with a UTF-8 byte-order mark', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fixture('bank-pt.camt053.xml')]);

    expect(isCamt053File(new Uint8Array(bytes))).toBe(true);
  });
});

describe('a file that is not a CAMT.053 document', () => {
  it('is refused as unreadable', async () => {
    const result = camt053ImportAdapter.parse(new Uint8Array(Buffer.from('<Document><Something /></Document>')), {});

    await expect(result).rejects.toMatchObject({ code: 'not_camt053' });
  });

  it('is refused when it is not XML at all', async () => {
    const result = camt053ImportAdapter.parse(new Uint8Array(Buffer.from('not xml')), {});

    await expect(result).rejects.toBeInstanceOf(Camt053UnreadableError);
  });
});
