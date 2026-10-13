import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Base } from './BaseEntity';
import { FinancialAsset } from './FinancialAsset';
import { FinancialBroker } from './FinancialBroker';
import { Tenant } from './Tenant';

@Entity({ tableName: 'portfolio_import_asset_mapping' })
@Index({ name: 'portfolio_import_asset_mapping_lookup_idx', properties: ['tenantKey', 'financialBrokerKey', 'identityHash'] })
@Index({
  expression:
    'CREATE UNIQUE INDEX portfolio_import_asset_mapping_active_unique ON portfolio_import_asset_mapping (tenant_key, financial_broker_key, identity_hash) WHERE deleted_at IS NULL AND financial_broker_key IS NOT NULL',
  name: 'portfolio_import_asset_mapping_active_unique',
})
export class PortfolioImportAssetMapping extends Base {
  @Property({ length: 255, nullable: true })
  brokerAssetName?: string;

  @Property({ length: 64, nullable: true })
  brokerExchange?: string;

  @Property({ length: 64, nullable: true })
  brokerTicker?: string;

  @Property({ length: 3, nullable: true })
  currency?: string;

  @ManyToOne({ cascade: [], entity: () => FinancialAsset, fieldName: 'financial_asset_key' })
  financialAssetKey!: Rel<FinancialAsset>;

  @ManyToOne({ cascade: [], entity: () => FinancialBroker, fieldName: 'financial_broker_key', nullable: true })
  financialBrokerKey?: Rel<FinancialBroker>;

  @Property({ length: 64 })
  identityHash!: string;

  @Property({ length: 32, nullable: true })
  isin?: string;

  @PrimaryKey()
  portfolioImportAssetMappingKey!: number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
