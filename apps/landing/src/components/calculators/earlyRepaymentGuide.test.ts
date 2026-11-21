import { describe, expect, it } from "vitest"
import { EARLY_REPAYMENT_EXAMPLE, computeEarlyRepayment } from "@/lib/calculators/earlyRepayment"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { EARLY_REPAYMENT_GUIDE_IDS, buildEarlyRepaymentGuide } from "./earlyRepaymentGuide"
import { expectFigures, expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"

const run = (feePercent: number) => {
	const calculation = computeEarlyRepayment({ ...EARLY_REPAYMENT_EXAMPLE, feePercent })
	if (!calculation.ok) throw new Error("invalid example")
	return calculation.result
}
const example = run(EARLY_REPAYMENT_EXAMPLE.feePercent)
const withFee = run(EARLY_REPAYMENT_EXAMPLE.exampleFeePercent)

describe("early repayment guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildEarlyRepaymentGuide(lang)
		expectTerms([...guide.choices, ...guide.checks, ...guide.notes, ...guide.assumptions])
		expectFigures([...guide.repayment, ...guide.outcomes, ...guide.interestSaved, ...guide.netSaving])
		expectFormulaLinks(guide.formulas, [...guide.choices, ...guide.checks, ...guide.notes, ...guide.assumptions])
		expect(guide.checks).toHaveLength(5)
		expect(formulaHrefs(guide.formulas).length).toBeGreaterThanOrEqual(14)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => {
			const guide = buildEarlyRepaymentGuide(lang)
			return [...guide.notes, ...guide.assumptions]
		}, "early-repayment")
		const guide = buildEarlyRepaymentGuide("en")
		expect([...guide.notes, ...guide.assumptions].map((note) => note.id)).toEqual(
			expect.arrayContaining(Object.values(EARLY_REPAYMENT_GUIDE_IDS)),
		)
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildEarlyRepaymentGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(guide.repayment.map((figure) => figure.value)).toEqual([
			money(EARLY_REPAYMENT_EXAMPLE.balance),
			money(EARLY_REPAYMENT_EXAMPLE.repayment),
			money(example.balanceAfter),
		])
		expect(guide.outcomes[0].value).toBe(money(example.lowerPayment.monthlyPayment))
		expect(guide.interestSaved.map((figure) => figure.value)).toEqual([
			money(example.lowerPayment.interestSaved),
			money(example.shorterTerm.interestSaved),
		])
		expect(guide.netSaving.map((figure) => figure.value)).toEqual([
			money(withFee.lowerPayment.netSaving),
			money(withFee.shorterTerm.netSaving),
		])
	})

	it("matches the story: the shorter term saves more interest", () => {
		expect(example.shorterTerm.interestSaved).toBeGreaterThan(example.lowerPayment.interestSaved)
		expect(example.balanceAfter).toBe(EARLY_REPAYMENT_EXAMPLE.balance - EARLY_REPAYMENT_EXAMPLE.repayment)
	})
})
