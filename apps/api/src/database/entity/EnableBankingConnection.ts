import { Collection, EntityRepositoryType, LoadStrategy } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { EnableBankingReturnTo } from '@app/types/enable-banking-return-to';

import { EnableBankingConnectionRepository } from '../repositories/EnableBankingConnectionRepository';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { EnableBankingCredential } from './EnableBankingCredential';
import { Tenant } from './Tenant';

export enum EnableBankingConnectionStatus {
  AUTHORIZED = 'authorized',
  CREATED = 'created',
  ERROR = 'error',
  EXPIRED = 'expired',
  LINKED = 'linked',
}

/**
 * An Enable Banking bank connection, shaped around its real two-step flow
 * (`POST /auth` → `POST /sessions`). `state` is the correlation value sent on
 * `POST /auth` and echoed back on the callback, which looks the connection up
 * by it — a reference, not the provider's id — so it's unique.
 *
 * `accessValidUntil` is the real provider-returned `access.valid_until`
 * (populated once linked), never a hardcoded offset — see
 * `EnableBankingConnectionRepository.changeToLinked`.
 */
@Entity({ repository: () => EnableBankingConnectionRepository })
@Index({ expression: 'CREATE INDEX enable_banking_connection_tenant_appuser_status_created_at_idx ON enable_banking_connection (tenant_key, appuser_key, status, created_at DESC) WHERE deleted_at IS NULL AND tenant_key IS NOT NULL', name: 'enable_banking_connection_tenant_appuser_status_created_at_idx' })
export class EnableBankingConnection extends Base {
  @Property({ columnType: 'timestamptz', nullable: true })
  accessValidUntil?: Date;

  @OneToMany({
    entity: () => Account,
    fieldName: 'account_keys',
    mappedBy: (account) => account.enableBankingConnectionKey,
    strategy: LoadStrategy.JOINED,
  })
  accounts = new Collection<Account>(this);

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: false })
  appuserKey!: Rel<Appuser>;

  @Property({ length: 2 })
  aspspCountry!: string;

  @Property({ length: 255 })
  aspspName!: string;

  @Property({ length: 255, nullable: true })
  authorizationId?: string;

  @PrimaryKey()
  enableBankingConnectionKey!: number;

  @ManyToOne({ cascade: [], entity: () => EnableBankingCredential, fieldName: 'enable_banking_credential_key', nullable: false })
  enableBankingCredentialKey!: Rel<EnableBankingCredential>;

  [EntityRepositoryType]: EnableBankingConnectionRepository;

  @Property({ nullable: true })
  maxConsentValiditySeconds?: number;

  /**
   * Where the callback sends the browser afterwards. Set once, when the connection is started;
   * null means the web app.
   */
  @Enum({ items: () => EnableBankingReturnTo, nullable: true })
  returnTo?: EnableBankingReturnTo | null;

  @Property({ length: 255, nullable: true })
  sessionId?: string;

  @Property({ length: 255 })
  @Unique({ name: 'enable_banking_connection_state_uindex' })
  state!: string;

  @Enum(() => EnableBankingConnectionStatus)
  status: EnableBankingConnectionStatus = EnableBankingConnectionStatus.CREATED;

  @ManyToOne({ cascade: [], deleteRule: 'no action', entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;
}
