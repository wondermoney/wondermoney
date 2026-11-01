import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import service from '../transaction-deterministic-categorization.service';

type CategorizeInput = Parameters<typeof service.categorizeTransactionDeterministically>[0];

const appuser = { appuserKey: 1 } as unknown as CategorizeInput['appuser'];
const transaction = { description: 'Acme Store', descriptionDirty: 'Acme Store', tenantKey: 7 } as unknown as CategorizeInput['transaction'];
const category = { categoryKey: 10, isSystemCategory: true };

interface EmMock {
  find: <T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>) => Promise<T[]>;
  findOne: <T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>) => Promise<null | T>;
  flush: (() => Promise<void>) & ReturnType<typeof vi.fn>;
  persist: ((entity: unknown) => { flush: () => Promise<void> }) & ReturnType<typeof vi.fn>;
}

function em(
  overrides: Partial<{ categories: unknown[]; existing: unknown; mappings: unknown[]; merchants: unknown[]; merchantWhere: Record<string, unknown>; stats: unknown[]; statsWhere: Record<string, unknown>; }> = {},
): EmMock {
  const find = vi.fn((entityClass: { name?: string }, where: Record<string, unknown>) => {
    const name = entityClass.name;
    if (name === 'TransactionMerchant') {
      overrides.merchantWhere ??= {};
      overrides.merchantWhere = where;
      return Promise.resolve(overrides.merchants ?? []);
    }
    if (name === 'AppuserMerchantCategory') return Promise.resolve(overrides.mappings ?? []);
    if (name === 'TransactionCategoryStats') {
      overrides.statsWhere = where;
      return Promise.resolve(overrides.stats ?? []);
    }
    return Promise.resolve([]);
  }) as EmMock['find'] & ReturnType<typeof vi.fn>;

  const findOne = vi.fn((entityClass: { name?: string }, where: Record<string, unknown>) => {
    const name = entityClass.name;
    if (name === 'AppuserTransactionCategory') return Promise.resolve(overrides.existing ?? null);
    if (name === 'Category') {
      const categories = overrides.categories ?? [];
      const categoryKey = (where as { categoryKey?: number }).categoryKey;
      const match = categories.find((category) => (category as { categoryKey?: number }).categoryKey === categoryKey);
      return Promise.resolve(match ?? null);
    }
    return Promise.resolve(null);
  }) as EmMock['findOne'] & ReturnType<typeof vi.fn>;

  return {
    find,
    findOne,
    flush: vi.fn().mockResolvedValue(undefined),
    persist: vi.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'];
});

describe('transaction deterministic categorization service', () => {
  it('skips when disabled or already categorized or unsafe', async () => {
    // Categorization is on by default now; it only skips when EXPLICITLY disabled.
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'false';
    expect(await service.categorizeTransactionDeterministically({ appuser, transaction }, { em: em() })).toMatchObject({ reason: 'disabled' });
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'true';
    expect(await service.categorizeTransactionDeterministically({ appuser, transaction }, { em: em({ existing: {} }) })).toMatchObject({ reason: 'already_categorized' });
    expect(await service.categorizeTransactionDeterministically({ appuser, transaction: { description: 'MB WAY' } as unknown as CategorizeInput['transaction'] }, { em: em() })).toMatchObject({ reason: 'unsafe_text' });
  });

  it('assigns via exact merchant match and user mapping precedence', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'yes';
    const mapped = { categoryKey: category, source: 'user', transactionMerchantKey: { name: 'Acme Store' } };
    const emMock = em({ categories: [category], mappings: [mapped], merchants: [{ name: 'Acme Store' }] });
    const res = await service.categorizeTransactionDeterministically({ appuser, transaction }, { em: emMock });
    expect(res).toMatchObject({ assigned: true, reason: 'user_mapping', source: 'user_mapping' });
  });

  it('rejects invalid merchant mapping category', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'true';
    const invalidCategory = { appuserKey: { appuserKey: 2 }, categoryKey: 99, isSystemCategory: false };
    const res = await service.categorizeTransactionDeterministically({ appuser, transaction }, { em: em({ categories: [], mappings: [{ categoryKey: invalidCategory, source: 'user', transactionMerchantKey: { name: 'Acme Store' } }], merchants: [{ name: 'Acme Store' }] }) });
    expect(res).toMatchObject({ reason: 'category_invalid' });
  });

  it('falls back to stats default/top count and skips ties', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'on';
    expect(await service.categorizeTransactionDeterministically({ appuser, transaction }, { em: em({ categories: [category], merchants: [{ name: 'Acme Store' }], stats: [{ categoryKey: category, count: 1, default: true, source: 'user' }] }) })).toMatchObject({ reason: 'stats_default' });
    expect(await service.categorizeTransactionDeterministically({ appuser, transaction }, { em: em({ categories: [category], merchants: [{ name: 'Acme Store' }], stats: [{ categoryKey: category, count: 3, default: false, source: 'user' }, { categoryKey: { categoryKey: 11 }, count: 2, default: false, source: 'user' }] }) })).toMatchObject({ reason: 'stats_top_count' });
    expect(await service.categorizeTransactionDeterministically({ appuser, transaction }, { em: em({ categories: [category], merchants: [{ name: 'Acme Store' }], stats: [{ categoryKey: category, count: 2, default: false, source: 'user' }, { categoryKey: { categoryKey: 11 }, count: 2, default: false, source: 'user' }] }) })).toMatchObject({ reason: 'stats_tie' });
  });

  it('prefers a recent low-count stat over a stale high-count one (recency weighting)', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'true';
    const nowMs = Date.now();
    const recentCat = { categoryKey: 10, isSystemCategory: true };
    const staleCat = { categoryKey: 11, isSystemCategory: true };
    const stats = [
      { categoryKey: staleCat, count: 10, default: false, source: 'user', updatedAt: new Date(nowMs - 365 * 24 * 60 * 60 * 1000) },
      { categoryKey: recentCat, count: 3, default: false, source: 'user', updatedAt: new Date(nowMs) },
    ];
    const res = await service.categorizeTransactionDeterministically(
      { appuser, transaction },
      { em: em({ categories: [recentCat, staleCat], merchants: [{ name: 'Acme Store' }], stats }) },
    );
    expect(res).toMatchObject({ assigned: true, reason: 'stats_top_count' });
    expect(res.category).toMatchObject({ categoryKey: 10 });
  });

  it('rejects stats category owned by another user', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'true';
    const res = await service.categorizeTransactionDeterministically({ appuser, transaction }, { em: em({ categories: [], merchants: [{ name: 'Acme Store' }], stats: [{ categoryKey: { appuserKey: { appuserKey: 2 }, categoryKey: 77, isSystemCategory: false }, count: 2, default: true, source: 'user' }] }) });
    expect(res).toMatchObject({ reason: 'category_invalid' });
  });

  it('does not assign stats without merchant match', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'true';
    const res = await service.categorizeTransactionDeterministically({ appuser, transaction }, { em: em({ stats: [{ categoryKey: category, count: 1, default: true, source: 'user' }] }) });
    expect(res).toMatchObject({ reason: 'merchant_no_mapping' });
  });

  it('skips merchant lookup without tenantKey', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'true';
    const res = await service.categorizeTransactionDeterministically({ appuser, transaction: { description: 'Acme Store', descriptionDirty: 'Acme Store' } as unknown as CategorizeInput['transaction'] }, { em: em({ merchants: [{ name: 'Acme Store' }] }) });
    expect(res).toMatchObject({ reason: 'merchant_no_mapping' });
  });

  it('scopes merchant lookup by tenantKey and soft delete', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'true';
    const emMock = em({ categories: [category], merchants: [{ name: 'Acme Store' }], merchantWhere: {} });
    await service.categorizeTransactionDeterministically({ appuser, transaction }, { em: emMock });
    expect(emMock.find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ deletedAt: undefined, tenantKey: transaction.tenantKey }));
  });

  it('scopes the stats fallback to the requesting user (no cross-member contamination)', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'true';
    const overrides = { categories: [category], merchants: [{ name: 'Acme Store' }], stats: [{ categoryKey: category, count: 1, default: true, source: 'user' }] };
    await service.categorizeTransactionDeterministically({ appuser, transaction }, { em: em(overrides) });
    expect(overrides).toHaveProperty('statsWhere');
    expect((overrides as { statsWhere?: Record<string, unknown> }).statsWhere).toMatchObject({ appuserKey: appuser, source: 'user' });
  });

  it('rejects invalid categories and duplicate assignments without stats/merchant writes', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'true';
    const emMock = em({ categories: [], mappings: [{ categoryKey: { appuserKey: { appuserKey: 2 }, categoryKey: 20, isSystemCategory: false }, source: 'user', transactionMerchantKey: { name: 'Acme Store' } }], merchants: [{ name: 'Acme Store' }] });
    await expect(service.categorizeTransactionDeterministically({ appuser, transaction }, { em: emMock })).resolves.toMatchObject({ reason: 'category_invalid' });
    expect(emMock.persist).not.toHaveBeenCalled();
    const emDup = em({ categories: [category], mappings: [{ categoryKey: category, source: 'user', transactionMerchantKey: { name: 'Acme Store' } }], merchants: [{ name: 'Acme Store' }] });
    emDup.flush.mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('dup')));
    await expect(service.categorizeTransactionDeterministically({ appuser, transaction }, { em: emDup })).resolves.toMatchObject({ reason: 'duplicate-assignment' });
  });

  it('treats duplicate assignments on same transaction as duplicate', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'true';
    const emDup = em({ categories: [category], mappings: [{ categoryKey: category, source: 'user', transactionMerchantKey: { name: 'Acme Store' } }], merchants: [{ name: 'Acme Store' }] });
    emDup.flush.mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('dup')));
    await expect(service.categorizeTransactionDeterministically({ appuser, transaction }, { em: emDup })).resolves.toMatchObject({ reason: 'duplicate-assignment' });
  });

  it('drops the user_mapping signal when a merchant has two active mappings (last-wins invariant guard)', async () => {
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'yes';
    const catA = { categoryKey: 10, isSystemCategory: true };
    const catB = { categoryKey: 11, isSystemCategory: true };
    const mappings = [
      { categoryKey: catA, source: 'user', transactionMerchantKey: { name: 'Acme Store' } },
      { categoryKey: catB, source: 'user', transactionMerchantKey: { name: 'Acme Store' } },
    ];
    const emMock = em({ categories: [catA, catB], mappings, merchants: [{ name: 'Acme Store' }], stats: [] });
    const res = await service.categorizeTransactionDeterministically(
      { appuser, transaction },
      { em: emMock },
    );
    expect(res).toMatchObject({ assigned: false, reason: 'category_invalid' });
  });
});
