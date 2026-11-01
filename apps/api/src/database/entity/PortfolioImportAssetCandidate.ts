import type { Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { Base } from './BaseEntity';
import { PortfolioImportAssetGroup } from './PortfolioImportAssetGroup';

@Entity({ tableName: 'portfolio_import_asset_candidate' })
@Index({ name: 'portfolio_import_asset_candidate_group_confidence_idx', properties: ['portfolioImportAssetGroupKey', 'confidence'] })
export class PortfolioImportAssetCandidate extends Base {
  @Property({ columnType: 'numeric', nullable: true })
  confidence?: number;

  @Property({ length: 32, nullable: true })
  currency?: string;

  @Property({ length: 64, nullable: true })
  exchange?: string;

  @Property({ default: false })
  hasPriceHistory = false;

  @Property({ length: 32, nullable: true })
  isin?: string;

  @Property({ length: 255, nullable: true })
  name?: string;

  @PrimaryKey()
  portfolioImportAssetCandidateKey!: number;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => PortfolioImportAssetGroup, fieldName: 'portfolio_import_asset_group_key' })
  portfolioImportAssetGroupKey!: Rel<PortfolioImportAssetGroup>;

  @Property({ columnType: 'jsonb', nullable: true })
  profileJson?: Record<string, unknown>;

  @Property({ length: 64 })
  provider!: string;

  @Property({ length: 255, nullable: true })
  rejectedReason?: string;

  @Property({ length: 64, nullable: true })
  symbol?: string;
}
