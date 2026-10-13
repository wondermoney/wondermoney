import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  confirmAssetMappings: vi.fn(),
  confirmColumnMapping: vi.fn(),
  getOwnedSession: vi.fn(),
  getPreview: vi.fn(),
  isExpired: vi.fn((session: { expiresAt?: Date }) => Boolean(session.expiresAt && session.expiresAt.getTime() <= Date.now())),
  session: { expiresAt: new Date('2030-01-01T00:00:00.000Z') },
  zParse: vi.fn(),
}));

vi.mock('@app/validators/parser', () => ({ zParse: mocked.zParse }));
vi.mock('@app/app', () => ({ DI: { em: {} } }));
vi.mock('@service/portfolio/portfolio-import-session.service', () => ({ default: { getOwnedSession: mocked.getOwnedSession, isExpired: mocked.isExpired } }));
vi.mock('@service/portfolio/portfolio-import-session-preview.service', () => ({ default: { getPreview: mocked.getPreview } }));
vi.mock('@service/portfolio/portfolio-csv-column-mapping.service', () => ({ default: { confirmColumnMapping: mocked.confirmColumnMapping, suggestColumnMapping: vi.fn() } }));
vi.mock('@app/validators/portfolio', async () => {
  const actual = await vi.importActual<typeof import('@app/validators/portfolio')>('@app/validators/portfolio');
  return { ...actual, confirmPortfolioImportAssetMappingsRequestSchema: {} };
});
vi.mock('@service/portfolio/portfolio-import-asset-mapping.service', () => ({ default: { confirmAssetMappings: mocked.confirmAssetMappings } }));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { confirmPortfolioImportSessionAssetMappings } from '../portfolio-import-session';

describe('portfolio import session asset mapping controller', () => {
  beforeEach(() => {
    mocked.confirmAssetMappings.mockReset();
    mocked.confirmColumnMapping.mockReset();
    mocked.getOwnedSession.mockReset().mockResolvedValue(mocked.session);
    mocked.isExpired.mockClear().mockImplementation((session: { expiresAt?: Date }) => Boolean(session.expiresAt && session.expiresAt.getTime() <= Date.now()));
    mocked.session.expiresAt = new Date('2030-01-01T00:00:00.000Z');
    mocked.getPreview.mockReset();
    mocked.zParse.mockReset();
  });

  it('rejects missing user', async () => {
    mocked.zParse.mockResolvedValueOnce({ body: { decisions: [{ action: 'skip_group', groupId: 1 }] }, params: { importSessionId: 11 } });
    await expect(confirmPortfolioImportSessionAssetMappings(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Unauthorized');
  });

  it('rejects missing tenant', async () => {
    mocked.zParse.mockResolvedValueOnce({ body: { decisions: [{ action: 'skip_group', groupId: 1 }] }, params: { importSessionId: 11 } });
    await expect(confirmPortfolioImportSessionAssetMappings(Object.assign(mockReq({ params: { importSessionId: '11' } }), { user: { appuserKey: 2 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Tenant not found');
  });

  it('calls service with parsed decisions and returns result', async () => {
    const parsed = { body: { decisions: [{ action: 'use_candidate', candidateId: 9, groupId: 3 }] }, params: { importSessionId: 11 } };
    const serviceResult = { applied: 1, importSessionId: 11, status: 'needs_asset_review' };
    mocked.zParse.mockResolvedValueOnce(parsed);
    mocked.confirmAssetMappings.mockResolvedValueOnce(serviceResult);
    const status = vi.fn().mockReturnThis(); const json = vi.fn();
    await confirmPortfolioImportSessionAssetMappings(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json, status }));
    expect(mocked.confirmAssetMappings).toHaveBeenCalledWith({ appuser: { appuserKey: 2 }, decisions: parsed.body.decisions, importSessionId: 11, tenant: { tenantKey: 1 } });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(serviceResult);
  });

  it('rejects expired sessions', async () => {
    mocked.session.expiresAt = new Date('2020-01-01T00:00:00.000Z');
    mocked.zParse.mockResolvedValueOnce({ body: { decisions: [{ action: 'skip_group', groupId: 1 }] }, params: { importSessionId: 11 } });
    await expect(confirmPortfolioImportSessionAssetMappings(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Import session has expired');
  });

  it('returns the service result unchanged', async () => {
    const parsed = { body: { decisions: [{ action: 'skip_group', groupId: 3 }] }, params: { importSessionId: 11 } };
    const serviceResult = { importSessionId: 11, status: 'partial', summary: { foo: 'bar' } };
    mocked.zParse.mockResolvedValueOnce(parsed);
    mocked.confirmAssetMappings.mockResolvedValueOnce(serviceResult);
    const status = vi.fn().mockReturnThis(); const json = vi.fn();

    await confirmPortfolioImportSessionAssetMappings(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json, status }));

    expect(json).toHaveBeenCalledWith(serviceResult);
  });

  it('does not call preview or column mapping services', async () => {
    mocked.zParse.mockResolvedValueOnce({ body: { decisions: [{ action: 'skip_group', groupId: 3 }] }, params: { importSessionId: 11 } });
    mocked.confirmAssetMappings.mockResolvedValueOnce({ importSessionId: 11, status: 'partial', summary: {} });

    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await confirmPortfolioImportSessionAssetMappings(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes(res));

    expect(mocked.getPreview).not.toHaveBeenCalled();
    expect(mocked.confirmColumnMapping).not.toHaveBeenCalled();
  });

  it('bubbles validation errors from zParse', async () => {
    mocked.zParse.mockRejectedValueOnce(new Error('validation failed'));
    await expect(confirmPortfolioImportSessionAssetMappings(Object.assign(mockReq({ params: { importSessionId: '11' } }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('validation failed');
  });

  it('validates asset mapping decision schema', async () => {
    const { confirmPortfolioImportAssetMappingsRequestSchema } = await vi.importActual<typeof import('@app/validators/portfolio')>('@app/validators/portfolio');
    expect(confirmPortfolioImportAssetMappingsRequestSchema.parse({ body: { decisions: [{ action: 'use_candidate', candidateId: 1, groupId: 2 }] }, params: { importSessionId: 3 } }).body.decisions[0]).toMatchObject({ action: 'use_candidate', candidateId: 1, groupId: 2 });
    expect(confirmPortfolioImportAssetMappingsRequestSchema.parse({ body: { decisions: [{ action: 'use_external_symbol', groupId: 4, symbol: 'TSLA' }] }, params: { importSessionId: 3 } }).body.decisions[0]).toMatchObject({ action: 'use_external_symbol', groupId: 4, symbol: 'TSLA' });
    expect(confirmPortfolioImportAssetMappingsRequestSchema.parse({ body: { decisions: [{ action: 'use_existing_asset', financialAssetId: 4, groupId: 5 }] }, params: { importSessionId: 3 } }).body.decisions[0]).toMatchObject({ action: 'use_existing_asset', financialAssetId: 4, groupId: 5 });
    expect(confirmPortfolioImportAssetMappingsRequestSchema.parse({ body: { decisions: [{ action: 'skip_group', groupId: 6, skipReason: '  not needed  ' }] }, params: { importSessionId: 3 } }).body.decisions[0]).toMatchObject({ action: 'skip_group', groupId: 6, skipReason: 'not needed' });
    expect(() => confirmPortfolioImportAssetMappingsRequestSchema.parse({ body: { decisions: [] }, params: { importSessionId: 3 } })).toThrow();
    expect(() => confirmPortfolioImportAssetMappingsRequestSchema.parse({ body: { decisions: [{ action: 'unknown', groupId: 1 }] }, params: { importSessionId: 3 } })).toThrow();
    expect(() => confirmPortfolioImportAssetMappingsRequestSchema.parse({ body: { decisions: [{ action: 'skip_group', extra: true, groupId: 1 }] }, params: { importSessionId: 3 } })).toThrow();
    expect(() => confirmPortfolioImportAssetMappingsRequestSchema.parse({ body: { decisions: [{ action: 'skip_group', groupId: 1, skipReason: '   ' }] }, params: { importSessionId: 3 } })).toThrow();
    expect(() => confirmPortfolioImportAssetMappingsRequestSchema.parse({ body: { decisions: [{ action: 'skip_group', groupId: 1, skipReason: 'x'.repeat(256) }] }, params: { importSessionId: 3 } })).toThrow();
    expect(() => confirmPortfolioImportAssetMappingsRequestSchema.parse({ body: { decisions: Array.from({ length: 101 }, (_, index) => ({ action: 'skip_group', groupId: index + 1 })) }, params: { importSessionId: 3 } })).toThrow();
  });
});
