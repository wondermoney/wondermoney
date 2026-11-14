// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import { getAnalyticsConsent } from "@/lib/analytics/consent";
import messages from "@/messages/en/common.json";

import { AnalyticsConsent } from "./AnalyticsConsent";

vi.mock("@/lib/utils/analytics-enabled", () => ({
  isAnalyticsEnabled: () => true,
  isGtmEnabled: () => false,
}));
beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

test("offers equally explicit choices and allows withdrawal from privacy settings", async () => {
  const user = userEvent.setup();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AnalyticsConsent />
      <AnalyticsConsent settings />
    </NextIntlClientProvider>,
  );
  assert.equal(getAnalyticsConsent(), null);
  await user.click(
    screen.getAllByRole("button", { name: "Allow analytics" })[0]!,
  );
  assert.equal(getAnalyticsConsent(), "granted");
  assert.equal(screen.getAllByRole("region").length, 1);
  await user.click(screen.getByRole("button", { name: "Decline analytics" }));
  assert.equal(getAnalyticsConsent(), "denied");
  view.unmount();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AnalyticsConsent />
    </NextIntlClientProvider>,
  );
  assert.equal(screen.queryByRole("region"), null);
});
