import { beforeEach, describe, expect, it, vi } from 'vitest';


const mocked = vi.hoisted(() => ({
  authedContext: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  findOneOrFail: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  persist: vi.fn().mockReturnThis(),
}));

vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema, req: unknown) => Promise.resolve(req)),
}));

vi.mock('@app/app', () => ({
  DI: {
    em: {
      find: mocked.find,
      findOne: mocked.findOne,
      findOneOrFail: mocked.findOneOrFail,
      flush: mocked.flush,
      persist: mocked.persist,
    },
  },
}));

vi.mock('@middleware/authed-context', () => ({
  authedContext: mocked.authedContext,
}));

vi.mock('@utils/errors', () => {
  class BadRequestError extends Error {
    status = 400;
  }

  class NotFoundError extends Error {
    status = 404;
  }

  return { BadRequestError, NotFoundError };
});

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import {
  updateBudgetAccounts,
  updateBudgetTemplateAccounts,
} from '../budget';

describe('budget account assignments', () => {
  const tenant = { tenantKey: 17 };
  const user = { appuserKey: 42 };
  const budget = { budgetKey: 7 };

  beforeEach(() => {
    mocked.find.mockReset();
    mocked.findOne.mockReset();
    mocked.findOneOrFail.mockReset();
    mocked.flush.mockReset().mockResolvedValue(undefined);
    mocked.persist.mockReset();
    mocked.persist.mockReturnThis();
    mocked.authedContext.mockReset().mockReturnValue({ appuserKey: user.appuserKey, tenant, tenantKey: tenant.tenantKey, user });
  });

  it('rejects a foreign-tenant account without revealing its ownership', async () => {
    mocked.find.mockResolvedValueOnce([]);
    const next = vi.fn();

    await updateBudgetAccounts(
      Object.assign(mockReq({ body: { accountKeys: [91] } }), { params: { budgetKey: 7 } }),
      mockRes(),
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "One or more accounts don't exist or you don't own them" }));
    expect(mocked.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $or: [{ isPrivate: false }, { accountOwnerAppuserKey: 42 }, { shares: { $some: { appuserKey: 42 } } }],
        accountKey: { $in: [91] },
        closed: false,
        deletedAt: undefined,
        tenantKey: { tenantKey: 17 },
      }),
    );
    expect(mocked.findOne).not.toHaveBeenCalled();
  });

  it('rejects a partner-private account for template assignments', async () => {
    mocked.find.mockResolvedValueOnce([]);
    const next = vi.fn();

    await updateBudgetTemplateAccounts(
      Object.assign(mockReq({ body: { accountKeys: [92] } }), { params: { budgetKey: 7, budgetTemplateCategoryKey: 8 } }),
      mockRes(),
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
    expect(mocked.findOne).not.toHaveBeenCalled();
  });

  it('assigns visible shared and viewer-owned private accounts to every budget template', async () => {
    const shared = { accountKey: 11 };
    const ownPrivate = { accountKey: 12 };
    const template = {
      accounts: {
        add: vi.fn(),
        getItems: () => [],
        remove: vi.fn(),
      },
    };
    mocked.find.mockResolvedValueOnce([shared, ownPrivate]).mockResolvedValueOnce([template]);
    mocked.findOne.mockResolvedValueOnce(budget);
    const sendStatus = vi.fn();
    const res = mockRes({ sendStatus });

    await updateBudgetAccounts(
      Object.assign(mockReq({ body: { accountKeys: [11, 12] } }), { params: { budgetKey: 7 } }),
      res,
      vi.fn(),
    );

    expect(template.accounts.add).toHaveBeenCalledWith([shared, ownPrivate]);
    expect(sendStatus).toHaveBeenCalledWith(200);
  });

  it('keeps the existing request-count behavior for duplicate account keys', async () => {
    mocked.find.mockResolvedValueOnce([{ accountKey: 11 }]);
    const next = vi.fn();

    await updateBudgetAccounts(
      Object.assign(mockReq({ body: { accountKeys: [11, 11] } }), { params: { budgetKey: 7 } }),
      mockRes(),
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
    expect(mocked.findOne).not.toHaveBeenCalled();
  });

  it('applies the same visibility checks to a single template assignment', async () => {
    const account = { accountKey: 11 };
    const template = {
      accounts: {
        add: vi.fn(),
        getItems: () => [],
        remove: vi.fn(),
      },
    };
    mocked.find.mockResolvedValueOnce([account]);
    mocked.findOne.mockResolvedValueOnce(budget).mockResolvedValueOnce(template);
    const sendStatus = vi.fn();
    const res = mockRes({ sendStatus });

    await updateBudgetTemplateAccounts(
      Object.assign(mockReq({ body: { accountKeys: [11] } }), { params: { budgetKey: 7, budgetTemplateCategoryKey: 8 } }),
      res,
      vi.fn(),
    );

    expect(template.accounts.add).toHaveBeenCalledWith([account]);
    expect(sendStatus).toHaveBeenCalledWith(200);
  });
});
