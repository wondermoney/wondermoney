import { Entity, Enum, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Base } from './BaseEntity';

export enum AccountFinancialInstitutionProvider {
  ENABLE_BANKING = 'enable_banking',
  GOCARDLESS = 'gocardless',
}

/**
 * `id` is unique per provider, not globally. Legacy-provider rows carry that provider's
 * opaque institution id; Enable Banking has no equivalent opaque id, so its rows use a
 * self-constructed one (`enable_banking:{country}:{slug}`). The `(provider, id)` composite
 * unique below prevents that from ever colliding with a legacy id sharing the same string.
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
