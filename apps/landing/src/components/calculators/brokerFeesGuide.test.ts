import { describe, expect, it } from "vitest"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { getTranslations } from "@/lib/translations"
import { createFeeFormat } from "@/lib/calculators/brokerFeesFormat"
import { brokerFeesExample, buildBrokerFeesGuide } from "./brokerFeesGuide"
import { expectTerms } from "./guideTestUtils"

const { bank, online } = brokerFeesExample()

describe("broker fees guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every step and figure in %s", (lang) => {
		const guide = buildBrokerFeesGuide(lang)

		expectTerms(guide.steps)
		expect(guide.steps).toHaveLength(5)
		expect(guide.stepsNote.trim()).not.toBe("")
		expect(guide.flowOperators).toHaveLength(guide.bankFlow.length - 1)
	})

	it.each(SUPPORTED_LANGS)("takes each broker's year from the table's own computation in %s", (lang) => {
		const format = createFeeFormat(getTranslations(lang), lang)
		const guide = buildBrokerFeesGuide(lang)

		for (const [flow, side] of [[guide.bankFlow, bank], [guide.onlineFlow, online]] as const) {
			expect(flow.map((figure) => figure.value)).toEqual([
				format.eur2(side.cost.trading),
				format.eur2(side.cost.fx),
				format.eur2(side.cost.custody),
				format.eur2(side.cost.total),
			])
			// The parts add up to the year's total.
			expect(Math.round((side.cost.trading + side.cost.fx + side.cost.custody) * 100) / 100).toBe(side.cost.total)
		}
	})
})
