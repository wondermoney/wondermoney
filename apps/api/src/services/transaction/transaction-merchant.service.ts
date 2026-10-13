import { UniqueConstraintViolationException } from '@mikro-orm/core';

import { DI } from '@app/app';
import { Tenant } from '@entity/Tenant';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { BadRequestError, NotFoundError } from '@utils/errors';

import { normalizeMerchantName } from './merchant-normalization';

export interface ResolveTransactionMerchantInput {
  tenant: Tenant;
  transactionMerchantId?: null | number;
  transactionMerchantName?: null | string;
}

class TransactionMerchantService {
  async resolveMerchant(input: ResolveTransactionMerchantInput): Promise<TransactionMerchant> {
    if (input.transactionMerchantId != null) {
      const merchant = await DI.em.findOne(TransactionMerchant, {
        deletedAt: undefined,
        tenantKey: input.tenant,
        transactionMerchantKey: input.transactionMerchantId,
      });

      if (!merchant) throw new NotFoundError('TransactionMerchant not found');
      return merchant;
    }

    const name = input.transactionMerchantName?.trim();
    if (!name) {
      throw new BadRequestError('Either transactionMerchantId or transactionMerchantName must be provided');
    }

    const normalizedName = normalizeMerchantName(name);
    const existingMerchant = await DI.em.findOne(TransactionMerchant, {
      deletedAt: undefined,
      normalizedName,
      tenantKey: input.tenant,
    });

    if (existingMerchant) return existingMerchant;

    const merchant = new TransactionMerchant();
    merchant.name = name.trim().replace(/\s+/g, ' ');
    merchant.normalizedName = normalizedName;
    merchant.tenantKey = input.tenant;

    try {
      await DI.em.persist(merchant).flush();
      return merchant;
    } catch (error) {
      if (!(error instanceof UniqueConstraintViolationException)) throw error;

      const concurrentMerchant = await DI.em.findOne(TransactionMerchant, {
        deletedAt: undefined,
        normalizedName,
        tenantKey: input.tenant,
      });

      if (concurrentMerchant) return concurrentMerchant;
      throw error;
    }
  }
}

export const transactionMerchantService = new TransactionMerchantService();
