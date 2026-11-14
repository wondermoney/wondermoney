import { EntityRepositoryType } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { HouseholdInviteRepository } from '../repositories/HouseholdInviteRepository';

import { Appuser } from './Appuser';
import { HouseholdRole } from './AppuserTenant';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * Invitation lifecycle for a person to join a household tenant.
 * A pending, unexpired invite holds one of the household's seats (`HOUSEHOLD_MAX_MEMBERS`).
 */
export enum HouseholdInviteStatus {
  ACCEPTED = 'accepted',
  EXPIRED = 'expired',
  PENDING = 'pending',
  REVOKED = 'revoked',
}

@Entity({ repository: () => HouseholdInviteRepository })
@Index({ properties: ['tenantKey', 'status'] })
export class HouseholdInvite extends Base {
  @Property({ columnType: 'timestamptz', nullable: true })
  acceptedAt?: Date;

  // Invited person's email. Accepting requires the signed-in or signup email to match it.
  @Property({ length: 255 })
  emailAddress!: string;

  [EntityRepositoryType]: HouseholdInviteRepository;

  @Property({ columnType: 'timestamptz' })
  expiresAt!: Date;

  @PrimaryKey()
  householdInviteKey!: number;

  // The role the person joins with, picked by the inviter. Never `owner`.
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'inviter_appuser_key' })
  inviterAppuserKey!: Rel<Appuser>;

  @Enum(() => HouseholdRole)
  role: HouseholdRole = HouseholdRole.MEMBER;

  @Enum(() => HouseholdInviteStatus)
  status: HouseholdInviteStatus = HouseholdInviteStatus.PENDING;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  // Opaque single-use token embedded in the invite link.
  @Property({ columnType: 'text' })
  @Unique()
  token!: string;
}
