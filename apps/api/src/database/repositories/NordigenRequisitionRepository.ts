import { QueryOrder } from '@mikro-orm/core';
import { addDays } from 'date-fns';

import { Appuser } from '../entity/Appuser';
import { NordigenRequisition, NordigenRequisitionStatus } from '../entity/NordigenRequisition';
import { Tenant } from '../entity/Tenant';

import { ExtendedEntityRepository } from './_ExtendedEntityRepository';

export class NordigenRequisitionRepository extends ExtendedEntityRepository<NordigenRequisition> {
  public changeToError = async (requisition: NordigenRequisition) => {
    // Change Requisition status to ER (error)
    requisition.status = NordigenRequisitionStatus.ER;
    await this.persist(requisition).flush();
    return requisition;
  };
  public changeToLinked = async (requisition: NordigenRequisition) => {
    // Change Requisition status to LN (linked)
    requisition.status = NordigenRequisitionStatus.LN;
    // Note: Hardcoded to 90 days, which is what we use for all requisitions at this time.
    requisition.expiresAt = addDays(new Date(), 90);
    await this.persist(requisition).flush();
    return requisition;
  };
  /**
   * Find the newest linked requisition for a given (appuser, tenant) pair.
   * Scoping by tenant prevents cross-tenant access if a user has ever
   * been active in more than one subscription context (RAD-244).
   */
  public getNewerLinkedRequistion = (appuser: Appuser, tenant: Tenant) => {
    if (!Number.isInteger(tenant.tenantKey) || tenant.tenantKey <= 0) {
      throw new Error('Requisition tenant is required and must be a persisted Tenant');
    }
    return this.findOne(
      { appuserKey: appuser, deletedAt: undefined, status: NordigenRequisitionStatus.LN, tenantKey: tenant },
      { orderBy: { createdAt: QueryOrder.DESC } },
    );
  };
}
