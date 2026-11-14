import { Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * The provider-agnostic bank connection: which aggregator, the provider's own session/consent
 * id, the consent's end date and the credential reference. Provider-specific detail (Enable
 * Banking's ASPSP name/country and credential FK) stays on its own row,
 * `EnableBankingConnection`, linked one-to-one through
 * `EnableBankingConnection.bankConnectionKey`.
 *
 * The sync path, the scheduler and the worker read this row only. Adding a provider means
 * adding a detail row and a `BankProvider`, not another branch here.
 */
export enum BankConnectionStatus {
  AUTHORIZED = 'authorized',
  CREATED = 'created',
  ERROR = 'error',
  EXPIRED = 'expired',
  LINKED = 'linked',
  /**
   * The provider refused the stored credential outright (SimpleFIN answers 403 once the user
   * disables the access token). The scheduler skips it; only a new connection recovers.
   */
  REVOKED = 'revoked',
}

@Entity({ tableName: 'bank_connection' })
@Index({ expression: 'CREATE INDEX bank_connection_tenant_appuser_status_created_at_idx ON bank_connection (tenant_key, appuser_key, status, created_at DESC) WHERE deleted_at IS NULL AND tenant_key IS NOT NULL', name: 'bank_connection_tenant_appuser_status_created_at_idx' })
@Unique({ name: 'bank_connection_provider_external_id_unique', properties: ['provider', 'externalId'] })
export class BankConnection extends Base {
  @Property({ columnType: 'timestamptz', nullable: true })
  accessValidUntil?: Date;

  @OneToMany({
    entity: () => Account,
    mappedBy: (account) => account.bankConnectionKey,
  })
  accounts = new Collection<Account>(this);

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: false })
  appuserKey!: Rel<Appuser>;

  @PrimaryKey()
  bankConnectionKey!: number;

  /**
   * The provider's credential this connection was made with. For Enable Banking this is the
   * `EnableBankingCredential` key (BYOK, one application per user); a provider without a
   * stored credential leaves it null.
   */
  @Property({ length: 255, nullable: true })
  credentialReference?: string;

  /**
   * The provider's session / consent id. Null until the consent flow completes; unique per
   * provider when set (Postgres allows several nulls).
   */
  @Property({ length: 255, nullable: true })
  externalId?: string;

  /**
   * When a sync last tried to reach the bank, whatever the outcome. The scheduler waits
   * `BANK_SYNC_MIN_INTERVAL_HOURS` from this time, so a failed attempt also waits out the
   * interval instead of spending another of the bank's PSD2 unattended-access calls.
   */
  @Property({ columnType: 'timestamptz', nullable: true })
  lastSyncAttemptAt?: Date;

  @Property({ nullable: true })
  maxConsentValiditySeconds?: number;

  /**
   * The scheduler leaves the connection alone until this time. Set when the provider
   * rate-limits a sync, from its `Retry-After` or the default sync interval.
   */
  @Property({ columnType: 'timestamptz', nullable: true })
  nextEligibleSyncAt?: Date;

  @Property({ length: 64 })
  provider!: string;

  /** The callback correlation value, unique per provider flow. */
  @Property({ length: 255, nullable: true })
  @Unique({ name: 'bank_connection_state_uindex' })
  state?: string;

  @Enum(() => BankConnectionStatus)
  status: BankConnectionStatus = BankConnectionStatus.CREATED;

  @ManyToOne({ cascade: [], deleteRule: 'no action', entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;
}
