import type { AiToolDataUsed, AiToolResult } from '@service/ai-tools/ai-tool-types';

export type AssistantDataUsed = AiToolDataUsed;

export interface AssistantToolContext {
  appuserKey: number;
  consentVersion: number;
  conversationId: string;
  /** ISO 4217 code of the user's base currency, which every aggregate is computed in. */
  currency: string;
  tenantKey: number;
}
export type AssistantToolResult<TData> = AiToolResult<TData>;
