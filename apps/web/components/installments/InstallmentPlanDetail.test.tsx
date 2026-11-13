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
  link: vi.fn(),
  unlink: vi.fn(),
  transactionsRequest: undefined as unknown,
  transactions: [] as unknown[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock(
  "@/lib/api/installment-plans/useInstallmentPlanMutations",
  async (importOriginal) => ({
    installmentLinkError: (
      await importOriginal<
        typeof import("@/lib/api/installment-plans/useInstallmentPlanMutations")
      >()
    ).installmentLinkError,
    useDeleteInstallmentPlan: () => ({
      mutateAsync: state.deletePlan,
      isPending: false,
    }),
    useLinkInstallment: () => ({ mutateAsync: state.link, isPending: false }),
    useUnlinkInstallment: () => ({
      mutateAsync: state.unlink,
      isPending: false,
    }),
  }),
);
vi.mock("@/lib/api/account/useTransactions", () => ({
  default: (request: unknown) => {
    state.transactionsRequest = request;
    return {
      data: { transactions: state.transactions },
      isLoading: false,
      isError: false,
    };
  },
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
  state.link.mockReset();
  state.unlink.mockReset();
  state.transactions = [];
  state.transactionsRequest = undefined;
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

const charge = (
  transactionKey: number,
  day: string,
  amount: number,
  description: string,
) => ({
  transactionKey,
  transactionDate: `${day}T00:00:00.000Z`,
  settlementAmount: amount,
  description,
  hidden: false,
  installment: null,
});

const refusal = (status: number, code: string) =>
  Object.assign(new Error(code), { response: { status, data: { code } } });

describe("InstallmentPlanDetail manual links", () => {
  test("offers Link on unmatched and upcoming installments and Unlink on paid ones", () => {
    renderDetail();
    const rows = within(
      screen.getByRole("region", { name: "Schedule" }),
    ).getAllByRole("listitem");
    assert.ok(
      within(rows[0]!).getByRole("button", {
        name: "Unlink the transaction from installment 1 of 4",
      }),
    );
    assert.equal(
      within(rows[0]!).queryByRole("button", { name: /^Link transaction/ }),
      null,
    );
    for (const index of [1, 2, 3]) {
      assert.ok(
        within(rows[index]!).getByRole("button", {
          name: `Link transaction to installment ${index + 1} of 4`,
        }),
      );
    }
  });

  test("searches the card's posted charges near the day and links the chosen one", async () => {
    const user = userEvent.setup();
    state.transactions = [
      charge(501, "2026-10-04", -100, "LAPTOP 2/4"),
      charge(502, "2026-10-20", -60, "Groceries"),
      charge(503, "2026-10-12", -105, "Laptop shop"),
    ];
    state.link.mockResolvedValue(plan);
    renderDetail();

    await user.click(
      screen.getByRole("button", {
        name: "Link transaction to installment 2 of 4",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Link installment 2 of 4",
    });
    assert.deepEqual(state.transactionsRequest, {
      accountKeys: ["3"],
      fromDate: new Date(2026, 8, 4),
      toDate: new Date(2026, 10, 5),
      statuses: ["BOOKED"],
      direction: "out",
      limit: 500,
    });
    // Closest amount first; the 60.00 charge is not about the installment's amount.
    const options = within(dialog).getAllByRole("radio");
    assert.match(
      options[0]!.closest("label")?.textContent ?? "",
      /LAPTOP 2\/4/,
    );
    assert.match(
      options[1]!.closest("label")?.textContent ?? "",
      /Laptop shop.*€5\.00 more than the installment/,
    );
    assert.equal(options.length, 2);

    await user.click(
      within(dialog).getByRole("button", { name: "Show other amounts" }),
    );
    assert.equal(within(dialog).getAllByRole("radio").length, 3);

    const link = within(dialog).getByRole("button", { name: "Link" });
    assert.equal((link as HTMLButtonElement).disabled, true);
    await user.click(
      within(dialog).getByRole("radio", { name: /LAPTOP 2\/4/ }),
    );
    await user.click(link);

    assert.deepEqual(state.link.mock.calls, [
      [{ installmentPlanKey: 9, installmentNumber: 2, transactionKey: 501 }],
    ]);
    assert.equal(state.toastSuccess.mock.calls.length, 1);
    assert.equal(screen.queryByRole("dialog"), null);
  });

  test.each([
    [
      refusal(400, "bad_request"),
      "That transaction is not on this plan's card.",
    ],
    [refusal(409, "conflict"), /already pays an installment/],
    [refusal(404, "not_found"), /no longer exists/],
    [new Error("offline"), "The transaction could not be linked."],
  ])("says why the API refused a link (%s)", async (error, message) => {
    const user = userEvent.setup();
    state.transactions = [charge(501, "2026-10-04", -100, "LAPTOP 2/4")];
    state.link.mockRejectedValue(error);
    renderDetail();

    await user.click(
      screen.getByRole("button", {
        name: "Link transaction to installment 2 of 4",
      }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("radio"));
    await user.click(within(dialog).getByRole("button", { name: "Link" }));

    const alert = within(dialog).getByRole("alert");
    if (typeof message === "string") assert.equal(alert.textContent, message);
    else assert.match(alert.textContent ?? "", message);
    // The dialog stays, so another transaction can be chosen.
    assert.ok(screen.getByRole("dialog"));
  });

  test("says so when no charge fits", async () => {
    const user = userEvent.setup();
    state.transactions = [charge(502, "2026-10-20", -60, "Groceries")];
    renderDetail();
    await user.click(
      screen.getByRole("button", {
        name: "Link transaction to installment 2 of 4",
      }),
    );
    const dialog = screen.getByRole("dialog");
    assert.match(
      dialog.textContent ?? "",
      /No posted charge on this card fits this installment/,
    );
  });

  test("unlinks a paid installment only after confirmation", async () => {
    const user = userEvent.setup();
    state.unlink.mockResolvedValue(plan);
    renderDetail();

    await user.click(
      screen.getByRole("button", {
        name: "Unlink the transaction from installment 1 of 4",
      }),
    );
    assert.equal(state.unlink.mock.calls.length, 0);
    const dialog = screen.getByRole("alertdialog", {
      name: "Unlink installment 1 of 4?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Unlink" }));

    assert.deepEqual(state.unlink.mock.calls, [
      [{ installmentPlanKey: 9, installmentNumber: 1 }],
    ]);
    assert.equal(
      state.toastSuccess.mock.calls[0]?.[0],
      "Installment unlinked.",
    );
  });

  test("says when an unlink failed", async () => {
    const user = userEvent.setup();
    state.unlink.mockRejectedValue(new Error("offline"));
    renderDetail();
    await user.click(
      screen.getByRole("button", {
        name: "Unlink the transaction from installment 1 of 4",
      }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Unlink",
      }),
    );
    assert.equal(
      state.toastError.mock.calls[0]?.[0],
      "The installment could not be unlinked.",
    );
  });
});
