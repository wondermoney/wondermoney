// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import budgetMessages from "../../messages/en/budget.json";
import { PersonalBudgetLabel } from "./PersonalBudgetLabel";

afterEach(cleanup);

const personal = budgetMessages.budgetVisibility.personal;

function renderLabel(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={budgetMessages}>
      {node}
    </NextIntlClientProvider>,
  );
}

test("a personal budget is labelled personal", () => {
  renderLabel(<PersonalBudgetLabel budget={{ visibility: "personal" }} />);
  assert.ok(screen.getByText(personal));
});

test("the badge form labels a personal budget too", () => {
  renderLabel(
    <PersonalBudgetLabel budget={{ visibility: "personal" }} variant="badge" />,
  );
  assert.ok(screen.getByText(personal));
});

test("a household budget, or one from an older server, carries no label", () => {
  const { container } = renderLabel(
    <>
      <PersonalBudgetLabel budget={{ visibility: "household" }} />
      <PersonalBudgetLabel budget={{}} variant="badge" />
    </>,
  );
  assert.equal(container.textContent, "");
});
