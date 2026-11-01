import type { Rel } from '@mikro-orm/core';
import { Entity, OneToOne, Property } from '@mikro-orm/decorators/legacy';

import { FinancialTransaction } from './FinancialTransaction';

/**
 * Certificado de Aforro-specific detail for a subscription `FinancialTransaction`.
 * Shares its primary key with the parent transaction (`transaction_key`) —
 * a true 1:1 extension table, not a surrogate-keyed side table — since exactly one
 * detail row exists per subscription transaction and it never outlives its parent.
 * Deliberately does NOT extend `Base`: it has no independent lifecycle (no
 * `deleted_at`) — its parent `FinancialTransaction`'s soft-delete is authoritative.
 *
 * NOTE ON THE SHARED PRIMARY KEY: MikroORM v6 does not support stacking `@PrimaryKey()`
 * and `@OneToOne()` as two separate decorators on the same property — it throws
 * `MetadataError: Multiple property decorators used` at entity-discovery time
 * regardless of decorator order (verified directly against
 * `@mikro-orm/core/metadata/MetadataValidator.js`). The correct v6 pattern for a
 * shared-PK 1:1 relation is a single relation decorator with `primary: true` — see the
 * existing composite-PK precedent in `FinancialAssetPrice.ts`
 * (`@ManyToOne({ ..., primary: true })`), applied here to `@OneToOne`.
 */
@Entity({ tableName: 'certificado_aforro_subscription_detail' })
export class CertificadoAforroSubscriptionDetail {
  @Property({ columnType: 'timestamptz', onCreate: () => new Date() })
  createdAt = new Date();

  @Property({ default: false, fieldName: 'tax_exempt' })
  taxExempt!: boolean;

  @OneToOne({
    deleteRule: 'no action',
    entity: () => FinancialTransaction,
    fieldName: 'transaction_key',
    owner: true,
    primary: true,
    updateRule: 'cascade',
  })
  transactionKey!: Rel<FinancialTransaction>;

  @Property({ columnType: 'timestamptz', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt = new Date();
}
