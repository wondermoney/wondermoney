import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectStatement: vi.fn(),
  findOne: vi.fn(),
  getLimitedCsvObjectBuffer: vi.fn(),
  toStatementPreview: vi.fn(),
  validateCsvObjectKey: vi.fn(),
}));

vi.mock('../../../app.js', () => ({ DI: { em: { findOne: mocks.findOne } } }));
vi.mock('@service/account/account-statement-detection.service', () => ({
  detectStatement: mocks.detectStatement,
  toStatementPreview: mocks.toStatementPreview,
}));
vi.mock('@service/account/csv-upload-boundary.service', () => ({
  getLimitedCsvObjectBuffer: mocks.getLimitedCsvObjectBuffer,
  validateCsvObjectKey: mocks.validateCsvObjectKey,
}));
vi.mock('@validators/parser', () => ({ zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)) }));

import { previewAccountCsvImport } from '../imports';

const user = { appuserKey: 71 };

function request(preferences: Record<string, unknown>) {
  return {
    body: { key: 'account-41-upload.csv' },
    params: { accountId: '41' },
    tenant: { tenantKey: 113 },
    user: { ...user, preferences },
  } as unknown as Request;
}

/*
 * A person who hid AI still imports a statement: the preview reads the file with the column
 * names and values and leaves the mapping to them, exactly as it does once the daily allowance
 * is used up. No model call is made.
 */
describe('account CSV preview with AI hidden', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOne.mockResolvedValue({ accountFinancialInstitutionKey: null, currencyKey: { code: 'EUR' } });
    mocks.validateCsvObjectKey.mockReturnValue(true);
    mocks.getLimitedCsvObjectBuffer.mockResolvedValue(Buffer.from('Date;Description;Amount\n2026-01-02;Shop;-1,00\n'));
    mocks.detectStatement.mockResolvedValue({ headers: [], invalidRows: 0, sample: [], source: 'none', totalRows: 0 });
    mocks.toStatementPreview.mockReturnValue({ source: 'none', totalRows: 0 });
  });

  it('reads the file without a model call and still previews it', async () => {
    const json = vi.fn();

    await previewAccountCsvImport(request({ aiHidden: true }), { json } as unknown as Response, vi.fn());

    expect(mocks.detectStatement).toHaveBeenCalledWith(expect.objectContaining({ model: expect.objectContaining({ allowed: false }) }));
    expect(json).toHaveBeenCalledWith({ source: 'none', totalRows: 0 });
  });

  it('allows the model again once the switch is off', async () => {
    const json = vi.fn();

    await previewAccountCsvImport(request({ aiHidden: false }), { json } as unknown as Response, vi.fn());

    expect(mocks.detectStatement).toHaveBeenCalledWith(expect.objectContaining({ model: expect.objectContaining({ allowed: true }) }));
    expect(json).toHaveBeenCalled();
  });
});
