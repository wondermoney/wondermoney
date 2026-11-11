import type { Rel } from '@mikro-orm/core';
import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';

/**
 * One member's place for an account in their own list. Accounts are shared within a household,
 * so the order lives per `appuserKey` rather than on the account: each member keeps their own.
 * An account with no row here is unordered and sorts after the ordered ones, by name.
 */
@Entity()
@Unique({ properties: ['appuserKey', 'accountKey'] })
export class AppuserAccountPosition extends Base {
  @ManyToOne({ cascade: [], entity: () => Account, fieldName: 'account_key' })
  accountKey!: Rel<Account>;

  @PrimaryKey()
  appuserAccountPositionKey!: number;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  /** Lower comes first. Not unique: only the account order the client sends defines the list. */
  @Property()
  position!: number;
}
