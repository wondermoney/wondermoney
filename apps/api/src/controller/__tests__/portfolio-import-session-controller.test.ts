import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockParseOutcome { correlationId: string; importSessionId: number; status: 'parsing'; }

const mocked = vi.hoisted(() => ({
  requestParse: vi.fn(),
  zParse: vi.fn((_schema: unknown, _req: unknown): Promise<{ params: { importSessionId: number } }> => Promise.resolve({ params: { importSessionId: 456 } })),
}));

vi.mock('@app/validators/parser', () => ({ zParse: mocked.zParse }));
vi.mock('@app/validators/portfolio', () => ({ parsePortfolioImportSessionRequestSchema: {} }));
vi.mock('@service/portfolio/portfolio-import-session-transitions', () => ({ default: { requestParse: mocked.requestParse } }));

import { zParse } from '@app/validators/parser';

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { triggerPortfolioImportSessionParse } from '../portfolio-import-session';

describe('portfolio import session parse controller', () => {
  const enqueue = { send: vi.fn(), sendAfter: vi.fn() };
  beforeEach(() => {
    mocked.requestParse.mockReset().mockResolvedValue({ correlationId: 'portfolio.csv-parse-preview:456:abc', importSessionId: 456, status: 'parsing' } satisfies MockParseOutcome);
    vi.mocked(zParse).mockClear();
  });

  it('rejects missing user', async () => {
    await expect(triggerPortfolioImportSessionParse(Object.assign(mockReq({ params: { importSessionId: '1' } }), { tenant: { tenantKey: 1 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Unauthorized');
  });

  it('rejects missing tenant', async () => {
    await expect(triggerPortfolioImportSessionParse(Object.assign(mockReq({ params: { importSessionId: '1' } }), { user: { appuserKey: 1 } }), mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Tenant not found');
  });

  it('delegates to the transitions module and returns 202', async () => {
    const status = vi.fn().mockReturnThis(); const json = vi.fn();
    await triggerPortfolioImportSessionParse(Object.assign(mockReq({ params: { importSessionId: '1' } }), { enqueue, tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json, status }));
    expect(mocked.requestParse).toHaveBeenCalledWith({ appuser: { appuserKey: 2 }, importSessionId: 456, tenant: { tenantKey: 1 } }, { enqueue });
    expect(status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({ correlationId: 'portfolio.csv-parse-preview:456:abc', importSessionId: 456, status: 'parsing' });
  });

  it('propagates domain errors from the transitions module', async () => {
    mocked.requestParse.mockRejectedValueOnce(new Error('Import session has expired'));
    await expect(triggerPortfolioImportSessionParse(Object.assign(mockReq({ params: { importSessionId: '1' } }), { enqueue, tenant: { tenantKey: 1 }, user: { appuserKey: 2 } }), mockRes({ json: vi.fn(), status: vi.fn().mockReturnThis() }))).rejects.toThrow('Import session has expired');
  });
});
