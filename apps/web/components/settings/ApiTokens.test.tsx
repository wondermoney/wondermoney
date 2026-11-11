// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { ApiToken } from "@/lib/api/user/useApiTokens";

import enApiTokens from "../../messages/en/api-tokens.json";
import enCommon from "../../messages/en/common.json";
import ApiTokens from "./ApiTokens";

const state = vi.hoisted(() => ({
  tokens: [] as ApiToken[],
  create: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/lib/api/user/useApiTokens", () => ({
  useApiTokens: () => ({ data: state.tokens, isLoading: false }),
  useCreateApiToken: () => ({ isPending: false, mutateAsync: state.create }),
  useRevokeApiToken: () => ({ isPending: false, mutateAsync: state.revoke }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  state.create.mockReset();
  state.revoke.mockReset();
});

function renderTokens(tokens: ApiToken[] = []) {
  state.tokens = tokens;
  render(
    <NextIntlClientProvider locale="en" messages={{ ...enCommon, ...enApiTokens }}>
      <ApiTokens />
    </NextIntlClientProvider>,
  );
}

const dashboard: ApiToken = {
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-04-01T00:00:00.000Z",
  id: 7,
  lastUsedAt: null,
  lastUsedIp: null,
  name: "Home dashboard",
  prefix: "wm_pat_AbCdEf12",
  revokedAt: null,
  scopes: ["read"],
};

test("creates a token and shows the plain value exactly once", async () => {
  state.create.mockResolvedValue({ apiToken: dashboard, token: "wm_pat_plain-value" });
  const user = userEvent.setup();
  renderTokens();

  await user.type(screen.getByLabelText("Name"), "Home dashboard");
  await user.click(screen.getByRole("button", { name: "Create token" }));

  await waitFor(() => assert.equal(state.create.mock.calls.length, 1));
  assert.deepEqual(state.create.mock.calls[0]?.[0], {
    expiresInDays: 90,
    name: "Home dashboard",
    scopes: ["read"],
  });
  await screen.findByDisplayValue("wm_pat_plain-value");
  assert.ok(screen.getByText(/only time it is shown/i));
});

test("lists a token by prefix and revokes it after confirmation", async () => {
  state.revoke.mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderTokens([dashboard]);

  assert.ok(screen.getByText("wm_pat_AbCdEf12…"));
  await user.click(screen.getByRole("button", { name: "Revoke" }));
  await user.click(await screen.findByRole("button", { name: "Revoke token" }));

  await waitFor(() => assert.equal(state.revoke.mock.calls.length, 1));
  assert.equal(state.revoke.mock.calls[0]?.[0], 7);
});

test("shows a revoked token without offering revoke again", () => {
  renderTokens([{ ...dashboard, revokedAt: "2026-02-01T00:00:00.000Z" }]);

  assert.ok(screen.getByText("Revoked"));
  assert.equal(screen.queryByRole("button", { name: "Revoke" }), null);
});
