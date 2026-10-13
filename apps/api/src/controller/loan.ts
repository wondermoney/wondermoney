import type { FilterQuery, RequiredEntityData } from '@mikro-orm/core';
import { QueryOrder } from '@mikro-orm/core';
import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Currency } from '@entity/Currency';
import { Loan } from '@entity/Loan';
import { LoanAdjustment } from '@entity/LoanAdjustment';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import {
  calculateLoanProgress,
  calculateNextPaymentDate,
  calculateOutstandingPrincipalWithAdjustments,
  calculateRemainingTermMonths,
  estimateRepaymentAllocation,
  validateRepaymentAllocation,
} from '@service/loan/loan-calculation.service';
import { scoreLoanRepaymentCandidate } from '@service/loan/loan-repayment-matching.service';
import { LoanAllocationSource, LoanPaymentFrequency, LoanRateType, LoanStatus } from '@service/loan/loan-types';
import { BadRequestError, ConflictError } from '@utils/errors';
import {
  createLoanSchema,
  deleteLoanRepaymentSchema,
  linkLoanRepaymentSchema,
  loanIdParamSchema,
  repaymentCandidatesSchema,
  updateLoanRepaymentSchema,
  updateLoanSchema,
} from '@validators/loan';
import { zParse } from '@validators/parser';

const TRANSACTION_OUTFLOW_TOLERANCE = 0.01;

interface LoanPatchInput {
  annualInterestRateBps?: number;
  includeInNetWorth?: boolean;
  maturityDate?: Date;
  name?: string;
  notes?: null | string;
  openingBalanceDate?: Date;
  openingPrincipalBalance?: number;
  originalPrincipal?: null | number;
  paymentDayOfMonth?: number;
  paymentFrequency?: LoanPaymentFrequency;
  providerName?: string;
  rateType?: LoanRateType;
  regularPaymentAmount?: number;
  status?: LoanStatus;
  termMonths?: number;
  type?: string;
}

export function assertAllocationWithinTransactionAmount(totalPaymentAmount: number, transaction: Transaction) {
  const transactionAmount = Math.abs(transaction.settlementAmount ?? transaction.originalAmount ?? 0);
  if (totalPaymentAmount > transactionAmount + TRANSACTION_OUTFLOW_TOLERANCE) {
    throw new BadRequestError('totalPaymentAmount exceeds transaction amount');
  }
}

export function assertPrincipalWithinOutstanding(principalAmount: number, outstandingPrincipal: number) {
  if (principalAmount > outstandingPrincipal + TRANSACTION_OUTFLOW_TOLERANCE) {
    throw new BadRequestError('principalAmount exceeds outstanding principal');
  }
}

export function buildLoanUpdatePatch(body: LoanPatchInput) {
  const patch: Record<string, unknown> = {};
  for (const key of [
    'annualInterestRateBps', 'includeInNetWorth', 'maturityDate', 'name', 'notes', 'openingBalanceDate',
    'openingPrincipalBalance', 'originalPrincipal', 'paymentDayOfMonth', 'paymentFrequency', 'providerName',
    'rateType', 'regularPaymentAmount', 'status', 'termMonths', 'type',
  ]) {
    const value = (body as Record<string, unknown>)[key];
    if (value !== undefined) patch[key] = value;
  }
  return patch;
}

export async function createLoan(req: Request, res: Response) {
  const { body } = await zParse(createLoanSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const currency = await DI.em.findOne(Currency, { currencyKey: body.currencyKey });
  if (!currency) throw new BadRequestError('Currency not found');
  const loan = DI.em.create(Loan, {
    annualInterestRateBps: body.annualInterestRateBps,
    currencyKey: currency,
    includeInNetWorth: body.includeInNetWorth,
    maturityDate: body.maturityDate,
    name: body.name,
    notes: body.notes,
    openingBalanceDate: body.openingBalanceDate,
    openingPrincipalBalance: body.openingPrincipalBalance,
    originalPrincipal: body.originalPrincipal,
    ownerAppuserKey: appuser,
    paymentDayOfMonth: body.paymentDayOfMonth,
    paymentFrequency: body.paymentFrequency ?? LoanPaymentFrequency.MONTHLY,
    providerName: body.providerName,
    rateType: body.rateType ?? LoanRateType.UNKNOWN,
    regularPaymentAmount: body.regularPaymentAmount,
    status: body.status ?? LoanStatus.ACTIVE,
    tenantKey: tenant,
    termMonths: body.termMonths,
    type: body.type,
  } as RequiredEntityData<Loan>);
  await DI.em.persist(loan).flush();
  return res.status(201).json({ loan: await enrichLoan(loan) });
}

export async function deleteLoan(req: Request, res: Response) {
  const { params: { loanId } } = await zParse(loanIdParamSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await DI.em.findOne(Loan, { deletedAt: undefined, loanKey: loanId, ownerAppuserKey: appuser, tenantKey: tenant });
  if (!loan) return res.sendStatus(404);
  loan.deletedAt = new Date();
  await DI.em.persist(loan).flush();
  return res.sendStatus(204);
}

export async function deleteLoanRepayment(req: Request, res: Response) {
  const { params: { loanId, repaymentLinkId } } = await zParse(deleteLoanRepaymentSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const repayment = await DI.em.findOne(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan, loanRepaymentLinkKey: repaymentLinkId, tenantKey: tenant });
  if (!repayment) return res.sendStatus(404);
  repayment.deletedAt = new Date();
  await DI.em.persist(repayment).flush();
  return res.sendStatus(204);
}

export async function getLoan(req: Request, res: Response) {
  const { params: { loanId } } = await zParse(loanIdParamSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await DI.em.findOne(Loan, { deletedAt: undefined, loanKey: loanId, ownerAppuserKey: appuser, tenantKey: tenant }, { populate: ['currencyKey'] });
  if (!loan) return res.sendStatus(404);
  return res.json({ loan: await enrichLoan(loan) });
}

export async function getLoanOverview(req: Request, res: Response) {
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loans = await DI.em.find(Loan, { deletedAt: undefined, ownerAppuserKey: appuser, tenantKey: tenant }, { populate: ['currencyKey'] });
  const enriched = await Promise.all(loans.map(enrichLoan));
  const overviewLoans = enriched as { includeInNetWorth: boolean; outstandingPrincipal?: number; regularPaymentAmount?: number }[];
  const totalOutstandingDebt = overviewLoans.reduce((sum, loan) => sum + (loan.outstandingPrincipal ?? 0), 0);
  const monthlyRepaymentTotal = overviewLoans.reduce((sum, loan) => sum + (loan.regularPaymentAmount ?? 0), 0);
  const netWorthImpact = -overviewLoans
    .filter((loan) => loan.includeInNetWorth)
    .reduce((sum, loan) => sum + (loan.outstandingPrincipal ?? 0), 0);
  return res.json({
    overview: {
      interestFeesThisMonth: 0,
      monthlyRepaymentTotal,
      netWorthImpact,
      repaymentsNeedingReviewCount: 0,
      totalOutstandingDebt,
    },
  });
}

export async function getLoanRequestContext(req: Request): Promise<{ appuser: Appuser; tenant: Tenant }> {
  if (!req.user) {
    throw new BadRequestError('User not found');
  }
  const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(req.user);
  if (!appuserTenant) {
    throw new BadRequestError("User doesn't have AppuserTenant");
  }
  return { appuser: req.user, tenant: appuserTenant.tenantKey };
}

export async function getLoanSummary(req: Request, res: Response) {
  const { params: { loanId } } = await zParse(loanIdParamSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await DI.em.findOne(Loan, { deletedAt: undefined, loanKey: loanId, ownerAppuserKey: appuser, tenantKey: tenant }, { populate: ['currencyKey'] });
  if (!loan) return res.sendStatus(404);
  return res.json({ loan: await enrichLoan(loan) });
}

export async function linkLoanRepayment(req: Request, res: Response) {
  const { body, params: { loanId }, query: { transactionKey } } = await zParse(linkLoanRepaymentSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const transaction = await loadOwnedOutflowTransaction(transactionKey, tenant);
  if (!transaction) return res.sendStatus(404);
  const duplicate = await DI.em.findOne(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan, transactionKey: transaction });
  if (duplicate) throw new ConflictError('Repayment already linked');
  const existingRepayments = await DI.em.find(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan });
  const outstandingPrincipal = calculateOutstandingPrincipalWithAdjustments({
    adjustments: [],
    openingPrincipalBalance: loan.openingPrincipalBalance,
    principalRepayments: existingRepayments.map((r) => ({ amount: r.principalAmount, effectiveDate: r.paymentDate })),
  });
  assertPrincipalWithinOutstanding(body.principalAmount, outstandingPrincipal);
  assertAllocationWithinTransactionAmount(body.totalPaymentAmount, transaction);
  const allocation = validateRepaymentAllocation(body);
  if (!allocation.valid) throw new BadRequestError(allocation.reason);
  const repayment = DI.em.create(LoanRepaymentLink, {
    allocationSource: LoanAllocationSource.MANUAL,
    feeAmount: body.feeAmount,
    interestAmount: body.interestAmount,
    linkedByAppuserKey: appuser,
    loanKey: loan,
    paymentDate: transaction.transactionDate ?? new Date(),
    principalAmount: body.principalAmount,
    tenantKey: tenant,
    totalPaymentAmount: body.totalPaymentAmount,
    transactionKey: transaction,
  } as RequiredEntityData<LoanRepaymentLink>);
  await DI.em.persist(repayment).flush();
  return res.status(201).json({ repayment: serializeRepayment(repayment, transaction) });
}

export async function listLoanRepaymentCandidates(req: Request, res: Response) {
  const { params: { loanId }, query } = await zParse(repaymentCandidatesSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const candidates = await DI.em.find(Transaction, {
    deletedAt: undefined,
    settlementAmount: { $lt: 0 },
    tenantKey: tenant,
    ...(query.accountKey ? { accountKey: query.accountKey } : {}),
    ...(query.amount ? { settlementAmount: -Math.abs(query.amount) } : {}),
    ...(query.endDate || query.startDate ? { transactionDate: { ...(query.startDate ? { $gte: query.startDate } : {}), ...(query.endDate ? { $lte: query.endDate } : {}) } } : {}),
  } as FilterQuery<Transaction>, { orderBy: { transactionDate: QueryOrder.DESC }, populate: ['transactionMerchantKey'] });

  const repayments = await DI.em.find(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan });
  const outstandingPrincipal = calculateOutstandingPrincipalWithAdjustments({
    adjustments: [],
    openingPrincipalBalance: loan.openingPrincipalBalance,
    principalRepayments: repayments.map((repayment) => ({ amount: repayment.principalAmount, effectiveDate: repayment.paymentDate })),
  });

  return res.json({
    candidates: candidates.map((transaction) => {
      const amount = Math.abs(transaction.settlementAmount ?? transaction.originalAmount ?? 0);
      const merchantName = (transaction.transactionMerchantKey as undefined | { name?: string })?.name;
      const score = scoreLoanRepaymentCandidate({
        amount,
        candidateAmount: amount,
        loanMerchantName: loan.providerName,
        merchantName,
        paymentDayOfMonth: loan.paymentDayOfMonth,
        transactionDate: transaction.transactionDate ?? undefined,
        transactionDirection: (transaction.settlementAmount ?? 0) < 0 ? 'OUTFLOW' : 'INFLOW',
      });
      return {
        amount,
        candidateScore: score.score,
        confidence: score.confidence,
        outstandingPrincipal,
        reasons: score.reasons,
        suggestedAllocation: buildSuggestedAllocation(amount, loan, outstandingPrincipal),
        transaction: summarizeTransaction(transaction),
      };
    }),
  });
}

export async function listLoanRepayments(req: Request, res: Response) {
  const { params: { loanId } } = await zParse(loanIdParamSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const repayments = await DI.em.find(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan }, { populate: ['transactionKey'] });
  return res.json({
    repayments: repayments.map((repayment) => ({
      allocationSource: repayment.allocationSource,
      feeAmount: repayment.feeAmount,
      interestAmount: repayment.interestAmount,
      loanRepaymentLinkKey: repayment.loanRepaymentLinkKey,
      needsReview: repayment.needsReview,
      notes: repayment.notes,
      paymentDate: repayment.paymentDate,
      principalAmount: repayment.principalAmount,
      totalPaymentAmount: repayment.totalPaymentAmount,
      transaction: summarizeTransaction(repayment.transactionKey as Transaction),
    })),
  });
}

export async function listLoans(req: Request, res: Response) {
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loans = await DI.em.find(Loan, { deletedAt: undefined, ownerAppuserKey: appuser, tenantKey: tenant }, { orderBy: { createdAt: QueryOrder.DESC }, populate: ['currencyKey'] });
  return res.json({ loans: await Promise.all(loans.map(enrichLoan)) });
}

export async function updateLoan(req: Request, res: Response) {
  const { body, params: { loanId } } = await zParse(updateLoanSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await DI.em.findOne(Loan, { deletedAt: undefined, loanKey: loanId, ownerAppuserKey: appuser, tenantKey: tenant }, { populate: ['currencyKey'] });
  if (!loan) return res.sendStatus(404);
  validateMergedLoanUpdate(loan, body);
  const patch = buildLoanUpdatePatch(body);
  if (body.currencyKey !== undefined) {
    const currency = await DI.em.findOne(Currency, { currencyKey: body.currencyKey });
    if (!currency) throw new BadRequestError('Currency not found');
    patch['currencyKey'] = currency;
  }
  DI.em.assign(loan, patch, { ignoreUndefined: true });
  await DI.em.persist(loan).flush();
  return res.json({ loan: await enrichLoan(loan) });
}

export async function updateLoanRepayment(req: Request, res: Response) {
  const { body, params: { loanId, repaymentLinkId } } = await zParse(updateLoanRepaymentSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const repayment = await DI.em.findOne(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan, loanRepaymentLinkKey: repaymentLinkId, tenantKey: tenant }, { populate: ['loanKey', 'transactionKey'] });
  if (!repayment) return res.sendStatus(404);
  const mergedAllocation = {
    feeAmount: body.feeAmount ?? repayment.feeAmount,
    interestAmount: body.interestAmount ?? repayment.interestAmount,
    principalAmount: body.principalAmount ?? repayment.principalAmount,
    totalPaymentAmount: body.totalPaymentAmount ?? repayment.totalPaymentAmount,
  };
  const validation = validateRepaymentAllocation(mergedAllocation);
  if (!validation.valid) throw new BadRequestError(validation.reason);
  assertAllocationWithinTransactionAmount(mergedAllocation.totalPaymentAmount, repayment.transactionKey as Transaction);
  const otherRepayments = await DI.em.find(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan, loanRepaymentLinkKey: { $ne: repayment.loanRepaymentLinkKey } });
  const outstandingPrincipal = calculateOutstandingPrincipalWithAdjustments({
    adjustments: [],
    openingPrincipalBalance: loan.openingPrincipalBalance,
    principalRepayments: otherRepayments.map((link) => ({ amount: link.principalAmount, effectiveDate: link.paymentDate })),
  });
  assertPrincipalWithinOutstanding(mergedAllocation.principalAmount, outstandingPrincipal + repayment.principalAmount);
  DI.em.assign(repayment, body);
  repayment.linkedByAppuserKey = appuser;
  await DI.em.persist(repayment).flush();
  return res.json({ repayment: serializeRepayment(repayment, repayment.transactionKey as Transaction) });
}

export function validateMergedLoanUpdate(
  loan: Loan,
  patch: Partial<Pick<Loan, 'maturityDate' | 'openingBalanceDate' | 'openingPrincipalBalance' | 'originalPrincipal'>>,
) {
  const mergedOpeningBalanceDate = patch.openingBalanceDate ?? loan.openingBalanceDate;
  const mergedOpeningPrincipalBalance = patch.openingPrincipalBalance ?? loan.openingPrincipalBalance;
  const mergedOriginalPrincipal = patch.originalPrincipal ?? loan.originalPrincipal;
  const mergedMaturityDate = patch.maturityDate ?? loan.maturityDate;

  if (mergedOriginalPrincipal != null && mergedOriginalPrincipal < mergedOpeningPrincipalBalance) {
    throw new BadRequestError('originalPrincipal must be greater than or equal to openingPrincipalBalance');
  }

  if (mergedMaturityDate != null && mergedMaturityDate <= mergedOpeningBalanceDate) {
    throw new BadRequestError('maturityDate must be after openingBalanceDate');
  }
}

function buildLoanDto(loan: Loan, computed: Record<string, unknown> = {}) {
  const currency = loan.currencyKey as Currency | undefined;
  return {
    annualInterestRateBps: loan.annualInterestRateBps,
    currency: currency ? { code: currency.code, currencyKey: currency.currencyKey } : undefined,
    includeInNetWorth: loan.includeInNetWorth,
    loanKey: loan.loanKey,
    maturityDate: loan.maturityDate,
    name: loan.name,
    notes: loan.notes,
    openingBalanceDate: loan.openingBalanceDate,
    openingPrincipalBalance: loan.openingPrincipalBalance,
    originalPrincipal: loan.originalPrincipal,
    paymentDayOfMonth: loan.paymentDayOfMonth,
    paymentFrequency: loan.paymentFrequency,
    providerName: loan.providerName,
    rateType: loan.rateType,
    regularPaymentAmount: loan.regularPaymentAmount,
    status: loan.status,
    termMonths: loan.termMonths,
    type: loan.type,
    ...computed,
  };
}

function buildSuggestedAllocation(totalPaymentAmount: number, loan: Loan, outstandingPrincipal: number) {
  const annualInterestRateBps = loan.annualInterestRateBps ?? 0;
  const estimate = estimateRepaymentAllocation({ annualInterestRateBps, outstandingPrincipal, totalPaymentAmount });
  return {
    feeAmount: estimate.feeAmount,
    interestAmount: estimate.interestAmount,
    needsReview: estimate.needsReview,
    negativeAmortization: estimate.negativeAmortization,
    principalAmount: estimate.principalAmount,
    totalPaymentAmount: estimate.totalPaymentAmount,
  };
}

async function enrichLoan(loan: Loan) {
  const [repaymentLinks, adjustments] = await Promise.all([
    DI.em.find(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan }),
    DI.em.find(LoanAdjustment, { deletedAt: undefined, loanKey: loan }),
  ]);

  const outstandingPrincipal = calculateOutstandingPrincipalWithAdjustments({
    adjustments: adjustments.map((adj) => ({ amount: adj.amount, effectiveDate: adj.effectiveDate, type: adj.type })),
    openingPrincipalBalance: loan.openingPrincipalBalance,
    principalRepayments: repaymentLinks.map((link) => ({ amount: link.principalAmount, effectiveDate: link.paymentDate })),
  });

  const progress = calculateLoanProgress({
    openingPrincipalBalance: loan.openingPrincipalBalance,
    originalPrincipal: loan.originalPrincipal,
    outstandingPrincipal,
  });

  const remainingTermMonthsEstimated =
    loan.annualInterestRateBps != null && loan.regularPaymentAmount != null
      ? calculateRemainingTermMonths({
          annualInterestRateBps: loan.annualInterestRateBps,
          outstandingPrincipal,
          regularPaymentAmount: loan.regularPaymentAmount,
        })
      : null;

  const nextPaymentDate = loan.paymentDayOfMonth ? calculateNextPaymentDate(new Date(), loan.paymentDayOfMonth) : null;

  return buildLoanDto(loan, {
    nextPaymentDate,
    outstandingPrincipal,
    progressBasis: progress.progressBasis,
    progressPercentage: progress.progressPercentage,
    remainingTermMonthsEstimated,
  });
}

async function loadOwnedLoan(loanId: number, appuser: Appuser, tenant: Tenant) {
  return DI.em.findOne(Loan, { deletedAt: undefined, loanKey: loanId, ownerAppuserKey: appuser, tenantKey: tenant }, { populate: ['currencyKey'] });
}

async function loadOwnedOutflowTransaction(transactionKey: number, tenant: Tenant) {
  return DI.em.findOne(Transaction, { deletedAt: undefined, settlementAmount: { $lt: 0 }, tenantKey: tenant, transactionKey }, { populate: ['transactionMerchantKey'] });
}

function serializeRepayment(repayment: LoanRepaymentLink, transaction: Transaction) {
  return {
    allocationSource: repayment.allocationSource,
    feeAmount: repayment.feeAmount,
    interestAmount: repayment.interestAmount,
    linkedByAppuserKey: repayment.linkedByAppuserKey,
    loanKey: repayment.loanKey,
    loanRepaymentLinkKey: repayment.loanRepaymentLinkKey,
    needsReview: repayment.needsReview,
    notes: repayment.notes,
    paymentDate: repayment.paymentDate,
    principalAmount: repayment.principalAmount,
    tenantKey: repayment.tenantKey,
    totalPaymentAmount: repayment.totalPaymentAmount,
    transaction: summarizeTransaction(transaction),
    transactionKey: repayment.transactionKey,
  };
}

function summarizeTransaction(transaction: Transaction) {
  const merchant = transaction.transactionMerchantKey as undefined | { name?: string };
  return {
    description: transaction.description,
    merchantName: merchant?.name,
    settlementAmount: transaction.settlementAmount,
    transactionDate: transaction.transactionDate,
    transactionKey: transaction.transactionKey,
  };
}
