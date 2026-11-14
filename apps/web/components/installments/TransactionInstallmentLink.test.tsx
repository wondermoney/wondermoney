// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, test, vi } from "vitest";

import type {
  Installment,
  InstallmentPlan,
  InstallmentPlanDetail,
} from "@/lib/api/installment-plans/types";

import commonMessages from "../../messages/en/common.json";
import { TransactionInstallmentLinkAction } from "./TransactionInstallmentLink";

const state = vi.hoisted(() => ({
  plans: [] as unknown[],
  details: new Map<number, unknown>(),
  link: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock(
  "@/lib/api/installment-plans/useInstallmentPlans",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/api/installment-plans/useInstallmentPlans")
      >();
    return {
      ...actual,
      default: (_accountId: number, options?: { enabled?: boolean }) => ({
        data:
          options?.enabled === false
            ? undefined
            : { installmentPlans: state.plans },
      }),
      getInstallmentPlan: async (planKey: number) => ({
        installmentPlan: state.details.get(planKey),
      }),
    };
  },
);
vi.mock(
  "@/lib/api/installment-plans/useInstallmentPlanMutations",
  async (importOriginal) => ({
    installmentLinkError: (
      await importOriginal<
        typeof import("@/lib/api/installment-plans/useInstallmentPlanMutations")
      >()
    ).installmentLinkError,
    useLinkInstallment: () => ({ mutateAsync: state.link, isPending: false }),
  }),
);
vi.mock("sonner", () => ({
  toast: { error: state.toastError, success: state.toastSuccess },
}));

afterEach(() => {
  cleanup();
  state.link.mockReset();
  state.toastSuccess.mockReset();
  state.plans = [];
  state.details.clear();
});

const installment = (fields: Partial<Installment>): Installment => ({
  installmentNumber: 1,
  amount: 100,
  scheduledDate: "2026-10-05",
  statementDate: null,
  dueDate: null,
  status: "unmatched",
  transactionKey: null,
  postedAmount: null,
  postedDate: null,
  ...fields,
});

const detail: InstallmentPlanDetail = {
  installmentPlanKey: 9,
  accountKey: 3,
  accountName: "Visa",
  currency: "EUR",
  description: "Laptop",
  purchaseDate: "2026-09-01",
  totalAmount: 300,
  installmentCount: 3,
  categoryKey: null,
  paidCount: 1,
  paidAmount: 100,
  remainingCount: 1,
  remainingAmount: 100,
  unmatchedCount: 1,
  nextInstallment: null,
  installments: [
    installment({
      installmentNumber: 1,
      scheduledDate: "2026-09-05",
      status: "paid",
    }),
    installment({ installmentNumber: 2, scheduledDate: "2026-10-05" }),
    installment({
      installmentNumber: 3,
      scheduledDate: "2026-11-30",
      status: "upcoming",
    }),
  ],
};
const { installments: _installments, ...summary } = detail;

const transaction = (fields: Record<string, unknown> = {}) => ({
  transactionKey: 77,
  transactionDate: "2026-10-06T00:00:00.000Z",
  settlementAmount: -100,
  hidden: false,
  installment: null,
  accountKey: {
    accountKey: 3,
    accountName: "Visa",
    currencyKey: { code: "EUR" as const },
  },
  ...fields,
});

function renderAction(row = transaction(), onLinked = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale="en"
        messages={commonMessages}
        timeZone="UTC"
      >
        <TransactionInstallmentLinkAction
          transaction={row}
          onLinked={onLinked}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onLinked };
}

describe("TransactionInstallmentLinkAction", () => {
  test("is offered only on a charge that pays no installment, on a card with open plans", () => {
    state.plans = [summary satisfies InstallmentPlan];
    renderAction();
    assert.ok(screen.getByRole("button", { name: "Link to installment" }));
    cleanup();

    renderAction(
      transaction({
        installment: {
          installmentPlanKey: 9,
          installmentNumber: 1,
          installmentCount: 3,
        },
      }),
    );
    assert.equal(
      screen.queryByRole("button", { name: "Link to installment" }),
      null,
    );
    cleanup();

    renderAction(transaction({ settlementAmount: 100 }));
    assert.equal(
      screen.queryByRole("button", { name: "Link to installment" }),
      null,
    );
    cleanup();

    state.plans = [{ ...summary, remainingCount: 0, unmatchedCount: 0 }];
    renderAction();
    assert.equal(
      screen.queryByRole("button", { name: "Link to installment" }),
      null,
    );
  });

  test("lists the open installments the charge could pay and links the chosen one", async () => {
    const user = userEvent.setup();
    state.plans = [summary];
    state.details.set(9, detail);
    state.link.mockResolvedValue(detail);
    const { onLinked } = renderAction();

    await user.click(
      screen.getByRole("button", { name: "Link to installment" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Link to an installment",
    });
    const options = await within(dialog).findAllByRole("radio");
    // Installment 3 is two months off and the paid one is never offered.
    assert.equal(options.length, 1);
    assert.match(
      options[0]!.closest("label")?.textContent ?? "",
      /Laptop, installment 2 of 3/,
    );

    await user.click(
      within(dialog).getByRole("button", {
        name: "Show all open installments",
      }),
    );
    assert.equal(within(dialog).getAllByRole("radio").length, 2);

    await user.click(
      within(dialog).getByRole("radio", { name: /installment 2 of 3/ }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Link" }));

    assert.deepEqual(state.link.mock.calls, [
      [{ installmentPlanKey: 9, installmentNumber: 2, transactionKey: 77 }],
    ]);
    assert.deepEqual(onLinked.mock.calls, [
      [{ installmentPlanKey: 9, installmentNumber: 2, installmentCount: 3 }],
    ]);
  });

  test("says why the API refused", async () => {
    const user = userEvent.setup();
    state.plans = [summary];
    state.details.set(9, detail);
    state.link.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        response: { status: 409, data: { code: "conflict" } },
      }),
    );
    renderAction();

    await user.click(
      screen.getByRole("button", { name: "Link to installment" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("radio"));
    await user.click(within(dialog).getByRole("button", { name: "Link" }));
    assert.match(
      within(dialog).getByRole("alert").textContent ?? "",
      /already pays an installment/,
    );
  });
});
