import type { Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';

@Entity()
@Index({ properties: ['emailType', 'sentAt'] })
@Unique({ properties: ['appuser', 'emailType'] })
export class SentEmail extends Base {
  @ManyToOne(() => Appuser, { nullable: false, updateRule: 'cascade' })
  appuser!: Rel<Appuser>;

  @Property({ default: 0 })
  attemptCount = 0;

  @Property({ length: 100, nullable: false })
  emailType!: string;

  @Property({ columnType: 'text', nullable: true })
  errorMessage?: string;

  @Property({ columnType: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Property({ columnType: 'jsonb', nullable: true })
  providerMessageIds?: string[];

  @Property({ length: 30, nullable: true })
  providerOutcome?: 'accepted' | 'rejected' | 'unknown';

  @Property({ columnType: 'timestamptz', nullable: true })
  providerRequestStartedAt?: Date;

  @Property({ nullable: true })
  retryable?: boolean;

  @Property({ columnType: 'timestamptz', nullable: false })
  sentAt!: Date;

  @PrimaryKey()
  sentEmailKey!: number;

  @Property({ default: 'sent', length: 30 })
  status: 'failed' | 'sending' | 'sent' | 'unknown' = 'sent';

  @Property({ length: 100, nullable: true })
  terminalReason?: string;
}
