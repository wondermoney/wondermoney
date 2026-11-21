import { describe, expect, it } from "vitest"
import { SAVINGS_GOAL_EXAMPLE, computeSavingsGoal } from "@/lib/calculators/savingsGoal"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { expectFigures, expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"
import { SAVINGS_GOAL_GUIDE_IDS, buildSavingsGoalGuide } from "./savingsGoalGuide"

const calculation = computeSavingsGoal(SAVINGS_GOAL_EXAMPLE)
if (!calculation.ok) throw new Error("The savings goal example must be valid")
const result = calculation.result

describe("savings goal guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every figure, formula and note in %s", (lang) => {
		const guide = buildSavingsGoalGuide(lang)

		expectTerms(guide.notes)
		expectFigures(guide.flow)
		expect(guide.formulas).toHaveLength(2)
		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a note on the page in %s", (lang) => {
		const guide = buildSavingsGoalGuide(lang)
		const hrefs = expectFormulaLinks(guide.formulas, guide.notes)

		// The monthly rate and the months appear in the powers and the fraction too.
		expect(hrefs).toContain(`#${SAVINGS_GOAL_GUIDE_IDS.rate}`)
		expect(hrefs).toContain(`#${SAVINGS_GOAL_GUIDE_IDS.contribution}`)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => buildSavingsGoalGuide(lang).notes, "savings-goal")
		expect(buildSavingsGoalGuide("en").notes.map((note) => note.id)).toEqual(Object.values(SAVINGS_GOAL_GUIDE_IDS))
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildSavingsGoalGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: Number.isInteger(value) ? 0 : 2 })

		expect(guide.flow.map((figure) => figure.value)).toEqual([
			money(SAVINGS_GOAL_EXAMPLE.startingSavings),
			money(result.totalContributions),
			money(result.totalGrowth),
			money(result.finalBalance),
		])
		// The parts add up to the final balance, as the operators say.
		expect(SAVINGS_GOAL_EXAMPLE.startingSavings + result.totalContributions + result.totalGrowth).toBeCloseTo(result.finalBalance, 2)
	})
})
