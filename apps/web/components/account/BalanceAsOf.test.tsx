// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import enCommon from "../../messages/en/common.json";
import ptCommon from "../../messages/pt/common.json";
import { BalanceAsOf } from "./BalanceAsOf";

afterEach(cleanup);

function renderHint(
  props: { balanceDerivedAt?: string | null; refreshedAt: string | null },
  locale: "en" | "pt" = "en",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enCommon : ptCommon}
      timeZone="UTC"
    >
      <BalanceAsOf {...props} />
    </NextIntlClientProvider>,
  );
}

test("dates a derived balance by when the bank last confirmed it", () => {
  renderHint({
    balanceDerivedAt: "2026-11-24T06:00:00.000Z",
    refreshedAt: "2026-11-01T08:00:00.000Z",
  });

  const hint = screen.getByTestId("balance-as-of");
  // The bank's date, not the day the balance was derived.
  assert.match(hint.textContent ?? "", /Nov 1, 2026/);
  assert.doesNotMatch(hint.textContent ?? "", /Nov 24/);
});

test("speaks the reader's language", () => {
  renderHint(
    {
      balanceDerivedAt: "2026-11-24T06:00:00.000Z",
      refreshedAt: "2026-11-01T08:00:00.000Z",
    },
    "pt",
  );

  assert.match(screen.getByTestId("balance-as-of").textContent ?? "", /nov/i);
  assert.doesNotMatch(
    screen.getByTestId("balance-as-of").textContent ?? "",
    /Balance as of/,
  );
});

test("says nothing while the balance is the bank's own", () => {
  renderHint({ balanceDerivedAt: null, refreshedAt: "2026-11-01T08:00:00.000Z" });

  assert.equal(screen.queryByTestId("balance-as-of"), null);
});

test("says nothing when there is no date to give", () => {
  renderHint({ balanceDerivedAt: "2026-11-24T06:00:00.000Z", refreshedAt: null });
  renderHint({ balanceDerivedAt: "2026-11-24T06:00:00.000Z", refreshedAt: "garbage" });

  assert.equal(screen.queryByTestId("balance-as-of"), null);
});
