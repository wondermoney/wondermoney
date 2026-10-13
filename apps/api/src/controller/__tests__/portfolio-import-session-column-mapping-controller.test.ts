import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  confirmColumnMapping: vi.fn(),
  getOwnedSession: vi.fn(),
  isExpired: vi.fn((session: { expiresAt?: Date }) => Boolean(session.expiresAt && session.expiresAt.getTime() <= Date.now())),
  session: { expiresAt: new Date('2030-01-01T00:00:00.000Z') },
  suggestColumnMapping: vi.fn(),
  zParse: vi.fn(),
}));

vi.mock('@app/validators/parser', () => ({ zParse: mocked.zParse }));
vi.mock('@app/app', () => ({ DI: { em: {} } }));
vi.mock('@service/portfolio/portfolio-import-session.service', () => ({ default: { getOwnedSession: mocked.getOwnedSession, isExpired: mocked.isExpired } }));
vi.mock('@service/portfolio/portfolio-csv-column-mapping.service', () => ({ default: { confirmColumnMapping: mocked.confirmColumnMapping, suggestColumnMapping: mocked.suggestColumnMapping } }));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { confirmPortfolioImportSessionColumnMapping, suggestPortfolioImportSessionColumnMapping } from '../portfolio-import-session';

describe('portfolio import session column mapping controller', () => {
  beforeEach(() => {
    mocked.confirmColumnMapping.mockReset();
    mocked.suggestColumnMapping.mockReset();
    mocked.getOwnedSession.mockReset().mockResolvedValue(mocked.session);
    mocked.isExpired.mockClear().mockImplementation((session: { expiresAt?: Date }) => Boolean(session.expiresAt && session.expiresAt.getTime() <= Date.now()));
    mocked.session.expiresAt = new Date('2030-01-01T00:00:00.000Z');
    mocked.zParse.mockReset();
  });

  it('suggest requires user', async () => {
    mocked.zParse.mockResolvedValueOnce({ body: {}, params: { importSessionId: 11 } });
    await expect(suggestPortfolioImportSessionColumnMapping(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 } }), mockRes())).rejects.toThrow('Unauthorized');
  });

  it('suggest requires tenant', async () => {
    mocked.zParse.mockResolvedValueOnce({ body: {}, params: { importSessionId: 11 } });
    await expect(suggestPortfolioImportSessionColumnMapping(Object.assign(mockReq({ params: { importSessionId: '11' } }), { user: { appuserKey: 2 } }), mockRes())).rejects.toThrow('Tenant not found');
  });

  it('suggest calls service and returns mapping warning status', async () => {
    mocked.zParse.mockResolvedValueOnce({ body: {}, params: { importSessionId: 11 } });
    mocked.suggestColumnMapping.mockResolvedValueOnce({ columnMapping: { columnMapping: {}, confidence: 0.9, transformations: { decimalSeparator: '.', thousandsSeparator: 'none' }, warnings: [] }, importSessionId: 11, mappingSource: 'llm', status: 'needs_column_mapping', warning: 'low confidence' });
    const status = vi.fn().mockReturnThis(); const json = vi.fn();
    await suggestPortfolioImportSessionColumnMapping(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json, status }));
    expect(mocked.suggestColumnMapping).toHaveBeenCalledWith({ appuser: { appuserKey: 2 }, importSessionId: 11, tenant: { tenantKey: 1 } });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ columnMapping: expect.any(Object), importSessionId: 11, mappingSource: 'llm', status: 'needs_column_mapping', warning: 'low confidence' });
  });

  it('confirm rejects expired sessions', async () => {
    mocked.session.expiresAt = new Date('2020-01-01T00:00:00.000Z');
    mocked.zParse.mockResolvedValueOnce({ body: { columnMapping: {}, transformations: {} }, params: { importSessionId: 11 } });
    await expect(confirmPortfolioImportSessionColumnMapping(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes())).rejects.toThrow('Import session has expired');
  });

  it('confirm requires user', async () => {
    mocked.zParse.mockResolvedValueOnce({ body: { columnMapping: {}, transformations: {} }, params: { importSessionId: 11 } });
    await expect(confirmPortfolioImportSessionColumnMapping(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 } }), mockRes())).rejects.toThrow('Unauthorized');
  });

  it('confirm requires tenant', async () => {
    mocked.zParse.mockResolvedValueOnce({ body: { columnMapping: {}, transformations: {} }, params: { importSessionId: 11 } });
    await expect(confirmPortfolioImportSessionColumnMapping(Object.assign(mockReq({ params: { importSessionId: '11' } }), { user: { appuserKey: 2 } }), mockRes())).rejects.toThrow('Tenant not found');
  });

  it('confirm calls service with parsed body and returns status summary', async () => {
    const parsed = { body: { columnMapping: { assetName: 'Asset', currency: 'Currency', quantity: 'Qty', totalAmount: 'Total', transactionDate: 'Date' }, layout: { dataStartRowIndex: 2, headerRowIndex: 1 }, transformations: { decimalSeparator: '.', thousandsSeparator: 'none' } }, params: { importSessionId: 11 } };
    mocked.zParse.mockResolvedValueOnce(parsed);
    mocked.confirmColumnMapping.mockResolvedValueOnce({ duplicateRows: 0, importSessionId: 11, invalidRows: 0, readyRows: 1, status: 'partial', totalRows: 1 });
    const status = vi.fn().mockReturnThis(); const json = vi.fn();
    await confirmPortfolioImportSessionColumnMapping(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json, status }));
    expect(mocked.confirmColumnMapping).toHaveBeenCalledWith({ appuser: { appuserKey: 2 }, columnMapping: parsed.body.columnMapping, importSessionId: 11, layout: parsed.body.layout, tenant: { tenantKey: 1 }, transformations: parsed.body.transformations });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ importSessionId: 11, status: 'partial', summary: expect.objectContaining({ readyRows: 1, totalRows: 1 }) }));
  });

  it('suggest validation rejection is surfaced', async () => {
    mocked.zParse.mockRejectedValueOnce(new Error('validation failed'));
    await expect(suggestPortfolioImportSessionColumnMapping(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes())).rejects.toThrow('validation failed');
  });

  it('confirm validation rejection is surfaced', async () => {
    mocked.zParse.mockRejectedValueOnce(new Error('validation failed'));
    await expect(confirmPortfolioImportSessionColumnMapping(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes())).rejects.toThrow('validation failed');
  });
});
