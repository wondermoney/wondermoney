import { describe, expect, it } from "vitest"
import { ELECTRICITY_BILL_EXAMPLE, computeElectricityBill } from "@/lib/calculators/electricityBill"
import { computeFuelCost, fuelCostExample } from "@/lib/calculators/fuelCost"
import { formatMoney, formatNumber } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { buildElectricityIndexGuide, buildFuelPricesGuide, buildTariffComparisonGuide } from "./energyGuides"
import { guideFigureFaces } from "./guideBlocks"
import { expectFigures, expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"

// The strings' own values are the pages' business; these builders only pass them through.
const VALUES = new Proxy({}, { get: () => "x" }) as Record<string, string>

const bill = (overrides: Partial<typeof ELECTRICITY_BILL_EXAMPLE>) => {
	const outcome = computeElectricityBill({ ...ELECTRICITY_BILL_EXAMPLE, ...overrides })
	if (!outcome.ok) throw new Error("example must be valid")
	return outcome.result
}

describe("electricity index guide content", () => {
	it.each(SUPPORTED_LANGS)("has its terms, figures and formula in %s", (lang) => {
		const guide = buildElectricityIndexGuide(lang, VALUES)

		expectTerms(guide.readTerms)
		expectTerms(guide.notes)
		expectFigures(guide.scenarios)
		expect(expectFormulaLinks(guide.formulas, guide.notes)).toHaveLength(5)
	})

	it.each(SUPPORTED_LANGS)("takes the three months from the bill estimator in %s", (lang) => {
		const euro = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(buildElectricityIndexGuide(lang, VALUES).scenarios.map((figure) => figure.value)).toEqual([
			euro(bill({}).total),
			euro(bill({ option: "biHourly", offPeakPercent: 50 }).total),
			euro(bill({ contractedPower: 6.9, consumption: 300 }).total),
		])
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => buildElectricityIndexGuide(lang, VALUES).notes, "electricity-index")
	})
})

describe("electricity tariff comparison guide content", () => {
	it.each(SUPPORTED_LANGS)("has its terms and the example's difference in %s", (lang) => {
		const guide = buildTariffComparisonGuide(lang, { regulated: 600.5, cheapest: 511.73 })

		expectTerms(guide.useTerms)
		expectTerms(guide.steps)
		expect(guide.steps).toHaveLength(7)
		expectFigures(guide.flow)
		expect(guide.flow[2].value).toBe(formatMoney(lang, 600.5 - 511.73, { decimals: 2 }))
		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
		// "First year" is words; the amounts are figures.
		expect(guide.flow.slice(0, 2).map((figure) => guideFigureFaces(figure).detail)).toEqual(["font-sans", "font-sans"])
		for (const figure of guide.flow) expect(guideFigureFaces(figure).value).toBe("font-mono")
	})
})

describe("fuel prices guide content", () => {
	const outcome = computeFuelCost(fuelCostExample())
	if (!outcome.ok) throw new Error("example must be valid")
	const { result } = outcome

	it.each(SUPPORTED_LANGS)("has its terms, figures and formulas in %s", (lang) => {
		const guide = buildFuelPricesGuide(lang, VALUES)

		expectTerms(guide.readTerms)
		expectTerms(guide.notes)
		expectTerms(guide.limits)
		expectFigures(guide.flow)
		expectFormulaLinks(guide.formulas, guide.notes)
		expect(guide.formulas).toHaveLength(3)
	})

	it.each(SUPPORTED_LANGS)("takes the example's cost from the calculator in %s", (lang) => {
		const guide = buildFuelPricesGuide(lang, VALUES)

		expect(guide.flow[1].value).toBe(formatMoney(lang, result.monthly, { decimals: 2 }))
		expect(guide.flow[2].value).toBe(formatMoney(lang, result.yearly, { decimals: 0 }))
		expect(guide.flow[0].value).toBe(`${formatNumber(lang, result.monthlyLitres, 1)} L`)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => buildFuelPricesGuide(lang, VALUES).notes, "fuel-prices")
	})
})
