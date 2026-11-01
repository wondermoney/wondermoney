import { z } from 'zod';

import { Recurrency } from '@utils/budget';

// Matches the existing income-amount ceiling below (createBudgetRequestSchema.incomes[].amount) so
// every budget-domain money field shares one sanity cap. Generous enough for any real household
// budget while still rejecting fat-finger/edge-case entries (e.g. 99999999) that would otherwise
// propagate through Total Budgeted, Budget Remaining, utilization %, and Net Worth History.
const MAX_BUDGET_CATEGORY_AMOUNT = 999999999;
const budgetCategoryAmountErrorMessage = `Amount must be ${MAX_BUDGET_CATEGORY_AMOUNT.toLocaleString('en-US')} or less`;

export const updateBudgetRequestSchema = z.object({
  body: z.object({
    description: z.string().max(500).optional(),
    name: z.string().min(1).max(100),
  }),
  params: z.object({
    budgetKey: z.coerce.number().positive(),
  }),
});

export const getBudgetRequestSchema = z.object({
  params: z.object({
    budgetKey: z.coerce.number().positive(),
  }),
});

export const deleteBudgetRequestSchema = z.object({
  params: z.object({
    budgetKey: z.coerce.number().positive(),
  }),
});

export const createBudgetRequestSchema = z.object({
  body: z.object({
    dependentsNum: z.number().nonnegative().max(50).default(0),
    houseHoldSize: z.number().nonnegative().max(100).default(1),
    incomes: z
      .array(
        z
          .object({
            amount: z.number().nonnegative().max(MAX_BUDGET_CATEGORY_AMOUNT, { message: budgetCategoryAmountErrorMessage }),
            isRecurrent: z.boolean(),
            name: z.string().min(1).max(100),
            recurrency: z.enum(Recurrency).optional(),
          })
          .refine((data) => {
            // If isRecurrent is true, recurrency should be defined
            if (data.isRecurrent) {
              return data.recurrency !== undefined;
            }
            return true;
          }),
      )
      .optional(),
  }),
});

export const updateBudgetAccountsRequestSchema = z.object({
  body: z.object({
    accountKeys: z.array(z.number()),
  }),
  params: z.object({
    budgetKey: z.coerce.number().positive(),
  }),
});

export const updateBudgetTemplateRequestSchema = z.object({
  body: z.object({
    accountKeys: z.array(z.number()),
  }),
  params: z.object({
    budgetKey: z.coerce.number().positive(),
    budgetTemplateCategoryKey: z.coerce.number().positive(),
  }),
});

export const getBudgetTemplateByYearAndMonthRequestSchema = z.object({
  params: z.object({
    budgetKey: z.coerce.number().positive(),
    month: z.coerce.number().positive(),
    year: z.coerce.number().positive(),
  }),
});

export const getBudgetTemplateByYearRequestSchema = z.object({
  params: z.object({
    budgetKey: z.coerce.number().positive(),
    year: z.coerce.number().positive(),
  }),
});

export const getBudgetTemplateByYearUntilMonthRequestSchema = z.object({
  params: z.object({
    budgetKey: z.coerce.number().positive(),
    month: z.coerce.number().positive(),
    year: z.coerce.number().positive(),
  }),
});

export const updateBudgetCategoryAmountRequestSchema = z.object({
  body: z.object({
    amount: z.coerce.number().positive().max(MAX_BUDGET_CATEGORY_AMOUNT, { message: budgetCategoryAmountErrorMessage }).optional(),
    applyToFollowingMonths: z.boolean().optional().default(true),
    recurrency: z.enum(Recurrency).optional(),
  }),
  params: z.object({
    budgetKey: z.coerce.number().positive(),
    categoryKey: z.coerce.number().positive(),
    month: z.coerce.number().positive(),
    year: z.coerce.number().positive(),
  }),
});

export const deleteBudgetCategoryRequestSchema = z.object({
  params: z.object({
    budgetKey: z.coerce.number().positive(),
    categoryKey: z.coerce.number().positive(),
    month: z.coerce.number().positive(),
    year: z.coerce.number().positive(),
  }),
});

export const addBudgetCategoryRequestSchema = z.object({
  body: z.object({
    amountBudgeted: z.number().positive().max(MAX_BUDGET_CATEGORY_AMOUNT, { message: budgetCategoryAmountErrorMessage }),
    categoryKey: z.number().positive(),
    recurrency: z.enum(Recurrency).optional(),
  }),
  params: z.object({
    budgetKey: z.coerce.number().positive(),
  }),
});

export const removeCategoryFromBudgetRequestSchema = z.object({
  params: z.object({
    budgetKey: z.coerce.number().positive(),
    categoryKey: z.coerce.number().positive(),
  }),
  query: z.object({
    deletePreviousMonths: z.coerce.boolean().default(false),
  }),
});
