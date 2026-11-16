import { describe, expect, it } from "vitest"
import { amortizeLevelPayment, monthlyRateFromAnnual, totalInterestCents } from "./amortization"
import { computeMortgage } from "./mortgage"
import {
	RATE_REVISION_EXAMPLE,
	RATE_REVISION_LIMITS,
	RATE_REVISION_STRESS_STEPS,
	RATE_REVISION_TABLE_STEPS,
	computeRateRevision,
	shiftedIndex,
	totalRate,
	type RateRevisionInput,
	type RateRevisionResult,
} from "./rateRevision"

const base: RateRevisionInput = { ...RATE_REVISION_EXAMPLE }

function compute(overrides: Partial<RateRevisionInput> = {}): RateRevisionResult {
	const calculation = computeRateRevision({ ...base, ...overrides })
	if (!calculation.ok) throw new Error(`unexpected errors: ${JSON.stringify(calculation.errors)}`)
	return calculation.result
}

function errorsFor(overrides: Partial<RateRevisionInput>) {
	const calculation = computeRateRevision({ ...base, ...overrides })
	if (calculation.ok) throw new Error("expected errors")
	return calculation.errors
}

const cents = (value: number) => Math.round(value * 100)

describe("totalRate", () => {
	it("adds the spread to the index", () => {
		expect(totalRate(2.1, 1)).toEqual({ rate: 3.1, floored: false })
		expect(totalRate(-0.5, 1.25)).toEqual({ rate: 0.75, floored: false })
	})

	it("floors the rate at 0% when a negative index outweighs the spread", () => {
		expect(totalRate(-1.5, 1)).toEqual({ rate: 0, floored: true })
		expect(totalRate(-1, 1)).toEqual({ rate: 0, floored: false })
	})

	it("drops the float noise of adding two decimals", () => {
		expect(totalRate(0.1, 0.2).rate).toBe(0.3)
		expect(totalRate(2.143, 0.9).rate).toBe(3.043)
	})
})

describe("shiftedIndex", () => {
	it("moves the index by whole points without float noise", () => {
		expect(shiftedIndex(2.1, 1)).toBe(3.1)
		expect(shiftedIndex(0.3, -1)).toBe(-0.7)
		expect(shiftedIndex(2.143, 3)).toBe(5.143)
	})
})

describe("computeRateRevision: the worked example", () => {
	const result = compute()

	it("pays the level payment on the balance and time left at index plus spread", () => {
		const months = RATE_REVISION_EXAMPLE.termYears * 12 + RATE_REVISION_EXAMPLE.termMonths
		const rate = RATE_REVISION_EXAMPLE.indexRate + RATE_REVISION_EXAMPLE.spread
		const mortgage = computeMortgage({
			loanAmount: RATE_REVISION_EXAMPLE.balance,
			termYears: months / 12,
			annualRate: rate,
			monthlyFees: 0,
		})
		if (!mortgage.ok) throw new Error("mortgage example invalid")

		expect(result.months).toBe(months)
		expect(result.current.rate).toBe(rate)
		expect(result.current.monthlyPayment).toBe(mortgage.result.monthlyPayment)
		expect(result.current.totalInterest).toBe(mortgage.result.totalInterest)
	})

	it("raises the payment when the index rises", () => {
		expect(result.revised.indexRate).toBe(RATE_REVISION_EXAMPLE.newIndexRate)
		expect(result.revised.rate).toBe(RATE_REVISION_EXAMPLE.newIndexRate + RATE_REVISION_EXAMPLE.spread)
		expect(result.revised.monthlyPayment).toBeGreaterThan(result.current.monthlyPayment)
		expect(result.monthlyChange).toBeGreaterThan(0)
		expect(result.totalInterestChange).toBeGreaterThan(0)
	})

	it("works every change out to the cent from the two schedules", () => {
		const months = result.months
		const now = amortizeLevelPayment(cents(base.balance), monthlyRateFromAnnual(result.current.rate), months)
		const next = amortizeLevelPayment(cents(base.balance), monthlyRateFromAnnual(result.revised.rate), months)

		expect(cents(result.current.monthlyPayment)).toBe(now[0].paymentCents)
		expect(cents(result.revised.monthlyPayment)).toBe(next[0].paymentCents)
		expect(cents(result.monthlyChange)).toBe(next[0].paymentCents - now[0].paymentCents)
		expect(result.nextYear.payments).toBe(12)
		expect(cents(result.nextYear.change)).toBe(
			next.slice(0, 12).reduce((sum, row) => sum + row.paymentCents, 0) -
				now.slice(0, 12).reduce((sum, row) => sum + row.paymentCents, 0),
		)
		expect(cents(result.current.totalInterest)).toBe(totalInterestCents(now))
		expect(cents(result.revised.totalInterest)).toBe(totalInterestCents(next))
		expect(cents(result.totalInterestChange)).toBe(totalInterestCents(next) - totalInterestCents(now))
		expect(cents(result.revised.totalPaid)).toBe(cents(base.balance) + totalInterestCents(next))
		// The total paid changes by exactly the interest: the balance is the same.
		expect(cents(result.revised.totalPaid) - cents(result.current.totalPaid)).toBe(
			cents(result.totalInterestChange),
		)
	})

	it("gives the change as a percentage of today's payment, to one decimal", () => {
		const exact = (result.monthlyChange / result.current.monthlyPayment) * 100
		expect(result.monthlyChangePercent).toBe(Math.round(exact * 10) / 10)
	})

	it("shows the payment as a share of the income, before and after, with the debt-to-income bands", () => {
		expect(result.income).not.toBeNull()
		const income = result.income!
		expect(income.current.ratio).toBe(
			Math.round((result.current.monthlyPayment / base.monthlyIncome) * 1000) / 10,
		)
		expect(income.revised.ratio).toBe(
			Math.round((result.revised.monthlyPayment / base.monthlyIncome) * 1000) / 10,
		)
		expect(["healthy", "caution", "high"]).toContain(income.revised.band)
	})
})

describe("computeRateRevision: the table of index changes", () => {
	const result = compute()

	it("has a row for each change from −2 to +4 points", () => {
		expect(RATE_REVISION_TABLE_STEPS).toEqual([-2, -1, 0, 1, 2, 3, 4])
		expect(result.scenarios.map((row) => row.step)).toEqual([...RATE_REVISION_TABLE_STEPS])
	})

	it("matches today's payment on the 0 row, and each row's own schedule", () => {
		const zero = result.scenarios.find((row) => row.step === 0)!
		expect(zero.monthlyPayment).toBe(result.current.monthlyPayment)
		expect(zero.monthlyChange).toBe(0)

		for (const row of result.scenarios) {
			expect(row.indexRate).toBe(shiftedIndex(base.indexRate, row.step))
			const single = compute({ newIndexRate: row.indexRate })
			expect(row.rate).toBe(single.revised.rate)
			expect(row.monthlyPayment).toBe(single.revised.monthlyPayment)
			expect(row.monthlyChange).toBe(single.monthlyChange)
			expect(row.totalInterestChange).toBe(single.totalInterestChange)
		}
	})

	it("rises with every point", () => {
		const payments = result.scenarios.map((row) => row.monthlyPayment)
		expect([...payments].sort((a, b) => a - b)).toEqual(payments)
		expect(new Set(payments).size).toBe(payments.length)
	})

	it("floors the rows whose rate would go below 0%", () => {
		const low = compute({ indexRate: 0.5, spread: 0.8, newIndexRate: 0.5 })
		const minusTwo = low.scenarios.find((row) => row.step === -2)!
		const minusOne = low.scenarios.find((row) => row.step === -1)!
		expect(minusTwo).toMatchObject({ indexRate: -1.5, rate: 0, floored: true })
		expect(minusOne).toMatchObject({ indexRate: -0.5, rate: 0.3, floored: false })
		// At 0% the payment is the balance split over the months left.
		expect(cents(minusTwo.monthlyPayment)).toBe(Math.round(cents(base.balance) / low.months))
	})
})

describe("computeRateRevision: stress steps", () => {
	it("offers +1, +2, +3 and −1 points", () => {
		expect(RATE_REVISION_STRESS_STEPS).toEqual([1, 2, 3, -1])
	})
})

describe("computeRateRevision: edge cases", () => {
	it("shows no change when the index stays the same", () => {
		const result = compute({ newIndexRate: base.indexRate })
		expect(result.monthlyChange).toBe(0)
		expect(result.monthlyChangePercent).toBe(0)
		expect(result.nextYear.change).toBe(0)
		expect(result.totalInterestChange).toBe(0)
	})

	it("lowers the payment when the index falls", () => {
		const result = compute({ newIndexRate: base.indexRate - 1 })
		expect(result.monthlyChange).toBeLessThan(0)
		expect(result.monthlyChangePercent).toBeLessThan(0)
		expect(result.totalInterestChange).toBeLessThan(0)
	})

	it("floors both rates at 0% with a negative index and charges no interest", () => {
		const result = compute({ indexRate: -0.5, spread: 0.3, newIndexRate: -0.6 })
		expect(result.current).toMatchObject({ rate: 0, floored: true, totalInterest: 0 })
		expect(result.revised).toMatchObject({ rate: 0, floored: true, totalInterest: 0 })
		expect(result.monthlyChange).toBe(0)
	})

	it("handles a 0% rate", () => {
		const result = compute({ indexRate: 0, spread: 0, newIndexRate: 1 })
		expect(result.current.rate).toBe(0)
		expect(result.current.floored).toBe(false)
		expect(result.current.totalInterest).toBe(0)
		expect(result.revised.totalInterest).toBeGreaterThan(0)
	})

	it("works with a single month left: the payment is the balance plus a month's interest", () => {
		const result = compute({ termYears: 0, termMonths: 1 })
		expect(result.months).toBe(1)
		expect(cents(result.current.monthlyPayment)).toBe(
			cents(base.balance) + Math.round(cents(base.balance) * monthlyRateFromAnnual(result.current.rate)),
		)
		expect(result.nextYear.payments).toBe(1)
		expect(result.nextYear.change).toBe(result.monthlyChange)
	})

	it("sums the payments left when fewer than 12 remain", () => {
		const result = compute({ termYears: 0, termMonths: 7 })
		expect(result.nextYear.payments).toBe(7)
		expect(result.nextYear.change).toBeCloseTo(result.monthlyChange * 7, 1)
	})

	it("stays finite and exact on the largest balance, rate and term", () => {
		const result = compute({
			balance: RATE_REVISION_LIMITS.maxBalance,
			termYears: RATE_REVISION_LIMITS.maxTermYears,
			termMonths: 0,
			indexRate: RATE_REVISION_LIMITS.maxIndexRate,
			spread: RATE_REVISION_LIMITS.maxSpread,
			newIndexRate: RATE_REVISION_LIMITS.maxIndexRate,
			monthlyIncome: RATE_REVISION_LIMITS.maxMonthlyIncome,
		})
		for (const value of [
			result.current.monthlyPayment,
			result.current.totalInterest,
			result.revised.totalPaid,
			...result.scenarios.map((row) => row.monthlyPayment),
		]) {
			expect(Number.isFinite(value)).toBe(true)
			expect(Number.isInteger(Math.round(value * 100))).toBe(true)
		}
		expect(result.income?.revised.status).toBe("ok")
		expect(result.income?.revised.exceedsIncome).toBe(true)
	})

	it("rounds a fractional time left to whole months", () => {
		const result = compute({ termYears: 10.04, termMonths: 0 })
		expect(result.months).toBe(120)
		expect(result.termRounded).toBe(true)
		expect(compute().termRounded).toBe(false)
	})
})

describe("computeRateRevision: income", () => {
	it.each([Number.NaN, 0])("shows no share of income when the income is %s", (monthlyIncome) => {
		expect(compute({ monthlyIncome }).income).toBeNull()
	})

	it("rejects a negative or huge income", () => {
		expect(errorsFor({ monthlyIncome: -1 }).monthlyIncome).toBe("negative")
		expect(errorsFor({ monthlyIncome: RATE_REVISION_LIMITS.maxMonthlyIncome + 1 }).monthlyIncome).toBe(
			"tooLarge",
		)
	})
})

describe("computeRateRevision: validation", () => {
	it.each(["balance", "indexRate", "spread", "newIndexRate"] as const)(
		"asks for a value when %s is empty",
		(field) => {
			expect(errorsFor({ [field]: Number.NaN })[field]).toBe("required")
		},
	)

	it("asks for the time left when both term fields are empty or zero", () => {
		expect(errorsFor({ termYears: Number.NaN, termMonths: Number.NaN }).termYears).toBe("required")
		expect(errorsFor({ termYears: 0, termMonths: 0 }).termYears).toBe("required")
	})

	it("reads an empty months field as 0 when years are given", () => {
		expect(compute({ termMonths: Number.NaN }).months).toBe(base.termYears * 12)
	})

	it("rejects out-of-range values", () => {
		expect(errorsFor({ balance: RATE_REVISION_LIMITS.minBalance - 1 }).balance).toBe("tooSmall")
		expect(errorsFor({ balance: RATE_REVISION_LIMITS.maxBalance + 1 }).balance).toBe("tooLarge")
		expect(errorsFor({ termYears: RATE_REVISION_LIMITS.maxTermYears, termMonths: 1 }).termYears).toBe(
			"tooLarge",
		)
		expect(errorsFor({ termYears: -1 }).termYears).toBe("negative")
		expect(errorsFor({ termMonths: 12 }).termMonths).toBe("tooLarge")
		expect(errorsFor({ termMonths: -1 }).termMonths).toBe("negative")
		expect(errorsFor({ indexRate: RATE_REVISION_LIMITS.minIndexRate - 0.01 }).indexRate).toBe("tooSmall")
		expect(errorsFor({ indexRate: RATE_REVISION_LIMITS.maxIndexRate + 0.01 }).indexRate).toBe("tooLarge")
		expect(errorsFor({ newIndexRate: RATE_REVISION_LIMITS.minIndexRate - 1 }).newIndexRate).toBe(
			"tooSmall",
		)
		expect(errorsFor({ newIndexRate: RATE_REVISION_LIMITS.maxIndexRate + 1 }).newIndexRate).toBe(
			"tooLarge",
		)
		expect(errorsFor({ spread: -0.1 }).spread).toBe("negative")
		expect(errorsFor({ spread: RATE_REVISION_LIMITS.maxSpread + 0.1 }).spread).toBe("tooLarge")
	})

	it("keeps every rate the calculator can reach within the mortgage calculator's range", () => {
		expect(RATE_REVISION_LIMITS.maxIndexRate + RATE_REVISION_LIMITS.maxSpread).toBeLessThanOrEqual(30)
	})

	it("accepts a negative index down to the minimum", () => {
		expect(compute({ indexRate: RATE_REVISION_LIMITS.minIndexRate }).current.rate).toBe(0)
	})
})
