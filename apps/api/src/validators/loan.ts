import { z } from 'zod';

import { validateRepaymentAllocation } from '@service/loan/loan-calculation.service';
import { LoanAdjustmentType, LoanAmortizationMethod, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';
import { finiteAmount, positiveIntId, validDate } from '@validators/shared';

const dateSchema = z
  .union([z.date(), z.number(), z.string()])
  .superRefine((value, ctx) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      ctx.addIssue({ code: 'custom', message: 'Invalid date' });
    }
  })
  .pipe(validDate);

const booleanLike = z.union([z.boolean(), z.string()]).transform((val) => (typeof val === 'string' ? val.toLowerCase() === 'true' : val));

const baseLoanSchema = z.object({
  amortizationMethod: z.enum(LoanAmortizationMethod).optional(),
  annualInterestRateBps: z.coerce.number().int().min(0).max(10_000).refine(Number.isSafeInteger).optional(),
  currencyKey: positiveIntId,
  firstPaymentDate: dateSchema.optional(),
  includeInNetWorth: booleanLike.optional().default(true),
  maturityDate: dateSchema.optional(),
  name: z.string().min(1).max(255),
  notes: z.string().max(10_000).optional(),
  openingBalanceDate: dateSchema,
  openingPrincipalBalance: finiteAmount.refine((value) => value > 0),
  originalPrincipal: finiteAmount.optional(),
  paymentDayOfMonth: z.coerce.number().int().min(1).max(31).refine(Number.isSafeInteger).optional(),
  paymentFrequency: z.enum(LoanPaymentFrequency).optional(),
  providerName: z.string().max(255).optional(),
  rateType: z.enum(LoanRateType).optional(),
  regularPaymentAmount: finiteAmount.refine((value) => value > 0).optional(),
  /** The household asset the loan finances; null unlinks it. */
  securedAssetKey: positiveIntId.nullable().optional(),
  status: z.enum(LoanStatus).optional(),
  termMonths: z.coerce.number().int().positive().refine(Number.isSafeInteger).optional(),
  type: z.enum(LoanType),
});

export const createLoanSchema = z.object({
  body: baseLoanSchema
    .extend({
      includeInNetWorth: booleanLike.optional().default(true),
    })
    .superRefine((data, ctx) => {
      if (data.originalPrincipal != null && data.originalPrincipal < data.openingPrincipalBalance) {
        ctx.addIssue({ code: 'custom', message: 'originalPrincipal must be greater than or equal to openingPrincipalBalance', path: ['originalPrincipal'] });
      }
      if (data.maturityDate && data.maturityDate <= data.openingBalanceDate) {
        ctx.addIssue({ code: 'custom', message: 'maturityDate must be after openingBalanceDate', path: ['maturityDate'] });
      }
    }),
});

export const updateLoanSchema = z.object({
  body: baseLoanSchema
    .partial()
    .superRefine((data, ctx) => {
      if (data.originalPrincipal != null && data.openingPrincipalBalance != null && data.originalPrincipal < data.openingPrincipalBalance) {
        ctx.addIssue({ code: 'custom', message: 'originalPrincipal must be greater than or equal to openingPrincipalBalance', path: ['originalPrincipal'] });
      }
      if (data.maturityDate && data.openingBalanceDate && data.maturityDate <= data.openingBalanceDate) {
        ctx.addIssue({ code: 'custom', message: 'maturityDate must be after openingBalanceDate', path: ['maturityDate'] });
      }
    }),
  params: z.object({
    loanId: positiveIntId,
  }),
});

export const loanIdParamSchema = z.object({
  params: z.object({
    loanId: positiveIntId,
  }),
});

const adjustmentTypeSchema = z.enum(LoanAdjustmentType);
const adjustmentShape = z.object({
  amount: finiteAmount,
  effectiveDate: dateSchema,
  reason: z.string().max(1000).nullable().optional(),
  type: adjustmentTypeSchema,
});
const adjustmentFields = adjustmentShape.superRefine((input, ctx) => {
  if (input.type === LoanAdjustmentType.BALANCE_CORRECTION ? input.amount < 0 : input.amount <= 0) {
    ctx.addIssue({ code: 'custom', message: input.type === LoanAdjustmentType.BALANCE_CORRECTION ? 'Balance correction must be nonnegative' : 'Amount must be greater than zero', path: ['amount'] });
  }
});

export const loanAdjustmentListSchema = loanIdParamSchema;
export const createLoanAdjustmentSchema = z.object({ body: adjustmentFields, params: loanIdParamSchema.shape.params });
export const updateLoanAdjustmentSchema = z.object({
  body: adjustmentShape.partial().superRefine((input, ctx) => {
    if (input.type === LoanAdjustmentType.BALANCE_CORRECTION && input.amount != null && input.amount < 0) ctx.addIssue({ code: 'custom', message: 'Balance correction must be nonnegative', path: ['amount'] });
    if (input.type != null && input.type !== LoanAdjustmentType.BALANCE_CORRECTION && input.amount != null && input.amount <= 0) ctx.addIssue({ code: 'custom', message: 'Amount must be greater than zero', path: ['amount'] });
  }),
  params: z.object({ adjustmentId: positiveIntId, loanId: positiveIntId }),
});
export const deleteLoanAdjustmentSchema = z.object({ params: z.object({ adjustmentId: positiveIntId, loanId: positiveIntId }) });

const ratePeriodFields = z.object({
  annualInterestRateBps: z.coerce.number().int().min(0).max(10_000).refine(Number.isSafeInteger),
  effectiveDate: dateSchema,
});
export const loanRatePeriodsSchema = loanIdParamSchema;
export const createLoanRatePeriodSchema = z.object({ body: ratePeriodFields, params: loanIdParamSchema.shape.params });
export const updateLoanRatePeriodSchema = z.object({ body: ratePeriodFields.partial(), params: z.object({ loanId: positiveIntId, ratePeriodId: positiveIntId }) });
export const deleteLoanRatePeriodSchema = z.object({ params: z.object({ loanId: positiveIntId, ratePeriodId: positiveIntId }) });

export const loanProjectionSchema = z.object({
  params: z.object({
    loanId: positiveIntId,
  }),
  query: z.object({
    extra: finiteAmount.refine((value) => value >= 0).optional().default(0),
    frequency: z.enum(['monthly', 'one-off']).optional().default('monthly'),
    startDate: dateSchema.optional(),
  }),
});

const repaymentAllocationSchema = z.object({
  feeAmount: finiteAmount.refine((value) => value >= 0),
  interestAmount: finiteAmount.refine((value) => value >= 0),
  principalAmount: finiteAmount.refine((value) => value > 0),
  totalPaymentAmount: finiteAmount.refine((value) => value > 0),
});

export const repaymentCandidatesSchema = z.object({
  params: z.object({
    loanId: positiveIntId,
  }),
  query: z.object({
    accountKey: z.coerce.number().int().positive().optional(),
    amount: z.coerce.number().positive().optional(),
    endDate: z.coerce.date().optional(),
    search: z.string().min(1).optional(),
    startDate: z.coerce.date().optional(),
  }).partial(),
});

export const linkLoanRepaymentSchema = z.object({
  body: repaymentAllocationSchema.superRefine((data, ctx) => {
    const validation = validateRepaymentAllocation(data);
    if (!validation.valid) {
      ctx.addIssue({ code: 'custom', message: validation.reason, path: ['totalPaymentAmount'] });
    }
  }),
  params: z.object({
    loanId: z.coerce.number().int().positive(),
  }),
  query: z.object({
    transactionKey: positiveIntId,
  }),
});

export const updateLoanRepaymentSchema = z.object({
  body: repaymentAllocationSchema.partial().superRefine((data, ctx) => {
    if (data.principalAmount == null || data.totalPaymentAmount == null || data.interestAmount == null || data.feeAmount == null) return;
    const validation = validateRepaymentAllocation({
      feeAmount: data.feeAmount,
      interestAmount: data.interestAmount,
      principalAmount: data.principalAmount,
      totalPaymentAmount: data.totalPaymentAmount,
    });
    if (!validation.valid) {
      ctx.addIssue({ code: 'custom', message: validation.reason, path: ['totalPaymentAmount'] });
    }
  }),
  params: z.object({
    loanId: positiveIntId,
    repaymentLinkId: positiveIntId,
  }),
});

export const deleteLoanRepaymentSchema = z.object({
  params: z.object({
    loanId: positiveIntId,
    repaymentLinkId: positiveIntId,
  }),
});
