import { z } from 'zod';

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

export const assistantChatSchema = z.object({
  body: z.object({
    id: z.string().trim().min(1).max(255).optional(),
    messages: z.array(assistantMessageSchema).min(1).max(50),
  }).strict(),
});

export const assistantAuditLogQuerySchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
  }).strict(),
});
