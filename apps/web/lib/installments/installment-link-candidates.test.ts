import assert from "node:assert/strict";

import { describe, test } from "vitest";

import type {
  Installment,
  InstallmentPlanDetail,
} from "@/lib/api/installment-plans/types";

import {
  amountTolerance,
  installmentTargets,
  isLinkableRow,
  linkCandidates,
  linkSearchWindow,
} from "./installment-link-candidates";

const row = (
  transactionKey: number,
  transactionDate: string,
  settlementAmount: number,
  fields: { hidden?: boolean; installment?: unknown } = {},
) => ({
  transactionKey,
  transactionDate: `${transactionDate}T00:00:00.000Z`,
  settlementAmount,
  ...fields,
});

const installment = (fields: Partial<Installment> = {}): Installment => ({
  installmentNumber: 3,
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

describe("linkCandidates", () => {
  test("keeps charges of about the installment's amount near its day, closest first", () => {
    const rows = [
      row(1, "2026-10-20", -104),
      row(2, "2026-10-06", -100),
      row(3, "2026-10-01", -100),
      row(4, "2026-10-05", -150), // another amount
      row(5, "2026-12-01", -100), // two months off
      row(6, "2026-10-05", 100), // money in
      row(7, "2026-10-05", -100, { hidden: true }),
      row(8, "2026-10-05", -100, { installment: { installmentNumber: 1 } }),
      row(-1, "2026-10-05", -100), // a synthetic opening-balance row
    ];
    const keys = linkCandidates(rows, installment()).map(
      (candidate) => candidate.row.transactionKey,
    );
    assert.deepEqual(keys, [2, 3, 1]);
  });

  test("with other amounts on, shows every charge in the window, and by how much each differs", () => {
    const rows = [row(4, "2026-10-05", -150), row(2, "2026-10-06", -100)];
    const candidates = linkCandidates(rows, installment(), {
      showAllAmounts: true,
    });
    assert.deepEqual(
      candidates.map((candidate) => [
        candidate.row.transactionKey,
        candidate.amount,
        candidate.amountDifference,
        candidate.dayDistance,
      ]),
      [
        [2, 100, 0, 1],
        [4, 150, 50, 0],
      ],
    );
  });

  test("the tolerance is 10% of the installment, at least one unit", () => {
    assert.equal(amountTolerance(100), 10);
    assert.equal(amountTolerance(4), 1);
    const close = linkCandidates(
      [row(1, "2026-10-05", -4.99), row(2, "2026-10-05", -5.01)],
      installment({ amount: 4 }),
    );
    assert.deepEqual(
      close.map((candidate) => candidate.row.transactionKey),
      [1],
    );
  });
});

test("the search window is a month either side of the scheduled day, on the local calendar", () => {
  const { fromDate, toDate } = linkSearchWindow("2026-10-05");
  assert.deepEqual(
    [fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()],
    [2026, 8, 4],
  );
  assert.deepEqual(
    [toDate.getFullYear(), toDate.getMonth(), toDate.getDate()],
    [2026, 10, 5],
  );
});

test("only a real, visible charge that pays no installment can be linked", () => {
  assert.equal(isLinkableRow(row(1, "2026-10-05", -10)), true);
  assert.equal(isLinkableRow(row(1, "2026-10-05", 10)), false);
  assert.equal(isLinkableRow(row(0, "2026-10-05", -10)), false);
  assert.equal(
    isLinkableRow(row(1, "2026-10-05", -10, { installment: {} })),
    false,
  );
});

describe("installmentTargets", () => {
  const plan = (
    installmentPlanKey: number,
    installments: Installment[],
  ): InstallmentPlanDetail => ({
    installmentPlanKey,
    accountKey: 3,
    accountName: "Visa",
    currency: "EUR",
    description: `Plan ${installmentPlanKey}`,
    purchaseDate: "2026-08-01",
    totalAmount: 400,
    installmentCount: 4,
    categoryKey: null,
    paidCount: 0,
    paidAmount: 0,
    remainingCount: 0,
    remainingAmount: 0,
    unmatchedCount: 0,
    nextInstallment: null,
    installments,
  });

  const plans = [
    plan(1, [
      installment({
        installmentNumber: 1,
        scheduledDate: "2026-09-05",
        status: "paid",
      }),
      installment({ installmentNumber: 2, scheduledDate: "2026-10-05" }),
      installment({
        installmentNumber: 3,
        scheduledDate: "2026-11-15",
        status: "upcoming",
      }),
    ]),
    plan(2, [
      installment({
        installmentNumber: 1,
        amount: 40,
        scheduledDate: "2026-10-07",
      }),
    ]),
  ];

  test("offers the open installments of about the charge's amount near its day, never a paid one", () => {
    const targets = installmentTargets(plans, row(9, "2026-10-06", -100));
    assert.deepEqual(
      targets.map((target) => [
        target.plan.installmentPlanKey,
        target.installment.installmentNumber,
      ]),
      [[1, 2]],
    );
  });

  test("shows every open installment when asked, closest first", () => {
    const targets = installmentTargets(plans, row(9, "2026-10-06", -100), {
      showAllAmounts: true,
    });
    assert.deepEqual(
      targets.map((target) => [
        target.plan.installmentPlanKey,
        target.installment.installmentNumber,
      ]),
      [
        [1, 2],
        [1, 3],
        [2, 1],
      ],
    );
  });
});
