import type { transactionImport } from '@wondermoney/shared';

import { completeJson } from '@service/ai/complete-json';

import { reconcileStatement, type StatementReconciliation } from './reconcile';
import { STATEMENT_PAGE_INSTRUCTIONS, STATEMENT_PAGE_RESPONSE_SCHEMA, type StatementPage, statementPagePrompt, statementPageSchema, type StatementRow, statementRowSchema } from './statement-page';

/**
 * A PDF bank statement read into staged rows by a vision model, one page at a time
 * (wondermoney/wondermoney#113).
 *
 * Each page is rendered to a PNG in memory and sent to the `statementImport` model on its own, so
 * one request never holds the whole statement and progress moves page by page. A page whose answer
 * does not have the page's shape, or whose request fails, is asked again, at most
 * {@link DEFAULT_MAX_ATTEMPTS} times in all; past that the statement fails. Rows are checked one by
 * one: a row that does not read is kept as unreadable, so the review shows it.
 *
 * Page images never touch disk: each is a buffer that is let go once its page is read. The caller
 * deletes the uploaded PDF once this returns, however it ends.
 *
 * A PDF states no transaction ids, so every row is a fingerprint of its date and amount (and how
 * many rows before it on the statement share them): the same statement read again finds its rows
 * as duplicates, whatever words the model chose for them. Fuzzy duplicates against the account
 * (a bank sync of the same month) are the session's own check, as for every format.
 */

export const DEFAULT_MAX_ATTEMPTS = 3;
/** Pages are rendered at twice the PDF's 72 dpi: statement print is small. */
const RENDER_SCALE = 2;

export type PdfStatementErrorCode = 'extraction_failed' | 'no_rows' | 'too_many_pages' | 'unreadable';

/** The statement cannot be read into rows; `code` is what the session records. */
export class PdfStatementError extends Error {
  constructor(readonly code: PdfStatementErrorCode, options: { cause?: unknown } = {}) {
    super(`PDF statement could not be read: ${code}`, options);
    this.name = 'PdfStatementError';
  }
}

/** An opened PDF: how many pages it has, and each page as a PNG. */
export type OpenPdf = (bytes: Uint8Array) => Promise<PdfPageSource>;

export interface PdfPageSource {
  close(): Promise<void>;
  page(pageNumber: number): Promise<Buffer>;
  pageCount: number;
}

/** One page to the model; resolves to its raw answer, which the reader checks. */
export interface PdfStatementProgress {
  pageCount: number;
  pagesRead: number;
}

export interface PdfStatementReading {
  pageCount: number;
  reconciliation: StatementReconciliation;
  result: transactionImport.ImportParseResult;
}

export interface ReadPdfStatementOptions {
  accountCurrency: string;
  maxAttempts?: number;
  maxPages: number;
  /** After the page count is known (with 0 pages read) and after each page; false stops the read (the import was cancelled). */
  onProgress?: (progress: PdfStatementProgress) => boolean | Promise<boolean>;
  open?: OpenPdf;
  readPage?: ReadStatementPage;
  /** Waits between attempts at a page. */
  sleep?: (ms: number) => Promise<void>;
}

export type ReadStatementPage = (input: { accountCurrency: string; image: Buffer; pageCount: number; pageNumber: number }) => Promise<unknown>;

const PDF_MAGIC = '%PDF-';

export function isPdfFile(bytes: Uint8Array): boolean {
  // The header may follow a little leading junk; the spec allows it within the first 1024 bytes.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  return head.includes(PDF_MAGIC);
}

export async function readPdfStatement(bytes: Uint8Array, options: ReadPdfStatementOptions): Promise<'cancelled' | PdfStatementReading> {
  if (!isPdfFile(bytes)) throw new PdfStatementError('unreadable');
  const open = options.open ?? openPdf;
  const readPage = options.readPage ?? readStatementPageWithModel;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let source: PdfPageSource;
  try {
    source = await open(bytes);
  } catch (error) {
    throw new PdfStatementError('unreadable', { cause: error });
  }
  try {
    const { pageCount } = source;
    if (pageCount < 1) throw new PdfStatementError('unreadable');
    if (pageCount > options.maxPages) throw new PdfStatementError('too_many_pages');
    if ((await options.onProgress?.({ pageCount, pagesRead: 0 })) === false) return 'cancelled';

    const pages: { page: StatementPage; pageNumber: number }[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      let image: Buffer;
      try {
        image = await source.page(pageNumber);
      } catch (error) {
        throw new PdfStatementError('unreadable', { cause: error });
      }
      pages.push({ page: await readWithRetries(() => readPage({ accountCurrency: options.accountCurrency, image, pageCount, pageNumber }), { maxAttempts, sleep }), pageNumber });
      if ((await options.onProgress?.({ pageCount, pagesRead: pageNumber })) === false) return 'cancelled';
    }
    return { pageCount, ...stage(pages, options.accountCurrency) };
  } finally {
    await source.close().catch(() => undefined);
  }
}

async function readWithRetries(read: () => Promise<unknown>, { maxAttempts, sleep }: { maxAttempts: number; sleep: (ms: number) => Promise<void> }): Promise<StatementPage> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(1000 * 2 ** (attempt - 2));
    try {
      const parsed = statementPageSchema.safeParse(await read());
      if (parsed.success) return parsed.data;
      lastError = parsed.error;
    } catch (error) {
      lastError = error;
    }
  }
  throw new PdfStatementError('extraction_failed', { cause: lastError });
}

/** The pages' rows as staged rows, numbered across the statement, and the statement's own check. */
function normalizedOf(row: StatementRow, amount: number, currency: string, externalId: string): transactionImport.NormalizedImportRow {
  return {
    amount,
    currency,
    date: `${row.date}T00:00:00.000Z`,
    description: row.description.replace(/\s+/gu, ' '),
    externalId,
    externalIdTrusted: false,
  };
}

function stage(pages: { page: StatementPage; pageNumber: number }[], accountCurrency: string): Omit<PdfStatementReading, 'pageCount'> {
  const statementCurrency = pages.find(({ page }) => page.currency !== null)?.page.currency ?? null;
  const openingBalance = pages.find(({ page }) => page.openingBalance !== null)?.page.openingBalance ?? null;
  const closingBalance = [...pages].reverse().find(({ page }) => page.closingBalance !== null)?.page.closingBalance ?? null;
  const defaultCurrency = statementCurrency ?? accountCurrency;

  const rows: transactionImport.ParsedImportRow[] = [];
  const amounts: number[] = [];
  const occurrences = new Map<string, number>();
  const otherCurrencies = new Set<string>();
  let sourceRow = 0;
  for (const { page, pageNumber } of pages) {
    for (const candidate of page.rows) {
      sourceRow += 1;
      const parsed = statementRowSchema.safeParse(candidate);
      if (!parsed.success) {
        rows.push({ error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`).join('; ').slice(0, 500), raw: rawOf(candidate, pageNumber), sourceRow });
        continue;
      }
      const row = parsed.data;
      const amount = Math.round(row.amount * 100) / 100;
      const currency = row.currency ?? defaultCurrency;
      if (currency !== accountCurrency) otherCurrencies.add(currency);
      const key = `${row.date}|${amount.toFixed(2)}`;
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      amounts.push(amount);
      rows.push({ normalized: normalizedOf(row, amount, currency, `pdf-fp:${key}|${occurrence}`), raw: rawOf(row, pageNumber), sourceRow });
    }
  }
  if (rows.length === 0) throw new PdfStatementError('no_rows');
  const warnings: transactionImport.ImportWarning[] = [...otherCurrencies].map((currency) => ({ code: 'pdf_currency_differs', detail: currency }));
  return {
    reconciliation: reconcileStatement({ amounts, closingBalance, currency: statementCurrency, openingBalance }),
    result: { rows, sourceAccounts: [], warnings },
  };
}

/** A few short fields, for the review; nothing else the model said is kept. */
function rawOf(candidate: unknown, page: number): Record<string, unknown> {
  const record = candidate !== null && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : {};
  const short = (value: unknown) => (typeof value === 'string' ? value.slice(0, 500) : typeof value === 'number' && Number.isFinite(value) ? value : null);
  return { amount: short(record['amount']), balance: short(record['balance']), date: short(record['date']), description: short(record['description']), page };
}

/** Opens the PDF with pdf.js (`pdf-to-img`), in memory. */
export const openPdf: OpenPdf = async (bytes) => {
  const { pdf } = await import('pdf-to-img');
  // pdf.js takes ownership of the buffer it is given: hand it a copy.
  const document = await pdf(Buffer.from(bytes), { scale: RENDER_SCALE });
  return { close: () => document.destroy(), page: (pageNumber) => document.getPage(pageNumber), pageCount: document.length };
};

/** The page to the configured `statementImport` model. */
export const readStatementPageWithModel: ReadStatementPage = async ({ accountCurrency, image, pageCount, pageNumber }) => {
  const { object } = await completeJson({
    feature: 'statementImport',
    images: [{ data: image.toString('base64'), mediaType: 'image/png' }],
    schema: STATEMENT_PAGE_RESPONSE_SCHEMA,
    schemaName: 'bank_statement_page',
    system: STATEMENT_PAGE_INSTRUCTIONS,
    user: statementPagePrompt({ pageCount, pageNumber }, accountCurrency),
  });
  return object;
};
