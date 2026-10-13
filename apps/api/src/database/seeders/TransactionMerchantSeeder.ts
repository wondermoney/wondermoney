import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { TransactionMerchant } from '@entity/TransactionMerchant';
import { Tenant } from '@entity/Tenant';
import { Seeder } from '@mikro-orm/seeder';

import { transactionTemplates } from '../utils/transactions';
import { normalizeMerchantName } from '@service/transaction/merchant-normalization';

const TENANTS_TO_SEED = ['ADMIN', 'DEMO'] as const;

export class TransactionMerchantSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const ctxTransactionMerchantEntities: TransactionMerchant[] = [];
    const uniqueMerchants = new Set([...transactionTemplates.map((template) => template.merchant)]);
    for (const tenantName of TENANTS_TO_SEED) {
      const tenant = (tenantName === 'ADMIN' ? ctx['_ADMIN_tenant'] : ctx['_DEMO_tenant']) as Tenant;
      for (const merchantName of uniqueMerchants) {
        const transactionMerchant = new TransactionMerchant();
        transactionMerchant.name = merchantName;
        transactionMerchant.normalizedName = normalizeMerchantName(merchantName);
        transactionMerchant.tenantKey = tenant;
        em.create(TransactionMerchant, transactionMerchant);
        ctxTransactionMerchantEntities.push(transactionMerchant);
      }
    }
    ctx['transactionMerchants'] = ctxTransactionMerchantEntities;
  }
}
