import { describe, expect, it } from "vitest"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { DEPOSIT_RATE_INDEX_GUIDE_IDS, buildDepositRateIndexGuide, depositRateIndexExampleResult } from "./depositRateIndexGuide"
import { expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"

const result = depositRateIndexExampleResult()

describe("deposit rate index guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every step, figure and formula in %s", (lang) => {
		const guide = buildDepositRateIndexGuide(lang)

		expectTerms(guide.steps)
		expect(guide.steps).toHaveLength(4)
		expect(guide.formulas).toHaveLength(3)
		expect(guide.flowOperators).toHaveLength(guide.taxFlow.length - 1)
		expect(guide.flowOperators).toHaveLength(guide.realFlow.length - 1)
		for (const figure of [...guide.taxFlow, ...guide.realFlow]) expect(figure.label).not.toMatch(/\{\{/)
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a step in %s", (lang) => {
		const guide = buildDepositRateIndexGuide(lang)
		const hrefs = expectFormulaLinks(guide.formulas, guide.steps)

		for (const id of Object.values(DEPOSIT_RATE_INDEX_GUIDE_IDS)) expect(hrefs).toContain(`#${id}`)
	})

	it("keeps the same step ids in every locale", () => {
		expectStableIds((lang) => buildDepositRateIndexGuide(lang).steps, "deposit-rate-index")
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildDepositRateIndexGuide(lang)
		const eur = (value: number) => formatMoney(lang, value, { currency: "EUR", decimals: 2 })
		const { deposit } = result

		expect(guide.taxFlow.map((figure) => figure.value)).toEqual([
			eur(deposit.grossInterest),
			eur(deposit.tax),
			eur(deposit.netInterest),
		])
		expect(guide.realFlow.map((figure) => figure.value)).toEqual([
			eur(deposit.netInterest),
			eur(result.inflationCost),
			eur(result.realGain),
		])
		expect(Math.round((deposit.grossInterest - deposit.tax) * 100) / 100).toBe(deposit.netInterest)
		expect(Math.round((deposit.netInterest - result.inflationCost) * 100) / 100).toBe(result.realGain)
	})
})
