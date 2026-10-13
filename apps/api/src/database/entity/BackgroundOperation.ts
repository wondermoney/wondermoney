import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

export enum BackgroundOperationStatus {
  FAILED = 'failed',
  NEEDS_ACTION = 'needs_action',
  PARTIAL = 'partial',
  QUEUED = 'queued',
  RUNNING = 'running',
  STALE = 'stale',
  SUCCEEDED = 'succeeded',
}

export const BACKGROUND_OPERATION_QUEUE_PROVIDER = 'pg-boss' as const;

@Entity({ tableName: 'background_operation' })
@Index({ name: 'background_operation_tenant_status_updated_idx', properties: ['tenantKey', 'status', 'updatedAt'] })
@Index({ name: 'background_operation_type_resource_idx', properties: ['operationType', 'resourceId'] })
@Unique({ name: 'background_operation_correlation_id_unique', properties: ['correlationId'] })
export class BackgroundOperation extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: true })
  appuserKey?: Rel<Appuser>;

  @Property()
  attemptCount!: number;

  @PrimaryKey()
  backgroundOperationKey!: number;

  @Property({ length: 255 })
  correlationId!: string;

  @Property({ length: 100, nullable: true })
  errorCode?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  finishedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastHeartbeatAt?: Date;

  @Property({ length: 100 })
  operationType!: string;

  @Property({ columnType: 'jsonb', nullable: true })
  progress?: Record<string, unknown>;

  @Property({ columnType: 'timestamptz', nullable: true })
  queuedAt?: Date;

  @Property({ length: 255, nullable: true })
  queueJobId?: null | string;

  @Property({ length: 50 })
  queueProvider!: string;

  @Property({ length: 255 })
  resourceId!: string;

  @Property()
  retryable!: boolean;

  @Property({ length: 100, nullable: true })
  stage?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  startedAt?: Date;

  @Enum(() => BackgroundOperationStatus)
  status!: BackgroundOperationStatus;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;
}
