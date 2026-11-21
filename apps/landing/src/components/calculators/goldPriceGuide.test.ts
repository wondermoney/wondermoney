import { describe, expect, it } from "vitest"
import { formatMoney, formatNumber } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { GOLD_PRICE_GUIDE_IDS, buildGoldPriceGuide, goldPriceExampleResults } from "./goldPriceGuide"
import { guideFigureFaces } from "./guideBlocks"
import { expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"

const { example, result } = goldPriceExampleResults()

describe("gold price guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildGoldPriceGuide(lang)

		expectTerms(guide.purities)
		expectTerms(guide.steps)
		expectTerms(guide.limits)
		expect(guide.purities).toHaveLength(6)
		expect(guide.steps).toHaveLength(4)
		expect(guide.formulas).toHaveLength(4)
		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a step in %s", (lang) => {
		const guide = buildGoldPriceGuide(lang)
		const hrefs = expectFormulaLinks(guide.formulas, guide.steps)

		for (const id of Object.values(GOLD_PRICE_GUIDE_IDS)) expect(hrefs).toContain(`#${id}`)
	})

	it("keeps the same step ids in every locale", () => {
		expectStableIds((lang) => buildGoldPriceGuide(lang).steps, "gold-price")
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildGoldPriceGuide(lang)

		expect(guide.flow.map((figure) => figure.value)).toEqual([
			`${formatNumber(lang, example.grams)} g`,
			`${formatNumber(lang, result.pureGrams)} g`,
			formatMoney(lang, result.value, { decimals: 2 }),
		])
		expect(guide.flow[0].detail).not.toMatch(/\{\{/)
	})

	it.each(SUPPORTED_LANGS)("sets the purity's name in the body face and the arithmetic as figures in %s", (lang) => {
		const guide = buildGoldPriceGuide(lang)

		expect(guide.flow.map((figure) => guideFigureFaces(figure).detail)).toEqual(["font-sans", "font-mono", "font-mono"])
		for (const figure of guide.flow) expect(guideFigureFaces(figure).value).toBe("font-mono")
	})
})
