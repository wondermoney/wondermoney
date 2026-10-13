import { Entity, EntityRepositoryType, Enum, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { AppuserTenantRepository } from '../repositories/AppuserTenantRepository';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * Household membership role (RAD-343). `owner` is the tenant creator and household anchor;
 * `member` is an invited partner. Defaults to `owner` because, historically, every
 * membership links a user to their *own* tenant. The invite flow (RAD-398/RAD-397)
 * sets `member` explicitly when provisioning a joining partner.
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
