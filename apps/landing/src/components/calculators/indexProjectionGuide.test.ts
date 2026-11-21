import { describe, expect, it } from "vitest"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"
import { buildIndexProjectionGuide, indexProjectionExampleResult } from "./indexProjectionGuide"

const result = indexProjectionExampleResult()

describe("index projection guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every note, figure and formula in %s", (lang) => {
		const guide = buildIndexProjectionGuide(lang)

		expectTerms(guide.notes)
		expect(guide.formulas).toHaveLength(3)
		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
		expectFormulaLinks(guide.formulas, guide.notes)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => buildIndexProjectionGuide(lang).notes, "index-projection")
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the projection in %s", (lang) => {
		const guide = buildIndexProjectionGuide(lang)
		const money = (value: number) => formatMoney(lang, value)

		expect(guide.flow.map((figure) => figure.value)).toEqual([
			money(result.beforeFees),
			money(result.feeImpact),
			money(result.afterFees),
		])
		expect(result.beforeFees - result.feeImpact).toBe(result.afterFees)
	})
})
