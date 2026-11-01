import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';

const mocked = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@app/validators/parser', () => ({
  zParse: vi.fn(((_schema: ZodType, req: unknown) => Promise.resolve(req)) as Parameters<typeof vi.fn>[0]),
}));

vi.mock('../../app.js', () => ({
  DI: { em: { find: mocked.find, findOne: mocked.findOne, flush: mocked.flush } },
}));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { updatePortfolio } from '../portfolio';

describe('updatePortfolio targetAllocation validation', () => {
  it('rejects targetAllocation with unknown asset class keys', async () => {
    mocked.findOne.mockResolvedValue({ portfolioKey: 7 });
    mocked.find.mockResolvedValue([{ name: 'Equities' }, { name: 'Fixed Income' }]);

    const req = mockReq({ body: { targetAllocation: { NotARealClass: 100 } }, params: { portfolioId: '7' } });
    const res = mockRes();

    await expect(updatePortfolio(req, res)).rejects.toThrow(/Unknown asset class/);
  });

  it('accepts targetAllocation with only known asset class keys', async () => {
    mocked.findOne.mockResolvedValue({ portfolioKey: 7 });
    mocked.find.mockResolvedValue([{ name: 'Equities' }, { name: 'Fixed Income' }]);

    const req = mockReq({ body: { targetAllocation: { Equities: 60, 'Fixed Income': 40 } }, params: { portfolioId: '7' } });
    const json = vi.fn();
    const res = mockRes({ json });

    await updatePortfolio(req, res);

    expect(json).toHaveBeenCalled();
  });
});
