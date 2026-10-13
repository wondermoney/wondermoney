import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { AppuserTenant } from '@entity/AppuserTenant';
import { AssistantAuditLog } from '@entity/AssistantAuditLog';
import { AssistantChatRetentionMode, AssistantConsent } from '@entity/AssistantConsent';
import { AssistantService } from '@service/assistant/assistant.service';
import { BadRequestError, ERROR_CODE } from '@utils/errors';
import { assistantAuditLogQuerySchema, assistantChatSchema, assistantConsentUpdateSchema } from '@validators/assistant';
import { zParse } from '@validators/parser';

export async function chatWithAssistant(req: Request, res: Response) {
  const { appuser, tenant } = await getAssistantContext(req);
  const { body: { messages } } = await zParse(assistantChatSchema, req);
  const consent = await DI.em.findOne(AssistantConsent, {
    appuserKey: appuser,
    deletedAt: null,
    tenantKey: tenant,
  });

  if (!consent?.assistantEnabled) {
    return res.status(403).json({
      code: ERROR_CODE.ASSISTANT_NOT_ENABLED,
      message: 'Assistant is not enabled for this account.',
    });
  }

  return AssistantService.streamChat({
    appuserKey: appuser.appuserKey,
    consent: { assistantEnabled: consent.assistantEnabled, consentVersion: consent.consentVersion },
    conversationId: randomUUID(),
    messages,
    req,
    res,
    tenantKey: tenant.tenantKey,
  });
}

export async function disableAssistant(req: Request, res: Response) {
  const { appuser, tenant } = await getAssistantContext(req);
  let consent = await DI.em.findOne(AssistantConsent, { appuserKey: appuser, deletedAt: null, tenantKey: tenant });
  if (!consent) {
    consent = new AssistantConsent();
    consent.appuserKey = appuser;
    consent.tenantKey = tenant;
  }
  consent.assistantEnabled = false;
  consent.disabledAt = new Date();
  await DI.em.persist(consent).flush();
  return res.json({ consent: buildConsentResponse(consent) });
}

export async function getAssistantAuditLog(req: Request, res: Response) {
  const { appuser, tenant } = await getAssistantContext(req);
  const { query: { limit } } = await zParse(assistantAuditLogQuerySchema, req);
  const events = await DI.em.find(
    AssistantAuditLog,
    {
      appuserKey: appuser,
      deletedAt: null,
      tenantKey: tenant,
    },
    { limit, orderBy: { createdAt: 'desc' } },
  );
  return res.json({ events: events.map(buildAuditEventResponse) });
}

export async function getAssistantConsent(req: Request, res: Response) {
  const { appuser, tenant } = await getAssistantContext(req);
  const consent = await DI.em.findOne(AssistantConsent, {
    appuserKey: appuser,
    deletedAt: null,
    tenantKey: tenant,
  });
  return res.json({ consent: buildConsentResponse(consent) });
}

export async function updateAssistantConsent(req: Request, res: Response) {
  const { appuser, tenant } = await getAssistantContext(req);
  const { body: { assistantEnabled, launcherHidden } } = await zParse(assistantConsentUpdateSchema, req);
  let consent = await DI.em.findOne(AssistantConsent, { appuserKey: appuser, deletedAt: null, tenantKey: tenant });
  if (!consent) {
    consent = new AssistantConsent();
    consent.appuserKey = appuser;
    consent.tenantKey = tenant;
  }
  consent.assistantEnabled = assistantEnabled;
  consent.launcherHidden = launcherHidden ?? consent.launcherHidden;
  consent.enabledAt = assistantEnabled ? new Date() : consent.enabledAt;
  consent.disabledAt = assistantEnabled ? undefined : new Date();
  await DI.em.persist(consent).flush();
  return res.json({ consent: buildConsentResponse(consent) });
}

function buildAuditEventResponse(event: AssistantAuditLog) {
  return {
    conversationId: event.conversationId,
    createdAt: event.createdAt,
    eventType: event.eventType,
    metadata: sanitizeAuditMetadata(event.metadata),
    toolName: event.toolName,
  };
}

function buildConsentResponse(consent: AssistantConsent | null) {
  if (!consent) return buildDefaultConsent();
  return {
    assistantEnabled: consent.assistantEnabled,
    chatRetentionMode: consent.chatRetentionMode,
    consentVersion: consent.consentVersion,
    disabledAt: consent.disabledAt ?? null,
    enabledAt: consent.enabledAt ?? null,
    launcherHidden: consent.launcherHidden,
    providerDisclosureVersion: consent.providerDisclosureVersion,
  };
}

function buildDefaultConsent() {
  return {
    assistantEnabled: false,
    chatRetentionMode: AssistantChatRetentionMode.TEMPORARY,
    consentVersion: 1,
    disabledAt: null,
    enabledAt: null,
    launcherHidden: false,
    providerDisclosureVersion: 1,
  };
}

async function getAssistantContext(req: Request) {
  if (!req.user) {
    throw new BadRequestError('User not found');
  }

  const appuserTenant = await DI.em.findOne(
    AppuserTenant,
    { appuserKey: req.user, deletedAt: undefined, recordActive: true },
    { populate: ['tenantKey'] },
  );

  if (!appuserTenant) {
    throw new BadRequestError('Tenant not found');
  }

  return { appuser: req.user, tenant: appuserTenant.tenantKey };
}

function sanitizeAuditMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return undefined;

  const allowedKeys = new Set(['dataCategory', 'dateRange', 'denialReason', 'granularity', 'period', 'recordCount', 'status']);
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => allowedKeys.has(key)));
}
