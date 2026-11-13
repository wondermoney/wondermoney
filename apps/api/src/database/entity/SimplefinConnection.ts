import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { ownerScopedCond, TENANT_FILTER } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { BankConnection } from './BankConnection';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * A SimpleFIN connection's own detail, one-to-one with its `BankConnection`.
 *
 * The access URL the setup-token claim returned carries the user's HTTP Basic credentials for
 * the SimpleFIN server, so it is stored only as the AES-256-GCM output of
 * `services/crypto/secret-encryption.service.ts` and never leaves the API: no response, log line
 * or error carries it. The four `accessUrl*`/`encryptionKeyVersion` columns are null once the
 * connection is disconnected, which destroys the credential.
 *
 * `serverHost` is the access URL's host without credentials, kept to show the user which server
 * the connection talks to. `institutionId`/`institutionName` are the bank behind the connection
 * when every account belongs to one bank, refreshed by each sync (one access URL can cover
 * several banks); the admin sync-health view reads them.
 *
 * Owner-scoped: inside a request only the member who connected it can see the row, even in their
 * own household. Workers run with no tenant context and read it by `bankConnectionKey`.
 */
@Entity()
@Filter({ args: false, cond: ownerScopedCond, default: true, name: TENANT_FILTER })
export class SimplefinConnection extends Base {
  @Property({ columnType: 'text', nullable: true })
  accessUrlAuthTag?: null | string;

  @Property({ columnType: 'text', nullable: true })
  accessUrlCiphertext?: null | string;

  @Property({ columnType: 'text', nullable: true })
  accessUrlIv?: null | string;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: false })
  appuserKey!: Rel<Appuser>;

  @ManyToOne({ cascade: [], entity: () => BankConnection, fieldName: 'bank_connection_key', nullable: false })
  @Unique({ name: 'simplefin_connection_bank_connection_uindex' })
  bankConnectionKey!: Rel<BankConnection>;

  @Property({ nullable: true })
  encryptionKeyVersion?: null | number;

  @Property({ length: 255, nullable: true })
  institutionId?: null | string;

  @Property({ length: 255, nullable: true })
  institutionName?: null | string;

  @Property({ length: 255 })
  serverHost!: string;

  @PrimaryKey()
  simplefinConnectionKey!: number;

  @ManyToOne({ cascade: [], deleteRule: 'no action', entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;
}
