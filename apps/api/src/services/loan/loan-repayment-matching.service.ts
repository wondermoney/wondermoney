export interface LoanRepaymentCandidateInput {
  amount: number;
  candidateAmount?: number;
  loanMerchantName?: string;
  merchantName?: string;
  paymentDayOfMonth?: number;
  recurringPatternEvidence?: boolean;
  transactionDate?: Date;
  transactionDirection?: LoanRepaymentDirection;
}
export interface LoanRepaymentCandidateScore {
  confidence: LoanRepaymentConfidence;
  reasons: string[];
  score: number;
}

export type LoanRepaymentConfidence = 'HIGH' | 'LOW' | 'MEDIUM';

export type LoanRepaymentDirection = 'INFLOW' | 'OUTFLOW';

export function scoreLoanRepaymentCandidate(input: LoanRepaymentCandidateInput): LoanRepaymentCandidateScore {
  if (input.transactionDirection === 'INFLOW') {
    return { confidence: 'LOW', reasons: ['inflow_ineligible'], score: 0 };
  }

  const reasons: string[] = [];
  let score = 0;
  const candidateAmount = input.candidateAmount ?? input.amount;
  const amountDiff = Math.abs(Math.abs(candidateAmount) - Math.abs(input.amount));
  const amountTolerance = Math.max(1, Math.abs(input.amount) * 0.02);
  const amountMatch = amountDiff <= amountTolerance;
  const merchantMatch = Boolean(input.loanMerchantName && input.merchantName && normalize(input.loanMerchantName) === normalize(input.merchantName));
  const dateMatch = Boolean(input.transactionDate && input.paymentDayOfMonth != null && isDayOfMonthClose(input.transactionDate.getUTCDate(), input.paymentDayOfMonth));
  const monthlyPatternMatch = Boolean(input.recurringPatternEvidence && input.paymentDayOfMonth != null);

  if (amountMatch) {
    score += 60;
    reasons.push('amount_match');
  } else {
    score -= 30;
    reasons.push('amount_mismatch');
  }

  if (merchantMatch) {
    score += 20;
    reasons.push('merchant_match');
  }

  if (dateMatch) {
    score += 15;
    reasons.push('date_match');
  }

  if (monthlyPatternMatch) {
    score += 10;
    reasons.push('monthly_pattern');
  }

  score = Math.max(0, Math.min(100, score));
  const confidence: LoanRepaymentConfidence = amountMatch && merchantMatch && (dateMatch || monthlyPatternMatch) ? 'HIGH' : amountMatch ? 'MEDIUM' : 'LOW';
  return { confidence, reasons, score };
}

function isDayOfMonthClose(transactionDayOfMonth: number, paymentDayOfMonth: number, tolerance = 2): boolean {
  const directDistance = Math.abs(transactionDayOfMonth - paymentDayOfMonth);
  const wrappedDistance = Math.min(
    directDistance,
    Math.abs(transactionDayOfMonth + 31 - paymentDayOfMonth),
    Math.abs(paymentDayOfMonth + 31 - transactionDayOfMonth),
  );
  return wrappedDistance <= tolerance;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}
