// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, test, vi } from "vitest";

import type {
  InstallmentCommitment,
  InstallmentPlan,
  InstallmentSuggestion,
} from "@/lib/api/installment-plans/types";

import commonMessages from "../../messages/en/common.json";
import CardInstallments from "./CardInstallments";

const state = vi.hoisted(() => ({
  plans: [] as unknown[],
  commitments: [] as unknown[],
  suggestions: [] as unknown[],
  create: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api/installment-plans/useInstallmentPlans", () => ({
  default: () => ({
    data: { installmentPlans: state.plans },
    isLoading: false,
  }),
  useInstallmentCommitments: () => ({
    data: { commitments: state.commitments },
    isLoading: false,
  }),
  useInstallmentSuggestions: () => ({
    data: { suggestions: state.suggestions },
    isLoading: false,
  }),
}));
vi.mock("@/lib/api/installment-plans/useInstallmentPlanMutations", () => ({
  useCreateInstallmentPlan: () => ({
    mutateAsync: state.create,
    isPending: false,
  }),
  useUpdateInstallmentPlan: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// The category picker needs matchMedia and a router; the category is optional here.
vi.mock("@/components/CategorySelect", () => ({ default: () => null }));
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
  state.plans = [];
  state.commitments = [];
  state.suggestions = [];
  state.create.mockReset();
  state.toastError.mockReset();
  state.toastSuccess.mockReset();
});

const plan: InstallmentPlan = {
  installmentPlanKey: 9,
  accountKey: 3,
  accountName: "Visa",
  currency: "EUR",
  description: "Laptop",
  purchaseDate: "2026-09-01",
  totalAmount: 1200,
  installmentCount: 12,
  categoryKey: null,
  paidCount: 3,
  paidAmount: 300,
  remainingCount: 9,
  remainingAmount: 900,
  unmatchedCount: 0,
  nextInstallment: {
    installmentNumber: 4,
    amount: 100,
    scheduledDate: "2026-12-05",
    statementDate: null,
    dueDate: null,
    status: "upcoming",
    transactionKey: null,
    postedAmount: null,
    postedDate: null,
  },
};

const commitment: InstallmentCommitment = {
  accountKey: 3,
  accountName: "Visa",
  currency: "EUR",
  remainingAmount: 958.5,
  remainingCount: 11,
  activePlanCount: 2,
  nextInstallment: {
    amount: 100,
    date: "2026-12-05",
    installmentPlanKey: 9,
    installmentNumber: 4,
    installmentCount: 12,
    description: "Laptop",
  },
};

const suggestion: InstallmentSuggestion = {
  key: "3-sofa",
  accountKey: 3,
  accountName: "Visa",
  currency: "EUR",
  description: "Sofa shop",
  installmentCount: 6,
  installmentAmount: 50,
  totalAmount: 300,
  purchaseDate: "2026-08-14",
  transactions: [
    {
      transactionKey: 501,
      installmentNumber: 1,
      amount: 50,
      transactionDate: "2026-08-14",
      description: "SOFA SHOP 1/6",
    },
    {
      transactionKey: 502,
      installmentNumber: 2,
      amount: 50,
      transactionDate: "2026-09-14",
      description: "SOFA SHOP 2/6",
    },
  ],
};

function renderSection({ readOnly = false }: { readOnly?: boolean } = {}) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={commonMessages}
      timeZone="UTC"
    >
      <CardInstallments
        accountKey={3}
        currency="EUR"
        categories={[]}
        readOnly={readOnly}
      />
    </NextIntlClientProvider>,
  );
}

describe("CardInstallments", () => {
  test("shows the card's remaining commitment and its plans, each linking to its detail", () => {
    state.plans = [plan];
    state.commitments = [
      { ...commitment, accountKey: 4, remainingAmount: 1 },
      commitment,
    ];
    const { container } = renderSection();

    const text = container.textContent ?? "";
    assert.match(text, /Still to be charged€958\.50/);
    assert.match(text, /11 installments across 2 plans/);
    assert.match(text, /Laptop, 4\/12/);
    assert.match(text, /3 of 12 paid/);

    const link = screen.getByRole("link", { name: /Laptop/ });
    assert.equal(link.getAttribute("href"), "/accounts/installment-plans/9");
    assert.match(link.textContent ?? "", /€900\.00/);
  });

  test("a card shared to view only shows its plans but offers no new plan or suggestion", () => {
    state.plans = [plan];
    state.suggestions = [suggestion];
    renderSection({ readOnly: true });
    assert.ok(screen.getByText(plan.description));
    assert.equal(
      screen.queryByRole("button", { name: "New installment plan" }),
      null,
    );
    assert.equal(screen.queryByRole("button", { name: "Create plan" }), null);
  });

  test("a card with no plan says so and still offers a new one", () => {
    renderSection();
    assert.ok(screen.getByText("No installment plans on this card."));
    assert.ok(screen.getByRole("button", { name: "New installment plan" }));
    assert.equal(screen.queryByText(/Still to be charged/), null);
  });

  test("accepting a suggestion opens the form pre-filled and sends the suggestion's links", async () => {
    const user = userEvent.setup();
    state.suggestions = [suggestion];
    state.create.mockResolvedValue({ ...plan, installments: [] });
    renderSection();

    const suggestions = screen.getByRole("region", {
      name: "Possible installment purchases",
    });
    assert.match(
      suggestions.textContent ?? "",
      /6 installments of €50\.00, total €300\.00/,
    );
    // Never automatic: nothing is created until the person asks.
    assert.equal(state.create.mock.calls.length, 0);

    await user.click(
      within(suggestions).getByRole("button", { name: "Create plan" }),
    );

    const dialog = screen.getByRole("dialog");
    assert.equal(
      (within(dialog).getByLabelText(/Description/) as HTMLInputElement).value,
      "Sofa shop",
    );
    assert.match(
      dialog.textContent ?? "",
      /2 transactions already on the card will be linked/,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create plan" }),
    );

    assert.deepEqual(state.create.mock.calls, [
      [
        {
          accountKey: 3,
          description: "Sofa shop",
          purchaseDate: "2026-08-14",
          totalAmount: 300,
          installmentCount: 6,
          categoryKey: null,
          links: [
            { transactionKey: 501, installmentNumber: 1 },
            { transactionKey: 502, installmentNumber: 2 },
          ],
        },
      ],
    ]);
    assert.equal(state.toastSuccess.mock.calls.length, 1);
  });
});
