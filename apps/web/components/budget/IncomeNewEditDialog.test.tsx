// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
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
