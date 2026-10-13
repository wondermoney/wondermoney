import { HouseholdInvite, HouseholdInviteStatus } from '@entity/HouseholdInvite';
import { Tenant } from '@entity/Tenant';

import { ExtendedEntityRepository } from './_ExtendedEntityRepository';

export class HouseholdInviteRepository extends ExtendedEntityRepository<HouseholdInvite> {
  public getByToken = (token: HouseholdInvite['token']) => this.findOne({ deletedAt: undefined, token });

  public getPendingForTenant = (tenant: Tenant) =>
    this.findOne({ deletedAt: undefined, status: HouseholdInviteStatus.PENDING, tenantKey: tenant });
}
