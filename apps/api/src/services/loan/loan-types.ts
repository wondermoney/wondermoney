export enum LoanAdjustmentType {
  BALANCE_CORRECTION = 'BALANCE_CORRECTION',
  CAPITALIZED_INTEREST = 'CAPITALIZED_INTEREST',
  FEE = 'FEE',
  PRINCIPAL_DECREASE = 'PRINCIPAL_DECREASE',
  PRINCIPAL_INCREASE = 'PRINCIPAL_INCREASE',
  WRITE_OFF = 'WRITE_OFF',
}

export enum LoanAllocationSource {
  AMORTIZATION_ESTIMATE = 'AMORTIZATION_ESTIMATE',
  AUTO_MATCHED = 'AUTO_MATCHED',
  MANUAL = 'MANUAL',
}

export enum LoanAmortizationMethod {
  /** Constant principal each month; the payment falls as interest falls (SAC). */
  CONSTANT_PRINCIPAL = 'CONSTANT_PRINCIPAL',
  /** Level payment; the interest share falls and the principal share rises (Price). */
  FRENCH = 'FRENCH',
}

export enum LoanPaymentFrequency {
  MONTHLY = 'MONTHLY',
}

export enum LoanRateType {
  FIXED = 'FIXED',
  UNKNOWN = 'UNKNOWN',
}

export enum LoanStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
  PAID_OFF = 'PAID_OFF',
}

export enum LoanType {
  AUTO_LOAN = 'AUTO_LOAN',
  MORTGAGE = 'MORTGAGE',
  OTHER = 'OTHER',
  PERSONAL_LOAN = 'PERSONAL_LOAN',
  STUDENT_LOAN = 'STUDENT_LOAN',
}
