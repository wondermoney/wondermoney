/**
 * Buy versus rent: the net worth of buying a home with a mortgage against renting one and
 * investing the difference, year by year.
 *
 * Both paths start with the same cash, the down payment plus the purchase costs. The owner
 * spends it on the home; the renter invests it. Each month the path that costs less invests the
 * difference: the renter when the mortgage payment and ownership costs exceed the rent, the
 * owner when the rent is higher. At the end of each year the owner's net worth is what selling
 * would leave (the home's value less selling costs and the loan still owed) plus their
 * investments; the renter's is their investments.
 *
 * The loan comes from the mortgage calculator, so the payments and balances match that tool
 * exactly. Everything is worked in whole cents, so each row adds up to the cent.
 *
 * Left out on purpose: taxes on gains, rent deposits, mortgage tax relief, and any country's
 * purchase taxes beyond the purchase-cost percentage the visitor enters.
 */
import { MORTGAGE_LIMITS, computeMortgage } from "./mortgage"

export const BUY_VS_RENT_LIMITS = {
	/** Euros. The loan can be the whole price, so the mortgage calculator's cap applies. */
	maxHomePrice: MORTGAGE_LIMITS.maxLoanAmount,
	/** Euros. A loan below this is not worth modelling: pay the price in full instead. */
	minLoanAmount: MORTGAGE_LIMITS.minLoanAmount,
	maxTermYears: MORTGAGE_LIMITS.maxTermYears,
	maxMortgageRate: MORTGAGE_LIMITS.maxAnnualRate,
	/** Euros a month. */
	maxMonthlyRent: 1_000_000,
	maxHorizonYears: 40,
	/** Percent of the price. */
	maxPurchaseCostsPct: 25,
	/** Percent of the home's value. */
	maxSellingCostsPct: 25,
	/** Percent of the home's value a year. */
	maxOwnershipCostsPct: 10,
	/** Percent a year, for the home's appreciation, rent increases and the investment return. */
	minGrowthPct: -10,
	maxGrowthPct: 15,
} as const

/** The comparison the page's worked example walks through; the calculator starts from it too. */
export const BUY_VS_RENT_EXAMPLE = {
	homePrice: 300_000,
	downPayment: 60_000,
	mortgageRate: 3.5,
	mortgageTermYears: 30,
	purchaseCostsPct: 7,
	ownershipCostsPct: 1,
	appreciationPct: 2,
	monthlyRent: 1_100,
	rentIncreasePct: 2,
	investmentReturnPct: 5,
	horizonYears: 10,
	sellingCostsPct: 5,
} as const satisfies BuyVsRentInput

/** The lower rent the worked example tries next, at which renting stays ahead. */
export const BUY_VS_RENT_EXAMPLE_ALTERNATIVE_RENT = 1_000

/**
 * Amounts in euros, rates in percent (3.5 means 3.5%). An empty field (NaN) reads as zero,
 * except the home price, the horizon and, when there is a loan, its term.
 */
export type BuyVsRentInput = {
	homePrice: number
	downPayment: number
	/** Fixed nominal annual rate of the mortgage. */
	mortgageRate: number
	/** Fractions are rounded to the nearest month. */
	mortgageTermYears: number
	/** One-off taxes and fees on the purchase, as a percentage of the price. */
	purchaseCostsPct: number
	/** Maintenance, insurance and property tax a year, as a percentage of the home's value. */
	ownershipCostsPct: number
	appreciationPct: number
	monthlyRent: number
	rentIncreasePct: number
	/** The annual return on money either path invests. */
	investmentReturnPct: number
	/** Whole years; fractions are rounded. */
	horizonYears: number
	/** Agent and other selling costs at the end, as a percentage of the home's value. */
	sellingCostsPct: number
}

export type BuyVsRentField = keyof BuyVsRentInput

export type BuyVsRentInputError =
	| "required"
	| "tooSmall"
	| "tooLarge"
	| "negative"
	| "aboveHomePrice"
	| "loanTooSmall"

/** One point in time: year 0 is the day of purchase, then the end of each year. */
export type BuyVsRentYear = {
	year: number
	homeValue: number
	sellingCosts: number
	/** Mortgage balance still owed. */
	loanBalance: number
	ownerInvestments: number
	renterInvestments: number
	/** Home value − selling costs − loan + the owner's investments. */
	ownerNetWorth: number
	/** The renter's investments. */
	renterNetWorth: number
	/** Owner's net worth minus the renter's: positive when buying is ahead. */
	difference: number
	/** Mortgage payments and ownership costs paid during the year (0 for year 0). */
	ownerCosts: number
	/** Rent paid during the year (0 for year 0). */
	rentPaid: number
}

export type BuyVsRentResult = {
	loanAmount: number
	purchaseCosts: number
	/** Down payment plus purchase costs: the cash both paths start with. */
	upfrontCash: number
	/** The first monthly mortgage payment of principal and interest; 0 without a loan. */
	monthlyMortgagePayment: number
	/** Mortgage payment plus ownership costs in the first month. */
	firstMonthOwnerCost: number
	firstMonthRent: number
	/** Year 0 to the horizon. */
	years: BuyVsRentYear[]
	/** At the horizon. */
	ownerNetWorth: number
	renterNetWorth: number
	difference: number
	/** The first year that ends with buying ahead, or null if it never is within the horizon. */
	breakEvenYear: number | null
}

export type BuyVsRentCalculation =
	| { ok: true; result: BuyVsRentResult }
	| { ok: false; errors: Partial<Record<BuyVsRentField, BuyVsRentInputError>> }

const orZero = (value: number) => (Number.isNaN(value) ? 0 : value)

function checkRange(
	value: number,
	min: number,
	max: number,
): BuyVsRentInputError | undefined {
	if (value < min) return min === 0 ? "negative" : "tooSmall"
	if (value > max) return "tooLarge"
	return undefined
}

function validate(input: BuyVsRentInput): Partial<Record<BuyVsRentField, BuyVsRentInputError>> {
	const errors: Partial<Record<BuyVsRentField, BuyVsRentInputError>> = {}
	const set = (field: BuyVsRentField, error: BuyVsRentInputError | undefined) => {
		if (error) errors[field] = error
	}
	const L = BUY_VS_RENT_LIMITS

	const { homePrice } = input
	if (Number.isNaN(homePrice) || homePrice <= 0) errors.homePrice = "required"
	else if (homePrice > L.maxHomePrice) errors.homePrice = "tooLarge"

	const downPayment = orZero(input.downPayment)
	if (downPayment < 0) errors.downPayment = "negative"
	else if (!errors.homePrice) {
		const loan = homePrice - downPayment
		if (loan < 0) errors.downPayment = "aboveHomePrice"
		else if (loan > 0 && loan < L.minLoanAmount) errors.downPayment = "loanTooSmall"
	}

	const hasLoan = !errors.homePrice && !errors.downPayment && homePrice - downPayment > 0
	if (hasLoan) {
		const term = input.mortgageTermYears
		if (Number.isNaN(term) || Math.round(term * 12) < 1) errors.mortgageTermYears = "required"
		else if (term > L.maxTermYears) errors.mortgageTermYears = "tooLarge"
		set("mortgageRate", checkRange(orZero(input.mortgageRate), 0, L.maxMortgageRate))
	}

	set("purchaseCostsPct", checkRange(orZero(input.purchaseCostsPct), 0, L.maxPurchaseCostsPct))
	set("ownershipCostsPct", checkRange(orZero(input.ownershipCostsPct), 0, L.maxOwnershipCostsPct))
	set("sellingCostsPct", checkRange(orZero(input.sellingCostsPct), 0, L.maxSellingCostsPct))
	set("monthlyRent", checkRange(orZero(input.monthlyRent), 0, L.maxMonthlyRent))
	for (const field of ["appreciationPct", "rentIncreasePct", "investmentReturnPct"] as const) {
		set(field, checkRange(orZero(input[field]), L.minGrowthPct, L.maxGrowthPct))
	}

	const horizon = input.horizonYears
	if (Number.isNaN(horizon)) errors.horizonYears = "required"
	else if (Math.round(horizon) < 1) errors.horizonYears = "tooSmall"
	else if (Math.round(horizon) > L.maxHorizonYears) errors.horizonYears = "tooLarge"

	return errors
}

const toCents = (euros: number) => Math.round(euros * 100)
const fromCents = (cents: number) => cents / 100

export function computeBuyVsRent(input: BuyVsRentInput): BuyVsRentCalculation {
	const errors = validate(input)
	if (Object.keys(errors).length > 0) return { ok: false, errors }

	const priceCents = toCents(input.homePrice)
	const downPaymentCents = toCents(orZero(input.downPayment))
	const loanCents = priceCents - downPaymentCents
	const purchaseCostsCents = Math.round((priceCents * orZero(input.purchaseCostsPct)) / 100)
	const upfrontCents = downPaymentCents + purchaseCostsCents

	const ownership = orZero(input.ownershipCostsPct) / 100
	const appreciation = orZero(input.appreciationPct) / 100
	const rentIncrease = orZero(input.rentIncreasePct) / 100
	const selling = orZero(input.sellingCostsPct) / 100
	const rentCents = toCents(orZero(input.monthlyRent))
	// The monthly rate that compounds to the annual return over twelve months.
	const monthlyReturn = Math.expm1(Math.log1p(orZero(input.investmentReturnPct) / 100) / 12)
	const horizon = Math.round(input.horizonYears)

	// Principal and interest each month, and the balance owed at the end of each loan year.
	const paymentCents: number[] = []
	const balanceCentsByYear: number[] = []
	if (loanCents > 0) {
		const mortgage = computeMortgage({
			loanAmount: fromCents(loanCents),
			termYears: input.mortgageTermYears,
			annualRate: orZero(input.mortgageRate),
			monthlyFees: 0,
		})
		if (!mortgage.ok) throw new Error("Buy versus rent passed the mortgage an invalid loan")
		for (const year of mortgage.result.years) {
			for (const month of year.months) paymentCents.push(toCents(month.payment))
			balanceCentsByYear.push(toCents(year.balance))
		}
	}
	const loanBalanceAt = (year: number) =>
		year === 0 ? loanCents : (balanceCentsByYear[year - 1] ?? 0)

	const homeValueAt = (year: number) => Math.round(priceCents * (1 + appreciation) ** year)

	const row = (
		year: number,
		ownerInvestmentsCents: number,
		renterInvestmentsCents: number,
		ownerCostsCents: number,
		rentPaidCents: number,
	): BuyVsRentYear => {
		const homeValueCents = homeValueAt(year)
		const sellingCostsCents = Math.round(homeValueCents * selling)
		const loanBalanceCents = loanBalanceAt(year)
		const ownerCents = homeValueCents - sellingCostsCents - loanBalanceCents + ownerInvestmentsCents
		return {
			year,
			homeValue: fromCents(homeValueCents),
			sellingCosts: fromCents(sellingCostsCents),
			loanBalance: fromCents(loanBalanceCents),
			ownerInvestments: fromCents(ownerInvestmentsCents),
			renterInvestments: fromCents(renterInvestmentsCents),
			ownerNetWorth: fromCents(ownerCents),
			renterNetWorth: fromCents(renterInvestmentsCents),
			difference: fromCents(ownerCents - renterInvestmentsCents),
			ownerCosts: fromCents(ownerCostsCents),
			rentPaid: fromCents(rentPaidCents),
		}
	}

	const years: BuyVsRentYear[] = [row(0, 0, upfrontCents, 0, 0)]
	let ownerInvestments = 0
	let renterInvestments = upfrontCents
	let firstMonthOwnerCents = 0

	for (let year = 1; year <= horizon; year++) {
		// Ownership costs follow the home's value and the rent rises once a year. The year's
		// ownership cost is spread over the months so the twelve add up to it exactly.
		const ownershipYearCents = Math.round(homeValueAt(year - 1) * ownership)
		const ownershipBy = (month: number) => Math.round((ownershipYearCents * month) / 12)
		const rentMonthlyCents = Math.round(rentCents * (1 + rentIncrease) ** (year - 1))
		let ownerCostsCents = 0

		for (let month = 1; month <= 12; month++) {
			const ownerMonthCents =
				(paymentCents[(year - 1) * 12 + month - 1] ?? 0) + ownershipBy(month) - ownershipBy(month - 1)
			if (year === 1 && month === 1) firstMonthOwnerCents = ownerMonthCents
			ownerCostsCents += ownerMonthCents

			ownerInvestments += Math.round(ownerInvestments * monthlyReturn)
			renterInvestments += Math.round(renterInvestments * monthlyReturn)
			const gap = ownerMonthCents - rentMonthlyCents
			if (gap > 0) renterInvestments += gap
			else ownerInvestments -= gap
		}

		years.push(row(year, ownerInvestments, renterInvestments, ownerCostsCents, rentMonthlyCents * 12))
	}

	const last = years[years.length - 1]
	const ahead = years.find((entry) => entry.year > 0 && entry.difference > 0)

	return {
		ok: true,
		result: {
			loanAmount: fromCents(loanCents),
			purchaseCosts: fromCents(purchaseCostsCents),
			upfrontCash: fromCents(upfrontCents),
			monthlyMortgagePayment: fromCents(paymentCents[0] ?? 0),
			firstMonthOwnerCost: fromCents(firstMonthOwnerCents),
			firstMonthRent: fromCents(rentCents),
			years,
			ownerNetWorth: last.ownerNetWorth,
			renterNetWorth: last.renterNetWorth,
			difference: last.difference,
			breakEvenYear: ahead?.year ?? null,
		},
	}
}
