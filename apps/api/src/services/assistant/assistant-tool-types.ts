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
  tenantKey: number;
}

export interface AssistantToolResult<TData> {
  data: TData;
  dataUsed: AssistantDataUsed;
}
