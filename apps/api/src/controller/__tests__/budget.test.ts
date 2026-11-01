import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';
import { buildBudgetTransactionAccountVisibility } from '@service/budget/spending';
import { Recurrency } from '@utils/budget';

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

import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import {
  updateBudgetAccounts,
  updateBudgetCategory,
  updateBudgetTemplateAccounts,
} from '../budget';

describe('updateBudgetCategory', () => {
  beforeEach(() => {
    mocked.find.mockReset();
    mocked.findOne.mockReset();
    mocked.findOneOrFail.mockReset();
    mocked.flush.mockReset().mockResolvedValue(undefined);
    mocked.persist.mockReset();
    mocked.persist.mockReturnThis();
    mocked.authedContext.mockReset();
  });

  it('batch-loads following budget category months when applying updates forward', async () => {
    const budget = { appuserKey: 42, budgetKey: 7 };
    const templates = [10, 11, 12].map((month) => ({
      amountBudgeted: 75,
      budgetKey: { budgetKey: 7 },
      categoryKey: { categoryKey: 3 },
      month,
      recurrency: Recurrency.QUARTERLY,
      year: 2026,
    })) as unknown as BudgetTemplateCategory[];

    mocked.findOne.mockResolvedValueOnce(budget);
    mocked.find.mockResolvedValueOnce(templates);

    const next = vi.fn();
    const sendStatus = vi.fn();
    const res = mockRes({ sendStatus });

    await updateBudgetCategory(
      Object.assign(mockReq({ body: { amount: 125, applyToFollowingMonths: true, recurrency: Recurrency.MONTHLY } }), {
        params: { budgetKey: 7, categoryKey: 3, month: 10, year: 2026 },
      }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(sendStatus).toHaveBeenCalledWith(200);
    expect(mocked.find).toHaveBeenCalledTimes(1);
    expect(mocked.find).toHaveBeenCalledWith(
      BudgetTemplateCategory,
      expect.objectContaining({
        budgetKey: { budgetKey: 7 },
        categoryKey: { categoryKey: 3 },
        month: expect.objectContaining({ $gte: 10, $lte: 12 }),
        year: 2026,
      }),
    );
    expect(mocked.findOne).toHaveBeenCalledTimes(1);
    expect(mocked.persist).toHaveBeenCalledTimes(1);
    expect(mocked.persist).toHaveBeenCalledWith(templates);
    expect(templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amountBudgeted: 125, recurrency: Recurrency.MONTHLY }),
      ]),
    );
    expect(templates.every((template) => template.amountBudgeted === 125 && template.recurrency === Recurrency.MONTHLY)).toBe(
      true,
    );
  });

  it('returns a not found error when a future month template is missing', async () => {
    const budget = { appuserKey: 42, budgetKey: 7 };
    const templates = [
      {
        amountBudgeted: 75,
        budgetKey: { budgetKey: 7 },
        categoryKey: { categoryKey: 3 },
        month: 10,
        recurrency: Recurrency.QUARTERLY,
        year: 2026,
      },
      {
        amountBudgeted: 75,
        budgetKey: { budgetKey: 7 },
        categoryKey: { categoryKey: 3 },
        month: 12,
        recurrency: Recurrency.QUARTERLY,
        year: 2026,
      },
    ] as unknown as BudgetTemplateCategory[];

    mocked.findOne.mockResolvedValueOnce(budget);
    mocked.find.mockResolvedValueOnce(templates);

    const next = vi.fn();
    const sendStatus = vi.fn();
    const res = mockRes({ sendStatus });

    await updateBudgetCategory(
      Object.assign(mockReq({ body: { amount: 125, applyToFollowingMonths: true, recurrency: Recurrency.MONTHLY } }), {
        params: { budgetKey: 7, categoryKey: 3, month: 10, year: 2026 },
      }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ message: 'Budget template category for next months not found' }));
    expect(mocked.persist).not.toHaveBeenCalled();
    expect(sendStatus).not.toHaveBeenCalled();
  });
});

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
        $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey: 42 } }],
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

describe('budget transaction aggregation scope', () => {
  it('generates tenant, active-account, and private-owner visibility predicates', () => {
    const { db } = kyselyDouble();
    const compiled = db.selectFrom('transaction').selectAll().where(buildBudgetTransactionAccountVisibility(17, 42)).compile();

    expect(compiled.sql).toContain('budget_account.tenant_key = $1');
    expect(compiled.sql).toContain('budget_account.closed = false');
    expect(compiled.sql).toContain('budget_account.deleted_at IS NULL');
    expect(compiled.sql).toContain('(budget_account.is_private = false OR budget_account.account_owner_appuser_key = $2)');
    expect(compiled.parameters).toEqual([17, 42]);
  });
});
