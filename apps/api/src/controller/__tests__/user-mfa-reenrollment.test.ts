import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flush: vi.fn(),
  getUserById: vi.fn(),
  persist: vi.fn(),
}));

vi.mock('@app/app', () => ({
  DI: {
    em: {
      getRepository: () => ({ getUserById: mocks.getUserById }),
      persist: mocks.persist,
    },
  },
}));

vi.mock('../../services/email/email', () => {
  throw new Error('email service should not load while importing user controller');
});

describe('completeMfaReenrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persist.mockReturnValue({ flush: mocks.flush });
    mocks.flush.mockResolvedValue(undefined);
  });

  it('clears the flag, persists, and returns 200', async () => {
    const user = { appuserKey: 7, requiresMfaReenrollment: true };
    mocks.getUserById.mockResolvedValue(user);
    const { completeMfaReenrollment } = await import('../user');
    const sendStatus = vi.fn();
    const res = { sendStatus } as unknown as Response;
    const req = { user: { appuserKey: 7 } } as unknown as Request;

    await completeMfaReenrollment(req, res, vi.fn());

    expect(user.requiresMfaReenrollment).toBe(false);
    expect(mocks.persist).toHaveBeenCalledWith(user);
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(sendStatus).toHaveBeenCalledWith(200);
  });

  it('rejects when the user cannot be found', async () => {
    mocks.getUserById.mockResolvedValue(null);
    const { completeMfaReenrollment } = await import('../user');
    const next = vi.fn();
    const req = { user: { appuserKey: 7 } } as unknown as Request;

    await completeMfaReenrollment(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'BadRequestError' }));
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
