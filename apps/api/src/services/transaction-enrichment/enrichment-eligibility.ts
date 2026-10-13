/**
 * Inputs the AI categoriser must never be asked about (RAD-584).
 *
 * A cash withdrawal and a person-to-person transfer carry no information about
 * what the money was spent on — the category is unknowable from the description
 * by construction, so any answer the model gives is invented. It gave them
 * anyway, confidently, and write mode applied the results: measured on
 * production 2026-08-23, 14.9% of applied writes at 0.70 confidence landed on
 * one of these (`ATM withdrawal at BPI Braga → FUEL`, `Transfer via MB Way to
 * Monica Pinto → CAFE_RESTAURANTS_BARS`, `Transfer to Fabio Costa €3,000 →
 * CAFE_RESTAURANTS_BARS`).
 *
 * No confidence threshold fixes this, which is why the filter is here at
 * candidate selection rather than at apply time — skipping them before the model
 * call also saves the tokens.
 *
 * The bank descriptions are Portuguese-first with an English-normalised variant
 * alongside, so both spellings are matched.
 */

/**
 * Cash withdrawals: `LEV ATM 3170 BPI ...`, `LEVANT Ecomarche ...`,
 * `Levantamento Pingo Doce`, and the bare `LEV <reference>` form Portuguese
 * banks use for a withdrawal at a merchant terminal (`LEV 8442573.89 Shop Serra
 * Nova`). `LEV` is only treated as a marker when followed by `ATM` or a
 * reference number, so it can't swallow a merchant whose name starts with it.
 *
 * `LEVANT` is a prefix match, so it covers `LEVANTAMENTO` too.
 */
const CASH_WITHDRAWAL_PATTERN = /\b(?:LEV\s+(?:ATM|\d)|LEVANT|ATM\s+WITHDRAWAL)/u;

/**
 * Value moved between people or accounts: MB Way, SEPA transfers, standing
 * orders, and the `Trsf.p/Ferias`-style self-transfers to a savings pot.
 */
const TRANSFER_PATTERN =
  /\b(?:MB\s*WAY|TRF|TRSF|TRANSFER|TRANSFERENCIA|TRANSFERÊNCIA|ORDEM\s+PERMANENTE|PERMANENT\s+ORDER)\b/u;

/**
 * True when the transaction's description identifies it as a withdrawal or a
 * transfer, and therefore as something no categoriser can legitimately label.
 *
 * Both the cleaned and the raw bank description are checked — normalisation
 * rewrites some of these strings and drops the marker from one but not the
 * other (`LEV ATM 3170 BESCL Moura` becomes `ATM Withdrawal at BESCL Moura`).
 */
export function isUncategorisableByDescription(
  transaction: Readonly<{ description?: null | string; descriptionDirty?: null | string }>,
): boolean {
  const haystack = `${transaction.description ?? ''}\n${transaction.descriptionDirty ?? ''}`.toUpperCase();
  if (!haystack.trim()) return false;
  return CASH_WITHDRAWAL_PATTERN.test(haystack) || TRANSFER_PATTERN.test(haystack);
}
