import { describe, expect, it } from "vitest"
import {
	BUY_VS_RENT_EXAMPLE,
	BUY_VS_RENT_LIMITS,
	computeBuyVsRent,
	type BuyVsRentInput,
	type BuyVsRentResult,
} from "./buyVsRent"
import { computeMortgage } from "./mortgage"

/** No loan, no costs, no growth: every figure is easy to work out by hand. */
const PLAIN: BuyVsRentInput = {
	homePrice: 100_000,
	downPayment: 100_000,
	mortgageRate: 0,
	mortgageTermYears: 25,
	purchaseCostsPct: 0,
	ownershipCostsPct: 0,
	appreciationPct: 0,
	monthlyRent: 500,
	rentIncreasePct: 0,
	investmentReturnPct: 0,
	horizonYears: 1,
	sellingCostsPct: 0,
}

function compute(input: Partial<BuyVsRentInput>, base: BuyVsRentInput = PLAIN): BuyVsRentResult {
	const calculation = computeBuyVsRent({ ...base, ...input })
	if (!calculation.ok) throw new Error(`Unexpected errors: ${JSON.stringify(calculation.errors)}`)
	return calculation.result
}

function errorsOf(input: Partial<BuyVsRentInput>) {
	const calculation = computeBuyVsRent({ ...BUY_VS_RENT_EXAMPLE, ...input })
	return calculation.ok ? {} : calculation.errors
}

const cents = (value: number) => Math.round(value * 100)

describe("computeBuyVsRent", () => {
	it("starts both paths with the same cash: the down payment plus purchase costs", () => {
		const result = compute({ downPayment: 20_000, purchaseCostsPct: 7, sellingCostsPct: 5 })
		const [today] = result.years

		expect(result.loanAmount).toBe(80_000)
		expect(result.purchaseCosts).toBe(7_000)
		expect(result.upfrontCash).toBe(27_000)
		expect(today.year).toBe(0)
		expect(today.renterNetWorth).toBe(27_000)
		// Selling on day one gives back the price less selling costs, and repays the loan.
		expect(today.ownerNetWorth).toBe(100_000 - 5_000 - 80_000)
		expect(today.difference).toBe(15_000 - 27_000)
	})

	it("has the owner invest the rent they no longer pay when renting costs more", () => {
		const result = compute({})

		// Renter: 100,000 invested at 0%, rent paid from income. Owner: the house, plus 12 × 500.
		expect(result.renterNetWorth).toBe(100_000)
		expect(result.ownerNetWorth).toBe(106_000)
		expect(result.years[1].ownerInvestments).toBe(6_000)
		expect(result.difference).toBe(6_000)
		expect(result.breakEvenYear).toBe(1)
	})

	it("has the renter invest what owning would cost on top of the rent", () => {
		const loanAmount = 60_000
		const result = compute({
			downPayment: 100_000 - loanAmount,
			mortgageTermYears: 10,
			mortgageRate: 3,
			ownershipCostsPct: 1.2,
			monthlyRent: 0,
			horizonYears: 10,
		})
		const mortgage = computeMortgage({ loanAmount, termYears: 10, annualRate: 3, monthlyFees: 0 })
		if (!mortgage.ok) throw new Error("mortgage")

		// With no rent and a 0% return, the renter ends with the upfront cash plus every euro the
		// owner paid: the loan's principal and interest and 1.2% of the home's value a year.
		const ownershipCosts = 100_000 * 0.012 * 10
		expect(result.renterNetWorth).toBeCloseTo(
			40_000 + mortgage.result.totalPrincipal + mortgage.result.totalInterest + ownershipCosts,
			2,
		)
		expect(result.ownerNetWorth).toBe(100_000)
		expect(result.years.at(-1)?.ownerInvestments).toBe(0)
	})

	it("takes the loan from the mortgage calculator and subtracts what is still owed", () => {
		const result = compute({ downPayment: 25_000, mortgageRate: 4, mortgageTermYears: 30, horizonYears: 10 })
		const mortgage = computeMortgage({ loanAmount: 75_000, termYears: 30, annualRate: 4, monthlyFees: 0 })
		if (!mortgage.ok) throw new Error("mortgage")

		expect(result.monthlyMortgagePayment).toBe(mortgage.result.monthlyPayment)
		for (let year = 1; year <= 10; year++) {
			expect(result.years[year].loanBalance).toBe(mortgage.result.years[year - 1].balance)
		}
		expect(result.firstMonthOwnerCost).toBe(mortgage.result.monthlyPayment)
		expect(result.firstMonthRent).toBe(500)
	})

	it("stops the mortgage payments once the term is over", () => {
		const result = compute({
			downPayment: 50_000,
			mortgageRate: 2,
			mortgageTermYears: 5,
			monthlyRent: 0,
			horizonYears: 8,
		})

		for (const year of result.years.slice(5)) expect(year.loanBalance).toBe(0)
		// No rent and no ownership costs: after year 5 nothing more is paid, so neither side
		// invests anything new and, at 0%, neither net worth moves.
		expect(result.years[6].ownerCosts).toBe(0)
		expect(result.years[8].renterNetWorth).toBe(result.years[5].renterNetWorth)
		expect(result.years[5].ownerCosts).toBeGreaterThan(0)
	})

	it("compounds investments monthly at the rate equivalent to the annual return", () => {
		const one = compute({ monthlyRent: 0, investmentReturnPct: 5, horizonYears: 1 })
		const ten = compute({ monthlyRent: 0, investmentReturnPct: 5, horizonYears: 10 })

		// Within a few cents of 100,000 × 1.05^n: interest is rounded to the cent each month.
		expect(Math.abs(one.renterNetWorth - 105_000)).toBeLessThan(0.1)
		expect(Math.abs(ten.renterNetWorth - 100_000 * 1.05 ** 10)).toBeLessThan(1)
	})

	it("grows the home value, the ownership costs and the rent once a year", () => {
		const result = compute({
			appreciationPct: 2,
			ownershipCostsPct: 1,
			rentIncreasePct: 3,
			monthlyRent: 1_000,
			horizonYears: 2,
		})

		expect(result.years[1].homeValue).toBe(102_000)
		expect(result.years[2].homeValue).toBe(104_040)
		// Ownership costs follow the value at the start of each year.
		expect(result.years[1].ownerCosts).toBe(1_000)
		expect(result.years[2].ownerCosts).toBe(1_020)
		expect(result.years[1].rentPaid).toBe(12_000)
		expect(result.years[2].rentPaid).toBe(12_360)
	})

	it("takes selling costs off the home's value at the end", () => {
		const result = compute({ appreciationPct: 10, sellingCostsPct: 5, monthlyRent: 0 })

		expect(result.years[1].homeValue).toBe(110_000)
		expect(result.years[1].sellingCosts).toBe(5_500)
		expect(result.ownerNetWorth).toBe(104_500)
	})

	it("reports the first year owning is ahead, or none within the horizon", () => {
		const example = compute({}, BUY_VS_RENT_EXAMPLE)
		const firstAhead = example.years.find((year) => year.year > 0 && year.difference > 0)
		expect(example.breakEvenYear).toBe(firstAhead?.year ?? null)

		const falling = compute({ appreciationPct: -5, horizonYears: 40 }, BUY_VS_RENT_EXAMPLE)
		expect(falling.breakEvenYear).toBeNull()
		expect(falling.difference).toBeLessThan(0)
	})

	it("treats an equal outcome as not yet ahead", () => {
		const result = compute({ monthlyRent: 0 })

		expect(result.difference).toBe(0)
		expect(result.breakEvenYear).toBeNull()
	})

	it("keeps every row consistent to the cent", () => {
		for (const input of [
			BUY_VS_RENT_EXAMPLE,
			{ ...BUY_VS_RENT_EXAMPLE, horizonYears: 40, mortgageTermYears: 25 },
			{ ...BUY_VS_RENT_EXAMPLE, investmentReturnPct: 7.3, appreciationPct: 3.1, rentIncreasePct: 2.7 },
		]) {
			const result = compute({}, input)
			for (const year of result.years) {
				for (const value of Object.values(year)) {
					expect(Number.isSafeInteger(cents(value))).toBe(true)
					expect(Math.abs(cents(value) - value * 100)).toBeLessThan(1e-6)
				}
				expect(cents(year.ownerNetWorth)).toBe(
					cents(year.homeValue) - cents(year.sellingCosts) - cents(year.loanBalance) + cents(year.ownerInvestments),
				)
				expect(cents(year.renterNetWorth)).toBe(cents(year.renterInvestments))
				expect(cents(year.difference)).toBe(cents(year.ownerNetWorth) - cents(year.renterNetWorth))
			}
			const last = result.years.at(-1)
			expect(result.ownerNetWorth).toBe(last?.ownerNetWorth)
			expect(result.renterNetWorth).toBe(last?.renterNetWorth)
			expect(result.difference).toBe(last?.difference)
		}
	})

	it("handles a 100% down payment with no loan", () => {
		// Without a loan the mortgage fields are ignored, even when empty.
		const result = compute({ mortgageTermYears: Number.NaN, mortgageRate: Number.NaN, horizonYears: 5 })

		expect(result.loanAmount).toBe(0)
		expect(result.monthlyMortgagePayment).toBe(0)
		for (const year of result.years) expect(year.loanBalance).toBe(0)
	})

	it("handles 0% everywhere and a one-year horizon", () => {
		const result = compute({ downPayment: 0, mortgageTermYears: 1, horizonYears: 1, monthlyRent: 0 })

		expect(result.years).toHaveLength(2)
		expect(result.monthlyMortgagePayment).toBeCloseTo(100_000 / 12, 2)
		expect(result.years[1].loanBalance).toBe(0)
		expect(result.ownerNetWorth).toBe(100_000)
		expect(result.renterNetWorth).toBe(100_000)
	})

	it("stays finite and exact at the largest values it accepts", () => {
		const result = compute({
			homePrice: BUY_VS_RENT_LIMITS.maxHomePrice,
			downPayment: 0,
			mortgageRate: 30,
			mortgageTermYears: 50,
			purchaseCostsPct: BUY_VS_RENT_LIMITS.maxPurchaseCostsPct,
			ownershipCostsPct: BUY_VS_RENT_LIMITS.maxOwnershipCostsPct,
			appreciationPct: BUY_VS_RENT_LIMITS.maxGrowthPct,
			monthlyRent: BUY_VS_RENT_LIMITS.maxMonthlyRent,
			rentIncreasePct: BUY_VS_RENT_LIMITS.maxGrowthPct,
			investmentReturnPct: BUY_VS_RENT_LIMITS.maxGrowthPct,
			horizonYears: BUY_VS_RENT_LIMITS.maxHorizonYears,
			sellingCostsPct: BUY_VS_RENT_LIMITS.maxSellingCostsPct,
		})

		for (const year of result.years) {
			for (const value of Object.values(year)) expect(Number.isSafeInteger(cents(value))).toBe(true)
		}
	})

	it("reads an empty down payment, rent or cost percentage as zero", () => {
		const empty = compute({
			downPayment: Number.NaN,
			purchaseCostsPct: Number.NaN,
			ownershipCostsPct: Number.NaN,
			monthlyRent: Number.NaN,
			sellingCostsPct: Number.NaN,
		})
		const zero = compute({ downPayment: 0, monthlyRent: 0 })

		expect(empty).toEqual(zero)
	})

	it("reports the year buying falls behind again after pulling ahead", () => {
		const result = compute(
			{
				downPayment: 30_000,
				mortgageRate: 1,
				mortgageTermYears: 15,
				ownershipCostsPct: 0.5,
				appreciationPct: 0,
				monthlyRent: 1_000,
				rentIncreasePct: 1,
				horizonYears: 20,
			},
			BUY_VS_RENT_EXAMPLE,
		)

		expect(result.breakEvenYear).toBe(11)
		expect(result.fallsBehindYear).toBe(15)
		expect(result.years[14].difference).toBeGreaterThan(0)
		expect(result.years[15].difference).toBeLessThanOrEqual(0)
		expect(result.difference).toBeLessThanOrEqual(0)
	})

	it("has no falls-behind year while buying stays ahead or never gets ahead", () => {
		expect(compute({}, BUY_VS_RENT_EXAMPLE).fallsBehindYear).toBeNull()
		expect(compute({ appreciationPct: -5 }, BUY_VS_RENT_EXAMPLE).fallsBehindYear).toBeNull()
	})

	it("matches the year-by-year differences for break-even and falling behind", () => {
		for (const appreciationPct of [-2, 0, 1, 2, 4]) {
			for (const monthlyRent of [600, 1_000, 1_400]) {
				for (const mortgageTermYears of [10, 15, 30]) {
					const result = compute(
						{ appreciationPct, monthlyRent, mortgageTermYears, horizonYears: 30 },
						BUY_VS_RENT_EXAMPLE,
					)
					const ahead = result.years.find((year) => year.year > 0 && year.difference > 0)
					const behind = ahead
						? result.years.find((year) => year.year > ahead.year && year.difference <= 0)
						: undefined
					expect(result.breakEvenYear).toBe(ahead?.year ?? null)
					expect(result.fallsBehindYear).toBe(behind?.year ?? null)
				}
			}
		}
	})
})

describe("computeBuyVsRent validation", () => {
	it("starts from a valid example", () => {
		expect(computeBuyVsRent(BUY_VS_RENT_EXAMPLE).ok).toBe(true)
	})

	it("needs a home price within range", () => {
		expect(errorsOf({ homePrice: Number.NaN }).homePrice).toBe("required")
		expect(errorsOf({ homePrice: 0 }).homePrice).toBe("required")
		expect(errorsOf({ homePrice: BUY_VS_RENT_LIMITS.maxHomePrice + 1 }).homePrice).toBe("tooLarge")
	})

	it("keeps the down payment between zero and the price, leaving no token loan", () => {
		expect(errorsOf({ downPayment: -1 }).downPayment).toBe("negative")
		expect(errorsOf({ downPayment: BUY_VS_RENT_EXAMPLE.homePrice + 1 }).downPayment).toBe("aboveHomePrice")
		expect(errorsOf({ downPayment: BUY_VS_RENT_EXAMPLE.homePrice - 50 }).downPayment).toBe("loanTooSmall")
		expect(errorsOf({ downPayment: BUY_VS_RENT_EXAMPLE.homePrice }).downPayment).toBeUndefined()
	})

	it("asks for an empty rate instead of reading it as 0%", () => {
		for (const field of ["mortgageRate", "appreciationPct", "rentIncreasePct", "investmentReturnPct"] as const) {
			expect(errorsOf({ [field]: Number.NaN })[field]).toBe("required")
		}
	})

	it("checks the minimum loan in cents, as the loan is built", () => {
		// In floating-point euros 128.01 − 28.01 is 99.99999999999999; in cents it is exactly 10000.
		expect(128.01 - 28.01).toBeLessThan(100)
		expect(errorsOf({ homePrice: 128.01, downPayment: 28.01 }).downPayment).toBeUndefined()
		expect(compute({ homePrice: 128.01, downPayment: 28.01 }, BUY_VS_RENT_EXAMPLE).loanAmount).toBe(100)
		expect(errorsOf({ homePrice: 128.01, downPayment: 28.02 }).downPayment).toBe("loanTooSmall")
	})

	it("checks the mortgage only when there is one", () => {
		expect(errorsOf({ mortgageTermYears: Number.NaN }).mortgageTermYears).toBe("required")
		expect(errorsOf({ mortgageTermYears: 51 }).mortgageTermYears).toBe("tooLarge")
		expect(errorsOf({ mortgageRate: -1 }).mortgageRate).toBe("negative")
		expect(errorsOf({ mortgageRate: 31 }).mortgageRate).toBe("tooLarge")
		expect(
			errorsOf({ downPayment: BUY_VS_RENT_EXAMPLE.homePrice, mortgageTermYears: Number.NaN, mortgageRate: 99 }),
		).toEqual({})
	})

	it("keeps the horizon between 1 and 40 whole years", () => {
		expect(errorsOf({ horizonYears: Number.NaN }).horizonYears).toBe("required")
		expect(errorsOf({ horizonYears: 0 }).horizonYears).toBe("tooSmall")
		expect(errorsOf({ horizonYears: 41 }).horizonYears).toBe("tooLarge")
		expect(compute({ horizonYears: 2.4 }).years).toHaveLength(3)
	})

	it("bounds the percentages and the rent", () => {
		expect(errorsOf({ purchaseCostsPct: -1 }).purchaseCostsPct).toBe("negative")
		expect(errorsOf({ purchaseCostsPct: 26 }).purchaseCostsPct).toBe("tooLarge")
		expect(errorsOf({ sellingCostsPct: 26 }).sellingCostsPct).toBe("tooLarge")
		expect(errorsOf({ ownershipCostsPct: 11 }).ownershipCostsPct).toBe("tooLarge")
		expect(errorsOf({ monthlyRent: -1 }).monthlyRent).toBe("negative")
		expect(errorsOf({ monthlyRent: BUY_VS_RENT_LIMITS.maxMonthlyRent + 1 }).monthlyRent).toBe("tooLarge")
		for (const field of ["appreciationPct", "rentIncreasePct", "investmentReturnPct"] as const) {
			expect(errorsOf({ [field]: -11 })[field]).toBe("tooSmall")
			expect(errorsOf({ [field]: 16 })[field]).toBe("tooLarge")
			expect(errorsOf({ [field]: -10 })[field]).toBeUndefined()
		}
	})
})
