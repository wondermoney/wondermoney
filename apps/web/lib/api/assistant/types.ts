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

export type AssistantProposalKind =
  | "categorize_transactions"
  | "mark_transactions_reviewed"
  | "update_transaction_note";

export type AssistantProposalStatus =
  "pending" | "applied" | "rejected" | "expired" | "failed";

export type AssistantProposalSource = "assistant" | "mcp";

/** One row of a proposal's diff. `before` is read live; `after` is the proposed value. */
export type AssistantProposalChange = {
  transactionId: number;
  description: string | null;
  transactionDate: string | null;
  /** category: category names (null = uncategorized); reviewed: booleans; note: text or null. */
  field: "category" | "reviewed" | "note";
  before: string | boolean | null;
  after: string | boolean | null;
};

/** A change the assistant or an MCP client proposed; nothing is written until the person applies it. */
export type AssistantProposal = {
  id: number;
  kind: AssistantProposalKind;
  source: AssistantProposalSource;
  status: AssistantProposalStatus;
  summary: string;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  failureReason: null | "transaction_unavailable" | "category_unavailable";
  changes: AssistantProposalChange[];
  /** Transactions in the proposal the viewer can no longer see. */
  unavailableCount: number;
};

/** What a `propose_*` tool returns inside the chat stream (`output.data`). */
export type AssistantProposalToolData =
  | { status: "proposed"; proposal: AssistantProposal }
  | {
      status: "refused";
      reason: "ai_hidden" | "transaction_unavailable" | "category_unavailable";
    };
