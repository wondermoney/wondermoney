import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requestConfirm: vi.fn(),
  zParse: vi.fn(),
}));

vi.mock('@app/validators/parser', () => ({ zParse: mocked.zParse }));
vi.mock('@app/validators/portfolio', async () => {
  const actual = await vi.importActual<typeof import('@app/validators/portfolio')>('@app/validators/portfolio');
  return { ...actual, confirmPortfolioImportSessionRequestSchema: {} };
});
vi.mock('@service/portfolio/portfolio-import-session-transitions', () => ({ default: { requestConfirm: mocked.requestConfirm } }));

import { zParse } from '@app/validators/parser';

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { confirmPortfolioImportSession } from '../portfolio-import-session';

describe('portfolio import session confirm controller', () => {
  const enqueue = { send: vi.fn(), sendAfter: vi.fn() };
  beforeEach(() => {
    mocked.requestConfirm.mockReset().mockResolvedValue({ correlationId: 'portfolio.csv-import-confirmed:456:abc', importSessionId: 456, status: 'importing' });
    mocked.zParse.mockReset().mockResolvedValue({ params: { importSessionId: 456 } });
    vi.mocked(zParse).mockClear();
  });

  it('rejects missing user', async () => {
    await expect(confirmPortfolioImportSession(Object.assign(mockReq({ params: { importSessionId: '1' } }), { tenant: { tenantKey: 1 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Unauthorized');
  });

  it('rejects missing tenant', async () => {
    await expect(confirmPortfolioImportSession(Object.assign(mockReq({ params: { importSessionId: '1' } }), { user: { appuserKey: 1 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Tenant not found');
  });

  it('propagates zParse validation errors', async () => {
    mocked.zParse.mockRejectedValueOnce(new Error('validation failed'));
    await expect(confirmPortfolioImportSession(Object.assign(mockReq({ params: { importSessionId: '1' } }), { tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('validation failed');
  });

  it('delegates to the transitions module and returns 202', async () => {
    const status = vi.fn().mockReturnThis(); const json = vi.fn();
    await confirmPortfolioImportSession(Object.assign(mockReq({ params: { importSessionId: '1' } }), { enqueue, tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json, status }));
    expect(mocked.requestConfirm).toHaveBeenCalledWith({ appuser: { appuserKey: 2 }, importSessionId: 456, tenant: { tenantKey: 1 } }, { enqueue });
    expect(status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({ correlationId: 'portfolio.csv-import-confirmed:456:abc', importSessionId: 456, status: 'importing' });
  });

  it('propagates domain errors from the transitions module', async () => {
    mocked.requestConfirm.mockRejectedValueOnce(new Error('Import session cannot be confirmed'));
    await expect(confirmPortfolioImportSession(Object.assign(mockReq({ params: { importSessionId: '1' } }), { enqueue, tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json: vi.fn(), status: vi.fn().mockReturnThis() }))).rejects.toThrow('Import session cannot be confirmed');
  });
});
