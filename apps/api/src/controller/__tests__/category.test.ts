import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '@utils/errors';

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  flush: vi.fn(),
  getAppuserTenantByAppuser: vi.fn(),
  persist: vi.fn(),
  zParse: vi.fn(),
}));

vi.mock('@app/app', () => ({
  DI: {
    em: {
      findOne: mocks.findOne,
      getRepository: vi.fn(() => ({ getAppuserTenantByAppuser: mocks.getAppuserTenantByAppuser })),
      persist: mocks.persist,
    },
  },
}));
vi.mock('@validators/parser', () => ({ zParse: mocks.zParse }));

import { Category } from '@entity/Category';

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { createCategory, deleteCategory, updateCategory } from '../category';

const user = { appuserKey: 11 };
const tenant = { tenantKey: 7 };

describe('category controller tenant authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flush.mockResolvedValue(undefined);
    mocks.getAppuserTenantByAppuser.mockResolvedValue({ tenantKey: tenant });
    mocks.persist.mockReturnValue({ flush: mocks.flush });
  });

  it('rejects a foreign parent category without persisting', async () => {
    mocks.zParse.mockResolvedValueOnce({ body: { name: 'Child', parentCategoryKey: 22 } });
    mocks.findOne.mockResolvedValueOnce(null);
    const next = vi.fn();

    await createCategory(Object.assign(mockReq({ body: {} }), { user }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(mocks.findOne).toHaveBeenCalledWith(Category, {
      $or: [
        { isSystemCategory: true, tenantKey: null },
        { isSystemCategory: false, tenantKey: tenant },
      ],
      categoryKey: 22,
      deletedAt: undefined,
    });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('accepts same-tenant and global system parents', async () => {
    const sameTenantParent = { categoryKey: 22, isSystemCategory: false, tenantKey: tenant };
    const globalSystemParent = { categoryKey: 23, isSystemCategory: true, tenantKey: null };
    mocks.zParse
      .mockResolvedValueOnce({ body: { name: 'Child 1', parentCategoryKey: 22 } })
      .mockResolvedValueOnce({ body: { name: 'Child 2', parentCategoryKey: 23 } });
    mocks.findOne.mockResolvedValueOnce(sameTenantParent).mockResolvedValueOnce(globalSystemParent);
    const status = vi.fn(() => ({ json: vi.fn() }));

    await createCategory(Object.assign(mockReq({ body: {} }), { user }), mockRes({ status }), vi.fn());
    await createCategory(Object.assign(mockReq({ body: {} }), { user }), mockRes({ status }), vi.fn());

    expect(mocks.findOne).toHaveBeenNthCalledWith(1, Category, expect.objectContaining({ categoryKey: 22, deletedAt: undefined }));
    expect(mocks.findOne).toHaveBeenNthCalledWith(2, Category, expect.objectContaining({ categoryKey: 23, deletedAt: undefined }));
    expect(mocks.persist).toHaveBeenCalledTimes(2);
    expect(mocks.persist.mock.calls[0]?.[0].parentCategory).toBe(sameTenantParent);
    expect(mocks.persist.mock.calls[1]?.[0].parentCategory).toBe(globalSystemParent);
  });

  it.each([
    ['system', 31],
    ['foreign-tenant', 32],
    ['deleted', 33],
  ])('rejects %s categories for update and delete', async (_kind, categoryId) => {
    mocks.zParse
      .mockResolvedValueOnce({ body: { name: 'Updated' }, params: { categoryId } })
      .mockResolvedValueOnce({ params: { categoryId } });
    mocks.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const updateNext = vi.fn();
    const deleteNext = vi.fn();

    await updateCategory(Object.assign(mockReq({ body: {} }), { user }), mockRes(), updateNext);
    await deleteCategory(Object.assign(mockReq({ params: {} }), { user }), mockRes(), deleteNext);

    expect(updateNext).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(deleteNext).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(mocks.findOne).toHaveBeenNthCalledWith(1, Category, {
      categoryKey: categoryId,
      deletedAt: undefined,
      isSystemCategory: false,
      tenantKey: tenant,
    });
    expect(mocks.findOne).toHaveBeenNthCalledWith(2, Category, {
      categoryKey: categoryId,
      deletedAt: undefined,
      isSystemCategory: false,
      tenantKey: tenant,
    });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('updates and deletes a same-tenant category without restricting by appuser', async () => {
    const category = { bgColor: '#fff', categoryKey: 44, deletedAt: undefined, icon: 'x', isSystemCategory: false, name: 'Shared', tenantKey: tenant, textColor: '#000' };
    mocks.zParse
      .mockResolvedValueOnce({ body: { name: 'Renamed' }, params: { categoryId: 44 } })
      .mockResolvedValueOnce({ params: { categoryId: 44 } });
    mocks.findOne.mockResolvedValueOnce(category).mockResolvedValueOnce(category);
    const updateJson = vi.fn();
    const sendStatus = vi.fn();

    await updateCategory(Object.assign(mockReq({ body: {} }), { user }), mockRes({ json: updateJson }), vi.fn());
    await deleteCategory(Object.assign(mockReq({ params: {} }), { user }), mockRes({ sendStatus }), vi.fn());

    expect(mocks.findOne).toHaveBeenCalledTimes(2);
    expect(mocks.findOne.mock.calls[0]?.[1]).not.toHaveProperty('appuserKey');
    expect(mocks.findOne.mock.calls[1]?.[1]).not.toHaveProperty('appuserKey');
    expect(mocks.persist).toHaveBeenCalledTimes(2);
    expect(updateJson).toHaveBeenCalled();
    expect(sendStatus).toHaveBeenCalled();
  });

  it('returns Tenant not found when the authenticated user has no tenant link', async () => {
    mocks.getAppuserTenantByAppuser.mockResolvedValueOnce(undefined);
    mocks.zParse.mockResolvedValueOnce({ body: { name: 'Updated' }, params: { categoryId: 44 } });
    const next = vi.fn();

    await updateCategory(Object.assign(mockReq({ body: {} }), { user }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Tenant not found' }));
    expect(mocks.findOne).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
