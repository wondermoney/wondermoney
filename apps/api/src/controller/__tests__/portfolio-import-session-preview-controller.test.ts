import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  getPreview: vi.fn(),
  zParse: vi.fn(),
}));

vi.mock('@app/validators/parser', () => ({ zParse: mocked.zParse }));
vi.mock('@app/validators/portfolio', async () => {
  const actual = await vi.importActual<typeof import('@app/validators/portfolio')>('@app/validators/portfolio');
  return {
    ...actual,
    confirmPortfolioImportColumnMappingRequestSchema: {},
    getPortfolioImportSessionPreviewRequestSchema: {},
    parsePortfolioImportSessionRequestSchema: {},
    suggestPortfolioImportColumnMappingRequestSchema: {},
  };
});
vi.mock('@app/app', () => ({ DI: { em: {} } }));
vi.mock('@service/portfolio/portfolio-import-session-preview.service', () => ({ default: { getPreview: mocked.getPreview } }));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { getPortfolioImportSessionPreview } from '../portfolio-import-session';

describe('portfolio import session preview controller', () => {
  beforeEach(() => {
    mocked.getPreview.mockReset();
    mocked.zParse.mockReset();
  });

  it('rejects missing user', async () => {
    mocked.zParse.mockResolvedValueOnce({ params: { importSessionId: 12 }, query: { limit: 25 } });
    await expect(getPortfolioImportSessionPreview(Object.assign(mockReq({ params: { importSessionId: '12' } }), { tenant: { tenantKey: 1 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Unauthorized');
  });

  it('rejects missing tenant', async () => {
    mocked.zParse.mockResolvedValueOnce({ params: { importSessionId: 12 }, query: { limit: 25 } });
    await expect(getPortfolioImportSessionPreview(Object.assign(mockReq({ params: { importSessionId: '12' } }), { user: { appuserKey: 2 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Tenant not found');
  });

  it('calls service with parsed params and returns preview', async () => {
    const preview = { importSessionId: 12, limits: { rowsPerBucket: 25 } };
    mocked.zParse.mockResolvedValueOnce({ params: { importSessionId: 12 }, query: { limit: 25 } });
    mocked.getPreview.mockResolvedValueOnce(preview);
    const status = vi.fn().mockReturnThis(); const json = vi.fn();
    await getPortfolioImportSessionPreview(Object.assign(mockReq({ params: { importSessionId: '12' }, query: {} }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json, status }));
    expect(mocked.getPreview).toHaveBeenCalledWith({ appuser: { appuserKey: 2 }, importSessionId: 12, limit: 25, tenant: { tenantKey: 1 } });
    expect(mocked.getPreview).toHaveBeenCalledTimes(1);
    expect(mocked.zParse).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(preview);
    expect(json.mock.calls[0]?.[0]).toBe(preview);
  });

  it('bubbles validation errors from zParse', async () => {
    mocked.zParse.mockRejectedValueOnce(new Error('validation failed'));
    await expect(getPortfolioImportSessionPreview(Object.assign(mockReq({ params: { importSessionId: '12' }, query: {} }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('validation failed');
  });

  it('exports the preview schema with limit defaults and bounds', async () => {
    const { getPortfolioImportSessionPreviewRequestSchema } = await vi.importActual<typeof import('@app/validators/portfolio')>('@app/validators/portfolio');
    expect(getPortfolioImportSessionPreviewRequestSchema.parse({ params: { importSessionId: 1 }, query: {} }).query.limit).toBe(25);
    expect(getPortfolioImportSessionPreviewRequestSchema.parse({ params: { importSessionId: 1 }, query: { limit: '100' } }).query.limit).toBe(100);
    expect(getPortfolioImportSessionPreviewRequestSchema.parse({ params: { importSessionId: 1 }, query: { limit: 100 } }).query.limit).toBe(100);
    expect(() => getPortfolioImportSessionPreviewRequestSchema.parse({ params: { importSessionId: 1 }, query: { limit: '101' } })).toThrow();
    expect(() => getPortfolioImportSessionPreviewRequestSchema.parse({ params: { importSessionId: 1 }, query: { limit: '0' } })).toThrow();
    expect(() => getPortfolioImportSessionPreviewRequestSchema.parse({ params: { importSessionId: 1 }, query: { limit: '1.5' } })).toThrow();
    expect(() => getPortfolioImportSessionPreviewRequestSchema.parse({ params: { importSessionId: 1 }, query: { limit: ['1', '2'] } })).toThrow();
    expect(() => getPortfolioImportSessionPreviewRequestSchema.parse({ params: { importSessionId: 1 }, query: { limit: '1', unexpected: 'x' } as unknown as { limit?: unknown } })).toThrow();
  });
});
