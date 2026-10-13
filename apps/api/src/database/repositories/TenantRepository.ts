import { getFullName } from '../../utils/misc';
import { Appuser } from '../entity/Appuser';
import { Tenant } from '../entity/Tenant';
import { TenantStatus } from '../entity/TenantStatus';

import { ExtendedEntityRepository } from './_ExtendedEntityRepository';

export class TenantRepository extends ExtendedEntityRepository<Tenant> {
  public createTenant = async (appUser: Appuser, status: TenantStatus) => {
    const tenant = new Tenant();
    tenant.name = getFullName(appUser.firstName, appUser.lastName);
    tenant.tentantStatusKey = status;
    tenant.ownerAppuserKey = appUser;
    await this.persist(tenant).flush();
    return tenant;
  };
}
