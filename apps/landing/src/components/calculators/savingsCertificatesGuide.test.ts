import { describe, expect, it } from "vitest"
import { SAVINGS_CERTIFICATES_EXAMPLE } from "@/lib/calculators/savingsCertificates"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"
import {
	SAVINGS_CERTIFICATES_GUIDE_IDS,
	buildSavingsCertificatesGuide,
	savingsCertificatesExampleResult,
} from "./savingsCertificatesGuide"

const result = savingsCertificatesExampleResult()

describe("savings certificates guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every note, figure and formula in %s", (lang) => {
		const guide = buildSavingsCertificatesGuide(lang)

		expectTerms(guide.notes)
		expect(guide.formulas).toHaveLength(4)
		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
		for (const value of Object.values(guide.values)) expect(value).not.toMatch(/\{\{/)
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a note in %s", (lang) => {
		const guide = buildSavingsCertificatesGuide(lang)
		const hrefs = expectFormulaLinks(guide.formulas, guide.notes)

		for (const id of Object.values(SAVINGS_CERTIFICATES_GUIDE_IDS)) expect(hrefs).toContain(`#${id}`)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => buildSavingsCertificatesGuide(lang).notes, "savings-certificates")
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildSavingsCertificatesGuide(lang)
		const money = (value: number, decimals = 2) => formatMoney(lang, value, { decimals })

		expect(guide.flow.map((figure) => figure.value)).toEqual([
			money(SAVINGS_CERTIFICATES_EXAMPLE.amount, 0),
			money(result.netInterest),
			money(result.finalValue),
		])
		expect(guide.flow[1].detail).toBe(`${money(result.grossInterest)} − ${money(result.irs)}`)
		// The amount and the net interest make the final value, and gross − IRS is the net.
		expect(Math.round((SAVINGS_CERTIFICATES_EXAMPLE.amount + result.netInterest) * 100) / 100).toBe(result.finalValue)
		expect(Math.round((result.grossInterest - result.irs) * 100) / 100).toBe(result.netInterest)
	})
})
