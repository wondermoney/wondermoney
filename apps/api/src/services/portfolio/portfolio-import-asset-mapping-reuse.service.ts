import type { EntityManager } from '@mikro-orm/core';

import { DI } from '@app/database/di';
import type { FinancialAsset } from '@entity/FinancialAsset';
import type { FinancialBroker } from '@entity/FinancialBroker';
import { PortfolioImportAssetMapping } from '@entity/PortfolioImportAssetMapping';
import type { Tenant } from '@entity/Tenant';
import { ConflictError } from '@utils/errors';

import type { PortfolioImportAssetIdentity } from './portfolio-import-asset-resolution.utils';

interface MappingScopeInput {
  financialBroker?: FinancialBroker;
  identity: PortfolioImportAssetIdentity;
  identityHash: string;
  tenant: Tenant;
}

interface PortfolioImportAssetMappingInsertRow {
  brokerAssetName?: string;
  brokerExchange?: string;
  brokerTicker?: string;
  currency?: string;
  financialAssetKey: number;
  financialBrokerKey?: number;
  identityHash: string;
  isin?: string;
  tenantKey: number;
}

interface SaveMappingInput extends MappingScopeInput {
  financialAsset: FinancialAsset;
}

class PortfolioImportAssetMappingReuseService {
  async findReusableAsset(input: MappingScopeInput, em: EntityManager = DI.em): Promise<FinancialAsset | undefined> {
    if (!input.financialBroker) return undefined;

    const mapping = await em.findOne(
      PortfolioImportAssetMapping,
      {
        deletedAt: undefined,
        financialBrokerKey: input.financialBroker,
        identityHash: input.identityHash,
        tenantKey: input.tenant,
      },
      { populate: ['financialAssetKey'] },
    );

    const asset = mapping?.financialAssetKey;
    if (!asset || asset.deletedAt || !asset.isActivelyTrading) return undefined;
    return asset;
  }

  async saveReusableMapping(input: SaveMappingInput, em: EntityManager = DI.em): Promise<PortfolioImportAssetMapping | undefined> {
    if (!input.financialBroker) return undefined;

    const criteria = {
      deletedAt: undefined,
      financialBrokerKey: input.financialBroker,
      identityHash: input.identityHash,
      tenantKey: input.tenant,
    };

    const existing = await this.findReusableMapping(criteria, em);

    if (existing) {
      const existingAssetKey = existing.financialAssetKey.financialAssetKey;
      if (existingAssetKey !== input.financialAsset.financialAssetKey) {
        throw new ConflictError('Reusable asset mapping already points to a different asset');
      }
      return existing;
    }

    const insertRow: PortfolioImportAssetMappingInsertRow = {
      brokerAssetName: input.identity.brokerAssetName,
      brokerExchange: input.identity.brokerExchange,
      brokerTicker: input.identity.brokerTicker,
      currency: input.identity.currency,
      financialAssetKey: input.financialAsset.financialAssetKey,
      financialBrokerKey: input.financialBroker.financialBrokerKey,
      identityHash: input.identityHash,
      isin: input.identity.isin,
      tenantKey: input.tenant.tenantKey,
    };

    // Use ON CONFLICT DO NOTHING + re-query so we stay transaction-safe and avoid unique-violation aborts.
    const sql = `insert into "portfolio_import_asset_mapping" (
      "broker_asset_name",
      "broker_exchange",
      "broker_ticker",
      "currency",
      "financial_asset_key",
      "financial_broker_key",
      "identity_hash",
      "isin",
      "tenant_key",
      "created_at",
      "updated_at"
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now()) on conflict do nothing`;

    await em.getConnection().execute(sql, [
      insertRow.brokerAssetName,
      insertRow.brokerExchange,
      insertRow.brokerTicker,
      insertRow.currency,
      insertRow.financialAssetKey,
      insertRow.financialBrokerKey,
      insertRow.identityHash,
      insertRow.isin,
      insertRow.tenantKey,
    ], 'run', em.getTransactionContext());

    const concurrent = await this.findReusableMapping(criteria, em);
    if (!concurrent) throw new ConflictError('Reusable asset mapping insert did not persist');

    const concurrentAssetKey = concurrent.financialAssetKey.financialAssetKey;
    if (concurrentAssetKey !== input.financialAsset.financialAssetKey) {
      throw new ConflictError('Reusable asset mapping already points to a different asset');
    }

    return concurrent;
  }

  private findReusableMapping(criteria: { deletedAt: undefined; financialBrokerKey: FinancialBroker; identityHash: string; tenantKey: Tenant }, em: EntityManager) {
    return em.findOne(PortfolioImportAssetMapping, criteria, { populate: ['financialAssetKey'] });
  }
}

export default new PortfolioImportAssetMappingReuseService();
