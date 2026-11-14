import type { EntityManager } from '@mikro-orm/core';

import { ApiToken } from '@entity/ApiToken';
import { Appuser } from '@entity/Appuser';
import { AssistantAuditEventType, AssistantAuditLog, AssistantAuditSource } from '@entity/AssistantAuditLog';
import { Tenant } from '@entity/Tenant';
import { getRef } from '@utils/em-helpers';
import logger from '@utils/logger';

interface AssistantAuditLogInput {
  appuserKey: number;
  /** The personal API token behind an MCP call; omitted for the in-app assistant. */
  apiTokenKey?: number;
  consentVersion?: number;
  conversationId: string;
  eventType: AssistantAuditEventType;
  metadata?: Record<string, unknown>;
  model?: string;
  provider?: string;
  source?: AssistantAuditSource;
  tenantKey: number;
  toolName?: string;
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AssistantAuditService {
  static async log(em: EntityManager, input: AssistantAuditLogInput): Promise<AssistantAuditLog | null> {
    try {
      const auditLog = new AssistantAuditLog();
      auditLog.appuserKey = getRef(em, Appuser, input.appuserKey);
      if (input.apiTokenKey !== undefined) auditLog.apiTokenKey = getRef(em, ApiToken, input.apiTokenKey);
      auditLog.conversationId = input.conversationId;
      auditLog.consentVersion = input.consentVersion;
      auditLog.eventType = input.eventType;
      auditLog.metadata = sanitizeAuditMetadata(input.metadata);
      auditLog.model = input.model;
      auditLog.provider = input.provider;
      auditLog.source = input.source ?? AssistantAuditSource.ASSISTANT;
      auditLog.tenantKey = getRef(em, Tenant, input.tenantKey);
      auditLog.toolName = input.toolName;
      await em.persist(auditLog).flush();
      return auditLog;
    } catch (error) {
      logger.warn({ errorMessage: error instanceof Error ? error.message : 'Unknown error', errorName: error instanceof Error ? error.name : 'UnknownError', eventType: input.eventType, toolName: input.toolName }, 'Assistant audit log write failed');
      return null;
    }
  }
}

function sanitizeAuditMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return undefined;

  const allowedKeys = new Set([
    'granularity',
    'inputTokens',
    'outputTokens',
    'period',
    'recordCount',
    'source',
    'status',
    'toolName',
    'totalTokens',
  ]);

  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => allowedKeys.has(key))
      .filter(([, value]) => value === undefined || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
  );
}
