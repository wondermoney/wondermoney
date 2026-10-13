import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assignGoalMoneyRequestSchema,
  createGoalRequestSchema,
  fundGoalTransactionRequestSchema,
  goalAccountLinkRequestSchema,
  goalActivityQueryRequestSchema,
  goalParamsRequestSchema,
  listGoalsRequestSchema,
  moveGoalMoneyOutRequestSchema,
  undoGoalTransactionFundingRequestSchema,
  unlinkGoalAccountRequestSchema,
  updateGoalRequestSchema,
} from '@validators/goal';

import { mockRes } from '../../__tests__/__helpers__/mock-request';

const mocked = vi.hoisted(() => ({
  appuserTenantRepo: { getAppuserTenantByAppuser: vi.fn() },
  goalService: {
    archiveGoal: vi.fn(),
    assignMoneyToGoal: vi.fn(),
    createGoal: vi.fn(),
    fundTransactionFromGoal: vi.fn(),
    getAvailableToAssign: vi.fn(),
    getGoal: vi.fn(),
    getGoalActivity: vi.fn(),
    linkGoalAccount: vi.fn(),
    listGoals: vi.fn(),
    moveMoneyOutOfGoal: vi.fn(),
    restoreGoal: vi.fn(),
    undoTransactionFunding: vi.fn(),
    unlinkGoalAccount: vi.fn(),
    updateGoal: vi.fn(),
  },
  zParse: vi.fn(),
}));

vi.mock('@validators/parser', () => ({ zParse: mocked.zParse }));
vi.mock('@app/app', () => ({ DI: { em: { getReference: vi.fn(), getRepository: vi.fn(() => mocked.appuserTenantRepo) } } }));
vi.mock('@service/goal/goal.service', () => ({
  GoalService: vi.fn(function GoalService() {
    return mocked.goalService;
  }),
}));

import { archiveGoal, assignGoalMoney, createGoal, fundGoalTransaction, getAvailableToAssign, getGoal, getGoalActivity, linkGoalAccount, listGoals, moveGoalMoneyOut, restoreGoal, undoGoalTransactionFunding, unlinkGoalAccount, updateGoal } from '../goal';

describe('goal controller scenarios', () => {
  beforeEach(() => {
    mocked.zParse.mockReset();
    mocked.appuserTenantRepo.getAppuserTenantByAppuser.mockReset();
    Object.values(mocked.goalService).forEach((fn) => fn.mockReset());
  });

  it('creates a goal with tenant/appuser context', async () => {
    mocked.zParse.mockResolvedValueOnce({ body: { currencyId: 3, name: 'Trip', targetAmount: 1000 } });
    mocked.appuserTenantRepo.getAppuserTenantByAppuser.mockResolvedValueOnce({ tenantKey: { tenantKey: 22 } });
    mocked.goalService.createGoal.mockResolvedValueOnce({ goalKey: 1 });
    const res = mockRes();
    res.status = vi.fn().mockReturnValue(res);
    await createGoal({ user: { appuserKey: 11, currencyKey: { currencyKey: 3 } } } as Parameters<typeof createGoal>[0], res);

    expect(mocked.zParse).toHaveBeenCalledWith(createGoalRequestSchema, expect.anything());
    expect(mocked.goalService.createGoal).toHaveBeenCalledWith(expect.objectContaining({ appuserKey: 11, currencyKey: 3, tenantKey: 22 }));
    // vi.fn().mockReturnValue returns `this` but the method is declared with `this: MockedFunction`, which the
    // unbound-method rule flags. The mock is a test double; lint suppresses it via a narrow allowlist.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ goal: { goalKey: 1 } });
  });

  it('passes priority through on create and update', async () => {
    mocked.zParse
      .mockResolvedValueOnce({ body: { currencyId: 3, name: 'Trip', priority: 1, targetAmount: 1000 } })
      .mockResolvedValueOnce({ body: { currencyId: 2, name: 'New', priority: 2 }, params: { goalKey: 7 } });
    mocked.appuserTenantRepo.getAppuserTenantByAppuser.mockResolvedValue({ tenantKey: { tenantKey: 22 } });
    mocked.goalService.createGoal.mockResolvedValueOnce({ goalKey: 1 });
    mocked.goalService.updateGoal.mockResolvedValueOnce({ goalKey: 7 });

    const createRes = mockRes();
    createRes.status = vi.fn().mockReturnValue(createRes);
    await createGoal({ user: { appuserKey: 11, currencyKey: { currencyKey: 3 } } } as Parameters<typeof createGoal>[0], createRes);
    const updateRes = mockRes();
    await updateGoal({ user: { appuserKey: 11, currencyKey: { currencyKey: 2 } } } as Parameters<typeof updateGoal>[0], updateRes);

    expect(mocked.goalService.createGoal).toHaveBeenCalledWith(expect.objectContaining({ priority: 1 }));
    expect(mocked.goalService.updateGoal).toHaveBeenCalledWith(expect.objectContaining({ priority: 2 }));
  });

  it('routes goal list and detail actions through the service', async () => {
    mocked.zParse.mockResolvedValueOnce({ query: { includeArchived: false } }).mockResolvedValueOnce({ params: { goalKey: 1 } });
    mocked.appuserTenantRepo.getAppuserTenantByAppuser.mockResolvedValue({ tenantKey: { tenantKey: 22 } });
    mocked.goalService.listGoals.mockResolvedValueOnce([{ goalKey: 1 }]);
    mocked.goalService.getGoal.mockResolvedValueOnce({ goal: { goalKey: 1 } });

    await listGoals({ user: { appuserKey: 11, currencyKey: { currencyKey: 55 } } } as Parameters<typeof listGoals>[0], mockRes({ json: vi.fn() }));
    await getGoal({ user: { appuserKey: 11, currencyKey: { currencyKey: 55 } } } as Parameters<typeof getGoal>[0], mockRes({ json: vi.fn() }));

    expect(mocked.zParse).toHaveBeenNthCalledWith(1, listGoalsRequestSchema, expect.anything());
    expect(mocked.zParse).toHaveBeenNthCalledWith(2, goalParamsRequestSchema, expect.anything());
    expect(mocked.goalService.listGoals).toHaveBeenCalledWith({ appuserKey: 11, includeArchived: false, tenantKey: 22 });
    expect(mocked.goalService.getGoal).toHaveBeenCalledWith({ appuserKey: 11, goalKey: 1, tenantKey: 22 });
    expect(mocked.zParse).toHaveBeenCalledTimes(2);
  });

  it('rejects cross-currency goal creation and uses lazy service construction', async () => {
    mocked.zParse.mockResolvedValueOnce({ body: { currencyId: 99, name: 'Trip', targetAmount: 1000 } });
    mocked.appuserTenantRepo.getAppuserTenantByAppuser.mockResolvedValueOnce({ tenantKey: { tenantKey: 22 } });
    await expect(createGoal({ user: { appuserKey: 11, currencyKey: { currencyKey: 3 } } } as Parameters<typeof createGoal>[0], mockRes())).rejects.toThrow();
    expect(mocked.goalService.createGoal).not.toHaveBeenCalled();
  });

  it('updates, archives, assigns, moves, funds, and undoes through the service', async () => {
    mocked.zParse
      .mockResolvedValueOnce({ body: { currencyId: 2, name: 'New' }, params: { goalKey: 7 } })
      .mockResolvedValueOnce({ params: { goalKey: 7 } })
      .mockResolvedValueOnce({ body: { amount: 10 }, params: { goalKey: 7 } })
      .mockResolvedValueOnce({ body: { amount: 5 }, params: { goalKey: 7 } })
      .mockResolvedValueOnce({ body: { amount: 8, transactionKey: 99 }, params: { goalKey: 7 } })
      .mockResolvedValueOnce({ params: { fundingKey: 44, goalKey: 7 } });
    mocked.goalService.updateGoal.mockResolvedValueOnce({ goalKey: 7 });
    mocked.goalService.archiveGoal.mockResolvedValueOnce({ goalKey: 7 });
    mocked.goalService.assignMoneyToGoal.mockResolvedValueOnce({ assigned: true });
    mocked.goalService.moveMoneyOutOfGoal.mockResolvedValueOnce({ moved: true });
    mocked.goalService.fundTransactionFromGoal.mockResolvedValueOnce({ fundingKey: 44 });
    mocked.goalService.undoTransactionFunding.mockResolvedValueOnce({ fundingKey: 44 });

    mocked.appuserTenantRepo.getAppuserTenantByAppuser.mockResolvedValue({ tenantKey: { tenantKey: 22 } });
    await updateGoal({ user: { appuserKey: 11, currencyKey: { currencyKey: 2 } } } as Parameters<typeof updateGoal>[0], mockRes({ json: vi.fn() }));
    await archiveGoal({ user: { appuserKey: 11, currencyKey: { currencyKey: 2 } } } as Parameters<typeof archiveGoal>[0], mockRes({ json: vi.fn() }));
    await assignGoalMoney({ user: { appuserKey: 11, currencyKey: { currencyKey: 55 } } } as Parameters<typeof assignGoalMoney>[0], mockRes({ json: vi.fn() }));
    await moveGoalMoneyOut({ user: { appuserKey: 11, currencyKey: { currencyKey: 55 } } } as Parameters<typeof moveGoalMoneyOut>[0], mockRes({ json: vi.fn() }));
    await fundGoalTransaction({ user: { appuserKey: 11, currencyKey: { currencyKey: 55 } } } as Parameters<typeof fundGoalTransaction>[0], mockRes({ json: vi.fn() }));
    await undoGoalTransactionFunding({ user: { appuserKey: 11, currencyKey: { currencyKey: 55 } } } as Parameters<typeof undoGoalTransactionFunding>[0], mockRes({ json: vi.fn() }));

    expect(mocked.zParse).toHaveBeenNthCalledWith(1, updateGoalRequestSchema, expect.anything());
    expect(mocked.zParse).toHaveBeenNthCalledWith(2, goalParamsRequestSchema, expect.anything());
    expect(mocked.zParse).toHaveBeenNthCalledWith(3, assignGoalMoneyRequestSchema, expect.anything());
    expect(mocked.zParse).toHaveBeenNthCalledWith(4, moveGoalMoneyOutRequestSchema, expect.anything());
    expect(mocked.zParse).toHaveBeenNthCalledWith(5, fundGoalTransactionRequestSchema, expect.anything());
    expect(mocked.zParse).toHaveBeenNthCalledWith(6, undoGoalTransactionFundingRequestSchema, expect.anything());
    expect(mocked.goalService.updateGoal).toHaveBeenCalledWith(expect.objectContaining({ appuserKey: 11, currencyKey: 2, goalKey: 7, tenantKey: 22 }));
    expect(mocked.goalService.assignMoneyToGoal).toHaveBeenCalledWith(expect.objectContaining({ amount: 10, currencyKey: 55, goalKey: 7 }));
    expect(mocked.goalService.moveMoneyOutOfGoal).toHaveBeenCalledWith(expect.objectContaining({ amount: 5, currencyKey: 55, goalKey: 7 }));
    expect(mocked.goalService.fundTransactionFromGoal).toHaveBeenCalledWith(expect.objectContaining({ amount: 8, goalKey: 7, transactionKey: 99 }));
    expect(mocked.goalService.undoTransactionFunding).toHaveBeenCalledWith(expect.objectContaining({ goalKey: 7, goalTransactionFundingKey: 44 }));
  });

  it('restores an archived goal through the service', async () => {
    mocked.zParse.mockResolvedValueOnce({ params: { goalKey: 7 } });
    mocked.goalService.restoreGoal.mockResolvedValueOnce({ goalKey: 7, status: 'active' });

    mocked.appuserTenantRepo.getAppuserTenantByAppuser.mockResolvedValue({ tenantKey: { tenantKey: 22 } });
    const res = mockRes({ json: vi.fn() });
    await restoreGoal({ user: { appuserKey: 11, currencyKey: { currencyKey: 2 } } } as Parameters<typeof restoreGoal>[0], res);

    expect(mocked.zParse).toHaveBeenCalledWith(goalParamsRequestSchema, expect.anything());
    expect(mocked.goalService.restoreGoal).toHaveBeenCalledWith({ appuserKey: 11, goalKey: 7, tenantKey: 22 });
    expect(res.json).toHaveBeenCalledWith({ goal: { goalKey: 7, status: 'active' } });
  });

  it('links and unlinks goal accounts through the service', async () => {
    mocked.zParse.mockResolvedValueOnce({ body: { accountKey: 9 }, params: { goalKey: 1 } }).mockResolvedValueOnce({ params: { accountKey: 9, goalKey: 1 } });
    mocked.goalService.linkGoalAccount.mockResolvedValueOnce({ goalAccountLinkKey: 1 });
    mocked.goalService.unlinkGoalAccount.mockResolvedValueOnce(undefined);

    mocked.appuserTenantRepo.getAppuserTenantByAppuser.mockResolvedValue({ tenantKey: { tenantKey: 22 } });
    const res = mockRes();
    res.status = vi.fn().mockReturnValue(res);
    res.sendStatus = vi.fn().mockReturnValue(res);
    await linkGoalAccount({ user: { appuserKey: 11, currencyKey: { currencyKey: 2 } } } as Parameters<typeof linkGoalAccount>[0], res);
    await unlinkGoalAccount({ user: { appuserKey: 11, currencyKey: { currencyKey: 2 } } } as Parameters<typeof unlinkGoalAccount>[0], res);

    expect(mocked.zParse).toHaveBeenNthCalledWith(1, goalAccountLinkRequestSchema, expect.anything());
    expect(mocked.zParse).toHaveBeenNthCalledWith(2, unlinkGoalAccountRequestSchema, expect.anything());
    expect(mocked.goalService.linkGoalAccount).toHaveBeenCalledWith(expect.objectContaining({ accountKey: 9, appuserKey: 11, goalKey: 1, tenantKey: 22 }));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.status).toHaveBeenCalledWith(201);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.sendStatus).toHaveBeenCalledWith(204);
  });

  it('gets goal activity with pagination', async () => {
    mocked.zParse.mockResolvedValueOnce({ params: { goalKey: 1 }, query: { limit: 25, offset: 0 } });
    mocked.goalService.getGoalActivity.mockResolvedValueOnce({ activities: [] });

    mocked.appuserTenantRepo.getAppuserTenantByAppuser.mockResolvedValue({ tenantKey: { tenantKey: 22 } });
    const res = mockRes({ json: vi.fn() });
    await getGoalActivity({ user: { appuserKey: 11, currencyKey: { currencyKey: 2 } } } as Parameters<typeof getGoalActivity>[0], res);

    expect(mocked.zParse).toHaveBeenCalledWith(goalActivityQueryRequestSchema, expect.anything());
    expect(mocked.goalService.getGoalActivity).toHaveBeenCalledWith({ appuserKey: 11, goalKey: 1, limit: 25, offset: 0, tenantKey: 22 });
    expect(res.json).toHaveBeenCalledWith({ activities: [] });
  });

  it('gets available-to-assign for the current appuser/tenant', async () => {
    mocked.appuserTenantRepo.getAppuserTenantByAppuser.mockResolvedValueOnce({ tenantKey: { tenantKey: 22 } });
    mocked.goalService.getAvailableToAssign.mockResolvedValueOnce(350);

    const res = mockRes({ json: vi.fn() });
    await getAvailableToAssign({ user: { appuserKey: 11, currencyKey: { currencyKey: 2 } } } as Parameters<typeof getAvailableToAssign>[0], res);

    expect(mocked.goalService.getAvailableToAssign).toHaveBeenCalledWith({ appuserKey: 11, tenantKey: 22 });
    expect(res.json).toHaveBeenCalledWith({ availableToAssign: 350 });
  });
});
