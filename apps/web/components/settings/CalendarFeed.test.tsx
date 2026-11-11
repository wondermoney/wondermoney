// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { ApiToken } from "@/lib/api/user/useApiTokens";

import enCalendarFeed from "../../messages/en/calendar-feed.json";
import enCommon from "../../messages/en/common.json";
import CalendarFeed from "./CalendarFeed";

const state = vi.hoisted(() => ({
  token: null as ApiToken | null,
  reset: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/lib/api/user/useCalendarFeed", () => ({
  calendarFeedUrl: (token: string, locale: string) =>
    `https://api.test/v1/calendar/bills.ics?locale=${locale}&token=${token}`,
  useCalendarFeedToken: () => ({ data: state.token, isLoading: false }),
  useResetCalendarFeedToken: () => ({ isPending: false, mutateAsync: state.reset }),
  useRevokeCalendarFeedToken: () => ({ isPending: false, mutateAsync: state.revoke }),
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
  state.reset.mockReset();
  state.revoke.mockReset();
});

function renderFeed(token: ApiToken | null = null) {
  state.token = token;
  render(
    <NextIntlClientProvider locale="en" messages={{ ...enCommon, ...enCalendarFeed }}>
      <CalendarFeed />
    </NextIntlClientProvider>,
  );
}

const activeToken: ApiToken = {
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2036-01-01T00:00:00.000Z",
  id: 11,
  lastUsedAt: null,
  lastUsedIp: null,
  name: "Calendar feed",
  prefix: "wm_pat_AbCdEf12",
  revokedAt: null,
  scopes: ["calendar:read"],
};

test("creates a link and shows the subscribe URL once", async () => {
  state.reset.mockResolvedValue({ calendarFeedToken: activeToken, token: "wm_pat_plain-value" });
  const user = userEvent.setup();
  renderFeed();

  await user.click(screen.getByRole("button", { name: "Create link" }));

  await waitFor(() => assert.equal(state.reset.mock.calls.length, 1));
  await screen.findByDisplayValue(
    "https://api.test/v1/calendar/bills.ics?locale=en&token=wm_pat_plain-value",
  );
  assert.ok(screen.getByText(/shown only now/i));
});

test("shows an active link by prefix and resets it", async () => {
  state.reset.mockResolvedValue({ calendarFeedToken: activeToken, token: "wm_pat_new-value" });
  const user = userEvent.setup();
  renderFeed(activeToken);

  assert.ok(screen.getByText(/wm_pat_AbCdEf12…/));
  await user.click(screen.getByRole("button", { name: "Reset link" }));

  await waitFor(() => assert.equal(state.reset.mock.calls.length, 1));
  await screen.findByDisplayValue(
    "https://api.test/v1/calendar/bills.ics?locale=en&token=wm_pat_new-value",
  );
});

test("revokes the link after confirmation", async () => {
  state.revoke.mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderFeed(activeToken);

  await user.click(screen.getByRole("button", { name: "Revoke link" }));
  await user.click(await screen.findByRole("button", { name: "Revoke this link" }));

  await waitFor(() => assert.equal(state.revoke.mock.calls.length, 1));
});

test("explains how to subscribe", () => {
  renderFeed();

  assert.ok(screen.getByText(/Google Calendar: Other calendars/));
  assert.ok(screen.getByText(/Apple Calendar: File/));
});
