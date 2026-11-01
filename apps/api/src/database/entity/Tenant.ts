import { EntityRepositoryType } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TenantRepository } from '../repositories/TenantRepository';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { TenantStatus } from './TenantStatus';

export enum TenantType {
  DEMO = 'demo',
  REGULAR = 'regular',
}

@Entity({ repository: () => TenantRepository })
export class Tenant extends Base {
  [EntityRepositoryType]: TenantRepository;

  @Property({ length: 255, nullable: true })
  name?: string;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'owner_appuser_key' })
  ownerAppuserKey: Rel<Appuser>;

  @Property()
  recordActive = true;

  @Property({ columnType: 'timestamptz', nullable: true })
  recurringDetectionLastRunAt?: Date;

  @PrimaryKey()
  tenantKey!: number;

  @Enum(() => TenantType)
  tenantType: TenantType = TenantType.REGULAR;

  @ManyToOne({ cascade: [], entity: () => TenantStatus, fieldName: 'tenant_status_key' })
  tentantStatusKey: Rel<TenantStatus>;
}
