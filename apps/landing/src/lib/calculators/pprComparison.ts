import { PPR_FUNDS, PPR_FUNDS_SOURCE } from "./data/pprFunds"
import { PPR_INSURANCE, PPR_INSURANCE_SOURCE } from "./data/pprInsurance"
import { PPR_TAX_RULES } from "./data/pprTaxRules"
import type { PprKind, PprProduct } from "./pprTypes"

export { PPR_FUNDS_SOURCE } from "./data/pprFunds"
export { PPR_INSURANCE_SOURCE } from "./data/pprInsurance"
export { PPR_TAX_RULES, PPR_TAX_RULES_REVIEWED, PPR_TAX_SOURCES } from "./data/pprTaxRules"
export type { PprFeeRange, PprFundCategory, PprGuarantee, PprKind, PprProduct, PprReturns } from "./pprTypes"

/** Every product on the page: the CMVM's funds, then the ASF's insurance and pension funds. */
export const PPR_PRODUCTS: readonly PprProduct[] = [...PPR_FUNDS, ...PPR_INSURANCE]

export const PPR_KINDS: readonly PprKind[] = ["fund", "insuranceLinked", "insuranceGuaranteed", "pensionFund"]
export const PPR_RISK_CLASSES = [1, 2, 3, 4, 5, 6, 7] as const

export type RiskFilter = "all" | "none" | (typeof PPR_RISK_CLASSES)[number]

export interface PprFilters {
	kind: "all" | PprKind
	riskClass: RiskFilter
	/** Free text matched against the product, share class and manager names. */
	query: string
}

export const PPR_SORTS = ["name", "cost", "return1", "return3", "return5"] as const
export type PprSort = (typeof PPR_SORTS)[number]

/** Lowercase without accents, so "acoes" finds "Ações". */
function fold(text: string): string {
	return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
}

export function filterProducts(products: readonly PprProduct[], filters: PprFilters): PprProduct[] {
	const query = fold(filters.query.trim())
	return products.filter((item) => {
		if (filters.kind !== "all" && item.kind !== filters.kind) return false
		if (filters.riskClass === "none" && item.riskClass !== null) return false
		if (typeof filters.riskClass === "number" && item.riskClass !== filters.riskClass) return false
		if (query && !fold(`${item.name} ${item.shareClass ?? ""} ${item.manager}`).includes(query)) return false
		return true
	})
}

const byName = (a: PprProduct, b: PprProduct) =>
	a.name.localeCompare(b.name, "pt", { sensitivity: "base" }) ||
	(a.shareClass ?? "").localeCompare(b.shareClass ?? "", "pt") ||
	a.id.localeCompare(b.id)

const SORT_VALUE: Record<Exclude<PprSort, "name">, (item: PprProduct) => number | null> = {
	cost: (item) => item.yearlyCost,
	return1: (item) => item.returns.y1,
	return3: (item) => item.returns.y3,
	return5: (item) => item.returns.y5,
}

/**
 * A sorted copy: by name, by yearly costs (lowest first) or by a return (highest first). Products
 * without the figure go last, by name, so a missing figure never reads as a good one.
 */
export function sortProducts(products: readonly PprProduct[], sort: PprSort): PprProduct[] {
	if (sort === "name") return [...products].sort(byName)
	const value = SORT_VALUE[sort]
	const direction = sort === "cost" ? 1 : -1
	return [...products].sort((a, b) => {
		const left = value(a)
		const right = value(b)
		if (left === null || right === null) return left === right ? byName(a, b) : left === null ? 1 : -1
		return (left - right) * direction || byName(a, b)
	})
}

export interface RiskClassSummary {
	count: number
	withCost: number
	minCost: number | null
	maxCost: number | null
	medianCost: number | null
}

/** How many products a risk class holds, and the range and median of their published yearly costs. */
export function riskClassSummary(products: readonly PprProduct[], riskClass: number): RiskClassSummary {
	const items = products.filter((item) => item.riskClass === riskClass)
	const costs = items.map((item) => item.yearlyCost).filter((cost): cost is number => cost !== null).sort((a, b) => a - b)
	const middle = Math.floor(costs.length / 2)
	const median = costs.length === 0 ? null : costs.length % 2 ? costs[middle] : (costs[middle - 1] + costs[middle]) / 2
	return {
		count: items.length,
		withCost: costs.length,
		minCost: costs[0] ?? null,
		maxCost: costs.at(-1) ?? null,
		medianCost: median === null ? null : Math.round(median * 1000) / 1000,
	}
}

// The IRS deduction of EBF art. 21.º, n.º 2.

export const PPR_DEDUCTION_LIMITS = PPR_TAX_RULES.limits.map((band) => band.limit)

export const DEDUCTION_INPUT_LIMITS = { maxAge: 120, maxContribution: 1_000_000 } as const

export interface DeductionInput {
	/** Age on 1 January of the year of the contribution (n.º 9). */
	age: number
	/** Contributions to PPR in the year, in euros. */
	contribution: number
	/** Retired before the contribution: nothing is deductible (n.º 10). */
	retired: boolean
}

export type DeductionError = "age" | "contribution"

export function validateDeduction(input: DeductionInput): DeductionError[] {
	const errors: DeductionError[] = []
	if (!Number.isInteger(input.age) || input.age < 0 || input.age > DEDUCTION_INPUT_LIMITS.maxAge) errors.push("age")
	if (!Number.isFinite(input.contribution) || input.contribution < 0 || input.contribution > DEDUCTION_INPUT_LIMITS.maxContribution)
		errors.push("contribution")
	return errors
}

export function deductionLimitForAge(age: number): number {
	const band = PPR_TAX_RULES.limits.find((item) => age >= item.fromAge && (item.toAge === null || age <= item.toAge))
	return band?.limit ?? PPR_TAX_RULES.limits[PPR_TAX_RULES.limits.length - 1].limit
}

export interface DeductionResult {
	/** The year's limit for this taxpayer, in euros. */
	limit: number
	/** The deduction from the IRS tax, in euros, before the overall cap of CIRS art. 78.º, n.º 7. */
	deduction: number
	/** The contribution that reaches the limit. */
	fullDeductionAt: number
	/** The 20% of the contribution was above the limit. */
	capped: boolean
}

const round2 = (value: number) => Math.round(value * 100) / 100

export function pprDeduction(input: DeductionInput): DeductionResult {
	if (input.retired) return { limit: 0, deduction: 0, fullDeductionAt: 0, capped: false }
	const limit = deductionLimitForAge(input.age)
	const rate = PPR_TAX_RULES.deductionRate / 100
	const uncapped = Math.max(0, input.contribution) * rate
	return {
		limit,
		deduction: round2(Math.min(uncapped, limit)),
		fullDeductionAt: round2(limit / rate),
		capped: uncapped > limit,
	}
}

export interface PprRedemptionRates {
	/** Effective tax on the gain of a lump sum in a legal case (EBF art. 21.º, n.º 3, b). */
	legal: number
	/** Effective tax on the gain outside the legal cases, from the plan's first year and after each reduction (n.º 5). */
	outside: readonly { afterYears: number; rate: number }[]
}

/** The tax rates on the gain of a PPR redemption, as shares of the whole gain, in percent. */
export function pprRedemptionRates(): PprRedemptionRates {
	const { legalRedemption, otherRedemptionRate, longHeldExclusions } = PPR_TAX_RULES
	return {
		legal: round2(legalRedemption.rate * legalRedemption.taxedShare),
		outside: [
			{ afterYears: 0, rate: otherRedemptionRate },
			...longHeldExclusions.map(({ afterYears, excludedShare }) => ({
				afterYears,
				rate: round2(otherRedemptionRate * (1 - excludedShare)),
			})),
		],
	}
}

// Staleness: the page checks it in the browser, so an old build still warns.

const DAY = 86_400_000
/** The CMVM list is read monthly; two missed runs make the page say so. */
export const FUNDS_STALE_AFTER_DAYS = 62

export function isFundsDataStale(now: Date): boolean {
	return now.getTime() - Date.parse(`${PPR_FUNDS_SOURCE.fetchedOn}T00:00:00Z`) > FUNDS_STALE_AFTER_DAYS * DAY
}

/**
 * The ASF publishes a new year's figures by the end of April. From June of the second year after
 * the data's year (figures for 2025 are due by April 2027), the page says they may be out of date.
 */
export function isInsuranceDataStale(now: Date): boolean {
	return now.getTime() >= Date.parse(`${PPR_INSURANCE_SOURCE.returnsYear + 2}-06-01T00:00:00Z`)
}
