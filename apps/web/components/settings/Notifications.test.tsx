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
  mutation: {} as Record<string, unknown>,
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
      variables: state.mutation.variables,
      isPending: state.mutation.isPending ?? false,
      isError: state.mutation.isError ?? false,
      isSuccess: state.mutation.isSuccess ?? false,
    }),
  }),
);

afterEach(() => {
  cleanup();
  state.mutate.mockClear();
  state.mutation = {};
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
  bankSyncAlerts: { storedEnabled: true, effectiveEnabled: false },
  creditCardDueReminders: { storedEnabled: true, effectiveEnabled: false },
  marketingOptOut: true,
};

function renderPanel(query: Record<string, unknown>) {
  state.mutation = (query.mutation as Record<string, unknown> | undefined) ?? {};
  state.query = { isPending: false, isError: false, isFetching: false, refetch: () => {}, ...query };
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Notifications />
    </NextIntlClientProvider>,
  );
}

function streamSwitch(titleKey: "budgetAlerts.title" | "weeklyInsights.title" | "accountRecovery.title" | "bankSyncAlerts.title", on: boolean) {
  return screen.getByRole("switch", {
    name: t(on ? "toggleOffLabel" : "toggleOnLabel", { name: t(titleKey) }),
  });
}

test("each switch shows what the user chose, not whether mail is currently delivered", () => {
  renderPanel({ data: preferences });

  assert.equal(streamSwitch("budgetAlerts.title", true).getAttribute("aria-checked"), "true");
  assert.equal(streamSwitch("weeklyInsights.title", false).getAttribute("aria-checked"), "false");
  assert.equal(streamSwitch("accountRecovery.title", true).getAttribute("aria-checked"), "true");
  assert.equal(streamSwitch("bankSyncAlerts.title", true).getAttribute("aria-checked"), "true");
});

test("turning one category off sends only that category", async () => {
  renderPanel({ data: preferences });

  await userEvent.click(streamSwitch("budgetAlerts.title", true));

  assert.deepEqual(state.mutate.mock.calls, [[{ budgetAlertsEnabled: false }]]);
});

test("card reminders show their saved value and a toggle sends only that field", async () => {
  renderPanel({ data: preferences });
  const reminder = screen.getByRole("switch", { name: t("toggleOffLabel", { name: t("creditCardDueReminders.title") }) });
  assert.equal(reminder.getAttribute("aria-checked"), "true");
  await userEvent.click(reminder);
  assert.deepEqual(state.mutate.mock.calls, [[{ creditCardDueRemindersEnabled: false }]]);
});

test("card reminders read as paused while the global unsubscribe is on", () => {
  renderPanel({ data: preferences });
  const section = screen.getByRole("region", { name: t("creditCardDueReminders.title") });
  assert.ok(section.textContent?.includes(t("status.paused")));
});

test("shows no card reminder switch when an older API does not return the preference", () => {
  const { creditCardDueReminders: _omitted, ...olderPreferences } = preferences;
  renderPanel({ data: olderPreferences });
  assert.equal(
    screen.queryByRole("switch", { name: t("toggleOffLabel", { name: t("creditCardDueReminders.title") }) }),
    null,
  );
  assert.equal(screen.getAllByRole("switch").length, 5);
});

test("keeps the persisted value and exposes retry after a reminder save fails", () => {
  renderPanel({
    data: preferences,
    variables: { creditCardDueRemindersEnabled: false },
    mutation: { variables: { creditCardDueRemindersEnabled: false }, isError: true },
  });
  const reminder = screen.getByRole("switch", { name: t("toggleOffLabel", { name: t("creditCardDueReminders.title") }) });
  assert.equal(reminder.getAttribute("aria-checked"), "true");
  screen.getByRole("alert");
  screen.getByRole("button", { name: t("retry") });
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
  assert.equal(screen.getAllByRole("switch").length, 6);
});

test("a first load that fails offers a retry instead of the controls", () => {
  renderPanel({ data: undefined, isError: true });

  screen.getByText(t("loadError.title"));
  assert.equal(screen.queryAllByRole("switch").length, 0);
});
