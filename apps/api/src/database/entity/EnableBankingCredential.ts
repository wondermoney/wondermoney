import type { Rel } from '@mikro-orm/core';
import { Check, Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

export enum EnableBankingCredentialStatus {
  ACTIVE = 'active',
  INVALID = 'invalid',
  /**
   * A key pair WonderMoney generated (`POST /v1/user/enable-banking-credential/certificate`) whose
   * certificate the person is registering with Enable Banking. It has no `applicationId` yet, is
   * never used to sign a provider call other than its own activation check, and lapses
   * `PENDING_ENABLE_BANKING_CREDENTIAL_TTL_MS` after `createdAt`.
   */
  PENDING = 'pending',
  REVOKED = 'revoked',
}

/**
 * A user's own Enable Banking application registration (BYOK — Restricted
 * Production mode ties an application to one PSU's own bank logins, so this is
 * always personal, never shared across a household, even though `tenantKey`
 * is dual-written for household account-sharing elsewhere).
 *
 * `privateKeyCiphertext`/`privateKeyIv`/`privateKeyAuthTag`/`encryptionKeyVersion`
 * are the AES-256-GCM output of `services/crypto/secret-encryption.service.ts`.
 * `applicationId` is not secret (it's used as the JWT `kid`), so it's stored plain. It is null
 * only on a `pending` row, whose application is not registered yet.
 *
 * There is deliberately no DB-level unique constraint on `appuserKey` alone.
 * `NordigenRequisition` (this repo's closest precedent for a "current record per
 * user" shape) allows multiple historical rows per `appuserKey` and resolves
 * "the current one" at the application level (status + `createdAt DESC`), rather
 * than via a schema constraint — see `NordigenRequisitionRepository.getNewerLinkedRequistion`.
 * Following that precedent here lets a revoked/invalid credential stay on record
 * next to a freshly-registered replacement instead of requiring a delete-then-insert.
 */
@Entity()
@Index({ properties: ['appuserKey', 'status', 'createdAt'] })
// Only a pending key, whose application is not registered yet, goes without an application ID.
@Check({ expression: `"status" = 'pending' or "application_id" is not null`, name: 'enable_banking_credential_application_id_check' })
export class EnableBankingCredential extends Base {
  @Property({ length: 255, nullable: true, type: 'string' })
  applicationId?: null | string;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: false })
  appuserKey!: Rel<Appuser>;

  @PrimaryKey()
  enableBankingCredentialKey!: number;

  @Property()
  encryptionKeyVersion!: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastValidatedAt?: Date;

  @Property({ columnType: 'text', nullable: true })
  lastValidationError?: string;

  @Property({ columnType: 'text' })
  privateKeyAuthTag!: string;

  @Property({ columnType: 'text' })
  privateKeyCiphertext!: string;

  @Property({ columnType: 'text' })
  privateKeyIv!: string;

  @Enum(() => EnableBankingCredentialStatus)
  status: EnableBankingCredentialStatus = EnableBankingCredentialStatus.ACTIVE;

  @ManyToOne({ cascade: [], deleteRule: 'no action', entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;
}
