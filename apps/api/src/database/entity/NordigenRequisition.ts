import {
  Collection,
  Entity,
  EntityRepositoryType,
  Enum,
  Index,
  LoadStrategy,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { NordigenRequisitionRepository } from '../repositories/NordigenRequisitionRepository';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

export enum NordigenRequisitionStatus {
  CR = 'created',
  ER = 'error',
  EX = 'expired',
  LN = 'linked',
}
@Entity({ repository: () => NordigenRequisitionRepository })
@Index({ expression: 'CREATE INDEX nordigen_requisition_tenant_appuser_status_created_at_idx ON nordigen_requisition (tenant_key, appuser_key, status, created_at DESC) WHERE deleted_at IS NULL AND tenant_key IS NOT NULL', name: 'nordigen_requisition_tenant_appuser_status_created_at_idx' })
export class NordigenRequisition extends Base {
  @OneToMany({
    entity: () => Account,
    fieldName: 'account_keys',
    mappedBy: (account) => account.nordigenRequisitionKey,
    strategy: LoadStrategy.JOINED,
  })
  accounts = new Collection<Account>(this);

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: false })
  appuserKey?: Rel<Appuser>;

  [EntityRepositoryType]: NordigenRequisitionRepository;

  @Property()
  expiresAt?: Date;

  @Property({ nullable: false })
  internalReference!: string;

  @PrimaryKey()
  nordigenRequisitionKey!: number;

  @Property({ length: 255 })
  @Unique({ name: 'nordigen_requisition_requisition_id_uindex' })
  requisitionId!: string;

  @Enum()
  status!: NordigenRequisitionStatus;

  @ManyToOne({ cascade: [], deleteRule: 'no action', entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;
}
