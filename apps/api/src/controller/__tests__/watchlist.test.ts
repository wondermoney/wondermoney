import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn(),
  getAppuserTenantByAppuser: vi.fn(),
  nativeDelete: vi.fn(),
}));

vi.mock('@app/app', () => ({
  DI: {
    em: {
      create: mocks.create,
      find: mocks.find,
      findOne: mocks.findOne,
      getRepository: () => ({ getAppuserTenantByAppuser: mocks.getAppuserTenantByAppuser }),
      nativeDelete: mocks.nativeDelete,
      persist: () => ({ flush: mocks.flush }),
    },
  },
}));

function fakeRes() {
  const json = vi.fn();
  const sendStatus = vi.fn();
  return { json, res: { json, sendStatus } as unknown as Response, sendStatus };
}

const appuser = { appuserKey: 42 };
const tenant = { tenantKey: 1 };

describe('watchlist controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAppuserTenantByAppuser.mockResolvedValue({ tenantKey: tenant });
  });

  describe('getWatchlist', () => {
    it('returns the user symbols, scoped to the appuser + tenant, in insertion order', async () => {
      const { getWatchlist } = await import('../watchlist');
      mocks.find.mockResolvedValue([{ symbol: 'AAPL' }, { symbol: 'MSFT' }]);
      const { json, res } = fakeRes();
      const req = { user: appuser } as unknown as Request;

      await getWatchlist(req, res);

      expect(mocks.find).toHaveBeenCalledWith(
        expect.anything(),
        { appuserKey: appuser, tenantKey: tenant },
        { orderBy: { createdAt: 'asc' } },
      );
      expect(json).toHaveBeenCalledWith({ symbols: ['AAPL', 'MSFT'] });
    });
  });

  describe('addToWatchlist', () => {
    it('creates the row (uppercased) when the symbol is absent and 204s', async () => {
      const { addToWatchlist } = await import('../watchlist');
      mocks.findOne.mockResolvedValue(null);
      mocks.create.mockReturnValue({ symbol: 'AAPL' });
      const { res, sendStatus } = fakeRes();
      const req = { params: { symbol: 'aapl' }, user: appuser } as unknown as Request;

      await addToWatchlist(req, res);

      expect(mocks.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ appuserKey: appuser, symbol: 'AAPL', tenantKey: tenant }),
      );
      expect(mocks.flush).toHaveBeenCalledTimes(1);
      expect(sendStatus).toHaveBeenCalledWith(204);
    });

    it('is a no-op when the symbol is already on the list', async () => {
      const { addToWatchlist } = await import('../watchlist');
      mocks.findOne.mockResolvedValue({ symbol: 'AAPL' });
      const { res, sendStatus } = fakeRes();
      const req = { params: { symbol: 'AAPL' }, user: appuser } as unknown as Request;

      await addToWatchlist(req, res);

      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.flush).not.toHaveBeenCalled();
      expect(sendStatus).toHaveBeenCalledWith(204);
    });
  });

  describe('removeFromWatchlist', () => {
    it('hard-deletes the scoped row (uppercased) and 204s', async () => {
      const { removeFromWatchlist } = await import('../watchlist');
      const { res, sendStatus } = fakeRes();
      const req = { params: { symbol: 'aapl' }, user: appuser } as unknown as Request;

      await removeFromWatchlist(req, res);

      expect(mocks.nativeDelete).toHaveBeenCalledWith(
        expect.anything(),
        { appuserKey: appuser, symbol: 'AAPL', tenantKey: tenant },
      );
      expect(sendStatus).toHaveBeenCalledWith(204);
    });
  });
});
