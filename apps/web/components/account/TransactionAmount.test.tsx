// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import commonMessages from "../../messages/en/common.json";
import { TransactionAmount } from "./TransactionAmount";

afterEach(cleanup);

type Row = Parameters<typeof TransactionAmount>[0]["transaction"];

const foreignRow = (fields: Partial<Row>): Row => ({
  appuserCurrencyKey: { code: "EUR" },
  appuserSettlementAmount: -60,
  settlementAmount: -10000,
  settlementCurrencyKey: { code: "JPY" },
  ...fields,
});

function renderAmount(transaction: Row) {
  return render(
    <NextIntlClientProvider locale="en" messages={commonMessages}>
      <TransactionAmount transaction={transaction} />
    </NextIntlClientProvider>,
  );
}

test("an exact row shows its converted amount, unmarked", () => {
  const { container } = renderAmount(foreignRow({ fxStatus: "exact" }));

  assert.match(container.textContent ?? "", /€60\.00/);
  assert.equal(screen.queryByRole("button"), null);
});

test("a row with no rate shows its original amount and says it was not converted", () => {
  const { container } = renderAmount(
    foreignRow({ fxStatus: "missing", appuserSettlementAmount: null }),
  );

  const text = container.textContent ?? "";
  assert.match(text, /¥10,000/);
  assert.doesNotMatch(text, /€/);
  assert.ok(screen.getByRole("button", { name: /^Not converted\./ }));
});

test("a row converted at an old rate is marked estimated, with the rate's date", () => {
  const { container } = renderAmount(
    foreignRow({ fxStatus: "provisional", fxRateDate: "2026-10-01" }),
  );

  assert.match(container.textContent ?? "", /€60\.00/);
  assert.match(
    screen
      .getByRole("button", { name: /^Estimated\./ })
      .getAttribute("aria-label") ?? "",
    /Oct 1, 2026/,
  );
});
