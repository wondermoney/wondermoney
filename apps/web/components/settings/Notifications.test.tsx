// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { EmailNotificationPreferencesResponse } from "@/lib/api/email-notification-preferences/types";

import enMessages from "../../messages/en/common.json";
import Notifications from "./Notifications";

const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  mutate: vi.fn(),
}));

vi.mock("@/lib/api/email-notification-preferences/useEmailNotificationPreferences", () => ({
  default: () => state.query,
}));
vi.mock(
  "@/lib/api/email-notification-preferences/useUpdateEmailNotificationPreferences",
  () => ({
    default: () => ({
      mutate: state.mutate,
      reset: () => {},
      variables: undefined,
      isPending: false,
      isError: false,
      isSuccess: false,
    }),
  }),
);

afterEach(() => {
  cleanup();
  state.mutate.mockClear();
});

const t = createTranslator({
  locale: "en",
  messages: enMessages,
  namespace: "notificationPreferences",
});

/** Marketing opted out, so nothing is delivered — but the stored choices differ. */
const preferences: EmailNotificationPreferencesResponse = {
  budgetAlerts: { storedEnabled: true, effectiveEnabled: false, deliverySupported: true },
  weeklyInsights: { storedEnabled: false, effectiveEnabled: false, deliverySupported: true },
  growth: { storedEnabled: true, effectiveEnabled: false },
  accountRecovery: { storedEnabled: true, effectiveEnabled: false },
  marketingOptOut: true,
};

function renderPanel(query: Record<string, unknown>) {
  state.query = { isPending: false, isError: false, isFetching: false, refetch: () => {}, ...query };
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Notifications />
    </NextIntlClientProvider>,
  );
}

function streamSwitch(titleKey: "budgetAlerts.title" | "weeklyInsights.title" | "accountRecovery.title", on: boolean) {
  return screen.getByRole("switch", {
    name: t(on ? "toggleOffLabel" : "toggleOnLabel", { name: t(titleKey) }),
  });
}

test("each switch shows what the user chose, not whether mail is currently delivered", () => {
  renderPanel({ data: preferences });

  assert.equal(streamSwitch("budgetAlerts.title", true).getAttribute("aria-checked"), "true");
  assert.equal(streamSwitch("weeklyInsights.title", false).getAttribute("aria-checked"), "false");
  assert.equal(streamSwitch("accountRecovery.title", true).getAttribute("aria-checked"), "true");
});

test("turning one category off sends only that category", async () => {
  renderPanel({ data: preferences });

  await userEvent.click(streamSwitch("budgetAlerts.title", true));

  assert.deepEqual(state.mutate.mock.calls, [[{ budgetAlertsEnabled: false }]]);
});

test("the unsubscribe-from-everything switch sends only the opt-out flag", async () => {
  renderPanel({ data: preferences });

  await userEvent.click(
    screen.getByRole("switch", { name: t("marketingOptOut.toggleOffLabel") }),
  );

  assert.deepEqual(state.mutate.mock.calls, [[{ marketingOptOut: false }]]);
});

test("a failed refresh keeps the saved controls on screen with a warning", () => {
  renderPanel({ data: preferences, isError: true });

  screen.getByText(t("refreshWarning.title"));
  assert.equal(screen.getAllByRole("switch").length, 4);
});

test("a first load that fails offers a retry instead of the controls", () => {
  renderPanel({ data: undefined, isError: true });

  screen.getByText(t("loadError.title"));
  assert.equal(screen.queryAllByRole("switch").length, 0);
});
