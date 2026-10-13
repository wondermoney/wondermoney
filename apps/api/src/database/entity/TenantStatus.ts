import { Entity, EntityRepositoryType, PrimaryKey, Property, Unique } from '@mikro-orm/core';

import { TenantStatusRepository } from '../repositories/TenantStatus';

@Entity({ repository: () => TenantStatusRepository })
export class TenantStatus {
  @Property({ length: 50 })
  @Unique()
  description: string;

  [EntityRepositoryType]: TenantStatusRepository;

  @PrimaryKey()
  tenantStatusKey!: number;
}
