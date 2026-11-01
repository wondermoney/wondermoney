// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { afterEach, test } from "vitest";

import { formatCurrencyForLocale } from "@/lib/utils/formatCurrency";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import { IncomeAmountEditButton } from "./IncomeAmountEditButton";

afterEach(cleanup);

test("the income amount is a real button that opens the edit dialog without submitting the step", () => {
  const { container } = render(
    <form>
      <IncomeAmountEditButton
        id="income-0"
        amount={2000}
        label="Edit Salary"
        onClick={() => {}}
      />
    </form>,
  );

  const button = screen.getByRole("button", { name: "Edit Salary" });
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.getAttribute("aria-haspopup"), "dialog");
  assert.equal(
    container.querySelectorAll("button").length,
    1,
    "no nested interactive elements",
  );
  assert.equal(container.querySelector("input"), null);
  assert.equal(container.querySelector("[readonly]"), null);
});

const catalogs = { en: enMessages, pt: ptMessages, es: esMessages } as const;

for (const [locale, messages] of Object.entries(catalogs)) {
  test(`the accessible name names the income source and its locale-formatted amount (${locale})`, () => {
    const t = createTranslator({ locale, messages });
    const amount = formatCurrencyForLocale(2000, "EUR", locale);

    for (const name of [
      t("edit-income-source", { name: "Salário", amount }),
      t("edit-income-source-recurring", { name: "Salário", amount, count: 14 }),
    ]) {
      assert.ok(name.includes("Salário"), name);
      assert.ok(name.includes(amount), `${name} should carry ${amount}`);
      assert.ok(!name.includes("{"), `uninterpolated placeholder: ${name}`);
    }

    assert.notEqual(
      t("edit-income-source", { name: "Salário", amount }),
      t("edit-income-source-recurring", { name: "Salário", amount, count: 14 }),
      "a recurring row is described differently from a one-off one",
    );
  });
}
