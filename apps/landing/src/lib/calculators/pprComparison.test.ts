import { describe, expect, it } from "vitest"
import {
	PPR_DEDUCTION_LIMITS,
	PPR_PRODUCTS,
	PPR_TAX_RULES,
	PPR_TAX_SOURCES,
	deductionLimitForAge,
	filterProducts,
	isFundsDataStale,
	isInsuranceDataStale,
	pprDeduction,
	pprRedemptionRates,
	riskClassSummary,
	sortProducts,
	validateDeduction,
	type PprFilters,
} from "./pprComparison"
import { PPR_FUNDS, PPR_FUNDS_SOURCE } from "./data/pprFunds"
import { PPR_INSURANCE, PPR_INSURANCE_SOURCE } from "./data/pprInsurance"
import type { PprProduct } from "./pprTypes"

const product = (overrides: Partial<PprProduct>): PprProduct => ({
	id: "x",
	name: "X",
	shareClass: null,
	manager: "M",
	kind: "fund",
	category: "ucits",
	riskClass: 4,
	yearlyCost: 1,
	subscriptionFee: null,
	redemptionFee: null,
	transferFee: null,
	returns: { y1: 1, y3: 1, y5: 1, y10: null },
	capitalGuarantee: null,
	returnGuarantee: null,
	minGuaranteedRate: null,
	documentUrl: null,
	...overrides,
})

const ALL: PprFilters = { kind: "all", riskClass: "all", query: "" }

describe("PPR data", () => {
	it("joins the CMVM funds and the ASF products, with unique ids", () => {
		expect(PPR_PRODUCTS).toHaveLength(PPR_FUNDS.length + PPR_INSURANCE.length)
		expect(new Set(PPR_PRODUCTS.map((item) => item.id)).size).toBe(PPR_PRODUCTS.length)
		expect(PPR_FUNDS.every((item) => item.kind === "fund" && item.id.startsWith("cmvm-"))).toBe(true)
		expect(PPR_INSURANCE.every((item) => item.kind !== "fund" && item.id.startsWith("asf-"))).toBe(true)
	})

	it("holds figures within the ranges the sources allow", () => {
		for (const item of PPR_PRODUCTS) {
			if (item.riskClass !== null) expect(item.riskClass).toBeGreaterThanOrEqual(1)
			if (item.riskClass !== null) expect(item.riskClass).toBeLessThanOrEqual(7)
			if (item.yearlyCost !== null) expect(item.yearlyCost).toBeGreaterThanOrEqual(0)
			for (const fee of [item.subscriptionFee, item.redemptionFee, item.transferFee]) {
				if (fee) expect(fee[0]).toBeLessThanOrEqual(fee[1])
			}
			// The CMVM list publishes no entry or exit fees and no guarantees: they stay "not published".
			if (item.kind === "fund") {
				expect([item.subscriptionFee, item.redemptionFee, item.transferFee, item.capitalGuarantee]).toEqual([null, null, null, null])
				expect(item.documentUrl).toMatch(/^https:\/\/investidor\.cmvm\.pt\/PInvestidor\/PDF_fundo\?Input=[0-9A-F]+$/)
			}
		}
		expect(PPR_FUNDS_SOURCE.returnsYear).toBeGreaterThanOrEqual(Number(PPR_FUNDS_SOURCE.fetchedOn.slice(0, 4)) - 2)
		expect(PPR_INSURANCE_SOURCE.returnsYear).toBeGreaterThanOrEqual(2024)
	})

	it("never links a seller or an affiliate", () => {
		for (const item of PPR_PRODUCTS) {
			if (item.documentUrl) expect(new URL(item.documentUrl).hostname).toBe("investidor.cmvm.pt")
		}
	})
})

describe("filtering and sorting", () => {
	const items = [
		product({ id: "a", name: "Alpha", riskClass: 4, yearlyCost: 1.5, returns: { y1: 5, y3: 3, y5: null, y10: null } }),
		product({ id: "b", name: "Beta", riskClass: 4, yearlyCost: 0.5, returns: { y1: 2, y3: 6, y5: 2, y10: null } }),
		product({ id: "c", name: "Gamma", riskClass: 2, yearlyCost: null, kind: "pensionFund", category: null, returns: { y1: null, y3: null, y5: null, y10: null } }),
		product({ id: "d", name: "Delta", riskClass: null, kind: "insuranceGuaranteed", category: null, manager: "Seguradora" }),
	]

	it("filters by type, risk class (including not published) and a search in name or manager", () => {
		expect(filterProducts(items, ALL)).toHaveLength(4)
		expect(filterProducts(items, { ...ALL, kind: "fund" }).map((item) => item.id)).toEqual(["a", "b"])
		expect(filterProducts(items, { ...ALL, riskClass: 4 }).map((item) => item.id)).toEqual(["a", "b"])
		expect(filterProducts(items, { ...ALL, riskClass: "none" }).map((item) => item.id)).toEqual(["d"])
		expect(filterProducts(items, { ...ALL, query: "  seguradORA " }).map((item) => item.id)).toEqual(["d"])
		expect(filterProducts(items, { ...ALL, query: "gamma" }).map((item) => item.id)).toEqual(["c"])
		expect(filterProducts(items, { ...ALL, kind: "fund", riskClass: 7 })).toEqual([])
	})

	it("sorts by cost, cheapest first, and by return, highest first, with missing figures last", () => {
		expect(sortProducts(items, "cost").map((item) => item.id)).toEqual(["b", "d", "a", "c"])
		expect(sortProducts(items, "return1").map((item) => item.id)).toEqual(["a", "b", "d", "c"])
		expect(sortProducts(items, "return3").map((item) => item.id)).toEqual(["b", "a", "d", "c"])
		expect(sortProducts(items, "return5").map((item) => item.id)).toEqual(["b", "d", "a", "c"])
		expect(sortProducts(items, "name").map((item) => item.id)).toEqual(["a", "b", "d", "c"])
		// Sorting returns a copy.
		expect(items.map((item) => item.id)).toEqual(["a", "b", "c", "d"])
	})

	it("summarises a risk class: count, cost range and median", () => {
		const summary = riskClassSummary(items, 4)
		expect(summary).toEqual({ count: 2, withCost: 2, minCost: 0.5, maxCost: 1.5, medianCost: 1 })
		expect(riskClassSummary(items, 7)).toEqual({ count: 0, withCost: 0, minCost: null, maxCost: null, medianCost: null })
	})
})

describe("IRS deduction (EBF art. 21.º, n.º 2)", () => {
	it("applies the limit for the age on 1 January", () => {
		expect(PPR_DEDUCTION_LIMITS).toEqual([400, 350, 300])
		expect(deductionLimitForAge(34)).toBe(400)
		expect(deductionLimitForAge(35)).toBe(350)
		expect(deductionLimitForAge(50)).toBe(350)
		expect(deductionLimitForAge(51)).toBe(300)
	})

	it("deducts 20% of the contributions up to the limit", () => {
		expect(pprDeduction({ age: 30, contribution: 1000, retired: false })).toEqual({
			limit: 400,
			deduction: 200,
			fullDeductionAt: 2000,
			capped: false,
		})
		expect(pprDeduction({ age: 40, contribution: 5000, retired: false })).toEqual({
			limit: 350,
			deduction: 350,
			fullDeductionAt: 1750,
			capped: true,
		})
		expect(pprDeduction({ age: 60, contribution: 1500, retired: false }).deduction).toBe(300)
		expect(pprDeduction({ age: 60, contribution: 0, retired: false }).deduction).toBe(0)
	})

	it("gives nothing for contributions made after retirement (n.º 10)", () => {
		expect(pprDeduction({ age: 67, contribution: 1500, retired: true })).toEqual({
			limit: 0,
			deduction: 0,
			fullDeductionAt: 0,
			capped: false,
		})
	})

	it("rejects empty, negative, fractional ages and very large amounts", () => {
		expect(validateDeduction({ age: 40, contribution: 1000, retired: false })).toEqual([])
		expect(validateDeduction({ age: Number.NaN, contribution: Number.NaN, retired: false })).toEqual(["age", "contribution"])
		expect(validateDeduction({ age: 40.5, contribution: -1, retired: false })).toEqual(["age", "contribution"])
		expect(validateDeduction({ age: 121, contribution: 1e12, retired: false })).toEqual(["age", "contribution"])
	})
})

describe("tax on a redemption (EBF art. 21.º, n.os 3 to 5)", () => {
	it("taxes a lump sum in a legal case at 20% on two fifths of the gain, 8% in effect (n.º 3, b)", () => {
		expect(PPR_TAX_RULES.legalRedemption).toEqual({ rate: 20, taxedShare: 2 / 5 })
		expect(pprRedemptionRates().legal).toBe(8)
	})

	it("taxes the gain outside the legal cases at 21.5% (n.º 5, as worded by Lei n.º 64-B/2011)", () => {
		expect(PPR_TAX_RULES.otherRedemptionRate).toBe(21.5)
		expect(PPR_TAX_RULES.clawbackPerYear).toBe(10)
	})

	it("leaves out a fifth of the gain after 5 years and three fifths after 8 (CIRS art. 5.º, n.º 3)", () => {
		expect(PPR_TAX_RULES.firstHalfShare).toBe(35)
		expect(PPR_TAX_RULES.longHeldExclusions).toEqual([
			{ afterYears: 5, excludedShare: 1 / 5 },
			{ afterYears: 8, excludedShare: 3 / 5 },
		])
		expect(pprRedemptionRates().outside).toEqual([
			{ afterYears: 0, rate: 21.5 },
			{ afterYears: 5, rate: 17.2 },
			{ afterYears: 8, rate: 8.6 },
		])
	})

	it("reads the rules from the consolidated texts", () => {
		expect(PPR_TAX_SOURCES.ebf).toBe(
			"https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/Cod_download/Documents/EBF.pdf",
		)
		expect(PPR_TAX_SOURCES.cirs).toBe(
			"https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/Cod_download/Documents/CIRS.pdf",
		)
	})
})

describe("staleness", () => {
	it("warns when the CMVM list was read more than two months ago", () => {
		const fetched = new Date(`${PPR_FUNDS_SOURCE.fetchedOn}T12:00:00Z`)
		expect(isFundsDataStale(fetched)).toBe(false)
		expect(isFundsDataStale(new Date(fetched.getTime() + 61 * 86_400_000))).toBe(false)
		expect(isFundsDataStale(new Date(fetched.getTime() + 63 * 86_400_000))).toBe(true)
	})

	it("warns when the ASF should have published a newer year", () => {
		const year = PPR_INSURANCE_SOURCE.returnsYear
		expect(isInsuranceDataStale(new Date(`${year + 1}-12-31T12:00:00Z`))).toBe(false)
		expect(isInsuranceDataStale(new Date(`${year + 2}-05-31T12:00:00Z`))).toBe(false)
		expect(isInsuranceDataStale(new Date(`${year + 2}-06-02T12:00:00Z`))).toBe(true)
	})
})
