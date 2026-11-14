import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

/**
 * A file (receipt, invoice, warranty) kept with a transaction.
 *
 * The bytes live in the S3-compatible store under a key that starts with the household's tenant
 * key and a random id (`services/transaction/transaction-attachment.service.ts`); this row holds
 * only the metadata. Reads are always through a short-lived presigned URL, never a public object
 * URL, so the store can stay private.
 *
 * Scoped to the household. Deleting one soft-deletes the row and removes the object; the file is
 * never reachable from another household, whatever key a client sends back.
 */
@Entity({ tableName: 'transaction_attachment' })
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['transactionKey'] })
export class TransactionAttachment extends Base {
  @Property({ length: 255 })
  fileName!: string;

  @Property({ length: 512 })
  storageKey!: string;

  /** The type found in the file's bytes, not the one the client declared. */
  @Property({ length: 100 })
  contentType!: string;

  @Property()
  sizeBytes!: number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @PrimaryKey()
  transactionAttachmentKey!: number;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Transaction, fieldName: 'transaction_key' })
  transactionKey!: Rel<Transaction>;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'uploaded_by_appuser_key' })
  uploadedByAppuserKey!: Rel<Appuser>;
}
