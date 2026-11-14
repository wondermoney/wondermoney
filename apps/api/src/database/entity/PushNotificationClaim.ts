import type { Rel } from '@mikro-orm/core';
import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';

/**
 * The dedupe for push notifications that have no delivery table of their own: today a budget
 * alert's threshold crossing (`ba:c:<tenant>:<budget>:<category>:<yyyymm>:<threshold>`, the same
 * key the email uses). A crossing is pushed at most once per person, however many daily runs see
 * it. The row holds no content.
 */
@Entity({ tableName: 'push_notification_claim' })
@Unique({ name: 'push_notification_claim_appuser_dedupe_unique', properties: ['appuserKey', 'dedupeKey'] })
export class PushNotificationClaim extends Base {
  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @Property({ length: 128 })
  dedupeKey!: string;

  @PrimaryKey()
  pushNotificationClaimKey!: number;
}
