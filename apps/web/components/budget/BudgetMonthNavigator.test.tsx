// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import { BudgetMonthNavigator } from "./BudgetMonthNavigator";

afterEach(cleanup);

const locales = [
  { locale: "en", messages: enMessages },
  { locale: "pt", messages: ptMessages },
  { locale: "es", messages: esMessages },
] as const;

for (const { locale, messages } of locales) {
  test(`the month arrows are buttons named in ${locale}`, async () => {
    const user = userEvent.setup();
    const onPreviousMonth = vi.fn();
    const onNextMonth = vi.fn();
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <BudgetMonthNavigator
          label="Oct 2026"
          hasPreviousMonth
          hasNextMonth
          onPreviousMonth={onPreviousMonth}
          onNextMonth={onNextMonth}
        />
      </NextIntlClientProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: messages["previous-month"] }),
    );
    await user.click(screen.getByRole("button", { name: messages["next-month"] }));

    assert.equal(onPreviousMonth.mock.calls.length, 1);
    assert.equal(onNextMonth.mock.calls.length, 1);
  });
}

test("an arrow with no month on that side is disabled, not just faded", async () => {
  const user = userEvent.setup();
  const onPreviousMonth = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <BudgetMonthNavigator
        label="Jan 2026"
        hasPreviousMonth={false}
        hasNextMonth
        onPreviousMonth={onPreviousMonth}
        onNextMonth={() => {}}
      />
    </NextIntlClientProvider>,
  );

  const previous = screen.getByRole("button", {
    name: enMessages["previous-month"],
  });
  assert.equal((previous as HTMLButtonElement).disabled, true);
  await user.click(previous);
  assert.equal(onPreviousMonth.mock.calls.length, 0);
});
