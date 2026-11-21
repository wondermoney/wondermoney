import { describe, expect, it } from "vitest"
import { TERM_DEPOSIT_EXAMPLE } from "@/lib/calculators/termDeposit"
import { formatMoney, formatPercent } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"
import { TERM_DEPOSIT_GUIDE_IDS, buildTermDepositGuide, termDepositExampleResults } from "./termDepositGuide"

const { atMaturity, taxed } = termDepositExampleResults()
const allTerms = (lang: (typeof SUPPORTED_LANGS)[number]) => {
	const guide = buildTermDepositGuide(lang)
	return [...guide.readTerms, ...guide.notes]
}

describe("term deposit guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildTermDepositGuide(lang)

		expectTerms(guide.readTerms)
		expectTerms(guide.notes)
		expect(guide.readTerms).toHaveLength(5)
		expect(guide.notes).toHaveLength(7)
		expect(guide.formulas).toHaveLength(4)
		expect(guide.maturityOperators).toHaveLength(guide.maturityFlow.length - 1)
		expect(guide.taxOperators).toHaveLength(guide.taxFlow.length - 1)
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a term or note in %s", (lang) => {
		const guide = buildTermDepositGuide(lang)
		const hrefs = expectFormulaLinks(guide.formulas, allTerms(lang))

		expect(hrefs).toContain(`#${TERM_DEPOSIT_GUIDE_IDS.net}`)
		expect(hrefs).toContain(`#${TERM_DEPOSIT_GUIDE_IDS.taxNote}`)
		expect(hrefs).toContain(`#${TERM_DEPOSIT_GUIDE_IDS.yieldNote}`)
	})

	it("keeps the same ids in every locale", () => {
		expectStableIds(allTerms, "term-deposit")
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildTermDepositGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: Number.isInteger(value) ? 0 : 2 })

		expect(guide.maturityFlow.map((figure) => figure.value)).toEqual([
			money(TERM_DEPOSIT_EXAMPLE.amount),
			money(atMaturity.grossInterest),
			money(atMaturity.finalBalance),
		])
		expect(guide.taxFlow.map((figure) => figure.value)).toEqual([
			money(taxed.grossInterest),
			money(taxed.tax),
			money(taxed.netInterest),
			formatPercent(lang, taxed.effectiveAnnualNetYield, { decimals: 2 }),
		])
		// The flows add up: amount + interest = balance; gross − tax = net.
		expect(TERM_DEPOSIT_EXAMPLE.amount + atMaturity.grossInterest).toBe(atMaturity.finalBalance)
		expect(Math.round((taxed.grossInterest - taxed.tax) * 100) / 100).toBe(taxed.netInterest)
	})

	it("quotes the worked example: 10 000 € for 24 months at 3%, then 20% withheld", () => {
		const guide = buildTermDepositGuide("en")

		expect(guide.values.gross).toBe(formatMoney("en", 600, { decimals: 0 }))
		expect(guide.values.tax).toBe(formatMoney("en", 120, { decimals: 0 }))
		expect(guide.values.net).toBe(formatMoney("en", 480, { decimals: 0 }))
	})
})
