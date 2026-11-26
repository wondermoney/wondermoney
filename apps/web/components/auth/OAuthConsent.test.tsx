// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import { parseOAuthConsentRequest } from "@/lib/auth/oauth-consent";

import enCommon from "../../messages/en/common.json";
import enConnectAiClient from "../../messages/en/connect-ai-client.json";
import { OAuthConsent } from "./OAuthConsent";

const state = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock("@/lib/api/household/useHousehold", () => ({
  default: () => ({
    data: {
      maxMembers: 6,
      members: [],
      pendingInvites: [],
      viewerAppuserKey: 1,
    },
  }),
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: { signOut: vi.fn(() => Promise.resolve()) },
}));

vi.mock("@/lib/auth/oauth-consent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOAuthClientInfo: () =>
    Promise.resolve({ client_id: "c1", client_name: "ChatGPT" }),
  submitOAuthConsent: state.submit,
}));

afterEach(() => {
  cleanup();
  state.submit.mockReset();
});

const query = (redirectUri: string) =>
  `client_id=c1&redirect_uri=${encodeURIComponent(redirectUri)}&scope=mcp%3Aread+offline_access&sig=s1`;

function renderConsent(
  redirectUri: string,
  props: { sessionFresh?: boolean; twoFactorEnabled?: boolean } = {},
) {
  const request = parseOAuthConsentRequest(query(redirectUri));
  if (!request) throw new Error("not a consent request");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enConnectAiClient }}
      >
        <OAuthConsent
          request={request}
          instanceName="WonderMoney"
          signedInEmail="person@example.test"
          sessionFresh={props.sessionFresh ?? true}
          twoFactorEnabled={props.twoFactorEnabled ?? false}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("names a website redirect by its https origin", async () => {
  renderConsent("https://chatgpt.com/connector/oauth/x");

  await screen.findByText(/ChatGPT wants to read/);
  assert.ok(screen.getByText("https://chatgpt.com"));
  assert.equal(screen.queryByText(/an app on this device/), null);
});

test("calls a custom-scheme redirect an app on this device, with a warning, never by the host it names", async () => {
  renderConsent("evilapp://chatgpt.com/oauth/callback");

  await screen.findByText(/ChatGPT wants to read/);
  assert.ok(screen.getByText("evilapp:"));
  assert.ok(screen.getByText(/Any app on this device could claim/));
  assert.equal(screen.queryByText(/chatgpt\.com/), null);
});

test("asks for the authenticator code and sends it with the answer", async () => {
  state.submit.mockResolvedValue("https://chatgpt.com/cb?code=x");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign: vi.fn() },
  });
  const user = userEvent.setup();
  renderConsent("https://chatgpt.com/cb", { twoFactorEnabled: true });

  const allow = await screen.findByRole("button", { name: "Allow" });
  assert.equal((allow as HTMLButtonElement).disabled, true);
  await user.type(screen.getByLabelText("Authenticator code"), "123456");
  await user.click(allow);

  await waitFor(() => assert.equal(state.submit.mock.calls.length, 1));
  assert.deepEqual(state.submit.mock.calls[0]?.[0], {
    accept: true,
    oauthQuery: query("https://chatgpt.com/cb"),
    totpCode: "123456",
  });
});

test("asks a session older than a day to sign in again before anything else", () => {
  renderConsent("https://chatgpt.com/cb", { sessionFresh: false });

  assert.ok(screen.getByRole("button", { name: "Sign in again" }));
  assert.equal(screen.queryByRole("button", { name: "Allow" }), null);
});
