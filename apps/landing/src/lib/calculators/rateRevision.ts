/**
 * Rate revision on a variable-rate loan: what the monthly payment becomes when the reference
 * index changes (Euribor, a central bank rate or any other index the contract follows).
 *
 * The rate paid is the index plus the lender's spread, floored at 0%. The payment is the level
 * payment that clears the balance still owed over the months left, at that rate, worked by the
 * shared fixed-rate engine (`./amortization`, the one the mortgage calculator runs) in whole
 * cents. The revised payment assumes the new rate applies from the next payment to the end of
 * the loan; real revisions happen at reset dates set in each contract, and caps and floors vary
 * by contract and country, so none of them is built in here.
 *
 * Every change is the difference of two schedules from the same balance and months, so the
 * monthly, yearly and total figures add up to the cent.
 */

import {
	amortizeLevelPayment,
	monthlyRateFromAnnual,
	totalInterestCents,
	type AmortizationMonth,
} from "./amortization"
import { computeDebtToIncome, type DebtToIncomeResult } from "./debtToIncome"
import { remainingTerm } from "./earlyRepayment"
import { MORTGAGE_LIMITS } from "./mortgage"

export const RATE_REVISION_LIMITS = {
	/** Euros; the mortgage calculator's floor, so the loan tools accept the same loans. */
	minBalance: MORTGAGE_LIMITS.minLoanAmount,
	maxBalance: MORTGAGE_LIMITS.maxLoanAmount,
	maxTermYears: MORTGAGE_LIMITS.maxTermYears,
	/** Percent. Indices have gone below zero; this only stops typos. */
	minIndexRate: -5,
	maxIndexRate: 20,
	/** Percent. With the largest index, the rate stays within the mortgage calculator's 30%. */
	maxSpread: 10,
	/** Euros a month. */
	maxMonthlyIncome: 1_000_000,
} as const

/** The quick changes the calculator offers for the new index, in points. */
export const RATE_REVISION_STRESS_STEPS = [1, 2, 3, -1] as const

/** The changes in the index the table of payments shows, in points. */
export const RATE_REVISION_TABLE_STEPS = [-2, -1, 0, 1, 2, 3, 4] as const

/** The loan the page's worked example walks through; the calculator starts from it too. */
export const RATE_REVISION_EXAMPLE = {
	balance: 150_000,
	termYears: 25,
	termMonths: 0,
	indexRate: 2,
	spread: 1,
	newIndexRate: 3,
	monthlyIncome: 2_800,
	/** The larger rise the example tries after the first one, in points. */
	exampleStressStep: 3,
} as const

export type RateRevisionInput = {
	/** Balance still owed today, in euros. */
	balance: number
	/** Whole years left on the loan. Empty (NaN) reads as 0. */
	termYears: number
	/** Months left on top of the years, 0 to 11. Empty (NaN) reads as 0. */
	termMonths: number
	/** The reference index today, in percent; can be negative. Empty (NaN) is `required`. */
	indexRate: number
	/** The lender's margin on top of the index, in percent. Empty (NaN) is `required`. */
	spread: number
	/** The index after the revision, in percent. Empty (NaN) is `required`. */
	newIndexRate: number
	/** Net monthly income, in euros. Optional: empty (NaN) or an amount that rounds to zero cents shows no share of income. */
	monthlyIncome: number
}

export type RateRevisionField = keyof RateRevisionInput

export type RateRevisionInputError = "required" | "tooSmall" | "tooLarge" | "negative"

export type RatePayment = {
	/** The index, in percent, as entered. */
	indexRate: number
	/** Index plus spread, floored at 0%. */
	rate: number
	/** True when index plus spread is below 0% and the rate was raised to 0%. */
	floored: boolean
	/** The next monthly payment; later ones stay within a cent of it. */
	monthlyPayment: number
	/** Interest over the rest of the loan. */
	totalInterest: number
	/** Balance plus interest over the rest of the loan. */
	totalPaid: number
}

export type RateScenario = Omit<RatePayment, "totalPaid"> & {
	/** Change in the index from today, in points. */
	step: number
	/** This payment minus today's. */
	monthlyChange: number
	/** This interest minus today's, over the rest of the loan. */
	totalInterestChange: number
}

export type RateRevisionResult = {
	/** Monthly payments left. */
	months: number
	/** Whether the years and months entered were rounded to whole months. */
	termRounded: boolean
	current: RatePayment
	revised: RatePayment
	/** Revised payment minus today's; negative when it falls. */
	monthlyChange: number
	/** The change as a percentage of today's payment, to one decimal. */
	monthlyChangePercent: number
	/** The change over the next 12 payments, or over the payments left when fewer remain. */
	nextYear: { payments: number; change: number }
	/** Revised interest minus today's, over the rest of the loan. */
	totalInterestChange: number
	/** Each payment as a share of net income, or null without an income. */
	income: { current: DebtToIncomeResult; revised: DebtToIncomeResult } | null
	/** A row per change in `RATE_REVISION_TABLE_STEPS`. */
	scenarios: RateScenario[]
}

export type RateRevisionCalculation =
	| { ok: true; result: RateRevisionResult }
	| { ok: false; errors: Partial<Record<RateRevisionField, RateRevisionInputError>> }

const fromCents = (cents: number) => cents / 100
/** Rates are entered with up to a few decimals; this drops the noise of adding them. */
const cleanRate = (value: number) => Math.round(value * 1e6) / 1e6 + 0

/** The rate paid: index plus spread, never below 0%. */
export function totalRate(indexRate: number, spread: number): { rate: number; floored: boolean } {
	const sum = cleanRate(indexRate + spread)
	return sum < 0 ? { rate: 0, floored: true } : { rate: sum, floored: false }
}

/** The index moved by `step` points. */
export function shiftedIndex(indexRate: number, step: number): number {
	return cleanRate(indexRate + step)
}

function validateRate(
	value: number,
	min: number,
	max: number,
): RateRevisionInputError | undefined {
	if (Number.isNaN(value)) return "required"
	if (value < min) return min === 0 ? "negative" : "tooSmall"
	if (value > max) return "tooLarge"
	return undefined
}

function validate(input: RateRevisionInput): Partial<Record<RateRevisionField, RateRevisionInputError>> {
	const errors: Partial<Record<RateRevisionField, RateRevisionInputError>> = {}
	const limits = RATE_REVISION_LIMITS
	const { balance, termYears, termMonths, monthlyIncome } = input

	if (Number.isNaN(balance) || balance <= 0) errors.balance = "required"
	else if (balance < limits.minBalance) errors.balance = "tooSmall"
	else if (balance > limits.maxBalance) errors.balance = "tooLarge"

	if (termMonths < 0) errors.termMonths = "negative"
	else if (termMonths > 11) errors.termMonths = "tooLarge"

	if (termYears < 0) errors.termYears = "negative"
	else if (!errors.termMonths) {
		const { months } = remainingTerm(termYears, termMonths)
		if (!Number.isFinite(months) || months > limits.maxTermYears * 12) errors.termYears = "tooLarge"
		else if (months < 1) errors.termYears = "required"
	}

	const indexError = validateRate(input.indexRate, limits.minIndexRate, limits.maxIndexRate)
	if (indexError) errors.indexRate = indexError
	const newIndexError = validateRate(input.newIndexRate, limits.minIndexRate, limits.maxIndexRate)
	if (newIndexError) errors.newIndexRate = newIndexError
	const spreadError = validateRate(input.spread, 0, limits.maxSpread)
	if (spreadError) errors.spread = spreadError

	if (monthlyIncome < 0) errors.monthlyIncome = "negative"
	else if (monthlyIncome > limits.maxMonthlyIncome) errors.monthlyIncome = "tooLarge"

	return errors
}

type Schedule = { rate: number; floored: boolean; indexRate: number; rows: AmortizationMonth[] }

function schedule(balanceCents: number, months: number, indexRate: number, spread: number): Schedule {
	const { rate, floored } = totalRate(indexRate, spread)
	return {
		rate,
		floored,
		indexRate,
		rows: amortizeLevelPayment(balanceCents, monthlyRateFromAnnual(rate), months),
	}
}

function toPayment(balanceCents: number, { rate, floored, indexRate, rows }: Schedule): RatePayment {
	const interestCents = totalInterestCents(rows)
	return {
		indexRate,
		rate,
		floored,
		monthlyPayment: fromCents(rows[0].paymentCents),
		totalInterest: fromCents(interestCents),
		totalPaid: fromCents(balanceCents + interestCents),
	}
}

function sumPayments(rows: readonly AmortizationMonth[], count: number): number {
	return rows.slice(0, count).reduce((sum, row) => sum + row.paymentCents, 0)
}

export function computeRateRevision(input: RateRevisionInput): RateRevisionCalculation {
	const errors = validate(input)
	if (Object.keys(errors).length > 0) return { ok: false, errors }

	const { months, rounded } = remainingTerm(input.termYears, input.termMonths)
	const balanceCents = Math.round(input.balance * 100)
	const now = schedule(balanceCents, months, input.indexRate, input.spread)
	const next = schedule(balanceCents, months, input.newIndexRate, input.spread)
	const current = toPayment(balanceCents, now)
	const revised = toPayment(balanceCents, next)

	const nowFirstCents = now.rows[0].paymentCents
	const nowInterestCents = totalInterestCents(now.rows)
	const change = (other: Schedule) => ({
		monthlyChangeCents: other.rows[0].paymentCents - nowFirstCents,
		interestChangeCents: totalInterestCents(other.rows) - nowInterestCents,
	})

	const revisedChange = change(next)
	const nextYearPayments = Math.min(12, months)

	const scenarios = RATE_REVISION_TABLE_STEPS.map((step): RateScenario => {
		const row = schedule(balanceCents, months, shiftedIndex(input.indexRate, step), input.spread)
		const { monthlyChangeCents, interestChangeCents } = change(row)
		const { indexRate, rate, floored, monthlyPayment, totalInterest } = toPayment(balanceCents, row)
		return {
			indexRate,
			rate,
			floored,
			monthlyPayment,
			totalInterest,
			step,
			monthlyChange: fromCents(monthlyChangeCents),
			totalInterestChange: fromCents(interestChangeCents),
		}
	})

	const monthlyIncome = fromCents(Math.round(input.monthlyIncome * 100))
	const income =
		monthlyIncome > 0
			? {
					current: computeDebtToIncome({ monthlyIncome, payments: [current.monthlyPayment] }),
					revised: computeDebtToIncome({ monthlyIncome, payments: [revised.monthlyPayment] }),
				}
			: null

	return {
		ok: true,
		result: {
			months,
			termRounded: rounded,
			current,
			revised,
			monthlyChange: fromCents(revisedChange.monthlyChangeCents),
			monthlyChangePercent:
				Math.round((revisedChange.monthlyChangeCents / nowFirstCents) * 1000) / 10 + 0,
			nextYear: {
				payments: nextYearPayments,
				change: fromCents(sumPayments(next.rows, nextYearPayments) - sumPayments(now.rows, nextYearPayments)),
			},
			totalInterestChange: fromCents(revisedChange.interestChangeCents),
			income,
			scenarios,
		},
	}
}
