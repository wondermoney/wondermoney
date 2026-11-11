import { decimalSeparatorForLocale, parseDecimal, parseDecimalNumber } from '@wondermoney/shared/decimal'
import { evaluateAmountExpression } from '@wondermoney/shared/amount-expression'

/**
 * Numbers people type into the app (amounts, prices, quantities, rates), read in the app's
 * language: "1.234,56" is 1234.56 in pt-PT and es, "1.000" is 1000 there and 1 in en.
 * Anything that is not clearly a number is `null`, so the form shows an error instead of
 * saving a different number. Values from the API are dot decimals and never go through here.
 */

/** The canonical dot-decimal string ("-1234.56") of what was typed, or `null`. */
export function parseDecimalInput(value: string, locale: string): string | null {
  return parseDecimal(value, { locale })
}

/** What was typed, as a number, or `null`. */
export function parseNumberInput(value: string, locale: string): number | null {
  return parseDecimalNumber(value, { locale })
}

/**
 * An amount the person typed: a plain locale number, or a small arithmetic expression
 * evaluated to cents ("12,40+3,15" is 15.55). A plain number is returned exactly as
 * `parseDecimalInput` reads it, so nothing that worked before changes. The result is the
 * dot-decimal string the API takes.
 */
export function parseAmountInput(value: string, locale: string): string | null {
  const plain = parseDecimal(value, { locale })
  if (plain !== null) return plain
  const result = evaluateAmountExpression(value, locale)
  return result === null ? null : formatExpressionResult(result)
}

/**
 * The result an amount field shows as its quiet "= 15,55" hint while the text is an
 * expression, or `null` when it is a plain number (which needs no hint) or not readable.
 */
export function amountExpressionResult(value: string, locale: string): number | null {
  if (value.trim() === '' || parseDecimal(value, { locale }) !== null) return null
  return evaluateAmountExpression(value, locale)
}

/** A rounded amount as the dot-decimal text the API takes ("15.55", "100"). */
function formatExpressionResult(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '')
}

/**
 * A stored number (or dot-decimal wire string) written back into an input, ungrouped and with
 * the locale's decimal separator, so that reading it again gives the same number: "1.234" in a
 * pt-PT input would otherwise read as 1234.
 */
export function formatNumberInput(value: number | string, locale: string): string {
  const text = String(value)
  return decimalSeparatorForLocale(locale) === ',' ? text.replace('.', ',') : text
}

/**
 * What was typed, as the dot-decimal text a model or payload builder reads with `Number()`: ''
 * when blank, and text that `Number()` reads as NaN when it is not a number, so validation
 * fails instead of a different number being saved ("1e3" or "0x10" would otherwise pass).
 */
export function toWireDecimalInput(value: string, locale: string): string {
  if (value.trim() === '') return ''
  return parseDecimalInput(value, locale) ?? 'invalid'
}
