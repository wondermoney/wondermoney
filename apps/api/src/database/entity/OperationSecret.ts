import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Base } from './BaseEntity';

/**
 * A secret one background operation needs once, for a short while: the password of a
 * password-protected data export, read by the export job or the streamed download. Encrypted with
 * the server's credential key (`secret-encryption.service.ts`), keyed by the operation's
 * `correlationId`, and hard-deleted when it is read or expires, never soft-deleted
 * (`operation-secret.service.ts`). Nothing but that service reads this table.
 */
@Entity({ tableName: 'operation_secret' })
@Index({ name: 'operation_secret_expires_at_idx', properties: ['expiresAt'] })
@Unique({ name: 'operation_secret_correlation_id_unique', properties: ['correlationId'] })
export class OperationSecret extends Base {
  @Property({ columnType: 'text' })
  authTag!: string;

  @Property({ columnType: 'text' })
  ciphertext!: string;

  @Property({ length: 255 })
  correlationId!: string;

  @Property({ columnType: 'timestamptz' })
  expiresAt!: Date;

  @Property({ columnType: 'text' })
  iv!: string;

  @Property()
  keyVersion!: number;

  @PrimaryKey()
  operationSecretKey!: number;
}
