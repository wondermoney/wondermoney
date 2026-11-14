import type { Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';

/**
 * One QR pairing between a signed-in web session and the mobile app.
 *
 * A row starts life as a **pairing code**: only its SHA-256 hash is stored, it is single-use
 * and it expires two minutes after creation. Claiming it (a conditional update, so two
 * concurrent exchanges cannot both win) stamps `claimedAt` and records the better-auth
 * `sessionId` the exchange created. From then on the same row is the **device**: the web
 * settings list reads every claimed, unrevoked row for the person, and revoking one deletes
 * that better-auth session and stamps `revokedAt`.
 *
 * One table rather than two because the code and the device are the same object at different
 * stages; a separate device table would need a second insert on the hot path of a single-use
 * claim, and could disagree with the code row about whether the pairing happened.
 */
@Entity()
@Index({ properties: ['appuserKey'] })
export class MobilePairing extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @PrimaryKey()
  mobilePairingKey!: number;

  /** SHA-256 hex digest of the pairing code. The plain code is shown once, in the QR. */
  @Property({ length: 64 })
  @Unique()
  codeHash!: string;

  /** Two minutes after creation. A claim after this instant is refused. */
  @Property({ columnType: 'timestamptz' })
  expiresAt!: Date;

  /** Set by the one exchange that wins the claim; null while the code is still unused. */
  @Property({ columnType: 'timestamptz', nullable: true })
  claimedAt?: Date;

  /** The better-auth session the exchange created. Null until claimed. */
  @Property({ length: 64, nullable: true })
  sessionId?: string;

  /** A human label for the device list, taken from the phone's user agent when it is known. */
  @Property({ length: 120, nullable: true })
  deviceLabel?: string;

  /** Set when the person revokes the device from web settings. */
  @Property({ columnType: 'timestamptz', nullable: true })
  revokedAt?: Date;
}
