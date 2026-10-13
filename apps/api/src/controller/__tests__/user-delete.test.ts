import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteWonderMoneyAccount: vi.fn(),
}));

vi.mock('@service/account/account-deletion.service', () => ({
  deleteWonderMoneyAccount: mocks.deleteWonderMoneyAccount,
}));

vi.mock('@service/subscription-dto', () => ({
  toSubscriptionDto: vi.fn(),
}));

vi.mock('../../app', () => ({
  DI: { em: {} },
}));

describe('deleteCurrentUserAccount', () => {
  it('deletes the current user account and returns no content', async () => {
    const { deleteCurrentUserAccount } = await import('../user');
    const sendStatus = vi.fn();
    const res = { sendStatus } as unknown as Response;
    const user = { appuserKey: 123 } as unknown as Request['user'];
    const req = { user } as unknown as Request;

    await deleteCurrentUserAccount(req, res);

    expect(mocks.deleteWonderMoneyAccount).toHaveBeenCalledWith(user);
    expect(sendStatus).toHaveBeenCalledWith(204);
  });
});
