// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { McpCall } from "@/lib/api/user/useMcpCalls";
import type { McpOAuthClient } from "@/lib/api/user/useMcpOAuthClients";

import enCommon from "../../messages/en/common.json";
import enConnectAiClient from "../../messages/en/connect-ai-client.json";
import ConnectAiClient from "./ConnectAiClient";

const state = vi.hoisted(() => ({
  calls: [] as McpCall[],
  create: vi.fn(),
  mcpEnabled: true,
  mcpOAuthEnabled: false,
  oauthClients: [] as McpOAuthClient[],
  revoke: vi.fn(),
}));

vi.mock("@/lib/api/api", () => ({
  getApiUrl: () => "https://api.example.test",
}));

vi.mock("@/lib/api/instance/useInstance", () => ({
  useFeature: (
    select: (features: { mcp?: boolean; mcpOAuth?: boolean }) => boolean,
  ) => select({ mcp: state.mcpEnabled, mcpOAuth: state.mcpOAuthEnabled }),
}));

vi.mock("@/lib/api/user/useApiTokens", () => ({
  useCreateApiToken: () => ({ isPending: false, mutateAsync: state.create }),
}));

vi.mock("@/lib/api/user/useMcpCalls", () => ({
  useMcpCalls: () => ({ data: state.calls, isLoading: false }),
}));

vi.mock("@/lib/api/user/useMcpOAuthClients", () => ({
  useMcpOAuthClients: () => ({ data: state.oauthClients, isLoading: false }),
  useRevokeMcpOAuthClient: () => ({ mutateAsync: state.revoke }),
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
  state.create.mockReset();
  state.calls = [];
  state.mcpEnabled = true;
  state.mcpOAuthEnabled = false;
  state.oauthClients = [];
  state.revoke.mockReset();
});

function renderPanel() {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...enCommon, ...enConnectAiClient }}
    >
      <ConnectAiClient />
    </NextIntlClientProvider>,
  );
}

test("shows the MCP endpoint and a copy-paste client config", () => {
  renderPanel();

  assert.ok(screen.getByDisplayValue("https://api.example.test/v1/mcp"));
  const [claudeConfig, httpConfig] = Array.from(
    document.querySelectorAll("pre"),
  );
  assert.match(
    claudeConfig?.textContent ?? "",
    /https:\/\/api\.example\.test\/v1\/mcp/,
  );
  assert.match(claudeConfig?.textContent ?? "", /mcp-remote/);
  assert.match(
    httpConfig?.textContent ?? "",
    /"Authorization": "Bearer <your-token>"/,
  );
});

test("creates a token with the mcp:read scope and shows it once", async () => {
  state.create.mockResolvedValue({
    apiToken: { id: 1, name: "AI client", scopes: ["mcp:read"] },
    token: "wm_pat_mcp-value",
  });
  const user = userEvent.setup();
  renderPanel();

  await user.click(
    screen.getByRole("button", { name: "Create an AI client token" }),
  );

  await waitFor(() => assert.equal(state.create.mock.calls.length, 1));
  assert.deepEqual(state.create.mock.calls[0]?.[0], {
    expiresInDays: 90,
    name: "AI client",
    scopes: ["mcp:read"],
  });
  await screen.findByDisplayValue("wm_pat_mcp-value");
});

test("adds the mcp:propose scope only when the person allows proposals", async () => {
  state.create.mockResolvedValue({
    apiToken: { id: 2, name: "AI client", scopes: ["mcp:read", "mcp:propose"] },
    token: "wm_pat_mcp-propose-value",
  });
  const user = userEvent.setup();
  renderPanel();

  await user.click(
    screen.getByRole("checkbox", {
      name: "Let the client propose changes for me to confirm",
    }),
  );
  await user.click(
    screen.getByRole("button", { name: "Create an AI client token" }),
  );

  await waitFor(() => assert.equal(state.create.mock.calls.length, 1));
  assert.deepEqual(state.create.mock.calls[0]?.[0]?.scopes, [
    "mcp:read",
    "mcp:propose",
  ]);
});

test("lists recent MCP calls by tool name", () => {
  state.calls = [
    {
      createdAt: "2026-11-11T10:00:00.000Z",
      toolName: "get_net_worth_summary",
    },
    { createdAt: "2026-11-11T09:00:00.000Z", toolName: "list_accounts" },
  ];
  renderPanel();

  assert.ok(screen.getByText("get_net_worth_summary"));
  assert.ok(screen.getByText("list_accounts"));
});

test("renders nothing when the instance has MCP disabled", () => {
  state.mcpEnabled = false;
  renderPanel();

  assert.equal(screen.queryByText("Connect an AI client"), null);
});

test("offers no OAuth section while the server does not offer OAuth", () => {
  renderPanel();

  assert.equal(screen.queryByText("Connect ChatGPT"), null);
});

test("lists the OAuth clients the member allowed and disconnects one", async () => {
  state.mcpOAuthEnabled = true;
  state.revoke.mockResolvedValue(undefined);
  state.oauthClients = [
    {
      clientId: "client-1",
      connectedAt: "2026-11-20T10:00:00.000Z",
      lastUsedAt: null,
      name: "ChatGPT",
      redirectHost: "chatgpt.com",
      scopes: ["mcp:read", "offline_access"],
    },
  ];
  const user = userEvent.setup();
  renderPanel();

  assert.ok(screen.getByText("Connect ChatGPT"));
  assert.ok(screen.getByText("ChatGPT"));
  assert.ok(screen.getByText("chatgpt.com"));

  await user.click(screen.getByRole("button", { name: "Disconnect" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(
    Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Disconnect",
    )!,
  );

  await waitFor(() => assert.equal(state.revoke.mock.calls.length, 1));
  assert.equal(state.revoke.mock.calls[0]?.[0], "client-1");
});
