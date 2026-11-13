import { EntityRepositoryType } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { AppuserTenantRepository } from '../repositories/AppuserTenantRepository';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * Household membership role, highest first:
 *
 * - `owner`: the household anchor (`Tenant.ownerAppuserKey`); exactly one per household.
 * - `admin`: manages invites and the people below admin.
 * - `member`: reads and changes the household's shared data.
 * - `viewer`: reads the household's shared data only.
 *
 * What each role may do is decided in one place, `householdCan`
 * (`services/household/household-permissions.ts`). Defaults to `owner` because a membership
 * created at signup links a user to their *own* tenant; the invite flow sets the invite's role.
 */
export enum HouseholdRole {
  ADMIN = 'admin',
  MEMBER = 'member',
  OWNER = 'owner',
  VIEWER = 'viewer',
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
