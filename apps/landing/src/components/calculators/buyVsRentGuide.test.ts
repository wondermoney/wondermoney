import { describe, expect, it } from "vitest"
import { BUY_VS_RENT_EXAMPLE, computeBuyVsRent } from "@/lib/calculators/buyVsRent"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { BUY_VS_RENT_GUIDE_IDS, buildBuyVsRentGuide } from "./buyVsRentGuide"
import { formulaHrefs } from "./guideBlocks"
import { expectFigures, expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"

const calculation = computeBuyVsRent(BUY_VS_RENT_EXAMPLE)
if (!calculation.ok) throw new Error("invalid example")
const result = calculation.result
const end = result.years[result.years.length - 1]

describe("buy versus rent guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildBuyVsRentGuide(lang)
		expectTerms([...guide.read, ...guide.notes])
		expectFigures([...guide.owner, ...guide.paths])
		expectFormulaLinks(guide.formulas, [...guide.read, ...guide.notes])
		expect(guide.read).toHaveLength(4)
		expect(formulaHrefs(guide.formulas)).toHaveLength(9)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => buildBuyVsRentGuide(lang).notes, "buy-vs-rent")
		expect(buildBuyVsRentGuide("en").notes.map((note) => note.id)).toEqual(Object.values(BUY_VS_RENT_GUIDE_IDS))
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildBuyVsRentGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(guide.owner.map((figure) => figure.value)).toEqual(
			[end.homeValue, end.sellingCosts, end.loanBalance, result.ownerNetWorth].map((value) =>
				formatMoney(lang, value, { decimals: 0 }),
			),
		)
		expect(guide.paths.map((figure) => figure.value)).toEqual(
			[result.ownerNetWorth, result.renterNetWorth, Math.abs(result.difference)].map(money),
		)
	})

	it("adds up the way the figures say: the owner has nothing invested in this example", () => {
		const cents = (value: number) => Math.round(value * 100)
		expect(end.ownerInvestments).toBe(0)
		expect(cents(end.homeValue - end.sellingCosts - end.loanBalance)).toBe(cents(result.ownerNetWorth))
		expect(cents(result.ownerNetWorth - result.renterNetWorth)).toBe(cents(result.difference))
		expect(result.difference).toBeGreaterThan(0)
	})
})
