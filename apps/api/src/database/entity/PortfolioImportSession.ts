import { Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { FinancialBroker } from './FinancialBroker';
import { Portfolio } from './Portfolio';
import { PortfolioImportRow } from './PortfolioImportRow';
import { Tenant } from './Tenant';

export enum PortfolioImportSessionStatus {
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  FAILED = 'failed',
  IMPORTING = 'importing',
  NEEDS_ASSET_REVIEW = 'needs_asset_review',
  NEEDS_COLUMN_MAPPING = 'needs_column_mapping',
  PARSING = 'parsing',
  PARTIAL = 'partial',
  READY_TO_IMPORT = 'ready_to_import',
  SUCCEEDED = 'succeeded',
  UPLOADED = 'uploaded',
  WAITING_FOR_UPLOAD = 'waiting_for_upload',
}

@Entity({ tableName: 'portfolio_import_session' })
@Index({ name: 'portfolio_import_session_owner_status_idx', properties: ['tenantKey', 'appuserKey', 'portfolioKey', 'status'] })
@Index({ name: 'portfolio_import_session_portfolio_created_idx', properties: ['portfolioKey', 'createdAt'] })
@Index({ name: 'portfolio_import_session_status_updated_idx', properties: ['status', 'updatedAt'] })
@Unique({ name: 'portfolio_import_session_correlation_id_unique', properties: ['correlationId'] })
export class PortfolioImportSession extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @Property({ columnType: 'jsonb', nullable: true })
  columnMappingJson?: Record<string, unknown>;

  @Property({ length: 255 })
  correlationId!: string;

  @Property({ columnType: 'timestamptz', fieldName: 'expired_at', nullable: true })
  expiredAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  expiresAt?: Date;

  @ManyToOne({ cascade: [], entity: () => FinancialBroker, fieldName: 'financial_broker_key', nullable: true })
  financialBrokerKey?: Rel<FinancialBroker>;

  @Property({ length: 255, nullable: true })
  objectEtag?: string;

  @PrimaryKey()
  portfolioImportSessionKey!: number;

  @ManyToOne({ cascade: [], entity: () => Portfolio, fieldName: 'portfolio_key' })
  portfolioKey!: Rel<Portfolio>;

  @OneToMany({ cascade: [], entity: () => PortfolioImportRow, mappedBy: 'portfolioImportSessionKey' })
  rows = new Collection<PortfolioImportRow>(this);

  @Property({ fieldName: 's3_bucket', length: 255 })
  s3Bucket!: string;

  @Property({ fieldName: 's3_key', length: 1024 })
  s3Key!: string;

  @Enum(() => PortfolioImportSessionStatus)
  status: PortfolioImportSessionStatus = PortfolioImportSessionStatus.WAITING_FOR_UPLOAD;

  @Property({ columnType: 'jsonb', nullable: true })
  summaryJson?: Record<string, unknown>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
