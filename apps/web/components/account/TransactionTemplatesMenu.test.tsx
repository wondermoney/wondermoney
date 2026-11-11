// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

import type { TransactionTemplate } from "@/lib/api/transaction-template/useTransactionTemplates";

import enTransactions from "../../messages/en/transactions.json";
import { TransactionTemplatesMenu } from "./TransactionTemplatesMenu";

const state = vi.hoisted(() => ({
  templates: [] as TransactionTemplate[],
  isLoading: false,
  isError: false,
}));

vi.mock("@/lib/api/transaction-template/useTransactionTemplates", () => ({
  default: () => ({
    data: state.isLoading || state.isError ? undefined : { templates: state.templates },
    isError: state.isError,
    isLoading: state.isLoading,
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  state.templates = [];
  state.isLoading = false;
  state.isError = false;
});

const template = (
  overrides: Partial<TransactionTemplate> = {},
): TransactionTemplate => ({
  account: null,
  amount: null,
  category: null,
  description: null,
  direction: "out",
  name: "Weekly groceries",
  notes: null,
  position: 0,
  transactionMerchant: null,
  transactionTemplateKey: 1,
  ...overrides,
});

function renderMenu() {
  const onSelect = vi.fn();
  const onCreate = vi.fn();
  render(
    <NextIntlClientProvider
      locale="en"
      messages={enTransactions}
      timeZone="UTC"
    >
      <TransactionTemplatesMenu onCreate={onCreate} onSelect={onSelect} />
    </NextIntlClientProvider>,
  );
  return { onCreate, onSelect };
}

test("choosing a template hands it to the form", async () => {
  const user = userEvent.setup();
  state.templates = [
    template(),
    template({ name: "Bus ticket", transactionTemplateKey: 2 }),
  ];
  const { onCreate, onSelect } = renderMenu();

  await user.click(screen.getByRole("button", { name: "Templates" }));
  await user.click(await screen.findByText("Bus ticket"));

  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Bus ticket", transactionTemplateKey: 2 }),
  );
  expect(onCreate).not.toHaveBeenCalled();
});

test("offers a new template even before any exists", async () => {
  const user = userEvent.setup();
  const { onCreate, onSelect } = renderMenu();

  await user.click(screen.getByRole("button", { name: "Templates" }));
  await user.click(await screen.findByText("New template"));

  expect(onCreate).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
});

test("stays out of the way when the API has no templates endpoint", () => {
  state.isError = true;
  renderMenu();

  assert.equal(screen.queryByRole("button", { name: "Templates" }), null);
});
