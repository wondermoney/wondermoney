import { describe, expect, it } from "vitest"
import { RATE_REVISION_EXAMPLE, computeRateRevision } from "@/lib/calculators/rateRevision"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { expectGuideParts, expectStableIds } from "./guideTestKit"
import { RATE_REVISION_GUIDE_IDS, buildRateRevisionGuide } from "./rateRevisionGuide"

const input = RATE_REVISION_EXAMPLE
const calculation = computeRateRevision(input)
if (!calculation.ok) throw new Error("invalid example")
const result = calculation.result

describe("rate revision guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildRateRevisionGuide(lang)
		expectGuideParts({
			terms: [...guide.notes, ...guide.assumptions, ...guide.contract],
			figures: [...guide.rise, ...guide.incomeShares],
			formulas: guide.formulas,
		})
		expect(guide.contract).toHaveLength(4)
		expect(formulaHrefs(guide.formulas).length).toBeGreaterThanOrEqual(14)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => {
			const guide = buildRateRevisionGuide(lang)
			return [...guide.notes, ...guide.assumptions].map((note) => note.id)
		}, "rate-revision")
		const guide = buildRateRevisionGuide("en")
		expect([...guide.notes, ...guide.assumptions].map((note) => note.id)).toEqual(Object.values(RATE_REVISION_GUIDE_IDS))
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildRateRevisionGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(guide.rise.map((figure) => figure.value)).toEqual([
			money(result.current.monthlyPayment),
			`+${money(result.monthlyChange)}`,
			money(result.revised.monthlyPayment),
		])
		const income = result.income
		if (income?.current.status !== "ok" || income.revised.status !== "ok") throw new Error("no income share")
		expect(guide.incomeShares.slice(0, 2).map((figure) => figure.share)).toEqual([
			income.current.ratio,
			income.revised.ratio,
		])
	})

	it("adds today's payment and the change up to the new payment", () => {
		const cents = (value: number) => Math.round(value * 100)
		expect(cents(result.current.monthlyPayment + result.monthlyChange)).toBe(cents(result.revised.monthlyPayment))
	})
})
