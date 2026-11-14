import { describe, expect, it, vi } from 'vitest';

import { type PdfPageSource, PdfStatementError, readPdfStatement, type ReadStatementPage } from '../pdf-statement-reader';

import { syntheticPdf } from './synthetic-pdf';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** The model's answer for each page, by page number. */
function modelAnswering(answers: Record<number, unknown>) {
  return vi.fn<ReadStatementPage>(({ pageNumber }) => Promise.resolve(answers[pageNumber]));
}

const page = (rows: unknown[], balances: { closingBalance?: number; openingBalance?: number } = {}) => ({ closingBalance: balances.closingBalance ?? null, currency: 'EUR', openingBalance: balances.openingBalance ?? null, rows });
const row = (date: string, description: string, amount: number, balance: null | number = null) => ({ amount, balance, currency: null, date, description });

const noWait = () => Promise.resolve();

describe('readPdfStatement', () => {
  it('renders each page of a real PDF to a PNG, asks the model page by page and stages the rows in order', async () => {
    const pdf = syntheticPdf([
      ['Statement 1 Sep 2026 - 30 Sep 2026', 'Opening balance 1,000.00', '02 Sep GROCERY STORE -42.50'],
      ['05 Sep SALARY 1,500.00', '07 Sep BAKERY -3.20', 'Closing balance 2,454.30'],
    ]);
    const readPage = modelAnswering({
      1: page([row('2026-09-02', 'GROCERY STORE', -42.5, 957.5)], { openingBalance: 1000 }),
      2: page([row('2026-09-05', 'SALARY', 1500), row('2026-09-07', 'BAKERY', -3.2)], { closingBalance: 2454.3 }),
    });

    const reading = await readPdfStatement(pdf, { accountCurrency: 'EUR', maxPages: 20, readPage, sleep: noWait });

    expect(readPage).toHaveBeenCalledTimes(2);
    for (const [call] of readPage.mock.calls) {
      expect(call.image.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
      expect(call.pageCount).toBe(2);
    }
    if (reading === 'cancelled') throw new Error('not cancelled');
    expect(reading.pageCount).toBe(2);
    expect(reading.result.rows.map((staged) => ({ sourceRow: staged.sourceRow, ...staged.normalized }))).toEqual([
      { amount: -42.5, currency: 'EUR', date: '2026-09-02T00:00:00.000Z', description: 'GROCERY STORE', externalId: 'pdf-fp:2026-09-02|-42.50|0', externalIdTrusted: false, sourceRow: 1 },
      { amount: 1500, currency: 'EUR', date: '2026-09-05T00:00:00.000Z', description: 'SALARY', externalId: 'pdf-fp:2026-09-05|1500.00|0', externalIdTrusted: false, sourceRow: 2 },
      { amount: -3.2, currency: 'EUR', date: '2026-09-07T00:00:00.000Z', description: 'BAKERY', externalId: 'pdf-fp:2026-09-07|-3.20|0', externalIdTrusted: false, sourceRow: 3 },
    ]);
    expect(reading.result.rows[0]?.raw).toEqual({ amount: -42.5, balance: 957.5, date: '2026-09-02', description: 'GROCERY STORE', page: 1 });
    expect(reading.reconciliation).toMatchObject({ closingBalance: 2454.3, difference: 0, openingBalance: 1000, status: 'matched' });
  });

  it('reports progress after each page, and stops when the import is cancelled', async () => {
    const pdf = syntheticPdf([['one'], ['two'], ['three']]);
    const readPage = modelAnswering({ 1: page([row('2026-09-01', 'A', -1)]), 2: page([row('2026-09-02', 'B', -2)]), 3: page([]) });
    const seen: number[] = [];
    const reading = await readPdfStatement(pdf, { accountCurrency: 'EUR', maxPages: 20, onProgress: ({ pagesRead }) => { seen.push(pagesRead); return pagesRead < 2; }, readPage, sleep: noWait });
    expect(reading).toBe('cancelled');
    expect(seen).toEqual([0, 1, 2]);
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it('refuses a statement over the page limit before asking the model anything', async () => {
    const readPage = modelAnswering({});
    await expect(readPdfStatement(syntheticPdf([['one'], ['two'], ['three']]), { accountCurrency: 'EUR', maxPages: 2, readPage })).rejects.toMatchObject({ code: 'too_many_pages' });
    expect(readPage).not.toHaveBeenCalled();
  });

  it('refuses a file that is not a PDF', async () => {
    await expect(readPdfStatement(Buffer.from('date,amount\n2026-09-01,-1\n'), { accountCurrency: 'EUR', maxPages: 20 })).rejects.toMatchObject({ code: 'unreadable' });
    // A file that claims to be a PDF and is not.
    await expect(readPdfStatement(Buffer.from('%PDF-1.4\nnot really'), { accountCurrency: 'EUR', maxPages: 20, readPage: modelAnswering({}) })).rejects.toBeInstanceOf(PdfStatementError);
  });

  it('asks a page again after a failed request or a malformed answer, up to the cap', async () => {
    const pdf = syntheticPdf([['one']]);
    const flaky = vi.fn()
      .mockRejectedValueOnce(new Error('Model request failed with status 503'))
      .mockResolvedValueOnce({ rows: 'not a list' })
      .mockResolvedValueOnce(page([row('2026-09-01', 'A', -1)]));
    const sleep = vi.fn(noWait);
    const reading = await readPdfStatement(pdf, { accountCurrency: 'EUR', maxPages: 20, readPage: flaky, sleep });
    expect(reading).not.toBe('cancelled');
    expect(flaky).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const broken = vi.fn().mockRejectedValue(new Error('Model request failed with status 500'));
    await expect(readPdfStatement(pdf, { accountCurrency: 'EUR', maxAttempts: 3, maxPages: 20, readPage: broken, sleep: noWait })).rejects.toMatchObject({ code: 'extraction_failed' });
    expect(broken).toHaveBeenCalledTimes(3);
  });

  it('stages a row the model got wrong as unreadable instead of losing the page', async () => {
    const reading = await readPdfStatement(syntheticPdf([['one']]), {
      accountCurrency: 'EUR',
      maxPages: 20,
      readPage: modelAnswering({ 1: page([row('2026-09-01', 'GOOD', -1), row('01/09/2026', 'BAD DATE', -2), { amount: 'lots', date: '2026-09-03', description: 'BAD AMOUNT' }]) }),
      sleep: noWait,
    });
    if (reading === 'cancelled') throw new Error('not cancelled');
    expect(reading.result.rows.map((staged) => (staged.error === undefined ? 'ok' : 'invalid'))).toEqual(['ok', 'invalid', 'invalid']);
    // The reconciliation sums what reads; the unreadable rows show up as a difference.
    expect(reading.reconciliation.rowsTotal).toBe(-1);
  });

  it('numbers repeated date-and-amount rows apart, so both import and a re-read finds each', async () => {
    const reading = await readPdfStatement(syntheticPdf([['one']]), {
      accountCurrency: 'EUR',
      maxPages: 20,
      readPage: modelAnswering({ 1: page([row('2026-09-01', 'COFFEE', -2.5), row('2026-09-01', 'COFFEE', -2.5)]) }),
      sleep: noWait,
    });
    if (reading === 'cancelled') throw new Error('not cancelled');
    expect(reading.result.rows.map((staged) => staged.normalized?.externalId)).toEqual(['pdf-fp:2026-09-01|-2.50|0', 'pdf-fp:2026-09-01|-2.50|1']);
  });

  it('fails a statement the model found no transactions on', async () => {
    await expect(readPdfStatement(syntheticPdf([['one']]), { accountCurrency: 'EUR', maxPages: 20, readPage: modelAnswering({ 1: page([]) }), sleep: noWait })).rejects.toMatchObject({ code: 'no_rows' });
  });

  it('warns when rows are in another currency than the account', async () => {
    const reading = await readPdfStatement(syntheticPdf([['one']]), {
      accountCurrency: 'EUR',
      maxPages: 20,
      readPage: modelAnswering({ 1: { ...page([row('2026-09-01', 'A', -1), { ...row('2026-09-02', 'B', -2), currency: 'usd' }]), currency: 'EUR' } }),
      sleep: noWait,
    });
    if (reading === 'cancelled') throw new Error('not cancelled');
    expect(reading.result.rows.map((staged) => staged.normalized?.currency)).toEqual(['EUR', 'USD']);
    expect(reading.result.warnings).toEqual([{ code: 'pdf_currency_differs', detail: 'USD' }]);
  });

  it('closes the document however the read ends', async () => {
    const close = vi.fn(() => Promise.resolve());
    const source: PdfPageSource = { close, page: () => Promise.resolve(Buffer.from('png')), pageCount: 1 };
    await expect(readPdfStatement(syntheticPdf([['one']]), { accountCurrency: 'EUR', maxPages: 20, open: () => Promise.resolve(source), readPage: () => Promise.reject(new Error('down')), sleep: noWait })).rejects.toMatchObject({ code: 'extraction_failed' });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
