import { describe, expect, it } from "vitest"
import {
	EXAMPLE_INPUTS,
	compareContributions,
	defaultComparisonContribution,
} from "@/lib/calculators/compoundInterest"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { COMPOUND_INTEREST_GUIDE_IDS, buildCompoundInterestGuide } from "./compoundInterestGuide"
import { expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"

const { current } = compareContributions(EXAMPLE_INPUTS, defaultComparisonContribution(EXAMPLE_INPUTS.monthlyContribution))

describe("compound interest guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every note, figure and formula in %s", (lang) => {
		const guide = buildCompoundInterestGuide(lang)

		expectTerms(guide.notes)
		expect(guide.notes).toHaveLength(5)
		expect(guide.formulas).toHaveLength(2)
		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
		for (const figure of guide.flow) expect(figure.label.trim()).not.toBe("")
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a note in %s", (lang) => {
		const guide = buildCompoundInterestGuide(lang)
		const hrefs = expectFormulaLinks(guide.formulas, guide.notes)

		// Balance, start balance, annual return, contribution; real value, value, inflation, years.
		expect(hrefs).toHaveLength(8)
		expect(hrefs).toContain(`#${COMPOUND_INTEREST_GUIDE_IDS.monthly}`)
		expect(hrefs).toContain(`#${COMPOUND_INTEREST_GUIDE_IDS.inflation}`)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => buildCompoundInterestGuide(lang).notes, "compound-interest")
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildCompoundInterestGuide(lang)
		const money = (value: number) => formatMoney(lang, value)

		expect(guide.flow.map((figure) => figure.value)).toEqual([
			money(current.nominal!.contributed),
			money(current.nominal!.growth),
			money(current.nominal!.finalValue),
			money(current.real!.finalValue),
		])
		// What was paid in and the growth add up to the final value.
		expect(current.nominal!.contributed + current.nominal!.growth).toBe(current.nominal!.finalValue)
	})

	it("quotes the calculator's starting example", () => {
		const guide = buildCompoundInterestGuide("en")

		expect(guide.values.contributed).toBe(formatMoney("en", 58_000))
		expect(guide.values.final).toBe(formatMoney("en", 144_573))
		expect(guide.values.realFinal).toBe(formatMoney("en", 97_293))
	})
})
