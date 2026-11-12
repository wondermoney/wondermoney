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

import type { LoanDetail, LoanRatePeriod } from "@/lib/api/loan/types";

import loans from "../../messages/en/loans.json";
import LoanRateHistory from "./LoanRateHistory";

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  toastError: vi.fn(),
  periods: [] as LoanRatePeriod[],
}));
vi.mock("@/lib/api/loan/useLoanHistory", () => ({
  useLoanRatePeriods: () => ({
    data: { ratePeriods: mock.periods },
    isLoading: false,
    isError: false,
  }),
  useLoanRateMutations: () => ({
    create: { mutateAsync: mock.create, isPending: false },
    update: { mutateAsync: mock.update, isPending: false },
    remove: { mutateAsync: mock.remove, isPending: false },
  }),
}));
vi.mock("@/lib/api/errors", () => ({
  getApiErrorMessage: () =>
    "A rate period already exists for this effective date",
  isDemoReadOnlyError: () => false,
}));
vi.mock("sonner", () => ({ toast: { error: mock.toastError } }));
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

const loan: LoanDetail = {
  currency: { code: "EUR", currencyKey: 1 },
  includeInNetWorth: true,
  initialAnnualInterestRateBps: 300,
  loanKey: 5,
  name: "Home loan",
  openingPrincipalBalance: 1000,
  outstandingPrincipal: 1000,
  rateType: "VARIABLE",
  securedAsset: null,
  status: "ACTIVE",
  type: "MORTGAGE",
};

function renderHistory(locale = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={loans}>
      <LoanRateHistory loan={loan} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mock.periods = [];
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("adds a rate change, reading a localized percentage as basis points", async () => {
  renderHistory("pt");
  expect(screen.getByText(/No rate changes yet: 3%/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Pick a date"), {
    target: { value: "2026-06-01" },
  });
  fireEvent.change(screen.getByLabelText(/Annual interest rate/), {
    target: { value: "3,75" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add rate change" }));

  await waitFor(() =>
    expect(mock.create).toHaveBeenCalledWith({
      effectiveDate: "2026-06-01",
      annualInterestRateBps: 375,
    }),
  );
});

it("refuses a rate change without a date or with a rate over 100%", async () => {
  renderHistory();
  fireEvent.change(screen.getByLabelText(/Annual interest rate/), {
    target: { value: "101" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add rate change" }));

  expect(
    await screen.findByText("Pick the date it takes effect."),
  ).toBeTruthy();
  expect(screen.getByText("Rate must be between 0 and 100%.")).toBeTruthy();
  expect(mock.create).not.toHaveBeenCalled();
});

it("edits a listed rate change and reports a clash with another date", async () => {
  mock.periods = [
    {
      loanRatePeriodKey: 9,
      effectiveDate: "2026-01-01T00:00:00.000Z",
      annualInterestRateBps: 425,
    },
  ];
  mock.update.mockRejectedValue(new Error("409"));
  renderHistory();
  expect(screen.getByRole("listitem").textContent).toMatch(/4\.25%/);

  fireEvent.click(screen.getByRole("button", { name: "Edit rate change" }));
  expect((screen.getByLabelText("Pick a date") as HTMLInputElement).value).toBe(
    "2026-01-01",
  );
  fireEvent.change(screen.getByLabelText(/Annual interest rate/), {
    target: { value: "4.5" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save rate change" }));

  await waitFor(() =>
    expect(mock.update).toHaveBeenCalledWith({
      key: 9,
      body: { effectiveDate: "2026-01-01", annualInterestRateBps: 450 },
    }),
  );
  await waitFor(() =>
    expect(mock.toastError).toHaveBeenCalledWith(
      "A rate period already exists for this effective date",
    ),
  );
});

it("deletes a rate change only after confirmation", async () => {
  mock.periods = [
    {
      loanRatePeriodKey: 9,
      effectiveDate: "2026-01-01T00:00:00.000Z",
      annualInterestRateBps: 425,
    },
  ];
  renderHistory();
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
  fireEvent.click(screen.getByRole("button", { name: "Delete rate change" }));
  expect(mock.remove).not.toHaveBeenCalled();
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  fireEvent.click(screen.getByRole("button", { name: "Delete rate change" }));
  await waitFor(() => expect(mock.remove).toHaveBeenCalledWith(9));
});
