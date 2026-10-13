import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockRes } from '../../__tests__/__helpers__/mock-request';

const mocked = vi.hoisted(() => ({
  findOne: vi.fn(),
  setUser: vi.fn(),
}));

vi.mock('@app/app', () => ({
  DI: { em: { findOne: mocked.findOne } },
}));

vi.mock('@sentry/node', () => ({
  setUser: mocked.setUser,
}));

describe('user middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUser', () => {
    it('resolves the appuser by req.authUser.user.id and attaches it to the request', async () => {
      const { getUser } = await import('../user');
      const appUser = { appuserKey: 1, emailAddress: 'user@example.com' };
      mocked.findOne.mockResolvedValueOnce(appUser);
      const req = { authUser: { session: { id: 'session-1' }, user: { id: 'auth-user-1' } } } as unknown as Request;
      const next = vi.fn();

      await getUser(req, mockRes(), next);

      expect(mocked.findOne).toHaveBeenCalledWith(expect.any(Function), {
        deletedAt: undefined,
        externalUserId: 'auth-user-1',
        recordActive: true,
      });
      expect((req as { user?: unknown }).user).toBe(appUser);
      expect(mocked.setUser).toHaveBeenCalledWith({ email: appUser.emailAddress, id: '1' });
      expect(next).toHaveBeenCalledWith();
    });

    it('throws when req.authUser is missing', async () => {
      const { getUser } = await import('../user');
      const req = {} as unknown as Request;
      const next = vi.fn();

      await expect(getUser(req, mockRes(), next)).rejects.toThrow('Auth user not found');
      expect(mocked.findOne).not.toHaveBeenCalled();
    });

    it('throws when no appuser matches the auth user id', async () => {
      const { getUser } = await import('../user');
      mocked.findOne.mockResolvedValueOnce(null);
      const req = { authUser: { session: { id: 'session-1' }, user: { id: 'auth-user-1' } } } as unknown as Request;
      const next = vi.fn();

      await expect(getUser(req, mockRes(), next)).rejects.toThrow('User not found');
    });
  });

  describe('getUserOptional', () => {
    it('sets req.user when a matching appuser is found', async () => {
      const { getUserOptional } = await import('../user');
      const appUser = { appuserKey: 2, emailAddress: 'user2@example.com' };
      mocked.findOne.mockResolvedValueOnce(appUser);
      const req = { authUser: { session: { id: 'session-2' }, user: { id: 'auth-user-2' } } } as unknown as Request;
      const next = vi.fn();

      await getUserOptional(req, mockRes(), next);

      expect((req as { user?: unknown }).user).toBe(appUser);
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next without setting req.user when req.authUser is missing', async () => {
      const { getUserOptional } = await import('../user');
      const req = {} as unknown as Request;
      const next = vi.fn();

      await getUserOptional(req, mockRes(), next);

      expect(mocked.findOne).not.toHaveBeenCalled();
      expect((req as { user?: unknown }).user).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
    });
  });
});
