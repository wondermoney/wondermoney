import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { FinancialBroker } from './FinancialBroker';
import { Tenant } from './Tenant';

export enum PortfolioImportParserSpecScope {
  GLOBAL = 'global',
  TENANT = 'tenant',
  USER = 'user',
}

export enum PortfolioImportParserSpecSource {
  ADMIN = 'admin',
  LLM_CONFIRMED = 'llm_confirmed',
  USER_CONFIRMED = 'user_confirmed',
}

export enum PortfolioImportParserSpecStatus {
  ACTIVE = 'active',
  DEPRECATED = 'deprecated',
  QUARANTINED = 'quarantined',
}

@Entity({ tableName: 'portfolio_import_parser_spec' })
@Index({ name: 'portfolio_import_parser_spec_scope_idx', properties: ['scope', 'tenantKey', 'appuserKey'] })
@Index({ name: 'portfolio_import_parser_spec_status_header_set_idx', properties: ['status', 'headerSetHash'] })
@Index({ name: 'portfolio_import_parser_spec_status_shape_idx', properties: ['status', 'shapeHash'] })
@Index({ name: 'portfolio_import_parser_spec_broker_lookup_idx', properties: ['financialBrokerKey', 'scope', 'status', 'engineVersion', 'schemaVersion', 'shapeHash'] })
@Index({ expression: "CREATE UNIQUE INDEX portfolio_import_parser_spec_active_global_broker_shape_unique ON portfolio_import_parser_spec (financial_broker_key, engine_version, schema_version, shape_hash) WHERE deleted_at IS NULL AND status = 'active' AND scope = 'global' AND financial_broker_key IS NOT NULL", name: 'portfolio_import_parser_spec_active_global_broker_shape_unique' })
@Index({ expression: "CREATE UNIQUE INDEX portfolio_import_parser_spec_active_tenant_broker_shape_unique ON portfolio_import_parser_spec (tenant_key, financial_broker_key, engine_version, schema_version, shape_hash) WHERE deleted_at IS NULL AND status = 'active' AND scope = 'tenant' AND financial_broker_key IS NOT NULL", name: 'portfolio_import_parser_spec_active_tenant_broker_shape_unique' })
export class PortfolioImportParserSpec extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: true })
  appuserKey?: Rel<Appuser>;

  @Property({ length: 64, nullable: true })
  contentHash?: string;

  @Property({ length: 64 })
  engineVersion!: string;

  @Property({ default: 0 })
  failureCount = 0;

  @ManyToOne({ cascade: [], entity: () => FinancialBroker, fieldName: 'financial_broker_key', nullable: true })
  financialBrokerKey?: Rel<FinancialBroker>;

  @Property({ default: 'portfolio-csv-shape-v1', length: 64 })
  fingerprintAlgorithm = 'portfolio-csv-shape-v1';

  @Property({ length: 64 })
  headerOrderHash!: string;

  @Property({ length: 64 })
  headerSetHash!: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastFailedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastMatchedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastSucceededAt?: Date;

  @Property({ columnType: 'jsonb' })
  normalizedHeadersJson!: string[];

  @PrimaryKey()
  portfolioImportParserSpecKey!: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  promotedAt?: Date;

  @Property({ default: 1 })
  schemaVersion = 1;

  @Enum(() => PortfolioImportParserSpecScope)
  scope: PortfolioImportParserSpecScope = PortfolioImportParserSpecScope.GLOBAL;

  @Property({ length: 64 })
  shapeHash!: string;

  @Enum(() => PortfolioImportParserSpecSource)
  source: PortfolioImportParserSpecSource = PortfolioImportParserSpecSource.LLM_CONFIRMED;

  @Property({ columnType: 'jsonb' })
  specJson!: Record<string, unknown>;

  @Property({ default: 1 })
  specVersion = 1;

  @Enum(() => PortfolioImportParserSpecStatus)
  status: PortfolioImportParserSpecStatus = PortfolioImportParserSpecStatus.ACTIVE;

  @Property({ default: 0 })
  successCount = 0;

  @ManyToOne({ cascade: [], entity: () => PortfolioImportParserSpec, fieldName: 'supersedes_spec_key', nullable: true })
  supersedesSpecKey?: Rel<PortfolioImportParserSpec>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;
}
