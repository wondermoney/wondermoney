import type { LoanStatus, LoanType } from "@/lib/api/loan/types";

/**
 * The `loans.types.*` / `loans.statuses.*` message key for a loan's enum value.
 *
 * These live here rather than beside one component so every surface that
 * labels a loan uses the same map. One map, one place, checked by the type
 * system against the union — a new loan type is a compile error here rather than an untranslated
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
 * `PAID_OFF` is `paid`, never `overdue`. `CLOSED` gets its own label rather
 * than `paid`, which a closed-but-unpaid facility has not earned.
 */
export const LOAN_STATUS_LABEL_KEY: Record<LoanStatus, string> = {
  ACTIVE: "active",
  CLOSED: "closed",
  PAID_OFF: "paid",
};
