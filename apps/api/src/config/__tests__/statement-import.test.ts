import { describe, expect, it } from 'vitest';

import { statementImportLimits } from '../statement-import';

describe('statementImportLimits', () => {
  it('reads 10 MB and 20 pages when the operator sets nothing', () => {
    expect(statementImportLimits({})).toEqual({ maxBytes: 10 * 1024 * 1024, maxPages: 20 });
  });

  it('takes the operator overrides', () => {
    expect(statementImportLimits({ STATEMENT_IMPORT_MAX_BYTES: ' 2097152 ', STATEMENT_IMPORT_MAX_PAGES: '3' })).toEqual({ maxBytes: 2_097_152, maxPages: 3 });
  });

  it('keeps the default for a value boot validation would refuse', () => {
    expect(statementImportLimits({ STATEMENT_IMPORT_MAX_BYTES: '0', STATEMENT_IMPORT_MAX_PAGES: 'ten' })).toEqual({ maxBytes: 10 * 1024 * 1024, maxPages: 20 });
  });
});
