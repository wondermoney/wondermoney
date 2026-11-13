import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Filter, Index, ManyToOne, PrimaryKey, Unique } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/** What a share lets the member do with a private account: see it, or also change it. */
export enum AccountShareAccess {
  READ = 'read',
  WRITE = 'write',
}

/**
 * One member's access to a private account (`Account.isPrivate`). A shared account
 * (`isPrivate = false`) ignores these rows: every member sees and changes it. A private account is
 * seen by its owner and by the members with a row here, and changed by its owner and the members
 * with `write`. A household viewer reads only, whatever their row says
 * (`services/account/account-access.ts` holds the rule).
 *
 * Rows are replaced as a whole by `PUT /v1/account/:accountId/shares` and deleted outright, not
 * soft-deleted. They outlive the member's membership: a member who leaves or is removed keeps no
 * access (they are no longer in the household), and gets it back if they rejoin.
 */
@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Unique({ properties: ['accountKey', 'appuserKey'] })
export class AccountShare extends Base {
  @Enum(() => AccountShareAccess)
  access!: AccountShareAccess;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Account, fieldName: 'account_key' })
  accountKey!: Rel<Account>;

  @PrimaryKey()
  accountShareKey!: number;

  /** Indexed: the visibility check looks up the caller's shares on every account read. */
  @Index()
  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
