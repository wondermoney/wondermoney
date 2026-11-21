import { describe, expect, it } from "vitest"
import { formatMoney, formatPercent } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { expectTerms } from "./guideTestUtils"
import { buildTermDepositOffersGuide, termDepositOffersExample } from "./termDepositOffersGuide"

const { result } = termDepositOffersExample()

describe("term deposit offers guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every step and figure in %s", (lang) => {
		const guide = buildTermDepositOffersGuide(lang)

		expectTerms(guide.steps)
		expect(guide.steps).toHaveLength(4)
		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the table's own computation in %s", (lang) => {
		const guide = buildTermDepositOffersGuide(lang)
		const eur = (value: number) => formatMoney(lang, value, { currency: "EUR", decimals: 2 })

		expect(guide.flow.map((figure) => figure.value)).toEqual([
			eur(result.grossInterest),
			eur(Math.round((result.grossInterest - result.netInterest) * 100) / 100),
			eur(result.netInterest),
			formatPercent(lang, result.netAnnualYield, { decimals: 2 }),
		])
	})
})
