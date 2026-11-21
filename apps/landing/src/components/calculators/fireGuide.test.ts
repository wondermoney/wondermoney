import { describe, expect, it } from "vitest"
import { formatFireDuration, formatFireProgress, formatFireRate } from "@/lib/calculators/fireFormat"
import { FIRE_WORKED_EXAMPLE } from "@/lib/calculators/fire"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { FIRE_GUIDE_IDS, buildFireGuide, fireExampleResults } from "./fireGuide"
import { guideFigureFaces } from "./guideBlocks"
import { expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"

const { result } = fireExampleResults()

describe("FIRE guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every note, figure and formula in %s", (lang) => {
		const guide = buildFireGuide(lang)

		expectTerms(guide.notes)
		expect(guide.notes).toHaveLength(6)
		expect(guide.formulas).toHaveLength(3)
		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a note in %s", (lang) => {
		const guide = buildFireGuide(lang)
		const hrefs = expectFormulaLinks(guide.formulas, guide.notes)

		expect(hrefs).toContain(`#${FIRE_GUIDE_IDS.multiple}`)
		expect(hrefs).toContain(`#${FIRE_GUIDE_IDS.growth}`)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => buildFireGuide(lang).notes, "fire")
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildFireGuide(lang)

		expect(guide.flow.map((figure) => figure.value)).toEqual([
			formatMoney(lang, FIRE_WORKED_EXAMPLE.annualSpending),
			formatFireRate(lang, FIRE_WORKED_EXAMPLE.withdrawalRate),
			formatMoney(lang, result.fireNumber),
		])
		expect(guide.outcome.map((figure) => figure.value)).toEqual([
			formatFireProgress(lang, result.progress ?? 0),
			formatFireDuration(lang, result.monthsToTarget ?? 0),
		])
		expect(guide.outcome[0].share).toBe(result.progress)
	})

	it.each(SUPPORTED_LANGS)("sets the time to FIRE in the body face and the amounts as figures in %s", (lang) => {
		const guide = buildFireGuide(lang)

		expect(guide.outcome.map((figure) => guideFigureFaces(figure).value)).toEqual(["font-mono", "font-sans"])
		for (const figure of guide.flow) expect(guideFigureFaces(figure).value).toBe("font-mono")
	})

	it("quotes the worked example: 24 000 € a year at 4% is 600 000 €", () => {
		expect(result.fireNumber).toBe(600_000)
		expect(buildFireGuide("en").values.target).toBe(formatMoney("en", 600_000))
	})
})
