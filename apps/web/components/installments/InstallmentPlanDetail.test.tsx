// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, test, vi } from "vitest";

import type {
  Installment,
  InstallmentPlanDetail as PlanData,
} from "@/lib/api/installment-plans/types";

import commonMessages from "../../messages/en/common.json";
import InstallmentPlanDetail from "./InstallmentPlanDetail";

const state = vi.hoisted(() => ({
  deletePlan: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api/installment-plans/useInstallmentPlanMutations", () => ({
  useDeleteInstallmentPlan: () => ({
    mutateAsync: state.deletePlan,
    isPending: false,
  }),
}));
// The edit form has its own test; here it only needs to be closed.
vi.mock("./InstallmentPlanFormDialog", () => ({ default: () => null }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({
  toast: { error: state.toastError, success: state.toastSuccess },
}));

afterEach(() => {
  cleanup();
  state.deletePlan.mockReset();
  state.toastError.mockReset();
  state.toastSuccess.mockReset();
});

const installment = (fields: Partial<Installment>): Installment => ({
  installmentNumber: 1,
  amount: 100,
  scheduledDate: "2026-09-05",
  statementDate: "2026-09-28",
  dueDate: "2026-10-10",
  status: "upcoming",
  transactionKey: null,
  postedAmount: null,
  postedDate: null,
  ...fields,
});

const plan: PlanData = {
  installmentPlanKey: 9,
  accountKey: 3,
  accountName: "Visa",
  currency: "EUR",
  description: "Laptop",
  purchaseDate: "2026-09-01",
  totalAmount: 400,
  installmentCount: 4,
  categoryKey: null,
  paidCount: 1,
  paidAmount: 100,
  remainingCount: 2,
  remainingAmount: 200,
  unmatchedCount: 1,
  nextInstallment: null,
  installments: [
    installment({
      installmentNumber: 1,
      scheduledDate: "2026-09-05",
      status: "paid",
      transactionKey: 77,
      postedAmount: 100,
      postedDate: "2026-09-06",
    }),
    installment({
      installmentNumber: 2,
      scheduledDate: "2026-10-05",
      status: "unmatched",
      statementDate: null,
      dueDate: null,
    }),
    installment({ installmentNumber: 3, scheduledDate: "2026-11-30" }),
    installment({ installmentNumber: 4, scheduledDate: "2026-12-30" }),
  ],
};
plan.nextInstallment = plan.installments[2]!;

function renderDetail(onDeleted = vi.fn()) {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={commonMessages}
      timeZone="UTC"
    >
      <InstallmentPlanDetail
        plan={plan}
        categories={[]}
        onDeleted={onDeleted}
      />
    </NextIntlClientProvider>,
  );
  return { onDeleted };
}

describe("InstallmentPlanDetail", () => {
  test("shows paid and upcoming installments, each with its status in words", () => {
    renderDetail();

    assert.ok(screen.getByRole("heading", { name: "Laptop" }));
    const schedule = screen.getByRole("region", { name: "Schedule" });
    const rows = within(schedule).getAllByRole("listitem");
    assert.deepEqual(
      rows.map((row) => row.getAttribute("data-status")),
      ["paid", "unmatched", "upcoming", "upcoming"],
    );
    assert.match(rows[0]!.textContent ?? "", /Installment 1 of 4/);
    assert.match(rows[0]!.textContent ?? "", /Paid/);
    assert.match(rows[0]!.textContent ?? "", /Posted €100\.00 on/);
    assert.match(rows[0]!.textContent ?? "", /Statement due/);
    assert.match(rows[1]!.textContent ?? "", /Not matched/);
    assert.doesNotMatch(rows[1]!.textContent ?? "", /Statement due|Posted/);
    assert.match(rows[2]!.textContent ?? "", /Upcoming/);
    assert.doesNotMatch(rows[2]!.textContent ?? "", /Posted/);
  });

  test("shows the paid and remaining amounts and counts", () => {
    const { container } = render(
      <NextIntlClientProvider
        locale="en"
        messages={commonMessages}
        timeZone="UTC"
      >
        <InstallmentPlanDetail plan={plan} categories={[]} />
      </NextIntlClientProvider>,
    );
    const text = container.textContent ?? "";
    assert.match(text, /Paid€100\.001 installment/);
    assert.match(text, /To come€200\.002 installments/);
    assert.match(text, /1 past installment has no matching transaction/);
    assert.ok(screen.getByRole("link", { name: /Visa/ }));
  });

  test("deletes the plan only after confirmation", async () => {
    const user = userEvent.setup();
    state.deletePlan.mockResolvedValue(9);
    const { onDeleted } = renderDetail();

    await user.click(screen.getByRole("button", { name: "Delete plan" }));
    assert.equal(state.deletePlan.mock.calls.length, 0);
    const dialog = screen.getByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete plan" }),
    );

    assert.deepEqual(state.deletePlan.mock.calls, [[9]]);
    assert.equal(onDeleted.mock.calls.length, 1);
    assert.equal(state.toastSuccess.mock.calls.length, 1);
  });
});
