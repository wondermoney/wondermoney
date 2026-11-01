// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import enMessages from "../../messages/en/common.json";
import Stats from "./Stats";

afterEach(cleanup);

function valueOf(item: Parameters<typeof Stats>[0]["stats"][number]) {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Stats stats={[item]} />
    </NextIntlClientProvider>,
  );
  return container.querySelector("dd")?.textContent?.trim();
}

test("an unavailable metric explains itself when it can", () => {
  const label = enMessages["portfolio-metric-unavailable"];
  assert.ok(
    valueOf({
      name: "YTD",
      value: null,
      unavailableValueLabel: label,
    })?.startsWith(label),
  );
});

test("an unavailable metric with no explanation shows an em-dash, not N/A or zero", () => {
  assert.ok(valueOf({ name: "YTD", value: null })?.startsWith("—"));
});
