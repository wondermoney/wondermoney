import { describe, expect, it } from "vitest"
import { DISMISSAL_EXAMPLE, computeDismissalCompensation } from "@/lib/calculators/dismissalCompensation"
import { SICK_PAY_EXAMPLE, computeSickPay } from "@/lib/calculators/sickPay"
import { UNEMPLOYMENT_EXAMPLE, computeUnemploymentBenefit } from "@/lib/calculators/unemploymentBenefit"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { buildDismissalGuide, buildSickPayGuide, buildUnemploymentGuide } from "./benefitGuides"
import { expectFigures, expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"

type Lang = (typeof SUPPORTED_LANGS)[number]
const euros = (lang: Lang, cents: number) => formatMoney(lang, cents / 100, { decimals: 2 })

const builders = [
	["unemployment benefit", buildUnemploymentGuide, "unemployment"],
	["sick pay", buildSickPayGuide, "sick-pay"],
	["dismissal compensation", buildDismissalGuide, "dismissal"],
] as const

describe.each(builders)("%s guide content", (_name, build, prefix) => {
	it.each(SUPPORTED_LANGS)("has a term for every method note and links every formula variable in %s", (lang) => {
		const guide = build(lang)

		expectTerms(guide.notes)
		expectFigures(guide.figures)
		expectFormulaLinks(guide.formulas, guide.notes)
		if (guide.flowOperators) expect(guide.flowOperators).toHaveLength(guide.figures.length - 1)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => build(lang).notes, prefix)
	})
})

describe("benefit guides' figures", () => {
	it.each(SUPPORTED_LANGS)("take the unemployment example from the calculator in %s", (lang) => {
		const outcome = computeUnemploymentBenefit(UNEMPLOYMENT_EXAMPLE)
		if (!outcome.ok) throw new Error("example must be valid")
		const { result } = outcome

		expect(buildUnemploymentGuide(lang).figures.map((figure) => figure.value)).toEqual([
			euros(lang, result.monthlyCents),
			euros(lang, result.totalCents),
			`−${euros(lang, result.monthlyDropCents)}`,
		])
		expect(result.netReferenceMonthlyCents - result.monthlyCents).toBe(result.monthlyDropCents)
	})

	it.each(SUPPORTED_LANGS)("take the sick pay bands and their total from the calculator in %s", (lang) => {
		const outcome = computeSickPay(SICK_PAY_EXAMPLE)
		if (!outcome.ok) throw new Error("example must be valid")
		const { result } = outcome
		const guide = buildSickPayGuide(lang)

		expect(guide.figures.map((figure) => figure.value)).toEqual([
			...result.bands.map((band) => euros(lang, band.amountCents)),
			euros(lang, result.totalCents),
		])
		expect(result.bands.reduce((sum, band) => sum + band.amountCents, 0)).toBe(result.totalCents)
		for (const band of result.bands) expect(band.paidDays * band.dailyCents).toBe(band.amountCents)
	})

	it.each(SUPPORTED_LANGS)("take the dismissal periods and their total from the calculator in %s", (lang) => {
		const outcome = computeDismissalCompensation(DISMISSAL_EXAMPLE)
		if (!outcome.ok) throw new Error("example must be valid")
		const { result } = outcome
		const guide = buildDismissalGuide(lang)

		expect(guide.figures.map((figure) => figure.value)).toEqual([
			...result.lines.map((line) => euros(lang, line.amountCents)),
			euros(lang, result.compensationCents),
		])
		const shares = guide.figures.reduce((sum, figure) => sum + (figure.share ?? 0), 0)
		expect(Math.round(shares)).toBe(100)
	})
})
