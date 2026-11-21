import { describe, expect, it } from "vitest"
import { MORTGAGE_TRANSFER_EXAMPLE, computeMortgageTransfer } from "@/lib/calculators/mortgageTransfer"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { expectFigures, expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"
import { MORTGAGE_TRANSFER_GUIDE_IDS, buildMortgageTransferGuide } from "./mortgageTransferGuide"

const { exampleCosts, ...example } = MORTGAGE_TRANSFER_EXAMPLE
const calculation = computeMortgageTransfer({ ...example, ...exampleCosts })
if (!calculation.ok) throw new Error("invalid example")
const result = calculation.result

describe("mortgage transfer guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildMortgageTransferGuide(lang)
		expectTerms([...guide.compare, ...guide.notes, ...guide.assumptions])
		expectFigures([...guide.monthly, ...guide.costs, ...guide.totals])
		expectFormulaLinks(guide.formulas, [...guide.compare, ...guide.notes, ...guide.assumptions])
		expect(guide.compare).toHaveLength(4)
		expect(formulaHrefs(guide.formulas).length).toBeGreaterThanOrEqual(15)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => {
			const guide = buildMortgageTransferGuide(lang)
			return [...guide.notes, ...guide.assumptions]
		}, "mortgage-transfer")
		const guide = buildMortgageTransferGuide("en")
		expect([...guide.notes, ...guide.assumptions].map((note) => note.id)).toEqual(
			expect.arrayContaining(Object.values(MORTGAGE_TRANSFER_GUIDE_IDS)),
		)
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildMortgageTransferGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(guide.monthly.map((figure) => figure.value)).toEqual([
			money(result.current.monthlyTotal),
			money(result.offer.monthlyTotal),
			money(result.monthlySaving),
		])
		expect(guide.costs.map((figure) => figure.value)).toEqual(
			[result.costs.exitFee, result.costs.newLoanFees, result.costs.valuationFee, result.costs.legalFees].map(money),
		)
		expect(guide.totals.map((figure) => figure.value)).toEqual([
			money(result.current.totalCost),
			money(result.offer.totalCost),
			money(result.netSaving),
		])
	})

	it("adds up the way the figures say", () => {
		const cents = (value: number) => Math.round(value * 100)
		expect(cents(result.current.monthlyTotal - result.offer.monthlyTotal)).toBe(cents(result.monthlySaving))
		expect(cents(result.current.totalCost - result.offer.totalCost)).toBe(cents(result.netSaving))
		expect(
			cents(result.costs.exitFee + result.costs.newLoanFees + result.costs.valuationFee + result.costs.legalFees),
		).toBe(cents(result.costs.total))
	})
})
