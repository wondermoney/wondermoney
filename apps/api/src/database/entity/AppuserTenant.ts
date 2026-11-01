import { EntityRepositoryType } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { AppuserTenantRepository } from '../repositories/AppuserTenantRepository';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * Household membership role. `owner` is the tenant creator and household anchor;
 * `member` is an invited partner. Defaults to `owner` because a membership created
 * at signup links a user to their *own* tenant. The invite flow sets `member`
 * explicitly when provisioning a joining partner.
 */
export enum HouseholdRole {
  MEMBER = 'member',
  OWNER = 'owner',
}

@Entity({ repository: () => AppuserTenantRepository })
export class AppuserTenant extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey: Rel<Appuser>;

  @PrimaryKey()
  appuserTenantKey!: number;

  [EntityRepositoryType]: AppuserTenantRepository;

  @Property()
  recordActive = true;

  @Enum(() => HouseholdRole)
  role: HouseholdRole = HouseholdRole.OWNER;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey: Rel<Tenant>;
}
