import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, OneToOne, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Account } from './Account';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * Credit-card settings for an account, one row per card.
 *
 * The card's spending belongs to a statement that closes on `statementCloseDay` and is paid by
 * `paymentDueDay`; the cycle itself is computed by
 * `services/account/credit-card-cycle.ts`, never stored. A row exists only for an account the
 * user (or the provider's `CARD` cash account type) marked as a credit card, so its presence is
 * what makes an account a card for the statement endpoints.
 *
 * Shares the account's primary key (`account_key`): exactly one detail row exists per card and it
 * never outlives its account. `tenantKey` is denormalised so the global tenant filter can scope
 * it without joining through `Account`.
 */
@Entity({ tableName: 'credit_card_detail' })
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ name: 'credit_card_detail_tenant_key_index', properties: ['tenantKey'] })
export class CreditCardDetail extends Base {
  @OneToOne({
    deleteRule: 'cascade',
    entity: () => Account,
    fieldName: 'account_key',
    owner: true,
    primary: true,
  })
  accountKey!: Rel<Account>;

  /** The day of the month the statement closes, 1–31; a short month clamps it to its last day. */
  @Property({ columnType: 'int' })
  statementCloseDay!: number;

  /** The day of the month the statement is due, 1–31; clamped to the month's last day. */
  @Property({ columnType: 'int' })
  paymentDueDay!: number;

  /** The card's credit limit, in the account's currency. Null when the user has not set one. */
  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  creditLimit?: null | number;

  /** Optional minimum payment, as a percentage of the statement balance. */
  @Property({ columnType: 'numeric(5, 2)', nullable: true })
  minimumPaymentPercent?: null | number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
