/** Types of the PPR comparison data (data/pprProducts.ts, written by scripts/build-ppr-products.mjs). */

/**
 * The legal form of a PPR, which sets its supervisor and what is published about it:
 * an investment fund (CMVM), insurance linked to investment funds, insurance not linked to funds
 * (with a capital guarantee) or a pension fund (all three ASF).
 */
export type PprKind = "fund" | "insuranceLinked" | "insuranceGuaranteed" | "pensionFund"

/** The CMVM's fund types: harmonised (UCITS) funds by asset class, or alternative (non-harmonised) funds. */
export type PprFundCategory = "ucits" | "ucitsEquity" | "ucitsBond" | "ucitsFlexible" | "alternative"

/** When a guarantee applies, as the ASF platform states it. */
export type PprGuarantee = "always" | "atMaturity" | "other" | "none"

/** A fee as published: the lowest and highest rate the contract allows, in percent. */
export type PprFeeRange = readonly [min: number, max: number]

export interface PprReturns {
	/** Annualised returns in percent over 1, 3, 5 and 10 calendar years; null when not published. */
	y1: number | null
	y3: number | null
	y5: number | null
	y10: number | null
}

export interface PprProduct {
	/** "cmvm-<share class id>" or "asf-<product code>". */
	id: string
	name: string
	/** The share class (categoria) when the product has several, as the source names it. */
	shareClass: string | null
	/** The management company or insurer. */
	manager: string
	kind: PprKind
	/** Funds only: the CMVM's fund type. */
	category: PprFundCategory | null
	/** 1 (lowest) to 7, from the volatility of the last five years; null when not published. */
	riskClass: number | null
	/**
	 * Yearly costs in percent: the TEC (ongoing charges) for a fund, the yearly management and
	 * deposit cost rate for an ASF product.
	 */
	yearlyCost: number | null
	/** ASF products only; the CMVM list does not publish these (they are in the fund's IFI). */
	subscriptionFee: PprFeeRange | null
	redemptionFee: PprFeeRange | null
	transferFee: PprFeeRange | null
	returns: PprReturns
	/** ASF products only. */
	capitalGuarantee: PprGuarantee | null
	returnGuarantee: PprGuarantee | null
	/** Guaranteed minimum rate for the current year, where capital or return is guaranteed. */
	minGuaranteedRate: number | null
	/** Funds: the CMVM's link to the fund's IFI (key investor information). */
	documentUrl: string | null
}
