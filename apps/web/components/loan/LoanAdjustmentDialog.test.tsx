// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";

import type { LoanAdjustment, LoanDetail } from "@/lib/api/loan/types";

import loans from "../../messages/en/loans.json";
import LoanAdjustmentDialog from "./LoanAdjustmentDialog";

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/lib/api/loan/useLoanHistory", () => ({
  useLoanAdjustmentMutations: () => ({
    create: { mutateAsync: mock.create, isPending: false },
    update: { mutateAsync: mock.update, isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock("@/lib/api/errors", () => ({
  getApiErrorMessage: () => "API unavailable",
  isDemoReadOnlyError: (error: unknown) => error === "demo",
}));
vi.mock("sonner", () => ({ toast: { error: mock.toastError } }));
vi.mock("@/components/ui/dialog-responsive", () => ({
  DrawerDialog: ({
    children,
    footer,
  }: {
    children: React.ReactNode;
    footer: React.ReactNode;
  }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
// The calendar popover is the date picker's own concern; a text box stands in for it.
vi.mock("@/components/ui/DatePicker", () => ({
  default: ({
    value,
    onSelect,
  }: {
    value?: Date;
    onSelect: (date: Date | undefined) => void;
  }) => (
    <input
      aria-label="Pick a date"
      value={
        value
          ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
          : ""
      }
      onChange={(event) => {
        const [year, month, day] = event.target.value.split("-").map(Number);
        onSelect(new Date(year, month - 1, day));
      }}
    />
  ),
}));

const messages = {
  ...loans,
  "demo-read-only-title": "Read-only demo",
  "demo-read-only-description": "Changes are off.",
};
const loan: LoanDetail = {
  currency: { code: "EUR", currencyKey: 1 },
  includeInNetWorth: true,
  loanKey: 5,
  name: "Home loan",
  openingPrincipalBalance: 1000,
  outstandingPrincipal: 1000,
  securedAsset: null,
  status: "ACTIVE",
  type: "MORTGAGE",
};

function renderDialog(adjustment?: LoanAdjustment, locale = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <LoanAdjustmentDialog
        open
        onOpenChange={() => {}}
        loan={loan}
        adjustment={adjustment}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("records a correction of the balance to zero on the chosen date", async () => {
  renderDialog();
  fireEvent.change(screen.getByLabelText("Pick a date"), {
    target: { value: "2026-04-03" },
  });
  fireEvent.change(screen.getByLabelText(/Balance on this date/), {
    target: { value: "0" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add adjustment" }));

  await waitFor(() =>
    expect(mock.create).toHaveBeenCalledWith({
      type: "BALANCE_CORRECTION",
      effectiveDate: "2026-04-03",
      amount: 0,
      reason: null,
    }),
  );
});

it("refuses a zero amount for a change that is not a correction", async () => {
  renderDialog({
    loanAdjustmentKey: 8,
    type: "FEE",
    effectiveDate: "2026-01-01T00:00:00.000Z",
    amount: 12,
    reason: "Old",
  });
  fireEvent.change(screen.getByLabelText(/^Amount/), {
    target: { value: "0" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));

  expect(
    await screen.findByText("Enter an amount greater than zero."),
  ).toBeTruthy();
  expect(mock.update).not.toHaveBeenCalled();
});

it("edits an adjustment, reading the amount in the reader's locale", async () => {
  renderDialog(
    {
      loanAdjustmentKey: 8,
      type: "FEE",
      effectiveDate: "2026-01-01T00:00:00.000Z",
      amount: 12,
      reason: "Old",
    },
    "pt",
  );
  expect((screen.getByLabelText("Pick a date") as HTMLInputElement).value).toBe(
    "2026-01-01",
  );
  fireEvent.change(screen.getByLabelText(/^Amount/), {
    target: { value: "1.234,5" },
  });
  fireEvent.change(screen.getByLabelText("Reason (optional)"), {
    target: { value: "  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));

  await waitFor(() =>
    expect(mock.update).toHaveBeenCalledWith({
      key: 8,
      body: {
        type: "FEE",
        effectiveDate: "2026-01-01",
        amount: 1234.5,
        reason: null,
      },
    }),
  );
});

it.each([
  [new Error("bad request"), "API unavailable"],
  ["demo", "Read-only demo"],
])("says why a save failed (%s)", async (error, message) => {
  mock.create.mockRejectedValue(error);
  renderDialog();
  fireEvent.change(screen.getByLabelText(/Balance on this date/), {
    target: { value: "500" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add adjustment" }));

  await waitFor(() => expect(mock.toastError).toHaveBeenCalled());
  expect(mock.toastError.mock.calls[0]?.[0]).toBe(message);
});
