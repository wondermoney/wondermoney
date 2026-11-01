import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

export enum AssistantAuditEventType {
  ERROR = 'error',
  RESPONSE_COMPLETED = 'response_completed',
  TOOL_CALLED = 'tool_called',
  TOOL_DENIED = 'tool_denied',
}

@Entity({ tableName: 'assistant_audit_log' })
@Index({ name: 'assistant_audit_log_tenant_key_appuser_key_created_at_index', properties: ['tenantKey', 'appuserKey', 'createdAt'] })
@Index({ name: 'assistant_audit_log_conversation_id_index', properties: ['conversationId'] })
export class AssistantAuditLog extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @PrimaryKey()
  assistantAuditLogKey!: number;

  @Property({ nullable: true })
  consentVersion?: number;

  @Property({ length: 255 })
  conversationId!: string;

  @Enum(() => AssistantAuditEventType)
  eventType!: AssistantAuditEventType;

  @Property({ columnType: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Property({ length: 255, nullable: true })
  model?: string;

  @Property({ length: 255, nullable: true })
  provider?: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @Property({ length: 255, nullable: true })
  toolName?: string;
}
