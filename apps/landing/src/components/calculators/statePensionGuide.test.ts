import { describe, expect, it } from "vitest"
import { SUSTAINABILITY_FACTOR_2026_BP } from "@/lib/calculators/statePension"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"
import { STATE_PENSION_GUIDE_IDS, buildStatePensionGuide, statePensionExampleResult } from "./statePensionGuide"

const result = statePensionExampleResult()

describe("state pension guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every note, figure and formula in %s", (lang) => {
		const guide = buildStatePensionGuide(lang)

		expectTerms(guide.notes)
		expect(guide.notes).toHaveLength(8)
		expect(guide.formulas).toHaveLength(4)
		expect(guide.pensionOperators).toHaveLength(guide.pensionFlow.length - 1)
		expect(guide.gapOperators).toHaveLength(guide.gapFlow.length - 1)
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a note in %s", (lang) => {
		const guide = buildStatePensionGuide(lang)
		const hrefs = expectFormulaLinks(guide.formulas, guide.notes)

		expect(hrefs).toContain(`#${STATE_PENSION_GUIDE_IDS.rate}`)
		expect(hrefs).toContain(`#${STATE_PENSION_GUIDE_IDS.early}`)
		expect(hrefs).toContain(`#${STATE_PENSION_GUIDE_IDS.gap}`)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => buildStatePensionGuide(lang).notes, "state-pension")
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildStatePensionGuide(lang)
		const money = (cents: number) => formatMoney(lang, cents / 100, { decimals: 2 })

		expect(guide.pensionFlow.map((figure) => figure.value)).toEqual([
			money(result.statutoryCents),
			money(result.monthlyCents),
			money(result.netPensionCents),
		])
		expect(guide.gapFlow.map((figure) => figure.value)).toEqual([
			money(result.netPayCents),
			money(result.netPensionCents),
			money(result.gapCents),
		])
		expect(result.netPayCents - result.netPensionCents).toBe(result.gapCents)
	})

	it("retires the example early, so the early formula applies to it", () => {
		expect(result.adjustment).toBe("early")
		const expected = Math.round((result.statutoryCents * (10_000 - result.penaltyBp) * SUSTAINABILITY_FACTOR_2026_BP) / 100_000_000)
		expect(result.monthlyCents).toBe(expected)
	})
})
