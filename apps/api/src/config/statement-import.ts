/**
 * The largest PDF statement an import reads (`services/transaction-import/pdf-statement/`):
 * `STATEMENT_IMPORT_MAX_BYTES` (10 MB by default) and `STATEMENT_IMPORT_MAX_PAGES` (20 pages by
 * default). Boot validation (`configuration.ts`) refuses anything but a positive whole number, so a
 * value read here is either unset or valid; a malformed one still falls back to the default.
 *
 * Every page is one vision request, so the page limit is also the most one statement can cost.
 */
export interface StatementImportLimits {
  maxBytes: number;
  maxPages: number;
}

export const DEFAULT_STATEMENT_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_STATEMENT_IMPORT_MAX_PAGES = 20;

type Env = Readonly<Record<string, string | undefined>>;

export function statementImportLimits(env: Env = process.env): StatementImportLimits {
  return {
    maxBytes: positiveWhole(env['STATEMENT_IMPORT_MAX_BYTES']) ?? DEFAULT_STATEMENT_IMPORT_MAX_BYTES,
    maxPages: positiveWhole(env['STATEMENT_IMPORT_MAX_PAGES']) ?? DEFAULT_STATEMENT_IMPORT_MAX_PAGES,
  };
}

function positiveWhole(value: string | undefined): null | number {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/u.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
