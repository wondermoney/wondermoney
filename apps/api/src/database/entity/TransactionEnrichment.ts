import { Entity, Enum, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Base } from './BaseEntity';
import { Category } from './Category';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

export enum TransactionEnrichmentStatus {
  COMPLETED = 'completed',
  DLQ = 'dlq',
  FAILED = 'failed',
  PENDING = 'pending',
  SHADOW = 'shadow',
  SKIPPED = 'skipped',
}

// RAD-425 Slice 2: whether the user's eventual category choice matched the model's suggestion
// (`categorySuggestionKey`), stamped once by the closed-loop hook when the user categorizes the
// transaction. Undefined until then (or forever, if the transaction is never categorized).
export enum TransactionEnrichmentOutcome {
  ACCEPTED = 'accepted',
  OVERRIDDEN = 'overridden',
}

@Entity({ tableName: 'transaction_enrichment' })
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['transactionKey', 'status'] })
@Index({ properties: ['tenantKey', 'status'] })
export class TransactionEnrichment extends Base {
  @Property({ default: 0 })
  attemptCount = 0;

  @ManyToOne({ cascade: [], entity: () => Category, fieldName: 'category_suggestion_key', nullable: true })
  categorySuggestionKey?: Rel<Category>;

  @Property({ columnType: 'timestamptz', nullable: true })
  completedAt?: Date;

  @Property({ default: 0 })
  completionTokens = 0;

  @Property({ columnType: 'numeric(6, 5)', nullable: true })
  confidence?: number;

  @Property({ length: 1024, nullable: true })
  dlqReason?: string;

  @Property({ length: 1024, nullable: true })
  eligibilityReason?: string;

  @Property({ length: 255, nullable: true })
  errorCode?: string;

  @Property({ columnType: 'numeric(18, 8)', nullable: true })
  estimatedCostUsd?: number;

  @Property({ length: 255 })
  idempotencyKey!: string;

  @Property({ length: 64 })
  inputHash!: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastAttemptAt?: Date;

  @Property({ length: 255, nullable: true })
  merchantSuggestion?: string;

  @Property({ length: 255 })
  modelVersion!: string;

  @Enum({ items: () => TransactionEnrichmentOutcome, nullable: true })
  outcome?: TransactionEnrichmentOutcome;

  @Property({ default: 0 })
  promptTokens = 0;

  @Property({ length: 255 })
  promptVersion!: string;

  @Property({ length: 255, nullable: true })
  reasonCode?: string;

  @Enum(() => TransactionEnrichmentStatus)
  status: TransactionEnrichmentStatus = TransactionEnrichmentStatus.PENDING;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;

  @Property({ default: 0 })
  totalTokens = 0;

  @PrimaryKey()
  transactionEnrichmentKey!: number;

  @ManyToOne({ cascade: [], entity: () => Transaction, fieldName: 'transaction_key' })
  transactionKey!: Rel<Transaction>;
}
