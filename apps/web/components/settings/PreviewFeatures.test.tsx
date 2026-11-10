// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import PreviewFeatures from "./PreviewFeatures";

const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  mutate: vi.fn(),
  variables: undefined as { previewFeatures?: boolean } | undefined,
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
      <PreviewFeatures />
    </NextIntlClientProvider>,
  );
}

test("shows the stored choice and turns preview features on", async () => {
  renderPanel({ data: { previewFeatures: false } });

  const toggle = screen.getByRole("switch", {
    name: "Turn on preview features",
  });
  assert.equal(toggle.getAttribute("aria-checked"), "false");

  await userEvent.click(toggle);

  assert.deepEqual(state.mutate.mock.calls[0], [{ previewFeatures: true }]);
});

test("turns preview features off again", async () => {
  renderPanel({ data: { previewFeatures: true } });

  const toggle = screen.getByRole("switch", {
    name: "Turn off preview features",
  });
  assert.equal(toggle.getAttribute("aria-checked"), "true");

  await userEvent.click(toggle);

  assert.deepEqual(state.mutate.mock.calls[0], [{ previewFeatures: false }]);
});

test("warns that preview features are unfinished", () => {
  renderPanel({ data: { previewFeatures: false } });

  assert.ok(screen.getByText(/unfinished/u));
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
