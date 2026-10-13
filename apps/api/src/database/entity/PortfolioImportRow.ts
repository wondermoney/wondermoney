import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Base } from './BaseEntity';
import { FinancialAsset } from './FinancialAsset';
import { FinancialTransaction } from './FinancialTransaction';
import { PortfolioImportAssetGroup } from './PortfolioImportAssetGroup';
import { PortfolioImportSession } from './PortfolioImportSession';

export enum PortfolioImportRowStatus {
  DUPLICATE = 'duplicate',
  FAILED = 'failed',
  IMPORTED = 'imported',
  INVALID = 'invalid',
  NEEDS_ASSET_REVIEW = 'needs_asset_review',
  READY = 'ready',
  SKIPPED = 'skipped',
  VALID = 'valid',
}

@Entity({ tableName: 'portfolio_import_row' })
@Index({ name: 'portfolio_import_row_session_status_idx', properties: ['portfolioImportSessionKey', 'status'] })
@Index({ name: 'portfolio_import_row_internal_transaction_id_idx', properties: ['internalTransactionId'] })
@Unique({ name: 'portfolio_import_row_session_row_number_unique', properties: ['portfolioImportSessionKey', 'rowNumber'] })
export class PortfolioImportRow extends Base {
  @ManyToOne({ cascade: [], entity: () => PortfolioImportAssetGroup, fieldName: 'asset_group_key', nullable: true })
  assetGroupKey?: Rel<PortfolioImportAssetGroup>;

  @Property({ length: 255, nullable: true })
  failureReason?: string;

  @ManyToOne({ cascade: [], entity: () => FinancialAsset, fieldName: 'financial_asset_key', nullable: true })
  financialAssetKey?: Rel<FinancialAsset>;

  @ManyToOne({
    cascade: [],
    entity: () => FinancialTransaction,
    fieldName: 'imported_financial_transaction_key',
    nullable: true,
  })
  importedFinancialTransactionKey?: Rel<FinancialTransaction>;

  @Property({ length: 255, nullable: true })
  internalTransactionId?: string;

  @Property({ columnType: 'jsonb', nullable: true })
  normalizedJson?: Record<string, unknown>;

  @PrimaryKey()
  portfolioImportRowKey!: number;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => PortfolioImportSession, fieldName: 'portfolio_import_session_key' })
  portfolioImportSessionKey!: Rel<PortfolioImportSession>;

  @Property({ columnType: 'jsonb' })
  rawJson!: Record<string, unknown>;

  @Property()
  rowNumber!: number;

  @Property({ length: 255, nullable: true })
  skipReason?: string;

  @Enum(() => PortfolioImportRowStatus)
  status: PortfolioImportRowStatus = PortfolioImportRowStatus.VALID;
}
