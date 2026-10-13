import { Entity, Enum, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

export enum TransactionOCRImportStatus {
  FAILED = 'Failed',
  STARTED = 'Started',
  SUCCESS = 'Success',
}

@Entity({ tableName: 'transaction_ocr_import' })
@Unique({ properties: ['transactionOCRImportKey'] })
export class TransactionOCRImport extends Base {
  @ManyToOne({ cascade: [], entity: () => Account, fieldName: 'account_key', nullable: true })
  accountKey?: Rel<Account>;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: true })
  appuserKey?: Rel<Appuser>;

  @Property({ nullable: false })
  fileUrl!: string;

  @Property({ length: 1024, nullable: true })
  llmResponse?: string;

  @Enum()
  status: TransactionOCRImportStatus = TransactionOCRImportStatus.STARTED;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;

  @Property({ nullable: false })
  tokensSpent!: number;

  @ManyToOne({ cascade: [], entity: () => Transaction, fieldName: 'transaction_key', nullable: true })
  transactionKey?: Rel<Transaction>;

  @PrimaryKey()
  transactionOCRImportKey!: number;
}
