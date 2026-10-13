import { Entity, Enum, PrimaryKey, Property, Unique } from '@mikro-orm/core';

import { Base } from './BaseEntity';

export enum AccountFinancialInstitutionProvider {
  ENABLE_BANKING = 'enable_banking',
  GOCARDLESS = 'gocardless',
}

/**
 * `id` used to be globally unique on its own, back when GoCardless was the
 * only provider and issued it as an opaque institution id. Enable Banking has
 * no equivalent opaque id, so its rows use a self-constructed one
 * (`enable_banking:{country}:{slug}`) — the `(provider, id)` composite unique
 * below (added by a Phase 1a migration) prevents that from ever colliding
 * with a legacy GoCardless id sharing the same string.
 */
@Entity()
@Unique({ name: 'account_financial_institution_provider_id_unique', properties: ['provider', 'id'] })
export class AccountFinancialInstitution extends Base {
  @PrimaryKey()
  accountFinancialInstitutionKey!: number;

  @Property({ length: 255, nullable: true })
  displayName?: string;

  @Property({ length: 255 })
  id: string;

  @Property({ nullable: true })
  logoUrl?: string;

  @Property({ length: 255 })
  name: string;

  @Enum(() => AccountFinancialInstitutionProvider)
  provider: AccountFinancialInstitutionProvider = AccountFinancialInstitutionProvider.GOCARDLESS;
}
