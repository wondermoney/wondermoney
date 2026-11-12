// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import { proposalFixture as proposal } from "@/lib/api/assistant/proposal-fixture";
import type { AssistantProposal } from "@/lib/api/assistant/types";

import enMessages from "../../messages/en/common.json";
import AssistantProposalCard from "./AssistantProposalCard";

const state = vi.hoisted(() => ({ apply: vi.fn(), reject: vi.fn() }));

vi.mock("@/lib/api/assistant/useDecideAssistantProposal", () => ({
  useApplyAssistantProposal: () => ({ isPending: false, mutateAsync: state.apply }),
  useRejectAssistantProposal: () => ({ isPending: false, mutateAsync: state.reject }),
}));

afterEach(() => {
  cleanup();
  state.apply.mockReset();
  state.reject.mockReset();
});

function renderCard(value: AssistantProposal, showSource = false) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AssistantProposalCard proposal={value} showSource={showSource} />
    </NextIntlClientProvider>,
  );
}

function apiError(code: string) {
  return Object.assign(new Error(code), { response: { data: { code }, status: 409 } });
}

test("shows the translated title and the before and after category of each row", () => {
  renderCard(proposal());

  assert.ok(screen.getByText("Categorize 2 transactions as Groceries"));
  assert.ok(screen.getByText("Corner shop"));
  assert.ok(screen.getByText("Uncategorized"));
  assert.ok(screen.getByText("Dining"));
  assert.equal(screen.getAllByText("Groceries").length, 2);
});

test("shows the note diff", () => {
  renderCard(
    proposal({
      changes: [{ after: "Split with Sam", before: null, description: "Dinner", field: "note", transactionDate: null, transactionId: 3 }],
      kind: "update_transaction_note",
    }),
  );

  assert.ok(screen.getByText("Change a transaction note"));
  assert.ok(screen.getByText("No note"));
  assert.ok(screen.getByText("Split with Sam"));
});

test("shows the reviewed diff", () => {
  renderCard(
    proposal({
      changes: [{ after: true, before: false, description: "Rent", field: "reviewed", transactionDate: null, transactionId: 4 }],
      kind: "mark_transactions_reviewed",
    }),
  );

  assert.ok(screen.getByText("Mark 1 transaction as reviewed"));
  assert.ok(screen.getByText("Not reviewed"));
  assert.ok(screen.getByText("Reviewed"));
});

test("applies the proposal and then shows it as applied", async () => {
  state.apply.mockResolvedValue(proposal({ status: "applied" }));
  const user = userEvent.setup();
  renderCard(proposal());

  await user.click(screen.getByRole("button", { name: "Apply" }));

  await waitFor(() => assert.equal(state.apply.mock.calls[0]?.[0], 42));
  assert.equal((await screen.findByTestId("assistant-proposal-outcome")).textContent, "Applied");
  assert.equal(screen.queryByRole("button", { name: "Apply" }), null);
});

test("dismisses the proposal", async () => {
  state.reject.mockResolvedValue(proposal({ status: "rejected" }));
  const user = userEvent.setup();
  renderCard(proposal());

  await user.click(screen.getByRole("button", { name: "Dismiss" }));

  await waitFor(() => assert.equal(state.reject.mock.calls[0]?.[0], 42));
  assert.equal((await screen.findByTestId("assistant-proposal-outcome")).textContent, "Dismissed");
});

test.each([
  ["assistant_proposal_expired", /Expired/],
  ["assistant_proposal_failed", /Could not be applied/],
  ["assistant_proposal_not_pending", /already decided/],
])("maps a 409 %s to its decided state", async (code, text) => {
  state.apply.mockRejectedValue(apiError(code));
  const user = userEvent.setup();
  renderCard(proposal());

  await user.click(screen.getByRole("button", { name: "Apply" }));

  assert.match((await screen.findByTestId("assistant-proposal-outcome")).textContent ?? "", text);
});

test("keeps the buttons and says so when the decision could not be saved", async () => {
  state.apply.mockRejectedValue(new Error("network"));
  const user = userEvent.setup();
  renderCard(proposal());

  await user.click(screen.getByRole("button", { name: "Apply" }));

  assert.ok(await screen.findByRole("alert"));
  assert.ok(screen.getByRole("button", { name: "Apply" }));
});

test("shows a proposal past its seven days as expired, without buttons", () => {
  renderCard(proposal({ expiresAt: "2026-01-01T00:00:00.000Z" }));

  assert.match(screen.getByTestId("assistant-proposal-outcome").textContent ?? "", /Expired/);
  assert.equal(screen.queryByRole("button", { name: "Apply" }), null);
});

test("names an MCP client as the source and counts rows no longer visible", () => {
  renderCard(proposal({ source: "mcp", unavailableCount: 1 }), true);

  assert.ok(screen.getByText(/From an MCP client/));
  assert.ok(screen.getByText("1 transaction is no longer available to you."));
  assert.ok(screen.getByText("Categorize 3 transactions as Groceries"));
});
