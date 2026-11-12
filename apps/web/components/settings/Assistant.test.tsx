// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import { instanceFeatures, queryClientWithInstance } from "@/lib/api/instance/instance-fixture";

import enMessages from "../../messages/en/common.json";
import Assistant from "./Assistant";

const state = vi.hoisted(() => ({ consentEnabled: [] as (boolean | undefined)[] }));

vi.mock("@/lib/api/assistant/useAssistantConsent", () => ({
  default: (options?: { enabled?: boolean }) => {
    state.consentEnabled.push(options?.enabled);
    return {
      data: { assistantEnabled: true, launcherHidden: false },
      isError: false,
      isLoading: false,
    };
  },
}));
vi.mock("@/lib/api/assistant/useAssistantAuditLog", () => ({
  default: () => ({ data: { events: [] }, isError: false, isLoading: false }),
}));
vi.mock("@/lib/api/assistant/useUpdateAssistantConsent", () => ({
  default: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("./AssistantPendingChanges", () => ({
  default: () => <p data-testid="assistant-pending-changes">pending changes</p>,
}));

afterEach(() => {
  cleanup();
  state.consentEnabled = [];
});

function renderTab(assistant: boolean) {
  const features = instanceFeatures({ ai: { ...instanceFeatures().ai, assistant }, mcp: true });
  render(
    <QueryClientProvider client={queryClientWithInstance(features)}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Assistant />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("with an assistant model, the tab shows the chat settings and pending changes", () => {
  renderTab(true);

  assert.ok(screen.getByLabelText(enMessages.assistant.settings.enabled));
  assert.ok(screen.getByTestId("assistant-pending-changes"));
});

test("on an MCP-only server, the tab shows only pending changes", () => {
  renderTab(false);

  assert.ok(screen.getByTestId("assistant-pending-changes"));
  assert.equal(screen.queryByLabelText(enMessages.assistant.settings.enabled), null);
  assert.equal(screen.queryByText(enMessages.assistant.settings.auditLog), null);
  assert.ok(state.consentEnabled.every((enabled) => enabled === false));
});
