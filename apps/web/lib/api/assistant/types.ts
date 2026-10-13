export type AssistantConsent = {
  assistantEnabled: boolean;
  consentVersion: number;
  providerDisclosureVersion: number;
  chatRetentionMode: "temporary";
  launcherHidden: boolean;
  enabledAt: string | null;
  disabledAt: string | null;
};

export type AssistantAuditEvent = {
  conversationId: string;
  eventType: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};
