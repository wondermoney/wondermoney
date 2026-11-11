// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import AiFeatures from "./AiFeatures";

const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  mutate: vi.fn(),
  variables: undefined as { aiHidden?: boolean } | undefined,
}));

vi.mock("@/lib/api/user-preferences/useUserPreferences", () => ({
  default: () => state.query,
}));
vi.mock("@/lib/api/user-preferences/useUpdateUserPreferences", () => ({
  default: () => ({
    mutate: state.mutate,
    variables: state.variables,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
}));

afterEach(() => {
  cleanup();
  state.mutate.mockClear();
  state.variables = undefined;
});

function renderPanel(query: Record<string, unknown>) {
  state.query = {
    isPending: false,
    isError: false,
    refetch: () => {},
    ...query,
  };
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AiFeatures />
    </NextIntlClientProvider>,
  );
}

test("shows the stored choice and hides AI features", async () => {
  renderPanel({ data: { aiHidden: false } });

  const toggle = screen.getByRole("switch", { name: "Hide AI features" });
  assert.equal(toggle.getAttribute("aria-checked"), "false");

  await userEvent.click(toggle);

  assert.deepEqual(state.mutate.mock.calls[0], [{ aiHidden: true }]);
});

test("turns AI features back on", async () => {
  renderPanel({ data: { aiHidden: true } });

  const toggle = screen.getByRole("switch", { name: "Show AI features" });
  assert.equal(toggle.getAttribute("aria-checked"), "true");

  await userEvent.click(toggle);

  assert.deepEqual(state.mutate.mock.calls[0], [{ aiHidden: false }]);
});

test("says what the switch turns off", () => {
  renderPanel({ data: { aiHidden: false } });

  assert.ok(screen.getByText(/assistant, receipt scanning/u));
});

test("does not render a switch until the stored value is known", () => {
  renderPanel({ isPending: true });

  assert.equal(screen.queryByRole("switch"), null);
});

test("offers a retry when the preference cannot be loaded", () => {
  renderPanel({ isError: true });

  assert.ok(screen.getByText("Could not load your preferences."));
  assert.ok(screen.getByRole("button", { name: "Retry" }));
});
