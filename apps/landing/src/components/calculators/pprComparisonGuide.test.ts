import { describe, expect, it } from "vitest"
import { PPR_TAX_RULES, pprDeduction } from "@/lib/calculators/pprComparison"
import { createPprFormat } from "@/lib/calculators/pprFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { getTranslations } from "@/lib/translations"
import { expectTerms } from "./guideTestUtils"
import { PPR_DEDUCTION_EXAMPLE, buildPprComparisonGuide, pprComparisonExample } from "./pprComparisonGuide"

const { low, high, costGap } = pprComparisonExample()
const deduction = pprDeduction(PPR_DEDUCTION_EXAMPLE)

describe("PPR comparison guide content", () => {
	it.each(SUPPORTED_LANGS)("lists the four forms of PPR as terms in %s", (lang) => {
		const guide = buildPprComparisonGuide(lang)

		expectTerms(guide.forms)
		expect(guide.forms).toHaveLength(4)
		for (const value of Object.values(guide.values)) expect(value).not.toMatch(/\{\{/)
	})

	it.each(SUPPORTED_LANGS)("takes the figures from the product lists and the tax rules in %s", (lang) => {
		const format = createPprFormat(getTranslations(lang), lang)
		const guide = buildPprComparisonGuide(lang)

		expect(guide.comparison.map((figure) => figure.value)).toEqual([
			format.percent(low.yearlyCost),
			format.percent(high.yearlyCost),
			format.eur(Math.round(costGap)),
		])
		expect(guide.deduction.map((figure) => figure.value)).toEqual([
			format.eur(PPR_DEDUCTION_EXAMPLE.contribution),
			format.eur(deduction.deduction),
		])
		expect(guide.deductionOperators).toHaveLength(guide.deduction.length - 1)
	})

	it("keeps the deduction example under its age limit, so contribution × rate is the deduction", () => {
		expect(deduction.capped).toBe(false)
		expect(deduction.deduction).toBe((PPR_DEDUCTION_EXAMPLE.contribution * PPR_TAX_RULES.deductionRate) / 100)
	})
})
