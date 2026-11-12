import type { AssistantProposal } from "./types";

/** A pending categorize proposal of two rows, for component tests. */
export function proposalFixture(
  overrides: Partial<AssistantProposal> = {},
): AssistantProposal {
  return {
    changes: [
      {
        after: "Groceries",
        before: null,
        description: "Corner shop",
        field: "category",
        transactionDate: "2026-11-02T00:00:00.000Z",
        transactionId: 11,
      },
      {
        after: "Groceries",
        before: "Dining",
        description: "Market",
        field: "category",
        transactionDate: "2026-11-03T00:00:00.000Z",
        transactionId: 12,
      },
    ],
    createdAt: "2026-11-10T10:00:00.000Z",
    decidedAt: null,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    failureReason: null,
    id: 42,
    kind: "categorize_transactions",
    source: "assistant",
    status: "pending",
    summary: "Categorize 2 transactions as Groceries",
    unavailableCount: 0,
    ...overrides,
  };
}
