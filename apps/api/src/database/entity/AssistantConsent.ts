import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

export enum AssistantChatRetentionMode {
  TEMPORARY = 'temporary',
}

@Entity({ tableName: 'assistant_consent' })
@Index({ name: 'assistant_consent_tenant_key_appuser_key_index', properties: ['tenantKey', 'appuserKey'] })
@Index({
  expression:
    'CREATE UNIQUE INDEX assistant_consent_active_uq ON assistant_consent (tenant_key, appuser_key) WHERE deleted_at IS NULL',
  name: 'assistant_consent_active_uq',
})
export class AssistantConsent extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @PrimaryKey()
  assistantConsentKey!: number;

  @Property()
  assistantEnabled = false;

  @Enum(() => AssistantChatRetentionMode)
  chatRetentionMode = AssistantChatRetentionMode.TEMPORARY;

  @Property()
  consentVersion = 1;

  @Property({ columnType: 'timestamptz', nullable: true })
  disabledAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  enabledAt?: Date;

  @Property()
  launcherHidden = false;

  @Property()
  providerDisclosureVersion = 1;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
