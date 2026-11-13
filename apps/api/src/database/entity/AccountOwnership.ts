import type { Rel } from '@mikro-orm/core';
import { Check, Entity, Filter, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * One member's share of an account, in basis points (10000 = 100%), for per-member net worth. An
 * account with no rows belongs wholly to its owner, or to Shared when it is joint
 * (`services/household/member-attribution.ts`). An account with rows is split between those members
 * by their shares, for net worth only: spending reports still follow the owner, the joint switch and
 * each transaction's "Spent by". A liability account (a card, a mortgage kept as an account) splits
 * the same way.
 *
 * An account's rows add up to exactly 10000. The service checks it before it writes
 * (`services/household/account-ownership.ts`), and a deferred constraint trigger checks it again at
 * commit (`Migration20261113200141`), so no transaction can leave an account half owned.
 *
 * Rows are replaced as a whole by `PUT /v1/account/:accountId/ownership` and deleted outright, not
 * soft-deleted. They outlive the member's membership: while the member is not in the household their
 * share counts as Shared, and it is theirs again if they rejoin. Ownership is attribution, never
 * visibility: who sees the account is `account-access.ts`'s rule.
 */
@Check({ expression: '"basis_points" >= 0 and "basis_points" <= 10000', name: 'account_ownership_basis_points_check' })
@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Unique({ properties: ['accountKey', 'appuserKey'] })
export class AccountOwnership extends Base {
  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Account, fieldName: 'account_key' })
  accountKey!: Rel<Account>;

  @PrimaryKey()
  accountOwnershipKey!: number;

  @Index()
  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  /** The member's share, 0 to 10000 (two decimals of a percent). */
  @Property({ columnType: 'int' })
  basisPoints!: number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
