import { describe, expect, it } from "vitest"
import { DEBT_TO_INCOME_WORKED_EXAMPLE, compareDebtScenario } from "@/lib/calculators/debtToIncome"
import { formatMoney, formatPercent } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { DEBT_TO_INCOME_GUIDE_IDS, buildDebtToIncomeGuide } from "./debtToIncomeGuide"

const example = DEBT_TO_INCOME_WORKED_EXAMPLE
const { current, scenario } = compareDebtScenario(example.monthlyIncome, example.rows, example.scenario)

describe("debt-to-income guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every band, note and figure in %s", (lang) => {
		const guide = buildDebtToIncomeGuide(lang)

		for (const entry of [...guide.bands, ...guide.notes]) {
			expect(entry.term.trim()).not.toBe("")
			expect(entry.body.trim()).not.toBe("")
			expect(`${entry.term}${entry.body}`).not.toMatch(/\{\{/)
			expect(entry.body.startsWith(`${entry.term}:`)).toBe(false)
		}
		expect(guide.flow).toHaveLength(3)
		expect(guide.comparison).toHaveLength(2)
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a note in %s", (lang) => {
		const guide = buildDebtToIncomeGuide(lang)
		const ids = new Set([...guide.bands, ...guide.notes].map((entry) => entry.id))
		const hrefs = formulaHrefs(guide.formulas)

		expect(hrefs).toHaveLength(3)
		for (const href of hrefs) expect(ids.has(href.slice(1))).toBe(true)
	})

	it("keeps the same ids in every locale", () => {
		const idsOf = (lang: (typeof SUPPORTED_LANGS)[number]) => {
			const guide = buildDebtToIncomeGuide(lang)
			return [...guide.bands, ...guide.notes].map((entry) => entry.id)
		}
		expect(idsOf("en")).toEqual(Object.values(DEBT_TO_INCOME_GUIDE_IDS))
		for (const lang of SUPPORTED_LANGS) expect(idsOf(lang)).toEqual(idsOf("en"))
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildDebtToIncomeGuide(lang)
		const money = (value: number) => formatMoney(lang, value)

		expect(guide.flow.map((figure) => figure.value)).toEqual([
			money(current.totalPayments),
			money(example.monthlyIncome),
			formatPercent(lang, current.ratio as number),
		])
		expect(guide.comparison.map((figure) => figure.share)).toEqual([current.ratio, scenario.ratio])
		expect(guide.comparison.map((figure) => figure.value)).toEqual([
			formatPercent(lang, current.ratio as number),
			formatPercent(lang, scenario.ratio as number),
		])
	})

	it("tells the story the copy describes: caution now, healthy after the change", () => {
		expect(current.band).toBe("caution")
		expect(scenario.band).toBe("healthy")
	})
})
