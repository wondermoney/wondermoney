import { Appuser } from '../entity/Appuser';
import { AppuserTenant, HouseholdRole } from '../entity/AppuserTenant';
import { Tenant } from '../entity/Tenant';

import { ExtendedEntityRepository } from './_ExtendedEntityRepository';

export class AppuserTenantRepository extends ExtendedEntityRepository<AppuserTenant> {
  public countActiveByTenant = (tenant: Tenant) =>
    this.count({ deletedAt: undefined, recordActive: true, tenantKey: tenant });
  // role defaults to OWNER (every historical link is the user's own tenant). The
  // household invite flow (RAD-343) passes MEMBER when linking a joining partner.
  public createAppuserTenant = (appUser: Appuser, tenant: Tenant, role: HouseholdRole = HouseholdRole.OWNER) => {
    const appuserTenant = new AppuserTenant();
    appuserTenant.appuserKey = appUser;
    appuserTenant.tenantKey = tenant;
    appuserTenant.role = role;
    return this.persist(appuserTenant).flush();
  };
  public getAppuserTenantByAppuser = (appuser: Appuser) => {
    return this.findOne(
      {
        appuserKey: { appuserKey: appuser.appuserKey, recordActive: true },
        deletedAt: undefined,
        recordActive: true,
      },
      { populate: ['tenantKey', 'appuserKey'] },
    );
  };
}
