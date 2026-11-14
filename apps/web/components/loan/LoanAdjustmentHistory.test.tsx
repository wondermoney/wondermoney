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

import messages from "../../messages/en/loans.json";
import LoanAdjustmentHistory from "./LoanAdjustmentHistory";

const mock = vi.hoisted(() => ({
  remove: vi.fn(),
  state: {
    adjustments: [] as LoanAdjustment[],
    isError: false,
  },
}));
vi.mock("@/lib/api/loan/useLoanHistory", () => ({
  useLoanAdjustments: () => ({
    data: { adjustments: mock.state.adjustments },
    isLoading: false,
    isError: mock.state.isError,
  }),
  useLoanAdjustmentMutations: () => ({
    remove: { mutateAsync: mock.remove, isPending: false },
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

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
const correction: LoanAdjustment = {
  loanAdjustmentKey: 3,
  type: "BALANCE_CORRECTION",
  effectiveDate: "2026-03-01T00:00:00.000Z",
  amount: 700,
  reason: "Lender statement",
};
const fee: LoanAdjustment = {
  loanAdjustmentKey: 4,
  type: "FEE",
  effectiveDate: "2026-04-01T00:00:00.000Z",
  amount: 25,
  reason: null,
};

function renderHistory(handlers = { onAdd: vi.fn(), onEdit: vi.fn() }) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LoanAdjustmentHistory loan={loan} {...handlers} />
    </NextIntlClientProvider>,
  );
  return handlers;
}

afterEach(() => {
  cleanup();
  mock.state.adjustments = [];
  mock.state.isError = false;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("shows each adjustment with what it does to the balance", () => {
  mock.state.adjustments = [correction, fee];
  renderHistory();

  const [first, second] = screen.getAllByRole("listitem");
  expect(first?.textContent).toContain("Correct balance");
  expect(first?.textContent).toContain("Lender statement");
  expect(first?.textContent).toMatch(/Set to.*700\.00/);
  expect(second?.textContent).toContain("Fee");
  expect(second?.textContent).toMatch(/\+.*25\.00/);
  expect(second?.textContent).toContain("Increases the balance by");
});

it("opens an adjustment for editing and deletes one only after confirmation", async () => {
  mock.state.adjustments = [correction];
  const handlers = renderHistory();

  fireEvent.click(screen.getByRole("button", { name: "Edit adjustment" }));
  expect(handlers.onEdit).toHaveBeenCalledWith(correction);

  vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
  fireEvent.click(screen.getByRole("button", { name: "Delete adjustment" }));
  expect(mock.remove).not.toHaveBeenCalled();
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  fireEvent.click(screen.getByRole("button", { name: "Delete adjustment" }));
  await waitFor(() => expect(mock.remove).toHaveBeenCalledWith(3));
});

it("invites the first adjustment when there is none, and says when loading failed", () => {
  const handlers = renderHistory();
  fireEvent.click(screen.getByRole("button", { name: "Add adjustment" }));
  expect(handlers.onAdd).toHaveBeenCalled();

  cleanup();
  mock.state.isError = true;
  renderHistory();
  expect(screen.getByRole("alert").textContent).toBe(
    "Could not load adjustments.",
  );
});
