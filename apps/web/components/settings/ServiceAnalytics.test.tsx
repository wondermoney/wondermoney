// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import ServiceAnalytics from "./ServiceAnalytics";

const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  mutate: vi.fn(),
}));

vi.mock("@/lib/api/service-analytics/useServiceAnalytics", () => ({
  useServiceAnalytics: () => state.query,
  useUpdateServiceAnalytics: () => ({
    mutate: state.mutate,
    variables: undefined,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
}));

afterEach(() => {
  cleanup();
  state.mutate.mockClear();
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
      <ServiceAnalytics />
    </NextIntlClientProvider>,
  );
}

test("shows service analytics on and lets the person object", async () => {
  renderPanel({ data: { available: true, enabled: true } });

  const toggle = screen.getByRole("switch", {
    name: "Share service analytics",
  });
  assert.equal(toggle.getAttribute("aria-checked"), "true");

  await userEvent.click(toggle);

  assert.deepEqual(state.mutate.mock.calls[0], [false]);
});

test("lets a person who objected allow them again", async () => {
  renderPanel({ data: { available: true, enabled: false } });

  await userEvent.click(
    screen.getByRole("switch", { name: "Share service analytics" }),
  );

  assert.deepEqual(state.mutate.mock.calls[0], [true]);
});

test("shows nothing on a server that records no service analytics", () => {
  renderPanel({ data: { available: false, enabled: true } });

  assert.equal(screen.queryByRole("switch"), null);
  assert.equal(screen.queryByText("Service analytics"), null);
});
