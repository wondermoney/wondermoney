import type { LoanStatus, LoanType } from "@/lib/api/loan/types";

/**
 * RAD-571 — the `loans.types.*` / `loans.statuses.*` message key for a loan's
 * enum value.
 *
 * These live here rather than beside one component because LoansTable was
 * printing the raw enum (`MORTGAGE`) while LoanAssumptionsCard kept a private
 * map, and the private map was lossy: every type but `PERSONAL_LOAN` and
 * `OTHER` resolved to the wrong label even though a correct one existed in all
 * three locales. One map, one place, checked by the type system against the
 * union — a new loan type is a compile error here rather than an untranslated
 * enum on screen.
 */
export const LOAN_TYPE_LABEL_KEY: Record<LoanType, string> = {
  AUTO_LOAN: "auto",
  MORTGAGE: "mortgage",
  OTHER: "other",
  PERSONAL_LOAN: "personal",
  STUDENT_LOAN: "student",
};

/**
 * `PAID_OFF` previously resolved to `overdue`, so a loan the user had finished
 * paying announced itself as *Em atraso* / *Atrasado*. `CLOSED` claimed the
 * `paid` label, which a closed-but-unpaid facility has not earned.
 */
export const LOAN_STATUS_LABEL_KEY: Record<LoanStatus, string> = {
  ACTIVE: "active",
  CLOSED: "closed",
  PAID_OFF: "paid",
};
