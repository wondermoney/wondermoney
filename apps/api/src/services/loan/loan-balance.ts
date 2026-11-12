import type { EntityManager } from '@mikro-orm/postgresql';

import type { Loan } from '@entity/Loan';
import { LoanAdjustment } from '@entity/LoanAdjustment';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';

import { calculateOutstandingPrincipalWithAdjustments } from './loan-calculation.service';

/**
 * Each loan's outstanding principal on `asOfDate`, keyed by loan key: the opening balance less
 * the principal of linked repayments, with the lender's adjustments applied, counting only what
 * is dated on or before that day. Two queries for any number of loans.
 */
export async function outstandingPrincipalsOn(em: EntityManager, loans: readonly Loan[], asOfDate: Date): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (loans.length === 0) return result;
  const [repayments, adjustments] = await Promise.all([
    em.find(LoanRepaymentLink, { deletedAt: undefined, loanKey: { $in: [...loans] }, paymentDate: { $lte: asOfDate } }),
    em.find(LoanAdjustment, { deletedAt: undefined, effectiveDate: { $lte: asOfDate }, loanKey: { $in: [...loans] } }),
  ]);
  for (const loan of loans) {
    const ownRepayments = repayments.filter((repayment) => repayment.loanKey.loanKey === loan.loanKey);
    const ownAdjustments = adjustments.filter((adjustment) => adjustment.loanKey.loanKey === loan.loanKey);
    result.set(loan.loanKey, calculateOutstandingPrincipalWithAdjustments({
      adjustments: ownAdjustments.map((adjustment) => ({ amount: adjustment.amount, effectiveDate: adjustment.effectiveDate, type: adjustment.type })),
      asOfDate,
      openingPrincipalBalance: loan.openingPrincipalBalance,
      principalRepayments: ownRepayments.map((repayment) => ({ amount: repayment.principalAmount, effectiveDate: repayment.paymentDate })),
    }));
  }
  return result;
}
