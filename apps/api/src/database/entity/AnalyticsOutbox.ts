import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Base } from './BaseEntity';

/**
 * Durable analytics outbox. One row is committed atomically with every canonical
 * signup and other durable events, then delivered to PostHog asynchronously.
 * `eventId` is a client-generated idempotency key and is unique. Delivery is
 * at-least-once; the same id is sent as PostHog's `$insert_id` for sink-side
 * deduplication. `sentAt` is null until the delivery buffer is acknowledged.
 */
@Entity({ tableName: 'analytics_outbox' })
export class AnalyticsOutbox extends Base {
  @PrimaryKey()
  analyticsOutboxKey!: number;

  @Property()
  distinctId!: string;

  @Property()
  @Unique()
  eventId!: string;

  @Property()
  eventName!: string;

  @Property({ type: 'json' })
  properties!: Record<string, unknown>;

  @Property({ columnType: 'timestamptz', nullable: true })
  sentAt?: Date;
}
