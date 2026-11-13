import { z } from "zod";
import { create } from "zustand";

import {
  BUDGET_VISIBILITIES,
  type BudgetVisibility,
} from "@/lib/budget/visibility";
import type { BudgetStarterProfileKey } from "@/lib/utils/budget-wizard";

// Who sees the budget: chosen once, at creation
export const visibilitySchema = z.object({
  visibility: z.enum(BUDGET_VISIBILITIES),
});

// Base schema for household
export const householdSchema = z.object({
  householdSize: z.number().min(1),
});

// Schema for dependents
export const dependentsSchema = z.object({
  dependentsNum: z.number().min(0),
});

// Schema for income
export const incomeSchema = z.object({
  incomes: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        amount: z.number().min(0),
        isRecurrent: z.boolean(),
        recurrency: z
          .enum([
            "MONTHLY",
            "MONTHLY_14",
            "QUARTERLY",
            "ANNUALLY",
            "BI_ANNUALLY",
          ])
          .optional(),
      }),
    )
    .min(1),
});

export type VisibilityData = z.infer<typeof visibilitySchema>;
export type HouseholdData = z.infer<typeof householdSchema>;
export type DependentsData = z.infer<typeof dependentsSchema>;
export type IncomeData = z.infer<typeof incomeSchema>;

// The dependents step's slider is capped at `household.householdSize` (see
// dependents/page.tsx), so `dependentsNum === householdSize` is a reachable,
// valid selection (e.g. a single-parent household with no other adults) and
// must not be rejected here. Only a value that could never come from the
// slider itself (greater than the household) is a real error — this
// refinement exists purely as a defensive check for stale wizard state (e.g.
// the household size was reduced after dependents was already set), not as
// the primary guard against out-of-range input.
export function buildDependentsSchema(
  household: HouseholdData | undefined,
  maxDependentsMessage: string,
) {
  return dependentsSchema.superRefine((data, ctx) => {
    if (!household) return;
    if (data.dependentsNum > household.householdSize) {
      ctx.addIssue({
        code: "custom",
        message: maxDependentsMessage,
        path: ["dependentsNum"],
      });
    }
  });
}

export interface BudgetWizardState {
  // Form Data
  /** Chosen on the first step; the budget keeps it for good. */
  visibility: BudgetVisibility;
  household?: HouseholdData;
  dependents?: DependentsData;
  income?: IncomeData;
  budgetId?: number;
  starterProfileKey?: BudgetStarterProfileKey;

  // Actions
  setVisibility: (visibility: BudgetVisibility) => void;
  setHousehold: (data: HouseholdData) => void;
  setDependents: (data: DependentsData) => void;
  setIncome: (data: IncomeData) => void;
  setBudgetId: (id: number) => void;
  setStarterProfileSelection: (profileKey: BudgetStarterProfileKey) => void;
  reset: () => void;
}

export const useBudgetWizardStore = create<BudgetWizardState>((set) => ({
  // Initial state
  visibility: "household",
  household: undefined,
  dependents: undefined,
  income: undefined,
  budgetId: undefined,
  starterProfileKey: undefined,

  // Actions
  setVisibility: (visibility) => set({ visibility }),
  setHousehold: (data) => set({ household: data }),
  setDependents: (data) => set({ dependents: data }),
  setIncome: (data) => set({ income: data }),
  setBudgetId: (id) => set({ budgetId: id }),
  setStarterProfileSelection: (profileKey) =>
    set({
      starterProfileKey: profileKey,
    }),
  reset: () =>
    set({
      visibility: "household",
      household: undefined,
      dependents: undefined,
      income: undefined,
      budgetId: undefined,
      starterProfileKey: undefined,
    }),
}));
