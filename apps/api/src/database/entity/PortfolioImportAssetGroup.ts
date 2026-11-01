import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { Base } from './BaseEntity';
import { FinancialAsset } from './FinancialAsset';
import { PortfolioImportSession } from './PortfolioImportSession';

export enum PortfolioImportAssetGroupSelectedAction {
  SKIP_GROUP = 'skip_group',
  USE_CANDIDATE = 'use_candidate',
  USE_EXISTING_ASSET = 'use_existing_asset',
}

export enum PortfolioImportAssetGroupStatus {
  AMBIGUOUS = 'ambiguous',
  MATCHED = 'matched',
  PROVIDER_ERROR = 'provider_error',
  SELECTED = 'selected',
  SKIPPED = 'skipped',
  UNMATCHED = 'unmatched',
}

@Entity({ tableName: 'portfolio_import_asset_group' })
@Index({ name: 'portfolio_import_asset_group_session_status_idx', properties: ['portfolioImportSessionKey', 'status'] })
@Index({
  expression:
    'CREATE UNIQUE INDEX portfolio_import_asset_group_session_identity_unique ON portfolio_import_asset_group (portfolio_import_session_key, identity_hash) WHERE deleted_at IS NULL',
  name: 'portfolio_import_asset_group_session_identity_unique',
})
export class PortfolioImportAssetGroup extends Base {
  @Property({ length: 255, nullable: true })
  brokerAssetName?: string;

  @Property({ length: 64, nullable: true })
  brokerExchange?: string;

  @Property({ length: 64, nullable: true })
  brokerTicker?: string;

  @Property({ length: 3, nullable: true })
  currency?: string;

  @Property({ length: 64 })
  identityHash!: string;

  @Property({ length: 32, nullable: true })
  isin?: string;

  @PrimaryKey()
  portfolioImportAssetGroupKey!: number;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => PortfolioImportSession, fieldName: 'portfolio_import_session_key' })
  portfolioImportSessionKey!: Rel<PortfolioImportSession>;

  @Property({ length: 255, nullable: true })
  resolutionReason?: string;

  @Enum({ items: () => PortfolioImportAssetGroupSelectedAction, nullable: true })
  selectedAction?: PortfolioImportAssetGroupSelectedAction;

  @ManyToOne({ cascade: [], entity: () => FinancialAsset, fieldName: 'selected_financial_asset_key', nullable: true })
  selectedFinancialAssetKey?: Rel<FinancialAsset>;

  @Enum(() => PortfolioImportAssetGroupStatus)
  status: PortfolioImportAssetGroupStatus = PortfolioImportAssetGroupStatus.UNMATCHED;
}
