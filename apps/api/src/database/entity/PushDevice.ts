import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';

export enum PushDevicePlatform {
  ANDROID = 'android',
  IOS = 'ios',
}

/**
 * A phone that asked for push notifications (`services/push`). The Expo push token is unique: one
 * install has one token, and it belongs to whoever signed in on it last, so registering a token
 * another person held moves it.
 *
 * `sessionId` is the better-auth session the app registered with. Signing out, revoking the
 * session or letting it expire ends the device too: the session-delete hook removes the row, and
 * the sender skips (and removes) any device whose session is gone. A token the push service
 * reports as unregistered gets `disabledAt` and is not sent to until the app registers it again.
 * Rows are deleted, not soft-deleted: a token has no history worth keeping.
 */
@Entity({ tableName: 'push_device' })
@Index({ name: 'push_device_session_id_index', properties: ['sessionId'] })
export class PushDevice extends Base {
  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  /** The app's version when it last registered, for support only. */
  @Property({ length: 32, nullable: true })
  appVersion?: string;

  /** Set when the push service reported the token as no longer registered. */
  @Property({ columnType: 'timestamptz', nullable: true })
  disabledAt?: Date;

  /** The last time the app registered this token. */
  @Property({ columnType: 'timestamptz' })
  lastSeenAt: Date = new Date();

  @Enum(() => PushDevicePlatform)
  platform!: PushDevicePlatform;

  @PrimaryKey()
  pushDeviceKey!: number;

  /** The better-auth session the app registered with (`better_auth.session.id`). */
  @Property({ length: 64, nullable: true })
  sessionId?: string;

  /** The Expo push token, `ExponentPushToken[...]`. */
  @Property({ length: 255 })
  @Unique({ name: 'push_device_token_unique' })
  token!: string;
}
