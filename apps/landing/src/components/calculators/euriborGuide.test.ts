import { describe, expect, it } from "vitest"
import { EURIBOR_EXAMPLE, computeEuriborImpact } from "@/lib/calculators/euribor"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { buildEuriborGuide } from "./euriborGuide"
import { expectFigures } from "./guideTestUtils"

const outcome = computeEuriborImpact(EURIBOR_EXAMPLE)
if (!outcome.ok) throw new Error("invalid example")
const { revision } = outcome.result

describe("Euribor guide content", () => {
	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildEuriborGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })
		expectFigures(guide.payment)

		expect(guide.payment[0].value).toBe(money(revision.current.monthlyPayment))
		expect(guide.payment[1].value).toContain(money(revision.monthlyChange))
		expect(guide.payment[2].value).toBe(money(revision.revised.monthlyPayment))
	})

	it("adds today's payment and the change up to the new payment", () => {
		const cents = (value: number) => Math.round(value * 100)
		expect(cents(revision.current.monthlyPayment + revision.monthlyChange)).toBe(cents(revision.revised.monthlyPayment))
	})
})
