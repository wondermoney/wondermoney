// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import commonMessages from "../../messages/en/common.json";
import ptMessages from "../../messages/pt/common.json";
import { FxStatusBadge } from "./FxStatusBadge";

afterEach(cleanup);

function renderBadge(
  view: Parameters<typeof FxStatusBadge>[0]["view"],
  locale = "en",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "pt" ? ptMessages : commonMessages}
    >
      <FxStatusBadge view={view} originalCurrency="JPY" />
    </NextIntlClientProvider>,
  );
}

test("an exact conversion is not marked", () => {
  const { container } = renderBadge({ status: "exact" });

  assert.equal(container.textContent, "");
});

test("a missing conversion says it was not converted, and why, naming the currency", () => {
  renderBadge({ status: "missing" });

  const badge = screen.getByRole("button", { name: /^Not converted\./ });
  assert.equal(badge.textContent, "Not converted");
  assert.match(badge.getAttribute("aria-label") ?? "", /JPY/);
});

test("a provisional conversion is marked estimated, with the date of its rate", () => {
  renderBadge({ status: "provisional", rateDate: "2026-10-01" });

  const badge = screen.getByRole("button", { name: /^Estimated\./ });
  assert.equal(badge.textContent, "Estimated");
  assert.match(badge.getAttribute("aria-label") ?? "", /Oct 1, 2026/);
});

test("a provisional conversion with no known rate date still says it is estimated", () => {
  renderBadge({ status: "provisional", rateDate: null });

  assert.ok(screen.getByRole("button", { name: /^Estimated\./ }));
});

test("the labels are translated", () => {
  renderBadge({ status: "missing" }, "pt");

  assert.equal(screen.getByRole("button").textContent, "Não convertido");
});
