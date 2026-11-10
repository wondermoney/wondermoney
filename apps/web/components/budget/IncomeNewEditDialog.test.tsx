// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import ptMessages from "../../messages/pt/common.json";
import IncomeNewEditDialog from "./IncomeNewEditDialog";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

/*
 * The dialog is portalled out of the DOM, but React still bubbles its submit
 * event up the component tree. On the budget wizard that meant saving an
 * income also submitted the wizard step around it, creating the budget
 * before the user pressed Continue — with the income they had not saved yet.
 */
test("saving the income dialog does not submit the form that renders it", async () => {
  const outerSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const onNewIncomeCreated = vi.fn();
  const user = userEvent.setup();

  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <form onSubmit={outerSubmit}>
        <IncomeNewEditDialog
          open
          setOpen={() => {}}
          onNewIncomeCreated={onNewIncomeCreated}
        />
      </form>
    </NextIntlClientProvider>,
  );

  const name = screen.getByPlaceholderText(enMessages.name);
  await user.type(name, "Freelance");
  await user.click(screen.getByRole("button", { name: enMessages["add-income"] }));

  await vi.waitFor(() => assert.equal(onNewIncomeCreated.mock.calls.length, 1));
  assert.equal(onNewIncomeCreated.mock.calls[0][0].name, "Freelance");
  assert.equal(outerSubmit.mock.calls.length, 0);
});

const renderDialog = (
  locale: "en" | "pt",
  onNewIncomeCreated: (income: { amount: number }) => void,
) =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "pt" ? ptMessages : enMessages}
    >
      <IncomeNewEditDialog
        open
        setOpen={() => {}}
        onNewIncomeCreated={onNewIncomeCreated}
      />
    </NextIntlClientProvider>,
  );

test.each([
  ["pt", "1.234,56", 1234.56],
  ["pt", "1.000", 1000],
  ["en", "1.000", 1],
  ["en", "1,234.56", 1234.56],
] as const)(
  "a %s reader typing %s saves %s",
  async (locale, typed, expected) => {
    const messages = locale === "pt" ? ptMessages : enMessages;
    const onNewIncomeCreated = vi.fn();
    const user = userEvent.setup();
    renderDialog(locale, onNewIncomeCreated);

    await user.type(screen.getByPlaceholderText(messages.name), "Salary");
    const amount = screen.getByLabelText(messages.amount, { exact: false });
    await user.clear(amount);
    await user.type(amount, typed);
    await user.click(screen.getByRole("button", { name: messages["add-income"] }));

    await vi.waitFor(() =>
      assert.equal(onNewIncomeCreated.mock.calls.length, 1),
    );
    assert.equal(onNewIncomeCreated.mock.calls[0][0].amount, expected);
  },
);

test("an amount it cannot read is a form error, not a saved income", async () => {
  const onNewIncomeCreated = vi.fn();
  const user = userEvent.setup();
  renderDialog("pt", onNewIncomeCreated);

  await user.type(screen.getByPlaceholderText(ptMessages.name), "Salary");
  const amount = screen.getByLabelText(ptMessages.amount, { exact: false });
  await user.clear(amount);
  await user.type(amount, "1.2.3");
  await user.click(screen.getByRole("button", { name: ptMessages["add-income"] }));

  await screen.findByText(ptMessages["invalid-amount"]);
  assert.equal(onNewIncomeCreated.mock.calls.length, 0);
});
