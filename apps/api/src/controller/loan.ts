import type { FilterQuery, RequiredEntityData } from '@mikro-orm/core';
import { QueryOrder, UniqueConstraintViolationException } from '@mikro-orm/core';
import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Currency } from '@entity/Currency';
import { Loan } from '@entity/Loan';
import { LoanAdjustment } from '@entity/LoanAdjustment';
import { LoanRatePeriod } from '@entity/LoanRatePeriod';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { accountActor, assertTransactionWritable } from '@service/account/account-access';
import { convertAtLatestRate, rateScope } from '@service/currency/exchange-rate';
import { addMonthsClamped, buildAmortizationSchedule } from '@service/loan/amortization-schedule';
import {
  calculateLoanProgress,
  calculateNextPaymentDate,
  calculateOutstandingPrincipalWithAdjustments,
  calculateRemainingTermMonths,
  estimateRepaymentAllocation,
  validateRepaymentAllocation,
} from '@service/loan/loan-calculation.service';
import { buildLoanProjection } from '@service/loan/loan-projection.service';
import { scoreLoanRepaymentCandidate } from '@service/loan/loan-repayment-matching.service';
import { findSecurableAsset, type LoanViewer, type SecuredAssetDto, securedAssetsOf } from '@service/loan/loan-secured-asset';
import { LoanAdjustmentType, LoanAllocationSource, LoanAmortizationMethod, LoanPaymentFrequency, LoanRateType, LoanStatus } from '@service/loan/loan-types';
import { type LoanRatePeriodInput, resolveLoanRate } from '@service/loan/rate-resolver';
import { isSplit } from '@service/transaction/transaction-split.service';
import { excludeExpired } from '@service/transaction/transaction-status';
import { BadRequestError, ConflictError, ERROR_CODE, UnprocessableEntityError } from '@utils/errors';
import { big, roundDisplay } from '@utils/money';
import {
  createLoanAdjustmentSchema,
  createLoanRatePeriodSchema,
  createLoanSchema,
  deleteLoanAdjustmentSchema,
  deleteLoanRatePeriodSchema,
  deleteLoanRepaymentSchema,
  linkLoanRepaymentSchema,
  loanIdParamSchema,
  loanProjectionSchema,
  repaymentCandidatesSchema,
  updateLoanAdjustmentSchema,
  updateLoanRatePeriodSchema,
  updateLoanRepaymentSchema,
  updateLoanSchema,
} from '@validators/loan';
import { zParse } from '@validators/parser';

const TRANSACTION_OUTFLOW_TOLERANCE = 0.01;

interface LoanPatchInput {
  amortizationMethod?: LoanAmortizationMethod;
  annualInterestRateBps?: number;
  firstPaymentDate?: Date;
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
    'amortizationMethod', 'annualInterestRateBps', 'firstPaymentDate', 'includeInNetWorth', 'maturityDate', 'name', 'notes', 'openingBalanceDate',
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
  const securedAsset = body.securedAssetKey == null ? null : await findSecurableAsset(DI.em, loanViewer(appuser, tenant), body.securedAssetKey);
  const loan = DI.em.create(Loan, {
    amortizationMethod: body.amortizationMethod ?? LoanAmortizationMethod.FRENCH,
    annualInterestRateBps: body.annualInterestRateBps,
    currencyKey: currency,
    firstPaymentDate: body.firstPaymentDate,
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
    securedAssetKey: securedAsset,
    status: body.status ?? LoanStatus.ACTIVE,
    tenantKey: tenant,
    termMonths: body.termMonths,
    type: body.type,
  } as RequiredEntityData<Loan>);
  await DI.em.persist(loan).flush();
  return res.status(201).json({ loan: await describeLoan(loan, appuser, tenant) });
}

export async function createLoanAdjustment(req: Request, res: Response) {
  const { body, params: { loanId } } = await zParse(createLoanAdjustmentSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const adjustment = DI.em.create(LoanAdjustment, { ...body, createdByAppuserKey: appuser, loanKey: loan, tenantKey: tenant } as RequiredEntityData<LoanAdjustment>);
  await DI.em.persist(adjustment).flush();
  return res.status(201).json({ adjustment: serializeAdjustment(adjustment), outstandingPrincipal: await currentOutstandingPrincipal(loan, new Date()) });
}

export async function createLoanRatePeriod(req: Request, res: Response) {
  const { body, params: { loanId } } = await zParse(createLoanRatePeriodSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  await assertUniqueRateDate(loan, body.effectiveDate);
  const ratePeriod = DI.em.create(LoanRatePeriod, { ...body, loanKey: loan, tenantKey: tenant } as RequiredEntityData<LoanRatePeriod>);
  try {
    await DI.em.persist(ratePeriod).flush();
  } catch (error) {
    if (error instanceof UniqueConstraintViolationException) throw new ConflictError('A rate period already exists for this effective date');
    throw error;
  }
  return res.status(201).json({ annualInterestRateBps: await currentLoanRate(loan, new Date()), ratePeriod: serializeRatePeriod(ratePeriod) });
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

export async function deleteLoanAdjustment(req: Request, res: Response) {
  const { params: { adjustmentId, loanId } } = await zParse(deleteLoanAdjustmentSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const adjustment = await DI.em.findOne(LoanAdjustment, { deletedAt: undefined, loanAdjustmentKey: adjustmentId, loanKey: loan, tenantKey: tenant });
  if (!adjustment) return res.sendStatus(404);
  adjustment.deletedAt = new Date();
  await DI.em.persist(adjustment).flush();
  return res.status(200).json({ outstandingPrincipal: await currentOutstandingPrincipal(loan, new Date()) });
}

export async function deleteLoanRatePeriod(req: Request, res: Response) {
  const { params: { loanId, ratePeriodId } } = await zParse(deleteLoanRatePeriodSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const ratePeriod = await DI.em.findOne(LoanRatePeriod, { deletedAt: undefined, loanKey: loan, loanRatePeriodKey: ratePeriodId, tenantKey: tenant });
  if (!ratePeriod) return res.sendStatus(404);
  ratePeriod.deletedAt = new Date();
  await DI.em.persist(ratePeriod).flush();
  return res.status(200).json({ annualInterestRateBps: await currentLoanRate(loan, new Date()) });
}

export async function deleteLoanRepayment(req: Request, res: Response) {
  const { params: { loanId, repaymentLinkId } } = await zParse(deleteLoanRepaymentSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const repayment = await DI.em.findOne(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan, loanRepaymentLinkKey: repaymentLinkId, tenantKey: tenant });
  if (!repayment) return res.sendStatus(404);
  // A repayment splits its transaction into principal, interest and fees: a change to that transaction.
  await assertTransactionWritable(DI.em, repayment.transactionKey.transactionKey, accountActor(req));
  repayment.deletedAt = new Date();
  await DI.em.persist(repayment).flush();
  return res.sendStatus(204);
}

export async function getLoan(req: Request, res: Response) {
  const { params: { loanId } } = await zParse(loanIdParamSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await DI.em.findOne(Loan, { deletedAt: undefined, loanKey: loanId, ownerAppuserKey: appuser, tenantKey: tenant }, { populate: ['currencyKey'] });
  if (!loan) return res.sendStatus(404);
  return res.json({ loan: await describeLoan(loan, appuser, tenant) });
}

export async function getLoanOverview(req: Request, res: Response) {
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loans = await DI.em.find(Loan, { deletedAt: undefined, ownerAppuserKey: appuser, tenantKey: tenant }, { populate: ['currencyKey'] });
  await DI.em.populate(appuser, ['currencyKey']);
  const userCurrency = appuser.currencyKey;
  const enriched = await Promise.all(loans.map((loan) => enrichLoan(loan)));
  // Totals are in the user's currency. A loan in another currency is converted at the latest
  // rate on or before today; one with no such rate is left out of every total and counted.
  const today = new Date();
  const converted = await Promise.all(
    loans.map(async (loan, index) => {
      const { outstandingPrincipal } = enriched[index] as { outstandingPrincipal?: number };
      const convert = (value: number) => convertAtLatestRate(DI.em, value, loan.currencyKey, userCurrency, today, rateScope(tenant));
      const [principal, payment] = await Promise.all([convert(outstandingPrincipal ?? 0), convert(loan.regularPaymentAmount ?? 0)]);
      return principal == null || payment == null ? null : { includeInNetWorth: loan.includeInNetWorth, outstandingPrincipal: principal, regularPaymentAmount: payment };
    }),
  );
  const totals = converted.filter((loan) => loan !== null);
  const sum = (rows: typeof totals, field: 'outstandingPrincipal' | 'regularPaymentAmount') => roundDisplay(rows.reduce((total, row) => total.plus(big(row[field])), big(0)));
  return res.json({
    overview: {
      currency: userCurrency.code,
      interestFeesThisMonth: 0,
      monthlyRepaymentTotal: sum(totals, 'regularPaymentAmount'),
      netWorthImpact: -sum(totals.filter((loan) => loan.includeInNetWorth), 'outstandingPrincipal'),
      repaymentsNeedingReviewCount: 0,
      totalOutstandingDebt: sum(totals, 'outstandingPrincipal'),
      unconvertedLoanCount: converted.length - totals.length,
    },
  });
}

export async function getLoanProjection(req: Request, res: Response) {
  const { params: { loanId }, query } = await zParse(loanProjectionSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);

  // The contract terms the schedule and the projection both need.
  const principal = loan.originalPrincipal ?? loan.openingPrincipalBalance;
  const annualInterestRateBps = loan.annualInterestRateBps;
  const termMonths = loan.termMonths;
  const missing = (reason: string) =>
    new UnprocessableEntityError(
      'The loan needs a principal, an interest rate and a term to project a payoff',
      ERROR_CODE.LOAN_PROJECTION_UNAVAILABLE,
      { reason },
    );
  if (annualInterestRateBps == null) throw missing('MISSING_INTEREST_RATE');
  if (termMonths == null) throw missing('MISSING_TERM');
  if (!(principal > 0)) throw missing('MISSING_PRINCIPAL');

  const firstPaymentDate =
    loan.firstPaymentDate ??
    addMonthsClamped(loan.openingBalanceDate, 1, loan.paymentDayOfMonth ?? loan.openingBalanceDate.getUTCDate());

  const now = new Date();
  const projection = buildLoanProjection({
    amortizationMethod: loan.amortizationMethod,
    annualInterestRateBps,
    contractPayment: loan.regularPaymentAmount ?? undefined,
    extraPayment: query.extra,
    firstPaymentDate,
    frequency: query.frequency,
    now,
    originalPrincipal: principal,
    outstandingPrincipal: await currentOutstandingPrincipal(loan, now),
    ratePeriods: await loadRatePeriods(loan),
    startDate: query.startDate ?? now,
    termMonths,
  });

  return res.json({ projection });
}

export async function getLoanSchedule(req: Request, res: Response) {
  const { params: { loanId } } = await zParse(loanIdParamSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);

  // The contract schedule is for the amount originally borrowed; a loan added
  // part-way through its life still shows the whole contract.
  const principal = loan.originalPrincipal ?? loan.openingPrincipalBalance;
  const annualInterestRateBps = loan.annualInterestRateBps;
  const termMonths = loan.termMonths;
  const missing = (reason: string) =>
    new UnprocessableEntityError(
      'The loan needs a principal, an interest rate and a term to build a schedule',
      ERROR_CODE.LOAN_SCHEDULE_UNAVAILABLE,
      { reason },
    );
  if (annualInterestRateBps == null) throw missing('MISSING_INTEREST_RATE');
  if (termMonths == null) throw missing('MISSING_TERM');
  if (!(principal > 0)) throw missing('MISSING_PRINCIPAL');

  const firstPaymentDate =
    loan.firstPaymentDate ??
    addMonthsClamped(loan.openingBalanceDate, 1, loan.paymentDayOfMonth ?? loan.openingBalanceDate.getUTCDate());
  const schedule = buildAmortizationSchedule({
    annualInterestRateBps,
    firstPaymentDate,
    method: loan.amortizationMethod,
    principal,
    ratePeriods: await loadRatePeriods(loan),
    termMonths,
  });

  // A row is paid when a linked repayment falls inside its period: from its own
  // due date up to (but not including) the next row's.
  const repayments = await DI.em.find(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan });
  const rows = schedule.rows.map((row, index) => {
    const next = schedule.rows[index + 1];
    const periodEnd = next ? next.date : addMonthsClamped(row.date, 1, row.date.getUTCDate());
    const paid = repayments.some(
      (repayment) => repayment.paymentDate.getTime() >= row.date.getTime() && repayment.paymentDate.getTime() < periodEnd.getTime(),
    );
    return { ...row, date: row.date.toISOString(), paid };
  });

  return res.json({
    schedule: {
      rows,
      totalInterest: schedule.totalInterest,
      totalPaid: schedule.totalPaid,
    },
  });
}

export async function getLoanSummary(req: Request, res: Response) {
  const { params: { loanId } } = await zParse(loanIdParamSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await DI.em.findOne(Loan, { deletedAt: undefined, loanKey: loanId, ownerAppuserKey: appuser, tenantKey: tenant }, { populate: ['currencyKey'] });
  if (!loan) return res.sendStatus(404);
  return res.json({ loan: await describeLoan(loan, appuser, tenant) });
}

export async function linkLoanRepayment(req: Request, res: Response) {
  const { body, params: { loanId }, query: { transactionKey } } = await zParse(linkLoanRepaymentSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const transaction = await loadOwnedOutflowTransaction(transactionKey, tenant);
  if (!transaction) return res.sendStatus(404);
  await assertTransactionWritable(DI.em, transaction.transactionKey, accountActor(req));
  const duplicate = await DI.em.findOne(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan, transactionKey: transaction });
  if (duplicate) throw new ConflictError('Repayment already linked');
  // A split already shares the payment out over categories; counting its interest on top would
  // count the payment twice. Remove the split first.
  if (await isSplit(DI.em, transaction)) throw new ConflictError('A split transaction cannot be linked as a loan repayment', ERROR_CODE.TRANSACTION_IS_SPLIT);
  const paymentDate = transaction.transactionDate ?? new Date();
  // The principal is checked against the balance on the payment's own date, not today's: a
  // later lender correction must not block recording a repayment made before it.
  assertPrincipalWithinOutstanding(body.principalAmount, await currentOutstandingPrincipal(loan, paymentDate));
  assertAllocationWithinTransactionAmount(body.totalPaymentAmount, transaction);
  const allocation = validateRepaymentAllocation(body);
  if (!allocation.valid) throw new BadRequestError(allocation.reason);
  const repayment = DI.em.create(LoanRepaymentLink, {
    allocationSource: LoanAllocationSource.MANUAL,
    feeAmount: body.feeAmount,
    interestAmount: body.interestAmount,
    linkedByAppuserKey: appuser,
    loanKey: loan,
    paymentDate,
    principalAmount: body.principalAmount,
    tenantKey: tenant,
    totalPaymentAmount: body.totalPaymentAmount,
    transactionKey: transaction,
  } as RequiredEntityData<LoanRepaymentLink>);
  await DI.em.persist(repayment).flush();
  return res.status(201).json({ repayment: serializeRepayment(repayment, transaction) });
}

export async function listLoanAdjustments(req: Request, res: Response) {
  const { params: { loanId } } = await zParse(loanIdParamSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const adjustments = await DI.em.find(LoanAdjustment, { deletedAt: undefined, loanKey: loan, tenantKey: tenant }, { orderBy: { effectiveDate: QueryOrder.ASC, loanAdjustmentKey: QueryOrder.ASC } });
  return res.json({ adjustments: adjustments.map(serializeAdjustment) });
}

export async function listLoanRatePeriods(req: Request, res: Response) {
  const { params: { loanId } } = await zParse(loanIdParamSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const ratePeriods = await DI.em.find(LoanRatePeriod, { deletedAt: undefined, loanKey: loan, tenantKey: tenant }, { orderBy: { effectiveDate: QueryOrder.ASC } });
  return res.json({ ratePeriods: ratePeriods.map(serializeRatePeriod) });
}

export async function listLoanRepaymentCandidates(req: Request, res: Response) {
  const { params: { loanId }, query } = await zParse(repaymentCandidatesSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  // A rejected or cancelled payment (EXPIRED) repaid nothing, so it is no candidate.
  const candidates = await DI.em.find(Transaction, excludeExpired({
    deletedAt: undefined,
    settlementAmount: { $lt: 0 },
    tenantKey: tenant,
    ...(query.accountKey ? { accountKey: query.accountKey } : {}),
    ...(query.amount ? { settlementAmount: -Math.abs(query.amount) } : {}),
    ...(query.endDate || query.startDate ? { transactionDate: { ...(query.startDate ? { $gte: query.startDate } : {}), ...(query.endDate ? { $lte: query.endDate } : {}) } } : {}),
  } as FilterQuery<Transaction>), { orderBy: { transactionDate: QueryOrder.DESC }, populate: ['transactionMerchantKey'] });

  const outstandingPrincipal = await currentOutstandingPrincipal(loan, new Date());
  const ratePeriods = await loadRatePeriods(loan);

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
        suggestedAllocation: buildSuggestedAllocation(amount, loan, outstandingPrincipal, ratePeriods, transaction.transactionDate ?? new Date()),
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
  const securedAssets = await securedAssetsOf(DI.em, loanViewer(appuser, tenant), loans, new Date());
  return res.json({ loans: await Promise.all(loans.map((loan) => enrichLoan(loan, securedAssets))) });
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
  // Checked before anything is assigned, so a refused asset leaves the loan as it was.
  if (body.securedAssetKey !== undefined) {
    patch['securedAssetKey'] = body.securedAssetKey === null ? null : await findSecurableAsset(DI.em, loanViewer(appuser, tenant), body.securedAssetKey);
  }
  DI.em.assign(loan, patch, { ignoreUndefined: true });
  await DI.em.persist(loan).flush();
  return res.json({ loan: await describeLoan(loan, appuser, tenant) });
}

export async function updateLoanAdjustment(req: Request, res: Response) {
  const { body, params: { adjustmentId, loanId } } = await zParse(updateLoanAdjustmentSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const adjustment = await DI.em.findOne(LoanAdjustment, { deletedAt: undefined, loanAdjustmentKey: adjustmentId, loanKey: loan, tenantKey: tenant });
  if (!adjustment) return res.sendStatus(404);
  const type = body.type ?? adjustment.type;
  const amount = body.amount ?? adjustment.amount;
  if (type === LoanAdjustmentType.BALANCE_CORRECTION ? amount < 0 : amount <= 0) throw new BadRequestError('Invalid adjustment amount');
  DI.em.assign(adjustment, body);
  await DI.em.persist(adjustment).flush();
  return res.json({ adjustment: serializeAdjustment(adjustment), outstandingPrincipal: await currentOutstandingPrincipal(loan, new Date()) });
}

export async function updateLoanRatePeriod(req: Request, res: Response) {
  const { body, params: { loanId, ratePeriodId } } = await zParse(updateLoanRatePeriodSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const ratePeriod = await DI.em.findOne(LoanRatePeriod, { deletedAt: undefined, loanKey: loan, loanRatePeriodKey: ratePeriodId, tenantKey: tenant });
  if (!ratePeriod) return res.sendStatus(404);
  if (body.effectiveDate) await assertUniqueRateDate(loan, body.effectiveDate, ratePeriod);
  DI.em.assign(ratePeriod, body);
  try {
    await DI.em.persist(ratePeriod).flush();
  } catch (error) {
    if (error instanceof UniqueConstraintViolationException) throw new ConflictError('A rate period already exists for this effective date');
    throw error;
  }
  return res.json({ annualInterestRateBps: await currentLoanRate(loan, new Date()), ratePeriod: serializeRatePeriod(ratePeriod) });
}

export async function updateLoanRepayment(req: Request, res: Response) {
  const { body, params: { loanId, repaymentLinkId } } = await zParse(updateLoanRepaymentSchema, req);
  const { appuser, tenant } = await getLoanRequestContext(req);
  const loan = await loadOwnedLoan(loanId, appuser, tenant);
  if (!loan) return res.sendStatus(404);
  const repayment = await DI.em.findOne(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan, loanRepaymentLinkKey: repaymentLinkId, tenantKey: tenant }, { populate: ['loanKey', 'transactionKey'] });
  if (!repayment) return res.sendStatus(404);
  await assertTransactionWritable(DI.em, repayment.transactionKey.transactionKey, accountActor(req));
  const mergedAllocation = {
    feeAmount: body.feeAmount ?? repayment.feeAmount,
    interestAmount: body.interestAmount ?? repayment.interestAmount,
    principalAmount: body.principalAmount ?? repayment.principalAmount,
    totalPaymentAmount: body.totalPaymentAmount ?? repayment.totalPaymentAmount,
  };
  const validation = validateRepaymentAllocation(mergedAllocation);
  if (!validation.valid) throw new BadRequestError(validation.reason);
  assertAllocationWithinTransactionAmount(mergedAllocation.totalPaymentAmount, repayment.transactionKey);
  // The balance on the repayment's own date, without the repayment being edited.
  const outstandingPrincipal = await currentOutstandingPrincipal(loan, repayment.paymentDate, repayment);
  assertPrincipalWithinOutstanding(mergedAllocation.principalAmount, outstandingPrincipal);
  DI.em.assign(repayment, body);
  repayment.linkedByAppuserKey = appuser;
  await DI.em.persist(repayment).flush();
  return res.json({ repayment: serializeRepayment(repayment, repayment.transactionKey) });
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

async function assertUniqueRateDate(loan: Loan, effectiveDate: Date, except?: LoanRatePeriod) {
  const existing = await DI.em.findOne(LoanRatePeriod, { deletedAt: undefined, effectiveDate, loanKey: loan, tenantKey: loan.tenantKey });
  if (existing && existing.loanRatePeriodKey !== except?.loanRatePeriodKey) throw new ConflictError('A rate period already exists for this effective date');
}

function buildLoanDto(loan: Loan, computed: Record<string, unknown> = {}) {
  const currency = loan.currencyKey as Currency | undefined;
  return {
    amortizationMethod: loan.amortizationMethod,
    annualInterestRateBps: loan.annualInterestRateBps,
    currency: currency ? { code: currency.code, currencyKey: currency.currencyKey } : undefined,
    firstPaymentDate: loan.firstPaymentDate,
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

function buildSuggestedAllocation(totalPaymentAmount: number, loan: Loan, outstandingPrincipal: number, ratePeriods: readonly LoanRatePeriodInput[], paymentDate: Date) {
  const annualInterestRateBps = loan.annualInterestRateBps ?? 0;
  const estimate = estimateRepaymentAllocation({ annualInterestRateBps, outstandingPrincipal, paymentDate, ratePeriods, totalPaymentAmount });
  return {
    feeAmount: estimate.feeAmount,
    interestAmount: estimate.interestAmount,
    needsReview: estimate.needsReview,
    negativeAmortization: estimate.negativeAmortization,
    principalAmount: estimate.principalAmount,
    totalPaymentAmount: estimate.totalPaymentAmount,
  };
}

/**
 * The outstanding principal on `asOfDate` (today, or a repayment's own date): events dated after
 * it are left out, so a future-dated correction does not change today's debt. `except` leaves out
 * the repayment being edited.
 */
async function currentOutstandingPrincipal(loan: Loan, asOfDate: Date, except?: LoanRepaymentLink): Promise<number> {
  const [repaymentLinks, adjustments] = await Promise.all([
    DI.em.find(LoanRepaymentLink, {
      deletedAt: undefined,
      loanKey: loan,
      paymentDate: { $lte: asOfDate },
      ...(except ? { loanRepaymentLinkKey: { $ne: except.loanRepaymentLinkKey } } : {}),
    }),
    DI.em.find(LoanAdjustment, { deletedAt: undefined, effectiveDate: { $lte: asOfDate }, loanKey: loan }),
  ]);

  return calculateOutstandingPrincipalWithAdjustments({
    adjustments: adjustments.map((adj) => ({ amount: adj.amount, effectiveDate: adj.effectiveDate, type: adj.type })),
    asOfDate,
    openingPrincipalBalance: loan.openingPrincipalBalance,
    principalRepayments: repaymentLinks.map((link) => ({ amount: link.principalAmount, effectiveDate: link.paymentDate })),
  });
}

/** One loan's DTO, with the asset it is secured against. */
async function describeLoan(loan: Loan, appuser: Appuser, tenant: Tenant) {
  return enrichLoan(loan, await securedAssetsOf(DI.em, loanViewer(appuser, tenant), [loan], new Date()));
}

/** `securedAssets`: the visible assets the loans are secured against (`securedAssetsOf`); a loan whose asset is absent shows none. */
async function enrichLoan(loan: Loan, securedAssets: ReadonlyMap<number, SecuredAssetDto> = new Map()) {
  const now = new Date();
  const outstandingPrincipal = await currentOutstandingPrincipal(loan, now);
  const currentRate = await currentLoanRate(loan, now);

  const progress = calculateLoanProgress({
    openingPrincipalBalance: loan.openingPrincipalBalance,
    originalPrincipal: loan.originalPrincipal,
    outstandingPrincipal,
  });

  const remainingTermMonthsEstimated =
    currentRate != null && loan.regularPaymentAmount != null
      ? calculateRemainingTermMonths({
          annualInterestRateBps: currentRate,
          outstandingPrincipal,
          regularPaymentAmount: loan.regularPaymentAmount,
        })
      : null;

  const nextPaymentDate = loan.paymentDayOfMonth ? calculateNextPaymentDate(now, loan.paymentDayOfMonth) : null;

  return buildLoanDto(loan, {
    // The rate in force today; the stored rate is the one before any rate change.
    annualInterestRateBps: currentRate,
    initialAnnualInterestRateBps: loan.annualInterestRateBps ?? null,
    nextPaymentDate,
    outstandingPrincipal,
    progressBasis: progress.progressBasis,
    progressPercentage: progress.progressPercentage,
    remainingTermMonthsEstimated,
    securedAsset: (loan.securedAssetKey && securedAssets.get(loan.securedAssetKey.manualAssetKey)) ?? null,
  });
}

async function getLoanRequestContext(req: Request): Promise<{ appuser: Appuser; tenant: Tenant }> {
  if (!req.user) {
    throw new BadRequestError('User not found');
  }
  const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(req.user);
  if (!appuserTenant) {
    throw new BadRequestError("User doesn't have AppuserTenant");
  }
  return { appuser: req.user, tenant: appuserTenant.tenantKey };
}

async function loadOwnedLoan(loanId: number, appuser: Appuser, tenant: Tenant) {
  return DI.em.findOne(Loan, { deletedAt: undefined, loanKey: loanId, ownerAppuserKey: appuser, tenantKey: tenant }, { populate: ['currencyKey'] });
}

async function loadOwnedOutflowTransaction(transactionKey: number, tenant: Tenant) {
  // An EXPIRED payment never happened, so it cannot be linked as a repayment.
  return DI.em.findOne(Transaction, excludeExpired({ deletedAt: undefined, settlementAmount: { $lt: 0 }, tenantKey: tenant, transactionKey }), { populate: ['transactionMerchantKey'] });
}

function loanViewer(appuser: Appuser, tenant: Tenant): LoanViewer {
  return { appuserKey: appuser.appuserKey, tenantKey: tenant.tenantKey };
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

/**
 * The rate in force on `date`: the latest rate period effective on or before it, else the
 * loan's stored rate. An unknown stored rate stays unknown (null) until a period takes effect;
 * nothing is assumed to be 0%.
 */
async function currentLoanRate(loan: Loan, date: Date): Promise<null | number> {
  const periods = await DI.em.find(LoanRatePeriod, { deletedAt: undefined, effectiveDate: { $lte: date }, loanKey: loan, tenantKey: loan.tenantKey }, { orderBy: { effectiveDate: QueryOrder.DESC } });
  if (loan.annualInterestRateBps == null) return periods[0]?.annualInterestRateBps ?? null;
  return resolveLoanRate(periods, date, loan.annualInterestRateBps);
}

async function loadRatePeriods(loan: Loan): Promise<LoanRatePeriodInput[]> {
  const periods = await DI.em.find(LoanRatePeriod, { deletedAt: undefined, loanKey: loan, tenantKey: loan.tenantKey }, { orderBy: { effectiveDate: QueryOrder.ASC } });
  return periods.map(({ annualInterestRateBps, effectiveDate }) => ({ annualInterestRateBps, effectiveDate }));
}

function serializeAdjustment(adjustment: LoanAdjustment) {
  return {
    amount: adjustment.amount,
    effectiveDate: adjustment.effectiveDate,
    loanAdjustmentKey: adjustment.loanAdjustmentKey,
    reason: adjustment.reason ?? null,
    type: adjustment.type,
  };
}

function serializeRatePeriod(ratePeriod: LoanRatePeriod) {
  return {
    annualInterestRateBps: ratePeriod.annualInterestRateBps,
    effectiveDate: ratePeriod.effectiveDate,
    loanRatePeriodKey: ratePeriod.loanRatePeriodKey,
  };
}
