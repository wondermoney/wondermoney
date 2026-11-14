// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, test, vi } from "vitest";

import commonMessages from "../../messages/en/common.json";
import InstallmentPlanFormDialog from "./InstallmentPlanFormDialog";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api/installment-plans/useInstallmentPlanMutations", () => ({
  useCreateInstallmentPlan: () => ({
    mutateAsync: state.create,
    isPending: false,
  }),
  useUpdateInstallmentPlan: () => ({
    mutateAsync: state.update,
    isPending: false,
  }),
}));
vi.mock("@/components/CategorySelect", () => ({ default: () => null }));
vi.mock("sonner", () => ({
  toast: { error: state.toastError, success: state.toastSuccess },
}));

afterEach(() => {
  cleanup();
  state.create.mockReset();
  state.update.mockReset();
  state.toastError.mockReset();
  state.toastSuccess.mockReset();
});

function renderForm(onOpenChange = vi.fn()) {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={commonMessages}
      timeZone="UTC"
    >
      <InstallmentPlanFormDialog
        open
        onOpenChange={onOpenChange}
        mode={{ kind: "create", accountKey: 3, currency: "EUR" }}
        categories={[]}
      />
    </NextIntlClientProvider>,
  );
  return { onOpenChange };
}

const cents = (text: string) =>
  Math.round(Number(text.replace(/[^\d.]/g, "")) * 100);

describe("InstallmentPlanFormDialog", () => {
  test("previews each installment so the installments sum exactly to the total", async () => {
    const user = userEvent.setup();
    renderForm();

    const preview = screen.getByTestId("installment-preview");
    assert.match(
      preview.textContent ?? "",
      /Enter the total and the number of installments/,
    );

    await user.type(screen.getByLabelText(/Total amount/), "100");
    await user.type(screen.getByLabelText(/Number of installments/), "3");

    const text = preview.textContent ?? "";
    const match =
      /(\d+) installments of (€[\d.,]+) and a last one of (€[\d.,]+)/.exec(
        text,
      );
    assert.ok(match, text);
    const [, regularCount, regular, last] = match;
    assert.equal(Number(regularCount), 2);
    assert.equal(regular, "€33.33");
    assert.equal(last, "€33.34");
    assert.equal(Number(regularCount) * cents(regular!) + cents(last!), 10000);
  });

  test("an even split shows one figure", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Total amount/), "1200");
    await user.type(screen.getByLabelText(/Number of installments/), "12");

    assert.match(
      screen.getByTestId("installment-preview").textContent ?? "",
      /12 installments of €100\.00/,
    );
  });

  test("creates the plan with the typed figures, and refuses a count outside 2 to 120", async () => {
    const user = userEvent.setup();
    state.create.mockResolvedValue({ installmentPlanKey: 1 });
    const { onOpenChange } = renderForm();

    await user.type(screen.getByLabelText(/Description/), "Phone");
    const date = screen.getByLabelText(/Purchase date/);
    await user.clear(date);
    await user.type(date, "2026-10-02");
    await user.type(screen.getByLabelText(/Total amount/), "999.99");
    const count = screen.getByLabelText(/Number of installments/);
    await user.type(count, "121");
    await user.click(screen.getByRole("button", { name: "Create plan" }));

    assert.ok(screen.getByText("Enter a whole number from 2 to 120."));
    assert.equal(state.create.mock.calls.length, 0);

    await user.clear(count);
    await user.type(count, "7");
    await user.click(screen.getByRole("button", { name: "Create plan" }));

    assert.deepEqual(state.create.mock.calls, [
      [
        {
          accountKey: 3,
          description: "Phone",
          purchaseDate: "2026-10-02",
          totalAmount: 999.99,
          installmentCount: 7,
          categoryKey: null,
        },
      ],
    ]);
    assert.deepEqual(onOpenChange.mock.calls.at(-1), [false]);
  });
});
