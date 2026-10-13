import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';

import { AccountFinancialInstitution } from './AccountFinancialInstitution';
import { Base } from './BaseEntity';

@Entity()
export class TransactionType extends Base {
  @ManyToOne({
    cascade: [],
    entity: () => AccountFinancialInstitution,
    fieldName: 'account_financial_institution_key',
    nullable: true,
  })
  accountFinancialInstitutionKey?: AccountFinancialInstitution;

  @Property({ nullable: false })
  displayName!: string;

  @Property({ unique: true })
  name!: string;

  @PrimaryKey()
  transactionTypeKey!: number;
}
