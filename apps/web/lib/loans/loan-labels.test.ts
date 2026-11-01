import assert from "node:assert/strict";

import { test } from "vitest";

import type { LoanStatus, LoanType } from "@/lib/api/loan/types";

import enLoans from "../../messages/en/loans.json";
import esLoans from "../../messages/es/loans.json";
import ptLoans from "../../messages/pt/loans.json";
import { LOAN_STATUS_LABEL_KEY, LOAN_TYPE_LABEL_KEY } from "./loan-labels";

const ALL_TYPES = Object.keys(LOAN_TYPE_LABEL_KEY) as LoanType[];
const ALL_STATUSES = Object.keys(LOAN_STATUS_LABEL_KEY) as LoanStatus[];

const catalogs = { en: enLoans, pt: ptLoans, es: esLoans } as const;

test("every loan type has its own label, so no type is shown as another", () => {
  assert.equal(
    new Set(ALL_TYPES.map((type) => LOAN_TYPE_LABEL_KEY[type])).size,
    ALL_TYPES.length,
  );
});

test("a paid-off loan is labelled as paid", () => {
  assert.equal(LOAN_STATUS_LABEL_KEY.PAID_OFF, "paid");
});

for (const [locale, messages] of Object.entries(catalogs)) {
  test(`every loan type and status label is translated (${locale})`, () => {
    const { types, statuses } = messages.loans as {
      types: Record<string, string>;
      statuses: Record<string, string>;
    };
    for (const type of ALL_TYPES) {
      assert.ok(
        types[LOAN_TYPE_LABEL_KEY[type]]?.trim(),
        `${locale}: loans.types for ${type}`,
      );
    }
    for (const status of ALL_STATUSES) {
      assert.ok(
        statuses[LOAN_STATUS_LABEL_KEY[status]]?.trim(),
        `${locale}: loans.statuses for ${status}`,
      );
    }
  });
}
