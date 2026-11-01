export interface AssistantDataUsed {
  granularity?: string;
  period?: string;
  recordCount?: number;
  source: string;
}

export interface AssistantToolContext {
  appuserKey: number;
  consentVersion: number;
  conversationId: string;
  /** ISO 4217 code of the user's base currency, which every aggregate is computed in. */
  currency: string;
  tenantKey: number;
}

export interface AssistantToolResult<TData> {
  data: TData;
  dataUsed: AssistantDataUsed;
}
