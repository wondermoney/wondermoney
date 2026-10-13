/**
 * Guards what RAD-571 fixed in the loans module.
 *
 * The module shipped without ever being moved onto the primitives the rest of
 * the app uses, so it was the last surface formatting money the English way for
 * Portuguese and Spanish readers, and the only one printing a raw enum where a
 * translated label already existed.
 *
 * 1. **Money goes through `<Amount>`.** `formatCurrency` passes `undefined` for
 *    locale, so `Intl` falls back to the *runtime's* default rather than the
 *    active one — `€185,000.00` on `/pt/loans` instead of `185.000,00 €`. The
 *    bug is invisible in `en` and invisible on a machine whose system locale is
 *    Portuguese, which is why this asserts the import rather than the output.
 * 2. **Enums resolve through one shared map.** LoansTable printed
 *    `row.original.type` directly; LoanAssumptionsCard kept a private map that
 *    collapsed four of the five types onto the wrong label.
 * 3. **Every mapped key exists in all three locales.**
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { LoanStatus, LoanType } from "../lib/api/loan/types";
import {
  LOAN_STATUS_LABEL_KEY,
  LOAN_TYPE_LABEL_KEY,
} from "../lib/loans/loan-labels";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(join(root, relativePath), "utf8");

const LOCALES = ["en", "pt", "es"] as const;

// --- 1. the locale premise the fix rests on --------------------------------

const symbolSuffixes = (locale: string) => {
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).formatToParts(185000);
  return (
    parts.findIndex((part) => part.type === "currency") >
    parts.findIndex((part) => part.type === "integer")
  );
};

assert.ok(
  !symbolSuffixes("en-IE"),
  "en is expected to prefix the currency symbol — the premise of this guard",
);
for (const locale of ["pt-PT", "es-ES"] as const) {
  assert.ok(
    symbolSuffixes(locale),
    `${locale} must suffix the currency symbol; a loans figure rendered with the English default is the RAD-571 bug`,
  );
}

// --- 2. no loans surface formats money without a locale --------------------

const MONEY_SURFACES = [
  "components/loan/LoansTable.tsx",
  "components/loan/LoansSummaryCards.tsx",
  "components/loan/LoanDetailSummaryCards.tsx",
  "components/loan/LoanRepaymentsTable.tsx",
  "components/loan/RepaymentCandidateList.tsx",
  "app/[locale]/(full-layout)/loans/loans-client.tsx",
  "app/[locale]/(full-layout)/loans/[loanId]/loan-detail-client.tsx",
] as const;

for (const surface of MONEY_SURFACES) {
  const source = read(surface);
  assert.ok(
    !/\bformatCurrency\s*\(/.test(source),
    `${surface} must not call formatCurrency — it passes undefined for locale, so pt and es get English formatting`,
  );
  // `<StatCard value= currency=>` counts: it renders its figure through
  // `<Amount>` internally, so a surface on StatCard inherits the split-unit
  // treatment without naming the primitive. What must never come back is a
  // hand-formatted string, which the `formatCurrency` assertion above covers.
  assert.ok(
    /<Amount\b/.test(source) || /<StatCard\b/.test(source),
    `${surface} renders money and must do it through <Amount> (directly or via <StatCard>)`,
  );
}

// --- 3. the table renders a label, not the enum ----------------------------

const loansTable = read("components/loan/LoansTable.tsx");
assert.ok(
  !/\{row\.original\.type\}/.test(loansTable),
  "LoansTable must not print row.original.type — that renders MORTGAGE to the user",
);
assert.ok(
  /LOAN_TYPE_LABEL_KEY\[row\.original\.type\]/.test(loansTable),
  "LoansTable must resolve the type through the shared label map",
);

const assumptions = read("components/loan/LoanAssumptionsCard.tsx");
assert.ok(
  !/facilityTypeKeyMap|statusKeyMap/.test(assumptions),
  "LoanAssumptionsCard must use the shared maps, not private ones — the private pair is what made MORTGAGE render as Personal",
);

// --- 4. the maps are total, distinct, and translated -----------------------

const ALL_TYPES: LoanType[] = [
  "MORTGAGE",
  "AUTO_LOAN",
  "PERSONAL_LOAN",
  "STUDENT_LOAN",
  "OTHER",
];
const ALL_STATUSES: LoanStatus[] = ["ACTIVE", "PAID_OFF", "CLOSED"];

assert.equal(
  new Set(ALL_TYPES.map((type) => LOAN_TYPE_LABEL_KEY[type])).size,
  ALL_TYPES.length,
  "each loan type must map to its own label — collapsing them is how MORTGAGE became Personal",
);

// The specific inversion that shipped: a paid-off loan announced itself as overdue.
assert.equal(
  LOAN_STATUS_LABEL_KEY.PAID_OFF,
  "paid",
  "PAID_OFF must resolve to the paid label, never overdue",
);

for (const locale of LOCALES) {
  const messages = JSON.parse(read(`messages/${locale}/loans.json`)) as {
    loans: { statuses: Record<string, string>; types: Record<string, string> };
  };

  for (const type of ALL_TYPES) {
    const key = LOAN_TYPE_LABEL_KEY[type];
    assert.ok(
      typeof messages.loans.types[key] === "string" &&
        messages.loans.types[key].trim() !== "",
      `messages/${locale}/loans.json is missing loans.types.${key} (for ${type})`,
    );
  }

  for (const status of ALL_STATUSES) {
    const key = LOAN_STATUS_LABEL_KEY[status];
    assert.ok(
      typeof messages.loans.statuses[key] === "string" &&
        messages.loans.statuses[key].trim() !== "",
      `messages/${locale}/loans.json is missing loans.statuses.${key} (for ${status})`,
    );
  }
}

// --- 5. the pt mortgage label names the product, not the lien --------------

const ptTypes = (
  JSON.parse(read("messages/pt/loans.json")) as {
    loans: { types: Record<string, string> };
  }
).loans.types;

assert.ok(
  !/^hipoteca$/i.test(ptTypes.mortgage.trim()),
  'pt names this product "crédito habitação"; "Hipoteca" is the lien, not the loan a reader recognises',
);

console.log("Loans locale regression checks passed");
