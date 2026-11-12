import { z } from 'zod';

import { AssistantProposalStatus } from '@entity/AssistantProposal';
import { positiveIntId } from '@validators/shared';

const assistantTextPartSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  type: z.literal('text'),
}).strict();

const assistantMessageSchema = z.object({
  content: z.string().trim().min(1).max(4_000).optional(),
  id: z.string().trim().min(1).max(255).optional(),
  parts: z.array(assistantTextPartSchema).min(1).max(20).optional(),
  role: z.enum(['user', 'assistant']),
}).strict().refine((message) => Boolean(message.content) || Boolean(message.parts?.length), {
  message: 'Message must include text content or text parts',
});

export const assistantConsentUpdateSchema = z.object({
  body: z.object({
    assistantEnabled: z.boolean(),
    launcherHidden: z.boolean().optional(),
  }).strict(),
});

/** The locales the web app ships; the chat formats amounts and replies in the one the client is showing. */
export const ASSISTANT_LOCALES = ['en', 'pt', 'es'] as const;
export type AssistantLocale = (typeof ASSISTANT_LOCALES)[number];

export const assistantChatSchema = z.object({
  body: z.object({
    id: z.string().trim().min(1).max(255).optional(),
    locale: z.enum(ASSISTANT_LOCALES).optional(),
    messages: z.array(assistantMessageSchema).min(1).max(50),
  }).strict(),
});

export const assistantAuditLogQuerySchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
  }).strict(),
});

export const assistantProposalListQuerySchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    /** Which proposals to list; pending by default. A pending one past its expiry is not pending. */
    status: z.enum(AssistantProposalStatus).default(AssistantProposalStatus.PENDING),
  }).strict(),
});

export const assistantProposalParamsSchema = z.object({
  params: z.object({ proposalId: positiveIntId }),
});
