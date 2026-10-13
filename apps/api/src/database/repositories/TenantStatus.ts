import { TenantStatus } from '../entity/TenantStatus';

import { ExtendedEntityRepository } from './_ExtendedEntityRepository';

export class TenantStatusRepository extends ExtendedEntityRepository<TenantStatus> {
  public getActiveStatus = () => {
    return this.findOne({ description: 'Active' });
  };
}
