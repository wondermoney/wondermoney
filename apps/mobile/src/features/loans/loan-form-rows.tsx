const positiveNumber = (raw: string) => { const value = Number(raw); return raw !== '' && Number.isFinite(value) && value > 0 }

/**
 * Which of a loan's typed numbers are entered and wrong. An empty field is
 * never wrong here: the required ones keep the ✓ disabled instead, and the
 * optional ones are simply left out.
 */
export function loanNumberErrors(fields: Readonly<{ openingPrincipalBalance: string; regularPaymentAmount: string; annualInterestRateBps: string; termMonths: string }>) {
  const principal = fields.openingPrincipalBalance.trim()
  const installment = fields.regularPaymentAmount.trim()
  const rate = fields.annualInterestRateBps.trim()
  const term = fields.termMonths.trim()
  const rateValue = Number(rate)
  const termValue = Number(term)
  return {
    principal: principal !== '' && !positiveNumber(principal),
    installment: installment !== '' && !positiveNumber(installment),
    rate: rate !== '' && !(Number.isFinite(rateValue) && rateValue >= 0 && rateValue <= 100),
    term: term !== '' && !(Number.isSafeInteger(termValue) && termValue > 0),
  }
}
