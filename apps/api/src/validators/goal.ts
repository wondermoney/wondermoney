import Big from 'big.js';
import { z } from 'zod';

const numericStringSchema = z.string().trim().regex(/^\d+(?:\.\d+)?$/);

const positiveFiniteMoneySchema = z
  .union([z.number(), numericStringSchema])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => Number.isFinite(value) && value > 0, {
    message: 'must be a positive finite number',
  });

// Reserve mutations (assign / move-out) are constrained to ≤4 fractional digits so
// goal balances can't accumulate sub-precision dust across repeated operations.
const fourDecimalNumericStringSchema = z.string().trim().regex(/^\d+(?:\.\d{1,4})?$/);

const positiveFiniteFourDecimalMoneySchema = z
  .union([z.number(), fourDecimalNumericStringSchema])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => Number.isFinite(value) && value > 0, {
    message: 'must be a positive finite number',
  })
  .refine((value) => !Number.isFinite(value) || new Big(value).round(4).eq(value), {
    message: 'must have at most four fractional decimal digits',
  });

const positiveKeySchema = z
  .union([z.number(), z.string().trim().regex(/^\d+$/)])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => Number.isInteger(value) && value > 0 && Number.isFinite(value), {
    message: 'must be a positive integer',
  });

const nonNegativeFiniteMoneySchema = z
  .union([z.number(), numericStringSchema])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => Number.isFinite(value) && value >= 0, {
    message: 'must be a non-negative finite number',
  });

// Interest rate accepted from clients as a percent (e.g. 19.99), converted to bps in the controller.
const interestPercentSchema = z
  .union([z.number(), numericStringSchema])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => Number.isFinite(value) && value >= 0 && value <= 1000, {
    message: 'interest rate must be between 0 and 1000 percent',
  });

const goalTypeSchema = z.enum(['debt_paydown', 'save_up']);

const paginationLimitSchema = z
  .union([z.number(), z.string().trim().regex(/^\d+$/)])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => Number.isInteger(value) && value >= 1 && value <= 100 && Number.isFinite(value), {
    message: 'must be an integer between 1 and 100',
  });

const paginationOffsetSchema = z
  .union([z.number(), z.string().trim().regex(/^\d+$/)])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => Number.isInteger(value) && value >= 0 && value <= 100000 && Number.isFinite(value), {
    message: 'must be an integer between 0 and 100000',
  });

const booleanStringSchema = z.enum(['true', 'false']);
const safeBooleanQuerySchema = z.union([z.boolean(), booleanStringSchema]).transform((value) => (typeof value === 'boolean' ? value : value === 'true'));

const futureDateSchema = z
  .coerce.date()
  .nullable()
  .optional()
  .refine((value) => value == null || value.getTime() > Date.now(), {
    message: 'targetDate must be in the future',
  });

const goalBodySchema = z.object({
  annualInterestRatePercent: interestPercentSchema.optional(),
  currencyId: positiveKeySchema.optional(),
  currentBalance: positiveFiniteMoneySchema.optional(),
  description: z.string().max(500).nullable().optional(),
  extraPayment: nonNegativeFiniteMoneySchema.optional(),
  loanKey: positiveKeySchema.nullable().optional(),
  minimumPayment: positiveFiniteMoneySchema.optional(),
  monthlyContributionTarget: positiveFiniteMoneySchema.nullable().optional(),
  name: z.string().min(1).max(100),
  priority: z.number().int().min(0).max(2).optional(),
  targetAmount: positiveFiniteMoneySchema.optional(),
  targetDate: futureDateSchema,
  type: goalTypeSchema.optional().default('save_up'),
});

export const createGoalRequestSchema = z.object({
  body: goalBodySchema.superRefine((body, ctx) => {
    if (body.type === 'debt_paydown') {
      if (body.currentBalance == null) ctx.addIssue({ code: 'custom', message: 'currentBalance is required for debt paydown goals', path: ['currentBalance'] });
      if (body.annualInterestRatePercent == null) ctx.addIssue({ code: 'custom', message: 'annualInterestRatePercent is required for debt paydown goals', path: ['annualInterestRatePercent'] });
      if (body.minimumPayment == null) ctx.addIssue({ code: 'custom', message: 'minimumPayment is required for debt paydown goals', path: ['minimumPayment'] });
    } else if (body.targetAmount == null) {
      ctx.addIssue({ code: 'custom', message: 'targetAmount is required', path: ['targetAmount'] });
    }
  }),
});

export const updateGoalRequestSchema = z.object({
  body: goalBodySchema.partial(),
  params: z.object({
    goalKey: positiveKeySchema,
  }),
});

export const goalParamsRequestSchema = z.object({
  params: z.object({
    goalKey: positiveKeySchema,
  }),
});

export const listGoalsRequestSchema = z.object({
  query: z.object({
    includeArchived: safeBooleanQuerySchema.optional().default(false),
  }),
});

export const assignGoalMoneyRequestSchema = z.object({
  body: z.object({
    amount: positiveFiniteFourDecimalMoneySchema,
  }).strict(),
  params: z.object({
    goalKey: positiveKeySchema,
  }),
});

export const moveGoalMoneyOutRequestSchema = z.object({
  body: z.object({
    amount: positiveFiniteFourDecimalMoneySchema,
  }).strict(),
  params: z.object({
    goalKey: positiveKeySchema,
  }),
});

export const fundGoalTransactionRequestSchema = z.object({
  body: z.object({
    amount: positiveFiniteMoneySchema,
    transactionKey: positiveKeySchema,
  }),
  params: z.object({
    goalKey: positiveKeySchema,
  }),
});

export const goalAccountLinkRequestSchema = z.object({
  body: z.object({
    accountKey: positiveKeySchema,
  }),
  params: z.object({
    goalKey: positiveKeySchema,
  }),
});

export const undoGoalTransactionFundingRequestSchema = z.object({
  params: z.object({
    fundingKey: positiveKeySchema,
    goalKey: positiveKeySchema,
  }),
});

export const unlinkGoalAccountRequestSchema = z.object({
  params: z.object({
    accountKey: positiveKeySchema,
    goalKey: positiveKeySchema,
  }),
});

export const goalActivityQueryRequestSchema = z.object({
  params: z.object({
    goalKey: positiveKeySchema,
  }),
  query: z.object({
    limit: paginationLimitSchema.optional().default(25),
    offset: paginationOffsetSchema.optional().default(0),
  }),
});
