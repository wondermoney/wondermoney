import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Unique } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Base } from './BaseEntity';
import { Tag } from './Tag';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

/**
 * A tag on a transaction. Read through both relations' tenant filters: a member sees a link
 * only when they can see the transaction (household + private-account carve-out).
 *
 * Links are removed outright when a tag comes off a transaction or the tag is deleted; the
 * transaction audit log keeps the history.
 */
@Entity({ tableName: 'transaction_tag' })
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['tagKey'] })
@Unique({ properties: ['transactionKey', 'tagKey'] })
export class TransactionTag extends Base {
  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Tag, fieldName: 'tag_key' })
  tagKey!: Rel<Tag>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Transaction, fieldName: 'transaction_key' })
  transactionKey!: Rel<Transaction>;

  @PrimaryKey()
  transactionTagKey!: number;
}
