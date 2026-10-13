import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Tenant } from '@entity/Tenant';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { BadRequestError } from '@utils/errors';

const em = {
  findOne: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  persist: vi.fn().mockReturnThis(),
};

vi.mock('@app/app', () => ({ DI: { em } }));

describe('TransactionMerchantService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    em.flush.mockResolvedValue(undefined);
    em.persist.mockReturnThis();
  });

  it('finds existing merchant by id within tenant only', async () => {
    const { transactionMerchantService } = await import('../transaction-merchant.service');
    const tenant = Object.assign(new Tenant(), { tenantKey: 22 });
    const merchant = Object.assign(new TransactionMerchant(), { name: 'Coffee Shop', transactionMerchantKey: 7 });
    em.findOne.mockResolvedValue(merchant);

    const result = await transactionMerchantService.resolveMerchant({ tenant, transactionMerchantId: 7 });

    expect(em.findOne).toHaveBeenCalledWith(TransactionMerchant, {
      deletedAt: undefined,
      tenantKey: tenant,
      transactionMerchantKey: 7,
    });
    expect(result).toBe(merchant);
  });

  it('throws when merchant id is not found in tenant', async () => {
    const { transactionMerchantService } = await import('../transaction-merchant.service');
    const tenant = Object.assign(new Tenant(), { tenantKey: 22 });
    em.findOne.mockResolvedValue(null);

    await expect(transactionMerchantService.resolveMerchant({ tenant, transactionMerchantId: 7 })).rejects.toThrow(
      'TransactionMerchant not found',
    );
  });

  it('looks up merchant id 0 instead of treating it as missing', async () => {
    const { transactionMerchantService } = await import('../transaction-merchant.service');
    const tenant = Object.assign(new Tenant(), { tenantKey: 22 });
    const merchant = Object.assign(new TransactionMerchant(), { name: 'Zero Merchant', transactionMerchantKey: 0 });
    em.findOne.mockResolvedValue(merchant);

    const result = await transactionMerchantService.resolveMerchant({ tenant, transactionMerchantId: 0 });

    expect(em.findOne).toHaveBeenCalledWith(TransactionMerchant, {
      deletedAt: undefined,
      tenantKey: tenant,
      transactionMerchantKey: 0,
    });
    expect(result).toBe(merchant);
  });

  it('reuses merchant by normalized name within tenant', async () => {
    const { transactionMerchantService } = await import('../transaction-merchant.service');
    const tenant = Object.assign(new Tenant(), { tenantKey: 22 });
    const merchant = Object.assign(new TransactionMerchant(), { name: 'Coffee Shop', transactionMerchantKey: 7 });
    em.findOne.mockResolvedValue(merchant);

    await transactionMerchantService.resolveMerchant({ tenant, transactionMerchantName: '  Coffee   Shop ' });

    expect(em.findOne).toHaveBeenCalledWith(TransactionMerchant, {
      deletedAt: undefined,
      normalizedName: 'coffee shop',
      tenantKey: tenant,
    });
  });

  it('creates new merchant with trimmed display name normalized name and tenant', async () => {
    const { transactionMerchantService } = await import('../transaction-merchant.service');
    const tenant = Object.assign(new Tenant(), { tenantKey: 22 });
    em.findOne.mockResolvedValue(null);
    em.persist.mockReturnThis();

    const result = await transactionMerchantService.resolveMerchant({ tenant, transactionMerchantName: '  Coffee   Shop ' });

    expect(em.persist).toHaveBeenCalledTimes(1);
    expect(em.persist.mock.calls[0]?.[0]).toMatchObject({
      name: 'Coffee Shop',
      normalizedName: 'coffee shop',
      tenantKey: tenant,
    });
    expect(result).toMatchObject({
      name: 'Coffee Shop',
      normalizedName: 'coffee shop',
      tenantKey: tenant,
    });
  });

  it('re-queries existing merchant when create races with unique constraint', async () => {
    const { transactionMerchantService } = await import('../transaction-merchant.service');
    const tenant = Object.assign(new Tenant(), { tenantKey: 22 });
    const merchant = Object.assign(new TransactionMerchant(), { name: 'Coffee Shop', transactionMerchantKey: 7 });
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(merchant);
    const uniqueViolation = Object.setPrototypeOf(new Error('duplicate key value violates unique constraint'),
      UniqueConstraintViolationException.prototype,
    );
    em.flush.mockRejectedValueOnce(uniqueViolation);

    const result = await transactionMerchantService.resolveMerchant({ tenant, transactionMerchantName: 'Coffee Shop' });

    expect(em.findOne).toHaveBeenNthCalledWith(1, TransactionMerchant, {
      deletedAt: undefined,
      normalizedName: 'coffee shop',
      tenantKey: tenant,
    });
    expect(em.findOne).toHaveBeenNthCalledWith(2, TransactionMerchant, {
      deletedAt: undefined,
      normalizedName: 'coffee shop',
      tenantKey: tenant,
    });
    expect(result).toBe(merchant);
  });

  it('normalizes accents when matching merchants', async () => {
    const { transactionMerchantService } = await import('../transaction-merchant.service');
    const tenant = Object.assign(new Tenant(), { tenantKey: 22 });
    const merchant = Object.assign(new TransactionMerchant(), { name: 'João Silva', transactionMerchantKey: 7 });
    em.findOne.mockResolvedValue(merchant);

    await transactionMerchantService.resolveMerchant({ tenant, transactionMerchantName: '  João   Silva ' });

    expect(em.findOne).toHaveBeenCalledWith(TransactionMerchant, {
      deletedAt: undefined,
      normalizedName: 'joao silva',
      tenantKey: tenant,
    });
  });

  it('throws when merchant input is missing', async () => {
    const { transactionMerchantService } = await import('../transaction-merchant.service');
    const tenant = Object.assign(new Tenant(), { tenantKey: 22 });

    await expect(transactionMerchantService.resolveMerchant({ tenant })).rejects.toBeInstanceOf(BadRequestError);
    await expect(transactionMerchantService.resolveMerchant({ tenant })).rejects.toThrow(
      'Either transactionMerchantId or transactionMerchantName must be provided',
    );
  });
});
