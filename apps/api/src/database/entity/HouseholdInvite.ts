import { Entity, EntityRepositoryType, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { HouseholdInviteRepository } from '../repositories/HouseholdInviteRepository';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * RAD-343 (B1) — invitation lifecycle for a partner to join a household tenant.
 * A pending invite consumes the household's single open seat.
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

  // Invited partner's email. The accept flow requires the signup email to match this.
  @Property({ length: 255 })
  emailAddress!: string;

  [EntityRepositoryType]: HouseholdInviteRepository;

  @Property({ columnType: 'timestamptz' })
  expiresAt!: Date;

  @PrimaryKey()
  householdInviteKey!: number;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'inviter_appuser_key' })
  inviterAppuserKey!: Rel<Appuser>;

  @Enum(() => HouseholdInviteStatus)
  status: HouseholdInviteStatus = HouseholdInviteStatus.PENDING;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  // Opaque single-use token embedded in the invite link.
  @Property({ columnType: 'text' })
  @Unique()
  token!: string;
}
