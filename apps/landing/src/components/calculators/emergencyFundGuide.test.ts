import { describe, expect, it } from "vitest"
import { EXAMPLE_INPUTS, computeEmergencyFund } from "@/lib/calculators/emergencyFund"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { expectFigures, expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"
import { EMERGENCY_FUND_GUIDE_IDS, buildEmergencyFundGuide } from "./emergencyFundGuide"

const result = computeEmergencyFund(EXAMPLE_INPUTS)

describe("emergency fund guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every figure, formula and note in %s", (lang) => {
		const guide = buildEmergencyFundGuide(lang)

		expectTerms(guide.notes)
		expectFigures(guide.flow)
		expect(guide.formulas).toHaveLength(3)
		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a note on the page in %s", (lang) => {
		const guide = buildEmergencyFundGuide(lang)
		expect(expectFormulaLinks(guide.formulas, guide.notes).length).toBe(formulaHrefs(guide.formulas).length)
		expect(formulaHrefs(guide.formulas)).toHaveLength(7)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => buildEmergencyFundGuide(lang).notes, "emergency-fund")
		expect(buildEmergencyFundGuide("en").notes.map((note) => note.id)).toEqual(Object.values(EMERGENCY_FUND_GUIDE_IDS))
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildEmergencyFundGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 0 })

		expect(guide.flow[0].value).toBe(money(result.target))
		expect(guide.flow[1].value).toBe(money(result.shortfall))
		expect(guide.flow[2].value).toContain(String(result.monthsToTarget))
	})

	it("quotes the worked example the calculator starts from", () => {
		const guide = buildEmergencyFundGuide("en")

		expect(guide.exampleValues.target).toBe(formatMoney("en", 9000, { decimals: 0 }))
		expect(guide.exampleValues.shortfall).toBe(formatMoney("en", 6000, { decimals: 0 }))
		expect(guide.exampleValues.monthsToTarget).toBe(24)
		expect(guide.flow[0].detail).toBe(`${formatMoney("en", 1500, { decimals: 0 })} × 6`)
	})
})
