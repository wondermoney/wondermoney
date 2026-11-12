// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import { proposalFixture } from "@/lib/api/assistant/proposal-fixture";
import type { AssistantProposal } from "@/lib/api/assistant/types";

import enMessages from "../../messages/en/common.json";
import AssistantPendingChanges from "./AssistantPendingChanges";

const state = vi.hoisted(() => ({
  aiHidden: false,
  enabled: [] as (boolean | undefined)[],
  proposals: [] as AssistantProposal[],
}));

vi.mock("@/lib/api/user-preferences/useAiHidden", () => ({
  default: () => state.aiHidden,
}));
vi.mock("@/lib/api/assistant/useAssistantProposals", () => ({
  default: (_status: string, options?: { enabled?: boolean }) => {
    state.enabled.push(options?.enabled);
    return { data: { proposals: state.proposals }, isError: false, isLoading: false };
  },
}));
vi.mock("@/lib/api/assistant/useDecideAssistantProposal", () => ({
  useApplyAssistantProposal: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRejectAssistantProposal: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  state.aiHidden = false;
  state.enabled = [];
  state.proposals = [];
});

function renderList() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AssistantPendingChanges />
    </NextIntlClientProvider>,
  );
}

test("lists each pending proposal with its source", () => {
  state.proposals = [
    proposalFixture({ id: 1, source: "mcp" }),
    proposalFixture({ id: 2, kind: "mark_transactions_reviewed", changes: [{ after: true, before: false, description: "Rent", field: "reviewed", transactionDate: null, transactionId: 5 }] }),
  ];
  renderList();

  assert.ok(screen.getByText("Pending changes"));
  assert.equal(screen.getAllByTestId("assistant-proposal-card").length, 2);
  assert.ok(screen.getByText(/From an MCP client/));
  assert.ok(screen.getByText(/From the assistant/));
});

test("says so when nothing is pending", () => {
  renderList();

  assert.ok(screen.getByText("No pending changes."));
});

test("is hidden, and does not fetch, when the person hid AI", () => {
  state.aiHidden = true;
  state.proposals = [proposalFixture()];
  renderList();

  assert.equal(screen.queryByTestId("assistant-pending-changes"), null);
  assert.deepEqual(state.enabled, [false]);
});
