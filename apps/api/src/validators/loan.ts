import { z } from 'zod';

import { validateRepaymentAllocation } from '@service/loan/loan-calculation.service';
import { LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';
import { finiteAmount, positiveIntId, validDate } from '@validators/shared';

const dateSchema = validDate;

const booleanLike = z.union([z.boolean(), z.string()]).transform((val) => (typeof val === 'string' ? val.toLowerCase() === 'true' : val));

const baseLoanSchema = z.object({
  annualInterestRateBps: z.coerce.number().int().min(0).max(10_000).refine(Number.isSafeInteger).optional(),
  currencyKey: positiveIntId,
  includeInNetWorth: booleanLike.optional().default(true),
  maturityDate: dateSchema.optional(),
  name: z.string().min(1).max(255),
  notes: z.string().max(10_000).optional(),
  openingBalanceDate: dateSchema,
  openingPrincipalBalance: finiteAmount.refine((value) => value > 0),
  originalPrincipal: finiteAmount.optional(),
  paymentDayOfMonth: z.coerce.number().int().min(1).max(31).refine(Number.isSafeInteger).optional(),
  paymentFrequency: z.nativeEnum(LoanPaymentFrequency).optional(),
  providerName: z.string().max(255).optional(),
  rateType: z.nativeEnum(LoanRateType).optional(),
  regularPaymentAmount: finiteAmount.refine((value) => value > 0).optional(),
  status: z.nativeEnum(LoanStatus).optional(),
  termMonths: z.coerce.number().int().positive().refine(Number.isSafeInteger).optional(),
  type: z.nativeEnum(LoanType),
});

export const createLoanSchema = z.object({
  body: baseLoanSchema
    .extend({
      includeInNetWorth: booleanLike.optional().default(true),
    })
    .superRefine((data, ctx) => {
      if (data.originalPrincipal != null && data.originalPrincipal < data.openingPrincipalBalance) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'originalPrincipal must be greater than or equal to openingPrincipalBalance', path: ['originalPrincipal'] });
      }
      if (data.maturityDate && data.maturityDate <= data.openingBalanceDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'maturityDate must be after openingBalanceDate', path: ['maturityDate'] });
      }
    }),
});

export const updateLoanSchema = z.object({
  body: baseLoanSchema
    .partial()
    .superRefine((data, ctx) => {
      if (data.originalPrincipal != null && data.openingPrincipalBalance != null && data.originalPrincipal < data.openingPrincipalBalance) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'originalPrincipal must be greater than or equal to openingPrincipalBalance', path: ['originalPrincipal'] });
      }
      if (data.maturityDate && data.openingBalanceDate && data.maturityDate <= data.openingBalanceDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'maturityDate must be after openingBalanceDate', path: ['maturityDate'] });
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
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation.reason, path: ['totalPaymentAmount'] });
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
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation.reason, path: ['totalPaymentAmount'] });
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
