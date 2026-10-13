import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  getPortfolioHistoryStatus: vi.fn(),
}));

vi.mock('@app/validators/parser', () => ({
  zParse: vi.fn(() => Promise.resolve({ params: { portfolioId: 12 } })),
}));

vi.mock('../../app.js', () => ({
  DI: { em: {} },
}));

vi.mock('../../services/portfolio/portfolio-history-status.service.js', () => ({
  default: {
    getPortfolioHistoryStatus: mocked.getPortfolioHistoryStatus,
  },
}));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { getPortfolioHistoryStatus as getPortfolioHistoryStatusController } from '../portfolio';

describe('portfolio history status controller', () => {
  it('returns status json from the service', async () => {
    mocked.getPortfolioHistoryStatus.mockResolvedValueOnce({ status: 'ready' });

    const json = vi.fn();
    const status = vi.fn().mockReturnThis();

    await getPortfolioHistoryStatusController(
      Object.assign(mockReq({ params: { portfolioId: '12' } }), { tenant: { tenantKey: 5 }, user: { appuserKey: 1 } }),
      mockRes({ json, status }),
    );

    expect(mocked.getPortfolioHistoryStatus).toHaveBeenCalledWith({ appuserKey: 1 }, 12, 5);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: 'ready' });
  });

  it('propagates not found errors', async () => {
    mocked.getPortfolioHistoryStatus.mockRejectedValueOnce(new Error('Portfolio not found'));

    await expect(
      getPortfolioHistoryStatusController(
        Object.assign(mockReq({ params: { portfolioId: '12' } }), { tenant: { tenantKey: 5 }, user: { appuserKey: 1 } }),
        mockRes({ status: vi.fn() }),
      ),
    ).rejects.toThrow('Portfolio not found');
  });
});
