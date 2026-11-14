// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import { proposalFixture } from "@/lib/api/assistant/proposal-fixture";

import enMessages from "../../messages/en/common.json";
import AssistantChat from "./AssistantChat";

const state = vi.hoisted(() => ({ messages: [] as unknown[] }));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    error: undefined,
    messages: state.messages,
    sendMessage: vi.fn(),
    status: "ready",
    stop: vi.fn(),
  }),
}));
vi.mock("@/lib/api/api", () => ({ getApiUrl: () => "https://api.example.test" }));
vi.mock("@/lib/api/assistant/useDecideAssistantProposal", () => ({
  useApplyAssistantProposal: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRejectAssistantProposal: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  state.messages = [];
});

function renderChat() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AssistantChat />
    </NextIntlClientProvider>,
  );
}

function assistantMessage(parts: unknown[]) {
  return { id: "m1", parts, role: "assistant" };
}

test("renders a proposal card for a finished propose tool call", () => {
  state.messages = [
    assistantMessage([
      { text: "I drafted this change for you to confirm.", type: "text" },
      {
        output: { data: { proposal: proposalFixture(), status: "proposed" }, dataUsed: { source: "database" } },
        state: "output-available",
        toolCallId: "call-1",
        type: "tool-propose_categorize_transactions",
      },
    ]),
  ];
  renderChat();

  assert.ok(screen.getByText("I drafted this change for you to confirm."));
  assert.ok(screen.getByTestId("assistant-proposal-card"));
  assert.ok(screen.getByRole("button", { name: "Apply" }));
});

test("renders no card for a refused proposal, a running call or a read tool", () => {
  state.messages = [
    assistantMessage([
      {
        output: { data: { reason: "transaction_unavailable", status: "refused" } },
        state: "output-available",
        toolCallId: "call-1",
        type: "tool-propose_categorize_transactions",
      },
      { input: {}, state: "input-available", toolCallId: "call-2", type: "tool-propose_update_transaction_note" },
      { output: { data: { accounts: [] } }, state: "output-available", toolCallId: "call-3", type: "tool-list_accounts" },
    ]),
  ];
  renderChat();

  assert.equal(screen.queryByTestId("assistant-proposal-card"), null);
});
