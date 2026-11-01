import { describe, expect, it, vi } from 'vitest';

import service from '@service/account/account-csv-categorization.service';

type CategorizeEm = Parameters<typeof service.categorizeTransaction>[0];
type CategorizeTransaction = Parameters<typeof service.categorizeTransaction>[2];

describe('account csv categorization service', () => {
  it('prefers merchant mapping over stats and uses deterministic source', async () => {
    const category = { categoryKey: 1 };
    const merchant = { name: 'Shop' };
    const em = {
      find: vi.fn().mockResolvedValue([{ categoryKey: category }]),
      findOne: vi.fn().mockImplementation((_entity, where) => Promise.resolve(where?.name === 'Shop' ? merchant : category)),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
    };
    const transaction = { descriptionDirty: 'Shop' } as unknown as CategorizeTransaction;

    await expect(service.categorizeTransaction(em as unknown as CategorizeEm, { appuserKey: 7 }, transaction)).resolves.toEqual({ assigned: true, reason: 'user_mapping' });
    expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({ source: 'deterministic' }));
  });

  it('falls back to top stats count', async () => {
    const category = { categoryKey: 2 };
    const merchant = { name: 'Cafe' };
    const em = {
      find: vi.fn().mockImplementation((entity) => Promise.resolve(entity.name === 'AppuserMerchantCategory' ? [] : [{ categoryKey: category, count: 2 }, { categoryKey: { categoryKey: 9 }, count: 1 }])),
      findOne: vi.fn().mockImplementation((_entity, where) => Promise.resolve(where?.name === 'Cafe' ? merchant : category)),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
    };

    await expect(service.categorizeTransaction(em as unknown as CategorizeEm, { appuserKey: 7 }, { descriptionDirty: 'Cafe' } as unknown as CategorizeTransaction)).resolves.toEqual({ assigned: true, reason: 'stats_top_count' });
  });

  it('scopes the stats fallback to the requesting user', async () => {
    const category = { categoryKey: 2 };
    const merchant = { name: 'Cafe' };
    const appuser = { appuserKey: 7 };
    const em = {
      find: vi.fn().mockImplementation((entity) => Promise.resolve(entity.name === 'AppuserMerchantCategory' ? [] : [{ categoryKey: category, count: 2 }])),
      findOne: vi.fn().mockImplementation((_entity, where) => Promise.resolve(where?.name === 'Cafe' ? merchant : category)),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
    };

    await service.categorizeTransaction(em, appuser, { descriptionDirty: 'Cafe' } as unknown as CategorizeTransaction);

    const statsCall = em.find.mock.calls.find((call) => (call[0] as { name?: string }).name === 'TransactionCategoryStats');
    expect(statsCall?.[1]).toMatchObject({ appuserKey: appuser });
  });

  it('prefers a recent low-count stat over a stale high-count one', async () => {
    const merchant = { name: 'Cafe' };
    const recent = { categoryKey: { categoryKey: 2 }, count: 3, updatedAt: new Date() };
    const stale = { categoryKey: { categoryKey: 1 }, count: 10, updatedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) };
    const em = {
      find: vi.fn().mockImplementation((entity) => Promise.resolve(entity.name === 'AppuserMerchantCategory' ? [] : [stale, recent])),
      findOne: vi.fn().mockImplementation((_entity, where) => Promise.resolve(where?.name === 'Cafe' ? merchant : { categoryKey: where?.categoryKey })),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
    };

    await expect(service.categorizeTransaction(em as unknown as CategorizeEm, { appuserKey: 7 }, { descriptionDirty: 'Cafe' } as unknown as CategorizeTransaction)).resolves.toEqual({ assigned: true, reason: 'stats_top_count' });
    expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({ categoryKey: { categoryKey: 2 } }));
  });

  it('returns merchant_no_mapping when no merchant name can be resolved', async () => {
    const em = {
      find: vi.fn(),
      findOne: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
    };

    await expect(service.categorizeTransaction(em as unknown as CategorizeEm, { appuserKey: 7 }, {} as unknown as CategorizeTransaction)).resolves.toEqual({ assigned: false, reason: 'merchant_no_mapping' });
    expect(em.find).not.toHaveBeenCalled();
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('returns merchant_no_mapping when the merchant cannot be found', async () => {
    const em = {
      find: vi.fn(),
      findOne: vi.fn().mockResolvedValue(null),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
    };
    const transaction = { descriptionDirty: 'Unknown' } as unknown as CategorizeTransaction;

    await expect(service.categorizeTransaction(em as unknown as CategorizeEm, { appuserKey: 7 }, transaction)).resolves.toEqual({ assigned: false, reason: 'merchant_no_mapping' });
    expect(em.find).not.toHaveBeenCalled();
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('returns category_invalid when mappings resolve to distinct/invalid categories', async () => {
    const merchant = { name: 'Multi' };
    const em = {
      find: vi.fn().mockResolvedValue([{ categoryKey: { categoryKey: 1 } }, { categoryKey: { categoryKey: 2 } }]),
      findOne: vi.fn().mockImplementation((_entity, where) => Promise.resolve(where?.name === 'Multi' ? merchant : { categoryKey: where?.categoryKey })),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
    };
    const transaction = { descriptionDirty: 'Multi' } as unknown as CategorizeTransaction;

    await expect(service.categorizeTransaction(em as unknown as CategorizeEm, { appuserKey: 7 }, transaction)).resolves.toEqual({ assigned: false, reason: 'category_invalid' });
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('returns merchant_no_mapping when there are no stats rows', async () => {
    const merchant = { name: 'NoStats' };
    const em = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockImplementation((_entity, where) => Promise.resolve(where?.name === 'NoStats' ? merchant : null)),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
    };
    const transaction = { descriptionDirty: 'NoStats' } as unknown as CategorizeTransaction;

    await expect(service.categorizeTransaction(em as unknown as CategorizeEm, { appuserKey: 7 }, transaction)).resolves.toEqual({ assigned: false, reason: 'merchant_no_mapping' });
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('returns stats_tie when top stats count is not unique', async () => {
    const merchant = { name: 'Tie' };
    const em = {
      find: vi.fn().mockImplementation((entity) => Promise.resolve(entity.name === 'AppuserMerchantCategory' ? [] : [{ categoryKey: { categoryKey: 1 }, count: 2 }, { categoryKey: { categoryKey: 2 }, count: 2 }])),
      findOne: vi.fn().mockImplementation((_entity, where) => Promise.resolve(where?.name === 'Tie' ? merchant : null)),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
    };
    const transaction = { descriptionDirty: 'Tie' } as unknown as CategorizeTransaction;

    await expect(service.categorizeTransaction(em as unknown as CategorizeEm, { appuserKey: 7 }, transaction)).resolves.toEqual({ assigned: false, reason: 'stats_tie' });
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('returns category_invalid when the unique top stat category cannot be resolved', async () => {
    const merchant = { name: 'Unresolved' };
    const em = {
      find: vi.fn().mockImplementation((entity) => Promise.resolve(entity.name === 'AppuserMerchantCategory' ? [] : [{ categoryKey: { categoryKey: 1 }, count: 3 }])),
      findOne: vi.fn().mockImplementation((_entity, where) => Promise.resolve(where?.name === 'Unresolved' ? merchant : null)),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
    };
    const transaction = { descriptionDirty: 'Unresolved' } as unknown as CategorizeTransaction;

    await expect(service.categorizeTransaction(em as unknown as CategorizeEm, { appuserKey: 7 }, transaction)).resolves.toEqual({ assigned: false, reason: 'category_invalid' });
    expect(em.persist).not.toHaveBeenCalled();
  });
});
