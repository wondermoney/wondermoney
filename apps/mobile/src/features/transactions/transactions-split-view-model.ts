import { formatNumberInput, parseAmountInput } from '@/lib/formatters/decimal-input'

import { MAX_SPLIT_LINES, type TransactionSplitLineDto, type TransactionSplitLineRequest } from './transactions-contract'
import type { TransactionViewModel } from './transactions-view-model'

/**
 * The arithmetic of the split editor: the lines a person types, what is left to assign, and the
 * request the API takes (`PUT /v1/account/transaction/:id/splits`).
 *
 * Money is counted in integer units of 0.0001 (the API stores four decimals), as bigints, so
 * "remaining to assign" is exact: 33.33 + 33.33 + 33.34 is 100, never 99.99999999999999. Input
 * is read in the app's language with `parseAmountInput`, so "1.234,56" and "1,234.56" are the
 * same figure and an ambiguous "1.000" follows the reader's locale.
 *
 * Lines are typed as magnitudes: a line of a -100 purchase is entered as "60", and every line
 * takes the transaction's sign, which the API requires anyway. A line may also be typed as a
 * percentage of the transaction ("25%"), worked out to the cent.
 */

/** The API stores line amounts with four decimals. */
export const SPLIT_AMOUNT_DECIMALS = 4
export { MAX_SPLIT_LINES }
const UNIT = 10n ** BigInt(SPLIT_AMOUNT_DECIMALS)
/** One cent in units: even splits and percentages round to cents. */
const CENT = UNIT / 100n

/** One line of the editor. The id keeps the row stable while lines are added and removed. */
export type SplitDraftLine = Readonly<{
  id: string
  /** Null for an uncategorized line. */
  categoryId: number | null
  /** What the person typed: a magnitude in their locale, or a percentage ("25%"). */
  amount: string
  notes: string
}>

export type SplitLineError = 'invalid' | 'too-precise' | 'zero'

export type SplitLineResult = Readonly<{
  /** The line's signed amount in units, or null when it is blank or unreadable. */
  units: bigint | null
  error: SplitLineError | null
}>

export type SplitProblem = 'too-few-lines' | 'line-errors' | 'unassigned' | 'over-assigned'

export type SplitSummary = Readonly<{
  lines: readonly SplitLineResult[]
  /** Signed sum of the readable lines. */
  assignedUnits: bigint
  /**
   * Signed: total minus assigned. Same sign as the total while something is left to assign,
   * the opposite sign when the lines add up to more than the transaction.
   */
  remainingUnits: bigint
  /** The first reason the split cannot be saved, or null when it can. */
  problem: SplitProblem | null
}>

const abs = (value: bigint) => (value < 0n ? -value : value)
const sign = (value: bigint) => (value < 0n ? -1n : 1n)

/** A canonical decimal ("-12.5") as units, or null when it has more than four decimals. */
export function decimalToUnits(decimal: string): bigint | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(decimal)
  if (!match) return null
  const [, minus, integer, fraction = ''] = match
  const trimmed = fraction.replace(/0+$/, '')
  if (trimmed.length > SPLIT_AMOUNT_DECIMALS) return null
  const units = BigInt(integer!) * UNIT + BigInt(trimmed.padEnd(SPLIT_AMOUNT_DECIMALS, '0') || '0')
  return minus ? -units : units
}

/** Units as a canonical decimal string for the API ("-12.5"); no float on the way. */
export function unitsToDecimal(units: bigint): string {
  const magnitude = abs(units)
  const integer = magnitude / UNIT
  const fraction = (magnitude % UNIT)
    .toString()
    .padStart(SPLIT_AMOUNT_DECIMALS, '0')
    .replace(/0+$/, '')
  const text = fraction ? `${integer}.${fraction}` : `${integer}`
  return units < 0n && magnitude > 0n ? `-${text}` : text
}

/** An amount the API sent as a number, in units. */
export function amountToUnits(amount: number): bigint {
  return decimalToUnits(amount.toFixed(SPLIT_AMOUNT_DECIMALS)) ?? 0n
}

/** Units as a number, for display through `Amount`. */
export function unitsToNumber(units: bigint): number {
  return Number(unitsToDecimal(units))
}

/** A line's magnitude written back into its field, in the reader's number format. */
export function formatUnitsForInput(units: bigint, locale: string): string {
  return formatNumberInput(unitsToDecimal(abs(units)), locale)
}

/** Rounds a non-negative units value to the nearest cent, halves up. */
function roundToCent(units: bigint): bigint {
  return ((units + CENT / 2n) / CENT) * CENT
}

/**
 * Reads one line as typed. Blank is no amount yet (not an error until saving); a percentage is
 * a share of `totalUnits`, rounded to the cent. The result carries the transaction's sign.
 */
export function parseSplitLineAmount(input: string, totalUnits: bigint, locale: string): SplitLineResult {
  const text = input.trim()
  if (text === '') return { units: null, error: null }

  const percent = /^(.*?)\s*%$/.exec(text)
  const parsed = parseAmountInput(percent ? percent[1]! : text, locale)
  if (parsed === null) return { units: null, error: 'invalid' }

  let magnitude: bigint | null
  if (percent) {
    const share = decimalToUnits(parsed.replace(/^-/, ''))
    if (share === null) return { units: null, error: 'invalid' }
    // share is the percentage in units (25% → 250000), so total * share / (100 * UNIT).
    magnitude = roundToCent((abs(totalUnits) * share) / (100n * UNIT))
  } else {
    magnitude = decimalToUnits(parsed.replace(/^-/, ''))
    if (magnitude === null) return { units: null, error: 'too-precise' }
  }
  if (magnitude === 0n) return { units: null, error: 'zero' }
  return { units: sign(totalUnits) * magnitude, error: null }
}

/** Everything the editor shows live, and whether the lines can be saved. */
export function summarizeSplit(lines: readonly SplitDraftLine[], totalUnits: bigint, locale: string): SplitSummary {
  const results = lines.map((line) => parseSplitLineAmount(line.amount, totalUnits, locale))
  const assignedUnits = results.reduce((sum, line) => sum + (line.units ?? 0n), 0n)
  const remainingUnits = totalUnits - assignedUnits

  let problem: SplitProblem | null = null
  if (lines.length < 2) problem = 'too-few-lines'
  else if (results.some((line) => line.error !== null || line.units === null)) problem = 'line-errors'
  else if (remainingUnits !== 0n) problem = sign(remainingUnits) === sign(totalUnits) ? 'unassigned' : 'over-assigned'

  return { lines: results, assignedUnits, remainingUnits, problem }
}

/**
 * `totalUnits` shared over `count` lines in whole cents; the leftover cents go one each to the
 * first lines, and anything below a cent (a four-decimal total) to the first line, so the lines
 * always add up exactly.
 */
export function splitEvenly(totalUnits: bigint, count: number): bigint[] {
  if (count < 1) return []
  const n = BigInt(count)
  const magnitude = abs(totalUnits)
  const cents = magnitude / CENT
  const subCent = magnitude % CENT
  const base = cents / n
  const extra = cents % n
  return Array.from({ length: count }, (_, index) => {
    const lineCents = base + (BigInt(index) < extra ? 1n : 0n)
    const units = lineCents * CENT + (index === 0 ? subCent : 0n)
    return sign(totalUnits) * units
  })
}

/**
 * The line's amount once the remainder is added to it, or null when that would leave it at
 * zero or with the wrong sign (the remainder is negative and larger than the line).
 */
export function fillRemainder(lineUnits: bigint | null, remainingUnits: bigint, totalUnits: bigint): bigint | null {
  const next = (lineUnits ?? 0n) + remainingUnits
  if (next === 0n || sign(next) !== sign(totalUnits)) return null
  return next
}

/** The `PUT .../splits` body; call only when `summarizeSplit` reports no problem. */
export function toSplitRequest(lines: readonly SplitDraftLine[], summary: SplitSummary): TransactionSplitLineRequest[] {
  return lines.map((line, index) => {
    const units = summary.lines[index]?.units
    if (units === null || units === undefined) throw new Error('A split line has no amount')
    const notes = line.notes.trim()
    return {
      amount: unitsToDecimal(units),
      categoryId: line.categoryId,
      notes: notes === '' ? null : notes,
    }
  })
}

let nextLineId = 0
/** A fresh key for a new line. */
export function newSplitLineId(): string {
  nextLineId += 1
  return `line-${nextLineId}`
}

/** Whether two drafts would send the same request (ignores ids and blank-vs-trimmed notes). */
export function sameSplitDraft(a: readonly SplitDraftLine[], b: readonly SplitDraftLine[]): boolean {
  return a.length === b.length
    && a.every((line, index) => (
      line.categoryId === b[index]!.categoryId
      && line.amount.trim() === b[index]!.amount.trim()
      && line.notes.trim() === b[index]!.notes.trim()
    ))
}

/** The existing lines of a split transaction, as editable drafts, in the API's order. */
export function draftFromSplits(splits: readonly TransactionSplitLineDto[], locale: string): SplitDraftLine[] {
  return [...splits]
    .sort((a, b) => a.position - b.position)
    .map((line) => ({
      id: newSplitLineId(),
      categoryId: line.category?.categoryKey ?? null,
      amount: formatUnitsForInput(amountToUnits(line.amount), locale),
      notes: line.notes ?? '',
    }))
}

/**
 * The draft a "Split" action starts from: the row's current category, and an empty second line.
 * Both amounts start blank, so "remaining to assign" shows the whole amount until the person
 * assigns it.
 */
export function startSplitDraft(transaction: TransactionViewModel): SplitDraftLine[] {
  return [
    {
      id: newSplitLineId(),
      categoryId: transaction.categoryId,
      amount: '',
      notes: '',
    },
    { id: newSplitLineId(), categoryId: null, amount: '', notes: '' },
  ]
}

/** How many categories a split's lines use; an uncategorized line counts as one. */
export function splitCategoryCount(splits: readonly TransactionSplitLineDto[]): number {
  return new Set(splits.map((line) => line.category?.categoryKey ?? null)).size
}

/** A transaction is split when the API sent it lines. */
export function isSplitTransaction(transaction: Pick<TransactionViewModel, 'splits'>): boolean {
  return transaction.splits.length > 0
}

/**
 * The amount the lines must add up to, in the settlement currency and with the transaction's
 * sign, or null when there is no amount to split.
 */
export function splitTotalUnits(transaction: TransactionViewModel): bigint | null {
  if (transaction.settlementAmount === null || transaction.settlementAmount === 0) return null
  if (transaction.direction === 'unknown') return null
  const magnitude = amountToUnits(transaction.settlementAmount)
  return transaction.direction === 'credit' ? magnitude : -magnitude
}

/** Whether "Split" is offered: a persisted row with an amount that is not a loan repayment. */
export function canSplitTransaction(transaction: TransactionViewModel): boolean {
  return !transaction.synthetic && !transaction.repayment && splitTotalUnits(transaction) !== null
}
