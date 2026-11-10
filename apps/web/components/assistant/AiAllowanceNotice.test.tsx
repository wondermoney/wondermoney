// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import enMessages from "../../messages/en/common.json";
import AiAllowanceNotice, { nextAllowanceReset } from "./AiAllowanceNotice";

afterEach(cleanup);

test("the allowance comes back at the next UTC midnight, whatever the hour", () => {
  assert.equal(nextAllowanceReset(new Date("2026-11-03T00:00:00Z")).toISOString(), "2026-11-04T00:00:00.000Z");
  assert.equal(nextAllowanceReset(new Date("2026-11-03T23:59:59Z")).toISOString(), "2026-11-04T00:00:00.000Z");
  assert.equal(nextAllowanceReset(new Date("2026-12-31T12:00:00Z")).toISOString(), "2027-01-01T00:00:00.000Z");
});

test("tells the household when the allowance comes back, in the viewer's time zone", () => {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Europe/Lisbon">
      <AiAllowanceNotice now={new Date("2026-07-03T12:00:00Z")} />
    </NextIntlClientProvider>,
  );
  // Midnight UTC is 1:00 AM in Lisbon summer time.
  assert.match(screen.getByTestId("ai-allowance-notice").textContent ?? "", /1:00/);
});
