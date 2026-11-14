import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { ApiToken } from './ApiToken';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

export enum AssistantAuditEventType {
  ERROR = 'error',
  RESPONSE_COMPLETED = 'response_completed',
  TOOL_CALLED = 'tool_called',
  TOOL_DENIED = 'tool_denied',
}

/**
 * Which surface made the call. The in-app assistant and the read-only MCP server share one
 * tool layer, so the audit log has to say which of the two a row belongs to.
 */
export enum AssistantAuditSource {
  ASSISTANT = 'assistant',
  MCP = 'mcp',
}

@Entity({ tableName: 'assistant_audit_log' })
@Index({ name: 'assistant_audit_log_tenant_key_appuser_key_created_at_index', properties: ['tenantKey', 'appuserKey', 'createdAt'] })
@Index({ name: 'assistant_audit_log_conversation_id_index', properties: ['conversationId'] })
@Index({ name: 'assistant_audit_log_source_appuser_key_created_at_index', properties: ['source', 'appuserKey', 'createdAt'] })
export class AssistantAuditLog extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  /**
   * The personal API token an MCP call was made with; null for the in-app assistant. Kept as a
   * relation so revoking the token leaves the audit trail intact (tokens are soft-deleted).
   */
  @ManyToOne({ cascade: [], entity: () => ApiToken, fieldName: 'api_token_key', nullable: true })
  apiTokenKey?: Rel<ApiToken>;

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

  @Enum(() => AssistantAuditSource)
  source: AssistantAuditSource = AssistantAuditSource.ASSISTANT;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @Property({ length: 255, nullable: true })
  toolName?: string;
}
